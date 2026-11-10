-- Exact addresses only, never domains: Morning Brew and Tech Brew share sending infrastructure.
update public.news_sources set sender_addresses = array['crew@morningbrew.com']
where id = 'morning-brew' and sender_addresses = '{}';
update public.news_sources set sender_addresses = array['news@daily.therundown.ai']
where id = 'rundown-ai' and sender_addresses = '{}';
