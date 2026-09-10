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
import { t2vaBaker } from './fixtures/guide-examples';

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
  readonly canEnforceSchema = true;
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


describe('a stop reaches the provider', () => {
  // Same class of gap as the task and the schema: the signal is chosen in the
  // UI, threaded through the pipeline and consumed inside a client, so nothing
  // between those points would notice it being dropped. A stop button wired to
  // a signal that never arrives looks identical to one that works, right up
  // until the generation it was meant to release keeps running.
  it('carries the abort signal into the planner call', async () => {
    const client = new RecordingClient(plan);
    const controller = new AbortController();
    await compile(client, input, { id: 'doc-1', signal: controller.signal });
    expect(client.calls[0].signal).toBe(controller.signal);
  });

  it('carries the abort signal into the patch call', async () => {
    const client = new RecordingClient({
      operations: [{ path: 'shots.0.beats.0.prose', value: 'a colder wide shot.', rationale: 'Asked.' }],
      declined: null,
    });
    const controller = new AbortController();
    await edit(client, docFor(), ['shots.0.beats.0.prose'], 'colder', { signal: controller.signal });
    expect(client.calls[0].signal).toBe(controller.signal);
  });

  it('omits the signal rather than sending undefined when nothing can stop it', async () => {
    const client = new RecordingClient(plan);
    await compile(client, input, { id: 'doc-1' });
    expect('signal' in client.calls[0]).toBe(false);
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

/**
 * What comes back through the seam, rather than what goes out through it.
 *
 * The rest of this file watches the call; this watches the reply being applied.
 * A patch operation carries `value: string` -- that is the schema the model
 * answers, not a convenience -- so a numeric field arrives as text and the
 * coercion that turns it back into a number lives in `ir/leaf.ts`, two layers
 * below. Asserting it at `applyPatch` leaves the question of whether an
 * assisted edit reaches that code at all, which is the wiring gap this file
 * exists for. It needs no provider: the reply is the fixture.
 *
 * `t2vaBaker` rather than `docFor()`, which has one shot and so no cut time.
 */
describe('a patch value crosses the seam as text', () => {
  it('applies a numeric leaf as a number, not as the string it arrived in', async () => {
    const client = new RecordingClient({
      operations: [{ path: 'shots[1].cutAtMs', value: '6200', rationale: 'Asked.' }],
      declined: null,
    });
    const result = await edit(client, t2vaBaker, ['shots[1].cutAtMs'], 'cut a second later');
    expect(result.patch.rejected).toEqual([]);
    expect(result.doc.shots[1].cutAtMs).toBe(6200);
  });

  it('refuses a value the document schema rejects, and says which field', async () => {
    const client = new RecordingClient({
      operations: [{ path: 'shots[1].cutAtMs', value: '6200.5', rationale: 'Asked.' }],
      declined: null,
    });
    const result = await edit(client, t2vaBaker, ['shots[1].cutAtMs'], 'cut a second later');
    expect(result.patch.applied).toEqual([]);
    expect(result.patch.rejected[0]?.reason).toMatch(/Not a legal value for "shots\[\]\.cutAtMs"/);
    expect(result.doc.shots[1].cutAtMs).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * A run is observed on every path, including the failing ones.
 *
 * This is the property the measurement table exists for. A table that recorded
 * only successes would answer none of the questions it was built for: "did
 * thinking-on improve conformance" is a comparison of FAILURE rates, so a
 * provider error or a schema refusal is the data rather than an absence of it.
 *
 * The stage vocabulary is the conformance harness's, and the stages are columns
 * rather than a sum -- a call that reached `diagnostics` held the shape and one
 * that stopped at `schema` did not.
 */
describe('every call is observed, not only the ones that work', () => {
  const observe = () => {
    const seen: { stage: string; failureCause?: string; rawOutput: string }[] = [];
    return { seen, onRun: (o: (typeof seen)[number]) => seen.push(o) };
  };

  it('records the clean path', async () => {
    const { seen, onRun } = observe();
    await compile(new RecordingClient(plan), input, { id: 'd1', onRun });
    expect(seen).toHaveLength(1);
    expect(['clean', 'diagnostics']).toContain(seen[0].stage);
  });

  it('records a provider failure, and does not swallow it', async () => {
    const { seen, onRun } = observe();
    class Failing implements InferenceClient {
      readonly providerId = 'heylook' as const;
      readonly canEnforceSchema = false;
      async call<T>(): Promise<CallResult<T>> {
        throw new Error('connection refused');
      }
    }
    await expect(compile(new Failing(), input, { id: 'd1', onRun })).rejects.toThrow(
      /connection refused/,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].stage).toBe('provider');
    expect(seen[0].failureCause).toMatch(/connection refused/);
  });

  it('records a schema refusal against the field that refused', async () => {
    const { seen, onRun } = observe();
    const client = new RecordingClient({ ...plan, shots: 'not an array' });
    await expect(compile(client, input, { id: 'd1', onRun })).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0].stage).toBe('schema');
    expect(seen[0].failureCause).toMatch(/shots/);
  });

  it('records a reply with no JSON as its own stage, not as a schema failure', async () => {
    const { seen, onRun } = observe();
    class NoJson implements InferenceClient {
      readonly providerId = 'heylook' as const;
      readonly canEnforceSchema = false;
      async call<T>(): Promise<CallResult<T>> {
        return { text: 'I am afraid I cannot do that', parsed: null as T, status: 'completed', usage: {}, durationMs: 1 };
      }
    }
    await expect(compile(new NoJson(), input, { id: 'd1', onRun })).rejects.toThrow();
    expect(seen[0].stage).toBe('no_json');
  });

  it('carries the raw reply, which is not reconstructable afterwards', async () => {
    const { seen, onRun } = observe();
    await compile(new RecordingClient(plan), input, { id: 'd1', onRun });
    expect(JSON.parse(seen[0].rawOutput)).toEqual(plan);
  });

  it('is optional, so nothing breaks for a caller that does not want it', async () => {
    await expect(compile(new RecordingClient(plan), input, { id: 'd1' })).resolves.toBeDefined();
  });
});
