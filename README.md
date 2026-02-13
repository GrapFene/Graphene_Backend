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

## API Documentation (Deep Dive)

### 🔐 Authentication Module (`/auth`)
Handles user identity, registration, and sovereign login flows.

#### 1. Request Challenge
- **Endpoint**: `POST /auth/challenge`
- **Description**: Generates a cryptographically secure challenge (nonce) for a Decentralized Identifier (DID). This is the first step in the sovereign login flow.
- **Parameters (Body)**:
  - `did`: (String) The user's unique DID.
- **Response Codes**:
  - `200 OK`: Challenge created successfully. Returns `{ challenge_id, nonce, expires_at }`.
  - `400 Bad Request`: DID is missing or malformed.
  - `404 Not Found`: Identity not found in the registry.
  - `500 Server Error`: Internal system failure.

#### 2. Verify Login
- **Endpoint**: `POST /auth/login`
- **Description**: Verifies the signature created by the client using the private key associated with their DID and returns a JWT on success.
- **Parameters (Body)**:
  - `did`: (String) User's DID.
  - `challenge_id`: (UUID) ID of the challenge being signed.
  - `signed_challenge`: (String) The signature of the nonce.
- **Response Codes**:
  - `200 OK`: Verification successful. Returns `{ token, user }`.
  - `401 Unauthorized`: Invalid signature or expired challenge.
  - `404 Not Found`: Identity doesn't exist.
  - `500 Server Error`: Verification logic error.

#### 3. Register User
- **Endpoint**: `POST /auth/register`
- **Description**: Registers a new user with its username, password, and mnemonic hashes.
- **Parameters (Body)**:
  - `username`: (String) Unique username.
  - `password`: (String) Hashed password.
  - `mnemonic_hashes`: (Array) List of hashes for mnemonic verification.
- **Response Codes**:
  - `201 Created`: Registration successful.
  - `409 Conflict`: Username already exists.
  - `500 Server Error`: Database insertion failed.

#### 4. Mnemonic Login (Init & Verify)
- **POST `/auth/login-init`**: Validates password and returns which mnemonic words (indices) the user needs to provide.
- **POST `/auth/login-verify`**: Validates the provided mnemonic words against stored hashes and returns a JWT.
- **Response Codes**: `200` (Success), `401` (Invalid credentials), `404` (User not found).

---

### 📝 Posts Module (`/posts`)
Manages the creation and retrieval of social content.

#### 1. Get Feed
- **Endpoint**: `GET /posts`
- **Query Params**:
  - `sort`: (recent | trending) Sort order of the feed.
  - `subreddit`: (String) Optional filter by community name.
  - `viewerDid`: (String) Optional DID to check for votes/interactions.
- **Response Codes**: `200 OK`, `500 Error`.

#### 2. Create Post
- **Endpoint**: `POST /posts`
- **Parameters (Body)**:
  - `did`: (String) Author's DID.
  - `title`: (String) Title of the post.
  - `content`: (String) Markdown or text content.
  - `subreddit`: (String) Target community.
- **Response Codes**: `201 Created`, `400 Missing Fields`.

---

### 🏛️ Communities Module (`/communities`)
Governance and discovery of community subreddits.

#### 1. Community Discovery
- **GET `/communities`**: Search communities by name (query `search`).
- **GET `/communities/top`**: Returns most active communities (query `limit`).
- **GET `/communities/:name`**: Get detailed metadata for a specific community.

#### 2. Management
- **POST `/communities`**: Create a new community (`name`, `topic`, `is_private`).
- **PUT `/communities/:name/rules`**: Update community rules (requires `did` of owner/mod).
- **POST `/communities/:name/moderators`**: Add a new moderator (`ownerDid`, `moderatorDid`).
- **DELETE `/communities/:name/moderators/:did`**: Remove a moderator (requires `ownerDid` in query).

---

### 💬 Comments & Interactions (`/comments`, `/votes`)
Handles threaded discussions and voting.

- **POST `/comments`**: Create a new comment or reply (params: `postId`, `content`, `parentId`).
- **GET `/comments/post/:postId`**: Retrieve all comments for a specific post.
- **POST `/comments/:id/vote`**: Vote on a specific comment (`voteType`: 1, 0, -1).
- **POST `/votes`**: Vote on a post (`postId`, `voteType`).

---

### 🛡️ Social Recovery Module (`/recovery`)
Handles account recovery via guardians.

- **POST `/recovery/guardians`**: Set the list of guardian DIDs for your account. **(Auth Required)**
- **POST `/recovery/request`**: Initiate a recovery request for a lost account.
- **POST `/recovery/approve`**: A guardian approves a pending recovery request. **(Auth Required)**
- **POST `/recovery/finalize`**: Completes the recovery once the guardian threshold is met.
- **Response Codes**: `200` (Success), `400` (Logic failure), `401` (Unauthorized), `420` (Rate limited if implemented, currently default 400).

---

### 👤 Profile Module (`/profile`)
- **GET `/profile/:did`**: Fetch public profile details (bio, avatar, etc.).
- **POST `/profile`**: Update authenticated user's profile details.

---

### 🗳️ Governance Module (`/proposals`)
- **POST `/proposals`**: Create a community proposal with options and a deadline.
- **GET `/proposals/:id`**: Get proposal status and current voting results.
- **POST `/proposals/:id/vote`**: Cast a vote on a specific proposal option.

---

### 🚫 Moderation Module (`/blocks`)
- **GET `/blocks`**: List all communities blocked by the user.
- **POST `/blocks`**: Block a community from appearing in feeds.
- **DELETE `/blocks/:communityName`**: Unblock a community.

---

### ⚙️ System
- **GET `/health`**: Returns `200 OK` with system status and timestamp.

> [!IMPORTANT]
> **Authentication**: All routes tagged with **(Auth Required)** or mentioned as protected require a valid Bearer Token in the `Authorization` header.
> **Status 420**: Used for cases where the request is understood but the system rejects it due to policy or rate limiting (e.g., recursive operations or threshold not met).

## Authentication Flow

1. Client requests challenge: `POST /auth/challenge { did }`
2. Server returns `{ challenge_id, nonce, expires_at }`
3. Client signs nonce with private key
4. Client submits: `POST /auth/login { did, challenge_id, signed_challenge }`
5. Server verifies signature and returns JWT
