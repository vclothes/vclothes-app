import { createFileRoute, Link } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  createCaptureSession,
  pollCaptureSession,
  type CaptureSessionState,
} from "@/lib/captureSession";
import { isDisplayableMeasurement, MEASUREMENT_LABELS } from "@/lib/measurements";
import type { Gender, ScanStatus } from "@/lib/threedlook";
import logoVClothes from "@/assets/logo-vclothes.png";

export const Route = createFileRoute("/")({
  component: Provador,
});

type Step = "intro" | "qr" | "result" | "error";

const STEP_NUMBER: Partial<Record<Step, number>> = {
  intro: 1,
  qr: 2,
};

const STATUS_LABELS: Record<CaptureSessionState["status"], string> = {
  waiting_photos: "Aguardando você tirar as fotos no celular…",
  processing: "Calculando suas medidas…",
  done: "Pronto!",
  failed: "Algo deu errado.",
};

function GenderSelect({ value, onChange }: { value: Gender; onChange: (g: Gender) => void }) {
  const options: { value: Gender; label: string }[] = [
    { value: "female", label: "Feminino" },
    { value: "male", label: "Masculino" },
  ];

  return (
    <div role="radiogroup" aria-label="Gênero" className="grid grid-cols-2 gap-3">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`rounded-2xl border px-4 py-4 text-sm font-medium transition-all duration-200 ${
              selected
                ? "border-ink bg-ink text-primary-foreground shadow-[var(--shadow-card)]"
                : "border hairline bg-card text-foreground hover:border-ink/30"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function NumberStepper({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step?: number;
}) {
  const numeric = Number(value) || 0;

  function nudge(delta: number) {
    const next = Math.min(max, Math.max(min, numeric + delta));
    onChange(String(next));
  }

  return (
    <div>
      <Label className="mb-3 block">{label}</Label>
      <div className="flex items-center justify-between rounded-2xl border hairline bg-card px-3 py-2">
        <button
          type="button"
          onClick={() => nudge(-step)}
          aria-label={`Diminuir ${label.toLowerCase()}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-foreground transition-colors hover:bg-secondary"
        >
          −
        </button>
        <div className="flex flex-1 items-baseline justify-center gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-16 bg-transparent text-center text-display text-4xl text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-mono text-muted-foreground">{unit}</span>
        </div>
        <button
          type="button"
          onClick={() => nudge(step)}
          aria-label={`Aumentar ${label.toLowerCase()}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-foreground transition-colors hover:bg-secondary"
        >
          +
        </button>
      </div>
    </div>
  );
}

function Provador() {
  const [step, setStep] = useState<Step>("intro");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");
  const [sessionId, setSessionId] = useState("");
  const [sessionStatus, setSessionStatus] =
    useState<CaptureSessionState["status"]>("waiting_photos");
  const [result, setResult] = useState<ScanStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const canContinueFromIntro =
    name.trim().length > 0 &&
    Number(height) >= 120 &&
    Number(height) <= 220 &&
    Number(weight) >= 30 &&
    Number(weight) <= 200;

  async function goToQr() {
    setErrorMessage("");
    try {
      const { sessionId: id } = await createCaptureSession({
        data: { name: name.trim(), gender, heightCm: Number(height), weightKg: Number(weight) },
      });
      setSessionId(id);
      setSessionStatus("waiting_photos");
      setStep("qr");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
      setStep("error");
    }
  }

  // While the QR step is showing, poll for the visitor's phone submitting
  // photos and 3DLOOK finishing processing — no "já terminei" button needed.
  useEffect(() => {
    if (step !== "qr" || !sessionId) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const session = await pollCaptureSession({ data: { sessionId } });
        if (cancelled || !session) return;

        setSessionStatus(session.status);
        if (session.status === "done") {
          setResult(session.result);
          setStep("result");
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

  const stepNumber = STEP_NUMBER[step];
  const captureUrl =
    typeof window !== "undefined" && sessionId
      ? `${window.location.origin}/captura/${sessionId}`
      : "";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b hairline">
        <div className="mx-auto flex h-18 max-w-3xl items-center px-6">
          <img
            src={logoVClothes}
            alt="V-Clothes"
            className="h-8 w-8 object-contain"
            width={1024}
            height={1024}
          />
          <span className="text-display ml-3 text-xl tracking-tight">V-Clothes</span>
          {stepNumber && (
            <span className="text-mono ml-auto text-muted-foreground">Passo {stepNumber} de 2</span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-6 py-12">
        {step === "intro" && (
          <div>
            <div className="text-mono mb-2 text-primary">Passo 1 de 2</div>
            <h1 className="text-display text-4xl text-ink">Suas informações</h1>
            <p className="mt-3 text-muted-foreground">
              Esses dados ajudam a calibrar a escala das suas medidas.
            </p>

            <div className="mt-8 flex flex-col gap-6">
              <div>
                <Label htmlFor="name" className="mb-3 block">
                  Nome
                </Label>
                <Input
                  id="name"
                  placeholder="Seu nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <Label className="mb-3 block">Gênero</Label>
                <GenderSelect value={gender} onChange={setGender} />
              </div>

              <NumberStepper
                label="Altura"
                unit="cm"
                value={height}
                onChange={setHeight}
                min={120}
                max={220}
              />
              <NumberStepper
                label="Peso"
                unit="kg"
                value={weight}
                onChange={setWeight}
                min={30}
                max={200}
              />

              <Button disabled={!canContinueFromIntro} onClick={goToQr} className="mt-2">
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === "qr" && (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="text-mono mb-2 text-primary">Passo 2 de 2</div>
            <h1 className="text-display text-3xl text-ink">Aponte a câmera do celular</h1>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Escaneie o código com o celular que vai fotografar {name || "você"}. Ele vai guiar a
              foto de frente e de perfil.
            </p>

            <div className="mt-8 rounded-2xl border hairline bg-card p-5">
              {captureUrl ? (
                <QRCodeSVG value={captureUrl} size={220} />
              ) : (
                <div className="flex h-[220px] w-[220px] items-center justify-center text-sm text-muted-foreground">
                  Gerando código…
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {STATUS_LABELS[sessionStatus]}
            </div>

            {sessionId && (
              <Link
                to="/captura/$sessionId"
                params={{ sessionId }}
                className="mt-6 block w-full text-center text-sm text-primary hover:underline"
              >
                Já está com o celular na mão? Toque aqui pra tirar as fotos por aqui mesmo
              </Link>
            )}

            <button
              type="button"
              onClick={() => setStep("intro")}
              className="mt-4 block w-full text-center text-sm text-muted-foreground hover:underline"
            >
              Voltar
            </button>
          </div>
        )}

        {step === "result" && result && (
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

            <Button
              variant="outline"
              className="mt-8"
              onClick={() => {
                setStep("intro");
                setResult(null);
              }}
            >
              Fazer novo escaneamento
            </Button>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center py-24 text-center">
            <h1 className="text-display text-2xl text-ink">Não foi possível calcular</h1>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">{errorMessage}</p>
            <Button
              className="mt-8"
              onClick={() => {
                setStep("intro");
                setSessionId("");
              }}
            >
              Tentar de novo
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
