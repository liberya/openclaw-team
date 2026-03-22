import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDbClient, type DbClient } from "../../db/client.js";
import { createLogger } from "../logging.js";
import type { AgentConfig } from "../../config/types.agents.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { User } from "../../auth/service.js";

const log = createLogger("migration/service");

export interface MigrationOptions {
    openclawHome?: string;
    userId?: string;
    dryRun?: boolean;
}

export interface MigrationResult {
    success: boolean;
    agentsMigrated: number;
    sessionsMigrated: number;
    memoriesMigrated: number;
    errors: string[];
}

function resolveOpenclawHome(): string {
    return process.env.OPENCLAW_HOME ?? path.join(process.env.HOME ?? "~", ".openclaw");
}

function expandPath(p: string): string {
    if (p.startsWith("~/")) {
        return path.join(process.env.HOME ?? "", p.slice(2));
    }
    return p;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        const content = await fs.promises.readFile(filePath, "utf-8");
        return JSON.parse(content);
    } catch {
        return null;
    }
}

async function findSqliteDatabases(memoryDir: string): Promise<string[]> {
    const dbs: string[] = [];
    try {
        const entries = await fs.promises.readdir(memoryDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".sqlite")) {
                dbs.push(path.join(memoryDir, entry.name));
            }
        }
    } catch {
        // Directory doesn't exist
    }
    return dbs;
}

export class MigrationService {
    private db: DbClient;
    private openclawHome: string;
    private userId: string;
    private dryRun: boolean;

    constructor(db: DbClient, options: MigrationOptions = {}) {
        this.db = db;
        this.openclawHome = expandPath(options.openclawHome ?? resolveOpenclawHome());
        this.userId = options.userId ?? "";
        this.dryRun = options.dryRun ?? false;
    }

    async migrate(): Promise<MigrationResult> {
        const result: MigrationResult = {
            success: true,
            agentsMigrated: 0,
            sessionsMigrated: 0,
            memoriesMigrated: 0,
            errors: [],
        };

        log.info("Starting migration", { openclawHome: this.openclawHome, userId: this.userId, dryRun: this.dryRun });

        const agentsMigrated = await this.migrateAgents();
        result.agentsMigrated = agentsMigrated;

        const sessionsMigrated = await this.migrateSessions();
        result.sessionsMigrated = sessionsMigrated;

        const memoriesMigrated = await this.migrateMemories();
        result.memoriesMigrated = memoriesMigrated;

        log.info("Migration completed", result);
        return result;
    }

    private async migrateAgents(): Promise<number> {
        const configPath = path.join(this.openclawHome, "openclaw.json");
        const config = await readJsonFile<{ agents?: { list?: AgentConfig[] } }>(configPath);

        if (!config?.agents?.list?.length) {
            log.info("No agents found to migrate");
            return 0;
        }

        let count = 0;
        for (const agent of config.agents.list) {
            try {
                const existing = await this.db.queryOne<{ id: string }>(
                    "SELECT id FROM agents WHERE user_id = $1 AND agent_id = $2",
                    [this.userId, agent.id]
                );

                if (existing) {
                    log.debug("Agent already exists, skipping", { agentId: agent.id });
                    continue;
                }

                if (!this.dryRun) {
                    const agentId = randomUUID();
                    await this.db.execute(
                        `INSERT INTO agents (id, user_id, agent_id, name, description, config, workspace, agent_dir, is_default, is_active, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW())`,
                        [
                            agentId,
                            this.userId,
                            agent.id,
                            agent.name ?? agent.id,
                            agent.description ?? null,
                            JSON.stringify(agent),
                            agent.workspace ?? null,
                            agent.agentDir ?? null,
                            agent.default ?? false,
                        ]
                    );
                }
                count++;
                log.info("Migrated agent", { agentId: agent.id });
            } catch (err) {
                log.error("Failed to migrate agent", { agentId: agent.id, error: err });
                result.errors.push(`Failed to migrate agent ${agent.id}: ${err}`);
            }
        }

        return count;
    }

    private async migrateSessions(): Promise<number> {
        const agentsDir = path.join(this.openclawHome, "agents");
        let count = 0;

        try {
            const agentDirs = await fs.promises.readdir(agentsDir, { withFileTypes: true });
            for (const agentDir of agentDirs) {
                if (!agentDir.isDirectory()) continue;

                const sessionsDir = path.join(agentDir.path, "sessions");
                const sessionsFile = path.join(sessionsDir, "sessions.json");
                const sessionsData = await readJsonFile<Record<string, SessionEntry>>(sessionsFile);

                if (!sessionsData) continue;

                const agentId = agentDir.name;
                const dbAgent = await this.db.queryOne<{ id: string }>(
                    "SELECT id FROM agents WHERE user_id = $1 AND agent_id = $2",
                    [this.userId, agentId]
                );

                for (const [sessionKey, session] of Object.entries(sessionsData)) {
                    try {
                        const existing = await this.db.queryOne<{ id: string }>(
                            "SELECT id FROM sessions WHERE user_id = $1 AND session_key = $2",
                            [this.userId, sessionKey]
                        );

                        if (existing) continue;

                        if (!this.dryRun) {
                            await this.db.execute(
                                `INSERT INTO sessions (
                                    id, user_id, agent_id, session_key, title, channel, last_channel,
                                    last_to, last_account_id, last_thread_id, chat_type, thinking_level,
                                    fast_mode, model, provider_override, input_tokens, output_tokens,
                                    total_tokens, created_at, updated_at
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
                                [
                                    randomUUID(),
                                    this.userId,
                                    dbAgent?.id ?? null,
                                    sessionKey,
                                    sessionKey,
                                    session.channel ?? null,
                                    session.lastChannel ?? null,
                                    session.lastTo ?? null,
                                    session.lastAccountId ?? null,
                                    session.lastThreadId ?? null,
                                    session.chatType ?? null,
                                    session.thinkingLevel ?? null,
                                    session.fastMode ?? null,
                                    session.model ?? null,
                                    session.providerOverride ?? null,
                                    session.inputTokens ?? 0,
                                    session.outputTokens ?? 0,
                                    session.totalTokens ?? 0,
                                    new Date(session.updatedAt),
                                    new Date(session.updatedAt),
                                ]
                            );
                        }
                        count++;
                    } catch (err) {
                        log.error("Failed to migrate session", { sessionKey, error: err });
                        result.errors.push(`Failed to migrate session ${sessionKey}: ${err}`);
                    }
                }
            }
        } catch (err) {
            log.error("Failed to read agents directory", { error: err });
        }

        return count;
    }

    private async migrateMemories(): Promise<number> {
        const memoryDir = path.join(this.openclawHome, "memory");
        let count = 0;

        try {
            const dbPaths = await findSqliteDatabases(memoryDir);

            for (const dbPath of dbPaths) {
                const agentId = path.basename(dbPath, ".sqlite");
                const dbAgent = await this.db.queryOne<{ id: string }>(
                    "SELECT id FROM agents WHERE user_id = $1 AND agent_id = $2",
                    [this.userId, agentId]
                );

                try {
                    const memories = await this.readMemoriesFromSqlite(dbPath);
                    for (const memory of memories) {
                        try {
                            const contentHash = this.hashContent(memory.content);
                            const existing = await this.db.queryOne<{ id: string }>(
                                "SELECT id FROM memories WHERE user_id = $1 AND content_hash = $2",
                                [this.userId, contentHash]
                            );

                            if (existing) continue;

                            if (!this.dryRun) {
                                await this.db.execute(
                                    `INSERT INTO memories (id, user_id, agent_id, content, content_hash, metadata, memory_type, created_at)
                                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                                    [
                                        randomUUID(),
                                        this.userId,
                                        dbAgent?.id ?? null,
                                        memory.content,
                                        contentHash,
                                        JSON.stringify(memory.metadata ?? {}),
                                        memory.type ?? "conversation",
                                    ]
                                );
                            }
                            count++;
                        } catch (err) {
                            log.error("Failed to migrate memory", { content: memory.content.slice(0, 50), error: err });
                        }
                    }
                } catch (err) {
                    log.error("Failed to read SQLite database", { dbPath, error: err });
                    result.errors.push(`Failed to read memory database ${dbPath}: ${err}`);
                }
            }
        } catch (err) {
            log.error("Failed to read memory directory", { error: err });
        }

        return count;
    }

    private async readMemoriesFromSqlite(dbPath: string): Promise<Array<{ content: string; metadata?: Record<string, unknown>; type?: string }>> {
        const memories: Array<{ content: string; metadata?: Record<string, unknown>; type?: string }> = [];

        try {
            const sqlite3 = await import("sqlite3");
            const db = new sqlite3.Database(dbPath);

            await new Promise<void>((resolve, reject) => {
                db.all("SELECT content, metadata, type FROM memories", [], (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    for (const row of rows as Array<{ content: string; metadata: string; type: string }>) {
                        memories.push({
                            content: row.content,
                            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
                            type: row.type,
                        });
                    }
                    db.close();
                    resolve();
                });
            });
        } catch {
            // Try reading as plain text lines (simple format)
            try {
                const content = await fs.promises.readFile(dbPath, "utf-8");
                const lines = content.split("\n").filter((l) => l.trim());
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.content) {
                            memories.push({
                                content: data.content,
                                metadata: data.metadata,
                                type: data.type,
                            });
                        }
                    } catch {
                        // Skip invalid lines
                    }
                }
            } catch {
                // File doesn't exist or can't be read
            }
        }

        return memories;
    }

    private hashContent(content: string): string {
        const crypto = require("node:crypto");
        return crypto.createHash("sha256").update(content).digest("hex");
    }
}

let migrationService: MigrationService | null = null;

export async function initMigrationService(
    db: DbClient,
    options?: MigrationOptions
): Promise<MigrationService> {
    migrationService = new MigrationService(db, options);
    return migrationService;
}

export function getMigrationService(): MigrationService {
    if (!migrationService) {
        throw new Error("Migration service not initialized. Call initMigrationService() first.");
    }
    return migrationService;
}