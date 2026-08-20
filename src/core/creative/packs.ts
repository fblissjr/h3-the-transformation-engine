/**
 * Injectable creative packs from the H3 Prompt Director Shareable Pack.
 *
 * Each pack supplies concrete, observable traits for the planner to weave
 * into its prose. The serializer never sees these -- they live in the system
 * prompt and shape what the LLM writes, not how code formats it.
 *
 * Source: internal/reference_prompting_h3/H3_Prompt_Director_Shareable_Pack_v2_2026-08-13/
 *   08_H3_AESTHETIC_MOTION_AUDIO_LIBRARY.md
 */

import type { Pack, VisualPackId, MotionPackId, FinishPackId, AudioPackId } from './types';

// ---------------------------------------------------------------------------
// Visual-medium packs (V01-V24)
// ---------------------------------------------------------------------------

export const VISUAL_PACKS: readonly Pack<VisualPackId>[] = [
  {
    id: 'V01',
    name: 'Classical hand-drawn cel',
    directive: 'Clean key poses, confident contour lines, painted backgrounds, clear silhouette staging, natural overlap in hair and clothing.',
  },
  {
    id: 'V02',
    name: 'Limited television animation',
    directive: 'Held poses, crisp key drawings, selective movement in eyes, mouth, and hair tips, small head turns, stable readable staging.',
  },
  {
    id: 'V03',
    name: 'Rubber-hose cartoon',
    directive: 'High-contrast rubber-hose style, elastic limbs, rhythmic bounce, rounded poses, musical accents on physical impacts, simple graphic backgrounds.',
  },
  {
    id: 'V04',
    name: 'Silhouette cutout',
    directive: 'Ornate black cutout animation, flat dark figures, patterned shapes, articulated paper joints, theatrical composition, layered parallax depth.',
  },
  {
    id: 'V05',
    name: 'Stop-motion puppet miniature',
    directive: 'Handcrafted materials, miniature set depth, visible surface texture, stepped frame-to-frame movement, subtle registration variation.',
  },
  {
    id: 'V06',
    name: 'Clay animation',
    directive: 'Softly sculpted forms, faint thumbprint texture, gentle surface wobble, tactile deformation on contact, practical miniature lighting.',
  },
  {
    id: 'V07',
    name: 'Paper collage and cutout',
    directive: 'Layered paper collage, torn and cut edges, printed textures, shallow parallax, composited shadows, handmade depth.',
  },
  {
    id: 'V08',
    name: 'Pencil and watercolor',
    directive: 'Pencil construction lines, translucent watercolor washes, visible paper fiber, soft pigment pooling, restrained color bleed, fluctuating hand-painted edges.',
  },
  {
    id: 'V09',
    name: 'Gouache paint-in-motion',
    directive: 'Layered brush strokes, matte pigment, simplified painted shapes, visible bristle texture, controlled paint-like edge movement.',
  },
  {
    id: 'V10',
    name: 'Rotoscoped painterly realism',
    directive: 'Lifelike timing and body-weight shifts, inked contours, painterly fill, subtle frame-to-frame drawing variation.',
  },
  {
    id: 'V11',
    name: 'Flat mid-century graphic',
    directive: 'Modernist flat shapes, asymmetric composition, bold color blocks, sparse linework, selective limited movement.',
  },
  {
    id: 'V12',
    name: 'Comic print hybrid',
    directive: 'Inked contours, halftone dots, offset color registration, graphic impact frames, stylized motion streaks, punchy panel-like composition.',
  },
  {
    id: 'V13',
    name: 'Psychedelic pop collage',
    directive: 'Saturated flat pop-art color, drifting graphic layers, playful scale changes, decorative pattern, fluid surreal transitions.',
  },
  {
    id: 'V14',
    name: 'High-detail cinematic cel realism',
    directive: 'Dense architectural cel detail, precise mechanical drawing, weighty body motion, atmospheric perspective, dramatic practical light sources.',
  },
  {
    id: 'V15',
    name: 'Painterly magical realism',
    directive: 'Richly observed environments, warm natural light, grounded character acting, soft secondary motion, restrained fantastical detail.',
  },
  {
    id: 'V16',
    name: 'Atmospheric cyber-noir animation',
    directive: 'Cool rain reflections, dense urban haze, precise sparse character movement, slow observational framing, luminous practical signage.',
  },
  {
    id: 'V17',
    name: 'Stylized feature CG',
    directive: 'Clean topology, expressive controlled facial animation, smooth easing, natural secondary motion, cinematic lensing, soft PBR lighting.',
  },
  {
    id: 'V18',
    name: 'Stylized CG comedy',
    directive: 'Bold facial shapes, snappy readable poses, controlled exaggeration, bright character separation, energetic coherent camera.',
  },
  {
    id: 'V19',
    name: 'Photoreal cinematic live action',
    directive: 'Physically plausible materials, motivated practical lighting, natural skin and fabric response, restrained depth of field, coherent motion blur.',
  },
  {
    id: 'V20',
    name: 'Premium product commercial',
    directive: 'Exact surface detail, controlled specular highlights, deliberate negative space, precise camera motion, clean reflections, disciplined brand presentation.',
  },
  {
    id: 'V21',
    name: 'Observational documentary',
    directive: 'Available light, responsive framing, natural exposure variation, unforced blocking, environmental detail, restrained handheld movement.',
  },
  {
    id: 'V22',
    name: 'Archival newsreel',
    directive: 'Period-appropriate framing, limited tonal range, intermittent exposure variation, mechanical camera steadiness, aged photographic texture.',
  },
  {
    id: 'V23',
    name: 'Vector motion design',
    directive: 'Vector-clean geometric shapes, strict alignment, controlled easing curves, layered 2.5D parallax, readable typography zones, precise graphic transitions.',
  },
  {
    id: 'V24',
    name: 'Game-cinematic rendering',
    directive: 'High-end real-time rendering, stable world geometry, readable silhouettes, controlled depth of field, responsive animation, coherent PBR materials.',
  },
] as const satisfies readonly Pack<VisualPackId>[];

// ---------------------------------------------------------------------------
// Motion-behavior packs (M01-M08)
// ---------------------------------------------------------------------------

export const MOTION_PACKS: readonly Pack<MotionPackId>[] = [
  {
    id: 'M01',
    name: 'Naturalistic acting',
    directive: 'Small anticipatory weight shifts, clean arcs, restrained gestures, breathing and eye focus preceding action, secondary motion settling after body.',
  },
  {
    id: 'M02',
    name: 'Limited held timing',
    directive: 'Held key poses, selective facial and hair movement, sparse in-between action, brief stepped transitions.',
  },
  {
    id: 'M03',
    name: 'Snappy cartoon timing',
    directive: 'Strong anticipation, rapid pose change, controlled squash and stretch, brief overshoot, clean held settle.',
  },
  {
    id: 'M04',
    name: 'Tactile stop-motion timing',
    directive: 'Stepped stop-motion cadence, slight frame registration variation, minimal motion blur, tiny material shifts, deliberate pose increments.',
  },
  {
    id: 'M05',
    name: 'Weighty cinematic action',
    directive: 'Clear preparation, believable momentum and resistance, strong contact points, trailing secondary motion, gradual deceleration after impact.',
  },
  {
    id: 'M06',
    name: 'Rhythmic performance',
    directive: 'Body accents and camera reframes landing on audible beats, evolving movement motifs, resolving on closing beat.',
  },
  {
    id: 'M07',
    name: 'Graphic morphing',
    directive: 'Shapes transforming through legible intermediate silhouettes, continuously flowing edges, exchanging color regions, stable graphic destination states.',
  },
  {
    id: 'M08',
    name: 'Product precision',
    directive: 'One controlled object action at a time, exact contact and release, smooth constant-speed movement, minimal vibration, clean alignment.',
  },
] as const satisfies readonly Pack<MotionPackId>[];

// ---------------------------------------------------------------------------
// Finish packs (F01-F08)
// ---------------------------------------------------------------------------

export const FINISH_PACKS: readonly Pack<FinishPackId>[] = [
  {
    id: 'F01',
    name: 'Clean digital',
    directive: 'Stable exposure, crisp edges, minimal grain, neutral highlight rolloff, clean color separation.',
  },
  {
    id: 'F02',
    name: '35mm film',
    directive: 'Fine film grain, mild highlight halation, soft contrast rolloff, subtle gate weave, restrained lens flare.',
  },
  {
    id: 'F03',
    name: '16mm reversal',
    directive: 'Pronounced organic grain, compact highlight latitude, slight color drift, mild flicker, documentary film texture.',
  },
  {
    id: 'F04',
    name: 'VHS tape',
    directive: 'Soft analog detail, light chroma bleed, faint scanline structure, intermittent tracking wobble, low-level tape noise.',
  },
  {
    id: 'F05',
    name: 'Paper and ink',
    directive: 'Visible paper tooth, uneven ink density, restrained line boil, handmade registration variation.',
  },
  {
    id: 'F06',
    name: 'Watercolor and gouache',
    directive: 'Paper fiber, pigment pooling, matte painted texture, soft edge variation, restrained color bleed.',
  },
  {
    id: 'F07',
    name: 'Print and collage',
    directive: 'Halftone or screen-print texture, cut edges, layered shadows, imperfect registration, tactile compositing.',
  },
  {
    id: 'F08',
    name: 'Noir monochrome',
    directive: 'Black-and-white tonal separation, deep controlled shadows, selective highlights, fine grain, minimal midtone haze.',
  },
] as const satisfies readonly Pack<FinishPackId>[];

// ---------------------------------------------------------------------------
// Audio-treatment packs (A01-A08)
// ---------------------------------------------------------------------------

export const AUDIO_PACKS: readonly Pack<AudioPackId>[] = [
  {
    id: 'A01',
    name: 'Natural synchronized realism',
    directive: 'Synchronized footsteps, cloth contact, room tone, environmental depth.',
  },
  {
    id: 'A02',
    name: 'Tactile miniature foley',
    directive: 'Small dry contacts, material creaks, tiny armature clicks, close-set room tone, restrained dynamics.',
  },
  {
    id: 'A03',
    name: 'Vintage cartoon orchestration',
    directive: 'Synchronized instrumental accents matching physical impacts, scored action beats.',
  },
  {
    id: 'A04',
    name: 'Anime action sound design',
    directive: 'Air displacements, cloth snaps, mechanical impacts, brief tonal accents on decisive poses.',
  },
  {
    id: 'A05',
    name: 'Product ASMR',
    directive: 'Close handling sounds including cap clicks, fabric glide, glass contact, packaging folds, room silence.',
  },
  {
    id: 'A06',
    name: 'Documentary location sound',
    directive: 'Location ambience, distant indistinct crowd murmur, environmental occlusion, natural mic perspective.',
  },
  {
    id: 'A07',
    name: 'Analog media audio',
    directive: 'Low tape hiss, limited bandwidth, wow and flutter, mechanical transport noise.',
  },
  {
    id: 'A08',
    name: 'Graphic rhythm bed',
    directive: 'Electronic percussion or acoustic clicks at stated tempo aligned to graphic transitions.',
  },
] as const satisfies readonly Pack<AudioPackId>[];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const visualMap = new Map(VISUAL_PACKS.map((p) => [p.id, p]));
const motionMap = new Map(MOTION_PACKS.map((p) => [p.id, p]));
const finishMap = new Map(FINISH_PACKS.map((p) => [p.id, p]));
const audioMap = new Map(AUDIO_PACKS.map((p) => [p.id, p]));

export function getVisualPack(id: VisualPackId): Pack<VisualPackId> | undefined {
  return visualMap.get(id);
}

export function getMotionPack(id: MotionPackId): Pack<MotionPackId> | undefined {
  return motionMap.get(id);
}

export function getFinishPack(id: FinishPackId): Pack<FinishPackId> | undefined {
  return finishMap.get(id);
}

export function getAudioPack(id: AudioPackId): Pack<AudioPackId> | undefined {
  return audioMap.get(id);
}
