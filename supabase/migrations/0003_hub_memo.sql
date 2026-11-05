-- Files one HiDock memo in a single transaction, so a crash can never leave a memo_files row without its item or transcript.
-- Security invoker: only service_role may call it, and the 0002 triggers on items and comments still run.
create function public.hub_accept_memo(
  p_file text,
  p_recorded timestamp,
  p_device text,
  p_title text,
  p_description text,
  p_transcript_parts text[],
  p_actor text
) returns table (item_id uuid, duplicate boolean)
language plpgsql set search_path = ''
as $$
declare
  new_item uuid;
  part_number bigint;
  part text;
begin
  if coalesce(p_file, '') = '' then
    raise exception 'a memo needs a file name';
  end if;
  if p_device is null or p_device not in ('phone', 'mac') then
    raise exception 'a memo device must be phone or mac';
  end if;
  if coalesce(cardinality(p_transcript_parts), 0) = 0 then
    raise exception 'a memo needs a transcript';
  end if;

  -- A concurrent upload of the same file waits here for the first one to commit, then sees its row.
  insert into public.memo_files (file, recorded, device, accepted_at)
  values (p_file, p_recorded, p_device, now())
  on conflict (file) do nothing;
  if not found then
    return query select m.item_id, true from public.memo_files m where m.file = p_file;
    return;
  end if;

  insert into public.items (title, description, labels, list, source)
  values (p_title, p_description, array['hidock-memo'], 'inbox', 'memo:' || p_device)
  returning id into new_item;

  update public.memo_files set item_id = new_item where file = p_file;

  -- now() is fixed for the transaction, so each part gets a microsecond more to keep them in order.
  for part, part_number in select t.body, t.n from unnest(p_transcript_parts) with ordinality as t(body, n) loop
    insert into public.comments (item_id, body, author, created_at)
    values (new_item, part, 'worker', now() + part_number * interval '1 microsecond');
  end loop;

  insert into public.audit_log (actor, action, item_id, detail)
  values (p_actor, 'add', new_item, jsonb_build_object('source', 'memo:' || p_device, 'file', p_file));

  return query select new_item, false;
end;
$$;

revoke execute on function public.hub_accept_memo(text, timestamp, text, text, text, text[], text)
  from public, anon, authenticated;
grant execute on function public.hub_accept_memo(text, timestamp, text, text, text, text[], text) to service_role;
