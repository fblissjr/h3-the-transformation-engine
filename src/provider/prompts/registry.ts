/**
 * Prompt Registry & Customization Catalog.
 *
 * Every system prompt in the engine has a stable key, human title, description,
 * and built-in default. Overrides can be saved to SQLite via the settings table
 * (key: 'prompts') and loaded at runtime.
 */

import { PLANNER_CORE_DEFAULT, PLANNER_MODE_BLOCKS_DEFAULT } from './planner';
import { PATCH_CORE_DEFAULT } from './patch';
import { VIDEO_ANALYSIS_DEFAULT } from '../geminiVideo';

export interface PromptDefinition {
  id: string;
  title: string;
  description: string;
  category: 'planner' | 'patch' | 'utility';
  getDefault: () => string;
}

export const PROMPT_DEFINITIONS: readonly PromptDefinition[] = [
  {
    id: 'planner:core',
    title: 'Planner: Core Guidelines & Rules',
    description:
      'Shared instructions for all planner runs: preamble, # How to write, # What the frame can show, # Camera, # Shots and beats, # Speech, # Style, # On-screen text, and # Audio.',
    category: 'planner',
    getDefault: () => PLANNER_CORE_DEFAULT,
  },
  {
    id: 'planner:mode:T2VA',
    title: 'Planner: T2VA Mode Block',
    description:
      'Mode instructions for Text-to-Video generation (Shot 1 style clause, character consistency, no reference media).',
    category: 'planner',
    getDefault: () => PLANNER_MODE_BLOCKS_DEFAULT.T2VA,
  },
  {
    id: 'planner:mode:I2VA',
    title: 'Planner: I2VA Mode Block',
    description:
      'Mode instructions for Image-to-Video generation (<Picture 1> is opening frame at 0.00s).',
    category: 'planner',
    getDefault: () => PLANNER_MODE_BLOCKS_DEFAULT.I2VA,
  },
  {
    id: 'planner:mode:FL2VA',
    title: 'Planner: FL2VA Mode Block',
    description:
      'Mode instructions for First-and-Last frame generation (Picture 1 opening, Picture 2 ending, path between them).',
    category: 'planner',
    getDefault: () => PLANNER_MODE_BLOCKS_DEFAULT.FL2VA,
  },
  {
    id: 'planner:mode:L2VA',
    title: 'Planner: L2VA Mode Block',
    description:
      'Mode instructions for Last-Frame-to-Video generation (<Picture 1> is final frame, backwards convergence).',
    category: 'planner',
    getDefault: () => PLANNER_MODE_BLOCKS_DEFAULT.L2VA,
  },
  {
    id: 'planner:mode:Ref2VA',
    title: 'Planner: Ref2VA Mode Block',
    description:
      'Mode instructions for Reference asset jobs (reusable subjects, retention markers, task types).',
    category: 'planner',
    getDefault: () => PLANNER_MODE_BLOCKS_DEFAULT.Ref2VA,
  },
  {
    id: 'patch:core',
    title: 'Patch: Core Edit Rules',
    description:
      'Guidelines for targeted AST edits (surgical replacements, preserving approved wording, path allowlist).',
    category: 'patch',
    getDefault: () => PATCH_CORE_DEFAULT,
  },
  {
    id: 'video:analysis',
    title: 'Video: Reference Analysis',
    description:
      'Prompt sent to Gemini to analyze uploaded reference videos for visual setting, subjects, actions, camera, and sound.',
    category: 'utility',
    getDefault: () => VIDEO_ANALYSIS_DEFAULT,
  },
] as const;

export function getPromptDefault(id: string): string | undefined {
  const def = PROMPT_DEFINITIONS.find((p) => p.id === id);
  return def?.getDefault();
}

export function resolvePrompt(id: string, overrides?: Record<string, string>): string {
  const val = overrides?.[id];
  if (typeof val === 'string' && val.trim() !== '') {
    return val;
  }
  return getPromptDefault(id) ?? '';
}
