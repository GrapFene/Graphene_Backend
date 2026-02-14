import { getSupabase } from '../src/services/supabase.js';

async function listRoles() {
    const supabase = getSupabase();
    console.log('--- Current Identities and Roles ---');

    const { data: identities, error } = await supabase
        .from('identities')
        .select('username, roles')
        .limit(10);

    if (error) {
        console.log(`Error: ${error.message}`);
    } else if (identities) {
        identities.forEach(id => {
            console.log(`User: ${id.username} | Roles: ${JSON.stringify(id.roles)}`);
        });
    }
}

listRoles();
