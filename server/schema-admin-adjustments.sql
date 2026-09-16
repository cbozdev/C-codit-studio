-- Adds an audit note and a dedicated transaction type for manual admin
-- balance adjustments (support refunds, goodwill credits, debiting abuse).
alter table public.transactions add column if not exists note text;

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('topup', 'stream_usage', 'refund', 'admin_adjustment'));

-- Applies the balance change AND records the audit transaction in a single
-- atomic call, so a failure recording the note (e.g. a missing column)
-- can't silently change a user's balance while reporting an error, and a
-- crash between the two steps can't leave one done without the other.
create or replace function public.admin_adjust_wallet(
  p_user_id uuid,
  p_delta integer,
  p_admin_email text,
  p_note text
)
returns integer
language plpgsql
security definer
as $$
declare
  new_balance integer;
begin
  update public.wallets
  set balance_credits = greatest(0, balance_credits + p_delta), updated_at = now()
  where user_id = p_user_id
  returning balance_credits into new_balance;

  if new_balance is null then
    raise exception 'wallet not found for user %', p_user_id;
  end if;

  insert into public.transactions (user_id, type, credits, status, note)
  values (
    p_user_id,
    'admin_adjustment',
    p_delta,
    'completed',
    '[by ' || p_admin_email || ']' || case when p_note is not null and p_note != '' then ' ' || p_note else '' end
  );

  return new_balance;
end;
$$;
