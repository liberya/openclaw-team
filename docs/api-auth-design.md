# OpenClaw API 认证设计

## 概述

本文档描述如何为 OpenClaw Gateway API 添加用户认证功能，支持 JWT 和 API Key 两种认证方式。

## 认证方式

### 1. JWT Token

用户登录后获取 Access Token，后续请求通过 `Authorization: Bearer <token>`  Header 传递。

**流程:**
```
1. 用户登录 /auth.login
2. 获取 accessToken (15分钟有效)
3. 后续请求 Header: Authorization: Bearer <accessToken>
4. 服务验证 token，设置用户上下文
```

### 2. API Key

用户可在个人设置中创建 API Key，请求时直接在 Header 中传递。

**流程:**
```
1. 用户创建 API Key (通过 /auth.apikey.create)
2. 获取 API Key (格式: sk_xxx...)
3. 请求 Header: Authorization: <apiKey>
4. 服务验证 API Key，设置用户上下文
```

## API 认证支持

### HTTP 端点

以下 HTTP 端点支持 JWT/API Key 认证：

| 端点 | 方法 | 认证方式 |
|------|------|----------|
| `/tools.invoke` | POST | JWT / API Key |
| WebSocket 连接 | WS | JWT / API Key |

### WebSocket 连接认证

连接时在 ConnectParams 中传递认证信息：

```typescript
{
  auth: {
    token: "Bearer <jwt_token>"  // 或直接是 API Key
  }
}
```

## 实现细节

### 1. HTTP 认证 (tools-invoke-http.ts)

HTTP 请求通过 `authorizeHttpGatewayConnect` 函数认证：

```typescript
const authResult = await authorizeHttpGatewayConnect({
  auth: resolvedAuth,
  connectAuth: { token: bearerToken },
  jwtSecret: process.env.OPENCLAW_JWT_SECRET,
  verifyJwt: async (token, secret) => verifyAccessToken(token, secret),
  verifyApiKey: async (key) => authService.verifyApiKey(key),
});
```

认证流程:
1. 检查 `Authorization` Header
2. 如果是 `Bearer <token>` 格式，验证 JWT
3. 如果不是 Bearer 前缀，尝试作为 API Key 验证
4. 验证失败则回退到传统的 token/password 认证

### 2. WebSocket 连接认证 (auth-context.ts)

WebSocket 连接通过 `authorizeGatewayConnect` 认证，支持 JWT 和 API Key。

### 3. 方法级认证 (server-methods.ts)

每个方法调用前会通过 `authorizeGatewayMethod` 检查权限：

```typescript
function authorizeGatewayMethod(method: string, client) {
  // 检查 JWT/API Key 认证的用户角色
  if (client.connect.authMethod === "jwt" || client.connect.authMethod === "api-key") {
    const role = client.userRole ?? "user";
    // 验证角色权限
  }
  // ... 原有逻辑
}
```

## 公共方法 (无需认证)

以下方法无需认证即可访问：

```typescript
const PUBLIC_METHODS = new Set([
  "health",
  "auth.register",
  "auth.login",
  "auth.refresh",
  "auth.admin.init",
]);
```

## 权限控制

### 角色权限

| 角色 | 权限 |
|------|------|
| admin | 所有管理功能 (用户管理、迁移等) |
| user | 常规功能 (聊天、Agent、Session 等) |

### 方法权限

方法权限通过 `role-policy.ts` 和 `method-scopes.ts` 控制。

## 认证中间件

### 中间件代码 (api-auth.ts)

```typescript
export async function authorizeApiRequest(params) {
  const connectAuth = params.connectAuth;
  
  // 1. 尝试 JWT 认证
  if (connectAuth?.token?.startsWith("Bearer ")) {
    const result = await authorizeJwtToken(token, authService);
    if (result.ok) {
      return {
        ok: true,
        method: "jwt",
        userId: result.user.id,
        userRole: result.user.role,
        userEmail: result.user.email,
      };
    }
  }
  
  // 2. 尝试 API Key 认证
  if (connectAuth?.token) {
    const result = await authorizeApiKey(token, authService);
    if (result.ok) {
      return {
        ok: true,
        method: "api-key",
        userId: result.user.id,
        userRole: result.user.role,
        userEmail: result.user.email,
      };
    }
  }
  
  // 3. 回退到传统认证
  return authorizeGatewayConnect(params);
}
```

## 使用示例

### 工具调用

```bash
# 使用 JWT
curl -X POST http://localhost:8080/tools.invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{"tool": "memory_search", "args": {"query": "test"}}'

# 使用 API Key
curl -X POST http://localhost:8080/tools.invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: sk_abc123..." \
  -d '{"tool": "memory_search", "args": {"query": "test"}}'
```

### WebSocket 连接

```javascript
const ws = new WebSocket('ws://localhost:8080', {
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
});

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'req',
    method: 'connect',
    params: {
      minProtocol: 1,
      maxProtocol: 1,
      client: { ... },
      auth: {
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      }
    }
  }));
});
```

## 环境变量

```bash
# JWT 密钥 (必需)
OPENCLAW_JWT_SECRET=your-secret-key-here

# 数据库配置
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=openclaw
DATABASE_USER=postgres
DATABASE_PASSWORD=password
```

## 安全注意事项

1. **HTTPS**: 生产环境必须使用 HTTPS
2. **Token 有效期**: Access Token 15 分钟，Refresh Token 7 天
3. **API Key 安全**: API Key 只显示一次，需安全存储
4. **密码传输**: 客户端应使用 HTTPS 传输密码，可选 RSA 加密