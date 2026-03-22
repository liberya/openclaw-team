# OpenClaw 企业级架构设计方案

## 1. 目标

将 OpenClaw 从单用户个人应用改造为多租户企业级应用，实现：
- 用户认证与权限管理
- 数据隔离（每个用户只能访问自己的数据）
- 支持多个用户/团队共用一个实例

## 2. 架构概览

### 2.1 技术栈升级

| 组件 | 现状 | 目标 |
|------|------|------|
| 数据库 | SQLite (每 agent 一个) | PostgreSQL + Redis (会话) |
| 认证 | 设备级 token/password | JWT + OAuth2/SSO |
| API | 无认证中间件 | 统一认证中间件 |
| 部署 | 单实例 | 支持集群 |

### 2.2 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Client Apps                           │
│         (iOS / Android / macOS / Web)                   │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS/WSS
┌─────────────────────▼───────────────────────────────────┐
│                  Gateway (Node.js)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Auth API   │  │  User API   │  │  Core API   │     │
│  │  (登录/注册)  │  │  (用户管理)  │  │  (Agent)   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Chat API   │  │ Memory API  │  │ Tools API   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────┬───────────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │     Load Balancer      │
         └────────────┬────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
┌───▼───┐       ┌─────▼─────┐    ┌─────▼─────┐
│ GW 1  │       │  GW 2     │    │  GW N     │
└───┬───┘       └─────┬─────┘    └─────┬─────┘
    │                 │                 │
    └─────────────────┼─────────────────┘
                      │
         ┌────────────┴────────────┐
         │     PostgreSQL          │
         │  (主数据库 + RLS)       │
         └─────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │       Redis             │
         │  (会话/缓存/队列)        │
         └─────────────────────────┘
```

## 3. 数据库设计

### 3.1 核心表结构

```sql
-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user', -- user, admin
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- API Keys (用户级别)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP
);

-- 租户/团队 (可选，用于团队协作)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 团队成员
CREATE TABLE organization_members (
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member', -- owner, admin, member
    PRIMARY KEY (organization_id, user_id)
);

-- Agents (用户隔离)
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    model VARCHAR(255),
    config JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Memory/向量存储 (用户隔离)
CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Chats/Sessions (用户隔离)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id),
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- user, assistant
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 配置/密钥 (用户隔离)
CREATE TABLE user_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    encrypted_value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3.2 行级安全 (RLS)

```sql
-- 启用 RLS
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;

-- 创建策略
CREATE POLICY agents_user_isolation ON agents
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY memories_user_isolation ON memories
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- 等等...
```

## 4. API 设计

### 4.1 认证 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/auth/register | 用户注册 |
| POST | /api/v1/auth/login | 登录 |
| POST | /api/v1/auth/logout | 登出 |
| POST | /api/v1/auth/refresh | 刷新 token |
| POST | /api/v1/auth/forgot-password | 忘记密码 |
| POST | /api/v1/auth/reset-password | 重置密码 |

### 4.2 用户 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/users/me | 获取当前用户信息 |
| PUT | /api/v1/users/me | 更新用户信息 |
| GET | /api/v1/users/me/api-keys | 获取用户的 API Keys |
| POST | /api/v1/users/me/api-keys | 创建 API Key |
| DELETE | /api/v1/users/me/api-keys/:id | 删除 API Key |

### 4.3 Agent API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/agents | 列出用户的 agents |
| POST | /api/v1/agents | 创建 agent |
| GET | /api/v1/agents/:id | 获取 agent 详情 |
| PUT | /api/v1/agents/:id | 更新 agent |
| DELETE | /api/v1/agents/:id | 删除 agent |

### 4.4 Chat API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/sessions | 列出用户的会话 |
| POST | /api/v1/sessions | 创建会话 |
| GET | /api/v1/sessions/:id | 获取会话及消息 |
| DELETE | /api/v1/sessions/:id | 删除会话 |
| POST | /api/v1/sessions/:id/chat | 发送消息 |

### 4.5 Memory API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/memories | 搜索记忆 |
| POST | /api/v1/memories | 添加记忆 |
| DELETE | /api/v1/memories/:id | 删除记忆 |

## 5. 认证设计

### 5.1 认证流程

```
用户登录流程:
1. 用户提交 email + password
2. 服务器验证密码
3. 生成 JWT Access Token (短期, 15min) + Refresh Token (长期, 7天)
4. 返回 token 给客户端
5. 客户端在后续请求中携带 Access Token

Token 刷新流程:
1. Access Token 过期
2. 客户端使用 Refresh Token 请求 /auth/refresh
3. 验证 refresh token 有效性
4. 生成新的 token 对
5. 返回新的 tokens
```

### 5.2 Token 设计

```typescript
// Access Token Payload
{
  "sub": "user-id",
  "email": "user@example.com",
  "role": "user",
  "iat": 1234567890,
  "exp": 1234568790  // 15 min
}

// Refresh Token (存数据库/Redis)
{
  "userId": "user-id",
  "tokenHash": "hash-of-token",
  "expiresAt": "2024-xx-xx"
}
```

### 5.3 客户端认证

移动端通过以下方式认证:
1. 首次登录获取 token
2. 将 token 存储在设备安全存储区
3. 每次请求在 Header 携带: `Authorization: Bearer <token>`

## 6. 数据迁移策略

### 6.1 迁移步骤

1. **创建新数据库**
   - 使用 PostgreSQL 替代 SQLite
   - 执行新的 schema

2. **迁移现有数据**
   - 创建默认用户 (原单用户数据归属)
   - 将现有 SQLite 数据导入 PostgreSQL

3. **双写阶段** (可选)
   - 同时写入新旧数据库
   - 验证一致性

4. **切换**
   - 切换到新数据库
   - 旧数据可保留一段时间用于回滚

### 6.2 现有数据处理

现有数据迁移映射:
- 现有 agent → 归属于默认用户 (user_id = default)
- 现有 memory → 归属于默认用户
- 现有 sessions → 归属于默认用户
- 现有配置 → 归属于默认用户

## 7. 实施计划

### Phase 1: 基础设施 (1-2周)
- [ ] 搭建 PostgreSQL 数据库
- [ ] 设计并创建数据库 schema
- [ ] 实现 RLS 策略

### Phase 2: 认证系统 (1周)
- [ ] 实现用户注册/登录 API
- [ ] 实现 JWT 认证
- [ ] 实现 API Key 管理

### Phase 3: 核心业务迁移 (2-3周)
- [ ] 迁移 agents 到 PostgreSQL
- [ ] 迁移 sessions/messages
- [ ] 迁移 memories
- [ ] 添加认证中间件到所有 API

### Phase 4: 客户端适配 (1-2周)
- [ ] iOS 登录界面
- [ ] Android 登录界面
- [ ] Token 管理

### Phase 5: 高级功能 (可选)
- [ ] 团队/组织功能
- [ ] SSO/OAuth 集成
- [ ] 管理员面板

## 8. 关键文件改动

需要改动的主要文件:
- `src/gateway/auth.ts` - 添加用户认证
- `src/gateway/server.ts` - 添加认证中间件
- `src/agents/memory-search.ts` - 改为从 DB 读取
- 移动端 - 添加登录/注册 UI
- 新增 `src/db/` - 数据库相关代码

## 9. 向后兼容性

为平滑迁移,支持两种模式:
1. **Legacy 模式**: 无用户认证,单实例模式 (老用户)
2. **Enterprise 模式**: 用户认证,多租户模式

通过环境变量或配置切换模式。