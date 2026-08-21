/**
 * Where a creative selection meets the rest of the pipeline.
 *
 * The unit tests cover the derivations. What is left is the wiring, and the
 * wiring is where this feature was previously untested: the planner prompt and
 * the patch prompt each had to be handed a style, in a different shape, by a
 * different caller. Both now derive it from the same record with the same
 * function, and these tests are what say so.
 *
 * The round-trip case is the important one. It is the only place that runs a
 * selection all the way out to storage and back -- through the Zod schema that
 * validates a stored document -- and asserts the prompt text on the far side is
 * the text it started with.
 */

import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/assemble';
import { applyPatch } from '../src/core/patch/apply';
import { styleDirective } from '../src/core/creative';
import type { CreativeModeRecord } from '../src/core/creative';
import { H3DocumentSchema } from '../src/core/ir/schema';
import type { PlannerOutput } from '../src/core/ir/schema';
import type { CompileInput, H3Document } from '../src/core/ir/types';
import { normalize } from '../src/core/normalize';
import { buildPlannerSystemPrompt } from '../src/provider/prompts/planner';
import { buildPatchSystemPrompt } from '../src/provider/prompts/patch';
import { fl2vaUmbrella, i2vaTrain, l2vaGlass, t2vaBaker } from './fixtures/guide-examples';
import { ref2vaCoffeeShop } from './fixtures/ref-example';

const CLAY: CreativeModeRecord = {
  mode: 'exploratory',
  selection: { visual: 'V06', motion: 'M04', finish: 'F02', audio: 'A02', strength: 'stress-test' },
};

const input: CompileInput = {
  idea: 'A baker opens up before dawn.',
  mode: 'T2VA',
  durationFrames: 192,
  slots: [],
};

const plan: PlannerOutput = {
  style: 'Live-action, cinematic',
  speakers: [],
  subjects: [],
  shots: [
    {
      cutAtMs: null,
      cutStyle: null,
      camera: null,
      beats: [
        {
          prose: 'a wide shot of a bakery before sunrise.',
          speaker: null,
          dialogue: null,
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
      ],
    },
  ],
  soundscape: 'Shutters scrape open over a quiet street.',
  music: 'A soft acoustic-guitar pattern at a moderate tempo.',
  summary: null,
  taskTypes: null,
  audioRetention: null,
  pictureRetention: null,
};

function docWith(creativeMode?: CreativeModeRecord): H3Document {
  const doc = assemble(plan, input, normalize(input), { id: 'doc-1' });
  if (creativeMode) doc.creativeMode = creativeMode;
  return doc;
}

// ---------------------------------------------------------------------------
// The planner prompt
// ---------------------------------------------------------------------------

describe('buildPlannerSystemPrompt', () => {
  const ctx = normalize(input);

  it('carries the style direction when a creative mode is in force', () => {
    const prompt = buildPlannerSystemPrompt(ctx, { ...input, creativeMode: CLAY });
    expect(prompt).toContain('# Style direction');
    expect(prompt).toContain('clay animation');
  });

  it('carries no style direction when there is no creative mode', () => {
    const prompt = buildPlannerSystemPrompt(ctx, input);
    expect(prompt).not.toContain('# Style direction');
  });

  it('carries no style direction for a mode with nothing selected in it', () => {
    const empty: CreativeModeRecord = { mode: 'directed', selection: { strength: 'full' } };
    expect(buildPlannerSystemPrompt(ctx, { ...input, creativeMode: empty })).not.toContain(
      '# Style direction',
    );
  });

  it('puts the direction before the supplied facts, so the facts have the last word', () => {
    const prompt = buildPlannerSystemPrompt(ctx, { ...input, creativeMode: CLAY });
    expect(prompt.indexOf('# Style direction')).toBeLessThan(prompt.indexOf('# Supplied facts'));
  });

  it('leaves the core instruction deferring to the section rather than overriding on its own', () => {
    const prompt = buildPlannerSystemPrompt(ctx, input);
    expect(prompt).toContain('That section states how far it reaches');
  });
});

// ---------------------------------------------------------------------------
// The patch prompt
// ---------------------------------------------------------------------------

describe('buildPatchSystemPrompt', () => {
  it('carries the document own style so an edit does not drift out of it', () => {
    const prompt = buildPatchSystemPrompt(CLAY);
    expect(prompt).toContain('# Active style');
    expect(prompt).toContain('clay animation');
  });

  it('carries no style block for a document that has none', () => {
    expect(buildPatchSystemPrompt()).not.toContain('# Active style');
  });

  /**
   * The two paths used to be handed a style in two different shapes by two
   * different callers, which is how they would have drifted. Same record, same
   * function, so the directive text is identical on both sides.
   */
  it('derives the same directive text as the planner prompt', () => {
    const directive = styleDirective(CLAY.selection);
    expect(directive).not.toBeNull();
    expect(buildPatchSystemPrompt(CLAY)).toContain(directive as string);
    expect(buildPlannerSystemPrompt(normalize(input), { ...input, creativeMode: CLAY })).toContain(
      directive as string,
    );
  });
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

describe('the creative mode on the document', () => {
  it('survives a patch, which is what lets a later edit preserve the style', () => {
    // `applyPatch` rebuilds the document by structural sharing, so a field it
    // knows nothing about has to come through untouched. If it ever stops
    // doing that, every edit silently drops the style the document was written
    // under and the patch prompt above has nothing left to preserve.
    const result = applyPatch(docWith(CLAY), {
      operations: [{ path: 'style', value: 'Clay animation, tactile', rationale: 'match' }],
      declined: [],
    });
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.doc.style).toBe('Clay animation, tactile');
    expect(result.doc.creativeMode).toEqual(CLAY);
  });

  it('is absent from the serialized prompt, which the vocab contract owns alone', async () => {
    const { serialize } = await import('../src/core/serialize');
    const { contextFor } = await import('../src/core/normalize');
    const plain = docWith();
    const styled = docWith(CLAY);
    expect(serialize(styled, contextFor(styled)).text).toBe(
      serialize(plain, contextFor(plain)).text,
    );
  });
});

// ---------------------------------------------------------------------------
// Storage round trip
// ---------------------------------------------------------------------------

describe('H3DocumentSchema', () => {
  /**
   * The schema was dead code until it was wired at the load boundary, so this
   * is the first thing that checks it still describes the type it claims to.
   * A golden fixture failing here means the schema drifted, not the fixture.
   */
  it('accepts every golden fixture', () => {
    for (const doc of [t2vaBaker, i2vaTrain, fl2vaUmbrella, l2vaGlass, ref2vaCoffeeShop]) {
      const parsed = H3DocumentSchema.safeParse(doc);
      expect(parsed.success, `${doc.id}: ${JSON.stringify(parsed.error?.issues[0])}`).toBe(true);
    }
  });

  it('accepts a document carrying a creative mode', () => {
    expect(H3DocumentSchema.safeParse(docWith(CLAY)).success).toBe(true);
  });

  /** The control: a document with a real defect has to be rejected, by path. */
  it('rejects a document whose shots are gone', () => {
    const parsed = H3DocumentSchema.safeParse({ ...docWith(), shots: [] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].path).toEqual(['shots']);
  });

  it('rejects a creative mode with a strength level off the union', () => {
    const doc = { ...docWith(), creativeMode: { mode: 'wild', selection: { strength: 'extreme' } } };
    const parsed = H3DocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].path).toEqual(['creativeMode', 'selection', 'strength']);
  });

  /**
   * Pack ids stay bare strings on purpose. A build that renames a pack must not
   * make the documents written before it unopenable -- the style resolves to
   * nothing instead, which `styleDirective` already handles.
   */
  it('accepts a pack id it has never heard of', () => {
    const doc = {
      ...docWith(),
      creativeMode: { mode: 'directed', selection: { visual: 'V99', strength: 'full' } },
    };
    expect(H3DocumentSchema.safeParse(doc).success).toBe(true);
    expect(styleDirective({ visual: 'V99', strength: 'full' })).toBeNull();
  });

  /**
   * The regression that prompted this: narrowing `visual` to a string made
   * every document written with an anchor selected fail to parse, show a
   * schema notice on every load, and lose its style.
   */
  it('accepts the numeric anchor id an older build wrote', () => {
    const doc = {
      ...docWith(),
      creativeMode: { mode: 'exploratory', selection: { visual: 28, finish: 'F04', strength: 'full' } },
    };
    const parsed = H3DocumentSchema.safeParse(doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues[0])).toBe(true);
    expect(styleDirective({ visual: 28, finish: 'F04', strength: 'full' })).toContain(
      '1990s camcorder memory',
    );
  });

  it('round-trips a selection through storage to the same prompt text', () => {
    const stored = JSON.parse(JSON.stringify(docWith(CLAY)));
    const parsed = H3DocumentSchema.parse(stored);
    expect(parsed.creativeMode).toBeDefined();
    expect(styleDirective(parsed.creativeMode!.selection)).toBe(styleDirective(CLAY.selection));
  });
});
