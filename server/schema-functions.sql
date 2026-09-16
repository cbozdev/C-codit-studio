-- Atomic wallet operations. Plain "read balance, then write new balance" from
-- application code has a race condition: two concurrent requests could both
-- read the same starting balance and one update would silently overwrite the
-- other, effectively giving free credits or losing a deduction. These run as
-- a single atomic statement inside Postgres itself, so that can't happen.

-- Generic adjustment (positive = credit, negative = debit), floored at 0.
create or replace function public.adjust_wallet_balance(p_user_id uuid, p_delta integer)
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
  return new_balance;
end;
$$;

-- Atomically checks-and-reserves credits in one step: deducts p_amount only
-- if the balance can cover it. Returns the new balance, or -1 if there
-- wasn't enough (in which case nothing is deducted). Used when starting a
-- stream, so two rapid "start" clicks can't both succeed against the same
-- balance.
create or replace function public.reserve_wallet_credits(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
as $$
declare
  new_balance integer;
begin
  update public.wallets
  set balance_credits = balance_credits - p_amount, updated_at = now()
  where user_id = p_user_id and balance_credits >= p_amount
  returning balance_credits into new_balance;

  if new_balance is null then
    return -1;
  end if;
  return new_balance;
end;
$$;
