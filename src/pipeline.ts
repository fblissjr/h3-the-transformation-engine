/**
 * The compile and edit pipelines.
 *
 * Sits above `core/` because it is the only place that talks to a model. Keeping
 * that boundary means the whole compiler -- normalize, validate, serialize,
 * patch -- stays runnable and testable with no network and no key.
 */

import { assemble } from './core/assemble';
import type { CompileInput, H3Document } from './core/ir/types';
import { PatchOutputSchema, PlannerOutputSchema, patchJsonSchema, plannerJsonSchema } from './core/ir/schema';
import { contextFor, normalize } from './core/normalize';
import { applyPatch, type PatchResult } from './core/patch/apply';
import { serialize, type SerializeResult } from './core/serialize';
import { validate, type ValidationResult } from './core/validate';
import { placeholdersIn } from './core/wildcards';
import {
  dataUrlToAttachment,
  type ImageAttachment,
  type InferenceClient,
} from './provider/types';
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  PLANNER_MAX_OUTPUT_TOKENS,
} from './provider/prompts/planner';
import {
  buildPatchSystemPrompt,
  buildPatchUserPrompt,
  PATCH_MAX_OUTPUT_TOKENS,
} from './provider/prompts/patch';
import { trace } from './debug';

export class PlanError extends Error {}

/**
 * One line each for the things every stage produces.
 *
 * Kept here rather than in `src/debug/` because they read the compiler's own
 * types, and `src/debug/` is deliberately ignorant of them -- the bus takes an
 * arbitrary payload so that a new layer can describe itself without editing a
 * shared type. These are the pipeline describing itself.
 */
function describeDoc(doc: H3Document): Record<string, unknown> {
  return {
    mode: doc.mode,
    shots: doc.shots.length,
    beats: doc.shots.reduce((total, shot) => total + shot.beats.length, 0),
    subjects: doc.subjects.length,
    slots: doc.slots.length,
    creativeMode: doc.creativeMode ?? null,
    hasRoll: doc.roll != null,
  };
}

function describeValidation(validation: ValidationResult): Record<string, unknown> {
  return {
    count: validation.diagnostics.length,
    codes: validation.diagnostics.map((d) => d.code),
    diagnostics: validation.diagnostics,
  };
}

export interface CompileResult {
  doc: H3Document;
  validation: ValidationResult;
  rendered: SerializeResult;
  interactionId?: string;
  usage: Record<string, unknown>;
}

/** Images ride along inline so the planner can actually see what it is describing. */
function imagesFor(input: CompileInput): ImageAttachment[] {
  return input.slots
    .filter((s) => s.kind === 'image' && s.dataUrl)
    .map((s) => dataUrlToAttachment(s.dataUrl!))
    .filter((a): a is ImageAttachment => a != null);
}

/**
 * Refuse an idea that still carries wildcard placeholders.
 *
 * `src/core/wildcards/expand.ts` states that nothing downstream of
 * `CompileInput` ever sees a placeholder. That was a claim about the UI rather
 * than a property of anything, and three paths broke it: generating without
 * rolling at all, checking out a version that carries no roll, and taking a
 * matrix cell whose category the library does not have. All three end in the
 * same place, so the check belongs here -- at the boundary the claim is about,
 * before a model call is spent -- rather than in three places in the UI.
 */
function refuseUnexpanded(input: CompileInput): void {
  const remaining = placeholdersIn(input.idea);
  if (remaining.length === 0) return;

  const names = [...new Set(remaining.map((p) => p.raw))].join(', ');
  throw new PlanError(
    `The idea still contains ${names}. Roll the wildcards, or remove the braces: a placeholder ` +
      'that reaches the planner is written into the prompt literally.',
  );
}

export async function compile(
  client: InferenceClient,
  input: CompileInput,
  options: { id: string; seed?: number; signal?: AbortSignal; enforceSchema?: boolean } = {
    id: 'doc-1',
  },
): Promise<CompileResult> {
  refuseUnexpanded(input);
  const started = Date.now();
  trace('pipeline', 'pipeline.compile.start', `compile: ${input.idea.length} char idea`, {
    id: options.id,
    idea: input.idea,
    modeOverride: input.mode ?? null,
    durationFrames: input.durationFrames ?? null,
    durationSeconds: input.durationSeconds ?? null,
    slots: input.slots.map((slot) => ({ kind: slot.kind, hasDataUrl: slot.dataUrl != null })),
    creativeMode: input.creativeMode ?? null,
    seed: options.seed ?? null,
    enforceSchema: options.enforceSchema ?? null,
  });

  const ctx = normalize(input);
  // The derived numbers the prompt is built from. When the planner writes a
  // document of the wrong length or the alignment line looks wrong, this is the
  // input to that, and it is otherwise invisible between the idea box and the
  // system prompt.
  trace(
    'pipeline',
    'pipeline.normalize',
    `normalized: ${ctx.mode} (${ctx.contract}), ${ctx.durationText}s, ${ctx.recommendedShots} shots suggested`,
    ctx,
  );

  const result = await client.call({
    systemInstruction: buildPlannerSystemPrompt(ctx, input),
    prompt: buildPlannerUserPrompt(input),
    task: 'planner',
    maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
    schema: plannerJsonSchema(),
    // Passed through untouched. The pipeline has no opinion on enforcement and
    // must not grow one: it is the caller's trade, and each client decides what
    // its own wire calls it.
    ...(options.enforceSchema != null ? { enforceSchema: options.enforceSchema } : {}),
    images: imagesFor(input),
    ...(options.seed != null ? { seed: options.seed } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  // Whether the schema was enforced by the backend or merely asked for in the
  // prompt, zod is what the rest of the code trusts. Parsing again here means a
  // reply the provider accepted but our types disagree with fails loudly at the
  // boundary rather than deep inside the serializer. With a local model that
  // has no constrained decoding -- by preference, not by limitation -- this is
  // the check doing the real work rather than a second opinion.
  const parsed = PlannerOutputSchema.safeParse(result.parsed);
  // The single trust boundary, so whether it held is worth saying either way.
  // A provider that enforced a schema and a provider that merely asked for one
  // both arrive here, and this is the only place the difference shows.
  trace(
    'pipeline',
    'pipeline.parse',
    parsed.success
      ? 'planner output matched the schema'
      : `planner output did not match the schema: ${parsed.error.issues.length} issue(s)`,
    parsed.success
      ? { ok: true }
      : { ok: false, issues: parsed.error.issues, received: result.parsed },
    { level: parsed.success ? 'info' : 'error' },
  );
  if (!parsed.success) {
    throw new PlanError(`Planner output did not match the schema: ${parsed.error.message}`);
  }

  const doc = assemble(parsed.data, input, ctx, { id: options.id, modeLocked: input.mode != null });
  trace('pipeline', 'pipeline.assemble', `assembled ${doc.mode} document`, describeDoc(doc));

  const validation = validate(doc, ctx);
  trace(
    'pipeline',
    'pipeline.validate',
    validation.diagnostics.length === 0
      ? 'no diagnostics'
      : `${validation.diagnostics.length} diagnostic(s)`,
    describeValidation(validation),
    { level: validation.diagnostics.length === 0 ? 'info' : 'warn' },
  );

  const rendered = serialize(doc, ctx);
  trace('pipeline', 'pipeline.serialize', `rendered ${rendered.length} chars`, {
    length: rendered.length,
    spans: rendered.map.length,
    text: rendered.text,
  });

  trace('pipeline', 'pipeline.compile.done', `compile finished`, { id: options.id }, {
    durationMs: Date.now() - started,
  });

  return {
    doc,
    validation,
    rendered,
    ...(result.interactionId ? { interactionId: result.interactionId } : {}),
    usage: result.usage,
  };
}

export interface EditResult extends CompileResult {
  patch: PatchResult;
}

/**
 * A surgical or wide edit.
 *
 * The only difference between the two is how many paths are passed in. One path
 * is "rewrite this beat"; every path in the document is "make it all night-time".
 * The mechanism, the guard rails and the audit trail are identical.
 */
export async function edit(
  client: InferenceClient,
  doc: H3Document,
  paths: string[],
  instruction: string,
  options: { seed?: number; signal?: AbortSignal; enforceSchema?: boolean } = {},
): Promise<EditResult> {
  if (paths.length === 0) throw new PlanError('An edit needs at least one target path.');
  const started = Date.now();
  trace('pipeline', 'pipeline.edit.start', `edit ${paths.length} path(s): ${instruction}`, {
    paths,
    instruction,
    // The document's own creative record, which is what the patch prompt is
    // built from -- deliberately not the picker's current selection. See the
    // note on `creative` in `src/ui/useEngine.ts`.
    creativeMode: doc.creativeMode ?? null,
    seed: options.seed ?? null,
  });

  const result = await client.call({
    systemInstruction: buildPatchSystemPrompt(doc.creativeMode),
    prompt: buildPatchUserPrompt(doc, paths, instruction),
    task: 'patch',
    maxOutputTokens: PATCH_MAX_OUTPUT_TOKENS,
    schema: patchJsonSchema(),
    ...(options.enforceSchema != null ? { enforceSchema: options.enforceSchema } : {}),
    ...(options.seed != null ? { seed: options.seed } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const parsed = PatchOutputSchema.safeParse(result.parsed);
  trace(
    'pipeline',
    'pipeline.parse',
    parsed.success
      ? 'patch output matched the schema'
      : `patch output did not match the schema: ${parsed.error.issues.length} issue(s)`,
    parsed.success
      ? { ok: true, operations: parsed.data.operations.length }
      : { ok: false, issues: parsed.error.issues, received: result.parsed },
    { level: parsed.success ? 'info' : 'error' },
  );
  if (!parsed.success) {
    throw new PlanError(`Patch output did not match the schema: ${parsed.error.message}`);
  }

  const patch = applyPatch(doc, parsed.data);
  // Applied, rejected and declined together. A partially applied edit that
  // looks complete is the failure mode that makes surgical editing
  // untrustworthy, and this is the record of which of the three each operation
  // fell into.
  trace(
    'pipeline',
    'pipeline.patch',
    `applied ${patch.applied.length}, rejected ${patch.rejected.length}, declined ${patch.declined.length}`,
    { applied: patch.applied, rejected: patch.rejected, declined: patch.declined },
    { level: patch.rejected.length > 0 || patch.declined.length > 0 ? 'warn' : 'info' },
  );
  const ctx = contextFor(patch.doc);

  const validation = validate(patch.doc, ctx);
  trace(
    'pipeline',
    'pipeline.validate',
    validation.diagnostics.length === 0
      ? 'no diagnostics'
      : `${validation.diagnostics.length} diagnostic(s)`,
    describeValidation(validation),
    { level: validation.diagnostics.length === 0 ? 'info' : 'warn' },
  );

  const rendered = serialize(patch.doc, ctx);
  trace('pipeline', 'pipeline.serialize', `rendered ${rendered.length} chars`, {
    length: rendered.length,
    spans: rendered.map.length,
    text: rendered.text,
  });

  trace('pipeline', 'pipeline.edit.done', 'edit finished', { paths }, {
    durationMs: Date.now() - started,
  });

  return {
    doc: patch.doc,
    patch,
    validation,
    rendered,
    ...(result.interactionId ? { interactionId: result.interactionId } : {}),
    usage: result.usage,
  };
}

/**
 * A direct edit: no model involved.
 *
 * Typed fields, enum dropdowns and reorders all land here. Same validation and
 * re-render as an assisted edit, so the two are indistinguishable downstream.
 */
export function editDirect(doc: H3Document, path: string, value: unknown): EditResult {
  const patch = applyPatch(
    doc,
    {
      operations: [{ path, value: value as string, rationale: 'Direct edit.' }],
      declined: null,
    },
    // The one caller that is the person rather than the model, which is what
    // lets them edit a line they supplied themselves.
    'direct',
  );
  const ctx = contextFor(patch.doc);
  const validation = validate(patch.doc, ctx);
  const rendered = serialize(patch.doc, ctx);
  // No model, so no provider events surround this one. Traced on the same
  // channel as an assisted edit precisely because the two are indistinguishable
  // downstream: the log should show that too.
  trace(
    'pipeline',
    'pipeline.editDirect',
    patch.rejected.length > 0 ? `direct edit of ${path} was rejected` : `direct edit of ${path}`,
    {
      path,
      value,
      applied: patch.applied,
      rejected: patch.rejected,
      diagnostics: validation.diagnostics.length,
      length: rendered.length,
    },
    { level: patch.rejected.length > 0 ? 'warn' : 'info' },
  );
  return {
    doc: patch.doc,
    patch,
    validation,
    rendered,
    usage: {},
  };
}

/** Re-render and re-validate without changing anything. */
export function inspect(doc: H3Document): { validation: ValidationResult; rendered: SerializeResult } {
  const ctx = contextFor(doc);
  return { validation: validate(doc, ctx), rendered: serialize(doc, ctx) };
}
