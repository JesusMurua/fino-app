import { environment } from '../../../environments/environment';

/**
 * Base URL for SignalR hub endpoints.
 *
 * The backend mounts SignalR hubs at **root** paths via `app.MapHub<>(...)`
 * in `Program.cs` (e.g. `/hubs/kds`, `/hubs/bridge`) — NOT under the
 * `/api` prefix that REST controllers live under. Using `environment.apiUrl`
 * directly produces `https://host/api/hubs/kds` which 404s at the routing
 * layer (kestrel never reaches the hub mapping).
 *
 * This constant strips the trailing `/api` (with or without trailing slash)
 * exactly once at module load — `environment.apiUrl` is a build-time
 * compile-time constant per Angular configuration, so memoization here is
 * both safe and free.
 *
 * Usage:
 * ```ts
 * import { SIGNALR_BASE_URL } from '../utils/signalr.utils';
 * const hubUrl = `${SIGNALR_BASE_URL}/hubs/bridge`;
 * ```
 *
 * Regex notes — `/\/api\/?$/` matches `/api` or `/api/` strictly at the
 * end of the string. It deliberately does NOT match middle-of-string
 * occurrences like `/v1/api/foo` so unrelated segments are preserved.
 */
export const SIGNALR_BASE_URL = environment.apiUrl.replace(/\/api\/?$/, '');
