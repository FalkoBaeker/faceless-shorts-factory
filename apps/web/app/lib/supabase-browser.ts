import { createClient } from '@supabase/supabase-js';

let singleton: ReturnType<typeof createClient> | null = null;

export const getSupabaseBrowserClient = () => {
  if (singleton) return singleton;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('SUPABASE_BROWSER_CONFIG_MISSING');
  }

  singleton = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });

  return singleton;
};
