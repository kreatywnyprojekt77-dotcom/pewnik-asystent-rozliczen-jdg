export const VAT_RULE_VERSION = "PL-VAT-2026.1";

const SUPPORTED_VAT_CODES = new Set(["23", "8", "5", "0", "ZW", "NP", "MIXED"]);
const NUMERIC_RATES = new Map([["23", 23], ["8", 8], ["5", 5], ["0", 0]]);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPeriod(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value);
}

function isDenseArray(value) {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}

function finding(code, severity, message, path, relatedIds = [], details) {
  const result = { code, severity, message, path, relatedIds };
  if (details !== undefined) result.details = details;
  return result;
}

function addFinding(result, code, severity, message, path, relatedIds = [], details) {
  result.findings.push(finding(code, severity, message, path, relatedIds, details));
}

function hasErrors(result) {
  return result.findings.some(({ severity }) => severity === "error");
}

function statusFromFindings(result) {
  if (hasErrors(result)) return "INVALID";
  if (result.findings.some(({ severity }) => severity === "warning")) return "REVIEW_REQUIRED";
  return "VERIFIED";
}

function safeSum(values, result, code, path) {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > MAX_SAFE_BIGINT || total < -MAX_SAFE_BIGINT) {
    addFinding(result, code, "error", "Suma przekracza bezpieczny zakres obliczeń.", path);
    return null;
  }
  return Number(total);
}

function expectedVatGrosz(baseGrosz, rate) {
  const sign = baseGrosz < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(baseGrosz) * rate / 100);
}

function baseResult(input) {
  return {
    status: "INVALID",
    ruleVersion: isRecord(input) && typeof input.ruleVersion === "string" ? input.ruleVersion : null,
    settlementPeriod: isRecord(input) && typeof input.settlementPeriod === "string" ? input.settlementPeriod : null,
    outputVatGrosz: null,
    inputVatGrosz: null,
    deductibleInputVatGrosz: null,
    nonDeductibleInputVatGrosz: null,
    openingCarryForwardGrosz: isRecord(input) && isSafeInteger(input.openingCarryForwardGrosz)
      ? input.openingCarryForwardGrosz
      : null,
    balanceBeforeDispositionGrosz: null,
    taxDueGrosz: null,
    excessGrosz: null,
    carryForwardGrosz: null,
    refundRequestedGrosz: null,
    outputRowsByVatCode: [],
    inputRowsByVatCode: [],
    findings: [],
    audit: {
      includedEntryIds: [],
      appliedOutputEntryIds: [],
      appliedInputEntryIds: [],
      appliedVatCodes: [],
    },
  };
}

function validateTopLevel(input, result) {
  if (!isRecord(input)) {
    addFinding(result, "INVALID_INPUT", "error", "Dane wejściowe muszą być obiektem.", "input");
    return false;
  }
  if (!isPeriod(input.settlementPeriod)) {
    addFinding(result, "INVALID_SETTLEMENT_PERIOD", "error", "Okres musi mieć format YYYY-MM.", "settlementPeriod");
  }
  if (input.settlementMode !== "monthly") {
    addFinding(result, "UNSUPPORTED_SETTLEMENT_MODE", "error", "Obsługiwane jest wyłącznie rozliczenie miesięczne.", "settlementMode");
  }
  if (input.taxpayerVatStatus !== "active") {
    addFinding(result, "UNSUPPORTED_VAT_STATUS", "error", "Kalkulator obsługuje czynnego podatnika VAT.", "taxpayerVatStatus");
  }
  if (input.ruleVersion !== VAT_RULE_VERSION) {
    addFinding(result, "UNSUPPORTED_RULE_VERSION", "error", `Obsługiwana wersja reguł to ${VAT_RULE_VERSION}.`, "ruleVersion");
  }
  if (!isDenseArray(input.entries)) {
    addFinding(result, "INVALID_ENTRIES", "error", "Dokumenty muszą być pełną tablicą bez pustych elementów.", "entries");
  }
  if (!isSafeInteger(input.openingCarryForwardGrosz) || input.openingCarryForwardGrosz < 0) {
    addFinding(result, "INVALID_OPENING_CARRY", "error", "Nadwyżka początkowa musi być nieujemną liczbą całkowitą groszy.", "openingCarryForwardGrosz");
  }
  if (!isRecord(input.excessDecision) || !["CARRY_FORWARD", "REFUND", "MIXED"].includes(input.excessDecision.mode)) {
    addFinding(result, "INVALID_EXCESS_DECISION", "error", "Wymagana jest decyzja o rozliczeniu nadwyżki VAT.", "excessDecision");
  }
  return true;
}

function validateEntries(input, result) {
  const rows = [];
  const ids = new Set();
  if (!Array.isArray(input.entries)) return rows;

  const orderedEntries = input.entries
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .sort((left, right) => {
      const leftId = isRecord(left.entry) && isNonEmptyString(left.entry.id) ? left.entry.id : `~${left.entryIndex}`;
      const rightId = isRecord(right.entry) && isNonEmptyString(right.entry.id) ? right.entry.id : `~${right.entryIndex}`;
      return leftId.localeCompare(rightId);
    });

  orderedEntries.forEach(({ entry, entryIndex }) => {
    const path = isRecord(entry) && isNonEmptyString(entry.id) ? `entries[${entry.id}]` : `entries[${entryIndex}]`;
    if (!isRecord(entry)) {
      addFinding(result, "INVALID_ENTRY", "error", "Dokument musi być obiektem.", path);
      return;
    }
    const relatedIds = isNonEmptyString(entry.id) ? [entry.id] : [];
    if (!isNonEmptyString(entry.id)) {
      addFinding(result, "INVALID_ENTRY_ID", "error", "Identyfikator dokumentu jest wymagany.", `${path}.id`);
    } else if (ids.has(entry.id)) {
      addFinding(result, "DUPLICATE_ENTRY_ID", "error", "Identyfikator dokumentu musi być unikalny.", `${path}.id`, relatedIds);
    } else {
      ids.add(entry.id);
    }
    if (!isNonEmptyString(entry.documentNumber)) {
      addFinding(result, "MISSING_DOCUMENT_NUMBER", "warning", "Brak numeru dokumentu wymaga weryfikacji.", `${path}.documentNumber`, relatedIds);
    }
    if (!["output", "input"].includes(entry.direction)) {
      addFinding(result, "INVALID_DIRECTION", "error", "Kierunek musi mieć wartość output albo input.", `${path}.direction`, relatedIds);
    }
    if (!["invoice", "correction"].includes(entry.documentType)) {
      addFinding(result, "UNSUPPORTED_DOCUMENT_TYPE", "error", "Obsługiwane są faktury i korekty.", `${path}.documentType`, relatedIds);
    }
    if (entry.accountingPeriod !== input.settlementPeriod) {
      addFinding(result, "ENTRY_PERIOD_MISMATCH", "error", "Dokument nie należy do badanego okresu.", `${path}.accountingPeriod`, relatedIds);
    }
    if (entry.accountingPeriodSource === "ISSUE_DATE_FALLBACK") {
      addFinding(result, "FALLBACK_ACCOUNTING_PERIOD", "warning", "Okres VAT ustalono zastępczo z daty wystawienia i wymaga potwierdzenia.", `${path}.accountingPeriodSource`, relatedIds);
    }
    if (entry.currency !== "PLN") {
      addFinding(result, "UNSUPPORTED_CURRENCY", "error", "Wersja 1 obsługuje wyłącznie PLN.", `${path}.currency`, relatedIds);
    }
    if (!isDenseArray(entry.amounts) || entry.amounts.length === 0) {
      addFinding(result, "INVALID_AMOUNT_ROWS", "error", "Dokument musi zawierać co najmniej jeden pełny wiersz VAT.", `${path}.amounts`, relatedIds);
      return;
    }

    entry.amounts.forEach((amount, amountIndex) => {
      const amountPath = `${path}.amounts[${amountIndex}]`;
      if (!isRecord(amount)) {
        addFinding(result, "INVALID_AMOUNT_ROW", "error", "Wiersz VAT musi być obiektem.", amountPath, relatedIds);
        return;
      }
      if (!SUPPORTED_VAT_CODES.has(amount.vatCode)) {
        addFinding(result, "UNSUPPORTED_VAT_CODE", "error", "Nieobsługiwany kod lub stawka VAT.", `${amountPath}.vatCode`, relatedIds);
      }
      if (!isSafeInteger(amount.taxableBaseGrosz) || !isSafeInteger(amount.vatAmountGrosz)) {
        addFinding(result, "INVALID_VAT_AMOUNT", "error", "Podstawa i VAT muszą być liczbami całkowitymi groszy.", amountPath, relatedIds);
        return;
      }
      if (entry.documentType !== "correction" && (amount.taxableBaseGrosz < 0 || amount.vatAmountGrosz < 0)) {
        addFinding(result, "NEGATIVE_NON_CORRECTION", "error", "Ujemne kwoty są dozwolone wyłącznie na korektach.", amountPath, relatedIds);
      }
      if (["ZW", "NP", "0"].includes(amount.vatCode) && amount.vatAmountGrosz !== 0) {
        addFinding(result, "VAT_MUST_BE_ZERO", "error", "Dla kodu 0, ZW lub NP kwota VAT musi wynosić zero.", `${amountPath}.vatAmountGrosz`, relatedIds);
      }
      if (NUMERIC_RATES.has(amount.vatCode)) {
        const expected = expectedVatGrosz(amount.taxableBaseGrosz, NUMERIC_RATES.get(amount.vatCode));
        const difference = Math.abs(expected - amount.vatAmountGrosz);
        if (difference > 1) {
          addFinding(result, "VAT_AMOUNT_MISMATCH", "warning", "Kwota VAT różni się od kontrolnego wyliczenia ze stawki.", amountPath, relatedIds, {
            expectedVatGrosz: expected,
            suppliedVatGrosz: amount.vatAmountGrosz,
            differenceGrosz: difference,
          });
        }
      }
      if (amount.vatCode === "MIXED") {
        addFinding(result, "AGGREGATED_MIXED_RATES", "warning", "Zagregowana faktura wielostawkowa wymaga weryfikacji pozycji.", amountPath, relatedIds);
      }
      if (entry.direction === "input") {
        if (!isSafeInteger(amount.deductibleVatGrosz)) {
          addFinding(result, "MISSING_DEDUCTIBLE_VAT", "error", "Zakup wymaga jawnej kwoty VAT do odliczenia.", `${amountPath}.deductibleVatGrosz`, relatedIds);
        } else {
          const invalidMagnitude = Math.abs(amount.deductibleVatGrosz) > Math.abs(amount.vatAmountGrosz);
          const invalidSign = amount.vatAmountGrosz !== 0 && Math.sign(amount.deductibleVatGrosz) !== Math.sign(amount.vatAmountGrosz) && amount.deductibleVatGrosz !== 0;
          if (invalidMagnitude || invalidSign) {
            addFinding(result, "INVALID_DEDUCTIBLE_VAT", "error", "VAT odliczany musi mieścić się w kwocie VAT dokumentu i mieć zgodny znak.", `${amountPath}.deductibleVatGrosz`, relatedIds);
          }
        }
        if (!isRecord(amount.deductionDecision) || !isNonEmptyString(amount.deductionDecision.mode)) {
          addFinding(result, "MISSING_DEDUCTION_DECISION", "warning", "Brak udokumentowanej decyzji o prawie do odliczenia.", `${amountPath}.deductionDecision`, relatedIds);
        } else if (amount.deductionDecision.mode === "UNCONFIRMED_FULL") {
          addFinding(result, "UNCONFIRMED_FULL_DEDUCTION", "warning", "Pełne odliczenie zostało przyjęte technicznie i wymaga potwierdzenia.", `${amountPath}.deductionDecision`, relatedIds);
        }
      }
      rows.push({ entry, amount });
    });
  });

  result.audit.includedEntryIds = [...ids].sort();
  return rows;
}

function aggregateByVatCode(rows, direction, result) {
  const grouped = new Map();
  for (const { entry, amount } of rows.filter(({ entry }) => entry.direction === direction)) {
    const current = grouped.get(amount.vatCode) || { taxableBaseGrosz: 0, vatAmountGrosz: 0, deductibleVatGrosz: 0, entryIds: new Set() };
    current.taxableBaseGrosz = safeSum([current.taxableBaseGrosz, amount.taxableBaseGrosz], result, "AMOUNT_OUT_OF_RANGE", "entries");
    current.vatAmountGrosz = safeSum([current.vatAmountGrosz, amount.vatAmountGrosz], result, "AMOUNT_OUT_OF_RANGE", "entries");
    if (direction === "input") {
      current.deductibleVatGrosz = safeSum([current.deductibleVatGrosz, amount.deductibleVatGrosz], result, "AMOUNT_OUT_OF_RANGE", "entries");
    }
    current.entryIds.add(entry.id);
    grouped.set(amount.vatCode, current);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([vatCode, value]) => ({
    vatCode,
    taxableBaseGrosz: value.taxableBaseGrosz,
    vatAmountGrosz: value.vatAmountGrosz,
    ...(direction === "input" ? { deductibleVatGrosz: value.deductibleVatGrosz } : {}),
    entryIds: [...value.entryIds].sort(),
  }));
}

function applyExcessDecision(input, result) {
  if (result.excessGrosz === 0) {
    result.carryForwardGrosz = 0;
    result.refundRequestedGrosz = 0;
    return;
  }
  const decision = input.excessDecision;
  if (decision.mode === "CARRY_FORWARD") {
    result.carryForwardGrosz = result.excessGrosz;
    result.refundRequestedGrosz = 0;
  } else if (decision.mode === "REFUND") {
    result.carryForwardGrosz = 0;
    result.refundRequestedGrosz = result.excessGrosz;
    addFinding(result, "REFUND_REQUIRES_REVIEW", "warning", "Wniosek o zwrot wymaga odrębnej weryfikacji warunków i terminu.", "excessDecision");
  } else {
    const carry = decision.carryForwardGrosz;
    const refund = decision.refundRequestedGrosz;
    if (!isSafeInteger(carry) || carry < 0 || !isSafeInteger(refund) || refund < 0 || carry + refund !== result.excessGrosz) {
      addFinding(result, "INVALID_MIXED_EXCESS_DECISION", "error", "Podział nadwyżki musi być nieujemny i równy całej nadwyżce.", "excessDecision");
      return;
    }
    result.carryForwardGrosz = carry;
    result.refundRequestedGrosz = refund;
    if (refund > 0) addFinding(result, "REFUND_REQUIRES_REVIEW", "warning", "Wniosek o zwrot wymaga odrębnej weryfikacji warunków i terminu.", "excessDecision");
  }
}

export function calculateVat(input) {
  const result = baseResult(input);
  if (!validateTopLevel(input, result)) return result;
  const rows = validateEntries(input, result);
  if (hasErrors(result)) return result;

  result.outputRowsByVatCode = aggregateByVatCode(rows, "output", result);
  result.inputRowsByVatCode = aggregateByVatCode(rows, "input", result);
  if (hasErrors(result)) return result;

  result.outputVatGrosz = safeSum(result.outputRowsByVatCode.map((row) => row.vatAmountGrosz), result, "OUTPUT_VAT_OUT_OF_RANGE", "entries");
  result.inputVatGrosz = safeSum(result.inputRowsByVatCode.map((row) => row.vatAmountGrosz), result, "INPUT_VAT_OUT_OF_RANGE", "entries");
  result.deductibleInputVatGrosz = safeSum(result.inputRowsByVatCode.map((row) => row.deductibleVatGrosz), result, "DEDUCTIBLE_VAT_OUT_OF_RANGE", "entries");
  if (hasErrors(result)) return result;
  result.nonDeductibleInputVatGrosz = result.inputVatGrosz - result.deductibleInputVatGrosz;
  result.balanceBeforeDispositionGrosz = safeSum([
    result.outputVatGrosz,
    -result.deductibleInputVatGrosz,
    -input.openingCarryForwardGrosz,
  ], result, "VAT_BALANCE_OUT_OF_RANGE", "entries");
  if (hasErrors(result)) return result;

  result.taxDueGrosz = Math.max(0, result.balanceBeforeDispositionGrosz);
  result.excessGrosz = Math.max(0, -result.balanceBeforeDispositionGrosz);
  applyExcessDecision(input, result);
  result.audit.appliedOutputEntryIds = [...new Set(rows.filter(({ entry }) => entry.direction === "output").map(({ entry }) => entry.id))].sort();
  result.audit.appliedInputEntryIds = [...new Set(rows.filter(({ entry }) => entry.direction === "input").map(({ entry }) => entry.id))].sort();
  result.audit.appliedVatCodes = [...new Set(rows.map(({ amount }) => amount.vatCode))].sort();
  result.status = statusFromFindings(result);
  return result;
}
