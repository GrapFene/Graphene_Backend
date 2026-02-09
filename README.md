# Graphene Backend

Federated, minimalist social network with sovereign identity.

## Project Structure

```
Graphene_Backend/
├── db/
│   └── init.sql              # PostgreSQL schema with RLS
├── src/
│   ├── config/
│   │   └── index.ts          # Environment configuration
│   ├── types/
│   │   ├── database.ts       # DB entity interfaces
│   │   ├── api.ts            # API request/response types
│   │   └── index.ts
│   ├── services/
│   │   ├── supabase.ts       # Supabase client
│   │   ├── crypto.ts         # Ed25519 signature utils
│   │   ├── auth.ts           # Auth logic
│   │   └── index.ts
│   ├── routes/
│   │   ├── auth.ts           # Auth endpoints
│   │   └── index.ts
│   └── server.ts             # Entry point
├── package.json
├── tsconfig.json
└── .env.example
```

## Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your Supabase credentials

# Run database migration
# Execute db/init.sql in your Supabase SQL Editor

# Start development server
npm run dev
```

## API Endpoints

| Method | Endpoint          | Description                    |
|--------|-------------------|--------------------------------|
| POST   | `/auth/challenge` | Request login challenge        |
| POST   | `/auth/login`     | Verify signature and get JWT   |
| GET    | `/health`         | Health check                   |

## Authentication Flow

1. Client requests challenge: `POST /auth/challenge { did }`
2. Server returns `{ challenge_id, nonce, expires_at }`
3. Client signs nonce with private key
4. Client submits: `POST /auth/login { did, challenge_id, signed_challenge }`
5. Server verifies signature and returns JWT
