import test from "node:test";
import assert from "node:assert/strict";
import { calculateZus } from "../zus-calculator.mjs";

function validInput(overrides = {}) {
  return {
    settlementPeriod: "2026-01",
    ruleVersion: "PL-ZUS-2026.1",
    taxationForm: "RYCZALT",
    scheme: "STANDARD",
    activeFullMonth: true,
    socialBaseMode: "MINIMUM",
    sicknessInsurance: true,
    labourFundsApplicable: true,
    accidentRateBasisPoints: 167,
    healthCalculationMethod: "CURRENT_YEAR_YTD",
    healthRevenueYtdGrosz: 0,
    ...overrides,
  };
}

test("RED TEAM: odrzuca nieistniejący okres i okres spoza reguł", () => {
  assert.equal(calculateZus(validInput({ settlementPeriod: "2026-13" })).status, "INVALID");
  assert.equal(calculateZus(validInput({ settlementPeriod: "2027-01" })).status, "INVALID");
});

test("RED TEAM: odrzuca ujemny, ułamkowy i niebezpieczny przychód", () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
    const result = calculateZus(validInput({ healthRevenueYtdGrosz: value }));
    assert.equal(result.status, "INVALID");
    assert.equal(result.totalDueGrosz, null);
  }
});

test("RED TEAM: brak i błędna wersja reguł nie uruchamiają obliczeń", () => {
  for (const value of [undefined, null, "PL-ZUS-2025.1"] ) {
    const result = calculateZus(validInput({ ruleVersion: value }));
    assert.equal(result.status, "INVALID");
    assert.equal(result.socialRows.length, 0);
  }
});

test("RED TEAM: obiekt niebędący kontraktem jest bezpiecznie odrzucany", () => {
  for (const value of [null, [], "input", 1]) {
    assert.doesNotThrow(() => calculateZus(value));
    assert.equal(calculateZus(value).status, "INVALID");
  }
});
