-- Spent: database schema, RLS and storage policies.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is idempotent, so re-running it is safe.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text,
  avatar_url      text,
  currency        text not null default 'USD',
  monthly_budget  numeric(12, 2) not null default 2000,
  opening_balance numeric(12, 2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Categories (user_id null = built-in default visible to everyone)
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete cascade,
  name       text not null,
  icon       text not null default 'pricetag',
  color      text not null default '#C6F432',
  kind       text not null default 'expense' check (kind in ('expense', 'income')),
  created_at timestamptz not null default now()
);

create unique index if not exists categories_default_name_idx
  on public.categories (name, kind) where user_id is null;

insert into public.categories (name, icon, color, kind) values
  ('Food & Dining',   'restaurant',     '#C6F432', 'expense'),
  ('Groceries',       'cart',           '#22C55E', 'expense'),
  ('Transport',       'car',            '#38BDF8', 'expense'),
  ('Shopping',        'bag-handle',     '#F472B6', 'expense'),
  ('Bills & Utilities','flash',         '#FACC15', 'expense'),
  ('Entertainment',   'film',           '#A78BFA', 'expense'),
  ('Health',          'medkit',         '#F87171', 'expense'),
  ('Travel',          'airplane',       '#2DD4BF', 'expense'),
  ('Subscriptions',   'repeat',         '#FB923C', 'expense'),
  ('Other',           'ellipsis-horizontal', '#94A3B8', 'expense'),
  ('Salary',          'briefcase',      '#22C55E', 'income'),
  ('Freelance',       'laptop',         '#C6F432', 'income'),
  ('Investments',     'trending-up',    '#38BDF8', 'income'),
  ('Gifts',           'gift',           '#F472B6', 'income')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('expense', 'income')),
  amount       numeric(12, 2) not null check (amount > 0),
  category_id  uuid references public.categories (id) on delete set null,
  merchant     text,
  note         text,
  occurred_at  timestamptz not null default now(),
  receipt_path text,
  created_at   timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "categories: read defaults and own" on public.categories;
create policy "categories: read defaults and own" on public.categories
  for select using (user_id is null or user_id = auth.uid());

drop policy if exists "categories: write own" on public.categories;
create policy "categories: write own" on public.categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "transactions: own rows" on public.transactions;
create policy "transactions: own rows" on public.transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage buckets (also created by `npm run setup:storage`, kept here for completeness)
--   avatars       public   - profile pictures,      path: <user_id>/avatar-*.jpg
--   receipts      private  - receipt photos/videos, path: <user_id>/<file>
--   app-releases  public   - APKs, promo video, screenshots for the download page
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',      'avatars',      true,  5242880,   array['image/jpeg','image/png','image/webp']),
  ('receipts',     'receipts',     false, 52428800,  array['image/jpeg','image/png','image/webp','application/pdf','video/mp4','video/quicktime']),
  ('app-releases', 'app-releases', true,  52428800,  null)
on conflict (id) do nothing;

-- Users may manage files only inside a folder named after their user id.
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars: owner write" on storage.objects;
create policy "avatars: owner write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts: owner all" on storage.objects;
create policy "receipts: owner all" on storage.objects
  for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "app-releases: public read" on storage.objects;
create policy "app-releases: public read" on storage.objects
  for select using (bucket_id = 'app-releases');
