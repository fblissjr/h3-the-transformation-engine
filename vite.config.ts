import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { parseInstances, allOrigins } from './src/provider/registry.ts';

/**
 * Write the configured heylook origin into the page's `connect-src`.
 *
 * The app reads the instance list through `src/provider/registry.ts` and this
 * plugin reads the same variables through the same `parseInstances`, so the
 * hosts the policy allows and the hosts a client can reach are one list rather
 * than two that have to be kept in step. Instance origins are build-time for
 * exactly this reason: which hosts may be contacted is a security question, and
 * a runtime field for it could only be honoured by widening the policy to
 * anything. A CSP that does not name the
 * origin refuses the fetch before it leaves the page, with no status code and
 * no response body -- the failure would look like the server being down.
 *
 * The token is required rather than optional. Vite's own `%VAR%` substitution
 * leaves the literal text in place when the variable is unset, which would put
 * a junk source into the policy; and an index.html that quietly lost the token
 * would ship a policy that blocks the provider with nothing to explain it. If
 * the token is missing the build stops.
 */
function heylookCsp(origins: string[]): Plugin {
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
      // Every configured instance, because any of them may be the one you
      // pick at runtime and a policy that names only the first would refuse
      // the others with no status and no response body.
      return html.replaceAll(TOKEN, origins.join(' '));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Third argument '' loads every variable, not only the VITE_ prefixed ones,
  // so this reads the same .env the app does. Only the origin is used here, and
  // it is not a secret -- it is a hostname that has to reach the browser.
  const env = loadEnv(mode, process.cwd(), '');
  // Parsed by the same function the app uses, so the hosts the policy allows
  // and the hosts the client can reach are one list rather than two that have
  // to be kept in step.
  const instances = parseInstances(env.VITE_HEYLOOK_INSTANCES, env.VITE_HEYLOOK_ORIGIN);
  const origins = allOrigins(instances);

  return {
    plugins: [react(), heylookCsp(origins)],
    define: {
      // Injected rather than read from `import.meta.env` by the app.
      //
      // `loadEnv` here and `import.meta.env` in the bundle are DIFFERENT env
      // surfaces: a variable passed on the command line reaches this config but
      // is not necessarily defined into the client, so the policy was generated
      // from one value while the client compiled another to `undefined` and
      // silently fell back. Injecting the resolved list means there is one
      // computation with two consumers instead of two readers who agree by
      // luck.
      __HEYLOOK_INSTANCES__: JSON.stringify(instances),
    },
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
