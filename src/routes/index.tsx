import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { createScan, getScanResult, type Gender, type ScanStatus } from "@/lib/threedlook";
import logoVClothes from "@/assets/logo-vclothes.png";

export const Route = createFileRoute("/")({
  component: Provador,
});

type Step = "intro" | "capture" | "processing" | "result" | "error";

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

function PhotoField({
  label,
  hint,
  file,
  onChange,
}: {
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = file ? URL.createObjectURL(file) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-sm font-medium text-primary hover:underline"
        >
          {file ? "Trocar foto" : "Escolher foto"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-2xl border hairline bg-secondary/40"
      >
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="px-6 text-center text-sm text-muted-foreground">Toque para enviar a foto</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
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

  async function handleSubmitPhotos() {
    if (!frontFile || !sideFile) return;
    setStep("processing");
    setErrorMessage("");

    try {
      const [frontImageBase64, sideImageBase64] = await Promise.all([
        fileToBase64(frontFile),
        fileToBase64(sideFile),
      ]);

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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b hairline">
        <div className="mx-auto flex h-18 max-w-3xl items-center px-6">
          <img src={logoVClothes} alt="V-Clothes" className="h-8 w-8 object-contain" width={1024} height={1024} />
          <span className="text-display ml-3 text-xl tracking-tight">V-Clothes</span>
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
                <Label className="mb-3 block">Gênero</Label>
                <GenderSelect value={gender} onChange={setGender} />
              </div>

              <NumberStepper label="Altura" unit="cm" value={height} onChange={setHeight} min={120} max={220} />
              <NumberStepper label="Peso" unit="kg" value={weight} onChange={setWeight} min={30} max={200} />

              <Button disabled={!canContinueFromIntro} onClick={() => setStep("capture")} className="mt-2">
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === "capture" && (
          <div>
            <div className="text-mono mb-2 text-primary">Passo 2 de 2</div>
            <h1 className="text-display text-4xl text-ink">Suas fotos</h1>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Vista roupa justa ao corpo, sem casaco largo</li>
              <li>Fique num fundo liso, bem iluminado</li>
              <li>Fique a 3-4 passos da câmera, corpo inteiro visível</li>
            </ul>

            <div className="mt-8 flex flex-col gap-8">
              <PhotoField
                label="Foto de frente"
                hint="De frente pra câmera, braços afastados do corpo em 'A', pernas separadas."
                file={frontFile}
                onChange={setFrontFile}
              />
              <PhotoField
                label="Foto de perfil"
                hint="De lado, braços alinhados com a linha da calça, pernas juntas."
                file={sideFile}
                onChange={setSideFile}
              />

              <Button disabled={!frontFile || !sideFile} onClick={handleSubmitPhotos}>
                Enviar e calcular medidas
              </Button>
              <button
                type="button"
                onClick={() => setStep("intro")}
                className="text-sm text-muted-foreground hover:underline"
              >
                Voltar
              </button>
            </div>
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
            <Button className="mt-8" onClick={() => setStep("capture")}>
              Tentar novamente
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
