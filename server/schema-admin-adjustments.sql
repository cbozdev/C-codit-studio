-- Adds an audit note and a dedicated transaction type for manual admin
-- balance adjustments (support refunds, goodwill credits, debiting abuse).
alter table public.transactions add column if not exists note text;

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('topup', 'stream_usage', 'refund', 'admin_adjustment'));
