import { ethers } from 'ethers';
import { randomBytes } from 'crypto';

/**
 * Verify a signature (supports Ethereum/Ethers signatures).
 * Message is expected to be the raw message (string).
 */
export async function verifySignature(
    signature: string,
    message: string,
    publicKey: string
): Promise<boolean> {
    try {
        // Recover address from signature
        // Note: ethers.verifyMessage automatically handles the prefixing "\x19Ethereum Signed Message:\n"

        // Fix: If signature is not valid length (e.g. it's a 32-byte hash from frontend), return false immediately
        // instead of letting ethers throw "invalid raw signature length"
        if (!signature || signature.length < 80) { // Standard sig is 65 bytes = 132 hex chars. Hash is 32 bytes = 66 chars.
            return false;
        }

        const recoveredAddress = ethers.verifyMessage(message, signature);

        // Convert input public key to address if it's a full public key
        // If publicKey is already an address (20 bytes), compare directly
        // If publicKey is simple public key (uncompressed/compressed), derive address

        let targetAddress = publicKey;

        // If publicKey doesn't look like an address (0x...), try to compute address
        if (!publicKey.startsWith('0x') || publicKey.length > 42) {
            try {
                targetAddress = ethers.computeAddress(publicKey.startsWith('0x') ? publicKey : `0x${publicKey}`);
            } catch (e) {
                // If computeAddress fails, assume it's already an address or invalid
                // If it is just missing 0x prefix for address
                if (publicKey.length === 40) {
                    targetAddress = `0x${publicKey}`;
                }
            }
        } else {
            targetAddress = publicKey;
        }

        return recoveredAddress.toLowerCase() === targetAddress.toLowerCase();
    } catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
}

/**
 * Generate a random nonce for auth challenges.
 */
export function generateNonce(length: number = 32): string {
    return randomBytes(length).toString('hex');
}
