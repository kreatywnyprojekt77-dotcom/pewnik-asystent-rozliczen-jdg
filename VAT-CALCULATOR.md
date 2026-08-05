# Kalkulator VAT — specyfikacja iteracji PL-VAT-2026.1

## Cel

Niezależny, czysty i deterministyczny kalkulator miesięcznego VAT dla czynnego podatnika VAT prowadzącego JDG. Kalkulator nie pobiera danych, nie modyfikuje stanu aplikacji, nie ustala prawa do odliczenia i nie generuje JPK. Otrzymuje ujednolicone oraz zatwierdzone dane, wykonuje walidację i arytmetykę, a następnie zwraca wynik ze śladem audytowym.

## Zakres wersji 1

Obsługiwane są:

- rozliczenia miesięczne;
- czynny podatnik VAT;
- faktury krajowe w PLN;
- sprzedaż i zakupy;
- faktury oraz faktury korygujące;
- wiele stawek na dokumencie;
- kody `23`, `8`, `5`, `0`, `ZW`, `NP` oraz techniczny kod `MIXED` dla niepełnych agregatów KSeF;
- jawna kwota VAT podlegająca odliczeniu;
- odliczenie 100%, 50%, 0% albo zatwierdzona kwota;
- nadwyżka z poprzedniego okresu;
- przeniesienie nadwyżki, wniosek o zwrot albo jawny podział;
- kwoty ujemne wyłącznie na korektach;
- statusy `VERIFIED`, `REVIEW_REQUIRED` i `INVALID`.

Nie są obsługiwane automatycznie:

- rozliczenie kwartalne i metoda kasowa;
- WNT, WDT, import usług i towarów, odwrotne obciążenie, OSS i IOSS;
- waluty inne niż PLN;
- proporcja, prewspółczynnik i wieloletnie korekty VAT;
- ulga na złe długi;
- automatyczna kwalifikacja prawa do odliczenia;
- automatyczne ustalenie okresu skomplikowanej korekty;
- wygenerowanie gotowego do wysłania JPK_V7M.

Przypadek spoza zakresu musi dać błąd albo ostrzeżenie. Kalkulator nie może zgadywać reguły podatkowej.

## Granice modułów

1. `vat-adapter.mjs` normalizuje dane ręczne, Supabase i KSeF do kontraktu kalkulatora.
2. `vat-calculator.mjs` waliduje kontrakt i wykonuje wyłącznie obliczenia VAT.
3. `app.js` orkiestruje kalkulatory i przedstawia wynik użytkownikowi.
4. Mapper/generator JPK pozostaje oddzielnym przyszłym modułem.

## Jednostki i źródła kwot

- Wszystkie kwoty kontraktu kalkulatora są bezpiecznymi liczbami całkowitymi groszy.
- Kwota VAT podana na dokumencie jest kwotą źródłową.
- Wyliczenie `podstawa × stawka` jest kontrolą. Różnica większa niż 1 grosz daje `VAT_AMOUNT_MISMATCH` i status co najmniej `REVIEW_REQUIRED`.
- `0`, `ZW` i `NP` nie są synonimami i pozostają oddzielnymi kodami.
- Zagregowany dokument KSeF, dla którego nie można potwierdzić pojedynczej stawki, otrzymuje `MIXED` i wymaga weryfikacji pozycji.

## Przypisanie do okresu

Kolejność źródeł okresu sprzedaży:

1. jawnie zatwierdzony `accountingPeriod`;
2. `taxPointDate`;
3. `supplyDate`;
4. data wystawienia — wyłącznie jako fallback z ostrzeżeniem.

Kolejność źródeł okresu zakupu:

1. jawnie zatwierdzony `accountingPeriod`;
2. `receivedDate`;
3. data otrzymania KSeF;
4. data wystawienia — wyłącznie jako fallback z ostrzeżeniem.

## Kontrakt wejściowy

```js
{
  settlementPeriod: "2026-06",
  settlementMode: "monthly",
  taxpayerVatStatus: "active",
  ruleVersion: "PL-VAT-2026.1",
  openingCarryForwardGrosz: 0,
  excessDecision: { mode: "CARRY_FORWARD" },
  entries: [{
    id: "invoice-1",
    documentNumber: "FV/1/2026",
    direction: "output",
    documentType: "invoice",
    accountingPeriod: "2026-06",
    accountingPeriodSource: "TAX_POINT_DATE",
    currency: "PLN",
    amounts: [{
      vatCode: "23",
      taxableBaseGrosz: 100000,
      vatAmountGrosz: 23000
    }]
  }]
}
```

Dla zakupu każdy wiersz dodatkowo zawiera `deductibleVatGrosz` oraz `deductionDecision`.

## Algorytm

1. Zweryfikuj kontrakt, typ podatnika, okres, wersję reguł, walutę i gęstość tablic.
2. Zweryfikuj dokumenty, unikalność identyfikatorów, typy, okres i wiersze VAT.
3. Zweryfikuj znak korekt i kontrolną zgodność kwot ze stawką.
4. Zsumuj VAT należny według kodów VAT.
5. Zsumuj VAT naliczony oraz odrębnie VAT podlegający odliczeniu.
6. Oblicz saldo: `należny − odliczalny naliczony − nadwyżka początkowa`.
7. Dodatnie saldo jest VAT do zapłaty.
8. Ujemne saldo jest nadwyżką. Nie wolno jej zerować.
9. Zastosuj decyzję `CARRY_FORWARD`, `REFUND` lub `MIXED`.
10. Zwróć wiersze stawek, ustalenia i identyfikatory wykorzystanych dokumentów.

## Statusy

- `VERIFIED`: kompletne, obsługiwane dane bez ostrzeżeń.
- `REVIEW_REQUIRED`: wynik policzony, lecz wymaga decyzji lub kontroli człowieka.
- `INVALID`: wynik podatkowy nie może zostać użyty; pola zależne od błędu pozostają `null`.

Zwrot VAT zawsze powoduje co najmniej `REVIEW_REQUIRED`, ponieważ kalkulator nie bada warunków i terminu zwrotu.

## Kryteria ukończenia

- testy normalne i red-team przechodzą;
- kolejność dokumentów nie wpływa na wynik;
- wejście nie jest mutowane;
- ujemna nadwyżka nie jest zerowana;
- aplikacja korzysta z nowego kalkulatora, a nie z równoległego wzoru w `app.js`;
- adapter nie uznaje automatycznie niepotwierdzonego VAT zakupowego za zweryfikowany;
- build zawiera kalkulator i adapter;
- baza przechowuje daty, kod VAT, typ dokumentu oraz decyzję o odliczeniu.
- nadwyżka początkowa i sposób rozliczenia nadwyżki są przechowywane oddzielnie dla każdego okresu.

## Źródła

- [Obowiązek podatkowy VAT](https://www.podatki.gov.pl/podatki-firmowe/vat/poradniki-i-informatory/kiedy-powstaje-obowiazek-podatkowy)
- [Odliczenie i zwrot VAT](https://www.podatki.gov.pl/podatki-firmowe/vat/poradniki-i-informatory/odliczenie-i-zwrot-podatku-vat)
- [Wystawianie i otrzymywanie faktur w KSeF](https://ksef.podatki.gov.pl/ksef-news/wystawianie-i-otrzymywanie-faktur/)
- [Struktury JPK_V7M](https://www.podatki.gov.pl/podatki-firmowe/jednolity-plik-kontrolny/jpk_vat-z-deklaracja/pliki-do-pobrania)
