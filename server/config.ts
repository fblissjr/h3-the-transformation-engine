/**
 * Bootstrap configuration.
 *
 * Only the values the server needs BEFORE it can read anything: where the
 * database is, what port to listen on, where secrets live. These cannot come
 * from the database, because the server cannot read config from a store it has
 * not opened yet.
 *
 * Everything else is runtime config and belongs in the `settings` table. The one
 * thing that must never move there is an instance origin: the page's
 * `connect-src` is generated from those at build time, so an origin typed at
 * runtime is refused by the browser before the request leaves, with no status
 * and no body.
 */

export interface ServerConfig {
  databasePath: string;
  port: number;
  /** Where the built SPA lives, served at the same origin as the API. */
  staticDir: string;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    databasePath: env.H3_DATABASE ?? 'data/h3.db',
    port: Number(env.H3_PORT ?? 8788),
    staticDir: env.H3_STATIC_DIR ?? 'dist',
  };
}
