import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { normalizeOrigin } from './src/provider/heylook/config';

/**
 * Write the configured heylook origin into the page's `connect-src`.
 *
 * The app reads VITE_HEYLOOK_ORIGIN through `src/provider/heylook/config.ts`
 * and this plugin reads the same variable through the same `normalizeOrigin`,
 * so the host the policy allows and the host the client calls are one value
 * rather than two that have to be kept in step. A CSP that does not name the
 * origin refuses the fetch before it leaves the page, with no status code and
 * no response body -- the failure would look like the server being down.
 *
 * The token is required rather than optional. Vite's own `%VAR%` substitution
 * leaves the literal text in place when the variable is unset, which would put
 * a junk source into the policy; and an index.html that quietly lost the token
 * would ship a policy that blocks the provider with nothing to explain it. If
 * the token is missing the build stops.
 */
function heylookCsp(origin: string): Plugin {
  const TOKEN = '__HEYLOOK_ORIGIN__';
  return {
    name: 'h3-heylook-csp',
    transformIndexHtml(html) {
      if (!html.includes(TOKEN)) {
        throw new Error(
          `index.html has no ${TOKEN} in its Content-Security-Policy. Without it the heylook ` +
            'provider is blocked by connect-src with no error the app can report.',
        );
      }
      return html.replaceAll(TOKEN, origin);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Third argument '' loads every variable, not only the VITE_ prefixed ones,
  // so this reads the same .env the app does. Only the origin is used here, and
  // it is not a secret -- it is a hostname that has to reach the browser.
  const env = loadEnv(mode, process.cwd(), '');
  const heylookOrigin = normalizeOrigin(env.VITE_HEYLOOK_ORIGIN);

  return {
    plugins: [react(), heylookCsp(heylookOrigin)],
    resolve: {
      alias: {
        '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
        '@provider': fileURLToPath(new URL('./src/provider', import.meta.url)),
        '@db': fileURLToPath(new URL('./src/db', import.meta.url)),
        '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
        '@lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
      },
    },
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts'],
      setupFiles: [],
    },
  } as never;
});
