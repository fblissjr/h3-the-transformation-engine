/**
 * The server entry point.
 *
 * A thin adapter: it opens the database, decides nothing, and hands every
 * request to `handle` in `routes.ts`. Everything testable lives there, so this
 * file staying trivial is what keeps the tests honest.
 *
 * It STARTS on a database it cannot write. The file is fine and only this build
 * cannot write it, so refusing to boot would report a broken server when what
 * happened is a version skew with a clean recovery -- and it would put that
 * recovery behind knowing a script exists. `mustWrite` guards the write
 * endpoints, never the boot. That is `loadDocument` returning `schemaError`
 * beside the record rather than throwing, one level out.
 */

import { join } from 'node:path';
import { configFromEnv } from './config';
import { handle } from './routes';
import { open } from './store';

const config = configFromEnv();
const opened = open(config.databasePath);
const ctx = { opened, databasePath: config.databasePath };

if (!opened.writable) {
  // Loud, not a footnote. The state is specific and has one cause, so the log
  // says which version wrote the file, that nothing has been modified, and what
  // can be done about it.
  console.warn(`\n  READ-ONLY: ${opened.mismatch.message}\n`);
}

Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return handle(req, ctx);

    // The built SPA, same origin as the API. Same-origin is what lets
    // `connect-src 'self'` cover the whole client without a policy change.
    const file = Bun.file(join(config.staticDir, url.pathname === '/' ? 'index.html' : url.pathname));
    if (await file.exists()) return new Response(file);
    // Client-side routing: unknown paths are the app's, not a 404.
    return new Response(Bun.file(join(config.staticDir, 'index.html')));
  },
});

console.log(
  `h3 server on http://localhost:${config.port}  db=${config.databasePath}` +
    `  ${opened.writable ? 'read/write' : 'READ-ONLY'}`,
);
