// =============================================================================
// Graphene: Network Service — outbound federation HTTP calls
// =============================================================================

import { config } from '../config/index.js';

/**
 * Send a signed FederationEnvelope to a peer instance's inbox.
 * The envelope must already be signed by the caller (initiateOutgoingSync).
 */
export async function sendFederationSync(
    targetInstanceUrl: string,
    syncType: string,
    payload: any
): Promise<void> {
    const targetDomain = targetInstanceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const inboxUrl = `http://${targetDomain}/api/federation/inbox`;

    console.log(`📡 [network] Sending ${syncType} to ${inboxUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.federation.outboundTimeoutMs);

    try {
        const response = await fetch(inboxUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');

            // Treat these as idempotent success — no point retrying:
            // • duplicate key      → peer already has this record (race condition)
            // • already exists     → same as above
            // • Envelope expired   → stale retry; peer has likely already processed it
            // • Malformed envelope → stored payload is corrupt; retrying won't help
            const isIdempotent =
                (response.status === 422 && (body.includes('duplicate key') || body.includes('already exists'))) ||
                (response.status === 400 && (body.includes('Envelope expired') || body.includes('Malformed envelope')));

            if (isIdempotent) {
                console.log(`✅ [network] ${syncType} idempotent/stale on ${targetDomain} — treating as success`);
                return;
            }

            throw new Error(`Peer returned ${response.status}: ${body}`);
        }

        console.log(`✅ [network] ${syncType} accepted by ${targetDomain}`);
    } catch (err: any) {
        if (err.name === 'AbortError') {
            throw new Error(`Network timeout after ${config.federation.outboundTimeoutMs}ms reaching ${targetDomain}`);
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}
