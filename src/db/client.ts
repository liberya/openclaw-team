import { createLogger } from "../logging.js";
import type { Database } from "pg";

const log = createLogger("db/client");

export interface DbConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
}

export interface DbClient {
    query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
    execute(sql: string, params?: unknown[]): Promise<number>;
    close(): Promise<void>;
    isConnected(): boolean;
}

let dbClient: DbClient | null = null;

export function createPostgresClient(config: DbConfig): DbClient {
    let pg: typeof import("pg");
    
    async function getPg() {
        if (!pg) {
            pg = await import("pg");
        }
        return pg;
    }

    const client = {
        query: async <T = unknown>(sql: string, params?: unknown[]): Promise<T[]> => {
            const pgModule = await getPg();
            const c = new pgModule.Client({
                host: config.host,
                port: config.port,
                database: config.database,
                user: config.user,
                password: config.password,
                ssl: config.ssl ? { rejectUnauthorized: false } : false,
            });
            try {
                await c.connect();
                const result = await c.query(sql, params);
                return result.rows as T[];
            } finally {
                await c.end();
            }
        },
        queryOne: async <T = unknown>(sql: string, params?: unknown[]): Promise<T | null> => {
            const rows = await client.query<T>(sql, params);
            return rows[0] ?? null;
        },
        execute: async (sql: string, params?: unknown[]): Promise<number> => {
            const pgModule = await getPg();
            const c = new pgModule.Client({
                host: config.host,
                port: config.port,
                database: config.database,
                user: config.user,
                password: config.password,
                ssl: config.ssl ? { rejectUnauthorized: false } : false,
            });
            try {
                await c.connect();
                const result = await c.query(sql, params);
                return result.rowCount ?? 0;
            } finally {
                await c.end();
            }
        },
        close: async (): Promise<void> => {
            log.info("PostgreSQL client closed");
        },
        isConnected: (): boolean => true,
    };
    
    return client;
}

export class InMemoryDbClient implements DbClient {
    private data: Map<string, Map<string, unknown>> = new Map();

    async query<T = unknown>(_sql: string, _params?: unknown[]): Promise<T[]> {
        return [];
    }

    async queryOne<T = unknown>(_sql: string, _params?: unknown[]): Promise<T | null> {
        return null;
    }

    async execute(_sql: string, _params?: unknown[]): Promise<number> {
        return 0;
    }

    async close(): Promise<void> {
        this.data.clear();
    }

    isConnected(): boolean {
        return true;
    }
}

export async function initDatabase(config?: DbConfig): Promise<DbClient> {
    if (config) {
        log.info("Initializing PostgreSQL client", { host: config.host, database: config.database });
        dbClient = createPostgresClient(config);
    } else {
        log.info("Using in-memory database client (development mode)");
        dbClient = new InMemoryDbClient();
    }
    return dbClient;
}

export function getDbClient(): DbClient {
    if (!dbClient) {
        throw new Error("Database not initialized. Call initDatabase() first.");
    }
    return dbClient;
}

export async function closeDatabase(): Promise<void> {
    if (dbClient) {
        await dbClient.close();
        dbClient = null;
    }
}