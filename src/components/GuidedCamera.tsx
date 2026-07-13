import { useEffect, useRef, useState } from "react";

import {
  detectKeypoints,
  getPoseLandmarker,
  SKELETON_BONES,
  type Keypoint,
} from "@/lib/poseDetection";

const DETECTION_INTERVAL_MS = 200;
const KEYPOINT_MIN_SCORE_TO_DRAW = 0.5;

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

// Bare MediaPipe body-landmark display: camera + skeleton overlay, nothing
// else. No scoring, no countdown, no capture — that logic was making it too
// hard to tell whether detection itself was even working, so this step is
// deliberately just "does MediaPipe see the body correctly."
export function GuidedCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [error, setError] = useState("");
  const [modelLoading, setModelLoading] = useState(true);
  const [pointsDetected, setPointsDetected] = useState(0);

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

  useEffect(() => {
    if (modelLoading || error) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function tick() {
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const landmarker = await getPoseLandmarker();
          const keypoints = detectKeypoints(landmarker, video, performance.now());
          if (canvasRef.current) drawSkeleton(canvasRef.current, video, keypoints);
          if (!cancelled) {
            setPointsDetected(
              keypoints.filter((k) => (k.score ?? 0) >= KEYPOINT_MIN_SCORE_TO_DRAW).length,
            );
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
  }, [modelLoading, error]);

  if (error) {
    return (
      <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-4 rounded-2xl border hairline bg-secondary/40 p-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border-4 border-hairline bg-black">
        <div className={`relative h-full w-full ${facingMode === "user" ? "scale-x-[-1]" : ""}`}>
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>

        {modelLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
            Carregando detector…
          </div>
        )}

        <button
          type="button"
          onClick={() => setFacingMode((m) => (m === "user" ? "environment" : "user"))}
          aria-label="Trocar câmera"
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-lg text-white"
        >
          ⟲
        </button>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        {modelLoading ? "Carregando…" : `${pointsDetected} de 13 pontos detectados`}
      </p>
    </div>
  );
}
