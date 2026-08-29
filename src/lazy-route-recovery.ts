export type RouteRecoveryStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type RouteRecoveryOptions = {
  buildId: string;
  routeKey: string;
  storage: RouteRecoveryStorage;
  reload: () => void;
};

const STALE_CHUNK_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [^ ]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS for/i,
];

export function isStaleRouteChunkError(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name || '')
    : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return STALE_CHUNK_PATTERNS.some(pattern => pattern.test(`${name}: ${message}`));
}

export function routeRecoveryGuardKey(buildId: string, routeKey: string) {
  return `curated-luxury:route-chunk-recovery:${encodeURIComponent(buildId || 'unknown')}:${encodeURIComponent(routeKey || 'unknown')}`;
}

export function requestOneShotRouteRecovery(error: unknown, options: RouteRecoveryOptions) {
  if (!isStaleRouteChunkError(error)) return false;
  const guardKey = routeRecoveryGuardKey(options.buildId, options.routeKey);
  try {
    if (options.storage.getItem(guardKey) === 'attempted') return false;
    // Persist the guard before reloading. If reload is delayed or the new
    // deployment is also missing its chunk, the same build/route cannot loop.
    options.storage.setItem(guardKey, 'attempted');
  } catch {
    // Session storage can be disabled. In that case show the route fallback
    // instead of risking an unguarded reload loop.
    return false;
  }
  options.reload();
  return true;
}

export async function loadRouteModuleWithRecovery<T>(
  importer: () => Promise<T>,
  options: RouteRecoveryOptions,
) {
  try {
    return await importer();
  } catch (error) {
    requestOneShotRouteRecovery(error, options);
    // The reload normally replaces this document immediately. Rejecting as
    // well lets the route error boundary remain visible if navigation stalls.
    throw error;
  }
}
