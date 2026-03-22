-- =============================================================================
-- OpenClaw Database Schema - Sessions & Messages Module
-- =============================================================================

-- Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    
    session_key VARCHAR(500) NOT NULL UNIQUE,
    
    title VARCHAR(255),
    channel VARCHAR(50),
    last_channel VARCHAR(50),
    last_to VARCHAR(100),
    last_account_id VARCHAR(100),
    last_thread_id VARCHAR(100),
    
    chat_type VARCHAR(50),
    thinking_level VARCHAR(20),
    fast_mode BOOLEAN,
    verbose_level VARCHAR(20),
    reasoning_level VARCHAR(20),
    elevated_level VARCHAR(20),
    tts_auto VARCHAR(20),
    
    model VARCHAR(255),
    model_provider VARCHAR(255),
    model_override VARCHAR(255),
    provider_override VARCHAR(255),
    
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    cache_read BIGINT DEFAULT 0,
    cache_write BIGINT DEFAULT 0,
    
    acp_backend VARCHAR(100),
    acp_agent VARCHAR(100),
    acp_runtime_session_name VARCHAR(255),
    acp_mode VARCHAR(20),
    acp_state VARCHAR(20),
    
    is_deleted BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_key ON sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_is_deleted ON sessions(is_deleted) WHERE is_deleted = false;

DROP TRIGGER IF EXISTS sessions_updated_at ON sessions;
CREATE TRIGGER sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    content_type VARCHAR(20) DEFAULT 'text',
    
    metadata JSONB DEFAULT '{}',
    
    input_tokens INTEGER,
    output_tokens INTEGER,
    
    message_id VARCHAR(100),
    parent_message_id VARCHAR(100),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent_message_id ON messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, created_at DESC);

-- Full-text search index for messages
CREATE INDEX IF NOT EXISTS idx_messages_content_fts ON messages USING gin(to_tsvector('simple', content));