import dotenv from 'dotenv';
dotenv.config();

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
        privateKey: process.env.FEDERATION_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Default Dev Key (Hardhat #0)
    }
} as const;

// Validate required environment variables
export function validateConfig(): void {
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}
