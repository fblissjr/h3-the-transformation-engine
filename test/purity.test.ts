/**
 * The core boundary.
 *
 * `src/core/` must stay free of React, the DOM, and the network. That is what
 * lets the whole compiler run in a Node script, a test, or later a
 * ComfyUI-adjacent tool, and what keeps the grammar assertions runnable without
 * a browser or an API key.
 *
 * Enforced here rather than by convention, because a boundary nothing checks is
 * a boundary that erodes on the first convenient import.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = join(import.meta.dirname, '../src/core');

/**
 * Two scan modes, because the two kinds of rule need opposite treatment.
 *
 * Import rules live inside string literals, so they need the source intact.
 * Global-access rules must ignore string literals and comments -- both mention
 * "document" in ordinary prose ("Path does not exist in this document."), and a
 * check that fires on those is one people learn to ignore.
 */
type Scan = 'raw' | 'code';

interface Forbidden {
  pattern: RegExp;
  why: string;
  scan: Scan;
}

const FORBIDDEN: Forbidden[] = [
  { pattern: /from\s+['"]react/, why: 'React', scan: 'raw' },
  { pattern: /from\s+['"]@google\/genai['"]/, why: 'the provider SDK', scan: 'raw' },
  { pattern: /from\s+['"]idb['"]/, why: 'the database layer', scan: 'raw' },
  { pattern: /\b(?:document|window|localStorage|navigator)\s*\./, why: 'the DOM', scan: 'code' },
  { pattern: /\bfetch\s*\(/, why: 'the network', scan: 'code' },
  // The trace bus is a module-level sink with a bounded buffer, which is state
  // -- and `src/core` is what has to stay runnable in a Node script with no app
  // around it. `src/debug/index.ts` said this discipline lived in a comment;
  // this file's own header says a boundary nothing checks erodes on the first
  // convenient import. Nothing in `src/core` is named debug, so the loose
  // pattern has nothing to false-positive on.
  { pattern: /from\s+['"][^'"]*debug(?:\/[^'"]*)?['"]/, why: 'the debug bus', scan: 'raw' },
];

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFilesIn(full);
    return entry.endsWith('.ts') ? [full] : [];
  });
}

/** Reduce a source file to just its code: no comments, no string contents. */
export function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function trips(rule: Forbidden, source: string): boolean {
  return rule.pattern.test(rule.scan === 'raw' ? source : codeOnly(source));
}

describe('src/core is pure', () => {
  const files = tsFilesIn(CORE);

  it('finds the core files at all', () => {
    // Without this the suite passes vacuously if the directory ever moves.
    expect(files.length).toBeGreaterThan(10);
  });

  for (const rule of FORBIDDEN) {
    it(`does not reach for ${rule.why}`, () => {
      const offenders = files.filter((f) => trips(rule, readFileSync(f, 'utf8')));
      expect(offenders.map((f) => f.replace(`${CORE}/`, ''))).toEqual([]);
    });
  }
});

describe('the purity check can fail', () => {
  const dom = FORBIDDEN.find((f) => f.why === 'the DOM')!;
  const sdk = FORBIDDEN.find((f) => f.why === 'the provider SDK')!;
  const net = FORBIDDEN.find((f) => f.why === 'the network')!;

  it('flags real DOM access', () => {
    expect(trips(dom, 'const t = document.title;')).toBe(true);
    expect(trips(dom, 'localStorage.setItem(k, v);')).toBe(true);
    expect(trips(dom, 'const w = window .innerWidth;')).toBe(true);
  });

  it('flags DOM access on a line that also carries a comment', () => {
    // Guards against comment-stripping being over-eager and blinding the check.
    expect(trips(dom, 'const t = document.title; // grab it')).toBe(true);
  });

  it('flags a network call', () => {
    expect(trips(net, 'await fetch(url);')).toBe(true);
  });

  it('flags the SDK import', () => {
    expect(trips(sdk, "import { GoogleGenAI } from '@google/genai';")).toBe(true);
  });

  it('flags a trace import, at either depth', () => {
    const bus = FORBIDDEN.find((f) => f.why === 'the debug bus')!;
    expect(trips(bus, "import { trace } from '../debug';")).toBe(true);
    // Deep imports too: banning only the barrel would leave the obvious way
    // round it open. The first version of this pattern did exactly that, and
    // this case documented the hole instead of closing it.
    expect(trips(bus, "import { trace } from '../../debug/bus';")).toBe(true);
    expect(trips(bus, "import { attach } from './debugger';")).toBe(false);
  });

  it('ignores the words in prose and in messages', () => {
    expect(trips(dom, '// Planner output -> document.')).toBe(false);
    expect(trips(dom, '/** The document model. */')).toBe(false);
    expect(trips(dom, "throw new Error('Not in this document.');")).toBe(false);
  });

  it('does not flag an innocent identifier', () => {
    expect(trips(dom, 'const t = doc.style;')).toBe(false);
    expect(trips(net, 'const f = prefetch(x);')).toBe(false);
  });
});
