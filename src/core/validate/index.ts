/**
 * The validator.
 *
 * Every machine-checkable claim the H3 format makes, checked in code. This is
 * where the project's leverage is: the grammar is exact, so a rule either holds
 * or it does not, and no amount of prompt wording is a substitute for asserting
 * it here.
 *
 * Rules are pure and independent. A rule that throws would take the whole run
 * down and hide every other diagnostic, so `validate` isolates each one and
 * reports the failure as a diagnostic rather than letting it escape.
 */

import type { H3Document, NormalizedContext } from '../ir/types';
import type { Diagnostic, Rule } from './types';
import { timelineRules } from './rules/timeline';
import { speechRules } from './rules/speech';
import { sectionRules } from './rules/sections';

export * from './types';

export const ALL_RULES: Rule[] = [...timelineRules, ...speechRules, ...sectionRules];

export interface ValidationResult {
  /** Errors only; there is no warning severity. See ./types.ts for why. */
  diagnostics: Diagnostic[];
  ok: boolean;
}

export function validate(
  doc: H3Document,
  ctx: NormalizedContext,
  rules: Rule[] = ALL_RULES,
): ValidationResult {
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    try {
      diagnostics.push(...rule(doc, ctx));
    } catch (cause) {
      diagnostics.push({
        code: 'RULE_THREW',
        path: '',
        message: `Validation rule "${rule.name || 'anonymous'}" threw: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
    }
  }

  return { diagnostics, ok: diagnostics.length === 0 };
}

/** Diagnostics grouped by the path they attach to, for the editor's inline markers. */
export function byPath(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
  const map = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const list = map.get(d.path);
    if (list) list.push(d);
    else map.set(d.path, [d]);
  }
  return map;
}
