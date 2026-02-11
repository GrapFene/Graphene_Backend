# Database Migration Instructions

## Migration: 001_blocked_instances.sql

This migration adds instance blocking and moderation capabilities to Graphene.

### What it does:
1. Adds `roles` column to `identities` table for RBAC
2. Creates `blocked_instances` table for the denylist
3. Creates `sync_rejection_logs` table for audit logging
4. Sets up appropriate indexes and Row Level Security policies

### How to apply:

1. **Open Supabase Dashboard**
   - Navigate to your project's SQL Editor

2. **Execute the migration**
   - Copy the contents of `db/migrations/001_blocked_instances.sql`
   - Paste into the SQL Editor
   - Click "Run"

3. **Verify the migration**
   ```sql
   -- Check that blocked_instances table was created
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'blocked_instances';

   -- Check that roles column was added to identities
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'identities' AND column_name = 'roles';
   ```

4. **Create a test moderator user**
   ```sql
   -- Update an existing user to have moderator role
   UPDATE identities 
   SET roles = '{"user", "moderator"}' 
   WHERE username = 'YOUR_TEST_USERNAME';
   ```

### Rollback (if needed):
```sql
-- Drop new tables
DROP TABLE IF EXISTS sync_rejection_logs;
DROP TABLE IF EXISTS blocked_instances;

-- Remove roles column
ALTER TABLE identities DROP COLUMN IF EXISTS roles;
```

## Next Steps

After running the migration, you can:
1. Test the API endpoints (see testing section in implementation_plan.md)
2. Create moderator users for your instance
3. Start blocking malicious instances via the API
