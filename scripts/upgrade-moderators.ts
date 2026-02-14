import { getSupabase } from '../src/services/supabase.js';

async function upgradeAllUsers() {
    const supabase = getSupabase();
    console.log('--- Upgrading all users to Moderator for testing ---');

    const { data: identities, error: selectError } = await supabase
        .from('identities')
        .select('did, username');

    if (selectError) {
        console.log(`Select Error: ${selectError.message}`);
        return;
    }

    if (identities) {
        for (const id of identities) {
            console.log(`Upgrading ${id.username}...`);
            const { error: updateError } = await supabase
                .from('identities')
                .update({ roles: ['user', 'moderator'] })
                .eq('did', id.did);

            if (updateError) {
                console.log(`  Update Error for ${id.username}: ${updateError.message}`);
            } else {
                console.log(`  ✅ ${id.username} is now a Moderator.`);
            }
        }
    }
}

upgradeAllUsers();
