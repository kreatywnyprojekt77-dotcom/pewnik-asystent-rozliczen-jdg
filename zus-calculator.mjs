import { ZUS_RULES, ZUS_RULE_VERSION } from "./zus-rules.mjs";

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPeriod(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function roundRatioHalfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function toSafeNumber(value) {
  return value <= MAX_SAFE_BIGINT ? Number(value) : null;
}

function finding(code, severity, message, path, details) {
  const result = { code, severity, message, path, relatedIds: [] };
  if (details !== undefined) result.details = details;
  return result;
}

function baseResult(input) {
  return {
    status: "INVALID",
    ruleVersion: isRecord(input) && typeof input.ruleVersion === "string" ? input.ruleVersion : null,
    settlementPeriod: isRecord(input) && typeof input.settlementPeriod === "string" ? input.settlementPeriod : null,
    socialBaseGrosz: null,
    socialRows: [],
    socialInsuranceDueGrosz: null,
    labourFundsDueGrosz: null,
    socialAndFundsDueGrosz: null,
    healthRevenueYtdGrosz: isRecord(input) && isSafeNonNegativeInteger(input.healthRevenueYtdGrosz)
      ? input.healthRevenueYtdGrosz
      : null,
    healthTier: null,
    healthBaseGrosz: null,
    healthContributionGrosz: null,
    totalDueGrosz: null,
    pitDeductibleWhenPaid: {
      socialInsuranceGrosz: null,
      labourFundsGrosz: 0,
      healthShareBasisPoints: 5000,
    },
    findings: [],
    audit: {
      appliedHealthThresholdsGrosz: [],
      accidentRateBasisPoints: null,
      sicknessIncluded: null,
    },
  };
}

function validate(input, result) {
  if (!isRecord(input)) {
    result.findings.push(finding("INVALID_INPUT", "error", "Dane wejściowe muszą być obiektem.", "input"));
    return;
  }
  if (!isPeriod(input.settlementPeriod)) {
    result.findings.push(finding("INVALID_SETTLEMENT_PERIOD", "error", "Okres musi mieć format YYYY-MM.", "settlementPeriod"));
  } else if (input.settlementPeriod < ZUS_RULES.validFrom || input.settlementPeriod > ZUS_RULES.validTo) {
    result.findings.push(finding("RULE_NOT_VALID_FOR_PERIOD", "error", "Wersja reguł nie obowiązuje w podanym okresie.", "settlementPeriod"));
  }
  if (input.ruleVersion !== ZUS_RULE_VERSION) {
    result.findings.push(finding("UNSUPPORTED_RULE_VERSION", "error", `Obsługiwana wersja reguł to ${ZUS_RULE_VERSION}.`, "ruleVersion"));
  }
  if (input.taxationForm !== "RYCZALT") {
    result.findings.push(finding("UNSUPPORTED_TAXATION_FORM", "error", "Obsługiwany jest wyłącznie ryczałt.", "taxationForm"));
  }
  if (input.scheme !== "STANDARD") {
    result.findings.push(finding("UNSUPPORTED_ZUS_SCHEME", "error", "Obsługiwany jest wyłącznie standardowy ZUS bez ulg.", "scheme"));
  }
  if (input.activeFullMonth !== true) {
    result.findings.push(finding("PARTIAL_MONTH_UNSUPPORTED", "error", "Kalkulator obsługuje wyłącznie pełny miesiąc prowadzenia działalności.", "activeFullMonth"));
  }
  if (input.socialBaseMode !== "MINIMUM") {
    result.findings.push(finding("UNSUPPORTED_SOCIAL_BASE", "error", "Obsługiwana jest wyłącznie minimalna standardowa podstawa składek.", "socialBaseMode"));
  }
  if (typeof input.sicknessInsurance !== "boolean") {
    result.findings.push(finding("INVALID_SICKNESS_SETTING", "error", "Ustawienie dobrowolnego chorobowego musi być wartością logiczną.", "sicknessInsurance"));
  }
  if (input.labourFundsApplicable !== true) {
    result.findings.push(finding("LABOUR_FUNDS_EXCEPTION_UNSUPPORTED", "error", "Wersja uproszczona wymaga opłacania FP i FS.", "labourFundsApplicable"));
  }
  if (input.accidentRateBasisPoints !== ZUS_RULES.socialRatesBasisPoints.accident) {
    result.findings.push(finding("UNSUPPORTED_ACCIDENT_RATE", "error", "Wersja uproszczona obsługuje stopę wypadkową 1,67%.", "accidentRateBasisPoints"));
  }
  if (input.healthCalculationMethod !== "CURRENT_YEAR_YTD") {
    result.findings.push(finding("UNSUPPORTED_HEALTH_METHOD", "error", "Obsługiwana jest wyłącznie metoda przychodu bieżącego roku.", "healthCalculationMethod"));
  }
  if (!isSafeNonNegativeInteger(input.healthRevenueYtdGrosz)) {
    result.findings.push(finding("INVALID_HEALTH_REVENUE", "error", "Przychód narastający musi być nieujemną bezpieczną liczbą całkowitą groszy.", "healthRevenueYtdGrosz"));
  }
}

function contributionRow(code, label, baseGrosz, rateBasisPoints, deductibleForPit) {
  const amount = roundRatioHalfUp(BigInt(baseGrosz) * BigInt(rateBasisPoints), 10000n);
  return {
    code,
    label,
    baseGrosz,
    rateBasisPoints,
    amountGrosz: toSafeNumber(amount),
    deductibleForPit,
  };
}

export function calculateZus(input) {
  const result = baseResult(input);
  validate(input, result);
  if (result.findings.some(({ severity }) => severity === "error")) return result;

  const rates = ZUS_RULES.socialRatesBasisPoints;
  const definitions = [
    ["PENSION", "Emerytalna", rates.pension, true],
    ["DISABILITY", "Rentowa", rates.disability, true],
    ["ACCIDENT", "Wypadkowa", rates.accident, true],
  ];
  if (input.sicknessInsurance) definitions.push(["SICKNESS", "Chorobowa", rates.sickness, true]);
  definitions.push(["LABOUR_FUNDS", "FP i FS", rates.labourFunds, false]);

  result.socialBaseGrosz = ZUS_RULES.socialBaseGrosz;
  result.socialRows = definitions.map(([code, label, rate, deductible]) =>
    contributionRow(code, label, ZUS_RULES.socialBaseGrosz, rate, deductible));
  if (result.socialRows.some(({ amountGrosz }) => amountGrosz === null)) {
    result.findings.push(finding("CONTRIBUTION_OUT_OF_RANGE", "error", "Kwota składki przekracza bezpieczny zakres obliczeń.", "socialRows"));
    result.socialRows = [];
    return result;
  }

  result.socialInsuranceDueGrosz = result.socialRows
    .filter(({ deductibleForPit }) => deductibleForPit)
    .reduce((sum, { amountGrosz }) => sum + amountGrosz, 0);
  result.labourFundsDueGrosz = result.socialRows
    .filter(({ code }) => code === "LABOUR_FUNDS")
    .reduce((sum, { amountGrosz }) => sum + amountGrosz, 0);
  result.socialAndFundsDueGrosz = result.socialInsuranceDueGrosz + result.labourFundsDueGrosz;

  const tier = ZUS_RULES.healthTiers.find(({ revenueToGrosz }) =>
    revenueToGrosz === null || input.healthRevenueYtdGrosz <= revenueToGrosz);
  result.healthRevenueYtdGrosz = input.healthRevenueYtdGrosz;
  result.healthTier = tier.code;
  result.healthBaseGrosz = tier.baseGrosz;
  result.healthContributionGrosz = tier.contributionGrosz;
  result.totalDueGrosz = result.socialAndFundsDueGrosz + result.healthContributionGrosz;
  result.pitDeductibleWhenPaid.socialInsuranceGrosz = result.socialInsuranceDueGrosz;
  result.audit.appliedHealthThresholdsGrosz = ZUS_RULES.healthTiers
    .map(({ revenueToGrosz }) => revenueToGrosz)
    .filter((value) => value !== null);
  result.audit.accidentRateBasisPoints = rates.accident;
  result.audit.sicknessIncluded = input.sicknessInsurance;
  result.findings.push(finding(
    "ANNUAL_HEALTH_RECONCILIATION_OUT_OF_SCOPE",
    "info",
    "Wynik obejmuje miesięczną składkę zdrowotną; rozliczenie roczne pozostaje poza zakresem.",
    "healthContributionGrosz",
  ));
  result.status = "VERIFIED";
  return result;
}
