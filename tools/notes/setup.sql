-- Coach notes. Paste into Supabase → SQL Editor → Run. Safe to run again.
--
-- Rows hold only ciphertext: the browser encrypts each note with a key derived from the coach
-- password before saving, and `scope` is an HMAC of the game, so the database never sees a note's
-- text, the game it belongs to, or the coach password.
--
-- Access is limited to the one shared coach account (COACH_EMAIL in app/src/config.ts). The project
-- allows public sign-ups, so "any signed-in user" would not be enough.

create table if not exists public.coach_notes (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null check (scope ~ '^[0-9a-f]{32}$'),
  data       text not null check (length(data) between 1 and 24000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists coach_notes_scope_idx on public.coach_notes (scope);

alter table public.coach_notes enable row level security;
revoke all on public.coach_notes from anon;
grant select, insert, update, delete on public.coach_notes to authenticated;

-- True only for the shared coach account. security definer so it can read auth.users.
create or replace function public.is_coach() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email = 'coaches@dfc-game-film.app'
  );
$$;
revoke all on function public.is_coach() from public, anon;
grant execute on function public.is_coach() to authenticated;

drop policy if exists coach_notes_coach_only on public.coach_notes;
create policy coach_notes_coach_only on public.coach_notes
  for all to authenticated
  using (public.is_coach())
  with check (public.is_coach());
