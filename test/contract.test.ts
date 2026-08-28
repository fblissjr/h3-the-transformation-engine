/**
 * Conformance: does the code do what `reference/h3/contract.json` says it does?
 *
 * The spec is written independently of the implementation, which is the only
 * way it can catch the implementation being wrong -- a spec generated from the
 * code agrees with the code by construction and is worth nothing. That
 * independence is also what makes this file necessary: two statements of the
 * same truth drift unless something compares them, and drift here is exactly
 * the failure this project keeps finding in itself.
 *
 * What is asserted:
 *
 *   the guide files still hash to what the spec recorded
 *   every alignment template, character for character
 *   section labels, order and layout, read off the rendered golden output
 *   where the style clause goes, and how shots are separated
 *   every vocabulary list, against the exports the code actually uses
 *   the ordered blocks of both system prompts
 *   the diagnostic list, against the codes the rules really emit
 *
 * If you are adding a mode, a section, a vocabulary value, a prompt block or a
 * diagnostic: put it in the spec first, watch this fail, then implement it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import contract from '../reference/h3/contract.json';
import * as vocab from '../src/core/ir/vocab';
import type { H3Mode } from '../src/core/ir/vocab';
import { serialize } from '../src/core/serialize';
import { contextFor, normalize } from '../src/core/normalize';
import { buildPlannerSystemPrompt } from '../src/provider/prompts/planner';
import { buildPatchSystemPrompt } from '../src/provider/prompts/patch';
import type { CompileInput } from '../src/core/ir/types';
import type { CreativeModeRecord } from '../src/core/creative';
import {
  fl2vaUmbrella,
  i2vaTrain,
  l2vaGlass,
  t2vaBaker,
} from './fixtures/guide-examples';
import { ref2vaCoffeeShop } from './fixtures/ref-example';

const GUIDE_DIR = join(import.meta.dirname, '../reference/h3');

const FIXTURES = {
  T2VA: t2vaBaker,
  I2VA: i2vaTrain,
  FL2VA: fl2vaUmbrella,
  L2VA: l2vaGlass,
  Ref2VA: ref2vaCoffeeShop,
} as const;

const rendered = (mode: keyof typeof FIXTURES) => {
  const doc = FIXTURES[mode];
  return serialize(doc, contextFor(doc)).text;
};

// ---------------------------------------------------------------------------
// The sources
// ---------------------------------------------------------------------------

describe('the guides the spec was written against', () => {
  for (const source of contract.sources) {
    it(`${source.file} is the file the spec recorded`, () => {
      const bytes = readFileSync(join(GUIDE_DIR, source.file));
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(
        sha,
        `${source.file} changed. If MiniMax revised the guide, update the hash and let the golden tests report what moved.`,
      ).toBe(source.sha256);
    });
  }
});

// ---------------------------------------------------------------------------
// Output shape, per mode
// ---------------------------------------------------------------------------

describe('output shape matches the spec', () => {
  it('covers every mode, and only modes that exist', () => {
    expect(Object.keys(contract.output).sort()).toEqual([...vocab.MODES].sort());
  });

  for (const mode of vocab.MODES) {
    const spec = contract.output[mode];
    const text = rendered(mode);

    describe(mode, () => {
      it('names the contract the code assigns it', () => {
        expect(spec.contract).toBe(vocab.contractFor(mode as H3Mode));
      });

      it('carries the alignment template exactly', () => {
        expect(spec.alignment).toBe(vocab.ALIGNMENT_TEMPLATES[mode as H3Mode]);
      });

      it('declares the substitutions its template actually contains', () => {
        const template = spec.alignment ?? '';
        const present = ['{N}', '{S.SS}'].filter((s) => template.includes(s));
        expect(('alignmentSubstitutions' in spec ? spec.alignmentSubstitutions : []) as string[]).toEqual(present);
      });

      it('lists the sections in the order they render', () => {
        const labels = spec.sections.map((s) => s.label);
        const positions = labels.map((label) => text.indexOf(`${label}:`));
        expect(positions.every((p) => p >= 0), `a section label is missing from ${mode}`).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      });

      it('lists the sections the contract defines and no others', () => {
        const expected =
          spec.contract === 'ref2va' ? [...vocab.REF_SECTIONS] : [...vocab.BASE_SECTIONS];
        expect(spec.sections.map((s) => s.label)).toEqual(expected);
      });

      /**
       * The one format difference between the contracts that is easy to get
       * wrong and invisible in a diff: base puts content on the label's line,
       * full-reference puts it on the next one.
       */
      it('gets the layout of every section right', () => {
        for (const section of spec.sections) {
          const at = text.indexOf(`${section.label}:`);
          const after = text.slice(at + section.label.length + 1);
          const inline = after.startsWith(' ') && !after.startsWith('\n');
          expect(inline, `${mode}.${section.label} is declared ${section.layout}`).toBe(
            section.layout === 'inline',
          );
        }
      });

      it('separates sections the way it says', () => {
        for (let i = 1; i < spec.sections.length; i++) {
          const previous = spec.sections[i - 1].label;
          const label = spec.sections[i].label;
          const between = text.slice(text.indexOf(`${previous}:`), text.indexOf(`${label}:`));
          expect(between.endsWith(spec.sectionSeparator)).toBe(true);
        }
      });

      it('puts the style clause where it says', () => {
        const body = spec.contract === 'ref2va' ? 'detailed_description:' : 'integrated_multimodal_description:';
        const start = text.indexOf(body) + body.length;
        const head = text.slice(start, start + 240);
        if (spec.stylePlacement === 'inline-after-shot-1') {
          expect(head.trimStart().startsWith('[Shot 1] ')).toBe(true);
        } else {
          // A sentence of its own, before the first shot marker.
          expect(head.indexOf('[Shot 1]')).toBeGreaterThan(1);
          expect(head.trimStart().startsWith('[Shot 1]')).toBe(false);
        }
      });

      /**
       * Scoped to the body. Ref2VA cites `[Shot 2]` in retention_analysis long
       * before the timeline reaches it, and the character in front of a
       * citation says nothing about how shots are separated.
       */
      it('separates shots the way it says', () => {
        const body = spec.contract === 'ref2va' ? 'detailed_description:' : 'integrated_multimodal_description:';
        const timeline = text.slice(text.indexOf(body));
        const secondShot = timeline.indexOf('[Shot 2]');
        if (secondShot < 0) return;
        expect(timeline[secondShot - 1]).toBe(spec.shotSeparator);
      });

      it('gives the first shot no timestamp', () => {
        expect(spec.firstShotHasTimestamp).toBe(false);
        const first = text.indexOf('[Shot 1]');
        expect(text.slice(first, first + 20)).not.toMatch(/\[Shot 1\] At \d/);
      });
    });
  }

  it('states the shot header the serializer writes', () => {
    expect(contract.shotHeader.first).toBe('[Shot 1]');
    expect(rendered('T2VA')).toContain('[Shot 1]');
    expect(rendered('T2VA')).toMatch(/\[Shot 2\] At \d\d:\d\d\.\d\d\d,/);
  });
});

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

describe('vocabulary matches the spec', () => {
  const v = contract.vocabulary;

  it('modes', () => expect(v.modes).toEqual([...vocab.MODES]));
  it('camera types', () => expect(v.cameraTypes.values).toEqual([...vocab.CAMERA_TYPES]));
  it('amplitudes', () => {
    expect(v.amplitudes.values).toEqual([...vocab.AMPLITUDES]);
    expect(v.amplitudes.phrases).toEqual(vocab.AMPLITUDE_PHRASE);
  });
  it('speeds', () => {
    expect(v.speeds.values).toEqual([...vocab.SPEEDS]);
    expect(v.speeds.phrases).toEqual(vocab.SPEED_PHRASE);
  });
  it('ordinary cuts', () => expect(v.ordinaryCuts.values).toEqual([...vocab.ORDINARY_CUTS]));
  it('special cuts', () => expect(v.specialCuts.values).toEqual([...vocab.SPECIAL_CUTS]));
  it('task types', () => expect(v.taskTypes.values).toEqual([...vocab.TASK_TYPES]));
  it('visual retention', () => expect(v.visualRetention.values).toEqual([...vocab.VISUAL_RETENTION]));
  it('audio retention', () => expect(v.audioRetention.values).toEqual([...vocab.AUDIO_RETENTION]));
  it('label kinds', () => expect(v.labelKinds.values).toEqual([...vocab.LABEL_KINDS]));
  it('media kinds', () => expect(v.mediaKinds.values).toEqual([...vocab.MEDIA_KINDS]));
  it('slot ceilings', () => expect(v.slotCeilings.values).toEqual(vocab.SLOT_CEILINGS));
  it('tags', () => {
    expect(v.tags.sceneTrans.value).toBe(vocab.SCENETRANS_TAG);
    expect(v.tags.cutoff.value).toBe(vocab.CUTOFF_TAG);
    expect(v.tags.unclear.value).toBe(vocab.UNCLEAR_MARKER);
  });
  it('voiceover phrase', () => expect(v.voiceoverPhrase.value).toBe(vocab.VOICEOVER_PHRASE));
  it('budgets', () => {
    expect(v.budgets.soundscapeSentences.range).toEqual([...vocab.SOUNDSCAPE_SENTENCE_RANGE]);
    expect(v.budgets.musicSentences.range).toEqual([...vocab.MUSIC_SENTENCE_RANGE]);
    expect(v.budgets.refDetailWords.range).toEqual([...vocab.REF_DETAIL_WORD_RANGE]);
  });
  it('the not-applicable sentinel', () => expect(v.notApplicable.value).toBe(vocab.NOT_APPLICABLE));

  /**
   * Every vocabulary entry says where it came from.
   *
   * `slotCeilings` and `mediaKinds` sat in this block beside twenty guide-cited
   * entries with the absence of a `guide` key as the only signal that no guide
   * states them. Marking the two was a data edit; without this the next entry
   * added with neither key is exactly as invisible as those two were, and the
   * whole suite stays green. An audit has to be able to tell contract from
   * house style at a glance, which is this file's stated job.
   */
  it('every entry carries either a guide citation or a house marker', () => {
    const unattributed = Object.entries(v)
      .filter(([, entry]) => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      .filter(([, entry]) => {
        const e = entry as Record<string, unknown>;
        if (typeof e.guide === 'string' || e.house === true) return false;
        // A grouping of sub-entries (tags) attributes each child instead.
        return !Object.values(e).every(
          (child) =>
            child !== null &&
            typeof child === 'object' &&
            typeof (child as Record<string, unknown>).guide === 'string',
        );
      })
      .map(([key]) => key);

    expect(unattributed).toEqual([]);
    // Not vacuous: the block has entries and they were actually inspected.
    expect(Object.keys(v).length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Prompt blocks
// ---------------------------------------------------------------------------

const input: CompileInput = { idea: 'A baker opens up before dawn.', mode: 'T2VA', durationFrames: 192, slots: [] };

/** Everything on: both conditional blocks present, so order can be checked whole. */
const EVERYTHING: CreativeModeRecord = {
  mode: 'directed',
  selection: { visual: 'V06', strength: 'full' },
  glitch: { tokens: ['SolidGoldMagikarp'], register: 'motif' },
};

describe('prompt blocks match the spec', () => {
  const planner = buildPlannerSystemPrompt(normalize(input), { ...input, creativeMode: EVERYTHING });
  const plannerBare = buildPlannerSystemPrompt(normalize(input), input);

  it('the planner carries every declared block, in order', () => {
    const positions = contract.prompts.planner.blocks.map((b) => planner.indexOf(b.heading));
    for (const [i, block] of contract.prompts.planner.blocks.entries()) {
      expect(positions[i], `planner is missing "${block.heading}"`).toBeGreaterThanOrEqual(0);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('the planner omits exactly the blocks the spec calls conditional', () => {
    for (const block of contract.prompts.planner.blocks) {
      const present = plannerBare.includes(block.heading);
      expect(present, `"${block.heading}" is declared conditional: ${block.conditional}`).toBe(
        !block.conditional,
      );
    }
  });

  it('the patch prompt carries every declared block, in order', () => {
    const patch = buildPatchSystemPrompt(EVERYTHING);
    const positions = contract.prompts.patch.blocks.map((b) => patch.indexOf(b.heading));
    for (const [i, block] of contract.prompts.patch.blocks.entries()) {
      expect(positions[i], `patch is missing "${block.heading}"`).toBeGreaterThanOrEqual(0);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('the patch prompt omits exactly the blocks the spec calls conditional', () => {
    const bare = buildPatchSystemPrompt();
    for (const block of contract.prompts.patch.blocks) {
      expect(bare.includes(block.heading), block.heading).toBe(!block.conditional);
    }
  });

  it('names builders that exist', () => {
    for (const prompt of [contract.prompts.planner, contract.prompts.patch]) {
      const [path, fn] = prompt.builder.split(':');
      const source = readFileSync(join(import.meta.dirname, '..', path), 'utf8');
      expect(source, prompt.builder).toContain(`export function ${fn}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

describe('the diagnostic list matches the rules', () => {
  it('lists every code the rules emit, and no code they do not', () => {
    const rulesDir = join(import.meta.dirname, '../src/core/validate/rules');
    const emitted = new Set<string>();
    for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(rulesDir, file), 'utf8');
      for (const m of source.matchAll(/\b(?:error|warn)\(\s*['"`]([A-Z0-9_]+)['"`]/g)) {
        emitted.add(m[1]);
      }
    }
    expect(Object.keys(contract.diagnostics.codes).sort()).toEqual([...emitted].sort());
  });

  it('gives every code a reason, citing a guide section or saying it is house', () => {
    for (const [code, why] of Object.entries(contract.diagnostics.codes)) {
      expect(why, code).toMatch(/^(house|base \d|ref \d)/);
    }
  });
});

// ---------------------------------------------------------------------------
// The rest of the spec's own claims
// ---------------------------------------------------------------------------

describe('the spec points at things that exist', () => {
  it('names golden fixtures that are exported', () => {
    const source = [
      readFileSync(join(import.meta.dirname, 'fixtures/guide-examples.ts'), 'utf8'),
      readFileSync(join(import.meta.dirname, 'fixtures/ref-example.ts'), 'utf8'),
    ].join('\n');
    for (const spec of Object.values(contract.output)) {
      expect(source, spec.goldenFixture).toContain(`export const ${spec.goldenFixture}`);
    }
  });

  it('names enforcing tests that exist for every invariant', () => {
    const files = new Set(readdirSync(join(import.meta.dirname)));
    for (const invariant of contract.invariants) {
      const named = invariant.enforcedBy.match(/test\/([\w.-]+\.ts)/);
      if (!named) continue;
      expect(files.has(named[1]), `${invariant.id} names ${named[1]}`).toBe(true);
    }
  });

  it('names source paths that exist for everything outside the guides', () => {
    for (const item of contract.notInTheGuides.items) {
      const path = item.where.split(':')[0];
      if (!path.startsWith('src/')) continue;
      expect(existsSync(join(import.meta.dirname, '..', path)), `${item.id} names ${path}`).toBe(true);
    }
  });
});
