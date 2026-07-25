import { createCsrfMiddleware, createStart, createMiddleware } from "@tanstack/react-start";

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

// Now that login/register/logout rely on a session cookie, server functions
// need real CSRF protection — without it, another site could make a logged-in
// visitor's browser fire an authenticated request (e.g. log them out, or
// worse if a more sensitive action gets added later) just by them loading a
// malicious page. This was flagged automatically in dev; not something to
// leave unaddressed once real accounts are involved.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, errorMiddleware],
}));
