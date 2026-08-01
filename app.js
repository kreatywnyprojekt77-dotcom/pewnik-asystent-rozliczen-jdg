(function () {
  'use strict';

  const STORAGE_KEY = 'pewnik-prototype-v1';
  const defaultRules = {
    software: 12,
    consulting: 15,
    vatRate: 23,
    revenueDeduction: 5500,
    socialZus: 1773.96,
    healthZus: 769.43
  };

  const defaultInvoices = [
    { id: 1, number: 'FV/06/2026/01', date: '2026-06-03', contractor: 'DEMO — Northbyte Sp. z o.o.', type: 'sale', net: 12000, vatRate: 23, category: 'software' },
    { id: 2, number: 'FV/06/2026/02', date: '2026-06-10', contractor: 'DEMO — Orbit Systems S.A.', type: 'sale', net: 6800, vatRate: 23, category: 'software' },
    { id: 3, number: 'FV/06/2026/03', date: '2026-06-18', contractor: 'DEMO — Metrum Digital Sp. z o.o.', type: 'sale', net: 5500, vatRate: 23, category: 'consulting' },
    { id: 4, number: 'FV/06/2026/04', date: '2026-06-26', contractor: 'DEMO — BluePeak Polska Sp. z o.o.', type: 'sale', net: 4500, vatRate: 23, category: 'software' },
    { id: 5, number: 'K/0626/184', date: '2026-06-12', contractor: 'DEMO — Cloud Hosting Polska', type: 'cost', net: 1800, vatRate: 23, category: null },
    { id: 6, number: 'FVK/1220/06', date: '2026-06-21', contractor: 'DEMO — Biuro i Sprzęt Sp. z o.o.', type: 'cost', net: 800, vatRate: 23, category: null }
  ];

  const initialState = {
    period: '2026-06-01',
    invoices: defaultInvoices,
    rules: defaultRules,
    tasks: { transfers: false, jpk: false, archive: false },
    company: { name: 'DEMO — Studio Testowe (dane syntetyczne)', nip: '0000000000' }
  };

  const loaded = loadState();
  const state = {
    period: loaded.period || initialState.period,
    invoices: Array.isArray(loaded.invoices) ? loaded.invoices : defaultInvoices,
    rules: Object.assign({}, defaultRules, loaded.rules || {}),
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
    state.tasks = Object.assign({}, initialState.tasks, nextState.tasks || {});
    state.company = Object.assign({}, initialState.company, nextState.company || {});
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Dane z chmury pozostają dostępne w bieżącej sesji.
    }
    updatePeriod();
    fillRuleForm();
    renderCompany();
    renderTasks();
    renderCalculations();
  }

  function money(value) {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
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
    const sales = state.invoices.filter(invoice => invoice.type === 'sale');
    const costs = state.invoices.filter(invoice => invoice.type === 'cost');
    const revenue = sales.reduce((sum, invoice) => sum + Number(invoice.net), 0);
    const costsNet = costs.reduce((sum, invoice) => sum + Number(invoice.net), 0);
    const salesVat = sales.reduce((sum, invoice) => sum + Number(invoice.net) * Number(invoice.vatRate) / 100, 0);
    const costVat = costs.reduce((sum, invoice) => sum + Number(invoice.net) * Number(invoice.vatRate) / 100, 0);
    const vat = Math.max(0, salesVat - costVat);

    const deduction = Math.min(revenue, Math.max(0, Number(state.rules.revenueDeduction)));
    const taxableRevenue = Math.max(0, revenue - deduction);
    const categories = ['software', 'consulting'];
    const categoryRows = categories.map(category => {
      const categoryRevenue = sales.filter(invoice => invoice.category === category).reduce((sum, invoice) => sum + Number(invoice.net), 0);
      const categoryDeduction = revenue ? deduction * (categoryRevenue / revenue) : 0;
      const base = Math.max(0, categoryRevenue - categoryDeduction);
      const rate = Number(state.rules[category]) || 0;
      return { category, revenue: categoryRevenue, base, rate, tax: base * rate / 100 };
    });
    const pit = categoryRows.reduce((sum, row) => sum + row.tax, 0);
    const zus = Number(state.rules.socialZus) + Number(state.rules.healthZus);

    return {
      sales, costs, revenue, costsNet, salesVat, costVat, vat,
      deduction, taxableRevenue, categoryRows, pit, zus,
      total: pit + vat + zus
    };
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
    setText('grandTotal', money(calc.total));
    setText('settlementTotal', money(calc.total));
    setText('pitAmount', money(calc.pit));
    setText('vatAmount', money(calc.vat));
    setText('zusAmount', money(calc.zus));
    setText('revenueMetric', money(calc.revenue));
    setText('costMetric', money(calc.costsNet));
    setText('vatMetric', money(calc.vat));
    setText('salesCountMetric', calc.sales.length + ' ' + plural(calc.sales.length, 'faktura sprzedażowa', 'faktury sprzedażowe', 'faktur sprzedażowych'));
    setText('costCountMetric', calc.costs.length + ' ' + plural(calc.costs.length, 'faktura kosztowa', 'faktury kosztowe', 'faktur kosztowych'));
    setText('documentVat', money(calc.vat));
    setText('documentInvoiceCount', state.invoices.length + ' ' + plural(state.invoices.length, 'pozycja ewidencji', 'pozycje ewidencji', 'pozycji ewidencji'));

    const pitRows = calc.categoryRows.filter(row => row.revenue > 0).map(row => {
      const name = row.category === 'software' ? 'Usługi programistyczne' : 'Usługi konsultingowe';
      return '<div class="detail-row"><span>' + name + ' · ' + number(row.base) + ' zł × ' + number(row.rate) + '%</span><strong>' + money(row.tax) + '</strong></div>';
    }).join('');
    document.getElementById('pitDetails').innerHTML =
      '<div class="detail-row"><span>Przychód netto</span><strong>' + money(calc.revenue) + '</strong></div>' +
      '<div class="detail-row"><span>Odliczenie od przychodu</span><strong>− ' + money(calc.deduction) + '</strong></div>' +
      pitRows +
      '<div class="detail-row"><span>Ryczałt do zapłaty</span><strong>' + money(calc.pit) + '</strong></div>';

    document.getElementById('vatDetails').innerHTML =
      '<div class="detail-row"><span>VAT należny ze sprzedaży</span><strong>' + money(calc.salesVat) + '</strong></div>' +
      '<div class="detail-row"><span>VAT naliczony z kosztów</span><strong>− ' + money(calc.costVat) + '</strong></div>' +
      '<div class="detail-row"><span>VAT do zapłaty</span><strong>' + money(calc.vat) + '</strong></div>';

    document.getElementById('zusDetails').innerHTML =
      '<div class="detail-row"><span>Składki społeczne</span><strong>' + money(state.rules.socialZus) + '</strong></div>' +
      '<div class="detail-row"><span>Składka zdrowotna</span><strong>' + money(state.rules.healthZus) + '</strong></div>' +
      '<div class="detail-row"><span>Składki do zapłaty</span><strong>' + money(calc.zus) + '</strong></div>';

    renderInvoices();
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
      const vat = Number(invoice.net) * Number(invoice.vatRate) / 100;
      const rateControl = invoice.type === 'sale'
        ? '<select class="rate-select" data-rate-invoice="' + invoice.id + '"><option value="software" ' + (invoice.category === 'software' ? 'selected' : '') + '>Programowanie · ' + number(state.rules.software) + '%</option><option value="consulting" ' + (invoice.category === 'consulting' ? 'selected' : '') + '>Konsulting · ' + number(state.rules.consulting) + '%</option></select>'
        : '<span style="color:#9aa4b2">—</span>';
      return '<tr>' +
        '<td class="document-cell"><strong>' + escapeHtml(invoice.number) + '</strong><small>' + date + '</small></td>' +
        '<td>' + escapeHtml(invoice.contractor) + '</td>' +
        '<td><span class="type-badge ' + (invoice.type === 'cost' ? 'cost' : '') + '">' + (invoice.type === 'sale' ? 'Sprzedaż' : 'Koszt') + '</span></td>' +
        '<td><strong>' + money(invoice.net) + '</strong></td>' +
        '<td>' + money(vat) + '</td>' +
        '<td>' + rateControl + '</td>' +
        '<td><button class="icon-button delete-invoice" data-delete-invoice="' + invoice.id + '" aria-label="Usuń fakturę">×</button></td>' +
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
    setTextInput('rateSoftware', state.rules.software);
    setTextInput('rateConsulting', state.rules.consulting);
    setTextInput('vatRate', state.rules.vatRate);
    setTextInput('revenueDeduction', state.rules.revenueDeduction);
    setTextInput('socialZus', state.rules.socialZus);
    setTextInput('healthZus', state.rules.healthZus);
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
      vatRate: value('vatRate'),
      revenueDeduction: value('revenueDeduction'),
      socialZus: value('socialZus'),
      healthZus: value('healthZus')
    };
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

  document.querySelectorAll('.nav-item[data-view]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
  document.querySelectorAll('[data-view-target]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.viewTarget));
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
    const amount = calculations().total.toFixed(2).replace('.', ',');
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
    document.querySelector('.rate-field').style.display = '';
    openModal('invoiceModal');
    setTimeout(() => form.elements.number.focus(), 100);
  });

  document.querySelectorAll('input[name="invoiceType"]').forEach(input => {
    input.addEventListener('change', () => {
      document.querySelector('.rate-field').style.display = input.value === 'sale' && input.checked ? '' : (document.querySelector('input[name="invoiceType"]:checked').value === 'cost' ? 'none' : '');
    });
  });

  document.getElementById('invoiceForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const type = data.get('invoiceType');
    state.invoices.unshift({
      id: Date.now(),
      number: String(data.get('number')).trim(),
      date: String(data.get('date')),
      contractor: String(data.get('contractor')).trim(),
      type,
      net: Number(data.get('net')),
      vatRate: Number(data.get('vat')),
      category: type === 'sale' ? String(data.get('category')) : null
    });
    persist();
    renderCalculations();
    closeModals();
    showToast('Faktura została dodana i uwzględniona w obliczeniach.');
  });

  document.getElementById('invoiceTableBody').addEventListener('change', event => {
    const select = event.target.closest('[data-rate-invoice]');
    if (!select) return;
    const invoice = state.invoices.find(item => String(item.id) === select.dataset.rateInvoice);
    if (invoice) {
      invoice.category = select.value;
      persist();
      renderCalculations();
      showToast('Zmieniono stawkę ryczałtu i przeliczono podsumowanie.');
    }
  });

  document.getElementById('invoiceTableBody').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-invoice]');
    if (!button) return;
    state.invoices = state.invoices.filter(invoice => String(invoice.id) !== button.dataset.deleteInvoice);
    persist();
    renderCalculations();
    showToast('Faktura została usunięta.');
  });

  document.getElementById('saveRules').addEventListener('click', () => {
    readRuleForm();
    persist();
    renderCalculations();
    showToast('Reguły zapisano. Wszystkie kwoty zostały przeliczone.');
  });

  document.getElementById('restoreRules').addEventListener('click', () => {
    state.rules = Object.assign({}, defaultRules);
    fillRuleForm();
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
      'VAT do zapłaty: ' + money(calc.vat),
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
  renderCompany();
  renderTasks();
  renderCalculations();
  if (window.PewnikCloud) {
    window.PewnikCloud.init({ getState, replaceState, showToast });
  }
})();
