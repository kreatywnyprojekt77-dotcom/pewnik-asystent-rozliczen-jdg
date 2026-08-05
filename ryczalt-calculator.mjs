const RULE_VERSION = "PL-RYCZALT-2026.1";
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPeriod(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toSafeNumber(value) {
  return value <= MAX_SAFE_BIGINT ? Number(value) : null;
}

function roundGroszToPln(grosz) {
  const wholePln = Math.trunc(grosz / 100);
  const remainderGrosz = grosz % 100;
  return wholePln + (remainderGrosz >= 50 ? 1 : 0);
}

function roundExactUnitsToPln(units) {
  const wholePln = units / 10000n;
  const remainderUnits = units % 10000n;
  return wholePln + (remainderUnits >= 5000n ? 1n : 0n);
}

function baseResult(input) {
  return {
    status: "INVALID",
    ruleVersion: isRecord(input) && typeof input.ruleVersion === "string" ? input.ruleVersion : null,
    settlementPeriod:
      isRecord(input) && typeof input.settlementPeriod === "string"
        ? input.settlementPeriod
        : null,
    revenueTotalGrosz: null,
    deductionTotalGrosz:
      isRecord(input) && isSafeNonNegativeInteger(input.deductionGrosz)
        ? input.deductionGrosz
        : null,
    taxableBaseBeforeRoundingGrosz: null,
    taxBeforeFinalRounding: {
      units: null,
      unitScale: 10000,
      currency: "PLN",
    },
    taxDuePln: null,
    categoryRows: [],
    rateRows: [],
    findings: [],
    audit: {
      inputRevenueIds: [],
      appliedCategoryIds: [],
      appliedRatesBasisPoints: [],
    },
  };
}

function finding(code, severity, message, path, relatedIds = [], details) {
  const value = { code, severity, message, path, relatedIds };
  if (details !== undefined) value.details = details;
  return value;
}

function addError(result, code, message, path, relatedIds = []) {
  result.findings.push(finding(code, "error", message, path, relatedIds));
}

function addWarning(result, code, message, path, relatedIds = [], details) {
  result.findings.push(finding(code, "warning", message, path, relatedIds, details));
}

function addInfo(result, code, message, path, relatedIds = []) {
  result.findings.push(finding(code, "info", message, path, relatedIds));
}

function hasErrors(result) {
  return result.findings.some(({ severity }) => severity === "error");
}

function statusFromFindings(result) {
  if (hasErrors(result)) return "INVALID";
  if (result.findings.some(({ severity }) => severity === "warning")) {
    return "REVIEW_REQUIRED";
  }
  return "VERIFIED";
}

function validateTopLevel(input, result) {
  if (!isRecord(input)) {
    addError(result, "INVALID_INPUT", "Dane wejściowe muszą być obiektem.", "input");
    return false;
  }

  if (!isPeriod(input.settlementPeriod)) {
    addError(
      result,
      "INVALID_SETTLEMENT_PERIOD",
      "Okres rozliczeniowy musi mieć format YYYY-MM.",
      "settlementPeriod",
    );
  }
  if (input.settlementMode !== "monthly") {
    addError(
      result,
      "UNSUPPORTED_SETTLEMENT_MODE",
      "Obsługiwany jest wyłącznie miesięczny tryb rozliczenia.",
      "settlementMode",
    );
  }
  if (input.ruleVersion !== RULE_VERSION) {
    addError(
      result,
      "UNSUPPORTED_RULE_VERSION",
      `Obsługiwana wersja reguł to ${RULE_VERSION}.`,
      "ruleVersion",
    );
  }
  if (!isDenseArray(input.revenues)) {
    addError(result, "INVALID_REVENUES", "Przychody muszą być pełną tablicą bez pustych elementów.", "revenues");
  }
  if (!isDenseArray(input.categories)) {
    addError(result, "INVALID_CATEGORIES", "Kategorie muszą być pełną tablicą bez pustych elementów.", "categories");
  }
  if (!isRecord(input.yearToDateRevenueByCategory)) {
    addError(
      result,
      "INVALID_YEAR_TO_DATE_REVENUE",
      "Przychody narastające muszą być obiektem.",
      "yearToDateRevenueByCategory",
    );
  }
  if (!isSafeNonNegativeInteger(input.deductionGrosz)) {
    addError(
      result,
      "INVALID_DEDUCTION",
      "Odliczenie musi być nieujemną bezpieczną liczbą całkowitą groszy.",
      "deductionGrosz",
    );
  }
  return true;
}

function validateCategories(input, result) {
  const categoryById = new Map();
  if (!Array.isArray(input.categories)) return categoryById;

  const orderedCategories = input.categories
    .map((category, index) => ({ category, index }))
    .sort((left, right) => {
      const leftId = isRecord(left.category) && isNonEmptyString(left.category.id) ? left.category.id : `~${left.index}`;
      const rightId = isRecord(right.category) && isNonEmptyString(right.category.id) ? right.category.id : `~${right.index}`;
      return lexicalCompare(leftId, rightId);
    });

  orderedCategories.forEach(({ category, index }) => {
    const path = isRecord(category) && isNonEmptyString(category.id) ? `categories[${category.id}]` : `categories[${index}]`;
    if (!isRecord(category)) {
      addError(result, "INVALID_CATEGORY", "Kategoria musi być obiektem.", path);
      return;
    }
    if (!isNonEmptyString(category.id)) {
      addError(result, "INVALID_CATEGORY_ID", "Identyfikator kategorii jest wymagany.", `${path}.id`);
      return;
    }
    const id = category.id;
    if (categoryById.has(id)) {
      addError(result, "DUPLICATE_CATEGORY_ID", "Identyfikator kategorii musi być unikalny.", `${path}.id`, [id]);
      return;
    }
    categoryById.set(id, category);

    if (!isNonEmptyString(category.name)) {
      addError(result, "MISSING_CATEGORY_NAME", "Nazwa kategorii jest wymagana.", `${path}.name`, [id]);
    }
    if (category.rateBasisPoints === undefined || category.rateBasisPoints === null) {
      addError(result, "MISSING_RATE", "Stawka ryczałtu jest wymagana.", `${path}.rateBasisPoints`, [id]);
    } else if (!isSafeNonNegativeInteger(category.rateBasisPoints)) {
      addError(result, "INVALID_RATE", "Stawka musi być nieujemną bezpieczną liczbą całkowitą punktów bazowych.", `${path}.rateBasisPoints`, [id]);
    }
    if (!isNonEmptyString(category.pkwiu)) {
      addWarning(result, "MISSING_PKWIU", "Brak klasyfikacji PKWiU wymaga weryfikacji.", `${path}.pkwiu`, [id]);
    }
    if (!isNonEmptyString(category.legalBasis)) {
      addWarning(result, "MISSING_LEGAL_BASIS", "Brak podstawy stawki wymaga weryfikacji.", `${path}.legalBasis`, [id]);
    }

    const validityMissing = !isNonEmptyString(category.validFrom) || !isNonEmptyString(category.validTo);
    if (validityMissing) {
      addWarning(result, "MISSING_RATE_VALIDITY", "Niepełny okres obowiązywania stawki wymaga weryfikacji.", path, [id]);
    } else if (!isPeriod(category.validFrom) || !isPeriod(category.validTo) || category.validFrom > category.validTo) {
      addError(result, "INVALID_RATE_VALIDITY", "Okres obowiązywania stawki jest nieprawidłowy.", path, [id]);
    } else if (
      isPeriod(input.settlementPeriod) &&
      (input.settlementPeriod < category.validFrom || input.settlementPeriod > category.validTo)
    ) {
      addError(result, "RATE_NOT_VALID_FOR_PERIOD", "Stawka nie obowiązuje w okresie rozliczeniowym.", path, [id]);
    }

    const decision = category.decision;
    const completeDecision =
      isRecord(decision) &&
      isNonEmptyString(decision.approvedBy) &&
      typeof decision.approvedAt === "string" &&
      /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(decision.approvedAt) &&
      isNonEmptyString(decision.reason) &&
      isNonEmptyString(decision.reference);
    if (!completeDecision) {
      addWarning(result, "MISSING_DECISION", "Niepełna decyzja podatkowa wymaga weryfikacji.", `${path}.decision`, [id]);
    } else if (!isCalendarDate(decision.approvedAt)) {
      addError(result, "INVALID_DECISION_DATE", "Data zatwierdzenia decyzji nie istnieje w kalendarzu.", `${path}.decision.approvedAt`, [id]);
    }
  });

  return categoryById;
}

function validateRevenues(input, result, categoryById) {
  const rows = [];
  const ids = new Set();
  if (!Array.isArray(input.revenues)) return rows;

  const orderedRevenues = input.revenues
    .map((revenue, index) => ({ revenue, index }))
    .sort((left, right) => {
      const leftId = isRecord(left.revenue) && isNonEmptyString(left.revenue.id) ? left.revenue.id : `~${left.index}`;
      const rightId = isRecord(right.revenue) && isNonEmptyString(right.revenue.id) ? right.revenue.id : `~${right.index}`;
      return lexicalCompare(leftId, rightId);
    });

  orderedRevenues.forEach(({ revenue, index }) => {
    const path = isRecord(revenue) && isNonEmptyString(revenue.id) ? `revenues[${revenue.id}]` : `revenues[${index}]`;
    if (!isRecord(revenue)) {
      addError(result, "INVALID_REVENUE", "Pozycja przychodu musi być obiektem.", path);
      return;
    }
    const relatedIds = isNonEmptyString(revenue.id) ? [revenue.id] : [];
    if (!isNonEmptyString(revenue.id)) {
      addError(result, "INVALID_REVENUE_ID", "Identyfikator przychodu jest wymagany.", `${path}.id`);
    } else if (ids.has(revenue.id)) {
      addError(result, "DUPLICATE_REVENUE_ID", "Identyfikator przychodu musi być unikalny.", `${path}.id`, relatedIds);
    } else {
      ids.add(revenue.id);
    }
    if (revenue.period !== input.settlementPeriod) {
      addError(result, "REVENUE_PERIOD_MISMATCH", "Okres przychodu nie odpowiada okresowi rozliczenia.", `${path}.period`, relatedIds);
    }
    if (!Number.isSafeInteger(revenue.amountGrosz)) {
      addError(result, "INVALID_REVENUE_AMOUNT", "Kwota przychodu musi być bezpieczną liczbą całkowitą groszy.", `${path}.amountGrosz`, relatedIds);
    } else if (revenue.amountGrosz < 0) {
      addError(result, "UNSUPPORTED_NEGATIVE_REVENUE", "Ujemny przychód jest nieobsługiwaną korektą.", `${path}.amountGrosz`, relatedIds);
    } else if (revenue.amountGrosz === 0) {
      addInfo(result, "ZERO_REVENUE", "Pozycja przychodu ma wartość zero.", `${path}.amountGrosz`, relatedIds);
    }
    if (!isNonEmptyString(revenue.categoryId) || !categoryById.has(revenue.categoryId)) {
      addError(result, "MISSING_CATEGORY", "Pozycja przychodu nie wskazuje istniejącej kategorii.", `${path}.categoryId`, relatedIds);
    }
    rows.push(revenue);
  });

  result.audit.inputRevenueIds = [...ids].sort(lexicalCompare);
  return rows;
}

function validateYearToDate(input, result, categoryById) {
  const values = new Map();
  if (!isRecord(input.yearToDateRevenueByCategory)) return values;

  for (const id of Object.keys(input.yearToDateRevenueByCategory).sort(lexicalCompare)) {
    const value = input.yearToDateRevenueByCategory[id];
    const path = `yearToDateRevenueByCategory.${id}`;
    if (!categoryById.has(id)) {
      addError(result, "UNKNOWN_YTD_CATEGORY", "Przychód narastający wskazuje nieistniejącą kategorię.", path, [id]);
    }
    if (!isSafeNonNegativeInteger(value)) {
      addError(result, "INVALID_YTD_REVENUE", "Przychód narastający musi być nieujemną bezpieczną liczbą całkowitą groszy.", path, [id]);
    } else {
      values.set(id, value);
    }
  }

  for (const id of [...categoryById.keys()].sort(lexicalCompare)) {
    if (!Object.prototype.hasOwnProperty.call(input.yearToDateRevenueByCategory, id)) {
      addError(result, "MISSING_YTD_CATEGORY", "Brak przychodu narastającego dla kategorii.", `yearToDateRevenueByCategory.${id}`, [id]);
    }
  }
  return values;
}

function sumSafe(values, result, code, path) {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  const safe = toSafeNumber(total);
  if (safe === null) addError(result, code, "Suma przekracza bezpieczny zakres obliczeń.", path);
  return { total, safe };
}

function allocateDeduction(categoryIds, ytdByCategory, ytdTotal, deductionGrosz) {
  if (ytdTotal === 0n) {
    return new Map(categoryIds.map((id) => [id, { floor: 0n, remainder: 0n, extra: 0n, allocated: 0n }]));
  }

  const deduction = BigInt(deductionGrosz);
  const parts = categoryIds.map((id) => {
    const product = deduction * BigInt(ytdByCategory.get(id));
    return { id, floor: product / ytdTotal, remainder: product % ytdTotal, extra: 0n };
  });
  let remaining = deduction - parts.reduce((sum, part) => sum + part.floor, 0n);
  const ranked = [...parts].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return lexicalCompare(left.id, right.id);
  });
  for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) {
    ranked[index].extra = 1n;
  }
  return new Map(parts.map((part) => [part.id, { ...part, allocated: part.floor + part.extra }]));
}

export function calculateRyczalt(input) {
  const result = baseResult(input);
  if (!validateTopLevel(input, result)) return result;

  const categoryById = validateCategories(input, result);
  const revenues = validateRevenues(input, result, categoryById);
  const ytdByCategory = validateYearToDate(input, result, categoryById);

  if (Array.isArray(input.revenues)) {
    const validAmounts = input.revenues
      .filter((row) => isRecord(row) && isSafeNonNegativeInteger(row.amountGrosz))
      .map((row) => row.amountGrosz);
    const revenueSum = sumSafe(validAmounts, result, "REVENUE_TOTAL_OUT_OF_RANGE", "revenues");
    result.revenueTotalGrosz = revenueSum.safe;
  }

  if (hasErrors(result)) {
    result.status = "INVALID";
    return result;
  }

  const categoryIds = [...categoryById.keys()].sort(lexicalCompare);
  const monthlyByCategory = new Map(categoryIds.map((id) => [id, 0]));
  for (const revenue of revenues) {
    monthlyByCategory.set(revenue.categoryId, monthlyByCategory.get(revenue.categoryId) + revenue.amountGrosz);
  }
  const monthlyTotalData = sumSafe([...monthlyByCategory.values()], result, "REVENUE_TOTAL_OUT_OF_RANGE", "revenues");
  const ytdTotalData = sumSafe([...ytdByCategory.values()], result, "YTD_TOTAL_OUT_OF_RANGE", "yearToDateRevenueByCategory");
  if (hasErrors(result)) {
    result.status = "INVALID";
    return result;
  }
  result.revenueTotalGrosz = monthlyTotalData.safe;

  if (ytdTotalData.total < monthlyTotalData.total) {
    addError(result, "YTD_REVENUE_INCONSISTENT", "Suma przychodów narastających jest mniejsza od przychodów bieżącego miesiąca.", "yearToDateRevenueByCategory");
  }
  if (ytdTotalData.total === 0n && input.deductionGrosz > 0) {
    addError(result, "DEDUCTION_WITHOUT_REVENUE", "Dodatniego odliczenia nie można podzielić przy zerowym przychodzie narastającym.", "deductionGrosz");
  }
  if (hasErrors(result)) {
    result.status = "INVALID";
    return result;
  }

  const allocations = allocateDeduction(categoryIds, ytdByCategory, ytdTotalData.total, input.deductionGrosz);
  let hasCategoryExcess = false;
  result.categoryRows = categoryIds.map((id) => {
    const category = categoryById.get(id);
    const currentRevenue = monthlyByCategory.get(id);
    const ytdRevenue = ytdByCategory.get(id);
    const allocation = allocations.get(id);
    const allocated = Number(allocation.allocated);
    const excess = Math.max(0, allocated - currentRevenue);
    if (excess > 0) {
      hasCategoryExcess = true;
      addWarning(
        result,
        "DEDUCTION_EXCEEDS_CATEGORY_REVENUE",
        "Proponowane odliczenie przekracza bieżący przychód kategorii i nie zostało redystrybuowane.",
        "deductionGrosz",
        [id],
        {
          categoryId: id,
          proposedDeductionGrosz: allocated,
          currentRevenueGrosz: currentRevenue,
          excessGrosz: excess,
        },
      );
    }
    return {
      categoryId: id,
      name: category.name,
      rateBasisPoints: category.rateBasisPoints,
      currentRevenueGrosz: currentRevenue,
      yearToDateRevenueGrosz: ytdRevenue,
      proportion:
        ytdTotalData.total === 0n
          ? { numeratorGrosz: 0, denominatorGrosz: 1 }
          : { numeratorGrosz: ytdRevenue, denominatorGrosz: ytdTotalData.safe },
      allocationFloorGrosz: Number(allocation.floor),
      allocationRemainder: {
        numerator: Number(allocation.remainder),
        denominator: ytdTotalData.total === 0n ? 1 : ytdTotalData.safe,
      },
      receivedRemainderGrosz: Number(allocation.extra),
      deductionAllocatedGrosz: allocated,
      deductionExcessGrosz: excess,
      taxableBaseBeforeRoundingGrosz: excess > 0 ? null : currentRevenue - allocated,
    };
  });

  result.audit.appliedCategoryIds = [...categoryIds];
  result.audit.appliedRatesBasisPoints = [...new Set(categoryIds.map((id) => categoryById.get(id).rateBasisPoints))].sort((a, b) => a - b);

  if (hasCategoryExcess) {
    result.status = "REVIEW_REQUIRED";
    result.taxDuePln = null;
    return result;
  }

  result.taxableBaseBeforeRoundingGrosz = result.revenueTotalGrosz - input.deductionGrosz;
  const baseByRate = new Map();
  for (const row of result.categoryRows) {
    baseByRate.set(
      row.rateBasisPoints,
      (baseByRate.get(row.rateBasisPoints) ?? 0) + row.taxableBaseBeforeRoundingGrosz,
    );
  }

  let totalTaxUnits = 0n;
  result.rateRows = [...baseByRate.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rateBasisPoints, baseBeforeRoundingGrosz]) => {
      const roundedBasePln = roundGroszToPln(baseBeforeRoundingGrosz);
      const exactUnits = BigInt(roundedBasePln) * BigInt(rateBasisPoints);
      totalTaxUnits += exactUnits;
      return {
        rateBasisPoints,
        baseBeforeRoundingGrosz,
        roundedBasePln,
        taxExact: { units: toSafeNumber(exactUnits), unitScale: 10000, currency: "PLN" },
      };
    });

  if (result.rateRows.some((row) => row.taxExact.units === null) || toSafeNumber(totalTaxUnits) === null) {
    addError(result, "TAX_OUT_OF_RANGE", "Podatek przekracza bezpieczny zakres wyniku.", "rateRows");
    result.status = "INVALID";
    result.rateRows = [];
    return result;
  }

  const taxDue = roundExactUnitsToPln(totalTaxUnits);
  const taxDuePln = toSafeNumber(taxDue);
  if (taxDuePln === null) {
    addError(result, "TAX_OUT_OF_RANGE", "Podatek przekracza bezpieczny zakres wyniku.", "taxDuePln");
    result.status = "INVALID";
    return result;
  }
  result.taxBeforeFinalRounding.units = Number(totalTaxUnits);
  result.taxDuePln = taxDuePln;
  result.status = statusFromFindings(result);
  return result;
}
