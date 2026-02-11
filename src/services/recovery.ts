import { getSupabase } from './supabase.js';
import { getIdentity } from './auth.js';
import type {
    ApiResult,
    Identity,
    Guardian,
    RecoveryRequest,
    RecoveryApproval,
    SetGuardiansRequest,
    InitiateRecoveryRequest,
    InitiateRecoveryResponse,
    GuardianInfo,
    RecoveryRequestInfo
} from '../types/index.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate required approvals (Optimization: stored in request or calc on fly?)
 * Simple majority rule: ceil((N+1)/2)
 */
async function getRequiredApprovals(did: string): Promise<number> {
    const { count, error } = await getSupabase()
        .from('guardians')
        .select('*', { count: 'exact', head: true })
        .eq('did', did);

    if (error || count === null) return 0;
    if (count === 0) return 0;

    // Majority:
    // 1 guardian -> 1 vote
    // 2 guardians -> 2 votes (for safety) 
    // 3 guardians -> 2 votes
    // Formula: floor(n/2) + 1
    return Math.floor(count / 2) + 1;
}

// =============================================================================
// Guardian Management
// =============================================================================

export async function setGuardians(
    did: string,
    request: SetGuardiansRequest
): Promise<ApiResult<boolean>> {
    const { guardian_dids, nicknames } = request;

    if (!guardian_dids || guardian_dids.length === 0) {
        return { success: false, error: { code: 'INVALID_REQUEST', message: 'No guardians provided' } };
    }

    // Verify self is not guardian
    if (guardian_dids.includes(did)) {
        return { success: false, error: { code: 'INVALID_REQUEST', message: 'Cannot be your own guardian' } };
    }

    // Verify all guardians exist
    for (const gDid of guardian_dids) {
        const identity = await getIdentity(gDid);
        if (!identity) {
            console.log(`[setGuardians] Guardian not found: ${gDid}`);
            return {
                success: false,
                error: { code: 'GUARDIAN_NOT_FOUND', message: `Guardian ${gDid} not found` }
            };
        }
    }

    // Transaction-like update: Delete old, Insert new
    // Supabase doesn't support easy transactions via JS client without RPC, 
    // so we'll do it sequentially. Ideally use RPC. 

    // 1. Delete existing guardians
    const { error: deleteError } = await getSupabase()
        .from('guardians')
        .delete()
        .eq('did', did);

    if (deleteError) {
        return { success: false, error: { code: 'DB_ERROR', message: deleteError.message } };
    }

    // 2. Insert new guardians
    const alertsToInsert = guardian_dids.map(gDid => ({
        did: did,
        guardian_did: gDid,
        nickname: nicknames ? nicknames[gDid] : null
    }));

    const { error: insertError } = await getSupabase()
        .from('guardians')
        .insert(alertsToInsert);

    if (insertError) {
        return { success: false, error: { code: 'DB_ERROR', message: insertError.message } };
    }

    return { success: true, data: true };
}

export async function getGuardians(did: string): Promise<ApiResult<{
    my_guardians: GuardianInfo[],
    guarding_for: GuardianInfo[]
}>> {
    // 1. Get my guardians
    const { data: myGuardiansData, error: myError } = await getSupabase()
        .from('guardians')
        .select(`
            guardian_did,
            nickname,
            identities!guardians_guardian_did_fkey (
                username
            )
        `)
        .eq('did', did);

    if (myError) return { success: false, error: { code: 'DB_ERROR', message: myError.message } };

    const my_guardians: GuardianInfo[] = myGuardiansData.map((g: any) => ({
        did: g.guardian_did,
        username: g.identities?.username || 'Unknown',
        nickname: g.nickname
    }));

    // 2. Get who I am guarding
    const { data: guardingData, error: guardingError } = await getSupabase()
        .from('guardians')
        .select(`
            did,
            nickname,
            identities!guardians_did_fkey (
                username
            )
        `)
        .eq('guardian_did', did);

    if (guardingError) return { success: false, error: { code: 'DB_ERROR', message: guardingError.message } };

    const guarding_for: GuardianInfo[] = guardingData.map((g: any) => ({
        did: g.did,
        username: g.identities?.username || 'Unknown',
        nickname: g.nickname // Nickname they gave me? No, nickname is on the relationship.
        // Actually the table structure 'nickname' is likely what 'did' calls 'guardian_did'. 
        // So here it's arguably irrelevant or what they call me.
    }));

    return { success: true, data: { my_guardians, guarding_for } };
}

// =============================================================================
// Recovery Workflow
// =============================================================================

export async function initiateRecovery(
    request: InitiateRecoveryRequest
): Promise<ApiResult<InitiateRecoveryResponse>> {
    const { target_did, new_password_hash, new_salt, new_mnemonic_hashes } = request;

    // Verify target exists
    const identity = await getIdentity(target_did);
    if (!identity) {
        return { success: false, error: { code: 'IDENTITY_NOT_FOUND', message: 'Target identity not found' } };
    }

    // Check if there are guardians
    const requiredApprovals = await getRequiredApprovals(target_did);
    if (requiredApprovals === 0) {
        return {
            success: false,
            error: { code: 'NO_GUARDIANS', message: 'No guardians set for this account. Cannot recover.' }
        };
    }

    // Create Request
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const { data, error } = await getSupabase()
        .from('recovery_requests')
        .insert({
            did: target_did,
            new_password_hash,
            new_salt,
            new_mnemonic_hashes,
            status: 'pending',
            expires_at: expiresAt.toISOString()
        })
        .select()
        .single();

    if (error || !data) {
        return { success: false, error: { code: 'DB_ERROR', message: error?.message || 'Failed to create request' } };
    }

    return {
        success: true,
        data: {
            request_id: data.id,
            expires_at: data.expires_at
        }
    };
}

export async function getPendingRecoveryRequests(
    guardian_did: string
): Promise<ApiResult<RecoveryRequestInfo[]>> {
    // Find active requests where I am a guardian for the target 'did'

    // 1. Get DIDs I function as guardian for
    const { data: guarding, error: gError } = await getSupabase()
        .from('guardians')
        .select('did')
        .eq('guardian_did', guardian_did);

    if (gError) return { success: false, error: { code: 'DB_ERROR', message: gError.message } };

    const targetDids = guarding.map((g: any) => g.did);
    if (targetDids.length === 0) return { success: true, data: [] };

    // 2. Get pending requests for these DIDs
    const { data: requests, error: rError } = await getSupabase()
        .from('recovery_requests')
        .select(`
            id,
            did,
            created_at,
            expires_at,
            identities!recovery_requests_did_fkey ( username )
        `)
        .in('did', targetDids)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString());

    if (rError) return { success: false, error: { code: 'DB_ERROR', message: rError.message } };

    // 3. For each request, check approval status + counts
    const result: RecoveryRequestInfo[] = [];

    for (const req of requests) {
        // Check if I already approved
        const { count: myVote } = await getSupabase()
            .from('recovery_approvals')
            .select('*', { count: 'exact', head: true })
            .eq('request_id', req.id)
            .eq('guardian_did', guardian_did);

        const { count: totalVotes } = await getSupabase()
            .from('recovery_approvals')
            .select('*', { count: 'exact', head: true })
            .eq('request_id', req.id);

        const required = await getRequiredApprovals(req.did);

        result.push({
            id: req.id,
            target_did: req.did,
            target_username: (req as any).identities?.username || 'Unknown',
            created_at: req.created_at,
            expires_at: req.expires_at,
            approvals: totalVotes || 0,
            required_approvals: required,
            has_approved: !!(myVote && myVote > 0)
        });
    }

    return { success: true, data: result };
}

export async function approveRecovery(
    guardian_did: string,
    request_id: string
): Promise<ApiResult<boolean>> {
    // 1. Verify Request exists and is pending
    const { data: request, error: rError } = await getSupabase()
        .from('recovery_requests')
        .select('*')
        .eq('id', request_id)
        .single();

    if (rError || !request) return { success: false, error: { code: 'REQUEST_NOT_FOUND', message: 'Request not found' } };
    if (request.status !== 'pending') return { success: false, error: { code: 'INVALID_STATUS', message: 'Request not pending' } };
    if (new Date(request.expires_at) < new Date()) return { success: false, error: { code: 'EXPIRED', message: 'Request expired' } };

    // 2. Verify I am a guardian for this DID
    const { count: isGuardian } = await getSupabase()
        .from('guardians')
        .select('*', { count: 'exact', head: true })
        .eq('did', request.did)
        .eq('guardian_did', guardian_did);

    if (!isGuardian) return { success: false, error: { code: 'NOT_AUTHORIZED', message: 'You are not a guardian' } };

    // 3. Record Vote
    const { error: voteError } = await getSupabase()
        .from('recovery_approvals')
        .insert({
            request_id,
            guardian_did
        });

    if (voteError) {
        // Likely unique constraint violation if already voted
        if (voteError.code === '23505') return { success: false, error: { code: 'ALREADY_VOTED', message: 'You already approved this request' } };
        return { success: false, error: { code: 'DB_ERROR', message: voteError.message } };
    }

    return { success: true, data: true };
}

export async function finalizeRecovery(
    request_id: string
): Promise<ApiResult<boolean>> {
    // 1. Get Request
    const { data: request, error: rError } = await getSupabase()
        .from('recovery_requests')
        .select('*')
        .eq('id', request_id)
        .single();

    if (rError || !request) return { success: false, error: { code: 'REQUEST_NOT_FOUND', message: 'Request not found' } };
    if (request.status !== 'pending') return { success: false, error: { code: 'INVALID_STATUS', message: 'Request not pending' } };

    // 2. Check threshold
    const required = await getRequiredApprovals(request.did);
    const { count: votes } = await getSupabase()
        .from('recovery_approvals')
        .select('*', { count: 'exact', head: true })
        .eq('request_id', request_id);

    if ((votes || 0) < required) {
        return {
            success: false,
            error: { code: 'INSUFFICIENT_VOTES', message: `Only ${votes}/${required} approvals received` }
        };
    }

    // 3. EXECUTING ROTATION
    // Ideally use a transaction/RPC here.
    // A. Update auth_credentials
    const { error: updateError } = await getSupabase()
        .from('auth_credentials')
        .update({
            password_hash: request.new_password_hash,
            salt: request.new_salt,
            mnemonic_hashes: request.new_mnemonic_hashes
        })
        .eq('did', request.did);

    if (updateError) return { success: false, error: { code: 'UPDATE_FAILED', message: updateError.message } };

    // B. Mark request as completed
    await getSupabase()
        .from('recovery_requests')
        .update({ status: 'completed' })
        .eq('id', request_id);

    return { success: true, data: true };
}
