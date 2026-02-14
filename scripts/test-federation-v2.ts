import { signPost, verifyPost, handleSyncInitiation } from '../src/services/federation.js';
import { SubscriptionService } from '../src/services/subscription.js';
import { Post } from '../src/types/post.js';

async function testFederationV2() {
    console.log('🧪 Starting US5 & US6 Verification Tests...');

    const mockPost: Partial<Post> = {
        id: 'post-123',
        author_did: 'did:graphene:user:alice',
        title: 'Federation Test',
        content: 'This is a test post for US5 and US6.',
        subreddit: 'technology',
        created_at: new Date().toISOString()
    };

    // 1. Test Signing
    console.log('\n--- 1. Testing Content Signing ---');
    const { signature, signer_did } = await signPost(mockPost);
    const fullPost: Post = { ...mockPost as Post, signature, signer_did };
    console.log(`✅ Post signed. Signer: ${signer_did}`);
    console.log(`Sig: ${signature.slice(0, 30)}...`);

    // 2. Test Verification (Valid)
    console.log('\n--- 2. Testing Signature Verification (Valid) ---');
    const isValid = await verifyPost(fullPost);
    console.log(`Result: ${isValid ? '✅ VALID' : '❌ INVALID'}`);

    // 3. Test Verification (Tampered)
    console.log('\n--- 3. Testing Signature Verification (Tampered) ---');
    const tamperedPost = { ...fullPost, content: 'Tampered content!' };
    const isStillValid = await verifyPost(tamperedPost);
    console.log(`Result: ${isStillValid ? '❌ VALID (FAILED)' : '✅ REJECTED (SUCCESS)'}`);

    // 4. Test Topic Filtering (Unsubscribed)
    console.log('\n--- 4. Testing Topic Filtering (Unsubscribed) ---');
    const instanceUrl = 'https://peer-b.com';
    const syncRequest = {
        source_instance_url: instanceUrl,
        sync_type: 'post',
        payload: { post: fullPost }
    };

    console.log('Attempting sync for "subreddit:technology" (unsubscribed)...');
    // This should log skipping but not throw
    await handleSyncInitiation(syncRequest);
    console.log('✅ Sync skipped correctly (no error thrown)');

    // 5. Test Topic Filtering (Subscribed)
    console.log('\n--- 5. Testing Topic Filtering (Subscribed) ---');
    await SubscriptionService.subscribeToTopic(instanceUrl, 'subreddit:technology');
    console.log('Instance subscribed to "subreddit:technology".');

    console.log('Attempting sync again...');
    await handleSyncInitiation(syncRequest);
    console.log('✅ Sync accepted and verified correctly');

    process.exit(0);
}

testFederationV2().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
