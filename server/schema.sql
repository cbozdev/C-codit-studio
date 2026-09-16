-- C Studio database schema — run this in Supabase SQL Editor.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_credits integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits integer not null,
  price_ngn integer not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.pricing_config (
  id int primary key default 1,
  credits_per_second numeric not null default 2,
  updated_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);
insert into public.pricing_config (id, credits_per_second) values (1, 2);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('topup','stream_usage','refund')),
  credits integer not null,
  amount_ngn integer,
  korapay_reference text unique,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  created_at timestamptz not null default now()
);

create table public.stream_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscribe_token text,
  started_at timestamptz not null default now(),
  max_seconds integer not null,
  ended_at timestamptz,
  credits_charged integer not null default 0,
  status text not null default 'active' check (status in ('active','ended'))
);

-- Auto-create a profile + wallet row whenever someone signs up via Supabase Auth.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  insert into public.wallets (user_id, balance_credits) values (new.id, 0);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security: the browser (anon key) can only ever READ its own
-- rows (or public pricing/packs). Every write that touches money — topups,
-- usage deductions, admin price changes — goes through the server using the
-- service_role key, which bypasses RLS entirely. The browser is never
-- trusted to write its own balance.
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.packs enable row level security;
alter table public.pricing_config enable row level security;
alter table public.transactions enable row level security;
alter table public.stream_sessions enable row level security;

create policy "read own profile" on public.profiles for select using (auth.uid() = id);
create policy "read own wallet" on public.wallets for select using (auth.uid() = user_id);
create policy "public read active packs" on public.packs for select using (active = true);
create policy "public read pricing" on public.pricing_config for select using (true);
create policy "read own transactions" on public.transactions for select using (auth.uid() = user_id);
create policy "read own sessions" on public.stream_sessions for select using (auth.uid() = user_id);

-- Starter set of top-up packs, matching a typical pay-as-you-stream model.
insert into public.packs (name, credits, price_ngn, sort_order) values
  ('Starter', 500, 1150, 1),
  ('Basic', 1000, 2300, 2),
  ('Pro', 2000, 4600, 3),
  ('Enterprise', 5000, 11500, 4);
