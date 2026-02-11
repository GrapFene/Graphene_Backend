-- =============================================================================
-- Graphene: Migration 001 - Instance Blocking and Moderation
-- =============================================================================

-- Add roles support to identities table
ALTER TABLE identities ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT '{"user"}' NOT NULL;

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_identities_roles ON identities USING GIN(roles);

-- Table: blocked_instances
-- Stores the denylist of blocked federated peer instances
CREATE TABLE IF NOT EXISTS blocked_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_url TEXT UNIQUE NOT NULL,
    reason TEXT NOT NULL,
    blocked_by_did TEXT NOT NULL REFERENCES identities(did) ON DELETE RESTRICT,
    blocked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL
);

-- Table: sync_rejection_logs
-- Audit log for rejected synchronization attempts from blocked instances
CREATE TABLE IF NOT EXISTS sync_rejection_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_url TEXT NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    rejection_reason TEXT NOT NULL,
    request_metadata JSONB
);

-- Indexes for blocked_instances
CREATE INDEX IF NOT EXISTS idx_blocked_instances_active ON blocked_instances(is_active);
CREATE INDEX IF NOT EXISTS idx_blocked_instances_url ON blocked_instances(instance_url);

-- Indexes for sync_rejection_logs
CREATE INDEX IF NOT EXISTS idx_sync_rejection_logs_instance ON sync_rejection_logs(instance_url);
CREATE INDEX IF NOT EXISTS idx_sync_rejection_logs_attempted_at ON sync_rejection_logs(attempted_at);

-- =============================================================================
-- Row Level Security for new tables
-- =============================================================================

ALTER TABLE blocked_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_rejection_logs ENABLE ROW LEVEL SECURITY;

-- Blocked Instances: Moderators can read/write, public can read
CREATE POLICY "blocked_instances_select_public" ON blocked_instances FOR SELECT USING (true);
CREATE POLICY "blocked_instances_moderator_insert" ON blocked_instances FOR INSERT 
    WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "blocked_instances_moderator_update" ON blocked_instances FOR UPDATE 
    USING (auth.role() = 'service_role');
CREATE POLICY "blocked_instances_moderator_delete" ON blocked_instances FOR DELETE 
    USING (auth.role() = 'service_role');

-- Sync Rejection Logs: Moderators can read, system can write
CREATE POLICY "sync_rejection_logs_moderator_select" ON sync_rejection_logs FOR SELECT 
    USING (auth.role() = 'service_role');
CREATE POLICY "sync_rejection_logs_system_insert" ON sync_rejection_logs FOR INSERT 
    WITH CHECK (auth.role() = 'service_role');
