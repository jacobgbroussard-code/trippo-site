-- Trippo: anonymous crash reports from the app (run once in Supabase → SQL Editor → Run).
-- Safe to run more than once.
--
-- The app (js/error-report.js) inserts a row when a script error happens on someone's device:
-- message, stack, app version, browser and page path. No account, trip or location data.
-- Rows can only be INSERTED with the app's public key; there is no SELECT policy, so only
-- you can read them (Table Editor → client_errors, or the queries at the bottom).

create table if not exists public.client_errors (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    app_version text,
    message text,
    source text,
    stack text,
    user_agent text,
    page text
);

alter table public.client_errors enable row level security;

drop policy if exists "Apps can report errors" on public.client_errors;
create policy "Apps can report errors"
    on public.client_errors
    for insert
    to anon, authenticated
    with check (
        char_length(coalesce(message, '')) <= 1000
        and char_length(coalesce(stack, '')) <= 4000
        and char_length(coalesce(source, '')) <= 300
        and char_length(coalesce(user_agent, '')) <= 300
        and char_length(coalesce(page, '')) <= 300
        and char_length(coalesce(app_version, '')) <= 20
    );

create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);

notify pgrst, 'reload schema';

-- Useful queries:
--   Most common errors this week:
--     select message, app_version, count(*) from client_errors
--     where created_at > now() - interval '7 days' group by 1, 2 order by 3 desc;
--   Clear out old reports:
--     delete from client_errors where created_at < now() - interval '90 days';
