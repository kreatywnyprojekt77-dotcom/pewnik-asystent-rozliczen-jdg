# KSeF TEST — stan prac WIP

Data aktualizacji: 4 sierpnia 2026 r.

Branch: `feature/ksef-integration`

Status: **poprawka przygotowana, test live nadal wymagany**. Nie traktować funkcji jako zaakceptowanej do czasu testu z aktywnym tokenem KSeF 2.0.

## Kryterium akceptacji

Integracja może zostać uznana za działającą dopiero wtedy, gdy:

1. test uwierzytelnienia tokenem zakończy się powodzeniem;
2. synchronizacja pobierze co najmniej jedną testową fakturę dla skonfigurowanego kontekstu NIP;
3. rekord zostanie zapisany w `public.invoices` z `source = 'ksef'` oraz uzupełnionymi polami KSeF;
4. ponowna synchronizacja nie utworzy duplikatu;
5. błąd i wynik synchronizacji zostaną poprawnie zapisane w tabelach stanu.

Żaden z powyższych punktów nie powinien być pomijany przy akceptacji lub przed merge’em.

## Co zostało przygotowane

- panel KSeF TEST w ustawieniach prototypu;
- wywołania Edge Function z aktywną sesją użytkownika Supabase;
- Edge Function `ksef-sync` dla API `https://api-test.ksef.mf.gov.pl/v2`;
- pobranie challenge, szyfrowanie `token|timestamp` przez RSA-OAEP SHA-256, sprawdzanie statusu uwierzytelnienia i wymiana tokenu operacyjnego na token dostępowy;
- zapytania o metadane faktur `Subject1` i `Subject2` z ostatnich 30 dni, a następnie synchronizacja przyrostowa;
- rozszerzenia tabeli `public.invoices` o metadane KSeF;
- tabele `public.ksef_connections` i `public.ksef_sync_runs`, indeksy oraz zasady RLS;
- sekrety KSeF są przechowywane w Supabase Edge Function, a nie w kodzie, przeglądarce ani bazie aplikacji;
- schemat SQL został zastosowany w testowym projekcie Supabase;
- robocza Edge Function została wysłana do testowego projektu Supabase podczas prac diagnostycznych.

## Przyczyna i wprowadzona poprawka

Wywołanie **Testuj połączenie** dociera do API KSeF TEST, ale proces uwierzytelniania kończy się odpowiedzią:

```text
Uwierzytelnianie zakończone niepowodzeniem z powodu błędnego tokenu.
Nieprawidłowe kodowanie tokenu.
```

Aktualny kontrakt API pokazuje, że pełny token KSeF 2.0 składa się z trzech części rozdzielonych znakiem `|`: numeru referencyjnego, kontekstu oraz sekretu. Sam numer referencyjny z listy tokenów, accessToken/JWT i token KSeF 1.0 nie są poprawną wartością `KSEF_TOKEN`.

Funkcja teraz, przed połączeniem z KSeF:

- waliduje strukturę pełnego tokena bez logowania jego wartości;
- rozpoznaje prawdopodobne wklejenie samego numeru referencyjnego;
- odrzuca białe znaki, cudzysłowy, uszkodzony sekret i token w kontekście `InternalId`;
- porównuje NIP zapisany w aplikacji z sekretem `KSEF_NIP`;
- porównuje NIP zawarty w kontekście tokena, jeżeli token go ujawnia;
- wymaga całkowitego `timestampMs` z bieżącego challenge;
- tłumaczy odpowiedź KSeF o nieprawidłowym kodowaniu na instrukcję możliwą do wykonania przez użytkownika.

## Najbardziej prawdopodobne obszary do sprawdzenia

1. Czy w `KSEF_TOKEN` zapisano pełną, jednorazowo wyświetlaną wartość pola **Token**, a nie numer referencyjny, opis lub identyfikator z listy tokenów.
2. Czy token został wygenerowany w środowisku TEST, ma status `Active` i uprawnienie `InvoiceRead`.
3. Czy `KSEF_NIP` jest identyczny z kontekstem NIP, dla którego wygenerowano token.
4. Czy sekret nie zawiera cudzysłowów, etykiety `Token:`, spacji lub znaku nowej linii skopiowanego razem z wartością.
5. Czy szyfrogram przygotowany przez implementację TypeScript jest zgodny bajt w bajt z aktualnym przykładem oficjalnego klienta KSeF 2.0.

## Następne kroki

1. Wygenerować nowy token w Aplikacji Podatnika KSeF 2.0 TEST i skopiować pełne pole **Token** natychmiast po utworzeniu.
2. Zaktualizować wyłącznie sekret `KSEF_TOKEN` w testowym projekcie Supabase.
3. Ponownie wdrożyć Edge Function `ksef-sync`.
4. Ponowić test połączenia, a następnie import kontrolnej faktury z ostatnich 30 dni.
5. Udokumentować wynik testu i dopiero po spełnieniu kryteriów usunąć oznaczenie WIP.

## Bezpieczeństwo

- Nie zapisywać tokenów, haseł ani klucza `service_role` w repozytorium.
- Nie wklejać wartości sekretów do zgłoszeń, commitów ani logów.
- Lokalny `.env` pozostaje ignorowany przez Git.
- `supabase-config.js` zawiera wyłącznie publiczny klucz klienta Supabase.
