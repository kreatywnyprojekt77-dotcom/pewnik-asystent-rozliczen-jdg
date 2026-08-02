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

test("RED TEAM: dziura w tablicy przychodów nie może zostać cicho pominięta", () => {
  const sparseRevenues = new Array(1);
  const result = calculateRyczalt(validInput({
    revenues: sparseRevenues,
    yearToDateRevenueByCategory: { software: 0 },
  }));

  assert.equal(result.status, "INVALID");
  assert.equal(result.taxDuePln, null);
});

test("RED TEAM: dziura w tablicy kategorii nie może zostać cicho pominięta", () => {
  const sparseCategories = new Array(1);
  const result = calculateRyczalt(validInput({
    revenues: [],
    yearToDateRevenueByCategory: {},
    categories: sparseCategories,
  }));

  assert.equal(result.status, "INVALID");
  assert.equal(result.taxDuePln, null);
});

test("RED TEAM: nieistniejąca data zatwierdzenia decyzji jest błędem technicznym", () => {
  const result = calculateRyczalt(validInput({
    categories: [category("software", 1200, {
      decision: {
        approvedBy: "użytkownik",
        approvedAt: "2026-02-31",
        reason: "Zweryfikowana klasyfikacja",
        reference: "Dokument źródłowy",
      },
    })],
  }));

  assert.equal(result.status, "INVALID");
  assert.equal(result.taxDuePln, null);
});

test("RED TEAM: kolejność przychodów nie może zmieniać pełnego wyniku z ustaleniami", () => {
  const input = validInput({
    revenues: [revenue("zero", 0), revenue("positive", 100)],
    yearToDateRevenueByCategory: { software: 100 },
  });
  const reordered = structuredClone(input);
  reordered.revenues.reverse();

  assert.deepEqual(calculateRyczalt(input), calculateRyczalt(reordered));
});

test("RED TEAM: kolejność kategorii nie może zmieniać pełnego wyniku z ostrzeżeniami", () => {
  const input = validInput({
    revenues: [revenue("a-1", 100, "a"), revenue("b-1", 100, "b")],
    yearToDateRevenueByCategory: { a: 100, b: 100 },
    categories: [
      category("a", 1200, { pkwiu: "" }),
      category("b", 850, { legalBasis: "" }),
    ],
  });
  const reordered = structuredClone(input);
  reordered.categories.reverse();

  assert.deepEqual(calculateRyczalt(input), calculateRyczalt(reordered));
});

test("RED TEAM: zduplikowane identyfikatory kategorii są odrzucane", () => {
  const result = calculateRyczalt(validInput({
    categories: [category("software", 1200), category("software", 850)],
  }));

  assert.equal(result.status, "INVALID");
  assert.equal(result.taxDuePln, null);
  assert.ok(findingCodes(result).includes("DUPLICATE_CATEGORY_ID"));
});

test("RED TEAM: wszystkie niedozwolone typy kwoty przychodu są odrzucane", () => {
  for (const amountGrosz of [NaN, Infinity, "100", null, undefined, 1n]) {
    const result = calculateRyczalt(validInput({
      revenues: [revenue("bad-type", amountGrosz)],
    }));

    assert.equal(result.status, "INVALID");
    assert.equal(result.taxDuePln, null);
    assert.ok(findingCodes(result).includes("INVALID_REVENUE_AMOUNT"));
  }
});

test("RED TEAM: suma bardzo dużych bezpiecznych składników jest bezpiecznie odrzucana", () => {
  const result = calculateRyczalt(validInput({
    revenues: [
      revenue("large-1", Number.MAX_SAFE_INTEGER),
      revenue("large-2", Number.MAX_SAFE_INTEGER),
    ],
    yearToDateRevenueByCategory: { software: Number.MAX_SAFE_INTEGER },
  }));

  assert.equal(result.status, "INVALID");
  assert.equal(result.taxDuePln, null);
  assert.ok(findingCodes(result).includes("REVENUE_TOTAL_OUT_OF_RANGE"));
});

test("RED TEAM: największe reszty rozdzielają wiele groszy i remis leksykograficznie", () => {
  const ids = ["g", "f", "e", "d", "c", "b", "a"];
  const result = calculateRyczalt(validInput({
    revenues: ids.map((id) => revenue(`${id}-1`, 100, id)),
    yearToDateRevenueByCategory: Object.fromEntries(ids.map((id) => [id, 100])),
    categories: ids.map((id) => category(id)),
    deductionGrosz: 10,
  }));

  assert.equal(result.status, "VERIFIED");
  assert.deepEqual(
    result.categoryRows.map(({ categoryId, deductionAllocatedGrosz }) => [categoryId, deductionAllocatedGrosz]),
    [["a", 2], ["b", 2], ["c", 2], ["d", 1], ["e", 1], ["f", 1], ["g", 1]],
  );
  assert.equal(
    result.categoryRows.reduce((sum, row) => sum + row.deductionAllocatedGrosz, 0),
    10,
  );
});

test("RED TEAM: zamrożone wejście nie jest mutowane także przy ostrzeżeniu", () => {
  const input = validInput({ categories: [category("software", 1200, { pkwiu: "" })] });
  Object.freeze(input.revenues[0]);
  Object.freeze(input.revenues);
  Object.freeze(input.categories[0].decision);
  Object.freeze(input.categories[0]);
  Object.freeze(input.categories);
  Object.freeze(input.yearToDateRevenueByCategory);
  Object.freeze(input);

  const result = calculateRyczalt(input);

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.taxDuePln, 120);
});
