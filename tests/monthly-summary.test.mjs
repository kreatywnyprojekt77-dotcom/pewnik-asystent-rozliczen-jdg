import test from "node:test";
import assert from "node:assert/strict";

import { generateMonthlySummary } from "../monthly-summary.mjs";

function categoryMetadata(overrides = {}) {
  return {
    name: "Usługi programistyczne",
    pkwiu: "ex 62.01.1",
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

function validInput(overrides = {}) {
  return {
    settlementPeriod: "2026-06",
    invoices: [
      {
        id: "s-1",
        number: "FV/1",
        type: "sale",
        documentType: "invoice",
        date: "2026-06-10",
        supplyDate: "2026-06-10",
        taxPointDate: "2026-06-10",
        net: 1000,
        vatRate: 23,
        vatCode: "23",
        category: "software",
      },
      {
        id: "k-1",
        number: "K/1",
        type: "cost",
        documentType: "invoice",
        date: "2026-06-12",
        receivedDate: "2026-06-12",
        net: 200,
        vatRate: 23,
        vatCode: "23",
        vatDeductionPercent: 100,
      },
    ],
    vatSettings: { openingCarryForwardGrosz: 0, excessMode: "CARRY_FORWARD" },
    ryczaltSettings: {
      deductionGrosz: 0,
      ratesPercent: { software: 12 },
      categoryMetadata: { software: categoryMetadata() },
    },
    zusSettings: { healthRevenueDeductionYtdGrosz: 0, sicknessInsurance: true },
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test("łączy VAT, ryczałt i ZUS w jedno zweryfikowane podsumowanie w groszach", () => {
  const result = generateMonthlySummary(validInput());

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.components.ryczalt.dueGrosz, 12000);
  assert.equal(result.components.vat.dueGrosz, 18400);
  assert.equal(result.components.zus.dueGrosz, 242511);
  assert.equal(result.payment.totalDueGrosz, 272911);
  assert.equal(result.payment.amountAvailable, true);
  assert.equal(result.payment.canCreateTransfers, true);
  assert.equal(result.metrics.revenueGrosz, 100000);
  assert.equal(result.metrics.costNetGrosz, 20000);
  assert.equal(result.metrics.salesDocumentCount, 1);
  assert.equal(result.metrics.costDocumentCount, 1);
  assert.deepEqual(result.audit.ruleVersions, {
    ryczalt: "PL-RYCZALT-2026.1",
    vat: result.components.vat.result.ruleVersion,
    zus: "PL-ZUS-2026.1",
  });
});

test("kwota robocza pozostaje widoczna przy REVIEW_REQUIRED, ale przelewy są zablokowane", () => {
  const input = validInput();
  input.ryczaltSettings.categoryMetadata.software = categoryMetadata({ pkwiu: "" });

  const result = generateMonthlySummary(input);

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.payment.amountAvailable, true);
  assert.equal(result.payment.totalDueGrosz, 272911);
  assert.equal(result.payment.canCreateTransfers, false);
  assert.ok(result.findings.some(({ area, code }) => area === "RYCZALT" && code === "MISSING_PKWIU"));
});

test("brak kwoty ryczałtu blokuje sumę zamiast zamieniać ją na zero", () => {
  const input = validInput();
  input.ryczaltSettings.deductionGrosz = 100001;

  const result = generateMonthlySummary(input);

  assert.equal(result.components.ryczalt.status, "REVIEW_REQUIRED");
  assert.equal(result.components.ryczalt.dueGrosz, null);
  assert.equal(result.payment.amountAvailable, false);
  assert.equal(result.payment.totalDueGrosz, null);
  assert.equal(result.payment.canCreateTransfers, false);
});

test("wynik INVALID któregokolwiek kalkulatora blokuje łączną kwotę", () => {
  const input = validInput();
  input.invoices[0].net = "niepoprawna kwota";

  const result = generateMonthlySummary(input);

  assert.equal(result.status, "INVALID");
  assert.equal(result.payment.amountAvailable, false);
  assert.equal(result.payment.totalDueGrosz, null);
  assert.equal(result.payment.canCreateTransfers, false);
});

test("nadwyżka VAT daje zero VAT do zapłaty i nie jest odejmowana od innych zobowiązań", () => {
  const input = validInput({
    invoices: [{
      id: "k-1",
      number: "K/1",
      type: "cost",
      documentType: "invoice",
      date: "2026-06-12",
      receivedDate: "2026-06-12",
      net: 200,
      vatRate: 23,
      vatCode: "23",
      vatDeductionPercent: 100,
    }],
  });

  const result = generateMonthlySummary(input);

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.components.vat.dueGrosz, 0);
  assert.equal(result.components.vat.excessGrosz, 4600);
  assert.equal(result.payment.totalDueGrosz, result.components.zus.dueGrosz);
});

test("nieprawidłowa kolekcja dokumentów jest jawnym błędem generatora", () => {
  const result = generateMonthlySummary(validInput({ invoices: null }));

  assert.equal(result.status, "INVALID");
  assert.equal(result.payment.totalDueGrosz, null);
  assert.ok(result.findings.some(({ area, code }) => area === "SUMMARY" && code === "INVALID_INVOICES"));
});

test("generator nie modyfikuje wejścia i nie zależy od kolejności dokumentów", () => {
  const input = validInput();
  const reversed = validInput({ invoices: [...input.invoices].reverse() });
  deepFreeze(input);

  const result = generateMonthlySummary(input);
  const reordered = generateMonthlySummary(reversed);

  assert.deepEqual(result, reordered);
});
