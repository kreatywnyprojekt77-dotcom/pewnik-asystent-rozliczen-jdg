# Pewnik — architektura i wymagania

README jest jedynym źródłem prawdy o architekturze i wymaganiach tej iteracji. Jeżeli wymagania nie ma w tym pliku, implementacja nie może go zgadywać.

## Cel iteracji

Zbudować niezależny, czysty i deterministyczny kalkulator miesięcznego ryczałtu dla jednoosobowej działalności gospodarczej świadczącej usługi IT.

Moduł ma wzbudzać zaufanie poprzez:

- brak cichego poprawiania danych;
- jawne błędy i ostrzeżenia;
- pełne rozbicie wyniku;
- kontrolowane zaokrąglenia;
- identyfikowalną podstawę każdej stawki;
- możliwość odtworzenia obliczenia;
- testy jednostkowe reguł i przypadków błędnych.

Wynik nie może być przedstawiony jako bezpieczna kwota do zapłaty, jeżeli dane są niepełne, sprzeczne albo wymagają decyzji użytkownika.

## Zakres

Wersja 1 obsługuje:

- JDG opodatkowaną ryczałtem od przychodów ewidencjonowanych;
- usługi z branży IT;
- miesięczny okres rozliczeniowy;
- wiele kategorii przychodu i stawek ryczałtu;
- proporcjonalne rozdzielenie zatwierdzonego odliczenia;
- wynik oraz szczegółowy ślad obliczenia;
- błędy, ostrzeżenia i udokumentowane decyzje użytkownika.

Wersja 1 nie obsługuje:

- VAT;
- obliczania składek ZUS;
- podatku liniowego ani skali podatkowej;
- rozliczeń kwartalnych;
- deklaracji rocznej PIT-28;
- korekt i ujemnych przychodów;
- przychodów w walutach innych niż PLN;
- automatycznego rozpoznawania PKWiU lub stawki;
- Supabase, KSeF ani interfejsu użytkownika;
- wysyłania deklaracji lub inicjowania płatności.

Nieobsługiwany przypadek musi zostać odrzucony, a nie przeliczony przy użyciu przybliżenia.

## Granice implementacji

Dozwolone jest utworzenie wyłącznie:

- `ryczalt-calculator.mjs`;
- `tests/ryczalt-calculator.test.mjs`.

Nie wolno modyfikować:

- `app.js`;
- `index.html`;
- `styles.css`;
- modułów VAT i ZUS;
- plików Supabase;
- plików KSeF;
- istniejącego interfejsu.

Testy mają korzystać z wbudowanego modułu `node:test` i być uruchamiane poleceniem:

```powershell
node --test
```

Nie należy dodawać zależności npm ani frameworka testowego.

## Interfejs modułu

Moduł eksportuje jedną główną funkcję:

```js
calculateRyczalt(input)
```

Funkcja:

- nie odczytuje globalnego stanu;
- nie korzysta z DOM, `localStorage`, sieci ani zegara systemowego;
- nie modyfikuje argumentów;
- dla tych samych danych zawsze zwraca ten sam wynik;
- nie zapisuje ani nie wysyła danych;
- zwraca wynik i ustalenia walidacyjne jako dane.

## Dane wejściowe

Wejście zawiera:

```js
{
  settlementPeriod: "YYYY-MM",
  settlementMode: "monthly",
  revenues: [],
  yearToDateRevenueByCategory: {},
  categories: [],
  deductionGrosz: 0,
  ruleVersion: "PL-RYCZALT-2026.1"
}
```

### Przychód

Każda pozycja `revenues` zawiera:

```js
{
  id: "unikalny-identyfikator",
  period: "YYYY-MM",
  amountGrosz: 1200000,
  categoryId: "software"
}
```

Wymagania:

- `id` jest niepusty i unikalny;
- `period` odpowiada `settlementPeriod`;
- `amountGrosz` jest nieujemną liczbą całkowitą;
- kwota jest wyrażona w groszach;
- `categoryId` wskazuje istniejącą kategorię;
- zero jest dozwolone, ale generuje informację;
- wartości ujemne są odrzucane jako nieobsługiwana korekta;
- liczby zmiennoprzecinkowe, `NaN`, `Infinity`, tekst i brak kwoty są odrzucane.

### Kategorie i stawki

Każda kategoria zawiera:

```js
{
  id: "software",
  name: "Usługi związane z oprogramowaniem",
  pkwiu: "ex 62.01.1",
  rateBasisPoints: 1200,
  validFrom: "2026-01",
  validTo: "2026-12",
  legalBasis: "opis podstawy lub odnośnik",
  decision: {
    approvedBy: "użytkownik",
    approvedAt: "2026-01-10",
    reason: "uzasadnienie klasyfikacji",
    reference: "źródło decyzji"
  }
}
```

`rateBasisPoints` przechowuje stawkę bez użycia liczby zmiennoprzecinkowej:

- `1200` oznacza 12%;
- `850` oznacza 8,5%;
- `1500` oznacza 15%.

Kalkulator nie może zakładać, że każda usługa IT ma stawkę 12%. Stawka zależy od faktycznie wykonywanej usługi oraz jej klasyfikacji. Sam opis faktury nie stanowi podstawy automatycznego wyboru stawki.

Brak PKWiU, podstawy, okresu obowiązywania albo decyzji powoduje co najmniej status `REVIEW_REQUIRED`. Brak samej stawki lub niezgodność okresu jej obowiązywania powoduje `INVALID`.

### Odliczenie

`deductionGrosz` jest zatwierdzoną, łączną kwotą możliwą do odliczenia w danym rozliczeniu.

Kalkulator:

- nie ustala samodzielnie prawa do odliczenia;
- nie oblicza składek społecznych ani zdrowotnych;
- nie zgaduje rodzaju odliczenia;
- rozdziela przekazaną kwotę proporcjonalnie między kategorie.

Do ustalenia proporcji służy `yearToDateRevenueByCategory`, zawierające przychody narastająco od początku roku do końca rozliczanego miesiąca.

Suma przychodów narastających nie może być mniejsza od przychodów przekazanych dla bieżącego miesiąca. Brak spójności powoduje `INVALID`.

Jeśli odliczenie przekracza przychód możliwy do pomniejszenia albo wymaga przeniesienia niewykorzystanej części, wersja 1 zwraca `REVIEW_REQUIRED` i nie przedstawia ostatecznej kwoty do zapłaty.

## Algorytm

1. Zweryfikuj kompletność i typy wszystkich danych.
2. Odrzuć przypadki spoza zakresu wersji 1.
3. Zgrupuj miesięczne przychody według kategorii.
4. Zweryfikuj kategorię, PKWiU, stawkę i okres obowiązywania.
5. Oblicz udział każdej kategorii w przychodzie narastającym roku.
6. Rozdziel `deductionGrosz` proporcjonalnie według tych udziałów.
7. Kontrolowanie rozdziel resztę wynikającą z groszy tak, aby suma części dokładnie odpowiadała `deductionGrosz`.
8. Odejmij przypisane odliczenie od przychodu właściwej kategorii.
9. Połącz kategorie opodatkowane tą samą stawką.
10. Zastosuj kontrolowane, ustawowe zaokrąglenia.
11. Oblicz ryczałt osobno dla każdej stawki.
12. Zsumuj części podatku.
13. Zwróć pełny ślad obliczenia oraz status wyniku.

Kolejność elementów wejściowych nie może wpływać na wynik. Przy rozdzielaniu reszty wymagane jest deterministyczne kryterium, np. identyfikator kategorii.

## Zaokrąglenia

Kwoty źródłowe i odliczenia są przechowywane jako całkowite liczby groszy.

Nie wolno używać binarnej arytmetyki zmiennoprzecinkowej do podejmowania decyzji o zaokrągleniu.

Zaokrąglenie do pełnych złotych:

- końcówkę poniżej 50 groszy pomija;
- końcówkę 50 groszy lub większą podwyższa do pełnego złotego;
- nie korzysta z domyślnego `Math.round()` bez jawnego uzasadnienia operacji.

Wynik musi pokazywać wartości przed i po każdym ustawowym zaokrągleniu.

Podstawą reguły jest art. 63 Ordynacji podatkowej. Przed użyciem produkcyjnym kolejność zaokrągleń musi zostać zatwierdzona przez osobę posiadającą kompetencje podatkowe.

## Statusy

Funkcja zwraca jeden z trzech statusów:

- `INVALID` — nie można bezpiecznie obliczyć podatku;
- `REVIEW_REQUIRED` — istnieje wynik roboczy, ale wymaga świadomej analizy;
- `VERIFIED` — dane i reguły przeszły wszystkie kontrole.

Przy `INVALID` pole z ostateczną kwotą do zapłaty musi mieć wartość `null`.

Przy `REVIEW_REQUIRED` wynik może być pokazany wyłącznie jako roboczy.

## Ustalenia walidacyjne

Każde ustalenie zawiera:

```js
{
  code: "MISSING_CATEGORY",
  severity: "error",
  message: "Czytelny opis problemu",
  path: "revenues[2].categoryId",
  relatedIds: ["invoice-123"]
}
```

Komunikat nie może być jedynym identyfikatorem błędu. Testy i interfejs mają opierać się na stabilnym `code`.

Błędu technicznego nie można zatwierdzić ani pominąć.

Decyzja dotycząca kwalifikacji podatkowej może być zaakceptowana tylko po zapisaniu osoby, daty, uzasadnienia i źródła.

## Wynik

Wynik funkcji zawiera co najmniej:

```js
{
  status: "VERIFIED",
  ruleVersion: "PL-RYCZALT-2026.1",
  settlementPeriod: "2026-06",
  revenueTotalGrosz: 0,
  deductionTotalGrosz: 0,
  taxableBaseBeforeRoundingGrosz: 0,
  taxBeforeFinalRoundingGrosz: 0,
  taxDuePln: 0,
  categoryRows: [],
  rateRows: [],
  findings: [],
  audit: {
    inputRevenueIds: [],
    appliedCategoryIds: [],
    appliedRatesBasisPoints: []
  }
}
```

`categoryRows` pokazuje przychód, proporcję, przypisane odliczenie i podstawę dla każdej kategorii.

`rateRows` pokazuje połączoną podstawę, stawkę oraz podatek przed i po zaokrągleniu.

## Minimalne testy akceptacyjne

Testy muszą obejmować:

- jedną kategorię ze stawką 12%;
- co najmniej dwie kategorie z różnymi stawkami;
- stawkę zawierającą część dziesiętną, np. 8,5%;
- proporcjonalne rozdzielenie odliczenia;
- deterministyczne rozdzielenie pozostałego grosza;
- granice zaokrąglenia: 49 i 50 groszy;
- zerowy przychód i zerowe odliczenie;
- zduplikowany identyfikator;
- brak kategorii;
- brak stawki;
- brak PKWiU lub decyzji;
- stawkę nieobowiązującą w wybranym okresie;
- niezgodność danych miesięcznych i narastających;
- ujemną kwotę i liczbę zmiennoprzecinkową;
- odliczenie przekraczające możliwą podstawę;
- brak mutowania danych wejściowych;
- identyczny wynik niezależnie od kolejności przychodów;
- brak zależności od DOM, globalnego `state` i czasu systemowego.

## Kryteria ukończenia

Zadanie jest ukończone tylko wtedy, gdy:

- istnieje niezależny moduł;
- wszystkie wymagane walidacje mają stabilne kody;
- wszystkie testy przechodzą przez `node --test`;
- moduł nie modyfikuje istniejącej aplikacji;
- nie dodano zależności zewnętrznych;
- wynik można odtworzyć na podstawie śladu obliczenia;
- żaden błędny przypadek nie jest po cichu zamieniany na zero;
- agent opisze wszystkie wymagania, których nie dało się zaimplementować bez zgadywania.

## Źródła prawne i informacyjne

- [Opodatkowanie ryczałtem — podatki.gov.pl](https://www.podatki.gov.pl/podatki-firmowe/pit/informacje-podstawowe/co-jest-opodatkowane/opodatkowanie-ryczaltem-od-przychodow-ewidencjonowanych)
- [Stawki i limity — podatki.gov.pl](https://www.podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity)
- [Odliczenie składki zdrowotnej — podatki.gov.pl](https://podatki.gov.pl/ulgi-i-odliczenia/odliczenie-skladek-na-ubezpieczenie-zdrowotne-pit)
- [Ordynacja podatkowa — ISAP](https://isap.sejm.gov.pl/isap.Nsf/download.xsp/WDU19971370926/U/D19970926Lj.pdf)

Źródła pomagają weryfikować reguły, ale nie upoważniają agenta do rozszerzania zakresu poza wymagania README.
