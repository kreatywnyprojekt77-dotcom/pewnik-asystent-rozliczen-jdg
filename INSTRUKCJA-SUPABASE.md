# Połączenie aplikacji Pewnik z Supabase

Kod integracji jest już dodany. Nie trzeba instalować Node.js ani uruchamiać `npm install` — biblioteka Supabase jest pobierana przez CDN po otwarciu aplikacji.

## 1. Utwórz projekt

1. Wejdź na https://supabase.com/dashboard i utwórz projekt.
2. Zachowaj hasło bazy w bezpiecznym miejscu.
3. Poczekaj, aż projekt zostanie uruchomiony.

## 2. Utwórz tabelę i zabezpieczenia

1. W panelu projektu otwórz **SQL Editor**.
2. Kliknij **New query**.
3. Skopiuj całą zawartość pliku `supabase-schema.sql`.
4. Kliknij **Run**.

Skrypt tworzy tabelę `app_states` oraz polityki Row Level Security. Użytkownik ma dostęp wyłącznie do rekordu, którego `user_id` jest zgodny z jego zalogowanym kontem.

## 3. Wklej dane połączenia

1. W Supabase otwórz okno **Connect** albo **Project Settings -> API**.
2. Skopiuj **Project URL**.
3. Skopiuj **Publishable key**. Jeśli projekt pokazuje starsze klucze, możesz użyć publicznego klucza `anon`.
4. Otwórz `supabase-config.js` i zastąp wartości:

```js
window.PEWNIK_SUPABASE_CONFIG = {
  url: 'https://TWOJ-PROJEKT.supabase.co',
  publishableKey: 'sb_publishable_...'
};
```

Nigdy nie wklejaj do tego pliku klucza `service_role`, `secret` ani hasła bazy. Plik jest wykonywany w przeglądarce, więc jego zawartość jest publiczna.

## 4. Uruchom i zaloguj się

1. Uruchom aplikację przez `URUCHOM-APLIKACJE.cmd`.
2. Kliknij profil w lewym dolnym rogu — powinien pokazywać „Połącz z Supabase”.
3. Wprowadź e-mail i hasło.
4. Kliknij **Utwórz konto** lub **Zaloguj się**.

Jeżeli w Supabase jest włączone potwierdzanie adresu, po rejestracji otwórz wiadomość e-mail i potwierdź konto. Następnie ponownie uruchom aplikację i się zaloguj.

Po pierwszym zalogowaniu aktualne dane z przeglądarki są przenoszone do Supabase. Kolejne zmiany są zapisywane lokalnie i synchronizowane automatycznie.

## Kontrola działania

W Supabase otwórz **Table Editor -> app_states**. Po zalogowaniu i zmianie danych powinien pojawić się jeden rekord. Pole `state` zawiera dane prototypu, a `updated_at` czas ostatniej synchronizacji.

To rozwiązanie przechowuje stan prototypu jako JSON. Jest odpowiednie do testów i demonstracji. Przed wdrożeniem prawdziwego systemu księgowego dane faktur, firm, członkostw i historii zmian należy rozdzielić na osobne tabele oraz zaprojektować audyt i kopie dokumentów.
