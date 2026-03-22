import { randomUUID } from "node:crypto";
import { verifyAccessToken, hashToken, type AuthService, type User } from "../../auth/service.js";
import { getDbClient, type DbClient } from "../../db/client.js";
import { createLogger } from "../../logging.js";
import type { GatewayAuthConfig, GatewayTailscaleMode, GatewayTrustedProxyConfig } from "../config/config.js";
import { resolveGatewayAuth, type ResolvedGatewayAuth, type AuthorizeGatewayConnectParams, type GatewayAuthResult } from "../auth.js";

const log = createLogger("gateway/api-auth");

const PUBLIC_METHODS = new Set([
    "health",
    "auth.register",
    "auth.login",
    "auth.refresh",
    "auth.admin.init",
]);

const JWT_AUTH_METHOD = "jwt";
const API_KEY_AUTH_METHOD = "api-key";

export interface ApiAuthResult extends GatewayAuthResult {
    method?: GatewayAuthResult["method"] | typeof JWT_AUTH_METHOD | typeof API_KEY_AUTH_METHOD;
    userId?: string;
    userRole?: string;
    userEmail?: string;
}

export async function authorizeApiRequest(
    params: AuthorizeGatewayConnectParams & {
        authService: AuthService;
    }
): Promise<ApiAuthResult> {
    const { authService, authSurface, ...authParams } = params;
    
    const connectAuth = authParams.connectAuth;

    if (connectAuth?.token) {
        const tokenResult = await authorizeJwtToken(connectAuth.token, authService);
        if (tokenResult.ok) {
            return {
                ok: true,
                method: JWT_AUTH_METHOD,
                user: tokenResult.user?.email,
                userId: tokenResult.user?.id,
                userRole: tokenResult.user?.role,
                userEmail: tokenResult.user?.email,
            };
        }
    }

    const apiKeyResult = await authorizeApiKey(connectAuth?.token, authService);
    if (apiKeyResult.ok) {
        return {
            ok: true,
            method: API_KEY_AUTH_METHOD,
            user: apiKeyResult.user?.email,
            userId: apiKeyResult.user?.id,
            userRole: apiKeyResult.user?.role,
            userEmail: apiKeyResult.user?.email,
        };
    }

    const resolvedAuth = resolveGatewayAuth(authParams);
    return authorizeGatewayConnect({
        ...authParams,
        auth: resolvedAuth,
        authSurface,
    });
}

async function authorizeJwtToken(token: string, authService: AuthService): Promise<{ ok: boolean; user?: User; error?: string }> {
    const jwtSecret = process.env.OPENCLAW_JWT_SECRET;
    if (!jwtSecret) {
        return { ok: false, error: "JWT not configured" };
    }

    const payload = verifyAccessToken(token, jwtSecret);
    if (!payload) {
        return { ok: false, error: "Invalid or expired token" };
    }

    const user = await authService.getUser(payload.sub);
    if (!user || user.status !== "active") {
        return { ok: false, error: "User not found or inactive" };
    }

    return { ok: true, user };
}

async function authorizeApiKey(key: string | undefined, authService: AuthService): Promise<{ ok: boolean; user?: User; error?: string }> {
    if (!key || key.startsWith("Bearer ")) {
        return { ok: false, error: "Not an API key" };
    }

    const user = await authService.verifyApiKey(key);
    if (!user) {
        return { ok: false, error: "Invalid API key" };
    }

    if (user.status !== "active") {
        return { ok: false, error: "User account is not active" };
    }

    return { ok: true, user };
}

export function createApiAuthMiddleware(authService: AuthService) {
    return async function apiAuthMiddleware(
        req: { method: string; headers: Record<string, string | string[] | undefined> },
        connect: { token?: string; password?: string }
    ): Promise<ApiAuthResult> {
        const method = req.method;

        if (PUBLIC_METHODS.has(method)) {
            return { ok: true, method: "public" };
        }

        const authHeader = connect.token;
        if (!authHeader) {
            return {
                ok: false,
                method: "none",
                reason: "Authentication required",
            };
        }

        if (authHeader.startsWith("Bearer ")) {
            const token = authHeader.slice(7);
            const jwtSecret = process.env.OPENCLAW_JWT_SECRET;
            if (!jwtSecret) {
                return { ok: false, reason: "JWT not configured" };
            }

            const payload = verifyAccessToken(token, jwtSecret);
            if (!payload) {
                return { ok: false, reason: "Invalid or expired token" };
            }

            const user = await authService.getUser(payload.sub);
            if (!user || user.status !== "active") {
                return { ok: false, reason: "User not found or inactive" };
            }

            return {
                ok: true,
                method: JWT_AUTH_METHOD,
                user: user.email,
                userId: user.id,
                userRole: user.role,
                userEmail: user.email,
            };
        }

        const user = await authService.verifyApiKey(authHeader);
        if (!user) {
            return { ok: false, reason: "Invalid API key" };
        }

        if (user.status !== "active") {
            return { ok: false, reason: "User account is not active" };
        }

        return {
            ok: true,
            method: API_KEY_AUTH_METHOD,
            user: user.email,
            userId: user.id,
            userRole: user.role,
            userEmail: user.email,
        };
    };
}

export function requireAuth(authService: AuthService, requiredRole?: "admin" | "user") {
    return createApiAuthMiddleware(authService);
}