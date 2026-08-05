import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createZusInputFromInvoices } from "../zus-adapter.mjs";

test("adapter sumuje sprzedaż bieżącego roku, pomija koszty, przyszłość i wyłączenia", () => {
  const input = createZusInputFromInvoices({
    settlementPeriod: "2026-06",
    healthRevenueDeductionYtdGrosz: 10000,
    invoices: [
      { id: 1, type: "sale", date: "2026-01-10", net: 1000 },
      { id: 2, type: "sale", date: "2026-06-10", netGrosz: 200000 },
      { id: 3, type: "cost", date: "2026-06-10", net: 9000 },
      { id: 4, type: "sale", date: "2026-07-10", net: 9000 },
      { id: 5, type: "sale", date: "2025-12-10", net: 9000 },
      { id: 6, type: "sale", date: "2026-03-10", net: 500, excludedFromHealthRevenue: true },
    ],
  });

  assert.equal(input.healthRevenueYtdGrosz, 290000);
  assert.equal(input.ruleVersion, "PL-ZUS-2026.1");
  assert.equal(input.scheme, "STANDARD");
});

test("jawna kwota przychodu zdrowotnego ma pierwszeństwo", () => {
  const input = createZusInputFromInvoices({
    settlementPeriod: "2026-06",
    invoices: [{ type: "sale", date: "2026-06-01", net: 1000, healthRevenueGrosz: 12345 }],
  });
  assert.equal(input.healthRevenueYtdGrosz, 12345);
});

test("błędna kwota trafia do walidacji kalkulatora zamiast być zerowana", () => {
  const input = createZusInputFromInvoices({
    settlementPeriod: "2026-06",
    invoices: [{ type: "sale", date: "2026-06-01", net: "abc" }],
  });
  assert.equal(Number.isNaN(input.healthRevenueYtdGrosz), true);
});

test("generator używa kalkulatora ZUS, a build publikuje wszystkie moduły", async () => {
  const [app, summary, build, html] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../monthly-summary.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);

  assert.match(app, /import \{ generateMonthlySummary \} from ['"]\.\/monthly-summary\.mjs['"]/);
  assert.match(summary, /createZusInputFromInvoices\(/);
  assert.match(summary, /calculateZus\(zusInput\)/);
  assert.doesNotMatch(app, /state\.rules\.socialZus|state\.rules\.healthZus/);
  assert.match(build, /['"]zus-rules\.mjs['"]/);
  assert.match(build, /['"]zus-calculator\.mjs['"]/);
  assert.match(build, /['"]zus-adapter\.mjs['"]/);
  assert.match(build, /['"]monthly-summary\.mjs['"]/);
  assert.match(html, /id="zusStatus"/);
  assert.doesNotMatch(html, /id="socialZus"|id="healthZus"/);
});
