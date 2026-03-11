// =============================================================================
// Graphene: Direct Message Routes
// =============================================================================
//
// ENDPOINTS
// ---------
//  GET  /messages/ws-ticket              — Generates a signed ticket to auth w/ central WS
//  GET  /messages/conversation/:otherDid — Fetch DM history
//  GET  /messages/threads                — Fetch recent threads
//  POST /messages/federated              — Receive a DM from the central WS server
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { getSupabase } from '../services/supabase.js';
import { authenticateToken, type AuthRequest } from '../middleware/auth.js';
import { signPayload } from '../lib/federation/crypto.js';
import { config } from '../config/index.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /messages/ws-ticket
// Issues a short-lived cryptographic ticket for the central WebSocket server.
// Instead of the WS server needing our JWT secret, we sign the user's DID
// with our instance's private key. The WS server verifies this using our
// public key (resolved via GET /federation/actor).
// ---------------------------------------------------------------------------
router.get('/ws-ticket', authenticateToken, async (req: Request, res: Response) => {
    const { user } = req as AuthRequest;
    if (!user) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const ticketTime = Date.now();
    
    // The payload that the central ws-server expects us to sign:
    const payload = {
        action: 'ws_auth',
        did: user.sub,
        t: ticketTime,
    };

    try {
        console.log(`[messages/ws-ticket] 🎫 Generating ticket for: ${user.sub}`);
        const signature = await signPayload(payload);
        
        // The central ws-server expects the raw query params to match the signed payload
        const wsUrl = config.federation.wsServerUrl;
        const connectUrl = `${wsUrl}/?did=${encodeURIComponent(user.sub)}&t=${ticketTime}&signature=${signature}`;

        console.log(`[messages/ws-ticket] ✅ Ticket signed. WS URL: ${wsUrl}`);
        return res.json({ ticket: payload, signature, connectUrl });
    } catch (err) {
        console.error('[messages/ws-ticket] Sign failed:', err);
        return res.status(500).json({ error: { message: 'Failed to generate WS ticket' } });
    }
});

// ---------------------------------------------------------------------------
// GET /messages/conversation/:otherDid
// Fetch paginated DM history between the authenticated user and another user.
// ---------------------------------------------------------------------------
router.get('/conversation/:otherDid', authenticateToken, async (req: Request, res: Response) => {
    const { user } = req as AuthRequest;
    if (!user) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const { otherDid } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 100);
    const before = req.query.before as string | undefined;

    const supabase = getSupabase();
    let query = supabase
        .from('direct_messages')
        .select('id, from_did, to_did, content, created_at, read_at')
        .or(
            `and(from_did.eq.${user.sub},to_did.eq.${otherDid}),and(from_did.eq.${otherDid},to_did.eq.${user.sub})`
        )
        .order('created_at', { ascending: false })
        .limit(limit);

    if (before) {
        query = query.lt('created_at', before);
    }

    const { data, error } = await query;
    if (error) {
        return res.status(500).json({ error: { message: 'Failed to fetch conversation' } });
    }

    const unreadIds = (data ?? [])
        .filter(m => m.to_did === user.sub && !m.read_at)
        .map(m => m.id);

    if (unreadIds.length > 0) {
        supabase
            .from('direct_messages')
            .update({ read_at: new Date().toISOString() })
            .in('id', unreadIds)
            .then(({ error: readErr }) => {
                if (readErr) console.warn('[messages] Failed to mark messages as read:', readErr.message);
            });
    }

    return res.json({
        messages: (data ?? []).reverse(),
        count: (data ?? []).length,
    });
});

// ---------------------------------------------------------------------------
// GET /messages/threads
// Returns a list of users the authenticated user has exchanged DMs with,
// along with the most recent message from each thread.
// ---------------------------------------------------------------------------
router.get('/threads', authenticateToken, async (req: Request, res: Response) => {
    const { user } = req as AuthRequest;
    if (!user) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('direct_messages')
        .select('id, from_did, to_did, content, created_at, read_at')
        .or(`from_did.eq.${user.sub},to_did.eq.${user.sub}`)
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        return res.status(500).json({ error: { message: 'Failed to fetch threads' } });
    }

    const threadsMap = new Map<string, typeof data[0]>();
    const partnerDids = new Set<string>();
    for (const msg of (data ?? [])) {
        const partner = msg.from_did === user.sub ? msg.to_did : msg.from_did;
        if (!threadsMap.has(partner)) {
            threadsMap.set(partner, msg);
            partnerDids.add(partner);
        }
    }

    // Fetch usernames for all partners
    const { data: identities } = await supabase
        .from('identities')
        .select('did, username')
        .in('did', Array.from(partnerDids));

    const usernameMap = new Map((identities || []).map(i => [i.did, i.username]));

    const threads = Array.from(threadsMap.entries()).map(([partner_did, last_message]) => {
        const identity = identities?.find(i => i.did === partner_did);
        let partner_username = identity?.username;
        
        // Fallback for federated users or missing local identities
        if (!partner_username || partner_username === 'Unknown User') {
            const parts = partner_did.split(':');
            partner_username = parts[parts.length - 1] || partner_did;
        }

        return {
            partner_did,
            partner_username,
            last_message,
            unread_count: (data ?? []).filter(
                m => m.to_did === user.sub && m.from_did === partner_did && !m.read_at
            ).length,
        };
    });

    return res.json({ threads, count: threads.length });
});

// ---------------------------------------------------------------------------
// POST /messages/federated
// Receives a DM forwarded from the central WS server for PERSISTENCE.
// Auth: X-WS-Central-Secret header.
// ---------------------------------------------------------------------------
router.post('/federated', async (req: Request, res: Response) => {
    const centralSecret = req.headers['x-ws-central-secret'] as string | undefined;
    
    console.log(`[messages/federated] 📨 Incoming DM from central WS server`);
    
    // In production, this should be a strong secret shared between the backend and WS server
    if (centralSecret !== process.env.CENTRAL_WS_SECRET) {
        console.warn(`[messages/federated] ❌ Secret mismatch: ${centralSecret}`);
        return res.status(401).json({ error: { message: 'Unauthorized: invalid central WS secret' } });
    }

    const dm = req.body as {
        id?: string;
        from_did?: string;
        to_did?: string;
        content?: string;
        created_at?: string;
    };

    if (!dm.from_did || !dm.to_did || !dm.content) {
        return res.status(400).json({ error: { message: 'Missing required fields: from_did, to_did, content' } });
    }

    const supabase = getSupabase();

    await supabase
        .from('identities')
        .upsert({ did: dm.from_did, username: dm.from_did }, { onConflict: 'did', ignoreDuplicates: true });

    const { data, error } = await supabase
        .from('direct_messages')
        .upsert({
            id: dm.id,
            from_did: dm.from_did,
            to_did: dm.to_did,
            content: dm.content,
            created_at: dm.created_at || new Date().toISOString(),
        }, { onConflict: 'id', ignoreDuplicates: true })
        .select()
        .single();

    if (error) {
        console.error('[messages/federated] DB error:', error.message);
        return res.status(500).json({ error: { message: 'Failed to store federated message' } });
    }

    return res.status(200).json({ success: true, message_id: data.id });
});

export { router as messageRouter };
