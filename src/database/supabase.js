const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

if (!config.supabase.url || !config.supabase.key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment configuration.');
}

const supabase = createClient(config.supabase.url, config.supabase.key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

const uvsUrl = config.uvsSupabase?.url || config.supabase.url;
const uvsKey = config.uvsSupabase?.key || config.supabase.key;

const uvsSupabase = createClient(uvsUrl, uvsKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

module.exports = { supabase, uvsSupabase };
