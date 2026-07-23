import { useEffect, useRef, useState } from "react";

import {
  detectKeypoints,
  evaluateFrontPose,
  evaluateSidePose,
  getPoseLandmarker,
  SKELETON_BONES,
  type Keypoint,
  type PoseChecks,
  type PoseStatus,
} from "@/lib/poseDetection";
import { cancelSpeech, pickGuidanceMessage, speak } from "@/lib/voiceGuidance";

const DETECTION_INTERVAL_MS = 200;
const SUSTAIN_TICKS_FOR_GREEN = 5; // ~1s of steady "green" before the countdown starts
const COUNTDOWN_STEP_MS = 700;
const KEYPOINT_MIN_SCORE_TO_DRAW = 0.5;
// How long to wait before repeating the exact same spoken instruction —
// long enough not to nag, short enough to work as a reminder if the first
// one wasn't heard (phone being repositioned, ambient noise, etc.).
const VOICE_REPEAT_MS = 5_000;

const STATUS_BORDER: Record<PoseStatus, string> = {
  red: "border-red-500",
  yellow: "border-yellow-400",
  green: "border-green-500",
};

const STATUS_DOT: Record<PoseStatus, string> = {
  red: "bg-red-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
};

const STATUS_LABEL: Record<PoseStatus, string> = {
  red: "Ajuste sua posição",
  yellow: "Quase lá",
  green: "Perfeito, segure!",
};

const CHECK_LABELS: Record<keyof Omit<PoseChecks, "bodyDetected">, string> = {
  centered: "Centralizado",
  fullyVisible: "Corpo inteiro",
  properSize: "Distância",
  armsOk: "Braços",
  facingAngle: "Ângulo",
};

function drawSkeleton(canvas: HTMLCanvasElement, video: HTMLVideoElement, keypoints: Keypoint[]) {
  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  if (displayWidth === 0 || displayHeight === 0) return;
  if (canvas.width !== displayWidth) canvas.width = displayWidth;
  if (canvas.height !== displayHeight) canvas.height = displayHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (keypoints.length === 0 || video.videoWidth === 0) return;

  // Video is displayed with object-cover, which crops rather than
  // stretches — project keypoints the same way so dots line up with the
  // actual body instead of drifting off it.
  const scale = Math.max(displayWidth / video.videoWidth, displayHeight / video.videoHeight);
  const offsetX = (video.videoWidth * scale - displayWidth) / 2;
  const offsetY = (video.videoHeight * scale - displayHeight) / 2;
  const project = (p: Keypoint) => ({ x: p.x * scale - offsetX, y: p.y * scale - offsetY });

  const confident = keypoints.filter((k) => (k.score ?? 0) >= KEYPOINT_MIN_SCORE_TO_DRAW);
  const byName = new Map(confident.map((k) => [k.name, k]));

  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 3;
  for (const [a, b] of SKELETON_BONES) {
    const ka = byName.get(a);
    const kb = byName.get(b);
    if (!ka || !kb) continue;
    const pa = project(ka);
    const pb = project(kb);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  ctx.fillStyle = "#facc15";
  for (const point of confident) {
    const p = project(point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function GuidedCamera({
  mode,
  onCapture,
}: {
  mode: "front" | "side";
  onCapture: (base64: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const greenStreakRef = useRef(0);
  const countingRef = useRef(false);
  const capturedRef = useRef(false);
  const lastSpokenMessageRef = useRef("");
  const lastSpokenAtRef = useRef(0);
  const mutedRef = useRef(false);

  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [error, setError] = useState("");
  const [modelLoading, setModelLoading] = useState(true);
  const [status, setStatus] = useState<PoseStatus>("red");
  const [checks, setChecks] = useState<PoseChecks | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) cancelSpeech();
  }, [muted]);

  useEffect(() => {
    return () => cancelSpeech();
  }, []);

  function maybeSpeak(message: string) {
    if (mutedRef.current) return;
    const now = Date.now();
    if (
      message === lastSpokenMessageRef.current &&
      now - lastSpokenAtRef.current < VOICE_REPEAT_MS
    ) {
      return;
    }
    lastSpokenMessageRef.current = message;
    lastSpokenAtRef.current = now;
    speak(message);
  }

  useEffect(() => {
    let cancelled = false;
    setError("");

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode, width: { ideal: 1080 }, height: { ideal: 1440 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err) => {
        console.error("[GuidedCamera] getUserMedia failed", err);
        setError("Não conseguimos acessar a câmera. Verifique as permissões do navegador.");
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facingMode]);

  useEffect(() => {
    getPoseLandmarker()
      .then(() => setModelLoading(false))
      .catch((err) => {
        console.error("[GuidedCamera] failed to load pose model", err);
        setError("Não conseguimos carregar o detector de posição.");
      });
  }, []);

  function cancelCountdown() {
    countingRef.current = false;
    setCountdown(null);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    capturedRef.current = true;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    onCapture(canvas.toDataURL("image/jpeg", 0.85));
  }

  function startCountdown() {
    if (countingRef.current) return;
    countingRef.current = true;
    let n = 3;
    setCountdown(n);
    if (!mutedRef.current) speak(String(n));

    const step = () => {
      if (!countingRef.current) return; // cancelled mid-countdown
      n -= 1;
      if (n <= 0) {
        countingRef.current = false;
        setCountdown(null);
        capturePhoto();
        return;
      }
      setCountdown(n);
      if (!mutedRef.current) speak(String(n));
      setTimeout(step, COUNTDOWN_STEP_MS);
    };
    setTimeout(step, COUNTDOWN_STEP_MS);
  }

  useEffect(() => {
    if (modelLoading || error) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function tick() {
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !capturedRef.current) {
        try {
          const landmarker = await getPoseLandmarker();
          const keypoints = detectKeypoints(landmarker, video, performance.now());

          if (canvasRef.current) drawSkeleton(canvasRef.current, video, keypoints);

          const evaluate = mode === "front" ? evaluateFrontPose : evaluateSidePose;
          const evaluation = evaluate(keypoints, video.videoWidth, video.videoHeight);

          if (cancelled) return;
          setStatus(evaluation.status);
          setChecks(evaluation.checks);

          // Once the countdown is running the pose is already confirmed
          // green — let "3, 2, 1" play uninterrupted instead of competing
          // with the regular guidance message.
          if (!countingRef.current) {
            maybeSpeak(pickGuidanceMessage(evaluation.checks, evaluation.status, mode));
          }

          if (evaluation.status === "green") {
            greenStreakRef.current += 1;
            if (greenStreakRef.current >= SUSTAIN_TICKS_FOR_GREEN) startCountdown();
          } else {
            greenStreakRef.current = 0;
            cancelCountdown();
          }
        } catch (err) {
          console.error("[GuidedCamera] detection tick failed", err);
        }
      }
      if (!cancelled) timeoutId = setTimeout(tick, DETECTION_INTERVAL_MS);
    }

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelLoading, error, mode]);

  if (error) {
    return (
      <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-4 rounded-2xl border hairline bg-secondary/40 p-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative aspect-[3/4] w-full overflow-hidden rounded-2xl border-4 bg-black transition-colors duration-300 ${STATUS_BORDER[status]}`}
      >
        <div className={`relative h-full w-full ${facingMode === "user" ? "scale-x-[-1]" : ""}`}>
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>

        {modelLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
            Carregando detector…
          </div>
        )}

        {countdown !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <span className="text-display text-8xl text-white">{countdown}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Ativar instruções por voz" : "Desativar instruções por voz"}
          className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-lg text-white"
        >
          {muted ? "🔇" : "🔊"}
        </button>

        <button
          type="button"
          onClick={() => setFacingMode((m) => (m === "user" ? "environment" : "user"))}
          aria-label="Trocar câmera"
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-lg text-white"
        >
          ⟲
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <span
          className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${STATUS_DOT[status]}`}
        />
        {modelLoading ? "Carregando…" : STATUS_LABEL[status]}
      </div>

      {checks && !checks.bodyDetected && (
        <p className="mt-2 text-xs text-muted-foreground">Nenhum corpo detectado na imagem.</p>
      )}

      {checks && checks.bodyDetected && (
        <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {(Object.keys(CHECK_LABELS) as (keyof typeof CHECK_LABELS)[]).map((key) => (
            <span key={key} className={checks[key] ? "text-green-600" : "text-red-500"}>
              {checks[key] ? "✓" : "✗"} {CHECK_LABELS[key]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
