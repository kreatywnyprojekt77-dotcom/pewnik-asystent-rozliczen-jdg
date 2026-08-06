export const DECLARATION_SCHEMA_VERSIONS = Object.freeze({
  ryczalt: "PEWNIK-RYCZALT-MIESIECZNY-2026.1",
  jpk: "JPK_V7M-3-1-0E",
  zus: "ZUS-DRA-KEDU-2.27-DRAFT",
});

const NUMERIC_VAT_CODES = new Set(["23", "8", "5", "0"]);
const JPK_SALES_FIELDS = {
  "23": ["K_19", "K_20"],
  "8": ["K_17", "K_18"],
  "5": ["K_15", "K_16"],
  "0": ["K_13", null],
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function digits(value) {
  return text(value).replace(/\D/g, "");
}

function moneyGrosz(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function pln(grosz) {
  return Number.isSafeInteger(grosz) ? (grosz / 100).toFixed(2) : "0.00";
}

function roundedPln(grosz) {
  if (!Number.isSafeInteger(grosz)) return 0;
  return Math.sign(grosz) * Math.round(Math.abs(grosz) / 100);
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  })[character]);
}

function xmlElement(name, value, indent = "      ") {
  if (value === null || value === undefined || value === "") return "";
  return `${indent}<${name}>${escapeXml(value)}</${name}>`;
}

function finding(code, message, path, severity = "error") {
  return { code, severity, message, path };
}

function statusFor(findings, calculationStatus) {
  if (calculationStatus === "INVALID" || findings.some((item) => item.severity === "error")) return "BLOCKED";
  if (calculationStatus === "REVIEW_REQUIRED" || findings.some((item) => item.severity === "warning")) return "REVIEW_REQUIRED";
  return "READY";
}

function validPeriod(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function nipChecksumValid(value) {
  const nip = digits(value);
  if (!/^\d{10}$/.test(nip) || /^0{10}$/.test(nip)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const checksum = weights.reduce((sum, weight, index) => sum + weight * Number(nip[index]), 0) % 11;
  return checksum !== 10 && checksum === Number(nip[9]);
}

function peselShapeValid(value) {
  const pesel = digits(value);
  if (!/^\d{11}$/.test(pesel) || /^0{11}$/.test(pesel)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const checksum = (10 - (weights.reduce((sum, weight, index) => sum + weight * Number(pesel[index]), 0) % 10)) % 10;
  return checksum === Number(pesel[10]);
}

function entriesForPeriod(invoices, period) {
  return (Array.isArray(invoices) ? invoices : []).filter((invoice) => {
    const effectiveDate = invoice.type === "sale"
      ? (invoice.taxPointDate || invoice.supplyDate || invoice.date)
      : (invoice.receivedDate || invoice.ksefAcquisitionDate || invoice.date);
    return typeof effectiveDate === "string" && effectiveDate.slice(0, 7) === period;
  });
}

function invoiceVatRows(invoice) {
  if (Array.isArray(invoice.vatLines) && invoice.vatLines.length) {
    return invoice.vatLines.map((row) => ({
      vatCode: String(row.vatCode || "").toUpperCase(),
      netGrosz: Number.isSafeInteger(row.taxableBaseGrosz) ? row.taxableBaseGrosz : Math.round(Number(row.net) * 100),
      vatGrosz: Number.isSafeInteger(row.vatAmountGrosz) ? row.vatAmountGrosz : Math.round(Number(row.vat) * 100),
      deductibleVatGrosz: Number.isSafeInteger(row.deductibleVatGrosz)
        ? row.deductibleVatGrosz
        : null,
    }));
  }
  const netGrosz = Number.isSafeInteger(invoice.netGrosz) ? invoice.netGrosz : Math.round(Number(invoice.net) * 100);
  const vatCode = String(invoice.vatCode ?? invoice.vatRate ?? "").toUpperCase();
  const vatGrosz = invoice.vatAmount != null
    ? Math.round(Number(invoice.vatAmount) * 100)
    : Math.round(netGrosz * Number(invoice.vatRate || 0) / 100);
  const deductionPercent = Number(invoice.vatDeductionPercent);
  return [{
    vatCode,
    netGrosz,
    vatGrosz,
    deductibleVatGrosz: invoice.type === "cost" && [0, 50, 100].includes(deductionPercent)
      ? Math.round(vatGrosz * deductionPercent / 100)
      : invoice.deductibleVatGrosz,
  }];
}

function jpkProfileFindings(company, profile) {
  const findings = [];
  if (!nipChecksumValid(company.nip)) findings.push(finding("INVALID_NIP", "Wpisz prawidłowy NIP podatnika.", "company.nip"));
  if (!text(profile.firstName)) findings.push(finding("MISSING_FIRST_NAME", "Uzupełnij imię właścicielki działalności.", "declarationProfile.firstName"));
  if (!text(profile.lastName)) findings.push(finding("MISSING_LAST_NAME", "Uzupełnij nazwisko właścicielki działalności.", "declarationProfile.lastName"));
  if (!validDate(profile.birthDate)) findings.push(finding("MISSING_BIRTH_DATE", "Uzupełnij datę urodzenia.", "declarationProfile.birthDate"));
  if (!/^\d{4}$/.test(text(profile.taxOfficeCode))) findings.push(finding("INVALID_TAX_OFFICE", "Wpisz czterocyfrowy kod urzędu skarbowego.", "declarationProfile.taxOfficeCode"));
  return findings;
}

function jpkInvoiceFindings(invoices) {
  const findings = [];
  for (const invoice of invoices) {
    const id = String(invoice.id ?? invoice.number ?? "?");
    if (!text(invoice.number)) findings.push(finding("MISSING_DOCUMENT_NUMBER", "Dokument nie ma numeru.", `invoices.${id}.number`));
    if (!text(invoice.contractor)) findings.push(finding("MISSING_CONTRACTOR", "Dokument nie ma nazwy kontrahenta.", `invoices.${id}.contractor`));
    const contractorTaxId = digits(invoice.contractorNip) || text(invoice.counterpartyTaxId);
    if (!contractorTaxId) {
      findings.push(finding("MISSING_CONTRACTOR_TAX_ID", `Uzupełnij NIP kontrahenta przy dokumencie ${invoice.number || id}.`, `invoices.${id}.contractorNip`));
    } else if (!/^\d{10}$/.test(contractorTaxId)) {
      findings.push(finding("INVALID_CONTRACTOR_TAX_ID", `NIP kontrahenta przy dokumencie ${invoice.number || id} musi mieć 10 cyfr.`, `invoices.${id}.contractorNip`));
    }
    for (const row of invoiceVatRows(invoice)) {
      if (!NUMERIC_VAT_CODES.has(row.vatCode)) {
        findings.push(finding("UNSUPPORTED_JPK_VAT_CODE", `Kod VAT ${row.vatCode || "brak"} przy dokumencie ${invoice.number || id} wymaga ręcznej obsługi.`, `invoices.${id}.vatCode`));
      }
      if (!Number.isSafeInteger(row.netGrosz) || !Number.isSafeInteger(row.vatGrosz)) {
        findings.push(finding("INVALID_JPK_AMOUNT", `Dokument ${invoice.number || id} ma nieprawidłowe kwoty.`, `invoices.${id}`));
      }
      if (invoice.type === "cost" && !Number.isSafeInteger(row.deductibleVatGrosz)) {
        findings.push(finding("MISSING_JPK_DEDUCTION", `Potwierdź odliczenie VAT przy dokumencie ${invoice.number || id}.`, `invoices.${id}.vatDeductionPercent`));
      }
    }
  }
  return findings;
}

function buildRyczaltDocument(summary, period) {
  const result = summary?.components?.ryczalt?.result || {};
  const findings = [];
  if (!validPeriod(period)) findings.push(finding("INVALID_PERIOD", "Nieprawidłowy okres rozliczenia.", "period"));
  const rows = Array.isArray(result.rateRows) ? result.rateRows.map((row) => ({
    label: `${Number(row.rateBasisPoints) / 100}%`,
    baseGrosz: moneyGrosz(row.baseBeforeRoundingGrosz ?? row.taxableBaseBeforeRoundingGrosz) ?? 0,
    roundedBasePln: row.roundedBasePln ?? row.taxableBaseRoundedPln ?? 0,
  })) : [];
  return {
    kind: "RYCZALT",
    title: "Miesięczne rozliczenie ryczałtu",
    schemaVersion: DECLARATION_SCHEMA_VERSIONS.ryczalt,
    period,
    status: statusFor(findings, result.status),
    findings,
    amountDueGrosz: summary?.components?.ryczalt?.dueGrosz ?? null,
    rows,
    ruleVersion: result.ruleVersion || null,
  };
}

function buildJpkDocument(company, profile, invoices, summary, period) {
  const periodInvoices = entriesForPeriod(invoices, period);
  const result = summary?.components?.vat?.result || {};
  const findings = [...jpkProfileFindings(company, profile), ...jpkInvoiceFindings(periodInvoices)];
  const salesRows = periodInvoices.filter((invoice) => invoice.type === "sale").map((invoice, index) => ({
    index: index + 1,
    invoice,
    vatRows: invoiceVatRows(invoice),
  }));
  const purchaseRows = periodInvoices.filter((invoice) => invoice.type === "cost").map((invoice, index) => ({
    index: index + 1,
    invoice,
    vatRows: invoiceVatRows(invoice),
  }));
  return {
    kind: "JPK_V7M",
    title: "JPK_V7M — ewidencja i deklaracja VAT",
    schemaVersion: DECLARATION_SCHEMA_VERSIONS.jpk,
    officialSchemaUrl: "https://crd.gov.pl/wzor/2025/12/19/14090/schemat.xsd",
    formVariant: 3,
    vatFormVariant: 23,
    period,
    status: statusFor(findings, result.status),
    findings,
    company: { ...company, nip: digits(company.nip) },
    profile: { ...profile },
    salesRows,
    purchaseRows,
    outputVatGrosz: result.outputVatGrosz ?? null,
    deductibleInputVatGrosz: result.deductibleInputVatGrosz ?? null,
    taxDueGrosz: result.taxDueGrosz ?? null,
    excessGrosz: result.excessGrosz ?? null,
    carryForwardGrosz: result.carryForwardGrosz ?? null,
    ruleVersion: result.ruleVersion || null,
  };
}

function buildZusDocument(company, profile, summary, period) {
  const result = summary?.components?.zus?.result || {};
  const findings = [];
  if (!nipChecksumValid(company.nip)) findings.push(finding("INVALID_NIP", "Wpisz prawidłowy NIP płatnika.", "company.nip"));
  if (!peselShapeValid(profile.pesel)) findings.push(finding("INVALID_PESEL", "Wpisz prawidłowy PESEL właścicielki.", "declarationProfile.pesel"));
  if (!/^\d{9}$/.test(digits(profile.regon))) findings.push(finding("INVALID_REGON", "Wpisz dziewięciocyfrowy REGON.", "declarationProfile.regon"));
  if (!/^\d{6}$/.test(digits(profile.zusInsuranceTitleCode))) findings.push(finding("INVALID_ZUS_TITLE_CODE", "Wpisz sześciocyfrowy kod tytułu ubezpieczenia.", "declarationProfile.zusInsuranceTitleCode"));
  findings.push(finding(
    "KEDU_ACCEPTANCE_REQUIRED",
    "Eksport KEDU pozostaje wersją techniczną do czasu przejścia testów oprogramowania interfejsowego ZUS.",
    "zus.kedu",
    "warning",
  ));
  return {
    kind: "ZUS_DRA",
    title: "ZUS DRA — deklaracja rozliczeniowa",
    schemaVersion: DECLARATION_SCHEMA_VERSIONS.zus,
    period,
    status: statusFor(findings, result.status),
    findings,
    company: { ...company, nip: digits(company.nip) },
    profile: { ...profile, pesel: digits(profile.pesel), regon: digits(profile.regon), zusInsuranceTitleCode: digits(profile.zusInsuranceTitleCode) },
    socialBaseGrosz: result.socialBaseGrosz ?? null,
    socialRows: Array.isArray(result.socialRows) ? result.socialRows : [],
    socialInsuranceDueGrosz: result.socialInsuranceDueGrosz ?? null,
    labourFundsDueGrosz: result.labourFundsDueGrosz ?? null,
    healthRevenueYtdGrosz: result.healthRevenueYtdGrosz ?? null,
    healthContributionGrosz: result.healthContributionGrosz ?? null,
    totalDueGrosz: result.totalDueGrosz ?? null,
    ruleVersion: result.ruleVersion || null,
  };
}

export function createDeclarationBundle({ company = {}, declarationProfile = {}, invoices = [], summary = {}, period }) {
  const normalizedPeriod = validPeriod(period) ? period : "";
  return {
    period: normalizedPeriod,
    createdAt: new Date().toISOString(),
    documents: {
      ryczalt: buildRyczaltDocument(summary, normalizedPeriod),
      jpk: buildJpkDocument(company, declarationProfile, invoices, summary, normalizedPeriod),
      zus: buildZusDocument(company, declarationProfile, summary, normalizedPeriod),
    },
    audit: {
      invoiceIds: entriesForPeriod(invoices, normalizedPeriod).map((invoice) => String(invoice.id)).sort(),
      ruleVersions: summary?.audit?.ruleVersions || {},
    },
  };
}

function jpkSalesXml(row) {
  const invoice = row.invoice;
  const amountFields = [];
  for (const amount of row.vatRows) {
    const fields = JPK_SALES_FIELDS[amount.vatCode];
    if (!fields) continue;
    amountFields.push(xmlElement(fields[0], pln(amount.netGrosz)));
    if (fields[1]) amountFields.push(xmlElement(fields[1], pln(amount.vatGrosz)));
  }
  return [
    "    <SprzedazWiersz>",
    xmlElement("LpSprzedazy", row.index),
    xmlElement("KodKrajuNadaniaTIN", "PL"),
    xmlElement("NrKontrahenta", digits(invoice.contractorNip) || text(invoice.counterpartyTaxId)),
    xmlElement("NazwaKontrahenta", text(invoice.contractor)),
    xmlElement("DowodSprzedazy", text(invoice.number)),
    xmlElement("DataWystawienia", invoice.date),
    xmlElement("DataSprzedazy", invoice.supplyDate || invoice.taxPointDate || invoice.date),
    invoice.ksefNumber ? xmlElement("NrKSeF", invoice.ksefNumber) : xmlElement("OFF", 1),
    ...amountFields,
    "    </SprzedazWiersz>",
  ].filter(Boolean).join("\n");
}

function jpkPurchaseXml(row) {
  const invoice = row.invoice;
  const net = row.vatRows.reduce((sum, amount) => sum + amount.netGrosz, 0);
  const deductibleVat = row.vatRows.reduce((sum, amount) => sum + amount.deductibleVatGrosz, 0);
  return [
    "    <ZakupWiersz>",
    xmlElement("LpZakupu", row.index),
    xmlElement("KodKrajuNadaniaTIN", "PL"),
    xmlElement("NrDostawcy", digits(invoice.contractorNip) || text(invoice.counterpartyTaxId)),
    xmlElement("NazwaDostawcy", text(invoice.contractor)),
    xmlElement("DowodZakupu", text(invoice.number)),
    xmlElement("DataZakupu", invoice.date),
    xmlElement("DataWplywu", invoice.receivedDate || invoice.ksefAcquisitionDate || invoice.date),
    invoice.ksefNumber ? xmlElement("NrKSeF", invoice.ksefNumber) : xmlElement("OFF", 1),
    xmlElement("K_42", pln(net)),
    xmlElement("K_43", pln(deductibleVat)),
    "    </ZakupWiersz>",
  ].filter(Boolean).join("\n");
}

function sumVatRows(rows, key) {
  return rows.reduce((total, row) => total + row.vatRows.reduce((rowTotal, amount) => rowTotal + (amount[key] || 0), 0), 0);
}

export function generateJpkV7mXml(document, generatedAt = new Date().toISOString()) {
  if (!isRecord(document) || document.kind !== "JPK_V7M") throw new TypeError("Nieprawidłowy dokument JPK_V7M.");
  if (document.status !== "READY") throw new Error("JPK_V7M nie jest jeszcze gotowy do eksportu XML. Sprawdź wszystkie ostrzeżenia.");
  if (document.officialSchemaUrl !== "https://crd.gov.pl/wzor/2025/12/19/14090/schemat.xsd" || document.formVariant !== 3) {
    throw new Error("Nieobsługiwana wersja schematu JPK_V7M.");
  }
  const [year, month] = document.period.split("-");
  const salesNetByCode = Object.fromEntries(Object.keys(JPK_SALES_FIELDS).map((code) => [code, 0]));
  const salesVatByCode = Object.fromEntries(Object.keys(JPK_SALES_FIELDS).map((code) => [code, 0]));
  for (const row of document.salesRows) for (const amount of row.vatRows) {
    salesNetByCode[amount.vatCode] = (salesNetByCode[amount.vatCode] || 0) + amount.netGrosz;
    salesVatByCode[amount.vatCode] = (salesVatByCode[amount.vatCode] || 0) + amount.vatGrosz;
  }
  const purchaseNet = sumVatRows(document.purchaseRows, "netGrosz");
  const purchaseVat = sumVatRows(document.purchaseRows, "deductibleVatGrosz");
  const duePln = roundedPln(document.taxDueGrosz);
  const excessPln = roundedPln(document.excessGrosz);
  const declarationFields = [
    ["P_13", roundedPln(salesNetByCode["0"])], ["P_15", roundedPln(salesNetByCode["5"])], ["P_16", roundedPln(salesVatByCode["5"])],
    ["P_17", roundedPln(salesNetByCode["8"])], ["P_18", roundedPln(salesVatByCode["8"])], ["P_19", roundedPln(salesNetByCode["23"])], ["P_20", roundedPln(salesVatByCode["23"])],
    ["P_37", roundedPln(document.outputVatGrosz)], ["P_38", 0], ["P_39", 0], ["P_40", 0], ["P_41", 0],
    ["P_42", roundedPln(purchaseNet)], ["P_43", roundedPln(purchaseVat)], ["P_44", 0], ["P_45", 0], ["P_46", 0], ["P_47", roundedPln(purchaseVat)], ["P_48", roundedPln(purchaseVat)],
    ["P_51", duePln], ["P_53", excessPln], ["P_62", roundedPln(document.carryForwardGrosz)], ["P_68", 0], ["P_69", 0],
  ];
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<JPK xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://crd.gov.pl/wzor/2025/12/19/14090/">',
    "  <Naglowek>",
    '    <KodFormularza kodSystemowy="JPK_V7M (3)" wersjaSchemy="1-0E">JPK_VAT</KodFormularza>',
    "    <WariantFormularza>3</WariantFormularza>",
    xmlElement("DataWytworzeniaJPK", generatedAt, "    "),
    xmlElement("NazwaSystemu", "Pewnik", "    "),
    '    <CelZlozenia poz="P_7">1</CelZlozenia>',
    xmlElement("KodUrzedu", document.profile.taxOfficeCode, "    "),
    xmlElement("Rok", year, "    "),
    xmlElement("Miesiac", Number(month), "    "),
    "  </Naglowek>",
    '  <Podmiot1 rola="Podatnik">',
    "    <OsobaFizyczna>",
    xmlElement("etd:NIP", document.company.nip),
    xmlElement("etd:ImiePierwsze", document.profile.firstName),
    xmlElement("etd:Nazwisko", document.profile.lastName),
    xmlElement("etd:DataUrodzenia", document.profile.birthDate),
    xmlElement("Email", document.profile.email),
    xmlElement("Telefon", digits(document.profile.phone)),
    "    </OsobaFizyczna>",
    "  </Podmiot1>",
    "  <Deklaracja>",
    "    <Naglowek>",
    '      <KodFormularzaDekl kodSystemowy="VAT-7 (23)" kodPodatku="VAT" rodzajZobowiazania="Z" wersjaSchemy="1-0E">VAT-7</KodFormularzaDekl>',
    "      <WariantFormularzaDekl>23</WariantFormularzaDekl>",
    "    </Naglowek>",
    "    <PozycjeSzczegolowe>",
    ...declarationFields.filter(([name, value]) => value !== 0 || ["P_37", "P_38", "P_39", "P_40", "P_41", "P_42", "P_43", "P_44", "P_45", "P_46", "P_47", "P_48", "P_51", "P_53", "P_62", "P_68", "P_69"].includes(name)).map(([name, value]) => xmlElement(name, value, "      ")),
    "    </PozycjeSzczegolowe>",
    "    <Pouczenia>1</Pouczenia>",
    "  </Deklaracja>",
    "  <Ewidencja>",
    ...document.salesRows.map(jpkSalesXml),
    "    <SprzedazCtrl>",
    xmlElement("LiczbaWierszySprzedazy", document.salesRows.length),
    xmlElement("PodatekNalezny", pln(sumVatRows(document.salesRows, "vatGrosz"))),
    "    </SprzedazCtrl>",
    ...document.purchaseRows.map(jpkPurchaseXml),
    "    <ZakupCtrl>",
    xmlElement("LiczbaWierszyZakupow", document.purchaseRows.length),
    xmlElement("PodatekNaliczony", pln(sumVatRows(document.purchaseRows, "deductibleVatGrosz"))),
    "    </ZakupCtrl>",
    "  </Ewidencja>",
    "</JPK>",
  ];
  return lines.filter(Boolean).join("\n");
}

export function generateZusDraKeduDraftXml(document) {
  if (!isRecord(document) || document.kind !== "ZUS_DRA") throw new TypeError("Nieprawidłowy dokument ZUS DRA.");
  if (document.status === "BLOCKED") throw new Error("ZUS DRA zawiera braki blokujące eksport.");
  const [year, month] = document.period.split("-");
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<KEDU wersja_schematu="2.27" status="WERSJA_TECHNICZNA_DO_TESTOW_ZUS">',
    '  <deklaracja typ="ZUS_DRA">',
    xmlElement("identyfikator", `01${month}${year}`, "    "),
    xmlElement("nip", document.company.nip, "    "),
    xmlElement("regon", document.profile.regon, "    "),
    xmlElement("pesel", document.profile.pesel, "    "),
    xmlElement("kod_tytulu_ubezpieczenia", document.profile.zusInsuranceTitleCode, "    "),
    xmlElement("podstawa_spoleczne", pln(document.socialBaseGrosz), "    "),
    xmlElement("skladki_spoleczne", pln(document.socialInsuranceDueGrosz), "    "),
    xmlElement("fundusz_pracy", pln(document.labourFundsDueGrosz), "    "),
    xmlElement("przychod_zdrowotna_narastajaco", pln(document.healthRevenueYtdGrosz), "    "),
    xmlElement("skladka_zdrowotna", pln(document.healthContributionGrosz), "    "),
    xmlElement("razem", pln(document.totalDueGrosz), "    "),
    "  </deklaracja>",
    "</KEDU>",
  ].join("\n");
}
