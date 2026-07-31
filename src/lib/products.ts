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

// volume_params/front_params keys that correspond to each size-chart column.
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
const MEASUREMENT_SCAN_KEYS: Partial<Record<keyof SizeSpec, string[]>> = {
  chestCm: ["chest"],
  waistCm: ["alternative_waist_girth", "pant_waist", "waist_gray"],
  hipCm: ["low_hips"],
  shoulderCm: ["shoulders"],
  collarCm: ["neck_girth", "neck_girth_relaxed"],
  sleeveCm: ["sleeve_length"],
  // lengthCm intentionally omitted — it's a garment spec (total shirt
  // length), not something 3DLOOK measures on a body.
};

// Used for both the size recommendation and the "your measurement" column
// on the size guide — chest/waist/hip/shoulders/collar only, matching
// MEASUREMENT_SCAN_KEYS minus sleeveCm (sleeve length isn't used to pick a
// size, just shown for reference).
const RECOMMENDATION_KEYS: (keyof SizeSpec)[] = [
  "chestCm",
  "waistCm",
  "hipCm",
  "shoulderCm",
  "collarCm",
];

function resolveScanValue(scan: Record<string, number | null>, specKey: keyof SizeSpec) {
  const scanKeys = MEASUREMENT_SCAN_KEYS[specKey];
  if (!scanKeys) return null;
  return scanKeys.map((k) => scan[k]).find((v): v is number => typeof v === "number") ?? null;
}

// How far over a size's own spec a measurement is allowed to run before that
// size no longer fits and the next one up gets tried instead. A body
// measurement doesn't need to be exactly equal to (or under) the garment
// spec — there's normally some ease built into a size already — but past
// this margin the shirt would actually be tight there in real life.
const FIT_TOLERANCE_CM = 2;

// Walks sizes from smallest to largest and returns the first one where
// every measurement the scan actually has (chest/waist/hip/shoulders/collar)
// is within FIT_TOLERANCE_CM of that size's own spec — i.e. the smallest
// size that still fits, not just whichever size is numerically closest on
// average. A single measurement running larger than a size allows (e.g. a
// hip well past that size's hip spec, even if chest/shoulders would fit
// fine) is enough on its own to bump the recommendation up to the next
// size, since the old "closest overall" approach could recommend a size
// that's too tight in one spot as long as it averaged out.
// Returns null if the scan didn't include enough overlapping measurements
// to make a meaningful comparison; returns the largest size if even that
// one runs over on something (there's nothing bigger to offer instead).
export function recommendShirtSize(
  scan: Record<string, number | null> | undefined,
): ShirtSize | null {
  if (!scan) return null;

  const usableKeys = RECOMMENDATION_KEYS.filter((k) => resolveScanValue(scan, k) != null);
  if (usableKeys.length === 0) return null;

  for (const size of SHIRT_SIZES) {
    const spec = SHIRT_SIZE_CHART[size];
    const fits = usableKeys.every((specKey) => {
      const scanValue = resolveScanValue(scan, specKey);
      return scanValue == null || scanValue - spec[specKey] <= FIT_TOLERANCE_CM;
    });
    if (fits) return size;
  }

  return SHIRT_SIZES[SHIRT_SIZES.length - 1];
}

// The person's own measurement for each size-guide row that has a body
// equivalent (everything except lengthCm), so the size guide can show
// "Você" alongside P/M/G/GG instead of leaving the person to eyeball which
// column is closest.
export function getUserMeasurements(
  scan: Record<string, number | null> | undefined,
): Partial<Record<keyof SizeSpec, number>> {
  if (!scan) return {};
  const result: Partial<Record<keyof SizeSpec, number>> = {};
  for (const specKey of Object.keys(MEASUREMENT_SCAN_KEYS) as (keyof SizeSpec)[]) {
    const value = resolveScanValue(scan, specKey);
    if (value != null) result[specKey] = value;
  }
  return result;
}
