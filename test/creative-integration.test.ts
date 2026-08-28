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
import { getVisual, glitchDirective, styleDirective } from '../src/core/creative';
import type { CreativeModeRecord } from '../src/core/creative';
import { H3DocumentSchema } from '../src/core/ir/schema';
import type { PlannerOutput } from '../src/core/ir/schema';
import type { CompileInput, H3Document } from '../src/core/ir/types';
import type { H3Mode } from '../src/core/ir/vocab';
import { normalize } from '../src/core/normalize';
import { GLITCH_MODE_NOTES, buildPlannerSystemPrompt } from '../src/provider/prompts/planner';
import { buildPatchSystemPrompt } from '../src/provider/prompts/patch';
import { fl2vaUmbrella, i2vaTrain, l2vaGlass, t2vaBaker } from './fixtures/guide-examples';
import { ref2vaCoffeeShop } from './fixtures/ref-example';

const CLAY: CreativeModeRecord = {
  mode: 'exploratory',
  selection: { visual: 'V06', motion: 'M04', finish: 'F02', audio: 'A02', strength: 'stress-test' },
};

/** The same style with marks on it, and marks with no style at all. */
const MARKED: CreativeModeRecord = {
  ...CLAY,
  glitch: { tokens: ['SolidGoldMagikarp', 'PsyNetMessage'], surfaces: ['reflection'], register: 'ood' },
};

const MARKS_ONLY: CreativeModeRecord = {
  mode: 'directed',
  selection: { strength: 'full' },
  glitch: { tokens: ['rawdownload'], register: 'motif' },
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
    // Read out of the table, not copied from it: renaming a pack should change
    // what the prompt says without failing a test about whether it arrived.
    expect(prompt).toContain(getVisual('V06')!.directive);
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
    expect(prompt).toContain(getVisual('V06')!.directive);
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

  /**
   * Both halves are asserted here rather than in a test of their own. An object
   * schema silently drops a key it does not describe, so a glitch record that
   * never reaches the far side would leave a style-only round trip passing with
   * nothing to show that half the record went missing.
   */
  it('round-trips a selection and its marks through storage to the same prompt text', () => {
    const stored = JSON.parse(JSON.stringify(docWith(MARKED)));
    const parsed = H3DocumentSchema.parse(stored);
    expect(parsed.creativeMode).toBeDefined();
    expect(styleDirective(parsed.creativeMode!.selection)).toBe(styleDirective(MARKED.selection));
    expect(parsed.creativeMode!.glitch).toEqual(MARKED.glitch);
    expect(glitchDirective(parsed.creativeMode!.glitch)).toBe(glitchDirective(MARKED.glitch));
  });
});

// ---------------------------------------------------------------------------
// Glitch marks, where they meet the two prompts
// ---------------------------------------------------------------------------

/**
 * The marks are the second contribution on the same record, and they reach the
 * prompts by the same route the style does. What is worth guarding is the part
 * that differs: the block is a pure function of the record so both prompts can
 * derive it, while everything that depends on which pictures are actual frames
 * is appended by the planner, which is the only side that knows the mode.
 */
describe('glitch marks in the planner prompt', () => {
  const ctx = normalize(input);

  it('carries the marks when the record has them', () => {
    const prompt = buildPlannerSystemPrompt(ctx, { ...input, creativeMode: MARKED });
    expect(prompt).toContain('# Glitch marks');
    expect(prompt).toContain('"SolidGoldMagikarp"');
    expect(prompt).toContain('"PsyNetMessage"');
  });

  it('carries none for a record with a style and no marks', () => {
    const prompt = buildPlannerSystemPrompt(ctx, { ...input, creativeMode: CLAY });
    expect(prompt).toContain('# Style direction');
    expect(prompt).not.toContain('# Glitch marks');
  });

  /**
   * A record can be marks alone. The gate that decides whether a record reaches
   * the document at all reads both halves for this reason; if the prompt could
   * not carry marks without a style, that gate would be guarding nothing.
   */
  it('carries marks with no style at all', () => {
    const prompt = buildPlannerSystemPrompt(ctx, { ...input, creativeMode: MARKS_ONLY });
    expect(prompt).not.toContain('# Style direction');
    expect(prompt).toContain('# Glitch marks');
    expect(prompt).toContain('"rawdownload"');
  });

  it('puts the marks after the style and before the supplied facts', () => {
    const prompt = buildPlannerSystemPrompt(ctx, { ...input, creativeMode: MARKED });
    expect(prompt.indexOf('# Style direction')).toBeLessThan(prompt.indexOf('# Glitch marks'));
    expect(prompt.indexOf('# Glitch marks')).toBeLessThan(prompt.indexOf('# Supplied facts'));
  });

  /**
   * The affordance turns on whether a supplied picture is an actual frame. A
   * mark described as visible in one is a description the image contradicts,
   * which is the same failure as any other invented first-frame detail and
   * harder to notice, since a mark is meant to look out of place.
   */
  /**
   * The property, not the sentences.
   *
   * This asserted five specific sentences, one per mode, which measured the
   * wording rather than the thing that matters: that each mode is told
   * something different, and told only its own. Reading the notes out of the
   * table makes a reword invisible to the test and a copy-pasted note fatal to
   * it -- which is the right way round, and is the stronger check besides.
   */
  it('gives every mode its own note, and shows it to no other mode', () => {
    const modeInput = (mode: H3Mode): CompileInput => ({ ...input, mode, creativeMode: MARKED });
    const promptFor = (mode: H3Mode) =>
      buildPlannerSystemPrompt(normalize(modeInput(mode)), modeInput(mode));

    const modes = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'] as H3Mode[];
    const notes = modes.map((m) => GLITCH_MODE_NOTES[m]);

    expect(new Set(notes).size, 'two modes share a note').toBe(modes.length);
    for (const note of notes) expect(note.length).toBeGreaterThan(40);

    for (const mine of modes) {
      expect(promptFor(mine), mine).toContain(GLITCH_MODE_NOTES[mine]);
      for (const other of modes) {
        if (other === mine) continue;
        expect(promptFor(other), `${other} carries ${mine}'s note`).not.toContain(
          GLITCH_MODE_NOTES[mine],
        );
      }
    }
  });

  it('adds no mode note when the record has no marks', () => {
    const prompt = buildPlannerSystemPrompt(ctx, { ...input, creativeMode: CLAY });
    expect(prompt).not.toContain('Nothing in this scene is fixed by a reference');
  });
});

describe('glitch marks in the patch prompt', () => {
  it('carries the document own marks so an edit does not drop them', () => {
    const prompt = buildPatchSystemPrompt(MARKED);
    expect(prompt).toContain('# Active glitch marks');
    expect(prompt).toContain('"SolidGoldMagikarp"');
  });

  it('carries no marks block for a document that has none', () => {
    expect(buildPatchSystemPrompt(CLAY)).not.toContain('# Active glitch marks');
    expect(buildPatchSystemPrompt()).not.toContain('# Active glitch marks');
  });

  /** Marks with no style still need the block, the same as in the planner. */
  it('carries marks with no style at all', () => {
    const prompt = buildPatchSystemPrompt(MARKS_ONLY);
    expect(prompt).not.toContain('# Active style');
    expect(prompt).toContain('# Active glitch marks');
  });

  /**
   * The same parity the style has. Both prompts call one function on one record,
   * so the marks an edit is told to preserve are the marks the planner was told
   * to place, character for character.
   */
  it('derives the same marks block as the planner prompt', () => {
    const directive = glitchDirective(MARKED.glitch);
    expect(directive).not.toBeNull();
    expect(buildPatchSystemPrompt(MARKED)).toContain(directive as string);
    expect(
      buildPlannerSystemPrompt(normalize(input), { ...input, creativeMode: MARKED }),
    ).toContain(directive as string);
  });

  /**
   * The block reads as an instruction to place marks, because that is what it
   * is for. An edit is not placing anything, so the wrapper has to say which
   * reading applies -- the same shape of contradiction that once had `subtle`
   * strength and the core prompt disagreeing inside one prompt.
   */
  it('frames the block as a description of what is there, not as a placement', () => {
    const prompt = buildPatchSystemPrompt(MARKED);
    expect(prompt).toContain('not as an instruction to place anything');
    expect(prompt).toContain('Do not introduce a mark into a beat that has none');
  });

  /** An edit has no mode, so nothing mode-conditional may reach it. */
  it('carries no mode note, having no mode to carry one for', () => {
    const prompt = buildPatchSystemPrompt(MARKED);
    expect(prompt).not.toContain('<Picture 1> is the actual first frame and does not contain a mark');
    expect(prompt).not.toContain('Marks go on the environment only');
  });
});

describe('glitch marks on the document', () => {
  it('survive a patch, which is what lets a later edit preserve them', () => {
    const result = applyPatch(docWith(MARKED), {
      operations: [{ path: 'style', value: 'Clay animation, tactile', rationale: 'match' }],
      declined: [],
    });
    expect(result.applied).toHaveLength(1);
    expect(result.doc.creativeMode).toEqual(MARKED);
  });

  /** The serializer owns the prompt text and knows nothing about any of this. */
  it('are absent from the serialized prompt', async () => {
    const { serialize } = await import('../src/core/serialize');
    const { contextFor } = await import('../src/core/normalize');
    const plain = docWith();
    const marked = docWith(MARKED);
    expect(serialize(marked, contextFor(marked)).text).toBe(
      serialize(plain, contextFor(plain)).text,
    );
  });
});

// ---------------------------------------------------------------------------
// Where a mark meets the validator
// ---------------------------------------------------------------------------

/**
 * The glitch block tells the planner a mark is on-screen text and defers to the
 * contract's rule for that rather than restating it. `visibleTextQuoted` is
 * that rule, and it turns out to enforce half the mark contract already: a mark
 * listed in a beat but not written into its prose in double quotes is a real
 * diagnostic, with no new rule and no prose pattern-matching added.
 *
 * Asserted here rather than assumed, because the deferral is only correct if
 * the existing rule actually accepts a correctly placed mark. A rule that fired
 * on legitimate marked output would be the class of rule this repo removed
 * seventeen of.
 */
describe('a mark and the on-screen text rule', () => {
  async function diagnose(prose: string, visibleText: string[]) {
    const { validate } = await import('../src/core/validate');
    const { contextFor } = await import('../src/core/normalize');
    const doc = docWith(MARKED);
    doc.shots[0].beats[0].prose = prose;
    doc.shots[0].beats[0].visibleText = visibleText;
    return validate(doc, contextFor(doc)).diagnostics.map((d) => d.code);
  }

  it('accepts a mark written the way the block asks for', async () => {
    const codes = await diagnose(
      'a wide shot of a bakery before sunrise, "SolidGoldMagikarp" stamped on the flour sack.',
      ['SolidGoldMagikarp'],
    );
    expect(codes).not.toContain('VISIBLE_TEXT_NOT_QUOTED');
  });

  /** The control: the same mark listed but not quoted into the prose. */
  it('rejects a mark listed on a beat whose prose does not carry it', async () => {
    const codes = await diagnose('a wide shot of a bakery before sunrise.', ['SolidGoldMagikarp']);
    expect(codes).toContain('VISIBLE_TEXT_NOT_QUOTED');
  });
});

// ---------------------------------------------------------------------------
// Recognisable people
// ---------------------------------------------------------------------------

/**
 * A house rule rather than a contract item: neither official guide mentions
 * public figures. It came from the Sora prompt architecture and the original
 * engine's own fragment, and it lives in the two prompts because deciding
 * whether a description names a real person is not something a validator can
 * do -- pattern-matching prose for it is the class of rule this repo removed
 * seventeen of.
 *
 * The carve-out is the part worth guarding. Dialogue and on-screen text are
 * reproduced exactly as given, and a rule that told the planner to rewrite a
 * name would contradict the one that says never to touch a user's words.
 */
describe('recognisable people', () => {
  const ctx = normalize(input);

  it('is in the planner prompt, in every mode', () => {
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'] as H3Mode[]) {
      const modeInput: CompileInput = { ...input, mode };
      const prompt = buildPlannerSystemPrompt(normalize(modeInput), modeInput);
      expect(prompt, mode).toContain('# Recognisable people');
      expect(prompt, mode).toContain('Do not write the proper name of a widely recognised person');
    }
  });

  it('teaches the substitution rather than only forbidding the name', () => {
    const prompt = buildPlannerSystemPrompt(ctx, input);
    expect(prompt).toContain('the role they are known for');
    expect(prompt).toContain('bicorne hat');
  });

  /**
   * Without this the rule collides with "Dialogue text is preserved exactly as
   * given. Never translate, paraphrase or tidy user-supplied lines" -- two
   * instructions in one prompt telling the model opposite things about the same
   * words.
   */
  it('exempts the two fields that are reproduced verbatim', () => {
    const prompt = buildPlannerSystemPrompt(ctx, input);
    expect(prompt).toContain('It does not apply to two things that are reproduced exactly as given');
    expect(prompt).toContain('If a character says a name, they say it.');
  });

  it('is in the patch prompt, so an edit cannot introduce one', () => {
    const prompt = buildPatchSystemPrompt();
    expect(prompt).toContain('A recognisable person is described, never named');
    expect(prompt).toContain('are the exception');
  });
});

// ---------------------------------------------------------------------------
// The roll on the document
// ---------------------------------------------------------------------------

/**
 * A seed on its own is not a record of anything.
 *
 * The version label says "seed 417301", and the template that seed applied to
 * lives in the idea box, which nothing persists. Storing the seed without its
 * template would leave the label naming a roll that can never be performed
 * again -- a partial record that reads as a complete one, which is the derived-
 * value-next-to-its-input problem the rest of this file exists about.
 */
describe('the wildcard roll on the document', () => {
  const ROLL = { template: 'a baker in {setting} during {era}.', seed: 4242 };

  function docWithRoll(): H3Document {
    const doc = assemble(plan, input, normalize(input), { id: 'doc-1' });
    doc.roll = ROLL;
    return doc;
  }

  it('carries both halves or neither', () => {
    expect(docWithRoll().roll).toEqual(ROLL);
    expect(docWith().roll).toBeUndefined();
  });

  it('round-trips through the stored-document schema', () => {
    const stored = JSON.parse(JSON.stringify(docWithRoll()));
    const parsed = H3DocumentSchema.parse(stored);
    expect(parsed.roll).toEqual(ROLL);
  });

  it('survives a patch, so an edit does not lose which roll made the document', () => {
    const result = applyPatch(docWithRoll(), {
      operations: [{ path: 'style', value: 'Live-action, cinematic', rationale: 'match' }],
      declined: [],
    });
    expect(result.doc.roll).toEqual(ROLL);
  });

  it('reproduces the idea it recorded', async () => {
    const { rollSeeded } = await import('../src/core/wildcards');
    const doc = docWithRoll();
    expect(rollSeeded(doc.roll!.template, doc.roll!.seed).text).toBe(
      rollSeeded(ROLL.template, ROLL.seed).text,
    );
    expect(rollSeeded(doc.roll!.template, doc.roll!.seed).text).not.toContain('{');
  });

  it('is absent from the serialized prompt', async () => {
    const { serialize } = await import('../src/core/serialize');
    const { contextFor } = await import('../src/core/normalize');
    const rolled = docWithRoll();
    const plain = docWith();
    expect(serialize(rolled, contextFor(rolled)).text).toBe(serialize(plain, contextFor(plain)).text);
  });

  /** A document written before rolls existed has no key, and must not gain one. */
  it('accepts a document written before rolls existed', () => {
    const parsed = H3DocumentSchema.safeParse(JSON.parse(JSON.stringify(docWith())));
    expect(parsed.success).toBe(true);
    expect(parsed.data && 'roll' in parsed.data).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What the prompt tells the model about its own output shape
// ---------------------------------------------------------------------------

/**
 * Three things the prompt got wrong about the format it governs.
 *
 * The shared core stated the base contract's style placement for every mode,
 * including Ref2VA, where the serializer writes the style as its own sentence
 * before `[Shot 1]`. A model obeying the core returned a clause and a lowercase
 * first beat, which cannot reproduce the guide's own worked example for that
 * mode -- and the golden fixture is the proof, since it carries a full sentence
 * and a capitalised opening.
 *
 * The planner schema requires `crossesCut` and `cutoff` on every dialogue beat,
 * and no prompt named either. A model doing the right thing for a line that
 * spans a cut produced `SCENETRANS_UNPAIRED` on a tag it was never told to
 * write -- unclearable, since the patch validator will not rewrite the prose.
 *
 * And the speech block said supplied dialogue is preserved exactly and then
 * told the model to end every line with a terminal mark. Following the second
 * sentence rewrites the user's words, which makes `assemble` stop matching them
 * against `suppliedDialogue`, so the document records them as not user-supplied
 * and the punctuation rules that are scoped away from them start applying.
 */
describe('the prompt describes the contract it is compiling for', () => {
  const promptFor = (mode: H3Mode) => {
    const modeInput: CompileInput = { ...input, mode };
    return buildPlannerSystemPrompt(normalize(modeInput), modeInput);
  };

  /**
   * Anchored on the rendered shape rather than on the sentence around it.
   * `[Shot 1] <style>, <your first beat>` is the base contract's output as the
   * serializer writes it, so this fails when the instruction stops matching the
   * format and not when someone rewords the paragraph explaining it.
   */
  const BASE_SHAPE = '[Shot 1] <style>, <your first beat>';

  it('shows the base modes the shape their serializer produces', () => {
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA'] as H3Mode[]) {
      expect(promptFor(mode), mode).toContain(BASE_SHAPE);
    }
  });

  it('never shows Ref2VA a shape its serializer does not produce', () => {
    expect(promptFor('Ref2VA')).not.toContain(BASE_SHAPE);
  });

  /**
   * The Ref2VA half has no structural anchor -- the instruction is prose about
   * where a sentence goes -- so this is a wording proxy, named as one. A reword
   * that keeps the meaning will fail it, and that failure is about the test.
   */
  it('tells Ref2VA the style is a sentence of its own (wording proxy)', () => {
    expect(promptFor('Ref2VA')).toContain('its own sentence before [Shot 1]');
  });

  it('names the continuity fields the schema requires, in every mode', () => {
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'] as H3Mode[]) {
      const prompt = promptFor(mode);
      expect(prompt, mode).toContain('<scenetrans>');
      expect(prompt, mode).toContain('crossesCut');
      expect(prompt, mode).toContain('<cutoff>');
      expect(prompt, mode).toContain('cutoff: true');
    }
  });

  it('offers the continuity phrasings the guide lists rather than inventing one', async () => {
    const { CONTINUITY_PHRASES } = await import('../src/core/ir/vocab');
    const prompt = promptFor('T2VA');
    for (const phrase of CONTINUITY_PHRASES) expect(prompt).toContain(phrase);
  });

  it('scopes the punctuation instruction away from words the user supplied', () => {
    const prompt = promptFor('T2VA');
    expect(prompt).toContain('Lines you write yourself end with . ? or !');
    expect(prompt).toContain('its missing full stop if that is how it arrived');
    // The unscoped form is what made the two instructions contradict.
    expect(prompt).not.toContain('End each line with . ? or !');
  });
});
