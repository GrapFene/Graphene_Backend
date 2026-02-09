import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

let supabaseInstance: SupabaseClient | null = null;

/**
 * Get Supabase client instance (singleton).
 * Uses service role key for bypassing RLS in backend operations.
 */
export function getSupabase(): SupabaseClient {
    if (!supabaseInstance) {
        supabaseInstance = createClient(config.supabase.url, config.supabase.serviceKey);
    }
    return supabaseInstance;
}
