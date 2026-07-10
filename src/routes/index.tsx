import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { GuidedCamera } from "@/components/GuidedCamera";

import { createScan, getScanResult, type Gender, type ScanStatus } from "@/lib/threedlook";
import logoVClothes from "@/assets/logo-vclothes.png";

export const Route = createFileRoute("/")({
  component: Provador,
});

type Step =
  | "intro"
  | "front-instructions"
  | "front-capture"
  | "side-instructions"
  | "side-capture"
  | "processing"
  | "result"
  | "error";

const STEP_NUMBER: Partial<Record<Step, number>> = {
  intro: 1,
  "front-instructions": 2,
  "front-capture": 3,
  "side-instructions": 4,
  "side-capture": 5,
};

// Only the volume_params/front_params keys we want to surface, in display order.
// Everything else 3DLOOK returns (body_model, textures, debug info, etc.) is internal.
const MEASUREMENT_LABELS: Record<string, string> = {
  chest: "Busto/Peito",
  waist: "Cintura",
  high_hips: "Quadril",
  bicep: "Bíceps",
  neck: "Pescoço",
  neck_girth: "Pescoço",
  thigh: "Coxa",
  calf: "Panturrilha",
  wrist: "Pulso",
  ankle: "Tornozelo",
  abdomen: "Abdômen",
  shoulders: "Ombros",
  inseam: "Entrepernas",
  sleeve_length: "Comprimento da manga",
  outseam: "Comprimento externo da perna",
};

function isDisplayableMeasurement(key: string, value: unknown): value is number {
  return key in MEASUREMENT_LABELS && typeof value === "number";
}

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Simple line-art pictograms so the instruction screens don't rely on external
// image assets — drawn in the brand's ink color, matching the site's minimal look.
function PoseIllustration({ mode }: { mode: "front" | "side" }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl border hairline py-10"
      style={{
        backgroundColor: "#eaf3fa",
        backgroundImage:
          "radial-gradient(ellipse at 50% 38%, rgba(255,255,255,0.95) 0%, rgba(207,228,240,0.55) 55%, rgba(191,216,232,0.9) 100%)",
      }}
    >
      <svg width="140" height="220" viewBox="0 0 120 200" fill="none" aria-hidden="true">
        <circle cx="60" cy="20" r="14" stroke="var(--color-ink)" strokeWidth="4" />
        {mode === "front" ? (
          <>
            <line x1="60" y1="34" x2="60" y2="92" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
            <line x1="60" y1="46" x2="14" y2="72" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
            <line x1="60" y1="46" x2="106" y2="72" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
            <line x1="60" y1="92" x2="34" y2="182" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
            <line x1="60" y1="92" x2="86" y2="182" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
          </>
        ) : (
          <>
            <line x1="60" y1="34" x2="58" y2="92" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
            <line x1="59" y1="48" x2="42" y2="80" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
            <line x1="58" y1="92" x2="55" y2="182" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
            <line x1="58" y1="92" x2="61" y2="182" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" />
          </>
        )}
      </svg>
    </div>
  );
}

function InstructionsScreen({
  stepLabel,
  title,
  mode,
  tips,
  onNext,
  onBack,
  backLabel,
}: {
  stepLabel: string;
  title: string;
  mode: "front" | "side";
  tips: string[];
  onNext: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <div>
      <div className="text-mono mb-2 text-primary">{stepLabel}</div>
      <h1 className="text-display text-4xl text-ink">{title}</h1>

      <div className="mt-6">
        <PoseIllustration mode={mode} />
      </div>

      <ul className="mt-6 space-y-2.5">
        {tips.map((tip) => (
          <li key={tip} className="flex items-start gap-2.5 text-sm text-foreground">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs text-primary">
              ✓
            </span>
            {tip}
          </li>
        ))}
      </ul>

      <Button onClick={onNext} className="mt-8 w-full">
        Próximo
      </Button>
      <button type="button" onClick={onBack} className="mt-4 text-sm text-muted-foreground hover:underline">
        {backLabel}
      </button>
    </div>
  );
}

function Provador() {
  const [step, setStep] = useState<Step>("intro");
  const [gender, setGender] = useState<Gender>("female");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [sideFile, setSideFile] = useState<File | null>(null);
  const [result, setResult] = useState<ScanStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const canContinueFromIntro =
    Number(height) >= 120 && Number(height) <= 220 && Number(weight) >= 30 && Number(weight) <= 200;

  async function handleSubmitPhotos(front: File, side: File) {
    setStep("processing");
    setErrorMessage("");

    try {
      const [frontImageBase64, sideImageBase64] = await Promise.all([fileToBase64(front), fileToBase64(side)]);

      const { taskSetId } = await createScan({
        data: {
          gender,
          heightCm: Number(height),
          weightKg: Number(weight),
          frontImageBase64,
          sideImageBase64,
        },
      });

      let scan: ScanStatus = { isReady: false };
      const startedAt = Date.now();
      const timeoutMs = 90_000;
      const pollIntervalMs = 4_000;

      while (!scan.isReady && Date.now() - startedAt < timeoutMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        scan = await getScanResult({ data: { taskSetId } });
      }

      if (!scan.isReady) {
        throw new Error("O processamento demorou mais que o esperado. Tente novamente.");
      }

      if (!scan.isSuccessful) {
        throw new Error((scan.failureMessages ?? []).join(" "));
      }

      setResult(scan);
      setStep("result");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
      setStep("error");
    }
  }

  const stepNumber = STEP_NUMBER[step];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b hairline">
        <div className="mx-auto flex h-18 max-w-3xl items-center px-6">
          <img src={logoVClothes} alt="V-Clothes" className="h-8 w-8 object-contain" width={1024} height={1024} />
          <span className="text-display ml-3 text-xl tracking-tight">V-Clothes</span>
          {stepNumber && (
            <span className="text-mono ml-auto text-muted-foreground">Passo {stepNumber} de 5</span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-6 py-12">
        {step === "intro" && (
          <div>
            <div className="text-mono mb-2 text-primary">Passo 1 de 5</div>
            <h1 className="text-display text-4xl text-ink">Suas informações</h1>
            <p className="mt-3 text-muted-foreground">
              Esses dados ajudam a calibrar a escala das suas medidas.
            </p>

            <div className="mt-8 flex flex-col gap-6">
              <div>
                <Label className="mb-3 block">Gênero</Label>
                <GenderSelect value={gender} onChange={setGender} />
              </div>

              <NumberStepper label="Altura" unit="cm" value={height} onChange={setHeight} min={120} max={220} />
              <NumberStepper label="Peso" unit="kg" value={weight} onChange={setWeight} min={30} max={200} />

              <Button
                disabled={!canContinueFromIntro}
                onClick={() => setStep("front-instructions")}
                className="mt-2"
              >
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === "front-instructions" && (
          <InstructionsScreen
            stepLabel="Passo 2 de 5 · Foto de frente"
            title="Antes da foto de frente"
            mode="front"
            tips={[
              "Vista roupas justas ao corpo, sem casacos largos.",
              "Fique num fundo liso e bem iluminado.",
              "Posicione-se a 3-4 passos da câmera.",
              "Fique de frente, com os braços afastados do corpo em \"A\".",
              "Deixe as pernas levemente afastadas.",
              "Seu corpo inteiro precisa aparecer no quadro, da cabeça aos pés.",
            ]}
            onNext={() => setStep("front-capture")}
            onBack={() => setStep("intro")}
            backLabel="Voltar"
          />
        )}

        {step === "front-capture" && (
          <div>
            <div className="text-mono mb-2 text-primary">Passo 3 de 5 · Foto de frente</div>
            <h1 className="text-display text-4xl text-ink">Fique como no exemplo</h1>

            <div className="mt-6">
              <GuidedCamera
                mode="front"
                onCapture={(file) => {
                  setFrontFile(file);
                  setStep("side-instructions");
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => setStep("front-instructions")}
              className="mt-6 text-sm text-muted-foreground hover:underline"
            >
              Ver instruções de novo
            </button>
          </div>
        )}

        {step === "side-instructions" && (
          <InstructionsScreen
            stepLabel="Passo 4 de 5 · Foto de perfil"
            title="Antes da foto de perfil"
            mode="side"
            tips={[
              "Vire o corpo de lado (perfil) para a câmera.",
              "Mantenha a mesma distância da foto de frente.",
              "Braços alinhados com a linha do corpo, sem afastar do quadril.",
              "Pernas juntas, uma na frente da outra.",
              "Seu corpo inteiro precisa aparecer no quadro, da cabeça aos pés.",
            ]}
            onNext={() => setStep("side-capture")}
            onBack={() => setStep("front-capture")}
            backLabel="Refazer foto de frente"
          />
        )}

        {step === "side-capture" && (
          <div>
            <div className="text-mono mb-2 text-primary">Passo 5 de 5 · Foto de perfil</div>
            <h1 className="text-display text-4xl text-ink">Agora de lado</h1>

            <div className="mt-6">
              <GuidedCamera
                mode="side"
                onCapture={(file) => {
                  setSideFile(file);
                  if (frontFile) handleSubmitPhotos(frontFile, file);
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => setStep("side-instructions")}
              className="mt-6 text-sm text-muted-foreground hover:underline"
            >
              Ver instruções de novo
            </button>
          </div>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center py-24 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <h1 className="text-display mt-8 text-2xl text-ink">Calculando suas medidas…</h1>
            <p className="mt-2 text-sm text-muted-foreground">Isso leva de 30 a 90 segundos.</p>
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
                setFrontFile(null);
                setSideFile(null);
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
                setFrontFile(null);
                setSideFile(null);
                setStep("front-instructions");
              }}
            >
              Tentar novamente
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
