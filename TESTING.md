# Testing Script for Instance Blocking

## Prerequisites
1. Database migration must be applied (see db/migrations/README.md)
2. Backend server must be running (`npm run dev`)
3. You need a registered user with moderator role

## Setup Test Environment

### 1. Create a moderator user in Supabase SQL Editor
```sql
-- First, register a user via the API or directly in DB
-- Then update their roles:
UPDATE identities 
SET roles = '{"user", "moderator"}' 
WHERE username = 'test_moderator';
```

### 2. Login to get JWT token
```bash
# Use PowerShell or command prompt
$response = Invoke-WebRequest -Uri "http://localhost:3000/auth/login-init" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"username":"test_moderator","password_hash":"YOUR_HASH"}'
  
# Save the token from response for subsequent requests
```

## Test Cases

### Test 1: Block an instance
```powershell
$headers = @{
    "Authorization" = "Bearer YOUR_JWT_TOKEN"
    "Content-Type" = "application/json"
}

$body = @{
    instance_url = "https://malicious-instance.com"
    reason = "Spam and harassment"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/moderation/blocks" `
  -Method POST `
  -Headers $headers `
  -Body $body
```

Expected: 201 Created with block details

### Test 2: List blocked instances
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/moderation/blocks" `
  -Method GET `
  -Headers $headers
```

Expected: 200 OK with array of blocked instances

### Test 3: Test sync rejection
```powershell
$syncBody = @{
    source_instance_url = "https://malicious-instance.com"
    sync_type = "posts"
    payload = @{}
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/federation/sync" `
  -Method POST `
  -ContentType "application/json" `
  -Body $syncBody
```

Expected: 403 Forbidden with "SYNC_BLOCKED" error

### Test 4: View rejection logs
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/moderation/logs/rejections" `
  -Method GET `
  -Headers $headers
```

Expected: 200 OK with rejection log entries

### Test 5: Unblock the instance
```powershell
$encodedUrl = [System.Web.HttpUtility]::UrlEncode("https://malicious-instance.com")
Invoke-WebRequest -Uri "http://localhost:3000/moderation/blocks/$encodedUrl" `
  -Method DELETE `
  -Headers $headers
```

Expected: 200 OK with success message

### Test 6: Verify sync works after unblock
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/federation/sync" `
  -Method POST `
  -ContentType "application/json" `
  -Body $syncBody
```

Expected: 200 OK with "Sync request accepted"

## Edge Cases

### Test: Non-moderator tries to block
Use a JWT token from a regular user (without moderator role)

Expected: 403 Forbidden

### Test: Block already blocked instance
Try to block the same instance twice

Expected: 409 Conflict

### Test: Invalid URL
```powershell
$badBody = @{
    instance_url = "not-a-url"
    reason = "test"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/moderation/blocks" `
  -Method POST `
  -Headers $headers `
  -Body $badBody
```

Expected: 400 Bad Request with "INVALID_URL"
