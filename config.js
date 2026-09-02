/* ============================================================================
   YOSOGO public config
   ----------------------------------------------------------------------------
   Safe to commit: the Supabase "anon" key is meant to be public — it only
   grants what your Row Level Security policies (see schema.sql) allow it to.
   Never put your Supabase "service_role" key here or anywhere in this repo;
   it lives only in the Cloudflare Worker's secrets (see worker/README.md).
   ============================================================================ */
window.YOSOGO_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",

  // Your deployed Cloudflare Worker, e.g. https://yosogo-api.yourname.workers.dev
  WORKER_URL: "https://yosogo-api.YOUR-SUBDOMAIN.workers.dev"
};
