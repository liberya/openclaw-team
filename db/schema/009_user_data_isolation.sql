-- =============================================================================
-- OpenClaw Database Schema - User Data Isolation (Hybrid Storage)
-- =============================================================================
-- This schema implements user data isolation using hybrid storage:
-- - Database: user_id + paths for RLS-based isolation
-- - Filesystem: actual config/data files
-- =============================================================================

-- =============================================================================
-- User Agents Table (Hybrid Storage)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id VARCHAR(100) NOT NULL,
    name VARCHAR(255),
    config_path VARCHAR(500),
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_agents_user_agent 
    ON user_agents(user_id, agent_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_user_agents_user ON user_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_agents_is_default 
    ON user_agents(user_id, is_default) WHERE is_default = true AND is_deleted = false;

-- RLS
ALTER TABLE user_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_agents_owner ON user_agents;
CREATE POLICY user_agents_owner ON user_agents 
    FOR ALL 
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS user_agents_updated_at ON user_agents;
CREATE TRIGGER user_agents_updated_at
    BEFORE UPDATE ON user_agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- User Sessions Table (Hybrid Storage)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_key VARCHAR(500) NOT NULL,
    session_path VARCHAR(500),
    title VARCHAR(255),
    channel VARCHAR(50),
    last_channel VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_user_key ON user_sessions(user_id, session_key);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_updated ON user_sessions(updated_at);

-- RLS
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_sessions_owner ON user_sessions;
CREATE POLICY user_sessions_owner ON user_sessions 
    FOR ALL 
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS user_sessions_updated_at ON user_sessions;
CREATE TRIGGER user_sessions_updated_at
    BEFORE UPDATE ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- User Cron Jobs Table (Hybrid Storage)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_crons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cron_id VARCHAR(100) NOT NULL,
    name VARCHAR(255),
    description TEXT,
    job_path VARCHAR(500),
    schedule JSONB,
    enabled BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_crons_user_cron ON user_crons(user_id, cron_id);
CREATE INDEX IF NOT EXISTS idx_user_crons_user ON user_crons(user_id);
CREATE INDEX IF NOT EXISTS idx_user_crons_enabled ON user_crons(user_id, enabled);

-- RLS
ALTER TABLE user_crons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_crons_owner ON user_crons;
CREATE POLICY user_crons_owner ON user_crons 
    FOR ALL 
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS user_crons_updated_at ON user_crons;
CREATE TRIGGER user_crons_updated_at
    BEFORE UPDATE ON user_crons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- User Channels Table - Already exists in 008_rbac_permissions.sql
-- Add missing RLS if not present
-- =============================================================================
-- Ensure RLS is enabled on user_channels (should already be there)
ALTER TABLE user_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_channels_owner ON user_channels;
CREATE POLICY user_channels_owner ON user_channels 
    FOR ALL 
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- =============================================================================
-- User Settings Table - Already exists in 008_rbac_permissions.sql
-- Add missing RLS if not present
-- =============================================================================
-- Ensure RLS is enabled on user_settings
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_owner ON user_settings;
CREATE POLICY user_settings_owner ON user_settings 
    FOR ALL 
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Add user_id column if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_settings' AND column_name = 'user_id') THEN
        ALTER TABLE user_settings ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Update existing records to have user_id if needed
UPDATE user_settings SET user_id = (SELECT id FROM users WHERE email = 'admin@openclaw.ai' LIMIT 1) WHERE user_id IS NULL;

-- =============================================================================
-- User Skills Table (for user-installed skills)
-- Platform bundled skills are shared (in config.yaml), user-installed skills are per-user
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    skill_key VARCHAR(255) NOT NULL,  -- Unique identifier for the skill
    skill_name VARCHAR(255),         -- Display name
    skill_source VARCHAR(50) NOT NULL,  -- 'npm', 'git', 'local', 'bundled'
    skill_url VARCHAR(500),          -- URL for npm/git skills
    skill_path VARCHAR(500),         -- Local path for local skills
    
    enabled BOOLEAN DEFAULT true,
    api_key VARCHAR(500),            -- Encrypted API key
    env JSONB DEFAULT '{}',          -- Environment variables
    config JSONB DEFAULT '{}',       -- Skill-specific config
    
    metadata JSONB DEFAULT '{}',
    
    installed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_skills_user_key ON user_skills(user_id, skill_key);
CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_enabled ON user_skills(user_id, enabled);

-- RLS
ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_skills_owner ON user_skills;
CREATE POLICY user_skills_owner ON user_skills 
    FOR ALL 
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS user_skills_updated_at ON user_skills;
CREATE TRIGGER user_skills_updated_at
    BEFORE UPDATE ON user_skills
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- Organizations - Add RLS if not present
-- =============================================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_owner ON organizations;
CREATE POLICY organizations_owner ON organizations 
    FOR ALL 
    USING (owner_id = current_setting('app.current_user_id', true)::uuid);

-- =============================================================================
-- Organization Members - Add RLS if not present
-- =============================================================================
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_members_owner ON organization_members;
CREATE POLICY organization_members_owner ON organization_members 
    FOR ALL 
    USING (user_id = current_setting('app.current_user_id', true)::uuid);
