import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shirt, Sparkles, UserRound } from "lucide-react";

import { AvatarViewer } from "@/components/AvatarViewer";
import { Button } from "@/components/ui/button";
import { GuidedCamera } from "@/components/GuidedCamera";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  saveAvatarSkinTone,
  saveUserScanResult,
  SKIN_TONE_PRESETS,
  validatePassword,
} from "@/lib/auth";
import { isDisplayableMeasurement, MEASUREMENT_LABELS } from "@/lib/measurements";
import {
  getUserMeasurements,
  PRODUCTS,
  recommendShirtSize,
  SHIRT_SIZE_CHART,
  SHIRT_SIZES,
  SIZE_CHART_ROWS,
  type ShirtSize,
} from "@/lib/products";
import { createScan, getScanResult, type Gender, type ScanStatus } from "@/lib/threedlook";
import logoVClothes from "@/assets/logo-vclothes.png";

const LANDING_PAGE_URL = "https://v-clothes.henriquecgfarias.workers.dev/";
import poseFrontAvatar from "@/assets/pose-front-avatar.jpg";
import poseSideAvatar from "@/assets/pose-side-avatar.jpg";

export const Route = createFileRoute("/")({
  component: Provador,
});

type Step =
  | "login"
  | "intro"
  | "front_instructions"
  | "front_capture"
  | "side_instructions"
  | "side_capture"
  | "side_processing"
  | "result"
  | "avatar"
  | "customize"
  | "shop"
  | "product"
  | "try_on"
  | "looks"
  | "error";

const STEP_NUMBER: Record<Step, number> = {
  login: 0,
  intro: 1,
  front_instructions: 2,
  front_capture: 3,
  side_instructions: 4,
  side_capture: 5,
  side_processing: 5,
  result: 5,
  avatar: 6,
  customize: 6,
  shop: 7,
  product: 7,
  try_on: 7,
  looks: 7,
  error: 5,
};

const POLL_INTERVAL_MS = 4_000;

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
  const [step, setStep] = useState<Step>("login");
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");
  const [frontImage, setFrontImage] = useState("");
  const [sideImage, setSideImage] = useState("");
  const [result, setResult] = useState<ScanStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [skinTone, setSkinTone] = useState<string | undefined>(undefined);
  const [selectedShirtSize, setSelectedShirtSize] = useState<ShirtSize | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  function handlePickSkinTone(tone: string | null) {
    setSkinTone(tone ?? undefined);
    saveAvatarSkinTone({ data: { skinTone: tone } }).catch((err) =>
      console.error("[Provador] failed to save skin tone", err),
    );
  }

  // Merges both measurement sources the same way the "result" step already
  // does when listing them out — chest/waist tend to live in volume_params,
  // neck/shoulders in front_params, so a size recommendation needs both.
  // Memoized because AvatarViewer's garment-loading effect depends on this
  // object's identity — a fresh literal on every render (the previous
  // code) restarted that effect continuously, cancelling the async GLB
  // load before it ever completed.
  const mergedMeasurements = useMemo(
    () => ({ ...result?.volumeParams, ...result?.frontParams }),
    [result?.volumeParams, result?.frontParams],
  );
  const recommendedShirtSize = recommendShirtSize(mergedMeasurements);
  const userMeasurements = getUserMeasurements(mergedMeasurements);
  // Defaults to the recommendation until the person taps a size themselves.
  const activeShirtSize = selectedShirtSize ?? recommendedShirtSize;
  const selectedProduct = PRODUCTS.find((p) => p.id === selectedProductId) ?? null;

  // Runs once on load — if there's already a valid session cookie, skip the
  // login screen entirely and go straight to wherever this person left off,
  // instead of asking them to log in again (and definitely instead of
  // letting them restart the photo flow and burn another credit).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        if (user) {
          if (user.scanResult) setResult(user.scanResult);
          if (user.skinTone) setSkinTone(user.skinTone);
          setStep(user.hasScan ? "shop" : "intro");
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");

    if (authMode === "register") {
      const passwordError = validatePassword(authPassword);
      if (passwordError) {
        setAuthError(passwordError);
        return;
      }
    }

    setAuthLoading(true);
    try {
      const submit = authMode === "login" ? loginUser : registerUser;
      const user = await submit({ data: { username: authUsername, password: authPassword } });
      if (user.scanResult) setResult(user.scanResult);
      if (user.skinTone) setSkinTone(user.skinTone);
      setStep(user.hasScan ? "shop" : "intro");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await logoutUser().catch(() => {});
    setStep("login");
    setResult(null);
    setFrontImage("");
    setSideImage("");
    setAuthUsername("");
    setAuthPassword("");
  }

  useEffect(() => {
    if (step !== "side_processing") return;
    let cancelled = false;

    (async () => {
      try {
        const { taskSetId } = await createScan({
          data: {
            gender,
            heightCm: Number(height),
            weightKg: Number(weight),
            frontImageBase64: frontImage,
            sideImageBase64: sideImage,
          },
        });
        if (cancelled) return;

        // No time limit here on purpose — 3DLOOK can take a while, and
        // giving up early just to show an error (after already spending a
        // credit) is worse than waiting. A transient hiccup on a single
        // poll doesn't end the wait either; it's logged and retried like
        // any other not-ready-yet result. "Cancelar" on the waiting screen
        // is the only way out short of an actual failure verdict.
        let scan: ScanStatus | null = null;
        while (!scan?.isReady) {
          if (cancelled) return;
          try {
            scan = await getScanResult({ data: { taskSetId } });
          } catch (pollErr) {
            console.error("[Provador] poll attempt failed, retrying", pollErr);
          }
          if (cancelled) return;
          if (!scan?.isReady) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (!scan.isSuccessful) {
          throw new Error((scan.failureMessages ?? []).join(" "));
        }

        setResult(scan);
        setStep("result");
        // Fire-and-forget: the scan already succeeded and is already on
        // screen, so a hiccup saving it shouldn't turn into an error state.
        saveUserScanResult({ data: { scanResult: scan } }).catch((saveErr) =>
          console.error("[Provador] failed to save scan result to account", saveErr),
        );
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
        setStep("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const canContinueFromIntro =
    name.trim().length > 0 &&
    Number(height) >= 120 &&
    Number(height) <= 220 &&
    Number(weight) >= 30 &&
    Number(weight) <= 200;

  const isShopSection =
    step === "shop" ||
    step === "product" ||
    step === "try_on" ||
    step === "avatar" ||
    step === "customize" ||
    step === "looks";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {isShopSection ? (
        <header className="border-b hairline">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
            <div>
              <div className="text-mono text-primary">V-Clothes</div>
              <h1 className="text-display text-3xl text-ink">Descubra seu estilo</h1>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm text-muted-foreground hover:underline"
              >
                Sair
              </button>
            </div>
          </div>
        </header>
      ) : (
        <header className="border-b hairline">
          <div className="mx-auto flex h-18 max-w-3xl items-center px-6">
            <a href={LANDING_PAGE_URL} className="flex items-center">
              <img
                src={logoVClothes}
                alt="V-Clothes"
                className="h-8 w-8 object-contain"
                width={1024}
                height={1024}
              />
              <span className="text-display ml-3 text-xl tracking-tight">V-Clothes</span>
            </a>
            {step !== "login" && (
              <span className="text-mono ml-auto text-muted-foreground">
                Passo {STEP_NUMBER[step]}
              </span>
            )}
          </div>
        </header>
      )}

      <main
        className={`mx-auto w-full flex-1 px-6 ${isShopSection ? "max-w-3xl py-8 pb-28" : "max-w-md py-12"}`}
      >
        {!authChecked ? (
          <div className="flex flex-col items-center py-24 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-secondary border-t-primary" />
          </div>
        ) : (
          <>
            {step === "login" && (
              <div>
                <div className="text-mono mb-2 text-primary">Bem-vindo</div>
                <h1 className="text-display text-4xl text-ink">
                  {authMode === "login" ? "Entrar" : "Criar conta"}
                </h1>
                <p className="mt-3 text-muted-foreground">
                  {authMode === "login"
                    ? "Entre para continuar de onde parou."
                    : "Crie sua conta para começar a experimentar."}
                </p>

                <form className="mt-8 flex flex-col gap-4" onSubmit={handleAuthSubmit}>
                  <div>
                    <Label className="mb-2 block">Usuário</Label>
                    <Input
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div>
                    <Label className="mb-2 block">Senha</Label>
                    <Input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      autoComplete={authMode === "login" ? "current-password" : "new-password"}
                      minLength={authMode === "register" ? 6 : undefined}
                      required
                    />
                    {authMode === "register" && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Mínimo de 6 caracteres, com pelo menos um número. Caracteres especiais são
                        permitidos.
                      </p>
                    )}
                  </div>

                  {authError && <p className="text-sm text-destructive">{authError}</p>}

                  <Button type="submit" className="mt-2" disabled={authLoading}>
                    {authLoading ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}
                  </Button>
                </form>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                  {authMode === "login" ? (
                    <>
                      Não tem conta?{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => {
                          setAuthMode("register");
                          setAuthError("");
                        }}
                      >
                        Criar conta
                      </button>
                    </>
                  ) : (
                    <>
                      Já tem conta?{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => {
                          setAuthMode("login");
                          setAuthError("");
                        }}
                      >
                        Entrar
                      </button>
                    </>
                  )}
                </p>
              </div>
            )}

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
                  Vamos te guiar pra tirar uma boa foto de frente. Confira as dicas antes de
                  começar.
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
                  A borda fica vermelha, amarela ou verde conforme sua posição. Quando ficar verde,
                  a foto é tirada sozinha.
                </p>

                <div className="mt-6 w-full">
                  <GuidedCamera
                    mode="front"
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

                <Button onClick={() => setStep("side_capture")} className="mt-8 w-full">
                  Continuar
                </Button>
                <button
                  type="button"
                  onClick={() => setStep("front_capture")}
                  className="mt-4 block w-full text-center text-sm text-muted-foreground hover:underline"
                >
                  Voltar
                </button>
              </div>
            )}

            {step === "side_capture" && (
              <div className="flex flex-col items-center text-center">
                <h1 className="text-display text-3xl text-ink">Encaixe-se no quadro</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  A borda fica vermelha, amarela ou verde conforme sua posição. Quando ficar verde,
                  a foto é tirada sozinha.
                </p>

                <div className="mt-6 w-full">
                  <GuidedCamera
                    mode="side"
                    onCapture={(base64) => {
                      setSideImage(base64);
                      setStep("side_processing");
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setStep("side_instructions")}
                  className="mt-6 block w-full text-center text-sm text-muted-foreground hover:underline"
                >
                  Ver instruções de novo
                </button>
              </div>
            )}

            {step === "side_processing" && (
              <div className="flex flex-col items-center py-24 text-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-secondary border-t-primary" />
                <h1 className="text-display mt-6 text-2xl text-ink">Calculando suas medidas</h1>
                <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                  Pode demorar alguns minutos — vamos esperar o tempo que precisar.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStep("front_instructions");
                    setFrontImage("");
                    setSideImage("");
                  }}
                  className="mt-8 block text-center text-sm text-muted-foreground hover:underline"
                >
                  Cancelar
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

                <Button className="mt-8" onClick={() => setStep("shop")}>
                  Próximo
                </Button>
              </div>
            )}

            {step === "avatar" && (
              <div>
                <div className="text-mono mb-2 text-primary">Seu avatar</div>
                <h1 className="text-display text-4xl text-ink">Modelo 3D</h1>
                <p className="mt-3 text-muted-foreground">
                  Gerado a partir das suas duas fotos. Arraste para girar.
                </p>

                <div className="mt-8">
                  {result?.modelUrl ? (
                    <AvatarViewer modelUrl={result.modelUrl} color={skinTone} />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-2xl border hairline bg-secondary p-6 text-center text-sm text-muted-foreground">
                      A 3DLOOK não devolveu um modelo 3D para esse escaneamento.
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-center">
                  <Button onClick={() => setStep("customize")}>Personalizar avatar</Button>
                </div>
              </div>
            )}

            {step === "customize" && (
              <div>
                <button
                  type="button"
                  onClick={() => setStep("avatar")}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:underline"
                >
                  ← Voltar
                </button>

                <div className="text-mono mb-2 mt-5 text-primary">Personalização</div>
                <h1 className="text-display text-4xl text-ink">Seu avatar</h1>

                <div className="mt-6">
                  {result?.modelUrl ? (
                    <AvatarViewer modelUrl={result.modelUrl} color={skinTone} />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-2xl border hairline bg-secondary p-6 text-center text-sm text-muted-foreground">
                      A 3DLOOK não devolveu um modelo 3D para esse escaneamento.
                    </div>
                  )}
                </div>

                <div className="mt-7">
                  <div className="text-sm font-semibold text-ink">Cor</div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handlePickSkinTone(null)}
                      aria-label="Tom de pele padrão"
                      title="Padrão"
                      className={`h-10 w-10 shrink-0 rounded-full border-2 bg-[repeating-conic-gradient(var(--secondary)_0%_25%,var(--card)_0%_50%)] bg-[length:8px_8px] ${
                        skinTone === undefined ? "border-primary" : "border-dashed border-border"
                      }`}
                    />
                    {SKIN_TONE_PRESETS.map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => handlePickSkinTone(tone)}
                        aria-label={`Tom de pele ${tone}`}
                        className={`h-10 w-10 shrink-0 rounded-full border-2 ${
                          skinTone === tone ? "border-primary" : "border-transparent"
                        }`}
                        style={{ backgroundColor: tone }}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-8 flex justify-center">
                  <Button onClick={() => setStep("shop")}>Próximo</Button>
                </div>
              </div>
            )}

            {step === "shop" && (
              <div>
                <div className="flex items-baseline justify-between">
                  <h1 className="text-display text-2xl text-ink">Todos os produtos</h1>
                  <span className="text-mono text-muted-foreground">
                    {PRODUCTS.length} {PRODUCTS.length === 1 ? "peça" : "peças"}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4">
                  {PRODUCTS.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => {
                        setSelectedProductId(product.id);
                        setStep("product");
                      }}
                      className="overflow-hidden rounded-2xl border hairline bg-card text-left"
                    >
                      <div className="aspect-4/5 w-full bg-secondary">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="p-3">
                        <div className="text-sm font-medium text-ink">{product.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === "product" && selectedProduct && (
              <div>
                <button
                  type="button"
                  onClick={() => setStep("shop")}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:underline"
                >
                  ← Voltar
                </button>

                <div className="mt-5 overflow-hidden rounded-2xl border hairline bg-card">
                  <div className="aspect-4/5 w-full bg-secondary">
                    <img
                      src={selectedProduct.image}
                      alt={selectedProduct.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-5">
                    <div className="text-xs text-muted-foreground">V-Clothes</div>
                    <h1 className="text-display mt-1 text-2xl text-ink">{selectedProduct.name}</h1>

                    {recommendedShirtSize && (
                      <p className="mt-3 text-sm text-foreground">
                        Tamanho recomendado pra você:{" "}
                        <span className="font-semibold text-primary">{recommendedShirtSize}</span>
                      </p>
                    )}

                    <div className="mt-5">
                      <div className="text-sm font-semibold text-ink">Tamanho</div>
                      <div className="mt-2 flex gap-2">
                        {SHIRT_SIZES.map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => setSelectedShirtSize(size)}
                            aria-label={`Tamanho ${size}`}
                            className={`flex h-11 w-14 items-center justify-center rounded-xl border-2 text-sm font-medium ${
                              activeShirtSize === size
                                ? "border-primary bg-primary/10 text-primary"
                                : "border hairline text-foreground"
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6">
                      <div className="text-sm font-semibold text-ink">Guia de medidas</div>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[500px] text-sm">
                          <thead>
                            <tr className="border-b hairline text-left text-muted-foreground">
                              <th className="py-2 pr-3 font-medium">Medida</th>
                              <th className="bg-secondary px-2 py-2 text-center font-medium text-ink">
                                Você
                              </th>
                              {SHIRT_SIZES.map((size) => (
                                <th
                                  key={size}
                                  className={`px-2 py-2 text-center font-medium ${
                                    activeShirtSize === size ? "text-primary" : ""
                                  }`}
                                >
                                  {size}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {SIZE_CHART_ROWS.map(({ label, key }) => (
                              <tr key={key} className="border-b hairline last:border-0">
                                <td className="py-2 pr-3 text-foreground">{label}</td>
                                <td className="bg-secondary px-2 py-2 text-center font-semibold text-ink">
                                  {userMeasurements[key] != null
                                    ? `${userMeasurements[key].toFixed(1)} cm`
                                    : "—"}
                                </td>
                                {SHIRT_SIZES.map((size) => (
                                  <td
                                    key={size}
                                    className={`px-2 py-2 text-center ${
                                      activeShirtSize === size
                                        ? "font-semibold text-primary"
                                        : "text-muted-foreground"
                                    }`}
                                  >
                                    {SHIRT_SIZE_CHART[size][key]} cm
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <Button
                      className="mt-6 w-full"
                      disabled={!result?.modelUrl}
                      onClick={() => setStep("try_on")}
                    >
                      Experimentar
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {step === "try_on" && selectedProduct && (
              <div>
                <button
                  type="button"
                  onClick={() => setStep("product")}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:underline"
                >
                  ← Voltar
                </button>

                <div className="text-mono mb-2 mt-5 text-primary">Experimentar</div>
                <h1 className="text-display text-4xl text-ink">{selectedProduct.name}</h1>
                <p className="mt-3 text-muted-foreground">
                  Ajustado às suas medidas — sem simulação de tecido em tempo real, mas gira junto
                  com o avatar.
                </p>

                <div className="mt-6">
                  {result?.modelUrl ? (
                    <AvatarViewer
                      modelUrl={result.modelUrl}
                      color={skinTone}
                      showShirt
                      scanMeasurements={mergedMeasurements}
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-2xl border hairline bg-secondary p-6 text-center text-sm text-muted-foreground">
                      A 3DLOOK não devolveu um modelo 3D para esse escaneamento.
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === "looks" && (
              <div className="flex flex-col items-center py-24 text-center">
                <Sparkles className="h-8 w-8 text-muted-foreground" />
                <h1 className="text-display mt-4 text-2xl text-ink">Looks em breve</h1>
                <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                  Em breve você vai poder combinar peças com o seu avatar aqui.
                </p>
              </div>
            )}

            {step === "error" && (
              <div className="flex flex-col items-center py-24 text-center">
                <h1 className="text-display text-2xl text-ink">Não foi possível calcular</h1>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">{errorMessage}</p>
                <Button
                  className="mt-8"
                  onClick={() => {
                    setStep("front_instructions");
                    setFrontImage("");
                    setSideImage("");
                  }}
                >
                  Tentar de novo
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {isShopSection && (
        <nav className="fixed inset-x-0 bottom-0 border-t hairline bg-card">
          <div className="mx-auto grid max-w-3xl grid-cols-3">
            <button
              type="button"
              onClick={() => setStep("shop")}
              className={`flex flex-col items-center gap-1 py-3 text-xs ${
                step === "shop" || step === "product" || step === "try_on"
                  ? "text-ink"
                  : "text-muted-foreground"
              }`}
            >
              <Shirt className="h-5 w-5" />
              Roupas
            </button>
            <button
              type="button"
              onClick={() => setStep("looks")}
              className={`flex flex-col items-center gap-1 py-3 text-xs ${
                step === "looks" ? "text-ink" : "text-muted-foreground"
              }`}
            >
              <Sparkles className="h-5 w-5" />
              Looks
            </button>
            <button
              type="button"
              onClick={() => setStep("avatar")}
              className={`flex flex-col items-center gap-1 py-3 text-xs ${
                step === "avatar" || step === "customize" ? "text-ink" : "text-muted-foreground"
              }`}
            >
              <UserRound className="h-5 w-5" />
              Avatar
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
