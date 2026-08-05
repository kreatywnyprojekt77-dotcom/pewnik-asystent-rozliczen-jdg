import test from "node:test";
import assert from "node:assert/strict";
import { calculateVat, VAT_RULE_VERSION } from "../vat-calculator.mjs";
import { createVatInputFromInvoices } from "../vat-adapter.mjs";

function input(overrides = {}) {
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

function entry(id, direction, amount, overrides = {}) {
  return {
    id,
    documentNumber: id,
    direction,
    documentType: "invoice",
    accountingPeriod: "2026-06",
    currency: "PLN",
    amounts: [{
      vatCode: "23",
      taxableBaseGrosz: amount * 100,
      vatAmountGrosz: amount * 23,
      ...(direction === "input" ? {
        deductibleVatGrosz: amount * 23,
        deductionDecision: { mode: "PERCENT_100" },
      } : {}),
    }],
    ...overrides,
  };
}

test("oblicza VAT należny, naliczony i do zapłaty", () => {
  const result = calculateVat(input({ entries: [entry("s1", "output", 1000), entry("k1", "input", 200)] }));
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.outputVatGrosz, 23000);
  assert.equal(result.deductibleInputVatGrosz, 4600);
  assert.equal(result.taxDueGrosz, 18400);
  assert.equal(result.excessGrosz, 0);
});

test("nie zeruje nadwyżki VAT i przenosi ją na kolejny okres", () => {
  const result = calculateVat(input({ entries: [entry("k1", "input", 1000)] }));
  assert.equal(result.taxDueGrosz, 0);
  assert.equal(result.excessGrosz, 23000);
  assert.equal(result.carryForwardGrosz, 23000);
});

test("uwzględnia nadwyżkę z poprzedniego okresu", () => {
  const result = calculateVat(input({ openingCarryForwardGrosz: 10000, entries: [entry("s1", "output", 1000)] }));
  assert.equal(result.taxDueGrosz, 13000);
});

test("obsługuje częściowe odliczenie VAT", () => {
  const cost = entry("k1", "input", 1000);
  cost.amounts[0].deductibleVatGrosz = 11500;
  cost.amounts[0].deductionDecision = { mode: "PERCENT_50" };
  const result = calculateVat(input({ entries: [cost] }));
  assert.equal(result.deductibleInputVatGrosz, 11500);
  assert.equal(result.nonDeductibleInputVatGrosz, 11500);
});

test("sumuje wiele stawek na jednym dokumencie", () => {
  const sale = entry("s1", "output", 1000);
  sale.amounts.push({ vatCode: "8", taxableBaseGrosz: 50000, vatAmountGrosz: 4000 });
  const result = calculateVat(input({ entries: [sale] }));
  assert.equal(result.outputVatGrosz, 27000);
  assert.deepEqual(result.outputRowsByVatCode.map((row) => row.vatCode), ["23", "8"]);
});

test("obsługuje korektę in minus", () => {
  const correction = entry("c1", "output", -100, { documentType: "correction" });
  const result = calculateVat(input({ entries: [entry("s1", "output", 1000), correction] }));
  assert.equal(result.outputVatGrosz, 20700);
});

test("odrzuca ujemną fakturę, która nie jest korektą", () => {
  const result = calculateVat(input({ entries: [entry("s1", "output", -100)] }));
  assert.equal(result.status, "INVALID");
  assert.ok(result.findings.some(({ code }) => code === "NEGATIVE_NON_CORRECTION"));
});

test("różnica kwoty VAT od stawki wymaga weryfikacji, ale używa kwoty dokumentu", () => {
  const sale = entry("s1", "output", 1000);
  sale.amounts[0].vatAmountGrosz = 20000;
  const result = calculateVat(input({ entries: [sale] }));
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.outputVatGrosz, 20000);
});

test("zwrot VAT wymaga weryfikacji", () => {
  const result = calculateVat(input({ excessDecision: { mode: "REFUND" }, entries: [entry("k1", "input", 1000)] }));
  assert.equal(result.refundRequestedGrosz, 23000);
  assert.equal(result.status, "REVIEW_REQUIRED");
});

test("odrzuca walutę inną niż PLN", () => {
  const result = calculateVat(input({ entries: [entry("s1", "output", 1000, { currency: "EUR" })] }));
  assert.equal(result.status, "INVALID");
  assert.ok(result.findings.some(({ code }) => code === "UNSUPPORTED_CURRENCY"));
});

test("odrzuca duplikaty i dziury w tablicach", () => {
  const duplicate = calculateVat(input({ entries: [entry("x", "output", 1), entry("x", "output", 1)] }));
  assert.equal(duplicate.status, "INVALID");
  const sparse = [];
  sparse.length = 1;
  assert.equal(calculateVat(input({ entries: sparse })).status, "INVALID");
});

test("wynik nie zależy od kolejności dokumentów", () => {
  const entries = [entry("b", "output", 1000), entry("a", "input", 200)];
  assert.deepEqual(calculateVat(input({ entries })), calculateVat(input({ entries: [...entries].reverse() })));
});

test("adapter wybiera właściwy miesiąc i buduje potwierdzone odliczenie", () => {
  const result = createVatInputFromInvoices({
    settlementPeriod: "2026-06",
    invoices: [
      { id: 1, number: "S/1", date: "2026-06-01", type: "sale", net: 100, vatRate: 23 },
      { id: 2, number: "K/1", date: "2026-06-02", receivedDate: "2026-07-01", type: "cost", net: 100, vatRate: 23, vatDeductionPercent: 50 },
    ],
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].direction, "output");
});

test("adapter oznacza brak decyzji zakupowej do weryfikacji", () => {
  const adapted = createVatInputFromInvoices({
    settlementPeriod: "2026-06",
    invoices: [{ id: 1, number: "K/1", date: "2026-06-02", type: "cost", net: 100, vatRate: 23 }],
  });
  const result = calculateVat(adapted);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.findings.some(({ code }) => code === "UNCONFIRMED_FULL_DEDUCTION"));
});
