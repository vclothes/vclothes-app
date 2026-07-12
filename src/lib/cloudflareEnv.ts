// Cloudflare bindings (KV, etc.) aren't exposed to TanStack Start server
// functions or our custom src/server.ts entry through any documented
// framework API — confirmed by tracing it: Nitro's own compiled Cloudflare
// module handler (node_modules/nitro/dist/presets/cloudflare/runtime/
// _module-handler.mjs) stashes the real platform `env` on
// `globalThis.__env__` before dispatching the request, and that's the only
// place it's reliably available. This reads it back from there.
export type CloudflareEnv = {
  VCLOTHES_SCANS?: KVNamespace;
};

export function getCloudflareEnv(): CloudflareEnv | undefined {
  return (globalThis as unknown as { __env__?: CloudflareEnv }).__env__;
}

// Minimal shape of the binding we use — avoids depending on @cloudflare/workers-types.
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
