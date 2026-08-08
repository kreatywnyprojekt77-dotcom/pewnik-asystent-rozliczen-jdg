import { readFile } from 'node:fs/promises';

const LOGIN = process.env.DEMO_USER_EMAIL || 'demo.pewnik.2026@example.com';
const PASSWORD = process.env.DEMO_USER_PASSWORD || 'demo.pewnik.2026';

async function readEnvironment(path) {
  const values = {};
  const source = await readFile(path, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const environment = await readEnvironment(new URL('../.env', import.meta.url));
const supabaseUrl = process.env.SUPABASE_URL || environment.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || environment.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !publishableKey) {
  throw new Error('Brakuje SUPABASE_URL lub SUPABASE_PUBLISHABLE_KEY.');
}

async function request(path, { method = 'GET', token, body, prefer } = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.msg || data?.message || data?.error_description || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function authenticate() {
  try {
    await request('/auth/v1/signup', {
      method: 'POST',
      body: {
        email: LOGIN,
        password: PASSWORD,
        data: { force_onboarding_each_login: true, account_kind: 'synthetic_demo' }
      }
    });
  } catch (error) {
    if (error.status !== 400 && error.status !== 422) throw error;
  }

  const session = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: LOGIN, password: PASSWORD }
  });
  if (!session?.access_token || !session?.user?.id) {
    throw new Error('Supabase nie zwrócił aktywnej sesji dla konta demonstracyjnego.');
  }
  await request('/auth/v1/user', {
    method: 'PUT',
    token: session.access_token,
    body: { data: { force_onboarding_each_login: true, account_kind: 'synthetic_demo' } }
  });
  return session;
}

const profileState = {
  period: '2026-08-01',
  rules: { software: 12, consulting: 15, vatRate: 23 },
  categoryProfiles: {
    software: {
      name: 'Usługi programistyczne',
      pkwiu: '62.01.11.0',
      legalBasis: 'DEMO — fikcyjna klasyfikacja zaakceptowana do testów aplikacji',
      validFrom: '2026-01',
      validTo: '2026-12',
      decision: {
        approvedBy: 'DEMO — Pracownia Cyfrowa Pewnik',
        approvedAt: '2026-05-01',
        reason: 'DEMO — konfiguracja syntetyczna bez skutków podatkowych',
        reference: 'DEMO — fikcyjna klasyfikacja zaakceptowana do testów aplikacji'
      }
    },
    consulting: {
      name: 'Usługi konsultingowe',
      pkwiu: '62.02.20.0',
      legalBasis: 'DEMO — fikcyjna klasyfikacja zaakceptowana do testów aplikacji',
      validFrom: '2026-01',
      validTo: '2026-12',
      decision: {
        approvedBy: 'DEMO — Pracownia Cyfrowa Pewnik',
        approvedAt: '2026-05-01',
        reason: 'DEMO — konfiguracja syntetyczna bez skutków podatkowych',
        reference: 'DEMO — fikcyjna klasyfikacja zaakceptowana do testów aplikacji'
      }
    }
  },
  ryczaltSettings: {
    byPeriod: {
      '2026-05': { deductionGrosz: 180000 },
      '2026-06': { deductionGrosz: 180000 },
      '2026-07': { deductionGrosz: 180000 },
      '2026-08': { deductionGrosz: 180000 }
    }
  },
  vatSettings: {
    byPeriod: {
      '2026-05': { openingCarryForwardGrosz: 0, excessMode: 'CARRY_FORWARD' },
      '2026-06': { openingCarryForwardGrosz: 0, excessMode: 'CARRY_FORWARD' },
      '2026-07': { openingCarryForwardGrosz: 0, excessMode: 'CARRY_FORWARD' },
      '2026-08': { openingCarryForwardGrosz: 0, excessMode: 'CARRY_FORWARD' }
    }
  },
  zusSettings: {
    sicknessInsurance: true,
    byPeriod: {
      '2026-05': { healthRevenueDeductionYtdGrosz: 0 },
      '2026-06': { healthRevenueDeductionYtdGrosz: 0 },
      '2026-07': { healthRevenueDeductionYtdGrosz: 0 },
      '2026-08': { healthRevenueDeductionYtdGrosz: 0 }
    }
  },
  tasks: { transfers: false, jpk: false, archive: false },
  onboardingCompleted: true,
  company: { name: 'DEMO — Pracownia Cyfrowa Pewnik', nip: '1111111111' },
  declarationProfile: {
    firstName: 'Daria',
    lastName: 'Demonstracyjna',
    birthDate: '1990-01-01',
    pesel: '90010100009',
    regon: '123456785',
    taxOfficeCode: '1410',
    email: LOGIN,
    phone: '500000000',
    zusShortName: 'DEMO PEWNIK',
    zusInsuranceTitleCode: '051000'
  }
};

const monthData = [
  ['05', [8200, 5600, 3900, 7400], [690, 1240, 430]],
  ['06', [9600, 6100, 4200, 7800], [720, 1380, 510]],
  ['07', [10400, 6700, 4600, 8300], [760, 1490, 620]],
  ['08', [11200, 7200, 5100, 8900], [810, 1580, 690]]
];
const saleContractors = [
  ['DEMO — Northbyte Labs', '2222222222', 'software'],
  ['DEMO — Metrum Digital', '3333333333', 'consulting'],
  ['DEMO — Orbit Systems', '4444444444', 'software'],
  ['DEMO — Zielony Piksel', '5555555555', 'consulting']
];
const costContractors = [
  ['DEMO — Chmura Testowa', '6666666666'],
  ['DEMO — Biuro Syntetyczne', '7777777777'],
  ['DEMO — Telekom Demo', '8888888888']
];

const invoices = monthData.flatMap(([month, sales, costs]) => {
  const period = `2026-${month}`;
  const saleRows = sales.map((net, index) => ({
    number: `FV/${month}/2026/${String(index + 1).padStart(2, '0')}`,
    issue_date: `${period}-${String(4 + index * 6).padStart(2, '0')}`,
    contractor: saleContractors[index][0],
    contractor_nip: saleContractors[index][1],
    invoice_type: 'sale',
    net_amount: net,
    vat_rate: 23,
    vat_code: '23',
    category: saleContractors[index][2],
    source: 'manual',
    currency: 'PLN',
    document_type: 'invoice',
    supply_date: `${period}-${String(4 + index * 6).padStart(2, '0')}`,
    tax_point_date: `${period}-${String(4 + index * 6).padStart(2, '0')}`,
    accounting_period: period
  }));
  const costRows = costs.map((net, index) => ({
    number: `KOSZT/${month}/2026/${String(index + 1).padStart(2, '0')}`,
    issue_date: `${period}-${String(7 + index * 8).padStart(2, '0')}`,
    contractor: costContractors[index][0],
    contractor_nip: costContractors[index][1],
    invoice_type: 'cost',
    net_amount: net,
    vat_rate: 23,
    vat_code: '23',
    category: null,
    source: 'manual',
    currency: 'PLN',
    document_type: 'invoice',
    received_date: `${period}-${String(8 + index * 8).padStart(2, '0')}`,
    accounting_period: period,
    vat_deduction_percent: 100
  }));
  return [...saleRows, ...costRows];
});

const session = await authenticate();
const userId = session.user.id;
const token = session.access_token;

await request('/rest/v1/app_states?on_conflict=user_id', {
  method: 'POST',
  token,
  prefer: 'resolution=merge-duplicates,return=minimal',
  body: [{ user_id: userId, state: profileState, updated_at: new Date().toISOString() }]
});

await request(`/rest/v1/invoices?user_id=eq.${userId}&issue_date=gte.2026-05-01&issue_date=lte.2026-08-31`, {
  method: 'DELETE',
  token,
  prefer: 'return=minimal'
});

await request('/rest/v1/invoices', {
  method: 'POST',
  token,
  prefer: 'return=minimal',
  body: invoices.map(invoice => ({
    category: null,
    supply_date: null,
    tax_point_date: null,
    received_date: null,
    accounting_period: null,
    vat_deduction_percent: null,
    ...invoice,
    user_id: userId
  }))
});

const verification = await request(
  `/rest/v1/invoices?select=invoice_type,issue_date&user_id=eq.${userId}&issue_date=gte.2026-05-01&issue_date=lte.2026-08-31`,
  { token }
);
const counts = verification.reduce((result, invoice) => {
  const month = invoice.issue_date.slice(0, 7);
  result[month] ||= { sale: 0, cost: 0 };
  result[month][invoice.invoice_type] += 1;
  return result;
}, {});

console.log(JSON.stringify({ login: LOGIN, userId, profileSeeded: true, invoiceCount: verification.length, counts }, null, 2));
