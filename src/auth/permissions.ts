import { getAuthService } from "../../auth/service.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export type Permission = 
    // User management
    | 'users:list' | 'users:create' | 'users:update' | 'users:delete' | 'users:manage-roles'
    | 'users:view-profile' | 'users:update-profile'
    // Settings
    | 'settings:read' | 'settings:write' | 'settings:appearance' | 'settings:notifications'
    // Agents
    | 'agents:create' | 'agents:read' | 'agents:update' | 'agents:delete' | 'agents:manage-all'
    // Sessions
    | 'sessions:create' | 'sessions:read' | 'sessions:delete'
    // Channels
    | 'channels:create' | 'channels:read' | 'channels:update' | 'channels:delete' | 'channels:manage-all'
    // Automation
    | 'automation:create' | 'automation:read' | 'automation:update' | 'automation:delete'
    // Infrastructure
    | 'infrastructure:manage'
    // AI & Models
    | 'ai:manage-models' | 'ai:view-usage'
    // Debug
    | 'debug:view-logs' | 'debug:manage'
    // Logs
    | 'logs:read' | 'logs:manage';

const PERMISSION_CACHE = new Map<string, Set<Permission>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function checkPermission(
    userId: string,
    permission: Permission
): Promise<boolean> {
    try {
        const authService = getAuthService();
        const user = await authService.getUserById(userId);
        
        if (!user) {
            return false;
        }

        // Admin always has all permissions
        if (user.role === 'admin') {
            return true;
        }

        // Check cache first
        const cacheKey = `${user.role}`;
        const cached = PERMISSION_CACHE.get(cacheKey);
        if (cached && cached.has(permission)) {
            return true;
        }

        // Check database
        const hasPerm = await authService.hasPermission(user.role, permission);
        
        // Update cache
        if (!PERMISSION_CACHE.has(cacheKey)) {
            PERMISSION_CACHE.set(cacheKey, new Set());
        }
        if (hasPerm) {
            PERMISSION_CACHE.get(cacheKey)!.add(permission);
        }
        
        return hasPerm;
    } catch (error) {
        console.error('[permission] Error checking permission:', error);
        return false;
    }
}

export function clearPermissionCache(role?: string) {
    if (role) {
        PERMISSION_CACHE.delete(role);
    } else {
        PERMISSION_CACHE.clear();
    }
}

export function requirePermission(permission: Permission) {
    return async (
        params: any,
        client: any,
        getUserId: () => string | null
    ): Promise<{ allowed: boolean; error?: string }> => {
        const userId = getUserId();
        
        if (!userId) {
            return { 
                allowed: false, 
                error: 'Authentication required' 
            };
        }

        const hasPermission = await checkPermission(userId, permission);
        
        if (!hasPermission) {
            return { 
                allowed: false, 
                error: `Permission '${permission}' required` 
            };
        }

        return { allowed: true };
    };
}

// Settings-related permissions that only admins should have
export const ADMIN_ONLY_PERMISSIONS: Permission[] = [
    'users:list',
    'users:create', 
    'users:update',
    'users:delete',
    'users:manage-roles',
    'settings:read',
    'settings:write',
    'settings:appearance',
    'settings:notifications',
    'channels:manage-all',
    'agents:manage-all',
    'infrastructure:manage',
    'ai:manage-models',
    'debug:manage',
    'logs:manage'
];

export function isAdminOnlyMethod(method: string): boolean {
    const adminMethods: Record<string, Permission[]> = {
        'auth.admin.': [
            'users:list', 'users:create', 'users:update', 'users:delete', 'users:manage-roles'
        ],
        'settings.': ['settings:read', 'settings:write'],
        'channels.': ['channels:manage-all'],
        'infrastructure.': ['infrastructure:manage'],
        'debug.': ['debug:view-logs', 'debug:manage'],
        'logs.': ['logs:read', 'logs:manage'],
        'ai.': ['ai:manage-models']
    };

    for (const [prefix, perms] of Object.entries(adminMethods)) {
        if (method.startsWith(prefix)) {
            return perms.some(p => !p.includes(':read') || p === 'logs:read');
        }
    }
    
    return false;
}
