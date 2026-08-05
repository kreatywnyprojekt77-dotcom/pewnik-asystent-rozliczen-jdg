import { VAT_RULE_VERSION } from "./vat-calculator.mjs";

function toGrosz(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.sign(number) * Math.round(Math.abs(number) * 100 + Number.EPSILON) : null;
}

function roundSigned(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

function periodFromDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : null;
}

function normalizedVatCode(invoice) {
  if (typeof invoice.vatCode === "string") return invoice.vatCode.toUpperCase();
  const rate = Number(invoice.vatRate);
  if ([23, 8, 5, 0].includes(rate)) return String(rate);
  return "MIXED";
}

function accountingPeriodDecision(invoice) {
  if (typeof invoice.accountingPeriod === "string") return { period: invoice.accountingPeriod, source: "EXPLICIT" };
  if (invoice.type === "sale") {
    if (invoice.taxPointDate) return { period: periodFromDate(invoice.taxPointDate), source: "TAX_POINT_DATE" };
    if (invoice.supplyDate) return { period: periodFromDate(invoice.supplyDate), source: "SUPPLY_DATE" };
    return { period: periodFromDate(invoice.date), source: "ISSUE_DATE_FALLBACK" };
  }
  if (invoice.receivedDate) return { period: periodFromDate(invoice.receivedDate), source: "RECEIVED_DATE" };
  if (invoice.ksefAcquisitionDate) return { period: periodFromDate(invoice.ksefAcquisitionDate), source: "KSEF_ACQUISITION_DATE" };
  return { period: periodFromDate(invoice.date), source: "ISSUE_DATE_FALLBACK" };
}

function amountRows(invoice) {
  if (Array.isArray(invoice.vatLines) && invoice.vatLines.length > 0) {
    return invoice.vatLines.map((line) => ({
      vatCode: String(line.vatCode).toUpperCase(),
      taxableBaseGrosz: Number.isSafeInteger(line.taxableBaseGrosz) ? line.taxableBaseGrosz : toGrosz(line.net),
      vatAmountGrosz: Number.isSafeInteger(line.vatAmountGrosz) ? line.vatAmountGrosz : toGrosz(line.vat),
      ...(invoice.type === "cost" ? deductionFor(line, invoice) : {}),
    }));
  }
  const vatAmountGrosz = invoice.vatAmount != null
    ? toGrosz(invoice.vatAmount)
    : roundSigned(toGrosz(invoice.net) * Number(invoice.vatRate) / 100);
  const row = {
    vatCode: normalizedVatCode(invoice),
    taxableBaseGrosz: toGrosz(invoice.net),
    vatAmountGrosz,
  };
  if (invoice.type === "cost") Object.assign(row, deductionFor({ vatAmountGrosz }, invoice));
  return [row];
}

function deductionFor(line, invoice) {
  const vatAmountGrosz = Number.isSafeInteger(line.vatAmountGrosz) ? line.vatAmountGrosz : toGrosz(line.vat);
  const hasPercent = invoice.vatDeductionPercent !== null && invoice.vatDeductionPercent !== undefined && invoice.vatDeductionPercent !== "";
  const percent = Number(invoice.vatDeductionPercent);
  if (hasPercent && [0, 50, 100].includes(percent)) {
    return {
      deductibleVatGrosz: roundSigned(vatAmountGrosz * percent / 100),
      deductionDecision: { mode: `PERCENT_${percent}`, confirmed: true },
    };
  }
  if (Number.isSafeInteger(invoice.deductibleVatGrosz)) {
    return {
      deductibleVatGrosz: invoice.deductibleVatGrosz,
      deductionDecision: invoice.deductionDecision || { mode: "AMOUNT", confirmed: true },
    };
  }
  return {
    deductibleVatGrosz: vatAmountGrosz,
    deductionDecision: { mode: "UNCONFIRMED_FULL", confirmed: false },
  };
}

export function createVatInputFromInvoices({
  invoices,
  settlementPeriod,
  openingCarryForwardGrosz = 0,
  excessDecision = { mode: "CARRY_FORWARD" },
}) {
  const entries = (Array.isArray(invoices) ? invoices : [])
    .map((invoice) => ({ invoice, periodDecision: accountingPeriodDecision(invoice) }))
    .filter(({ periodDecision }) => periodDecision.period === settlementPeriod)
    .map(({ invoice, periodDecision }) => ({
      id: String(invoice.id),
      documentNumber: String(invoice.number || ""),
      direction: invoice.type === "sale" ? "output" : "input",
      documentType: invoice.documentType === "correction" || Number(invoice.net) < 0 ? "correction" : "invoice",
      accountingPeriod: settlementPeriod,
      accountingPeriodSource: periodDecision.source,
      currency: invoice.currency || "PLN",
      source: invoice.source || "manual",
      ksefNumber: invoice.ksefNumber || null,
      dates: {
        issueDate: invoice.date || null,
        supplyDate: invoice.supplyDate || null,
        taxPointDate: invoice.taxPointDate || null,
        receivedDate: invoice.receivedDate || invoice.ksefAcquisitionDate || null,
      },
      amounts: amountRows(invoice),
    }));

  return {
    settlementPeriod,
    settlementMode: "monthly",
    taxpayerVatStatus: "active",
    ruleVersion: VAT_RULE_VERSION,
    openingCarryForwardGrosz,
    excessDecision,
    entries,
  };
}
