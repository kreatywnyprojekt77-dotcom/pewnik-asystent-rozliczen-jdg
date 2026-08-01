# Pewnik — prototyp aplikacji księgowej

Prototyp dla właściciela jednoosobowej działalności gospodarczej z branży IT, rozliczającego ryczałt, VAT i standardowy ZUS.

## Uruchomienie

Kliknij dwukrotnie `URUCHOM-APLIKACJE.cmd` albo otwórz plik `index.html` w przeglądarce.

Aplikacja nie wymaga instalacji ani własnego serwera. Bez konfiguracji działa lokalnie. Po opcjonalnym połączeniu z Supabase udostępnia logowanie i synchronizację danych użytkownika.

## Supabase

Pliki integracji są już dodane. Instrukcja utworzenia projektu, tabeli i wklejenia publicznego klucza znajduje się w pliku `INSTRUKCJA-SUPABASE.md`.

## Co działa

- miesięczne podsumowanie ryczałtu, VAT i standardowego ZUS;
- transparentne rozwinięcia „Jak to policzyliśmy?”;
- terminy płatności dla wybranego miesiąca;
- lista faktur sprzedażowych i kosztowych;
- dodawanie, usuwanie, wyszukiwanie i filtrowanie faktur;
- przypisywanie stawki ryczałtu do faktury sprzedażowej;
- edycja demonstracyjnych reguł i automatyczne przeliczanie;
- checklista działań do wykonania;
- podgląd i pobranie roboczego zestawienia JPK_V7M;
- ustawienia działalności i oficjalne linki źródłowe;
- responsywny interfejs na komputer i telefon.

## Ważne ograniczenie

To prototyp edukacyjny. Zawiera ręcznie wprowadzone wartości demonstracyjne oznaczone jako `DEMO 2026.1`. Nie wysyła deklaracji i nie łączy się z KSeF, bankiem, ZUS ani administracją publiczną. Kwoty nie powinny być podstawą rzeczywistej płatności bez weryfikacji aktualnych reguł.
