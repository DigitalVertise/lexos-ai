-- Ping the free Render agent runtime every 10 minutes so WhatsApp and voice
-- replies stay fast (GitHub's scheduled workflows proved unreliable for this).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'lexos-keep-runtime-awake',
  '*/10 * * * *',
  $$select net.http_get(url := 'https://lexos-ai-api.onrender.com/health', timeout_milliseconds := 60000)$$
);
