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

