import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

// Local dev only: `vite dev` doesn't read Wrangler's `.dev.vars` the way the
// real Cloudflare Workers runtime does, so load it into process.env by hand.
// No-ops (and never throws) in production, where secrets come from Cloudflare.
try {
  process.loadEnvFile?.(".dev.vars");
} catch {
  // .dev.vars not present (e.g. production) — ignore.
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
