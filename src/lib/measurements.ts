// Only the volume_params/front_params keys we want to surface, in display order.
// Everything else 3DLOOK returns (body_model, textures, debug info, etc.) is internal.
export const MEASUREMENT_LABELS: Record<string, string> = {
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

export function isDisplayableMeasurement(key: string, value: unknown): value is number {
  return key in MEASUREMENT_LABELS && typeof value === "number";
}
