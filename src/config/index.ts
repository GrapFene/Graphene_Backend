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
    },
} as const;

// Validate required environment variables
export function validateConfig(): void {
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}
