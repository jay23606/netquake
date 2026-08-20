-- One lobby, two games.
--
-- Rooms carry which engine they belong to so a single room list can serve both
-- Quake 1 and Quake 2. Existing rooms predate Quake 2 and default to 'q1'.

alter table public.nq_rooms add column if not exists game text not null default 'q1';

do $$ begin
  alter table public.nq_rooms add constraint nq_rooms_game_chk
    check (game in ('q1', 'q2'));
exception when duplicate_object then null; end $$;

create index if not exists nq_rooms_game_open_idx
  on public.nq_rooms (game, is_open, created_at desc);
