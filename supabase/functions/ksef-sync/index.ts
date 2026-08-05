import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  CredentialConfigurationError,
  validateChallengeTimestamp,
  validateKsefCredentials,
} from "./credential-validation.ts";

const KSEF_BASE_URL = "https://api-test.ksef.mf.gov.pl/v2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new HttpError(503, `Brak sekretu funkcji ${name}.`);
  return value;
}

function errorMessage(error: unknown, fallback = "Nieznany błąd integracji KSeF."): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const parts = [details.message, details.details, details.hint, details.code]
      .filter((value) => typeof value === "string" && value.length > 0)
      .map(String);
    if (parts.length) return parts.join(" · ");
  }
  return fallback;
}

function supabaseError(error: unknown, operation: string): HttpError {
  return new HttpError(500, `Supabase (${operation}): ${errorMessage(error, "nieznany błąd bazy danych")}`);
}

async function ksefRequest<T>(
  path: string,
  init: RequestInit = {},
  bearerToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Error-Format", "problem-details");
  if (init.body) headers.set("Content-Type", "application/json");
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${KSEF_BASE_URL}${path}`, { ...init, headers });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (response.status === 429 && attempt < 2) {
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(5000, retryAfterSeconds * 1000)
        : 1100;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      continue;
    }

    if (!response.ok) {
      const problem = payload as JsonRecord | null;
      const details = Array.isArray(problem?.details) ? problem.details.join("; ") : "";
      const message = String(problem?.detail || problem?.title || details || payload || `HTTP ${response.status}`);
      throw new HttpError(response.status, `KSeF: ${message}`);
    }

    return payload as T;
  }

  throw new HttpError(429, "KSeF: przekroczono limit żądań mimo automatycznych ponowień.");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

type DerNode = {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
};

function readDerNode(data: Uint8Array, start: number): DerNode {
  if (start + 2 > data.length) throw new Error("Nieprawidłowy certyfikat DER.");
  const tag = data[start];
  const lengthByte = data[start + 1];
  let length = 0;
  let contentStart = start + 2;

  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const byteCount = lengthByte & 0x7f;
    if (!byteCount || byteCount > 4 || contentStart + byteCount > data.length) {
      throw new Error("Nieobsługiwana długość certyfikatu DER.");
    }
    for (let index = 0; index < byteCount; index += 1) {
      length = (length << 8) | data[contentStart + index];
    }
    contentStart += byteCount;
  }

  const end = contentStart + length;
  if (end > data.length) throw new Error("Ucięty certyfikat DER.");
  return { tag, start, contentStart, end };
}

// WebCrypto importuje SubjectPublicKeyInfo, a API KSeF zwraca cały certyfikat X.509.
function extractSubjectPublicKeyInfo(certificateDer: Uint8Array): Uint8Array {
  const certificate = readDerNode(certificateDer, 0);
  const tbsCertificate = readDerNode(certificateDer, certificate.contentStart);
  let offset = tbsCertificate.contentStart;
  let node = readDerNode(certificateDer, offset);

  if (node.tag === 0xa0) {
    offset = node.end; // opcjonalne pole version [0]
  }

  // serialNumber, signature, issuer, validity, subject
  for (let index = 0; index < 5; index += 1) {
    node = readDerNode(certificateDer, offset);
    offset = node.end;
  }

  const subjectPublicKeyInfo = readDerNode(certificateDer, offset);
  if (subjectPublicKeyInfo.tag !== 0x30) throw new Error("Nie znaleziono klucza publicznego w certyfikacie KSeF.");
  return certificateDer.slice(subjectPublicKeyInfo.start, subjectPublicKeyInfo.end);
}

async function encryptKsefToken(token: string, timestampMs: number) {
  const certificates = await ksefRequest<Array<{
    certificate: string;
    publicKeyId: string;
    validFrom: string;
    validTo: string;
    usage: string[];
  }>>("/security/public-key-certificates");

  const now = Date.now();
  const certificate = certificates.find((item) =>
    item.usage.includes("KsefTokenEncryption") &&
    Date.parse(item.validFrom) <= now &&
    Date.parse(item.validTo) > now
  );
  if (!certificate) throw new HttpError(503, "KSeF nie zwrócił aktywnego klucza do szyfrowania tokena.");

  const certificateDer = base64ToBytes(certificate.certificate);
  const spki = extractSubjectPublicKeyInfo(certificateDer);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const plaintext = new TextEncoder().encode(`${token}|${timestampMs}`);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, plaintext);
  return { encryptedToken: bytesToBase64(encrypted), publicKeyId: certificate.publicKeyId };
}

async function waitForAuthentication(referenceNumber: string, authenticationToken: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await ksefRequest<{ status: { code: number; description: string; details?: string[] } }>(
      `/auth/${encodeURIComponent(referenceNumber)}`,
      {},
      authenticationToken,
    );
    if (result.status.code === 200) return;
    if (result.status.code >= 400) {
      const details = result.status.details || [];
      const combined = [result.status.description, ...details].join(" ");
      if (result.status.code === 450 && details.some((detail) => /token encoding|kodowani[ea] token/i.test(detail))) {
        throw new HttpError(
          401,
          "KSeF odrzucił format tokena. W KSEF_TOKEN musi być pełna, jednorazowo wyświetlana wartość pola Token z KSeF 2.0 — nie numer referencyjny, accessToken/JWT ani token KSeF 1.0.",
        );
      }
      throw new HttpError(401, combined);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new HttpError(504, "KSeF nie zakończył uwierzytelniania w oczekiwanym czasie.");
}

async function authenticateKsef(nip: string, ksefToken: string): Promise<string> {
  const challenge = await ksefRequest<{ challenge: string; timestampMs: number }>(
    "/auth/challenge",
    { method: "POST" },
  );
  const encrypted = await encryptKsefToken(ksefToken, validateChallengeTimestamp(challenge.timestampMs));
  const initialized = await ksefRequest<{
    referenceNumber: string;
    authenticationToken: { token: string };
  }>("/auth/ksef-token", {
    method: "POST",
    body: JSON.stringify({
      challenge: challenge.challenge,
      contextIdentifier: { type: "Nip", value: nip },
      encryptedToken: encrypted.encryptedToken,
      publicKeyId: encrypted.publicKeyId,
    }),
  });

  const authenticationToken = initialized.authenticationToken.token;
  await waitForAuthentication(initialized.referenceNumber, authenticationToken);
  const tokens = await ksefRequest<{ accessToken: { token: string } }>(
    "/auth/token/redeem",
    { method: "POST" },
    authenticationToken,
  );
  return tokens.accessToken.token;
}

type KsefInvoiceMetadata = {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  invoicingDate: string;
  acquisitionDate: string;
  permanentStorageDate: string;
  seller: { nip: string; name?: string | null };
  buyer: { identifier: { type: string; value?: string | null }; name?: string | null };
  netAmount: number;
  grossAmount: number;
  vatAmount: number;
  currency: string;
  invoiceType: string;
  formCode: { systemCode: string; schemaVersion: string; value: string };
  invoiceHash: string;
};

async function queryInvoiceMetadata(
  accessToken: string,
  subjectType: "Subject1" | "Subject2",
  from: string,
): Promise<{ invoices: KsefInvoiceMetadata[]; hwmDate: string | null }> {
  const invoices: KsefInvoiceMetadata[] = [];
  let pageOffset = 0;
  let hwmDate: string | null = null;

  while (pageOffset < 40) {
    const result = await ksefRequest<{
      hasMore: boolean;
      isTruncated: boolean;
      permanentStorageHwmDate?: string | null;
      invoices: KsefInvoiceMetadata[];
    }>(`/invoices/query/metadata?pageOffset=${pageOffset}&pageSize=250&sortOrder=Asc`, {
      method: "POST",
      body: JSON.stringify({
        subjectType,
        dateRange: {
          dateType: "PermanentStorage",
          from,
          to: new Date().toISOString(),
          restrictToPermanentStorageHwmDate: true,
        },
      }),
    }, accessToken);

    invoices.push(...result.invoices);
    hwmDate = result.permanentStorageHwmDate || hwmDate;
    if (result.isTruncated) {
      throw new HttpError(409, "Zakres synchronizacji przekroczył 10 000 faktur. Wymagany jest import partiami.");
    }
    if (!result.hasMore) return { invoices, hwmDate };
    pageOffset += 1;
  }

  throw new HttpError(409, "Synchronizacja przekroczyła limit 10 000 faktur na jedno wywołanie.");
}

function invoiceRow(metadata: KsefInvoiceMetadata, userId: string, direction: "sale" | "cost") {
  const contractor = direction === "cost"
    ? metadata.seller.name || metadata.seller.nip
    : metadata.buyer.name || metadata.buyer.identifier.value || "Nabywca bez identyfikatora";
  const vatRate = metadata.netAmount
    ? Math.min(100, Math.max(0, Math.abs(metadata.vatAmount / metadata.netAmount * 100)))
    : 0;
  const standardRate = [23, 8, 5, 0].find((rate) => Math.abs(vatRate - rate) < 0.005);
  const isCorrection = String(metadata.invoiceType).toUpperCase().includes("KOR");

  return {
    user_id: userId,
    number: metadata.invoiceNumber,
    issue_date: metadata.issueDate,
    contractor,
    invoice_type: direction,
    net_amount: metadata.netAmount,
    vat_rate: Number(vatRate.toFixed(2)),
    vat_code: standardRate == null ? "MIXED" : String(standardRate),
    document_type: isCorrection ? "correction" : "invoice",
    received_date: direction === "cost" && metadata.acquisitionDate
      ? String(metadata.acquisitionDate).slice(0, 10)
      : null,
    category: null,
    source: "ksef",
    ksef_number: metadata.ksefNumber,
    ksef_status: "accepted",
    seller_nip: metadata.seller.nip,
    buyer_nip: metadata.buyer.identifier.type === "Nip" ? metadata.buyer.identifier.value : null,
    currency: metadata.currency,
    ksef_vat_amount: metadata.vatAmount,
    ksef_gross_amount: metadata.grossAmount,
    ksef_invoice_type: metadata.invoiceType,
    ksef_form_code: `${metadata.formCode.systemCode}/${metadata.formCode.schemaVersion}`,
    ksef_invoicing_date: metadata.invoicingDate,
    ksef_acquisition_date: metadata.acquisitionDate,
    ksef_permanent_storage_date: metadata.permanentStorageDate,
    invoice_hash: metadata.invoiceHash,
    ksef_metadata: metadata,
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Dozwolona jest tylko metoda POST." }, 405);

  let runId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;
  let userId: string | null = null;

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const rawKsefToken = Deno.env.get("KSEF_TOKEN") || "";
    const rawConfiguredNip = Deno.env.get("KSEF_NIP") || "";

    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Zaloguj się do Supabase.");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new HttpError(401, "Sesja Supabase jest nieważna.");

    userId = userData.user.id;
    admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const body = await request.json().catch(() => ({})) as { action?: string; nip?: string };
    const action = body.action || "status";
    let credentials;
    try {
      credentials = validateKsefCredentials(rawKsefToken, rawConfiguredNip, body.nip);
    } catch (error) {
      if (error instanceof CredentialConfigurationError) throw new HttpError(503, error.message);
      throw error;
    }
    const configuredNip = credentials.nip;
    const ksefToken = credentials.token;

    const accessToken = await authenticateKsef(configuredNip, ksefToken);
    const { error: connectionUpsertError } = await admin.from("ksef_connections").upsert({
      user_id: userId,
      environment: "test",
      nip: configuredNip,
      status: "connected",
      last_error: null,
      updated_at: new Date().toISOString(),
    });
    if (connectionUpsertError) throw supabaseError(connectionUpsertError, "zapis połączenia KSeF");

    if (action === "status") {
      return json({ connected: true, environment: "test", nip: configuredNip });
    }
    if (action !== "sync") throw new HttpError(400, "Nieznana operacja KSeF.");

    const { data: run, error: runError } = await admin.from("ksef_sync_runs")
      .insert({ user_id: userId })
      .select("id")
      .single();
    if (runError) throw supabaseError(runError, "utworzenie historii synchronizacji");
    runId = run.id;

    const { data: connection, error: connectionReadError } = await admin.from("ksef_connections")
      .select("last_hwm_date")
      .eq("user_id", userId)
      .maybeSingle();
    if (connectionReadError) throw supabaseError(connectionReadError, "odczyt stanu synchronizacji");
    const fallbackFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const previousHwm = connection?.last_hwm_date ? new Date(connection.last_hwm_date) : fallbackFrom;
    const from = new Date(previousHwm.getTime() - 2 * 60 * 1000).toISOString();

    const [outgoing, incoming] = await Promise.all([
      queryInvoiceMetadata(accessToken, "Subject1", from),
      queryInvoiceMetadata(accessToken, "Subject2", from),
    ]);
    const rows = [
      ...outgoing.invoices.map((item) => invoiceRow(item, userId, "sale")),
      ...incoming.invoices.map((item) => invoiceRow(item, userId, "cost")),
    ];
    const deduplicatedRows = Array.from(new Map(rows.map((row) => [row.ksef_number, row])).values());

    if (deduplicatedRows.length) {
      const { error: upsertError } = await admin.from("invoices").upsert(deduplicatedRows, {
        onConflict: "user_id,ksef_number",
      });
      if (upsertError) throw supabaseError(upsertError, "zapis faktur KSeF");
    }

    const hwmCandidates = [outgoing.hwmDate, incoming.hwmDate].filter(Boolean) as string[];
    const lastHwmDate = hwmCandidates.length
      ? new Date(Math.max(...hwmCandidates.map((value) => Date.parse(value)))).toISOString()
      : new Date().toISOString();
    const completedAt = new Date().toISOString();

    const { error: connectionUpdateError } = await admin.from("ksef_connections").update({
      status: "connected",
      last_sync_at: completedAt,
      last_hwm_date: lastHwmDate,
      last_error: null,
      updated_at: completedAt,
    }).eq("user_id", userId);
    if (connectionUpdateError) throw supabaseError(connectionUpdateError, "aktualizacja stanu połączenia KSeF");
    const { error: runUpdateError } = await admin.from("ksef_sync_runs").update({
      status: "success",
      completed_at: completedAt,
      incoming_count: incoming.invoices.length,
      outgoing_count: outgoing.invoices.length,
    }).eq("id", runId);
    if (runUpdateError) throw supabaseError(runUpdateError, "zakończenie historii synchronizacji");

    return json({
      connected: true,
      environment: "test",
      nip: configuredNip,
      imported: deduplicatedRows.length,
      incoming: incoming.invoices.length,
      outgoing: outgoing.invoices.length,
      lastSyncAt: completedAt,
    });
  } catch (error) {
    const message = errorMessage(error);
    if (admin && userId) {
      const nip = (Deno.env.get("KSEF_NIP") || "").replace(/\D/g, "");
      if (/^\d{10}$/.test(nip)) {
        await admin.from("ksef_connections").upsert({
          user_id: userId,
          environment: "test",
          nip,
          status: "error",
          last_error: message,
          updated_at: new Date().toISOString(),
        });
      }
    }
    if (admin && runId) {
      await admin.from("ksef_sync_runs").update({
        status: "error",
        completed_at: new Date().toISOString(),
        error_message: message,
      }).eq("id", runId);
    }
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: message }, status);
  }
});
