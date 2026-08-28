/**
 * Are the golden fixtures actually the guides' text?
 *
 * `test/serialize.test.ts` asserts the serializer reproduces the fixtures byte
 * for byte. That is only worth anything if the fixtures are themselves the
 * guides' worked examples, and nothing checked it -- two of the five had been
 * transcribed with typographic apostrophes (U+2019) where the official text has
 * ASCII ones, so the suite was byte-exact against a copy that was already wrong.
 *
 * Two checks, because the guides are not in the repo:
 *
 * 1. The character-set check runs everywhere. It is the one that would have
 *    caught the bug on a fresh clone: the guides' worked examples are pure
 *    ASCII apart from the em dash in the FL2VA and L2VA alignment lines, so
 *    anything else in the golden text came from a transcription tool.
 *
 * 2. The byte comparison against the guide files themselves, which are tracked
 *    in `reference/h3/` precisely so this can run from a clean checkout. The
 *    absent branch below is a safety net rather than the normal case now, and
 *    it reports itself instead of passing quietly: a green that skipped the
 *    only check of transcription fidelity must not look like one that ran it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fl2vaUmbrellaExpected,
  i2vaTrainExpected,
  l2vaGlassExpected,
  t2vaBakerExpected,
} from './fixtures/guide-examples';
import { ref2vaCoffeeShopExpected } from './fixtures/ref-example';
import { REF_DETAIL_WORD_RANGE } from '../src/core/ir/vocab';
import { normalize } from '../src/core/normalize';
import { buildPlannerSystemPrompt } from '../src/provider/prompts/planner';

const GUIDE_DIR = join(import.meta.dirname, '../reference/h3');
const BASE_GUIDE = join(GUIDE_DIR, 'VIDEO_PROMPT_WRITING_GUIDE_base_en.md');
const REF_GUIDE = join(GUIDE_DIR, 'VIDEO_PROMPT_WRITING_GUIDE_ref_en.md');

/**
 * The em dash opens the FL2VA and L2VA alignment lines and is the only
 * character above ASCII in any of the five examples. The apostrophes, the
 * quotes and the hyphens in the official text are all the plain forms.
 */
const ALLOWED_NON_ASCII = new Set(['—']);

const goldens = [
  { name: 'T2VA', text: t2vaBakerExpected },
  { name: 'I2VA', text: i2vaTrainExpected },
  { name: 'FL2VA', text: fl2vaUmbrellaExpected },
  { name: 'L2VA', text: l2vaGlassExpected },
  { name: 'Ref2VA', text: ref2vaCoffeeShopExpected },
];

describe('the golden text uses the characters the guides use', () => {
  for (const { name, text } of goldens) {
    it(name, () => {
      const found = [...new Set([...text].filter((c) => c.charCodeAt(0) > 127))]
        .filter((c) => !ALLOWED_NON_ASCII.has(c))
        .map((c) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(c)}`);
      expect(found, `${name} carries characters the official text does not`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// The direct comparison, where the guides are on disk
// ---------------------------------------------------------------------------

/** The fenced `text` blocks of a section, in order. */
function fencedBlocks(markdown: string, afterHeading: string): string[] {
  const section = markdown.split(afterHeading)[1] ?? '';
  return [...section.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1].replace(/\n+$/, ''));
}

const guidesPresent = existsSync(BASE_GUIDE) && existsSync(REF_GUIDE);

describe('the golden text is the guides own text', () => {
  if (!guidesPresent) {
    /**
     * A todo, not a skip and not a silent pass.
     *
     * `console.warn` from a passing test does not reach the default reporter,
     * so a "loud" message here would have been invisible -- which is the exact
     * shape of the problem this file exists to fix. A todo is counted and named
     * in the run summary, so the line reads `N passed | 1 todo` and the todo
     * says what went unchecked.
     */
    it.todo(
      'UNVERIFIED: reference/h3 is absent, so the golden text was not compared to the guides',
    );
    return;
  }

  const base = readFileSync(BASE_GUIDE, 'utf8');
  const ref = readFileSync(REF_GUIDE, 'utf8');
  const cases = fencedBlocks(base, '## 5. Cases');
  const refCase = fencedBlocks(ref, '## 7. Complete Example');

  const pairs = [
    { name: 'T2VA (base guide case 1)', golden: t2vaBakerExpected, guide: cases[0] },
    { name: 'I2VA (base guide case 2)', golden: i2vaTrainExpected, guide: cases[1] },
    { name: 'FL2VA (base guide case 3)', golden: fl2vaUmbrellaExpected, guide: cases[2] },
    { name: 'L2VA (base guide case 4)', golden: l2vaGlassExpected, guide: cases[3] },
    { name: 'Ref2VA (ref guide section 7)', golden: ref2vaCoffeeShopExpected, guide: refCase[0] },
  ];

  it('found all five worked examples in the guides', () => {
    expect(cases).toHaveLength(4);
    expect(refCase.length).toBeGreaterThanOrEqual(1);
  });

  for (const { name, golden, guide } of pairs) {
    it(name, () => {
      expect(golden).toBe(guide);
    });
  }
});

/**
 * A scoped number carries its scope, or it is a misquote.
 *
 * ref 5.2 states 350-500 words `for generation tasks` and exempts two cases in
 * the same breath: video-editing descriptions scale with the source video, and
 * dialogue-dense material fits the spoken timeline first. The contract encoded
 * the bare range and the planner applied it to every Ref2VA job, so a video
 * edit was told to pad to a range the guide explicitly frees it from. An
 * outside audit of the contract found it; nothing here would have.
 *
 * The guide half of this test needs the guide on disk and says so when it is
 * absent. The planner half does not, because the exemptions are the thing that
 * regresses -- a later edit that tightens the sentence back to a bare range
 * should fail on a clean checkout too.
 */
describe('the ref word range keeps the scope the guide gives it', () => {
  const planner = buildPlannerSystemPrompt(
    normalize({ idea: 'A coffee shop scene, recut.', mode: 'Ref2VA', durationFrames: 192, slots: [] }),
    { idea: 'A coffee shop scene, recut.', mode: 'Ref2VA', durationFrames: 192, slots: [] },
  );

  it('states the range at all, so the rest of this test is not vacuous', () => {
    expect(planner).toContain(`${REF_DETAIL_WORD_RANGE[0]}-${REF_DETAIL_WORD_RANGE[1]} words`);
  });

  it('names the generation-task scope', () => {
    expect(planner).toContain('generation task');
  });

  it('names the video-editing exemption', () => {
    expect(planner.toLowerCase()).toContain('video-editing');
  });

  it('names the dialogue-dense exemption', () => {
    expect(planner.toLowerCase()).toContain('dialogue-dense');
  });

  if (!guidesPresent) {
    it.todo('UNVERIFIED: reference/h3 is absent, so the scope was not compared to ref 5.2');
  } else {
    it('is the scope ref 5.2 actually states', () => {
      const ref = readFileSync(REF_GUIDE, 'utf8');
      const sentence = ref
        .split('\n')
        .find((line) => line.includes(`${REF_DETAIL_WORD_RANGE[0]}-${REF_DETAIL_WORD_RANGE[1]} English words`));
      expect(sentence, 'ref 5.2 no longer states the range this build encodes').toBeDefined();
      expect(sentence).toContain('For generation tasks');
      expect(sentence).toContain('do not have to follow the generation-task range');
      expect(sentence).toContain('Dialogue-dense content');
    });
  }
});
