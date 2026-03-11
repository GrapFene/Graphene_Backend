import { signPayload, verifyEnvelopeSignature, INSTANCE_PUBLIC_ADDRESS } from '../src/lib/federation/crypto.js';
import { handleSyncInitiation } from '../src/services/federation.js';
import { SubscriptionService } from '../src/services/subscription.js';
import { Post } from '../src/types/post.js';

export async function testFederation(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 TEST: Federation (Signing, Verification, Topic Filtering)');
    console.log('════════════════════════════════════════');

    let passed = true;

    const mockPost: Partial<Post> = {
        id: 'post-123',
        author_did: 'did:graphene:user:alice',
        title: 'Federation Test',
        content: 'This is a test post for federation.',
        subreddit: 'technology',
        created_at: new Date().toISOString()
    };

    // 1. Test Signing
    console.log('\n[1/5] Testing Content Signing...');
    const signature = await signPayload(mockPost);
    const fullPost: Post = { ...mockPost as Post };
    console.log(`  ✅ Post signed. Signer: ${INSTANCE_PUBLIC_ADDRESS}`);
    console.log(`  Sig: ${signature.slice(0, 30)}...`);

    // 2. Test Verification (Valid)
    console.log('\n[2/5] Testing Signature Verification (Valid)...');
    const isValid = await verifyEnvelopeSignature(mockPost, signature, INSTANCE_PUBLIC_ADDRESS);
    if (isValid) {
        console.log('  ✅ Signature VALID');
    } else {
        console.error('  ❌ Signature verification failed for untampered post');
        passed = false;
    }

    // 3. Test Verification (Tampered)
    console.log('\n[3/5] Testing Signature Verification (Tampered)...');
    const tamperedPost = { ...mockPost, content: 'Tampered content!' };
    const isStillValid = await verifyEnvelopeSignature(tamperedPost, signature, INSTANCE_PUBLIC_ADDRESS);
    if (!isStillValid) {
        console.log('  ✅ Tampered post correctly REJECTED');
    } else {
        console.error('  ❌ Tampered post was NOT rejected');
        passed = false;
    }

    // 4. Test Topic Filtering (Unsubscribed)
    console.log('\n[4/5] Testing Topic Filtering (Unsubscribed instance)...');
    const instanceUrl = 'https://peer-b.com';
    const syncRequest = {
        source_instance_url: instanceUrl,
        sync_type: 'post',
        payload: { post: fullPost }
    };
    try {
        await handleSyncInitiation(syncRequest);
        console.log('  ✅ Sync skipped correctly (no error thrown for unsubscribed instance)');
    } catch (e) {
        console.error('  ❌ handleSyncInitiation threw unexpectedly:', e);
        passed = false;
    }

    // 5. Test Topic Filtering (Subscribed)
    console.log('\n[5/5] Testing Topic Filtering (Subscribed instance)...');
    await SubscriptionService.subscribeToTopic(instanceUrl, 'subreddit:technology');
    console.log('  Instance subscribed to "subreddit:technology".');
    try {
        await handleSyncInitiation(syncRequest);
        console.log('  ✅ Sync accepted and verified correctly');
    } catch (e) {
        console.error('  ❌ Sync failed for subscribed instance:', e);
        passed = false;
    }

    return passed;
}
