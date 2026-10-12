-- Coach notes. Don't paste this file as is: run `npx tsx tools/notes/coach.ts setup-sql`, which
-- writes private/notes-setup.sql with the coach key's fingerprint filled in, then paste that into
-- Supabase → SQL Editor → Run. Safe to run again.
--
-- There are no Supabase accounts. The coach password is turned, in the browser, into
--  - an encryption key: notes are encrypted before they are sent, so rows hold only ciphertext, and
--    `scope` is an HMAC of the game, so the database never sees a note's text or which game it is on;
--  - an access key: every function below takes it and checks its SHA-256 against coach_key.
-- The tables themselves are closed to the public API; the functions are the only way in.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.coach_notes (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null check (scope ~ '^[0-9a-f]{32}$'),
  data       text not null check (length(data) between 1 and 24000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists coach_notes_scope_idx on public.coach_notes (scope);

create table if not exists public.coach_key (
  id       int primary key default 1 check (id = 1),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$')
);

alter table public.coach_notes enable row level security;
alter table public.coach_key enable row level security;
revoke all on public.coach_notes, public.coach_key from anon, authenticated;

-- Remove the earlier account-based setup, if it was run.
drop policy if exists coach_notes_coach_only on public.coach_notes;
drop function if exists public.is_coach();

create or replace function public.notes_key_ok(p_key text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.coach_key
    where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
  );
$$;

create or replace function public.notes_check(p_key text) returns boolean
  language sql stable security definer set search_path = ''
as $$ select public.notes_key_ok(p_key); $$;

create or replace function public.notes_list(p_key text, p_scope text)
  returns table (id uuid, data text, updated_at timestamptz)
  language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.notes_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select n.id, n.data, n.updated_at from public.coach_notes n
    where p_scope is null or n.scope = p_scope order by n.updated_at;
end $$;

create or replace function public.notes_save(p_key text, p_id uuid, p_scope text, p_data text)
  returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.notes_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.coach_notes (scope, data) values (p_scope, p_data) returning id into v_id;
  else
    update public.coach_notes set scope = p_scope, data = p_data, updated_at = now()
      where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.notes_delete(p_key text, p_id uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.notes_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.coach_notes where id = p_id;
end $$;

-- Changing the coach password: the old key authorises the new key's fingerprint.
create or replace function public.notes_set_key(p_key text, p_new_hash text) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.notes_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.coach_key set key_hash = p_new_hash where id = 1;
end $$;

revoke all on function public.notes_key_ok(text) from public, anon, authenticated;
revoke all on function public.notes_check(text), public.notes_list(text, text), public.notes_save(text, uuid, text, text),
  public.notes_delete(text, uuid), public.notes_set_key(text, text) from public;
grant execute on function public.notes_check(text), public.notes_list(text, text), public.notes_save(text, uuid, text, text),
  public.notes_delete(text, uuid), public.notes_set_key(text, text) to anon, authenticated;

-- The coach key's fingerprint (filled in by `coach.ts setup-sql`).
insert into public.coach_key (id, key_hash) values (1, '__KEY_HASH__')
  on conflict (id) do update set key_hash = excluded.key_hash;
