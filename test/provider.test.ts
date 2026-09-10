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
import { GoogleGenAI } from '@google/genai';
import {
  buildRequest,
  DEFAULT_MODEL,
  GeminiClient,
  supportsThinkingLevel,
  THINKING,
  type GeminiConfig,
} from '../src/provider/gemini';
import { type CallOptions, type InferenceClient, ProviderError, TruncatedError, dataUrlToAttachment } from '../src/provider/types';
import { instrument } from '../src/debug';
import { analyzeVideoWithGemini } from '../src/provider/geminiVideo';
import { HeylookClient } from '../src/provider/heylook';
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

describe('schema shape instructions are appended as trailer', () => {
  const schema = { type: 'object', required: ['style', 'shots'] };

  it('never sends response_format (unconstrained decoding)', () => {
    expect(build({ schema })).not.toHaveProperty('response_format');
  });

  it('asks for the shape with a json shape trailer', () => {
    const built = String(build({ schema }).system_instruction);
    expect(built.startsWith(base.systemInstruction)).toBe(true);
    expect(built).toContain(JSON.stringify(schema, null, 2));
  });

  it('sends bare system instruction when no schema is requested', () => {
    expect(build().system_instruction).toBe(base.systemInstruction);
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

  it('strips data: prefix from image base64 if provided with data url scheme', () => {
    const input = build({
      images: [{ base64: 'data:image/png;base64,BBBB', mimeType: 'image/png' }],
    }).input as Record<string, unknown>[];
    expect(input[0]).toMatchObject({ data: 'BBBB', mime_type: 'image/png' });
  });

  it('never sends response_format', () => {
    expect(build()).not.toHaveProperty('response_format');
    expect(build({ schema: { type: 'object' } })).not.toHaveProperty('response_format');
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
 */
describe('schema enforcement toggle is completely removed', () => {
  it('useEngine has no enforceSchema state', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src/ui/useEngine.ts'), 'utf8');
    expect(src).not.toContain('enforceSchema');
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

  it('falls back to default model when config model is empty or whitespace', () => {
    const reqEmpty = buildRequest(base, DEFAULT_MODEL, { model: '' });
    expect(reqEmpty.model).toBe(DEFAULT_MODEL);

    const reqWhitespace = buildRequest(base, DEFAULT_MODEL, { model: '   ' });
    expect(reqWhitespace.model).toBe(DEFAULT_MODEL);
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

describe('GeminiClient runtime behavior and error classification', () => {
  function createStubbedClient(
    response: Record<string, unknown> | (() => Promise<Record<string, unknown>>),
  ): GeminiClient {
    const client = new GeminiClient({ apiKey: 'AIza-test-key', retryBaseMs: 1 });
    (client as unknown as { ai: unknown }).ai = {
      interactions: {
        create: typeof response === 'function' ? response : async () => response,
      },
    };
    return client;
  }

  const callOpts: CallOptions = {
    systemInstruction: 'You plan scenes.',
    prompt: 'A baker opens the shop.',
    task: 'planner',
    schema: { type: 'object', properties: { shot: { type: 'string' } }, required: ['shot'] },
  };

  it('parses direct JSON reply', async () => {
    const client = createStubbedClient({
      status: 'completed',
      output_text: '{"shot":"wide angle bakery"}',
      id: 'int_ok_1',
      usage: { prompt_tokens: 10, candidate_tokens: 20 },
    });
    const res = await client.call<{ shot: string }>(callOpts);
    expect(res.status).toBe('completed');
    expect(res.interactionId).toBe('int_ok_1');
    expect(res.parsed).toEqual({ shot: 'wide angle bakery' });
  });

  it('throws ProviderError when JSON parsing/extraction fails', async () => {
    const client = createStubbedClient({
      status: 'completed',
      output_text: 'Not JSON at all',
      id: 'int_bad_json',
    });
    await expect(
      client.call(callOpts),
    ).rejects.toThrow(/No JSON object found/i);
  });

  it('extracts embedded JSON in markdown code fences', async () => {
    const client = createStubbedClient({
      status: 'completed',
      output_text: 'Here is the plan:\n```json\n{"shot":"wide angle bakery"}\n```\nEnjoy!',
      id: 'int_unconstrained_1',
    });
    const res = await client.call<{ shot: string }>(callOpts);
    expect(res.status).toBe('completed');
    expect(res.parsed).toEqual({ shot: 'wide angle bakery' });
  });

  it('throws ProviderError when JSON cannot be extracted', async () => {
    const client = createStubbedClient({
      status: 'completed',
      output_text: 'I refuse to provide any json.',
      id: 'int_no_json',
    });
    await expect(
      client.call(callOpts),
    ).rejects.toThrow(/No JSON object found/i);
  });

  it('throws TruncatedError on status: "incomplete"', async () => {
    const client = createStubbedClient({
      status: 'incomplete',
      output_text: '{"shot":"partial',
      id: 'int_trunc',
    });
    const promise = client.call(callOpts);
    await expect(promise).rejects.toThrow(TruncatedError);
    await expect(promise).rejects.toMatchObject({
      partialText: '{"shot":"partial',
      status: 'incomplete',
      interactionId: 'int_trunc',
    });
  });

  it('throws ProviderError on terminal failure statuses (failed, cancelled, budget_exceeded)', async () => {
    for (const failStatus of ['failed', 'cancelled', 'budget_exceeded']) {
      const client = createStubbedClient({
        status: failStatus,
        output_text: '',
        id: `int_${failStatus}`,
      });
      await expect(
        client.call(callOpts),
      ).rejects.toThrow(ProviderError);
    }
  });

  it('throws ProviderError on unexpected non-terminal statuses', async () => {
    const client = createStubbedClient({
      status: 'in_progress',
      output_text: '',
      id: 'int_prog',
    });
    await expect(
      client.call(callOpts),
    ).rejects.toThrow(/Unexpected non-terminal status/);
  });

  it('throws DOMException with AbortError when signal is already aborted prior to call', async () => {
    const client = createStubbedClient({
      status: 'completed',
      output_text: '{"shot":"wide"}',
      id: 'int_aborted',
    });
    const controller = new AbortController();
    controller.abort();
    const promise = client.call({ ...callOpts, signal: controller.signal });
    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps SDK exceptions into ProviderError rather than letting raw exceptions escape', async () => {
    const client = createStubbedClient(async () => {
      const err = new Error('Resource has been exhausted (e.g. check quota).');
      (err as any).status = 429;
      throw err;
    });
    const promise = client.call(callOpts);
    await expect(promise).rejects.toThrow(ProviderError);
    await expect(promise).rejects.toMatchObject({
      status: '429',
      message: expect.stringContaining('Resource has been exhausted'),
    });
  });

  it('maps in-flight abort exception from SDK into DOMException with AbortError', async () => {
    const controller = new AbortController();
    const client = createStubbedClient(async () => {
      controller.abort();
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });
    const promise = client.call({ ...callOpts, signal: controller.signal });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('falls back to DEFAULT_MODEL on modelId when model is empty or whitespace', () => {
    const clientEmpty = new GeminiClient({ apiKey: 'AIza-test', model: '' });
    expect(clientEmpty.modelId).toBe(DEFAULT_MODEL);

    const clientWhitespace = new GeminiClient({ apiKey: 'AIza-test', model: '   ' });
    expect(clientWhitespace.modelId).toBe(DEFAULT_MODEL);

    const clientConfigEmpty = new GeminiClient({
      apiKey: 'AIza-test',
      config: { model: '' },
    });
    expect(clientConfigEmpty.modelId).toBe(DEFAULT_MODEL);
  });

  it('exposes DEFAULT_MODEL on modelId when unconfigured', () => {
    const client = new GeminiClient({ apiKey: 'AIza-test' });
    expect(client.modelId).toBe(DEFAULT_MODEL);
    expect(client.modelId).toBe('models/gemini-3.8-flash');
  });

  it('exposes configured model on modelId when overridden via top-level or config', () => {
    const client = new GeminiClient({ apiKey: 'AIza-test', model: 'models/gemini-3.7-pro' });
    expect(client.modelId).toBe('models/gemini-3.7-pro');

    const clientWithConfig = new GeminiClient({
      apiKey: 'AIza-test',
      config: { model: 'models/gemini-3.7-flash' },
    });
    expect(clientWithConfig.modelId).toBe('models/gemini-3.7-flash');
  });

  it('preserves modelId across instrument() wrapping for GeminiClient', () => {
    const client = new GeminiClient({ apiKey: 'AIza-test' });
    const wrapped = instrument(client);
    expect(wrapped.modelId).toBe(DEFAULT_MODEL);

    const custom = new GeminiClient({ apiKey: 'AIza-test', model: 'custom-model' });
    const wrappedCustom = instrument(custom);
    expect(wrappedCustom.modelId).toBe('custom-model');
  });

  it('HeylookClient exposes model.id on modelId when model is configured', () => {
    const hlClient = new HeylookClient({
      model: { id: 'mlx-community/Qwen2.5-7B-Instruct-4bit' } as any,
    });
    expect(hlClient.modelId).toBe('mlx-community/Qwen2.5-7B-Instruct-4bit');
  });

  it('HeylookClient exposes "unknown" on modelId when model is missing or null', () => {
    const clientDefault = new HeylookClient();
    expect(clientDefault.modelId).toBe('unknown');

    const clientNull = new HeylookClient({ model: null });
    expect(clientNull.modelId).toBe('unknown');
  });

  it('preserves modelId across instrument() wrapping for HeylookClient and stubs', () => {
    const hlClient = new HeylookClient({
      model: { id: 'mlx-community/Qwen2.5-7B-Instruct-4bit' } as any,
    });
    const wrapped = instrument(hlClient);
    expect(wrapped.modelId).toBe('mlx-community/Qwen2.5-7B-Instruct-4bit');

    const hlDefault = new HeylookClient();
    const wrappedDefault = instrument(hlDefault);
    expect(wrappedDefault.modelId).toBe('unknown');

    const stub: InferenceClient = {
      providerId: 'gemini',
      modelId: 'stub-model-xyz',
      call: async () => ({
        text: '',
        parsed: null,
        status: 'completed',
        usage: {},
        durationMs: 0,
      }),
    };
    const wrappedStub = instrument(stub);
    expect(wrappedStub.modelId).toBe('stub-model-xyz');

    const stubNoModel: InferenceClient = {
      providerId: 'heylook',
      call: async () => ({
        text: '',
        parsed: null,
        status: 'completed',
        usage: {},
        durationMs: 0,
      }),
    };
    const wrappedNoModel = instrument(stubNoModel);
    expect(wrappedNoModel.modelId).toBeUndefined();
  });

  it('sources telemetry model string via client.modelId rather than caller branching', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src/ui/useEngine.ts'), 'utf8');
    expect(src).toMatch(/model:\s*client\.modelId/);
    expect(src).not.toMatch(/model:\s*\(provider === 'heylook'\s*\?\s*heylookModel\s*:/);
  });
});

describe('analyzeVideoWithGemini pipeline and zero-retention lifecycle', () => {
  it('requires an API key', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    await expect(
      analyzeVideoWithGemini({ apiKey: '', file }),
    ).rejects.toThrow(/Gemini API key is required/);
  });

  it('gates thinking_level on supportsThinkingLevel in video generation_config', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    let sentRequest: Record<string, any> | null = null;
    let deletedName: string | null = null;

    const mockAi = {
      files: {
        upload: async () => ({ name: 'files/test-vid-1', state: 'ACTIVE', uri: 'https://video.uri/1' }),
        get: async () => ({ name: 'files/test-vid-1', state: 'ACTIVE', uri: 'https://video.uri/1' }),
        delete: async (p: { name: string }) => { deletedName = p.name; },
      },
      interactions: {
        create: async (req: Record<string, unknown>) => {
          sentRequest = req;
          return { status: 'completed', output_text: 'A vivid cinematic scene description.', id: 'int_vid_1' };
        },
      },
    } as unknown as GoogleGenAI;

    // Test with supported model (3.8-flash)
    await analyzeVideoWithGemini({
      apiKey: 'AIza-test',
      file,
      aiClient: mockAi,
      config: { model: 'models/gemini-3.8-flash', plannerThinkingLevel: 'high' },
    });
    expect((sentRequest as any)?.generation_config?.thinking_level).toBe('high');
    expect(deletedName).toBe('files/test-vid-1');

    // Test with unsupported model (2.0-flash)
    sentRequest = null;
    await analyzeVideoWithGemini({
      apiKey: 'AIza-test',
      file,
      aiClient: mockAi,
      config: { model: 'models/gemini-2.0-flash', plannerThinkingLevel: 'high' },
    });
    expect((sentRequest as any)?.generation_config).not.toHaveProperty('thinking_level');
  });

  it('guarantees zero retention by calling files.delete in finally even when analysis throws', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    let deletedName: string | null = null;

    const mockAi = {
      files: {
        upload: async () => ({ name: 'files/to-clean-up', state: 'ACTIVE', uri: 'https://video.uri/clean' }),
        get: async () => ({ name: 'files/to-clean-up', state: 'ACTIVE', uri: 'https://video.uri/clean' }),
        delete: async (p: { name: string }) => { deletedName = p.name; },
      },
      interactions: {
        create: async () => {
          throw new Error('Inference failed after upload');
        },
      },
    } as unknown as GoogleGenAI;

    await expect(
      analyzeVideoWithGemini({
        apiKey: 'AIza-test',
        file,
        aiClient: mockAi,
      }),
    ).rejects.toThrow('Inference failed after upload');

    // File was purged despite the failure
    expect(deletedName).toBe('files/to-clean-up');
  });

  it('rejects when file parameter is missing or null', async () => {
    await expect(
      analyzeVideoWithGemini({ apiKey: 'AIza-test', file: null as any }),
    ).rejects.toThrow(/video file is required/);
  });

  it('aborts immediately before upload if signal is already aborted', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    let uploadCalled = false;
    const mockAi = {
      files: {
        upload: async () => {
          uploadCalled = true;
          return { name: 'files/should-not-upload' };
        },
      },
    } as unknown as GoogleGenAI;

    const controller = new AbortController();
    controller.abort();

    await expect(
      analyzeVideoWithGemini({
        apiKey: 'AIza-test',
        file,
        aiClient: mockAi,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/Video analysis was aborted/);
    expect(uploadCalled).toBe(false);
  });

  it('rejects when video file is empty (0 bytes)', async () => {
    const file = new File([], 'empty.mp4', { type: 'video/mp4' });
    await expect(
      analyzeVideoWithGemini({ apiKey: 'AIza-test', file }),
    ).rejects.toThrow(/video file is empty/i);
  });

  it('throws DOMException with AbortError when signal aborts during polling delay', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    const controller = new AbortController();
    let deleted = false;

    const mockAi = {
      files: {
        upload: async () => ({ name: 'files/test-vid-poll', state: 'PROCESSING' }),
        get: async () => ({ name: 'files/test-vid-poll', state: 'PROCESSING' }),
        delete: async () => { deleted = true; },
      },
    } as unknown as GoogleGenAI;

    // Trigger abort after 30ms so it aborts while inside delay(2000, signal)
    setTimeout(() => controller.abort(), 30);
    const start = Date.now();

    const promise = analyzeVideoWithGemini({
      apiKey: 'AIza-test',
      file,
      aiClient: mockAi,
      signal: controller.signal,
    });

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(deleted).toBe(true);
    expect(Date.now() - start).toBeLessThan(500); // Wakes up immediately rather than waiting 2000ms
  });

  it('rejects when uploaded file resource URI is missing after processing', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    const mockAi = {
      files: {
        upload: async () => ({ name: 'files/test-no-uri', state: 'ACTIVE', uri: '' }),
        get: async () => ({ name: 'files/test-no-uri', state: 'ACTIVE', uri: '' }),
        delete: async () => {},
      },
    } as unknown as GoogleGenAI;

    await expect(
      analyzeVideoWithGemini({
        apiKey: 'AIza-test',
        file,
        aiClient: mockAi,
      }),
    ).rejects.toThrow(/no resource URI was returned/i);
  });

  it('falls back to DEFAULT_MODEL when config.model is empty string or whitespace', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    let usedModel: string | null = null;
    const mockAi = {
      files: {
        upload: async () => ({ name: 'files/test-fb', state: 'ACTIVE', uri: 'https://video.uri/fb' }),
        get: async () => ({ name: 'files/test-fb', state: 'ACTIVE', uri: 'https://video.uri/fb' }),
        delete: async () => {},
      },
      interactions: {
        create: async (req: Record<string, unknown>) => {
          usedModel = req.model as string;
          return { status: 'completed', output_text: 'fallback video analysis', id: 'int_fb_1' };
        },
      },
    } as unknown as GoogleGenAI;

    await analyzeVideoWithGemini({
      apiKey: 'AIza-test',
      file,
      aiClient: mockAi,
      config: { model: '   ' },
    });
    expect(usedModel).toBe(DEFAULT_MODEL);
  });

  it('maps in-flight abort exception during files.upload into DOMException with AbortError', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    const controller = new AbortController();
    const mockAi = {
      files: {
        upload: async () => {
          controller.abort();
          const err = new Error('The user aborted a request.');
          throw err;
        },
      },
    } as unknown as GoogleGenAI;

    const promise = analyzeVideoWithGemini({
      apiKey: 'AIza-test',
      file,
      aiClient: mockAi,
      signal: controller.signal,
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps in-flight abort exception during interactions.create into DOMException with AbortError', async () => {
    const file = new File(['dummy'], 'sample.mp4', { type: 'video/mp4' });
    const controller = new AbortController();
    let deleted = false;
    const mockAi = {
      files: {
        upload: async () => ({ name: 'files/test-vid-abort', state: 'ACTIVE', uri: 'https://video.uri/abort' }),
        get: async () => ({ name: 'files/test-vid-abort', state: 'ACTIVE', uri: 'https://video.uri/abort' }),
        delete: async () => { deleted = true; },
      },
      interactions: {
        create: async () => {
          controller.abort();
          const err = new Error('The user aborted a request.');
          throw err;
        },
      },
    } as unknown as GoogleGenAI;

    const promise = analyzeVideoWithGemini({
      apiKey: 'AIza-test',
      file,
      aiClient: mockAi,
      signal: controller.signal,
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(deleted).toBe(true);
  });
});

describe('supportsThinkingLevel model family gating and edge cases', () => {
  it('identifies supported Gemini 3.x models', () => {
    expect(supportsThinkingLevel('models/gemini-3.8-flash')).toBe(true);
    expect(supportsThinkingLevel('gemini-3.8-flash')).toBe(true);
    expect(supportsThinkingLevel('models/gemini-3.7-flash')).toBe(true);
    expect(supportsThinkingLevel('gemini-3.7-flash')).toBe(true);
  });

  it('handles uppercase and mixed-case model identifiers', () => {
    expect(supportsThinkingLevel('MODELS/GEMINI-3.8-FLASH')).toBe(true);
    expect(supportsThinkingLevel('Gemini-3.7-Flash')).toBe(true);
    expect(supportsThinkingLevel('models/GEMINI-2.0-FLASH')).toBe(false);
  });

  it('rejects unsupported legacy model families', () => {
    expect(supportsThinkingLevel('models/gemini-2.0-flash')).toBe(false);
    expect(supportsThinkingLevel('gemini-2.0-flash')).toBe(false);
    expect(supportsThinkingLevel('models/gemini-2.5-pro')).toBe(false);
    expect(supportsThinkingLevel('models/gemini-1.5-flash')).toBe(false);
  });

  it('safely handles null, undefined, empty, and non-string inputs without throwing', () => {
    expect(supportsThinkingLevel('')).toBe(false);
    expect(supportsThinkingLevel(null)).toBe(false);
    expect(supportsThinkingLevel(undefined)).toBe(false);
    expect(supportsThinkingLevel(123 as any)).toBe(false);
    expect(supportsThinkingLevel({} as any)).toBe(false);
  });
});

describe('dataUrlToAttachment robust parsing and edge cases', () => {
  it('correctly parses standard single-line data URLs', () => {
    const res = dataUrlToAttachment('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ');
    expect(res).toEqual({
      mimeType: 'image/png',
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
    });
  });

  it('handles multi-line line-wrapped base64 data URLs without dropping payload', () => {
    const multiline = 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAE\nAAAABCAYAAAAfFcSJ\nAAAADUlEQVR42mNk';
    const res = dataUrlToAttachment(multiline);
    expect(res).not.toBeNull();
    expect(res?.mimeType).toBe('image/jpeg');
    expect(res?.base64).toBe('iVBORw0KGgoAAAANSUhEUgAAAAE\nAAAABCAYAAAAfFcSJ\nAAAADUlEQVR42mNk');
  });

  it('trims leading and trailing whitespace from dataUrl and fields', () => {
    const res = dataUrlToAttachment('   data:image/webp;base64,AQIDBAUGBwg=   \n');
    expect(res).toEqual({
      mimeType: 'image/webp',
      base64: 'AQIDBAUGBwg=',
    });
  });

  it('returns null for non-string, malformed, or empty data URLs', () => {
    expect(dataUrlToAttachment(null as any)).toBeNull();
    expect(dataUrlToAttachment(undefined as any)).toBeNull();
    expect(dataUrlToAttachment('' as any)).toBeNull();
    expect(dataUrlToAttachment('http://example.com/image.png')).toBeNull();
    expect(dataUrlToAttachment('data:image/png')).toBeNull();
    expect(dataUrlToAttachment('data:image/png;base64,')).toBeNull();
    expect(dataUrlToAttachment('data:;base64,AQID')).toBeNull();
  });
});
