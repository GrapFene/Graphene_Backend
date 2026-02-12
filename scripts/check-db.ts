import { getSupabase } from '../src/services/supabase.js';

async function checkDb() {
    const supabase = getSupabase();
    console.log('--- DB Check Start ---');

    const tables = ['blocked_instances', 'sync_rejection_logs', 'identities'];

    for (const table of tables) {
        try {
            const { error } = await supabase.from(table).select('*').limit(1);
            if (error) {
                console.log(`Table "${table}": ❌ ERROR: ${error.message}`);
            } else {
                console.log(`Table "${table}": ✅ EXISTS`);
            }
        } catch (e: any) {
            console.log(`Table "${table}": ❌ EXCEPTION: ${e.message}`);
        }
    }
    console.log('--- DB Check End ---');
}

checkDb();
