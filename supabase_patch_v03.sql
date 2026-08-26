-- AgroClima patch v0.3 - ejecutar una sola vez en Supabase SQL Editor
alter table public.simulations add column if not exists field_name text;

-- Permitir que usuarios autenticados lean catalogos de referencia
alter table public.hybrids enable row level security;
drop policy if exists hybrids_read_authenticated on public.hybrids;
create policy hybrids_read_authenticated
on public.hybrids for select
to authenticated
using (active = true);

alter table public.model_config enable row level security;
drop policy if exists model_config_read_authenticated on public.model_config;
create policy model_config_read_authenticated
on public.model_config for select
to authenticated
using (true);

alter table public.risk_priors enable row level security;
drop policy if exists risk_priors_read_authenticated on public.risk_priors;
create policy risk_priors_read_authenticated
on public.risk_priors for select
to authenticated
using (true);
