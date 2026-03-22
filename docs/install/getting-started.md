# OpenClaw Enterprise Installation Guide

---

## Environment Requirements

### Server Configuration

#### Minimum (Development / Single User)

| Item     | Requirement                         |
| -------- | ----------------------------------- |
| CPU      | 2 cores                            |
| Memory   | 4 GB                               |
| Disk     | 10 GB available space               |
| OS       | macOS / Linux (Ubuntu 20.04+)      |

#### Recommended (Team / Up to 10 Users)

| Item     | Requirement                         |
| -------- | ----------------------------------- |
| CPU      | 4 cores                            |
| Memory   | 8 GB                               |
| Disk     | 50 GB SSD                          |
| OS       | macOS / Ubuntu 22.04 / Debian 12  |

#### Enterprise (20+ Users)

| Item     | Requirement                                              |
| -------- | --------------------------------------------------------|
| CPU      | 8+ cores                                                |
| Memory   | 16 GB+                                                 |
| Disk     | 100 GB SSD                                             |
| OS       | Linux (Ubuntu 22.04)                                   |
| Network  | Internal deployment recommended; use Nginx reverse proxy + HTTPS for external access |

#### Standalone Database Deployment (Optional)

If PostgreSQL is deployed on the same server as Gateway, additional resources are recommended:

| Item       | Requirement                                 |
| ---------- | ------------------------------------------- |
| Extra RAM  | +2 GB (PostgreSQL recommended to run standalone) |
| Extra Disk | +20 GB (depends on log and session data growth) |

### Development Environment Requirements

| Item       | Version    | Notes                              |
| ---------- | ---------- | ---------------------------------- |
| Node.js    | >= 22.16.0 | Check with `node --version`       |
| pnpm       | >= 10.x    | Install with `npm install -g pnpm` |
| PostgreSQL | >= 14      | Database                           |

---

## Installation Steps

### Step 1: Clone the Repository

```bash
git clone https://github.com/iberya/openclaw-team.git
cd openclaw-team
```

### Step 2: Install Dependencies

```bash
pnpm install
```

### Step 3: Initialize the Database

#### 3.1 Create Database and User

```bash
# Connect as postgres user
sudo -u postgres psql
```

In psql, execute:

```sql
CREATE USER openclaw WITH ENCRYPTED PASSWORD 'your_password';
CREATE DATABASE openclaw OWNER openclaw;
\q
```

#### 3.2 Run Database Migrations

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

### Step 4: Configure Environment Variables

Create `~/.openclaw/.env`:

```bash
mkdir -p ~/.openclaw
cat > ~/.openclaw/.env << 'EOF'
# Database connection
OPENCLAW_DB_HOST=localhost
OPENCLAW_DB_PORT=5432
OPENCLAW_DB_NAME=openclaw
OPENCLAW_DB_USER=openclaw
OPENCLAW_DB_PASSWORD=your_password

# JWT signing secret (recommended to use a random string)
OPENCLAW_JWT_SECRET=your-random-jwt-secret

# Gateway access token (optional for localhost access)
# OPENCLAW_GATEWAY_TOKEN=your-gateway-token
EOF
```

> Database connection info can also be written directly to `~/.openclaw/openclaw.json`. Environment variables take precedence.

### Step 5: Build the Project

```bash
# Install UI dependencies and build frontend
pnpm ui:install
pnpm ui:build

# Build backend
pnpm build
```

### Step 6: Configure Gateway

Create or edit `~/.openclaw/openclaw.json`:

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

### Step 7: Start the Service

```bash
# Start Gateway
pnpm start

# Or start with specific port
node openclaw.mjs start --port 18789
```

Gateway listens on `http://127.0.0.1:18789` by default, WebSocket on the same port.

**On first startup, Gateway automatically creates the admin account:**

| Field   | Value                |
| ------- | -------------------- |
| Email   | `admin@openclaw.ai`  |
| Password| `admin123`           |

### Step 8: Access the Control Panel

Open your browser: `http://127.0.0.1:18789`

Login with admin account: `admin@openclaw.ai` / `admin123`

---

## Configuring AI Model Providers

In **Settings → Models**, click **Add Model Provider** and fill in:

1. **Provider** — Select from dropdown (e.g., qwen-portal)
2. **API Key** — Enter the provider's API key
3. **Base URL** — Use default, can be left empty; fill in if using a custom API address

Click **Add Provider** and the system will automatically:

- Discover available models from the provider's API
- Identify models that support image input (e.g., qwen-vl series)
- Write the model list to the config file

**After adding**, select the model on the chat page to start using it.

**Supported Provider Presets:**

| Provider    | Description              |
| ----------- | ------------------------ |
| OpenAI      | OpenAI API               |
| Anthropic   | Claude series            |
| qwen-portal | Alibaba Tongyi Qwen      |
| KiloCode    | KiloCode API            |
| HuggingFace | HF Inference API         |
| Gemini      | Google Gemini            |
| OpenRouter  | Aggregates multiple models|
| Local AI    | Locally deployed compatible APIs |

---

## Environment Variables Reference

| Variable               | Default         | Description                               |
| ---------------------- | --------------- | ----------------------------------------- |
| `OPENCLAW_DB_HOST`     | `localhost`     | PostgreSQL host address                   |
| `OPENCLAW_DB_PORT`     | `5432`          | PostgreSQL port                           |
| `OPENCLAW_DB_NAME`     | `openclaw`      | Database name                             |
| `OPENCLAW_DB_USER`     | `openclaw`      | Database username                          |
| `OPENCLAW_DB_PASSWORD` | `openclaw123`   | Database password                          |
| `OPENCLAW_JWT_SECRET`  | —               | JWT signing secret (required)               |
| `OPENCLAW_GATEWAY_PORT` | `18789`         | Gateway listening port                    |

---

## FAQ

**Q: UI is blank or styles are broken?**  
Make sure you have run `pnpm ui:build`. Gateway loads frontend assets from `ui/dist/`.

**Q: Database connection failed?**  
Check if PostgreSQL is running and the database credentials in the environment variables are correct.

**Q: Adding model failed?**  
Make sure the API Key is valid and the network can reach the provider's endpoint.

**Q: Token expired?**  
Access Token is valid for 24 hours. Re-login when it expires.

**Q: Port is already in use?**  
Use `node openclaw.mjs start --port <other-port>` to specify a different port.

**Q: How to restart Gateway?**  
Press `Ctrl+C` to stop, then run `pnpm start` again. For production, use systemd or supervisor to manage the process.
