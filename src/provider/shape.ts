/**
 * Getting JSON out of a model without constraining how it writes.
 *
 * Provider-agnostic on purpose, and it did not start that way. This lived under
 * `heylook/` while it was the answer to one backend's missing feature: Gemini's
 * `response_format` constrains decoding, heylook has no equivalent on either
 * wire, so the shape was asked for in prose and the reply parsed defensively.
 *
 * Enforcement is now a per-call choice rather than a property of the backend
 * (`CallOptions.enforceSchema`), so *any* client can end up on this path --
 * Gemini with enforcement switched off takes exactly the same trailer and the
 * same extractor. That is what moved it up a directory. Nothing here knows
 * which provider is calling, and nothing should.
 *
 * The reason the choice exists at all: grammar-constrained generation buys
 * shape conformance by distorting the token distribution while the model is
 * writing, which costs output quality -- and this project's first invariant is
 * that beats carry real prose, because H3 conditions on descriptive quality.
 * Shape is the cheap thing to check and quality is the thing that matters, so
 * the trade is a real one to be made per task rather than a deficiency to be
 * patched. This path is the unconstrained side of it.
 *
 * What the weaker shape guarantee costs is paid here: the trailer names the
 * schema rather than describing it, extraction tolerates the things a model
 * actually does to JSON, and anything that survives all of it still goes
 * through `PlannerOutputSchema.safeParse` in the pipeline, which is where a
 * malformed document was always going to be caught.
 *
 * The trailer is appended to the system prompt by the client, not written by
 * the prompt builders. `reference/h3/contract.json` describes the builders'
 * output -- `test/contract.test.ts` indexes into `buildPlannerSystemPrompt`
 * directly -- so a trailer added downstream of them is invisible to that test
 * either way. It is recorded under `notInTheGuides` and asserted in
 * `test/heylook.test.ts` instead, because an edge that no check reaches is the
 * failure mode this repo keeps finding in itself.
 */

/**
 * How many FAILED candidates to tolerate before giving up.
 *
 * Only failures are counted, because only failures are expensive: an unbalanced
 * `{` scans to the end of the string, so prose full of braces is the quadratic
 * case this bounds. A candidate that parses advances the cursor past itself, so
 * any number of real objects costs one linear pass -- and capping those was a
 * bug of its own, since twenty legitimate objects in front of the document made
 * the document unreachable.
 */
const MAX_FAILED_CANDIDATES = 20;

/**
 * The instruction that stands in for constrained decoding.
 *
 * It names the schema by serializing it rather than paraphrasing it. A prose
 * description of a nested shape is a second copy of the schema that drifts from
 * the first; the schema itself cannot drift from itself.
 */
export function jsonShapeTrailer(schema: Record<string, unknown>): string {
  return [
    '# Output format',
    '',
    'Reply with a single JSON object and nothing else. No prose before or after it,',
    'no explanation, no markdown code fences. The object must validate against this',
    'JSON Schema:',
    '',
    JSON.stringify(schema, null, 2),
  ].join('\n');
}

/** The system prompt as it is actually sent, when a shape was asked for. */
export function withShapeTrailer(
  systemInstruction: string,
  schema: Record<string, unknown> | undefined,
): string {
  if (!schema) return systemInstruction;
  return `${systemInstruction}\n\n${jsonShapeTrailer(schema)}`;
}

/**
 * Find the JSON object in a reply that may be carrying other things.
 *
 * Three things happen to JSON from a local model, in rough order of frequency:
 * it arrives wrapped in a ```json fence, it arrives with a sentence in front of
 * it, and it arrives clean. All three end here.
 *
 * Two earlier versions of this were wrong, and both failures are worth keeping
 * written down because the second only appeared under review.
 *
 * FIRST-MATCH was wrong because a preamble can contain a brace: "the schema
 * uses {} for an empty object" in front of a real reply yields `{}`, which is
 * valid JSON, parses cleanly, and then fails `PlannerOutputSchema.safeParse`
 * with a message about a missing field rather than about the wrong object
 * having been picked.
 *
 * LONGEST-MATCH was wrong for a reason particular to this client: the trailer
 * hands the model the serialized planner schema, so echoing it back is a
 * plausible reply shape -- and the schema is far longer than any document
 * written against it (13,912 characters against roughly a hundred). Longest
 * therefore returns the schema, confidently, on exactly the input this design
 * makes likely.
 *
 * So the discriminator is not size, it is resemblance: prefer the candidate
 * carrying the most of the keys the caller actually asked for, and fall back to
 * the longest only among equals. That uses information already at hand -- the
 * request named the shape -- rather than guessing from shape-free text. A
 * schema echo scores zero on the planner's own field names, because its top
 * level is `type`/`properties`/`required`.
 *
 * The cap counts FAILED candidates only, and `i` advances past a matched object
 * that resembles the request rather than stepping into it -- while an object
 * that resembles nothing is descended into, since the document may be wrapped
 * inside it. Counting every `{` spent the whole budget
 * inside the first large object -- the schema alone holds 93 of them -- so a
 * reply that echoed it never reached the document. Counting successes was
 * wrong too, for a quieter reason: twenty valid objects in front of the
 * document made the document unreachable, and only failures are expensive
 * enough to need bounding.
 *
 * Returns the raw slice rather than the parsed value so the caller can report
 * what it tried to parse.
 */
export function extractJsonObject(text: string, expectedKeys: string[] = []): string | null {
  const stripped = stripFences(text).trim();
  if (stripped === '') return null;

  let failed = 0;
  let best: { slice: string; score: number; depth: number } | null = null;
  /** End offsets of objects being scanned INTO, so depth is known at any index. */
  const open: number[] = [];

  for (let i = 0; i < stripped.length && failed < MAX_FAILED_CANDIDATES; i += 1) {
    if (stripped[i] !== '{') continue;

    const slice = balancedObjectAt(stripped, i);
    if (slice == null) {
      failed += 1;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(slice);
    } catch {
      // Balanced but not valid JSON -- a brace in prose that happened to close.
      failed += 1;
      continue;
    }

    while (open.length > 0 && open[open.length - 1] <= i) open.pop();
    const depth = open.length;
    const score = resemblance(parsed, expectedKeys);

    if (best == null || better({ score, depth, slice }, best)) {
      best = { slice, score, depth };
    }

    if (score > 0) {
      // Looks like what was asked for; nothing better is inside it.
      i += slice.length - 1;
    } else {
      // Resembles nothing, so it may be a wrapper around the real answer.
      // Scan into it, remembering where it ends so depth stays right.
      open.push(i + slice.length);
    }
  }

  return best?.slice ?? null;
}

/**
 * Which of two candidates to keep.
 *
 * Ranked before scored, and the rank exists because two real reply shapes pull
 * in opposite directions.
 *
 * A reply that ECHOES THE SCHEMA contains a `properties` map whose keys are
 * exactly the field names being looked for -- a perfect resemblance by
 * construction, and a better one than a document that omits optional fields.
 * So score alone hands back the schema, which is the failure this function was
 * rewritten to stop.
 *
 * A reply that WRAPS the document (`{"result": {...}}`) offers a top level
 * resembling nothing, with the answer inside it. So refusing to look inside
 * ever means never finding it.
 *
 * The rule that serves both: prefer a top-level object that resembles the
 * request; look inside only when nothing at the top level resembles it at all.
 * A nested object is a fallback, never a competitor to a plausible top-level
 * answer, however much better it scores.
 */
function rank(candidate: { score: number; depth: number }): number {
  if (candidate.score > 0) return candidate.depth === 0 ? 2 : 1;
  return 0;
}

function better(
  candidate: { score: number; depth: number; slice: string },
  incumbent: { score: number; depth: number; slice: string },
): boolean {
  const a = rank(candidate);
  const b = rank(incumbent);
  if (a !== b) return a > b;
  if (candidate.score !== incumbent.score) return candidate.score > incumbent.score;
  if (candidate.depth !== incumbent.depth) return candidate.depth < incumbent.depth;
  return candidate.slice.length > incumbent.slice.length;
}

/** How many of the asked-for top-level keys this object actually has. */
function resemblance(value: unknown, expectedKeys: string[]): number {
  if (expectedKeys.length === 0) return 0;
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return 0;
  const keys = new Set(Object.keys(value as object));
  return expectedKeys.reduce((n, k) => n + (keys.has(k) ? 1 : 0), 0);
}

/**
 * Remove a surrounding markdown fence.
 *
 * Only a fence that wraps the whole reply is removed. A fence in the middle of
 * a longer reply is left alone, because the brace scan handles that case and
 * cutting on an inner fence could remove the object itself.
 */
function stripFences(text: string): string {
  const fenced = /^\s*```(?:json|JSON)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
  return fenced ? fenced[1] : text;
}

/**
 * The slice from `start` to its matching `}`, or null if it never closes.
 *
 * String literals are skipped so that a brace inside a value -- which a beat's
 * prose can contain, and a glitch mark very well might -- does not move the
 * depth counter.
 */
function balancedObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The top-level keys a reply is supposed to carry, read off the JSON Schema.
 *
 * `required` where the schema states it, falling back to the declared
 * properties. An empty list is handled by `extractJsonObject`: with nothing to
 * resemble, it falls back to preferring the longest candidate.
 */
export function requiredKeys(schema: Record<string, unknown> | undefined): string[] {
  if (!schema) return [];
  const required = schema.required;
  if (Array.isArray(required)) return required.map(String);
  const properties = schema.properties;
  if (properties && typeof properties === 'object') return Object.keys(properties as object);
  return [];
}
