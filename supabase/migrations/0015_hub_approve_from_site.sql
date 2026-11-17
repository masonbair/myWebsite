-- The site's approve actions start the worker now: pg_net's lone approval calls failed with HTTP/2 framing errors and were never retried.
drop trigger if exists items_fire_approved on public.items;
drop function if exists public.items_fire_approved();
