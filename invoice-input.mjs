const VAT_CODES = new Set(["23", "8", "5", "0", "ZW", "NP", "MIXED"]);
const INVOICE_TYPES = new Set(["sale", "cost"]);
const DOCUMENT_TYPES = new Set(["invoice", "correction"]);
const DEDUCTION_PERCENTAGES = new Set([0, 50, 100]);

function finding(code, message, path) {
  return { code, severity: "error", message, path };
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function parseMoneyToGrosz(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;

  const text = String(value).trim().replace(/[\s\u00a0]/g, "").replace(",", ".");
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] || "").padEnd(2, "0"));
  const grosz = sign * (whole * 100n + fraction);
  if (grosz > BigInt(Number.MAX_SAFE_INTEGER) || grosz < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(grosz);
}

function normalizedDate(value, path, findings) {
  if (value === null || value === undefined || value === "") return null;
  const date = trimmed(value);
  if (!isIsoDate(date)) findings.push(finding("INVALID_DATE", "Data musi istnieć i mieć format YYYY-MM-DD.", path));
  return date;
}

export function prepareInvoice(input) {
  const findings = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      status: "INVALID",
      value: null,
      findings: [finding("INVALID_INVOICE", "Faktura musi być obiektem.", "invoice")],
    };
  }

  const id = input.id === null || input.id === undefined ? "" : String(input.id).trim();
  const number = trimmed(input.number);
  const contractor = trimmed(input.contractor);
  const type = trimmed(input.type).toLowerCase();
  const documentType = trimmed(input.documentType || "invoice").toLowerCase();
  const currency = trimmed(input.currency || "PLN").toUpperCase();
  const rawVatCode = input.vatCode ?? input.vatRate;
  const vatCode = trimmed(String(rawVatCode ?? "")).toUpperCase();
  const netGrosz = Number.isSafeInteger(input.netGrosz)
    ? input.netGrosz
    : parseMoneyToGrosz(input.net);

  if (!id) findings.push(finding("MISSING_INVOICE_ID", "Brak identyfikatora faktury.", "id"));
  if (!number) findings.push(finding("MISSING_INVOICE_NUMBER", "Podaj numer faktury.", "number"));
  if (!contractor) findings.push(finding("MISSING_CONTRACTOR", "Podaj kontrahenta.", "contractor"));
  if (!INVOICE_TYPES.has(type)) findings.push(finding("INVALID_INVOICE_TYPE", "Typ musi mieć wartość sale albo cost.", "type"));
  if (!DOCUMENT_TYPES.has(documentType)) findings.push(finding("INVALID_DOCUMENT_TYPE", "Nieobsługiwany rodzaj dokumentu.", "documentType"));
  if (netGrosz === null) findings.push(finding("INVALID_NET_AMOUNT", "Kwota netto musi mieć najwyżej dwa miejsca po przecinku.", "net"));
  if (netGrosz !== null && netGrosz < 0 && documentType !== "correction") {
    findings.push(finding("NEGATIVE_NON_CORRECTION", "Ujemna kwota jest dozwolona wyłącznie dla korekty.", "net"));
  }
  if (!VAT_CODES.has(vatCode)) findings.push(finding("INVALID_VAT_CODE", "Nieobsługiwana stawka lub kod VAT.", "vatCode"));
  if (!/^[A-Z]{3}$/.test(currency)) findings.push(finding("INVALID_CURRENCY", "Waluta musi być trzyliterowym kodem, np. PLN.", "currency"));

  const date = normalizedDate(input.date, "date", findings);
  if (!date) findings.push(finding("MISSING_ISSUE_DATE", "Podaj datę wystawienia.", "date"));
  const supplyDate = normalizedDate(input.supplyDate, "supplyDate", findings);
  const taxPointDate = normalizedDate(input.taxPointDate, "taxPointDate", findings);
  const receivedDate = normalizedDate(input.receivedDate, "receivedDate", findings);

  let vatDeductionPercent = null;
  if (input.vatDeductionPercent !== null && input.vatDeductionPercent !== undefined && input.vatDeductionPercent !== "") {
    vatDeductionPercent = Number(input.vatDeductionPercent);
    if (!DEDUCTION_PERCENTAGES.has(vatDeductionPercent)) {
      findings.push(finding("INVALID_VAT_DEDUCTION_PERCENT", "Odliczenie VAT musi wynosić 0, 50 albo 100 procent.", "vatDeductionPercent"));
    }
  }

  const normalized = {
    ...input,
    id,
    number,
    contractor,
    type,
    documentType,
    currency,
    date,
    supplyDate,
    taxPointDate,
    receivedDate,
    netGrosz,
    net: netGrosz === null ? null : netGrosz / 100,
    vatCode,
    vatRate: ["23", "8", "5", "0"].includes(vatCode) ? Number(vatCode) : 0,
    vatDeductionPercent,
    category: type === "sale" ? trimmed(input.category) || null : null,
  };

  return {
    status: findings.length ? "INVALID" : "VALID",
    value: normalized,
    findings,
  };
}
