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
import { buildRequest, DEFAULT_MODEL, THINKING } from '../src/provider/gemini';
import type { CallOptions } from '../src/provider/types';

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
