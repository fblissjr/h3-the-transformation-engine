import { describe, expect, it } from 'vitest';
import {
  PROMPT_DEFINITIONS,
  getPromptDefault,
  resolvePrompt,
} from '../src/provider/prompts/registry';
import { buildPlannerSystemPrompt } from '../src/provider/prompts/planner';
import { buildPatchSystemPrompt } from '../src/provider/prompts/patch';
import { normalize } from '../src/core/normalize';
import type { CompileInput } from '../src/core/ir/types';

describe('prompt customization and registry', () => {
  it('registers all key engine prompts with defaults', () => {
    const ids = PROMPT_DEFINITIONS.map((p) => p.id);
    expect(ids).toContain('planner:core');
    expect(ids).toContain('planner:mode:T2VA');
    expect(ids).toContain('planner:mode:I2VA');
    expect(ids).toContain('planner:mode:FL2VA');
    expect(ids).toContain('planner:mode:L2VA');
    expect(ids).toContain('planner:mode:Ref2VA');
    expect(ids).toContain('patch:core');
    expect(ids).toContain('video:analysis');

    for (const def of PROMPT_DEFINITIONS) {
      const defText = getPromptDefault(def.id);
      expect(defText).toBeTruthy();
      expect(defText!.length).toBeGreaterThan(50);
    }
  });

  it('resolvePrompt falls back to defaults when overrides are empty or absent', () => {
    expect(resolvePrompt('planner:core')).toBe(getPromptDefault('planner:core'));
    expect(resolvePrompt('planner:core', {})).toBe(getPromptDefault('planner:core'));
    expect(resolvePrompt('planner:core', { 'planner:core': '   ' })).toBe(
      getPromptDefault('planner:core'),
    );
  });

  it('resolvePrompt safely handles non-string values without throwing', () => {
    expect(resolvePrompt('planner:core', { 'planner:core': 123 as unknown as string })).toBe(
      getPromptDefault('planner:core'),
    );
    expect(resolvePrompt('planner:core', { 'planner:core': null as unknown as string })).toBe(
      getPromptDefault('planner:core'),
    );
  });

  it('resolvePrompt returns the customized override when provided', () => {
    const custom = 'CUSTOM OVERRIDE FOR PLANNER CORE';
    expect(resolvePrompt('planner:core', { 'planner:core': custom })).toBe(custom);
  });

  it('buildPlannerSystemPrompt uses customized core and mode overrides', () => {
    const input: CompileInput = {
      idea: 'A test idea',
      mode: 'T2VA',
      durationSeconds: 8,
      slots: [],
    };
    const ctx = normalize(input);

    const defaultPrompt = buildPlannerSystemPrompt(ctx, input);
    expect(defaultPrompt).toContain('# How to write');

    const customCore = '# How to write\n\nCustom core guidance';
    const customMode = '# Active mode: T2VA\n\nCustom mode instructions';
    const overriddenPrompt = buildPlannerSystemPrompt(ctx, input, {
      'planner:core': customCore,
      'planner:mode:T2VA': customMode,
    });

    expect(overriddenPrompt).toContain('Custom core guidance');
    expect(overriddenPrompt).toContain('Custom mode instructions');
  });

  it('buildPlannerSystemPrompt falls back to defaults when overrides are empty or whitespace', () => {
    const input: CompileInput = {
      idea: 'A test idea',
      mode: 'T2VA',
      durationSeconds: 8,
      slots: [],
    };
    const ctx = normalize(input);

    const promptWithEmpty = buildPlannerSystemPrompt(ctx, input, {
      'planner:core': '   ',
      'planner:mode:T2VA': '',
    });

    expect(promptWithEmpty).toContain('# How to write');
    expect(promptWithEmpty).toContain('# Active mode: T2VA');
  });

  it('buildPatchSystemPrompt uses customized patch core override', () => {
    const defaultPatch = buildPatchSystemPrompt();
    expect(defaultPatch).toContain('# Rules');

    const customPatch = 'Custom patch core rules';
    const overriddenPatch = buildPatchSystemPrompt(undefined, undefined, {
      'patch:core': customPatch,
    });
    expect(overriddenPatch).toBe(customPatch);
  });

  it('buildPatchSystemPrompt falls back to defaults when override is empty or whitespace', () => {
    const promptWithEmpty = buildPatchSystemPrompt(undefined, undefined, {
      'patch:core': '   ',
    });
    expect(promptWithEmpty).toContain('# Rules');
    expect(promptWithEmpty).toContain('You make targeted edits to a MiniMax H3 scene document');
  });
});
