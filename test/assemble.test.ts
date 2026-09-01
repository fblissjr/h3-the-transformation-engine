/**
 * Planner output -> document.
 *
 * The interesting behaviour is the resolution of ordinals to ids and the
 * refusal to accept a plan that references something that was never attached.
 * A dangling reference that assembles cleanly becomes a rendering bug much
 * later, at which point its cause is invisible.
 */

import { describe, expect, it } from 'vitest';
import { assemble, AssembleError } from '../src/core/assemble';
import type { CreativeModeRecord } from '../src/core/creative';
import { PlannerOutputSchema, plannerJsonSchema } from '../src/core/ir/schema';
import type { PlannerOutput } from '../src/core/ir/schema';
import type { CompileInput } from '../src/core/ir/types';
import { normalize } from '../src/core/normalize';
import { serialize } from '../src/core/serialize';
import { contextFor } from '../src/core/normalize';
import { validate } from '../src/core/validate';

const input: CompileInput = {
  idea: 'A baker opens up before dawn.',
  mode: 'T2VA',
  durationFrames: 192,
  slots: [],
  suppliedDialogue: ['First batch of the morning.'],
};

const plan: PlannerOutput = {
  style: 'Live-action, cinematic',
  speakers: [{ descriptor: 'the middle-aged baker with a calm voice', subject: null, compoundOf: null }],
  subjects: [],
  shots: [
    {
      cutAtMs: null,
      cutStyle: null,
      camera: { type: 'Push In', amplitude: 'small', speed: 'slow' },
      beats: [
        {
          prose:
            'The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm ' +
            'voice (S1) sets down a loaf and says: <d/>',
          speaker: 1,
          dialogue: {
            language: 'English',
            text: 'First batch of the morning.',
            voiceover: false,
            crossesCut: null,
            cutoff: false,
          },
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
      ],
    },
    {
      cutAtMs: 5000,
      cutStyle: 'the camera cuts to',
      camera: null,
      beats: [
        {
          prose: 'the camera cuts to a close-up of steam rising from the sliced bread.',
          speaker: null,
          dialogue: null,
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
      ],
    },
  ],
  soundscape: 'Wooden shutters scrape open over a quiet street.',
  music: 'A soft acoustic-guitar pattern at a moderate tempo.',
  summary: null,
  taskTypes: null,
  audioRetention: null,
  pictureRetention: null,
};

describe('assemble', () => {
  const ctx = normalize(input);
  const doc = assemble(plan, input, ctx, { id: 'doc-1' });

  it('assigns positional ids and derived indices', () => {
    expect(doc.shots.map((s) => s.id)).toEqual(['shot-1', 'shot-2']);
    expect(doc.shots.map((s) => s.index)).toEqual([1, 2]);
    expect(doc.speakers[0].id).toBe('sp-1');
    expect(doc.speakers[0].ordinal).toBe(1);
  });

  it('forces the first shot to carry no timestamp whatever the planner said', () => {
    const withStray = structuredClone(plan);
    withStray.shots[0].cutAtMs = 1234;
    expect(assemble(withStray, input, ctx, { id: 'x' }).shots[0].cutAtMs).toBeNull();
  });

  it('resolves a speaker ordinal to a speaker id', () => {
    expect(doc.shots[0].beats[0].speakerId).toBe('sp-1');
  });

  it('marks dialogue the user supplied so the patch gate can protect it', () => {
    expect(doc.shots[0].beats[0].dialogue?.userSupplied).toBe(true);
  });

  it('produces a document that validates and renders', () => {
    expect(validate(doc, contextFor(doc)).diagnostics).toEqual([]);
    expect(serialize(doc, contextFor(doc)).text).toContain(
      '<d>[English] First batch of the morning.</d>',
    );
  });

  it('is deterministic', () => {
    expect(assemble(plan, input, ctx, { id: 'doc-1' })).toEqual(doc);
  });
});

describe('assemble refuses dangling references', () => {
  const ctx = normalize(input);

  it('throws when a beat is attributed to an undeclared speaker', () => {
    const bad = structuredClone(plan);
    bad.shots[0].beats[0].speaker = 4;
    expect(() => assemble(bad, input, ctx, { id: 'x' })).toThrow(AssembleError);
    expect(() => assemble(bad, input, ctx, { id: 'x' })).toThrow(/\(S4\), which was never declared/);
  });

  it('throws when a subject cites a slot that was never attached', () => {
    const refInput: CompileInput = {
      idea: 'x',
      mode: 'Ref2VA',
      durationSeconds: 8,
      slots: [{ id: 'a', order: 0, kind: 'image', roles: ['identity'], description: 'someone' }],
    };
    const bad = structuredClone(plan);
    bad.subjects = [
      {
        sources: [{ slotOrder: 7, provides: 'appearance' }],
        traits: 'is a person.',
        appearsInShots: [1],
        retention: 'fully_preserved',
        retentionNote: 'retained.',
      },
    ];
    expect(() => assemble(bad, refInput, normalize(refInput), { id: 'x' })).toThrow(
      /slot order 7, which was never attached/,
    );
  });
});

/**
 * Input metadata reaching the document.
 *
 * These two used to be stamped by the caller, one `if` each in `compile`, where
 * nothing could reach them without a client: deleting either line left the whole
 * suite green. They belong on the document -- an assisted edit reads the style
 * off it, and the version label's seed means nothing without the template
 * beside it -- so they are assembled with everything else that is derived from
 * the input.
 */
describe('input metadata on the assembled document', () => {
  it('carries the creative mode that produced the prose', () => {
    const creativeMode = {
      mode: 'wild',
      selection: { visual: 'V06', strength: 'full' },
    } satisfies CreativeModeRecord;
    const doc = assemble(plan, { ...input, creativeMode }, normalize({ ...input, creativeMode }), { id: 'd' });
    expect(doc.creativeMode).toEqual(creativeMode);
  });

  it('carries the roll that produced the idea', () => {
    const roll = { template: 'a baker in {setting}.', seed: 7 };
    const doc = assemble(plan, { ...input, roll }, normalize({ ...input, roll }), { id: 'd' });
    expect(doc.roll).toEqual(roll);
  });

  it('adds neither key when the input carries neither', () => {
    const doc = assemble(plan, input, normalize(input), { id: 'd' });
    expect('creativeMode' in doc).toBe(false);
    expect('roll' in doc).toBe(false);
  });
});

describe('null amplitude and speed are a spelling of absent', () => {
  // The prompt says medium and normal are expressed by leaving the field out,
  // and a model doing exactly that in JSON writes null. Measured 2026-09-01:
  // three of eight T2VA plans from a local model were refused on
  // `amplitude: null` and nothing else. The schema accepts it and the document
  // never carries it, so the vocabulary is still the guide's two values.
  it('parses, assembles without the key, and validates clean', () => {
    const withNulls = structuredClone(plan);
    withNulls.shots[0].camera = { type: 'Push In', amplitude: null, speed: null } as never;
    const parsed = PlannerOutputSchema.safeParse(withNulls);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const ctx = normalize(input);
    const doc = assemble(parsed.data, input, ctx, { id: 'nulls', modeLocked: true });
    expect(doc.shots[0].camera).toEqual({ type: 'Push In' });
    expect(Object.keys(doc.shots[0].camera ?? {})).not.toContain('amplitude');
    expect(validate(doc, ctx).diagnostics).toEqual([]);
  });

  it('advertises null in the JSON schema the trailer sends, so the model is told it is legal', () => {
    // The JSON Schema is what a local model reads; a value accepted by zod but
    // not shown there is a leniency the model cannot discover.
    const text = JSON.stringify(plannerJsonSchema());
    expect(text).toContain('"amplitude"');
    // The window after the key, since the schema nests anyOf inside anyOf and a
    // bracket-matching regex is more test than the claim deserves.
    const window = text.slice(text.indexOf('"amplitude":'), text.indexOf('"amplitude":') + 120);
    expect(window, window).toMatch(/"null"/);
  });
});
