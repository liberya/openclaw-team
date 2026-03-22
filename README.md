# OpenClaw-Team

**让每个团队成员拥有独立的 AI 助手，数据互不干扰**

---

## About

OpenClaw-Team 是基于 [OpenClaw](https://github.com/openclaw/openclaw) 改造的多用户版本，为企业提供**安全隔离、团队协作、统一管理**的 AI 助手平台。

### 原始版本的局限

> 所有人共享同一个 AI 助手配置，张三创建的 Agent，李四也能看到；王五的定时任务，赵六也能修改。

OpenClaw-Team 在保持原有功能的基础上，构建了**多用户隔离机制**。每个用户登录后，只能看到和管理自己创建的内容，所有数据严格分离。

---

## Core Differences

|                | Original OpenClaw    | OpenClaw-Team                      |
| -------------- | ------------------- | ---------------------------------- |
| **Target User**   | Personal users       | Enterprise teams                    |
| **User System**   | None                | Dedicated accounts + JWT tokens     |
| **Data Isolation** | Shared globally    | Strict per-user isolation           |
| **Access Control** | Device pairing    | User roles (admin/user)             |
| **Token Mechanism** | Shared static token | Per-user JWT (24h) + Refresh token |
| **Model Config**  | Manual config file   | Web admin UI + auto discovery       |
| **Admin Features** | None               | User management + model admin console|

---

## Features

### 1. Multi-Tenant Data Isolation

Users can only see and manage data they created; admins can see everything:

| API                          | Isolation Scope                        |
| ---------------------------- | -------------------------------------- |
| `agents.list`                | Returns only the user's own agents     |
| `cron.list`                  | Returns only the user's own cron jobs  |
| `cron.runs`                 | Filters logs by job authorization      |
| `cron.update / remove / run` | Validates user authorization first     |

Isolation mechanism: Database-level (Row Level Security) + Application-layer dual filtering.

### 2. User Accounts & Authentication

- **Login** — Email + password, bcrypt hashing
- **JWT Access Token** — 24-hour validity, contains user identity
- **Refresh Token** — 30-day validity, supports automatic renewal
- **User Deletion** — Soft delete + cascading cleanup of related data
- **Role System** — `admin` (administrator) / `user` (regular user)

### 3. Automatic Model Discovery

Automatically discovers models when adding a provider:

- **Auto Discovery** — No need to manually find model IDs
- **Image Input Detection** — Automatically identifies models that support image input (qwen-vl, gpt-4o, etc.)
- **Manual Input Fallback** — Can manually input model IDs if discovery fails

### 4. Admin Control Panel

Administrators can access the management backend to perform:

**User Management**
- View all user list (email, role, status, registration time)
- Create new users
- Delete users (soft delete)
- Set user roles (admin / user)

**Model Management**
- View all configured model providers
- Add new model providers (fill in API Key, auto-discover models)
- View model list under each provider
- Delete model providers

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  OpenClaw Enterprise                   │
│                                                         │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐  │
│  │  User A     │   │  User B     │   │  User C     │  │
│  │  (admin)    │   │  (user)     │   │  (user)     │  │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘  │
│         │                  │                  │         │
│         └────────────────┼──────────────────┘         │
│                          │                            │
│                    WebSocket Connection                │
│                    (Token Authentication)             │
│                          │                            │
│  ┌───────────────────────▼──────────────────────────┐  │
│  │                      Gateway                     │  │
│  │                                                     │  │
│  │  /agents.list  →  Query user_agents table  → Own  │  │
│  │  /cron.list   →  Query user_crons table   → Own  │  │
│  │  /cron.runs  →  Check jobId authorization       │  │
│  │  /config.patch →  AI creates Agent → user_agents  │  │
│  └──────────────────────────┬────────────────────────┘  │
│                             │                          │
│         ┌───────────────────┴───────────────────┐       │
│         │                                       │        │
│  ┌──────▼──────┐                        ┌─────▼──────┐  │
│  │ PostgreSQL  │                        │   Config   │  │
│  │             │                        │   File     │  │
│  │ users       │                        │ (~/.open- │  │
│  │ user_agents │                        │   claw/)   │  │
│  │ user_crons  │                        │            │  │
│  │refresh_tokens│                        │ agents.json │  │
│  └─────────────┘                        └────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Security Model

- **Token Security** — Access Token expires in 24 hours, Refresh Token in 30 days, supports revocation
- **Database Isolation** — Row Level Security (RLS), automatic filtering of each user's queries
- **Password Storage** — bcrypt high-strength hashing, irreversible
- **Data Isolation** — Even if code has bugs, database RLS policies ensure no data leakage between users

---

## Getting Started

### Prerequisites

- **Node.js** >= 22.16.0
- **PostgreSQL** >= 14
- **pnpm** >= 10.x (`npm install -g pnpm`)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/iberya/openclaw-team.git
cd openclaw-team

# 2. Install dependencies
pnpm install

# 3. Build UI and backend
pnpm ui:build
pnpm build

# 4. Configure environment
cp .env.enterprise ~/.openclaw/.env
# Edit ~/.openclaw/.env with your database credentials and JWT secret

# 5. Initialize database
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/001_users.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/002_agents.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/003_sessions.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/004_memories.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/005_secrets.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/006_audit.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/007_rls.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/008_rbac_permissions.sql
PGPASSWORD=your_password psql -d openclaw -U openclaw -f db/schema/009_user_data_isolation.sql

# 6. Start the gateway
pnpm start

# 7. Access the control panel
# Open http://127.0.0.1:18789
# Default admin login: admin@openclaw.ai / admin123
```

### Configuration

Edit `~/.openclaw/openclaw.json`:

```json
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
```

For detailed installation instructions (server requirements, cloud deployment, troubleshooting), see the [Full Installation Guide](docs/install/getting-started.md).

---

## Use Cases

- Enterprise internal AI platform (multi-department data isolation)
- Multi-user AI platform (independent configuration, independent models)
- Training institutions (multi-class independent management)

---

## License

This project is licensed under the Apache License 2.0.

- OpenClaw Enterprise additions: Copyright 2026 OpenClaw-Team Contributors, Apache 2.0
- Original OpenClaw: Copyright 2025 Peter Steinberger, MIT License

See [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
