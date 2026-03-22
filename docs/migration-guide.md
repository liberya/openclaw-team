# OpenClaw 数据迁移指南

## 概述

本指南帮助将现有 OpenClaw 单用户数据迁移到 PostgreSQL 数据库，实现多用户数据隔离。

## 迁移内容

迁移服务会从现有数据存储导入以下内容：

| 数据类型 | 源位置 | 目标表 |
|----------|--------|--------|
| Agent 配置 | `~/.openclaw/openclaw.json` | `agents` |
| 会话数据 | `~/.openclaw/agents/{agentId}/sessions/sessions.json` | `sessions` |
| 记忆/向量 | `~/.openclaw/memory/{agentId}.sqlite` | `memories` |

## 使用方式

### 1. 初始化迁移服务

在应用启动时初始化迁移服务：

```typescript
import { initDatabase, getDbClient } from "./db/client.js";
import { initMigrationService } from "./db/migration.js";

const db = await initDatabase({ /* config */ });
await initMigrationService(db);
```

### 2. 执行迁移

通过 API 调用执行迁移（需要 admin 权限）：

```typescript
// 完整迁移
const result = await gateway.invoke("migration.run", {
    // 可选：指定 openclaw 目录，默认 ~/.openclaw
    openclawHome: "/path/to/openclaw",
    // 试运行模式，不实际写入数据
    dryRun: false
});

/*
响应示例：
{
    "ok": true,
    "payload": {
        "success": true,
        "agentsMigrated": 3,
        "sessionsMigrated": 15,
        "memoriesMigrated": 128,
        "errors": []
    }
}
*/
```

### 3. 检查迁移状态

```typescript
const status = await gateway.invoke("migration.status");
```

## 数据映射

### Agents

- 从 `openclaw.json` 的 `agents.list` 读取
- 每个 agent 对应一条数据库记录
- 保留完整配置 JSON

### Sessions

- 从 `agents/{agentId}/sessions/sessions.json` 读取
- 关联到对应的 agent
- 保留会话元数据（channel、model、tokens 等）

### Memories

- 从 `memory/{agentId}.sqlite` 读取
- 使用 SHA256 哈希进行去重
- 保留 metadata 和 memory_type

## 注意事项

1. **幂等性**: 迁移服务会检查已存在的记录，相同内容不会重复导入
2. **试运行**: 使用 `dryRun: true` 可以先预览迁移结果
3. **错误处理**: 部分失败不会阻止其他数据迁移
4. **向量数据**: 如果 SQLite 无法读取，会尝试作为文本文件解析

## 故障排除

### 问题：找不到数据目录

**解决**: 确认 `~/.openclaw` 目录存在，或通过 `openclawHome` 参数指定路径。

### 问题：SQLite 数据库读取失败

**解决**: 某些记忆可能存储为文本格式，服务会自动尝试两种格式。

### 问题：迁移后数据未显示

**解决**: 确认用户 ID 正确，数据通过 RLS 策略过滤。

## 批量迁移脚本

```bash
#!/bin/bash
# 迁移脚本示例

# 1. 登录获取 token
TOKEN=$(curl -s -X POST http://localhost:8080/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}' \
  | jq -r '.payload.tokens.accessToken')

# 2. 执行迁移
curl -X POST http://localhost:8080/migration.run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"dryRun":false}'
```