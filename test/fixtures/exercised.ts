/**
 * Known-good documents for the contract features the golden fixtures never use.
 *
 * The five golden fixtures are the guides' worked examples, and between them
 * they contain no voiceover, no on-screen text, no line crossing a cut and no
 * speech truncated by the end of the video. Four validator rules therefore had
 * a green half that asserted "this code does not fire on known-good input"
 * while the rule was handed nothing it inspects -- an assertion that passes
 * without testing anything and reads as coverage in the run summary.
 *
 * These documents fill that in. They are deliberately NOT golden: nothing here
 * reproduces guide text, and the goldens must not be edited to carry these
 * features, because their whole job is to be byte-exact reproductions.
 *
 * Every document here validates clean. That is the point -- a green half is
 * only worth anything if the input is both known-good and actually looked at,
 * and `test/validate.test.ts` asserts both.
 */

import type { H3Document } from '../../src/core/ir/types';
import { t2vaBaker } from './guide-examples';

/** A copy of the baker with its dialogue and speakers cleared out. */
function bakerShell(id: string): H3Document {
  const doc = structuredClone(t2vaBaker);
  doc.id = id;
  doc.speakers = [];
  for (const shot of doc.shots) {
    for (const beat of shot.beats) {
      delete beat.dialogue;
      delete beat.speakerId;
      beat.prose = beat.prose.replace(/ and says: <d\/>/, '');
      beat.visibleText = [];
    }
  }
  return doc;
}

/**
 * Base 4.4: the exact voiceover phrase, and the lips-closed statement after it.
 *
 * The guide mandates stating the fact rather than a wording, so the rule checks
 * only the phrase -- which is why this fixture exists to prove the rule stays
 * silent on prose that satisfies it.
 */
export const voiceoverBaker: H3Document = (() => {
  const doc = bakerShell('t2va-voiceover');
  doc.speakers = [
    { id: 'sp-1', ordinal: 1, descriptor: 'the baker, unseen, in a calm low register' },
  ];
  const beat = doc.shots[0].beats[0];
  beat.speakerId = 'sp-1';
  beat.prose =
    'a wide shot of a bakery before sunrise. The baker (S1) says in an off-screen voiceover: <d/> ' +
    'while his lips remain completely closed.';
  beat.dialogue = {
    language: 'English',
    text: 'The oven has been on since four.',
    voiceover: true,
    userSupplied: false,
  };
  return doc;
})();

/** Base 4.5: a visible string, quoted in the prose and listed on the beat. */
export const visibleTextBaker: H3Document = (() => {
  const doc = bakerShell('t2va-visible-text');
  const beat = doc.shots[0].beats[0];
  beat.prose = 'a wide shot of a bakery before sunrise, a hand-painted board reading "OPEN" above the door.';
  beat.visibleText = ['OPEN'];
  return doc;
})();

/**
 * Base 4.4: one line running across a cut, tagged on both sides.
 *
 * `<scenetrans>` on each half plus a statement that the audio carries over.
 * The rule counts starts against continues, so both halves are required.
 */
export const crossCutBaker: H3Document = (() => {
  const doc = bakerShell('t2va-cross-cut');
  doc.speakers = [
    { id: 'sp-1', ordinal: 1, descriptor: 'the middle-aged baker with a calm, slightly raspy voice' },
  ];

  const first = doc.shots[0].beats[0];
  first.speakerId = 'sp-1';
  first.prose =
    'a wide shot of a bakery before sunrise as the baker (S1) says: <d/> <scenetrans> and the line ' +
    'continues seamlessly across the cut.';
  first.dialogue = {
    language: 'English',
    text: 'First batch of the morning,',
    voiceover: false,
    crossesCut: 'starts',
    userSupplied: false,
  };

  const second = doc.shots[1].beats[0];
  second.speakerId = 'sp-1';
  second.prose =
    'the camera cuts to a close-up of the sliced loaf <scenetrans> as the baker (S1) finishes: <d/> ' +
    'carrying over from the previous shot.';
  second.dialogue = {
    language: 'English',
    text: 'and the best one.',
    voiceover: false,
    crossesCut: 'continues',
    userSupplied: false,
  };
  return doc;
})();

/** Base 4.4: speech still going when the video ends, in the final beat only. */
export const cutoffBaker: H3Document = (() => {
  const doc = bakerShell('t2va-cutoff');
  doc.speakers = [
    { id: 'sp-1', ordinal: 1, descriptor: 'the middle-aged baker with a calm, slightly raspy voice' },
  ];
  const shot = doc.shots[doc.shots.length - 1];
  const beat = shot.beats[shot.beats.length - 1];
  beat.speakerId = 'sp-1';
  beat.prose = 'the camera cuts to a close-up of steam rising as the baker (S1) begins: <d/> <cutoff>';
  beat.dialogue = {
    language: 'English',
    text: 'Tomorrow we start an hour earlier and',
    voiceover: false,
    cutoff: true,
    userSupplied: false,
  };
  return doc;
})();

export const EXERCISED = [voiceoverBaker, visibleTextBaker, crossCutBaker, cutoffBaker];
