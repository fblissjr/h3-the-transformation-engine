/**
 * The request body's privacy-critical properties.
 *
 * These are the claims the README makes to a user about what leaves their
 * browser. A claim nothing checks is a claim that quietly stops being true, so
 * each one is asserted here rather than left to a comment.
 *
 * `buildRequest` is pure, so none of this needs a network call or a key.
 */

import { describe, expect, it } from 'vitest';
import { buildRequest, DEFAULT_MODEL, THINKING, type CallOptions } from '../src/provider/gemini';

const base: CallOptions = {
  systemInstruction: 'You expand a creative request.',
  prompt: 'A baker opens the shutters.',
  thinkingLevel: 'medium',
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
    for (const level of Object.values(THINKING)) {
      const config = build({ thinkingLevel: level }).generation_config as Record<string, unknown>;
      expect(config.thinking_level).toBe(level);
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
