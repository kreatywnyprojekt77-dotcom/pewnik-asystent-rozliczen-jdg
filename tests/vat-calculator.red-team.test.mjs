import test from "node:test";
import assert from "node:assert/strict";
import { calculateVat, VAT_RULE_VERSION } from "../vat-calculator.mjs";
import { createVatInputFromInvoices } from "../vat-adapter.mjs";

function base(overrides = {}) {
  return {
    settlementPeriod: "2026-06",
    settlementMode: "monthly",
    taxpayerVatStatus: "active",
    ruleVersion: VAT_RULE_VERSION,
    openingCarryForwardGrosz: 0,
    excessDecision: { mode: "CARRY_FORWARD" },
    entries: [],
    ...overrides,
  };
}

function sale(id = "s", vat = 2300) {
  return {
    id,
    documentNumber: id,
    direction: "output",
    documentType: "invoice",
    accountingPeriod: "2026-06",
    accountingPeriodSource: "TAX_POINT_DATE",
    currency: "PLN",
    amounts: [{ vatCode: "23", taxableBaseGrosz: 10000, vatAmountGrosz: vat }],
  };
}

test("RED TEAM: dziura w tablicy wierszy VAT jest odrzucana", () => {
  const entry = sale();
  entry.amounts = [];
  entry.amounts.length = 1;
  const result = calculateVat(base({ entries: [entry] }));
  assert.equal(result.status, "INVALID");
  assert.ok(result.findings.some(({ code }) => code === "INVALID_AMOUNT_ROWS"));
});

test("RED TEAM: dokument z innego okresu nie może wpłynąć na wynik", () => {
  const entry = sale();
  entry.accountingPeriod = "2026-05";
  const result = calculateVat(base({ entries: [entry] }));
  assert.equal(result.status, "INVALID");
  assert.equal(result.taxDueGrosz, null);
});

test("RED TEAM: odliczenie większe niż VAT dokumentu jest odrzucane", () => {
  const entry = sale("k");
  entry.direction = "input";
  entry.amounts[0].deductibleVatGrosz = 2301;
  entry.amounts[0].deductionDecision = { mode: "AMOUNT" };
  const result = calculateVat(base({ entries: [entry] }));
  assert.equal(result.status, "INVALID");
  assert.ok(result.findings.some(({ code }) => code === "INVALID_DEDUCTIBLE_VAT"));
});

test("RED TEAM: ujemne odliczenie przy dodatnim VAT jest odrzucane", () => {
  const entry = sale("k");
  entry.direction = "input";
  entry.amounts[0].deductibleVatGrosz = -100;
  entry.amounts[0].deductionDecision = { mode: "AMOUNT" };
  assert.equal(calculateVat(base({ entries: [entry] })).status, "INVALID");
});

test("RED TEAM: błędny podział nadwyżki nie jest akceptowany", () => {
  const entry = sale("k");
  entry.direction = "input";
  entry.amounts[0].deductibleVatGrosz = 2300;
  entry.amounts[0].deductionDecision = { mode: "PERCENT_100" };
  const result = calculateVat(base({
    entries: [entry],
    excessDecision: { mode: "MIXED", carryForwardGrosz: 1000, refundRequestedGrosz: 1000 },
  }));
  assert.equal(result.status, "INVALID");
});

test("RED TEAM: suma poza bezpiecznym zakresem jest odrzucana", () => {
  const first = sale("a", Number.MAX_SAFE_INTEGER);
  first.amounts[0].vatCode = "MIXED";
  first.amounts[0].taxableBaseGrosz = 0;
  const second = sale("b", 1);
  second.amounts[0].vatCode = "MIXED";
  second.amounts[0].taxableBaseGrosz = 0;
  const result = calculateVat(base({ entries: [first, second] }));
  assert.equal(result.status, "INVALID");
  assert.ok(result.findings.some(({ code }) => code === "AMOUNT_OUT_OF_RANGE"));
});

test("RED TEAM: zamrożone wejście nie jest mutowane", () => {
  const entry = sale();
  Object.freeze(entry.amounts[0]);
  Object.freeze(entry.amounts);
  Object.freeze(entry);
  const input = base({ entries: Object.freeze([entry]) });
  Object.freeze(input.excessDecision);
  Object.freeze(input);
  assert.doesNotThrow(() => calculateVat(input));
});

test("RED TEAM: kolejność dokumentów nie zmienia także ostrzeżeń", () => {
  const a = sale("a", 2200);
  const b = sale("b", 2100);
  assert.deepEqual(calculateVat(base({ entries: [a, b] })), calculateVat(base({ entries: [b, a] })));
});

test("RED TEAM: brak daty właściwej nie może dać statusu VERIFIED", () => {
  const adapted = createVatInputFromInvoices({
    settlementPeriod: "2026-06",
    invoices: [{ id: 1, number: "FV/1", date: "2026-06-15", type: "sale", net: 100, vatRate: 23 }],
  });
  const result = calculateVat(adapted);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.findings.some(({ code }) => code === "FALLBACK_ACCOUNTING_PERIOD"));
});

test("RED TEAM: KSeF bez decyzji zakupowej nie może potwierdzić odliczenia", () => {
  const adapted = createVatInputFromInvoices({
    settlementPeriod: "2026-06",
    invoices: [{
      id: 1,
      number: "K/1",
      date: "2026-06-10",
      ksefAcquisitionDate: "2026-06-11T08:00:00Z",
      type: "cost",
      source: "ksef",
      net: 100,
      vatRate: 23,
      vatAmount: 23,
      vatDeductionPercent: null,
    }],
  });
  const result = calculateVat(adapted);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.findings.some(({ code }) => code === "UNCONFIRMED_FULL_DEDUCTION"));
});
