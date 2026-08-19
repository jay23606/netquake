-- NetQuake / Supabase: lobby + WebRTC signaling
--
-- Design note: game traffic NEVER passes through here. Supabase brokers the
-- connection (rooms, presence, SDP/ICE exchange); once the WebRTC DataChannel
-- is open, all gameplay is peer-to-peer between the host and each client.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 15),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- rooms
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,          -- short human-shareable join code
  name          text not null,
  host_id       uuid not null references public.profiles(id) on delete cascade,
  map           text not null default 'e1m1',
  max_players   int  not null default 8 check (max_players between 2 and 16),
  game_settings jsonb not null default '{}'::jsonb,
  is_open       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rooms_open_idx on public.rooms (is_open, created_at desc);

-- ------------------------------------------------------------ room_players
create table if not exists public.room_players (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  player_id  uuid not null references public.profiles(id) on delete cascade,
  is_host    boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (room_id, player_id)
);
create index if not exists room_players_room_idx on public.room_players (room_id);

-- --------------------------------------------------------------------- RLS
alter table public.profiles     enable row level security;
alter table public.rooms        enable row level security;
alter table public.room_players enable row level security;

-- profiles: world-readable (names shown in lobbies), self-writable
create policy "profiles readable"   on public.profiles for select using (true);
create policy "profiles self-write" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles self-update" on public.profiles for update using (auth.uid() = id);

-- rooms: open rooms are listable by anyone; only the host mutates
create policy "rooms readable"   on public.rooms for select using (true);
create policy "rooms host-insert" on public.rooms for insert with check (auth.uid() = host_id);
create policy "rooms host-update" on public.rooms for update using (auth.uid() = host_id);
create policy "rooms host-delete" on public.rooms for delete using (auth.uid() = host_id);

-- room_players: readable by anyone; a player may only add/remove THEMSELF,
-- and the room host may remove anyone (kick).
create policy "room_players readable" on public.room_players for select using (true);
create policy "room_players self-join" on public.room_players
  for insert with check (auth.uid() = player_id);
create policy "room_players self-or-host-leave" on public.room_players
  for delete using (
    auth.uid() = player_id
    or auth.uid() = (select host_id from public.rooms r where r.id = room_id)
  );

-- ------------------------------------------------- realtime + housekeeping
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;

-- Deleting the host's row closes the room.
create or replace function public.close_room_when_host_leaves()
returns trigger language plpgsql security definer as $$
begin
  if old.is_host then
    delete from public.rooms where id = old.room_id;
  end if;
  return old;
end;
$$;

drop trigger if exists close_room_on_host_leave on public.room_players;
create trigger close_room_on_host_leave
  after delete on public.room_players
  for each row execute function public.close_room_when_host_leaves();

-- Reap rooms abandoned without a clean leave (call from a scheduled job).
create or replace function public.reap_stale_rooms(max_age interval default '4 hours')
returns void language sql security definer as $$
  delete from public.rooms where updated_at < now() - max_age;
$$;
