import tshirtBlack from "@/assets/tshirt-black.jpg";

// The catalog shown on the shop tab. Just one real product so far — a
// grid of one card still reads as "a catalog" (vs. the single full-page
// product view this replaced), and new products slot in the same way.
export type Product = {
  id: string;
  name: string;
  image: string;
};

export const PRODUCTS: Product[] = [
  { id: "camiseta-preta", name: "Camiseta Preta Básica", image: tshirtBlack },
];

// Size chart values are cm, as supplied by the team (matches the units
// 3DLOOK's own volume_params/front_params already use — see measurements.ts).
export type ShirtSize = "P" | "M" | "G" | "GG";

export const SHIRT_SIZES: ShirtSize[] = ["P", "M", "G", "GG"];

export type SizeSpec = {
  collarCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  lengthCm: number;
  shoulderCm: number;
  sleeveCm: number;
};

export const SHIRT_SIZE_CHART: Record<ShirtSize, SizeSpec> = {
  P: {
    collarCm: 38,
    chestCm: 104,
    waistCm: 98,
    hipCm: 102,
    lengthCm: 74,
    shoulderCm: 44,
    sleeveCm: 62,
  },
  M: {
    collarCm: 40,
    chestCm: 112,
    waistCm: 106,
    hipCm: 110,
    lengthCm: 76,
    shoulderCm: 46,
    sleeveCm: 64,
  },
  G: {
    collarCm: 42,
    chestCm: 120,
    waistCm: 114,
    hipCm: 118,
    lengthCm: 78,
    shoulderCm: 48,
    sleeveCm: 66,
  },
  GG: {
    collarCm: 44,
    chestCm: 128,
    waistCm: 122,
    hipCm: 126,
    lengthCm: 80,
    shoulderCm: 50,
    sleeveCm: 68,
  },
};

// Display order/labels for the size-guide table — mirrors the chart exactly
// as given (Medida / P / M / G / GG).
export const SIZE_CHART_ROWS: { label: string; key: keyof SizeSpec }[] = [
  { label: "Colarinho (Pescoço)", key: "collarCm" },
  { label: "Peito (Circunferência)", key: "chestCm" },
  { label: "Cintura (Circunferência)", key: "waistCm" },
  { label: "Quadril / Barra (Circunferência)", key: "hipCm" },
  { label: "Comprimento da camisa", key: "lengthCm" },
  { label: "Largura dos ombros", key: "shoulderCm" },
  { label: "Comprimento da manga", key: "sleeveCm" },
];

// volume_params/front_params keys that correspond to each size-chart column
// this garment can actually be matched against. "lengthCm" has no
// body-measurement equivalent (it's a garment spec, not something 3DLOOK
// measures), so it's left out of matching on purpose.
//
// The obvious key names ("waist", "high_hips", "neck") are NOT the actual
// circumferences — confirmed against a real scan's raw JSON, they come back
// as small, unrelated numbers (e.g. "neck": 12.8, "waist": 33.79) that have
// nothing to do with the person's real measurements, while the correct
// circumference lives under a differently-named key that matches 3DLOOK's
// own dashboard values almost exactly. Using the wrong ones was silently
// recommending "P" for nearly everyone, since those three bogus values sit
// far below every size in the chart and swamp the (correct) chest/shoulders
// signal with a near-constant penalty that happens to favor the smallest
// size. Do not "fix" this back to the obvious names without re-checking
// against a real scan's raw output first.
const MATCH_KEYS: { specKey: keyof SizeSpec; scanKeys: string[] }[] = [
  { specKey: "chestCm", scanKeys: ["chest"] },
  { specKey: "waistCm", scanKeys: ["alternative_waist_girth", "pant_waist", "waist_gray"] },
  { specKey: "hipCm", scanKeys: ["low_hips"] },
  { specKey: "shoulderCm", scanKeys: ["shoulders"] },
  { specKey: "collarCm", scanKeys: ["neck_girth", "neck_girth_relaxed"] },
];

// Picks whichever size's chart values are closest overall to this person's
// own scan measurements (least total absolute difference across whichever
// of chest/waist/hip/shoulders/collar the scan actually returned) — garment
// sizing always runs a bit large over the body it's meant to fit, but
// nearest-match is a reasonable default without a real ease/fit model.
// Returns null if the scan didn't include enough overlapping measurements
// to make a meaningful comparison.
export function recommendShirtSize(
  scan: Record<string, number | null> | undefined,
): ShirtSize | null {
  if (!scan) return null;

  const usableKeys = MATCH_KEYS.filter(({ scanKeys }) =>
    scanKeys.some((k) => typeof scan[k] === "number"),
  );
  if (usableKeys.length === 0) return null;

  let best: ShirtSize | null = null;
  let bestScore = Infinity;

  for (const size of SHIRT_SIZES) {
    const spec = SHIRT_SIZE_CHART[size];
    let score = 0;
    for (const { specKey, scanKeys } of usableKeys) {
      const scanValue = scanKeys
        .map((k) => scan[k])
        .find((v): v is number => typeof v === "number");
      if (scanValue == null) continue;
      score += Math.abs(scanValue - spec[specKey]);
    }
    if (score < bestScore) {
      bestScore = score;
      best = size;
    }
  }

  return best;
}
