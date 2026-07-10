import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { clearLatestScan, getLatestScan, type Gender, type ScanStatus } from "@/lib/threedlook";
import logoVClothes from "@/assets/logo-vclothes.png";

export const Route = createFileRoute("/")({
  component: Provador,
});

type Step = "intro" | "instructions" | "waiting" | "result" | "error";

const STEP_NUMBER: Partial<Record<Step, number>> = {
  intro: 1,
  instructions: 2,
  waiting: 3,
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

function Provador() {
  const [step, setStep] = useState<Step>("intro");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");
  const [result, setResult] = useState<ScanStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [checking, setChecking] = useState(false);

  const canContinueFromIntro =
    name.trim().length > 0 &&
    Number(height) >= 120 &&
    Number(height) <= 220 &&
    Number(weight) >= 30 &&
    Number(weight) <= 200;

  async function goToWaiting() {
    // Clear any leftover result from a previous visitor before this one starts,
    // so "Já terminei" can't accidentally show someone else's measurements.
    await clearLatestScan();
    setStep("waiting");
  }

  async function handleCheckResult() {
    setChecking(true);
    setErrorMessage("");

    try {
      let scan: ScanStatus | null = null;
      const startedAt = Date.now();
      const timeoutMs = 90_000;
      const pollIntervalMs = 4_000;

      while (Date.now() - startedAt < timeoutMs) {
        scan = await getLatestScan();
        if (scan?.isReady) break;
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }

      if (!scan?.isReady) {
        throw new Error(
          "Ainda não recebemos seu resultado. Confirme que você terminou o escaneamento no site da 3DLOOK e tente de novo.",
        );
      }

      if (!scan.isSuccessful) {
        throw new Error((scan.failureMessages ?? []).join(" "));
      }

      setResult(scan);
      setStep("result");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
      setStep("error");
    } finally {
      setChecking(false);
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
            <span className="text-mono ml-auto text-muted-foreground">Passo {stepNumber} de 3</span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-6 py-12">
        {step === "intro" && (
          <div>
            <div className="text-mono mb-2 text-primary">Passo 1 de 3</div>
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

              <NumberStepper label="Altura" unit="cm" value={height} onChange={setHeight} min={120} max={220} />
              <NumberStepper label="Peso" unit="kg" value={weight} onChange={setWeight} min={30} max={200} />

              <Button disabled={!canContinueFromIntro} onClick={() => setStep("instructions")} className="mt-2">
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === "instructions" && (
          <div>
            <div className="text-mono mb-2 text-primary">Passo 2 de 3</div>
            <h1 className="text-display text-4xl text-ink">Hora de escanear</h1>
            <p className="mt-3 text-muted-foreground">
              O escaneamento é feito no sistema da 3DLOOK, referência mundial em medidas corporais
              por foto.
            </p>

            <ol className="mt-6 space-y-4">
              <li className="flex gap-3 text-sm text-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-medium text-primary-foreground">
                  1
                </span>
                <span>
                  Peça pro nosso time gerar seu código QR com o nome <strong>{name || "—"}</strong>.
                </span>
              </li>
              <li className="flex gap-3 text-sm text-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-medium text-primary-foreground">
                  2
                </span>
                <span>Escaneie o QR code com a câmera do seu celular.</span>
              </li>
              <li className="flex gap-3 text-sm text-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-medium text-primary-foreground">
                  3
                </span>
                <span>
                  Siga as instruções na tela: roupa justa, fundo liso, corpo inteiro visível.
                </span>
              </li>
              <li className="flex gap-3 text-sm text-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-medium text-primary-foreground">
                  4
                </span>
                <span>Quando terminar, volte pra essa tela.</span>
              </li>
            </ol>

            <Button onClick={goToWaiting} className="mt-8 w-full">
              Já escaneei, ver meu resultado
            </Button>
            <button
              type="button"
              onClick={() => setStep("intro")}
              className="mt-4 block w-full text-center text-sm text-muted-foreground hover:underline"
            >
              Voltar
            </button>
          </div>
        )}

        {step === "waiting" && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="text-mono mb-2 text-primary">Passo 3 de 3</div>
            <h1 className="text-display text-3xl text-ink">Terminou de escanear?</h1>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Toque no botão abaixo depois de concluir o processo no site da 3DLOOK. Pode levar
              até 90 segundos pra calcular suas medidas.
            </p>

            <Button onClick={handleCheckResult} disabled={checking} className="mt-8 w-full">
              {checking ? "Verificando…" : "Já terminei, ver meu resultado"}
            </Button>
            <button
              type="button"
              onClick={() => setStep("instructions")}
              className="mt-4 block w-full text-center text-sm text-muted-foreground hover:underline"
            >
              Ver instruções de novo
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
            <Button className="mt-8" onClick={() => setStep("waiting")}>
              Tentar de novo
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
