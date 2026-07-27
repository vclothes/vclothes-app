import thumbHair9cap from "@/assets/hair/hair9cap.png";
import thumbHair4 from "@/assets/hair/hair4.png";
import thumbHair01 from "@/assets/hair/hair01.png";
import thumbHair02 from "@/assets/hair/hair02.png";
import thumbHair03 from "@/assets/hair/hair03.png";
import thumbHair05 from "@/assets/hair/hair05.png";
import thumbHair06 from "@/assets/hair/hair06.png";
import thumbHair07 from "@/assets/hair/hair07.png";
import thumbHair10cap from "@/assets/hair/hair10cap.png";
import thumbHair12cap from "@/assets/hair/hair12cap.png";
import thumbHair09 from "@/assets/hair/hair09.png";
import thumbHair10 from "@/assets/hair/hair10.png";
import thumbHair11 from "@/assets/hair/hair11.png";
import thumbHair12 from "@/assets/hair/hair12.png";
import thumbHair08 from "@/assets/hair/hair08.png";

// The .glb (public/hair.glb, ~4.7MB) started as a free 21-style CC-BY pack
// from Sketchfab (21 styles, only 15 are actual hairstyles — the rest were
// eyebrows, dropped when trimming). Each entry's `node` is the name of the
// node inside that file to show; every other hair node gets hidden.
// `scale`/`topOffsetMm` override the defaults below for a specific style —
// needed for hair9cap/hair10cap/hair12cap (identical geometry, see the
// comment where they're used) whose bottom rim is jagged rather than a
// clean cut, which showed as a scalp-colored gap at the back of the neck
// at the default scale.
export type HairStyle = {
  id: string;
  node: string;
  thumb: string;
  scale?: number;
  topOffsetMm?: number;
};

export const HAIR_STYLES: HairStyle[] = [
  { id: "hair9cap", node: "hair9cap", thumb: thumbHair9cap, scale: 13 },
  { id: "hair4", node: "hair4", thumb: thumbHair4 },
  { id: "hair01", node: "hair01", thumb: thumbHair01 },
  { id: "hair02", node: "hair02", thumb: thumbHair02 },
  { id: "hair03", node: "hair03", thumb: thumbHair03 },
  { id: "hair05", node: "hair05", thumb: thumbHair05 },
  { id: "hair06", node: "hair06", thumb: thumbHair06 },
  { id: "hair07", node: "hair07", thumb: thumbHair07 },
  { id: "hair10cap", node: "hair10cap", thumb: thumbHair10cap, scale: 13 },
  { id: "hair12cap", node: "hair12cap", thumb: thumbHair12cap, scale: 13 },
  { id: "hair09", node: "hair09", thumb: thumbHair09 },
  { id: "hair10", node: "hair10", thumb: thumbHair10 },
  { id: "hair11", node: "hair11", thumb: thumbHair11 },
  { id: "hair12", node: "hair12", thumb: thumbHair12 },
  { id: "hair08", node: "hair08", thumb: thumbHair08 },
];

export const HAIR_MODEL_URL = "/hair.glb";

// These hairstyles were modeled against a different, unknown reference head,
// not ours — there's no way to fit them exactly. Empirically calibrated
// against a real 3DLOOK scan (screenshot-compared, several iterations) so
// they read as "person with hair" rather than clipping into or floating off
// the scalp. HAIR_SCALE converts the pack's native units into the avatar's
// millimeters (its meshes work out to roughly 1 unit = 1cm, then padded up
// ~15% so the shell clears the scalp instead of intersecting it).
// HAIR_TOP_OFFSET_MM lifts the whole thing slightly above the avatar's own
// head-top for the same reason.
export const HAIR_SCALE = 11.5;
export const HAIR_TOP_OFFSET_MM = 25;

// The head width (mm, measured across a horizontal slice near the top of
// the real scan HAIR_SCALE/topOffsetMm were calibrated against — see
// AvatarViewer's headWidthRef). Every avatar's hair scale gets multiplied
// by (that avatar's own measured head width / this number), so a wider or
// narrower head than the one this was tuned on still gets a proportional
// fit instead of everyone sharing one fixed size.
export const REFERENCE_HEAD_WIDTH_MM = 144.3;
