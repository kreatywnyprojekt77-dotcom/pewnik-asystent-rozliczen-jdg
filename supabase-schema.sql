-- Uruchom cały plik w Supabase Dashboard -> SQL Editor.
-- Każdy użytkownik może odczytać i zmieniać wyłącznie swój rekord.

create table if not exists public.app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_states enable row level security;

drop policy if exists "Użytkownik odczytuje własne dane" on public.app_states;
create policy "Użytkownik odczytuje własne dane"
on public.app_states
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Użytkownik dodaje własne dane" on public.app_states;
create policy "Użytkownik dodaje własne dane"
on public.app_states
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Użytkownik aktualizuje własne dane" on public.app_states;
create policy "Użytkownik aktualizuje własne dane"
on public.app_states
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Użytkownik usuwa własne dane" on public.app_states;
create policy "Użytkownik usuwa własne dane"
on public.app_states
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.app_states from anon;
grant select, insert, update, delete on table public.app_states to authenticated;

-- Każda faktura jest osobnym rekordem.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  number text not null,
  issue_date date not null,
  contractor text not null,
  invoice_type text not null check (invoice_type in ('sale', 'cost')),
  net_amount numeric(14, 2) not null check (net_amount > 0),
  vat_rate numeric(5, 2) not null check (vat_rate >= 0 and vat_rate <= 100),
  category text check (category is null or category in ('software', 'consulting')),
  vat_amount numeric(14, 2) generated always as (
    round(net_amount * vat_rate / 100, 2)
  ) stored,
  gross_amount numeric(14, 2) generated always as (
    round(net_amount * (1 + vat_rate / 100), 2)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, number)
);

-- Pola integracji KSeF. Kwoty z KSeF są przechowywane osobno, ponieważ
-- pojedyncza faktura może zawierać wiele stawek VAT.
alter table public.invoices add column if not exists source text not null default 'manual';
alter table public.invoices add column if not exists ksef_number text;
alter table public.invoices add column if not exists ksef_status text;
alter table public.invoices add column if not exists seller_nip text;
alter table public.invoices add column if not exists buyer_nip text;
alter table public.invoices add column if not exists currency text not null default 'PLN';
alter table public.invoices add column if not exists ksef_vat_amount numeric(14, 2);
alter table public.invoices add column if not exists ksef_gross_amount numeric(14, 2);
alter table public.invoices add column if not exists ksef_invoice_type text;
alter table public.invoices add column if not exists ksef_form_code text;
alter table public.invoices add column if not exists ksef_invoicing_date timestamptz;
alter table public.invoices add column if not exists ksef_acquisition_date timestamptz;
alter table public.invoices add column if not exists ksef_permanent_storage_date timestamptz;
alter table public.invoices add column if not exists invoice_hash text;
alter table public.invoices add column if not exists ksef_metadata jsonb;
alter table public.invoices add column if not exists vat_code text;
alter table public.invoices add column if not exists document_type text not null default 'invoice';
alter table public.invoices add column if not exists supply_date date;
alter table public.invoices add column if not exists tax_point_date date;
alter table public.invoices add column if not exists received_date date;
alter table public.invoices add column if not exists accounting_period text;
alter table public.invoices add column if not exists vat_deduction_percent integer;
alter table public.invoices add column if not exists deductible_vat_amount numeric(14, 2);
alter table public.invoices add column if not exists vat_lines jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_document_type_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices add constraint invoices_document_type_check
      check (document_type in ('invoice', 'correction'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_vat_deduction_percent_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices add constraint invoices_vat_deduction_percent_check
      check (vat_deduction_percent is null or vat_deduction_percent in (0, 50, 100));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_vat_code_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices add constraint invoices_vat_code_check
      check (vat_code is null or vat_code in ('23', '8', '5', '0', 'ZW', 'NP', 'MIXED'));
  end if;
end $$;

-- Numery własne faktur nie są globalnie unikalne (dwóch dostawców może użyć
-- tego samego numeru). Deduplikacja importu odbywa się po numerze KSeF.
alter table public.invoices drop constraint if exists invoices_user_id_number_key;
-- Korekty KSeF mogą mieć kwoty ujemne lub zerowe.
alter table public.invoices drop constraint if exists invoices_net_amount_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_user_ksef_number_key'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_user_ksef_number_key unique (user_id, ksef_number);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_source_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_source_check check (source in ('manual', 'ksef'));
  end if;
end $$;

create index if not exists invoices_user_date_idx
on public.invoices(user_id, issue_date desc);

create index if not exists invoices_user_type_idx
on public.invoices(user_id, invoice_type);

alter table public.invoices enable row level security;

drop policy if exists "Użytkownik widzi własne faktury" on public.invoices;
create policy "Użytkownik widzi własne faktury"
on public.invoices for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Użytkownik dodaje własne faktury" on public.invoices;
create policy "Użytkownik dodaje własne faktury"
on public.invoices for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Użytkownik zmienia własne faktury" on public.invoices;
create policy "Użytkownik zmienia własne faktury"
on public.invoices for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Użytkownik usuwa własne faktury" on public.invoices;
create policy "Użytkownik usuwa własne faktury"
on public.invoices for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.invoices from anon;
grant select, insert, update, delete on table public.invoices to authenticated;
grant select, insert, update, delete on table public.invoices to service_role;

-- Stan połączenia i kursor synchronizacji. Sekret KSeF nie trafia do bazy;
-- jest przechowywany jako sekret Supabase Edge Function.
create table if not exists public.ksef_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  environment text not null default 'test' check (environment in ('test')),
  nip text not null check (nip ~ '^\d{10}$'),
  status text not null default 'configured' check (status in ('configured', 'connected', 'error')),
  last_sync_at timestamptz,
  last_hwm_date timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.ksef_connections enable row level security;

drop policy if exists "Użytkownik widzi własne połączenie KSeF" on public.ksef_connections;
create policy "Użytkownik widzi własne połączenie KSeF"
on public.ksef_connections for select to authenticated
using ((select auth.uid()) = user_id);

-- Zapis wykonuje wyłącznie Edge Function z kluczem service_role.
revoke all on table public.ksef_connections from anon, authenticated;
grant select on table public.ksef_connections to authenticated;
grant select, insert, update on table public.ksef_connections to service_role;

create table if not exists public.ksef_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  incoming_count integer not null default 0,
  outgoing_count integer not null default 0,
  error_message text
);

create index if not exists ksef_sync_runs_user_started_idx
on public.ksef_sync_runs(user_id, started_at desc);

alter table public.ksef_sync_runs enable row level security;

drop policy if exists "Użytkownik widzi własne synchronizacje KSeF" on public.ksef_sync_runs;
create policy "Użytkownik widzi własne synchronizacje KSeF"
on public.ksef_sync_runs for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.ksef_sync_runs from anon, authenticated;
grant select on table public.ksef_sync_runs to authenticated;
grant select, insert, update on table public.ksef_sync_runs to service_role;
