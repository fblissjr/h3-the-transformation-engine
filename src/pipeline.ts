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
import { dataUrlToAttachment, GeminiClient, THINKING, type ImageAttachment } from './provider/gemini';
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

export class PlanError extends Error {}

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

export async function compile(
  client: GeminiClient,
  input: CompileInput,
  options: { id: string; seed?: number; signal?: AbortSignal } = { id: 'doc-1' },
): Promise<CompileResult> {
  const ctx = normalize(input);

  const result = await client.call({
    systemInstruction: buildPlannerSystemPrompt(ctx, input),
    prompt: buildPlannerUserPrompt(input),
    thinkingLevel: THINKING.planner,
    maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
    schema: plannerJsonSchema(),
    images: imagesFor(input),
    ...(options.seed != null ? { seed: options.seed } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  // The API enforces the schema, but zod is what the rest of the code trusts.
  // Parsing again here means a schema the API accepted but our types disagree
  // with fails loudly at the boundary rather than deep inside the serializer.
  const parsed = PlannerOutputSchema.safeParse(result.parsed);
  if (!parsed.success) {
    throw new PlanError(`Planner output did not match the schema: ${parsed.error.message}`);
  }

  const doc = assemble(parsed.data, input, ctx, { id: options.id, modeLocked: input.mode != null });
  return {
    doc,
    validation: validate(doc, ctx),
    rendered: serialize(doc, ctx),
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
  client: GeminiClient,
  doc: H3Document,
  paths: string[],
  instruction: string,
  options: { seed?: number; signal?: AbortSignal } = {},
): Promise<EditResult> {
  if (paths.length === 0) throw new PlanError('An edit needs at least one target path.');

  const result = await client.call({
    systemInstruction: buildPatchSystemPrompt(),
    prompt: buildPatchUserPrompt(doc, paths, instruction),
    thinkingLevel: THINKING.patch,
    maxOutputTokens: PATCH_MAX_OUTPUT_TOKENS,
    schema: patchJsonSchema(),
    ...(options.seed != null ? { seed: options.seed } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const parsed = PatchOutputSchema.safeParse(result.parsed);
  if (!parsed.success) {
    throw new PlanError(`Patch output did not match the schema: ${parsed.error.message}`);
  }

  const patch = applyPatch(doc, parsed.data);
  const ctx = contextFor(patch.doc);

  return {
    doc: patch.doc,
    patch,
    validation: validate(patch.doc, ctx),
    rendered: serialize(patch.doc, ctx),
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
  const patch = applyPatch(doc, {
    operations: [{ path, value: value as string, rationale: 'Direct edit.' }],
    declined: null,
  });
  const ctx = contextFor(patch.doc);
  return {
    doc: patch.doc,
    patch,
    validation: validate(patch.doc, ctx),
    rendered: serialize(patch.doc, ctx),
    usage: {},
  };
}

/** Re-render and re-validate without changing anything. */
export function inspect(doc: H3Document): { validation: ValidationResult; rendered: SerializeResult } {
  const ctx = contextFor(doc);
  return { validation: validate(doc, ctx), rendered: serialize(doc, ctx) };
}
