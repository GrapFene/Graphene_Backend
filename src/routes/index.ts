import authRouter from './auth.js';
import { postRouter } from './post.js';
import { subscriptionRouter } from './subscription.js';
import { communityRouter } from './community.js';
import { voteRouter } from './vote.js';
import { proposalRouter } from './proposal.js';
import { blockRouter } from './block.js';
import profileRouter from './profile.js';
import { commentRouter } from './comment.js';
import { moderationRouter } from './moderation.js';
import { federationRouter } from './federation.js';
import { default as uploadRouter } from './upload.js';
import { messageRouter } from './messages.js';

export {
    authRouter,
    postRouter,
    subscriptionRouter,
    communityRouter,
    voteRouter,
    proposalRouter,
    blockRouter,
    profileRouter,
    commentRouter,
    moderationRouter,
    federationRouter,
    uploadRouter,
    messageRouter
};
export { default as recoveryRouter } from './recovery.js';
