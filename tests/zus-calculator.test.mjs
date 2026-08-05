import test from "node:test";
import assert from "node:assert/strict";
import { calculateZus } from "../zus-calculator.mjs";

function validInput(overrides = {}) {
  return {
    settlementPeriod: "2026-06",
    ruleVersion: "PL-ZUS-2026.1",
    taxationForm: "RYCZALT",
    scheme: "STANDARD",
    activeFullMonth: true,
    socialBaseMode: "MINIMUM",
    sicknessInsurance: true,
    labourFundsApplicable: true,
    accidentRateBasisPoints: 167,
    healthCalculationMethod: "CURRENT_YEAR_YTD",
    healthRevenueYtdGrosz: 2910000,
    ...overrides,
  };
}

test("oblicza standardowy ZUS 2026 z chorobowym i najniższą zdrowotną", () => {
  const result = calculateZus(validInput());

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.socialBaseGrosz, 565200);
  assert.deepEqual(result.socialRows.map(({ code, amountGrosz }) => [code, amountGrosz]), [
    ["PENSION", 110327],
    ["DISABILITY", 45216],
    ["ACCIDENT", 9439],
    ["SICKNESS", 13847],
    ["LABOUR_FUNDS", 13847],
  ]);
  assert.equal(result.socialInsuranceDueGrosz, 178829);
  assert.equal(result.socialAndFundsDueGrosz, 192676);
  assert.equal(result.healthContributionGrosz, 49835);
  assert.equal(result.totalDueGrosz, 242511);
  assert.equal(result.pitDeductibleWhenPaid.labourFundsGrosz, 0);
});

test("dokładne granice progów pozostają w niższym progu", () => {
  assert.equal(calculateZus(validInput({ healthRevenueYtdGrosz: 6000000 })).healthTier, "TO_60000");
  assert.equal(calculateZus(validInput({ healthRevenueYtdGrosz: 6000001 })).healthTier, "TO_300000");
  assert.equal(calculateZus(validInput({ healthRevenueYtdGrosz: 30000000 })).healthTier, "TO_300000");
  assert.equal(calculateZus(validInput({ healthRevenueYtdGrosz: 30000001 })).healthTier, "ABOVE_300000");
});

test("oblicza wariant bez dobrowolnego chorobowego", () => {
  const result = calculateZus(validInput({ sicknessInsurance: false }));

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.socialInsuranceDueGrosz, 164982);
  assert.equal(result.socialAndFundsDueGrosz, 178829);
  assert.equal(result.totalDueGrosz, 228664);
  assert.equal(result.socialRows.some(({ code }) => code === "SICKNESS"), false);
});

test("nie mutuje wejścia", () => {
  const input = validInput();
  const snapshot = structuredClone(input);
  calculateZus(input);
  assert.deepEqual(input, snapshot);
});

test("odrzuca przypadki poza uproszczonym zakresem", () => {
  for (const overrides of [
    { scheme: "SMALL_ZUS_PLUS" },
    { activeFullMonth: false },
    { socialBaseMode: "DECLARED" },
    { labourFundsApplicable: false },
    { accidentRateBasisPoints: 180 },
    { healthCalculationMethod: "PREVIOUS_YEAR" },
  ]) {
    assert.equal(calculateZus(validInput(overrides)).status, "INVALID");
  }
});
