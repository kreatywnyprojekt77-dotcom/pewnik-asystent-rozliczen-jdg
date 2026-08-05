import { parseMoneyToGrosz } from "./invoice-input.mjs";
import { ZUS_RULE_VERSION } from "./zus-rules.mjs";

function periodFromInvoice(invoice) {
  const value = invoice && (invoice.revenuePeriod || invoice.date);
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])(?:-|$)/.test(value)
    ? value.slice(0, 7)
    : null;
}

function revenueGrosz(invoice) {
  if (Number.isSafeInteger(invoice.healthRevenueGrosz)) return invoice.healthRevenueGrosz;
  if (Number.isSafeInteger(invoice.netGrosz)) return invoice.netGrosz;
  return parseMoneyToGrosz(invoice.net);
}

export function createZusInputFromInvoices({
  invoices,
  settlementPeriod,
  healthRevenueDeductionYtdGrosz = 0,
  sicknessInsurance = true,
}) {
  const source = Array.isArray(invoices) ? invoices : [];
  const year = typeof settlementPeriod === "string" ? settlementPeriod.slice(0, 4) : "";
  let grossHealthRevenueYtdGrosz = 0;

  for (const invoice of source) {
    if (!invoice || invoice.type !== "sale" || invoice.excludedFromHealthRevenue === true) continue;
    const period = periodFromInvoice(invoice);
    if (!period || period.slice(0, 4) !== year || period > settlementPeriod) continue;
    const amount = revenueGrosz(invoice);
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(grossHealthRevenueYtdGrosz + amount)) {
      grossHealthRevenueYtdGrosz = Number.NaN;
      break;
    }
    grossHealthRevenueYtdGrosz += amount;
  }

  const deduction = Number.isSafeInteger(healthRevenueDeductionYtdGrosz) && healthRevenueDeductionYtdGrosz >= 0
    ? healthRevenueDeductionYtdGrosz
    : Number.NaN;
  const healthRevenueYtdGrosz = Number.isSafeInteger(grossHealthRevenueYtdGrosz) && Number.isSafeInteger(deduction)
    ? Math.max(0, grossHealthRevenueYtdGrosz - deduction)
    : Number.NaN;

  return {
    settlementPeriod,
    ruleVersion: ZUS_RULE_VERSION,
    taxationForm: "RYCZALT",
    scheme: "STANDARD",
    activeFullMonth: true,
    socialBaseMode: "MINIMUM",
    sicknessInsurance,
    labourFundsApplicable: true,
    accidentRateBasisPoints: 167,
    healthCalculationMethod: "CURRENT_YEAR_YTD",
    healthRevenueYtdGrosz,
  };
}
