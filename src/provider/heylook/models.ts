/**
 * Runtime model discovery.
 *
 * heylook's registry is override-only: any model under a scanned folder is
 * served with derived defaults, so the roster changes when the owner downloads
 * something -- no config edit, no restart. There is no equivalent of
 * `DEFAULT_MODEL`. An id hard-coded here would be a 400 on any machine but the
 * one it was written on, so ids are resolved from the live server and the UI
 * offers what it finds.
 *
 * Capabilities are per-model, not per-provider. With Gemini vision can be
 * assumed; here one served model does vision and the next is text-only, so the
 * feature is gated on the row rather than on the backend.
 */

import { HEYLOOK_INSTANCES } from '../registry';

export interface HeylookModel {
  id: string;
  /** `mlx`, `mlx_embedding` or `gguf`. Kept for display; nothing branches on it. */
  provider?: string;
  /**
   * What the checkpoint author declared. Deliberately NOT what gating reads:
   * MLX strips audio towers at load, so a model can declare a modality it will
   * never serve.
   */
  modalities?: string[];
  /** What the server will actually serve. This is what gating reads. */
  capabilities?: string[];
}

export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

/**
 * The roster, as the server reports it right now.
 *
 * Every failure mode gets its own sentence, because they call for different
 * actions and "could not reach the server" covers all of them badly: the
 * server being down is a thing to start, a non-heylook reply on that port is a
 * thing to look at, and an empty roster is a thing to download a model for.
 */
export async function listModels(
  origin: string = HEYLOOK_INSTANCES[0].origin,
  signal?: AbortSignal,
): Promise<HeylookModel[]> {
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/models`, signal ? { signal } : {});
  } catch (cause) {
    // Both spellings pass through. `AbortSignal.timeout()` rejects with a
    // DOMException named `TimeoutError`, NOT `AbortError` -- so rethrowing only
    // the latter buried every timeout in the generic three-way message below,
    // and the caller's TimeoutError branch was unreachable.
    if (cause instanceof DOMException && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
      throw cause;
    }
    // Three different problems arrive here identically, as a TypeError with no
    // status and no response, so the message names all three rather than
    // guessing. Blaming the server is the wrong default: it is the only one of
    // the three that `curl` can confirm, which makes it the one most likely to
    // have been ruled out already.
    throw new DiscoveryError(
      `Could not reach heylook at ${origin}, and the failure carries no status -- which means ` +
        'one of three things. The server is not running there; or the page policy refused it, ' +
        'because connect-src is generated from the instance list at build time and a changed ' +
        'origin needs a restart; or the server answered without CORS headers for this page, ' +
        'which a curl check cannot see because curl does not enforce CORS. The browser network ' +
        'tab tells the three apart: no request at all is the policy, a failed OPTIONS preflight ' +
        'is CORS, and a connection error is the server.',
      cause,
    );
  }

  if (!response.ok) {
    throw new DiscoveryError(`heylook answered ${response.status} for /v1/models at ${origin}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new DiscoveryError(`Reply from ${origin}/v1/models was not JSON.`, cause);
  }

  const rows = (body as { data?: unknown }).data;
  if (!Array.isArray(rows)) {
    throw new DiscoveryError(
      `Reply from ${origin}/v1/models is not heylook's shape -- no "data" array. Something ` +
        'else may be listening on that port.',
    );
  }

  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .map((row) => ({
      id: String(row.id ?? ''),
      ...(typeof row.provider === 'string' ? { provider: row.provider } : {}),
      ...(Array.isArray(row.modalities) ? { modalities: row.modalities.map(String) } : {}),
      ...(Array.isArray(row.capabilities) ? { capabilities: row.capabilities.map(String) } : {}),
    }))
    .filter((row) => row.id !== '');
}

/** Gate on `capabilities`, never on `modalities`. See the type. */
export function canServe(model: HeylookModel | null, capability: string): boolean {
  return model?.capabilities?.includes(capability) ?? false;
}

/**
 * A reasonable default from a roster.
 *
 * Prefers a model that can see, because the app's images are the feature most
 * likely to be silently lost, then anything that can chat, then the first row.
 * Embedding models cannot answer a prompt, so they are never offered.
 */
export function pickDefaultModel(models: HeylookModel[]): HeylookModel | null {
  const usable = models.filter((m) => m.provider !== 'mlx_embedding');
  return (
    usable.find((m) => canServe(m, 'vision')) ?? usable.find((m) => canServe(m, 'chat')) ?? usable[0] ?? null
  );
}
