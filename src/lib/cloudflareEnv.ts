import { AsyncLocalStorage } from "node:async_hooks";

// Bridges the raw Cloudflare Workers `env` (bindings like KV namespaces) —
// only available in src/server.ts's fetch handler — into code reached via
// TanStack Start server functions, which don't expose it directly.
// Undefined during local `vite dev` (no real Workers runtime), so callers
// must handle a missing binding gracefully.
export type CloudflareEnv = {
  VCLOTHES_SCANS?: KVNamespace;
};

const storage = new AsyncLocalStorage<CloudflareEnv>();

export function runWithCloudflareEnv<T>(env: CloudflareEnv, fn: () => T): T {
  return storage.run(env, fn);
}

export function getCloudflareEnv(): CloudflareEnv | undefined {
  return storage.getStore();
}

// Minimal shape of the binding we use — avoids depending on @cloudflare/workers-types.
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
