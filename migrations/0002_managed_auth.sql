-- Supabase Auth is the source of truth for credentials, email confirmation and sessions.
-- Keep the existing internal user IDs so attempts, purchases and entitlements remain stable.
ALTER TABLE users ADD COLUMN auth_provider_user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_provider_user_id
  ON users(auth_provider_user_id) WHERE auth_provider_user_id IS NOT NULL;
