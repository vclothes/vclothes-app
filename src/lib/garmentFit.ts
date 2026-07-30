// Fitting parameters for the real garment asset AvatarViewer overlays on
// the avatar (public/shirt.glb) — a professionally-modeled t-shirt from a
// free 3D asset pack (CLO Virtual Fashion export: simulated cotton-jersey
// body + rib collar/cuffs), not something we built or AI-generated. It
// comes pre-shaped at whatever size its creator simulated it at, so it
// needs to be scaled per person the same way the hairstyles are (see
// REFERENCE_HEAD_WIDTH_MM in products.ts for the same pattern).
//
// REFERENCE_CHEST_CIRCUMFERENCE_MM was back-calculated by testing against
// a real body scan: the garment only cleared that body's chest/belly
// (roughly 125.7cm circumference, measured from the scan mesh) once
// scaled up 1.42x, so its native (1x) size corresponds to about 88.5cm
// chest circumference (125.7 / 1.42).
export const REFERENCE_CHEST_CIRCUMFERENCE_MM = 885;

// Where the garment's own collar/shoulder line should sit, as a fraction
// of the avatar's own total height (bodyTopYRef) — same convention as the
// hairstyle fitting, tuned by eye against a real body render.
export const GARMENT_COLLAR_HEIGHT_FRACTION = 0.86;

// Returns null if the scan doesn't have a chest circumference yet (no scan
// result, or 3DLOOK didn't return it) — null means "don't show the
// garment," since there's nothing to size it against.
export function computeGarmentScale(
  scan: Record<string, number | null> | undefined,
): number | null {
  if (!scan) return null;
  const chest = scan.chest;
  if (typeof chest !== "number") return null;
  return (chest * 10) / REFERENCE_CHEST_CIRCUMFERENCE_MM;
}
