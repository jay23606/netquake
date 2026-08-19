-- Lobby features: synchronised launch, live player list, chat, host controls.
-- Idempotent; safe to re-run.

-- ---------------------------------------------------------- room lifecycle
-- The host flips this to 'in-game'; every peer is watching it over Realtime
-- and launches together instead of each player pressing Start for themselves.
alter table public.nq_rooms add column if not exists status text not null default 'lobby';
do $$ begin
  alter table public.nq_rooms add constraint nq_rooms_status_chk
    check (status in ('lobby', 'in-game'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------- player presentation
alter table public.nq_room_players add column if not exists color int not null default 0;
alter table public.nq_room_players add column if not exists asset_progress int not null default 100;

-- ------------------------------------------------------------------- bans
create table if not exists public.nq_room_bans (
  room_id    uuid not null references public.nq_rooms(id) on delete cascade,
  player_id  uuid not null references public.nq_profiles(id) on delete cascade,
  banned_at  timestamptz not null default now(),
  primary key (room_id, player_id)
);

-- ------------------------------------------------------------------- chat
create table if not exists public.nq_chat (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.nq_rooms(id) on delete cascade,
  player_id  uuid references public.nq_profiles(id) on delete set null,
  kind       text not null default 'text',
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists nq_chat_room_idx on public.nq_chat (room_id, created_at);

-- -------------------------------------------------------------------- RLS
alter table public.nq_room_bans enable row level security;
alter table public.nq_chat      enable row level security;

drop policy if exists "nq_room_bans readable"    on public.nq_room_bans;
drop policy if exists "nq_room_bans host-write"  on public.nq_room_bans;
drop policy if exists "nq_room_bans host-delete" on public.nq_room_bans;

-- Readable by everyone because the join policy below consults it.
create policy "nq_room_bans readable" on public.nq_room_bans for select using (true);
create policy "nq_room_bans host-write" on public.nq_room_bans for insert
  with check (auth.uid() = (select host_id from public.nq_rooms r where r.id = room_id));
create policy "nq_room_bans host-delete" on public.nq_room_bans for delete
  using (auth.uid() = (select host_id from public.nq_rooms r where r.id = room_id));

drop policy if exists "nq_chat readable"    on public.nq_chat;
drop policy if exists "nq_chat self-insert" on public.nq_chat;

create policy "nq_chat readable" on public.nq_chat for select using (true);
-- Only your own messages, and only while you are actually in the room.
create policy "nq_chat self-insert" on public.nq_chat for insert with check (
  auth.uid() = player_id
  and exists (
    select 1 from public.nq_room_players p
    where p.room_id = nq_chat.room_id and p.player_id = auth.uid()
  )
);

-- Colour and download progress are self-service. Without an UPDATE policy any
-- upsert that resolves to DO UPDATE is rejected on the USING expression.
drop policy if exists "nq_room_players self-update" on public.nq_room_players;
create policy "nq_room_players self-update" on public.nq_room_players
  for update using (auth.uid() = player_id) with check (auth.uid() = player_id);

-- Re-joining after a ban must fail.
drop policy if exists "nq_room_players self-join" on public.nq_room_players;
create policy "nq_room_players self-join" on public.nq_room_players for insert with check (
  auth.uid() = player_id
  and not exists (
    select 1 from public.nq_room_bans b
    where b.room_id = nq_room_players.room_id and b.player_id = auth.uid()
  )
);

-- --------------------------------------------------------------- realtime
do $$
declare t text;
begin
  foreach t in array array['nq_chat', 'nq_room_bans'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
