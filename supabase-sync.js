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
      type: row.invoice_type,
      net: Number(row.net_amount),
      vatRate: Number(row.vat_rate),
      category: row.category
    };
  }

  function invoiceToDatabase(invoice, userId) {
    return {
      user_id: userId,
      number: invoice.number,
      issue_date: invoice.date,
      contractor: invoice.contractor,
      invoice_type: invoice.type,
      net_amount: Number(invoice.net),
      vat_rate: Number(invoice.vatRate),
      category: invoice.type === 'sale' ? invoice.category : null
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

  async function deleteInvoice(invoiceId) {
    if (!currentUser) return;
    const { error } = await client
      .from('invoices')
      .delete()
      .eq('id', invoiceId);
    if (error) throw error;
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
    deleteInvoice
  };
})();
