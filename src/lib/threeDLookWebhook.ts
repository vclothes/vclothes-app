import { parsePersonWebhookBody } from "./threedlook";
import type { CloudflareEnv } from "./cloudflareEnv";

// Receives 3DLOOK's "update_person" webhook (registered in their Mobile
// Tailor admin panel under Settings → API → Webhook endpoints). Fires when a
// person's scan — including ones done through 3DLOOK's own QR-code capture
// page, not just ones we create via the API — changes status.
//
// No documented signature/auth scheme for these webhooks, so this just
// accepts any well-formed payload. Fine for a low-traffic project; would
// need real verification before handling anything sensitive.
export async function handleThreeDLookWebhook(request: Request, env: CloudflareEnv): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const status = parsePersonWebhookBody(body as Parameters<typeof parsePersonWebhookBody>[0]);

  const kv = env.VCLOTHES_SCANS;
  if (kv && status.isReady) {
    await kv.put("latest_scan", JSON.stringify(status), { expirationTtl: 3600 });
  }

  return new Response("ok", { status: 200 });
}
