/**
 * Planner prompts.
 *
 * The governing idea: the prompt contains only what requires semantic or
 * creative judgment. Duration, label ordinals, shot numbering, timestamps,
 * alignment strings and section formatting are all computed and either supplied
 * as facts or added afterwards, so the model is told the answers rather than
 * asked to derive them. A prompt that teaches arithmetic is a prompt that will
 * eventually get arithmetic wrong.
 *
 * What is deliberately NOT here: rationale, background on how H3 works, and the
 * rules the validator already enforces mechanically. Those belong in the repo's
 * documentation and in code respectively; restating them per call costs tokens
 * and buys nothing.
 */

import type { CompileInput, NormalizedContext } from '../../core/ir/types';
import type { H3Mode } from '../../core/ir/vocab';
import {
  AMPLITUDE_PHRASE,
  CAMERA_TYPES,
  CONTINUITY_PHRASES,
  CUTOFF_TAG,
  MUSIC_SENTENCE_RANGE,
  ORDINARY_CUTS,
  REF_DETAIL_WORD_RANGE,
  SCENETRANS_TAG,
  SOUNDSCAPE_SENTENCE_RANGE,
  SPEED_PHRASE,
  TASK_TYPES,
  VISUAL_RETENTION,
  VOICEOVER_PHRASE,
} from '../../core/ir/vocab';
import { glitchDirective, styleDirective } from '../../core/creative';
import { DIALOGUE_PLACEHOLDER } from '../../core/serialize/shared';
import { recommendedBeats } from '../../core/normalize/budgets';

// ---------------------------------------------------------------------------
// Shared core
// ---------------------------------------------------------------------------

const CORE = `You expand a creative request into a concrete audiovisual scene plan for MiniMax H3.

You are writing PROSE. The sentences you write are what conditions the model. Everything structural around them -- shot numbers, cut timestamps, section headers, the alignment line -- is added afterwards by code. Never write any of it yourself.

# How to write

Describe what is visible and audible. Not what it means, not how the viewer should feel, not what the director intends. "Her shoulders drop and she looks at the floor", never "she is devastated".

Prefer a few legible, causal actions over many simultaneous ones. Keep identity, wardrobe, handedness, props, geography, lighting and object state consistent from beat to beat -- if a character is holding something in one beat, they are still holding it in the next unless you say they put it down.

# Recognisable people

Do not write the proper name of a widely recognised person, living, dead or fictional. Describe them instead: the role they are known for, the era, how they dress, and the physical traits that identify them on sight. Naming one pulls the whole frame toward a likeness and away from the scene you were asked for; describing one leaves you in charge of the shot.

  "a diminutive Corsican general in a bicorne hat, one hand inside his coat", not the name
  "a long-reigning British monarch in a bright coat and matching hat, handbag over one arm", not the name
  "two American bicycle mechanics in shirtsleeves on a windy dune", not the names

This applies even when the request names someone. The name is what they asked for; the description is how it gets made. It does not apply to two things that are reproduced exactly as given: words inside a \`dialogue\` field, and on-screen text. If a character says a name, they say it.

# Camera

Write camera motion as natural action inside a sentence: "The camera pushes in with small amplitude at slow speed toward the key in her palm." Never as a detached label like "Camera: push in, slow."

Then record the same motion in the shot's \`camera\` field so it can be checked. The two must agree. Available motions: ${CAMERA_TYPES.join(', ')}.
Amplitude is optional and only "${AMPLITUDE_PHRASE.small}" or "${AMPLITUDE_PHRASE.large}" -- medium is implied by leaving it out. Speed is optional and only "${SPEED_PHRASE.slow}" or "${SPEED_PHRASE.fast}" -- normal is implied by leaving it out.

# Shots and beats

Where the style clause goes differs by contract, and the active mode below says which shape applies. Write the first beat of Shot 1 to fit it.

Every later shot is rendered as "[Shot N] At MM:SS.mmm, <your first beat>", so that beat must open with the cut itself: one of ${ORDINARY_CUTS.map((c) => `"${c}"`).join(', ')}.

Cut only to reveal genuinely new subject, space, state, viewpoint or time. If only the distance or angle changes, use camera motion inside one shot instead.

# Speech

Give a stable id to every vocal source, numbered by the order voices actually occur. The first time a voice is heard, establish who it is in the prose: type, age, gender, whether they are on screen, and how they sound. Write the id in the prose too, as (S1), (S2), or (S1,S2) when people speak together.

Put ${DIALOGUE_PLACEHOLDER} in the prose exactly where the spoken line goes, and put the words themselves in the beat's \`dialogue\` field. Write the prose around it so it reads correctly once spliced:

  "the middle-aged baker with a calm, slightly raspy voice (S1) places a fresh loaf on the counter and says: ${DIALOGUE_PLACEHOLDER}"

Dialogue the user supplied is reproduced exactly: never translate, paraphrase, retype or repunctuate it. Base 4.4 requires every original word and punctuation mark verbatim, so a supplied line keeps its ellipses, its "?!", and its missing full stop if that is how it arrived. Changing so much as its punctuation makes the document stop recognising it as the user's own words, which also costs it the protection that stops a later edit rewriting it.

Lines you write yourself end with . ? or ! and carry no decorative punctuation -- no repeated marks, tildes, emoji or bullets.

For voiceover, the prose must contain the exact phrase "${VOICEOVER_PHRASE}", and immediately after the placeholder it must state that the on-screen character's lips remain completely closed.

Name a vocal act only where you supply its words. Writing that someone talks, speaks, argues, rants, sings, narrates or has a conversation, on a beat with no dialogue, is an instruction to vocalise and will be obeyed with invented speech. The only audible words in the clip are the ones in a \`dialogue\` field.

When one spoken line runs across a cut, split it into two beats: mark the first \`crossesCut: "starts"\` and the second \`crossesCut: "continues"\`, write ${SCENETRANS_TAG} into both beats' prose, and say in the prose that the audio carries across -- one of ${CONTINUITY_PHRASES.map((c) => `"${c}"`).join(', ')}. Both halves are required; a start with no continuation is rejected.

When speech is still going as the video ends, mark that beat \`cutoff: true\` and write ${CUTOFF_TAG} into its prose. Only the final beat may carry it.

A held facial state cannot survive the line that breaks it. If a closed mouth or fixed expression is part of a subject's identity, say it returns after the line rather than that it holds through it.

# Style

\`style\` names the medium and finish. How it is rendered depends on the contract; the active mode below says which.

If a Style direction section is provided below, follow it. That section states how far it reaches; do not extend it further than it asks. Otherwise, take the style from the request when the request states one; otherwise from the visible medium and finish of a supplied image; otherwise from the genre. Live action is one option among many and never the default -- do not reach for it because nothing else was specified. Name one medium, one motion treatment and one finish. Do not stack unrelated adjectives, and translate a named style into its concrete traits rather than leaning on the name.

# On-screen text

Any sign, banner, label or subtitle that is actually visible goes in the prose inside English double quotation marks, spelled exactly as it appears, in its original language. List the same strings in the beat's \`visibleText\` field.

# Audio

\`soundscape\` covers ambience, physical action sounds and non-verbal human sounds across the whole video, in ${SOUNDSCAPE_SENTENCE_RANGE[0]}-${SOUNDSCAPE_SENTENCE_RANGE[1]} sentences. Do not repeat dialogue, singing or diegetic music here -- those belong in the beats. Use "N/A" only if total silence was explicitly requested.

\`music\` covers score only the audience can hear, in ${MUSIC_SENTENCE_RANGE[0]}-${MUSIC_SENTENCE_RANGE[1]} sentences. Name instrumentation, tempo, rhythm and dynamics. Never mood words like "emotional" or "epic". Music a character can hear is a diegetic event and belongs in the beats. Use "N/A" when there is no score.`;

// ---------------------------------------------------------------------------
// Mode blocks
// ---------------------------------------------------------------------------

const MODE_BLOCKS: Record<string, string> = {
  T2VA: `# Active mode: T2VA

The style clause opens Shot 1: the output reads "[Shot 1] <style>, <your first beat>". So the style is a clause, not a sentence, and the first beat starts lowercase and continues it -- "a medium-wide shot frames a baker opening the shutters".

No reference media. Build the whole timeline from the request. You may add scene, character, action and sound detail that stays consistent with what was asked for.`,

  I2VA: `# Active mode: I2VA

The style clause opens Shot 1: the output reads "[Shot 1] <style>, <your first beat>". So the style is a clause, not a sentence, and the first beat starts lowercase and continues it -- "a medium-wide shot frames a baker opening the shutters".

<Picture 1> is the actual first frame at 0.00 seconds and belongs to Shot 1.

Open Shot 1 from what is in that image -- subjects, composition, scene anchors -- then develop forward. Character identity, clothing, colours, key objects and spatial relationships carry through unchanged.

Shape: first-frame anchor, action onset, continuous development, result or reaction.`,

  FL2VA: `# Active mode: FL2VA

The style clause opens Shot 1: the output reads "[Shot 1] <style>, <your first beat>". So the style is a clause, not a sentence, and the first beat starts lowercase and continues it -- "a medium-wide shot frames a baker opening the shutters".

Picture 1 is the opening frame and Picture 2 is the ending frame.

Do not describe the two images as two static states. Describe the PATH between them: how the subject moves, how poses change, how objects are handled, how composition and lighting evolve. The final beat must land exactly on Picture 2.

Strongly prefer a single shot so the model can interpolate continuously. Use more only if the request explicitly asked for them.

Shape: first-frame state, observable intermediate changes, progressively narrowing differences, last-frame state.`,

  L2VA: `# Active mode: L2VA

The style clause opens Shot 1: the output reads "[Shot 1] <style>, <your first beat>". So the style is a clause, not a sentence, and the first beat starts lowercase and continues it -- "a medium-wide shot frames a baker opening the shutters".

<Picture 1> is the FINAL frame and belongs to the last shot. It is not where the video starts.

Infer a plausible earlier state from the request and the image, then describe how characters, objects, camera and scene gradually converge on it. The last beat lands on the image exactly.

Shape: plausible preceding state, explicit causal transition, gradual convergence, last-frame landing.`,

  Ref2VA: `# Active mode: Ref2VA

Reference assets supply reusable content rather than boundary frames. Each one already has a label and a declared job, listed under Supplied facts.

Define a subject for each distinct piece of reusable visible content -- a person, an animal, an environment, a costume, a style. One subject may draw on several assets, and one asset may supply several subjects. State what each asset contributes.

Your subject definitions are the binding description of what gets generated. A trait you write there is produced even when it contradicts the asset, and the retention marker does not repair it -- fully_preserved preserves what you wrote, not what the asset shows. Write only traits you can see in the supplied media or that appear in the asset's description. Never fill in hair colour, age, build, wardrobe, material or facial detail by inference. Video and audio assets arrive as a written description and nothing else; there, the description is the whole of your evidence.

State the invariant traits first, then any requested restyle or new role. Do not list a trait merely to say it is being discarded. Identify a subject by its source and its visible traits, never by comparison to an outside character, brand or property -- naming one pulls the design toward that thing and away from the asset.

A frame anchor controls exactly one moment. A first frame controls 0.00 seconds and nothing else; a last frame controls the end and nothing else. Do not write that a composition returns, is restored, is matched again or closes the scene unless the request asked for that recurrence -- in a retention note as much as in a beat.

The style is its own sentence before [Shot 1], not a clause inside it: write one or two complete English sentences describing the look, and start the first beat as an ordinary sentence with a capital -- "A medium shot establishes <Subject 1>, the coffee shop with its exposed brick wall".

\`summary\` classifies the job and names who is in it, in one or two sentences. Keep every verb in it physical. Never write that a subject speaks, talks, argues, rants, narrates, replies or sings: the words live in the beats, and a summary that announces speech produces speech before the scripted line arrives. Physical action, setting, and the reference relationship are all fine there.

Cite subjects in the prose as <Subject 1>, <Subject 2>. Cite assets by the labels you were given. Never invent a label that was not supplied, and never renumber one.

When a subject speaks, write both: <Subject 2> (S1).

Retention says how faithfully each reference survives: ${VISUAL_RETENTION.join(', ')}.

Task types describe what the job actually is: ${TASK_TYPES.join(', ')}. Presence of a video or an audio file does not by itself create a task type -- a video that only supplies a person's appearance is reference generation, not video editing.

Aim for ${REF_DETAIL_WORD_RANGE[0]}-${REF_DETAIL_WORD_RANGE[1]} words across all beats when the job is a generation task. Two exemptions, both from the same guide paragraph: a video-editing job scales its description with the complexity of the source video and is not held to that range, and dialogue-dense material fits the complete spoken timeline ahead of any word count. A single shot does not by itself justify a shorter description -- distribute detail across shots according to how much each one carries. A job can be both at once; the guide's own example prefix is [video editing + reference generation + audio reuse]. When the prefix names video editing alongside a generation type nothing says which of the two applies, so never pad toward the range to satisfy it -- let the information load set the length.`,
};

// ---------------------------------------------------------------------------
// Glitch marks, per mode
// ---------------------------------------------------------------------------

/**
 * What each contract allows a mark to do, appended to the derived glitch block.
 *
 * The prohibitions in that block hold everywhere and so are part of the record's
 * own derivation, which the patch prompt shares. These are affordances, and they
 * turn on which pictures are actual frames. A supplied image already exists and
 * does not contain the mark, so writing that one is visible in it asks the model
 * to reconcile a description against a picture that contradicts it -- the same
 * failure as any other invented first-frame detail, but harder to spot because
 * the mark is meant to look out of place.
 */
export const GLITCH_MODE_NOTES: Record<H3Mode, string> = {
  T2VA:
    'Nothing in this scene is fixed by a reference, so a mark can go anywhere the world would ' +
    'plausibly carry one.',

  I2VA:
    '<Picture 1> is the actual first frame and does not contain a mark. Do not place one in it or ' +
    'describe one as visible there. Marks appear after the opening beat, on surfaces the image ' +
    'establishes or on ones that come into frame later.',

  FL2VA:
    'Both pictures are actual frames and neither contains a mark. Marks live on the path between ' +
    'them: one appears after the opening beat and is gone, out of frame, or turned away before the ' +
    'final beat lands on Picture 2.',

  L2VA:
    '<Picture 1> is the actual final frame and does not contain a mark. Marks belong to the earlier ' +
    'state you infer, and none of them is visible in the last beat.',

  Ref2VA:
    'Marks go on the environment only. Never put one on a referenced subject, and never on a surface ' +
    'an asset supplies -- the references do not contain these strings, and a subject definition or a ' +
    'retention note that mentions one is claiming they do. Keep them out of the summary for the same ' +
    'reason.',
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Facts the model must not compute.
 *
 * Everything here is already exact. Presenting it as supplied fact rather than
 * as something to work out removes the entire class of arithmetic and
 * label-numbering errors from the model's job.
 */
function suppliedFacts(ctx: NormalizedContext, input: CompileInput): string {
  const lines: string[] = [
    `Mode: ${ctx.mode}`,
    `Duration: ${ctx.durationText} seconds${ctx.durationFrames ? ` (${ctx.durationFrames} frames at 24fps)` : ''}`,
    `Latest legal cut time: ${ctx.latestCutMs}ms. Every cut must be strictly before this and strictly after the previous cut.`,
    `Suggested shots: ${ctx.recommendedShots}. Suggested beats: about ${recommendedBeats(ctx.durationSeconds)}.`,
    `Spoken-word budget across the whole clip: roughly ${ctx.spokenWordBudget} words.`,
  ];

  if (ctx.labels.length > 0) {
    lines.push('', 'Reference assets, already labelled. Use these labels exactly:');
    for (const label of ctx.labels) {
      const slot = input.slots.find((s) => s.id === label.slotId);
      if (!slot) continue;
      const roles = slot.roles.join(', ');
      const described = slot.description.trim();
      lines.push(
        `  ${label.ref} -- ${slot.kind}, order ${slot.order}, role: ${roles}${described ? `. ${described}` : ''}`,
      );
    }
    lines.push(
      '',
      'Slot order is 0-based and matches the order above. Refer to slots by that order number in citesSlots.',
    );
  }

  if (input.suppliedDialogue && input.suppliedDialogue.length > 0) {
    lines.push('', 'Dialogue supplied by the user. Reproduce these words EXACTLY, without translation or edits:');
    for (const line of input.suppliedDialogue) lines.push(`  ${JSON.stringify(line)}`);
  }

  return `# Supplied facts\n\n${lines.join('\n')}`;
}

export function buildPlannerSystemPrompt(ctx: NormalizedContext, input: CompileInput): string {
  const blocks = [CORE, MODE_BLOCKS[ctx.mode]];

  const directive = input.creativeMode ? styleDirective(input.creativeMode.selection) : null;
  if (directive) blocks.push(directive);

  const glitch = input.creativeMode ? glitchDirective(input.creativeMode.glitch) : null;
  if (glitch) blocks.push([glitch, GLITCH_MODE_NOTES[ctx.mode]].join('\n\n'));

  blocks.push(suppliedFacts(ctx, input));
  return blocks.join('\n\n');
}

export function buildPlannerUserPrompt(input: CompileInput): string {
  return `Plan this:\n\n${input.idea.trim()}`;
}

/**
 * Output ceiling.
 *
 * Truncation at max_output_tokens is a terminal status that returns partial
 * JSON, so this is set generously: a Ref2VA plan with subjects, retention and
 * 500 words of beats is a large object, and paying for headroom is cheaper than
 * paying for a truncated call twice.
 */
export const PLANNER_MAX_OUTPUT_TOKENS = 16_384;
