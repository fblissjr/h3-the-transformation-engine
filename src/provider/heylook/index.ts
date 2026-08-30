/**
 * The heylook provider, as the rest of the app sees it.
 *
 * A barrel rather than a flat module because this backend needs four things the
 * hosted one does not -- discovery, capability gating, JSON extraction and an
 * image resize -- and each is a separate concern with its own reasoning.
 */

export { normalizeOrigin } from './config';
export { HeylookClient, buildRequest, joinTextBlocks, retryAfterMs } from './client';
export type { HeylookClientConfig } from './client';
export { canServe, listModels, pickDefaultModel, DiscoveryError } from './models';
export type { HeylookModel } from './models';
export { canResize, resizeAll, resizeAttachment, MAX_EDGE } from './images';
