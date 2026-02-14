// =============================================================================
// Graphene: Moderation Service
// =============================================================================

import { getSupabase } from './supabase.js';
import type { BlockedInstance, SyncRejectionLog } from '../types/moderation.js';

/**
 * Check if a user has moderator or admin role.
 */
export async function hasModeratorRole(did: string): Promise<boolean> {
    const supabase = getSupabase();

    const { data: identity, error } = await supabase
        .from('identities')
        .select('roles')
        .eq('did', did)
        .maybeSingle();

    if (error || !identity) {
        return false;
    }

    const roles = identity.roles || [];
    return roles.includes('moderator') || roles.includes('admin');
}

/**
 * Block an instance by adding it to the denylist.
 */
export async function blockInstance(
    instanceUrl: string,
    reason: string,
    moderatorDid: string
): Promise<BlockedInstance> {
    const supabase = getSupabase();
    const normalizedUrl = instanceUrl.replace(/\/$/, '');

    // Check if already blocked
    const { data: existing } = await supabase
        .from('blocked_instances')
        .select('id')
        .eq('instance_url', normalizedUrl)
        .eq('is_active', true)
        .maybeSingle();

    if (existing) {
        throw new Error('Instance is already blocked');
    }

    // Insert new block
    const { data, error } = await supabase
        .from('blocked_instances')
        .insert({
            instance_url: normalizedUrl,
            reason,
            blocked_by_did: moderatorDid,
            is_active: true
        })
        .select()
        .maybeSingle();

    if (error || !data) {
        console.error('Error blocking instance:', error);
        throw new Error(`Failed to block instance: ${error?.message || 'No data returned'}`);
    }

    return data as BlockedInstance;
}

/**
 * Unblock an instance by setting is_active to false.
 */
export async function unblockInstance(
    instanceUrl: string,
    moderatorDid: string
): Promise<void> {
    const supabase = getSupabase();
    const normalizedUrl = instanceUrl.replace(/\/$/, '');

    const { error } = await supabase
        .from('blocked_instances')
        .update({ is_active: false })
        .eq('instance_url', normalizedUrl)
        .eq('is_active', true);

    if (error) {
        console.error('Error unblocking instance:', error);
        throw new Error(`Failed to unblock instance: ${error.message}`);
    }
}

/**
 * Check if an instance is currently blocked.
 */
export async function isInstanceBlocked(instanceUrl: string): Promise<boolean> {
    const supabase = getSupabase();
    const normalizedUrl = instanceUrl.replace(/\/$/, '');

    const { data, error } = await supabase
        .from('blocked_instances')
        .select('id')
        .eq('instance_url', normalizedUrl)
        .eq('is_active', true)
        .maybeSingle();

    return !error && !!data;
}

/**
 * Get all blocked instances.
 */
export async function getBlockedInstances(): Promise<BlockedInstance[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('blocked_instances')
        .select('*')
        .eq('is_active', true)
        .order('blocked_at', { ascending: false });

    if (error) {
        console.error('Error fetching blocked instances:', error);
        throw new Error(`Failed to fetch blocked instances: ${error.message}`);
    }

    return (data || []) as BlockedInstance[];
}

/**
 * Log a rejected sync attempt.
 */
export async function logSyncRejection(
    instanceUrl: string,
    reason: string,
    metadata?: any
): Promise<void> {
    const supabase = getSupabase();

    const { error } = await supabase
        .from('sync_rejection_logs')
        .insert({
            instance_url: instanceUrl.replace(/\/$/, ''),
            rejection_reason: reason,
            request_metadata: metadata || null
        });

    if (error) {
        console.error('Error logging sync rejection:', error);
    }
}

/**
 * Get sync rejection logs (for audit purposes).
 */
export async function getSyncRejectionLogs(
    limit: number = 100
): Promise<SyncRejectionLog[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('sync_rejection_logs')
        .select('*')
        .order('attempted_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching sync rejection logs:', error);
        throw new Error(`Failed to fetch rejection logs: ${error.message}`);
    }

    return (data || []) as SyncRejectionLog[];
}

