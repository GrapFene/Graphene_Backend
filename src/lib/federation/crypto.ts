// =============================================================================
// Graphene: Federation Crypto Utility
// =============================================================================
//
// WHY THIS EXISTS AS A SEPARATE MODULE FROM services/crypto.ts
// ------------------------------------------------------------
// services/crypto.ts handles *user-level* signing (wallet signatures for auth).
// This module handles *server-level* signing — the instance signs outbound S2S
// payloads so that peer servers can cryptographically prove the payload came
// from *this* server and was not tampered with in transit.
//
// The algorithm is the same (secp256k1 / ethers.js) but the key material and
// the subject being signed are fundamentally different.
//
// HOW THIS FITS INTO A GOSSIP PROTOCOL
// -------------------------------------
// In a gossip network each node re-broadcasts received messages to N peers.
// Before re-broadcasting, the relaying node verifies the *original* producer's
// signature (this module), then wraps the envelope in its own signature so the
// next hop can verify the relay chain. This creates an auditable provenance
// trail without a central certificate authority.
// =============================================================================

import { ethers } from 'ethers';
import { config } from '../../config/index.js';
import type { FederationEnvelope } from '../../types/federation.js';

// ---------------------------------------------------------------------------
// Local instance wallet — loaded once at module init, never recreated.
// The private key comes exclusively from the environment; the corresponding
// Ethereum address is our "Server DID" that peers verify signatures against.
// ---------------------------------------------------------------------------
const instanceWallet = new ethers.Wallet(config.federation.privateKey);

/**
 * The Ethereum address derived from this instance's FEDERATION_PRIVATE_KEY.
 * Expose this via GET /federation/actor so remote peers can verify our sigs.
 */
export const INSTANCE_PUBLIC_ADDRESS: string = instanceWallet.address.toLowerCase();

// ---------------------------------------------------------------------------
// Canonical serialisation
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic JSON string from a payload object.
 *
 * Standard JSON.stringify is non-deterministic across engines (key order can
 * vary). We sort keys recursively so the byte-for-byte string is identical
 * on both the signing side and the verification side, regardless of runtime.
 */
function canonicalJson(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);

    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalJson).join(',') + ']';
    }

    const sorted = Object.keys(obj as Record<string, unknown>)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`)
        .join(',');

    return '{' + sorted + '}';
}

// ---------------------------------------------------------------------------
// Outbound: sign a payload before sending it to peers
// ---------------------------------------------------------------------------

/**
 * Sign a federation payload with this instance's private key.
 *
 * The function returns the hex signature string. Callers embed it in the
 * FederationEnvelope.signature field before dispatching.
 *
 * @param payload - The activity object (FederatedPost, FederatedVote, etc.)
 *                  The SAME object is what receivers will verify against.
 */
export async function signPayload(payload: unknown): Promise<string> {
    const canonical = canonicalJson(payload);
    // ethers.signMessage prefixes with "\x19Ethereum Signed Message:\n<len>"
    // which prevents signature re-use as raw transactions.
    const signature = await instanceWallet.signMessage(canonical);
    return signature;
}

// ---------------------------------------------------------------------------
// Inbound: verify a payload from a remote peer
// ---------------------------------------------------------------------------

/**
 * Verify a signature from a remote Graphene instance.
 *
 * @param payload   - The raw payload object from the envelope (NOT the envelope itself).
 * @param signature - The hex signature from envelope.signature.
 * @param expectedAddress - The Ethereum address of the sending instance.
 *                          In production this comes from a GET /federation/actor
 *                          call to the sender's domain.
 *
 * @returns true if the signature is valid and from the expected address.
 */
export async function verifyEnvelopeSignature(
    payload: unknown,
    signature: string,
    expectedAddress: string
): Promise<boolean> {
    try {
        // Basic sanity: an Ethereum sig is 65 bytes = 132 hex chars + "0x" = 132
        if (!signature || signature.length < 130) return false;

        const canonical = canonicalJson(payload);
        const recoveredAddress = ethers.verifyMessage(canonical, signature);

        return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (err) {
        // Never throw — return false so callers can handle gracefully.
        console.error('[federation/crypto] verifyEnvelopeSignature failed:', err);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Peer actor resolution
// ---------------------------------------------------------------------------

/**
 * Fetch the public Ethereum address of a remote Graphene instance.
 *
 * Each Graphene node exposes GET /federation/actor which returns an
 * InstanceActor object. We cache the result per domain for the lifetime of
 * the process to avoid hammering peer servers on every inbound request.
 *
 * In a production system this cache should be backed by Redis with a TTL of
 * ~5 minutes, and refreshed on cache-miss or signature-verify failure.
 */
const peerAddressCache = new Map<string, string>();

// Pre-seed the cache from KNOWN_PEER_ADDRESSES env var so that known peers
// never require a live network call to /federation/actor for signature verification.
// This is essential when running inside Docker where outbound TLS to peer
// domains may be unreliable.
for (const [domain, address] of Object.entries(config.federation.knownPeerAddresses)) {
    peerAddressCache.set(domain, address);
    console.log(`[federation/crypto] Pre-seeded peer address: ${domain} → ${address}`);
}

export async function resolvePeerAddress(domain: string): Promise<string | null> {
    // Cache hit
    if (peerAddressCache.has(domain)) {
        return peerAddressCache.get(domain)!;
    }

    try {
        const url = `https://${domain}/federation/actor`;
        const res = await fetch(url, {
            signal: AbortSignal.timeout(config.federation.outboundTimeoutMs),
            headers: { 'Accept': 'application/json' },
        });

        if (!res.ok) {
            console.warn(`[federation/crypto] GET ${url} returned ${res.status}`);
            return null;
        }

        const actor = await res.json() as Record<string, unknown>;

        if (!actor?.public_address || typeof actor.public_address !== 'string') {
            console.warn(`[federation/crypto] actor from ${domain} missing public_address`);
            return null;
        }

        const address = (actor.public_address as string).toLowerCase();
        peerAddressCache.set(domain, address);
        return address;
    } catch (err) {
        console.error(`[federation/crypto] resolvePeerAddress(${domain}) failed:`, err);
        return null;
    }
}

/**
 * Manually invalidate the cached address for a peer domain.
 * Call this when a signature verification fails so we re-fetch the actor
 * (the peer may have rotated their key).
 */
export function invalidatePeerAddressCache(domain: string): void {
    peerAddressCache.delete(domain);
}
