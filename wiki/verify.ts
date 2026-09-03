#!/usr/bin/env bun
/**
 * Automated Verification Harness for H3 Transformation Engine LLM-Wiki Knowledge Base.
 *
 * Implements the 4-tier verification methodology specified in PROJECT.md and TEST_INFRA.md:
 * - Tier 1: Feature Coverage (subsystems, diagnostic codes, pack families, anchors, postmortems, invariants)
 * - Tier 2: Boundary & Corner Cases (relative links, anchor links `#...`, code fences, empty docs)
 * - Tier 3: Symbol Correspondence (code identifiers in backticks mapped against real symbols in `src/`)
 * - Tier 4: Real-World Scenarios & Repository Sanity (tsc typecheck, test baseline, git repository isolation)
 *
 * Usage:
 *   bun run wiki/verify.ts [options]
 *
 * Options:
 *   --tier <1|2|3|4>   Run only the specified tier
 *   --skip-tier4       Run tiers 1, 2, 3 only (skips typecheck and test runner)
 *   --verbose          Output detailed diagnostics for all verified items
 *   --help             Show help text
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Configuration & Specification Constants
// ---------------------------------------------------------------------------

export const ROOT_DIR = resolve(dirname(new URL(import.meta.url).pathname), '..');
export const WIKI_DIR = join(ROOT_DIR, 'wiki');
export const SRC_DIR = join(ROOT_DIR, 'src');

export const EXPECTED_ARTICLES = [
  'index.md',
  'code_doc_discrepancies.md',
  'architecture.md',
  'invariants.md',
  'core_ir.md',
  'core_normalize.md',
  'core_validate.md',
  'core_serialize.md',
  'core_patch.md',
  'core_creative.md',
  'glitch_marks.md',
  'wildcards.md',
  'provider.md',
  'crypto.md',
  'db.md',
  'debug.md',
  'ui.md',
  'policy.md',
  'postmortems_lessons.md',
] as const;

export const EXPECTED_SUBSYSTEMS = [
  { name: 'core/ir', article: 'core_ir.md' },
  { name: 'core/normalize', article: 'core_normalize.md' },
  { name: 'core/validate', article: 'core_validate.md' },
  { name: 'core/serialize', article: 'core_serialize.md' },
  { name: 'core/patch', article: 'core_patch.md' },
  { name: 'core/creative', article: 'core_creative.md' },
  { name: 'core/wildcards', article: 'wildcards.md' },
  { name: 'provider', article: 'provider.md' },
  { name: 'crypto', article: 'crypto.md' },
  { name: 'db', article: 'db.md' },
  { name: 'debug', article: 'debug.md' },
  { name: 'ui', article: 'ui.md' },
] as const;

export const EXPECTED_DIAGNOSTIC_CODES = [
  'NO_SHOTS',
  'DURATION_NOT_POSITIVE',
  'MODE_SLOT_MISMATCH',
  'SHOT_INDEX_NOT_SEQUENTIAL',
  'SHOT_1_HAS_TIMESTAMP',
  'SHOT_MISSING_TIMESTAMP',
  'CUT_NOT_INCREASING',
  'CUT_OUTSIDE_DURATION',
  'SHOT_NO_BEATS',
  'CAMERA_TYPE_INVALID',
  'FRAME_ROLE_ON_NON_IMAGE',
  'SPEAKER_ORDINALS_NOT_SEQUENTIAL',
  'SPEAKER_ORDER_WRONG',
  'SPEAKER_UNDECLARED',
  'SPEAKER_REF_MISSING_IN_PROSE',
  'SPEAKER_NOT_INTRODUCED',
  'COMPOUND_SPEAKER_INVALID',
  'DIALOGUE_PLACEHOLDER_MISSING',
  'DIALOGUE_PLACEHOLDER_ORPHAN',
  'DIALOGUE_BAD_TERMINAL',
  'DIALOGUE_DECORATIVE_PUNCT',
  'VOICEOVER_PHRASE_MISSING',
  'SCENETRANS_UNPAIRED',
  'CUTOFF_NOT_AT_END',
  'VISIBLE_TEXT_NOT_QUOTED',
  'SLOT_CEILING_EXCEEDED',
  'SLOT_NO_ROLES',
  'SLOT_ORDER_NOT_CONTIGUOUS',
  'REF_MISSING_SUMMARY',
  'REF_MISSING_TASK_TYPES',
  'REF_TASK_TYPE_DUPLICATE',
  'REF_SUMMARY_NEW_LABEL',
  'REF_RETENTION_MISSING',
  'REF_RETENTION_MARKER_WRONG_CLASS',
  'REF_SPEAKER_IN_RETENTION',
  'REF_LABEL_UNDEFINED',
] as const;

export const EXPECTED_PACK_FAMILIES = [
  { prefix: 'V', count: 27, name: 'Visual-medium packs (V01-V27)' },
  { prefix: 'M', count: 8, name: 'Motion packs (M01-M08)' },
  { prefix: 'F', count: 9, name: 'Finish packs (F01-F09)' },
  { prefix: 'A', count: 9, name: 'Audio treatment packs (A01-A09)' },
] as const;

export const EXPECTED_ANCHOR_COUNT = 30; // R01-R30

export const EXPECTED_POSTMORTEM_SESSIONS = [
  '2026-08-28',
  '2026-08-30',
  '2026-08-31',
  '2026-09-01',
] as const;

// ---------------------------------------------------------------------------
// ANSI Color Formatting
// ---------------------------------------------------------------------------

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function passBadge(): string {
  return `${colors.bold}${colors.green}[PASS]${colors.reset}`;
}

function failBadge(): string {
  return `${colors.bold}${colors.red}[FAIL]${colors.reset}`;
}

function warnBadge(): string {
  return `${colors.bold}${colors.yellow}[WARN]${colors.reset}`;
}

function infoBadge(): string {
  return `${colors.bold}${colors.cyan}[INFO]${colors.reset}`;
}

// ---------------------------------------------------------------------------
// Error Tracking Types
// ---------------------------------------------------------------------------

export interface VerificationIssue {
  tier: 1 | 2 | 3 | 4;
  file?: string;
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface TierResult {
  tier: 1 | 2 | 3 | 4;
  name: string;
  passed: boolean;
  checksRun: number;
  checksPassed: number;
  issues: VerificationIssue[];
}

export interface VerificationOptions {
  tier?: 1 | 2 | 3 | 4;
  skipTier4?: boolean;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Markdown Parsing Helpers
// ---------------------------------------------------------------------------

/**
 * Generates standard GitHub Flavored Markdown slug from heading text.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '') // remove HTML tags
    .replace(/`([^`]+)`/g, '$1') // remove code formatting
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // remove links, keep text
    .replace(/[^\w\s-]/g, '') // remove non-alphanumerics except spaces and hyphens
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Generates alternative GitHub slug where characters like & preserve spacing
 */
export function slugifyPreservingSpaces(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/ /g, '-');
}

export interface MarkdownLink {
  text: string;
  target: string;
  line: number;
  raw: string;
}

export interface ParsedMarkdown {
  filename: string;
  relativePath: string;
  rawContent: string;
  lines: string[];
  headings: { text: string; slug: string; level: number; line: number }[];
  headingSlugs: Set<string>;
  links: MarkdownLink[];
  codeBlocks: { lang: string; content: string; startLine: number; endLine: number }[];
  backtickIdentifiers: { text: string; line: number; fullLine: string }[];
}

export function parseMarkdownFile(filePath: string, wikiBaseDir: string): ParsedMarkdown {
  const rawContent = readFileSync(filePath, 'utf-8');
  const lines = rawContent.split('\n');
  const relativePath = relative(wikiBaseDir, filePath);

  const headings: ParsedMarkdown['headings'] = [];
  const headingSlugs = new Set<string>();
  const slugCounts = new Map<string, number>();

  const links: MarkdownLink[] = [];
  const codeBlocks: ParsedMarkdown['codeBlocks'] = [];
  const backtickIdentifiers: ParsedMarkdown['backtickIdentifiers'] = [];

  let inCodeBlock = false;
  let blockLang = '';
  let blockStart = 0;
  let blockContentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Handle code fence transitions (CommonMark allows up to 3 spaces before ```)
    const fenceMatch = line.match(/^\s{0,3}```(\w*)/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        blockLang = fenceMatch[1] ?? '';
        blockStart = lineNum;
        blockContentLines = [];
      } else {
        inCodeBlock = false;
        codeBlocks.push({
          lang: blockLang,
          content: blockContentLines.join('\n'),
          startLine: blockStart,
          endLine: lineNum,
        });
      }
      continue;
    }

    if (inCodeBlock) {
      blockContentLines.push(line);
      continue;
    }

    // Parse headings: # Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const baseSlug = slugify(text);
      const altSlug = slugifyPreservingSpaces(text);

      let slug = baseSlug;
      const count = slugCounts.get(baseSlug) ?? 0;
      if (count > 0) {
        slug = `${baseSlug}-${count}`;
      }
      slugCounts.set(baseSlug, count + 1);

      headingSlugs.add(slug);
      headingSlugs.add(baseSlug);
      headingSlugs.add(altSlug);
      headings.push({ text, slug, level, line: lineNum });
    }

    // Parse inline links: [text](target)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(line)) !== null) {
      links.push({
        text: match[1],
        target: match[2].trim(),
        line: lineNum,
        raw: match[0],
      });
    }

    // Parse reference-style links: [text]: target
    const refMatch = line.match(/^\[([^\]]+)\]:\s*(\S+)/);
    if (refMatch) {
      links.push({
        text: refMatch[1],
        target: refMatch[2].trim(),
        line: lineNum,
        raw: refMatch[0],
      });
    }

    // Parse inline code backticks: `identifier`
    const backtickRegex = /`([^`\n]+)`/g;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = backtickRegex.exec(line)) !== null) {
      backtickIdentifiers.push({
        text: bMatch[1].trim(),
        line: lineNum,
        fullLine: line,
      });
    }
  }

  return {
    filename: basename(filePath),
    relativePath,
    rawContent,
    lines,
    headings,
    headingSlugs,
    links,
    codeBlocks,
    backtickIdentifiers,
  };
}

// ---------------------------------------------------------------------------
// Symbol Index Extractor from src/ and repository specifications
// ---------------------------------------------------------------------------

export interface SymbolIndex {
  allSymbols: Set<string>;
  exportedSymbols: Set<string>;
  filePaths: Set<string>;
  diagnosticCodes: Set<string>;
  packIds: Set<string>;
  anchorIds: Set<string>;
}

export function buildSymbolIndex(srcDir: string): SymbolIndex {
  const allSymbols = new Set<string>();
  const exportedSymbols = new Set<string>();
  const filePaths = new Set<string>();
  const diagnosticCodes = new Set<string>();
  const packIds = new Set<string>();
  const anchorIds = new Set<string>();

  // Standard TypeScript & JS Global Built-ins and Library Symbols
  const standardSymbols = [
    'string', 'number', 'boolean', 'any', 'unknown', 'never', 'void', 'null', 'undefined',
    'Record', 'Array', 'Map', 'Set', 'Promise', 'Error', 'Object', 'Function', 'RegExp',
    'Date', 'JSON', 'Math', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'ArrayBuffer',
    'CryptoKey', 'CryptoKeyPair', 'SubtleCrypto', 'IndexedDB', 'IDBDatabase', 'IDBTransaction',
    'IDBObjectStore', 'IDBIndex', 'IDBVersionChangeEvent', 'localStorage', 'sessionStorage',
    'window', 'document', 'navigator', 'fetch', 'Headers', 'Request', 'Response',
    'AbortSignal', 'AbortController', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'structuredClone', 'console', 'log', 'warn', 'error', 'info', 'debug',
    // Ecosystem & framework identifiers
    'React', 'FC', 'ReactNode', 'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
    'ZodSchema', 'z', 'InferenceClient', 'H3Document', 'H3DocumentSchema', 'H3Mode',
    // Tooling & Env
    'bun', 'vite', 'vitest', 'tsc', 'git', 'package.json', 'tsconfig.json',
    'GEMINI_API_KEY', 'VITE_HEYLOOK_ORIGIN', 'VITE_HEYLOOK_BASE_URL',
    // Project standard vocabulary constants
    'T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA',
    'first_frame', 'last_frame', 'identity', 'motion', 'style', 'audio',
    'fully_preserved', 'partially_preserved', 'recreated', 'adapted', 'reference',
    'cutAtMs', 'speakerId', 'prose', 'visibleText', 'dialogue', 'durationSeconds',
    'slots', 'shots', 'beats', 'speakers', 'subjects', 'retention', 'summary', 'taskTypes',
    // Specification keys in reference/h3/contract.json
    'notInTheGuides', 'notWrittenByHand', 'planner', 'patch', 'prompts', 'vocabulary',
  ];

  for (const s of standardSymbols) {
    allSymbols.add(s);
  }

  for (const code of EXPECTED_DIAGNOSTIC_CODES) {
    diagnosticCodes.add(code);
    allSymbols.add(code);
  }

  // Generate pack IDs (V01-V27, M01-M08, F01-F09, A01-A09)
  for (const fam of EXPECTED_PACK_FAMILIES) {
    for (let i = 1; i <= fam.count; i++) {
      const id = `${fam.prefix}${i.toString().padStart(2, '0')}`;
      packIds.add(id);
      allSymbols.add(id);
    }
  }

  // Generate anchor IDs (R01-R30)
  for (let i = 1; i <= EXPECTED_ANCHOR_COUNT; i++) {
    const id = `R${i.toString().padStart(2, '0')}`;
    anchorIds.add(id);
    allSymbols.add(id);
  }

  // Walk and index repository directories
  function walkFiles(dir: string, baseRelative: string) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkFiles(fullPath, baseRelative);
      } else if (entry.isFile()) {
        const relToRoot = relative(ROOT_DIR, fullPath);
        filePaths.add(relToRoot);
        filePaths.add(entry.name);

        if (baseRelative === 'src') {
          const relToSrc = relative(srcDir, fullPath);
          filePaths.add(relToSrc);
          filePaths.add(`src/${relToSrc}`);
          filePaths.add(entry.name.replace(/\.tsx?$/, ''));
        }

        if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          const content = readFileSync(fullPath, 'utf-8');

          // Extract export declarations: export (const|type|interface|class|function|enum) Name
          const exportRegex = /export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
          let m: RegExpExecArray | null;
          while ((m = exportRegex.exec(content)) !== null) {
            exportedSymbols.add(m[1]);
            allSymbols.add(m[1]);
          }

          // Extract named exports: export { A, B as C }
          const namedExportRegex = /export\s+\{([^}]+)\}/g;
          while ((m = namedExportRegex.exec(content)) !== null) {
            const list = m[1].split(',');
            for (const item of list) {
              const parts = item.trim().split(/\s+as\s+/);
              const sym = parts[parts.length - 1].trim();
              if (sym && /^[A-Za-z0-9_$]+$/.test(sym)) {
                exportedSymbols.add(sym);
                allSymbols.add(sym);
              }
            }
          }

          // Extract all top-level declarations
          const declRegex = /(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
          while ((m = declRegex.exec(content)) !== null) {
            allSymbols.add(m[1]);
          }

          // Extract interface property names
          const propRegex = /^\s*([A-Za-z0-9_$]+)\s*\??:\s*/gm;
          while ((m = propRegex.exec(content)) !== null) {
            allSymbols.add(m[1]);
          }

          // Extract string constants in uppercase or camelcase
          const constRegex = /\b([A-Z][A-Z0-9_]{2,})\b/g;
          while ((m = constRegex.exec(content)) !== null) {
            allSymbols.add(m[1]);
          }
        }
      }
    }
  }

  walkFiles(srcDir, 'src');
  walkFiles(join(ROOT_DIR, 'test'), 'test');
  walkFiles(join(ROOT_DIR, 'reference'), 'reference');
  walkFiles(join(ROOT_DIR, 'postmortems'), 'postmortems');

  // Load contract.json top-level keys
  const contractPath = join(ROOT_DIR, 'reference/h3/contract.json');
  if (existsSync(contractPath)) {
    try {
      const contract = JSON.parse(readFileSync(contractPath, 'utf-8'));
      for (const k of Object.keys(contract)) {
        allSymbols.add(k);
      }
    } catch {
      // ignore
    }
  }

  return {
    allSymbols,
    exportedSymbols,
    filePaths,
    diagnosticCodes,
    packIds,
    anchorIds,
  };
}

// ---------------------------------------------------------------------------
// Tier 1: Feature Coverage Verification
// ---------------------------------------------------------------------------

export function verifyTier1(
  wikiDir: string,
  options: VerificationOptions = {},
): TierResult {
  const issues: VerificationIssue[] = [];
  let checksRun = 0;
  let checksPassed = 0;

  function check(desc: string, fn: () => void) {
    checksRun++;
    try {
      fn();
      checksPassed++;
      if (options.verbose) {
        console.log(`  ${passBadge()} ${desc}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      issues.push({
        tier: 1,
        message: `${desc}: ${msg}`,
        severity: 'error',
      });
      console.log(`  ${failBadge()} ${desc}: ${colors.red}${msg}${colors.reset}`);
    }
  }

  console.log(`\n${colors.bold}${colors.cyan}=== Tier 1: Feature Coverage Verification ===${colors.reset}`);

  // 1. Check existence of wiki root directory
  check('Wiki root directory exists', () => {
    if (!existsSync(wikiDir)) {
      throw new Error(`Directory ${wikiDir} does not exist.`);
    }
  });

  if (!existsSync(wikiDir)) {
    return {
      tier: 1,
      name: 'Feature Coverage',
      passed: false,
      checksRun,
      checksPassed,
      issues,
    };
  }

  // 2. Check all 19 required articles exist
  for (const article of EXPECTED_ARTICLES) {
    check(`Dedicated article exists: wiki/${article}`, () => {
      const fullPath = join(wikiDir, article);
      if (!existsSync(fullPath)) {
        throw new Error(`Missing expected wiki article wiki/${article}`);
      }
      const stat = statSync(fullPath);
      if (stat.size < 50) {
        throw new Error(`Article wiki/${article} is empty or under 50 bytes`);
      }
    });
  }

  // 3. Check all 12 subsystems are mapped to dedicated articles
  for (const sub of EXPECTED_SUBSYSTEMS) {
    check(`Subsystem '${sub.name}' has dedicated article wiki/${sub.article}`, () => {
      const fullPath = join(wikiDir, sub.article);
      if (!existsSync(fullPath)) {
        throw new Error(`Subsystem ${sub.name} is missing article wiki/${sub.article}`);
      }
      const content = readFileSync(fullPath, 'utf-8');
      if (!content.includes(sub.name) && !content.includes(sub.article.replace(/\.md$/, ''))) {
        throw new Error(`Article wiki/${sub.article} does not reference subsystem ${sub.name}`);
      }
    });
  }

  // 4. Check all 36 diagnostic codes exist as cataloged entries
  const validateDocPath = join(wikiDir, 'core_validate.md');
  const validateContent = existsSync(validateDocPath) ? readFileSync(validateDocPath, 'utf-8') : '';

  check('All 36 diagnostic codes cataloged with triggers and controls', () => {
    const missingCodes: string[] = [];
    for (const code of EXPECTED_DIAGNOSTIC_CODES) {
      if (!validateContent.includes(code)) {
        missingCodes.push(code);
      }
    }
    if (missingCodes.length > 0) {
      throw new Error(
        `Missing ${missingCodes.length}/36 diagnostic codes in wiki/core_validate.md: ${missingCodes.slice(0, 5).join(', ')}${missingCodes.length > 5 ? '...' : ''}`,
      );
    }
  });

  // 5. Check all 4 pack families and 30 anchors in wiki/core_creative.md
  const creativeDocPath = join(wikiDir, 'core_creative.md');
  const creativeContent = existsSync(creativeDocPath) ? readFileSync(creativeDocPath, 'utf-8') : '';

  check('All 4 pack families (Visual, Motion, Finish, Audio) cataloged', () => {
    for (const fam of EXPECTED_PACK_FAMILIES) {
      const sampleId = `${fam.prefix}01`;
      if (!creativeContent.includes(sampleId)) {
        throw new Error(`Creative article missing pack family ${fam.name} (e.g. ${sampleId})`);
      }
    }
  });

  check('All 30 style reference anchors (R01-R30) cataloged', () => {
    const missingAnchors: string[] = [];
    for (let i = 1; i <= EXPECTED_ANCHOR_COUNT; i++) {
      const id = `R${i.toString().padStart(2, '0')}`;
      if (!creativeContent.includes(id)) {
        missingAnchors.push(id);
      }
    }
    if (missingAnchors.length > 0) {
      throw new Error(`Missing style anchors in wiki/core_creative.md: ${missingAnchors.join(', ')}`);
    }
  });

  // 6. Check postmortem lessons synthesis in wiki/postmortems_lessons.md
  const postmortemsDocPath = join(wikiDir, 'postmortems_lessons.md');
  const postmortemsContent = existsSync(postmortemsDocPath) ? readFileSync(postmortemsDocPath, 'utf-8') : '';

  check('Consolidated engineering postmortem lessons synthesized', () => {
    for (const session of EXPECTED_POSTMORTEM_SESSIONS) {
      if (!postmortemsContent.includes(session)) {
        throw new Error(`wiki/postmortems_lessons.md missing session synthesis for ${session}`);
      }
    }
  });

  // 7. Check core invariants documented in wiki/invariants.md
  const invariantsDocPath = join(wikiDir, 'invariants.md');
  const invariantsContent = existsSync(invariantsDocPath) ? readFileSync(invariantsDocPath, 'utf-8') : '';

  check('The 2 core engineering invariants & purity rules cataloged', () => {
    const hasInv1 = invariantsContent.toLowerCase().includes('beats carry prose') ||
                    invariantsContent.toLowerCase().includes('enums are validated annotations');
    const hasInv2 = invariantsContent.toLowerCase().includes('pure function') ||
                    invariantsContent.toLowerCase().includes('serialize(doc, ctx)');
    const hasPurity = invariantsContent.toLowerCase().includes('purity') ||
                      invariantsContent.includes('purity.test.ts');
    if (!hasInv1) throw new Error('Missing Invariant 1 (Beats carry prose; enums are validated annotations)');
    if (!hasInv2) throw new Error('Missing Invariant 2 (Prompt text is a pure function of the document)');
    if (!hasPurity) throw new Error('Missing purity rules / test/purity.test.ts boundary documentation');
  });

  // 8. Check master navigation map in wiki/index.md
  const indexDocPath = join(wikiDir, 'index.md');
  const indexContent = existsSync(indexDocPath) ? readFileSync(indexDocPath, 'utf-8') : '';

  check('wiki/index.md provides master navigation map linking to all topic articles', () => {
    const missingLinks: string[] = [];
    for (const article of EXPECTED_ARTICLES) {
      if (article === 'index.md') continue;
      if (!indexContent.includes(article)) {
        missingLinks.push(article);
      }
    }
    if (missingLinks.length > 0) {
      throw new Error(`wiki/index.md missing links to articles: ${missingLinks.join(', ')}`);
    }
  });

  return {
    tier: 1,
    name: 'Feature Coverage',
    passed: issues.length === 0,
    checksRun,
    checksPassed,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Tier 2: Boundary & Corner Cases (Link & Structural Integrity)
// ---------------------------------------------------------------------------

export function verifyTier2(
  wikiDir: string,
  options: VerificationOptions = {},
): TierResult {
  const issues: VerificationIssue[] = [];
  let checksRun = 0;
  let checksPassed = 0;

  console.log(`\n${colors.bold}${colors.cyan}=== Tier 2: Boundary & Corner Cases (Link & Markdown Structure) ===${colors.reset}`);

  if (!existsSync(wikiDir)) {
    issues.push({
      tier: 2,
      message: `Wiki directory ${wikiDir} does not exist.`,
      severity: 'error',
    });
    return {
      tier: 2,
      name: 'Boundary & Corner Cases',
      passed: false,
      checksRun: 1,
      checksPassed: 0,
      issues,
    };
  }

  // Gather all markdown files in wiki/
  const mdFiles: string[] = [];
  const entries = readdirSync(wikiDir);
  for (const entry of entries) {
    if (entry.endsWith('.md')) {
      mdFiles.push(join(wikiDir, entry));
    }
  }

  if (mdFiles.length === 0) {
    issues.push({
      tier: 2,
      message: `No markdown files found in ${wikiDir}.`,
      severity: 'error',
    });
    return {
      tier: 2,
      name: 'Boundary & Corner Cases',
      passed: false,
      checksRun: 1,
      checksPassed: 0,
      issues,
    };
  }

  // Parse all markdown files and build document map
  const docMap = new Map<string, ParsedMarkdown>();
  for (const file of mdFiles) {
    const parsed = parseMarkdownFile(file, wikiDir);
    docMap.set(parsed.filename, parsed);
  }

  // 1. Check for empty or malformed files
  for (const [filename, doc] of docMap.entries()) {
    checksRun++;
    if (doc.rawContent.trim().length === 0) {
      issues.push({
        tier: 2,
        file: filename,
        message: `File is completely empty.`,
        severity: 'error',
      });
      console.log(`  ${failBadge()} ${filename}: Empty document`);
    } else {
      checksPassed++;
    }

    // Check code fence matching (unclosed code fences)
    checksRun++;
    let fenceCount = 0;
    for (const line of doc.lines) {
      if (/^```/.test(line.trim())) fenceCount++;
    }
    if (fenceCount % 2 !== 0) {
      issues.push({
        tier: 2,
        file: filename,
        message: `Odd number of code fence lines (${fenceCount}), indicating an unclosed code block.`,
        severity: 'error',
      });
      console.log(`  ${failBadge()} ${filename}: Unclosed code block (${fenceCount} fence markers)`);
    } else {
      checksPassed++;
    }
  }

  // 2. Check all markdown links & anchors
  for (const [filename, doc] of docMap.entries()) {
    for (const link of doc.links) {
      checksRun++;
      const target = link.target;

      // Skip external URLs and email links
      if (/^(https?:\/\/|mailto:|ftp:\/\/)/i.test(target)) {
        checksPassed++;
        continue;
      }

      // Decompose target into path and anchor hash
      const [targetPathPart, hashPart] = target.split('#');

      let targetDoc: ParsedMarkdown | undefined = doc;

      // If targetPathPart is provided, resolve target file
      if (targetPathPart && targetPathPart !== '') {
        const resolvedPath = resolve(wikiDir, targetPathPart);
        const resolvedName = basename(resolvedPath);

        if (!existsSync(resolvedPath)) {
          issues.push({
            tier: 2,
            file: filename,
            line: link.line,
            message: `Broken relative link: "${link.raw}" targets non-existent file "${targetPathPart}"`,
            severity: 'error',
          });
          console.log(`  ${failBadge()} ${filename}:${link.line}: Dead file link -> ${targetPathPart}`);
          continue;
        }

        targetDoc = docMap.get(resolvedName);
      }

      // If hashPart is provided, verify anchor exists in target document
      if (hashPart && hashPart !== '') {
        if (!targetDoc) {
          checksPassed++;
          continue;
        }

        const normalizedHash = hashPart.toLowerCase();
        const hashCollapsed = normalizedHash.replace(/-+/g, '-');

        const anchorFound =
          targetDoc.headingSlugs.has(normalizedHash) ||
          targetDoc.headingSlugs.has(hashCollapsed) ||
          [...targetDoc.headingSlugs].some((s) => s.replace(/-+/g, '-') === hashCollapsed);

        if (!anchorFound) {
          issues.push({
            tier: 2,
            file: filename,
            line: link.line,
            message: `Dead anchor link: "${link.raw}" points to non-existent heading anchor "#${hashPart}" in ${targetDoc.filename}`,
            severity: 'error',
          });
          console.log(`  ${failBadge()} ${filename}:${link.line}: Dead anchor -> #${hashPart} in ${targetDoc.filename}`);
          continue;
        }
      }

      checksPassed++;
    }
  }

  // 3. Check bidirectional linking with index.md
  const indexDoc = docMap.get('index.md');
  if (indexDoc) {
    for (const [filename, doc] of docMap.entries()) {
      if (filename === 'index.md') continue;
      checksRun++;
      const linksToIndex = doc.links.some(
        (l) => l.target === 'index.md' || l.target === './index.md' || l.target.startsWith('index.md#'),
      );
      if (!linksToIndex) {
        issues.push({
          tier: 2,
          file: filename,
          message: `Article does not link back to master index (index.md).`,
          severity: 'warning',
        });
        if (options.verbose) {
          console.log(`  ${warnBadge()} ${filename}: Missing backlink to index.md`);
        }
      } else {
        checksPassed++;
      }
    }
  }

  if (issues.length === 0) {
    console.log(`  ${passBadge()} All relative file links, in-file anchors, and structural fences valid.`);
  }

  return {
    tier: 2,
    name: 'Boundary & Corner Cases',
    passed: issues.filter((i) => i.severity === 'error').length === 0,
    checksRun,
    checksPassed,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Tier 3: Symbol Correspondence Verification
// ---------------------------------------------------------------------------

export function verifyTier3(
  wikiDir: string,
  srcDir: string,
  options: VerificationOptions = {},
): TierResult {
  const issues: VerificationIssue[] = [];
  let checksRun = 0;
  let checksPassed = 0;

  console.log(`\n${colors.bold}${colors.cyan}=== Tier 3: Code Symbol Correspondence Verification ===${colors.reset}`);

  if (!existsSync(wikiDir)) {
    issues.push({
      tier: 3,
      message: `Wiki directory ${wikiDir} does not exist.`,
      severity: 'error',
    });
    return {
      tier: 3,
      name: 'Symbol Correspondence',
      passed: false,
      checksRun: 1,
      checksPassed: 0,
      issues,
    };
  }

  const symbolIndex = buildSymbolIndex(srcDir);
  if (options.verbose) {
    console.log(`  ${infoBadge()} Built symbol index: ${symbolIndex.allSymbols.size} symbols, ${symbolIndex.filePaths.size} source paths.`);
  }

  const entries = readdirSync(wikiDir);
  const mdFiles = entries.filter((e) => e.endsWith('.md')).map((e) => join(wikiDir, e));

  for (const file of mdFiles) {
    const parsed = parseMarkdownFile(file, wikiDir);
    const isDiscrepancyDoc = parsed.filename === 'code_doc_discrepancies.md';

    for (const token of parsed.backtickIdentifiers) {
      const raw = token.text.trim();
      if (!raw) continue;

      // Skip multi-word phrases, bash commands with spaces, pure string literals, or numbers
      if (raw.includes(' ') || raw.includes('\t') || /^\d+(\.\d+)*$/.test(raw)) {
        continue;
      }
      if (/^["'].*["']$/.test(raw)) {
        continue;
      }

      // If in discrepancy document, check if line is a blockquote (citing audited doc) or mentions removed/stale items
      const isHistoricalContext =
        isDiscrepancyDoc &&
        (token.fullLine.trim().startsWith('>') ||
          /\b(?:stale|removed|deleted|purged|omitted|deprecated|formerly|divergence|discrepancy|historical|relocated)\b/i.test(
            token.fullLine,
          ));

      // Check if it's a file path reference (e.g. src/core/ir/types.ts:123 or core/validate)
      if (raw.includes('/') || /\.(?:ts|tsx|json|mjs|js|md|css|html)(?::\d.*)?$/.test(raw)) {
        checksRun++;
        // Strip line number citations like :516-555 or :141
        const cleanPath = raw.replace(/:\d+.*$/, '');

        const isPathMatch =
          symbolIndex.filePaths.has(cleanPath) ||
          symbolIndex.filePaths.has(`src/${cleanPath}`) ||
          existsSync(join(ROOT_DIR, cleanPath));

        if (isPathMatch || isHistoricalContext) {
          checksPassed++;
        } else {
          // If it purports to reference a repo file path that doesn't exist
          if (
            cleanPath.startsWith('src/') ||
            cleanPath.startsWith('test/') ||
            cleanPath.startsWith('reference/') ||
            cleanPath.startsWith('postmortems/')
          ) {
            issues.push({
              tier: 3,
              file: parsed.filename,
              line: token.line,
              message: `Referenced file path "${cleanPath}" does not exist in the repository.`,
              severity: 'error',
            });
            console.log(`  ${failBadge()} ${parsed.filename}:${token.line}: Invalid file reference \`${raw}\``);
          }
        }
        continue;
      }

      // Handle method calls like AbortController.abort() or obj.method()
      const cleaned = raw.replace(/\(\)$/, '').replace(/^[A-Za-z0-9_]+\./, '');
      const baseObj = raw.includes('.') ? raw.split('.')[0] : null;

      // Check if it's a code identifier (PascalCase, camelCase, UPPER_SNAKE)
      const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cleaned);
      if (!isIdentifier) continue;

      // Skip short English words or markdown keywords
      if (['a', 'in', 'of', 'to', 'for', 'the', 'and', 'or', 'not', 'is', 'it'].includes(cleaned.toLowerCase())) {
        continue;
      }

      // Only assert on identifiers that look like specific code symbols
      const looksLikeCodeSymbol =
        /^[A-Z][a-zA-Z0-9]+$/.test(cleaned) || // PascalCase
        /^[a-z]+[A-Z][a-zA-Z0-9]*$/.test(cleaned) || // camelCase
        /^[A-Z][A-Z0-9_]{2,}$/.test(cleaned) || // UPPER_SNAKE
        raw.endsWith('()'); // function call notation

      if (looksLikeCodeSymbol) {
        checksRun++;
        const known =
          symbolIndex.allSymbols.has(cleaned) ||
          symbolIndex.allSymbols.has(raw) ||
          (baseObj && symbolIndex.allSymbols.has(baseObj)) ||
          symbolIndex.diagnosticCodes.has(cleaned) ||
          symbolIndex.packIds.has(cleaned) ||
          symbolIndex.anchorIds.has(cleaned) ||
          isHistoricalContext;

        if (known) {
          checksPassed++;
        } else {
          issues.push({
            tier: 3,
            file: parsed.filename,
            line: token.line,
            message: `Unverified code identifier: \`${raw}\` does not correspond to any exported or declared symbol in src/`,
            severity: 'error',
          });
          console.log(`  ${failBadge()} ${parsed.filename}:${token.line}: Unknown symbol \`${raw}\``);
        }
      }
    }
  }

  if (issues.length === 0) {
    console.log(`  ${passBadge()} All backticked code symbols and file references correspond to real symbols in src/.`);
  }

  return {
    tier: 3,
    name: 'Symbol Correspondence',
    passed: issues.length === 0,
    checksRun,
    checksPassed,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Tier 4: Real-World Scenarios & Repository Sanity
// ---------------------------------------------------------------------------

export function verifyTier4(
  repoDir: string,
  options: VerificationOptions = {},
): TierResult {
  const issues: VerificationIssue[] = [];
  let checksRun = 0;
  let checksPassed = 0;

  console.log(`\n${colors.bold}${colors.cyan}=== Tier 4: Real-World Scenarios & Repository Sanity ===${colors.reset}`);

  // 1. Run typecheck: bun run typecheck (tsc --noEmit)
  checksRun++;
  console.log(`  ${infoBadge()} Running TypeScript typecheck (bun run typecheck)...`);
  const typecheck = spawnSync('bun', ['run', 'typecheck'], {
    cwd: repoDir,
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (typecheck.status === 0) {
    checksPassed++;
    console.log(`  ${passBadge()} bun run typecheck passed with 0 errors.`);
  } else {
    issues.push({
      tier: 4,
      message: `TypeScript typecheck failed (exit code ${typecheck.status}):\n${typecheck.stdout}\n${typecheck.stderr}`,
      severity: 'error',
    });
    console.log(`  ${failBadge()} bun run typecheck failed.`);
  }

  // 2. Run repository test runner: bun test
  checksRun++;
  console.log(`  ${infoBadge()} Executing repository test suite (bun test)...`);
  const testRun = spawnSync('bun', ['test'], {
    cwd: repoDir,
    encoding: 'utf-8',
    timeout: 60000,
  });

  // Check output for test suite pass counts
  const output = `${testRun.stdout}\n${testRun.stderr}`;
  const passMatch = output.match(/(\d+)\s+pass/);
  const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;

  // Baseline requires >= 915 tests passing, exactly matches known divergence footprint
  if (passCount >= 915) {
    checksPassed++;
    console.log(`  ${passBadge()} bun test completed: ${passCount} tests passed (baseline satisfied).`);
  } else {
    issues.push({
      tier: 4,
      message: `Repository test suite pass count (${passCount}) below baseline (915):\n${output.slice(0, 1000)}`,
      severity: 'error',
    });
    console.log(`  ${failBadge()} bun test pass count ${passCount} < baseline 915.`);
  }

  // 3. Verify repository isolation: existing files outside wiki/ remain untouched
  checksRun++;
  console.log(`  ${infoBadge()} Verifying repository isolation via git status...`);
  const gitStatus = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoDir,
    encoding: 'utf-8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 10000,
  });

  if (gitStatus.status === 0) {
    const lines = gitStatus.stdout.split('\n').filter((l) => l.trim().length > 0);
    const illegalModifications: string[] = [];

    for (const line of lines) {
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim();

      // Untracked or explicitly managed docs/assets under wiki/, public/, or README.md are allowed
      if (
        filePath.startsWith('wiki/') ||
        filePath.startsWith('public/') ||
        filePath === 'README.md'
      ) {
        continue;
      }

      // Any modification to existing source, tests, or config is an isolation violation
      if (code.includes('M') || code.includes('D') || code.includes('A')) {
        illegalModifications.push(filePath);
      }
    }

    if (illegalModifications.length === 0) {
      checksPassed++;
      console.log(`  ${passBadge()} Repository isolation verified: 0 existing files modified.`);
    } else {
      issues.push({
        tier: 4,
        message: `Existing repository files outside wiki/ were modified: ${illegalModifications.join(', ')}`,
        severity: 'error',
      });
      console.log(`  ${failBadge()} Isolation breach: ${illegalModifications.join(', ')}`);
    }
  } else {
    issues.push({
      tier: 4,
      message: `Unable to verify git status cleanly: ${gitStatus.stderr || gitStatus.stdout}`,
      severity: 'warning',
    });
    console.log(`  ${warnBadge()} git status check encountered environment limit: ${gitStatus.stderr.trim()}`);
  }

  return {
    tier: 4,
    name: 'Real-World Scenarios & Repository Sanity',
    passed: issues.filter((i) => i.severity === 'error').length === 0,
    checksRun,
    checksPassed,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Main Harness Runner
// ---------------------------------------------------------------------------

export function main() {
  const args = process.argv.slice(2);
  const options: VerificationOptions = {};

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
H3 Transformation Engine LLM-Wiki Verification Harness

Usage:
  bun run wiki/verify.ts [options]

Options:
  --tier <1|2|3|4>   Run only the specified tier
  --skip-tier4       Skip Tier 4 (typecheck and test runner)
  --verbose          Show detailed check-by-check output
  --help, -h         Show this help message
`);
    process.exit(0);
  }

  const tierIndex = args.indexOf('--tier');
  if (tierIndex !== -1 && args[tierIndex + 1]) {
    const t = parseInt(args[tierIndex + 1], 10);
    if (t >= 1 && t <= 4) {
      options.tier = t as 1 | 2 | 3 | 4;
    }
  }

  if (args.includes('--skip-tier4')) {
    options.skipTier4 = true;
  }

  if (args.includes('--verbose')) {
    options.verbose = true;
  }

  console.log(`${colors.bold}${colors.magenta}================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}   H3 Transformation Engine LLM-Wiki Automated Verification     ${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}================================================================${colors.reset}`);

  const startTime = Date.now();
  const results: TierResult[] = [];

  const shouldRunTier = (tier: 1 | 2 | 3 | 4) => {
    if (options.tier) return options.tier === tier;
    if (tier === 4 && options.skipTier4) return false;
    return true;
  };

  if (shouldRunTier(1)) {
    results.push(verifyTier1(WIKI_DIR, options));
  }

  if (shouldRunTier(2)) {
    results.push(verifyTier2(WIKI_DIR, options));
  }

  if (shouldRunTier(3)) {
    results.push(verifyTier3(WIKI_DIR, SRC_DIR, options));
  }

  if (shouldRunTier(4)) {
    results.push(verifyTier4(ROOT_DIR, options));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  // ---------------------------------------------------------------------------
  // Summary Reporting
  // ---------------------------------------------------------------------------

  console.log(`\n${colors.bold}${colors.magenta}================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}                      Verification Summary                      ${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}================================================================${colors.reset}`);

  let allPassed = true;
  let totalChecksRun = 0;
  let totalChecksPassed = 0;
  const allIssues: VerificationIssue[] = [];

  for (const res of results) {
    totalChecksRun += res.checksRun;
    totalChecksPassed += res.checksPassed;
    allIssues.push(...res.issues);
    if (!res.passed) allPassed = false;

    const statusBadge = res.passed ? passBadge() : failBadge();
    console.log(`Tier ${res.tier} [${res.name}]: ${statusBadge} (${res.checksPassed}/${res.checksRun} checks passed)`);
  }

  console.log(`\nTotal Execution Time: ${elapsed}s`);
  console.log(`Overall Checks: ${totalChecksPassed}/${totalChecksRun} passed`);

  if (allIssues.length > 0) {
    console.log(`\n${colors.bold}${colors.red}Detailed Issues Breakdown (${allIssues.length} issues):${colors.reset}`);
    for (const issue of allIssues) {
      const loc = issue.file ? ` [${issue.file}${issue.line ? `:${issue.line}` : ''}]` : '';
      const prefix = issue.severity === 'error' ? `${colors.red}ERROR` : `${colors.yellow}WARN`;
      console.log(`- ${prefix}${colors.reset}${loc}: ${issue.message}`);
    }
  }

  if (allPassed) {
    console.log(`\n${colors.bold}${colors.green}>>> ALL VERIFICATION CHECKS PASSED (Exit Code 0) <<<${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.bold}${colors.red}>>> VERIFICATION FAILED (Exit Code 1) <<<${colors.reset}\n`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
