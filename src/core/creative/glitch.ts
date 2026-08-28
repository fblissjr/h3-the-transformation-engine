/**
 * Glitch-token infusion.
 *
 * A glitch token is an ultra-rare string from the tokenizer corpus -- one that
 * appears so seldom, and in such narrow contexts, that its embedding sits at an
 * odd edge of the space. Dropped into a scene as a visible mark, it reads as a
 * deliberate anomaly: legible, unexplained, and not attributable to anything in
 * the frame.
 *
 * This is not the "glitch art" aesthetic. Nothing here corrupts the image; the
 * VHS and chroma-bleed treatments are finish packs, a different feature that
 * happens to share the word.
 *
 * The shape follows the pack tables next door. One array is the single source
 * for the family, the id union is derived from it, and a stored document naming
 * something this build dropped resolves to nothing rather than failing to load.
 * The one difference: a token's id IS the token. There is no short code that
 * could name one string in the table and a different one in a document, because
 * the id and the payload cannot disagree when they are the same value.
 *
 * Source: the Sora 2 dual-stage architect, Glitch Token Infusion Edition, and
 * its standalone storyboard-rewriter sibling. What ports is the placement
 * grammar and the safety rules. The source's worked examples do not: they are
 * built out of timecodes, lens choices and imperial camera metrics, which here
 * are either computed by code or absent from the vocabulary.
 */

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

export interface GlitchTokenDef {
  readonly id: string;
  /**
   * Why this string behaves oddly, in the terms the source used. Not prompt
   * text -- the planner is never told the theory, only where to put the mark.
   */
  readonly note: string;
  /**
   * Set when the token carries a documented attractor strong enough to steer a
   * scene on its own. Offered, never drawn at random, and never a default.
   */
  readonly skew?: string;
}

/**
 * The stable set, plus the two the source explicitly fenced off.
 *
 * `GoldMagikarp` is the truncated sibling of `SolidGoldMagikarp`; the source
 * treats nested families as stylistic variants and warns against forcing the
 * truncation, so both are offered and neither is derived from the other.
 */
export const GLITCH_TOKENS = [
  {
    id: 'SolidGoldMagikarp',
    note: 'The canonical example. A username scraped in bulk, never used in prose.',
  },
  {
    id: 'GoldMagikarp',
    note: 'The truncated form of the same family. Offered as a variant, not as a shortening.',
  },
  {
    id: 'embedreportprint',
    note: 'A concatenated interface fragment with no natural sentence context.',
  },
  {
    id: 'rawdownload',
    note: 'A markup fragment out of bulk-scraped page furniture.',
  },
  {
    id: 'oreAndOnline',
    note: 'A boundary artifact, split across a phrase that was never a word.',
  },
  {
    id: 'TPPStreamerBot',
    note: 'A bot handle from a single high-volume forum, seen nowhere else.',
  },
  {
    id: 'PsyNetMessage',
    note: 'A logging identifier out of telemetry dumps.',
  },
  {
    id: 'RandomRedditorWithNo',
    note: 'A truncated handle; the sentence it belonged to never appears.',
  },
  {
    id: 'petertodd',
    note: 'The most documented of the anomalous strings.',
    skew: 'Pulls hard and negative. The source neutralises its context or leaves it alone.',
  },
  {
    id: 'Leilan',
    note: 'The counterpart to the one above.',
    skew: 'Attracts lunar and deity readings that will colour a whole scene.',
  },
] as const satisfies readonly GlitchTokenDef[];

/** Derived from the table above, so adding a token is a one-place edit. */
export type GlitchTokenId = (typeof GLITCH_TOKENS)[number]['id'];

const tokenMap: ReadonlyMap<string, GlitchTokenDef> = new Map(GLITCH_TOKENS.map((t) => [t.id, t]));

/** Takes a bare string: the id can come from a stored document. */
export function getGlitchToken(id: string): GlitchTokenDef | undefined {
  return tokenMap.get(id);
}

/** The ones a random draw may use. A documented attractor is a deliberate pick. */
export const DRAWABLE_TOKENS: readonly GlitchTokenId[] = GLITCH_TOKENS.filter(
  (t) => !('skew' in t),
).map((t) => t.id);

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export interface GlitchSurfaceDef {
  readonly id: string;
  readonly name: string;
  readonly directive: string;
}

/**
 * Where a mark can live.
 *
 * The source's fifth placement strategy was "whispered metadata". It is gone:
 * the planner prompt states that naming a vocal act on a beat with no dialogue
 * produces invented speech, and a whisper is exactly that trigger. The surface
 * it was reaching for -- a marking too small to be signage -- is `etching`.
 */
export const GLITCH_SURFACES = [
  {
    id: 'inscription',
    name: 'Inscription',
    directive:
      'Carved, etched or painted into something the world already contains: a wall, a plaque, a copper plate, a paving stone.',
  },
  {
    id: 'reflection',
    name: 'Reflection',
    directive:
      'Readable only in glass, water, chrome or a dark screen, so it belongs to the reflection rather than to the object.',
  },
  {
    id: 'overlay',
    name: 'Interface overlay',
    directive:
      'A display element that flickers up over part of the frame and goes again. It is on a screen inside the scene, never on the image itself.',
  },
  {
    id: 'stamp',
    name: 'Stamp',
    directive:
      'Printed on something manufactured: packaging, a crate, a ticket, a livery panel, a shipping label.',
  },
  {
    id: 'etching',
    name: 'Etching',
    directive:
      'Marked too small to be signage, at the scale of a serial number on an instrument, a tool, or a gauge face.',
  },
  {
    id: 'wear',
    name: 'Wear',
    directive:
      'Faded, peeling, scratched or half-obscured, so it reads as older than everything around it.',
  },
] as const satisfies readonly GlitchSurfaceDef[];

export type GlitchSurfaceId = (typeof GLITCH_SURFACES)[number]['id'];

const surfaceMap: ReadonlyMap<string, GlitchSurfaceDef> = new Map(
  GLITCH_SURFACES.map((s) => [s.id, s]),
);

export function getGlitchSurface(id: string): GlitchSurfaceDef | undefined {
  return surfaceMap.get(id);
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * How far the anomaly reaches into the writing.
 *
 * `motif` is the dual-stage source: sparse marks, everything else written
 * normally. `ood` is the standalone rewriter, which asked for unusual token
 * selection throughout -- ported as a lexical instruction that stays inside
 * this compiler's rule that every sentence describes something observable.
 */
export type GlitchRegister = 'motif' | 'ood';

export const GLITCH_REGISTERS: readonly GlitchRegister[] = ['motif', 'ood'];

/**
 * The source's ceiling, kept.
 *
 * Past three the marks stop reading as anomalies and start reading as a
 * typeface. That is a property of the effect rather than a UI convenience, so
 * it is enforced where the record is normalised, not only in the picker.
 */
export const GLITCH_MAX_TOKENS = 3;

/** A glitch selection as it may arrive from storage: ids are bare strings. */
export interface StoredGlitch {
  tokens: string[];
  /** Empty or absent means the planner varies the surface itself. */
  surfaces?: string[];
  register: GlitchRegister;
}

/** One built by code, where every id is known to exist. */
export interface GlitchSelection extends StoredGlitch {
  tokens: GlitchTokenId[];
  surfaces?: GlitchSurfaceId[];
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** The tokens this build resolves, in selection order, deduplicated and capped. */
function resolvedTokens(glitch: StoredGlitch | undefined): GlitchTokenDef[] {
  const kept: GlitchTokenDef[] = [];
  const seen = new Set<string>();

  for (const id of glitch?.tokens ?? []) {
    if (seen.has(id)) continue;
    const found = getGlitchToken(id);
    if (!found) continue;
    seen.add(id);
    kept.push(found);
    if (kept.length === GLITCH_MAX_TOKENS) break;
  }
  return kept;
}

function resolvedSurfaces(glitch: StoredGlitch | undefined): GlitchSurfaceDef[] {
  const kept: GlitchSurfaceDef[] = [];
  const seen = new Set<string>();

  for (const id of glitch?.surfaces ?? []) {
    if (seen.has(id)) continue;
    const found = getGlitchSurface(id);
    if (!found) continue;
    seen.add(id);
    kept.push(found);
  }
  return kept;
}

/** Whether the record contributes anything at all. */
export function hasGlitch(glitch: StoredGlitch | undefined): boolean {
  return resolvedTokens(glitch).length > 0;
}

function register(glitch: StoredGlitch | undefined): GlitchRegister {
  const value = glitch?.register as GlitchRegister;
  return GLITCH_REGISTERS.includes(value) ? value : 'motif';
}

/**
 * Drop what this build cannot resolve, so what is held matches what is shown.
 *
 * Returns undefined when nothing survives, which is what makes an empty token
 * list indistinguishable from no glitch at all. The two must not be separate
 * states: a record carrying `tokens: []` renders no directive while still
 * reporting itself as different from a record carrying none, which is the
 * badge saying an edit will change something that it will not.
 */
export function pruneGlitch(glitch: StoredGlitch | undefined): GlitchSelection | undefined {
  const tokens = resolvedTokens(glitch).map((t) => t.id as GlitchTokenId);
  if (tokens.length === 0) return undefined;

  const surfaces = resolvedSurfaces(glitch).map((s) => s.id as GlitchSurfaceId);
  return {
    tokens,
    register: register(glitch),
    ...(surfaces.length > 0 ? { surfaces } : {}),
  };
}

/** Whether two glitch records name the same thing. Absent equals unresolvable. */
export function sameGlitch(a: StoredGlitch | undefined, b: StoredGlitch | undefined): boolean {
  const left = pruneGlitch(a);
  const right = pruneGlitch(b);
  if (!left || !right) return !left && !right;

  return (
    left.register === right.register &&
    left.tokens.join(' ') === right.tokens.join(' ') &&
    (left.surfaces ?? []).join(' ') === (right.surfaces ?? []).join(' ')
  );
}

/** Human-readable label for the UI badge and the version history entry. */
export function describeGlitch(glitch: StoredGlitch | undefined): string {
  const tokens = resolvedTokens(glitch);
  if (tokens.length === 0) return '';

  const names = tokens.map((t) => t.id).join(', ');
  return register(glitch) === 'ood' ? `OOD glyphs ${names}` : `glyphs ${names}`;
}

const REGISTER_CLAUSE: Record<GlitchRegister, string> = {
  motif:
    'Everything else stays in its normal register. The marks are the only anomaly in the scene, ' +
    'and they work because nothing around them is straining.',
  ood:
    'Beyond the marks, take the less expected option wherever two would serve equally well: what a ' +
    'thing is made of, where the light comes from, which object is in which place. Stay concrete -- ' +
    'every sentence still describes something a camera could record. The strangeness belongs to what ' +
    'is in the frame, never to abstraction, metaphor or mood words.',
};

/**
 * The block spliced into a system prompt, or null when the record resolves to
 * nothing -- no tokens, or only ids written by a build this one no longer is.
 *
 * A pure function of the record and of nothing else. The planner knows the
 * active H3 mode and the patch prompt does not, so everything mode-specific
 * lives with the mode blocks in `planner.ts`. Keeping this total on the record
 * alone is what lets both prompts derive identical text from it.
 */
export function glitchDirective(glitch: StoredGlitch | undefined): string | null {
  const tokens = resolvedTokens(glitch);
  if (tokens.length === 0) return null;

  const surfaces = resolvedSurfaces(glitch);
  const placement =
    surfaces.length > 0
      ? [
          surfaces.length === 1
            ? 'Use this surface:'
            : 'Draw from these surfaces, a different one for each mark:',
          ...surfaces.map((s) => `  ${s.name}: ${s.directive}`),
        ]
      : [
          'Give each mark a different kind of surface. Something carved into the world, something ' +
            'legible only in a reflection, a display element inside the scene, something printed on ' +
            'manufactured goods, a marking too small to be signage, something faded or half-scratched ' +
            'away. Two marks of the same kind read as a set rather than as anomalies.',
        ];

  return [
    '# Glitch marks',
    '',
    'The scene contains the marks below. Each is a string that means nothing, was placed by nobody, ' +
      'and is noticed by no one in the frame. That is the entire effect: something legible and ' +
      'deliberate, with no author and no explanation.',
    '',
    'Place exactly these, spelled exactly as written, once each:',
    ...tokens.map((t) => `  "${t.id}"`),
    '',
    ...placement,
    '',
    "A mark is on-screen text. Write it into the beat prose inside English double quotation marks " +
      "and list it in that beat's visibleText, the same as any other visible string.",
    '',
    'Never truncate, split, hyphenate, space out or change the case of a mark. Never have anyone ' +
      'read one aloud, point at one, react to one or be puzzled by one, and never make one the ' +
      'reason for anything that happens.',
    '',
    'A mark belongs to the moment it appears in, not to the identity of anything. Keep it out of ' +
      'the style clause, out of every subject description, and out of every retention note.',
    '',
    REGISTER_CLAUSE[register(glitch)],
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Random draw
// ---------------------------------------------------------------------------

/**
 * A draw of one to three marks, with a surface for each.
 *
 * Separate from `randomWild` on purpose. A wild draw changes how the clip
 * looks; this one puts readable strings on screen, which is a literal addition
 * to the frame and should be something the user asked for rather than something
 * a style shuffle hands them without saying so.
 *
 * The register is drawn as `motif` every time, for the same reason. Switching
 * to `ood` changes how every sentence in the clip is written, which is a larger
 * change than the marks are, and a button labelled Draw should not be the thing
 * that makes it.
 */
export function randomGlitch(random: () => number = Math.random): GlitchSelection {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(random() * arr.length)];

  const wanted = 1 + Math.floor(random() * GLITCH_MAX_TOKENS);
  const tokens: GlitchTokenId[] = [];
  const surfaces: GlitchSurfaceId[] = [];

  for (let attempt = 0; attempt < 30 && tokens.length < wanted; attempt++) {
    const token = pick(DRAWABLE_TOKENS);
    if (!tokens.includes(token)) tokens.push(token);
  }
  // A pinned random source can draw the same index every time, so the loops
  // above are bounded and may come up short. One mark is still a usable record;
  // zero is not.
  if (tokens.length === 0) tokens.push(DRAWABLE_TOKENS[0]);

  for (let attempt = 0; attempt < 30 && surfaces.length < tokens.length; attempt++) {
    const surface = pick(GLITCH_SURFACES).id;
    if (!surfaces.includes(surface)) surfaces.push(surface);
  }

  return { tokens, surfaces, register: 'motif' };
}
