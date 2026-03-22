import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { getAuthService, hashPassword, generateAccessToken, generateRefreshToken, hashToken, encryptValue, decryptValue, getEncryptionKey } from "../../auth/service.js";
import { loadConfig, writeConfigFile, clearConfigCache, createConfigIO, type OpenClawConfig } from "../../config/config.js";
import { discoverOpenAICompatibleLocalModels } from "../../agents/models-config.providers.discovery.js";
import { randomUUID } from "node:crypto";

const PUBLIC_METHODS = new Set([
    "health",
    "auth.register",
    "auth.login",
    "auth.refresh",
    "auth.admin.init",
    "models.admin.list",
    "models.admin.add",
    "models.admin.update",
    "models.admin.remove",
    "models.admin.presets",
]);

function verifyTokenPayload(token: string): { sub: string; email: string; role: string } | null {
    try {
        const parts = token.split('.');
        let payloadJson: string;
        
        if (parts.length === 1) {
            // Single-part format (base64url encoded JSON) - custom token format
            payloadJson = Buffer.from(parts[0], 'base64url').toString();
        } else if (parts.length >= 2) {
            // Standard JWT format (header.payload.signature)
            payloadJson = Buffer.from(parts[1], 'base64').toString();
        } else {
            return null;
        }
        
        const payload = JSON.parse(payloadJson);
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) return null;
        return payload;
    } catch {
        return null;
    }
}

function getUserIdFromToken(client: any): string | null {
    const authToken = client?.connect?.authToken;
    if (!authToken) return null;
    const token = authToken.startsWith("Bearer ") ? authToken.slice(7) : authToken;
    const payload = verifyTokenPayload(token);
    return payload?.sub ?? null;
}

function getCurrentUserId(client: any, params?: any): string | null {
    const userIdFromConnection = getUserIdFromToken(client);
    if (userIdFromConnection) return userIdFromConnection;
    
    if (params?.token) {
        const payload = verifyTokenPayload(params.token);
        if (payload?.sub) return payload.sub;
    }
    
    return null;
}

async function checkIsAdmin(userId: string): Promise<boolean> {
    try {
        const { getAuthService } = await import("../../auth/service.js");
        const authService = getAuthService();
        const user = await authService.getUserById(userId);
        return user?.role === 'admin';
    } catch {
        return false;
    }
}

async function setUserContext(client: any, params?: any): Promise<void> {
    const userId = getCurrentUserId(client, params);
    if (userId) {
        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const userDataService = getUserDataService();
            await userDataService.setCurrentUserContext(userId);
        } catch (err) {
            console.error("[setUserContext] Error:", err);
        }
    }
}

async function clearUserContext(): Promise<void> {
    try {
        const { getUserDataService } = await import("../../auth/user-data.js");
        const userDataService = getUserDataService();
        await userDataService.clearCurrentUserContext();
    } catch (err) {
        console.error("[clearUserContext] Error:", err);
    }
}

function isAdmin(client: any, params?: any): boolean {
    if (params?.token) {
        const payload = verifyTokenPayload(params.token);
        if (payload?.role === "admin") return true;
    }
    
    const authToken = client?.connect?.authToken;
    if (!authToken) return false;
    const token = authToken.startsWith("Bearer ") ? authToken.slice(7) : authToken;
    const payload = verifyTokenPayload(token);
    return payload?.role === "admin";
}

export { setUserContext, clearUserContext, getCurrentUserId, isAdmin, verifyTokenPayload };

export const authHandlers: GatewayRequestHandlers = {
    "auth.register": async ({ params, respond }) => {
        const { email, password, name } = params as { email?: string; password?: string; name?: string };
        if (!email || !password) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Email and password required"));
            return;
        }
        respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Use auth.admin.init to create admin first"));
    },

    "auth.login": async ({ params, respond, client }) => {
        const { email, password } = params as { email?: string; password?: string };
        if (!email || !password) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Email and password required"));
            return;
        }

        try {
            const authService = getAuthService();
            const result = await authService.authenticateUser(email, password);
            
            if (client?.connect) {
                client.connect.authToken = `Bearer ${result.tokens.accessToken}`;
            }
            
            respond(true, {
                user: {
                    id: result.user.id,
                    email: result.user.email,
                    name: result.user.name,
                    role: result.user.role
                },
                accessToken: result.tokens.accessToken,
                refreshToken: result.tokens.refreshToken,
                expiresIn: result.tokens.expiresIn
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Login failed";
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, message || "Login failed"));
        }
    },

    "auth.refresh": async ({ params, respond }) => {
        const { refreshToken } = params as { refreshToken?: string };
        if (!refreshToken) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Refresh token required"));
            return;
        }

        try {
            const authService = getAuthService();
            const result = await authService.refreshAuthSession(refreshToken);
            respond(true, {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresIn: result.expiresIn
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Token refresh failed";
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, message));
        }
    },

    "auth.logout": async ({ respond }) => {
        respond(true, { loggedOut: true });
    },

    "auth.me": async ({ respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "No token"));
            return;
        }
        respond(true, { user: { id: userId, email: "user", role: "user" } });
    },

    "auth.apikey.create": async ({ respond }) => {
        respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Not implemented"));
    },

    "auth.apikey.list": async ({ respond }) => {
        respond(true, { apiKeys: [] });
    },

    "auth.apikey.delete": async ({ respond }) => {
        respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Not implemented"));
    },

    "auth.admin.users.list": async ({ params, respond, client }) => {
        if (!isAdmin(client, params)) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin required"));
            return;
        }
        try {
            const authService = getAuthService();
            const { limit = 20, offset = 0 } = params as { limit?: number; offset?: number };
            const result = await authService.listUsers(limit, offset);
            const users = result.users.map((u: any) => ({
                id: u.id,
                email: u.email,
                name: u.name,
                role: u.role,
                status: u.status,
                createdAt: u.createdAt?.toISOString() || new Date().toISOString(),
                lastLoginAt: u.lastLoginAt?.toISOString() || null,
            }));
            respond(true, { users, total: result.total });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to list users";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "auth.admin.users.create": async ({ params, respond, client }) => {
        if (!isAdmin(client, params)) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin required"));
            return;
        }
        try {
            const { email, password, name, role = "user" } = params as { email?: string; password?: string; name?: string; role?: string };
            if (!email || !password) {
                respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Email and password required"));
                return;
            }
            const authService = getAuthService();
            const user = await authService.createUser(email, password, name);
            respond(true, { user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status, createdAt: user.createdAt.toISOString(), lastLoginAt: null } });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to create user";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "auth.admin.users.update": async ({ params, respond, client }) => {
        if (!isAdmin(client, params)) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin required"));
            return;
        }
        try {
            // 优先从 params.token 获取 adminUserId（适用于多连接场景）
            let adminUserId = params?.token ? verifyTokenPayload(params.token)?.sub : null;
            if (!adminUserId) {
                adminUserId = getUserIdFromToken(client);
            }
            const { userId, name, status, role } = params as { userId?: string; name?: string; status?: string; role?: string };
            if (!userId) {
                respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "User ID required"));
                return;
            }
            const authService = getAuthService();
            await authService.updateUser(adminUserId!, userId, { name, status, role });
            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to update user";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "auth.admin.users.reset-password": async ({ params, respond, client }) => {
        if (!isAdmin(client, params)) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin required"));
            return;
        }
        try {
            // 优先从 params.token 获取 adminUserId（适用于多连接场景）
            let adminUserId = params?.token ? verifyTokenPayload(params.token)?.sub : null;
            if (!adminUserId) {
                adminUserId = getUserIdFromToken(client);
            }
            const { userId, newPassword } = params as { userId?: string; newPassword?: string };
            if (!userId || !newPassword) {
                respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "User ID and new password required"));
                return;
            }
            const authService = getAuthService();
            await authService.resetUserPassword(adminUserId!, userId, newPassword);
            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to reset password";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "auth.admin.users.delete": async ({ params, respond, client }) => {
        if (!isAdmin(client, params)) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin required"));
            return;
        }
        try {
            // 优先从 params.token 获取 adminUserId（适用于多连接场景）
            let adminUserId = params?.token ? verifyTokenPayload(params.token)?.sub : null;
            // 兜底从 client.connect.authToken 获取
            if (!adminUserId) {
                adminUserId = getUserIdFromToken(client);
            }
            
            const { userId } = params as { userId?: string };
            if (!userId) {
                respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "User ID required"));
                return;
            }
            const authService = getAuthService();
            await authService.deleteUser(adminUserId!, userId);
            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to delete user";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "auth.admin.init": async ({ params, respond }) => {
        const { email, password } = params as { email?: string; password?: string };
        if (!email || !password) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Email and password required"));
            return;
        }

        try {
            const authService = getAuthService();
            const admin = await authService.initializeDefaultAdmin(email, password);
            respond(true, { 
                message: "Admin user created successfully",
                user: {
                    id: admin.id,
                    email: admin.email,
                    name: admin.name,
                    role: admin.role
                }
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to create admin";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    // ==================== Channel Management ====================
    "channels.list": async ({ params, respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const userDataService = getUserDataService();
            
            const channels = await userDataService.listUserChannels(userId);
            respond(true, { 
                channels: channels.map(ch => ({
                    id: ch.id,
                    channelType: ch.channelType,
                    accountId: ch.accountId,
                    appId: ch.appId,
                    isActive: ch.isActive,
                    isVerified: ch.isVerified,
                    lastConnectedAt: ch.lastConnectedAt?.toISOString() ?? null,
                }))
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to list channels";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "channels.add": async ({ params, respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const { channelType, accountId, appId, appSecret, accessToken, refreshToken, tokenExpiresAt, webhookUrl, webhookSecret, botUserId, botId } = params as any;
        
        if (!channelType || !accountId) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "channelType and accountId required"));
            return;
        }

        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const { hashToken } = await import("../../auth/service.js");
            const userDataService = getUserDataService();

            await userDataService.createUserChannel(userId, channelType, accountId, {
                appId: appId ?? undefined,
                appSecretHash: appSecret ? await hashToken(appSecret) : undefined,
                accessToken: accessToken ?? undefined,
                refreshToken: refreshToken ?? undefined,
                tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : undefined,
                webhookUrl: webhookUrl ?? undefined,
                webhookSecretHash: webhookSecret ? await hashToken(webhookSecret) : undefined,
                botUserId: botUserId ?? undefined,
                botId: botId ?? undefined,
            });

            console.log(`[channels.add] Created channel: userId=${userId}, channelType=${channelType}`);
            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to add channel";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "channels.update": async ({ params, respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const { channelType, accessToken, refreshToken, tokenExpiresAt, isVerified } = params as any;
        
        if (!channelType) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "channelType required"));
            return;
        }

        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const userDataService = getUserDataService();

            await userDataService.updateUserChannel(userId, channelType, {
                accessToken: accessToken ?? undefined,
                refreshToken: refreshToken ?? undefined,
                tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : undefined,
                isVerified: isVerified ?? undefined,
                lastConnectedAt: new Date(),
            });

            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to update channel";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "channels.remove": async ({ params, respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const { channelType } = params as any;
        
        if (!channelType) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "channelType required"));
            return;
        }

        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const userDataService = getUserDataService();

            await userDataService.deleteUserChannel(userId, channelType);
            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to remove channel";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    // ==================== User Skills Management ====================
    "skills.user.list": async ({ params, respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const userDataService = getUserDataService();
            
            const skills = await userDataService.listUserSkills(userId);
            respond(true, { 
                skills: skills.map(s => ({
                    id: s.id,
                    skillKey: s.skillKey,
                    skillName: s.skillName,
                    skillSource: s.skillSource,
                    skillUrl: s.skillUrl,
                    skillPath: s.skillPath,
                    enabled: s.enabled,
                    env: s.env,
                    config: s.config,
                    installedAt: s.installedAt.toISOString(),
                }))
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to list skills";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "skills.user.add": async ({ params, respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const { skillKey, skillName, skillSource, skillUrl, skillPath, enabled, apiKey, env, config } = params as any;
        
        if (!skillKey || !skillSource) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "skillKey and skillSource required"));
            return;
        }

        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const userDataService = getUserDataService();

            await userDataService.createUserSkill(userId, skillKey, skillName ?? skillKey, skillSource, {
                skillUrl: skillUrl ?? undefined,
                skillPath: skillPath ?? undefined,
                enabled: enabled ?? true,
                apiKey: apiKey ?? undefined,
                env: env ?? undefined,
                config: config ?? undefined,
            });

            console.log(`[skills.user.add] Created skill: userId=${userId}, skillKey=${skillKey}`);
            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to add skill";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "skills.user.update": async ({ params, respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const { skillKey, enabled, apiKey, env, config } = params as any;
        
        if (!skillKey) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "skillKey required"));
            return;
        }

        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const userDataService = getUserDataService();

            await userDataService.updateUserSkill(userId, skillKey, {
                enabled: enabled ?? undefined,
                apiKey: apiKey ?? undefined,
                env: env ?? undefined,
                config: config ?? undefined,
            });

            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to update skill";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "skills.user.remove": async ({ params, respond, client }) => {
        const userId = getUserIdFromToken(client);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const { skillKey } = params as any;
        
        if (!skillKey) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "skillKey required"));
            return;
        }

        try {
            const { getUserDataService } = await import("../../auth/user-data.js");
            const userDataService = getUserDataService();

            await userDataService.deleteUserSkill(userId, skillKey);
            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to remove skill";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    // ==================== Model Provider Management (Admin) ====================
    "models.admin.list": async ({ params, respond, client }) => {
        const userId = getCurrentUserId(client, params);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const isAdminUser = await checkIsAdmin(userId);
        if (!isAdminUser) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
            return;
        }

        try {
            const io = createConfigIO();
            const cfg = io.loadConfig();
            const providers = cfg.models?.providers ?? {};
            
            const providerList = Object.entries(providers).map(([id, config]: [string, any]) => ({
                id,
                baseUrl: config.baseUrl ?? null,
                api: config.api ?? null,
                auth: config.auth ?? null,
                hasApiKey: !!config.apiKey,
                hasModels: !!(config.models && config.models.length > 0),
                modelCount: config.models?.length ?? 0,
                models: config.models ?? [],
            }));

            respond(true, { providers: providerList });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to list providers";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    async discoverModelsForProvider(params: {
        providerId: string;
        baseUrl: string;
        apiKey: string;
        api: string;
    }): Promise<{ models: any[]; error?: string }> {
        const baseUrl = params.baseUrl?.trim();
        const apiKey = params.apiKey?.trim();
        const api = params.api;

        if (!baseUrl) {
            return { models: [], error: "Base URL is required for model discovery" };
        }
        if (!apiKey) {
            return { models: [], error: "API Key is required for model discovery" };
        }

        if (api === "openai-completions" || api === "openai-responses") {
            try {
                const discovered = await discoverOpenAICompatibleLocalModels({
                    baseUrl,
                    apiKey,
                    label: params.providerId,
                });
                if (discovered.length === 0) {
                    return { models: [], error: `No models found at ${baseUrl}. Please configure models manually.` };
                }
                return { models: discovered };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { models: [], error: `Failed to discover models: ${msg}. Please configure models manually.` };
            }
        }

        return {
            models: [],
            error: `Auto model discovery is not supported for API type "${api}". Please configure models manually.`,
        };
    },

    "models.admin.add": async ({ params, respond, client }) => {
        const userId = getCurrentUserId(client, params);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const isAdminUser = await checkIsAdmin(userId);
        if (!isAdminUser) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
            return;
        }

        const { providerId, apiKey, baseUrl, api, auth, headers } = params as any;
        
        if (!providerId) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "providerId required"));
            return;
        }

        try {
            const resolvedBaseUrl = baseUrl || PROVIDER_PRESETS[providerId]?.baseUrl || "";
            const resolvedApi = api || PROVIDER_PRESETS[providerId]?.api || "openai-completions";

            if (!apiKey) {
                respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "API Key is required"));
                return;
            }

            const discoverResult = await (async () => {
                const baseUrlToUse = resolvedBaseUrl?.trim();
                const apiKeyToUse = apiKey?.trim();
                const apiToUse = resolvedApi;

                if (!baseUrlToUse) {
                    return { models: [], error: "Base URL is required for model discovery" };
                }
                if (!apiKeyToUse) {
                    return { models: [], error: "API Key is required for model discovery" };
                }

                if (apiToUse === "openai-completions" || apiToUse === "openai-responses") {
                    try {
                        const discovered = await discoverOpenAICompatibleLocalModels({
                            baseUrl: baseUrlToUse,
                            apiKey: apiKeyToUse,
                            label: providerId,
                        });
                        if (discovered.length === 0) {
                            return { models: [], error: `No models found at ${baseUrlToUse}. Please configure models manually.` };
                        }
                        return { models: discovered };
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        return { models: [], error: `Failed to discover models: ${msg}. Please configure models manually.` };
                    }
                }

                return {
                    models: [],
                    error: `Auto model discovery is not supported for API type "${apiToUse}". Please configure models manually.`,
                };
            })();

            const providerConfig: any = {
                models: discoverResult.models,
            };
            
            if (resolvedBaseUrl) providerConfig.baseUrl = resolvedBaseUrl;
            if (resolvedApi) providerConfig.api = resolvedApi;
            if (auth) providerConfig.auth = auth;
            if (headers) providerConfig.headers = headers;
            if (apiKey) providerConfig.apiKey = apiKey;

            const cfg = loadConfig();
            const providers = cfg.models?.providers ?? {};

            const nextConfig: OpenClawConfig = {
                ...cfg,
                models: {
                    ...cfg.models,
                    providers: {
                        ...providers,
                        [providerId]: providerConfig,
                    },
                },
            };

            await writeConfigFile(nextConfig);
            clearConfigCache();

            if (discoverResult.error) {
                console.log(`[models.admin.add] Added provider: ${providerId} (discovery failed: ${discoverResult.error})`);
                respond(true, { success: true, providerId, modelCount: 0, discoveryFailed: true, discoveryError: discoverResult.error });
                return;
            }

            console.log(`[models.admin.add] Added provider: ${providerId} with ${discoverResult.models.length} models`);
            respond(true, { success: true, providerId, modelCount: discoverResult.models.length, discoveryFailed: false });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to add provider";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "models.admin.update": async ({ params, respond, client }) => {
        const userId = getCurrentUserId(client, params);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const isAdminUser = await checkIsAdmin(userId);
        if (!isAdminUser) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
            return;
        }

        const { providerId, apiKey, baseUrl, api, auth, headers, models } = params as any;
        
        if (!providerId) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "providerId required"));
            return;
        }

        try {
            const cfg = loadConfig();
            const providers = cfg.models?.providers ?? {};
            
            if (!providers[providerId]) {
                respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, `Provider ${providerId} not found`));
                return;
            }

            const existingConfig = providers[providerId];
            const resolvedBaseUrl = baseUrl !== undefined ? baseUrl : (existingConfig.baseUrl || PROVIDER_PRESETS[providerId]?.baseUrl || "");
            const resolvedApi = api !== undefined ? api : (existingConfig.api || PROVIDER_PRESETS[providerId]?.api || "openai-completions");
            
            const newApiKey = apiKey !== undefined ? apiKey : existingConfig.apiKey;
            const needsDiscovery = apiKey !== undefined && apiKey !== existingConfig.apiKey && newApiKey;

            let updatedModels: any[] = existingConfig.models || [];
            
            if (Array.isArray(models) && models.length > 0) {
                updatedModels = models.map((id: string) => ({
                    id: id.trim(),
                    name: id.trim(),
                    reasoning: false,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 128000,
                    maxTokens: 8192,
                }));
            } else if (needsDiscovery && newApiKey) {
                const baseUrlToUse = resolvedBaseUrl?.trim();
                const apiKeyToUse = newApiKey?.trim();
                const apiToUse = resolvedApi;

                if (baseUrlToUse && apiKeyToUse) {
                    if (apiToUse === "openai-completions" || apiToUse === "openai-responses") {
                        try {
                            const discovered = await discoverOpenAICompatibleLocalModels({
                                baseUrl: baseUrlToUse,
                                apiKey: apiKeyToUse,
                                label: providerId,
                            });
                            if (discovered.length > 0) {
                                updatedModels = discovered;
                            }
                        } catch {
                        }
                    }
                }
            }

            const providerConfig: any = { ...existingConfig };
            
            if (baseUrl !== undefined) providerConfig.baseUrl = baseUrl;
            if (api !== undefined) providerConfig.api = api;
            if (auth !== undefined) providerConfig.auth = auth;
            if (headers !== undefined) providerConfig.headers = headers;
            
            if (apiKey !== undefined) {
                if (apiKey) {
                    providerConfig.apiKey = apiKey;
                } else {
                    delete providerConfig.apiKey;
                }
            }
            
            providerConfig.models = updatedModels;

            const nextConfig: OpenClawConfig = {
                ...cfg,
                models: {
                    ...cfg.models,
                    providers: {
                        ...providers,
                        [providerId]: providerConfig,
                    },
                },
            };

            await writeConfigFile(nextConfig);
            clearConfigCache();
            console.log(`[models.admin.update] Updated provider: ${providerId} with ${updatedModels.length} models`);
            respond(true, { success: true, providerId, modelCount: updatedModels.length });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to update provider";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "models.admin.remove": async ({ params, respond, client }) => {
        const userId = getCurrentUserId(client, params);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const isAdminUser = await checkIsAdmin(userId);
        if (!isAdminUser) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
            return;
        }

        const { providerId } = params as any;
        
        if (!providerId) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "providerId required"));
            return;
        }

        try {
            const cfg = loadConfig();
            const providers = cfg.models?.providers ?? {};
            
            if (!providers[providerId]) {
                respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, `Provider ${providerId} not found`));
                return;
            }

            const { [providerId]: _removed, ...remainingProviders } = providers;

            const nextConfig: OpenClawConfig = {
                ...cfg,
                models: {
                    ...cfg.models,
                    providers: remainingProviders,
                },
            };

            await writeConfigFile(nextConfig);
            clearConfigCache();
            console.log(`[models.admin.remove] Removed provider: ${providerId}`);
            respond(true, { success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to remove provider";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "models.admin.presets": async ({ params, respond, client }) => {
        // This endpoint doesn't require authentication - presets are public info
        respond(true, { presets: PROVIDER_PRESETS });
    },

    "models.admin.setDefault": async ({ params, respond, client }) => {
        const userId = getCurrentUserId(client, params);
        if (!userId) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
            return;
        }

        const isAdminUser = await checkIsAdmin(userId);
        if (!isAdminUser) {
            respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
            return;
        }

        const { providerId, modelId } = params as any;
        
        if (!providerId) {
            respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "providerId required"));
            return;
        }

        try {
            const cfg = loadConfig();
            const providers = cfg.models?.providers ?? {};
            
            if (!providers[providerId]) {
                respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, `Provider ${providerId} not found`));
                return;
            }

            const modelRef = modelId ? `${providerId}/${modelId}` : providerId;
            
            const nextConfig: OpenClawConfig = {
                ...cfg,
                agents: {
                    ...cfg.agents,
                    defaults: {
                        ...cfg.agents?.defaults,
                        model: {
                            primary: modelRef,
                        },
                    },
                },
            };

            await writeConfigFile(nextConfig);
            clearConfigCache();
            console.log(`[models.admin.setDefault] Set default model to: ${modelRef}`);
            respond(true, { success: true, defaultModel: modelRef });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to set default model";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },
};

// ==================== Provider Presets ====================
const PROVIDER_PRESETS: Record<string, {
    name: string;
    baseUrl: string;
    api: string;
    auth: string;
    description: string;
}> = {
    openai: {
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        api: "openai-responses",
        auth: "api-key",
        description: "GPT-4o, o1, o3-mini and more",
    },
    anthropic: {
        name: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        api: "anthropic-messages",
        auth: "api-key",
        description: "Claude Opus 4.6, Sonnet 4.5, Haiku",
    },
    google: {
        name: "Google Gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        api: "google-generative-ai",
        auth: "api-key",
        description: "Gemini 2.5 Pro/Flash",
    },
    "google-vertex": {
        name: "Google Vertex AI",
        baseUrl: "https://us-central1-aiplatform.googleapis.com",
        api: "google-generative-ai",
        auth: "aws-sdk",
        description: "Google Cloud Vertex AI",
    },
    "azure-openai": {
        name: "Azure OpenAI",
        baseUrl: "https://<your-resource>.openai.azure.com",
        api: "openai-responses",
        auth: "api-key",
        description: "Azure OpenAI Service",
    },
    ollama: {
        name: "Ollama",
        baseUrl: "http://localhost:11434",
        api: "ollama",
        auth: "api-key",
        description: "Local LLM runtime",
    },
    vllm: {
        name: "vLLM",
        baseUrl: "http://localhost:8000/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "High-performance LLM inference server",
    },
    sglang: {
        name: "SGLang",
        baseUrl: "http://localhost:30000/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "SGLang inference server",
    },
    openrouter: {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "Unified access to 100+ models",
    },
    together: {
        name: "Together AI",
        baseUrl: "https://api.together.ai/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "Leading open-source models",
    },
    huggingface: {
        name: "HuggingFace",
        baseUrl: "https://api-inference.huggingface.co",
        api: "openai-completions",
        auth: "api-key",
        description: "HuggingFace Inference API",
    },
    nvidia: {
        name: "NVIDIA NIM",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "NVIDIA NIM microservices",
    },
    moonshot: {
        name: "Moonshot (月之暗面)",
        baseUrl: "https://api.moonshot.ai/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "Kimi series models",
    },
    minimax: {
        name: "MiniMax (稀宇科技)",
        baseUrl: "https://api.minimax.io/anthropic",
        api: "anthropic-messages",
        auth: "api-key",
        description: "MiniMax M2.5 series",
    },
    "kimi-coding": {
        name: "Kimi Coding",
        baseUrl: "https://api.kimi.com/coding/",
        api: "openai-completions",
        auth: "api-key",
        description: "Kimi k2.5 coding model",
    },
    "qwen-portal": {
        name: "Qwen Portal (通义千问)",
        baseUrl: "https://portal.qwen.ai/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "Alibaba Qwen series",
    },
    qianfan: {
        name: "Qianfan (百度)",
        baseUrl: "https://qianfan.baidubce.com/v2",
        api: "openai-completions",
        auth: "api-key",
        description: "Baidu ERNIE series",
    },
    modelstudio: {
        name: "ModelStudio (阿里云)",
        baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "Alibaba Cloud Qwen series",
    },
    venice: {
        name: "Venice AI",
        baseUrl: "https://api.veniceai.com/v1",
        api: "openai-completions",
        auth: "api-key",
        description: "Uncensored models",
    },
    bedrock: {
        name: "AWS Bedrock",
        baseUrl: "",
        api: "bedrock-converse-stream",
        auth: "aws-sdk",
        description: "AWS Bedrock managed models",
    },
};