-- AgroClima Data Risk indexes and read access
create index if not exists idx_observed_risk_lookup
on public.observed_risk_stats (phase, fortnight, metric);

-- Climate/reference data is read-only to authenticated users.
alter table public.observed_risk_stats enable row level security;
drop policy if exists observed_risk_authenticated_read on public.observed_risk_stats;
create policy observed_risk_authenticated_read
on public.observed_risk_stats for select
to authenticated
using (true);

alter table public.hybrids enable row level security;
drop policy if exists hybrids_authenticated_read on public.hybrids;
create policy hybrids_authenticated_read
on public.hybrids for select
to authenticated
using (active is true);

select 'Data Risk patch listo' as status;
