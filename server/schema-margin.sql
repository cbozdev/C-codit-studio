-- Adds a configurable cost basis so the admin dashboard can compute real
-- margin/profit, not just revenue. These need to be editable because your
-- actual Decart rate and the USD/NGN exchange rate both change over time —
-- hardcoding either would make the profit numbers quietly wrong.
alter table public.pricing_config add column if not exists decart_cost_per_second_usd numeric not null default 0.02;
alter table public.pricing_config add column if not exists usd_to_ngn_rate numeric not null default 1600;
