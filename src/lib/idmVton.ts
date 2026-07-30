// Talks to IDM-VTON (https://github.com/yisol/IDM-VTON), a free, open-source
// virtual try-on model, via its public Hugging Face Space
// (https://huggingface.co/spaces/yisol/IDM-VTON) — no API key, no cost, no
// GPU server of our own. It's a Gradio app, so the call is Gradio's own
// upload-then-queue-then-SSE protocol, not a simple REST endpoint. Verified
// against the live space directly (not just its docs): a real end-to-end
// call — upload our own product photo, run tryon, download the result —
// completed in ~9.5s and produced a correct, photorealistic composite.
//
// This is a public demo space shared with everyone on the internet, not
// infrastructure we control: no uptime guarantee, and a request can queue
// behind other people's if the space is busy. Each call here has a generous
// but finite timeout so a stuck request fails with a clear message instead
// of hanging forever.
const HF_SPACE_ROOT = "https://yisol-idm-vton.hf.space";

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
      throw new Error(`O gerador de try-on não respondeu em ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function stripDataUrlPrefix(base64: string) {
  const commaIndex = base64.indexOf(",");
  return base64.startsWith("data:") && commaIndex !== -1 ? base64.slice(commaIndex + 1) : base64;
}

// Gradio's own file-upload endpoint: takes raw bytes, returns a server-side
// temp path we can then reference in the actual tryon call below. There's no
// way to hand it raw base64/inline data directly — the underlying components
// (ImageEditor, Image) only accept a FileData path reference.
async function uploadImage(base64: string, filename: string, mime: string): Promise<string> {
  const bytes = Buffer.from(stripDataUrlPrefix(base64), "base64");
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mime }), filename);

  const response = await fetchWithTimeout(
    `${HF_SPACE_ROOT}/upload`,
    { method: "POST", body: form },
    30_000,
  );
  if (!response.ok) {
    throw new Error(`Falha ao enviar imagem para o gerador de try-on (${response.status}).`);
  }
  const paths = (await response.json().catch(() => null)) as string[] | null;
  if (!paths?.[0]) {
    throw new Error("O gerador de try-on não confirmou o envio da imagem.");
  }
  return paths[0];
}

// Kicks off the "tryon" call (Gradio's SSE-based protocol: POST starts the
// job and returns an event_id, then a GET on that event_id streams progress
// until a "complete" event carries the result) and waits for the resulting
// image's own hosted URL.
async function runTryOn(
  humanPath: string,
  garmentPath: string,
  description: string,
): Promise<string> {
  const payload = {
    data: [
      {
        background: { path: humanPath, meta: { _type: "gradio.FileData" } },
        layers: [],
        composite: null,
      },
      { path: garmentPath, meta: { _type: "gradio.FileData" } },
      description,
      true, // use auto-generated mask
      false, // auto-crop & resizing
      30, // denoising steps
      42, // seed
    ],
  };

  const startResponse = await fetchWithTimeout(
    `${HF_SPACE_ROOT}/call/tryon`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    20_000,
  );
  if (!startResponse.ok) {
    throw new Error(`Falha ao iniciar a geração do try-on (${startResponse.status}).`);
  }
  const { event_id: eventId } = (await startResponse.json().catch(() => ({}))) as {
    event_id?: string;
  };
  if (!eventId) {
    throw new Error("O gerador de try-on não retornou um identificador de tarefa.");
  }

  const streamResponse = await fetchWithTimeout(
    `${HF_SPACE_ROOT}/call/tryon/${eventId}`,
    { headers: { Accept: "text/event-stream" } },
    120_000,
  );
  if (!streamResponse.ok || !streamResponse.body) {
    throw new Error(`Falha ao acompanhar a geração do try-on (${streamResponse.status}).`);
  }

  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffered.indexOf("\n\n")) !== -1) {
      const rawEvent = buffered.slice(0, separatorIndex);
      buffered = buffered.slice(separatorIndex + 2);

      if (rawEvent.includes("event: error")) {
        throw new Error(
          "O gerador de try-on falhou ao processar essa combinação. Tente novamente.",
        );
      }
      if (rawEvent.includes("event: complete")) {
        const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data: "));
        const parsed = dataLine ? JSON.parse(dataLine.slice("data: ".length)) : null;
        const outputUrl: string | undefined = parsed?.[0]?.url;
        if (!outputUrl) throw new Error("O gerador de try-on não retornou uma imagem.");
        return outputUrl;
      }
    }
  }

  throw new Error("A geração do try-on não terminou a tempo. Tente novamente.");
}

async function fetchAsDataUri(url: string): Promise<string> {
  const response = await fetchWithTimeout(url, {}, 30_000);
  if (!response.ok) {
    throw new Error(`Falha ao baixar a imagem gerada (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mime = response.headers.get("content-type") ?? "image/png";
  return `data:${mime};base64,${base64}`;
}

// Runs a full try-on: uploads both photos, waits for the composite, then
// downloads it as a data URI (rather than returning the space's own
// temporary file URL) so what we cache/return doesn't depend on that
// ephemeral path staying alive after the request finishes.
export async function generateTryOnImage(
  personBase64: string,
  garmentBase64: string,
  garmentDescription: string,
): Promise<string> {
  const [humanPath, garmentPath] = await Promise.all([
    uploadImage(personBase64, "person.jpg", "image/jpeg"),
    uploadImage(garmentBase64, "garment.jpg", "image/jpeg"),
  ]);
  const outputUrl = await runTryOn(humanPath, garmentPath, garmentDescription);
  return fetchAsDataUri(outputUrl);
}
