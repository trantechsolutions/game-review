-- Scorekeeper stat logs. Don't paste this file as is: run `npx tsx tools/keeper/keeper.ts setup-sql`, which
-- writes private/keeper-setup.sql with the scorekeeper key's fingerprint filled in, then paste that into
-- Supabase → SQL Editor → Run. Safe to run again. Lives beside the coach notes and doesn't touch them.
--
-- The scorekeeper password is turned, in the browser, into
--  - an encryption key: every log entry is encrypted before it is sent, and `scope` is an HMAC of the game,
--    so the database never sees a player, a game or a stat;
--  - an access key: every function below takes it and checks its SHA-256 against keeper_key.
-- Logs are append-only (an undo is a new entry), so there is no update function; a whole game can be removed.

create extension if not exists pgcrypto with schema extensions;
grant usage on schema public to anon, authenticated;

create table if not exists public.keeper_log (
  id         uuid primary key,              -- the entry's own id, so a resend after a dropped connection is a no-op
  scope      text not null check (scope ~ '^[0-9a-f]{32}$'),
  data       text not null check (length(data) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists keeper_log_scope_idx on public.keeper_log (scope);

create table if not exists public.keeper_key (
  id       int primary key default 1 check (id = 1),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$')
);

alter table public.keeper_log enable row level security;
alter table public.keeper_key enable row level security;
revoke all on public.keeper_log, public.keeper_key from anon, authenticated;

create or replace function public.keeper_key_ok(p_key text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.keeper_key
    where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
  );
$$;

create or replace function public.keeper_check(p_key text) returns boolean
  language sql stable security definer set search_path = ''
as $$ select public.keeper_key_ok(p_key); $$;

-- p_rows: [{ "id": uuid, "scope": hex, "data": base64 }, …], at most 500 per call.
create or replace function public.keeper_append(p_key text, p_rows jsonb) returns int
  language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  if not public.keeper_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'bad rows' using errcode = '22023'; end if;
  insert into public.keeper_log (id, scope, data)
    select (r->>'id')::uuid, r->>'scope', r->>'data' from jsonb_array_elements(p_rows) r
    on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.keeper_list(p_key text, p_scope text)
  returns table (id uuid, scope text, data text)
  language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.keeper_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select l.id, l.scope, l.data from public.keeper_log l
    where p_scope is null or l.scope = p_scope order by l.created_at;
end $$;

-- Changing the scorekeeper password: the old key authorises the new key's fingerprint.
create or replace function public.keeper_set_key(p_key text, p_new_hash text) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.keeper_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.keeper_key set key_hash = p_new_hash where id = 1;
end $$;

-- Only the setup tool's check removes rows: its own test entries, by id.
create or replace function public.keeper_delete_test(p_key text, p_id uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.keeper_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.keeper_log where id = p_id and scope = '00000000000000000000000000000000';
end $$;

-- Removing a whole game (a test, or one logged twice): `keeper.ts forget <slug>`, from the coach's PC.
create or replace function public.keeper_forget(p_key text, p_scope text) returns int
  language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  if not public.keeper_key_ok(p_key) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.keeper_log where scope = p_scope;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.keeper_key_ok(text) from public, anon, authenticated;
revoke all on function public.keeper_check(text), public.keeper_append(text, jsonb), public.keeper_list(text, text),
  public.keeper_set_key(text, text), public.keeper_delete_test(text, uuid), public.keeper_forget(text, text) from public;
grant execute on function public.keeper_check(text), public.keeper_append(text, jsonb), public.keeper_list(text, text),
  public.keeper_set_key(text, text), public.keeper_delete_test(text, uuid), public.keeper_forget(text, text) to anon, authenticated;

-- The scorekeeper key's fingerprint (filled in by `keeper.ts setup-sql`).
insert into public.keeper_key (id, key_hash) values (1, '__KEY_HASH__')
  on conflict (id) do update set key_hash = excluded.key_hash;
