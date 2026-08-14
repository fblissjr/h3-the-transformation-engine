/**
 * Red-proving controls.
 *
 * A check is unverified until it has been shown to go red for the right reason
 * AND green for the right reason. Every diagnostic code below gets a fixture
 * that deliberately breaks exactly that rule, plus the standing evidence from
 * serialize.test.ts that the unbroken official examples produce no errors at
 * all. A rule with only a green path is decoration.
 *
 * The last test in this file is the one that keeps the discipline: it scans the
 * rule sources for emitted codes and fails if any of them has no control here.
 * Adding a rule without a red fixture breaks the build.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { H3Document } from '../src/core/ir/types';
import { contextFor } from '../src/core/normalize';
import { validate, type Rule } from '../src/core/validate';
import { fl2vaUmbrella, t2vaBaker } from './fixtures/guide-examples';
import { ref2vaCoffeeShop } from './fixtures/ref-example';

type Mutate = (doc: H3Document) => void;

function broken(base: H3Document, mutate: Mutate): H3Document {
  const copy = structuredClone(base);
  mutate(copy);
  return copy;
}

function codesFor(doc: H3Document): string[] {
  return validate(doc, contextFor(doc)).diagnostics.map((d) => d.code);
}

interface Control {
  code: string;
  base: H3Document;
  mutate: Mutate;
}

const CONTROLS: Control[] = [
  // --- structure and duration -------------------------------------------
  { code: 'NO_SHOTS', base: t2vaBaker, mutate: (d) => void (d.shots = []) },
  { code: 'EMPTY_STYLE', base: t2vaBaker, mutate: (d) => void (d.style = '   ') },
  { code: 'DURATION_NOT_POSITIVE', base: t2vaBaker, mutate: (d) => void (d.durationSeconds = 0) },
  { code: 'FRAME_GRID_OFF', base: t2vaBaker, mutate: (d) => void (d.durationFrames = 100) },
  {
    code: 'MODE_SLOT_MISMATCH',
    base: t2vaBaker,
    mutate: (d) =>
      void d.slots.push({ id: 'x', order: 0, kind: 'image', roles: ['first_frame'], description: 'stray' }),
  },

  // --- shots --------------------------------------------------------------
  { code: 'SHOT_INDEX_NOT_SEQUENTIAL', base: t2vaBaker, mutate: (d) => void (d.shots[0].index = 3) },
  { code: 'SHOT_1_HAS_TIMESTAMP', base: t2vaBaker, mutate: (d) => void (d.shots[0].cutAtMs = 1000) },
  { code: 'SHOT_MISSING_TIMESTAMP', base: t2vaBaker, mutate: (d) => void (d.shots[1].cutAtMs = null) },
  { code: 'CUT_NOT_INCREASING', base: ref2vaCoffeeShop, mutate: (d) => void (d.shots[2].cutAtMs = 1000) },
  { code: 'CUT_OUTSIDE_DURATION', base: t2vaBaker, mutate: (d) => void (d.shots[1].cutAtMs = 99_000) },
  { code: 'CUT_TOO_LATE', base: t2vaBaker, mutate: (d) => void (d.shots[1].cutAtMs = 7_000) },
  { code: 'SHOT_NO_BEATS', base: t2vaBaker, mutate: (d) => void (d.shots[0].beats = []) },
  {
    code: 'FL2VA_MULTISHOT',
    base: fl2vaUmbrella,
    mutate: (d) =>
      void d.shots.push({ ...structuredClone(d.shots[0]), id: 's2', index: 2, cutAtMs: 4000 }),
  },

  // --- camera -------------------------------------------------------------
  {
    code: 'CAMERA_TYPE_INVALID',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].camera = { type: 'Barrel Roll' as never }),
  },
  {
    code: 'CAMERA_PROSE_MISSING',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].camera = { type: 'Arc Shot' }),
  },
  {
    code: 'CAMERA_LABEL_STACK',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[0].prose = 'Camera: push in, slow, small amplitude.'),
  },
  {
    code: 'FRAME_ROLE_ON_NON_IMAGE',
    base: ref2vaCoffeeShop,
    mutate: (d) => void d.slots[6].roles.push('first_frame'),
  },

  // --- speakers -----------------------------------------------------------
  { code: 'SPEAKER_ORDINALS_NOT_SEQUENTIAL', base: t2vaBaker, mutate: (d) => void (d.speakers[0].ordinal = 5) },
  {
    code: 'SPEAKER_ORDER_WRONG',
    base: ref2vaCoffeeShop,
    // The man speaks second but is renumbered (S1); the woman speaks first.
    mutate: (d) => {
      d.speakers[0].ordinal = 2;
      d.speakers[1].ordinal = 1;
    },
  },
  { code: 'SPEAKER_UNDECLARED', base: t2vaBaker, mutate: (d) => void (d.shots[0].beats[1].speakerId = 'ghost') },
  {
    code: 'SPEAKER_REF_MISSING_IN_PROSE',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].prose = d.shots[0].beats[1].prose.replace('(S1)', 'she')),
  },
  { code: 'SPEAKER_NOT_INTRODUCED', base: t2vaBaker, mutate: (d) => void (d.speakers[0].descriptor = '') },
  {
    code: 'COMPOUND_SPEAKER_INVALID',
    base: t2vaBaker,
    mutate: (d) => void (d.speakers[0].compoundOf = ['sp-baker']),
  },

  // --- dialogue -----------------------------------------------------------
  {
    code: 'DIALOGUE_PLACEHOLDER_MISSING',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].prose = d.shots[0].beats[1].prose.replace('<d/>', '')),
  },
  {
    code: 'DIALOGUE_PLACEHOLDER_ORPHAN',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[0].prose += ' <d/>'),
  },
  {
    code: 'DIALOGUE_BAD_TERMINAL',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].dialogue!.text = 'First batch of the morning'),
  },
  {
    code: 'DIALOGUE_DECORATIVE_PUNCT',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].dialogue!.text = 'First batch of the morning!!!'),
  },
  {
    code: 'VOICEOVER_PHRASE_MISSING',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].dialogue!.voiceover = true),
  },
  {
    code: 'VOICEOVER_LIPS_MISSING',
    base: t2vaBaker,
    mutate: (d) => {
      d.shots[0].beats[1].dialogue!.voiceover = true;
      d.shots[0].beats[1].prose = 'The baker (S1) says in an off-screen voiceover: <d/>';
    },
  },
  {
    code: 'SCENETRANS_UNPAIRED',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].dialogue!.crossesCut = 'starts'),
  },
  {
    code: 'CONTINUITY_PHRASE_MISSING',
    base: t2vaBaker,
    mutate: (d) => {
      d.shots[0].beats[1].dialogue!.crossesCut = 'starts';
      d.shots[0].beats[1].prose += ' <scenetrans>';
    },
  },
  {
    code: 'CUTOFF_NOT_AT_END',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].dialogue!.cutoff = true),
  },
  {
    code: 'DIALOGUE_OVER_BUDGET',
    base: t2vaBaker,
    mutate: (d) =>
      void (d.shots[0].beats[1].dialogue!.text = `${'word '.repeat(60).trim()}.`),
  },

  // --- visible text -------------------------------------------------------
  {
    code: 'VISIBLE_TEXT_NOT_QUOTED',
    base: t2vaBaker,
    mutate: (d) => void d.shots[0].beats[0].visibleText.push('OPEN'),
  },

  // --- audio sections -----------------------------------------------------
  {
    code: 'SOUNDSCAPE_SENTENCE_COUNT',
    base: t2vaBaker,
    mutate: (d) => void (d.soundscape = 'One. Two. Three. Four. Five.'),
  },
  {
    code: 'MUSIC_SENTENCE_COUNT',
    base: t2vaBaker,
    mutate: (d) => void (d.music = 'One. Two. Three. Four.'),
  },
  {
    code: 'SOUNDSCAPE_CONTAINS_DIALOGUE',
    base: t2vaBaker,
    mutate: (d) => void (d.soundscape = 'Trays clink softly. First batch of the morning is heard.'),
  },
  { code: 'MUSIC_ABSTRACT', base: t2vaBaker, mutate: (d) => void (d.music = 'Emotional and uplifting music.') },

  // --- slots --------------------------------------------------------------
  {
    code: 'SLOT_CEILING_EXCEEDED',
    base: ref2vaCoffeeShop,
    mutate: (d) => {
      for (let i = 0; i < 8; i += 1) {
        d.slots.push({
          id: `extra-${i}`,
          order: d.slots.length,
          kind: 'image',
          roles: ['identity'],
          description: 'extra',
        });
      }
    },
  },
  { code: 'SLOT_NO_ROLES', base: ref2vaCoffeeShop, mutate: (d) => void (d.slots[0].roles = []) },
  { code: 'SLOT_ORDER_NOT_CONTIGUOUS', base: ref2vaCoffeeShop, mutate: (d) => void (d.slots[2].order = 99) },
  {
    code: 'SLOT_UNUSED',
    base: ref2vaCoffeeShop,
    mutate: (d) =>
      void d.slots.push({
        id: 'orphan',
        order: d.slots.length,
        kind: 'image',
        roles: ['style'],
        description: 'never cited',
      }),
  },

  // --- Ref2VA -------------------------------------------------------------
  { code: 'REF_MISSING_SUMMARY', base: ref2vaCoffeeShop, mutate: (d) => void (d.summary = '') },
  { code: 'REF_MISSING_TASK_TYPES', base: ref2vaCoffeeShop, mutate: (d) => void (d.taskTypes = []) },
  {
    code: 'REF_TASK_TYPE_DUPLICATE',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.taskTypes = ['reference generation', 'reference generation']),
  },
  {
    code: 'REF_SUMMARY_NEW_LABEL',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.summary += ' It also uses <Picture 9>.'),
  },
  { code: 'REF_RETENTION_MISSING', base: ref2vaCoffeeShop, mutate: (d) => void (d.retention = []) },
  {
    code: 'REF_RETENTION_MARKER_WRONG_CLASS',
    base: ref2vaCoffeeShop,
    // A visual marker on the audio label.
    mutate: (d) => void (d.retention![4].marker = 'fully_preserved'),
  },
  {
    code: 'REF_SPEAKER_IN_RETENTION',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.retention![0].note += ' Spoken by (S1).'),
  },
  {
    code: 'REF_LABEL_UNDEFINED',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.shots[0].beats[0].prose += ' <Subject 9> waves.'),
  },
  {
    // Reproduces the observed failure: a summary that announces speech makes
    // the model improvise until it reaches the scripted line.
    code: 'SUMMARY_VOCAL_DIRECTIVE',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.summary += ' <Subject 3> argues with <Subject 4>.'),
  },
  {
    code: 'REF_FRAME_ROLE_EXTENDED',
    base: ref2vaCoffeeShop,
    mutate: (d) => {
      d.slots[0].roles = ['first_frame'];
      d.retention!.push({
        target: { type: 'slot', slotId: d.slots[0].id },
        context: '[Shot 1] first frame',
        marker: 'fully_preserved',
        note: 'the composition is restored for the closing wide shot.',
      });
    },
  },
  {
    code: 'REF_DETAIL_WORD_COUNT',
    base: ref2vaCoffeeShop,
    // Strip dialogue so the dialogue-dense exemption does not apply, then cut
    // the body well under the 350-word target.
    mutate: (d) => {
      d.shots = [d.shots[0]];
      d.shots[0].beats[0].prose = 'A medium shot establishes <Subject 1>.';
      delete d.shots[0].beats[0].dialogue;
      d.speakers = [];
      d.shots[0].beats[0].speakerId = undefined;
    },
  },
];

describe('every rule can go red', () => {
  for (const { code, base, mutate } of CONTROLS) {
    it(`${code} fires when its rule is violated`, () => {
      expect(codesFor(broken(base, mutate))).toContain(code);
    });
  }
});

describe('every rule stays green when it should', () => {
  for (const { code, base } of CONTROLS) {
    it(`${code} is absent from the unmodified fixture`, () => {
      expect(codesFor(base)).not.toContain(code);
    });
  }
});

describe('a rule that throws is reported, not swallowed', () => {
  it('surfaces RULE_THREW instead of taking down the whole run', () => {
    const exploding: Rule = () => {
      throw new Error('boom');
    };
    const result = validate(t2vaBaker, contextFor(t2vaBaker), [exploding]);
    expect(result.errors.map((d) => d.code)).toContain('RULE_THREW');
    expect(result.errors[0].message).toContain('boom');
  });
});

describe('control coverage', () => {
  it('every code emitted by a rule has a red-proving control', () => {
    const rulesDir = join(import.meta.dirname, '../src/core/validate/rules');
    const emitted = new Set<string>();

    for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(rulesDir, file), 'utf8');
      // Codes are the first argument to error()/warn(). Quote style is not
      // constrained anywhere, so match all three -- an earlier version of this
      // scan only accepted single quotes and let a double-quoted code ship
      // uncontrolled, which is precisely the gap this test exists to close.
      for (const m of source.matchAll(/\b(?:error|warn)\(\s*['"`]([A-Z0-9_]+)['"`]/g)) {
        emitted.add(m[1]);
      }
    }

    const controlled = new Set(CONTROLS.map((c) => c.code));
    const uncontrolled = [...emitted].filter((c) => !controlled.has(c)).sort();

    expect(uncontrolled).toEqual([]);
    // Guard against the scan silently matching nothing and passing vacuously.
    expect(emitted.size).toBeGreaterThan(40);
  });
});
