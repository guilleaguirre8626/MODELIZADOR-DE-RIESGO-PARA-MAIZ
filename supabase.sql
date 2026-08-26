create table if not exists public.simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  field_name text,
  hybrid text not null,
  sow_date text not null,
  flowering_date text,
  critical_start text,
  critical_end text,
  score integer not null,
  heat_risk integer,
  drought_risk integer,
  excess_risk integer,
  cold_risk integer,
  recommendation text
);

alter table public.simulations enable row level security;

create policy "Users can read own simulations"
on public.simulations for select
using (auth.uid() = user_id);

create policy "Users can insert own simulations"
on public.simulations for insert
with check (auth.uid() = user_id);

create policy "Users can delete own simulations"
on public.simulations for delete
using (auth.uid() = user_id);
