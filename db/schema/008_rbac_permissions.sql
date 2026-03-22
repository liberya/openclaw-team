-- =============================================================================
-- OpenClaw Database Schema - RBAC Permissions Module
-- =============================================================================

-- Permissions Table
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50),  -- 'user', 'agent', 'settings', 'system', 'channel'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Role Permissions Mapping Table
CREATE TABLE IF NOT EXISTS role_permissions (
    role VARCHAR(50) NOT NULL,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (role, permission_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);

-- Initialize Permissions Data
INSERT INTO permissions (name, category, description) VALUES
    -- User Management
    ('users:list', 'user', 'List all users'),
    ('users:create', 'user', 'Create new user'),
    ('users:update', 'user', 'Update user'),
    ('users:delete', 'user', 'Delete user'),
    ('users:manage-roles', 'user', 'Manage user roles'),
    ('users:view-profile', 'user', 'View own profile'),
    ('users:update-profile', 'user', 'Update own profile'),
    
    -- System Settings
    ('settings:read', 'settings', 'View system settings'),
    ('settings:write', 'settings', 'Modify system settings'),
    ('settings:appearance', 'settings', 'Manage appearance settings'),
    ('settings:notifications', 'settings', 'Manage notification settings'),
    
    -- Agents
    ('agents:create', 'agent', 'Create new agent'),
    ('agents:read', 'agent', 'View agents'),
    ('agents:update', 'agent', 'Update agent'),
    ('agents:delete', 'agent', 'Delete agent'),
    ('agents:manage-all', 'agent', 'Manage all users agents'),
    
    -- Sessions
    ('sessions:create', 'session', 'Create new session'),
    ('sessions:read', 'session', 'View sessions'),
    ('sessions:delete', 'session', 'Delete session'),
    
    -- Channels
    ('channels:create', 'channel', 'Create channel connection'),
    ('channels:read', 'channel', 'View channel connections'),
    ('channels:update', 'channel', 'Update channel connection'),
    ('channels:delete', 'channel', 'Delete channel connection'),
    ('channels:manage-all', 'channel', 'Manage all users channels'),
    
    -- Automation
    ('automation:create', 'automation', 'Create automation'),
    ('automation:read', 'automation', 'View automations'),
    ('automation:update', 'automation', 'Update automation'),
    ('automation:delete', 'automation', 'Delete automation'),
    
    -- Infrastructure
    ('infrastructure:manage', 'infrastructure', 'Manage infrastructure'),
    
    -- AI & Models
    ('ai:manage-models', 'ai', 'Manage AI models'),
    ('ai:view-usage', 'ai', 'View AI usage statistics'),
    
    -- Debugging
    ('debug:view-logs', 'debug', 'View debug logs'),
    ('debug:manage', 'debug', 'Manage debug settings'),
    
    -- Logs
    ('logs:read', 'logs', 'View system logs'),
    ('logs:manage', 'logs', 'Manage log settings')
ON CONFLICT (name) DO NOTHING;

-- Grant all permissions to admin role
INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', id FROM permissions
ON CONFLICT (role, permission_id) DO NOTHING;

-- Grant basic permissions to regular user role
INSERT INTO role_permissions (role, permission_id)
SELECT 'user', id FROM permissions 
WHERE name IN (
    'users:view-profile',
    'users:update-profile',
    'agents:create',
    'agents:read',
    'agents:update',
    'agents:delete',
    'sessions:create',
    'sessions:read',
    'sessions:delete',
    'channels:create',
    'channels:read',
    'channels:update',
    'channels:delete',
    'automation:create',
    'automation:read',
    'automation:update',
    'automation:delete',
    'ai:view-usage',
    'logs:read'
) ON CONFLICT (role, permission_id) DO NOTHING;

-- Function to check if role has permission
CREATE OR REPLACE FUNCTION has_permission(p_role VARCHAR, p_permission VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role = p_role AND p.name = p_permission
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user permissions
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS TABLE(permission_name VARCHAR) AS $$
BEGIN
    RETURN QUERY
    SELECT p.name
    FROM permissions p
    JOIN role_permissions rp ON p.id = rp.permission
    JOIN users u ON u.role = rp.role
    WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- User Settings Table (complementing users.settings JSONB)
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    
    theme VARCHAR(20) DEFAULT 'system',
    language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    notification_email BOOLEAN DEFAULT true,
    notification_push BOOLEAN DEFAULT true,
    
    preferences JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Channels Table (for Feishu, Slack, Discord, etc.)
CREATE TABLE IF NOT EXISTS user_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    channel_type VARCHAR(50) NOT NULL,  -- 'feishu', 'slack', 'discord', 'telegram', 'whatsapp', etc.
    account_id VARCHAR(255),              -- Platform-specific account identifier
    
    app_id VARCHAR(255),
    app_secret_hash VARCHAR(255),
    
    access_token VARCHAR(500),
    refresh_token VARCHAR(500),
    token_expires_at TIMESTAMPTZ,
    
    webhook_url VARCHAR(500),
    webhook_secret_hash VARCHAR(255),
    
    bot_user_id VARCHAR(255),
    bot_id VARCHAR(255),
    
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    
    metadata JSONB DEFAULT '{}',
    
    last_connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_channels_user_id ON user_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_user_channels_type ON user_channels(channel_type);
CREATE INDEX IF NOT EXISTS idx_user_channels_account ON user_channels(channel_type, account_id);

-- RLS for user_channels
ALTER TABLE user_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_channels_owner_policy ON user_channels
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS user_settings_updated_at ON user_settings;
CREATE TRIGGER user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS user_channels_updated_at ON user_channels;
CREATE TRIGGER user_channels_updated_at
    BEFORE UPDATE ON user_channels
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
