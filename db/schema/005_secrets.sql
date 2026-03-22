-- =============================================================================
-- OpenClaw Database Schema - Secrets Module
-- =============================================================================

-- User Secrets Table
CREATE TABLE IF NOT EXISTS user_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    key VARCHAR(255) NOT NULL,
    encrypted_value TEXT NOT NULL,
    value_nonce VARCHAR(64),
    
    secret_type VARCHAR(50) DEFAULT 'generic',
    provider VARCHAR(100),
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_secrets_user_key ON user_secrets(user_id, key);
CREATE INDEX IF NOT EXISTS idx_user_secrets_user_id ON user_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_secrets_provider ON user_secrets(provider);

DROP TRIGGER IF EXISTS user_secrets_updated_at ON user_secrets;
CREATE TRIGGER user_secrets_updated_at
    BEFORE UPDATE ON user_secrets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();