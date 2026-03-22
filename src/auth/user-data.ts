import { randomUUID } from "node:crypto";
import { getDbClient, type DbClient } from "../../db/client.js";
import { createLogger } from "../logging.js";

const log = createLogger("auth/user-data");

export interface UserAgent {
    id: string;
    userId: string;
    agentId: string;
    name: string | null;
    configPath: string | null;
    isDefault: boolean;
    isActive: boolean;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserSession {
    id: string;
    userId: string;
    sessionKey: string;
    sessionPath: string | null;
    title: string | null;
    channel: string | null;
    lastChannel: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserCron {
    id: string;
    userId: string;
    cronId: string;
    name: string | null;
    description: string | null;
    jobPath: string | null;
    schedule: Record<string, unknown> | null;
    enabled: boolean;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export class UserDataService {
    private db: DbClient;

    constructor(db: DbClient) {
        this.db = db;
    }

    async setCurrentUserContext(userId: string): Promise<void> {
        await this.db.execute(
            "SELECT set_config('app.current_user_id', $1, true)",
            [userId]
        );
    }

    async upsertUserAgent(
        userId: string,
        agentId: string,
        name?: string,
        configPath?: string,
        isDefault = false,
    ): Promise<void> {
        const id = randomUUID();
        await this.db.execute(
            `INSERT INTO user_agents (id, user_id, agent_id, name, config_path, is_default, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             ON CONFLICT (user_id, agent_id) WHERE is_deleted = false DO NOTHING`,
            [id, userId, agentId, name ?? null, configPath ?? null, isDefault],
        );
    }

    async clearCurrentUserContext(): Promise<void> {
        await this.db.execute(
            "SELECT set_config('app.current_user_id', NULL, true)"
        );
    }

    // ==================== User Agents ====================

    async createUserAgent(
        userId: string,
        agentId: string,
        name?: string,
        configPath?: string,
        isDefault = false
    ): Promise<UserAgent> {
        const id = randomUUID();
        const now = new Date();

        await this.db.execute(
            `INSERT INTO user_agents (id, user_id, agent_id, name, config_path, is_default, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, userId, agentId, name ?? null, configPath ?? null, isDefault, now, now]
        );

        return {
            id,
            userId,
            agentId,
            name: name ?? null,
            configPath: configPath ?? null,
            isDefault,
            isActive: true,
            isDeleted: false,
            createdAt: now,
            updatedAt: now,
        };
    }

    async listUserAgents(userId: string): Promise<UserAgent[]> {
        const rows = await this.db.query<{
            id: string;
            user_id: string;
            agent_id: string;
            name: string | null;
            config_path: string | null;
            is_default: boolean;
            is_active: boolean;
            is_deleted: boolean;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT id, user_id, agent_id, name, config_path, is_default, is_active, is_deleted, created_at, updated_at
             FROM user_agents 
             WHERE user_id = $1 AND is_deleted = false
             ORDER BY is_default DESC, created_at DESC`,
            [userId]
        );

        return rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            agentId: r.agent_id,
            name: r.name,
            configPath: r.config_path,
            isDefault: r.is_default,
            isActive: r.is_active,
            isDeleted: r.is_deleted,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }));
    }

    async getUserAgent(userId: string, agentId: string): Promise<UserAgent | null> {
        const r = await this.db.queryOne<{
            id: string;
            user_id: string;
            agent_id: string;
            name: string | null;
            config_path: string | null;
            is_default: boolean;
            is_active: boolean;
            is_deleted: boolean;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT id, user_id, agent_id, name, config_path, is_default, is_active, is_deleted, created_at, updated_at
             FROM user_agents 
             WHERE user_id = $1 AND agent_id = $2 AND is_deleted = false`,
            [userId, agentId]
        );

        if (!r) return null;

        return {
            id: r.id,
            userId: r.user_id,
            agentId: r.agent_id,
            name: r.name,
            configPath: r.config_path,
            isDefault: r.is_default,
            isActive: r.is_active,
            isDeleted: r.is_deleted,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }

    async updateUserAgent(
        userId: string,
        agentId: string,
        updates: { name?: string; isDefault?: boolean; isActive?: boolean }
    ): Promise<UserAgent | null> {
        const setClauses: string[] = ["updated_at = NOW()"];
        const params: unknown[] = [userId, agentId];
        let paramIndex = 3;

        if (updates.name !== undefined) {
            setClauses.push(`name = $${paramIndex++}`);
            params.push(updates.name);
        }
        if (updates.isDefault !== undefined) {
            setClauses.push(`is_default = $${paramIndex++}`);
            params.push(updates.isDefault);
        }
        if (updates.isActive !== undefined) {
            setClauses.push(`is_active = $${paramIndex++}`);
            params.push(updates.isActive);
        }

        await this.db.execute(
            `UPDATE user_agents SET ${setClauses.join(", ")} WHERE user_id = $1 AND agent_id = $2`,
            params
        );

        return this.getUserAgent(userId, agentId);
    }

    async deleteUserAgent(userId: string, agentId: string): Promise<boolean> {
        const result = await this.db.execute(
            `UPDATE user_agents SET is_deleted = true, updated_at = NOW() WHERE user_id = $1 AND agent_id = $2`,
            [userId, agentId]
        );
        return result > 0;
    }

    // ==================== User Sessions ====================

    async createUserSession(
        userId: string,
        sessionKey: string,
        sessionPath?: string,
        title?: string,
        channel?: string
    ): Promise<UserSession> {
        const id = randomUUID();
        const now = new Date();

        await this.db.execute(
            `INSERT INTO user_sessions (id, user_id, session_key, session_path, title, channel, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, userId, sessionKey, sessionPath ?? null, title ?? null, channel ?? null, now, now]
        );

        return {
            id,
            userId,
            sessionKey,
            sessionPath: sessionPath ?? null,
            title: title ?? null,
            channel: channel ?? null,
            lastChannel: null,
            metadata: {},
            createdAt: now,
            updatedAt: now,
        };
    }

    async listUserSessions(userId: string, limit = 50, offset = 0): Promise<UserSession[]> {
        const rows = await this.db.query<{
            id: string;
            user_id: string;
            session_key: string;
            session_path: string | null;
            title: string | null;
            channel: string | null;
            last_channel: string | null;
            metadata: Record<string, unknown>;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT id, user_id, session_key, session_path, title, channel, last_channel, metadata, created_at, updated_at
             FROM user_sessions 
             WHERE user_id = $1
             ORDER BY updated_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );

        return rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            sessionKey: r.session_key,
            sessionPath: r.session_path,
            title: r.title,
            channel: r.channel,
            lastChannel: r.last_channel,
            metadata: r.metadata,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }));
    }

    async getUserSession(userId: string, sessionKey: string): Promise<UserSession | null> {
        const r = await this.db.queryOne<{
            id: string;
            user_id: string;
            session_key: string;
            session_path: string | null;
            title: string | null;
            channel: string | null;
            last_channel: string | null;
            metadata: Record<string, unknown>;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT id, user_id, session_key, session_path, title, channel, last_channel, metadata, created_at, updated_at
             FROM user_sessions 
             WHERE user_id = $1 AND session_key = $2`,
            [userId, sessionKey]
        );

        if (!r) return null;

        return {
            id: r.id,
            userId: r.user_id,
            sessionKey: r.session_key,
            sessionPath: r.session_path,
            title: r.title,
            channel: r.channel,
            lastChannel: r.last_channel,
            metadata: r.metadata,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }

    async updateUserSession(
        userId: string,
        sessionKey: string,
        updates: { title?: string; channel?: string; lastChannel?: string; metadata?: Record<string, unknown> }
    ): Promise<UserSession | null> {
        const setClauses: string[] = ["updated_at = NOW()"];
        const params: unknown[] = [userId, sessionKey];
        let paramIndex = 3;

        if (updates.title !== undefined) {
            setClauses.push(`title = $${paramIndex++}`);
            params.push(updates.title);
        }
        if (updates.channel !== undefined) {
            setClauses.push(`channel = $${paramIndex++}`);
            params.push(updates.channel);
        }
        if (updates.lastChannel !== undefined) {
            setClauses.push(`last_channel = $${paramIndex++}`);
            params.push(updates.lastChannel);
        }
        if (updates.metadata !== undefined) {
            setClauses.push(`metadata = $${paramIndex++}`);
            params.push(JSON.stringify(updates.metadata));
        }

        await this.db.execute(
            `UPDATE user_sessions SET ${setClauses.join(", ")} WHERE user_id = $1 AND session_key = $2`,
            params
        );

        return this.getUserSession(userId, sessionKey);
    }

    async deleteUserSession(userId: string, sessionKey: string): Promise<boolean> {
        const result = await this.db.execute(
            `DELETE FROM user_sessions WHERE user_id = $1 AND session_key = $2`,
            [userId, sessionKey]
        );
        return result > 0;
    }

    // ==================== User Cron Jobs ====================

    async createUserCron(
        userId: string,
        cronId: string,
        name?: string,
        description?: string,
        jobPath?: string,
        schedule?: Record<string, unknown>
    ): Promise<UserCron> {
        const id = randomUUID();
        const now = new Date();

        await this.db.execute(
            `INSERT INTO user_crons (id, user_id, cron_id, name, description, job_path, schedule, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, userId, cronId, name ?? null, description ?? null, jobPath ?? null, schedule ? JSON.stringify(schedule) : null, now, now]
        );

        return {
            id,
            userId,
            cronId,
            name: name ?? null,
            description: description ?? null,
            jobPath: jobPath ?? null,
            schedule: schedule ?? null,
            enabled: true,
            metadata: {},
            createdAt: now,
            updatedAt: now,
        };
    }

    async listUserCrons(userId: string): Promise<UserCron[]> {
        const rows = await this.db.query<{
            id: string;
            user_id: string;
            cron_id: string;
            name: string | null;
            description: string | null;
            job_path: string | null;
            schedule: Record<string, unknown> | null;
            enabled: boolean;
            metadata: Record<string, unknown>;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT id, user_id, cron_id, name, description, job_path, schedule, enabled, metadata, created_at, updated_at
             FROM user_crons 
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );

        return rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            cronId: r.cron_id,
            name: r.name,
            description: r.description,
            jobPath: r.job_path,
            schedule: r.schedule,
            enabled: r.enabled,
            metadata: r.metadata,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }));
    }

    async getUserCron(userId: string, cronId: string): Promise<UserCron | null> {
        const r = await this.db.queryOne<{
            id: string;
            user_id: string;
            cron_id: string;
            name: string | null;
            description: string | null;
            job_path: string | null;
            schedule: Record<string, unknown> | null;
            enabled: boolean;
            metadata: Record<string, unknown>;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT id, user_id, cron_id, name, description, job_path, schedule, enabled, metadata, created_at, updated_at
             FROM user_crons 
             WHERE user_id = $1 AND cron_id = $2`,
            [userId, cronId]
        );

        if (!r) return null;

        return {
            id: r.id,
            userId: r.user_id,
            cronId: r.cron_id,
            name: r.name,
            description: r.description,
            jobPath: r.job_path,
            schedule: r.schedule,
            enabled: r.enabled,
            metadata: r.metadata,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }

    async updateUserCron(
        userId: string,
        cronId: string,
        updates: { name?: string; description?: string; enabled?: boolean; schedule?: Record<string, unknown> }
    ): Promise<UserCron | null> {
        const setClauses: string[] = ["updated_at = NOW()"];
        const params: unknown[] = [userId, cronId];
        let paramIndex = 3;

        if (updates.name !== undefined) {
            setClauses.push(`name = $${paramIndex++}`);
            params.push(updates.name);
        }
        if (updates.description !== undefined) {
            setClauses.push(`description = $${paramIndex++}`);
            params.push(updates.description);
        }
        if (updates.enabled !== undefined) {
            setClauses.push(`enabled = $${paramIndex++}`);
            params.push(updates.enabled);
        }
        if (updates.schedule !== undefined) {
            setClauses.push(`schedule = $${paramIndex++}`);
            params.push(JSON.stringify(updates.schedule));
        }

        await this.db.execute(
            `UPDATE user_crons SET ${setClauses.join(", ")} WHERE user_id = $1 AND cron_id = $2`,
            params
        );

        return this.getUserCron(userId, cronId);
    }

    async deleteUserCron(userId: string, cronId: string): Promise<boolean> {
        const result = await this.db.execute(
            `DELETE FROM user_crons WHERE user_id = $1 AND cron_id = $2`,
            [userId, cronId]
        );
        return result > 0;
    }

    // ==================== User Channels ====================

    async createUserChannel(
        userId: string,
        channelType: string,
        accountId: string,
        config: {
            appId?: string;
            appSecretHash?: string;
            accessToken?: string;
            refreshToken?: string;
            tokenExpiresAt?: Date;
            webhookUrl?: string;
            webhookSecretHash?: string;
            botUserId?: string;
            botId?: string;
            metadata?: Record<string, unknown>;
        }
    ): Promise<void> {
        const id = randomUUID();
        const now = new Date();

        await this.db.execute(
            `INSERT INTO user_channels (id, user_id, channel_type, account_id, app_id, app_secret_hash, access_token, refresh_token, token_expires_at, webhook_url, webhook_secret_hash, bot_user_id, bot_id, metadata, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
                id, userId, channelType, accountId,
                config.appId ?? null,
                config.appSecretHash ?? null,
                config.accessToken ?? null,
                config.refreshToken ?? null,
                config.tokenExpiresAt ?? null,
                config.webhookUrl ?? null,
                config.webhookSecretHash ?? null,
                config.botUserId ?? null,
                config.botId ?? null,
                JSON.stringify(config.metadata ?? {}),
                now, now
            ]
        );
    }

    async listUserChannels(userId: string): Promise<Array<{
        id: string;
        userId: string;
        channelType: string;
        accountId: string | null;
        appId: string | null;
        isActive: boolean;
        isVerified: boolean;
        metadata: Record<string, unknown>;
        lastConnectedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>> {
        const rows = await this.db.query(
            `SELECT id, user_id, channel_type, account_id, app_id, is_active, is_verified, metadata, last_connected_at, created_at, updated_at
             FROM user_channels 
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );

        return rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            channelType: r.channel_type,
            accountId: r.account_id,
            appId: r.app_id,
            isActive: r.is_active,
            isVerified: r.is_verified,
            metadata: r.metadata,
            lastConnectedAt: r.last_connected_at,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }));
    }

    async getUserChannel(userId: string, channelType: string): Promise<{
        id: string;
        userId: string;
        channelType: string;
        accountId: string | null;
        appId: string | null;
        accessToken: string | null;
        refreshToken: string | null;
        tokenExpiresAt: Date | null;
        webhookUrl: string | null;
        botUserId: string | null;
        botId: string | null;
        isActive: boolean;
        isVerified: boolean;
        metadata: Record<string, unknown>;
        lastConnectedAt: Date | null;
    } | null> {
        const r = await this.db.queryOne(
            `SELECT id, user_id, channel_type, account_id, app_id, access_token, refresh_token, token_expires_at, webhook_url, bot_user_id, bot_id, is_active, is_verified, metadata, last_connected_at
             FROM user_channels 
             WHERE user_id = $1 AND channel_type = $2 AND is_active = true`,
            [userId, channelType]
        );

        if (!r) return null;

        return {
            id: r.id,
            userId: r.user_id,
            channelType: r.channel_type,
            accountId: r.account_id,
            appId: r.app_id,
            accessToken: r.access_token,
            refreshToken: r.refresh_token,
            tokenExpiresAt: r.token_expires_at,
            webhookUrl: r.webhook_url,
            botUserId: r.bot_user_id,
            botId: r.bot_id,
            isActive: r.is_active,
            isVerified: r.is_verified,
            metadata: r.metadata,
            lastConnectedAt: r.last_connected_at,
        };
    }

    async updateUserChannel(
        userId: string,
        channelType: string,
        updates: {
            accessToken?: string;
            refreshToken?: string;
            tokenExpiresAt?: Date;
            isVerified?: boolean;
            lastConnectedAt?: Date;
        }
    ): Promise<void> {
        const setClauses: string[] = ["updated_at = NOW()"];
        const params: unknown[] = [userId, channelType];
        let paramIndex = 3;

        if (updates.accessToken !== undefined) {
            setClauses.push(`access_token = $${paramIndex++}`);
            params.push(updates.accessToken);
        }
        if (updates.refreshToken !== undefined) {
            setClauses.push(`refresh_token = $${paramIndex++}`);
            params.push(updates.refreshToken);
        }
        if (updates.tokenExpiresAt !== undefined) {
            setClauses.push(`token_expires_at = $${paramIndex++}`);
            params.push(updates.tokenExpiresAt);
        }
        if (updates.isVerified !== undefined) {
            setClauses.push(`is_verified = $${paramIndex++}`);
            params.push(updates.isVerified);
        }
        if (updates.lastConnectedAt !== undefined) {
            setClauses.push(`last_connected_at = $${paramIndex++}`);
            params.push(updates.lastConnectedAt);
        }

        await this.db.execute(
            `UPDATE user_channels SET ${setClauses.join(", ")} WHERE user_id = $1 AND channel_type = $2`,
            params
        );
    }

    async deleteUserChannel(userId: string, channelType: string): Promise<boolean> {
        const result = await this.db.execute(
            `DELETE FROM user_channels WHERE user_id = $1 AND channel_type = $2`,
            [userId, channelType]
        );
        return result > 0;
    }

    // ==================== User Skills ====================

    async createUserSkill(
        userId: string,
        skillKey: string,
        skillName: string,
        skillSource: string,
        config: {
            skillUrl?: string;
            skillPath?: string;
            enabled?: boolean;
            apiKey?: string;
            env?: Record<string, string>;
            config?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
        }
    ): Promise<void> {
        const id = randomUUID();
        const now = new Date();

        await this.db.execute(
            `INSERT INTO user_skills (id, user_id, skill_key, skill_name, skill_source, skill_url, skill_path, enabled, api_key, env, config, metadata, installed_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
                id, userId, skillKey, skillName, skillSource,
                config.skillUrl ?? null,
                config.skillPath ?? null,
                config.enabled ?? true,
                config.apiKey ?? null,
                JSON.stringify(config.env ?? {}),
                JSON.stringify(config.config ?? {}),
                JSON.stringify(config.metadata ?? {}),
                now, now
            ]
        );
    }

    async listUserSkills(userId: string): Promise<Array<{
        id: string;
        userId: string;
        skillKey: string;
        skillName: string | null;
        skillSource: string;
        skillUrl: string | null;
        skillPath: string | null;
        enabled: boolean;
        env: Record<string, unknown>;
        config: Record<string, unknown>;
        metadata: Record<string, unknown>;
        installedAt: Date;
        updatedAt: Date;
    }>> {
        const rows = await this.db.query(
            `SELECT id, user_id, skill_key, skill_name, skill_source, skill_url, skill_path, enabled, env, config, metadata, installed_at, updated_at
             FROM user_skills 
             WHERE user_id = $1
             ORDER BY installed_at DESC`,
            [userId]
        );

        return rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            skillKey: r.skill_key,
            skillName: r.skill_name,
            skillSource: r.skill_source,
            skillUrl: r.skill_url,
            skillPath: r.skill_path,
            enabled: r.enabled,
            env: r.env,
            config: r.config,
            metadata: r.metadata,
            installedAt: r.installed_at,
            updatedAt: r.updated_at,
        }));
    }

    async getUserSkill(userId: string, skillKey: string): Promise<{
        id: string;
        userId: string;
        skillKey: string;
        skillName: string | null;
        skillSource: string;
        skillUrl: string | null;
        skillPath: string | null;
        enabled: boolean;
        apiKey: string | null;
        env: Record<string, unknown>;
        config: Record<string, unknown>;
    } | null> {
        const r = await this.db.queryOne(
            `SELECT id, user_id, skill_key, skill_name, skill_source, skill_url, skill_path, enabled, api_key, env, config
             FROM user_skills 
             WHERE user_id = $1 AND skill_key = $2`,
            [userId, skillKey]
        );

        if (!r) return null;

        return {
            id: r.id,
            userId: r.user_id,
            skillKey: r.skill_key,
            skillName: r.skill_name,
            skillSource: r.skill_source,
            skillUrl: r.skill_url,
            skillPath: r.skill_path,
            enabled: r.enabled,
            apiKey: r.api_key,
            env: r.env,
            config: r.config,
        };
    }

    async updateUserSkill(
        userId: string,
        skillKey: string,
        updates: {
            enabled?: boolean;
            apiKey?: string;
            env?: Record<string, string>;
            config?: Record<string, unknown>;
        }
    ): Promise<void> {
        const setClauses: string[] = ["updated_at = NOW()"];
        const params: unknown[] = [userId, skillKey];
        let paramIndex = 3;

        if (updates.enabled !== undefined) {
            setClauses.push(`enabled = $${paramIndex++}`);
            params.push(updates.enabled);
        }
        if (updates.apiKey !== undefined) {
            setClauses.push(`api_key = $${paramIndex++}`);
            params.push(updates.apiKey);
        }
        if (updates.env !== undefined) {
            setClauses.push(`env = $${paramIndex++}`);
            params.push(JSON.stringify(updates.env));
        }
        if (updates.config !== undefined) {
            setClauses.push(`config = $${paramIndex++}`);
            params.push(JSON.stringify(updates.config));
        }

        await this.db.execute(
            `UPDATE user_skills SET ${setClauses.join(", ")} WHERE user_id = $1 AND skill_key = $2`,
            params
        );
    }

    async deleteUserSkill(userId: string, skillKey: string): Promise<boolean> {
        const result = await this.db.execute(
            `DELETE FROM user_skills WHERE user_id = $1 AND skill_key = $2`,
            [userId, skillKey]
        );
        return result > 0;
    }
}

let userDataService: UserDataService | null = null;

export function initUserDataService(db: DbClient): UserDataService {
    userDataService = new UserDataService(db);
    return userDataService;
}

export function getUserDataService(): UserDataService {
    if (!userDataService) {
        throw new Error("UserDataService not initialized. Call initUserDataService() first.");
    }
    return userDataService;
}
