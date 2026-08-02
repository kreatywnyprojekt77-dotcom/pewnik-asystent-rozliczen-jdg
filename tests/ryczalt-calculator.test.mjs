import test from "node:test";
import assert from "node:assert/strict";

import { calculateRyczalt } from "../ryczalt-calculator.mjs";

function category(id = "software", rateBasisPoints = 1200, overrides = {}) {
  return {
    id,
    name: `Kategoria ${id}`,
    pkwiu: "ex 62.01.1",
    rateBasisPoints,
    validFrom: "2026-01",
    validTo: "2026-12",
    legalBasis: "Zweryfikowana podstawa",
    decision: {
      approvedBy: "użytkownik",
      approvedAt: "2026-01-10",
      reason: "Zweryfikowana klasyfikacja",
      reference: "Dokument źródłowy",
    },
    ...overrides,
  };
}

function revenue(id, amountGrosz, categoryId = "software") {
  return { id, period: "2026-06", amountGrosz, categoryId };
}

function validInput(overrides = {}) {
  return {
    settlementPeriod: "2026-06",
    settlementMode: "monthly",
    revenues: [revenue("r-1", 100000)],
    yearToDateRevenueByCategory: { software: 100000 },
    categories: [category()],
    deductionGrosz: 0,
    ruleVersion: "PL-RYCZALT-2026.1",
    ...overrides,
  };
}

function findingCodes(result) {
  return result.findings.map(({ code }) => code);
}

test("jedna kategoria 12% daje pełny, odtwarzalny wynik", () => {
  const result = calculateRyczalt(validInput());

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.revenueTotalGrosz, 100000);
  assert.equal(result.taxableBaseBeforeRoundingGrosz, 100000);
  assert.deepEqual(result.rateRows, [
    {
      rateBasisPoints: 1200,
      baseBeforeRoundingGrosz: 100000,
      roundedBasePln: 1000,
      taxExact: { units: 1200000, unitScale: 10000, currency: "PLN" },
    },
  ]);
  assert.deepEqual(result.taxBeforeFinalRounding, {
    units: 1200000,
    unitScale: 10000,
    currency: "PLN",
  });
  assert.equal(result.taxDuePln, 120);
});

test("różne stawki są liczone osobno, a dokładne podatki sumowane przed zaokrągleniem", () => {
  const input = validInput({
    revenues: [revenue("a-1", 100, "a"), revenue("b-1", 100, "b")],
    yearToDateRevenueByCategory: { a: 100, b: 100 },
    categories: [category("a", 2500), category("b", 2500)],
  });
  input.categories[1].rateBasisPoints = 2501;

  const result = calculateRyczalt(input);

  assert.equal(result.status, "VERIFIED");
  assert.deepEqual(result.rateRows.map((row) => row.taxExact.units), [2500, 2501]);
  assert.equal(result.taxBeforeFinalRounding.units, 5001);
  assert.equal(result.taxDuePln, 1);
});

test("stawka 8,5% zachowuje dokładny ułamkowy grosz", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("r-1", 100)],
    yearToDateRevenueByCategory: { software: 100 },
    categories: [category("software", 850)],
  }));

  assert.equal(result.rateRows[0].roundedBasePln, 1);
  assert.equal(result.rateRows[0].taxExact.units, 850);
  assert.equal(result.taxBeforeFinalRounding.units, 850);
  assert.equal(result.taxDuePln, 0);
});

test("odliczenie jest dzielone proporcjonalnie metodą największych reszt", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("a-1", 100, "a"), revenue("b-1", 100, "b"), revenue("c-1", 100, "c")],
    yearToDateRevenueByCategory: { a: 100, b: 100, c: 100 },
    categories: [category("c", 1200), category("b", 850), category("a", 1500)],
    deductionGrosz: 5,
  }));

  assert.equal(result.status, "VERIFIED");
  assert.deepEqual(result.categoryRows.map((row) => row.categoryId), ["a", "b", "c"]);
  assert.deepEqual(result.categoryRows.map((row) => row.allocationFloorGrosz), [1, 1, 1]);
  assert.deepEqual(result.categoryRows.map((row) => row.receivedRemainderGrosz), [1, 1, 0]);
  assert.deepEqual(result.categoryRows.map((row) => row.deductionAllocatedGrosz), [2, 2, 1]);
  assert.equal(result.categoryRows.reduce((sum, row) => sum + row.deductionAllocatedGrosz, 0), 5);
});

test("największa część ułamkowa ma pierwszeństwo przed categoryId", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("a-1", 100, "a"), revenue("b-1", 100, "b"), revenue("c-1", 100, "c")],
    yearToDateRevenueByCategory: { a: 100, b: 200, c: 300 },
    categories: [category("a"), category("b"), category("c")],
    deductionGrosz: 2,
  }));

  assert.deepEqual(result.categoryRows.map((row) => row.deductionAllocatedGrosz), [0, 1, 1]);
});

test("podstawa 49 groszy jest pomijana, a 50 groszy podwyższana", () => {
  const below = calculateRyczalt(validInput({
    revenues: [revenue("r-1", 149)],
    yearToDateRevenueByCategory: { software: 149 },
    categories: [category("software", 10000)],
  }));
  const atBoundary = calculateRyczalt(validInput({
    revenues: [revenue("r-1", 150)],
    yearToDateRevenueByCategory: { software: 150 },
    categories: [category("software", 10000)],
  }));

  assert.equal(below.rateRows[0].roundedBasePln, 1);
  assert.equal(atBoundary.rateRows[0].roundedBasePln, 2);
});

test("łączny podatek 49 groszy jest pomijany, a 50 groszy podwyższany", () => {
  const below = calculateRyczalt(validInput({
    revenues: [revenue("r-1", 100)],
    yearToDateRevenueByCategory: { software: 100 },
    categories: [category("software", 4900)],
  }));
  const atBoundary = calculateRyczalt(validInput({
    revenues: [revenue("r-1", 100)],
    yearToDateRevenueByCategory: { software: 100 },
    categories: [category("software", 5000)],
  }));

  assert.equal(below.taxBeforeFinalRounding.units, 4900);
  assert.equal(below.taxDuePln, 0);
  assert.equal(atBoundary.taxBeforeFinalRounding.units, 5000);
  assert.equal(atBoundary.taxDuePln, 1);
});

test("zerowy przychód i odliczenie mają zerowe proporcje bez ostrzeżenia", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("r-0", 0)],
    yearToDateRevenueByCategory: { software: 0 },
  }));

  assert.equal(result.status, "VERIFIED");
  assert.deepEqual(result.categoryRows[0].proportion, { numeratorGrosz: 0, denominatorGrosz: 1 });
  assert.equal(result.categoryRows[0].deductionAllocatedGrosz, 0);
  assert.equal(result.taxDuePln, 0);
  assert.ok(findingCodes(result).includes("ZERO_REVENUE"));
});

test("dodatnie odliczenie przy zerowym przychodzie narastającym jest INVALID", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("r-0", 0)],
    yearToDateRevenueByCategory: { software: 0 },
    deductionGrosz: 1,
  }));

  assert.equal(result.status, "INVALID");
  assert.equal(result.taxDuePln, null);
  assert.ok(findingCodes(result).includes("DEDUCTION_WITHOUT_REVENUE"));
});

test("zduplikowany identyfikator przychodu jest odrzucany", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("dup", 50), revenue("dup", 50)],
  }));

  assert.equal(result.status, "INVALID");
  assert.ok(findingCodes(result).includes("DUPLICATE_REVENUE_ID"));
  assert.equal(result.taxDuePln, null);
});

test("brak istniejącej kategorii jest odrzucany", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("r-1", 100, "unknown")],
  }));

  assert.equal(result.status, "INVALID");
  assert.ok(findingCodes(result).includes("MISSING_CATEGORY"));
});

test("brak stawki jest odrzucany", () => {
  const withoutRate = category();
  delete withoutRate.rateBasisPoints;
  const result = calculateRyczalt(validInput({ categories: [withoutRate] }));

  assert.equal(result.status, "INVALID");
  assert.ok(findingCodes(result).includes("MISSING_RATE"));
});

test("brak PKWiU, podstawy lub pełnej decyzji wymaga przeglądu", () => {
  const incomplete = category("software", 1200, {
    pkwiu: "",
    legalBasis: "",
    decision: { approvedBy: "użytkownik" },
  });
  const result = calculateRyczalt(validInput({ categories: [incomplete] }));

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.taxDuePln, 120);
  assert.ok(findingCodes(result).includes("MISSING_PKWIU"));
  assert.ok(findingCodes(result).includes("MISSING_LEGAL_BASIS"));
  assert.ok(findingCodes(result).includes("MISSING_DECISION"));
});

test("stawka spoza okresu obowiązywania jest odrzucana", () => {
  const result = calculateRyczalt(validInput({
    categories: [category("software", 1200, { validTo: "2026-05" })],
  }));

  assert.equal(result.status, "INVALID");
  assert.ok(findingCodes(result).includes("RATE_NOT_VALID_FOR_PERIOD"));
});

test("suma narastająca mniejsza od miesięcznej jest odrzucana", () => {
  const result = calculateRyczalt(validInput({ yearToDateRevenueByCategory: { software: 99999 } }));

  assert.equal(result.status, "INVALID");
  assert.ok(findingCodes(result).includes("YTD_REVENUE_INCONSISTENT"));
});

test("ujemna i zmiennoprzecinkowa kwota są odrzucane stabilnymi kodami", () => {
  const negative = calculateRyczalt(validInput({ revenues: [revenue("r-neg", -1)] }));
  const fractional = calculateRyczalt(validInput({ revenues: [revenue("r-frac", 1.5)] }));

  assert.equal(negative.status, "INVALID");
  assert.ok(findingCodes(negative).includes("UNSUPPORTED_NEGATIVE_REVENUE"));
  assert.equal(fractional.status, "INVALID");
  assert.ok(findingCodes(fractional).includes("INVALID_REVENUE_AMOUNT"));
});

test("odliczenie przekraczające podstawę daje REVIEW_REQUIRED i brak kwoty do zapłaty", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("r-1", 100)],
    yearToDateRevenueByCategory: { software: 100 },
    deductionGrosz: 101,
  }));

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.taxDuePln, null);
  assert.equal(result.categoryRows[0].taxableBaseBeforeRoundingGrosz, null);
  assert.equal(result.categoryRows[0].deductionExcessGrosz, 1);
  assert.ok(findingCodes(result).includes("DEDUCTION_EXCEEDS_CATEGORY_REVENUE"));
});

test("nadwyżka w jednej kategorii nie jest redystrybuowana", () => {
  const result = calculateRyczalt(validInput({
    revenues: [revenue("a-1", 0, "a"), revenue("b-1", 100, "b")],
    yearToDateRevenueByCategory: { a: 100, b: 0 },
    categories: [category("a"), category("b")],
    deductionGrosz: 50,
  }));

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.taxDuePln, null);
  assert.deepEqual(result.categoryRows.map((row) => row.deductionAllocatedGrosz), [50, 0]);
  assert.equal(result.categoryRows[0].deductionExcessGrosz, 50);
  assert.equal(result.findings.find((item) => item.code === "DEDUCTION_EXCEEDS_CATEGORY_REVENUE").details.excessGrosz, 50);
});

test("funkcja nie mutuje danych wejściowych", () => {
  const input = validInput();
  const snapshot = structuredClone(input);

  calculateRyczalt(input);

  assert.deepEqual(input, snapshot);
});

test("kolejność przychodów nie wpływa na wynik", () => {
  const base = validInput({
    revenues: [revenue("b-1", 300, "b"), revenue("a-1", 200, "a")],
    yearToDateRevenueByCategory: { b: 300, a: 200 },
    categories: [category("b", 850), category("a", 1200)],
  });
  const reordered = structuredClone(base);
  reordered.revenues.reverse();

  assert.deepEqual(calculateRyczalt(base), calculateRyczalt(reordered));
});

test("wynik nie zależy od DOM, globalnego state ani zegara", () => {
  const previousDocument = globalThis.document;
  const previousState = globalThis.state;
  Object.defineProperty(globalThis, "document", { configurable: true, get: () => { throw new Error("DOM read"); } });
  Object.defineProperty(globalThis, "state", { configurable: true, get: () => { throw new Error("state read"); } });
  const originalNow = Date.now;
  Date.now = () => { throw new Error("clock read"); };
  try {
    assert.deepEqual(calculateRyczalt(validInput()), calculateRyczalt(validInput()));
  } finally {
    Date.now = originalNow;
    Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: previousDocument });
    Object.defineProperty(globalThis, "state", { configurable: true, writable: true, value: previousState });
  }
});
