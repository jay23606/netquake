-- End-of-match map vote.
--
-- Unlike nq_match_results, this one can be properly enforced: each player casts
-- only their own vote, so the policy is a plain auth.uid() = player_id check.
-- The host tallies and applies the winner, but it cannot forge a ballot.
--
-- `round` scopes a vote to one match. It is the same seed the clients use to
-- derive the candidate list -- room id plus the map just played -- so votes
-- from an earlier match cannot be counted toward the next one, and no cleanup
-- pass is needed to keep the tally honest.

create table if not exists public.nq_map_votes (
	room_id    uuid not null references public.nq_rooms(id) on delete cascade,
	player_id  uuid not null references public.nq_profiles(id) on delete cascade,
	round      text not null,
	map        text not null,
	created_at timestamptz not null default now(),
	primary key (room_id, player_id, round)
);

create index if not exists nq_map_votes_round_idx
	on public.nq_map_votes (room_id, round);

alter table public.nq_map_votes enable row level security;

-- Everyone in the room needs the running tally, so reads are open. A vote is
-- public by nature: the point is to see what the others picked.
do $$ begin
	create policy "nq_map_votes read" on public.nq_map_votes
		for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
	create policy "nq_map_votes self-insert" on public.nq_map_votes
		for insert with check (auth.uid() = player_id);
exception when duplicate_object then null; end $$;

-- Changing your mind before the timer runs out is allowed.
do $$ begin
	create policy "nq_map_votes self-update" on public.nq_map_votes
		for update using (auth.uid() = player_id) with check (auth.uid() = player_id);
exception when duplicate_object then null; end $$;

-- Realtime carries the running tally. Guarded the same way the other tables
-- are: adding a table twice to a publication is an error, not a no-op.
do $$ begin
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime'
			and schemaname = 'public'
			and tablename = 'nq_map_votes'
	) then
		alter publication supabase_realtime add table public.nq_map_votes;
	end if;
end $$;
