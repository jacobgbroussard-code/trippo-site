-- Trippo: full-fidelity cloud sync (run once in Supabase → SQL Editor → New query → Run)
-- Safe to run more than once. Adds columns/tables only; existing data is untouched.
--
-- Without this, the app still works offline and syncs, but the cloud only stores each
-- trip's name, start date, stops and places (budget, expenses, collab info etc. stay
-- on the device), and wishlist lists aren't backed up.

-- 1. Whole trip object (every field the app uses)
alter table public.trips add column if not exists data jsonb;

-- 2. Whole wishlist pin + which list it belongs to
alter table public.wishlist add column if not exists data jsonb;
alter table public.wishlist add column if not exists wishlist_id text default 'master';

-- 3. Wishlist lists ("collections"). Keyed per user, since every account has a 'master' list.
create table if not exists public.wishlist_collections (
    user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
    id text not null,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
);

alter table public.wishlist_collections enable row level security;

drop policy if exists "Users manage their own wishlist collections" on public.wishlist_collections;
create policy "Users manage their own wishlist collections"
    on public.wishlist_collections
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Make the new columns visible to the API immediately
notify pgrst, 'reload schema';
