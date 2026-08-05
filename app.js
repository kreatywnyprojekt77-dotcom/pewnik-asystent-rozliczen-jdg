import { calculateVat } from './vat-calculator.mjs';
import { createVatInputFromInvoices } from './vat-adapter.mjs';
import { calculateRyczalt } from './ryczalt-calculator.mjs';
import { createRyczaltInputFromInvoices } from './ryczalt-adapter.mjs';
import { calculateZus } from './zus-calculator.mjs';
import { createZusInputFromInvoices } from './zus-adapter.mjs';
import { prepareInvoice } from './invoice-input.mjs';

(function () {
  'use strict';

  const STORAGE_KEY = 'pewnik-prototype-v1';
  const defaultRules = {
    software: 12,
    consulting: 15,
    vatRate: 23
  };

  const defaultCategoryProfiles = {
    software: {
      name: 'Usługi programistyczne',
      pkwiu: '',
      legalBasis: '',
      validFrom: '2026-01',
      validTo: '2026-12',
      decision: null
    },
    consulting: {
      name: 'Usługi konsultingowe',
      pkwiu: '',
      legalBasis: '',
      validFrom: '2026-01',
      validTo: '2026-12',
      decision: null
    }
  };

  const defaultRyczaltSettings = {
    byPeriod: {
      '2026-06': { deductionGrosz: 550000 }
    }
  };

  const defaultInvoices = [
    { id: 1, number: 'FV/06/2026/01', date: '2026-06-03', supplyDate: '2026-06-03', taxPointDate: '2026-06-03', contractor: 'DEMO — Northbyte Sp. z o.o.', type: 'sale', documentType: 'invoice', net: 12000, vatRate: 23, vatCode: '23', category: 'software' },
    { id: 2, number: 'FV/06/2026/02', date: '2026-06-10', supplyDate: '2026-06-10', taxPointDate: '2026-06-10', contractor: 'DEMO — Orbit Systems S.A.', type: 'sale', documentType: 'invoice', net: 6800, vatRate: 23, vatCode: '23', category: 'software' },
    { id: 3, number: 'FV/06/2026/03', date: '2026-06-18', supplyDate: '2026-06-18', taxPointDate: '2026-06-18', contractor: 'DEMO — Metrum Digital Sp. z o.o.', type: 'sale', documentType: 'invoice', net: 5500, vatRate: 23, vatCode: '23', category: 'consulting' },
    { id: 4, number: 'FV/06/2026/04', date: '2026-06-26', supplyDate: '2026-06-26', taxPointDate: '2026-06-26', contractor: 'DEMO — BluePeak Polska Sp. z o.o.', type: 'sale', documentType: 'invoice', net: 4500, vatRate: 23, vatCode: '23', category: 'software' },
    { id: 5, number: 'K/0626/184', date: '2026-06-12', receivedDate: '2026-06-12', contractor: 'DEMO — Cloud Hosting Polska', type: 'cost', documentType: 'invoice', net: 1800, vatRate: 23, vatCode: '23', vatDeductionPercent: 100, category: null },
    { id: 6, number: 'FVK/1220/06', date: '2026-06-21', receivedDate: '2026-06-21', contractor: 'DEMO — Biuro i Sprzęt Sp. z o.o.', type: 'cost', documentType: 'invoice', net: 800, vatRate: 23, vatCode: '23', vatDeductionPercent: 100, category: null }
  ];

  const initialState = {
    period: '2026-06-01',
    invoices: defaultInvoices,
    rules: defaultRules,
    categoryProfiles: defaultCategoryProfiles,
    ryczaltSettings: defaultRyczaltSettings,
    vatSettings: { byPeriod: {} },
    zusSettings: { sicknessInsurance: true, byPeriod: {} },
    tasks: { transfers: false, jpk: false, archive: false },
    company: { name: 'DEMO — Studio Testowe (dane syntetyczne)', nip: '0000000000' }
  };

  const loaded = loadState();
  const state = {
    period: loaded.period || initialState.period,
    invoices: Array.isArray(loaded.invoices) ? loaded.invoices : defaultInvoices,
    rules: Object.assign({}, defaultRules, loaded.rules || {}),
    categoryProfiles: mergeCategoryProfiles(loaded.categoryProfiles),
    ryczaltSettings: mergePeriodSettings(defaultRyczaltSettings, loaded.ryczaltSettings),
    vatSettings: Object.assign({}, initialState.vatSettings, loaded.vatSettings || {}),
    zusSettings: Object.assign({}, initialState.zusSettings, loaded.zusSettings || {}),
    tasks: Object.assign({}, initialState.tasks, loaded.tasks || {}),
    company: Object.assign({}, initialState.company, loaded.company || {})
  };

  let toastTimer;

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (_) {
      return {};
    }
  }

  function mergeCategoryProfiles(profiles) {
    const source = profiles && typeof profiles === 'object' ? profiles : {};
    return Object.fromEntries(Object.keys(defaultCategoryProfiles).map(id => [
      id,
      Object.assign({}, defaultCategoryProfiles[id], source[id] || {})
    ]));
  }

  function mergePeriodSettings(defaults, settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    return {
      byPeriod: Object.assign({}, defaults.byPeriod, source.byPeriod || {})
    };
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Aplikacja nadal działa, nawet gdy przeglądarka blokuje localStorage.
    }
    if (window.PewnikCloud) window.PewnikCloud.queueSave(state);
  }

  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  function replaceState(nextState) {
    if (!nextState || typeof nextState !== 'object') return;
    state.period = nextState.period || initialState.period;
    state.invoices = Array.isArray(nextState.invoices) ? nextState.invoices : defaultInvoices;
    state.rules = Object.assign({}, defaultRules, nextState.rules || {});
    state.categoryProfiles = mergeCategoryProfiles(nextState.categoryProfiles);
    state.ryczaltSettings = mergePeriodSettings(defaultRyczaltSettings, nextState.ryczaltSettings);
    state.vatSettings = Object.assign({}, initialState.vatSettings, nextState.vatSettings || {});
    state.zusSettings = Object.assign({}, initialState.zusSettings, nextState.zusSettings || {});
    state.tasks = Object.assign({}, initialState.tasks, nextState.tasks || {});
    state.company = Object.assign({}, initialState.company, nextState.company || {});
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Dane z chmury pozostają dostępne w bieżącej sesji.
    }
    updatePeriod();
    fillRuleForm();
    fillVerificationForm();
    renderCompany();
    renderTasks();
    renderCalculations();
  }

  function money(value, currency = 'PLN') {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function number(value) {
    return new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function exactTax(units) {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(Number(units) / 10000);
  }

  function toGrosz(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Math.sign(numeric) * Math.round(Math.abs(numeric) * 100 + Number.EPSILON)
      : null;
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function periodDate() {
    const parts = state.period.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, 1);
  }

  function periodName(form = 'long') {
    const text = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(periodDate());
    return form === 'long' ? capitalize(text) : text;
  }

  function vatSettingsForPeriod() {
    const period = state.period.slice(0, 7);
    const legacySettings = state.vatSettings && (Number.isSafeInteger(state.vatSettings.openingCarryForwardGrosz) || state.vatSettings.excessMode)
      ? state.vatSettings
      : {};
    return Object.assign(
      { openingCarryForwardGrosz: 0, excessMode: 'CARRY_FORWARD' },
      legacySettings,
      state.vatSettings && state.vatSettings.byPeriod ? state.vatSettings.byPeriod[period] : null
    );
  }

  function ryczaltSettingsForPeriod() {
    const period = state.period.slice(0, 7);
    return Object.assign(
      { deductionGrosz: 0 },
      state.ryczaltSettings && state.ryczaltSettings.byPeriod
        ? state.ryczaltSettings.byPeriod[period]
        : null
    );
  }

  function zusSettingsForPeriod() {
    const period = state.period.slice(0, 7);
    return Object.assign(
      { healthRevenueDeductionYtdGrosz: 0 },
      state.zusSettings && state.zusSettings.byPeriod
        ? state.zusSettings.byPeriod[period]
        : null
    );
  }

  function formatDate(date, includeYear = true) {
    return new Intl.DateTimeFormat('pl-PL', includeYear
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'long' }
    ).format(date);
  }

  function nextMonthDeadline(day, moveWeekend) {
    const period = periodDate();
    const deadline = new Date(period.getFullYear(), period.getMonth() + 1, day);
    if (moveWeekend) {
      if (deadline.getDay() === 6) deadline.setDate(deadline.getDate() + 2);
      if (deadline.getDay() === 0) deadline.setDate(deadline.getDate() + 1);
    }
    return deadline;
  }

  function calculations() {
    const settlementPeriod = state.period.slice(0, 7);
    const vatSettings = vatSettingsForPeriod();
    const vatInput = createVatInputFromInvoices({
      invoices: state.invoices,
      settlementPeriod,
      openingCarryForwardGrosz: vatSettings.openingCarryForwardGrosz,
      excessDecision: { mode: vatSettings.excessMode }
    });
    const vatResult = calculateVat(vatInput);
    const salesVat = vatResult.outputVatGrosz == null ? 0 : vatResult.outputVatGrosz / 100;
    const costVat = vatResult.inputVatGrosz == null ? 0 : vatResult.inputVatGrosz / 100;
    const deductibleVat = vatResult.deductibleInputVatGrosz == null ? 0 : vatResult.deductibleInputVatGrosz / 100;
    const vat = vatResult.taxDueGrosz == null ? 0 : vatResult.taxDueGrosz / 100;

    const ryczaltInput = createRyczaltInputFromInvoices({
      invoices: state.invoices,
      settlementPeriod,
      deductionGrosz: ryczaltSettingsForPeriod().deductionGrosz,
      ratesPercent: {
        software: state.rules.software,
        consulting: state.rules.consulting
      },
      categoryMetadata: state.categoryProfiles
    });
    const pitResult = calculateRyczalt(ryczaltInput);
    const zusInput = createZusInputFromInvoices({
      invoices: state.invoices,
      settlementPeriod,
      healthRevenueDeductionYtdGrosz: zusSettingsForPeriod().healthRevenueDeductionYtdGrosz,
      sicknessInsurance: state.zusSettings.sicknessInsurance !== false
    });
    const zusResult = calculateZus(zusInput);
    const includedPitIds = new Set(pitResult.audit.inputRevenueIds.map(String));
    const includedVatIds = new Set(vatResult.audit.includedEntryIds.map(String));
    const sales = state.invoices.filter(invoice => invoice.type === 'sale' && includedPitIds.has(String(invoice.id)));
    const costs = state.invoices.filter(invoice => invoice.type === 'cost' && includedVatIds.has(String(invoice.id)));
    const revenue = pitResult.revenueTotalGrosz == null ? null : pitResult.revenueTotalGrosz / 100;
    const costsNet = costs.reduce((sum, invoice) => sum + Number(invoice.net), 0);
    const deduction = pitResult.deductionTotalGrosz == null ? null : pitResult.deductionTotalGrosz / 100;
    const taxableRevenue = pitResult.taxableBaseBeforeRoundingGrosz == null ? null : pitResult.taxableBaseBeforeRoundingGrosz / 100;
    const pit = pitResult.taxDuePln;
    const zus = zusResult.totalDueGrosz == null ? null : zusResult.totalDueGrosz / 100;
    const calculationInvalid = vatResult.status === 'INVALID' || pitResult.status === 'INVALID' || zusResult.status === 'INVALID' || pit == null;

    return {
      sales, costs, revenue, costsNet, salesVat, costVat, deductibleVat, vat, vatResult,
      deduction, taxableRevenue, pitResult, pit, zus, zusResult,
      total: calculationInvalid ? null : pit + vat + zus
    };
  }

  function invoiceVat(invoice) {
    if (invoice.vatAmount != null && Number.isFinite(Number(invoice.vatAmount))) {
      return Number(invoice.vatAmount);
    }
    return Number(invoice.net) * Number(invoice.vatRate) / 100;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function updatePeriod() {
    const label = periodName();
    setText('periodLabel', label);
    document.querySelectorAll('[data-period-text]').forEach(element => {
      element.textContent = periodName('lower');
    });

    const period = periodDate();
    const pitDeadline = nextMonthDeadline(20, true);
    const zusDeadline = nextMonthDeadline(20, true);
    const vatDeadline = nextMonthDeadline(25, true);
    setText('pitDeadline', formatDate(pitDeadline));
    setText('zusDeadline', formatDate(zusDeadline));
    setText('vatDeadline', formatDate(vatDeadline));
    setText('jpkDeadline', formatDate(vatDeadline, false));
    setText('nearestDeadline', formatDate(pitDeadline, false));
    setText('documentPeriod', String(period.getMonth() + 1).padStart(2, '0') + ' / ' + period.getFullYear());
  }

  function renderCalculations() {
    const calc = calculations();
    const vatSettings = vatSettingsForPeriod();
    const invalidPit = calc.pitResult.status === 'INVALID';
    const reviewPit = calc.pitResult.status === 'REVIEW_REQUIRED';
    const invalidVat = calc.vatResult.status === 'INVALID';
    const reviewVat = calc.vatResult.status === 'REVIEW_REQUIRED';
    const invalidZus = calc.zusResult.status === 'INVALID';
    const reviewZus = calc.zusResult.status === 'REVIEW_REQUIRED';
    const invalidOverall = invalidPit || invalidVat || invalidZus;
    const reviewOverall = !invalidOverall && (reviewPit || reviewVat || reviewZus);
    const blockedOverall = invalidOverall || calc.pit == null;
    setText('grandTotal', calc.total == null ? '—' : money(calc.total));
    setText('settlementTotal', calc.total == null ? '—' : money(calc.total));
    setText('pitAmount', calc.pit == null ? '—' : money(calc.pit));
    setText('vatAmount', invalidVat ? '—' : money(calc.vat));
    setText('zusAmount', invalidZus || calc.zus == null ? '—' : money(calc.zus));
    setText('revenueMetric', calc.revenue == null ? '—' : money(calc.revenue));
    setText('costMetric', money(calc.costsNet));
    setText('vatMetric', invalidVat ? '—' : money(calc.vat));
    setText('salesCountMetric', calc.sales.length + ' ' + plural(calc.sales.length, 'faktura sprzedażowa', 'faktury sprzedażowe', 'faktur sprzedażowych'));
    setText('costCountMetric', calc.costs.length + ' ' + plural(calc.costs.length, 'faktura kosztowa', 'faktury kosztowe', 'faktur kosztowych'));
    setText('documentVat', invalidVat ? '—' : money(calc.vat));
    const vatDocumentCount = calc.vatResult.audit.includedEntryIds.length;
    setText('documentInvoiceCount', vatDocumentCount + ' ' + plural(vatDocumentCount, 'pozycja ewidencji', 'pozycje ewidencji', 'pozycji ewidencji'));

    const pitStatus = document.getElementById('pitStatus');
    pitStatus.textContent = invalidPit ? 'Błąd danych' : (reviewPit ? 'Do weryfikacji' : 'Do zapłaty');
    pitStatus.className = 'status-pill ' + (invalidPit ? 'error' : (reviewPit ? 'warning' : 'neutral'));
    const vatStatus = document.getElementById('vatStatus');
    vatStatus.textContent = calc.vatResult.status === 'VERIFIED' ? (calc.vatResult.excessGrosz > 0 ? 'Nadwyżka' : 'Do zapłaty') : (calc.vatResult.status === 'INVALID' ? 'Błąd danych' : 'Do weryfikacji');
    vatStatus.className = 'status-pill ' + (calc.vatResult.status === 'VERIFIED' ? 'neutral' : (calc.vatResult.status === 'INVALID' ? 'error' : 'warning'));
    const zusStatus = document.getElementById('zusStatus');
    zusStatus.textContent = invalidZus ? 'Błąd danych' : (reviewZus ? 'Do weryfikacji' : 'Do zapłaty');
    zusStatus.className = 'status-pill ' + (invalidZus ? 'error' : (reviewZus ? 'warning' : 'neutral'));
    setText('calculationReadinessTitle', invalidOverall ? 'Rozliczenie wymaga poprawy danych' : (reviewOverall ? 'Rozliczenie wymaga sprawdzenia' : 'Rozliczenie jest gotowe'));
    setText('calculationReadinessDescription', invalidOverall ? 'Popraw dane wskazane w Centrum weryfikacji przed przygotowaniem płatności.' : (reviewOverall ? 'Przejdź przez krótką listę zadań i potwierdź brakujące informacje.' : 'Nie znaleźliśmy braków ani sytuacji wymagających uwagi.'));
    const overallStatus = document.getElementById('overallCalculationStatus');
    overallStatus.textContent = invalidOverall ? 'Błąd' : (reviewOverall ? 'Do weryfikacji' : 'Gotowe');
    overallStatus.className = 'status-pill ' + (invalidOverall ? 'error' : (reviewOverall ? 'warning' : 'success'));
    document.querySelector('.ready-banner').classList.toggle('warning', invalidOverall || reviewOverall);
    document.getElementById('downloadDraft').disabled = invalidVat;
    document.querySelector('[data-task="transfers"]').disabled = blockedOverall;
    document.querySelector('[data-task="jpk"]').disabled = invalidVat;

    const pitCategoryRows = calc.pitResult.categoryRows.filter(row => row.currentRevenueGrosz > 0).map(row => {
      const base = row.taxableBaseBeforeRoundingGrosz == null ? '—' : money(row.taxableBaseBeforeRoundingGrosz / 100);
      return '<div class="detail-row"><span>' + escapeHtml(row.name) + ' · przychód ' + money(row.currentRevenueGrosz / 100) + ' · odliczenie ' + money(row.deductionAllocatedGrosz / 100) + '</span><strong>podstawa ' + base + '</strong></div>';
    }).join('');
    const pitRateRows = calc.pitResult.rateRows.map(row =>
      '<div class="detail-row"><span>Podstawa ' + money(row.baseBeforeRoundingGrosz / 100) + ' → ' + money(row.roundedBasePln) + ' × ' + number(row.rateBasisPoints / 100) + '%</span><strong>' + exactTax(row.taxExact.units) + '</strong></div>'
    ).join('');
    const pitFindings = findingSummary(calc.pitResult.findings, 'pit');
    document.getElementById('pitDetails').innerHTML =
      '<div class="detail-row"><span>Przychód netto</span><strong>' + (calc.revenue == null ? '—' : money(calc.revenue)) + '</strong></div>' +
      '<div class="detail-row"><span>Odliczenie od przychodu</span><strong>' + (calc.deduction == null ? '—' : '− ' + money(calc.deduction)) + '</strong></div>' +
      pitCategoryRows + pitRateRows +
      '<div class="detail-row"><span>' + (reviewPit ? 'Ryczałt — do weryfikacji' : 'Ryczałt do zapłaty') + '</span><strong>' + (calc.pit == null ? '—' : money(calc.pit)) + '</strong></div>' +
      pitFindings;

    document.getElementById('vatDetails').innerHTML =
      '<div class="detail-row"><span>VAT należny ze sprzedaży</span><strong>' + money(calc.salesVat) + '</strong></div>' +
      '<div class="detail-row"><span>VAT naliczony z zakupów</span><strong>' + money(calc.costVat) + '</strong></div>' +
      '<div class="detail-row"><span>VAT podlegający odliczeniu</span><strong>− ' + money(calc.deductibleVat) + '</strong></div>' +
      '<div class="detail-row"><span>Nadwyżka z poprzedniego okresu</span><strong>− ' + money(vatSettings.openingCarryForwardGrosz / 100) + '</strong></div>' +
      (calc.vatResult.excessGrosz > 0
        ? '<div class="detail-row"><span>Nadwyżka VAT</span><strong>' + money(calc.vatResult.excessGrosz / 100) + '</strong></div><div class="detail-row"><span>' + (vatSettings.excessMode === 'REFUND' ? 'Wnioskowany zwrot' : 'Do przeniesienia') + '</span><strong>' + money((vatSettings.excessMode === 'REFUND' ? calc.vatResult.refundRequestedGrosz : calc.vatResult.carryForwardGrosz) / 100) + '</strong></div>'
        : '<div class="detail-row"><span>VAT do zapłaty</span><strong>' + money(calc.vat) + '</strong></div>') +
      findingSummary(calc.vatResult.findings, 'vat');

    const zusSocialRows = calc.zusResult.socialRows.map(row =>
      '<div class="detail-row"><span>' + escapeHtml(row.label) + ' · ' + number(row.rateBasisPoints / 100) + '%</span><strong>' + money(row.amountGrosz / 100) + '</strong></div>'
    ).join('');
    document.getElementById('zusDetails').innerHTML =
      '<div class="detail-row"><span>Podstawa składek społecznych</span><strong>' + (calc.zusResult.socialBaseGrosz == null ? '—' : money(calc.zusResult.socialBaseGrosz / 100)) + '</strong></div>' +
      zusSocialRows +
      '<div class="detail-row"><span>Przychód dla zdrowotnej narastająco</span><strong>' + (calc.zusResult.healthRevenueYtdGrosz == null ? '—' : money(calc.zusResult.healthRevenueYtdGrosz / 100)) + '</strong></div>' +
      '<div class="detail-row"><span>Składka zdrowotna</span><strong>' + (calc.zusResult.healthContributionGrosz == null ? '—' : money(calc.zusResult.healthContributionGrosz / 100)) + '</strong></div>' +
      '<div class="detail-row"><span>Składki do zapłaty</span><strong>' + (calc.zus == null ? '—' : money(calc.zus)) + '</strong></div>' +
      findingSummary(calc.zusResult.findings.filter(item => item.severity !== 'info'), 'zus');

    renderInvoices();
    renderVerification(calc);
  }

  function findingSummary(findings, area) {
    if (!findings.length) return '';
    const grouped = new Map();
    findings.forEach(item => {
      const key = item.code + '|' + item.severity;
      const current = grouped.get(key) || { item, count: 0 };
      current.count += 1;
      grouped.set(key, current);
    });
    const actionText = area === 'pit'
      ? 'Otwórz Centrum weryfikacji, aby uzupełnić stały profil kategorii lub dane tego miesiąca.'
      : (area === 'zus'
        ? 'Sprawdź profil ZUS i przychód narastający wykorzystany do obliczeń.'
        : 'Otwórz Centrum weryfikacji, aby sprawdzić dokumenty i decyzje dotyczące VAT.');
    const rows = [...grouped.values()].map(({ item, count }) =>
      '<div class="technical-finding"><strong>' + escapeHtml(item.code) + (count > 1 ? ' × ' + count : '') + '</strong><span>' + escapeHtml(item.message) + '</span></div>'
    ).join('');
    return '<div class="verification-prompt"><strong>Wymaga Twojej uwagi</strong><span>' + actionText + '</span><button type="button" class="text-button" data-view-target="verification">Przejdź do weryfikacji →</button></div>' +
      '<details class="technical-findings"><summary>Szczegóły techniczne (' + findings.length + ')</summary>' + rows + '</details>';
  }

  function isCategoryProfileComplete(id) {
    const profile = state.categoryProfiles[id] || {};
    const decision = profile.decision || {};
    const period = state.period.slice(0, 7);
    return Boolean(
      profile.pkwiu && profile.legalBasis && profile.validFrom && profile.validTo &&
      profile.validFrom <= period && profile.validTo >= period &&
      decision.approvedBy && decision.approvedAt && decision.reason && decision.reference
    );
  }

  function invoicePeriod(invoice) {
    const value = invoice.revenuePeriod || invoice.date;
    return typeof value === 'string' ? value.slice(0, 7) : '';
  }

  function renderVerification(calc = calculations()) {
    const period = state.period.slice(0, 7);
    const currentSales = state.invoices.filter(invoice => invoice.type === 'sale' && invoicePeriod(invoice) === period);
    const noSalesConfirmed = Boolean(ryczaltSettingsForPeriod().noSalesConfirmed);
    const salesReady = currentSales.length > 0 || noSalesConfirmed;
    const incompleteProfiles = Object.keys(defaultCategoryProfiles).filter(id => !isCategoryProfileComplete(id));
    const deductionGrosz = ryczaltSettingsForPeriod().deductionGrosz;
    const deductionBlocked = calc.pitResult.findings.some(item =>
      item.code === 'DEDUCTION_EXCEEDS_CATEGORY_REVENUE' || item.code === 'DEDUCTION_WITHOUT_REVENUE'
    );
    const vatNeedsReview = calc.vatResult.status !== 'VERIFIED';
    const taskCount = incompleteProfiles.length + (salesReady ? 0 : 1) + (deductionBlocked ? 1 : 0) + (vatNeedsReview ? 1 : 0);

    setText('verificationCountBadge', taskCount);
    setText('verificationOpenCount', taskCount);
    setText('verificationPeriodName', periodName());
    setText('verificationSalesCount', currentSales.length + ' ' + plural(currentSales.length, 'faktura sprzedażowa', 'faktury sprzedażowe', 'faktur sprzedażowych'));
    setText('verificationDeductionValue', money(deductionGrosz / 100));
    setText('verificationVatStatus', vatNeedsReview ? 'Wymaga sprawdzenia' : 'Gotowe');

    const overall = document.getElementById('verificationOverallStatus');
    overall.textContent = taskCount ? 'Do weryfikacji' : 'Gotowe';
    overall.className = 'status-pill ' + (taskCount ? 'warning' : 'success');

    const salesTask = document.getElementById('verificationSalesTask');
    salesTask.classList.toggle('complete', salesReady);
    salesTask.classList.toggle('attention', !salesReady);
    setText('verificationSalesHelp', currentSales.length
      ? 'Dokumenty sprzedaży z wybranego miesiąca są gotowe do obliczeń.'
      : (noSalesConfirmed
        ? 'Potwierdzono brak sprzedaży w tym miesiącu.'
        : 'Nie znaleźliśmy sprzedaży. Dodaj dokument, zsynchronizuj KSeF albo potwierdź miesiąc bez sprzedaży.'));
    document.getElementById('confirmNoSales').hidden = currentSales.length > 0 || noSalesConfirmed;

    const deductionTask = document.getElementById('verificationDeductionTask');
    deductionTask.classList.toggle('complete', !deductionBlocked);
    deductionTask.classList.toggle('attention', deductionBlocked);
    setText('verificationDeductionHelp', deductionBlocked
      ? 'Odliczenie przekracza przychód możliwy do rozliczenia w tym miesiącu. Zmień kwotę i przelicz.'
      : 'Kwota jest przypisana wyłącznie do tego okresu i nie przejdzie automatycznie na kolejny miesiąc.');

    const vatTask = document.getElementById('verificationVatTask');
    vatTask.classList.toggle('complete', !vatNeedsReview);
    vatTask.classList.toggle('attention', vatNeedsReview);

    Object.keys(defaultCategoryProfiles).forEach(id => {
      const complete = isCategoryProfileComplete(id);
      const status = document.getElementById(id + 'ProfileStatus');
      status.textContent = complete ? 'Potwierdzone' : 'Uzupełnij raz';
      status.className = 'status-pill ' + (complete ? 'success' : 'warning');
      document.getElementById(id + 'ProfileCard').classList.toggle('complete', complete);
    });
  }

  function plural(count, one, few, many) {
    if (count === 1) return one;
    if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return few;
    return many;
  }

  function renderInvoices() {
    const tbody = document.getElementById('invoiceTableBody');
    const query = (document.getElementById('invoiceSearch').value || '').trim().toLowerCase();
    const filter = document.getElementById('invoiceFilter').value;
    const filtered = state.invoices.filter(invoice => {
      const matchesQuery = invoice.number.toLowerCase().includes(query) || invoice.contractor.toLowerCase().includes(query);
      const matchesFilter = filter === 'all' || invoice.type === filter;
      return matchesQuery && matchesFilter;
    });

    tbody.innerHTML = filtered.map(invoice => {
      const date = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(invoice.date + 'T12:00:00'));
      const vat = invoiceVat(invoice);
      const currency = invoice.currency || 'PLN';
      const vatCurrency = invoice.source === 'ksef' ? 'PLN' : currency;
      const origin = invoice.source === 'ksef' ? '<span class="ksef-origin">KSeF</span>' : '';
      const ksefNumber = invoice.ksefNumber
        ? '<span class="ksef-number" title="' + escapeHtml(invoice.ksefNumber) + '">' + escapeHtml(invoice.ksefNumber) + '</span>'
        : '';
      const rateControl = invoice.type === 'sale'
        ? '<select class="rate-select" data-rate-invoice="' + invoice.id + '"><option value="" disabled ' + (!invoice.category ? 'selected' : '') + '>Przypisz stawkę</option><option value="software" ' + (invoice.category === 'software' ? 'selected' : '') + '>Programowanie · ' + number(state.rules.software) + '%</option><option value="consulting" ' + (invoice.category === 'consulting' ? 'selected' : '') + '>Konsulting · ' + number(state.rules.consulting) + '%</option></select>'
        : '<select class="rate-select" data-vat-deduction-invoice="' + invoice.id + '"><option value="" disabled ' + (invoice.vatDeductionPercent == null ? 'selected' : '') + '>Potwierdź odliczenie VAT</option><option value="100" ' + (Number(invoice.vatDeductionPercent) === 100 ? 'selected' : '') + '>VAT 100%</option><option value="50" ' + (Number(invoice.vatDeductionPercent) === 50 ? 'selected' : '') + '>VAT 50%</option><option value="0" ' + (Number(invoice.vatDeductionPercent) === 0 ? 'selected' : '') + '>VAT 0%</option></select>';
      const deleteControl = invoice.source === 'ksef'
        ? '<span class="ksef-origin" title="Dokument źródłowy pozostaje w KSeF">ŹRÓDŁO</span>'
        : '<button class="icon-button delete-invoice" data-delete-invoice="' + invoice.id + '" aria-label="Usuń fakturę">×</button>';
      return '<tr>' +
        '<td class="document-cell"><strong>' + escapeHtml(invoice.number) + origin + '</strong><small>' + date + '</small>' + ksefNumber + '</td>' +
        '<td>' + escapeHtml(invoice.contractor) + '</td>' +
        '<td><span class="type-badge ' + (invoice.type === 'cost' ? 'cost' : '') + '">' + (invoice.type === 'sale' ? 'Sprzedaż' : 'Koszt') + '</span></td>' +
        '<td><strong>' + money(invoice.net, currency) + '</strong></td>' +
        '<td>' + money(vat, vatCurrency) + '</td>' +
        '<td>' + rateControl + '</td>' +
        '<td>' + deleteControl + '</td>' +
      '</tr>';
    }).join('');

    setText('invoiceCountBadge', state.invoices.length);
    document.getElementById('invoiceEmpty').classList.toggle('visible', filtered.length === 0);
    document.querySelector('.invoice-table-wrap').style.display = filtered.length ? '' : 'none';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const view = document.getElementById(name + 'View');
    const nav = document.querySelector('.nav-item[data-view="' + name + '"]');
    if (view) view.classList.add('active');
    if (nav) nav.classList.add('active');
    document.getElementById('sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(message, type) {
    const toast = document.getElementById('toast');
    document.getElementById('toastText').textContent = message;
    toast.querySelector('.toast-icon').textContent = type === 'info' ? 'i' : '✓';
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModals() {
    document.querySelectorAll('.modal-backdrop.visible').forEach(modal => {
      modal.classList.remove('visible');
      modal.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = '';
  }

  function fillRuleForm() {
    const vatSettings = vatSettingsForPeriod();
    setTextInput('rateSoftware', state.rules.software);
    setTextInput('rateConsulting', state.rules.consulting);
    setTextInput('vatRate', state.rules.vatRate);
    setTextInput('openingVatCarry', vatSettings.openingCarryForwardGrosz / 100);
    document.getElementById('vatExcessMode').value = vatSettings.excessMode;
  }

  function setTextInput(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value;
  }

  function readRuleForm() {
    const value = id => Math.max(0, Number(document.getElementById(id).value) || 0);
    state.rules = {
      software: value('rateSoftware'),
      consulting: value('rateConsulting'),
      vatRate: state.rules.vatRate
    };
    const byPeriod = Object.assign({}, state.vatSettings.byPeriod || {});
    byPeriod[state.period.slice(0, 7)] = {
      openingCarryForwardGrosz: Math.round(value('openingVatCarry') * 100),
      excessMode: document.getElementById('vatExcessMode').value
    };
    state.vatSettings = { byPeriod };
  }

  function fillVerificationForm() {
    Object.keys(defaultCategoryProfiles).forEach(id => {
      const profile = state.categoryProfiles[id];
      setTextInput(id + 'ProfilePkwiu', profile.pkwiu);
      setTextInput(id + 'ProfileLegalBasis', profile.legalBasis);
      setTextInput(id + 'ProfileValidFrom', profile.validFrom);
      setTextInput(id + 'ProfileValidTo', profile.validTo);
      setTextInput(id + 'ProfileRate', state.rules[id]);
      const checkbox = document.getElementById(id + 'ProfileConfirmed');
      if (checkbox) checkbox.checked = Boolean(profile.decision);
    });
    setTextInput('verificationDeduction', ryczaltSettingsForPeriod().deductionGrosz / 100);
  }

  function localIsoDate() {
    const date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function saveCategoryProfiles() {
    const nextProfiles = {};
    for (const id of Object.keys(defaultCategoryProfiles)) {
      const pkwiu = document.getElementById(id + 'ProfilePkwiu').value.trim();
      const legalBasis = document.getElementById(id + 'ProfileLegalBasis').value.trim();
      const validFrom = document.getElementById(id + 'ProfileValidFrom').value;
      const validTo = document.getElementById(id + 'ProfileValidTo').value;
      const confirmed = document.getElementById(id + 'ProfileConfirmed').checked;
      const rate = Math.max(0, Number(document.getElementById(id + 'ProfileRate').value) || 0);
      if (confirmed && (!pkwiu || !legalBasis || !validFrom || !validTo || !rate)) {
        showToast('Uzupełnij PKWiU, stawkę, źródło i okres obowiązywania przed potwierdzeniem profilu.', 'error');
        return false;
      }
      if (validFrom && validTo && validFrom > validTo) {
        showToast('Data końcowa obowiązywania kategorii nie może być wcześniejsza niż początkowa.', 'error');
        return false;
      }
      state.rules[id] = rate;
      nextProfiles[id] = Object.assign({}, state.categoryProfiles[id], {
        pkwiu,
        legalBasis,
        validFrom,
        validTo,
        decision: confirmed ? {
          approvedBy: state.company.name || 'Użytkownik aplikacji',
          approvedAt: localIsoDate(),
          reason: 'Potwierdzenie stałej konfiguracji działalności',
          reference: legalBasis
        } : null
      });
    }
    state.categoryProfiles = nextProfiles;
    return true;
  }

  function savePeriodDeduction() {
    const amount = Math.max(0, Number(document.getElementById('verificationDeduction').value) || 0);
    const byPeriod = Object.assign({}, state.ryczaltSettings.byPeriod || {});
    byPeriod[state.period.slice(0, 7)] = Object.assign({}, byPeriod[state.period.slice(0, 7)] || {}, { deductionGrosz: toGrosz(amount) });
    state.ryczaltSettings = { byPeriod };
  }

  function renderTasks() {
    document.querySelectorAll('[data-task]').forEach(input => {
      input.checked = Boolean(state.tasks[input.dataset.task]);
    });
    const complete = Object.values(state.tasks).filter(Boolean).length;
    setText('taskProgress', complete + ' z 3');
  }

  function renderCompany() {
    setTextInput('companyName', state.company.name);
    setTextInput('companyNip', state.company.nip);
    setText('documentCompany', state.company.name);
    setText('documentNip', state.company.nip);
  }

  function formatKsefDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function setKsefPanel(status, title, description, lastSync) {
    const dot = document.getElementById('ksefStatusDot');
    dot.className = 'ksef-status-dot' + (status ? ' ' + status : '');
    setText('ksefStatusTitle', title);
    setText('ksefStatusDescription', description);
    setText('ksefLastSync', formatKsefDate(lastSync));
    const signedIn = Boolean(window.PewnikCloud && window.PewnikCloud.isSignedIn());
    document.getElementById('testKsefConnection').disabled = !signedIn || status === 'loading';
    document.getElementById('syncKsefInvoices').disabled = !signedIn || status === 'loading';
  }

  async function refreshKsefPanel() {
    if (!window.PewnikCloud || !window.PewnikCloud.isSignedIn()) {
      setKsefPanel('', 'Wymaga logowania', 'Zaloguj się do Supabase, aby korzystać z integracji.', null);
      return;
    }
    try {
      const connection = await window.PewnikCloud.getKsefConnection();
      if (!connection) {
        setKsefPanel('', 'Gotowe do konfiguracji', 'Wdróż funkcję i ustaw sekrety KSEF_NIP oraz KSEF_TOKEN.', null);
        return;
      }
      if (connection.status === 'error') {
        setKsefPanel('error', 'Błąd połączenia', connection.last_error || 'Sprawdź konfigurację funkcji KSeF.', connection.last_sync_at);
        return;
      }
      setKsefPanel('connected', 'Połączono z KSeF TEST', 'Kontekst NIP ' + connection.nip + '.', connection.last_sync_at);
    } catch (error) {
      setKsefPanel('error', 'Nie można odczytać konfiguracji', error.message, null);
    }
  }

  async function runKsefAction(action) {
    const nip = state.company.nip.replace(/\D/g, '');
    if (nip.length !== 10 || nip === '0000000000') {
      showToast('Najpierw wpisz syntetyczny, 10-cyfrowy NIP firmy i zapisz ustawienia.', 'info');
      return;
    }
    const isSync = action === 'sync';
    setKsefPanel('loading', isSync ? 'Pobieranie faktur…' : 'Testowanie połączenia…', 'Łączę się z testowym API KSeF.', null);
    try {
      const result = isSync
        ? await window.PewnikCloud.syncKsefInvoices(nip)
        : await window.PewnikCloud.testKsefConnection(nip);
      if (isSync) {
        showToast('KSeF: pobrano ' + result.imported + ' dokumentów (' + result.incoming + ' kosztowych, ' + result.outgoing + ' sprzedażowych).');
      } else {
        showToast('Połączenie z testowym KSeF działa.');
      }
      await refreshKsefPanel();
    } catch (error) {
      setKsefPanel('error', 'Błąd połączenia', error.message, null);
      showToast(error.message, 'error');
    }
  }

  document.querySelectorAll('.nav-item[data-view]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-view-target]');
    if (!button) return;
    event.preventDefault();
    showView(button.dataset.viewTarget);
  });
  document.querySelectorAll('[data-toast]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      showToast(button.dataset.toast, 'info');
    });
  });

  document.getElementById('mobileMenu').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  document.querySelectorAll('.calculation-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const details = button.nextElementSibling;
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      details.classList.toggle('open', !open);
    });
  });

  document.getElementById('previousMonth').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonth').addEventListener('click', () => changeMonth(1));
  document.getElementById('periodButton').addEventListener('click', () => showToast('Użyj strzałek, aby zmienić miesiąc.', 'info'));

  function changeMonth(offset) {
    const date = periodDate();
    date.setMonth(date.getMonth() + offset);
    state.period = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-01';
    updatePeriod();
    fillRuleForm();
    fillVerificationForm();
    renderCalculations();
    persist();
    showToast('Wybrano okres: ' + periodName(), 'info');
  }

  document.getElementById('refreshCalculation').addEventListener('click', event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Sprawdzamy dane…';
    setTimeout(() => {
      renderCalculations();
      button.disabled = false;
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.7-2.2L20 9M4 15l2.2 2.2A7 7 0 0 0 18 15"/></svg>Przelicz ponownie';
      showToast('Obliczenia są aktualne.');
    }, 650);
  });

  document.getElementById('copyTotal').addEventListener('click', async () => {
    const total = calculations().total;
    if (total == null) {
      showToast('Najpierw popraw błędy kalkulatora ryczałtu lub VAT.', 'error');
      return;
    }
    const amount = total.toFixed(2).replace('.', ',');
    try {
      await navigator.clipboard.writeText(amount);
      showToast('Skopiowano kwotę ' + amount + ' zł.');
    } catch (_) {
      showToast('Łączna kwota: ' + amount + ' zł.', 'info');
    }
  });

  document.querySelectorAll('[data-task]').forEach(input => {
    input.addEventListener('change', () => {
      state.tasks[input.dataset.task] = input.checked;
      renderTasks();
      persist();
      if (input.checked) showToast('Oznaczono jako wykonane.');
    });
  });

  document.getElementById('invoiceSearch').addEventListener('input', renderInvoices);
  document.getElementById('invoiceFilter').addEventListener('change', renderInvoices);
  document.getElementById('addInvoice').addEventListener('click', () => {
    const form = document.getElementById('invoiceForm');
    form.reset();
    form.elements.date.value = state.period.slice(0, 7) + '-15';
    form.elements.vatEffectiveDate.value = state.period.slice(0, 7) + '-15';
    setText('vatEffectiveDateText', 'Data sprzedaży / wykonania usługi');
    document.querySelector('.rate-field').style.display = '';
    document.querySelector('.vat-deduction-field').style.display = 'none';
    openModal('invoiceModal');
    setTimeout(() => form.elements.number.focus(), 100);
  });

  document.querySelectorAll('input[name="invoiceType"]').forEach(input => {
    input.addEventListener('change', () => {
      document.querySelector('.rate-field').style.display = input.value === 'sale' && input.checked ? '' : (document.querySelector('input[name="invoiceType"]:checked').value === 'cost' ? 'none' : '');
      const isCost = document.querySelector('input[name="invoiceType"]:checked').value === 'cost';
      document.querySelector('.vat-deduction-field').style.display = isCost ? '' : 'none';
      setText('vatEffectiveDateText', isCost ? 'Data otrzymania' : 'Data sprzedaży / wykonania usługi');
    });
  });

  document.getElementById('invoiceForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const type = data.get('invoiceType');
    const documentType = String(data.get('documentType'));
    const vatCode = String(data.get('vat'));
    const vatRate = Number(vatCode) || 0;
    const effectiveDate = String(data.get('vatEffectiveDate'));
    const prepared = prepareInvoice({
      id: Date.now(),
      number: String(data.get('number')).trim(),
      date: String(data.get('date')),
      contractor: String(data.get('contractor')).trim(),
      type,
      net: data.get('net'),
      vatCode,
      vatRate,
      currency: 'PLN',
      source: 'manual',
      documentType,
      supplyDate: type === 'sale' ? effectiveDate : null,
      taxPointDate: type === 'sale' ? effectiveDate : null,
      receivedDate: type === 'cost' ? effectiveDate : null,
      vatDeductionPercent: type === 'cost' ? Number(data.get('vatDeductionPercent')) : null,
      category: type === 'sale' ? String(data.get('category')) : null
    });
    if (prepared.status === 'INVALID') {
      showToast(prepared.findings[0].message, 'error');
      return;
    }
    const localInvoice = prepared.value;

    try {
      const invoice = window.PewnikCloud
        ? await window.PewnikCloud.createInvoice(localInvoice)
        : localInvoice;
      state.invoices.unshift(invoice);
      persist();
      renderCalculations();
      closeModals();
      showToast('Faktura została dodana i uwzględniona w obliczeniach.');
    } catch (error) {
      showToast('Nie udało się zapisać faktury: ' + error.message, 'error');
    }
  });

  document.getElementById('invoiceTableBody').addEventListener('change', async event => {
    const select = event.target.closest('[data-rate-invoice]');
    if (select) {
      const invoice = state.invoices.find(item => String(item.id) === select.dataset.rateInvoice);
      if (!invoice) return;
      const previousCategory = invoice.category;
      try {
        if (window.PewnikCloud) await window.PewnikCloud.updateInvoiceCategory(invoice.id, select.value);
        invoice.category = select.value;
        persist();
        renderCalculations();
        showToast('Zmieniono stawkę ryczałtu i przeliczono podsumowanie.');
      } catch (error) {
        select.value = previousCategory;
        showToast('Nie udało się zmienić faktury: ' + error.message, 'error');
      }
      return;
    }
    const vatSelect = event.target.closest('[data-vat-deduction-invoice]');
    if (vatSelect) {
      const invoice = state.invoices.find(item => String(item.id) === vatSelect.dataset.vatDeductionInvoice);
      if (!invoice) return;
      const previousPercent = invoice.vatDeductionPercent;
      const percent = Number(vatSelect.value);
      try {
        if (window.PewnikCloud) await window.PewnikCloud.updateInvoiceVatDeduction(invoice.id, percent);
        invoice.vatDeductionPercent = percent;
        invoice.deductibleVatGrosz = null;
        persist();
        renderCalculations();
        showToast('Potwierdzono zakres odliczenia VAT i przeliczono podsumowanie.');
      } catch (error) {
        vatSelect.value = previousPercent == null ? '' : String(previousPercent);
        showToast('Nie udało się zapisać decyzji VAT: ' + error.message, 'error');
      }
    }
  });

  document.getElementById('invoiceTableBody').addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-invoice]');
    if (!button) return;
    try {
      if (window.PewnikCloud) await window.PewnikCloud.deleteInvoice(button.dataset.deleteInvoice);
      state.invoices = state.invoices.filter(invoice => String(invoice.id) !== button.dataset.deleteInvoice);
      persist();
      renderCalculations();
      showToast('Faktura została usunięta.');
    } catch (error) {
      showToast('Nie udało się usunąć faktury: ' + error.message, 'error');
    }
  });

  document.getElementById('saveRules').addEventListener('click', () => {
    readRuleForm();
    fillVerificationForm();
    persist();
    renderCalculations();
    showToast('Reguły zapisano. Wszystkie kwoty zostały przeliczone.');
  });

  document.getElementById('saveCategoryProfiles').addEventListener('click', () => {
    if (!saveCategoryProfiles()) return;
    fillRuleForm();
    persist();
    renderCalculations();
    showToast('Profil działalności zapisano. Będzie używany także w kolejnych miesiącach.');
  });

  document.getElementById('savePeriodDeduction').addEventListener('click', () => {
    savePeriodDeduction();
    persist();
    renderCalculations();
    showToast('Odliczenie zapisano tylko dla wybranego miesiąca.');
  });

  document.getElementById('confirmNoSales').addEventListener('click', () => {
    const period = state.period.slice(0, 7);
    const byPeriod = Object.assign({}, state.ryczaltSettings.byPeriod || {});
    byPeriod[period] = Object.assign({}, byPeriod[period] || {}, { noSalesConfirmed: true });
    state.ryczaltSettings = { byPeriod };
    persist();
    renderCalculations();
    showToast('Potwierdzono miesiąc bez sprzedaży.');
  });

  document.getElementById('restoreRules').addEventListener('click', () => {
    state.rules = Object.assign({}, defaultRules);
    state.vatSettings = Object.assign({}, initialState.vatSettings);
    fillRuleForm();
    fillVerificationForm();
    persist();
    renderCalculations();
    showToast('Przywrócono wartości demonstracyjne.');
  });

  document.getElementById('saveSettings').addEventListener('click', () => {
    const name = document.getElementById('companyName').value.trim();
    const nip = document.getElementById('companyNip').value.replace(/\D/g, '');
    if (!name || nip.length !== 10) {
      showToast('Uzupełnij nazwę i wpisz 10 cyfr NIP.', 'info');
      return;
    }
    state.company = { name, nip };
    renderCompany();
    persist();
    showToast('Ustawienia działalności zostały zapisane.');
  });

  document.getElementById('testKsefConnection').addEventListener('click', () => runKsefAction('status'));
  document.getElementById('syncKsefInvoices').addEventListener('click', () => runKsefAction('sync'));
  window.addEventListener('pewnik:cloud-session', refreshKsefPanel);

  document.querySelectorAll('.modal-close, .declaration-close').forEach(button => button.addEventListener('click', closeModals));
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeModals();
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModals();
  });

  document.querySelectorAll('.preview-declaration').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openModal('declarationModal');
    });
  });

  document.getElementById('downloadDraft').addEventListener('click', () => {
    const calc = calculations();
    if (calc.vatResult.status === 'INVALID') {
      showToast('Nie można przygotować JPK przy błędnym wyniku VAT.', 'error');
      return;
    }
    const content = [
      'PEWNIK — WERSJA ROBOCZA DOKUMENTU',
      'JPK_V7M — podgląd danych',
      '',
      'Podmiot: ' + state.company.name,
      'NIP: ' + state.company.nip,
      'Okres: ' + periodName(),
      'Liczba dokumentów: ' + state.invoices.length,
      'VAT należny: ' + money(calc.salesVat),
      'VAT naliczony: ' + money(calc.costVat),
      'VAT podlegający odliczeniu: ' + money(calc.deductibleVat),
      'VAT do zapłaty: ' + money(calc.vat),
      'Nadwyżka do przeniesienia: ' + money((calc.vatResult.carryForwardGrosz || 0) / 100),
      'Status kalkulatora VAT: ' + calc.vatResult.status,
      '',
      'To plik demonstracyjny, nie jest deklaracją gotową do wysyłki.'
    ].join('\r\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'JPK_V7M_' + state.period.slice(0, 7) + '_WERSJA_ROBOCZA.txt';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Pobrano wersję roboczą dokumentu.');
  });

  updatePeriod();
  fillRuleForm();
  fillVerificationForm();
  renderCompany();
  renderTasks();
  renderCalculations();
  refreshKsefPanel();
  if (window.PewnikCloud) {
    window.PewnikCloud.init({ getState, replaceState, showToast });
  }
  window.PEWNIK_APP_READY = true;
})();
