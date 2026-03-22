import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import {
  readCronRunLogEntriesPage,
  readCronRunLogEntriesPageAll,
  resolveCronRunLogPath,
} from "../../cron/run-log.js";
import type { CronJobCreate, CronJobPatch } from "../../cron/types.js";
import { validateScheduleTimestamp } from "../../cron/validate-timestamp.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateCronAddParams,
  validateCronListParams,
  validateCronRemoveParams,
  validateCronRunParams,
  validateCronRunsParams,
  validateCronStatusParams,
  validateCronUpdateParams,
  validateWakeParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { setUserContext, getCurrentUserId, isAdmin, verifyTokenPayload } from "./auth.js";

type AuthContext = {
  userId: string | null;
  isAdminUser: boolean;
};

async function extractAuthContext(params: unknown, client: unknown): Promise<AuthContext> {
  let userId: string | null = null;

  const paramsAny = params as { token?: string; sessionKey?: string } | null;
  const paramsSessionKey = typeof paramsAny?.sessionKey === "string" ? paramsAny.sessionKey : undefined;

  if (paramsAny?.token) {
    const payload = verifyTokenPayload(paramsAny.token);
    if (payload?.sub) {
      userId = payload.sub;
    }
  }

  if (!userId && paramsSessionKey?.startsWith("agent:main:")) {
    userId = paramsSessionKey.replace("agent:main:", "");
  }

  if (!userId) {
    userId = getCurrentUserId(client as any, params as any);
  }

  const admin = isAdmin(client as any, params as any);
  return { userId, isAdminUser: admin };
}

async function getAuthorizedCronIds(
  userId: string | null,
  isAdminUser: boolean,
  context: { cron: { list(): Promise<Array<{ id: string; sessionKey?: string }>> } },
): Promise<Set<string> | null> {
  if (isAdminUser) return null;
  if (!userId) return new Set<string>();

  try {
    const { getUserDataService } = await import("../../auth/user-data.js");
    const userDataService = getUserDataService();
    const userCrons = await userDataService.listUserCrons(userId);
    const allowedCronIds = new Set(userCrons.map((c) => c.cronId));

    const jobs = await context.cron.list({ includeDisabled: true });
    for (const job of jobs) {
      if (job.sessionKey?.includes(userId)) {
        allowedCronIds.add(job.id);
      }
    }

    return allowedCronIds;
  } catch {
    return new Set<string>();
  }
}

export const cronHandlers: GatewayRequestHandlers = {
  wake: ({ params, respond, context }) => {
    if (!validateWakeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wake params: ${formatValidationErrors(validateWakeParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      mode: "now" | "next-heartbeat";
      text: string;
    };
    const result = context.cron.wake({ mode: p.mode, text: p.text });
    respond(true, result, undefined);
  },
  "cron.list": async ({ params, respond, context, client }) => {
    if (!validateCronListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.list params: ${formatValidationErrors(validateCronListParams.errors)}`,
        ),
      );
      return;
    }

    // Set user context for data isolation
    await setUserContext(client, params);

    const p = params as {
      includeDisabled?: boolean;
      limit?: number;
      offset?: number;
      query?: string;
      enabled?: "all" | "enabled" | "disabled";
      sortBy?: "nextRunAtMs" | "updatedAtMs" | "name";
      sortDir?: "asc" | "desc";
    };
    let page = await context.cron.listPage({
      includeDisabled: p.includeDisabled,
      limit: p.limit,
      offset: p.offset,
      query: p.query,
      enabled: p.enabled,
      sortBy: p.sortBy,
      sortDir: p.sortDir,
    });

    // Apply data isolation: filter by user_id
    // Priority: 1. params.token, 2. sessionKey format, 3. client connection
    let userId = params?.token ? verifyTokenPayload(params.token)?.sub : null;
    
    // Try to extract userId from sessionKey in params
    const paramsSessionKey = typeof (params as { sessionKey?: unknown } | null)?.sessionKey === "string"
      ? (params as { sessionKey: string }).sessionKey
      : undefined;
    if (!userId && paramsSessionKey && paramsSessionKey.startsWith('agent:main:')) {
      userId = paramsSessionKey.replace('agent:main:', '');
    }
    
    if (!userId) {
      userId = getCurrentUserId(client, params);
    }
    const admin = isAdmin(client, params);
    
    // If userId is email (not UUID), resolve to UUID
    if (userId && !admin && !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      try {
        const { getAuthService } = await import("../../auth/service.js");
        const authService = getAuthService();
        userId = await authService.getUserIdByEmail(userId) ?? userId;
      } catch {
      }
    }
    
    if (!admin && !userId) {
      page.jobs = [];
      page.total = 0;
      respond(true, page, undefined);
      return;
    }
    
    if (admin) {
      respond(true, page, undefined);
      return;
    }
    
    if (userId) {
      const authorizedIds = await getAuthorizedCronIds(userId, admin, context);
      if (authorizedIds !== null && page.jobs) {
        const originalCount = page.jobs.length;
        page.jobs = page.jobs.filter(job => authorizedIds.has(job.id));
        page.total = page.jobs.length;
      }
    }

    respond(true, page, undefined);
  },
  "cron.status": async ({ params, respond, context }) => {
    if (!validateCronStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.status params: ${formatValidationErrors(validateCronStatusParams.errors)}`,
        ),
      );
      return;
    }
    const status = await context.cron.status();
    respond(true, status, undefined);
  },
  "cron.add": async ({ params, respond, context, client }) => {
    // Extract sessionKey from params
    const paramsSessionKey =
      typeof (params as { sessionKey?: unknown } | null)?.sessionKey === "string"
        ? (params as { sessionKey: string }).sessionKey
        : undefined;
    
    // Extract userId from sessionKey (format: agent:main:${userId})
    let userIdFromSessionKey: string | null = null;
    if (paramsSessionKey && paramsSessionKey.startsWith('agent:main:')) {
      userIdFromSessionKey = paramsSessionKey.replace('agent:main:', '');
    }
    
    const normalized =
      normalizeCronJobCreate(params, {
        sessionContext: { sessionKey: paramsSessionKey },
      }) ?? params;
    if (!validateCronAddParams(normalized)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.add params: ${formatValidationErrors(validateCronAddParams.errors)}`,
        ),
      );
      return;
    }
    const jobCreate = normalized as unknown as CronJobCreate;
    const timestampValidation = validateScheduleTimestamp(jobCreate.schedule);
    if (!timestampValidation.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
      );
      return;
    }
    
    // Set user context
    await setUserContext(client, params);
    
    // Default sessionTarget to "main" if not specified
    if (!jobCreate.sessionTarget) {
      jobCreate.sessionTarget = "main";
    }
    
    // Default sessionKey to user's session if not specified
    if (!jobCreate.sessionKey && userIdFromSessionKey) {
      jobCreate.sessionKey = `agent:main:${userIdFromSessionKey}`;
    }
    
    const job = await context.cron.add(jobCreate);
    context.logGateway.info("cron: job created", { jobId: job.id, schedule: jobCreate.schedule, sessionKey: job.sessionKey });

    // Sync to database for user data isolation
    let userId = params?.token ? verifyTokenPayload(params.token)?.sub : null;
    if (!userId && userIdFromSessionKey) {
      userId = userIdFromSessionKey;
    }
    if (!userId) {
      userId = getCurrentUserId(client, params);
    }
    const admin = isAdmin(client, params);
    
    // If userId is an email (not UUID), resolve to UUID
    if (userId && !admin && !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      try {
        const { getAuthService } = await import("../../auth/service.js");
        const authService = getAuthService();
        const resolvedUserId = await authService.getUserIdByEmail(userId);
        userId = resolvedUserId;
      } catch {
      }
    }
    
    if (userId) {
      try {
        const { getUserDataService } = await import("../../auth/user-data.js");
        const userDataService = getUserDataService();
        const existing = await userDataService.getUserCron(userId, job.id);
        if (!existing) {
          await userDataService.createUserCron(
            userId,
            job.id,
            job.name ?? undefined,
            job.description ?? undefined,
            undefined,
            job.schedule as Record<string, unknown>
          );
        }
      } catch {
        // Non-fatal: cron job is created, user link will be retried on next access
      }
    }

    respond(true, job, undefined);
  },
  "cron.update": async ({ params, respond, context }) => {
    const normalizedPatch = normalizeCronJobPatch((params as { patch?: unknown } | null)?.patch);
    const candidate =
      normalizedPatch && typeof params === "object" && params !== null
        ? { ...params, patch: normalizedPatch }
        : params;
    if (!validateCronUpdateParams(candidate)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.update params: ${formatValidationErrors(validateCronUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = candidate as {
      id?: string;
      jobId?: string;
      patch: Record<string, unknown>;
    };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.update params: missing id"),
      );
      return;
    }

    const auth = await extractAuthContext(params, client);
    if (!auth.isAdminUser && !auth.userId) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Not authorized to update this job"));
      return;
    }
    const authorizedIds = await getAuthorizedCronIds(auth.userId, auth.isAdminUser, context);
    if (authorizedIds !== null && !authorizedIds.has(jobId)) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Not authorized to update this job"));
      return;
    }

    const patch = p.patch as unknown as CronJobPatch;
    if (patch.schedule) {
      const timestampValidation = validateScheduleTimestamp(patch.schedule);
      if (!timestampValidation.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
        );
        return;
      }
    }
    const job = await context.cron.update(jobId, patch);
    context.logGateway.info("cron: job updated", { jobId });
    respond(true, job, undefined);
  },
  "cron.remove": async ({ params, respond, context }) => {
    if (!validateCronRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.remove params: ${formatValidationErrors(validateCronRemoveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.remove params: missing id"),
      );
      return;
    }

    const auth = await extractAuthContext(params, client);
    if (!auth.isAdminUser && !auth.userId) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Not authorized to remove this job"));
      return;
    }
    const authorizedIds = await getAuthorizedCronIds(auth.userId, auth.isAdminUser, context);
    if (authorizedIds !== null && !authorizedIds.has(jobId)) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Not authorized to remove this job"));
      return;
    }

    const result = await context.cron.remove(jobId);
    if (result.removed) {
      context.logGateway.info("cron: job removed", { jobId });
    }
    respond(true, result, undefined);
  },
  "cron.run": async ({ params, respond, context }) => {
    if (!validateCronRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.run params: ${formatValidationErrors(validateCronRunParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string; mode?: "due" | "force" };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.run params: missing id"),
      );
      return;
    }

    const auth = await extractAuthContext(params, client);
    if (!auth.isAdminUser && !auth.userId) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Not authorized to run this job"));
      return;
    }
    const authorizedIds = await getAuthorizedCronIds(auth.userId, auth.isAdminUser, context);
    if (authorizedIds !== null && !authorizedIds.has(jobId)) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Not authorized to run this job"));
      return;
    }

    const result = await context.cron.enqueueRun(jobId, p.mode ?? "force");
    respond(true, result, undefined);
  },
  "cron.runs": async ({ params, respond, context }) => {
    if (!validateCronRunsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.runs params: ${formatValidationErrors(validateCronRunsParams.errors)}`,
        ),
      );
      return;
    }

    const auth = await extractAuthContext(params, client);
    const { userId, isAdminUser } = auth;

    if (!isAdminUser && !userId) {
      respond(true, { entries: [], total: 0, offset: 0, limit: 50, hasMore: false, nextOffset: null }, undefined);
      return;
    }

    const p = params as {
      scope?: "job" | "all";
      id?: string;
      jobId?: string;
      limit?: number;
      offset?: number;
      statuses?: Array<"ok" | "error" | "skipped">;
      status?: "all" | "ok" | "error" | "skipped";
      deliveryStatuses?: Array<"delivered" | "not-delivered" | "unknown" | "not-requested">;
      deliveryStatus?: "delivered" | "not-delivered" | "unknown" | "not-requested";
      query?: string;
      sortDir?: "asc" | "desc";
    };
    const explicitScope = p.scope;
    const jobId = p.id ?? p.jobId;
    const scope: "job" | "all" = explicitScope ?? (jobId ? "job" : "all");
    if (scope === "job" && !jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: missing id"),
      );
      return;
    }

    const authorizedIds = await getAuthorizedCronIds(userId, isAdminUser, context);

    if (scope === "all") {
      const jobs = await context.cron.list({ includeDisabled: true });
      const jobNameById = Object.fromEntries(
        jobs
          .filter((job) => typeof job.id === "string" && typeof job.name === "string")
          .map((job) => [job.id, job.name]),
      );
      const page = await readCronRunLogEntriesPageAll({
        storePath: context.cronStorePath,
        limit: p.limit,
        offset: p.offset,
        statuses: p.statuses,
        status: p.status,
        deliveryStatuses: p.deliveryStatuses,
        deliveryStatus: p.deliveryStatus,
        query: p.query,
        sortDir: p.sortDir,
        jobNameById,
      });

      if (authorizedIds !== null) {
        const originalCount = page.entries.length;
        page.entries = page.entries.filter((entry) => authorizedIds.has(entry.jobId));
        page.total = page.entries.length;
      }

      respond(true, page, undefined);
      return;
    }

    if (authorizedIds !== null && !authorizedIds.has(jobId as string)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.FORBIDDEN, "Not authorized to view this job's runs"),
      );
      return;
    }

    let logPath: string;
    try {
      logPath = resolveCronRunLogPath({
        storePath: context.cronStorePath,
        jobId: jobId as string,
      });
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: invalid id"),
      );
      return;
    }
    const page = await readCronRunLogEntriesPage(logPath, {
      limit: p.limit,
      offset: p.offset,
      jobId: jobId as string,
      statuses: p.statuses,
      status: p.status,
      deliveryStatuses: p.deliveryStatuses,
      deliveryStatus: p.deliveryStatus,
      query: p.query,
      sortDir: p.sortDir,
    });
    respond(true, page, undefined);
  },
};
