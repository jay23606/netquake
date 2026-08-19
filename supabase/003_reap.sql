-- Stale-room reaping.
--
-- A room is only closed when its host's row is deleted, which needs an explicit
-- leave. A host who crashes, force-quits, or is on mobile Safari (where the
-- unload handler often does not run) strands a room nobody can play in.
--
-- Reaping by nq_rooms.updated_at alone would be wrong: that column only moved
-- when the host edited settings, so a lobby full of people chatting looked
-- idle. These triggers make updated_at mean "last activity in this room", after
-- which a simple age test is safe.

create or replace function public.nq_touch_room()
returns trigger language plpgsql security definer as $$
begin
  update public.nq_rooms set updated_at = now() where id = new.room_id;
  return new;
end;
$$;

drop trigger if exists nq_touch_room_on_chat on public.nq_chat;
create trigger nq_touch_room_on_chat
  after insert on public.nq_chat
  for each row execute function public.nq_touch_room();

drop trigger if exists nq_touch_room_on_join on public.nq_room_players;
create trigger nq_touch_room_on_join
  after insert on public.nq_room_players
  for each row execute function public.nq_touch_room();

-- Deleting the room cascades to its players, chat and bans.
-- Dropped first: the original returned void and a return type cannot be
-- changed by create-or-replace.
drop function if exists public.nq_reap_stale_rooms(interval);
create or replace function public.nq_reap_stale_rooms(max_age interval default '45 minutes')
returns integer language plpgsql security definer as $$
declare removed integer;
begin
  with gone as (
    delete from public.nq_rooms where updated_at < now() - max_age returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;

select cron.unschedule('nq-reap-stale-rooms')
  where exists (select 1 from cron.job where jobname = 'nq-reap-stale-rooms');

select cron.schedule(
  'nq-reap-stale-rooms', '*/15 * * * *', $$select public.nq_reap_stale_rooms()$$);
