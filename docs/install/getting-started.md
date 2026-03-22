# OpenClaw Enterprise 安装指南

---

## 环境要求

### 服务器配置

#### 最低配置（开发 / 单用户）

| 项目     | 要求                           |
| -------- | ------------------------------ |
| CPU      | 2 核                           |
| 内存     | 4 GB                           |
| 磁盘     | 10 GB 可用空间                 |
| 操作系统 | macOS / Linux（Ubuntu 20.04+） |

#### 推荐配置（团队 / 10 人以内）

| 项目     | 要求                             |
| -------- | -------------------------------- |
| CPU      | 4 核                             |
| 内存     | 8 GB                             |
| 磁盘     | 50 GB SSD                        |
| 操作系统 | macOS / Ubuntu 22.04 / Debian 12 |

#### 企业配置（20 人以上）

| 项目     | 要求                                                |
| -------- | --------------------------------------------------- |
| CPU      | 8 核+                                               |
| 内存     | 16 GB+                                              |
| 磁盘     | 100 GB SSD                                          |
| 操作系统 | Linux（Ubuntu 22.04）                               |
| 网络     | 推荐内网部署；外网访问建议配 Nginx 反向代理 + HTTPS |

#### 数据库独立部署（可选）

如果 PostgreSQL 与 Gateway 部署在同一台机器，建议额外准备：

| 项目     | 要求                               |
| -------- | ---------------------------------- |
| 额外内存 | +2 GB（PostgreSQL 建议独立占用）   |
| 额外磁盘 | +20 GB（根据日志和会话数据量增长） |

### 开发环境要求

| 项目       | 版本要求  | 备注                       |
| ---------- | --------- | -------------------------- |
| Node.js    | >= 22.16.0 | `node --version` 查看      |
| pnpm       | >= 10.x    | `npm install -g pnpm` 安装 |
| PostgreSQL | >= 14      | 数据库                     |

---

## 安装步骤

### 第一步：克隆代码

```bash
git clone https://github.com/iberya/openclaw-team.git
cd openclaw-team
```

### 第二步：安装依赖

```bash
pnpm install
```

### 第三步：初始化数据库

#### 3.1 创建数据库和用户

```bash
# 以 postgres 用户连接
sudo -u postgres psql
```

在 psql 中执行：

```sql
CREATE USER openclaw WITH ENCRYPTED PASSWORD 'your_password';
CREATE DATABASE openclaw OWNER openclaw;
\q
```

#### 3.2 执行数据库迁移

```bash
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/001_users.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/002_agents.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/003_sessions.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/004_memories.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/005_secrets.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/006_audit.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/007_rls.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/008_rbac_permissions.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/009_user_data_isolation.sql
```

### 第四步：配置环境变量

创建 `~/.openclaw/.env` 文件：

```bash
mkdir -p ~/.openclaw
cat > ~/.openclaw/.env << 'EOF'
# 数据库连接
OPENCLAW_DB_HOST=localhost
OPENCLAW_DB_PORT=5432
OPENCLAW_DB_NAME=openclaw
OPENCLAW_DB_USER=openclaw
OPENCLAW_DB_PASSWORD=your_password

# JWT 密钥（建议使用随机字符串）
OPENCLAW_JWT_SECRET=your-random-jwt-secret

# Gateway 访问密钥（可选，localhost 访问时可省略）
# OPENCLAW_GATEWAY_TOKEN=your-gateway-token
EOF
```

> 数据库连接信息也可直接写在 `~/.openclaw/openclaw.json` 中，Gateway 优先读取环境变量。

### 第五步：构建项目

```bash
# 安装 UI 依赖并构建前端
pnpm ui:install
pnpm ui:build

# 构建后端
pnpm build
```

### 第六步：配置 Gateway

创建或编辑 `~/.openclaw/openclaw.json`：

```bash
mkdir -p ~/.openclaw
cat > ~/.openclaw/openclaw.json << 'EOF'
{
  "gateway": {
    "mode": "local",
    "controlUi": {
      "allowInsecureAuth": true
    },
    "auth": {
      "mode": "token",
      "token": "YOUR_GATEWAY_TOKEN"
    }
  },
  "models": {
    "providers": {}
  },
  "agents": {
    "defaults": {
      "compaction": {
        "mode": "safeguard"
      }
    },
    "list": [
      { "id": "main" }
    ]
  }
}
EOF
```

### 第七步：启动服务

```bash
# 启动 Gateway
pnpm start

# 或指定端口启动
node openclaw.mjs start --port 18789
```

Gateway 默认监听 `http://127.0.0.1:18789`，WebSocket 同端口。

**首次启动时，Gateway 会自动创建管理员账户：**

| 字段   | 值                  |
| ------ | ------------------- |
| 用户名 | `admin@openclaw.ai` |
| 密码   | `admin123`          |

### 第八步：访问控制台

打开浏览器访问：`http://127.0.0.1:18789`

使用管理员账户登录：`admin@openclaw.ai` / `admin123`

---

## 如何配置 AI 模型 Provider

在 **Settings → Models** 页面，点击 **Add Model Provider**，填写以下信息：

**填写步骤：**

1. **Provider** — 从下拉列表选择（如 qwen-portal）
2. **API Key** — 填入该 Provider 的密钥
3. **Base URL** — 使用默认值，可留空；如有自定义 API 地址则填写

填好后点击 **Add Provider**，系统会自动：

- 从该 Provider 的 API 发现可用模型
- 识别支持图片输入的模型（如 qwen-vl 系列）
- 将模型列表写入配置文件

**添加完成后**，在聊天页面即可选择对应模型进行对话。

**支持的 Provider 预设示例：**

| Provider    | 说明               |
| ----------- | ------------------ |
| OpenAI      | OpenAI API         |
| Anthropic   | Claude 系列        |
| qwen-portal | 阿里通义千问       |
| KiloCode    | KiloCode API       |
| HuggingFace | HF Inference API   |
| Gemini      | Google Gemini      |
| OpenRouter  | 聚合多个模型       |
| Local AI    | 本地部署的兼容 API |

---

## 环境变量说明

| 变量                   | 默认值        | 说明                                       |
| ---------------------- | ------------- | ------------------------------------------ |
| `OPENCLAW_DB_HOST`     | `localhost`   | PostgreSQL 主机地址                         |
| `OPENCLAW_DB_PORT`     | `5432`        | PostgreSQL 端口                             |
| `OPENCLAW_DB_NAME`     | `openclaw`    | 数据库名称                                 |
| `OPENCLAW_DB_USER`     | `openclaw`    | 数据库用户名                               |
| `OPENCLAW_DB_PASSWORD` | `openclaw123` | 数据库密码                                 |
| `OPENCLAW_JWT_SECRET`  | —             | JWT 签名密钥（必须设置）                    |
| `OPENCLAW_GATEWAY_PORT` | `18789`       | Gateway 监听端口                           |

---

## 常见问题

**Q: UI 空白或样式异常？**  
确认已执行 `pnpm ui:build`，Gateway 会从 `ui/dist/` 目录加载前端资源。

**Q: 数据库连接失败？**  
检查 PostgreSQL 是否启动，以及环境变量中的数据库连接信息是否正确。

**Q: 添加模型失败？**  
确认 API Key 有效，且网络可以访问该 Provider 的接口地址。

**Q: Token 过期？**  
Access Token 有效期 24 小时，超时后重新登录即可。

**Q: 端口被占用？**  
使用 `node openclaw.mjs start --port <其他端口>` 指定其他端口。

**Q: 如何重启 Gateway？**  
按 `Ctrl+C` 停止，然后重新运行 `pnpm start`。生产环境建议使用 systemd 或 supervisor 管理进程。
