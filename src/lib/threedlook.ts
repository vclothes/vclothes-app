import { createServerFn } from "@tanstack/react-start";
import { getCloudflareEnv } from "./cloudflareEnv";

const API_BASE = "https://saia.3dlook.me/api/v2";

function authHeaders() {
  const apiKey = process.env.THREEDLOOK_API_KEY;
  if (!apiKey) {
    throw new Error("THREEDLOOK_API_KEY não configurada no servidor.");
  }
  return {
    Authorization: `APIKey ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function stripDataUrlPrefix(base64: string) {
  const commaIndex = base64.indexOf(",");
  return base64.startsWith("data:") && commaIndex !== -1 ? base64.slice(commaIndex + 1) : base64;
}

// Human-friendly translations for the failure messages 3DLOOK's sub_tasks return.
// Falls back to the raw message if we don't recognize it.
const KNOWN_FAILURE_MESSAGES: Record<string, string> = {
  "Can't detect the human body":
    "Não conseguimos identificar um corpo na foto. Tente novamente com boa iluminação, fundo liso e o corpo inteiro visível.",
};

export type Gender = "male" | "female";

export type CreateScanInput = {
  gender: Gender;
  heightCm: number;
  weightKg: number;
  frontImageBase64: string;
  sideImageBase64: string;
};

export type CreateScanResult = {
  taskSetId: string;
};

export type ScanStatus = {
  isReady: boolean;
  isSuccessful?: boolean;
  volumeParams?: Record<string, number | null>;
  frontParams?: Record<string, number | null>;
  sideParams?: Record<string, number | null>;
  failureMessages?: string[];
};

// Shared by getScanResult (queue polling) and the 3DLOOK webhook receiver —
// both end up with the same "task_set + measurements" shape, just reached
// through different API calls.
export function parsePersonWebhookBody(body: {
  task_set?: { is_ready?: boolean; is_successful?: boolean; sub_tasks?: { message?: string }[] };
  volume_params?: Record<string, number | null>;
  front_params?: Record<string, number | null>;
  side_params?: Record<string, number | null>;
}): ScanStatus {
  const taskSet = body?.task_set;
  if (!taskSet?.is_ready) {
    return { isReady: false };
  }

  if (!taskSet.is_successful) {
    const failureMessages = (taskSet.sub_tasks ?? [])
      .map((t) => t.message)
      .filter((m): m is string => Boolean(m))
      .map((m) => KNOWN_FAILURE_MESSAGES[m] ?? m);

    return {
      isReady: true,
      isSuccessful: false,
      failureMessages: failureMessages.length > 0 ? failureMessages : ["O escaneamento falhou. Tente novamente."],
    };
  }

  return {
    isReady: true,
    isSuccessful: true,
    volumeParams: body.volume_params,
    frontParams: body.front_params,
    sideParams: body.side_params,
  };
}

export const createScan = createServerFn({ method: "POST" })
  .validator((data: CreateScanInput) => data)
  .handler(async ({ data }): Promise<CreateScanResult> => {
    const response = await fetch(`${API_BASE}/persons/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        gender: data.gender,
        height: Math.round(data.heightCm),
        weight: data.weightKg,
        front_image: stripDataUrlPrefix(data.frontImageBase64),
        side_image: stripDataUrlPrefix(data.sideImageBase64),
      }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        `Falha ao criar escaneamento (${response.status}): ${JSON.stringify(body)}`,
      );
    }

    // The API returns { task_set_url: "https://saia.3dlook.me/api/v2/queue/<taskSetId>/" }
    // — no person id yet. We look the person up by task_set_url once processing finishes.
    const taskSetUrl: string | undefined = body?.task_set_url;
    const taskSetId = taskSetUrl?.split("/").filter(Boolean).pop();

    if (!taskSetId) {
      throw new Error(`Resposta inesperada da 3DLOOK ao criar escaneamento: ${JSON.stringify(body)}`);
    }

    return { taskSetId };
  });

export const getScanResult = createServerFn({ method: "GET" })
  .validator((data: { taskSetId: string }) => data)
  .handler(async ({ data }): Promise<ScanStatus> => {
    const queueResponse = await fetch(`${API_BASE}/queue/${data.taskSetId}/`, {
      headers: authHeaders(),
    });
    const queueBody = await queueResponse.json().catch(() => null);

    if (!queueResponse.ok) {
      throw new Error(
        `Falha ao consultar status do escaneamento (${queueResponse.status}): ${JSON.stringify(queueBody)}`,
      );
    }

    if (!queueBody?.is_ready) {
      return { isReady: false };
    }

    if (!queueBody.is_successful) {
      const failureMessages = (queueBody.sub_tasks ?? [])
        .map((t: { message?: string }) => t.message)
        .filter((m: string | undefined): m is string => Boolean(m))
        .map((m: string) => KNOWN_FAILURE_MESSAGES[m] ?? m);

      return {
        isReady: true,
        isSuccessful: false,
        failureMessages: failureMessages.length > 0 ? failureMessages : ["O escaneamento falhou. Tente novamente."],
      };
    }

    const personsResponse = await fetch(
      `${API_BASE}/persons/?task_set_url__icontains=${data.taskSetId}&measurements_type=all`,
      { headers: authHeaders() },
    );
    const personsBody = await personsResponse.json().catch(() => null);

    if (!personsResponse.ok) {
      throw new Error(
        `Falha ao buscar medidas (${personsResponse.status}): ${JSON.stringify(personsBody)}`,
      );
    }

    const person = personsBody?.results?.[0];

    return {
      isReady: true,
      isSuccessful: true,
      volumeParams: person?.volume_params,
      frontParams: person?.front_params,
      sideParams: person?.side_params,
    };
  });

// Reads the most recently completed scan reported by 3DLOOK's "update_person"
// webhook (see src/lib/threeDLookWebhook.ts). Used for the QR-code handoff
// flow: the person scans on 3DLOOK's own hosted page, and when they come
// back to us we just check whether a fresh result has arrived.
//
// Simplification: this is a single global "latest scan" slot, not per-visitor
// — correct for a one-person-at-a-time science-fair booth, but would need a
// real per-session key (or the person's 3DLOOK id) to support concurrent use.
export const getLatestScan = createServerFn({ method: "GET" }).handler(async (): Promise<ScanStatus | null> => {
  const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
  if (!kv) return null;

  const raw = await kv.get("latest_scan");
  if (!raw) return null;

  return JSON.parse(raw) as ScanStatus;
});

// Called right before sending someone off to scan on 3DLOOK's page, so a
// stale result left over from a previous visitor's scan (the KV slot is
// global, see getLatestScan) can't be mistaken for theirs.
export const clearLatestScan = createServerFn({ method: "POST" }).handler(async () => {
  const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
  if (!kv) return;
  await kv.delete("latest_scan");
});
