/**
 * The patch prompt.
 *
 * A surgical edit is the opposite of a regeneration: the model sees the whole
 * document for context but is only permitted to rewrite the fields the user
 * selected. It returns operations against named paths, never a new document.
 *
 * The distinction matters because "rewrite this beat" and "regenerate with this
 * beat changed" produce very different diffs. The second quietly perturbs
 * wording everywhere, which destroys the user's ability to trust that anything
 * they already approved is still what they approved.
 */

import type { CreativeModeRecord } from '../../core/creative';
import { glitchDirective, styleDirective } from '../../core/creative';
import type { H3Document } from '../../core/ir/types';
import { serialize } from '../../core/serialize';
import { contextFor } from '../../core/normalize';
import { getAtPath } from '../../core/ir/paths';
import { DIALOGUE_PLACEHOLDER } from '../../core/serialize/shared';
import { CAMERA_TYPES, VOICEOVER_PHRASE } from '../../core/ir/vocab';

const CORE = `You make targeted edits to a MiniMax H3 scene document.

You return a list of operations. Each names a path and its replacement value. You never return a rewritten document, and you never touch a path outside the editable set you are given -- anything else is discarded and the user is told you tried.

# Rules

Change only what the instruction asks for. If a beat's lighting is wrong, fix the lighting; do not also polish the verbs. Untouched wording is wording the user has already approved.

Keep every value in the same register and format as the value it replaces. Prose stays prose, in the same tense and voice.

Preserve continuity across the whole document. If you change what a character is wearing in one beat, every later beat that mentions it is also part of the edit -- include those paths too.

${DIALOGUE_PLACEHOLDER} marks where a spoken line is spliced into prose. If a beat's prose contains it, your replacement must contain it exactly once, in a position that still reads correctly.

Camera motion must stay expressed as natural action inside the sentence, and must still match the shot's camera annotation. If the instruction requires a different motion, patch both the prose and the annotation. Motions: ${CAMERA_TYPES.join(', ')}.

A subject's traits are the binding description of what gets generated, and a retention marker does not repair an inaccurate one. If an edit changes a trait, change it to something the asset supports.

Never introduce a speech act into \`summary\`, or into a beat that has no dialogue. Naming speech without supplying words produces invented speech.

Voiceover prose must keep the exact phrase "${VOICEOVER_PHRASE}" and the statement that the character's lips remain completely closed.

On-screen text stays inside English double quotation marks, spelled exactly.

# When you should refuse

If part of the instruction cannot be done through the editable paths -- it needs a new shot, a new speaker, a different duration -- do the parts you can and list the rest under \`declined\` with a short reason. Do not approximate a structural change by rewording prose.`;

/**
 * Render the fields the model may write, with their current values.
 *
 * Showing current values rather than just path names is what lets the model make
 * a minimal edit: without them it is rewriting from scratch and the diff is
 * total even when the instruction was narrow.
 */
function editableSection(doc: H3Document, paths: string[]): string {
  const lines = paths.map((path) => {
    const value = getAtPath(doc, path);
    return `${path}\n  ${JSON.stringify(value)}`;
  });
  return `# Editable paths\n\n${lines.join('\n\n')}`;
}

/**
 * The patch prompt derives the style block and the glitch block from the
 * document's own creative mode, exactly as the planner prompt derives them from
 * the compile input. The two paths call the same functions on the same shape,
 * so an edit cannot drift away from what the document was written under.
 *
 * Neither derivation is given the H3 mode, and neither needs it: everything
 * mode-specific about a glitch mark is an affordance, and an edit is not adding
 * marks -- it is keeping the ones already in the prose intact.
 */
export function buildPatchSystemPrompt(creativeMode?: CreativeModeRecord): string {
  const directive = creativeMode ? styleDirective(creativeMode.selection) : null;
  const glitch = creativeMode ? glitchDirective(creativeMode.glitch) : null;
  if (!directive && !glitch) return CORE;

  const blocks = [CORE];

  if (directive) {
    blocks.push(
      [
        '# Active style',
        '',
        'The document was written under the style direction below. Preserve it in any prose you rewrite.',
        '',
        directive,
      ].join('\n'),
    );
  }

  if (glitch) {
    blocks.push(
      [
        '# Active glitch marks',
        '',
        'The marks below are already placed in this document. What follows is the direction they were ' +
          'placed under; read it as a description of what is there, not as an instruction to place ' +
          'anything. Keep every mark that appears in a beat you rewrite exactly as it is spelled and ' +
          "keep it in that beat's visibleText. Do not introduce a mark into a beat that has none, and " +
          'do not remove one unless the instruction asks for it.',
        '',
        glitch,
      ].join('\n'),
    );
  }

  return blocks.join('\n\n');
}

export function buildPatchUserPrompt(doc: H3Document, paths: string[], instruction: string): string {
  const { text } = serialize(doc, contextFor(doc));
  return [
    '# The prompt as it currently renders',
    '',
    text,
    '',
    editableSection(doc, paths),
    '',
    '# Instruction',
    '',
    instruction.trim(),
  ].join('\n');
}

export const PATCH_MAX_OUTPUT_TOKENS = 8_192;
