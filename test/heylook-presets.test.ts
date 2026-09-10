/**
 * Tests for Heylook preset discovery, normalization, roster state reduction,
 * wire request construction, and prompt/schema integration.
 */

import { describe, expect, it } from 'vitest';
import {
  listPresets,
  normalizePreset,
  reducePresetRoster,
  INITIAL_PRESET_ROSTER,
} from '../src/provider/heylook/presets';
import { DiscoveryError } from '../src/provider/heylook/models';
import { HeylookClient, buildRequest } from '../src/provider/heylook/client';
import { buildPlannerSystemPrompt } from '../src/provider/prompts/planner';
import { buildPatchSystemPrompt } from '../src/provider/prompts/patch';
import { assemble } from '../src/core/assemble';
import { H3DocumentSchema } from '../src/core/ir/schema';
import type { CompileInput, H3Document } from '../src/core/ir/types';
import { normalize } from '../src/core/normalize';

const ORIGIN = 'http://heylook.test';

function answers(status: number, body: string) {
  const urls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

function throws(cause: unknown) {
  return (async () => {
    throw cause;
  }) as unknown as typeof fetch;
}

describe('normalizePreset', () => {
  it('normalizes flat preset structures', () => {
    const raw = {
      id: 'preset-1',
      name: 'Cyberpunk Noir',
      description: 'High contrast neo-noir style',
      system_prompt: 'You are a gritty cinematographer.',
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 4096,
      thinking: true,
      updated_at: '2026-03-01T12:00:00Z',
    };

    const normalized = normalizePreset(raw);
    expect(normalized).toEqual({
      id: 'preset-1',
      name: 'Cyberpunk Noir',
      systemPrompt: 'You are a gritty cinematographer.',
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 4096,
      thinking: { mode: 'on' },
      updatedAt: '2026-03-01T12:00:00Z',
      raw,
    });
  });

  it('normalizes params-wrapped preset structures', () => {
    const raw = {
      id: 'preset-2',
      name: 'Documentary Realism',
      params: {
        system_prompt: 'Observational style with natural lighting.',
        temperature: 0.4,
        top_p: 0.8,
        max_output_tokens: 2048,
        enable_thinking: true,
        reasoning_effort: 'high',
      },
    };

    const normalized = normalizePreset(raw);
    expect(normalized).toEqual({
      id: 'preset-2',
      name: 'Documentary Realism',
      systemPrompt: 'Observational style with natural lighting.',
      temperature: 0.4,
      topP: 0.8,
      maxOutputTokens: 2048,
      thinking: { mode: 'on', effort: 'high' },
      raw,
    });
  });

  it('handles empty or minimally populated records gracefully', () => {
    const raw = {
      id: 'minimal',
    };
    const normalized = normalizePreset(raw);
    expect(normalized).toEqual({
      id: 'minimal',
      name: 'minimal',
      raw,
    });
  });

  it('clamps or rejects non-numeric temperatures and topP', () => {
    const raw = {
      id: 'bad-types',
      temperature: 'high' as unknown as number,
      top_p: null as unknown as number,
    };
    const normalized = normalizePreset(raw);
    expect(normalized?.temperature).toBeUndefined();
    expect(normalized?.topP).toBeUndefined();
  });
});

describe('listPresets', () => {
  it('fetches /v1/presets and parses { data: [...] } responses', async () => {
    const payload = JSON.stringify({
      data: [
        { id: 'p1', name: 'Preset One', system_prompt: 'Prompt 1', temperature: 0.5 },
        { id: 'p2', name: 'Preset Two', params: { system_prompt: 'Prompt 2' } },
      ],
    });
    const { impl, urls } = answers(200, payload);

    const presets = await listPresets(ORIGIN, { fetchImpl: impl });
    expect(urls).toEqual([`${ORIGIN}/v1/presets`]);
    expect(presets).toHaveLength(2);
    expect(presets[0].id).toBe('p1');
    expect(presets[0].systemPrompt).toBe('Prompt 1');
    expect(presets[0].temperature).toBe(0.5);
    expect(presets[1].id).toBe('p2');
    expect(presets[1].systemPrompt).toBe('Prompt 2');
  });

  it('handles bare array responses', async () => {
    const payload = JSON.stringify([
      { id: 'p1', name: 'Direct Array Preset' },
    ]);
    const { impl } = answers(200, payload);

    const presets = await listPresets(ORIGIN, { fetchImpl: impl });
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe('Direct Array Preset');
  });

  it('throws DiscoveryError on non-200 responses', async () => {
    const { impl } = answers(500, 'Internal Server Error');
    await expect(listPresets(ORIGIN, { fetchImpl: impl })).rejects.toThrow(DiscoveryError);
  });

  it('throws DiscoveryError on network connection failure', async () => {
    const impl = throws(new Error('Connection refused'));
    await expect(listPresets(ORIGIN, { fetchImpl: impl })).rejects.toThrow(DiscoveryError);
  });
});

describe('reducePresetRoster', () => {
  it('transitions through ask, resolved, and failed states', () => {
    let state = INITIAL_PRESET_ROSTER;
    expect(state.kind).toBe('unasked');

    state = reducePresetRoster(state, { type: 'ask', instanceId: 'inst-1' });
    expect(state.kind).toBe('asking');

    const samplePresets = [
      { id: 'p1', name: 'P1' },
    ];
    state = reducePresetRoster(state, { type: 'resolved', instanceId: 'inst-1', presets: samplePresets });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.presets).toEqual(samplePresets);
    }

    state = reducePresetRoster(state, { type: 'reset' });
    expect(state.kind).toBe('unasked');

    state = reducePresetRoster(state, { type: 'ask', instanceId: 'inst-1' });
    state = reducePresetRoster(state, { type: 'failed', instanceId: 'inst-1', error: 'Network error' });
    expect(state.kind).toBe('failed');
    if (state.kind === 'failed') {
      expect(state.error).toBe('Network error');
    }

    state = reducePresetRoster(state, { type: 'reconsider' });
    expect(state.kind).toBe('unasked');
  });
});

describe('HeylookClient and buildRequest with sampler parameters', () => {
  it('buildRequest attaches temperature, top_p, and max_tokens', () => {
    const req = buildRequest(
      { systemInstruction: 'Sys', prompt: 'Prompt', task: 'planner', temperature: 0.7, topP: 0.9 },
      [],
      null,
      undefined,
      { maxOutputTokens: 2048 },
    );
    expect(req.temperature).toBe(0.7);
    expect(req.top_p).toBe(0.9);
    expect(req.max_tokens).toBe(2048);
  });

  it('client.call attaches sampler options to chat completions body', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'test-model',
        content: [{ type: 'text', text: '{"style":"test","speakers":[],"subjects":[],"shots":[]}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;

    const client = new HeylookClient({
      origin: ORIGIN,
      model: { id: 'test-model', modalities: ['text'], capabilities: ['chat'] },
      temperature: 0.65,
      topP: 0.9,
      maxOutputTokens: 1500,
      fetchImpl: fetchMock,
    });

    await client.call({
      systemInstruction: 'Sys prompt',
      prompt: 'User prompt',
      task: 'planner',
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.['temperature']).toBe(0.65);
    expect(capturedBody?.['top_p']).toBe(0.9);
    expect(capturedBody?.['max_tokens']).toBe(1500);
  });
});

describe('Creative direction injection in prompts', () => {
  const baseInput: CompileInput = {
    idea: 'A detective inspects a clock tower.',
    mode: 'T2VA',
    durationFrames: 192,
    slots: [],
    direction: 'Make it moody, high-contrast, film noir with heavy fog and shadows.',
  };

  it('injects # Creative direction into planner system prompt when present', () => {
    const normalized = normalize(baseInput);
    const prompt = buildPlannerSystemPrompt(normalized, baseInput);

    expect(prompt).toContain('# Creative direction');
    expect(prompt).toContain('Make it moody, high-contrast, film noir with heavy fog and shadows.');
  });

  it('omits # Creative direction when direction is empty or undefined', () => {
    const noDirInput: CompileInput = {
      ...baseInput,
      direction: undefined,
    };
    const normalized = normalize(noDirInput);
    const prompt = buildPlannerSystemPrompt(normalized, noDirInput);

    expect(prompt).not.toContain('# Creative direction');
  });

  it('injects # Active creative direction into patch system prompt when present', () => {
    const promptWithDir = buildPatchSystemPrompt(undefined, 'Keep characters backlit and silhouette.');
    expect(promptWithDir).toContain('# Active creative direction');
    expect(promptWithDir).toContain('Keep characters backlit and silhouette.');

    const promptWithoutDir = buildPatchSystemPrompt();
    expect(promptWithoutDir).not.toContain('# Active creative direction');
  });
});

describe('Document assembly and schema roundtrip with direction and preset', () => {
  it('stamps direction and preset provenance on assembled document and validates schema', () => {
    const compileInput: CompileInput = {
      idea: 'Sunrise over mountains',
      mode: 'T2VA',
      durationFrames: 192,
      slots: [],
      direction: 'Golden hour warmth with volumetric rays.',
      preset: {
        id: 'preset-golden',
        name: 'Golden Hour',
        updatedAt: '2026-03-01T10:00:00Z',
      },
    };

    const plan = {
      style: 'Cinematic landscape',
      speakers: [],
      subjects: [],
      shots: [
        {
          cutAtMs: null,
          cutStyle: null,
          camera: null,
          beats: [{
            prose: 'Sun emerges over mountain peak.',
            speaker: null,
            dialogue: null,
            visibleText: [],
            citesSlots: [],
            crossesCut: false,
            cutoff: false,
          }],
        },
      ],
    };

    const doc: H3Document = assemble(
      plan,
      compileInput,
      normalize(compileInput),
      { id: 'doc-golden-1' },
    );

    expect(doc.direction).toBe('Golden hour warmth with volumetric rays.');
    expect(doc.preset).toEqual({
      id: 'preset-golden',
      name: 'Golden Hour',
      updatedAt: '2026-03-01T10:00:00Z',
    });

    const parsed = H3DocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.direction).toBe('Golden hour warmth with volumetric rays.');
      expect(parsed.data.preset?.name).toBe('Golden Hour');
    }
  });
});
