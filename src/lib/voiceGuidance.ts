import type { PoseChecks, PoseStatus } from "./poseDetection";

// Small wrapper around the browser's built-in speech synthesis — no
// account, no API key, works offline once the page has loaded. Exists so
// someone holding the phone (often at arm's length or a few meters away)
// can hear what to adjust instead of squinting at small on-screen text.

let cachedPtBrVoice: SpeechSynthesisVoice | null | undefined;

function getPtBrVoice(): SpeechSynthesisVoice | null {
  if (cachedPtBrVoice !== undefined) return cachedPtBrVoice;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  cachedPtBrVoice = voices.find((v) => v.lang?.toLowerCase().startsWith("pt")) ?? null;
  return cachedPtBrVoice;
}

// Voice lists load asynchronously on some browsers — refresh the cache
// once they're available instead of getting stuck with "no pt-BR voice
// found" from an empty first read.
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    cachedPtBrVoice = undefined;
  });
}

export function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // replace whatever's queued/speaking, never stack up
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "pt-BR";
  const voice = getPtBrVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

export function cancelSpeech() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// One instruction at a time, prioritized so fixing the first thing said
// often fixes the ones after it too (no point saying "chegue mais perto"
// while they're still facing the wrong way).
export function pickGuidanceMessage(
  checks: PoseChecks | null,
  status: PoseStatus,
  mode: "front" | "side",
): string {
  if (!checks || !checks.bodyDetected) return "Não estamos te vendo. Entre no quadro.";
  if (!checks.facingAngle) {
    return mode === "front" ? "Vire de frente para a câmera." : "Vire de lado para a câmera.";
  }
  if (!checks.centered) return "Ande até o centro do quadro.";
  if (!checks.fullyVisible) return "Afaste-se até o corpo inteiro aparecer.";
  if (!checks.properSize) return "Chegue um pouco mais perto da câmera.";
  if (!checks.armsOk) return "Solte os braços ao lado do corpo, afastados um pouco do tronco.";
  if (status === "green") return "Perfeito, segure a posição!";
  return "Quase lá, mantenha a posição.";
}
