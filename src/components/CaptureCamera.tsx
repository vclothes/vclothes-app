import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

// Plain manual capture: live camera preview + a static reference silhouette
// overlay, no pose detection. The visitor (or whoever is holding the phone)
// lines the body up with the outline and taps the shutter themselves.
export function CaptureCamera({
  mode,
  onCapture,
}: {
  mode: "front" | "side";
  onCapture: (base64: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1080 },
          height: { ideal: 1440 },
        },
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
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    onCapture(canvas.toDataURL("image/jpeg", 0.85));
  }

  if (error) {
    return (
      <div className="flex aspect-[3/4] w-full flex-col items-center justify-center rounded-2xl border hairline bg-secondary/40 p-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        <SilhouetteOverlay mode={mode} />
      </div>
      <Button onClick={capture} className="mt-6 w-full">
        Capturar foto
      </Button>
    </div>
  );
}

function SilhouetteOverlay({ mode }: { mode: "front" | "side" }) {
  return (
    <svg
      viewBox="0 0 300 400"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
      aria-hidden="true"
    >
      {mode === "front" ? (
        <g fill="none" stroke="white" strokeWidth="3">
          <circle cx="150" cy="55" r="28" />
          <line x1="150" y1="83" x2="150" y2="230" />
          <line x1="150" y1="110" x2="70" y2="70" />
          <line x1="150" y1="110" x2="230" y2="70" />
          <line x1="150" y1="230" x2="105" y2="370" />
          <line x1="150" y1="230" x2="195" y2="370" />
          <line x1="95" y1="145" x2="205" y2="145" />
        </g>
      ) : (
        <g fill="none" stroke="white" strokeWidth="3">
          <circle cx="160" cy="55" r="28" />
          <line x1="160" y1="83" x2="150" y2="230" />
          <line x1="155" y1="110" x2="120" y2="200" />
          <line x1="150" y1="230" x2="140" y2="370" />
          <line x1="150" y1="230" x2="175" y2="365" />
        </g>
      )}
    </svg>
  );
}
