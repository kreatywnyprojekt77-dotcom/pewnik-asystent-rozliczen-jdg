export class CredentialConfigurationError extends Error {}

export type ValidatedKsefCredentials = {
  nip: string;
  token: string;
};

function normalizeNip(value: string): string {
  return value.replace(/\D/g, "");
}

export function validateChallengeTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new CredentialConfigurationError(
      "KSeF zwrócił nieprawidłowy timestampMs. Wymagana jest całkowita liczba milisekund z /auth/challenge.",
    );
  }
  return value;
}

export function validateKsefCredentials(
  rawToken: string,
  rawConfiguredNip: string,
  rawRequestedNip?: string,
): ValidatedKsefCredentials {
  const nip = normalizeNip(rawConfiguredNip);
  if (!/^\d{10}$/.test(nip)) {
    throw new CredentialConfigurationError("Sekret KSEF_NIP musi zawierać dokładnie 10 cyfr.");
  }

  if (rawRequestedNip != null) {
    const requestedNip = normalizeNip(rawRequestedNip);
    if (!/^\d{10}$/.test(requestedNip)) {
      throw new CredentialConfigurationError("NIP zapisany w aplikacji musi zawierać dokładnie 10 cyfr.");
    }
    if (requestedNip !== nip) {
      throw new CredentialConfigurationError(
        "NIP zapisany w aplikacji nie zgadza się z sekretem KSEF_NIP funkcji Supabase.",
      );
    }
  }

  const token = rawToken.trim();
  if (!token) throw new CredentialConfigurationError("Brak sekretu funkcji KSEF_TOKEN.");
  if (token !== rawToken || /\s/.test(token)) {
    throw new CredentialConfigurationError(
      "KSEF_TOKEN zawiera biały znak. Wklej ponownie pełną wartość pola Token bez spacji i nowej linii.",
    );
  }
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    throw new CredentialConfigurationError("KSEF_TOKEN nie może zawierać cudzysłowów.");
  }
  if (token.length > 160) {
    throw new CredentialConfigurationError("KSEF_TOKEN przekracza maksymalną długość tokena KSeF 2.0.");
  }

  const parts = token.split("|");
  if (parts.length !== 3) {
    const looksLikeReferenceNumber = /^\d{8}-[A-Z]{2}-/i.test(token);
    throw new CredentialConfigurationError(
      looksLikeReferenceNumber
        ? "W KSEF_TOKEN zapisano prawdopodobnie tylko numer referencyjny. Wymagana jest pełna, jednorazowo wyświetlana wartość pola Token z KSeF 2.0 (trzy części rozdzielone znakiem |)."
        : "KSEF_TOKEN nie ma formatu tokena KSeF 2.0. Wymagana jest pełna wartość pola Token (trzy części rozdzielone znakiem |), a nie accessToken/JWT ani token KSeF 1.0.",
    );
  }

  const [referenceNumber, context, secret] = parts;
  if (!/^\d{8}-[A-Z]{2}-[A-Z0-9-]+$/i.test(referenceNumber) || !context || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new CredentialConfigurationError(
      "KSEF_TOKEN jest niekompletny lub uszkodzony. Skopiuj pełne pole Token bez etykiety, cudzysłowów i spacji.",
    );
  }

  const tokenNip = /^nip-(\d{10})$/i.exec(context)?.[1];
  if (tokenNip && tokenNip !== nip) {
    throw new CredentialConfigurationError(
      "Token KSeF został wygenerowany dla innego NIP niż sekret KSEF_NIP.",
    );
  }
  if (/^internalid-/i.test(context)) {
    throw new CredentialConfigurationError(
      "Token KSeF został wygenerowany w kontekście identyfikatora wewnętrznego, a integracja jest skonfigurowana dla kontekstu NIP.",
    );
  }

  return { nip, token };
}
