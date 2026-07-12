import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { Gender } from "@/lib/threedlook";
import logoVClothes from "@/assets/logo-vclothes.png";

export const Route = createFileRoute("/")({
  component: Provador,
});

type Step = "intro" | "front_instructions";

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

function FrontPoseIllustration() {
  return (
    <svg viewBox="0 0 300 400" className="h-64 w-auto" aria-hidden="true">
      <rect x="0" y="0" width="300" height="400" rx="24" className="fill-secondary" />
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        className="text-ink"
      >
        <circle cx="150" cy="70" r="30" />
        <line x1="150" y1="100" x2="150" y2="240" />
        <line x1="150" y1="130" x2="85" y2="95" />
        <line x1="150" y1="130" x2="215" y2="95" />
        <line x1="150" y1="240" x2="112" y2="360" />
        <line x1="150" y1="240" x2="188" y2="360" />
        <line x1="100" y1="160" x2="200" y2="160" />
      </g>
    </svg>
  );
}

const FRONT_PHOTO_TIPS = [
  "Fique de frente para a câmera, com o corpo inteiro visível.",
  "Braços levemente afastados do corpo, como na ilustração.",
  "Roupas justas ao corpo, sem casacos ou peças largas por cima.",
  "Fundo liso e ambiente bem iluminado.",
];

function Provador() {
  const [step, setStep] = useState<Step>("intro");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");

  const canContinueFromIntro =
    name.trim().length > 0 &&
    Number(height) >= 120 &&
    Number(height) <= 220 &&
    Number(weight) >= 30 &&
    Number(weight) <= 200;

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
          <span className="text-mono ml-auto text-muted-foreground">
            Passo {step === "intro" ? 1 : 2}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-6 py-12">
        {step === "intro" && (
          <div>
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

              <Button
                disabled={!canContinueFromIntro}
                onClick={() => setStep("front_instructions")}
                className="mt-2"
              >
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === "front_instructions" && (
          <div className="flex flex-col items-center text-center">
            <h1 className="text-display text-4xl text-ink">Foto de frente</h1>
            <p className="mt-3 text-muted-foreground">
              Vamos te guiar pra tirar uma boa foto de frente. Confira as dicas antes de começar.
            </p>

            <div className="mt-8">
              <FrontPoseIllustration />
            </div>

            <ul className="mt-8 flex w-full flex-col gap-3 text-left">
              {FRONT_PHOTO_TIPS.map((tip) => (
                <li key={tip} className="flex gap-3 text-sm text-foreground">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-medium text-primary-foreground">
                    ✓
                  </span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>

            <Button className="mt-8 w-full">Continuar</Button>
            <button
              type="button"
              onClick={() => setStep("intro")}
              className="mt-4 block w-full text-center text-sm text-muted-foreground hover:underline"
            >
              Voltar
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
