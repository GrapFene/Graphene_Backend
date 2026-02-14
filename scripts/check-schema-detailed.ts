import { getSupabase } from '../src/services/supabase.js';

async function checkDetailedSchema() {
    const supabase = getSupabase();
    console.log('--- Detailed Schema Check ---');

    // Check if identities has roles column
    const { data: identities, error: idError } = await supabase.from('identities').select('*').limit(1);
    if (idError) {
        console.log(`Identities table error: ${idError.message}`);
    } else if (identities && identities.length > 0) {
        const columns = Object.keys(identities[0]);
        console.log(`Identities columns: ${columns.join(', ')}`);
        console.log(`Has 'roles' column: ${columns.includes('roles')}`);
    } else {
        console.log('Identities table is empty, cannot check columns via select *');
    }

    const tables = ['blocked_instances', 'sync_rejection_logs', 'sync_retry_queue'];
    for (const table of tables) {
        const { error } = await supabase.from(table).select('*').limit(1);
        if (error) {
            console.log(`Table "${table}": ❌ MISSING (${error.message})`);
        } else {
            console.log(`Table "${table}": ✅ EXISTS`);
        }
    }
}

checkDetailedSchema();
