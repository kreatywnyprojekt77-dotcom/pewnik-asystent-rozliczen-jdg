import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseMoneyToGrosz, prepareInvoice } from "../invoice-input.mjs";
import { createRyczaltInputFromInvoices } from "../ryczalt-adapter.mjs";
import { createVatInputFromInvoices } from "../vat-adapter.mjs";

function validInvoice(overrides = {}) {
  return {
    id: 1,
    number: " FV/1 ",
    date: "2026-06-15",
    contractor: " Test Sp. z o.o. ",
    type: "sale",
    documentType: "invoice",
    net: "1 234,56",
    vatCode: "23",
    currency: "pln",
    category: "software",
    ...overrides,
  };
}

test("parsuje kwoty do groszy bez mnożenia binarnej liczby zmiennoprzecinkowej", () => {
  assert.equal(parseMoneyToGrosz("1 234,56"), 123456);
  assert.equal(parseMoneyToGrosz("-0.01"), -1);
  assert.equal(parseMoneyToGrosz("12.3"), 1230);
  assert.equal(parseMoneyToGrosz(""), null);
  assert.equal(parseMoneyToGrosz(null), null);
  assert.equal(parseMoneyToGrosz("1.234"), null);
});

test("normalizuje prostą fakturę z formularza", () => {
  const result = prepareInvoice(validInvoice());
  assert.equal(result.status, "VALID");
  assert.equal(result.value.id, "1");
  assert.equal(result.value.number, "FV/1");
  assert.equal(result.value.contractor, "Test Sp. z o.o.");
  assert.equal(result.value.netGrosz, 123456);
  assert.equal(result.value.net, 1234.56);
  assert.equal(result.value.currency, "PLN");
  assert.equal(result.value.vatRate, 23);
});

test("zwraca stabilne błędy zamiast poprawiać błędne dane", () => {
  const result = prepareInvoice(validInvoice({
    date: "2026-02-30",
    net: "10.999",
    vatCode: "17",
  }));
  assert.equal(result.status, "INVALID");
  assert.deepEqual(result.findings.map(({ code }) => code), [
    "INVALID_NET_AMOUNT",
    "INVALID_VAT_CODE",
    "INVALID_DATE",
  ]);
});

test("odrzuca ujemną zwykłą fakturę i błędne odliczenie VAT", () => {
  const result = prepareInvoice(validInvoice({
    type: "cost",
    net: "-10.00",
    vatDeductionPercent: 25,
  }));
  assert.equal(result.status, "INVALID");
  assert.ok(result.findings.some(({ code }) => code === "NEGATIVE_NON_CORRECTION"));
  assert.ok(result.findings.some(({ code }) => code === "INVALID_VAT_DEDUCTION_PERCENT"));
});

test("nie modyfikuje danych wejściowych", () => {
  const invoice = validInvoice();
  const snapshot = structuredClone(invoice);
  prepareInvoice(invoice);
  assert.deepEqual(invoice, snapshot);
});

test("adaptery nie zamieniają pustej kwoty na zero", () => {
  const invoice = validInvoice({ net: "" });
  const ryczalt = createRyczaltInputFromInvoices({
    invoices: [invoice],
    settlementPeriod: "2026-06",
    ratesPercent: { software: 12 },
  });
  const vat = createVatInputFromInvoices({
    invoices: [invoice],
    settlementPeriod: "2026-06",
  });

  assert.equal(ryczalt.revenues[0].amountGrosz, null);
  assert.equal(vat.entries[0].amounts[0].taxableBaseGrosz, null);
  assert.equal(vat.entries[0].amounts[0].vatAmountGrosz, null);
});

test("formularz i build korzystają ze wspólnego modułu", async () => {
  const [app, build] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(app, /import \{ prepareInvoice \} from ['"]\.\/invoice-input\.mjs['"]/);
  assert.match(app, /const prepared = prepareInvoice\(/);
  assert.match(build, /['"]invoice-input\.mjs['"]/);
});
