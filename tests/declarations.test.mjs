import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import xmllint from "xmllint-wasm";
import {
  createDeclarationBundle,
  generateJpkV7mXml,
  generateZusDraKeduXml,
} from "../declarations.mjs";
import { DECLARATION_SCHEMAS, validateWithOfficialSchema } from "../declaration-validation.mjs";

const schemaNames = [...new Set(Object.values(DECLARATION_SCHEMAS).flatMap(({ main, dependencies }) => [main, ...dependencies]))];
const schemaFiles = Object.fromEntries(await Promise.all(schemaNames.map(async name => [
  name,
  await readFile(new URL(`../schemas/${name}`, import.meta.url), "utf8"),
])));

const company = { name: "Testowa działalność", nip: "1234563218" };
const declarationProfile = {
  firstName: "Anna",
  lastName: "Kowalska",
  birthDate: "1990-01-01",
  taxOfficeCode: "1215",
  email: "anna@example.test",
  phone: "500600700",
  zusShortName: "TESTOWA DZIALALNOSC",
  pesel: "44051401458",
  regon: "123456785",
  zusInsuranceTitleCode: "051000",
};
const invoices = [
  { id: "s1", number: "FV/1", date: "2026-06-03", supplyDate: "2026-06-03", contractor: "Klient", contractorNip: "1234563218", type: "sale", net: 1000, vatRate: 23, vatCode: "23", category: "consulting" },
  { id: "k1", number: "K/1", date: "2026-06-05", receivedDate: "2026-06-05", contractor: "Dostawca", contractorNip: "1234563218", type: "cost", net: 100, vatRate: 23, vatCode: "23", vatDeductionPercent: 100 },
];
const summary = {
  components: {
    ryczalt: { dueGrosz: 12000, result: { status: "VERIFIED", ruleVersion: "R1", rateRows: [] } },
    vat: { result: { status: "VERIFIED", ruleVersion: "V1", outputVatGrosz: 23000, deductibleInputVatGrosz: 2300, taxDueGrosz: 20700, excessGrosz: 0, carryForwardGrosz: 0 } },
    zus: { result: { status: "VERIFIED", ruleVersion: "Z1", socialBaseGrosz: 520314, socialRows: [
      { code: "PENSION", amountGrosz: 101565 },
      { code: "DISABILITY", amountGrosz: 41625 },
      { code: "ACCIDENT", amountGrosz: 8690 },
      { code: "SICKNESS", amountGrosz: 12748 },
    ], socialInsuranceDueGrosz: 164628, labourFundsDueGrosz: 12748, healthRevenueYtdGrosz: 1000000, healthBaseGrosz: 553718, healthContributionGrosz: 49835, totalDueGrosz: 227211 } },
  },
  audit: { ruleVersions: { ryczalt: "R1", vat: "V1", zus: "Z1" } },
};

test("tworzy gotowe dokumenty JPK i ZUS DRA w KEDU", () => {
  const bundle = createDeclarationBundle({ company, declarationProfile, invoices, summary, period: "2026-06" });
  assert.equal(bundle.documents.jpk.status, "READY");
  assert.equal(bundle.documents.zus.status, "READY");
  assert.deepEqual(bundle.audit.invoiceIds, ["k1", "s1"]);
});

test("ryczałt jest miesięczną kartą rozliczenia, a nie deklaracją PIT-28", () => {
  const document = createDeclarationBundle({ company, declarationProfile, invoices, summary, period: "2026-06" }).documents.ryczalt;
  assert.equal(document.kind, "RYCZALT");
  assert.equal(document.title, "Miesięczne rozliczenie ryczałtu");
  assert.equal(document.amountDueGrosz, 12000);
  assert.equal(Object.hasOwn(document, "xml"), false);
});

test("JPK_V7M zawiera nagłówek, dane osoby i ewidencję", () => {
  const document = createDeclarationBundle({ company, declarationProfile, invoices, summary, period: "2026-06" }).documents.jpk;
  const xml = generateJpkV7mXml(document, "2026-07-01T12:00:00+02:00");
  assert.match(xml, /kodSystemowy="JPK_V7M \(3\)"/);
  assert.match(xml, /<Miesiac>6<\/Miesiac>/);
  assert.match(xml, /<K_19>1000\.00<\/K_19>/);
  assert.match(xml, /<K_20>230\.00<\/K_20>/);
  assert.match(xml, /<GTU_12>1<\/GTU_12>/);
  assert.match(xml, /<K_43>23\.00<\/K_43>/);
  assert.match(xml, /<P_51>207<\/P_51>/);
  assert.equal(document.officialSchemaUrl, "https://crd.gov.pl/wzor/2025/12/19/14090/schemat.xsd");
});

test("JPK bezpiecznie koduje tekst pochodzący z faktury", () => {
  const specialInvoices = structuredClone(invoices);
  specialInvoices[0].contractor = "A & B <Usługi>";
  const document = createDeclarationBundle({ company, declarationProfile, invoices: specialInvoices, summary, period: "2026-06" }).documents.jpk;
  const xml = generateJpkV7mXml(document, "2026-07-01T12:00:00+02:00");
  assert.match(xml, /A &amp; B &lt;Usługi&gt;/);
  assert.doesNotMatch(xml, /A & B <Usługi>/);
});

test("blokuje JPK przy brakujących danych identyfikacyjnych", () => {
  const bundle = createDeclarationBundle({ company: { name: "X", nip: "0000000000" }, declarationProfile: {}, invoices, summary, period: "2026-06" });
  assert.equal(bundle.documents.jpk.status, "BLOCKED");
  assert.throws(() => generateJpkV7mXml(bundle.documents.jpk), /nie jest jeszcze gotowy/);
});

test("nie eksportuje JPK ze statusem wymagającym weryfikacji", () => {
  const reviewSummary = structuredClone(summary);
  reviewSummary.components.vat.result.status = "REVIEW_REQUIRED";
  const document = createDeclarationBundle({ company, declarationProfile, invoices, summary: reviewSummary, period: "2026-06" }).documents.jpk;
  assert.equal(document.status, "REVIEW_REQUIRED");
  assert.throws(() => generateJpkV7mXml(document), /nie jest jeszcze gotowy/);
});

test("eksport ZUS jest rzeczywistą paczką KEDU 2.27 z dokumentem DRA", () => {
  const document = createDeclarationBundle({ company, declarationProfile, invoices, summary, period: "2026-06" }).documents.zus;
  const xml = generateZusDraKeduXml(document, "2026-07-01T12:00:00+02:00");
  assert.match(xml, /<KEDU wersja_schematu="1" xmlns="http:\/\/www\.zus\.pl\/2026\/KEDU_5_7"/);
  assert.match(xml, /<ZUSDRA id_dokumentu="1">/);
  assert.match(xml, /<p2>2026-06<\/p2>/);
  assert.match(xml, /<p2>2272\.11<\/p2>/);
  assert.match(xml, /<p12>true<\/p12>/);
  assert.equal(document.targetSchema, "KEDU-2.27 / KEDU_5_7");
  assert.equal(document.acceptanceStatus, "LOCAL_XSD_VALIDATION_REQUIRED");
});

test("wygenerowany JPK_V7M(3) przechodzi oficjalny schemat XSD", async () => {
  const document = createDeclarationBundle({ company, declarationProfile, invoices, summary, period: "2026-06" }).documents.jpk;
  const xml = generateJpkV7mXml(document, "2026-07-01T12:00:00+02:00");
  const result = await validateWithOfficialSchema("jpk", xml, schemaFiles, xmllint.validateXML);
  assert.equal(result.valid, true, result.errors.map(error => error.message).join("\n"));
});

test("wygenerowany KEDU z ZUS DRA przechodzi oficjalny schemat XSD", async () => {
  const document = createDeclarationBundle({ company, declarationProfile, invoices, summary, period: "2026-06" }).documents.zus;
  const xml = generateZusDraKeduXml(document, "2026-07-01T12:00:00+02:00");
  const result = await validateWithOfficialSchema("zus", xml, schemaFiles, xmllint.validateXML);
  assert.equal(result.valid, true, result.errors.map(error => error.message).join("\n"));
});

test("oficjalne schematy odrzucają uszkodzone pliki zamiast oznaczać je jako gotowe", async () => {
  const bundle = createDeclarationBundle({ company, declarationProfile, invoices, summary, period: "2026-06" });
  const invalidJpk = generateJpkV7mXml(bundle.documents.jpk, "2026-07-01T12:00:00+02:00")
    .replace("<WariantFormularza>3</WariantFormularza>", "<WariantFormularza>99</WariantFormularza>");
  const invalidKedu = generateZusDraKeduXml(bundle.documents.zus, "2026-07-01T12:00:00+02:00")
    .replace(/\s*<I>[\s\S]*?<\/I>/, "");
  const [jpkResult, zusResult] = await Promise.all([
    validateWithOfficialSchema("jpk", invalidJpk, schemaFiles, xmllint.validateXML),
    validateWithOfficialSchema("zus", invalidKedu, schemaFiles, xmllint.validateXML),
  ]);
  assert.equal(jpkResult.valid, false);
  assert.equal(zusResult.valid, false);
});
