/**
 * Getting JSON out of a backend that cannot be made to emit it.
 *
 * This file exists because of one structural difference: Gemini's
 * `response_format` constrains decoding, so the planner's large nested document
 * parses by construction. heylook has no equivalent on either wire -- there is
 * no `responseSchema`, and asking for one is not an error, it is simply absent.
 * The shape has to be requested in prose and the reply parsed defensively.
 *
 * That is a materially weaker guarantee and it is treated as such: the trailer
 * names the schema rather than describing it, extraction tolerates the three
 * things a local model actually does to JSON, and anything that survives all of
 * it still goes through `PlannerOutputSchema.safeParse` in the pipeline, which
 * is where a malformed document was always going to be caught.
 *
 * The trailer is appended to the system prompt by the client, not written by
 * the prompt builders. `reference/h3/contract.json` describes the builders'
 * output -- `test/contract.test.ts` indexes into `buildPlannerSystemPrompt`
 * directly -- so a trailer added downstream of them is invisible to that test
 * either way. It is recorded under `notInTheGuides` and asserted in
 * `test/heylook.test.ts` instead, because an edge that no check reaches is the
 * failure mode this repo keeps finding in itself.
 */

/** How many `{` positions to try before giving up. See `extractJsonObject`. */
const MAX_CANDIDATES = 20;

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
 * The scan walks candidate `{` positions and returns the LONGEST that both
 * balances and parses. Longest rather than first, because a preamble can
 * contain a brace and taking the first match hands back the wrong object
 * silently: "the schema uses {} for an empty object" in front of a real reply
 * yields `{}`, which is valid JSON, parses cleanly, and then fails
 * `PlannerOutputSchema.safeParse` with a message about a missing field rather
 * than about the wrong object having been picked. A document is always the
 * longest object in a reply about a document.
 *
 * It is capped at MAX_CANDIDATES so that a reply which is prose all the way
 * down costs a bounded scan rather than a quadratic one; a reply with twenty
 * false starts before the object was never going to be usable.
 *
 * Returns the raw slice rather than the parsed value so the caller can report
 * what it tried to parse.
 */
export function extractJsonObject(text: string): string | null {
  const stripped = stripFences(text).trim();
  if (stripped === '') return null;

  let tried = 0;
  let best: string | null = null;
  for (let i = 0; i < stripped.length && tried < MAX_CANDIDATES; i += 1) {
    if (stripped[i] !== '{') continue;
    tried += 1;
    const slice = balancedObjectAt(stripped, i);
    if (slice == null) continue;
    try {
      JSON.parse(slice);
      if (best == null || slice.length > best.length) best = slice;
    } catch {
      // Balanced but not valid JSON -- a brace in prose that happened to close.
      // Keep looking.
    }
  }
  return best;
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
