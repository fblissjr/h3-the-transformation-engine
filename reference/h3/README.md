# The H3 contract

The two official MiniMax guides this compiler implements. They are the source of
truth: where any other source disagrees with them, they win.

| File | Covers |
| --- | --- |
| [VIDEO_PROMPT_WRITING_GUIDE_base_en.md](./VIDEO_PROMPT_WRITING_GUIDE_base_en.md) | T2VA, I2VA, FL2VA, L2VA |
| [VIDEO_PROMPT_WRITING_GUIDE_ref_en.md](./VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) | Ref2VA, the full-reference rewrite format |

They are tracked rather than kept alongside the working notes, because the
project's central claim is that every value in `src/core/ir/vocab.ts` traces to
a line in one of them, and a claim that cannot be checked from a clean checkout
is not a claim. `test/guide-fidelity.test.ts` reads these files directly and
compares the five worked examples to the golden fixtures byte for byte.

Do not edit them. They are a copy of someone else's specification, and an edit
here does not change what H3 does -- it only makes the tests agree with a
contract that no longer exists. If MiniMax publishes a revision, replace a whole
file and let the golden tests report everything the revision changed.

## What is derived from them, and where

| In the guides | In the code |
| --- | --- |
| Base 2.1, the three opening lines | `ALIGNMENT_TEMPLATES` in `src/core/ir/vocab.ts` |
| Base 2.2, the three core fields | `src/core/serialize/base.ts` |
| Base 4.2, cuts | `ORDINARY_CUTS`, `SPECIAL_CUTS`, and the `CUT_STYLE_NOT_IN_PROSE` rule |
| Base 4.3, camera | `CAMERA_TYPES`, `AMPLITUDE_PHRASE`, `SPEED_PHRASE` |
| Base 4.4, speakers and dialogue | `speakerRef`, `<d>`, `<scenetrans>`, `<cutoff>`, the voiceover phrase |
| Base 4.5, on-screen text | the `VISIBLE_TEXT_NOT_QUOTED` rule |
| Base 4.6 and 4.7, the audio sections | `SOUNDSCAPE_SENTENCE_RANGE`, `MUSIC_SENTENCE_RANGE` |
| Base 5, the four worked examples | `test/fixtures/guide-examples.ts` |
| Ref 1, the six sections in order | `src/core/serialize/ref2va.ts` |
| Ref 3, task types | `TASK_TYPES` |
| Ref 4, retention markers | `VISUAL_RETENTION`, `AUDIO_RETENTION` |
| Ref 5.2, the word range | `REF_DETAIL_WORD_RANGE` |
| Ref 5.4, no `(Sx)` in retention | the `REF_SPEAKER_IN_RETENTION` rule |
| Ref 7, the worked example | `test/fixtures/ref-example.ts` |

The rewrite notes that used to sit beside these are secondary sources and stay
out of the repo. When they disagree with the guides, the guides win.
