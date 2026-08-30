/**
 * What the pipeline actually hands a provider.
 *
 * This sits in the gap CLAUDE.md names: everything past the model call in
 * `compile` and `edit` is unreachable from a test that never lets the call
 * happen. Deleting `if (input.creativeMode) doc.creativeMode = ...` once left
 * every test green for exactly that reason, and until now the only tests
 * driving `compile` were the wildcard refusals, which assert that the client is
 * NEVER called.
 *
 * It became cheap to close when the provider became an interface: a recording
 * client is now a legal implementation rather than a mock of an SDK. What it
 * watches is the wiring that no unit test on either client can see -- that the
 * task and the schema chosen in the pipeline are the ones the client receives,
 * and that reference images reach the call at all.
 *
 * The task assertions are the live concern. `thinkingLevel` used to be passed
 * explicitly by the pipeline and is now derived by each client from `task`, so
 * a `task` that failed to arrive would leave Gemini looking up `THINKING[
 * undefined]` and sending no thinking level -- which is the expensive path,
 * silently, with no error and no test on the Gemini side able to notice.
 */

import { describe, expect, it } from 'vitest';
import { compile, edit } from '../src/pipeline';
import { assemble } from '../src/core/assemble';
import { normalize } from '../src/core/normalize';
import type { PlannerOutput } from '../src/core/ir/schema';
import type { CompileInput, H3Document } from '../src/core/ir/types';
import type { CallOptions, CallResult, InferenceClient } from '../src/provider/types';

const plan: PlannerOutput = {
  style: 'Live-action, cinematic',
  speakers: [],
  subjects: [],
  shots: [
    {
      cutAtMs: null,
      cutStyle: null,
      camera: null,
      beats: [
        {
          prose: 'a wide shot of a bakery before sunrise.',
          speaker: null,
          dialogue: null,
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
      ],
    },
  ],
  soundscape: 'Shutters scrape open over a quiet street.',
  music: 'A soft acoustic-guitar pattern at a moderate tempo.',
  summary: null,
  taskTypes: null,
  audioRetention: null,
  pictureRetention: null,
};

const input: CompileInput = {
  idea: 'A baker opens up before dawn.',
  mode: 'T2VA',
  durationFrames: 192,
  slots: [],
};

/**
 * A provider that answers correctly and remembers what it was asked.
 *
 * A real implementation of the interface rather than a stub of an SDK, which is
 * the point: if the interface changes shape this stops compiling, instead of
 * agreeing with a signature that no longer exists.
 */
class RecordingClient implements InferenceClient {
  readonly providerId = 'gemini' as const;
  readonly calls: CallOptions[] = [];

  constructor(private readonly reply: unknown) {}

  async call<T>(options: CallOptions): Promise<CallResult<T>> {
    this.calls.push(options);
    return {
      text: JSON.stringify(this.reply),
      parsed: this.reply as T,
      status: 'completed',
      usage: {},
      durationMs: 1,
    };
  }
}

const docFor = (): H3Document => assemble(plan, input, normalize(input), { id: 'doc-1' });

describe('compile hands the planner call its task and its schema', () => {
  it('names the planner task, so the client can pick a depth for it', async () => {
    const client = new RecordingClient(plan);
    await compile(client, input, { id: 'doc-1' });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].task).toBe('planner');
  });

  it('asks for JSON, whether or not the backend can enforce it', async () => {
    // The field is a request for a shape, not a claim about constrained
    // decoding: Gemini turns it into `response_format`, heylook turns it into a
    // prompt trailer. A call that arrived without it would be free-form text on
    // both, and the pipeline's safeParse would report a schema failure rather
    // than the missing request.
    const client = new RecordingClient(plan);
    await compile(client, input, { id: 'doc-1' });
    const schema = client.calls[0].schema as Record<string, unknown>;
    expect(schema).toBeTruthy();
    expect(JSON.stringify(schema)).toContain('shots');
  });

  it('carries reference images through to the call', async () => {
    const client = new RecordingClient(plan);
    await compile(
      client,
      {
        ...input,
        mode: 'I2VA',
        slots: [
          {
            id: 's1',
            order: 0,
            kind: 'image',
            roles: [],
            filename: 'ref.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,AAAA',
            description: '',
          },
        ],
      },
      { id: 'doc-1' },
    );
    expect(client.calls[0].images).toEqual([{ base64: 'AAAA', mimeType: 'image/png' }]);
  });

  it('sends no images when there are none, rather than an empty attachment', async () => {
    const client = new RecordingClient(plan);
    await compile(client, input, { id: 'doc-1' });
    expect(client.calls[0].images).toEqual([]);
  });
});

describe('edit hands the patch call its own task', () => {
  it('names the patch task, which is a different depth from planning', async () => {
    // The two tasks map to different levels on Gemini, so a pipeline that sent
    // one task for both would quietly plan at patch depth or patch at planning
    // cost, with correct output either way.
    const client = new RecordingClient({
      operations: [{ path: 'shots.0.beats.0.prose', value: 'a colder wide shot.', rationale: 'Asked.' }],
      declined: null,
    });
    await edit(client, docFor(), ['shots.0.beats.0.prose'], 'make it colder');
    expect(client.calls[0].task).toBe('patch');
  });

  it('asks for the patch shape, not the planner shape', async () => {
    const client = new RecordingClient({
      operations: [{ path: 'shots.0.beats.0.prose', value: 'a colder wide shot.', rationale: 'Asked.' }],
      declined: null,
    });
    await edit(client, docFor(), ['shots.0.beats.0.prose'], 'make it colder');
    const schema = JSON.stringify(client.calls[0].schema);
    expect(schema).toContain('operations');
    expect(schema).not.toContain('soundscape');
  });
});
