import { createServerFn } from "@tanstack/react-start";

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

// Plain fetch() has no timeout — if 3DLOOK's server never responds, the
// request (and everything awaiting it, all the way up to the UI showing
// "Perfil em carregamento") just hangs forever with no way out. This gives
// every call a hard ceiling so a slow/unresponsive upstream turns into a
// clear error instead of an infinite spinner.
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `A 3DLOOK não respondeu em ${Math.round(timeoutMs / 1000)}s. Tente novamente.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Human-friendly translations for the failure messages 3DLOOK's sub_tasks return.
// Falls back to the raw message if we don't recognize it.
const KNOWN_FAILURE_MESSAGES: Record<string, string> = {
  "Can't detect the human body":
    "Não conseguimos identificar um corpo na foto. Tente novamente com boa iluminação, fundo liso e o corpo inteiro visível.",
  "The body is not full":
    "Uma das fotos não mostrava o corpo inteiro (provavelmente os pés ou a cabeça ficaram fora do quadro). Afaste-se mais da câmera e tente novamente.",
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
  // The .obj 3D mesh 3DLOOK generates from the two photos. Not in their
  // public API docs — found by inspecting a real person record directly:
  // it's volume_params.body_model, an S3 URL with open CORS.
  modelUrl?: string;
};

export const createScan = createServerFn({ method: "POST" })
  .validator((data: CreateScanInput) => data)
  .handler(async ({ data }): Promise<CreateScanResult> => {
    const response = await fetchWithTimeout(
      `${API_BASE}/persons/`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          gender: data.gender,
          height: Math.round(data.heightCm),
          weight: data.weightKg,
          front_image: stripDataUrlPrefix(data.frontImageBase64),
          side_image: stripDataUrlPrefix(data.sideImageBase64),
        }),
      },
      30_000,
    );

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`Falha ao criar escaneamento (${response.status}): ${JSON.stringify(body)}`);
    }

    // The API returns { task_set_url: "https://saia.3dlook.me/api/v2/queue/<taskSetId>/" }
    // — no person id yet. We look the person up by task_set_url once processing finishes.
    const taskSetUrl: string | undefined = body?.task_set_url;
    const taskSetId = taskSetUrl?.split("/").filter(Boolean).pop();

    if (!taskSetId) {
      throw new Error(
        `Resposta inesperada da 3DLOOK ao criar escaneamento: ${JSON.stringify(body)}`,
      );
    }

    return { taskSetId };
  });

function extractFailureMessages(subTasks: { message?: string }[] | undefined): string[] {
  const messages = (subTasks ?? [])
    .map((t) => t.message)
    .filter((m): m is string => Boolean(m))
    .map((m) => KNOWN_FAILURE_MESSAGES[m] ?? m);
  return messages.length > 0 ? messages : ["O escaneamento falhou. Tente novamente."];
}

// POST, not GET, even though this only reads data — same reasoning as
// createScan being POST: keeps this off any HTTP cache path, which matters
// for a polling call hitting the same URL repeatedly.
export const getScanResult = createServerFn({ method: "POST" })
  .validator((data: { taskSetId: string }) => data)
  .handler(async ({ data }): Promise<ScanStatus> => {
    const queueResponse = await fetchWithTimeout(
      `${API_BASE}/queue/${data.taskSetId}/`,
      { headers: authHeaders() },
      20_000,
    );
    const body = await queueResponse.json().catch(() => null);

    if (!queueResponse.ok) {
      throw new Error(
        `Falha ao consultar status do escaneamento (${queueResponse.status}): ${JSON.stringify(body)}`,
      );
    }

    // Undocumented but real behavior, found by reading 3DLOOK's own docs
    // directly instead of guessing: when a scan finishes successfully, this
    // endpoint doesn't return a JSON status body at all — it 303-redirects
    // straight to the finished person resource. fetch() follows that
    // automatically, so `body` here is already the *person* record in that
    // case, not the queue status object. The bug this replaces: the old
    // code always read `body.is_ready` at the top level, which is where a
    // queue status puts it but a person record doesn't (it's nested under
    // `task_set.is_ready` there) — so a finished scan silently read as
    // "not ready" forever, no matter how many times it polled, with no
    // error at all. A separate, undocumented `/persons/?task_set_url__…`
    // lookup used to run after this to fetch the measurements — no longer
    // needed, since the redirect already hands us the full person record.
    if (body?.task_set) {
      const taskSet = body.task_set;
      if (!taskSet.is_successful) {
        return {
          isReady: true,
          isSuccessful: false,
          failureMessages: extractFailureMessages(taskSet.sub_tasks),
        };
      }
      return {
        isReady: true,
        isSuccessful: true,
        volumeParams: body.volume_params,
        frontParams: body.front_params,
        sideParams: body.side_params,
        modelUrl: body.volume_params?.body_model ?? undefined,
      };
    }

    if (!body?.is_ready) {
      return { isReady: false };
    }

    // Ready but no redirect happened, i.e. failed — the documented case for
    // a plain (non-redirected) status body.
    if (!body.is_successful) {
      return {
        isReady: true,
        isSuccessful: false,
        failureMessages: extractFailureMessages(body.sub_tasks),
      };
    }

    // Ready + successful without a task_set shouldn't happen per how 3DLOOK
    // documents this endpoint — keep polling rather than surfacing an error
    // for a state that isn't actually a failure.
    return { isReady: false };
  });
