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
 *   every guide citation resolves to a heading those files actually have
 *   every alignment template, character for character
 *   section labels, order, layout, and the exact gap between them
 *   where the style clause goes, how shots are separated, and both shot headers
 *   every vocabulary claim, against whatever its `binds` descriptor names
 *   the ordered blocks of both prompts, and structural anchors for what each says
 *   the diagnostic list, against the codes the rules really emit
 *   that everything the spec points at exists: test files, source paths, functions
 *
 * Two obligations, and both are enforced. A claim says where it came from --
 * a `guide` citation or `house: true` -- and it says what would make it false,
 * in `binds`. Provenance was checked here long before binding was, and the gap
 * was not visible from a green run: a mutation sweep of 63 spec fields found 33
 * could be changed with the whole suite passing, including nine vocabulary
 * entries that named a real exported constant and were compared to nothing.
 *
 * If you are adding a mode, a section, a vocabulary value, a prompt block or a
 * diagnostic: put it in the spec first, watch this fail, then implement it.
 * A new vocabulary claim needs a `binds` descriptor -- `export`, `render`,
 * `quotedIn`, or `unbound` with a reason, and the unbound list is pinned. A new
 * prompt block needs `asserts`, or a `noAnchor` reason saying why no structural
 * anchor is reachable. Neither is optional; this file fails without them.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import contract from '../reference/h3/contract.json';
import * as vocab from '../src/core/ir/vocab';
import type { H3Mode } from '../src/core/ir/vocab';
import { serialize } from '../src/core/serialize';
import { DIALOGUE_PLACEHOLDER } from '../src/core/serialize/shared';
import { contextFor, normalize } from '../src/core/normalize';
import { buildPlannerSystemPrompt } from '../src/provider/prompts/planner';
import { buildPatchSystemPrompt } from '../src/provider/prompts/patch';
import type { CompileInput } from '../src/core/ir/types';
import type { CreativeModeRecord } from '../src/core/creative';
import * as creative from '../src/core/creative';
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

/** The pinned guide text, by source id, read once. */
const GUIDE_TEXT: Record<string, string> = Object.fromEntries(
  contract.sources.map((s) => [s.id, readFileSync(join(GUIDE_DIR, s.file), 'utf8')]),
);

/**
 * Everything a `binds: {export}` descriptor may name.
 *
 * `DIALOGUE_PLACEHOLDER` lives in the serializer rather than the vocabulary, which is
 * why the staleness check below reads two files. Adding a module here is the whole cost
 * of letting the spec bind to it.
 */
const EXPORTS: Record<string, unknown> = { ...vocab, DIALOGUE_PLACEHOLDER };

type Node = Record<string, unknown>;

/**
 * The keys that make a claim. A leaf carries at least one; a group only holds leaves.
 *
 * `open`, `close`, `appliesTo` and `exemptions` were added after a mutation sweep found
 * them unreadable by any test: `tags.dialogue.open` could have said `<dlg>` and
 * `refDetailWords.appliesTo` could have said "everything" with the suite green. The
 * scope keys are the guide-number rule's own subject, so leaving them off this list is
 * the specific mistake that rule exists to prevent.
 */
const CLAIM_KEYS = [
  'values',
  'value',
  'range',
  'form',
  'phrases',
  'quoting',
  'compoundForm',
  'open',
  'close',
  'appliesTo',
  'exemptions',
] as const;

const isLeaf = (node: Node) => CLAIM_KEYS.some((k) => k in node);

/** Every claim-bearing entry under `node`, with the dotted path that reaches it. */
function leaves(node: unknown, path: string, out: [string, Node][] = []): [string, Node][] {
  if (typeof node !== 'object' || node === null) {
    out.push([path, {} as Node]);
    return out;
  }
  const record = node as Node;
  if (isLeaf(record)) {
    out.push([path, record]);
    return out;
  }
  for (const [key, sub] of Object.entries(record)) {
    if (['note', 'house', 'guide', 'binds'].includes(key)) continue;
    leaves(sub, path === '' ? key : `${path}.${key}`, out);
  }
  return out;
}

/** The placeholders a spec template may use, and what each one matches. */
const PLACEHOLDERS: Record<string, string> = {
  '{N}': '\\d+',
  '{MM:SS.mmm}': '\\d\\d:\\d\\d\\.\\d\\d\\d',
};

/**
 * Turn a template the spec states -- `[Shot {N}] At {MM:SS.mmm},` -- into the pattern
 * the serializer has to match, so the spec string is what the assertion reads.
 *
 * An unknown placeholder throws rather than being escaped into a literal that could
 * never match: a silent non-match would look like the serializer being wrong.
 */
function templatePattern(template: string): RegExp {
  const unknown = [...template.matchAll(/\{[^}]*\}/g)]
    .map((m) => m[0])
    .filter((p) => !(p in PLACEHOLDERS));
  expect(unknown, `${template} uses a placeholder this helper cannot render`).toEqual([]);

  const body = template
    .split(/(\{N\}|\{MM:SS\.mmm\})/)
    .map((part) => PLACEHOLDERS[part] ?? part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('');
  return new RegExp(body);
}

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
// Guide citations
// ---------------------------------------------------------------------------

/**
 * Every `guide` key in the spec is a claim that a section exists, and until now not one
 * of them was read. `output.*.guide`, `vocabulary.*.guide`, `blocks[].guide` and
 * `sections[].guide` could all cite a section the guide does not have -- which is what a
 * renumbering upstream would produce, silently, across the whole document at once.
 *
 * The citation grammar is small and closed:
 *
 *   cite := part (", " part)*
 *   part := [guide] N[.M]        "base 4.7", "ref 5.2", "base 4.6, 4.7"
 *         | guide N " case " K   "base 5 case 3"
 *
 * The guide name is sticky across commas, so `base 4.6, 4.7` is two base citations,
 * while `base 3, ref 5` names one section in each file.
 */
type Citation = { guide: string; heading: RegExp; text: string };

function parseCitation(cite: string): Citation[] {
  let guide = '';
  return cite.split(',').map((raw) => {
    const part = raw.trim();
    const m = /^(?:(base|ref)\s+)?(\d+(?:\.\d+)?)(?:\s+case\s+(\d+))?$/.exec(part);
    if (!m) throw new Error(`unparseable citation part: "${part}" in "${cite}"`);
    guide = m[1] ?? guide;
    if (!guide) throw new Error(`citation names no guide: "${cite}"`);
    const heading = m[3]
      ? new RegExp(`^### Case ${m[3]}:`, 'm')
      : m[2].includes('.')
        ? new RegExp(`^### ${m[2].replace('.', '\\.')} `, 'm')
        : new RegExp(`^## ${m[2]}\\. `, 'm');
    return { guide, heading, text: m[3] ? `${m[2]} case ${m[3]}` : m[2] };
  });
}

/** Every citation in the document, with the path that carries it. */
function citations(node: unknown, path = '', out: [string, string][] = []): [string, string][] {
  if (typeof node !== 'object' || node === null) return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => citations(v, `${path}[${i}]`, out));
    return out;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const at = path ? `${path}.${key}` : key;
    if (typeof value === 'string' && /guide$/i.test(key)) out.push([at, value]);
    else citations(value, at, out);
  }
  return out;
}

describe('every guide citation resolves to a section that exists', () => {
  const text: Record<string, string> = {};
  for (const source of contract.sources) {
    text[source.id] = readFileSync(join(GUIDE_DIR, source.file), 'utf8');
  }

  const found = citations(contract);

  it('finds citations to check, across more than one part of the spec', () => {
    // Guards the walker, not the guides: a walker that matched nothing would leave
    // every assertion below vacuously green.
    expect(found.length).toBeGreaterThan(40);
    const roots = new Set(found.map(([path]) => path.split(/[.[]/)[0]));
    expect([...roots].sort()).toEqual(['output', 'prompts', 'shotHeader', 'vocabulary']);
  });

  for (const [path, cite] of found) {
    it(`${path}: ${cite}`, () => {
      for (const part of parseCitation(cite)) {
        expect(text[part.guide], `${cite} names guide "${part.guide}"`).toBeDefined();
        expect(
          part.heading.test(text[part.guide]),
          `${path} cites ${part.guide} ${part.text}, which has no such heading`,
        ).toBe(true);
      }
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

      /**
       * The gap is compared exactly, not with `endsWith`.
       *
       * `endsWith` accepts any suffix of the truth, so a spec that under-declared the
       * separator passed: with the real gap `\n\n`, declaring `\n` went green on all
       * five modes, while `\n\n\n` and `XX` went red. That is the one direction drift
       * actually takes -- someone reads `\n` in the spec and writes a serializer change
       * to match it.
       */
      it('separates sections the way it says', () => {
        for (let i = 1; i < spec.sections.length; i++) {
          const previous = spec.sections[i - 1].label;
          const label = spec.sections[i].label;
          const between = text.slice(text.indexOf(`${previous}:`), text.indexOf(`${label}:`));
          const gap = between.slice(between.trimEnd().length);
          expect(gap, `${mode}: the gap before ${label}`).toBe(spec.sectionSeparator);
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

  /**
   * `later` is derived from the spec, not hardcoded.
   *
   * The pattern used to be written out as a literal regex here, so the spec's
   * `[Shot {N}] At {MM:SS.mmm},` was read by nothing and could have said anything.
   * `first` is left as it is: two equalities against the same literal do bind it.
   */
  /**
   * The task-type prefix, built from the spec rather than compared to a literal.
   *
   * `open`, `close` and `join` were declared and read by nothing: the serializer builds
   * `[a + b]` from three hardcoded strings at serialize/ref2va.ts, and the spec could
   * have said anything about any of them. Assembling the expected prefix binds all three
   * at once, so a mutation to any single one goes red.
   */
  it('builds the Ref2VA summary prefix the way it says', () => {
    const spec = contract.output.Ref2VA.summaryPrefix;
    const types = FIXTURES.Ref2VA.taskTypes ?? [];
    expect(types.length, 'the Ref2VA fixture carries no task types to prefix').toBeGreaterThan(0);
    expect(rendered('Ref2VA')).toContain(`${spec.open}${types.join(spec.join)}${spec.close}`);
  });

  it('states the shot header the serializer writes', () => {
    expect(contract.shotHeader.first).toBe('[Shot 1]');
    expect(rendered('T2VA')).toContain('[Shot 1]');
    expect(rendered('T2VA')).toMatch(templatePattern(contract.shotHeader.later));
  });
});

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Every vocabulary claim is compared to the thing it describes.
 *
 * This replaces sixteen hand-written `it()` lines, and the reason is not tidiness: a
 * claim was checked only if someone remembered to write a line for it, so nine leaves
 * that named a real exported constant in `source` -- SLOT_ROLES, AUDIO_ROLES,
 * CONTINUITY_PHRASES, DIALOGUE_TERMINALS, DIALOGUE_ALLOWED_PUNCTUATION,
 * DIALOGUE_PLACEHOLDER, FRAME_ANCHOR_ROLES, SUBJECT_CONTENT_ROLES and
 * VIDEO_STRUCTURE_ROLES -- were compared to nothing at all, and a mutation sweep of the
 * spec found 33 of 63 fields could be changed with the whole suite green.
 *
 * The spec is still written by hand. `binds` says *where to compare*, never what the
 * value is, so the two statements stay independent -- a spec generated from the code
 * would agree with it by construction and be worth nothing.
 *
 * `render` is the weaker oracle and is used only where it is the honest one: it proves
 * the serializer emits the form, not that it is the only form it can emit. It also has
 * to name its modes, or it degenerates into "this short string appears somewhere",
 * which almost anything passes.
 */
describe('every vocabulary claim is bound to what it describes', () => {
  const claims = leaves(contract.vocabulary, '').flatMap(([path, leaf]) =>
    CLAIM_KEYS.filter((k) => k in leaf).map((key) => ({ path, leaf, key })),
  );

  const binding = (leaf: Node, key: string) =>
    (leaf.binds as Record<string, Record<string, unknown>> | undefined)?.[key];

  it('binds at least as many claims as the hand-written block it replaced', () => {
    // The sixteen `it()` lines performed 22 value comparisons. A resolver that silently
    // skipped a claim key would otherwise look exactly like a passing refactor.
    const compared = claims.filter(({ leaf, key }) => 'export' in (binding(leaf, key) ?? {}));
    expect(compared.length).toBeGreaterThanOrEqual(22);
    expect(claims.length).toBeGreaterThan(30);
  });

  /**
   * The exemptions are pinned, because `unbound` is the escape hatch.
   *
   * An allowlist that grants is safe to pin: the dangerous direction is growth, and
   * pinning is what makes a new exemption a decision someone writes down rather than a
   * quiet way to make this whole describe stop asking.
   */
  it('exempts exactly these claims and no others', () => {
    const exempt = claims
      .filter(({ leaf, key }) => 'unbound' in (binding(leaf, key) ?? {}))
      .map(({ path, key }) => `${path}.${key}`);
    expect(exempt.sort()).toEqual([
      'budgets.refDetailWords.appliesTo',
      'budgets.refDetailWords.exemptions',
      'onScreenText.quoting',
      'tags.dialogue.form',
    ]);
  });

  it('gives every claim exactly one binding of a kind this file resolves', () => {
    const kinds = ['export', 'render', 'quotedIn', 'unbound'];
    const bad = claims
      .map(({ path, leaf, key }) => {
        const b = binding(leaf, key);
        if (!b) return `${path}.${key}: no binding`;
        const named = Object.keys(b).filter((k) => kinds.includes(k));
        if (named.length !== 1) return `${path}.${key}: ${named.length} known kinds`;
        return null;
      })
      .filter(Boolean);
    expect(bad).toEqual([]);
  });

  for (const { path, leaf, key } of claims) {
    const b = binding(leaf, key) ?? {};
    const value = leaf[key];

    if ('export' in b) {
      it(`${path}.${key} equals ${String(b.export)}`, () => {
        expect(Object.hasOwn(EXPORTS, b.export as string), `${String(b.export)} is exported`).toBe(
          true,
        );
        const expected = EXPORTS[b.export as string];
        expect(value).toEqual(Array.isArray(expected) ? [...expected] : expected);
      });
    } else if ('render' in b) {
      const modes = b.render as (keyof typeof FIXTURES)[];
      it(`${path}.${key} is rendered in ${modes.join(', ')}`, () => {
        expect(modes.length, 'a render binding names no mode').toBeGreaterThan(0);
        for (const mode of modes) expect(rendered(mode)).toContain(String(value));
      });
    } else if ('quotedIn' in b) {
      it(`${path}.${key} is quoted verbatim in the ${String(b.quotedIn)} guide`, () => {
        expect(GUIDE_TEXT[b.quotedIn as string], `no such guide: ${String(b.quotedIn)}`).toBeDefined();
        expect(GUIDE_TEXT[b.quotedIn as string]).toContain(String(value));
      });
    } else {
      it(`${path}.${key} says why it is unbound`, () => {
        expect(String(b.unbound).length, 'an unbound reason has to be a reason').toBeGreaterThan(30);
      });
    }
  }
});

describe('vocabulary attribution', () => {
  const v = contract.vocabulary;

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

/**
 * Every claim in the vocabulary block says where it came from.
 *
 * An outside audit found `mediaKinds` and `slotCeilings` sitting unmarked among
 * guide-cited entries, which is how a platform limit and a house partition came
 * to read as contract. The fix was to mark them; this is the check that makes
 * the class impossible to reintroduce quietly, because the whole point of the
 * spec is that an auditor can tell contract from house style at a glance.
 *
 * A leaf is an entry that makes a claim -- it carries values, a value, a range
 * or a form. A group only holds leaves and cites nothing itself.
 */
describe('every vocabulary claim is attributed', () => {
  it('cites a guide section or declares itself house, with nothing in between', () => {
    const unattributed = leaves(contract.vocabulary, '')
      .filter(([, entry]) => !('guide' in entry) && entry.house !== true)
      .map(([path]) => path);
    expect(unattributed).toEqual([]);
  });

  /**
   * The prompt blocks are where house rules actually get written into the
   * model's instructions, and they were the least attributed part of the spec:
   * one block marked `origin: "house"`, five with nothing at all, and the patch
   * prompt with no attribution on any block. A different key from the
   * vocabulary's, too, so the check could not have been pointed at them.
   */
  it('attributes every prompt block, on both prompts, with the same key', () => {
    for (const side of ['planner', 'patch'] as const) {
      for (const block of contract.prompts[side].blocks) {
        const entry = block as Record<string, unknown>;
        expect('origin' in entry, `${side} ${block.heading} uses the retired key`).toBe(false);
        expect(
          'guide' in entry || entry.house === true,
          `${side} ${block.heading} cites nothing and declares nothing`,
        ).toBe(true);
        if (entry.house === true) {
          expect(typeof entry.note, `${side} ${block.heading}`).toBe('string');
        }
      }
    }
  });

  it('cites a section that looks like one, where it cites at all', () => {
    for (const [path, entry] of leaves(contract.vocabulary, '')) {
      if (!('guide' in entry)) continue;
      expect(String(entry.guide), path).toMatch(/^(base|ref) \d/);
    }
    for (const side of ['planner', 'patch'] as const) {
      for (const block of contract.prompts[side].blocks) {
        const guide = (block as Record<string, unknown>).guide;
        if (guide == null) continue;
        expect(String(guide), `${side} ${block.heading}`).toMatch(/^(base|ref) \d/);
      }
    }
  });

  /** A house entry is not exempt from explaining itself. */
  it('gives every house entry a note saying why it is not contract', () => {
    for (const [path, entry] of leaves(contract.vocabulary, '')) {
      if (entry.house !== true) continue;
      expect(typeof entry.note, path).toBe('string');
      expect(String(entry.note).length, path).toBeGreaterThan(20);
    }
  });
});

/**
 * The reverse direction: a vocabulary the code exports and the spec omits.
 *
 * Every check above compares what the spec declares against the code. Nothing
 * compared the other way, so five role tables, the continuity phrasings, the
 * two dialogue punctuation sets and the house `<d/>` token were absent from the
 * spec entirely and invisible -- an omission is not a disagreement. `SLOT_ROLES`
 * is the one that mattered: 19 values deciding which label kind every reference
 * asset gets and whether it earns a definition line.
 *
 * Each vocabulary leaf names the constant it describes, and this asserts the two
 * sets are equal. Constants that belong to another part of the spec are listed
 * here by name rather than left to a substring match, so adding one is a
 * decision someone writes down.
 */
describe('the spec covers every vocabulary the code exports', () => {
  /** Declared elsewhere in the spec, or not vocabulary at all. */
  const ELSEWHERE: Record<string, string> = {
    ALIGNMENT_TEMPLATES: 'output[].alignment, one per mode',
    BASE_SECTIONS: 'output[].sections for the base contract',
    REF_SECTIONS: 'output[].sections for Ref2VA',
    FPS: 'a workflow constant, not part of the output format',
    FRAME_BLOCK: 'the frame grid, in notInTheGuides',
    FRAME_OFFSET: 'the frame grid, in notInTheGuides',
  };

  /**
   * Only the vocabulary subtree. `prompts.*.blocks[].source` is a different
   * field with a different meaning -- `core`, `mode-block`, `computed` -- and
   * walking the whole document swept those in as constant names.
   */
  function declaredSources(node: unknown, out: Set<string> = new Set()): Set<string> {
    if (typeof node !== 'object' || node === null) return out;
    const record = node as Record<string, unknown>;
    for (const descriptor of Object.values(record.binds ?? {})) {
      const named = (descriptor as Record<string, unknown>)?.export;
      if (typeof named === 'string') out.add(named);
    }
    for (const sub of Object.values(record)) declaredSources(sub, out);
    return out;
  }

  it('names every exported vocabulary constant, or says where it lives instead', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/core/ir/vocab.ts'), 'utf8');
    const exported = [...source.matchAll(/^export const ([A-Z][A-Z0-9_]*)\b/gm)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(20);

    const declared = declaredSources(contract.vocabulary);
    const missing = exported.filter((name) => !declared.has(name) && !(name in ELSEWHERE));
    expect(missing).toEqual([]);
  });

  it('does not name a constant the code no longer exports', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/core/ir/vocab.ts'), 'utf8');
    const shared = readFileSync(join(import.meta.dirname, '../src/core/serialize/shared.ts'), 'utf8');
    const known = new Set([
      ...[...source.matchAll(/^export const ([A-Z][A-Z0-9_]*)\b/gm)].map((m) => m[1]),
      ...[...shared.matchAll(/^export const ([A-Z][A-Z0-9_]*)\b/gm)].map((m) => m[1]),
    ]);
    const stale = [...declaredSources(contract.vocabulary)].filter((name) => !known.has(name));
    expect(stale).toEqual([]);
  });

  it('lists nothing under ELSEWHERE that the code stopped exporting', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/core/ir/vocab.ts'), 'utf8');
    const exported = new Set([...source.matchAll(/^export const ([A-Z][A-Z0-9_]*)\b/gm)].map((m) => m[1]));
    const gone = Object.keys(ELSEWHERE).filter((name) => !exported.has(name));
    expect(gone).toEqual([]);
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

  /**
   * What each block actually says, not just that its heading is present.
   *
   * The spec described blocks by heading, source, conditional, guide and note, and
   * nothing about their content -- so an instruction inside `# Audio` was semantically
   * inverted with all 734 tests green. That is the same blind spot the shape trailer
   * has, and it is invisible by construction: no amount of work on a spec that declares
   * only headings can notice a block whose subject was deleted.
   *
   * Anchors are structural on purpose: a field name in backticks, a tag literal, a
   * rendered shape, a phrase bound elsewhere in the vocabulary. The question asked of a
   * candidate anchor is not "can I make this fail" but "what legitimate improvement to
   * this block would this wrongly reject" -- so no anchor here is a sentence. A block
   * with no reachable structural anchor declares why in `noAnchor` rather than getting a
   * wording assertion by default.
   */
  describe('blocks say what the spec says they say', () => {
    const sides = {
      planner: { text: planner, blocks: contract.prompts.planner.blocks },
      patch: { text: buildPatchSystemPrompt(EVERYTHING), blocks: contract.prompts.patch.blocks },
    };

    /** The text from this heading up to whichever declared heading comes next. */
    const slice = (text: string, headings: string[], i: number) => {
      const start = text.indexOf(headings[i]);
      const after = headings
        .slice(i + 1)
        .map((h) => text.indexOf(h))
        .filter((p) => p > start);
      return text.slice(start, after.length ? Math.min(...after) : text.length);
    };

    for (const [side, { text, blocks }] of Object.entries(sides)) {
      const headings = blocks.map((b) => b.heading);

      for (const [i, block] of blocks.entries()) {
        if (block.asserts.length === 0) {
          it(`${side} ${block.heading} says why it carries no anchor`, () => {
            expect(String(block.noAnchor ?? '').length, `${block.heading}`).toBeGreaterThan(30);
          });
          continue;
        }
        it(`${side} ${block.heading}`, () => {
          const body = slice(text, headings, i);
          expect(body.length, `${block.heading} sliced to nothing`).toBeGreaterThan(block.heading.length);
          for (const anchor of block.asserts) {
            expect(body, `${block.heading} no longer contains ${anchor}`).toContain(anchor);
          }
        });
      }
    }

    it('anchors most blocks, and each anchor lands in exactly one of them', () => {
      const anchored = Object.values(sides)
        .flatMap(({ blocks }) => (blocks as { asserts: string[] }[]))
        .filter((b) => b.asserts.length > 0);
      expect(anchored.length).toBeGreaterThanOrEqual(11);
      // An anchor that appears in a neighbouring block too would pass while pointing at
      // the wrong text, which is the proxy-used-silently failure in a new place. It also
      // guards the slicer: a slice that returned the whole prompt would match everywhere.
      for (const { text, blocks } of Object.values(sides)) {
        const headings = blocks.map((b) => b.heading);
        for (const block of blocks) {
          for (const anchor of block.asserts) {
            const hits = blocks.filter((_, j) => slice(text, headings, j).includes(anchor));
            expect(hits.length, `${anchor} appears in ${hits.length} blocks`).toBe(1);
          }
        }
      }
    });
  });

  /**
   * `source` says how a block gets into the prompt, and it was read by nothing -- a
   * block could have claimed `derived:somethingGone` with the suite green. The three
   * static kinds are pinned; a `derived:` block has to name a function the creative
   * module really exports, which is the half that can rot.
   */
  it('names a source kind it can resolve, and derived blocks name a real function', () => {
    const STATIC = ['core', 'mode-block', 'computed'];
    let derived = 0;
    for (const side of ['planner', 'patch'] as const) {
      for (const block of contract.prompts[side].blocks) {
        const source = block.source;
        if (source.startsWith('derived:')) {
          const name = source.slice('derived:'.length);
          expect(typeof (creative as Record<string, unknown>)[name], `${source}`).toBe('function');
          derived++;
        } else {
          expect(STATIC, `${side} ${block.heading} source`).toContain(source);
        }
      }
    }
    // Not vacuous: the derived branch was actually taken.
    expect(derived).toBeGreaterThan(0);
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
// non_diegetic_music
// ---------------------------------------------------------------------------

/**
 * base 4.7 makes `N/A` conditional: "Use N/A when there is no non-diegetic
 * music". This repo carried a house lean the other way -- default to N/A unless
 * music was asked for -- declared as `music-default` in notInTheGuides. It was
 * reverted, and these assertions now guard the revert rather than the lean.
 *
 * Why it was reverted, since the note matters more than the assertions: 4.7
 * states a test applied to the scene in front of you, so a default answers that
 * question unconditionally and every clip emitted then asserts it is unscored
 * whether or not anything evaluated it. Both directions assert something --
 * writing a score claims a score, writing N/A claims silence -- which is why
 * neither is a safe default and the guide declines to have one.
 *
 * The patch assertion is the load-bearing one. That prompt said nothing about
 * music at all, so its green comes from text that had to be written; the planner
 * already names the field and would half-pass on wording alone. The patch rule
 * survived the revert unchanged and deliberately: it is edit conservatism over a
 * field whose legitimate value looks like an empty one, not a restored default.
 */
describe('the music condition reaches both prompts', () => {
  const planner = buildPlannerSystemPrompt(normalize(input), input);
  const patch = buildPatchSystemPrompt();

  it('states the sentence range from vocab rather than a second copy', () => {
    const [lo, hi] = vocab.MUSIC_SENTENCE_RANGE;
    expect(planner).toContain(`${lo}-${hi} sentences`);
  });

  it('tells the patch prompt that an N/A is deliberate', () => {
    expect(patch).toMatch(/music/);
    expect(patch).toContain('"N/A"');
  });

  it('no longer declares a music lean as house, because there is none', () => {
    const ids = contract.notInTheGuides.items.map((i) => i.id);
    expect(ids, 'the lean was reverted; re-adding it here means re-adding the default').not.toContain(
      'music-default',
    );
    // Structural, deliberately. Whether the note records the withdrawal is a
    // documentation call -- and a good one, since a reader who remembers the
    // lean needs to see it was withdrawn rather than quietly reworded -- but it
    // is not a contract to police by regex. An earlier version of this asserted
    // the note matched /reverted/, which is a wording proxy on prose wearing no
    // label: improving that note's English would have gone red for nothing.
    const audio = contract.prompts.planner.blocks.find((b) => b.heading === '# Audio');
    expect(audio?.guide, '# Audio is wholly 4.6 and 4.7 and claims no house deviation').toBe(
      'base 4.6, 4.7',
    );
  });

  // Wording proxy, and marked as one: "decide per scene" and "default to N/A"
  // render no differently -- there is no shape, field name or tag that tells
  // them apart -- so this reads the words. A failure here is a fact about this
  // assertion unless the condition itself was removed. Anchored on "only when",
  // which is the shape base 4.7 states and which the soundscape rule two lines
  // above already uses, so a legitimate rewording that keeps the condition
  // keeps this green.
  it('states the condition rather than a default in the planner (wording proxy)', () => {
    expect(planner).toMatch(/use "N\/A" only when/i);
  });

  // Denylist, and it cannot be complete -- it names the phrasings the reverted
  // lean actually used, not every phrasing a future lean could use. It is here
  // because this is the one direction of change that has already happened once,
  // and a named regression is worth more than nothing even when the set is open.
  it('carries no population claim about how often scenes are scored', () => {
    expect(planner).not.toMatch(/Write "N\/A" unless/);
    expect(planner, 'a claim about most scenes is the sentence that inverts 4.7').not.toMatch(
      /Most scenes do not have one/,
    );
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

  /**
   * Every item names the files it lives in, and every one of them is checked.
   *
   * This used to read a single prose `where` and skip anything that did not begin
   * `src/` -- so `recognisable-people` ("planner and patch prompts") and, when it was
   * added, `music-default` were checked by nothing, while looking exactly like the
   * nine entries that were. A list of paths has no prose form to fall through.
   */
  it('names source paths that exist for everything outside the guides', () => {
    let checked = 0;
    for (const item of contract.notInTheGuides.items) {
      expect(item.paths.length, `${item.id} names no path`).toBeGreaterThan(0);
      for (const path of item.paths) {
        expect(existsSync(join(import.meta.dirname, '..', path)), `${item.id} names ${path}`).toBe(
          true,
        );
        checked++;
      }
    }
    // Not vacuous: every item contributed at least one path.
    expect(checked).toBeGreaterThanOrEqual(contract.notInTheGuides.items.length);
  });
});
