import dotenv from 'dotenv';
dotenv.config();

// =============================================================================
// Federation environment validation — runs at import time, before config is
// exported, so a missing key crashes the process immediately with a clear
// message rather than allowing the server to start with an insecure identity.
//
// WHY CRASH-EARLY?
//   A missing FEDERATION_PRIVATE_KEY would cause every outbound envelope to be
//   signed with undefined/empty key material — peers would reject all of our
//   broadcasts and our identity would be unverifiable.
//
//   A missing INSTANCE_DOMAIN would cause us to advertise "undefined" as our
//   actor URL, breaking peer actor resolution across the entire network.
//
// HOW TO FIX:
//   Set the following in your .env (never commit real values):
//     FEDERATION_PRIVATE_KEY=0x<your-secp256k1-private-key>
//     INSTANCE_DOMAIN=api.your-domain.com
// =============================================================================
(function assertFederationEnv() {
    const missingFederation: string[] = [];

    if (!process.env.FEDERATION_PRIVATE_KEY || process.env.FEDERATION_PRIVATE_KEY.trim() === '') {
        missingFederation.push('FEDERATION_PRIVATE_KEY');
    }
    if (!process.env.INSTANCE_DOMAIN || process.env.INSTANCE_DOMAIN.trim() === '') {
        missingFederation.push('INSTANCE_DOMAIN');
    }

    if (missingFederation.length > 0) {
        // Use process.stderr directly — logger may not be initialised yet.
        process.stderr.write(
            `\n[FATAL] Missing required federation environment variables: ${missingFederation.join(', ')}\n` +
            `The server cannot start without a unique identity and signing key.\n` +
            `Set these variables in your .env file before starting the server.\n\n`
        );
        process.exit(1);
    }
})();

export const config = {
    supabase: {
        url: process.env.SUPABASE_URL || '',
        serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'default-secret-change-me',
        expiresIn: '24h',
    },
    server: {
        port: parseInt(process.env.PORT || '3000', 10),
        instanceUrl: process.env.INSTANCE_URL || `http://localhost:${process.env.PORT || '3000'}`,
    },
    federation: {
        // Derived exclusively from INSTANCE_DOMAIN — no hardcoded fallback.
        // Validated above; guaranteed non-empty by the time this runs.
        instanceDomain: process.env.INSTANCE_DOMAIN as string,

        // Derived exclusively from FEDERATION_PRIVATE_KEY — no hardcoded fallback.
        // Validated above; guaranteed non-empty by the time this runs.
        privateKey: process.env.FEDERATION_PRIVATE_KEY as string,

        // Timeout (ms) for outbound HTTP calls to peer instances.
        outboundTimeoutMs: parseInt(process.env.FEDERATION_TIMEOUT_MS || '5000', 10),

        // Comma-separated list of known peer instance domains to broadcast to.
        // Derived from KNOWN_PEERS env var — no hardcoded domains.
        knownPeers: (process.env.KNOWN_PEERS || '').split(',').map(p => p.trim()).filter(Boolean),

        // Pre-seeded peer public addresses to avoid network calls at verify time.
        // Format: "domain:0xAddress,domain2:0xAddress2"
        // e.g. KNOWN_PEER_ADDRESSES=graphene.myvnc.com:0xabc123...,peer2.com:0xdef456...
        knownPeerAddresses: Object.fromEntries(
            (process.env.KNOWN_PEER_ADDRESSES || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
                .map(s => {
                    const idx = s.indexOf(':0x');
                    return idx !== -1 ? [s.slice(0, idx), s.slice(idx + 1).toLowerCase()] : null;
                })
                .filter((e): e is [string, string] => e !== null)
        ),
        // Centralized WebSocket server URL
        wsServerUrl: process.env.WS_SERVER_URL || 'wss://localhost:4000',
    }
} as const;

// Validate required environment variables
export function validateConfig(): void {
    // Federation vars are already enforced at import time above.
    // This function validates the remaining application-level vars.
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}
