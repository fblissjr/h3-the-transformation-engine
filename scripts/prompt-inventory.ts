/**
 * What is actually inside every prompt this app sends, and what claims it.
 *
 * A thin CLI. The decomposition is `src/provider/prompts/inventory.ts`, which is
 * pure and has no fs or contract.json in it, so the same rendering-and-splitting
 * can be reused by a prompt-editing screen later. Everything here is the parts
 * that cannot be: reading the spec off disk, calling the builders, printing.
 *
 * WHICH ARTIFACT THIS REPORTS ON. Two strings exist per model call and they are
 * not the same string. `buildPlannerSystemPrompt` returns one; the client then
 * appends the serialized JSON Schema through `withShapeTrailer` when enforcement
 * is off, and `ENFORCE_SCHEMA_DEFAULT` is false, so the trailer is on the
 * default path for both system prompts. `test/contract.test.ts` indexes into the
 * builder output and is structurally blind to the trailer. This reports the
 * builder output per prompt and carries the trailer as its own entry, so both
 * are visible and neither is silently folded into the other.
 *
 * SOURCE VERSUS RENDERED. Every prompt here is rendered by calling its builder,
 * because the builders hold `${SOUNDSCAPE_SENTENCE_RANGE[0]}-...` and the digits
 * only exist after interpolation. The one exception is the video analysis
 * prompt, which is an inline literal in a function that also calls the Files
 * API; it is lifted from source and labelled `source-extracted` rather than
 * quietly skipped, because its unreachability is part of what there is to report.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not re-check that a block contains
 * its anchors -- `test/contract.test.ts` already fails a block that cites
 * nothing and declares nothing, and a second implementation of one check is the
 * drift this repo keeps finding. Anchors are a column, not an assertion. It also
 * does not grep the guides: a pattern built out of a claim can only confirm the
 * claim's own wording, so automating that falsifier would manufacture exactly
 * the hollow green the working notes warn about.
 *
 * Run: bun run scripts/prompt-inventory.ts [--json] [--text <id>]
 *
 * Exits nonzero when anything is unclaimed. Not wired into `bun run test` on
 * purpose: it reports open questions for the owner, not regressions, and a check
 * that goes red on a known open question trains people to ignore it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPlannerSystemPrompt, buildPlannerUserPrompt } from '../src/provider/prompts/planner';
import { buildPatchSystemPrompt, buildPatchUserPrompt } from '../src/provider/prompts/patch';
import { decompose, provenanceLabel, provenanceOf, type DeclaredBlock } from '../src/provider/prompts/inventory';
import { jsonShapeTrailer } from '../src/provider/shape';
import { normalize } from '../src/core/normalize/index';
import { plannerJsonSchema } from '../src/core/ir/schema';
import { PATCHABLE_LEAVES } from '../src/core/ir/paths';
import type { CompileInput } from '../src/core/ir/types';
import type { H3Mode } from '../src/core/ir/vocab';
import type { CreativeModeRecord } from '../src/core/creative';
import { t2vaBaker } from '../test/fixtures/guide-examples';

const ROOT = join(import.meta.dirname, '..');
const contract = JSON.parse(readFileSync(join(ROOT, 'reference/h3/contract.json'), 'utf8'));
const NOT_IN_GUIDES: { id: string; paths: string[] }[] = contract.notInTheGuides.items;

const MODES: H3Mode[] = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'];

/**
 * The same fixture `test/contract.test.ts` uses, and deliberately not a second
 * one. Two ways to build a planner prompt is the one-renderer-per-output-string
 * rule waiting to happen.
 */
const EVERYTHING: CreativeModeRecord = {
  mode: 'directed',
  selection: { visual: 'V06', strength: 'full' },
  glitch: { tokens: ['SolidGoldMagikarp'], register: 'motif' },
};

const inputFor = (mode: H3Mode): CompileInput => ({
  idea: 'A baker opens up before dawn.',
  mode,
  durationFrames: 192,
  slots: [],
});

interface Rendering {
  id: string;
  role: 'system' | 'user' | 'appended' | 'system+user';
  builder: string;
  /** Dotted path into contract.json enumerating this prompt's blocks, if any. */
  spec: string | null;
  specNote?: string;
  text: string;
  artifact: 'rendered' | 'source-extracted';
  variant?: string;
}

/**
 * The video analysis prompt is an inline literal inside `analyzeVideoWithGemini`
 * and is not exported, so it cannot be rendered without calling the Files API.
 */
function videoPromptFromSource(): string {
  const src = readFileSync(join(ROOT, 'src/provider/geminiVideo.ts'), 'utf8');
  const anchor = src.indexOf('export const VIDEO_ANALYSIS_DEFAULT =') >= 0
    ? 'export const VIDEO_ANALYSIS_DEFAULT ='
    : 'const prompt =';
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error('geminiVideo.ts: the prompt literal is not where this expects it');
  const end = src.indexOf(';', src.indexOf('scene prompt conditioning', start));
  if (end < 0) throw new Error('geminiVideo.ts: could not find the end of the prompt literal');
  const text = [...src.slice(start, end).matchAll(/'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"))
    .join('');
  // The two indexOf guards above catch a literal that moved or was renamed. They
  // do not catch one that was re-quoted: switched to a template string, the
  // single-quote matcher finds nothing and this silently joins to empty, which
  // would present as a 0-char prompt rather than as a broken extractor.
  if (text.length < 100) {
    throw new Error(
      `geminiVideo.ts: extracted ${text.length} chars, which is too short to be the prompt. ` +
        'The literal was probably re-quoted; this extractor only reads single-quoted concatenation.',
    );
  }
  return text;
}

function renderings(): Rendering[] {
  const out: Rendering[] = [];

  for (const mode of MODES) {
    const input = inputFor(mode);
    out.push({
      id: 'planner.system',
      role: 'system',
      builder: 'src/provider/prompts/planner.ts:buildPlannerSystemPrompt',
      spec: 'prompts.planner.blocks',
      text: buildPlannerSystemPrompt(normalize(input), { ...input, creativeMode: EVERYTHING }),
      artifact: 'rendered',
      variant: mode,
    });
  }

  out.push({
    id: 'planner.user',
    role: 'user',
    builder: 'src/provider/prompts/planner.ts:buildPlannerUserPrompt',
    spec: null,
    specNote: 'No contract entry. The spec enumerates system-prompt blocks only.',
    text: buildPlannerUserPrompt(inputFor('T2VA')),
    artifact: 'rendered',
  });

  out.push({
    id: 'patch.system',
    role: 'system',
    builder: 'src/provider/prompts/patch.ts:buildPatchSystemPrompt',
    spec: 'prompts.patch.blocks',
    text: buildPatchSystemPrompt(EVERYTHING),
    artifact: 'rendered',
  });

  out.push({
    id: 'patch.user',
    role: 'user',
    builder: 'src/provider/prompts/patch.ts:buildPatchUserPrompt',
    spec: null,
    specNote:
      'No contract entry. Three headings of its own plus the whole serialized document, so its rendered size tracks the document rather than this fixture.',
    text: buildPatchUserPrompt(t2vaBaker, [...PATCHABLE_LEAVES].slice(0, 4), 'Make the light colder.'),
    artifact: 'rendered',
  });

  out.push({
    id: 'shape.trailer',
    role: 'appended',
    builder: 'src/provider/shape.ts:jsonShapeTrailer',
    spec: null,
    specNote:
      'Recorded in notInTheGuides as json-shape-trailer, which states it is not described as blocks anywhere. Appended after the builder returns, so contract.test.ts cannot see it.',
    text: jsonShapeTrailer(plannerJsonSchema() as Record<string, unknown>),
    artifact: 'rendered',
  });

  out.push({
    id: 'video.analysis',
    role: 'system+user',
    builder: 'src/provider/geminiVideo.ts:analyzeVideoWithGemini (inline literal)',
    spec: null,
    specNote:
      'No contract entry of any kind, and no notInTheGuides entry. Gemini-only, outside the InferenceClient seam, so the instrument.ts decorator never wraps it.',
    text: videoPromptFromSource(),
    artifact: 'source-extracted',
  });

  return out;
}

function specBlocks(spec: string | null): DeclaredBlock[] {
  if (!spec) return [];
  return spec.split('.').reduce<any>((node, key) => node?.[key], contract) ?? [];
}

/**
 * How many findings one prompt contributes.
 *
 * One function because the text path and the `--json` path both need it and had
 * drifted apart while they each counted inline: the text path was scoring the
 * out-of-order case and the no-blocks case that `--json` was not, so the two
 * could exit with different codes over the same tree. That is the
 * one-renderer-per-output-string rule applied to a number.
 */
function countFindings(d: ReturnType<typeof decompose>, declared: number): number {
  // A prompt the spec does not describe at all is ONE finding, not one per
  // heading it happens to carry. Its undeclared headings and its unclaimed span
  // are consequences of that single fact, and counting them separately would
  // score the trailer's schema dump above a real drift in the planner.
  if (declared === 0) return 1;
  return d.missing.length + d.undeclared.length + d.unclaimed.length + (d.inDeclaredOrder ? 0 : 1);
}

function main(): number {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const textOf = argv.includes('--text') ? argv[argv.indexOf('--text') + 1] : null;

  const all = renderings();
  const nameOf = (r: Rendering) => (r.variant ? `${r.id}:${r.variant}` : r.id);

  if (textOf) {
    const hit = all.find((r) => nameOf(r) === textOf || r.id === textOf);
    if (!hit) {
      console.error(`no such prompt: ${textOf}`);
      console.error(`known: ${all.map(nameOf).join(', ')}`);
      return 2;
    }
    console.log(hit.text);
    return 0;
  }

  let findings = 0;
  const json: unknown[] = [];

  for (const r of all) {
    const blocks = specBlocks(r.spec);
    const d = decompose(r.text, blocks);
    const builderFile = r.builder.split(':')[0];

    if (wantJson) {
      json.push({
        id: r.id,
        variant: r.variant,
        role: r.role,
        builder: r.builder,
        spec: r.spec,
        specNote: r.specNote,
        artifact: r.artifact,
        chars: r.text.length,
        inDeclaredOrder: d.inDeclaredOrder,
        blocks: d.spans.map((s) => ({
          heading: s.heading,
          chars: s.chars,
          provenance: provenanceLabel(provenanceOf(s.declared, builderFile, NOT_IN_GUIDES)),
          conditional: s.declared.conditional ?? null,
          asserts: s.declared.asserts ?? [],
          noAnchor: Boolean(s.declared.noAnchor),
          quotesOutput: Boolean(s.declared.quotesOutput),
        })),
        unanchored: d.unanchored,
        missing: d.missing,
        undeclared: d.undeclared,
        unclaimed: d.unclaimed,
        findings: countFindings(d, blocks.length),
      });
      findings += countFindings(d, blocks.length);
      continue;
    }

    console.log('='.repeat(78));
    console.log(`${nameOf(r)}  [${r.role}]  ${r.text.length} chars  (${r.artifact})`);
    console.log(`  builder: ${r.builder}`);
    console.log(`  spec:    ${r.spec ?? 'NONE'}`);
    if (r.specNote) console.log(`           ${r.specNote}`);
    console.log('='.repeat(78));

    if (blocks.length === 0) {
      console.log('  NO DECLARED BLOCKS -- every character is unclaimed by the spec.');
      const heads = d.undeclared;
      if (heads.length) {
        console.log('  headings present in the rendered text:');
        for (const h of heads) console.log(`    ${h}`);
      } else {
        console.log('  no headings; the whole string is one undeclared block.');
      }
      findings += countFindings(d, blocks.length);
      console.log();
      continue;
    }

    for (const s of d.spans) {
      const prov = provenanceLabel(provenanceOf(s.declared, builderFile, NOT_IN_GUIDES));
      const anchors = s.declared.asserts?.length
        ? s.declared.asserts.join(' | ')
        : s.declared.noAnchor
          ? 'none (declared why)'
          : 'NONE, AND NO REASON GIVEN';
      const flags = [s.declared.conditional ? 'conditional' : null, s.declared.quotesOutput ? 'quotesOutput' : null]
        .filter(Boolean)
        .join(', ');
      console.log(`  ${s.heading}`);
      console.log(`      ${String(s.chars).padStart(5)} chars   ${prov}${flags ? `   [${flags}]` : ''}`);
      console.log(`      anchors: ${anchors}`);
    }

    if (!d.inDeclaredOrder) {
      console.log();
      console.log('  OUT OF ORDER: the prompt renders these blocks in a different order than declared.');
    }
    if (d.unanchored.length) {
      console.log();
      console.log('  NO STRUCTURAL ANCHOR (asserted by wording or by nothing; each carries one');
      console.log('  generated case in test/contract.test.ts that no file names literally):');
      for (const h of d.unanchored) console.log(`    ${h}`);
    }
    if (d.missing.length) {
      console.log();
      console.log('  DECLARED BUT ABSENT (the spec claims a block the prompt does not have):');
      for (const h of d.missing) console.log(`    ${h}`);
    }
    if (d.undeclared.length) {
      console.log();
      console.log('  PRESENT BUT UNDECLARED (a heading in the prompt that no spec entry claims):');
      for (const h of d.undeclared) console.log(`    ${h}`);
    }
    if (d.unclaimed.length) {
      console.log();
      console.log('  UNCLAIMED TEXT (inside no declared block; contract.test.ts cannot reach it):');
      for (const u of d.unclaimed) {
        console.log(`    chars ${u.start}-${u.end}, ${u.text.length} chars:`);
        for (const line of u.text.split('\n')) console.log(`      | ${line}`);
      }
    }
    findings += countFindings(d, blocks.length);
    console.log();
  }

  if (wantJson) {
    console.log(JSON.stringify(json, null, 2));
    return findings > 0 ? 1 : 0;
  }

  console.log('='.repeat(78));
  console.log(`${findings} finding(s).`);
  console.log('='.repeat(78));
  return findings > 0 ? 1 : 0;
}

process.exit(main());
