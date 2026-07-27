// Builds the shape/position parameters for a simple 3D "shirt shell" fitted
// to a person's own 3DLOOK measurements — not a real garment mesh or cloth
// simulation, just a lathed torso silhouette (padded a bit outside the
// body) plus two short sleeve cylinders, rendered on top of the avatar in
// AvatarViewer. Good enough to show roughly how a plain t-shirt sits on
// this specific body and to rotate with it — not a substitute for real
// draping/fit simulation.
//
// Circumference->half-width uses an ellipse approximation (C ≈ π·(a+b),
// with b = OVAL_DEPTH_RATIO·a) rather than treating the torso as a circle
// cross-section, since a real torso reads as noticeably wider than it is
// deep front-to-back.
const OVAL_DEPTH_RATIO = 0.6;

function halfWidthFromCircumferenceCm(circumferenceCm: number): number {
  return (circumferenceCm * 10) / (Math.PI * (1 + OVAL_DEPTH_RATIO));
}

// Landmark heights fall back to rough proportions of the avatar's own
// measured height when 3DLOOK didn't return the specific height field for
// this scan (these fields are less consistently populated than the core
// circumferences).
const FALLBACK_HEIGHT_FRACTION = {
  shoulder: 0.82,
  chest: 0.72,
  waist: 0.62,
  hem: 0.56,
};

export type ShirtFit = {
  shoulderY: number;
  chestY: number;
  waistY: number;
  hemY: number;
  shoulderHalfWidthMm: number;
  chestRadiusMm: number;
  waistRadiusMm: number;
  hemRadiusMm: number;
};

// Returns null if the scan is missing the core measurements this needs
// (chest/waist/hip circumference, shoulder width) — those are reliably
// present once a scan succeeds, so null effectively means "no scan yet."
export function computeShirtFit(
  scan: Record<string, number | null> | undefined,
  bodyTopYMm: number,
): ShirtFit | null {
  if (!scan) return null;

  const chest = scan.chest;
  const waist = scan.alternative_waist_girth ?? scan.pant_waist ?? scan.waist_gray;
  const hip = scan.low_hips;
  const shoulders = scan.shoulders;
  if (
    typeof chest !== "number" ||
    typeof waist !== "number" ||
    typeof hip !== "number" ||
    typeof shoulders !== "number"
  ) {
    return null;
  }

  const landmarkY = (cmField: unknown, fallbackFraction: number) =>
    typeof cmField === "number" ? cmField * 10 : bodyTopYMm * fallbackFraction;

  return {
    shoulderY: landmarkY(scan.back_neck_height, FALLBACK_HEIGHT_FRACTION.shoulder),
    chestY: landmarkY(scan.bust_height, FALLBACK_HEIGHT_FRACTION.chest),
    waistY: landmarkY(scan.waist_height, FALLBACK_HEIGHT_FRACTION.waist),
    hemY: landmarkY(scan.upper_hip_height, FALLBACK_HEIGHT_FRACTION.hem),
    shoulderHalfWidthMm: (shoulders * 10) / 2,
    chestRadiusMm: halfWidthFromCircumferenceCm(chest),
    waistRadiusMm: halfWidthFromCircumferenceCm(waist),
    hemRadiusMm: halfWidthFromCircumferenceCm(hip),
  };
}
