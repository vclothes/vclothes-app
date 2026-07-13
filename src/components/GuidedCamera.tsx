import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  detectKeypoints,
  getPoseLandmarker,
  scoreFrontPose,
  type PoseStatus,
} from "@/lib/poseDetection";

const DETECTION_INTERVAL_MS = 200;
const SUSTAIN_TICKS_FOR_GREEN = 4; // ~800ms of steady "green" before the countdown starts
const COUNTDOWN_STEP_MS = 700;

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

export function GuidedCamera({ onCapture }: { onCapture: (base64: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const greenStreakRef = useRef(0);
  const countingRef = useRef(false);
  const capturedRef = useRef(false);

  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [error, setError] = useState("");
  const [modelLoading, setModelLoading] = useState(true);
  const [status, setStatus] = useState<PoseStatus>("red");
  const [countdown, setCountdown] = useState<number | null>(null);

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
      .catch(() =>
        setError("Não conseguimos acessar a câmera. Verifique as permissões do navegador."),
      );

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facingMode]);

  useEffect(() => {
    getPoseLandmarker()
      .then(() => setModelLoading(false))
      .catch(() => setError("Não conseguimos carregar o detector de posição."));
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
          const nextStatus =
            keypoints.length > 0
              ? scoreFrontPose(keypoints, video.videoWidth, video.videoHeight)
              : "red";

          if (cancelled) return;
          setStatus(nextStatus);

          if (nextStatus === "green") {
            greenStreakRef.current += 1;
            if (greenStreakRef.current >= SUSTAIN_TICKS_FOR_GREEN) startCountdown();
          } else {
            greenStreakRef.current = 0;
            cancelCountdown();
          }
        } catch {
          // Transient detection hiccup — try again next tick.
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
  }, [modelLoading, error]);

  if (error) {
    return (
      <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-4 rounded-2xl border hairline bg-secondary/40 p-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => setError("")}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative aspect-[3/4] w-full overflow-hidden rounded-2xl border-4 bg-black transition-colors duration-300 ${STATUS_BORDER[status]}`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
        />

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
    </div>
  );
}
