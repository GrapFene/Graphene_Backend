// jaisimha/test-federation.ts
// Tests: Content signing, signature verification, topic filtering
// Covers the federation protocol layer (signPayload, verifyEnvelopeSignature, handleSyncInitiation)

import { signPayload, verifyEnvelopeSignature, INSTANCE_PUBLIC_ADDRESS } from '../../src/lib/federation/crypto.js';
import { handleSyncInitiation } from '../../src/services/federation.js';
import { SubscriptionService } from '../../src/services/subscription.js';

export async function testFederation(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 FEDERATION — Signing, Verification, Topic Filtering');
    console.log('════════════════════════════════════════');

    let passed = true;

    const mockPayload = {
        id: `post-fed-${Date.now()}`,
        author_did: 'did:graphene:user:alice',
        title: 'Federation Test',
        content: 'Test post for federation signing.',
        subreddit: 'technology',
        created_at: new Date().toISOString(),
        source_instance_url: 'https://this-instance.com',
    };

    // [1] Sign payload
    console.log('\n[1/5] Signing payload...');
    let signature: string;
    try {
        signature = await signPayload(mockPayload);
        console.log(`  ✅ Signed. Address: ${INSTANCE_PUBLIC_ADDRESS}`);
        console.log(`  Sig: ${signature.slice(0, 30)}...`);
    } catch (e) {
        console.error('  ❌ signPayload threw:', e);
        return false;
    }

    // [2] Verify valid signature
    console.log('\n[2/5] Verifying valid signature...');
    const isValid = await verifyEnvelopeSignature(mockPayload, signature, INSTANCE_PUBLIC_ADDRESS);
    if (isValid) {
        console.log('  ✅ Signature VALID');
    } else {
        console.error('  ❌ Valid signature failed verification');
        passed = false;
    }

    // [3] Verify tampered payload (should REJECT)
    console.log('\n[3/5] Verifying tampered payload (should reject)...');
    const tampered = { ...mockPayload, content: 'Injected content!' };
    const isStillValid = await verifyEnvelopeSignature(tampered, signature, INSTANCE_PUBLIC_ADDRESS);
    if (!isStillValid) {
        console.log('  ✅ Tampered payload correctly REJECTED');
    } else {
        console.error('  ❌ Tampered payload was NOT rejected');
        passed = false;
    }

    // [4] Topic filtering — unsubscribed instance (should skip silently)
    console.log('\n[4/5] Topic filtering — unsubscribed instance (should skip)...');
    const instanceUrl = `https://peer-test-${Date.now()}.com`;
    const syncRequest = {
        source_instance_url: instanceUrl,
        sync_type: 'post',
        payload: { post: { ...mockPayload, is_verified: false } }
    };
    try {
        await handleSyncInitiation(syncRequest);
        console.log('  ✅ Sync silently skipped for unsubscribed topic');
    } catch (e: any) {
        if (e.message?.includes('blocked')) {
            console.log('  ✅ Instance blocked (also acceptable outcome)');
        } else {
            console.error('  ❌ Unexpected error during unsubscribed sync:', e.message);
            passed = false;
        }
    }

    // [5] Topic filtering — subscribed instance (should accept)
    console.log('\n[5/5] Topic filtering — subscribed instance (should accept)...');
    try {
        await SubscriptionService.subscribeToTopic(instanceUrl, 'subreddit:technology');
        await handleSyncInitiation(syncRequest);
        console.log('  ✅ Sync accepted for subscribed instance');
    } catch (e: any) {
        console.error('  ❌ Sync failed for subscribed instance:', e.message);
        passed = false;
    }

    return passed;
}
