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
    expect(validate(doc, contextFor(doc)).errors).toEqual([]);
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
