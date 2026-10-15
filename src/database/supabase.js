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

module.exports = { supabase };
