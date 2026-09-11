/**
 * VISION-TRACKER · chromatic system
 *
 * Deliberately not the default sci-fi neon set. No #00FFFF, no #00FF00, no #FF0000.
 * The palette is drawn from analogue optics: exposed film base, sodium-vapour
 * street light, oxidised copper, and the grey-green of a phosphor tube that has
 * been left on too long. Every HUD element must source its colour from here.
 */
export const PALETTE = {
  /** Deepest ground. Not black — a cold bituminous green-black. */
  ground: '#070A09',
  /** Panel fill, one step above ground. */
  substrate: '#0D1211',
  /** Raised surface / chrome plate. */
  plate: '#151C1A',
  /** Hairline structure. */
  rule: '#2A3532',

  /** Primary read-out. Aged sodium-vapour, warm and slightly dirty. */
  sodium: '#E4B056',
  /** Sodium at low intensity, for inactive structure. */
  sodiumDim: '#7A6135',

  /** Secondary type. Unbleached film base. */
  bone: '#DCD3BE',
  boneDim: '#8A8577',

  /** Biometric / living-subject tracking. Oxidised copper, not neon green. */
  verdigris: '#6F9E8A',
  verdigrisDim: '#3C5A4E',

  /** Inanimate object classification. Cold pewter. */
  pewter: '#8A98A2',
  pewterDim: '#4A555C',

  /** Articulation / skeletal. Faded indigo ink. */
  indigo: '#7B86B8',
  indigoDim: '#414868',

  /** Attention state. Burnt oxide — reads urgent without being fire-engine red. */
  oxide: '#C4562A',
  /** Critical. Deeper, arterial rust. */
  oxideDeep: '#8E3316',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Applies an alpha channel to a palette hex without allocating a colour object. */
export function alpha(hex: string, a: number): string {
  const n = Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${n}`;
}

/** Per-module signature colour, so every overlay is instantly attributable. */
export const MODULE_COLOR = {
  face: PALETTE.sodium,
  hands: PALETTE.verdigris,
  pose: PALETTE.indigo,
  objects: PALETTE.pewter,
} as const;
