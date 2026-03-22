import { verifyAccessToken, getJwtSecret, type AuthService } from "../../auth/service.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, GatewayRequestOptions } from "./types.js";

const PUBLIC_METHODS = new Set([
    "health",
    "auth.register",
    "auth.login",
    "auth.refresh",
    "auth.admin.init",
]);

interface AuthenticatedClient extends GatewayRequestOptions["client"] {
    userId?: string;
    userRole?: string;
    userEmail?: string;
}

export function createAuthMiddleware(getAuthService: () => AuthService) {
    const jwtSecret = getJwtSecret();

    return function authMiddleware(
        req: GatewayRequestOptions["req"],
        client: GatewayRequestOptions["client"],
        respond: GatewayRequestOptions["respond"]
    ): { authorized: boolean; newClient?: AuthenticatedClient } {
        const method = req.method;

        if (PUBLIC_METHODS.has(method)) {
            return { authorized: true };
        }

        // Check WebSocket connection authToken first
        let authHeader = client?.connect?.authToken;
        let token = authHeader ? (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader) : null;

        // If no WebSocket authToken, check params.token (for REST-like calls through WebSocket)
        if (!token && req.params?.token) {
            const paramsToken = req.params.token;
            token = paramsToken.startsWith("Bearer ") ? paramsToken.slice(7) : paramsToken;
        }

        if (!token) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Authentication required"));
            return { authorized: false };
        }

        const payload = verifyAccessToken(token, jwtSecret);

        if (!payload) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Invalid or expired token"));
            return { authorized: false };
        }

        const authenticatedClient: AuthenticatedClient = {
            ...client,
            userId: payload.sub,
            userRole: payload.role,
            userEmail: payload.email,
        };

        return { authorized: true, newClient: authenticatedClient };
    };
}

export function createApiKeyAuthMiddleware(getAuthService: () => AuthService) {
    return async function apiKeyAuth(
        req: GatewayRequestOptions["req"],
        client: GatewayRequestOptions["client"],
        respond: GatewayRequestOptions["respond"]
    ): Promise<{ authorized: boolean; newClient?: AuthenticatedClient }> {
        const method = req.method;

        if (PUBLIC_METHODS.has(method)) {
            return { authorized: true };
        }

        const authHeader = client?.connect?.authToken;
        if (!authHeader) {
            return { authorized: true };
        }

        if (authHeader.startsWith("Bearer ")) {
            return { authorized: true };
        }

        const authService = getAuthService();
        const user = await authService.verifyApiKey(authHeader);

        if (!user) {
            respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Invalid API key"));
            return { authorized: false };
        }

        const authenticatedClient: AuthenticatedClient = {
            ...client,
            userId: user.id,
            userRole: user.role,
            userEmail: user.email,
        };

        return { authorized: true, newClient: authenticatedClient };
    };
}