/**
 * Design tokens — ported from apps/desktop/src/renderer/styles/theme.css.
 * Direction: "financial terminal / editorial" — dark, dense, tabular,
 * one warm accent, semantic positive/negative, restrained neutrals.
 *
 * Keep names aligned with desktop CSS variables so the visual contract
 * stays single-sourced even though the runtime is different.
 */

export const colors = {
  bg: '#0a0a0c',
  bgRaised: '#0f0f12',
  surface1: '#131317',
  surface2: '#181820',
  surface3: '#1f1f28',

  line: '#26262e',
  lineSoft: '#1d1d24',
  lineStrong: '#33333d',

  fg: '#ececf0',
  fgMuted: '#8a8a95',
  fgSoft: '#5a5a63',

  accent: '#ff6a3d',
  accentHover: '#ff7d55',
  accentSoft: 'rgba(255, 106, 61, 0.14)',
  accentInk: '#faf9f7',

  positive: '#5ccf9a',
  positiveSoft: 'rgba(92, 207, 154, 0.14)',
  negative: '#ff7676',
  negativeSoft: 'rgba(255, 118, 118, 0.14)',
  info: '#8ab4f8',
  infoSoft: 'rgba(138, 180, 248, 0.14)',
  warning: '#ffc66d',
  warningSoft: 'rgba(255, 198, 109, 0.14)',

  chart1: '#ff6a3d',
  chart2: '#ffa066',
  chart3: '#ffc088',
  chart4: '#8ab4f8',
  chart5: '#5ccf9a',
  chart6: '#b794f4',
  chartOther: '#4a4a54',
} as const

export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const

/**
 * Mobile reads at closer distance than desktop, so the scale starts a
 * bit higher than the desktop (which uses 0.72rem ≈ 11.5px as xs).
 */
export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  xxxl: 32,
} as const

export const lineHeight = {
  tight: 1.15,
  normal: 1.45,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const motion = {
  fast: 140,
  base: 220,
} as const

/** Tracking is per-element via `letterSpacing` on `Text` styles. */
export const tracking = {
  base: -0.2,
  label: 0.6,
} as const

/**
 * iOS uses `shadow*` props; Android uses `elevation`. Apply both.
 * Keep shadows rare — the design is calm, not chrome-heavy.
 */
export const shadow = {
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 2,
  },
  raised: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 32,
    elevation: 16,
  },
} as const
