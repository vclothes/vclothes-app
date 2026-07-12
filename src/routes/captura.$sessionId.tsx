import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { CaptureCamera } from "@/components/CaptureCamera";
import {
  getCaptureSession,
  submitCapturePhotos,
  type CaptureSessionState,
} from "@/lib/captureSession";
import logoVClothes from "@/assets/logo-vclothes.png";

export const Route = createFileRoute("/captura/$sessionId")({
  component: CapturaPage,
});

type LocalStep =
  | "loading"
  | "not_found"
  | "already_used"
  | "front_intro"
  | "front_shot"
  | "side_intro"
  | "side_shot"
  | "sending"
  | "sent"
  | "error";

function CapturaPage() {
  const { sessionId } = Route.useParams();
  const [step, setStep] = useState<LocalStep>("loading");
  const [name, setName] = useState("");
  const [frontImage, setFrontImage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    getCaptureSession({ data: { sessionId } })
      .then((session: CaptureSessionState | null) => {
        if (cancelled) return;
        if (!session) {
          setStep("not_found");
          return;
        }
        setName(session.name);
        setStep(session.status === "waiting_photos" ? "front_intro" : "already_used");
      })
      .catch(() => !cancelled && setStep("not_found"));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleSideCapture(sideImage: string) {
    setStep("sending");
    try {
      await submitCapturePhotos({
        data: { sessionId, frontImageBase64: frontImage, sideImageBase64: sideImage },
      });
      setStep("sent");
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

        {step === "already_used" && (
          <div className="py-24 text-center">
            <h1 className="text-display text-2xl text-ink">Fotos já enviadas</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Esse código já foi usado, {name}. Volte para o computador para ver o resultado.
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

        {step === "sent" && (
          <div className="py-24 text-center">
            <h1 className="text-display text-2xl text-ink">Prontinho!</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Suas fotos foram enviadas. Pode voltar para o computador para ver suas medidas.
            </p>
          </div>
        )}

        {step === "error" && (
          <div className="py-24 text-center">
            <h1 className="text-display text-2xl text-ink">Não foi possível enviar</h1>
            <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
            <Button className="mt-8" onClick={() => setStep("side_shot")}>
              Tentar de novo
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
