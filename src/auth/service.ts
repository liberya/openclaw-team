import { randomBytes, createHash, createCipheriv, createDecipheriv, randomUUID } from "node:crypto";
import { getDbClient, type DbClient } from "../../db/client.js";
import { createLogger } from "../logging.js";

const log = createLogger("auth/service");

const ACCESS_TOKEN_EXPIRY = 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_HASH_ITERATIONS = 100000;
const PASSWORD_HASH_KEYLEN = 64;
const PASSWORD_HASH_DIGEST = "sha512";
const JWT_ALGORITHM = "HS256";
const ENCRYPTION_KEY_LENGTH = 32;
const ENCRYPTION_IV_LENGTH = 16;
const ENCRYPTION_TAG_LENGTH = 16;

export interface User {
    id: string;
    email: string;
    passwordHash: string;
    name: string | null;
    role: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    lastLoginAt: Date | null;
}

export interface ApiKey {
    id: string;
    userId: string;
    keyHash: string;
    keyPrefix: string;
    name: string | null;
    scope: string[];
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    isActive: boolean;
    createdAt: Date;
}

export interface RefreshToken {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: Date;
}

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

export interface TokenPayload {
    sub: string;
    email: string;
    role: string;
    iat: number;
    exp: number;
}

function deriveKey(password: string, salt: Buffer): Buffer {
    return require("node:crypto").pbkdf2Sync(
        password,
        salt,
        PASSWORD_HASH_ITERATIONS,
        PASSWORD_HASH_KEYLEN,
        PASSWORD_HASH_DIGEST
    );
}

export function hashPassword(password: string): string {
    const salt = randomBytes(32);
    const key = deriveKey(password, salt);
    return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export function verifyPassword(password: string, hash: string | undefined): boolean {
    if (!hash) {
        return false;
    }
    const [saltHex, keyHex] = hash.split(":");
    if (!saltHex || !keyHex) {
        return false;
    }
    const salt = Buffer.from(saltHex, "hex");
    const storedKey = Buffer.from(keyHex, "hex");
    const derivedKey = deriveKey(password, salt);
    return storedKey.equals(derivedKey);
}

export function generateAccessToken(user: User): string {
    const now = Date.now();
    const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        iat: Math.floor(now / 1000),
        exp: Math.floor((now + ACCESS_TOKEN_EXPIRY) / 1000),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function generateRefreshToken(): string {
    return randomBytes(64).toString("hex");
}

export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function verifyAccessToken(token: string, secret: string): TokenPayload | null {
    try {
        const payload = JSON.parse(Buffer.from(token, "base64url").toString());
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp < now) {
            return null;
        }
        return payload as TokenPayload;
    } catch {
        return null;
    }
}

export function encryptValue(value: string, key: string): { encrypted: string; nonce: string } {
    const iv = randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key.slice(0, ENCRYPTION_KEY_LENGTH), "utf8"), iv);
    let encrypted = cipher.update(value, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    return {
        encrypted: encrypted + tag.toString("hex"),
        nonce: iv.toString("hex"),
    };
}

export function decryptValue(encryptedData: string, nonce: string, key: string): string {
    const iv = Buffer.from(nonce, "hex");
    const encrypted = encryptedData.slice(0, -ENCRYPTION_TAG_LENGTH * 2);
    const tag = Buffer.from(encryptedData.slice(-ENCRYPTION_TAG_LENGTH * 2), "hex");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key.slice(0, ENCRYPTION_KEY_LENGTH), "utf8"), iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

export function getEncryptionKey(): string {
    const key = process.env.OPENCLAW_ENCRYPTION_KEY;
    if (!key) {
        const generated = randomBytes(32).toString("hex");
        log.warn("No encryption key configured, using generated key (will change on restart)");
        return generated;
    }
    return key;
}

export class AuthService {
    private db: DbClient;
    private jwtSecret: string;

    constructor(db: DbClient, jwtSecret: string) {
        this.db = db;
        this.jwtSecret = jwtSecret;
    }

    async setCurrentUserContext(userId: string): Promise<void> {
        await this.db.execute(
            "SELECT set_config('app.current_user_id', $1, true)",
            [userId]
        );
    }

    async clearCurrentUserContext(): Promise<void> {
        await this.db.execute(
            "SELECT set_config('app.current_user_id', NULL, true)"
        );
    }

    async createUser(email: string, password: string, name?: string): Promise<User> {
        const existing = await this.db.queryOne<{ id: string }>(
            "SELECT id FROM users WHERE email = $1",
            [email.toLowerCase()]
        );
        if (existing) {
            throw new Error("User already exists");
        }

        const passwordHash = hashPassword(password);
        const id = randomUUID();
        const now = new Date();

        await this.db.execute(
            `INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'user', 'active', $5, $6)`,
            [id, email.toLowerCase(), passwordHash, name ?? null, now, now]
        );

        log.info("User created", { userId: id, email: email.toLowerCase() });

        return {
            id,
            email: email.toLowerCase(),
            passwordHash,
            name: name ?? null,
            role: "user",
            status: "active",
            createdAt: now,
            updatedAt: now,
            lastLoginAt: null,
        };
    }

    async authenticateUser(
        email: string,
        password: string,
        userAgent?: string,
        ipAddress?: string
    ): Promise<{ user: User; tokens: AuthTokens }> {
        const users = await this.db.query<any>(
            `SELECT id, email, password_hash, name, role, status, created_at, updated_at, last_login_at
             FROM users WHERE email = $1 AND status = 'active'`,
            [email.toLowerCase()]
        );

        if (users.length === 0) {
            throw new Error("Invalid credentials");
        }

        const row = users[0];
        const user: User = {
            id: row.id,
            email: row.email,
            passwordHash: row.password_hash,
            name: row.name,
            role: row.role,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastLoginAt: row.last_login_at,
        };

        if (!verifyPassword(password, user.passwordHash)) {
            await this.logLoginAttempt(user.id, "password", false, "Invalid password", userAgent, ipAddress);
            throw new Error("Invalid credentials");
        }

        const tokens = await this.createAuthSession(user.id, userAgent, ipAddress);
        await this.logLoginAttempt(user.id, "password", true, undefined, userAgent, ipAddress);

        await this.db.execute(
            "UPDATE users SET last_login_at = $1 WHERE id = $2",
            [new Date(), user.id]
        );

        return {
            user: {
                ...user,
                passwordHash: "",
            },
            tokens,
        };
    }

    async createAuthSession(userId: string, userAgent?: string, ipAddress?: string): Promise<AuthTokens> {
        const user = await this.db.queryOne<User>("SELECT id, email, role FROM users WHERE id = $1", [userId]);
        if (!user) {
            throw new Error("User not found");
        }

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken();
        const refreshTokenHash = hashToken(refreshToken);
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY);

        await this.db.execute(
            `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip_address, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), userId, refreshTokenHash, expiresAt, userAgent ?? null, ipAddress ?? null, new Date()]
        );

        return {
            accessToken,
            refreshToken,
            expiresIn: Math.floor(ACCESS_TOKEN_EXPIRY / 1000),
        };
    }

    async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
        const tokenHash = hashToken(refreshToken);
        const now = new Date();

        const tokens = await this.db.query<RefreshToken>(
            `SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens 
             WHERE token_hash = $1 AND expires_at > $2 AND revoked_at IS NULL`,
            [tokenHash, now]
        );

        if (tokens.length === 0) {
            throw new Error("Invalid or expired refresh token");
        }

        const tokenRecord = tokens[0];
        const user = await this.db.queryOne<User>(
            "SELECT id, email, role, status FROM users WHERE id = $1 AND status = 'active'",
            [tokenRecord.user_id]
        );

        if (!user) {
            throw new Error("User not found or inactive");
        }

        await this.db.execute("UPDATE refresh_tokens SET revoked_at = $1 WHERE id = $2", [now, tokenRecord.id]);

        return this.createAuthSession(user.id);
    }

    async revokeRefreshToken(refreshToken: string): Promise<void> {
        const tokenHash = hashToken(refreshToken);
        await this.db.execute(
            "UPDATE refresh_tokens SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL",
            [new Date(), tokenHash]
        );
    }

    async revokeAllUserSessions(userId: string): Promise<void> {
        await this.db.execute("UPDATE refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL", [
            new Date(),
            userId,
        ]);
    }

    async createApiKey(userId: string, name: string, scope: string[], expiresAt?: Date): Promise<ApiKey> {
        const apiKey = `sk_${randomBytes(24).toString("hex")}`;
        const keyHash = hashToken(apiKey);
        const keyPrefix = apiKey.slice(0, 12);
        const id = randomUUID();
        const now = new Date();

        await this.db.execute(
            `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, scope, expires_at, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
            [id, userId, keyHash, keyPrefix, name, JSON.stringify(scope), expiresAt ?? null, now, now]
        );

        return {
            id,
            userId,
            keyHash,
            keyPrefix,
            name,
            scope,
            expiresAt: expiresAt ?? null,
            lastUsedAt: null,
            isActive: true,
            createdAt: now,
        };
    }

    async verifyApiKey(apiKey: string): Promise<User | null> {
        const keyHash = hashToken(apiKey);
        const now = new Date();

        const keys = await this.db.query<ApiKey & { email: string; role: string; status: string }>(
            `SELECT k.id, k.user_id, k.key_hash, k.expires_at, k.is_active, k.last_used_at, k.created_at,
                    u.email, u.role, u.status
             FROM api_keys k
             JOIN users u ON k.user_id = u.id
             WHERE k.key_hash = $1 AND k.is_active = true AND (k.expires_at IS NULL OR k.expires_at > $2)`,
            [keyHash, now]
        );

        if (keys.length === 0) {
            return null;
        }

        await this.db.execute("UPDATE api_keys SET last_used_at = $1 WHERE id = $2", [now, keys[0].id]);

        return {
            id: keys[0].user_id,
            email: keys[0].email,
            passwordHash: "",
            name: null,
            role: keys[0].role,
            status: keys[0].status,
            createdAt: keys[0].created_at,
            updatedAt: now,
            lastLoginAt: null,
        };
    }

    async deleteApiKey(userId: string, keyId: string): Promise<void> {
        await this.db.execute("UPDATE api_keys SET is_active = false WHERE id = $1 AND user_id = $2", [keyId, userId]);
    }

    async getUser(userId: string): Promise<User | null> {
        const users = await this.db.query<User>(
            "SELECT id, email, name, role, status, created_at, updated_at, last_login_at FROM users WHERE id = $1",
            [userId]
        );
        if (users.length === 0) {
            return null;
        }
        return {
            ...users[0],
            passwordHash: "",
        };
    }

    async listUsers(limit = 50, offset = 0): Promise<{ users: User[]; total: number }> {
        const users = await this.db.query<User>(
            "SELECT id, email, name, role, status, created_at, updated_at, last_login_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2",
            [limit, offset]
        );
        const countResult = await this.db.queryOne<{ count: string }>("SELECT COUNT(*) as count FROM users");
        return {
            users: users.map((u) => ({ ...u, passwordHash: "" })),
            total: parseInt(countResult?.count ?? "0", 10),
        };
    }

    async updateUser(adminUserId: string, targetUserId: string, updates: { name?: string; status?: string; role?: string }): Promise<User> {
        const admin = await this.getUser(adminUserId);
        if (!admin || admin.role !== "admin") {
            throw new Error("Permission denied: admin access required");
        }

        if (targetUserId === adminUserId) {
            throw new Error("Cannot modify own admin account");
        }

        const setClauses: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (updates.name !== undefined) {
            setClauses.push(`name = $${paramIndex++}`);
            params.push(updates.name);
        }
        if (updates.status !== undefined) {
            setClauses.push(`status = $${paramIndex++}`);
            params.push(updates.status);
        }
        if (updates.role !== undefined) {
            if (updates.role !== "user" && updates.role !== "admin") {
                throw new Error("Invalid role");
            }
            setClauses.push(`role = $${paramIndex++}`);
            params.push(updates.role);
        }

        if (setClauses.length === 0) {
            throw new Error("No updates provided");
        }

        params.push(targetUserId);
        await this.db.execute(
            `UPDATE users SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${paramIndex}`,
            params
        );

        const user = await this.getUser(targetUserId);
        if (!user) {
            throw new Error("User not found");
        }
        return user;
    }

    async resetUserPassword(adminUserId: string, targetUserId: string, newPassword: string): Promise<void> {
        const admin = await this.getUser(adminUserId);
        if (!admin || admin.role !== "admin") {
            throw new Error("Permission denied: admin access required");
        }

        if (targetUserId === adminUserId) {
            throw new Error("Cannot reset own password through this method");
        }

        const passwordHash = hashPassword(newPassword);
        await this.db.execute("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [
            passwordHash,
            targetUserId,
        ]);

        await this.db.execute(
            "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
            [targetUserId]
        );

        log.info("Admin reset user password", { adminUserId, targetUserId });
    }

    async deleteUser(adminUserId: string, targetUserId: string): Promise<void> {
        const admin = await this.getUser(adminUserId);
        if (!admin || admin.role !== "admin") {
            throw new Error("Permission denied: admin access required");
        }

        if (targetUserId === adminUserId) {
            throw new Error("Cannot delete own account");
        }

        await this.db.execute("UPDATE users SET status = 'inactive', updated_at = NOW() WHERE id = $1", [targetUserId]);
        await this.db.execute(
            "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
            [targetUserId]
        );
        await this.db.execute("UPDATE api_keys SET is_active = false WHERE user_id = $1", [targetUserId]);

        log.info("Admin deleted user", { adminUserId, targetUserId });
    }

    async initializeDefaultAdmin(email: string, password: string): Promise<User> {
        const existing = await this.db.queryOne<{ id: string }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");

        if (existing) {
            const user = await this.getUser(existing.id);
            if (user) {
                log.info("Admin user already exists");
                return user;
            }
        }

        const passwordHash = hashPassword(password);
        const id = randomUUID();
        const now = new Date();

        await this.db.execute(
            `INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'admin', 'active', $5, $6)`,
            [id, email.toLowerCase(), passwordHash, "Administrator", now, now]
        );

        log.info("Default admin user created", { email: email.toLowerCase() });

        return {
            id,
            email: email.toLowerCase(),
            passwordHash,
            name: "Administrator",
            role: "admin",
            status: "active",
            createdAt: now,
            updatedAt: now,
            lastLoginAt: null,
        };
    }

    private async logLoginAttempt(
        userId: string,
        method: string,
        success: boolean,
        failureReason?: string,
        userAgent?: string,
        ipAddress?: string
    ): Promise<void> {
        await this.db.execute(
            `INSERT INTO login_logs (id, user_id, login_method, success, failure_reason, user_agent, ip_address, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                randomUUID(),
                userId,
                method,
                success,
                failureReason ?? null,
                userAgent ?? null,
                ipAddress ?? null,
                new Date(),
            ]
        );
    }

    async hasPermission(role: string, permission: string): Promise<boolean> {
        try {
            const result = await this.db.queryOne<{ has_permission: boolean }>(
                `SELECT has_permission($1, $2) as has_permission`,
                [role, permission]
            );
            return result?.has_permission ?? false;
        } catch (error) {
            // If the function doesn't exist, fall back to role check
            if (role === 'admin') {
                return true;
            }
            return false;
        }
    }

    async getUserById(userId: string): Promise<{ id: string; email: string; name: string | null; role: string; status: string } | null> {
        return await this.getUser(userId);
    }

    async getUserIdByEmail(email: string): Promise<string | null> {
        const user = await this.db.queryOne<{ id: string }>(
            "SELECT id FROM users WHERE email = $1",
            [email.toLowerCase()]
        );
        return user?.id ?? null;
    }
}

let authService: AuthService | null = null;

export function initAuthService(db: DbClient, jwtSecret: string): AuthService {
    authService = new AuthService(db, jwtSecret);
    return authService;
}

export function getAuthService(): AuthService {
    if (!authService) {
        throw new Error("Auth service not initialized. Call initAuthService() first.");
    }
    return authService;
}

export function getJwtSecret(): string {
    const secret = process.env.OPENCLAW_JWT_SECRET;
    if (!secret) {
        const generated = randomBytes(32).toString("hex");
        log.warn("No JWT secret configured, using generated secret (will change on restart)");
        return generated;
    }
    return secret;
}