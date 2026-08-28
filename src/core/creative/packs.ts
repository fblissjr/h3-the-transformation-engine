/**
 * Injectable creative packs from the H3 Prompt Director Shareable Pack.
 *
 * Each pack supplies concrete, observable traits for the planner to weave
 * into its prose. The serializer never sees these -- they live in the system
 * prompt and shape what the LLM writes, not how code formats it.
 *
 * Each table is the single source for its family: the id union, the display
 * name, the directive text and the strength axes all come from the one array,
 * the way `src/core/ir/vocab.ts` derives its unions. Adding a pack is a
 * one-place edit and cannot leave a table half-updated.
 *
 * Source: the H3 Prompt Director Shareable Pack, aesthetic/motion/audio library.
 *
 * V25-V27, F09 and A09 came later, from a coverage gap rather than that pack:
 * footage that is what a device recorded -- phone, fixed camera, webcam, and
 * the sensor and microphone that go with them -- had no entry in any table,
 * with V19 and V21 the nearest and neither of them about the recording. They
 * claim no leverage axis except F09's palette remap, which is correct and not
 * an omission: device capture is photorealism recorded badly rather than a
 * move away from it, so the wild draw should never land on one.
 */

/**
 * The five axes of style leverage against H3's photorealism default.
 *
 * G  Geometry / material change (clay, cutout, marble, liquid)
 * S  Shape / edge / shadow grammar (carved shadows, broken contours, posterized)
 * P  Palette / value system (2-3 colour limits, posterized ramps, blacklight)
 * M  Motion grammar (squash and stretch, rhythmic bounce, stepped holds)
 * T  Animated texture / process (line boil, paint crawl, misregistration)
 */
export type Axis = 'G' | 'S' | 'P' | 'M' | 'T';

/**
 * One entry in a pack table.
 *
 * Audio packs carry an empty `axes`: a sound treatment does not move H3 away
 * from photorealism, so audio is deliberately absent from strength scoring.
 */
export interface PackDef {
  readonly id: string;
  readonly name: string;
  readonly directive: string;
  readonly axes: readonly Axis[];
}

// ---------------------------------------------------------------------------
// Visual-medium packs (V01-V27)
// ---------------------------------------------------------------------------

export const VISUAL_PACKS = [
  {
    id: 'V01',
    name: 'Classical hand-drawn cel',
    directive: 'Clean key poses, confident contour lines, painted backgrounds, clear silhouette staging, natural overlap in hair and clothing.',
    axes: ['S', 'T'],
  },
  {
    id: 'V02',
    name: 'Limited television animation',
    directive: 'Held poses, crisp key drawings, selective movement in eyes, mouth, and hair tips, small head turns, stable readable staging.',
    axes: ['M'],
  },
  {
    id: 'V03',
    name: 'Rubber-hose cartoon',
    directive: 'High-contrast rubber-hose style, elastic limbs, rhythmic bounce, rounded poses, musical accents on physical impacts, simple graphic backgrounds.',
    axes: ['S', 'M'],
  },
  {
    id: 'V04',
    name: 'Silhouette cutout',
    directive: 'Ornate black cutout animation, flat dark figures, patterned shapes, articulated paper joints, theatrical composition, layered parallax depth.',
    axes: ['G', 'S'],
  },
  {
    id: 'V05',
    name: 'Stop-motion puppet miniature',
    directive: 'Handcrafted materials, miniature set depth, visible surface texture, stepped frame-to-frame movement, subtle registration variation.',
    axes: ['G', 'T'],
  },
  {
    id: 'V06',
    name: 'Clay animation',
    directive: 'Softly sculpted forms, faint thumbprint texture, gentle surface wobble, tactile deformation on contact, practical miniature lighting.',
    axes: ['G', 'T'],
  },
  {
    id: 'V07',
    name: 'Paper collage and cutout',
    directive: 'Layered paper collage, torn and cut edges, printed textures, shallow parallax, composited shadows, handmade depth.',
    axes: ['G', 'T'],
  },
  {
    id: 'V08',
    name: 'Pencil and watercolor',
    directive: 'Pencil construction lines, translucent watercolor washes, visible paper fiber, soft pigment pooling, restrained color bleed, fluctuating hand-painted edges.',
    axes: ['S', 'P', 'T'],
  },
  {
    id: 'V09',
    name: 'Gouache paint-in-motion',
    directive: 'Layered brush strokes, matte pigment, simplified painted shapes, visible bristle texture, controlled paint-like edge movement.',
    axes: ['S', 'T'],
  },
  {
    id: 'V10',
    name: 'Rotoscoped painterly realism',
    directive: 'Lifelike timing and body-weight shifts, inked contours, painterly fill, subtle frame-to-frame drawing variation.',
    axes: ['S', 'T'],
  },
  {
    id: 'V11',
    name: 'Flat mid-century graphic',
    directive: 'Modernist flat shapes, asymmetric composition, bold color blocks, sparse linework, selective limited movement.',
    axes: ['S', 'P'],
  },
  {
    id: 'V12',
    name: 'Comic print hybrid',
    directive: 'Inked contours, halftone dots, offset color registration, graphic impact frames, stylized motion streaks, punchy panel-like composition.',
    axes: ['S', 'P', 'T'],
  },
  {
    id: 'V13',
    name: 'Psychedelic pop collage',
    directive: 'Saturated flat pop-art color, drifting graphic layers, playful scale changes, decorative pattern, fluid surreal transitions.',
    axes: ['S', 'P', 'T'],
  },
  {
    id: 'V14',
    name: 'High-detail cinematic cel realism',
    directive: 'Dense architectural cel detail, precise mechanical drawing, weighty body motion, atmospheric perspective, dramatic practical light sources.',
    axes: ['S'],
  },
  {
    id: 'V15',
    name: 'Painterly magical realism',
    directive: 'Richly observed environments, warm natural light, grounded character acting, soft secondary motion, restrained fantastical detail.',
    axes: ['S'],
  },
  {
    id: 'V16',
    name: 'Atmospheric cyber-noir animation',
    directive: 'Cool rain reflections, dense urban haze, precise sparse character movement, slow observational framing, luminous practical signage.',
    axes: ['S', 'P'],
  },
  {
    id: 'V17',
    name: 'Stylized feature CG',
    directive: 'Clean topology, expressive controlled facial animation, smooth easing, natural secondary motion, cinematic lensing, soft PBR lighting.',
    axes: [],
  },
  {
    id: 'V18',
    name: 'Stylized CG comedy',
    directive: 'Bold facial shapes, snappy readable poses, controlled exaggeration, bright character separation, energetic coherent camera.',
    axes: ['S', 'M'],
  },
  {
    id: 'V19',
    name: 'Photoreal cinematic live action',
    directive: 'Physically plausible materials, motivated practical lighting, natural skin and fabric response, restrained depth of field, coherent motion blur.',
    axes: [],
  },
  {
    id: 'V20',
    name: 'Premium product commercial',
    directive: 'Exact surface detail, controlled specular highlights, deliberate negative space, precise camera motion, clean reflections, disciplined brand presentation.',
    axes: [],
  },
  {
    id: 'V21',
    name: 'Observational documentary',
    directive: 'Available light, responsive framing, natural exposure variation, unforced blocking, environmental detail, restrained handheld movement.',
    axes: [],
  },
  {
    id: 'V22',
    name: 'Archival newsreel',
    directive: 'Period-appropriate framing, limited tonal range, intermittent exposure variation, mechanical camera steadiness, aged photographic texture.',
    axes: ['T'],
  },
  {
    id: 'V23',
    name: 'Vector motion design',
    directive: 'Vector-clean geometric shapes, strict alignment, controlled easing curves, layered 2.5D parallax, readable typography zones, precise graphic transitions.',
    axes: ['S'],
  },
  {
    id: 'V24',
    name: 'Game-cinematic rendering',
    directive: 'High-end real-time rendering, stable world geometry, readable silhouettes, controlled depth of field, responsive animation, coherent PBR materials.',
    axes: [],
  },
  {
    id: 'V25',
    name: 'Handheld phone capture',
    directive: 'Vertical framing, autofocus hunting between subjects, exposure stepping as the camera turns, rolling-shutter lean on fast pans, compression blocking in the shadows.',
    axes: [],
  },
  {
    id: 'V26',
    name: 'Fixed surveillance capture',
    directive: 'High static mounting, wide-angle edge distortion, uneven room coverage, one long unbroken take, subjects entering and leaving at the frame edges.',
    axes: [],
  },
  {
    id: 'V27',
    name: 'Webcam and video call',
    directive: 'Fixed near-eye-level framing, shallow small-sensor depth, uneven key from a screen, dropped frames on fast movement, compression smearing across motion.',
    axes: [],
  },
] as const satisfies readonly PackDef[];

/** Derived from the table above, so adding a pack is a one-place edit. */
export type VisualPackId = (typeof VISUAL_PACKS)[number]['id'];

// ---------------------------------------------------------------------------
// Motion-behavior packs (M01-M08)
// ---------------------------------------------------------------------------

export const MOTION_PACKS = [
  {
    id: 'M01',
    name: 'Naturalistic acting',
    directive: 'Small anticipatory weight shifts, clean arcs, restrained gestures, breathing and eye focus preceding action, secondary motion settling after body.',
    axes: [],
  },
  {
    id: 'M02',
    name: 'Limited held timing',
    directive: 'Held key poses, selective facial and hair movement, sparse in-between action, brief stepped transitions.',
    axes: ['M'],
  },
  {
    id: 'M03',
    name: 'Snappy cartoon timing',
    directive: 'Strong anticipation, rapid pose change, controlled squash and stretch, brief overshoot, clean held settle.',
    axes: ['M'],
  },
  {
    id: 'M04',
    name: 'Tactile stop-motion timing',
    directive: 'Stepped stop-motion cadence, slight frame registration variation, minimal motion blur, tiny material shifts, deliberate pose increments.',
    axes: ['M'],
  },
  {
    id: 'M05',
    name: 'Weighty cinematic action',
    directive: 'Clear preparation, believable momentum and resistance, strong contact points, trailing secondary motion, gradual deceleration after impact.',
    axes: [],
  },
  {
    id: 'M06',
    name: 'Rhythmic performance',
    directive: 'Body accents and camera reframes landing on audible beats, evolving movement motifs, resolving on closing beat.',
    axes: ['M'],
  },
  {
    id: 'M07',
    name: 'Graphic morphing',
    directive: 'Shapes transforming through legible intermediate silhouettes, continuously flowing edges, exchanging color regions, stable graphic destination states.',
    axes: ['G', 'M'],
  },
  {
    id: 'M08',
    name: 'Product precision',
    directive: 'One controlled object action at a time, exact contact and release, smooth constant-speed movement, minimal vibration, clean alignment.',
    axes: [],
  },
] as const satisfies readonly PackDef[];

/** Derived from the table above, so adding a pack is a one-place edit. */
export type MotionPackId = (typeof MOTION_PACKS)[number]['id'];

// ---------------------------------------------------------------------------
// Finish packs (F01-F08)
// ---------------------------------------------------------------------------

export const FINISH_PACKS = [
  {
    id: 'F01',
    name: 'Clean digital',
    directive: 'Stable exposure, crisp edges, minimal grain, neutral highlight rolloff, clean color separation.',
    axes: [],
  },
  {
    id: 'F02',
    name: '35mm film',
    directive: 'Fine film grain, mild highlight halation, soft contrast rolloff, subtle gate weave, restrained lens flare.',
    axes: ['T'],
  },
  {
    id: 'F03',
    name: '16mm reversal',
    directive: 'Pronounced organic grain, compact highlight latitude, slight color drift, mild flicker, documentary film texture.',
    axes: ['T'],
  },
  {
    id: 'F04',
    name: 'VHS tape',
    directive: 'Soft analog detail, light chroma bleed, faint scanline structure, intermittent tracking wobble, low-level tape noise.',
    axes: ['T'],
  },
  {
    id: 'F05',
    name: 'Paper and ink',
    directive: 'Visible paper tooth, uneven ink density, restrained line boil, handmade registration variation.',
    axes: ['T'],
  },
  {
    id: 'F06',
    name: 'Watercolor and gouache',
    directive: 'Paper fiber, pigment pooling, matte painted texture, soft edge variation, restrained color bleed.',
    axes: ['T'],
  },
  {
    id: 'F07',
    name: 'Print and collage',
    directive: 'Halftone or screen-print texture, cut edges, layered shadows, imperfect registration, tactile compositing.',
    axes: ['T', 'P'],
  },
  {
    id: 'F08',
    name: 'Noir monochrome',
    directive: 'Black-and-white tonal separation, deep controlled shadows, selective highlights, fine grain, minimal midtone haze.',
    axes: ['P'],
  },
  {
    id: 'F09',
    name: 'Sensor imaging',
    directive: 'Single-channel tonal mapping, bloom around hot points, heavy gain noise across flat areas, hard clipping at the bright end, detail collapsing to silhouette at the dark end.',
    axes: ['P'],
  },
] as const satisfies readonly PackDef[];

/** Derived from the table above, so adding a pack is a one-place edit. */
export type FinishPackId = (typeof FINISH_PACKS)[number]['id'];

// ---------------------------------------------------------------------------
// Audio-treatment packs (A01-A08)
// ---------------------------------------------------------------------------

export const AUDIO_PACKS = [
  {
    id: 'A01',
    name: 'Natural synchronized realism',
    directive: 'Synchronized footsteps, cloth contact, room tone, environmental depth.',
    axes: [],
  },
  {
    id: 'A02',
    name: 'Tactile miniature foley',
    directive: 'Small dry contacts, material creaks, tiny armature clicks, close-set room tone, restrained dynamics.',
    axes: [],
  },
  {
    id: 'A03',
    name: 'Vintage cartoon orchestration',
    directive: 'Synchronized instrumental accents matching physical impacts, scored action beats.',
    axes: [],
  },
  {
    id: 'A04',
    name: 'Anime action sound design',
    directive: 'Air displacements, cloth snaps, mechanical impacts, brief tonal accents on decisive poses.',
    axes: [],
  },
  {
    id: 'A05',
    name: 'Product ASMR',
    directive: 'Close handling sounds including cap clicks, fabric glide, glass contact, packaging folds, room silence.',
    axes: [],
  },
  {
    id: 'A06',
    name: 'Documentary location sound',
    directive: 'Location ambience, distant indistinct crowd murmur, environmental occlusion, natural mic perspective.',
    axes: [],
  },
  {
    id: 'A07',
    name: 'Analog media audio',
    directive: 'Low tape hiss, limited bandwidth, wow and flutter, mechanical transport noise.',
    axes: [],
  },
  {
    id: 'A08',
    name: 'Graphic rhythm bed',
    directive: 'Electronic percussion or acoustic clicks at stated tempo aligned to graphic transitions.',
    axes: [],
  },
  {
    id: 'A09',
    name: 'Onboard device capture',
    directive: 'Single onboard microphone perspective, wind buffeting across the capture, clipping on loud transients, room slap on close voices, rolled-off low end.',
    axes: [],
  },
] as const satisfies readonly PackDef[];

/** Derived from the table above, so adding a pack is a one-place edit. */
export type AudioPackId = (typeof AUDIO_PACKS)[number]['id'];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

// Each takes a bare string: the argument can come from a stored document
// written by an older build, so an unknown id has to be a miss at runtime
// rather than a type error nobody is there to see. Visual ids are looked up
// through `getVisual` instead, because packs and anchors share one id space.

const motionMap: ReadonlyMap<string, PackDef> = new Map(MOTION_PACKS.map((p) => [p.id, p]));
const finishMap: ReadonlyMap<string, PackDef> = new Map(FINISH_PACKS.map((p) => [p.id, p]));
const audioMap: ReadonlyMap<string, PackDef> = new Map(AUDIO_PACKS.map((p) => [p.id, p]));

export function getMotionPack(id: string): PackDef | undefined {
  return motionMap.get(id);
}

export function getFinishPack(id: string): PackDef | undefined {
  return finishMap.get(id);
}

export function getAudioPack(id: string): PackDef | undefined {
  return audioMap.get(id);
}
