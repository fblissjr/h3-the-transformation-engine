/**
 * Does the spec cover what the guides state?
 *
 * The one direction nothing else checks. `test/contract.test.ts` binds the spec
 * to the code both ways, spec citations are checked to name headings that
 * exist, and the guides' worked examples are byte-compared to the golden
 * fixtures. None of that can notice a rule the guides state and the spec never
 * mentions, because spec and code agree with each other and agreement is the
 * whole of what is tested. Two such rules were found by hand (ref 3's mandated
 * video-editing summary opener, ref 6's audio-layer placement rule); both sat
 * inside sections the spec already cites, so no citation-level or heading-level
 * check would ever have reached them.
 *
 * WHAT THIS IS. A ledger, not a judge. It enumerates every prose sentence in
 * both guides, pins that enumeration, and requires each sentence to carry a
 * disposition. It decides nothing about whether a sentence is covered -- a
 * person does that -- but it does mechanically verify the *claims*:
 *
 *   covered    must name a dotted path into contract.json, and that path is
 *              resolved. A coverage claim that does not resolve is an error,
 *              so "covered" cannot be a bare assertion.
 *   declined   must carry a reason. Unverifiable by machine, auditable by a
 *              reader, on the `noAnchor` precedent -- a bare list of declined
 *              ids is the "checked by nothing" ledger row that goes stale.
 *   unverified the loud default, and the backlog.
 *
 * WHY EVERY PROSE SENTENCE AND NOT THE NORMATIVE ONES. Because "normative" is a
 * property of the regex rather than of the guides, and that was measured rather
 * than assumed: two independent extractors written for this task disagreed by
 * 27 sentences over the same two files, one under-matching (base 4.5's
 * on-screen-text rule contains no must/should/only) and one over-matching. A
 * filter nobody can reproduce cannot define a backlog. So everything prose gets
 * an entry, and `normative` is recorded only to order the work.
 *
 * WHY THE SENTENCES ARE PINNED AND NOT JUST COUNTED. Same measurement: the
 * sentence set depends on the extractor, so a regenerated count is not
 * comparable to an old one. The pin stores the sentence texts themselves, keyed
 * by a hash of the normalised text, so an edited guide shows up as ids that
 * appeared and ids that vanished rather than as a number that moved.
 *
 * THE DIRECTION CAVEAT, which is the thing that bit the last candidate rule
 * this repo considered: an example can refute a rule and cannot establish one.
 * This enumerates STATED sentences. Fenced blocks are stripped, so worked
 * examples never enter it, and anything a sweep turns up inside an example
 * section is not a finding.
 *
 * Run:
 *   bun run scripts/guide-coverage.ts            # report
 *   bun run scripts/guide-coverage.ts --init     # write the pin, all unverified
 *   bun run scripts/guide-coverage.ts --todo 20  # next 20 to disposition
 *
 * Exits nonzero on INCONSISTENCY -- a guide hash that moved, a sentence with no
 * entry, an entry for a sentence that no longer exists, a `covered` path that
 * does not resolve, a `declined` with no reason. It exits ZERO on unverified
 * entries, because those are a backlog rather than a fault, and a check that is
 * permanently red is one people stop reading.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const GUIDE_DIR = join(ROOT, 'reference/h3');
const PIN_PATH = join(GUIDE_DIR, 'guide-coverage.json');

const contract = JSON.parse(readFileSync(join(GUIDE_DIR, 'contract.json'), 'utf8'));

/**
 * The extractor is part of the pin, so changing anything below changes the
 * sentence set and must be a deliberate act with a re-init behind it.
 */
const EXTRACTOR_VERSION = 1;

/** Ordering hint only. Never a filter -- see the header. */
const NORMATIVE =
  /\b(must|should|do not|never|always|only|use|uses|write|place|preserve|avoid|begin|begins|state|states|give|add|keep|prefer|choose|required|do)\b/i;

interface Sentence {
  id: string;
  guide: string;
  line: number;
  section: string;
  text: string;
  normative: boolean;
}

type Disposition = 'unverified' | 'covered' | 'declined';

interface Entry {
  id: string;
  guide: string;
  section: string;
  text: string;
  normative: boolean;
  disposition: Disposition;
  /**
   * Required when covered: one or more dotted paths into contract.json, each of
   * which must resolve.
   *
   * A list rather than a single path because a guide sentence often states two
   * things the spec accounts for in different places -- "preserve the original
   * language inside `<d>` and for visible text" is the dialogue tag and the
   * on-screen-text rule. Forcing one path would mean either dropping half the
   * claim or leaving the sentence unverified, and both lose information the
   * reader wants.
   */
  coveredBy?: string | string[];
  /** Required when declined. */
  reason?: string;
}

interface Pin {
  about: string;
  extractorVersion: number;
  guides: { id: string; file: string; sha256: string }[];
  entries: Entry[];
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
const idOf = (guide: string, text: string) =>
  createHash('sha256').update(`${guide} ${normalise(text)}`).digest('hex').slice(0, 12);

/** Split a line into sentences. Colons do not split: a rule often ends in one. */
function sentencesIn(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);
}

/**
 * Every prose sentence in a guide, with the heading it sits under.
 *
 * Fenced blocks are dropped whole, which is what keeps worked examples out of
 * the enumeration. Table rows are dropped because the guides' tables are
 * vocabulary, already bound value-by-value in `contract.vocabulary`. HTML
 * wrappers around the complete example are dropped as markup.
 */
function extract(guideId: string, file: string): Sentence[] {
  const lines = readFileSync(join(GUIDE_DIR, file), 'utf8').split('\n');
  const out: Sentence[] = [];
  let inFence = false;
  let section = '(preamble)';

  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line) continue;
    if (line.startsWith('#')) {
      section = line;
      continue;
    }
    if (line.startsWith('|') || line.startsWith('<')) continue;

    const text = line.replace(/^>\s?/, '').replace(/^[-*]\s+/, '').trim();
    if (!text) continue;

    for (const s of sentencesIn(text)) {
      out.push({
        id: idOf(guideId, s),
        guide: guideId,
        line: i + 1,
        section,
        text: normalise(s),
        normative: NORMATIVE.test(s),
      });
    }
  }
  return out;
}

function allSentences(): Sentence[] {
  return contract.sources.flatMap((s: { id: string; file: string }) => extract(s.id, s.file));
}

function guideHashes(): { id: string; file: string; sha256: string }[] {
  return contract.sources.map((s: { id: string; file: string }) => ({
    id: s.id,
    file: s.file,
    sha256: createHash('sha256').update(readFileSync(join(GUIDE_DIR, s.file))).digest('hex'),
  }));
}

/** Resolve a dotted path into contract.json. Array indices are written `a.b[0].c`. */
function resolves(path: string): boolean {
  let node: unknown = contract;
  for (const part of path.split('.')) {
    const m = part.match(/^([^[\]]+)((\[\d+\])*)$/);
    if (!m) return false;
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[m[1]];
    if (node === undefined) return false;
    for (const idx of m[2].match(/\d+/g) ?? []) {
      if (!Array.isArray(node)) return false;
      node = node[Number(idx)];
      if (node === undefined) return false;
    }
  }
  return true;
}

function init(): number {
  const sentences = allSentences();
  const existing: Map<string, Entry> = existsSync(PIN_PATH)
    ? new Map((JSON.parse(readFileSync(PIN_PATH, 'utf8')) as Pin).entries.map((e) => [e.id, e]))
    : new Map();

  const pin: Pin = {
    about:
      'Coverage ledger: does reference/h3/contract.json account for what the guides STATE? ' +
      'One entry per prose sentence; fenced blocks are excluded, so worked examples are not in here ' +
      'and an example can never be read as a rule. `covered` must name a contract.json path that ' +
      'resolves; `declined` must carry a reason; `unverified` is the backlog. ' +
      'Regenerate with scripts/guide-coverage.ts --init after a guide revision.',
    extractorVersion: EXTRACTOR_VERSION,
    guides: guideHashes(),
    entries: sentences.map((s) => {
      const prior = existing.get(s.id);
      return {
        id: s.id,
        guide: s.guide,
        section: s.section,
        text: s.text,
        normative: s.normative,
        disposition: prior?.disposition ?? 'unverified',
        ...(prior?.coveredBy ? { coveredBy: prior.coveredBy } : {}),
        ...(prior?.reason ? { reason: prior.reason } : {}),
      };
    }),
  };

  writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`);
  const carried = pin.entries.filter((e) => e.disposition !== 'unverified').length;
  console.log(`wrote ${pin.entries.length} entries to reference/h3/guide-coverage.json`);
  console.log(`carried ${carried} existing disposition(s) forward by id`);
  return 0;
}

function report(todo: number | null): number {
  if (!existsSync(PIN_PATH)) {
    console.error('no pin yet -- run with --init');
    return 2;
  }
  const pin: Pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'));
  const sentences = allSentences();
  const problems: string[] = [];

  if (pin.extractorVersion !== EXTRACTOR_VERSION) {
    problems.push(
      `extractor is v${EXTRACTOR_VERSION} and the pin was built with v${pin.extractorVersion}; re-init deliberately`,
    );
  }
  /**
   * Three hashes, three different claims, and they are deliberately not one.
   *
   *   the file on disk        what the guides say now
   *   this pin               the text the dispositions below were made against
   *   contract.sources       the text the spec was written against
   *
   * A reviewer suggested deriving this pin from `contract.sources` so there is
   * only one source and they cannot disagree. That is the right instinct about
   * duplicated values and the wrong call here: the two record different facts
   * that happen to share a value today, and collapsing them destroys the one
   * signal worth having. Updating a guide is a deliberate act (replace the
   * file, update `contract.sources`), and re-dispositioning the ledger is a
   * second deliberate act. If the pin were derived, doing the first without the
   * second would leave a ledger silently agreeing with a spec it had never been
   * re-read against.
   *
   * So both stay, and the disagreement is reported instead of prevented. The
   * third comparison below is the one neither file catches alone: re-init the
   * ledger without updating `contract.sources` and the ledger matches the live
   * file while the spec does not, which every check here passed before it.
   */
  const sources: { id: string; sha256: string }[] = contract.sources;
  for (const live of guideHashes()) {
    const pinned = pin.guides.find((g) => g.id === live.id);
    const spec = sources.find((s) => s.id === live.id);
    if (!pinned) problems.push(`guide "${live.id}" is not in the pin`);
    else if (pinned.sha256 !== live.sha256) {
      problems.push(`guide "${live.id}" has changed since the pin -- every disposition below is against the old text`);
    }
    if (pinned && spec && pinned.sha256 !== spec.sha256) {
      problems.push(
        `guide "${live.id}": the ledger was dispositioned against ${pinned.sha256.slice(0, 12)} but ` +
          `contract.sources pins ${spec.sha256.slice(0, 12)} -- the spec and the ledger were updated against different text`,
      );
    }
  }

  const byId = new Map(pin.entries.map((e) => [e.id, e]));
  const liveIds = new Set(sentences.map((s) => s.id));
  for (const s of sentences) if (!byId.has(s.id)) problems.push(`no entry for ${s.guide} sentence ${s.id}: ${s.text.slice(0, 70)}`);
  for (const e of pin.entries) if (!liveIds.has(e.id)) problems.push(`entry ${e.id} matches no current sentence: ${e.text.slice(0, 70)}`);

  for (const e of pin.entries) {
    if (e.disposition === 'covered') {
      const paths = e.coveredBy === undefined ? [] : [e.coveredBy].flat();
      if (paths.length === 0) problems.push(`${e.id} is covered but names no path`);
      for (const path of paths) {
        if (!resolves(path)) problems.push(`${e.id} claims coverage at "${path}", which does not resolve`);
      }
    }
    if (e.disposition === 'declined' && !(e.reason ?? '').trim()) {
      problems.push(`${e.id} is declined with no reason`);
    }
  }

  const counts = { unverified: 0, covered: 0, declined: 0 } as Record<Disposition, number>;
  for (const e of pin.entries) counts[e.disposition] += 1;
  const openNormative = pin.entries.filter((e) => e.disposition === 'unverified' && e.normative);

  console.log('='.repeat(74));
  console.log(`guide coverage: ${pin.entries.length} stated sentences across both guides`);
  console.log('='.repeat(74));
  console.log(`  covered    ${String(counts.covered).padStart(4)}  (path checked)`);
  console.log(`  declined   ${String(counts.declined).padStart(4)}  (reason given)`);
  console.log(`  unverified ${String(counts.unverified).padStart(4)}  <- the backlog, ${openNormative.length} of them normative-looking`);

  if (todo !== null) {
    console.log();
    console.log(`next ${Math.min(todo, openNormative.length)} normative-looking sentences to disposition:`);
    for (const e of openNormative.slice(0, todo)) {
      console.log(`\n  ${e.id}  [${e.guide}] ${e.section}`);
      console.log(`    ${e.text}`);
    }
  }

  if (problems.length) {
    console.log();
    console.log('INCONSISTENCIES (these are errors, unlike the backlog):');
    for (const p of problems) console.log(`  ${p}`);
    return 1;
  }
  console.log();
  console.log('no inconsistencies. Unverified entries are a backlog, not a failure.');
  return 0;
}

const argv = process.argv.slice(2);
if (argv.includes('--init')) process.exit(init());
const t = argv.indexOf('--todo');
process.exit(report(t >= 0 ? Number(argv[t + 1] ?? 10) : null));
