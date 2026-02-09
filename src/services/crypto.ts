import * as ed from '@noble/ed25519';
import { randomBytes } from 'crypto';

/**
 * Verify an Ed25519 signature.
 */
export async function verifySignature(
    signature: string,
    message: string,
    publicKey: string
): Promise<boolean> {
    try {
        const sigBytes = Buffer.from(signature, 'hex');
        const msgBytes = Buffer.from(message, 'utf8');
        const pubBytes = Buffer.from(publicKey, 'hex');

        return await ed.verifyAsync(sigBytes, msgBytes, pubBytes);
    } catch {
        return false;
    }
}

/**
 * Generate a random nonce for auth challenges.
 */
export function generateNonce(length: number = 32): string {
    return randomBytes(length).toString('hex');
}
