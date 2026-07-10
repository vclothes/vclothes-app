import { useEffect, useRef, useState, useCallback } from "react";
import type * as poseDetection from "@tensorflow-models/pose-detection";

type PoseMode = "front" | "side";

type CheckResult = { ok: boolean; message: string };

const MIN_SCORE = 0.3;
const HOLD_MS = 900;

const SKELETON_CONNECTIONS: [string, string][] = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

// TensorFlow.js is loaded from a CDN <script> tag rather than bundled via npm —
// bundling it with esbuild/Vite stalled the dev server indefinitely in this
// environment. Only its types are imported (erased at build, never bundled).
declare global {
  interface Window {
    tf?: { setBackend: (name: string) => Promise<boolean>; ready: () => Promise<void> };
    poseDetection?: typeof poseDetection;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

let detectorPromise: Promise<poseDetection.PoseDetector> | null = null;
function getDetector(): Promise<poseDetection.PoseDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js");
      await loadScript(
        "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js",
      );
      const tf = window.tf!;
      const pd = window.poseDetection!;
      await tf.setBackend("webgl");
      await tf.ready();
      return pd.createDetector(pd.SupportedModels.MoveNet, {
        modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
      });
    })();
  }
  return detectorPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function kp(pose: poseDetection.Pose, name: string) {
  return pose.keypoints.find((k) => k.name === name);
}

function checkFrontPose(pose: poseDetection.Pose, videoW: number, videoH: number): CheckResult {
  // Only the "frame" keypoints (shoulders/hips/ankles) gate the generic
  // "corpo inteiro visível" message. Wrists are checked separately below so
  // that arms tucked at the sides — which MoveNet often can't confidently
  // locate — get the actionable "afaste os braços" message instead of a
  // generic one that never changes no matter how the person moves.
  const frameNames = ["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_ankle", "right_ankle"];
  const framePoints = Object.fromEntries(frameNames.map((n) => [n, kp(pose, n)]));
  const frameMissing = frameNames.filter((n) => !framePoints[n] || (framePoints[n]!.score ?? 0) < MIN_SCORE);
  if (frameMissing.length > 0) {
    return { ok: false, message: "Fique com o corpo inteiro visível, de frente pra câmera." };
  }

  const { left_shoulder: lS, right_shoulder: rS, left_hip: lH, right_hip: rH, left_ankle: lA, right_ankle: rA } =
    framePoints as Record<string, poseDetection.Keypoint>;

  const topY = Math.min(lS.y, rS.y);
  const bottomY = Math.max(lA.y, rA.y);
  const frameRatio = (bottomY - topY) / videoH;
  if (frameRatio < 0.45) return { ok: false, message: "Chegue um pouco mais perto da câmera." };
  if (frameRatio > 0.95) return { ok: false, message: "Afaste-se um pouco da câmera." };

  const shoulderWidth = Math.abs(rS.x - lS.x);

  const lW = kp(pose, "left_wrist");
  const rW = kp(pose, "right_wrist");
  const armSpread = (wrist: poseDetection.Keypoint | undefined, hip: poseDetection.Keypoint) =>
    !!wrist && (wrist.score ?? 0) >= MIN_SCORE && Math.abs(wrist.x - hip.x) >= shoulderWidth * 0.35;
  if (!armSpread(lW, lH) || !armSpread(rW, rH)) {
    return { ok: false, message: "Afaste os braços do corpo, como na foto de exemplo." };
  }

  const legGap = Math.abs(lA.x - rA.x);
  if (legGap < shoulderWidth * 0.12) {
    return { ok: false, message: "Separe um pouco as pernas." };
  }

  const centerRatio = ((lS.x + rS.x) / 2) / videoW;
  if (centerRatio < 0.3 || centerRatio > 0.7) {
    return { ok: false, message: "Centralize-se no meio da câmera." };
  }

  return { ok: true, message: "Perfeito! Mantendo a posição…" };
}

function checkSidePose(pose: poseDetection.Pose, videoW: number, videoH: number): CheckResult {
  const names = ["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_ankle", "right_ankle"];
  const points = Object.fromEntries(names.map((n) => [n, kp(pose, n)]));
  const missing = names.filter((n) => !points[n] || (points[n]!.score ?? 0) < MIN_SCORE);
  if (missing.length > 1) {
    return { ok: false, message: "Fique com o corpo inteiro visível na câmera." };
  }

  const { left_shoulder: lS, right_shoulder: rS, left_hip: lH, right_hip: rH, left_ankle: lA, right_ankle: rA } = points as Record<string, poseDetection.Keypoint>;

  const topY = Math.min(lS.y, rS.y);
  const bottomY = Math.max(lA.y, rA.y);
  const frameRatio = (bottomY - topY) / videoH;
  if (frameRatio < 0.4) return { ok: false, message: "Chegue um pouco mais perto da câmera." };

  const shoulderMid = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
  const hipMid = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2 };
  const torsoLength = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y) || 1;

  const shoulderGap = Math.abs(rS.x - lS.x);
  const hipGap = Math.abs(rH.x - lH.x);
  if (shoulderGap > torsoLength * 0.4 || hipGap > torsoLength * 0.4) {
    return { ok: false, message: "Vire o corpo de lado para a câmera (perfil)." };
  }

  const ankleGap = Math.abs(lA.x - rA.x);
  if (ankleGap > torsoLength * 0.35) {
    return { ok: false, message: "Junte as pernas." };
  }

  const centerRatio = ((lS.x + rS.x) / 2) / videoW;
  if (centerRatio < 0.25 || centerRatio > 0.75) {
    return { ok: false, message: "Centralize-se no meio da câmera." };
  }

  return { ok: true, message: "Perfeito! Mantendo a posição…" };
}

export function GuidedCamera({
  mode,
  onCapture,
}: {
  mode: PoseMode;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const goodSinceRef = useRef<number | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "denied" | "unsupported" | "model-error">(
    "loading",
  );
  const [feedback, setFeedback] = useState("Carregando câmera…");
  const [poseOk, setPoseOk] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [retryKey, setRetryKey] = useState(0);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture(new File([blob], `${mode}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }, [mode, onCapture]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStatus("loading");
      setFeedback("Carregando câmera…");
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 720 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setFeedback("Carregando o modelo de detecção…");
        let detector: poseDetection.PoseDetector;
        try {
          detector = await withTimeout(getDetector(), 15_000);
        } catch {
          if (!cancelled) setStatus("model-error");
          return;
        }

        if (cancelled) return;
        setStatus("ready");
        runLoop(detector);
      } catch {
        if (!cancelled) setStatus("denied");
      }
    }

    function runLoop(detector: poseDetection.PoseDetector) {
      async function tick() {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");

        const poses = await detector.estimatePoses(video);
        const pose = poses[0];

        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!pose) {
          setPoseOk(false);
          goodSinceRef.current = null;
          setFeedback("Não estamos vendo você. Fique no quadro da câmera.");
        } else {
          const result =
            mode === "front"
              ? checkFrontPose(pose, video.videoWidth, video.videoHeight)
              : checkSidePose(pose, video.videoWidth, video.videoHeight);

          if (ctx) drawSkeleton(ctx, pose, result.ok);
          setFeedback(result.message);

          if (result.ok) {
            if (goodSinceRef.current === null) goodSinceRef.current = performance.now();
            const held = performance.now() - goodSinceRef.current;
            setPoseOk(held >= HOLD_MS);
          } else {
            goodSinceRef.current = null;
            setPoseOk(false);
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, facingMode, retryKey]);

  // Auto-capture once the pose has been held correctly for long enough.
  useEffect(() => {
    if (poseOk) {
      const timeout = setTimeout(capture, 250);
      return () => clearTimeout(timeout);
    }
  }, [poseOk, capture]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border hairline bg-ink">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: facingMode === "user" ? "scaleX(-1)" : undefined }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ transform: facingMode === "user" ? "scaleX(-1)" : undefined }}
        />

        {status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-ink/90 px-6 text-center text-sm text-primary-foreground">
            <span>
              {status === "loading" && "Carregando câmera…"}
              {status === "denied" &&
                "Não conseguimos acessar sua câmera. Verifique as permissões do navegador e tente de novo."}
              {status === "unsupported" && "Seu navegador não suporta captura de câmera aqui."}
              {status === "model-error" &&
                "Não conseguimos carregar o assistente de posição. Verifique sua internet e tente de novo."}
            </span>
            {(status === "denied" || status === "model-error") && (
              <button
                type="button"
                onClick={() => setRetryKey((k) => k + 1)}
                className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
              >
                Tentar novamente
              </button>
            )}
          </div>
        )}

        {status === "ready" && (
          <div
            className={`absolute inset-x-4 bottom-4 rounded-xl px-4 py-3 text-center text-sm font-medium transition-colors ${
              poseOk ? "bg-primary text-primary-foreground" : "bg-card/95 text-foreground"
            }`}
          >
            {feedback}
          </div>
        )}

        <button
          type="button"
          onClick={() => setFacingMode((m) => (m === "user" ? "environment" : "user"))}
          aria-label="Trocar câmera"
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-card/90 text-foreground shadow-[var(--shadow-card)]"
        >
          ⟲
        </button>
      </div>

      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={capture}
          disabled={status !== "ready"}
          className="text-sm font-medium text-primary hover:underline disabled:opacity-40"
        >
          Capturar manualmente
        </button>
      </div>
    </div>
  );
}

function drawSkeleton(ctx: CanvasRenderingContext2D, pose: poseDetection.Pose, ok: boolean) {
  const color = ok ? "#22c55e" : "#f59e0b";
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  for (const [a, b] of SKELETON_CONNECTIONS) {
    const pa = kp(pose, a);
    const pb = kp(pose, b);
    if (!pa || !pb || (pa.score ?? 0) < MIN_SCORE || (pb.score ?? 0) < MIN_SCORE) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  for (const point of pose.keypoints) {
    if ((point.score ?? 0) < MIN_SCORE) continue;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}
