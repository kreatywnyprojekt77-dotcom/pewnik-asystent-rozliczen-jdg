import { calculateVat } from "./vat-calculator.mjs";
import { createVatInputFromInvoices } from "./vat-adapter.mjs";
import { calculateRyczalt } from "./ryczalt-calculator.mjs";
import { createRyczaltInputFromInvoices } from "./ryczalt-adapter.mjs";
import { calculateZus } from "./zus-calculator.mjs";
import { createZusInputFromInvoices } from "./zus-adapter.mjs";

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const STATUS_RANK = { VERIFIED: 0, REVIEW_REQUIRED: 1, INVALID: 2 };

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function defaultWhenUndefined(value, fallback) {
  return value === undefined ? fallback : value;
}

function safeSum(values) {
  if (!values.every(Number.isSafeInteger)) return null;
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return total <= MAX_SAFE_BIGINT && total >= -MAX_SAFE_BIGINT ? Number(total) : null;
}

function plnToGrosz(value) {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const grosz = BigInt(value) * 100n;
  return grosz <= MAX_SAFE_BIGINT ? Number(grosz) : null;
}

function statusFromResults(results) {
  return results.reduce((status, result) => {
    const nextStatus = Object.hasOwn(STATUS_RANK, result.status) ? result.status : "INVALID";
    return STATUS_RANK[nextStatus] > STATUS_RANK[status] ? nextStatus : status;
  }, "VERIFIED");
}

function componentFindings(area, result) {
  return (Array.isArray(result.findings) ? result.findings : []).map((item) => ({
    area,
    ...item,
  }));
}

function summaryFinding(code, message, path) {
  return {
    area: "SUMMARY",
    code,
    severity: "error",
    message,
    path,
    relatedIds: [],
  };
}

function sortedIds(value) {
  return Array.isArray(value) ? [...new Set(value.map(String))].sort() : [];
}

function sumVatTaxableBase(rows) {
  if (!Array.isArray(rows)) return null;
  return safeSum(rows.map((row) => row && row.taxableBaseGrosz));
}

export function generateMonthlySummary(input) {
  const source = isRecord(input) ? input : {};
  const invoices = source.invoices;
  const vatSettings = isRecord(source.vatSettings) ? source.vatSettings : {};
  const ryczaltSettings = isRecord(source.ryczaltSettings) ? source.ryczaltSettings : {};
  const zusSettings = isRecord(source.zusSettings) ? source.zusSettings : {};

  const vatInput = createVatInputFromInvoices({
    invoices,
    settlementPeriod: source.settlementPeriod,
    openingCarryForwardGrosz: defaultWhenUndefined(vatSettings.openingCarryForwardGrosz, 0),
    excessDecision: { mode: defaultWhenUndefined(vatSettings.excessMode, "CARRY_FORWARD") },
  });
  const vatResult = calculateVat(vatInput);

  const ryczaltInput = createRyczaltInputFromInvoices({
    invoices,
    settlementPeriod: source.settlementPeriod,
    deductionGrosz: defaultWhenUndefined(ryczaltSettings.deductionGrosz, 0),
    ratesPercent: isRecord(ryczaltSettings.ratesPercent) ? ryczaltSettings.ratesPercent : {},
    categoryMetadata: isRecord(ryczaltSettings.categoryMetadata) ? ryczaltSettings.categoryMetadata : {},
  });
  const ryczaltResult = calculateRyczalt(ryczaltInput);

  const zusInput = createZusInputFromInvoices({
    invoices,
    settlementPeriod: source.settlementPeriod,
    healthRevenueDeductionYtdGrosz: defaultWhenUndefined(zusSettings.healthRevenueDeductionYtdGrosz, 0),
    sicknessInsurance: defaultWhenUndefined(zusSettings.sicknessInsurance, true),
  });
  const zusResult = calculateZus(zusInput);

  const findings = [
    ...componentFindings("RYCZALT", ryczaltResult),
    ...componentFindings("VAT", vatResult),
    ...componentFindings("ZUS", zusResult),
  ];
  if (!isRecord(input)) {
    findings.push(summaryFinding("INVALID_SUMMARY_INPUT", "Dane generatora muszą być obiektem.", "input"));
  } else if (!Array.isArray(invoices)) {
    findings.push(summaryFinding("INVALID_INVOICES", "Dokumenty muszą być tablicą.", "invoices"));
  }

  const pitDueGrosz = plnToGrosz(ryczaltResult.taxDuePln);
  const vatDueGrosz = Number.isSafeInteger(vatResult.taxDueGrosz) && vatResult.taxDueGrosz >= 0
    ? vatResult.taxDueGrosz
    : null;
  const zusDueGrosz = Number.isSafeInteger(zusResult.totalDueGrosz) && zusResult.totalDueGrosz >= 0
    ? zusResult.totalDueGrosz
    : null;

  for (const [area, result, dueGrosz] of [
    ["RYCZALT", ryczaltResult, pitDueGrosz],
    ["VAT", vatResult, vatDueGrosz],
    ["ZUS", zusResult, zusDueGrosz],
  ]) {
    if (result.status === "VERIFIED" && dueGrosz === null) {
      findings.push(summaryFinding(
        "MISSING_COMPONENT_AMOUNT",
        `Zweryfikowany wynik ${area} nie zawiera bezpiecznej kwoty do zapłaty.`,
        `components.${area.toLowerCase()}.dueGrosz`,
      ));
    }
  }

  const costNetGrosz = vatResult.status === "INVALID" ? null : sumVatTaxableBase(vatResult.inputRowsByVatCode);
  if (vatResult.status !== "INVALID" && costNetGrosz === null) {
    findings.push(summaryFinding(
      "COST_NET_OUT_OF_RANGE",
      "Łączna wartość netto kosztów przekracza bezpieczny zakres podsumowania.",
      "metrics.costNetGrosz",
    ));
  }

  const componentAmounts = [pitDueGrosz, vatDueGrosz, zusDueGrosz];
  const allAmountsAvailable = componentAmounts.every(Number.isSafeInteger);
  const totalDueGrosz = allAmountsAvailable ? safeSum(componentAmounts) : null;
  if (allAmountsAvailable && totalDueGrosz === null) {
    findings.push(summaryFinding(
      "TOTAL_DUE_OUT_OF_RANGE",
      "Łączna kwota zobowiązań przekracza bezpieczny zakres podsumowania.",
      "payment.totalDueGrosz",
    ));
  }

  const hasSummaryError = findings.some(({ area, severity }) => area === "SUMMARY" && severity === "error");
  const componentStatus = statusFromResults([ryczaltResult, vatResult, zusResult]);
  const status = hasSummaryError ? "INVALID" : componentStatus;
  const amountAvailable = status !== "INVALID" && totalDueGrosz !== null;
  const salesDocumentIds = sortedIds(ryczaltResult.audit && ryczaltResult.audit.inputRevenueIds);
  const costDocumentIds = sortedIds(vatResult.audit && vatResult.audit.appliedInputEntryIds);
  const vatDocumentIds = sortedIds(vatResult.audit && vatResult.audit.includedEntryIds);

  return {
    status,
    settlementPeriod: typeof source.settlementPeriod === "string" ? source.settlementPeriod : null,
    payment: {
      amountAvailable,
      canCreateTransfers: status === "VERIFIED" && amountAvailable,
      totalDueGrosz: amountAvailable ? totalDueGrosz : null,
    },
    components: {
      ryczalt: { status: ryczaltResult.status, dueGrosz: pitDueGrosz, result: ryczaltResult },
      vat: {
        status: vatResult.status,
        dueGrosz: vatDueGrosz,
        excessGrosz: vatResult.excessGrosz,
        carryForwardGrosz: vatResult.carryForwardGrosz,
        refundRequestedGrosz: vatResult.refundRequestedGrosz,
        result: vatResult,
      },
      zus: { status: zusResult.status, dueGrosz: zusDueGrosz, result: zusResult },
    },
    metrics: {
      revenueGrosz: ryczaltResult.revenueTotalGrosz,
      costNetGrosz,
      ryczaltDeductionGrosz: ryczaltResult.deductionTotalGrosz,
      taxableRevenueGrosz: ryczaltResult.taxableBaseBeforeRoundingGrosz,
      outputVatGrosz: vatResult.outputVatGrosz,
      inputVatGrosz: vatResult.inputVatGrosz,
      deductibleInputVatGrosz: vatResult.deductibleInputVatGrosz,
      salesDocumentCount: salesDocumentIds.length,
      costDocumentCount: costDocumentIds.length,
      vatDocumentCount: vatDocumentIds.length,
    },
    findings,
    audit: {
      salesDocumentIds,
      costDocumentIds,
      vatDocumentIds,
      ruleVersions: {
        ryczalt: ryczaltResult.ruleVersion,
        vat: vatResult.ruleVersion,
        zus: zusResult.ruleVersion,
      },
    },
  };
}
