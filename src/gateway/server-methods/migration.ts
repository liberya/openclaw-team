import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, GatewayRequestOptions } from "./types.js";
import { verifyAccessToken, getJwtSecret } from "../../auth/service.js";
import { getMigrationService, type MigrationResult } from "../../db/migration.js";

export const migrationHandlers = {
    "migration.run": async ({ params, respond, client }) => {
        try {
            const authHeader = (client as any)?.connect?.authToken;
            if (!authHeader) {
                respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "No token provided"));
                return;
            }

            const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
            const jwtSecret = getJwtSecret();
            const payload = verifyAccessToken(token, jwtSecret);

            if (!payload || payload.role !== "admin") {
                respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
                return;
            }

            const { openclawHome, dryRun } = params as { openclawHome?: string; dryRun?: boolean };

            const migrationService = getMigrationService();
            const result = await migrationService.migrate({
                userId: payload.sub,
                openclawHome,
                dryRun: dryRun ?? false,
            });

            respond(true, {
                success: result.success,
                agentsMigrated: result.agentsMigrated,
                sessionsMigrated: result.sessionsMigrated,
                memoriesMigrated: result.memoriesMigrated,
                errors: result.errors,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Migration failed";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },

    "migration.status": async ({ respond, client }) => {
        try {
            const authHeader = (client as any)?.connect?.authToken;
            if (!authHeader) {
                respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "No token provided"));
                return;
            }

            const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
            const jwtSecret = getJwtSecret();
            const payload = verifyAccessToken(token, jwtSecret);

            if (!payload || payload.role !== "admin") {
                respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
                return;
            }

            respond(true, {
                message: "Migration service ready",
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to get status";
            respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
        }
    },
};

export function createMigrationHandlers(): GatewayRequestHandlers {
    return {
        "migration.run": async ({ params, respond, client }) => {
            try {
                const authHeader = (client as any)?.connect?.authToken;
                if (!authHeader) {
                    respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "No token provided"));
                    return;
                }

                const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
                const jwtSecret = getJwtSecret();
                const payload = verifyAccessToken(token, jwtSecret);

                if (!payload || payload.role !== "admin") {
                    respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
                    return;
                }

                const { openclawHome, dryRun } = params as { openclawHome?: string; dryRun?: boolean };

                const migrationService = getMigrationService();
                const result = await migrationService.migrate({
                    userId: payload.sub,
                    openclawHome,
                    dryRun: dryRun ?? false,
                });

                respond(true, {
                    success: result.success,
                    agentsMigrated: result.agentsMigrated,
                    sessionsMigrated: result.sessionsMigrated,
                    memoriesMigrated: result.memoriesMigrated,
                    errors: result.errors,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Migration failed";
                respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
            }
        },

        "migration.status": async ({ respond, client }) => {
            try {
                const authHeader = (client as any)?.connect?.authToken;
                if (!authHeader) {
                    respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "No token provided"));
                    return;
                }

                const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
                const jwtSecret = getJwtSecret();
                const payload = verifyAccessToken(token, jwtSecret);

                if (!payload || payload.role !== "admin") {
                    respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Admin access required"));
                    return;
                }

                respond(true, {
                    message: "Migration service ready",
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Failed to get status";
                respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, message));
            }
        },
    };
}