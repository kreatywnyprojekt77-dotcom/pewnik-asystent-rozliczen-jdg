import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { calculateRyczalt } from "../ryczalt-calculator.mjs";
import { createRyczaltInputFromInvoices, RYCZALT_RULE_VERSION } from "../ryczalt-adapter.mjs";

function metadata(name) {
  return {
    name,
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
  };
}

test("adapter wybiera miesiąc, buduje YTD i pomija koszty oraz przyszłe okresy", () => {
  const input = createRyczaltInputFromInvoices({
    settlementPeriod: "2026-06",
    deductionGrosz: 100,
    ratesPercent: { software: 12, consulting: 8.5 },
    categoryMetadata: {
      software: metadata("Programowanie"),
      consulting: metadata("Konsulting"),
    },
    invoices: [
      { id: "jan", type: "sale", date: "2026-01-10", net: 100, category: "software" },
      { id: "jun-a", type: "sale", date: "2026-06-10", net: 200, category: "software" },
      { id: "jun-b", type: "sale", date: "2026-06-12", net: 50, category: "consulting" },
      { id: "cost", type: "cost", date: "2026-06-15", net: 999, category: "software" },
      { id: "future", type: "sale", date: "2026-07-01", net: 500, category: "software" },
    ],
  });

  assert.equal(input.ruleVersion, RYCZALT_RULE_VERSION);
  assert.deepEqual(input.revenues, [
    { id: "jun-a", period: "2026-06", amountGrosz: 20000, categoryId: "software" },
    { id: "jun-b", period: "2026-06", amountGrosz: 5000, categoryId: "consulting" },
  ]);
  assert.deepEqual(input.yearToDateRevenueByCategory, { consulting: 5000, software: 30000 });
  assert.deepEqual(input.categories.map(({ id, rateBasisPoints }) => [id, rateBasisPoints]), [
    ["consulting", 850],
    ["software", 1200],
  ]);

  const result = calculateRyczalt(input);
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.revenueTotalGrosz, 25000);
  assert.equal(result.deductionTotalGrosz, 100);
});

test("jawny revenuePeriod ma pierwszeństwo przed datą dokumentu", () => {
  const input = createRyczaltInputFromInvoices({
    settlementPeriod: "2026-06",
    ratesPercent: { software: 12 },
    categoryMetadata: { software: metadata("Programowanie") },
    invoices: [
      { id: 1, type: "sale", date: "2026-07-01", revenuePeriod: "2026-06", net: 10, category: "software" },
    ],
  });

  assert.equal(input.revenues.length, 1);
  assert.equal(input.revenues[0].period, "2026-06");
  assert.equal(input.yearToDateRevenueByCategory.software, 1000);
});

test("adapter nie wymyśla metadanych decyzji podatkowej", () => {
  const input = createRyczaltInputFromInvoices({
    settlementPeriod: "2026-06",
    ratesPercent: { software: 12 },
    invoices: [{ id: 1, type: "sale", date: "2026-06-01", net: 100, category: "software" }],
  });
  const result = calculateRyczalt(input);

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.taxDuePln, 12);
  assert.ok(result.findings.some(({ code }) => code === "MISSING_DECISION"));
  assert.ok(result.findings.some(({ code }) => code === "MISSING_PKWIU"));
});

test("brak kategorii sprzedaży pozostaje jawnym błędem kalkulatora", () => {
  const input = createRyczaltInputFromInvoices({
    settlementPeriod: "2026-06",
    ratesPercent: { software: 12 },
    categoryMetadata: { software: metadata("Programowanie") },
    invoices: [{ id: 1, type: "sale", date: "2026-06-01", net: 100, category: null }],
  });
  const result = calculateRyczalt(input);

  assert.equal(result.status, "INVALID");
  assert.equal(result.taxDuePln, null);
  assert.ok(result.findings.some(({ code }) => code === "MISSING_CATEGORY"));
});

test("app używa generatora, a generator orkiestruje kalkulatory", async () => {
  const [app, summary, build, html] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../monthly-summary.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);

  assert.match(app, /import \{ generateMonthlySummary \} from ['"]\.\/monthly-summary\.mjs['"]/);
  assert.match(app, /generateMonthlySummary\(\{/);
  assert.match(summary, /createRyczaltInputFromInvoices\(/);
  assert.match(summary, /calculateRyczalt\(ryczaltInput\)/);
  assert.match(summary, /createVatInputFromInvoices\(/);
  assert.match(summary, /calculateVat\(vatInput\)/);
  assert.doesNotMatch(app, /base\s*\*\s*rate\s*\/\s*100/);
  assert.match(build, /['"]ryczalt-adapter\.mjs['"]/);
  assert.match(build, /['"]monthly-summary\.mjs['"]/);
  assert.match(html, /id="pitStatus"/);
  assert.match(html, /id="vatStatus"/);
  assert.match(html, /id="dashboardVerificationPanel"/);
  assert.doesNotMatch(html, /id="verificationView"/);
  assert.doesNotMatch(html, /data-view="verification"/);
  assert.doesNotMatch(html, /data-view="settlements"/);
  assert.match(html, /id="saveCategoryProfiles"/);
  assert.match(html, /Dokończ rozliczenie krok po kroku/);
  assert.match(app, /categoryMetadata: state\.categoryProfiles/);
  assert.match(app, /deductionGrosz: ryczaltSettings\.deductionGrosz/);
  assert.match(app, /noSalesConfirmed/);
  assert.doesNotMatch(app, /state\.rules\.revenueDeduction/);
  assert.match(app, /reviewPit \? 'Wymaga uwagi'/);
  assert.match(app, /status === 'INVALID' \? 'Popraw dane' : 'Wymaga uwagi'/);
  assert.match(app, /reviewOverall \? 'Do weryfikacji'/);
  assert.doesNotMatch(app, /reviewPit \? 'Wynik roboczy'/);
  assert.doesNotMatch(app, /Ryczałt — wynik roboczy/);
});
