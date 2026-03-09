// =============================================================================
// Graphene: Peer Health Monitor
// =============================================================================
//
// Runs a background cron job that periodically pings every known peer's
// /health endpoint. Updates is_active + last_seen_at in the known_peers table.
//
// If a peer goes down:  is_active = false
// If a peer comes back: is_active = true, last_seen_at = now()
// =============================================================================

import { getSupabase } from './supabase.js';
import { config } from '../config/index.js';

const HEALTH_CHECK_INTERVAL_MS = 60_000; // every 60 seconds
const HEALTH_TIMEOUT_MS = 5_000;

async function checkPeerHealth(domain: string): Promise<boolean> {
    try {
        const url = `https://${domain}/health`;
        const res = await fetch(url, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            headers: { 'Accept': 'application/json' },
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function runHealthChecks(): Promise<void> {
    const supabase = getSupabase();

    const { data: peers, error } = await supabase
        .from('known_peers')
        .select('id, domain, is_active');

    if (error || !peers || peers.length === 0) return;

    await Promise.allSettled(
        peers.map(async (peer: { id: string; domain: string; is_active: boolean }) => {
            const healthy = await checkPeerHealth(peer.domain);

            if (healthy) {
                // Peer is up — mark active and update last_seen_at
                await supabase
                    .from('known_peers')
                    .update({ is_active: true, last_seen_at: new Date().toISOString() })
                    .eq('id', peer.id);

                if (!peer.is_active) {
                    console.log(`[peer-health] ✅ Peer back online: ${peer.domain}`);
                }
            } else {
                // Peer is down — mark inactive
                if (peer.is_active) {
                    console.warn(`[peer-health] ❌ Peer went offline: ${peer.domain}`);
                    await supabase
                        .from('known_peers')
                        .update({ is_active: false })
                        .eq('id', peer.id);
                }
            }
        })
    );
}

export function startPeerHealthMonitor(): void {
    console.log(`⚕️  Starting Peer Health Monitor (Interval: ${HEALTH_CHECK_INTERVAL_MS}ms)`);

    // Run immediately on start, then on interval
    runHealthChecks().catch(err =>
        console.error('[peer-health] Initial health check failed:', err)
    );

    setInterval(() => {
        runHealthChecks().catch(err =>
            console.error('[peer-health] Health check failed:', err)
        );
    }, HEALTH_CHECK_INTERVAL_MS);
}
