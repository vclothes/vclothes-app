import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { GuidedCamera } from "@/components/GuidedCamera";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { Gender } from "@/lib/threedlook";
import logoVClothes from "@/assets/logo-vclothes.png";
import poseFrontAvatar from "@/assets/pose-front-avatar.jpg";
import poseSideAvatar from "@/assets/pose-side-avatar.jpg";

export const Route = createFileRoute("/")({
  component: Provador,
});

type Step = "intro" | "front_instructions" | "front_capture" | "side_instructions";

const STEP_NUMBER: Record<Step, number> = {
  intro: 1,
  front_instructions: 2,
  front_capture: 3,
  side_instructions: 4,
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

const FRONT_PHOTO_TIPS = [
  "Fique de frente para a câmera, com o corpo inteiro visível.",
  "Braços levemente afastados do corpo, como na ilustração.",
  "Roupas justas ao corpo, sem casacos ou peças largas por cima.",
  "Fundo liso e ambiente bem iluminado.",
];

const SIDE_PHOTO_TIPS = [
  "Gire 90° e fique de lado (perfil) para a câmera.",
  "Mesma distância e iluminação da foto de frente.",
  "Braço ao lado do corpo, sem cruzar na frente.",
  "Olhe para o lado, não para a câmera.",
];

function Provador() {
  const [step, setStep] = useState<Step>("intro");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");
  const [frontImage, setFrontImage] = useState("");

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
          <span className="text-mono ml-auto text-muted-foreground">Passo {STEP_NUMBER[step]}</span>
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

            <div className="mt-8 overflow-hidden rounded-2xl bg-secondary">
              <img
                src={poseFrontAvatar}
                alt="Referência da pose de frente"
                className="h-64 w-auto"
              />
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

            <Button onClick={() => setStep("front_capture")} className="mt-8 w-full">
              Continuar
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

        {step === "front_capture" && (
          <div className="flex flex-col items-center text-center">
            <h1 className="text-display text-3xl text-ink">Encaixe-se no quadro</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A borda fica vermelha, amarela ou verde conforme sua posição. Quando ficar verde, a
              foto é tirada sozinha.
            </p>

            <div className="mt-6 w-full">
              <GuidedCamera
                onCapture={(base64) => {
                  setFrontImage(base64);
                  setStep("side_instructions");
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => setStep("front_instructions")}
              className="mt-6 block w-full text-center text-sm text-muted-foreground hover:underline"
            >
              Ver instruções de novo
            </button>
          </div>
        )}

        {step === "side_instructions" && (
          <div className="flex flex-col items-center text-center">
            <h1 className="text-display text-4xl text-ink">Foto de perfil</h1>
            <p className="mt-3 text-muted-foreground">
              Foto de frente ok! Agora vamos tirar sua foto de perfil (de lado).
            </p>

            <div className="mt-8 overflow-hidden rounded-2xl bg-secondary">
              <img
                src={poseSideAvatar}
                alt="Referência da pose de perfil"
                className="h-64 w-auto"
              />
            </div>

            <ul className="mt-8 flex w-full flex-col gap-3 text-left">
              {SIDE_PHOTO_TIPS.map((tip) => (
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
              onClick={() => setStep("front_capture")}
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
