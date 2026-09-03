/**
 * The Gemini request body's privacy-critical properties.
 *
 * These are the claims the README makes to a user about what leaves their
 * browser. A claim nothing checks is a claim that quietly stops being true, so
 * each one is asserted here rather than left to a comment.
 *
 * `buildRequest` is pure, so none of this needs a network call or a key.
 *
 * Everything here is scoped to Gemini and none of it travels: heylook honours
 * `temperature`, has no `store` concept and no interaction to chain from. Its
 * own request properties are in `test/heylook.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { buildRequest, DEFAULT_MODEL, THINKING, type GeminiConfig } from '../src/provider/gemini';
import { ENFORCE_SCHEMA_DEFAULT } from '../src/provider/shape';
import type { CallOptions } from '../src/provider/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const base: CallOptions = {
  systemInstruction: 'You expand a creative request.',
  prompt: 'A baker opens the shutters.',
  task: 'planner',
};

const build = (extra: Partial<CallOptions> = {}) =>
  buildRequest({ ...base, ...extra }, DEFAULT_MODEL);

describe('interactions are never stored', () => {
  it('sends store: false', () => {
    expect(build().store).toBe(false);
  });

  it('sends store: false regardless of what the caller passes', () => {
    // There is deliberately no `store` option on CallOptions. This asserts that
    // smuggling one through cannot flip it.
    const sneaky = build({ store: true } as unknown as Partial<CallOptions>);
    expect(sneaky.store).toBe(false);
  });

  it('never sets previous_interaction_id, which would require storage', () => {
    expect(build()).not.toHaveProperty('previous_interaction_id');
  });
});

describe('sampling parameters', () => {
  it('never sends temperature -- the API accepts and silently ignores it', () => {
    const config = build().generation_config as Record<string, unknown>;
    expect(config).not.toHaveProperty('temperature');
  });

  it('always states a thinking level, because unset bills at the output rate', () => {
    // The level is no longer passed in -- the interface names a task and this
    // client maps it -- so the property is now that EVERY task maps to a level,
    // with no path that leaves the field off.
    for (const task of Object.keys(THINKING) as (keyof typeof THINKING)[]) {
      const config = build({ task }).generation_config as Record<string, unknown>;
      expect(config.thinking_level, task).toBe(THINKING[task]);
    }
  });

  it('never sends the level this model rejects', () => {
    // `minimal` is in the SDK's union but 400s on gemini-3.7-flash.
    expect(Object.values(THINKING)).not.toContain('minimal');
  });

  it('always sends the system instruction, which is interaction-scoped', () => {
    expect(build().system_instruction).toBe(base.systemInstruction);
  });
});

describe('schema enforcement is a choice, and only this file knows its wire name', () => {
  // The interface says `enforceSchema` and keeps saying it all the way down.
  // `response_format` appears here and nowhere upstream -- that is the whole
  // point of the field, so a second provider adds one mapping rather than a
  // second vocabulary.
  const schema = { type: 'object', required: ['style', 'shots'] };

  it('enforces by default, which is what this client has always done', () => {
    expect(build({ schema }).response_format).toMatchObject({ mime_type: 'application/json' });
  });

  it('does not enforce when told not to', () => {
    expect(build({ schema, enforceSchema: false })).not.toHaveProperty('response_format');
  });

  it('asks for the shape in words when it is not enforcing it', () => {
    // Otherwise switching enforcement off would send no shape guidance at all
    // and the reply would be free-form prose. The trailer is shared with the
    // local client rather than reimplemented here.
    const unenforced = String(build({ schema, enforceSchema: false }).system_instruction);
    expect(unenforced.startsWith(base.systemInstruction)).toBe(true);
    expect(unenforced).toContain(JSON.stringify(schema, null, 2));
  });

  it('does not add the trailer when it IS enforcing, which would be saying it twice', () => {
    expect(build({ schema }).system_instruction).toBe(base.systemInstruction);
  });

  it('has nothing to enforce without a schema, whatever the flag says', () => {
    expect(build({ enforceSchema: true })).not.toHaveProperty('response_format');
    expect(build({ enforceSchema: true }).system_instruction).toBe(base.systemInstruction);
  });
});

describe('request shape', () => {
  it('puts media before the question', () => {
    const input = build({
      images: [{ base64: 'AAAA', mimeType: 'image/png' }],
    }).input as Record<string, unknown>[];
    expect(input.map((b) => b.type)).toEqual(['image', 'text']);
  });

  it('carries images inline rather than uploading them', () => {
    const input = build({
      images: [{ base64: 'AAAA', mimeType: 'image/png' }],
    }).input as Record<string, unknown>[];
    expect(input[0]).toMatchObject({ data: 'AAAA', mime_type: 'image/png' });
    expect(input[0]).not.toHaveProperty('uri');
  });

  it('omits response_format unless a schema was given', () => {
    expect(build()).not.toHaveProperty('response_format');
    expect(build({ schema: { type: 'object' } }).response_format).toMatchObject({
      type: 'text',
      mime_type: 'application/json',
    });
  });

  it('omits seed and max_output_tokens rather than sending nulls', () => {
    const config = build().generation_config as Record<string, unknown>;
    expect(config).not.toHaveProperty('seed');
    expect(config).not.toHaveProperty('max_output_tokens');
  });
});

// ---------------------------------------------------------------------------
// The starting value of the enforcement toggle
// ---------------------------------------------------------------------------

/**
 * Off, on the owner's observation that constrained decoding costs prompt
 * quality. Not a measurement -- no A/B has been run in this repo, and the
 * README says as much -- so this asserts the decision, not a finding.
 *
 * The second test is the load-bearing one and is why the constant exists.
 * `useEngine` is a React hook with no test harness here, so a default written
 * as `useState(true)` inside it was a default nothing could reach: flipping it
 * broke no test, and flipping it back would break none either. That is the
 * shape `buildClient` was extracted to fix. Reading the source is a proxy for
 * rendering the hook, and it is named as one -- but it is a proxy for the thing
 * that actually goes wrong, which is someone re-hardcoding the literal.
 */
describe('schema enforcement starts off', () => {
  it('is the recorded default', () => {
    expect(ENFORCE_SCHEMA_DEFAULT).toBe(false);
  });

  it('is what useEngine starts from, rather than a literal (source proxy)', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src/ui/useEngine.ts'), 'utf8');
    expect(src, 'the engine must seed its toggle from the shared constant').toContain(
      'useState(ENFORCE_SCHEMA_DEFAULT)',
    );
    expect(src, 're-hardcoding the literal puts the default back out of reach').not.toMatch(
      /const \[enforceSchema, setEnforceSchemaState\] = useState\((true|false)\)/,
    );
  });
});

describe('gemini configuration and overrides', () => {
  it('uses default model gemini-3.8-flash when unconfigured', () => {
    expect(build().model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe('models/gemini-3.8-flash');
  });

  it('allows model override via GeminiConfig', () => {
    const req = buildRequest(base, DEFAULT_MODEL, { model: 'models/gemini-3.7-flash' });
    expect(req.model).toBe('models/gemini-3.7-flash');
  });

  it('allows call options to override both default and config model', () => {
    const req = buildRequest({ ...base, model: 'custom-model' }, DEFAULT_MODEL, {
      model: 'models/gemini-3.7-flash',
    });
    expect(req.model).toBe('custom-model');
  });

  it('allows configuring planner and patch thinking levels', () => {
    const plannerReq = buildRequest({ ...base, task: 'planner' }, DEFAULT_MODEL, {
      plannerThinkingLevel: 'high',
    });
    const patchReq = buildRequest({ ...base, task: 'patch' }, DEFAULT_MODEL, {
      patchThinkingLevel: 'medium',
    });

    const plannerGen = plannerReq.generation_config as Record<string, unknown>;
    const patchGen = patchReq.generation_config as Record<string, unknown>;

    expect(plannerGen.thinking_level).toBe('high');
    expect(patchGen.thinking_level).toBe('medium');
  });

  it('serializes video attachments with agentic video processing by default', () => {
    const req = buildRequest(
      {
        ...base,
        videos: [{ uri: 'https://generativelanguage.googleapis.com/v1beta/files/123', mimeType: 'video/mp4' }],
      },
      DEFAULT_MODEL,
    );
    const input = req.input as Record<string, unknown>[];
    expect(input[0]).toMatchObject({
      type: 'video',
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/123',
      mime_type: 'video/mp4',
      processing: 'agentic',
    });
  });

  it('honors videoProcessing and videoResolution from config', () => {
    const req = buildRequest(
      {
        ...base,
        videos: [{ uri: 'https://generativelanguage.googleapis.com/v1beta/files/456', mimeType: 'video/mp4' }],
      },
      DEFAULT_MODEL,
      { videoProcessing: 'static', videoResolution: 'ultra_high' },
    );
    const input = req.input as Record<string, unknown>[];
    expect(input[0]).toMatchObject({
      type: 'video',
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/456',
      mime_type: 'video/mp4',
      processing: 'static',
      resolution: 'ultra_high',
    });
  });

  it('forwards thinking summaries, token limits, and stop sequences', () => {
    const req = buildRequest(base, DEFAULT_MODEL, {
      thinkingSummaries: 'auto',
      maxOutputTokens: 4096,
      stopSequences: ['```'],
    });
    const gen = req.generation_config as Record<string, unknown>;
    expect(gen.thinking_summaries).toBe('auto');
    expect(gen.max_output_tokens).toBe(4096);
    expect(gen.stop_sequences).toEqual(['```']);
  });

  it('gates thinking_level to model families that support it', () => {
    const flash38 = buildRequest(base, 'models/gemini-3.8-flash');
    expect((flash38.generation_config as Record<string, unknown>).thinking_level).toBe('medium');

    const flash20 = buildRequest(base, 'models/gemini-2.0-flash');
    expect(flash20.generation_config as Record<string, unknown>).not.toHaveProperty('thinking_level');
  });

  it('strictly preserves store: false and omits temperature under all configurations', () => {
    const fullConfig: GeminiConfig = {
      model: 'models/gemini-3.8-flash',
      plannerThinkingLevel: 'high',
      patchThinkingLevel: 'medium',
      thinkingSummaries: 'auto',
      maxOutputTokens: 8192,
      videoProcessing: 'agentic',
      videoResolution: 'high',
    };
    const req = buildRequest(base, DEFAULT_MODEL, fullConfig);
    expect(req.store).toBe(false);
    expect(req.generation_config as Record<string, unknown>).not.toHaveProperty('temperature');
  });
});
