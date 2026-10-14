-- Trippo: weekly encrypted cloud backup (run once in Supabase → SQL Editor → Run). Safe to re-run.
--
-- trippo_backup() returns every public table as one JSON document, encrypted with the backup
-- PUBLIC key below (PGP). Only the private key on the owner's PC can decrypt it, so the app's
-- public key may call it (owner-approved Oct 2026): .github/workflows/cloud-backup.yml does that
-- weekly and keeps the result as a 90-day artifact. Decrypt instructions: backup/README.md.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.trippo_backup()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
    dump jsonb := jsonb_build_object('created_at', now());
    t text;
    tbl_rows jsonb;
begin
    for t in select tablename from pg_tables where schemaname = 'public' order by 1 loop
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into tbl_rows;
        dump := dump || jsonb_build_object(t, tbl_rows);
    end loop;
    return armor(pgp_pub_encrypt(dump::text, dearmor($key$
-----BEGIN PGP PUBLIC KEY BLOCK-----

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
=RbDy
-----END PGP PUBLIC KEY BLOCK-----
$key$), 'compress-algo=2'));
end
$fn$;

revoke all on function public.trippo_backup() from public;
grant execute on function public.trippo_backup() to anon, authenticated;

-- One-time cleanup: the test crash report from setup.
delete from public.client_errors where message ilike '%Claude live check%';

select 'backup function ready' as status;
