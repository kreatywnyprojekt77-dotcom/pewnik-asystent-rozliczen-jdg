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

