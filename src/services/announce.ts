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
import { signPayload } from '../lib/federation/crypto.js';
import type { FederationEnvelope, FederatedAnnounce } from '../types/federation.js';

async function sendAnnounce(targetDomain: string): Promise<void> {
    const payload: FederatedAnnounce = {
        instance_domain: config.federation.instanceDomain,
        instance_name: `Graphene @ ${config.federation.instanceDomain}`,
    };

    const signature = await signPayload(payload);

    const envelope: FederationEnvelope = {
        type: 'Announce',
        actor_domain: config.federation.instanceDomain,
        timestamp: new Date().toISOString(),
        payload,
        signature,
    };

    const url = `https://${targetDomain}/federation/inbox`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Graphene-Actor': config.federation.instanceDomain,
            'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body}`);
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
