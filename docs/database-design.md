# OpenClaw 企业级数据库设计

## 1. 概述

本设计将现有基于文件系统（SQLite + JSON）的数据存储迁移到 PostgreSQL，实现多用户数据隔离。

## 2. 技术选型

| 组件 | 版本 | 说明 |
|------|------|------|
| PostgreSQL | ≥15 | 主数据库 |
| pgvector | ≥0.5 | 向量相似搜索 |
| Redis | ≥7 | 会话/缓存（可选） |

### pgvector 扩展

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 3. Schema 设计

### 3.1 用户模块

```sql
-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    avatar_url VARCHAR(500),
    role VARCHAR(50) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,
    
    -- 限额
    monthly_api_calls_limit INTEGER DEFAULT 10000,
    monthly_api_calls_used INTEGER DEFAULT 0,
    
    -- 兼容字段
    settings JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created_at ON users(created_at);

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

```sql
-- 用户 API Keys
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Key 信息
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    key_prefix VARCHAR(20) NOT NULL,  -- 便于 UI 显示: sk-xxx... 
    name VARCHAR(255),
    description VARCHAR(500),
    
    -- 权限范围
    scope JSONB DEFAULT '["read"]',
    
    -- 有效期
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    
    -- 状态
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at);
```

```sql
-- 用户刷新令牌 (Refresh Tokens)
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    
    -- 设备信息
    user_agent VARCHAR(500),
    ip_address INET,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;
```

### 3.2 组织/团队模块 (可选)

```sql
-- 组织表
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    logo_url VARCHAR(500),
    
    -- 计费
    plan VARCHAR(50) DEFAULT 'free',
    monthly_limit INTEGER DEFAULT 10000,
    
    owner_id UUID NOT NULL REFERENCES users(id),
    
    settings JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_owner_id ON organizations(owner_id);
```

```sql
-- 组织成员
CREATE TABLE organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX idx_organization_members_user_id ON organization_members(user_id);
```

### 3.3 Agent 模块

基于现有 `AgentConfig` 结构：

```sql
-- Agents 表
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 所有者
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    
    -- 基本信息
    agent_id VARCHAR(100) NOT NULL,  -- 兼容现有 ID 格式
    name VARCHAR(255),
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    
    -- Agent 配置 (JSON 存储)
    config JSONB NOT NULL DEFAULT '{}',
    
    -- 兼容：工作目录
    workspace VARCHAR(500),
    agent_dir VARCHAR(500),
    
    -- 状态
    is_active BOOLEAN DEFAULT true,
    is_deleted BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_agents_organization_id ON agents(organization_id);
CREATE INDEX idx_agents_agent_id ON agents(agent_id);
CREATE INDEX idx_agents_is_default ON agents(is_default) WHERE is_default = true AND is_deleted = false;
CREATE UNIQUE INDEX idx_agents_user_agent_id ON agents(user_id, agent_id) WHERE is_deleted = false;
```

### 3.4 会话/聊天模块

基于现有 `SessionEntry` 结构：

```sql
-- 会话表
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 所有者
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    
    -- 会话标识 (兼容现有 session key)
    session_key VARCHAR(500) NOT NULL UNIQUE,
    
    -- 元数据
    title VARCHAR(255),
    channel VARCHAR(50),
    last_channel VARCHAR(50),
    last_to VARCHAR(100),
    last_account_id VARCHAR(100),
    last_thread_id VARCHAR(100),
    
    -- 会话配置
    chat_type VARCHAR(50),
    thinking_level VARCHAR(20),
    fast_mode BOOLEAN,
    verbose_level VARCHAR(20),
    reasoning_level VARCHAR(20),
    elevated_level VARCHAR(20),
    tts_auto VARCHAR(20),
    
    -- 模型信息
    model VARCHAR(255),
    model_provider VARCHAR(255),
    model_override VARCHAR(255),
    provider_override VARCHAR(255),
    
    -- 使用统计
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    cache_read BIGINT DEFAULT 0,
    cache_write BIGINT DEFAULT 0,
    
    -- ACP 相关
    acp_backend VARCHAR(100),
    acp_agent VARCHAR(100),
    acp_runtime_session_name VARCHAR(255),
    acp_mode VARCHAR(20),
    acp_state VARCHAR(20),
    
    -- 状态
    is_deleted BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_agent_id ON sessions(agent_id);
CREATE INDEX idx_sessions_session_key ON sessions(session_key);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX idx_sessions_is_deleted ON sessions(is_deleted) WHERE is_deleted = false;
```

```sql
-- 消息表
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 所属会话
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    
    -- 消息内容
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    content_type VARCHAR(20) DEFAULT 'text',  -- text, markdown, html
    
    -- 元数据
    metadata JSONB DEFAULT '{}',
    
    -- Token 统计
    input_tokens INTEGER,
    output_tokens INTEGER,
    
    -- 消息标识 (用于去重/引用)
    message_id VARCHAR(100),
    parent_message_id VARCHAR(100),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_message_id ON messages(message_id);
CREATE INDEX idx_messages_parent_message_id ON messages(parent_message_id);

-- 消息内容全文搜索 (可选)
CREATE INDEX idx_messages_content_fts ON messages USING gin(to_tsvector('simple', content));
```

### 3.5 Memory/向量模块

```sql
-- 记忆表 (向量存储)
CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 所有者
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    
    -- 内容
    content TEXT NOT NULL,
    content_hash VARCHAR(64),  -- SHA256 用于去重
    
    -- 向量 (pgvector)
    embedding vector(1536),  -- OpenAI ada-002 dimension
    
    -- 元数据
    metadata JSONB DEFAULT '{}',
    memory_type VARCHAR(50),  -- conversation, fact, document
    
    -- 标签/分类
    tags TEXT[],
    
    -- 状态
    is_deleted BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_agent_id ON memories(agent_id);
CREATE INDEX idx_memories_session_id ON memories(session_id);
CREATE INDEX idx_memories_content_hash ON memories(content_hash);
CREATE INDEX idx_memories_is_deleted ON memories(is_deleted) WHERE is_deleted = false;

-- 向量索引 (HNSW)
CREATE INDEX idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

```sql
-- QMD 集合 (文档/知识库)
CREATE TABLE qmd_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 所有者
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    
    -- 集合信息
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- 配置
    config JSONB DEFAULT '{}',
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qmd_collections_user_id ON qmd_collections(user_id);
CREATE INDEX idx_qmd_collections_agent_id ON qmd_collections(agent_id);
```

```sql
-- QMD 文档块
CREATE TABLE qmd_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 所属集合
    collection_id UUID NOT NULL REFERENCES qmd_collections(id) ON DELETE CASCADE,
    
    -- 内容
    content TEXT NOT NULL,
    content_hash VARCHAR(64),
    
    -- 向量
    embedding vector(1536),
    
    -- 元数据
    metadata JSONB DEFAULT '{}',
    chunk_index INTEGER,
    source_file VARCHAR(500),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qmd_chunks_collection_id ON qmd_chunks(collection_id);
CREATE INDEX idx_qmd_chunks_content_hash ON qmd_chunks(content_hash);
CREATE INDEX idx_qmd_chunks_embedding ON qmd_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

### 3.6 密钥/配置模块

```sql
-- 用户密钥 (加密存储)
CREATE TABLE user_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 所有者
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 密钥信息
    key VARCHAR(255) NOT NULL,
    encrypted_value TEXT NOT NULL,  -- AES-256-GCM 加密
    value_nonce VARCHAR(64),        -- 加密 nonce
    
    -- 密钥类型
    secret_type VARCHAR(50) DEFAULT 'generic',  -- api_key, password, token
    provider VARCHAR(100),        -- openai, anthropic, etc.
    
    -- 元数据
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_secrets_user_key ON user_secrets(user_id, key);
CREATE INDEX idx_user_secrets_user_id ON user_secrets(user_id);
CREATE INDEX idx_user_secrets_provider ON user_secrets(provider);
```

### 3.7 系统/审计模块

```sql
-- API 调用日志
CREATE TABLE api_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 用户
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    
    -- 请求信息
    method VARCHAR(10) NOT NULL,
    path VARCHAR(500) NOT NULL,
    query_params JSONB,
    request_body JSONB,
    
    -- 响应信息
    status_code INTEGER,
    response_body JSONB,
    response_time_ms INTEGER,
    
    -- 环境
    ip_address INET,
    user_agent VARCHAR(500),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_logs_user_id ON api_logs(user_id);
CREATE INDEX idx_api_logs_created_at ON api_logs(created_at);
CREATE INDEX idx_api_logs_path ON api_logs(path);
CREATE INDEX idx_api_logs_status_code ON api_logs(status_code);

-- 建议：按月份分区存储
```

```sql
-- 登录日志
CREATE TABLE login_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 登录方式
    login_method VARCHAR(20) NOT NULL,  -- password, api_key, oauth, sso
    login_provider VARCHAR(100),
    
    -- 结果
    success BOOLEAN NOT NULL,
    failure_reason VARCHAR(255),
    
    -- 环境
    ip_address INET,
    user_agent VARCHAR(500),
    country VARCHAR(50),
    city VARCHAR(50),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_logs_user_id ON login_logs(user_id);
CREATE INDEX idx_login_logs_created_at ON login_logs(created_at);
CREATE INDEX idx_login_logs_success ON login_logs(success) WHERE success = false;
```

## 4. 行级安全策略 (RLS)

```sql
-- 启用 RLS
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmd_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmd_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;

-- Agents 策略
CREATE POLICY agents_rls_policy ON agents
    USING (
        user_id = current_setting('app.current_user_id', true)::uuid
        OR organization_id IN (
            SELECT organization_id FROM organization_members 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    )
    WITH CHECK (
        user_id = current_setting('app.current_user_id', true)::uuid
    );

-- Sessions 策略
CREATE POLICY sessions_rls_policy ON sessions
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Messages 策略
CREATE POLICY messages_rls_policy ON messages
    USING (
        session_id IN (
            SELECT id FROM sessions 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    );

-- Memories 策略
CREATE POLICY memories_rls_policy ON memories
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- User Secrets 策略
CREATE POLICY user_secrets_rls_policy ON user_secrets
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
```

## 5. 数据迁移映射

从现有结构迁移时的映射关系：

| 现有数据 | 目标表 | 映射说明 |
|----------|--------|----------|
| `~/.openclaw/config.json` | users | 创建默认用户，所有现有数据归属该用户 |
| `~/.openclaw/agents/` | agents | 每个 agent 目录对应一条记录 |
| `~/.openclaw/sessions/*.json` | sessions + messages | session.json → sessions, transcript.json → messages |
| `~/.openclaw/memory/{agentId}.sqlite` | memories | 向量数据导入 PostgreSQL |
| `~/.openclaw/secrets.json` | user_secrets | 加密后存储 |

### 迁移脚本要点

1. 创建默认用户 `default@local` (password hash = bcrypt('openclaw'))
2. 遍历现有 agents 目录，导入 agent 配置
3. 遍历 sessions 目录，导入会话和消息
4. 连接 SQLite 导出向量数据，导入 PostgreSQL
5. 迁移 secrets（需要先完成用户认证系统）

## 6. 索引优化建议

### 常用查询模式

```sql
-- 按更新时间查询用户会话
CREATE INDEX idx_sessions_user_updated 
    ON sessions(user_id, updated_at DESC);

-- 向量搜索 + 用户过滤
-- (使用 pgvector 的 HNSW 索引，配合 RLS)

-- 消息搜索 (按会话 + 时间)
CREATE INDEX idx_messages_session_time 
    ON messages(session_id, created_at DESC);

-- 记忆搜索 (按用户 + 时间)
CREATE INDEX idx_memories_user_time 
    ON memories(user_id, created_at DESC);
```

## 7. 扩展考虑

### 7.1 分区表

大表建议使用分区：

```sql
-- 消息表按月分区
CREATE TABLE messages (
    -- ... same columns ...
) PARTITION BY RANGE (created_at);

CREATE TABLE messages_2024_01 PARTITION OF messages
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### 7.2 物化视图

常用统计查询：

```sql
-- 用户使用统计
CREATE MATERIALIZED VIEW user_usage_stats AS
SELECT 
    user_id,
    DATE_TRUNC('day', created_at) as date,
    COUNT(*) as request_count,
    SUM(input_tokens) as input_tokens,
    SUM(output_tokens) as output_tokens
FROM api_logs
GROUP BY user_id, DATE_TRUNC('day', created_at);
```

### 7.3 Redis 缓存

高频访问数据可用 Redis 缓存：

- 用户会话 (JWT → user_id)
- API Key 缓存
- Rate limiting 计数

## 8. SQL 文件位置

所有 DDL 文件位于:
```
/Users/liber/Desktop/openclaw/openclaw-team/db/schema/
├── 001_users.sql
├── 002_agents.sql
├── 003_sessions.sql
├── 004_memories.sql
├── 005_secrets.sql
├── 006_audit.sql
└── 007_rls.sql
```