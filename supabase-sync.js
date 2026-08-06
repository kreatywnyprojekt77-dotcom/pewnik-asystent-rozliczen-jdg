(function () {
  'use strict';

  const config = window.PEWNIK_SUPABASE_CONFIG || {};
  const isConfigured = Boolean(
    config.url &&
    config.publishableKey &&
    !config.url.startsWith('WKLEJ_') &&
    !config.publishableKey.startsWith('WKLEJ_')
  );

  let client = null;
  let app = null;
  let currentUser = null;
  let loadedUserId = null;
  let saveTimer = null;
  let pendingState = null;

  function loadSupabaseLibrary() {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Nie udało się pobrać biblioteki Supabase.'));
      document.head.appendChild(script);
    });
  }
  function elements() {
    return {
      modal: document.getElementById('authModal'),
      form: document.getElementById('authForm'),
      email: document.getElementById('authEmail'),
      password: document.getElementById('authPassword'),
      login: document.getElementById('authLogin'),
      register: document.getElementById('authRegister'),
      logout: document.getElementById('authLogout'),
      message: document.getElementById('authMessage'),
      accountButton: document.getElementById('accountButton'),
      accountName: document.getElementById('accountName'),
      accountStatus: document.getElementById('accountStatus'),
      authFields: document.getElementById('authFields')
    };
  }

  function setMessage(message, isError) {
    const { message: box } = elements();
    if (!box) return;
    box.textContent = message;
    box.classList.toggle('error', Boolean(isError));
  }

  function setBusy(busy) {
    const { login, register, logout } = elements();
    [login, register, logout].forEach(button => {
      if (button) button.disabled = busy;
    });
  }

  function updateAccountUi() {
    const { accountName, accountStatus, authFields, login, register, logout } = elements();
    if (!isConfigured) {
      accountName.textContent = 'Supabase niepołączony';
      accountStatus.textContent = 'Tryb lokalny';
      authFields.hidden = true;
      login.hidden = true;
      register.hidden = true;
      logout.hidden = true;
      setMessage('Najpierw uzupełnij plik supabase-config.js zgodnie z instrukcją.', false);
      return;
    }

    if (currentUser) {
      accountName.textContent = currentUser.email || 'Zalogowany użytkownik';
      accountStatus.textContent = 'Synchronizacja aktywna';
      authFields.hidden = true;
      login.hidden = true;
      register.hidden = true;
      logout.hidden = false;
      setMessage('Dane są zapisywane lokalnie i synchronizowane z Supabase.', false);
    } else {
      accountName.textContent = 'Połącz z Supabase';
      accountStatus.textContent = 'Zaloguj się';
      authFields.hidden = false;
      login.hidden = false;
      register.hidden = false;
      logout.hidden = true;
      setMessage('Zaloguj się lub utwórz konto, aby włączyć synchronizację.', false);
    }
  }

  function openAuthModal() {
    const { modal, email } = elements();
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (!currentUser && isConfigured) setTimeout(() => email.focus(), 100);
  }

  function validateCredentials() {
    const { email, password } = elements();
    const credentials = {
      email: email.value.trim(),
      password: password.value
    };
    if (!credentials.email || credentials.password.length < 6) {
      throw new Error('Podaj poprawny e-mail i hasło mające co najmniej 6 znaków.');
    }
    return credentials;
  }

  async function signIn() {
    try {
      setBusy(true);
      setMessage('Logowanie…', false);
      const { error } = await client.auth.signInWithPassword(validateCredentials());
      if (error) throw error;
      setMessage('Zalogowano. Pobieram dane…', false);
    } catch (error) {
      setMessage(error.message || 'Nie udało się zalogować.', true);
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    try {
      setBusy(true);
      setMessage('Tworzenie konta…', false);
      const { data, error } = await client.auth.signUp(validateCredentials());
      if (error) throw error;
      if (data.session) {
        setMessage('Konto utworzone i zalogowane.', false);
      } else {
        setMessage('Konto utworzone. Potwierdź adres przez wiadomość e-mail, a potem się zaloguj.', false);
      }
    } catch (error) {
      setMessage(error.message || 'Nie udało się utworzyć konta.', true);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      setBusy(true);
      const { error } = await client.auth.signOut();
      if (error) throw error;
      setMessage('Wylogowano. Aplikacja działa teraz na danych lokalnych.', false);
    } catch (error) {
      setMessage(error.message || 'Nie udało się wylogować.', true);
    } finally {
      setBusy(false);
    }
  }

  function invoiceFromDatabase(row) {
    return {
      id: row.id,
      number: row.number,
      date: row.issue_date,
      contractor: row.contractor,
      contractorNip: row.contractor_nip || (row.invoice_type === 'sale' ? row.buyer_nip : row.seller_nip),
      type: row.invoice_type,
      net: Number(row.net_amount),
      vatRate: Number(row.vat_rate),
      vatCode: row.vat_code || String(Number(row.vat_rate)),
      vatAmount: row.ksef_vat_amount == null ? Number(row.vat_amount) : Number(row.ksef_vat_amount),
      gross: row.ksef_gross_amount == null ? Number(row.gross_amount) : Number(row.ksef_gross_amount),
      category: row.category,
      currency: row.currency || 'PLN',
      source: row.source || 'manual',
      ksefNumber: row.ksef_number,
      ksefStatus: row.ksef_status,
      ksefAcquisitionDate: row.ksef_acquisition_date,
      documentType: row.document_type || (Number(row.net_amount) < 0 ? 'correction' : 'invoice'),
      supplyDate: row.supply_date,
      taxPointDate: row.tax_point_date,
      receivedDate: row.received_date,
      accountingPeriod: row.accounting_period,
      vatDeductionPercent: row.vat_deduction_percent,
      deductibleVatGrosz: row.deductible_vat_amount == null ? null : Math.round(Number(row.deductible_vat_amount) * 100),
      vatLines: Array.isArray(row.vat_lines) ? row.vat_lines : null
    };
  }

  function invoiceToDatabase(invoice, userId) {
    return {
      user_id: userId,
      number: invoice.number,
      issue_date: invoice.date,
      contractor: invoice.contractor,
      contractor_nip: invoice.contractorNip || null,
      invoice_type: invoice.type,
      net_amount: Number(invoice.net),
      vat_rate: Number(invoice.vatRate),
      vat_code: invoice.vatCode || String(Number(invoice.vatRate)),
      category: invoice.type === 'sale' ? invoice.category : null,
      source: 'manual',
      currency: invoice.currency || 'PLN',
      document_type: invoice.documentType || 'invoice',
      supply_date: invoice.supplyDate || null,
      tax_point_date: invoice.taxPointDate || null,
      received_date: invoice.receivedDate || null,
      accounting_period: invoice.accountingPeriod || null,
      vat_deduction_percent: invoice.type === 'cost' ? invoice.vatDeductionPercent : null,
      deductible_vat_amount: Number.isSafeInteger(invoice.deductibleVatGrosz) ? invoice.deductibleVatGrosz / 100 : null,
      vat_lines: Array.isArray(invoice.vatLines) ? invoice.vatLines : null
    };
  }

  async function readInvoices() {
    const { data, error } = await client
      .from('invoices')
      .select('*')
      .order('issue_date', { ascending: false });
    if (error) throw error;
    return data.map(invoiceFromDatabase);
  }

  async function migrateInvoices(invoices) {
    if (!invoices.length) return [];
    const rows = invoices.map(invoice => invoiceToDatabase(invoice, currentUser.id));
    const { data, error } = await client
      .from('invoices')
      .insert(rows)
      .select();
    if (error) throw error;
    return data.map(invoiceFromDatabase);
  }

  async function loadRemoteState(user) {
    if (!user || loadedUserId === user.id) return;
    loadedUserId = user.id;

    const { data, error } = await client
      .from('app_states')
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      loadedUserId = null;
      setMessage('Połączono konto, ale nie udało się odczytać danych: ' + error.message, true);
      return;
    }

    try {
      const hasRemoteState = Boolean(data && data.state);
      const nextState = hasRemoteState ? data.state : app.getState();
      let invoices = await readInvoices();

      // Jednorazowa migracja faktur zapisanych wcześniej w app_states.state.
      if (!invoices.length && Array.isArray(nextState.invoices) && nextState.invoices.length) {
        invoices = await migrateInvoices(nextState.invoices);
      }

      app.replaceState(Object.assign({}, nextState, { invoices }));
      await writeState(app.getState());
      app.showToast(hasRemoteState
        ? 'Wczytano dane i faktury z Supabase.'
        : 'Połączono Supabase i przeniesiono dane lokalne.');
    } catch (migrationError) {
      loadedUserId = null;
      setMessage('Nie udało się odczytać lub przenieść faktur: ' + migrationError.message, true);
    }
  }

  async function writeState(state) {
    if (!currentUser) return;
    const stateWithoutInvoices = Object.assign({}, state);
    delete stateWithoutInvoices.invoices;
    const { error } = await client.from('app_states').upsert({
      user_id: currentUser.id,
      state: stateWithoutInvoices,
      updated_at: new Date().toISOString()
    });
    if (error) {
      setMessage('Zapis lokalny działa, ale synchronizacja nie powiodła się: ' + error.message, true);
      return;
    }
    const { accountStatus } = elements();
    accountStatus.textContent = 'Zsynchronizowano';
  }

  async function createInvoice(invoice) {
    if (!currentUser) return invoice;
    const { data, error } = await client
      .from('invoices')
      .insert(invoiceToDatabase(invoice, currentUser.id))
      .select()
      .single();
    if (error) throw error;
    return invoiceFromDatabase(data);
  }

  async function updateInvoiceCategory(invoiceId, category) {
    if (!currentUser) return;
    const { error } = await client
      .from('invoices')
      .update({ category, updated_at: new Date().toISOString() })
      .eq('id', invoiceId);
    if (error) throw error;
  }

  async function updateInvoiceVatDeduction(invoiceId, percent) {
    if (!currentUser) return;
    const { error } = await client
      .from('invoices')
      .update({ vat_deduction_percent: percent, deductible_vat_amount: null, updated_at: new Date().toISOString() })
      .eq('id', invoiceId);
    if (error) throw error;
  }

  async function updateInvoiceContractorNip(invoiceId, contractorNip) {
    if (!currentUser) return;
    const { error } = await client
      .from('invoices')
      .update({ contractor_nip: contractorNip, updated_at: new Date().toISOString() })
      .eq('id', invoiceId);
    if (error) throw error;
  }

  async function deleteInvoice(invoiceId) {
    if (!currentUser) return;
    const { error } = await client
      .from('invoices')
      .delete()
      .eq('id', invoiceId);
    if (error) throw error;
  }

  async function ksefFunctionError(error) {
    if (error && error.context && typeof error.context.json === 'function') {
      try {
        const payload = await error.context.json();
        if (payload && payload.error) return new Error(payload.error);
      } catch (_) {
        // Supabase zwróci standardowy komunikat funkcji.
      }
    }
    return error instanceof Error ? error : new Error('Nie udało się wywołać funkcji KSeF.');
  }

  async function invokeKsef(action, nip) {
    if (!isConfigured || !client || !currentUser) {
      throw new Error('Najpierw zaloguj się do Supabase.');
    }
    const { data, error } = await client.functions.invoke('ksef-sync', {
      body: { action, nip }
    });
    if (error) throw await ksefFunctionError(error);
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  async function getKsefConnection() {
    if (!isConfigured || !client || !currentUser) return null;
    const { data, error } = await client
      .from('ksef_connections')
      .select('environment,nip,status,last_sync_at,last_error')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function testKsefConnection(nip) {
    return invokeKsef('status', nip);
  }

  async function syncKsefInvoices(nip) {
    const result = await invokeKsef('sync', nip);
    const invoices = await readInvoices();
    app.replaceState(Object.assign({}, app.getState(), { invoices }));
    return result;
  }

  function queueSave(state) {
    if (!isConfigured || !currentUser) return;
    pendingState = JSON.parse(JSON.stringify(state));
    clearTimeout(saveTimer);
    const { accountStatus } = elements();
    accountStatus.textContent = 'Zapisywanie…';
    saveTimer = setTimeout(async () => {
      const stateToSave = pendingState;
      pendingState = null;
      await writeState(stateToSave);
    }, 500);
  }

  async function handleSession(session) {
    const nextUser = session ? session.user : null;
    if (!nextUser) loadedUserId = null;
    currentUser = nextUser;
    updateAccountUi();
    if (currentUser) await loadRemoteState(currentUser);
    window.dispatchEvent(new CustomEvent('pewnik:cloud-session', {
      detail: { signedIn: Boolean(currentUser) }
    }));
  }

  async function init(appApi) {
    app = appApi;
    const { accountButton, login, register, logout, form } = elements();
    accountButton.addEventListener('click', openAuthModal);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (isConfigured) signIn();
    });
    register.addEventListener('click', signUp);
    logout.addEventListener('click', signOut);

    updateAccountUi();
    if (!isConfigured) return;

    try {
      await loadSupabaseLibrary();
    } catch (error) {
      setMessage(error.message + ' Sprawdź połączenie z internetem.', true);
      return;
    }

    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => handleSession(session), 0);
    });

    const { data, error } = await client.auth.getSession();
    if (error) {
      setMessage('Błąd sesji Supabase: ' + error.message, true);
      return;
    }
    await handleSession(data.session);
  }

  window.PewnikCloud = {
    init,
    queueSave,
    createInvoice,
    updateInvoiceCategory,
    updateInvoiceVatDeduction,
    updateInvoiceContractorNip,
    deleteInvoice,
    getKsefConnection,
    testKsefConnection,
    syncKsefInvoices,
    isSignedIn: () => Boolean(currentUser)
  };
})();
