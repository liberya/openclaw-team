# OpenClaw 企业级认证系统设计

## 1. 概述

本系统为 OpenClaw 提供完整的用户认证和授权功能，包括用户注册、登录、Token 管理、API Key 管理等。

## 2. 安全特性

### 2.1 密码安全

**服务端密码哈希**
- 使用 PBKDF2 (SHA-512) 进行密码哈希
- 100,000 次迭代，64 字节输出
- 每个用户使用随机盐值

```typescript
// src/auth/service.ts
export function hashPassword(password: string): string {
    const salt = randomBytes(32);
    const key = deriveKey(password, salt);
    return `${salt.toString("hex")}:${key.toString("hex")}`;
}
```

**客户端密码加密传输 (HTTPS + 额外层)**

为提供额外安全层，客户端可在发送密码前使用 RSA 公钥加密：

```
Client (Browser/Mobile)
    │
    │  1. 使用服务器公钥加密密码
    ▼
Encrypted Password
    │
    │  2. HTTPS POST /auth/login
    ▼
Server
    │
    │  3. 使用私钥解密
    ▼
Decrypt → 验证密码
```

**注意**: 由于 HTTPS 已提供传输层加密，RSA 加密是可选的额外安全层。

### 2.2 Token 安全

**Access Token**
- 短期 Token (15 分钟)
- Base64URL 编码的 JWT
- 包含用户 ID、邮箱、角色、过期时间

**Refresh Token**
- 长期 Token (7 天)
- 随机生成，存储哈希值
- 使用后立即轮换

```typescript
// Token 结构
interface TokenPayload {
    sub: string;      // user ID
    email: string;
    role: string;
    iat: number;     // issued at
    exp: number;     // expiration
}
```

### 2.3 数据加密

敏感数据（如 API Keys、secrets）使用 AES-256-GCM 加密存储：

```typescript
// src/auth/service.ts
export function encryptValue(value: string, key: string): { encrypted: string; nonce: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key.slice(0, 32), "utf8"), iv);
    // ... encryption
}
```

## 3. API 设计

### 3.1 注册

```
POST /auth.register
{
    email: string,      // required, valid email
    password: string,   // required, min 8 chars
    name?: string       // optional
}

Response:
{
    ok: true,
    payload: {
        user: {
            id: string,
            email: string,
            name: string | null,
            role: "user" | "admin"
        }
    }
}
```

### 3.2 登录

```
POST /auth.login
{
    email: string,
    password: string
}

Response:
{
    ok: true,
    payload: {
        user: { ... },
        tokens: {
            accessToken: string,
            refreshToken: string,
            expiresIn: 900
        }
    }
}
```

### 3.3 Token 刷新

```
POST /auth.refresh
{
    refreshToken: string
}

Response:
{
    ok: true,
    payload: {
        accessToken: string,
        refreshToken: string,
        expiresIn: 900
    }
}
```

### 3.4 登出

```
POST /auth.logout
{
    refreshToken?: string
}

Response:
{
    ok: true,
    payload: { loggedOut: true }
}
```

### 3.5 当前用户

```
POST /auth.me
// 需要在 Header 中携带 Authorization: Bearer <accessToken>

Response:
{
    ok: true,
    payload: {
        user: {
            id: string,
            email: string,
            name: string | null,
            role: string,
            status: string,
            lastLoginAt: Date | null
        }
    }
}
```

### 3.6 API Key 管理

```
POST /auth.apikey.create
// 需要认证
{
    name: string,
    scope: string[],  // ["read"] 或 ["read", "write"]
    expiresAt?: string  // ISO date
}

POST /auth.apikey.list

POST /auth.apikey.delete
// 需要认证
{
    keyId: string
}
```

## 4. 认证流程

### 4.1 完整登录流程

```
┌─────────────┐                              ┌─────────────┐
│   Client    │                              │   Gateway   │
└──────┬──────┘                              └──────┬──────┘
       │                                           │
       │  1. POST /auth.login (HTTPS)             │
       │     { email, password }                  │
       │───────────────────────────────────────────▶
       │                                           │
       │         2. Verify password (PBKDF2)     │
       │         3. Create JWT (15min)             │
       │         4. Create Refresh Token (7 days) │
       │         5. Log login attempt              │
       │                                           │
       │  6. Response: { user, tokens }           │
       │◀──────────────────────────────────────────
       │                                           │
       │  7. Store tokens securely                 │
       │     (Keychain for mobile,                │
       │      httpOnly cookie for web)            │
```

### 4.2 Token 刷新流程

```
┌─────────────┐                              ┌─────────────┐
│   Client    │                              │   Gateway   │
└──────┬──────┘                              └──────┬──────┘
       │                                           │
       │  1. POST /auth.refresh                    │
       │     { refreshToken }                      │
       │───────────────────────────────────────────▶
       │                                           │
       │         2. Verify refresh token (hash)  │
       │         3. Revoke old refresh token      │
       │         4. Generate new tokens            │
       │                                           │
       │  2. Response: { accessToken, refreshToken }
       │◀──────────────────────────────────────────
```

## 5. 使用方式

### 5.1 初始化

```typescript
import { initDatabase, getDbClient } from "./db/client.js";
import { initAuthService, getAuthService, getJwtSecret } from "./auth/service.js";

// 初始化数据库
const db = await initDatabase({
    host: "localhost",
    port: 5432,
    database: "openclaw",
    user: "postgres",
    password: "password"
});

// 初始化认证服务
initAuthService(db, getJwtSecret());
```

### 5.2 客户端使用

```typescript
// 登录
const response = await gateway.invoke("auth.login", {
    email: "user@example.com",
    password: "password123"
});

const { accessToken, refreshToken } = response.tokens;

// 后续请求使用 Access Token
const me = await gateway.invoke("auth.me", {}, {
    authToken: `Bearer ${accessToken}`
});

// Token 过期时刷新
const newTokens = await gateway.invoke("auth.refresh", {
    refreshToken
});
```

## 6. 环境变量

```bash
# JWT 密钥 (必需用于生产)
OPENCLAW_JWT_SECRET=your-secret-key-here

# 加密密钥 (用于加密敏感数据)
OPENCLAW_ENCRYPTION_KEY=your-encryption-key

# 数据库配置
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=openclaw
DATABASE_USER=postgres
DATABASE_PASSWORD=password
```

## 7. 文件结构

```
src/
├── auth/
│   ├── service.ts        # 认证服务 (密码哈希, JWT, Token 管理)
│   └── client-encrypt.ts  # 客户端加密工具 (可选)
├── db/
│   └── client.ts         # 数据库客户端 (PostgreSQL/内存)
└── gateway/
    ├── server-methods/
    │   ├── auth.ts        # 认证 API Handlers
    │   └── types.ts       # Handler 类型定义
    └── auth-middleware.ts # JWT 验证中间件
```