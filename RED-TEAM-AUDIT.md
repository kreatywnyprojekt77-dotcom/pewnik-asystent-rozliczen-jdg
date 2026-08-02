# Red Team AI — kalkulator ryczałtu

Data audytu: 2026-08-02

Branch: `test/red-team-ryczalt-calculator`

Źródło prawdy: `README.md`

## Zakres i ograniczenia

Audyt objął wyłącznie `README.md`, `ryczalt-calculator.mjs` oraz `tests/ryczalt-calculator.test.mjs`. Sprawdzono przypadki brzegowe, walidację, bezpieczeństwo arytmetyki całkowitoliczbowej, zaokrąglenia, metodę największych reszt, bardzo duże liczby, błędne typy, duplikaty, mutowanie wejścia i zależność wyniku od kolejności danych.

Nie czytano ani nie zmieniano `app.js`, UI, VAT, ZUS, Supabase ani KSeF. Nie zmieniono kodu produkcyjnego, README ani istniejących testów.

## Podsumowanie wykonania

- Początkowy branch był zgodny, a working tree był czysty.
- Dodano 10 testów Red Team: 5 ujawnia defekty i celowo pozostaje czerwonych, 5 potwierdza istniejące zabezpieczenia.
- `node --test` uruchomiono zgodnie z poleceniem, lecz runner nie rozpoczął testów z powodu ograniczenia środowiska: `spawn EPERM`.
- Dodatkowe uruchomienie `node --test --test-isolation=none` wykonało 31 testów: 26 przeszło, 5 nie przeszło.

## Ustalenia

### RT-01 — P1: rzadka tablica przychodów omija walidację

**Dane wejściowe:** poprawny obiekt rozliczenia, ale `revenues = new Array(1)` (tablica długości 1 z nieistniejącym elementem), przychód narastający kategorii równy 0 i odliczenie 0.

**Oczekiwane zachowanie:** `INVALID`, `taxDuePln = null` i jawne ustalenie o nieprawidłowej pozycji przychodu. Wymóg README nakazuje walidację kompletności i typów wszystkich danych oraz zabrania cichego poprawiania danych.

**Rzeczywiste zachowanie:** `VERIFIED`, `taxDuePln = 0`, brak ustalenia. `Array.prototype.forEach()` i `filter()` pomijają dziury w tablicy, więc element nie trafia do walidacji ani sumy.

**Możliwy skutek podatkowy:** pominięty przychód może zaniżyć podstawę i ryczałt, a wynik jest błędnie oznaczony jako zweryfikowany. Jest to szczególnie groźne po transformacji danych, która pozostawia dziurę zamiast jawnej wartości `null`.

**Dowód:** test `RED TEAM: dziura w tablicy przychodów nie może zostać cicho pominięta` — oczekiwano `INVALID`, otrzymano `VERIFIED`.

### RT-02 — P1: rzadka tablica kategorii omija walidację

**Dane wejściowe:** `categories = new Array(1)`, `revenues = []`, pusty obiekt przychodów narastających i odliczenie 0.

**Oczekiwane zachowanie:** `INVALID`, `taxDuePln = null` i jawne ustalenie o nieprawidłowej kategorii.

**Rzeczywiste zachowanie:** `VERIFIED`, `taxDuePln = 0`, brak ustalenia. Walidacja kategorii oparta na `forEach()` nie odwiedza brakującego elementu.

**Możliwy skutek podatkowy:** skojarzona utrata kategorii i pozycji przychodowych podczas transformacji może doprowadzić do cichego pominięcia opodatkowanego przychodu. Status `VERIFIED` tworzy fałszywe poczucie bezpieczeństwa.

**Dowód:** test `RED TEAM: dziura w tablicy kategorii nie może zostać cicho pominięta` — oczekiwano `INVALID`, otrzymano `VERIFIED`.

### RT-03 — P2: nieistniejąca data decyzji jest uznawana za poprawną

**Dane wejściowe:** kompletna kategoria ze stawką 12%, ale `decision.approvedAt = "2026-02-31"`; przychód 100000 gr.

**Oczekiwane zachowanie:** błąd techniczny, `INVALID` i `taxDuePln = null`. Nieistniejąca data nie dokumentuje rzeczywistego zatwierdzenia decyzji podatkowej.

**Rzeczywiste zachowanie:** `VERIFIED`, `taxDuePln = 120`. Walidacja sprawdza wyłącznie kształt tekstu wyrażeniem regularnym, nie poprawność kalendarzową.

**Możliwy skutek podatkowy:** niezatwierdzona albo błędnie udokumentowana klasyfikacja może zostać użyta jako podstawa stawki i wygenerować kwotę przedstawioną jako zweryfikowana. W przykładzie kwota 120 PLN jest zwracana mimo nieważnego śladu decyzji; rzeczywista różnica zależy od prawidłowej stawki.

**Dowód:** test `RED TEAM: nieistniejąca data zatwierdzenia decyzji jest błędem technicznym` — oczekiwano `INVALID`, otrzymano `VERIFIED`.

### RT-04 — P2: pełny wynik zależy od kolejności przychodów

**Dane wejściowe:** dwie pozycje tej samej kategorii: `zero = 0 gr` i `positive = 100 gr`; następnie ten sam zestaw w odwrotnej kolejności.

**Oczekiwane zachowanie:** identyczny pełny wynik dla obu kolejności, zgodnie z jednoznacznym wymaganiem README.

**Rzeczywiste zachowanie:** wyniki nie są identyczne. Ustalenie `ZERO_REVENUE` ma ścieżkę `revenues[0].amountGrosz` w pierwszym wyniku i `revenues[1].amountGrosz` w drugim.

**Możliwy skutek podatkowy:** w pokazanym przypadku kwota podatku się nie zmienia, ale ślad audytowy nie jest deterministyczny. Może to powodować błędne przypisanie komunikatu w systemie nadrzędnym, rozbieżności porównań i trudność odtworzenia decyzji podatkowej.

**Dowód:** test `RED TEAM: kolejność przychodów nie może zmieniać pełnego wyniku z ustaleniami` — `deepEqual` nie przechodzi.

### RT-05 — P2: pełny wynik zależy od kolejności kategorii

**Dane wejściowe:** kategoria `a` bez PKWiU i kategoria `b` bez podstawy prawnej; następnie ten sam zestaw w odwrotnej kolejności.

**Oczekiwane zachowanie:** identyczny pełny wynik dla obu kolejności.

**Rzeczywiste zachowanie:** kolejność ustaleń i ich ścieżki indeksowe zmieniają się. Raz pierwsze jest `MISSING_PKWIU` dla `categories[0]`, a po zmianie kolejności pierwsze jest `MISSING_LEGAL_BASIS` dla `categories[0]`.

**Możliwy skutek podatkowy:** w pokazanym przypadku kwota podatku się nie zmienia, ale system może przypisać ostrzeżenie do niewłaściwego elementu po ponownym uporządkowaniu danych. Osłabia to identyfikowalność podstawy stawki i odtwarzalność obliczenia.

**Dowód:** test `RED TEAM: kolejność kategorii nie może zmieniać pełnego wyniku z ostrzeżeniami` — `deepEqual` nie przechodzi.

## Kontrole, które przeszły próbę Red Team

- Zduplikowane `categoryId` powoduje `INVALID`, `taxDuePln = null` i kod `DUPLICATE_CATEGORY_ID`.
- `NaN`, `Infinity`, tekst, `null`, `undefined` i `BigInt` jako kwota przychodu są odrzucane kodem `INVALID_REVENUE_AMOUNT`.
- Suma dwóch składników równych `Number.MAX_SAFE_INTEGER` jest bezpiecznie odrzucana kodem `REVENUE_TOTAL_OUT_OF_RANGE`.
- Metoda największych reszt dla siedmiu kategorii rozdziela wiele groszy, zachowuje sumę odliczenia i rozstrzyga remis rosnąco po `categoryId`.
- Głęboko zamrożone wejście nie jest mutowane także na ścieżce `REVIEW_REQUIRED`.
- Istniejące testy potwierdzają granice zaokrąglenia 49/50 gr dla podstawy i podatku, agregację podstaw według stawki, sumowanie dokładnych podatków przed końcowym zaokrągleniem oraz dokładność stawki 8,5%.

## Ocena ryzyka i rekomendowana kolejność napraw

1. Najpierw odrzucać rzadkie tablice albo iterować po wszystkich indeksach i walidować brakujące elementy. Obie luki mają bezpośredni potencjał zaniżenia podatku.
2. Walidować `approvedAt` jako rzeczywistą datę kalendarzową i zwracać stabilny kod błędu technicznego.
3. Kanonizować ustalenia niezależnie od kolejności wejścia. Ścieżki oparte wyłącznie na indeksach są sprzeczne z wymaganiem identycznego wyniku po permutacji; identyfikatory biznesowe powinny zapewnić stabilne powiązanie.

## Potwierdzenie integralności

Kod produkcyjny nie został zmieniony. Nie zmieniono również README ani istniejących testów. Utworzono wyłącznie `tests/ryczalt-calculator.red-team.test.mjs` oraz `RED-TEAM-AUDIT.md`. Nie wykonano commita.
