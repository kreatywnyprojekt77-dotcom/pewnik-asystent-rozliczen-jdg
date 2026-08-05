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

Każda wartość w `yearToDateRevenueByCategory` musi być nieujemną liczbą całkowitą wyrażoną w groszach. Kluczem jest `categoryId` istniejącej kategorii.

Suma przychodów narastających nie może być mniejsza od przychodów przekazanych dla bieżącego miesiąca. Brak spójności powoduje `INVALID`.

Jeżeli suma przychodów narastających oraz `deductionGrosz` wynoszą zero, proporcja i przydzielone odliczenie każdej kategorii wynoszą zero. Sam ten przypadek nie powoduje błędu ani ostrzeżenia.

Jeżeli suma przychodów narastających wynosi zero, a `deductionGrosz` jest większe od zera, wynik otrzymuje status `INVALID`, `taxDuePln` ma wartość `null`, a lista ustaleń zawiera kod `DEDUCTION_WITHOUT_REVENUE`. Podział przez zero nie jest wykonywany.

Jeżeli część odliczenia przydzielona zgodnie z proporcją przekracza bieżący miesięczny przychód danej kategorii, nadwyżka nie jest redystrybuowana. Wynik otrzymuje status `REVIEW_REQUIRED`, `taxDuePln` ma wartość `null`, a lista ustaleń zawiera kod `DEDUCTION_EXCEEDS_CATEGORY_REVENUE`, proponowany podział i kwotę nadwyżki. Podstawa kategorii nie może stać się ujemna, a kalkulator nie zgaduje zasad przeniesienia niewykorzystanej kwoty.

## Algorytm

1. Zweryfikuj kompletność i typy wszystkich danych.
2. Odrzuć przypadki spoza zakresu wersji 1.
3. Zgrupuj miesięczne przychody według kategorii.
4. Zweryfikuj kategorię, PKWiU, stawkę i okres obowiązywania.
5. Oblicz udział każdej kategorii w przychodzie narastającym roku.
6. Oblicz dokładny udział każdej kategorii w `deductionGrosz` bez używania arytmetyki zmiennoprzecinkowej.
7. Obetnij każdy udział w dół do pełnego grosza.
8. Pozostałe grosze rozdziel metodą największych reszt: po jednym groszu według malejącej części ułamkowej. Remis rozstrzyga `categoryId` sortowane rosnąco leksykograficznie. Suma przydzielonych części musi dokładnie odpowiadać `deductionGrosz`.
9. Sprawdź, czy przydzielona część odliczenia nie przekracza bieżącego przychodu kategorii.
10. Odejmij przypisane odliczenie od przychodu właściwej kategorii.
11. Połącz kategorie opodatkowane tą samą stawką.
12. Zaokrąglij połączoną podstawę każdej stawki do pełnych złotych zgodnie z regułą opisaną poniżej.
13. Dla każdej stawki oblicz dokładny podatek od jej zaokrąglonej podstawy, nie zaokrąglając podatku osobno dla danej stawki.
14. Zsumuj dokładne kwoty podatku ze wszystkich stawek.
15. Zaokrąglij do pełnych złotych dopiero łączny ryczałt.
16. Zwróć pełny ślad obliczenia oraz status wyniku.

Kolejność elementów wejściowych nie może wpływać na wynik. `categoryId` rozstrzyga wyłącznie remis równych części ułamkowych, a nie zastępuje metody największych reszt.

## Zaokrąglenia

Kwoty źródłowe i odliczenia są przechowywane jako całkowite liczby groszy. Podstawy po odliczeniach są najpierw agregowane według stawki, a następnie każda podstawa stawki jest osobno zaokrąglana do pełnych złotych.

Nie wolno używać binarnej arytmetyki zmiennoprzecinkowej do podejmowania decyzji o zaokrągleniu.

Zaokrąglenie do pełnych złotych:

- końcówkę poniżej 50 groszy pomija;
- końcówkę 50 groszy lub większą podwyższa do pełnego złotego;
- nie korzysta z domyślnego `Math.round()` bez jawnego uzasadnienia operacji.

Podatek dla stawki jest obliczany dokładnie według wzoru:

```text
taxExactUnits = roundedBasePln × rateBasisPoints
```

`taxExactUnits` jest całkowitą liczbą jednostek równych `0,0001 PLN`, czyli jednej setnej grosza. Dzięki temu stawka taka jak 8,5% nie wymaga przedwczesnego zaokrąglenia ani użycia liczby zmiennoprzecinkowej.

Podatku nie zaokrągla się osobno dla każdej stawki. `taxExactUnits` wszystkich stawek są sumowane, a dopiero suma jest zaokrąglana do pełnego PLN według reguły 50 groszy. Wynik musi pokazywać podstawy przed i po zaokrągleniu, dokładny podatek każdej stawki oraz łączny podatek przed i po końcowym zaokrągleniu.

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
  taxBeforeFinalRounding: {
    units: 0,
    unitScale: 10000,
    currency: "PLN"
  },
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

`rateRows` pokazuje połączoną podstawę przed zaokrągleniem, podstawę po zaokrągleniu do pełnych złotych, stawkę oraz dokładny podatek w jednostkach `0,0001 PLN`. Nie zawiera osobno zaokrąglonego podatku dla stawki.

## Minimalne testy akceptacyjne

Testy muszą obejmować:

- jedną kategorię ze stawką 12%;
- co najmniej dwie kategorie z różnymi stawkami;
- stawkę zawierającą część dziesiętną, np. 8,5%;
- proporcjonalne rozdzielenie odliczenia;
- metodę największych reszt, rozdzielenie wielu pozostałych groszy i leksykograficzne rozstrzygnięcie remisu przez `categoryId`;
- granice zaokrąglenia podstawy oraz końcowego podatku: 49 i 50 groszy;
- sumowanie dokładnych podatków wielu stawek przed końcowym zaokrągleniem;
- dokładny wynik zawierający ułamkowy grosz dla stawki 8,5%;
- zerowy przychód i zerowe odliczenie;
- zerowy przychód narastający przy dodatnim odliczeniu;
- zduplikowany identyfikator;
- brak kategorii;
- brak stawki;
- brak PKWiU lub decyzji;
- stawkę nieobowiązującą w wybranym okresie;
- niezgodność danych miesięcznych i narastających;
- ujemną kwotę i liczbę zmiennoprzecinkową;
- odliczenie przekraczające możliwą podstawę;
- przydzielone odliczenie przekraczające przychód pojedynczej kategorii bez redystrybucji;
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

## Integracja KSeF TEST

Na osobne zlecenie użytkownika projekt zawiera roboczą integrację z KSeF API 2.0 TEST przez Supabase Edge Function. Funkcja waliduje pełny format tokena KSeF 2.0, zgodność NIP-u aplikacji, sekretu i kontekstu tokena, a następnie uwierzytelnia się oraz importuje metadane faktur. Szczegóły uruchomienia i aktualny stan testów live opisują `INSTRUKCJA-KSEF.md` i `KSEF-WIP.md`.
## Iteracja kalkulatora VAT

Ograniczenia plików opisane wcześniej dotyczą zakończonej, izolowanej iteracji kalkulatora ryczałtu. Bieżąca iteracja rozszerza aplikację o niezależny kalkulator VAT oraz zezwala na zmianę integracji, UI, testów, schematu Supabase i procesu budowania w zakresie niezbędnym do jego uruchomienia.

Normatywna specyfikacja zakresu, kontraktu, algorytmu, statusów i kryteriów ukończenia tej iteracji znajduje się w `VAT-CALCULATOR.md`. Implementację stanowią `vat-calculator.mjs` i `vat-adapter.mjs`; aplikacja musi korzystać z tych modułów zamiast utrzymywać drugi wzór VAT w `app.js`.

## Integracja kalkulatorów z aplikacją

`app.js` orkiestruje oba niezależne kalkulatory i nie może utrzymywać równoległego wzoru ryczałtu ani VAT. Dane faktur są mapowane przez:

- `ryczalt-adapter.mjs` do kontraktu `calculateRyczalt()`;
- `vat-adapter.mjs` do kontraktu `calculateVat()`.

Adapter ryczałtu uwzględnia wyłącznie sprzedaż z wybranego miesiąca, a przychód narastający buduje ze sprzedaży od początku tego samego roku do końca wybranego miesiąca. Jawne `revenuePeriod` ma pierwszeństwo; w obecnym prototypie jego braku używana jest data dokumentu. Koszty nie wchodzą do przychodu ryczałtowego. Stawki z UI są przeliczane na całkowite punkty bazowe, a odliczenie na całkowite grosze przed przekazaniem do kalkulatora.

Obecny interfejs nie zapisuje kompletnej klasyfikacji PKWiU, podstawy prawnej ani decyzji podatkowej. Adapter nie uzupełnia ich fikcyjnymi danymi, dlatego wynik ryczałtu pozostaje `REVIEW_REQUIRED`, dopóki te informacje nie zostaną jawnie dostarczone. Status całego rozliczenia uwzględnia niezależnie status ryczałtu i VAT; błąd któregokolwiek kalkulatora blokuje łączną kwotę przelewów.
