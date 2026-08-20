-- Close a room once its last player leaves.
--
-- Until now only the host leaving closed a room. A room whose host row was
-- removed some other way, or whose players all left individually, could sit in
-- the list with nobody in it until the reaper caught it 45 minutes later.

create or replace function public.nq_close_empty_room()
returns trigger language plpgsql security definer as $$
begin
  if not exists (
    select 1 from public.nq_room_players p where p.room_id = old.room_id
  ) then
    delete from public.nq_rooms where id = old.room_id;
  end if;
  return old;
end;
$$;

drop trigger if exists nq_close_room_when_empty on public.nq_room_players;
create trigger nq_close_room_when_empty
  after delete on public.nq_room_players
  for each row execute function public.nq_close_empty_room();
