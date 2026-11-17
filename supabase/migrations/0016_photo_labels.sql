-- Claude describes and tags each phone photo once (lib/photos/job.ts); the site places photos by those tags.
-- Labels are written by the site's server (service role) only. Mason's session still changes nothing but hidden.

alter table public.collector_photo
  add column description text check (description is null or length(btrim(description)) between 1 and 200),
  add column kind text check (kind is null or kind in ('portrait', 'travel', 'event', 'food', 'scenery', 'other')),
  -- Where the photo may go on the site; slideshow, the About portrait and the coffee page.
  add column places text[] check (places is null or places <@ array['slideshow', 'about', 'coffee']::text[]),
  -- 1-10, how good a photo of Mason it is; the best one wins a single spot like the About portrait.
  add column score smallint check (score is null or score between 1 and 10),
  add column labeled_at timestamptz,
  -- Counts only failures that were the photo's fault, so a bad photo stops being retried after a few tries.
  add column label_attempts smallint not null default 0 check (label_attempts between 0 and 100),
  add column label_error text check (label_error is null or length(label_error) <= 100),
  add constraint collector_photo_label_complete check (
    (labeled_at is null and kind is null and places is null and score is null and description is null)
    or (labeled_at is not null and kind is not null and places is not null and score is not null)
  );

create index collector_photo_unlabeled_idx on public.collector_photo (taken_at desc, id desc)
  where labeled_at is null and not hidden;

-- The phone's insert may only name the photo's own columns, so it can never send a label of its own.
revoke insert on table public.collector_photo from authenticated;
grant insert (path, asset_id, taken_at, width, height) on table public.collector_photo to authenticated;

comment on column public.collector_photo.description is
  'Alt text from Claude. Never names a place, landmark, business or anyone but Mason; lib/photos/privacy.ts drops any that might.';

-- ai_usage.item_id points at hub items, so a photo's asset id goes in purpose instead.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('ideas', 'news', 'learn', 'photos'));

-- Every 15 minutes, so a new photo is labeled and placed within about a quarter of an hour of the upload.
select cron.schedule('hub-photos', '*/15 * * * *', $$ select public.hub_post_event('photos') $$);
