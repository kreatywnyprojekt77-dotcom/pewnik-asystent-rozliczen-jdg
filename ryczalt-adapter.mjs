import { parseMoneyToGrosz } from "./invoice-input.mjs";

export const RYCZALT_RULE_VERSION = "PL-RYCZALT-2026.1";

const CATEGORY_NAMES = {
  software: "Usługi programistyczne",
  consulting: "Usługi konsultingowe",
};

function periodFromDate(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])(?:-|$)/.test(value)
    ? value.slice(0, 7)
    : null;
}

function revenuePeriod(invoice) {
  if (typeof invoice.revenuePeriod === "string") return invoice.revenuePeriod;
  return periodFromDate(invoice.date);
}

function toGrosz(value) {
  return parseMoneyToGrosz(value);
}

function toBasisPoints(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const basisPoints = Math.round(number * 100);
  return Number.isSafeInteger(basisPoints) ? basisPoints : null;
}

function categoryContract(id, ratePercent, metadata = {}) {
  return {
    id,
    name: metadata.name || CATEGORY_NAMES[id] || id,
    pkwiu: metadata.pkwiu || "",
    rateBasisPoints: toBasisPoints(ratePercent),
    validFrom: metadata.validFrom || "",
    validTo: metadata.validTo || "",
    legalBasis: metadata.legalBasis || "",
    decision: metadata.decision || null,
  };
}

export function createRyczaltInputFromInvoices({
  invoices,
  settlementPeriod,
  deductionGrosz = 0,
  ratesPercent = {},
  categoryMetadata = {},
}) {
  const sourceInvoices = Array.isArray(invoices) ? invoices : [];
  const categoryIds = Object.keys(ratesPercent).sort();
  const categoryIdSet = new Set(categoryIds);
  const settlementYear = typeof settlementPeriod === "string" ? settlementPeriod.slice(0, 4) : "";
  const yearToDateRevenueByCategory = Object.fromEntries(categoryIds.map((id) => [id, 0]));

  const salesWithPeriod = sourceInvoices
    .filter((invoice) => invoice && invoice.type === "sale")
    .map((invoice) => ({ invoice, period: revenuePeriod(invoice) }));

  for (const { invoice, period } of salesWithPeriod) {
    if (
      period &&
      period.slice(0, 4) === settlementYear &&
      period <= settlementPeriod &&
      categoryIdSet.has(invoice.category)
    ) {
      const amountGrosz = Number.isSafeInteger(invoice.netGrosz) ? invoice.netGrosz : toGrosz(invoice.net);
      yearToDateRevenueByCategory[invoice.category] = Number.isSafeInteger(amountGrosz)
        ? yearToDateRevenueByCategory[invoice.category] + amountGrosz
        : Number.NaN;
    }
  }

  const revenues = salesWithPeriod
    .filter(({ period }) => period === settlementPeriod)
    .map(({ invoice, period }) => ({
      id: String(invoice.id ?? ""),
      period,
      amountGrosz: Number.isSafeInteger(invoice.netGrosz) ? invoice.netGrosz : toGrosz(invoice.net),
      categoryId: typeof invoice.category === "string" ? invoice.category : "",
    }));

  return {
    settlementPeriod,
    settlementMode: "monthly",
    revenues,
    yearToDateRevenueByCategory,
    categories: categoryIds.map((id) => categoryContract(id, ratesPercent[id], categoryMetadata[id])),
    deductionGrosz,
    ruleVersion: RYCZALT_RULE_VERSION,
  };
}
