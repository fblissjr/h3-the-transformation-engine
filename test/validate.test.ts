/**
 * Red-proving controls.
 *
 * This is the case where a breakage plainly earns itself: a diagnostic nothing
 * can make fire is decoration, and whether it fires is a question about the
 * rule reaching a document, not about an assertion reading a value. So every
 * code below gets a fixture that breaks exactly its rule, against the standing
 * evidence from serialize.test.ts that the unbroken official examples produce
 * no errors at all.
 *
 * The broader judgement about when to spend a breakage is in CLAUDE.md.
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
import { i2vaTrain, t2vaBaker } from './fixtures/guide-examples';
import { ref2vaCoffeeShop } from './fixtures/ref-example';
import {
  EXERCISED,
  crossCutBaker,
  cutoffBaker,
  visibleTextBaker,
  voiceoverBaker,
} from './fixtures/exercised';

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
  /**
   * What input class this rule examines, on the unmutated fixture.
   *
   * The green half of every control asserts the code is absent from known-good
   * input. That is the cry-wolf check, and it is vacuous when the rule was
   * handed nothing it looks at: four codes gated on `crossesCut`, `cutoff`,
   * `voiceover` and `visibleText` were asserting silence about features the
   * corpus did not contain, and reading as coverage in the run summary.
   *
   * Required, so a new rule cannot ship with a hollow green, the same way
   * control coverage below refuses one with no red.
   *
   * The honest limit: this proves the corpus holds an input the rule inspects,
   * not one that would expose the rule's bug. The `userSupplied` scoping error
   * fixed earlier would have passed it -- the corpus does carry a supplied
   * line, correctly punctuated, so the rule looked and was rightly silent.
   */
  inspects: (doc: H3Document) => boolean;
}

const anyBeat = (doc: H3Document, f: (b: H3Document['shots'][number]['beats'][number]) => boolean) =>
  doc.shots.some((s) => s.beats.some(f));

const has = {
  shots: (d: H3Document) => d.shots.length > 0,
  laterShot: (d: H3Document) => d.shots.length > 1,
  duration: (d: H3Document) => d.durationSeconds > 0,
  slots: (d: H3Document) => d.slots.length > 0,
  camera: (d: H3Document) => d.shots.some((s) => s.camera != null),
  speakers: (d: H3Document) => d.speakers.length > 0,
  dialogue: (d: H3Document) => anyBeat(d, (b) => b.dialogue != null),
  prose: (d: H3Document) => anyBeat(d, (b) => b.prose.trim() !== ''),
  visibleText: (d: H3Document) => anyBeat(d, (b) => b.visibleText.length > 0),
  voiceover: (d: H3Document) => anyBeat(d, (b) => b.dialogue?.voiceover === true),
  crossesCut: (d: H3Document) => anyBeat(d, (b) => b.dialogue?.crossesCut != null),
  cutoff: (d: H3Document) => anyBeat(d, (b) => b.dialogue?.cutoff === true),
  subjects: (d: H3Document) => (d.subjects?.length ?? 0) > 0,
  retention: (d: H3Document) => (d.retention?.length ?? 0) > 0,
  summary: (d: H3Document) => d.summary != null,
  taskTypes: (d: H3Document) => (d.taskTypes?.length ?? 0) > 0,
};

const CONTROLS: Control[] = [
  // --- structure and duration -------------------------------------------
  { code: 'NO_SHOTS', base: t2vaBaker, mutate: (d) => void (d.shots = []), inspects: has.shots },
  { code: 'DURATION_NOT_POSITIVE', base: t2vaBaker, mutate: (d) => void (d.durationSeconds = 0), inspects: has.duration },
  {
    code: 'MODE_SLOT_MISMATCH',
    base: t2vaBaker,
    mutate: (d) =>
      void d.slots.push({ id: 'x', order: 0, kind: 'image', roles: ['first_frame'], description: 'stray' }),
    inspects: has.shots,
  },

  // --- shots --------------------------------------------------------------
  { code: 'SHOT_INDEX_NOT_SEQUENTIAL', base: t2vaBaker, mutate: (d) => void (d.shots[0].index = 3), inspects: has.shots },
  { code: 'SHOT_1_HAS_TIMESTAMP', base: t2vaBaker, mutate: (d) => void (d.shots[0].cutAtMs = 1000), inspects: has.shots },
  { code: 'SHOT_MISSING_TIMESTAMP', base: t2vaBaker, mutate: (d) => void (d.shots[1].cutAtMs = null), inspects: has.laterShot },
  { code: 'CUT_NOT_INCREASING', base: ref2vaCoffeeShop, mutate: (d) => void (d.shots[2].cutAtMs = 1000), inspects: has.laterShot },
  { code: 'CUT_OUTSIDE_DURATION', base: t2vaBaker, mutate: (d) => void (d.shots[1].cutAtMs = 99_000), inspects: has.laterShot },
  { code: 'SHOT_NO_BEATS', base: t2vaBaker, mutate: (d) => void (d.shots[0].beats = []), inspects: has.shots },

  // --- camera -------------------------------------------------------------
  {
    code: 'CAMERA_TYPE_INVALID',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].camera = { type: 'Barrel Roll' as never }),
    inspects: has.camera,
  },
  {
    code: 'FRAME_ROLE_ON_NON_IMAGE',
    base: ref2vaCoffeeShop,
    mutate: (d) => void d.slots[6].roles.push('first_frame'),
    inspects: has.slots,
  },

  // --- speakers -----------------------------------------------------------
  { code: 'SPEAKER_ORDINALS_NOT_SEQUENTIAL', base: t2vaBaker, mutate: (d) => void (d.speakers[0].ordinal = 5), inspects: has.speakers },
  {
    code: 'SPEAKER_ORDER_WRONG',
    base: ref2vaCoffeeShop,
    // The man speaks second but is renumbered (S1); the woman speaks first.
    mutate: (d) => {
      d.speakers[0].ordinal = 2;
      d.speakers[1].ordinal = 1;
    },
    inspects: has.speakers,
  },
  { code: 'SPEAKER_UNDECLARED', base: t2vaBaker, mutate: (d) => void (d.shots[0].beats[1].speakerId = 'ghost'), inspects: has.dialogue },
  {
    code: 'SPEAKER_REF_MISSING_IN_PROSE',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].prose = d.shots[0].beats[1].prose.replace('(S1)', 'she')),
    inspects: has.speakers,
  },
  { code: 'SPEAKER_NOT_INTRODUCED', base: t2vaBaker, mutate: (d) => void (d.speakers[0].descriptor = ''), inspects: has.speakers },
  {
    code: 'COMPOUND_SPEAKER_INVALID',
    base: t2vaBaker,
    mutate: (d) => void (d.speakers[0].compoundOf = ['sp-baker']),
    inspects: has.speakers,
  },

  // --- dialogue -----------------------------------------------------------
  {
    code: 'DIALOGUE_PLACEHOLDER_MISSING',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].prose = d.shots[0].beats[1].prose.replace('<d/>', '')),
    inspects: has.dialogue,
  },
  {
    code: 'DIALOGUE_PLACEHOLDER_ORPHAN',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[0].prose += ' <d/>'),
    inspects: has.prose,
  },
  {
    code: 'DIALOGUE_BAD_TERMINAL',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].dialogue!.text = 'First batch of the morning'),
    inspects: has.dialogue,
  },
  {
    code: 'DIALOGUE_DECORATIVE_PUNCT',
    base: t2vaBaker,
    mutate: (d) => void (d.shots[0].beats[1].dialogue!.text = 'First batch of the morning!!!'),
    inspects: has.dialogue,
  },
  {
    code: 'VOICEOVER_PHRASE_MISSING',
    base: voiceoverBaker,
    mutate: (d) =>
      void (d.shots[0].beats[0].prose = d.shots[0].beats[0].prose.replace(
        'says in an off-screen voiceover',
        'says',
      )),
    inspects: has.voiceover,
  },
  {
    code: 'SCENETRANS_UNPAIRED',
    base: crossCutBaker,
    mutate: (d) => void delete d.shots[1].beats[0].dialogue!.crossesCut,
    inspects: has.crossesCut,
  },
  {
    code: 'CUTOFF_NOT_AT_END',
    base: cutoffBaker,
    mutate: (d) => void (d.shots[0].beats[0].prose += ' <cutoff>'),
    inspects: has.cutoff,
  },

  // --- visible text -------------------------------------------------------
  {
    code: 'VISIBLE_TEXT_NOT_QUOTED',
    base: visibleTextBaker,
    mutate: (d) =>
      void (d.shots[0].beats[0].prose = d.shots[0].beats[0].prose.replace('"OPEN"', 'OPEN')),
    inspects: has.visibleText,
  },

  // --- audio sections -----------------------------------------------------

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
    inspects: has.slots,
  },
  { code: 'SLOT_NO_ROLES', base: ref2vaCoffeeShop, mutate: (d) => void (d.slots[0].roles = []), inspects: has.slots },
  { code: 'SLOT_ORDER_NOT_CONTIGUOUS', base: ref2vaCoffeeShop, mutate: (d) => void (d.slots[2].order = 99), inspects: has.slots },

  // --- Ref2VA -------------------------------------------------------------
  { code: 'REF_MISSING_SUMMARY', base: ref2vaCoffeeShop, mutate: (d) => void (d.summary = ''), inspects: has.summary },
  { code: 'REF_MISSING_TASK_TYPES', base: ref2vaCoffeeShop, mutate: (d) => void (d.taskTypes = []), inspects: has.taskTypes },
  {
    code: 'REF_TASK_TYPE_DUPLICATE',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.taskTypes = ['reference generation', 'reference generation']),
    inspects: has.taskTypes,
  },
  {
    code: 'REF_SUMMARY_NEW_LABEL',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.summary += ' It also uses <Picture 9>.'),
    inspects: has.summary,
  },
  { code: 'REF_RETENTION_MISSING', base: ref2vaCoffeeShop, mutate: (d) => void (d.retention = []), inspects: has.retention },
  {
    code: 'REF_RETENTION_MARKER_WRONG_CLASS',
    base: ref2vaCoffeeShop,
    // A visual marker on the audio label.
    mutate: (d) => void (d.retention![4].marker = 'fully_preserved'),
    inspects: has.retention,
  },
  {
    code: 'REF_SPEAKER_IN_RETENTION',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.retention![0].note += ' Spoken by (S1).'),
    inspects: has.retention,
  },
  {
    code: 'REF_LABEL_UNDEFINED',
    base: ref2vaCoffeeShop,
    mutate: (d) => void (d.shots[0].beats[0].prose += ' <Subject 9> waves.'),
    inspects: has.prose,
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
    expect(result.diagnostics.map((d) => d.code)).toContain('RULE_THREW');
    expect(result.diagnostics[0].message).toContain('boom');
  });
});

/**
 * The green half is only worth something if the rule was handed something to
 * look at.
 *
 * Every control asserts its code is absent from the unmutated fixture, which is
 * the cry-wolf check. Four of them were asserting silence about features the
 * corpus did not contain -- no voiceover, no on-screen text, no line across a
 * cut, no truncated speech anywhere in the five guide examples -- so the rule
 * was never handed an input and the assertion passed without testing anything.
 *
 * Writing the fixtures that fill that in immediately found a rule firing on
 * legitimate output: the terminal-punctuation check demanded a full stop on the
 * first half of a line crossing a cut and on speech truncated by the end of the
 * video, both of which are incomplete by construction and are exactly what
 * `<scenetrans>` and `<cutoff>` mean.
 */
/**
 * The standing evidence behind the four fixtures above.
 *
 * They only serve as known-good input while they are known good, and writing
 * them is what found the terminal-punctuation rule demanding a full stop on the
 * first half of a line crossing a cut and on speech the video truncates -- both
 * incomplete by construction, and both exactly what their tags mean. Without
 * this assertion that fix has no control: every other test here is about a
 * mutated document.
 */
describe('the exercised fixtures are known good', () => {
  for (const doc of EXERCISED) {
    it(`${doc.id} validates clean`, () => {
      const diagnostics = validate(doc, contextFor(doc)).diagnostics;
      expect(diagnostics.map((d) => `${d.code} @ ${d.path}`)).toEqual([]);
    });
  }
});

describe('every green half was handed something to look at', () => {
  for (const { code, base, inspects } of CONTROLS) {
    it(`${code} runs against a fixture containing the input it examines`, () => {
      expect(inspects(base), `${code}'s fixture has nothing its rule inspects`).toBe(true);
    });
  }
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
    expect(emitted.size).toBeGreaterThan(25);
  });
});


/**
 * The punctuation rules are scoped to dialogue the user did not supply.
 *
 * Ref 5.4 standardizes punctuation, but its own paragraph scopes that to
 * dialogue reused from reference audio or reperformed on request. Base 4.4
 * governs the other case and says the opposite: "Preserve every original word
 * and punctuation mark verbatim; do not translate or rewrite them." Applied to
 * a line the user typed, these two codes demand a rewrite the base guide
 * forbids -- and `src/core/patch/apply.ts` refuses to let a patch touch
 * user-supplied dialogue, so the error could not be cleared even by agreeing
 * with it. `i2vaTrain` carries the only userSupplied line in the fixtures.
 */
describe('dialogue punctuation scope', () => {
  const supplied = (mutate: Mutate) => broken(i2vaTrain, mutate);

  it('the fixture it relies on really is user-supplied', () => {
    expect(i2vaTrain.shots[0].beats[2].dialogue?.userSupplied).toBe(true);
  });

  it('leaves decorative punctuation alone in a supplied line', () => {
    const doc = supplied((d) => void (d.shots[0].beats[2].dialogue!.text = 'I get off... at the next station!!!'));
    expect(codesFor(doc)).not.toContain('DIALOGUE_DECORATIVE_PUNCT');
  });

  it('leaves a missing terminal mark alone in a supplied line', () => {
    const doc = supplied((d) => void (d.shots[0].beats[2].dialogue!.text = 'I get off at the next station'));
    expect(codesFor(doc)).not.toContain('DIALOGUE_BAD_TERMINAL');
  });

  /**
   * ref 5.4 scopes the terminal rule to "complete statements, questions, and
   * exclamations". The rule was wider than that sentence: every line without a
   * terminal failed, so a planner-written chant or interjection was rejected
   * for punctuation the guide never asked of it. The contract's own diagnostic
   * text had the scope right the whole time, and nothing compared the two
   * because the spec binds a diagnostic's existence and not its condition.
   *
   * The flag is `fragment` and not `sung` on purpose. Completeness is the
   * property ref 5.4 names; delivery only correlates with it. Both directions
   * of that leak are asserted below.
   */
  it('leaves a fragment alone, since ref 5.4 asks only about complete utterances', () => {
    const doc = supplied((d) => {
      const dialogue = d.shots[0].beats[2].dialogue!;
      dialogue.userSupplied = false;
      dialogue.text = "I'm lonely lonely lonely lonely lonely I'm lonely";
      dialogue.fragment = true;
    });
    expect(codesFor(doc)).not.toContain('DIALOGUE_BAD_TERMINAL');
  });

  it('still fires on a complete statement that happens to be sung', () => {
    // The leak a `sung` flag would have had in one direction: this is a
    // complete statement and takes a terminal mark whether or not it is sung.
    const doc = supplied((d) => {
      const dialogue = d.shots[0].beats[2].dialogue!;
      dialogue.userSupplied = false;
      dialogue.text = 'I left the light on down the hall';
      dialogue.fragment = false;
    });
    expect(codesFor(doc)).toContain('DIALOGUE_BAD_TERMINAL');
  });

  it('strips decorative punctuation from a fragment all the same', () => {
    // Only the terminal-mark half is scoped to complete utterances. ref 5.4's
    // decorative-punctuation clause is unconditional, and this is the assertion
    // that keeps the narrowing on one branch.
    const doc = supplied((d) => {
      const dialogue = d.shots[0].beats[2].dialogue!;
      dialogue.userSupplied = false;
      dialogue.text = 'lonely lonely lonely~~~';
      dialogue.fragment = true;
    });
    expect(codesFor(doc)).toContain('DIALOGUE_DECORATIVE_PUNCT');
  });

  it('still fires on a missing terminal mark once it is not user-supplied', () => {
    const doc = supplied((d) => {
      const dialogue = d.shots[0].beats[2].dialogue!;
      dialogue.userSupplied = false;
      dialogue.text = 'I get off at the next station';
    });
    expect(codesFor(doc)).toContain('DIALOGUE_BAD_TERMINAL');
  });

  it('still fires on the same text once it is not user-supplied', () => {
    const doc = supplied((d) => {
      const dialogue = d.shots[0].beats[2].dialogue!;
      dialogue.userSupplied = false;
      dialogue.text = 'I get off... at the next station!!!';
    });
    const codes = codesFor(doc);
    expect(codes).toContain('DIALOGUE_DECORATIVE_PUNCT');
  });
});
