# Kalkulator ZUS — specyfikacja iteracji PL-ZUS-2026.1

## Cel

Niezależny, czysty i deterministyczny kalkulator miesięcznych składek ZUS należnych za przedsiębiorcę prowadzącego JDG i opodatkowanego ryczałtem. Kalkulator nie odczytuje faktur, nie zapisuje stanu, nie potwierdza zapłaty i nie generuje ZUS DRA ani RCA.

## Zakres wersji 1

Obsługiwane są:

- standardowy ZUS bez ulg, od minimalnej podstawy;
- pełny miesiąc prowadzenia jednej JDG;
- ryczałt od przychodów ewidencjonowanych;
- bieżący przychód narastający jako metoda ustalania zdrowotnej;
- stopa wypadkowa 1,67%;
- FP i FS;
- wariant z dobrowolnym chorobowym albo bez niego;
- statusy `VERIFIED`, `REVIEW_REQUIRED` i `INVALID`.

Nie są obsługiwane:

- ulga na start, składki preferencyjne i Mały ZUS Plus;
- zadeklarowana podstawa wyższa od minimalnej;
- część miesiąca, zawieszenie i wakacje składkowe;
- zbieg tytułów, kilka działalności, pracownicy i osoby współpracujące;
- indywidualna stopa wypadkowa i zwolnienie z FP/FS;
- metoda przychodu z poprzedniego roku;
- roczne rozliczenie zdrowotnej, korekty, zwroty i dopłaty;
- przygotowanie dokumentów do wysłania.

Przypadek spoza zakresu daje `INVALID` albo `REVIEW_REQUIRED`. Kalkulator nie zgaduje reguły.

## Granice modułów

1. `zus-rules.mjs` zawiera wersjonowane parametry urzędowe.
2. `zus-adapter.mjs` agreguje przychód z danych aplikacji i buduje kontrakt.
3. `zus-calculator.mjs` waliduje kontrakt i wykonuje wyłącznie obliczenia.
4. `app.js` orkiestruje kalkulatory i prezentuje wynik.
5. Potwierdzone wpłaty oraz mapper odliczenia PIT pozostają oddzielnym zakresem.

## Reguły 2026

- minimalna podstawa społeczna: 565 200 gr;
- emerytalna: 19,52%;
- rentowa: 8%;
- wypadkowa: 1,67%;
- dobrowolna chorobowa: 2,45%;
- FP i FS: 2,45%;
- zdrowotna do 60 000 zł przychodu: 49 835 gr;
- zdrowotna powyżej 60 000 zł do 300 000 zł: 83 058 gr;
- zdrowotna powyżej 300 000 zł: 149 504 gr.

Kwoty składników społecznych są obliczane osobno i zaokrąglane do pełnego grosza metodą połowa w górę.

## Kontrakt wejściowy

```js
{
  settlementPeriod: "2026-06",
  ruleVersion: "PL-ZUS-2026.1",
  taxationForm: "RYCZALT",
  scheme: "STANDARD",
  activeFullMonth: true,
  socialBaseMode: "MINIMUM",
  sicknessInsurance: true,
  labourFundsApplicable: true,
  accidentRateBasisPoints: 167,
  healthCalculationMethod: "CURRENT_YEAR_YTD",
  healthRevenueYtdGrosz: 2910000
}
```

`healthRevenueYtdGrosz` jest zatwierdzonym przychodem dla zdrowotnej po uwzględnieniu dopuszczalnych pomniejszeń. Adapter może odjąć przekazane `healthRevenueDeductionYtdGrosz`, ale sam nie ustala prawa do pomniejszenia.

## Należność a odliczenie PIT

Wynik kalkulatora jest należnością za wskazany miesiąc. Nie jest dowodem zapłaty. Ryczałt może korzystać tylko z zatwierdzonego odliczenia opartego na faktycznie zapłaconych składkach. FP i FS nie są częścią składek społecznych wskazanych jako potencjalnie odliczalne; dla zdrowotnej wynik podaje udział 50%, który może mieć zastosowanie dopiero po zapłacie.

## Statusy

- `VERIFIED`: przypadek jest w zakresie, a miesięczna należność została policzona;
- `REVIEW_REQUIRED`: wynik może być pokazany, lecz wymaga decyzji człowieka;
- `INVALID`: wynik nie może być użyty, a kwoty zależne pozostają `null`.

Informacja o braku rozliczenia rocznego zdrowotnej ma poziom `info` i sama nie obniża statusu.

## Kryteria ukończenia

- testy normalne i red-team przechodzą;
- wejście nie jest mutowane;
- granice 60 000 zł i 300 000 zł są obsługiwane dokładnie;
- FP/FS jest oddzielone od potencjalnego odliczenia społecznego PIT;
- aplikacja nie utrzymuje równoległego wzoru ZUS ani ręcznych kwot ZUS w `app.js`.

## Źródła

- [ZUS — wysokość składek na ubezpieczenia](https://www.zus.pl/firmy/rozliczenia-z-zus/skladki-na-ubezpieczenia)
- [ZUS — składka zdrowotna w 2026 r.](https://www.zus.pl/-/informacja-w-sprawie-podstawy-wymiaru-sk%C5%82adki-oraz-kwoty-sk%C5%82adki-na-ubezpieczenie-zdrowotne-w-2026-r.)
- [podatki.gov.pl — odliczenie składek społecznych](https://www.podatki.gov.pl/ulgi-i-odliczenia/odliczenie-skladek-na-ubezpieczenie-spoleczne-pit/)
- [podatki.gov.pl — odliczenie składki zdrowotnej](https://www.podatki.gov.pl/ulgi-i-odliczenia/odliczenie-skladek-na-ubezpieczenie-zdrowotne-pit/)
