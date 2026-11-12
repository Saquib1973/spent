-- WhatUSpent 1.1: money accounts (bank, savings, credit cards, cash, wallets).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Also included at the end of schema.sql for fresh setups.

create table if not exists public.accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null,
  type            text not null default 'bank' check (type in ('bank', 'savings', 'credit', 'cash', 'wallet')),
  opening_balance numeric(12, 2) not null default 0,
  credit_limit    numeric(12, 2),
  color           text not null default '#2F6BFF',
  sort            integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists accounts_user_idx on public.accounts (user_id, sort);

alter table public.transactions
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

create index if not exists transactions_account_idx on public.transactions (account_id);

alter table public.accounts enable row level security;

drop policy if exists "accounts: own rows" on public.accounts;
create policy "accounts: own rows" on public.accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Let the API see the new table and column straight away.
notify pgrst, 'reload schema';
