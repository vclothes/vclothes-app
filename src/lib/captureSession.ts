import { createServerFn } from "@tanstack/react-start";
import { getCloudflareEnv } from "./cloudflareEnv";
import { createScan, getScanResult, type Gender, type ScanStatus } from "./threedlook";

// Bridges the kiosk (fills in name/gender/height/weight, shows a QR code) and
// the visitor's phone (scans the QR, takes the two photos) — both sides poll
// this shared, KV-backed session rather than talking to each other directly.
const SESSION_TTL_SECONDS = 30 * 60;

export type CaptureSessionState =
  | { status: "waiting_photos"; name: string; gender: Gender; heightCm: number; weightKg: number }
  | { status: "processing"; name: string; taskSetId: string }
  | { status: "done"; name: string; result: ScanStatus }
  | { status: "failed"; name: string; message: string };

function sessionKey(sessionId: string) {
  return `session:${sessionId}`;
}

export const createCaptureSession = createServerFn({ method: "POST" })
  .validator((data: { name: string; gender: Gender; heightCm: number; weightKg: number }) => data)
  .handler(async ({ data }): Promise<{ sessionId: string }> => {
    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    if (!kv) throw new Error("Armazenamento indisponível no servidor.");

    const sessionId = crypto.randomUUID();
    const state: CaptureSessionState = { status: "waiting_photos", ...data };
    await kv.put(sessionKey(sessionId), JSON.stringify(state), {
      expirationTtl: SESSION_TTL_SECONDS,
    });

    return { sessionId };
  });

export const getCaptureSession = createServerFn({ method: "GET" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }): Promise<CaptureSessionState | null> => {
    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    if (!kv) return null;

    const raw = await kv.get(sessionKey(data.sessionId));
    return raw ? (JSON.parse(raw) as CaptureSessionState) : null;
  });

export const submitCapturePhotos = createServerFn({ method: "POST" })
  .validator(
    (data: { sessionId: string; frontImageBase64: string; sideImageBase64: string }) => data,
  )
  .handler(async ({ data }): Promise<void> => {
    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    if (!kv) throw new Error("Armazenamento indisponível no servidor.");

    const raw = await kv.get(sessionKey(data.sessionId));
    if (!raw) throw new Error("Sessão expirada ou inválida. Peça um novo QR code.");

    const session = JSON.parse(raw) as CaptureSessionState;
    if (session.status !== "waiting_photos") {
      throw new Error("Essa sessão já recebeu fotos.");
    }

    const { taskSetId } = await createScan({
      data: {
        gender: session.gender,
        heightCm: session.heightCm,
        weightKg: session.weightKg,
        frontImageBase64: data.frontImageBase64,
        sideImageBase64: data.sideImageBase64,
      },
    });

    const next: CaptureSessionState = { status: "processing", name: session.name, taskSetId };
    await kv.put(sessionKey(data.sessionId), JSON.stringify(next), {
      expirationTtl: SESSION_TTL_SECONDS,
    });
  });

// Called by the kiosk while it waits. If the scan is done processing, this
// also persists the final state so it doesn't need to be recomputed on the
// next poll (and so the phone, if it checks back, sees the same answer).
export const pollCaptureSession = createServerFn({ method: "GET" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }): Promise<CaptureSessionState | null> => {
    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    if (!kv) return null;

    const raw = await kv.get(sessionKey(data.sessionId));
    if (!raw) return null;

    const session = JSON.parse(raw) as CaptureSessionState;
    if (session.status !== "processing") return session;

    const result = await getScanResult({ data: { taskSetId: session.taskSetId } });
    if (!result.isReady) return session;

    const next: CaptureSessionState = result.isSuccessful
      ? { status: "done", name: session.name, result }
      : { status: "failed", name: session.name, message: (result.failureMessages ?? []).join(" ") };

    await kv.put(sessionKey(data.sessionId), JSON.stringify(next), {
      expirationTtl: SESSION_TTL_SECONDS,
    });
    return next;
  });
