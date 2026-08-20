-- Match results, one row per player per finished match.
--
-- This is the thing a static Quake port cannot have: a match ends and it is
-- remembered. Everything else in this app is ephemeral by design; results are
-- deliberately not.
--
-- Only the host writes. The host is the server, so its scoreboard is the
-- authoritative one -- every client writing its own view would multiply every
-- match by the player count. `reported_by` records which player did the
-- writing, since RLS cannot express "is the host of this room": the host
-- inserts rows on behalf of other players, so a row-level
-- `player_id = auth.uid()` check would forbid exactly the legitimate case.

create table if not exists public.nq_match_results (
	id uuid primary key default gen_random_uuid(),
	room_id uuid references public.nq_rooms(id) on delete set null,
	game text not null default 'q1',
	map text not null,
	ended_at timestamptz not null default now(),

	player_id uuid references public.nq_profiles(id) on delete cascade,
	-- Denormalised on purpose: players rename themselves, and a scoreboard
	-- should read the way it did on the night.
	player_name text not null,
	frags integer not null default 0,
	rank integer not null default 0,
	players integer not null default 0,

	reported_by uuid default auth.uid()
);

do $$ begin
	alter table public.nq_match_results add constraint nq_match_results_game_chk
		check (game in ('q1', 'q2'));
exception when duplicate_object then null; end $$;

create index if not exists nq_match_results_player_idx
	on public.nq_match_results (player_id, ended_at desc);
create index if not exists nq_match_results_recent_idx
	on public.nq_match_results (ended_at desc);
create index if not exists nq_match_results_map_idx
	on public.nq_match_results (game, map, frags desc);

alter table public.nq_match_results enable row level security;

-- The leaderboard is public: anyone may read it, signed in or not.
do $$ begin
	create policy nq_match_results_read on public.nq_match_results
		for select using (true);
exception when duplicate_object then null; end $$;

-- Any signed-in player may report a result, because the reporter writes rows
-- for the other players too. Results are therefore trusted, not proven -- a
-- determined host could inflate them. That is an acceptable trade for a game
-- with no server to arbitrate; it is not a competitive ladder.
do $$ begin
	create policy nq_match_results_insert on public.nq_match_results
		for insert with check (auth.uid() is not null);
exception when duplicate_object then null; end $$;

-- Nothing updates or deletes a result: there is no policy for either, so RLS
-- denies both.

-- Leaderboard aggregate. A view keeps the ranking rules in one place rather
-- than in whichever client happens to be asking.
create or replace view public.nq_leaderboard as
select
	player_id,
	max(player_name) as player_name,
	game,
	count(*) as matches,
	sum(frags) as total_frags,
	max(frags) as best_frags,
	count(*) filter (where rank = 1) as wins,
	round(avg(frags)::numeric, 1) as avg_frags,
	max(ended_at) as last_played
from public.nq_match_results
where player_id is not null
group by player_id, game;
