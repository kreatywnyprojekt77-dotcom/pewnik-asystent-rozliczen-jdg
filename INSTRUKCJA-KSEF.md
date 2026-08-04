# Integracja z testowym KSeF API 2.0

> **WIP:** poprawka diagnostyki jest gotowa, ale wymaga ponownego testu z aktywnym tokenem KSeF 2.0. Aktualny stan opisuje `KSEF-WIP.md`.

Pierwszy etap integracji uwierzytelnia się tokenem KSeF i pobiera metadane faktur:

- `Subject1` — faktury sprzedażowe;
- `Subject2` — faktury kosztowe;
- pierwszy import obejmuje ostatnie 30 dni;
- kolejne importy używają daty trwałego zapisu jako kursora synchronizacji.

Funkcja korzysta wyłącznie ze środowiska testowego:

`https://api-test.ksef.mf.gov.pl/v2`

Nie używaj prawdziwych faktur ani danych osobowych. Dane środowiska TEST mogą być współdzielone z innymi integratorami używającymi tego samego fikcyjnego NIP-u.

## 1. Zaktualizuj bazę Supabase

1. Otwórz **Supabase Dashboard → SQL Editor**.
2. Wklej i uruchom cały plik `supabase-schema.sql`.
3. Sprawdź, czy powstały tabele `ksef_connections` i `ksef_sync_runs`, a tabela `invoices` zawiera kolumnę `ksef_number`.

Plik jest idempotentny i można uruchomić go ponownie na istniejącym projekcie.

## 2. Przygotuj testowy NIP i token KSeF

1. Wejdź do testowej Aplikacji Podatnika: <https://ap-test.ksef.mf.gov.pl>.
2. Skonfiguruj fikcyjny podmiot/JDG i użyj wyłącznie syntetycznych danych.
3. Wygeneruj token z co najmniej uprawnieniem do odczytu faktur (`InvoiceRead`).
4. Skopiuj pełną wartość pola **Token** od razu i przechowuj ją jak hasło — nie wpisuj jej do `app.js`, `.env`, `supabase-config.js` ani do bazy danych.

Pełny token KSeF 2.0 ma trzy części rozdzielone znakiem `|`:

```text
numer-referencyjny|kontekst|64-znakowy-sekret
```

Numer referencyjny widoczny później na liście tokenów nie jest tokenem. Nie zadziała również `accessToken`/JWT ani token wygenerowany dla KSeF 1.0.

NIP zapisany w ustawieniach aplikacji musi być identyczny z kontekstem NIP tokena.

## 3. Wdróż Edge Function

W katalogu projektu wykonaj:

```powershell
Set-Location "C:\Users\eliza\OneDrive - Akademia Leona Kozminskiego\Pulpit\AIDEAS Vibecoding\Prototyp aplikacji księgowej 1"
npx.cmd supabase login
npx.cmd supabase link --project-ref chfnpuyxcqeyovolqlen
npx.cmd supabase secrets set KSEF_NIP=WPISZ_TESTOWY_NIP KSEF_TOKEN="WKLEJ_TOKEN_TESTOWY"
npx.cmd supabase functions deploy ksef-sync
```

Na Windows używamy `npx.cmd`, ponieważ PowerShell może blokować skrypt `npx.ps1` swoją polityką wykonywania skryptów. Nie trzeba w tym celu zmieniać `ExecutionPolicy`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` oraz `SUPABASE_SERVICE_ROLE_KEY` są automatycznie dostępne we wdrożonej funkcji Supabase. Nie należy dodawać service role key do frontendu.

## 4. Sprawdź połączenie w aplikacji

1. Zaloguj się w aplikacji do Supabase.
2. W **Ustawieniach** wpisz ten sam syntetyczny NIP i kliknij **Zapisz ustawienia**.
3. W sekcji **KSeF API · TEST** wybierz **Testuj połączenie**.
4. Po pozytywnym teście wybierz **Pobierz faktury**.

Zaimportowane rekordy mają zielone oznaczenie `KSeF` oraz numer KSeF pod numerem dokumentu. Dokumentu źródłowego KSeF nie można usunąć z listy; ponowna synchronizacja aktualizuje go po `ksef_number` bez tworzenia duplikatu.

## Najczęstsze błędy

- **Brak sekretu KSEF_TOKEN/KSEF_NIP** — ustaw sekrety i ponownie wdróż funkcję.
- **NIP w ustawieniach nie zgadza się** — wpisz w aplikacji NIP użyty przy generowaniu tokena.
- **Brak InvoiceRead** — wygeneruj token z uprawnieniem do odczytu faktur.
- **Tabela lub kolumna nie istnieje** — ponownie uruchom aktualny `supabase-schema.sql`.
- **W KSEF_TOKEN zapisano prawdopodobnie tylko numer referencyjny** — wygeneruj nowy token i skopiuj pełną, jednorazowo wyświetloną wartość pola **Token**.
- **NIP zapisany w aplikacji nie zgadza się z sekretem KSEF_NIP** — popraw jedną z wartości; funkcja celowo zatrzymuje żądanie przed połączeniem z KSeF.
- **401 z KSeF** — token jest nieważny, nieaktywny, unieważniony albo nie ma uprawnień w wybranym kontekście.

## Zakres kolejnego etapu

Kolejny etap obejmuje pobieranie pełnego XML FA(3), prywatny bucket na XML/UPO, pozycje faktur oraz wysyłkę faktur sprzedażowych w sesji interaktywnej.
