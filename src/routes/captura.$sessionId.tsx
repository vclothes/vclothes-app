import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { CaptureCamera } from "@/components/CaptureCamera";
import {
  getCaptureSession,
  pollCaptureSession,
  submitCapturePhotos,
  type CaptureSessionState,
} from "@/lib/captureSession";
import { isDisplayableMeasurement, MEASUREMENT_LABELS } from "@/lib/measurements";
import type { ScanStatus } from "@/lib/threedlook";
import logoVClothes from "@/assets/logo-vclothes.png";

export const Route = createFileRoute("/captura/$sessionId")({
  component: CapturaPage,
});

type LocalStep =
  | "loading"
  | "not_found"
  | "front_intro"
  | "front_shot"
  | "side_intro"
  | "side_shot"
  | "sending"
  | "processing"
  | "done"
  | "error";

function CapturaPage() {
  const { sessionId } = Route.useParams();
  const [step, setStep] = useState<LocalStep>("loading");
  const [name, setName] = useState("");
  const [frontImage, setFrontImage] = useState("");
  const [result, setResult] = useState<ScanStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Works whether this phone is a second device (kiosk handed off via QR) or
  // the only device in play (visitor tapped "continue here" on the kiosk
  // screen) — either way, once photos go out this page just waits it out and
  // shows the result itself, instead of assuming there's a computer to check.
  useEffect(() => {
    let cancelled = false;
    getCaptureSession({ data: { sessionId } })
      .then((session: CaptureSessionState | null) => {
        if (cancelled || !session) {
          if (!cancelled) setStep("not_found");
          return;
        }
        setName(session.name);
        if (session.status === "waiting_photos") setStep("front_intro");
        else if (session.status === "processing") setStep("processing");
        else if (session.status === "done") {
          setResult(session.result);
          setStep("done");
        } else {
          setErrorMessage(session.message);
          setStep("error");
        }
      })
      .catch(() => !cancelled && setStep("not_found"));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (step !== "processing") return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const session = await pollCaptureSession({ data: { sessionId } });
        if (cancelled || !session) return;

        if (session.status === "done") {
          setResult(session.result);
          setStep("done");
        } else if (session.status === "failed") {
          setErrorMessage(session.message);
          setStep("error");
        }
      } catch {
        // Transient network hiccup — just try again on the next tick.
      }
    }, 3_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, sessionId]);

  async function handleSideCapture(sideImage: string) {
    setStep("sending");
    try {
      await submitCapturePhotos({
        data: { sessionId, frontImageBase64: frontImage, sideImageBase64: sideImage },
      });
      setStep("processing");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Algo deu errado ao enviar as fotos.");
      setStep("error");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b hairline">
        <div className="mx-auto flex h-16 max-w-md items-center px-6">
          <img
            src={logoVClothes}
            alt="V-Clothes"
            className="h-7 w-7 object-contain"
            width={1024}
            height={1024}
          />
          <span className="text-display ml-3 text-lg tracking-tight">V-Clothes</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
        {step === "loading" && (
          <p className="py-24 text-center text-sm text-muted-foreground">Carregando…</p>
        )}

        {step === "not_found" && (
          <div className="py-24 text-center">
            <h1 className="text-display text-2xl text-ink">Link expirado ou inválido</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Peça um novo código QR no computador.
            </p>
          </div>
        )}

        {step === "front_intro" && (
          <div>
            <h1 className="text-display text-3xl text-ink">Olá, {name}</h1>
            <p className="mt-3 text-muted-foreground">
              Agora vamos tirar sua foto de frente. Fique parado(a), braços levemente afastados do
              corpo, em um fundo liso, com o corpo inteiro visível.
            </p>
            <Button onClick={() => setStep("front_shot")} className="mt-8 w-full">
              Tirar foto de frente
            </Button>
          </div>
        )}

        {step === "front_shot" && (
          <div>
            <h1 className="text-display mb-4 text-2xl text-ink">Foto de frente</h1>
            <CaptureCamera
              mode="front"
              onCapture={(base64) => {
                setFrontImage(base64);
                setStep("side_intro");
              }}
            />
          </div>
        )}

        {step === "side_intro" && (
          <div>
            <h1 className="text-display text-3xl text-ink">Foto de frente ok!</h1>
            <p className="mt-3 text-muted-foreground">
              Agora gire 90° e tire a foto de perfil (de lado), na mesma posição.
            </p>
            <Button onClick={() => setStep("side_shot")} className="mt-8 w-full">
              Tirar foto de perfil
            </Button>
          </div>
        )}

        {step === "side_shot" && (
          <div>
            <h1 className="text-display mb-4 text-2xl text-ink">Foto de perfil</h1>
            <CaptureCamera mode="side" onCapture={handleSideCapture} />
          </div>
        )}

        {step === "sending" && (
          <p className="py-24 text-center text-sm text-muted-foreground">Enviando fotos…</p>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center py-24 text-center">
            <h1 className="text-display text-2xl text-ink">Fotos enviadas!</h1>
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              Calculando suas medidas…
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div>
            <div className="text-mono mb-2 text-primary">Pronto</div>
            <h1 className="text-display text-4xl text-ink">Suas medidas</h1>

            <div className="mt-8 divide-y hairline rounded-2xl border hairline">
              {Object.entries({ ...result.volumeParams, ...result.frontParams })
                .filter(([key, value]) => isDisplayableMeasurement(key, value))
                .map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between px-5 py-4">
                    <span className="text-sm text-foreground">{MEASUREMENT_LABELS[key]}</span>
                    <span className="text-display text-lg text-primary">{value} cm</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="py-24 text-center">
            <h1 className="text-display text-2xl text-ink">Não foi possível calcular</h1>
            <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
          </div>
        )}
      </main>
    </div>
  );
}
