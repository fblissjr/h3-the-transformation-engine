/**
 * Named creative presets.
 *
 * Each preset maps to a recognisable creative intent -- the equivalent of
 * the original Transformation Engine's "wild", "glitch" and "smart enhance"
 * modes, expressed as concrete pack combinations that the H3 planner can
 * execute within the formal prompt grammar.
 */

import type { CreativeSelection } from './types';

export interface CreativePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly selection: CreativeSelection;
}

export const PRESETS: readonly CreativePreset[] = [
  // -- Smart Enhance equivalents (directed, full strength) --------------------
  {
    id: 'cinema-classic',
    name: 'Cinema Classic',
    description: 'Photoreal cinematography with 35mm grain and naturalistic acting.',
    selection: { visual: 'V19', motion: 'M01', finish: 'F02', audio: 'A01', strength: 'full' },
  },
  {
    id: 'anime-action',
    name: 'Anime Action',
    description: 'High-detail cinematic cel with weighty action and anime action sound design.',
    selection: { visual: 'V14', motion: 'M05', finish: 'F01', audio: 'A04', strength: 'full' },
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Observational realism with 16mm grain and location sound.',
    selection: { visual: 'V21', motion: 'M01', finish: 'F03', audio: 'A06', strength: 'full' },
  },
  {
    id: 'product-reveal',
    name: 'Product Reveal',
    description: 'Premium commercial precision with ASMR handling sounds.',
    selection: { visual: 'V20', motion: 'M08', finish: 'F01', audio: 'A05', strength: 'full' },
  },
  {
    id: 'storybook',
    name: 'Storybook',
    description: 'Warm golden-age cel animation with watercolor finish.',
    selection: { visual: 'V01', motion: 'M01', finish: 'F06', audio: 'A01', strength: 'full' },
  },
  {
    id: 'cyber-noir',
    name: 'Cyber Noir',
    description: 'Atmospheric cyber-noir with noir monochrome and moody precision.',
    selection: { visual: 'V16', motion: 'M01', finish: 'F08', audio: 'A01', strength: 'full' },
  },
  // -- Wild / Glitch equivalents (stress-test strength) -----------------------
  {
    id: 'analog-glitch',
    name: 'Analog Glitch',
    description: 'VHS tracking wobble, chroma bleed, print misregistration.',
    selection: { visual: 'V12', finish: 'F04', audio: 'A07', strength: 'stress-test' },
  },
  {
    id: 'psychedelic',
    name: 'Psychedelic',
    description: 'Fluid surreal pop collage with graphic morphing transitions.',
    selection: { visual: 'V13', motion: 'M07', finish: 'F07', audio: 'A08', strength: 'stress-test' },
  },
  {
    id: 'clay-world',
    name: 'Clay World',
    description: 'Full clay animation with stop-motion timing and miniature foley.',
    selection: { visual: 'V06', motion: 'M04', finish: 'F02', audio: 'A02', strength: 'stress-test' },
  },
  {
    id: 'paper-cutout',
    name: 'Paper Cutout',
    description: 'Silhouette cutout figures with paper collage environments.',
    selection: { visual: 'V04', motion: 'M02', finish: 'F05', audio: 'A02', strength: 'stress-test' },
  },
  {
    id: 'comic-pop',
    name: 'Comic Pop',
    description: 'Inked comic contours with halftone shading and snappy cartoon timing.',
    selection: { visual: 'V12', motion: 'M03', finish: 'F07', audio: 'A03', strength: 'stress-test' },
  },
  {
    id: 'retro-vhs',
    name: 'Retro VHS',
    description: '1990s camcorder aesthetic with tape artifacts and analog audio.',
    selection: { visual: 'R28', finish: 'F04', audio: 'A07', strength: 'full' },
  },
] as const satisfies readonly CreativePreset[];

const presetMap = new Map(PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): CreativePreset | undefined {
  return presetMap.get(id);
}

/**
 * Presets suitable for wild mode -- those with stress-test strength and
 * enough G/S/P/M/T leverage to avoid collapsing to H3's default.
 */
export function wildPresets(): readonly CreativePreset[] {
  return PRESETS.filter((p) => p.selection.strength === 'stress-test');
}
