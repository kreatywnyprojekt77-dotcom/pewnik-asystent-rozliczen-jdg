import { generateMonthlySummary } from './monthly-summary.mjs';
import { prepareInvoice } from './invoice-input.mjs';
import { createDeclarationBundle, generateJpkV7mXml, generateZusDraKeduXml } from './declarations.mjs';
import { validateDeclarationXml } from './declaration-validation.mjs';

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
    { id: 1, number: 'FV/06/2026/01', date: '2026-06-03', supplyDate: '2026-06-03', taxPointDate: '2026-06-03', contractor: 'DEMO — Northbyte Sp. z o.o.', contractorNip: '5210000001', type: 'sale', documentType: 'invoice', net: 12000, vatRate: 23, vatCode: '23', category: 'software' },
    { id: 2, number: 'FV/06/2026/02', date: '2026-06-10', supplyDate: '2026-06-10', taxPointDate: '2026-06-10', contractor: 'DEMO — Orbit Systems S.A.', contractorNip: '5210000002', type: 'sale', documentType: 'invoice', net: 6800, vatRate: 23, vatCode: '23', category: 'software' },
    { id: 3, number: 'FV/06/2026/03', date: '2026-06-18', supplyDate: '2026-06-18', taxPointDate: '2026-06-18', contractor: 'DEMO — Metrum Digital Sp. z o.o.', contractorNip: '5210000003', type: 'sale', documentType: 'invoice', net: 5500, vatRate: 23, vatCode: '23', category: 'consulting' },
    { id: 4, number: 'FV/06/2026/04', date: '2026-06-26', supplyDate: '2026-06-26', taxPointDate: '2026-06-26', contractor: 'DEMO — BluePeak Polska Sp. z o.o.', contractorNip: '5210000004', type: 'sale', documentType: 'invoice', net: 4500, vatRate: 23, vatCode: '23', category: 'software' },
    { id: 5, number: 'K/0626/184', date: '2026-06-12', receivedDate: '2026-06-12', contractor: 'DEMO — Cloud Hosting Polska', contractorNip: '5210000005', type: 'cost', documentType: 'invoice', net: 1800, vatRate: 23, vatCode: '23', vatDeductionPercent: 100, category: null },
    { id: 6, number: 'FVK/1220/06', date: '2026-06-21', receivedDate: '2026-06-21', contractor: 'DEMO — Biuro i Sprzęt Sp. z o.o.', contractorNip: '5210000006', type: 'cost', documentType: 'invoice', net: 800, vatRate: 23, vatCode: '23', vatDeductionPercent: 100, category: null }
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
    onboardingCompleted: false,
    company: { name: 'DEMO — Studio Testowe (dane syntetyczne)', nip: '0000000000' },
    declarationProfile: {
      firstName: '', lastName: '', birthDate: '', pesel: '', regon: '',
      taxOfficeCode: '', email: '', phone: '', zusShortName: '', zusInsuranceTitleCode: '051000'
    }
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
    onboardingCompleted: loaded.onboardingCompleted === true || Boolean(loaded.company && loaded.company.nip && loaded.company.nip !== '0000000000'),
    company: Object.assign({}, initialState.company, loaded.company || {}),
    declarationProfile: Object.assign({}, initialState.declarationProfile, loaded.declarationProfile || {})
  };

  let toastTimer;
  let currentDeclarationKind = 'jpk';
  let declarationValidationRun = 0;
  let onboardingStep = 0;
  let editingInvoiceId = null;
  let currentViewName = 'dashboard';
  const navigationStack = [];

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
    state.onboardingCompleted = nextState.onboardingCompleted === true || Boolean(nextState.company && nextState.company.nip && nextState.company.nip !== '0000000000');
    state.company = Object.assign({}, initialState.company, nextState.company || {});
    state.declarationProfile = Object.assign({}, initialState.declarationProfile, nextState.declarationProfile || {});
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Dane z chmury pozostają dostępne w bieżącej sesji.
    }
    updatePeriod();
    fillRuleForm();
    fillVerificationForm();
    renderCompany();
    fillDeclarationProfile();
    renderTasks();
    renderCalculations();
    refreshOnboarding();
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
    const ryczaltSettings = ryczaltSettingsForPeriod();
    const zusSettings = zusSettingsForPeriod();
    return generateMonthlySummary({
      invoices: state.invoices,
      settlementPeriod,
      vatSettings: {
        openingCarryForwardGrosz: vatSettings.openingCarryForwardGrosz,
        excessMode: vatSettings.excessMode
      },
      ryczaltSettings: {
        deductionGrosz: ryczaltSettings.deductionGrosz,
        ratesPercent: {
          software: state.rules.software,
          consulting: state.rules.consulting
        },
        categoryMetadata: state.categoryProfiles
      },
      zusSettings: {
        healthRevenueDeductionYtdGrosz: zusSettings.healthRevenueDeductionYtdGrosz,
        sicknessInsurance: state.zusSettings.sicknessInsurance !== false
      }
    });
  }

  function declarationBundle() {
    return createDeclarationBundle({
      company: state.company,
      declarationProfile: state.declarationProfile,
      invoices: state.invoices,
      summary: calculations(),
      period: state.period.slice(0, 7)
    });
  }

  function declarationStatusCopy(status) {
    if (status === 'READY') return { label: 'Gotowy do pobrania', className: 'success' };
    if (status === 'REVIEW_REQUIRED') return { label: 'Wymaga sprawdzenia', className: 'warning' };
    return { label: 'Brak wymaganych danych', className: 'error' };
  }

  function fillDeclarationProfile() {
    Object.entries(state.declarationProfile).forEach(([key, value]) => setTextInput('declarationProfile' + key.charAt(0).toUpperCase() + key.slice(1), value));
  }

  function saveDeclarationProfile() {
    const value = key => document.getElementById('declarationProfile' + key.charAt(0).toUpperCase() + key.slice(1)).value.trim();
    state.declarationProfile = {
      firstName: value('firstName'),
      lastName: value('lastName'),
      birthDate: value('birthDate'),
      pesel: value('pesel').replace(/\D/g, ''),
      regon: value('regon').replace(/\D/g, ''),
      taxOfficeCode: value('taxOfficeCode').replace(/\D/g, ''),
      email: value('email'),
      phone: value('phone').replace(/[^\d+]/g, ''),
      zusShortName: value('zusShortName'),
      zusInsuranceTitleCode: value('zusInsuranceTitleCode').replace(/\D/g, '')
    };
  }

  function declarationFindingsHtml(documentData) {
    if (!documentData.findings.length) return '<div class="declaration-ready-note">Wszystkie wymagane dane są kompletne.</div>';
    return '<ul class="declaration-findings">' + documentData.findings.slice(0, 4).map(item =>
      '<li class="' + escapeHtml(item.severity) + '">' + escapeHtml(item.message) + '</li>'
    ).join('') + (documentData.findings.length > 4 ? '<li>oraz ' + (documentData.findings.length - 4) + ' kolejnych uwag</li>' : '') + '</ul>';
  }

  function declarationXml(kind, documentData) {
    if (kind === 'jpk') return generateJpkV7mXml(documentData);
    if (kind === 'zus') return generateZusDraKeduXml(documentData);
    throw new TypeError('Ten dokument nie ma urzędowego pliku XML.');
  }

  async function validateDeclarationCards(bundle) {
    const run = ++declarationValidationRun;
    await Promise.all(['jpk', 'zus'].map(async kind => {
      const documentData = bundle.documents[kind];
      if (documentData.status !== 'READY') return;
      const badge = document.getElementById('declarationStatus-' + kind);
      const buttons = document.querySelectorAll('[data-declaration-xml="' + kind + '"]');
      if (badge) {
        badge.textContent = 'Sprawdzanie XSD…';
        badge.className = 'status-pill warning';
      }
      buttons.forEach(button => { button.disabled = true; });
      try {
        const result = await validateDeclarationXml(kind, declarationXml(kind, documentData));
        if (run !== declarationValidationRun) return;
        if (result.valid) {
          if (badge) {
            badge.textContent = 'Gotowy do pobrania';
            badge.className = 'status-pill success';
          }
          buttons.forEach(button => { button.disabled = false; });
        } else {
          if (badge) {
            badge.textContent = 'Błąd formatu XML';
            badge.className = 'status-pill error';
          }
          const findings = document.getElementById('declarationFindings-' + kind);
          if (findings) findings.innerHTML = '<ul class="declaration-findings"><li class="error">Dokument nie przeszedł oficjalnej walidacji XSD.</li><li>' + escapeHtml(result.errors[0]?.message || 'Sprawdź strukturę XML.') + '</li></ul>';
        }
      } catch (error) {
        if (run !== declarationValidationRun) return;
        if (badge) {
          badge.textContent = 'Nie można sprawdzić XSD';
          badge.className = 'status-pill error';
        }
        const findings = document.getElementById('declarationFindings-' + kind);
        if (findings) findings.innerHTML = '<ul class="declaration-findings"><li class="error">' + escapeHtml(error.message) + '</li></ul>';
      }
    }));
  }

  function renderDeclarations() {
    const bundle = declarationBundle();
    const profileFields = state.declarationProfile;
    const profileComplete = Boolean(
      state.company.name && /^\d{10}$/.test(state.company.nip || '') &&
      profileFields.firstName && profileFields.lastName && /^\d{4}-\d{2}-\d{2}$/.test(profileFields.birthDate || '') &&
      /^\d{11}$/.test(profileFields.pesel || '') && /^\d{9}$/.test(profileFields.regon || '') &&
      /^\d{4}$/.test(profileFields.taxOfficeCode || '') && profileFields.zusShortName &&
      /^\d{6}$/.test(profileFields.zusInsuranceTitleCode || '')
    );
    setText('declarationProfileSummary', profileComplete
      ? 'Profil firmy i właściciela jest uzupełniony. Dokumenty poniżej korzystają z tych danych.'
      : 'Brakuje części danych firmy lub właściciela. Uzupełnij Profil działalności przed pobraniem dokumentów.');
    const amounts = {
      ryczalt: bundle.documents.ryczalt.amountDueGrosz,
      jpk: bundle.documents.jpk.taxDueGrosz,
      zus: bundle.documents.zus.totalDueGrosz
    };
    Object.entries(bundle.documents).forEach(([kind, documentData]) => {
      const status = declarationStatusCopy(documentData.status);
      const badge = document.getElementById('declarationStatus-' + kind);
      if (badge) {
        badge.textContent = status.label;
        badge.className = 'status-pill ' + status.className;
      }
      setText('declarationAmount-' + kind, Number.isSafeInteger(amounts[kind]) ? money(amounts[kind] / 100) : '—');
      const findings = document.getElementById('declarationFindings-' + kind);
      if (findings) findings.innerHTML = declarationFindingsHtml(documentData);
      document.querySelectorAll('[data-declaration-xml="' + kind + '"]').forEach(button => {
        button.disabled = documentData.status !== 'READY';
      });
    });
    void validateDeclarationCards(bundle);
  }

  function downloadTextFile(content, fileName, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function documentPdfDefinition(kind, documentData) {
    const heading = [
      { text: 'PEWNIK', color: '#2457d6', bold: true, fontSize: 10 },
      { text: documentData.title, bold: true, fontSize: 18, margin: [0, 7, 0, 3] },
      { text: 'Okres: ' + documentData.period + '  •  Wersja: ' + documentData.schemaVersion, color: '#657084', fontSize: 9, margin: [0, 0, 0, 18] }
    ];
    const identity = {
      table: {
        widths: ['35%', '*'],
        body: [
          ['Podmiot', state.company.name],
          ['NIP', state.company.nip],
          ['Status', declarationStatusCopy(documentData.status).label]
        ]
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 18]
    };
    let details = [];
    if (kind === 'ryczalt') {
      const rateRows = documentData.rows.length
        ? [{
            table: {
              widths: ['*', 'auto', 'auto'],
              body: [['Stawka', 'Podstawa przed zaokrągleniem', 'Podstawa w pełnych zł'], ...documentData.rows.map(row => [row.label, money(row.baseGrosz / 100), money(row.roundedBasePln)])]
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 12]
          }]
        : [];
      details = [
        { text: 'Ryczałt do wpłaty', style: 'section' },
        { text: money((documentData.amountDueGrosz || 0) / 100), bold: true, fontSize: 20, margin: [0, 4, 0, 12] },
        ...rateRows,
        { text: 'To miesięczna karta rozliczenia. PIT-28 jest zeznaniem rocznym.', color: '#657084', fontSize: 9 }
      ];
    } else if (kind === 'jpk') {
      details = [
        { text: 'Podsumowanie VAT', style: 'section' },
        { table: { widths: ['*', 'auto'], body: [
          ['Liczba dokumentów sprzedaży', documentData.salesRows.length],
          ['Liczba dokumentów zakupu', documentData.purchaseRows.length],
          ['VAT należny', money((documentData.outputVatGrosz || 0) / 100)],
          ['VAT do odliczenia', money((documentData.deductibleInputVatGrosz || 0) / 100)],
          ['VAT do zapłaty', money((documentData.taxDueGrosz || 0) / 100)]
        ] }, layout: 'lightHorizontalLines' }
      ];
    } else {
      details = [
        { text: 'Podsumowanie ZUS DRA', style: 'section' },
        { table: { widths: ['*', 'auto'], body: [
          ['Podstawa składek społecznych', money((documentData.socialBaseGrosz || 0) / 100)],
          ['Składki społeczne', money((documentData.socialInsuranceDueGrosz || 0) / 100)],
          ['Fundusz Pracy i FS', money((documentData.labourFundsDueGrosz || 0) / 100)],
          ['Składka zdrowotna', money((documentData.healthContributionGrosz || 0) / 100)],
          ['Razem', money((documentData.totalDueGrosz || 0) / 100)]
        ] }, layout: 'lightHorizontalLines' }
      ];
    }
    const findings = documentData.findings.length ? [
      { text: 'Uwagi i walidacja', style: 'section', margin: [0, 18, 0, 6] },
      { ul: documentData.findings.map(item => item.message), color: '#7a4d18', fontSize: 9 }
    ] : [];
    return {
      pageSize: 'A4',
      pageMargins: [45, 45, 45, 45],
      content: [...heading, identity, ...details, ...findings, { text: 'Ten PDF jest czytelnym podglądem. Plikiem przeznaczonym do ręcznego importu w narzędziu urzędowym jest XML zweryfikowany schematem XSD.', color: '#8992a0', fontSize: 8, margin: [0, 28, 0, 0] }],
      styles: { section: { bold: true, fontSize: 11, color: '#172033' } },
      defaultStyle: { font: 'Roboto', color: '#172033', fontSize: 10 }
    };
  }

  function downloadDeclarationPdf(kind) {
    const documentData = declarationBundle().documents[kind];
    if (!window.pdfMake) {
      showToast('Generator PDF nie został załadowany. Odśwież aplikację i spróbuj ponownie.', 'error');
      return;
    }
    window.pdfMake.createPdf(documentPdfDefinition(kind, documentData)).download(documentData.kind + '_' + documentData.period + '_PODGLAD.pdf');
    showToast('Przygotowano podgląd PDF.');
  }

  async function downloadDeclarationXml(kind) {
    const documentData = declarationBundle().documents[kind];
    try {
      const xml = declarationXml(kind, documentData);
      showToast('Sprawdzamy dokument z oficjalnym schematem XSD…', 'info');
      const validation = await validateDeclarationXml(kind, xml);
      if (!validation.valid) throw new Error('Dokument nie przeszedł walidacji XSD: ' + (validation.errors[0]?.message || 'nieznany błąd struktury.'));
      const fileName = kind === 'jpk'
        ? 'JPK_V7M_' + documentData.period + '.xml'
        : 'KEDU_ZUS_DRA_' + documentData.period + '.xml';
      downloadTextFile(xml, fileName, 'application/xml;charset=utf-8');
      showToast(kind === 'jpk' ? 'Pobrano zweryfikowany JPK_V7M XML.' : 'Pobrano zweryfikowany plik KEDU z ZUS DRA.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function declarationPreviewHtml(kind, documentData) {
    const amount = kind === 'ryczalt' ? documentData.amountDueGrosz : (kind === 'jpk' ? documentData.taxDueGrosz : documentData.totalDueGrosz);
    const status = declarationStatusCopy(documentData.status);
    const rows = kind === 'jpk'
      ? '<div class="document-grid"><div><span>Sprzedaż</span><strong>' + documentData.salesRows.length + ' pozycji</strong></div><div><span>Zakupy</span><strong>' + documentData.purchaseRows.length + ' pozycji</strong></div></div>'
      : (kind === 'zus'
        ? '<div class="document-grid"><div><span>Składki społeczne</span><strong>' + money((documentData.socialInsuranceDueGrosz || 0) / 100) + '</strong></div><div><span>Składka zdrowotna</span><strong>' + money((documentData.healthContributionGrosz || 0) / 100) + '</strong></div></div>'
        : '<div class="document-grid"><div><span>Wersja reguł</span><strong>' + escapeHtml(documentData.ruleVersion || '—') + '</strong></div><div><span>Charakter dokumentu</span><strong>Karta miesięczna</strong></div></div>');
    return '<div class="document-preview"><div class="document-top"><div class="document-logo">' + (kind === 'jpk' ? 'MF' : (kind === 'zus' ? 'ZUS' : '%')) + '</div><div><span>' + escapeHtml(documentData.schemaVersion) + '</span><strong>' + escapeHtml(documentData.title) + '</strong></div><span class="draft-stamp">PODGLĄD</span></div>' +
      '<div class="document-grid"><div><span>Podmiot</span><strong>' + escapeHtml(state.company.name) + '</strong></div><div><span>NIP</span><strong>' + escapeHtml(state.company.nip) + '</strong></div><div><span>Okres</span><strong>' + escapeHtml(documentData.period) + '</strong></div><div><span>Kwota</span><strong>' + (Number.isSafeInteger(amount) ? money(amount / 100) : '—') + '</strong></div></div>' + rows +
      '<div class="document-summary"><span>Status dokumentu</span><strong>' + escapeHtml(status.label) + '</strong></div>' + declarationFindingsHtml(documentData) + '</div>';
  }

  function openDeclarationPreview(kind) {
    currentDeclarationKind = kind;
    const documentData = declarationBundle().documents[kind];
    setText('declarationTitle', documentData.title);
    document.getElementById('declarationPreviewContent').innerHTML = declarationPreviewHtml(kind, documentData);
    document.getElementById('downloadDeclarationXml').hidden = kind === 'ryczalt';
    document.getElementById('downloadDeclarationXml').disabled = documentData.status !== 'READY';
    document.getElementById('downloadDeclarationXml').textContent = kind === 'zus' ? 'Pobierz KEDU XML' : 'Pobierz XML';
    openModal('declarationModal');
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
    setText('pitDaysLeft', deadlineDistance(pitDeadline));
    setText('zusDaysLeft', deadlineDistance(zusDeadline));
    setText('vatDaysLeft', deadlineDistance(vatDeadline));
    setCalendarDate('pit', pitDeadline);
    setCalendarDate('zus', zusDeadline);
    setCalendarDate('vat', vatDeadline);
    setText('documentPeriod', String(period.getMonth() + 1).padStart(2, '0') + ' / ' + period.getFullYear());
  }

  function setCalendarDate(prefix, date) {
    setText(prefix + 'CalendarDay', String(date.getDate()));
    setText(prefix + 'CalendarMonth', new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(date));
  }

  function deadlineDistance(deadline) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(deadline);
    target.setHours(0, 0, 0, 0);
    const days = Math.round((target - today) / 86400000);
    if (days === 0) return 'dzisiaj';
    if (days === 1) return 'jutro';
    if (days > 1) return 'za ' + days + ' dni';
    if (days === -1) return '1 dzień po terminie';
    return Math.abs(days) + ' dni po terminie';
  }

  function renderCalculations() {
    const calc = calculations();
    const vatSettings = vatSettingsForPeriod();
    const pitResult = calc.components.ryczalt.result;
    const vatResult = calc.components.vat.result;
    const zusResult = calc.components.zus.result;
    const pit = calc.components.ryczalt.dueGrosz == null ? null : calc.components.ryczalt.dueGrosz / 100;
    const vat = calc.components.vat.dueGrosz == null ? null : calc.components.vat.dueGrosz / 100;
    const zus = calc.components.zus.dueGrosz == null ? null : calc.components.zus.dueGrosz / 100;
    const total = calc.payment.totalDueGrosz == null ? null : calc.payment.totalDueGrosz / 100;
    const invalidPit = pitResult.status === 'INVALID';
    const reviewPit = pitResult.status === 'REVIEW_REQUIRED';
    const invalidVat = vatResult.status === 'INVALID';
    const reviewVat = vatResult.status === 'REVIEW_REQUIRED';
    const invalidZus = zusResult.status === 'INVALID';
    const reviewZus = zusResult.status === 'REVIEW_REQUIRED';
    const invalidOverall = calc.status === 'INVALID';
    const reviewOverall = calc.status === 'REVIEW_REQUIRED';
    setText('grandTotal', total == null ? '—' : money(total));
    setText('pitAmount', pit == null ? '—' : money(pit));
    setText('vatAmount', invalidVat || vat == null ? '—' : money(vat));
    setText('zusAmount', invalidZus || zus == null ? '—' : money(zus));
    setText('revenueMetric', calc.metrics.revenueGrosz == null ? '—' : money(calc.metrics.revenueGrosz / 100));
    setText('costMetric', calc.metrics.costNetGrosz == null ? '—' : money(calc.metrics.costNetGrosz / 100));
    setText('vatMetric', invalidVat || vat == null ? '—' : money(vat));
    setText('salesCountMetric', calc.metrics.salesDocumentCount + ' ' + plural(calc.metrics.salesDocumentCount, 'faktura sprzedażowa', 'faktury sprzedażowe', 'faktur sprzedażowych'));
    setText('costCountMetric', calc.metrics.costDocumentCount + ' ' + plural(calc.metrics.costDocumentCount, 'faktura kosztowa', 'faktury kosztowe', 'faktur kosztowych'));
    setText('documentVat', invalidVat || vat == null ? '—' : money(vat));
    const vatDocumentCount = calc.metrics.vatDocumentCount;
    setText('documentInvoiceCount', vatDocumentCount + ' ' + plural(vatDocumentCount, 'pozycja ewidencji', 'pozycje ewidencji', 'pozycji ewidencji'));

    const pitStatus = document.getElementById('pitStatus');
    pitStatus.textContent = invalidPit ? 'Popraw dane' : (reviewPit ? 'Wymaga uwagi' : (pit === 0 ? 'Brak wpłaty' : 'Do zapłaty'));
    pitStatus.className = 'status-pill ' + (invalidPit ? 'error' : (reviewPit ? 'warning' : 'neutral'));
    const vatStatus = document.getElementById('vatStatus');
    vatStatus.textContent = vatResult.status === 'VERIFIED' ? (vatResult.excessGrosz > 0 ? 'Nadwyżka' : (vat === 0 ? 'Brak wpłaty · wyślij JPK' : 'Do zapłaty')) : (vatResult.status === 'INVALID' ? 'Popraw dane' : 'Wymaga uwagi');
    vatStatus.className = 'status-pill ' + (vatResult.status === 'VERIFIED' ? 'neutral' : (vatResult.status === 'INVALID' ? 'error' : 'warning'));
    const zusStatus = document.getElementById('zusStatus');
    zusStatus.textContent = invalidZus ? 'Popraw dane' : (reviewZus ? 'Wymaga uwagi' : (zus === 0 ? 'Brak wpłaty' : 'Do zapłaty'));
    zusStatus.className = 'status-pill ' + (invalidZus ? 'error' : (reviewZus ? 'warning' : 'neutral'));
    setText('calculationReadinessTitle', invalidOverall ? 'Rozliczenie wymaga poprawy danych' : (reviewOverall ? 'Rozliczenie wymaga sprawdzenia' : 'Kwoty zostały obliczone'));
    setText('calculationReadinessDescription', invalidOverall ? 'Poniżej pokazujemy, co trzeba uzupełnić przed przygotowaniem płatności.' : (reviewOverall ? 'Poniżej znajdziesz krótką listę zadań i brakujących informacji.' : 'Nie znaleźliśmy braków technicznych. Sprawdź podsumowanie przed wysłaniem dokumentów i płatnością.'));
    const overallStatus = document.getElementById('overallCalculationStatus');
    overallStatus.textContent = invalidOverall ? 'Błąd' : (reviewOverall ? 'Do weryfikacji' : 'Obliczone');
    overallStatus.className = 'status-pill ' + (invalidOverall ? 'error' : 'warning');
    document.querySelector('.ready-banner').classList.toggle('warning', true);
    document.querySelector('[data-task="transfers"]').disabled = !calc.payment.canCreateTransfers;
    document.querySelector('[data-task="jpk"]').disabled = invalidVat;
    const positivePayments = [pit, vat, zus].filter(value => Number.isFinite(value) && value > 0).length;
    setText('obligationCount', positivePayments + ' ' + plural(positivePayments, 'kwota do zapłaty', 'kwoty do zapłaty', 'kwot do zapłaty'));
    setText('transferTaskTitle', positivePayments ? 'Wykonaj ' + positivePayments + ' ' + plural(positivePayments, 'przelew', 'przelewy', 'przelewów') : 'Brak przelewów podatkowych');
    setText('transferTaskHelp', positivePayments ? 'Pokażemy dane tylko dla kwot większych od zera.' : 'Nadal sprawdź, czy trzeba wysłać JPK_V7M.');
    setText('pitCalendarResult', invalidPit || pit == null ? 'Najpierw popraw dane' : (pit > 0 ? money(pit) + ' do zapłaty' : 'Brak wpłaty'));
    setText('zusCalendarResult', invalidZus || zus == null ? 'Najpierw popraw dane' : (zus > 0 ? money(zus) + ' do zapłaty' : 'Brak wpłaty'));
    setText('vatCalendarResult', invalidVat || vat == null ? 'Najpierw popraw dane' : (vat > 0 ? money(vat) + ' do zapłaty + JPK' : 'Brak wpłaty · JPK wymagany'));

    const pitCategoryRows = pitResult.categoryRows.filter(row => row.currentRevenueGrosz > 0).map(row => {
      const base = row.taxableBaseBeforeRoundingGrosz == null ? '—' : money(row.taxableBaseBeforeRoundingGrosz / 100);
      return '<div class="detail-row"><span>' + escapeHtml(row.name) + ' · przychód ' + money(row.currentRevenueGrosz / 100) + ' · odliczenie ' + money(row.deductionAllocatedGrosz / 100) + '</span><strong>podstawa ' + base + '</strong></div>';
    }).join('');
    const pitRateRows = pitResult.rateRows.map(row =>
      '<div class="detail-row"><span>Podstawa ' + money(row.baseBeforeRoundingGrosz / 100) + ' → ' + money(row.roundedBasePln) + ' × ' + number(row.rateBasisPoints / 100) + '%</span><strong>' + exactTax(row.taxExact.units) + '</strong></div>'
    ).join('');
    const pitFindings = findingSummary(pitResult.findings, 'pit');
    document.getElementById('pitDetails').innerHTML =
      '<div class="detail-row"><span>Przychód netto</span><strong>' + (calc.metrics.revenueGrosz == null ? '—' : money(calc.metrics.revenueGrosz / 100)) + '</strong></div>' +
      '<div class="detail-row"><span>Odliczenie od przychodu</span><strong>' + (calc.metrics.ryczaltDeductionGrosz == null ? '—' : '− ' + money(calc.metrics.ryczaltDeductionGrosz / 100)) + '</strong></div>' +
      pitCategoryRows + pitRateRows +
      '<div class="detail-row"><span>' + (reviewPit ? 'Ryczałt — do weryfikacji' : 'Ryczałt do zapłaty') + '</span><strong>' + (pit == null ? '—' : money(pit)) + '</strong></div>' +
      pitFindings;

    document.getElementById('vatDetails').innerHTML =
      '<div class="detail-row"><span>VAT należny ze sprzedaży</span><strong>' + (calc.metrics.outputVatGrosz == null ? '—' : money(calc.metrics.outputVatGrosz / 100)) + '</strong></div>' +
      '<div class="detail-row"><span>VAT naliczony z zakupów</span><strong>' + (calc.metrics.inputVatGrosz == null ? '—' : money(calc.metrics.inputVatGrosz / 100)) + '</strong></div>' +
      '<div class="detail-row"><span>VAT podlegający odliczeniu</span><strong>− ' + (calc.metrics.deductibleInputVatGrosz == null ? '—' : money(calc.metrics.deductibleInputVatGrosz / 100)) + '</strong></div>' +
      '<div class="detail-row"><span>Nadwyżka z poprzedniego okresu</span><strong>− ' + money(vatSettings.openingCarryForwardGrosz / 100) + '</strong></div>' +
      (vatResult.excessGrosz > 0
        ? '<div class="detail-row"><span>Nadwyżka VAT</span><strong>' + money(vatResult.excessGrosz / 100) + '</strong></div><div class="detail-row"><span>' + (vatSettings.excessMode === 'REFUND' ? 'Wnioskowany zwrot' : 'Do przeniesienia') + '</span><strong>' + money((vatSettings.excessMode === 'REFUND' ? vatResult.refundRequestedGrosz : vatResult.carryForwardGrosz) / 100) + '</strong></div>'
        : '<div class="detail-row"><span>VAT do zapłaty</span><strong>' + (vat == null ? '—' : money(vat)) + '</strong></div>') +
      findingSummary(vatResult.findings, 'vat');

    const zusSocialRows = zusResult.socialRows.map(row =>
      '<div class="detail-row"><span>' + escapeHtml(row.label) + ' · ' + number(row.rateBasisPoints / 100) + '%</span><strong>' + money(row.amountGrosz / 100) + '</strong></div>'
    ).join('');
    document.getElementById('zusDetails').innerHTML =
      '<div class="detail-row"><span>Podstawa składek społecznych</span><strong>' + (zusResult.socialBaseGrosz == null ? '—' : money(zusResult.socialBaseGrosz / 100)) + '</strong></div>' +
      zusSocialRows +
      '<div class="detail-row"><span>Przychód dla zdrowotnej narastająco</span><strong>' + (zusResult.healthRevenueYtdGrosz == null ? '—' : money(zusResult.healthRevenueYtdGrosz / 100)) + '</strong></div>' +
      '<div class="detail-row"><span>Składka zdrowotna</span><strong>' + (zusResult.healthContributionGrosz == null ? '—' : money(zusResult.healthContributionGrosz / 100)) + '</strong></div>' +
      '<div class="detail-row"><span>Składki do zapłaty</span><strong>' + (zus == null ? '—' : money(zus)) + '</strong></div>' +
      findingSummary(zusResult.findings.filter(item => item.severity !== 'info'), 'zus');

    renderInvoices();
    renderVerification(calc);
    renderDeclarations();
    renderPeriodHistory();
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
      ? 'Sprawdź poniżej profil kategorii lub dane tego miesiąca.'
      : (area === 'zus'
        ? 'Sprawdź profil ZUS i przychód narastający wykorzystany do obliczeń.'
        : 'Sprawdź faktury i decyzje dotyczące VAT.');
    const rows = [...grouped.values()].map(({ item, count }) =>
      '<div class="technical-finding"><strong>' + escapeHtml(item.code) + (count > 1 ? ' × ' + count : '') + '</strong><span>' + escapeHtml(item.message) + '</span></div>'
    ).join('');
    return '<div class="verification-prompt"><strong>Wymaga Twojej uwagi</strong><span>' + actionText + '</span><button type="button" class="text-button" data-scroll-target="dashboardVerificationPanel">Zobacz, co zrobić →</button></div>' +
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
    const declarationProfile = state.declarationProfile || {};
    const identityProfileReady = Boolean(
      state.company.name && /^\d{10}$/.test(state.company.nip || '') && state.company.nip !== '0000000000' &&
      declarationProfile.firstName && declarationProfile.lastName && /^\d{4}-\d{2}-\d{2}$/.test(declarationProfile.birthDate || '') &&
      /^\d{11}$/.test((declarationProfile.pesel || '').replace(/\D/g, '')) &&
      /^\d{9}$/.test((declarationProfile.regon || '').replace(/\D/g, '')) &&
      declarationProfile.zusShortName && declarationProfile.zusShortName.length <= 31 &&
      /^\d{4}$/.test(declarationProfile.taxOfficeCode || '') &&
      /^\d{6}$/.test((declarationProfile.zusInsuranceTitleCode || '').replace(/\D/g, ''))
    );
    const profileReady = identityProfileReady && incompleteProfiles.length === 0;
    const deductionGrosz = ryczaltSettingsForPeriod().deductionGrosz;
    const deductionBlocked = calc.components.ryczalt.result.findings.some(item =>
      item.code === 'DEDUCTION_EXCEEDS_CATEGORY_REVENUE' || item.code === 'DEDUCTION_WITHOUT_REVENUE'
    );
    const vatNeedsReview = calc.components.vat.status !== 'VERIFIED';
    const taskCount = (profileReady ? 0 : 1) + (salesReady ? 0 : 1) + (deductionBlocked ? 1 : 0) + (vatNeedsReview ? 1 : 0);

    setText('verificationOpenCount', taskCount);
    setText('verificationOpenLabel', plural(taskCount, 'rzecz do zrobienia', 'rzeczy do zrobienia', 'rzeczy do zrobienia'));
    setText('dashboardVerificationTitle', taskCount ? 'Dokończ rozliczenie krok po kroku' : 'Wszystkie podstawowe informacje są sprawdzone');
    setText('verificationSalesCount', currentSales.length + ' ' + plural(currentSales.length, 'faktura sprzedażowa', 'faktury sprzedażowe', 'faktur sprzedażowych'));
    setText('verificationDeductionValue', money(deductionGrosz / 100));
    setText('verificationVatStatus', vatNeedsReview ? 'Wymaga sprawdzenia' : 'Gotowe');
    setText('verificationProfileStatus', profileReady ? 'Profil kompletny' : 'Brakuje danych potrzebnych do deklaracji');
    setText('verificationProfileHelp', profileReady
      ? 'Dane firmy, właściciela i rodzajów usług są gotowe do użycia.'
      : (!identityProfileReady && incompleteProfiles.length
        ? 'Uzupełnij dane firmy i właściciela oraz potwierdź stawki dla swoich usług.'
        : (!identityProfileReady
          ? 'Uzupełnij dane firmy i właściciela potrzebne do JPK_V7M i ZUS DRA.'
          : 'Potwierdź PKWiU, stawkę i źródło dla używanych rodzajów usług.')));

    const overall = document.getElementById('verificationOverallStatus');
    overall.textContent = taskCount ? 'Wymaga uwagi' : 'Wszystko sprawdzone';
    overall.className = 'status-pill ' + (taskCount ? 'warning' : 'success');
    document.getElementById('dashboardVerificationPanel').classList.toggle('complete', taskCount === 0);
    document.getElementById('readinessAction').hidden = taskCount === 0;

    const profileTask = document.getElementById('verificationProfileTask');
    profileTask.classList.toggle('complete', profileReady);
    profileTask.classList.toggle('attention', !profileReady);

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
    const periodFilter = document.getElementById('invoicePeriodFilter').value;
    const selectedPeriod = state.period.slice(0, 7);
    const filtered = state.invoices.filter(invoice => {
      const matchesQuery = invoice.number.toLowerCase().includes(query) || invoice.contractor.toLowerCase().includes(query);
      const matchesFilter = filter === 'all' || invoice.type === filter || (filter === 'review' && invoiceNeedsReview(invoice));
      const matchesPeriod = periodFilter === 'all' || invoicePeriod(invoice) === selectedPeriod;
      return matchesQuery && matchesFilter && matchesPeriod;
    });

    const currentPeriodInvoices = state.invoices.filter(invoice => invoicePeriod(invoice) === selectedPeriod);
    const attentionCount = currentPeriodInvoices.filter(invoiceNeedsReview).length;
    setText('invoiceAttentionCount', attentionCount);
    setText('invoiceAttentionTitle', attentionCount
      ? attentionCount + ' ' + plural(attentionCount, 'faktura wymaga uwagi', 'faktury wymagają uwagi', 'faktur wymaga uwagi')
      : 'Wszystkie faktury są sprawdzone');
    setText('invoiceAttentionText', attentionCount
      ? 'Uzupełnij NIP, rodzaj usługi lub decyzję o odliczeniu VAT. Aplikacja wskaże brakujące pole w tabeli.'
      : 'Dokumenty tego miesiąca mają komplet podstawowych informacji potrzebnych do obliczeń.');
    const attentionBar = document.getElementById('invoiceAttentionBar');
    attentionBar.classList.toggle('complete', attentionCount === 0);
    document.getElementById('showReviewInvoices').hidden = attentionCount === 0;

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
      const editLabel = invoiceNeedsReview(invoice) ? 'Uzupełnij' : 'Edytuj';
      const deleteControl = '<div class="invoice-row-actions"><button type="button" class="text-button edit-invoice" data-edit-invoice="' + invoice.id + '">' + editLabel + '</button>' + (invoice.source === 'ksef'
        ? '<span class="ksef-origin" title="Dane źródłowe pozostają w KSeF">KSeF</span>'
        : '<button class="icon-button delete-invoice" data-delete-invoice="' + invoice.id + '" data-invoice-number="' + escapeHtml(invoice.number) + '" aria-label="Usuń fakturę ' + escapeHtml(invoice.number) + '">×</button>') + '</div>';
      return '<tr>' +
        '<td class="document-cell"><strong>' + escapeHtml(invoice.number) + origin + '</strong><small>' + date + '</small>' + ksefNumber + '</td>' +
        '<td class="contractor-cell"><strong>' + escapeHtml(invoice.contractor) + '</strong><label class="nip-inline">NIP <input value="' + escapeHtml(invoice.contractorNip || '') + '" data-contractor-nip-invoice="' + invoice.id + '" inputmode="numeric" maxlength="10" placeholder="uzupełnij"></label></td>' +
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

  function updateBackNavigation() {
    document.getElementById('backNavigation').hidden = navigationStack.length === 0;
  }

  function showView(name, options = {}) {
    const view = document.getElementById(name + 'View');
    if (!view) return;
    if (!options.fromHistory && name !== currentViewName) navigationStack.push(currentViewName);
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const nav = document.querySelector('.nav-item[data-view="' + name + '"]');
    view.classList.add('active');
    if (nav) nav.classList.add('active');
    currentViewName = name;
    updateBackNavigation();
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('periodPicker').hidden = true;
    closeAssistant();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function invoiceNeedsReview(invoice) {
    if (!invoice) return false;
    if (!invoice.contractorNip || !/^\d{10}$/.test(String(invoice.contractorNip).replace(/\D/g, ''))) return true;
    if (invoice.type === 'sale') return !invoice.category;
    return invoice.type === 'cost' && ![0, 50, 100].includes(Number(invoice.vatDeductionPercent));
  }

  function renderPeriodHistory() {
    const container = document.getElementById('periodHistoryList');
    if (!container) return;
    const selected = state.period.slice(0, 7);
    const periods = [...new Set([selected, ...state.invoices.map(invoicePeriod).filter(Boolean)])]
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 6);
    container.innerHTML = periods.map(period => {
      const date = new Date(period + '-01T12:00:00');
      const label = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(date);
      const count = state.invoices.filter(invoice => invoicePeriod(invoice) === period).length;
      const isSelected = period === selected;
      return '<button type="button" class="period-history-item' + (isSelected ? ' selected' : '') + '" data-period-value="' + period + '">' +
        '<span class="period-history-status">' + (isSelected ? 'Wybrany miesiąc' : 'Dane zapisane') + '</span>' +
        '<strong>' + escapeHtml(label.charAt(0).toUpperCase() + label.slice(1)) + '</strong>' +
        '<small>' + count + ' ' + plural(count, 'dokument', 'dokumenty', 'dokumentów') + '</small></button>';
    }).join('');
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
      const authRequired = modal.id === 'authModal' && window.PewnikCloud && !window.PewnikCloud.isSignedIn();
      if (authRequired) return;
      modal.classList.remove('visible');
      modal.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = document.querySelector('.modal-backdrop.visible') ? 'hidden' : '';
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
    setText('dashboardGreeting', state.declarationProfile.firstName
      ? 'Dzień dobry, ' + state.declarationProfile.firstName
      : 'Twoje rozliczenie miesiąca');
    const requiredValues = [
      state.company.name && !state.company.name.startsWith('DEMO'),
      /^\d{10}$/.test(state.company.nip || '') && state.company.nip !== '0000000000',
      state.declarationProfile.firstName,
      state.declarationProfile.lastName,
      state.declarationProfile.taxOfficeCode,
      isCategoryProfileComplete('software') || isCategoryProfileComplete('consulting')
    ];
    const completion = Math.round(requiredValues.filter(Boolean).length / requiredValues.length * 100);
    setText('profileCompletion', completion + '%');
  }

  const assistantTopics = {
    taxation: {
      eyebrow: 'Wybór sposobu rozliczeń',
      title: 'Forma opodatkowania zależy od Twojej sytuacji',
      answer: '<p>Porównaj przede wszystkim poziom kosztów, rodzaj usług, przewidywany dochód i możliwość korzystania z ulg. Ten prototyp obsługuje tylko ryczałt, czynny VAT i standardowy ZUS — nie oznacza to, że ten wariant jest najlepszy dla Ciebie.</p><p><strong>Co przygotować:</strong> prognozę przychodów i kosztów, opis usług oraz informację o innych dochodach. Przed zmianą formy potwierdź wybór z księgową lub doradcą.</p><a href="https://www.podatki.gov.pl/pit/" target="_blank" rel="noreferrer">Sprawdź oficjalne informacje o PIT ↗</a>'
    },
    pkwiu: {
      eyebrow: 'Klasyfikacja usług',
      title: 'PKWiU opisuje rzeczywiście wykonywaną usługę',
      answer: '<p>Nie wybieraj kodu wyłącznie na podstawie nazwy zawodu. Liczy się zakres czynności wykonywanych dla klienta, a podobnie brzmiące usługi mogą mieć inne stawki ryczałtu.</p><p><strong>Bezpieczna ścieżka:</strong> opisz usługę, sprawdź klasyfikację GUS, zapisz źródło i okres obowiązywania, a przy wątpliwości poproś o opinię księgowej lub interpretację.</p><a href="https://stat.gov.pl/Klasyfikacje/" target="_blank" rel="noreferrer">Klasyfikacje GUS ↗</a>'
    },
    vat: {
      eyebrow: 'Faktura kosztowa',
      title: 'Zakres odliczenia VAT wymaga decyzji',
      answer: '<p><strong>100%</strong> zwykle oznacza zakup wykorzystywany wyłącznie w działalności opodatkowanej. <strong>50%</strong> bywa stosowane m.in. przy mieszanym użyciu niektórych pojazdów. <strong>0%</strong> wybierz, gdy VAT nie podlega odliczeniu.</p><p>To uproszczenie edukacyjne. Charakter wydatku, sposób wykorzystania i ograniczenia ustawowe mogą zmienić wynik.</p><a href="https://www.podatki.gov.pl/vat/" target="_blank" rel="noreferrer">Informacje o VAT ↗</a>'
    },
    monthly: {
      eyebrow: 'Rutyna miesięczna',
      title: 'Zamykaj miesiąc w tej samej kolejności',
      answer: '<ol><li>Na Podsumowaniu sprawdź, co wymaga uwagi.</li><li>Dodaj lub pobierz wszystkie faktury.</li><li>Uzupełnij wskazane klasyfikacje i decyzje VAT.</li><li>Wróć do Podsumowania i sprawdź obliczone kwoty.</li><li>W Deklaracjach i płatnościach przygotuj dokumenty, wykonaj płatności i zachowaj potwierdzenia.</li></ol>'
    }
  };

  function openAssistant(topic) {
    const panel = document.getElementById('assistantPanel');
    const overlay = document.getElementById('assistantOverlay');
    const content = assistantTopics[topic];
    if (content) {
      setText('assistantEyebrow', content.eyebrow);
      setText('assistantTitle', content.title);
      document.getElementById('assistantAnswer').innerHTML = content.answer;
    }
    panel.classList.add('visible');
    panel.setAttribute('aria-hidden', 'false');
    overlay.hidden = false;
  }

  function closeAssistant() {
    document.getElementById('assistantPanel').classList.remove('visible');
    document.getElementById('assistantPanel').setAttribute('aria-hidden', 'true');
    document.getElementById('assistantOverlay').hidden = true;
  }

  function updateOnboardingStep() {
    document.querySelectorAll('.onboarding-step').forEach((step, index) => step.classList.toggle('active', index === onboardingStep));
    document.querySelectorAll('.onboarding-progress span').forEach((step, index) => step.classList.toggle('active', index <= onboardingStep));
    document.getElementById('onboardingBack').disabled = onboardingStep === 0;
    document.getElementById('onboardingNext').hidden = onboardingStep === 3;
    document.getElementById('onboardingFinish').hidden = onboardingStep !== 3;
  }

  function openOnboardingWizard() {
    const form = document.getElementById('onboardingForm');
    form.elements.onboardingCompany.value = state.company.nip === '0000000000' ? '' : state.company.name;
    form.elements.onboardingNip.value = state.company.nip === '0000000000' ? '' : state.company.nip;
    form.elements.onboardingFirstName.value = state.declarationProfile.firstName;
    form.elements.onboardingLastName.value = state.declarationProfile.lastName;
    onboardingStep = 0;
    updateOnboardingStep();
    openModal('onboardingModal');
  }

  function refreshOnboarding(event) {
    const modal = document.getElementById('onboardingModal');
    const isSignedIn = Boolean(window.PewnikCloud && window.PewnikCloud.isSignedIn());
    const forceOnboarding = Boolean(event && event.detail && event.detail.forceOnboarding);
    if ((state.onboardingCompleted && !forceOnboarding) || !isSignedIn) {
      modal.classList.remove('visible');
      modal.setAttribute('aria-hidden', 'true');
      if (!document.querySelector('.modal-backdrop.visible')) document.body.style.overflow = '';
      return;
    }
    openOnboardingWizard();
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
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-scroll-target]');
    if (!button) return;
    event.preventDefault();
    showView('dashboard');
    const target = document.getElementById(button.dataset.scrollTarget);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelectorAll('[data-toast]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      showToast(button.dataset.toast, 'info');
    });
  });
  document.getElementById('openAssistant').addEventListener('click', () => openAssistant('monthly'));
  document.getElementById('restartOnboarding').addEventListener('click', openOnboardingWizard);
  document.getElementById('sidebarTutorial').addEventListener('click', openOnboardingWizard);
  document.getElementById('backNavigation').addEventListener('click', () => {
    const previousView = navigationStack.pop();
    if (!previousView) return;
    showView(previousView, { fromHistory: true });
  });
  document.getElementById('closeAssistant').addEventListener('click', closeAssistant);
  document.getElementById('assistantOverlay').addEventListener('click', closeAssistant);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-assistant-topic]');
    if (!button) return;
    event.preventDefault();
    openAssistant(button.dataset.assistantTopic);
  });

  document.getElementById('onboardingNext').addEventListener('click', () => {
    const form = document.getElementById('onboardingForm');
    if (onboardingStep === 0) {
      const company = form.elements.onboardingCompany.value.trim();
      const nip = form.elements.onboardingNip.value.replace(/\D/g, '');
      if (!company || nip.length !== 10) {
        showToast('Podaj nazwę firmy i 10 cyfr NIP, aby przejść dalej.', 'error');
        return;
      }
    }
    if (onboardingStep === 1 && !form.elements.onboardingTaxConfirmed.checked) {
      showToast('Potwierdź, że rozumiesz ograniczenie prototypu.', 'info');
      return;
    }
    onboardingStep = Math.min(3, onboardingStep + 1);
    updateOnboardingStep();
  });
  document.getElementById('onboardingBack').addEventListener('click', () => {
    onboardingStep = Math.max(0, onboardingStep - 1);
    updateOnboardingStep();
  });
  document.getElementById('onboardingLater').addEventListener('click', () => {
    closeModals();
    showToast('Możesz wrócić do konfiguracji w Profilu działalności.', 'info');
  });
  document.getElementById('onboardingForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const wasDemoProfile = state.company.nip === '0000000000';
    state.company = {
      name: form.elements.onboardingCompany.value.trim(),
      nip: form.elements.onboardingNip.value.replace(/\D/g, '')
    };
    state.declarationProfile.firstName = form.elements.onboardingFirstName.value.trim();
    state.declarationProfile.lastName = form.elements.onboardingLastName.value.trim();
    const category = form.elements.onboardingCategory.value;
    const pkwiu = form.elements.onboardingPkwiu.value.trim();
    if (pkwiu && state.categoryProfiles[category]) state.categoryProfiles[category].pkwiu = pkwiu;
    if (wasDemoProfile) {
      state.invoices = [];
      state.tasks = Object.assign({}, initialState.tasks);
      state.ryczaltSettings = { byPeriod: {} };
    }
    state.onboardingCompleted = true;
    persist();
    fillVerificationForm();
    fillDeclarationProfile();
    renderCompany();
    renderTasks();
    renderCalculations();
    closeModals();
    showView('settings');
    showToast('Podstawowa konfiguracja została zapisana. Uzupełnij brakujące pola profilu.');
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
  document.getElementById('periodButton').addEventListener('click', () => {
    const picker = document.getElementById('periodPicker');
    document.getElementById('periodPickerInput').value = state.period.slice(0, 7);
    picker.hidden = !picker.hidden;
  });
  document.getElementById('applyPeriod').addEventListener('click', () => {
    const selected = document.getElementById('periodPickerInput').value;
    if (!/^\d{4}-\d{2}$/.test(selected)) return;
    state.period = selected + '-01';
    document.getElementById('periodPicker').hidden = true;
    updatePeriod();
    fillRuleForm();
    fillVerificationForm();
    renderCalculations();
    persist();
    showToast('Wybrano okres: ' + periodName(), 'info');
  });

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
    const summary = calculations();
    if (!summary.payment.canCreateTransfers) {
      showToast('Najpierw zakończ weryfikację rozliczenia VAT, ryczałtu i ZUS.', 'error');
      return;
    }
    const total = summary.payment.totalDueGrosz / 100;
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
  document.getElementById('invoicePeriodFilter').addEventListener('change', renderInvoices);
  document.getElementById('showReviewInvoices').addEventListener('click', () => {
    document.getElementById('invoicePeriodFilter').value = 'period';
    document.getElementById('invoiceFilter').value = 'review';
    renderInvoices();
    document.querySelector('.table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('periodHistoryList').addEventListener('click', event => {
    const button = event.target.closest('[data-period-value]');
    if (!button) return;
    state.period = button.dataset.periodValue + '-01';
    updatePeriod();
    fillRuleForm();
    fillVerificationForm();
    renderCalculations();
    persist();
    showView('dashboard');
  });
  function configureInvoiceType(type) {
    const isCost = type === 'cost';
    document.querySelector('.rate-field').style.display = isCost ? 'none' : '';
    document.querySelector('.vat-deduction-field').style.display = isCost ? '' : 'none';
    setText('vatEffectiveDateText', isCost ? 'Data otrzymania' : 'Data sprzedaży / wykonania usługi');
  }

  function setInvoiceSourceLock(form, locked) {
    ['number', 'date', 'vatEffectiveDate', 'contractor', 'contractorNip', 'net'].forEach(name => {
      form.elements[name].readOnly = locked;
    });
    form.querySelectorAll('input[name="invoiceType"]').forEach(input => { input.disabled = locked; });
    form.elements.documentType.disabled = locked;
    form.elements.vat.disabled = locked;
  }

  function openNewInvoiceForm() {
    const form = document.getElementById('invoiceForm');
    editingInvoiceId = null;
    form.reset();
    setInvoiceSourceLock(form, false);
    form.elements.date.value = state.period.slice(0, 7) + '-15';
    form.elements.vatEffectiveDate.value = state.period.slice(0, 7) + '-15';
    configureInvoiceType('sale');
    setText('invoiceModalEyebrow', 'Nowy dokument');
    setText('invoiceModalTitle', 'Dodaj fakturę');
    setText('invoiceSubmitButton', 'Dodaj do rozliczenia');
    document.getElementById('invoiceEditHint').hidden = true;
    openModal('invoiceModal');
    setTimeout(() => form.elements.number.focus(), 100);
  }

  function openInvoiceEditor(invoice) {
    const form = document.getElementById('invoiceForm');
    editingInvoiceId = String(invoice.id);
    form.reset();
    form.elements.invoiceType.value = invoice.type;
    form.elements.number.value = invoice.number || '';
    form.elements.date.value = invoice.date || '';
    form.elements.documentType.value = invoice.documentType || 'invoice';
    form.elements.vatEffectiveDate.value = invoice.type === 'sale'
      ? (invoice.taxPointDate || invoice.supplyDate || invoice.date || '')
      : (invoice.receivedDate || invoice.date || '');
    form.elements.contractor.value = invoice.contractor || '';
    form.elements.contractorNip.value = invoice.contractorNip || '';
    form.elements.net.value = Number.isFinite(Number(invoice.net)) ? Number(invoice.net).toFixed(2) : '';
    form.elements.vat.value = invoice.vatCode || String(Number(invoice.vatRate || 0));
    if (invoice.category) form.elements.category.value = invoice.category;
    if (invoice.vatDeductionPercent != null) form.elements.vatDeductionPercent.value = String(invoice.vatDeductionPercent);
    configureInvoiceType(invoice.type);
    const fromKsef = invoice.source === 'ksef';
    setInvoiceSourceLock(form, fromKsef);
    setText('invoiceModalEyebrow', fromKsef ? 'Dokument z KSeF' : 'Edycja dokumentu');
    setText('invoiceModalTitle', fromKsef ? 'Sprawdź klasyfikację faktury' : 'Edytuj fakturę');
    setText('invoiceSubmitButton', fromKsef ? 'Zapisz klasyfikację' : 'Zapisz zmiany');
    const hint = document.getElementById('invoiceEditHint');
    hint.hidden = false;
    hint.textContent = fromKsef
      ? 'Danych źródłowych faktury z KSeF nie zmieniamy. Możesz uzupełnić rodzaj usługi albo decyzję o odliczeniu VAT.'
      : 'Możesz poprawić dane dokumentu oraz jego klasyfikację. Po zapisaniu wszystkie kwoty zostaną przeliczone.';
    openModal('invoiceModal');
  }

  document.getElementById('addInvoice').addEventListener('click', openNewInvoiceForm);

  document.querySelectorAll('input[name="invoiceType"]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) configureInvoiceType(input.value);
    });
  });

  document.getElementById('invoiceForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const existingInvoice = editingInvoiceId
      ? state.invoices.find(invoice => String(invoice.id) === editingInvoiceId)
      : null;
    const sourceLocked = existingInvoice && existingInvoice.source === 'ksef';
    const type = sourceLocked ? existingInvoice.type : String(data.get('invoiceType'));
    const documentType = sourceLocked ? (existingInvoice.documentType || 'invoice') : String(data.get('documentType'));
    const vatCode = sourceLocked ? String(existingInvoice.vatCode || existingInvoice.vatRate) : String(data.get('vat'));
    const vatRate = Number(vatCode) || 0;
    const effectiveDate = sourceLocked
      ? (type === 'sale'
        ? (existingInvoice.taxPointDate || existingInvoice.supplyDate || existingInvoice.date)
        : (existingInvoice.receivedDate || existingInvoice.date))
      : String(data.get('vatEffectiveDate'));
    const prepared = prepareInvoice({
      id: existingInvoice ? existingInvoice.id : Date.now(),
      number: sourceLocked ? existingInvoice.number : String(data.get('number')).trim(),
      date: sourceLocked ? existingInvoice.date : String(data.get('date')),
      contractor: sourceLocked ? existingInvoice.contractor : String(data.get('contractor')).trim(),
      contractorNip: sourceLocked ? existingInvoice.contractorNip : String(data.get('contractorNip')).replace(/\D/g, ''),
      type,
      net: sourceLocked ? existingInvoice.net : data.get('net'),
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
      if (existingInvoice) {
        const updatedInvoice = Object.assign({}, existingInvoice, localInvoice, {
          id: existingInvoice.id,
          source: existingInvoice.source
        });
        if (window.PewnikCloud) {
          if (sourceLocked) {
            if (type === 'sale') await window.PewnikCloud.updateInvoiceCategory(existingInvoice.id, updatedInvoice.category);
            if (type === 'cost') await window.PewnikCloud.updateInvoiceVatDeduction(existingInvoice.id, updatedInvoice.vatDeductionPercent);
          } else {
            await window.PewnikCloud.updateInvoice(existingInvoice.id, updatedInvoice);
          }
        }
        state.invoices = state.invoices.map(invoice => String(invoice.id) === editingInvoiceId ? updatedInvoice : invoice);
        editingInvoiceId = null;
        persist();
        renderCalculations();
        closeModals();
        showToast('Zapisano zmiany faktury i przeliczono miesiąc.');
        return;
      }
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
    const nipInput = event.target.closest('[data-contractor-nip-invoice]');
    if (nipInput) {
      const invoice = state.invoices.find(item => String(item.id) === nipInput.dataset.contractorNipInvoice);
      if (!invoice) return;
      const previousNip = invoice.contractorNip || '';
      const contractorNip = nipInput.value.replace(/\D/g, '');
      if (contractorNip.length !== 10) {
        nipInput.value = previousNip;
        showToast('NIP kontrahenta musi mieć 10 cyfr.', 'error');
        return;
      }
      try {
        if (window.PewnikCloud) await window.PewnikCloud.updateInvoiceContractorNip(invoice.id, contractorNip);
        invoice.contractorNip = contractorNip;
        persist();
        renderCalculations();
        showToast('Zapisano NIP kontrahenta.');
      } catch (error) {
        nipInput.value = previousNip;
        showToast('Nie udało się zapisać NIP-u: ' + error.message, 'error');
      }
      return;
    }
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
    const editButton = event.target.closest('[data-edit-invoice]');
    if (editButton) {
      const invoice = state.invoices.find(item => String(item.id) === editButton.dataset.editInvoice);
      if (invoice) openInvoiceEditor(invoice);
      return;
    }
    const button = event.target.closest('[data-delete-invoice]');
    if (!button) return;
    const invoiceNumber = button.dataset.invoiceNumber || '';
    if (!window.confirm('Usunąć fakturę ' + invoiceNumber + '? Tej operacji nie można cofnąć.')) return;
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
    showToast('Ustawienie VAT zapisano dla wybranego miesiąca.');
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

  document.getElementById('saveCategoryProfiles').addEventListener('click', () => {
    const name = document.getElementById('companyName').value.trim();
    const nip = document.getElementById('companyNip').value.replace(/\D/g, '');
    if (!name || nip.length !== 10) {
      showToast('Uzupełnij nazwę firmy i wpisz 10 cyfr NIP.', 'error');
      document.getElementById(!name ? 'companyName' : 'companyNip').focus();
      return;
    }
    state.company = { name, nip };
    saveDeclarationProfile();
    if (!saveCategoryProfiles()) return;
    state.onboardingCompleted = true;
    fillRuleForm();
    renderCompany();
    persist();
    renderCalculations();
    showToast('Cały profil działalności został zapisany.');
  });

  document.getElementById('testKsefConnection').addEventListener('click', () => runKsefAction('status'));
  document.getElementById('syncKsefInvoices').addEventListener('click', () => runKsefAction('sync'));
  window.addEventListener('pewnik:cloud-session', refreshKsefPanel);
  window.addEventListener('pewnik:cloud-session', refreshOnboarding);

  document.querySelectorAll('.modal-close, .declaration-close').forEach(button => button.addEventListener('click', closeModals));
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeModals();
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeModals();
      closeAssistant();
      document.getElementById('periodPicker').hidden = true;
    }
  });

  document.querySelectorAll('.preview-declaration').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openDeclarationPreview(button.dataset.type === 'JPK_V7M' ? 'jpk' : (button.dataset.declarationPreview || 'jpk'));
    });
  });

  document.querySelectorAll('[data-declaration-preview]').forEach(button => {
    button.addEventListener('click', () => openDeclarationPreview(button.dataset.declarationPreview));
  });
  document.querySelectorAll('[data-declaration-pdf]').forEach(button => {
    button.addEventListener('click', () => downloadDeclarationPdf(button.dataset.declarationPdf));
  });
  document.querySelectorAll('[data-declaration-xml]').forEach(button => {
    button.addEventListener('click', () => downloadDeclarationXml(button.dataset.declarationXml));
  });
  document.getElementById('downloadDeclarationPdf').addEventListener('click', () => downloadDeclarationPdf(currentDeclarationKind));
  document.getElementById('downloadDeclarationXml').addEventListener('click', () => downloadDeclarationXml(currentDeclarationKind));

  updatePeriod();
  fillRuleForm();
  fillVerificationForm();
  renderCompany();
  fillDeclarationProfile();
  renderTasks();
  renderCalculations();
  refreshOnboarding();
  refreshKsefPanel();
  if (window.PewnikCloud) {
    window.PewnikCloud.init({ getState, replaceState, showToast });
  }
  window.PEWNIK_APP_READY = true;
})();
