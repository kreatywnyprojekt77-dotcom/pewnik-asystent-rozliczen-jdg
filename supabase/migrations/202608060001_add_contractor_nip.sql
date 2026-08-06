alter table public.invoices
add column if not exists contractor_nip text;

comment on column public.invoices.contractor_nip is
  'NIP kontrahenta używany do przygotowania ewidencji JPK_V7M.';
