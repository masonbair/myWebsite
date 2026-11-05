-- Reminders, the daily backup and the claude approval call the app through pg_net.
-- The app URL and token live in Vault (hub_events_url, hub_events_token), so neither is in git; see docs/hub-setup.md.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Only the server may make outbound requests. On Supabase, supabase_admin grants anon and authenticated rights in net,
-- and postgres cannot revoke another role's grant, so these lines can't remove those rights. The real guard is that net is
-- not an API schema (supabase/config.toml), checked in tests/unit/hub/pg-net.integration.test.ts.
revoke execute on all functions in schema net from anon, authenticated;
revoke usage on schema net from anon, authenticated;

-- Posts quietly to /api/hub/events/<event>, or does nothing (returns null) while either Vault secret is missing
-- or the URL is not https (plain http only for a local stub), so the bearer token never travels in the clear.
create function public.hub_post_event(p_event text, p_body jsonb default '{}') returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  base_url text;
  token text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'hub_events_url';
  select decrypted_secret into token from vault.decrypted_secrets where name = 'hub_events_token';
  if coalesce(base_url, '') = '' or coalesce(token, '') = '' then
    return null;
  end if;
  if base_url !~* '^https://' and base_url !~* '^http://(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]+)?(/|$)' then
    return null;
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/api/hub/events/' || p_event,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || token),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function public.hub_post_event(text, jsonb) from public, anon, authenticated, service_role;

create function public.items_fire_approved() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  had_claude boolean := tg_op = 'UPDATE' and coalesce(old.labels @> array['claude'], false);
begin
  if new.state <> 'open' or had_claude or not coalesce(new.labels @> array['claude'], false) then
    return null;
  end if;
  -- Mason's edit must save even when Vault or pg_net is broken; the worker's scheduled run picks the item up anyway.
  begin
    perform public.hub_post_event('approved', jsonb_build_object('id', new.id));
  exception when others then
    raise warning 'hub approved event not sent for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.items_fire_approved() from public, anon, authenticated, service_role;

-- Insert too, as todo-hub's relay fired on item:added: an item can be created already approved.
create trigger items_fire_approved after insert or update of labels on public.items
  for each row execute function public.items_fire_approved();

select cron.schedule('hub-reminders', '*/5 * * * *', $$ select public.hub_post_event('reminders') $$);
select cron.schedule('hub-backup', '0 3 * * *', $$ select public.hub_post_event('backup') $$);
