// =============================================================================
// Graphene: Startup Announce
// =============================================================================
//
// On server startup, send a signed Announce envelope to every peer listed in
// KNOWN_PEERS. This auto-registers this instance in each peer's known_peers
// table so they can route posts and health checks correctly.
//
// Fire-and-forget — failures are logged but never crash the server.
// =============================================================================

import { config } from '../config/index.js';
import { signPayload, INSTANCE_PUBLIC_ADDRESS } from '../lib/federation/crypto.js';
import type { FederationEnvelope, FederatedAnnounce } from '../types/federation.js';

async function sendAnnounce(targetDomain: string): Promise<void> {
    const payload: FederatedAnnounce = {
        instance_domain: config.federation.instanceDomain,
        instance_name: `Graphene @ ${config.federation.instanceDomain}`,
        public_address: INSTANCE_PUBLIC_ADDRESS,
    };

    const signature = await signPayload(payload);

    const envelope: FederationEnvelope = {
        type: 'Announce',
        actor_domain: config.federation.instanceDomain,
        timestamp: new Date().toISOString(),
        payload,
        signature,
    };

    const protocols = ['https', 'http'];
    let lastError: any = null;
    let success = false;

    for (const protocol of protocols) {
        try {
            const url = `${protocol}://${targetDomain}/federation/inbox`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Graphene-Actor': config.federation.instanceDomain,
                    'ngrok-skip-browser-warning': 'true',
                },
                body: JSON.stringify(envelope),
                signal: AbortSignal.timeout(5000),
            });

            if (res.ok) {
                success = true;
                break; 
            } else {
                const body = await res.text().catch(() => '');
                lastError = new Error(`HTTP ${res.status}: ${body}`);
            }
        } catch (err: any) {
            lastError = err;
            // Continue to next protocol (usually http)
        }
    }

    if (!success) {
        throw lastError || new Error(`Failed to announce to ${targetDomain}`);
    }
    console.log(`[announce] ✅ Announced to ${targetDomain}`);
}

export async function announceToKnownPeers(): Promise<void> {
    const peers = config.federation.knownPeers;
    if (peers.length === 0) {
        console.log('[announce] No KNOWN_PEERS configured, skipping startup announce.');
        return;
    }

    console.log(`[announce] 📣 Announcing to ${peers.length} known peer(s): ${peers.join(', ')}`);

    await Promise.allSettled(
        peers.map(domain =>
            sendAnnounce(domain).catch(err =>
                console.warn(`[announce] ⚠️ Failed to announce to ${domain}: ${err.message}`)
            )
        )
    );
}
