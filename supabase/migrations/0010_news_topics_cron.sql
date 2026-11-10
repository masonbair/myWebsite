-- The news job's schedule, the link from a Claude charge to its issue, and the first topic list.

-- ai_usage keeps its grants, RLS and no-update/no-delete triggers from 0008; this only adds a nullable link.
alter table public.ai_usage add column news_issue_id uuid references public.news_issues (id);

select cron.schedule('hub-news', '*/30 * * * *', $$ select public.hub_post_event('news') $$);

-- Provisional list until the model comparison (Task 5) drafts the real one; that run may rename or retire these.
insert into public.news_topics (slug, name) values
  ('ai-models', 'AI models'),
  ('chips', 'Chips'),
  ('climate-change', 'Climate change'),
  ('interest-rates', 'Interest rates'),
  ('jobs', 'Jobs'),
  ('retail', 'Retail'),
  ('crypto', 'Crypto'),
  ('ev-batteries', 'EVs and batteries'),
  ('streaming', 'Streaming'),
  ('space', 'Space'),
  ('cybersecurity', 'Cybersecurity'),
  ('healthcare', 'Healthcare'),
  ('energy', 'Energy'),
  ('housing', 'Housing'),
  ('trade-tariffs', 'Trade and tariffs'),
  ('earnings', 'Earnings'),
  ('ipos', 'IPOs'),
  ('mergers', 'Mergers'),
  ('regulation', 'Regulation'),
  ('social-media', 'Social media'),
  ('consumer-tech', 'Consumer tech'),
  ('autos', 'Autos'),
  ('travel', 'Travel'),
  ('food-and-beverage', 'Food and beverage'),
  ('media', 'Media'),
  ('labor', 'Labor'),
  ('inflation', 'Inflation'),
  ('banking', 'Banking'),
  ('venture-capital', 'Venture capital'),
  ('robotics', 'Robotics')
on conflict (slug) do nothing;
