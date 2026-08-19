-- NetQuake / Supabase: lobby + WebRTC signaling
--
-- Every object here is prefixed nq_ so this app can share a Supabase project
-- with unrelated apps without colliding. Nothing in this file touches or
-- depends on tables it does not own.
--
-- Design note: game traffic NEVER passes through Supabase. This brokers the
-- connection (rooms, presence, SDP/ICE exchange); once the WebRTC DataChannel
-- is open, all gameplay is peer-to-peer between the host and each client.

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------- nq_profiles
create table if not exists public.nq_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 15),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ nq_rooms
create table if not exists public.nq_rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,          -- short human-shareable join code
  name          text not null,
  host_id       uuid not null references public.nq_profiles(id) on delete cascade,
  map           text not null default 'e1m1',
  max_players   int  not null default 8 check (max_players between 2 and 16),
  game_settings jsonb not null default '{}'::jsonb,
  is_open       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists nq_rooms_open_idx on public.nq_rooms (is_open, created_at desc);

-- ----------------------------------------------------------- nq_room_players
create table if not exists public.nq_room_players (
  room_id    uuid not null references public.nq_rooms(id) on delete cascade,
  player_id  uuid not null references public.nq_profiles(id) on delete cascade,
  is_host    boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (room_id, player_id)
);
create index if not exists nq_room_players_room_idx on public.nq_room_players (room_id);

-- ---------------------------------------------------------------------- RLS
alter table public.nq_profiles     enable row level security;
alter table public.nq_rooms        enable row level security;
alter table public.nq_room_players enable row level security;

drop policy if exists "nq_profiles readable"    on public.nq_profiles;
drop policy if exists "nq_profiles self-insert" on public.nq_profiles;
drop policy if exists "nq_profiles self-update" on public.nq_profiles;

-- Player names are shown in lobbies, so profiles are world-readable but only
-- ever written by their owner.
create policy "nq_profiles readable"    on public.nq_profiles for select using (true);
create policy "nq_profiles self-insert" on public.nq_profiles for insert with check (auth.uid() = id);
create policy "nq_profiles self-update" on public.nq_profiles for update using (auth.uid() = id);

drop policy if exists "nq_rooms readable"    on public.nq_rooms;
drop policy if exists "nq_rooms host-insert" on public.nq_rooms;
drop policy if exists "nq_rooms host-update" on public.nq_rooms;
drop policy if exists "nq_rooms host-delete" on public.nq_rooms;

create policy "nq_rooms readable"    on public.nq_rooms for select using (true);
create policy "nq_rooms host-insert" on public.nq_rooms for insert with check (auth.uid() = host_id);
create policy "nq_rooms host-update" on public.nq_rooms for update using (auth.uid() = host_id);
create policy "nq_rooms host-delete" on public.nq_rooms for delete using (auth.uid() = host_id);

drop policy if exists "nq_room_players readable"          on public.nq_room_players;
drop policy if exists "nq_room_players self-join"         on public.nq_room_players;
drop policy if exists "nq_room_players self-or-host-part" on public.nq_room_players;

-- A player may only add themself; they may remove themself, and the room host
-- may remove anyone (kick).
create policy "nq_room_players readable"  on public.nq_room_players for select using (true);
create policy "nq_room_players self-join" on public.nq_room_players
  for insert with check (auth.uid() = player_id);
create policy "nq_room_players self-or-host-part" on public.nq_room_players
  for delete using (
    auth.uid() = player_id
    or auth.uid() = (select host_id from public.nq_rooms r where r.id = room_id)
  );

-- ------------------------------------------------- realtime + housekeeping
-- Idempotent: re-running the script must not fail on an existing membership.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nq_rooms'
  ) then
    alter publication supabase_realtime add table public.nq_rooms;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nq_room_players'
  ) then
    alter publication supabase_realtime add table public.nq_room_players;
  end if;
end
$$;

-- Deleting the host's row closes the room.
create or replace function public.nq_close_room_when_host_leaves()
returns trigger language plpgsql security definer as $$
begin
  if old.is_host then
    delete from public.nq_rooms where id = old.room_id;
  end if;
  return old;
end;
$$;

drop trigger if exists nq_close_room_on_host_leave on public.nq_room_players;
create trigger nq_close_room_on_host_leave
  after delete on public.nq_room_players
  for each row execute function public.nq_close_room_when_host_leaves();

-- Reap rooms abandoned without a clean leave (call from a scheduled job).
create or replace function public.nq_reap_stale_rooms(max_age interval default '4 hours')
returns void language sql security definer as $$
  delete from public.nq_rooms where updated_at < now() - max_age;
$$;
