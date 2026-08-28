/**
 * The full-reference worked example, ref-guide section 7.
 *
 * Kept separate from the base cases because it exercises a different contract
 * and four mechanisms the base modes never touch: the label registry, the
 * task-type prefix, the derived `(appears in ...)` parentheticals, and the
 * two-vocabulary retention table.
 *
 * Note what is NOT in the expected output: no standalone <Picture N> or
 * <Video N> definition lines. Every image here supplies a scene or an identity
 * and every video supplies a person, so all of them are cited inside a
 * <Subject N> instead. Only <Audio 1>, which carries a genuine audio
 * relationship, earns its own line. Getting that wrong was a real bug caught by
 * building this fixture.
 */

import type { H3Document } from '../../src/core/ir/types';

export const ref2vaCoffeeShop: H3Document = {
  schemaVersion: '1.0.0',
  id: 'ref2va-coffee-shop',
  mode: 'Ref2VA',
  modeLocked: true,
  durationFrames: null,
  durationSeconds: 8,
  style: 'The target video uses a realistic multi-camera sitcom style with warm indoor lighting',

  slots: [
    {
      id: 'pic-shop',
      order: 0,
      kind: 'image',
      roles: ['scene'],
      description: 'the coffee shop interior.',
    },
    { id: 'pic-dog-a', order: 1, kind: 'image', roles: ['identity'], description: 'the Samoyed, front view.' },
    { id: 'pic-dog-b', order: 2, kind: 'image', roles: ['identity'], description: 'the Samoyed, side view.' },
    { id: 'pic-dog-c', order: 3, kind: 'image', roles: ['identity'], description: 'the Samoyed, seated.' },
    { id: 'vid-woman', order: 4, kind: 'video', roles: ['identity'], description: 'the blonde woman.' },
    { id: 'vid-man', order: 5, kind: 'video', roles: ['identity'], description: 'the young man.' },
    {
      id: 'aud-voice',
      order: 6,
      kind: 'audio',
      roles: ['voice'],
      description: 'is the voice-timbre reference for <Subject 3> (S1), containing a spoken English vocal layer.',
    },
  ],

  subjects: [
    {
      id: 'subj-shop',
      ordinal: 1,
      sources: [{ slotId: 'pic-shop', provides: 'environment' }],
      traits:
        'is the coffee-shop environment in <Picture 1>, featuring an exposed brick wall, an orange tufted ' +
        'sofa with patterned pillows, a neon sign, and a wooden coffee table.',
      appearsInShots: ['shot-1', 'shot-2', 'shot-3'],
      retention: 'fully_preserved',
      retentionNote:
        'the exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table are retained.',
    },
    {
      id: 'subj-dog',
      ordinal: 2,
      sources: [
        { slotId: 'pic-dog-a', provides: 'appearance' },
        { slotId: 'pic-dog-b', provides: 'appearance' },
        { slotId: 'pic-dog-c', provides: 'appearance' },
      ],
      traits:
        'is the fluffy white Samoyed in <Picture 2>, <Picture 3>, and <Picture 4>, with thick white fur, ' +
        'pointed ears, a dark nose, and a curved tail.',
      appearsInShots: ['shot-1', 'shot-2'],
      retention: 'fully_preserved',
      retentionNote:
        'the Samoyed\'s thick white fur, pointed ears, dark nose, and curved tail are retained.',
    },
    {
      id: 'subj-woman',
      ordinal: 3,
      sources: [{ slotId: 'vid-woman', provides: 'appearance' }],
      traits:
        'is the young blonde woman in <Video 1>, with long blonde hair and a light-pink button-down shirt ' +
        'with rolled-up sleeves.',
      appearsInShots: ['shot-1', 'shot-2', 'shot-3'],
      retention: 'fully_preserved',
      retentionNote: 'the blonde woman\'s identity, long hair, and light-pink shirt are retained.',
    },
    {
      id: 'subj-man',
      ordinal: 4,
      sources: [{ slotId: 'vid-man', provides: 'appearance' }],
      traits:
        'is the young man in <Video 2>, with short wavy brown hair and a dark-grey hoodie with drawstrings.',
      appearsInShots: ['shot-1', 'shot-2'],
      retention: 'fully_preserved',
      retentionNote: 'the young man\'s short wavy brown hair and dark-grey hoodie are retained.',
    },
  ],

  speakers: [
    { id: 'sp-woman', ordinal: 1, descriptor: 'the young woman with a clear youthful voice', subjectId: 'subj-woman' },
    { id: 'sp-man', ordinal: 2, descriptor: 'a casual young male voice with a playful tone', subjectId: 'subj-man' },
  ],

  taskTypes: ['reference generation', 'audio reference'],
  summary:
    'The target video shows <Subject 3> eating a cookie in <Subject 1>. <Subject 4> enters with <Subject 2>, ' +
    'which lunges toward the cookie. The three-shot exchange uses <Audio 1> as the voice-timbre reference for ' +
    '<Subject 3> and ends with a canned audience laugh.',

  retention: [
    {
      target: { type: 'subject', subjectId: 'subj-shop' },
      context: '',
      marker: 'fully_preserved',
      note: 'the exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table are retained.',
    },
    {
      target: { type: 'subject', subjectId: 'subj-dog' },
      context: '',
      marker: 'fully_preserved',
      note: 'the Samoyed\'s thick white fur, pointed ears, dark nose, and curved tail are retained.',
    },
    {
      target: { type: 'subject', subjectId: 'subj-woman' },
      context: '',
      marker: 'fully_preserved',
      note: 'the blonde woman\'s identity, long hair, and light-pink shirt are retained.',
    },
    {
      target: { type: 'subject', subjectId: 'subj-man' },
      context: '',
      marker: 'fully_preserved',
      note: 'the young man\'s short wavy brown hair and dark-grey hoodie are retained.',
    },
    {
      target: { type: 'slot', slotId: 'aud-voice' },
      context: '',
      marker: 'reference',
      note: 'its vocal timbre guides the dialogue delivery of <Subject 3> without copying the original signal.',
    },
  ],

  shots: [
    {
      id: 'shot-1',
      index: 1,
      cutAtMs: null,
      camera: null,
      beats: [
        {
          id: 'r1',
          prose:
            'A medium shot establishes <Subject 1>, the coffee shop with its exposed brick wall, orange ' +
            'tufted sofa, patterned pillows, neon sign, and wooden coffee table. <Subject 3> (S1), the young ' +
            'woman with long blonde hair and a light-pink button-down shirt with rolled-up sleeves, sits on ' +
            'the sofa holding a chocolate-chip cookie. From the left, <Subject 4>, the young man with short ' +
            'wavy brown hair and a dark-grey hoodie with drawstrings, enters holding the leash of ' +
            '<Subject 2>, the thick-furred white Samoyed with pointed ears, a dark nose, and a curved tail. ' +
            'The dog lunges toward the cookie and pulls the leash taut. <Subject 3> (S1) jerks her hand back ' +
            'and, using the clear youthful voice timbre referenced from <Audio 1>, exclaims with light ' +
            'annoyance, <d/> She closes her lips and guards the cookie while <Subject 4> pulls the dog back.',
          speakerId: 'sp-woman',
          dialogue: {
            language: 'English',
            text: 'Hey! Watch your dog!',
            voiceover: false,
            userSupplied: false,
          },
          visibleText: [],
          citesSlots: ['aud-voice'],
          citesSubjects: ['subj-shop', 'subj-dog', 'subj-woman', 'subj-man'],
        },
      ],
    },
    {
      id: 'shot-2',
      index: 2,
      cutAtMs: 3000,
      cutStyle: 'the shot cuts to',
      camera: null,
      beats: [
        {
          id: 'r2',
          prose:
            'the shot cuts to a close-up of <Subject 4> (S2), the young man in the dark-grey hoodie from ' +
            'Shot 1, sitting beside <Subject 3> on the sofa and holding <Subject 2> securely in his arms. ' +
            '<Subject 4> (S2) says in a casual young male voice with a playful tone and an easy ' +
            'conversational pace, <d/> He closes his mouth into an apologetic smile and strokes the dog\'s ' +
            'thick white fur.',
          speakerId: 'sp-man',
          dialogue: {
            language: 'English',
            text: 'He just likes cookies more than me.',
            voiceover: false,
            userSupplied: false,
          },
          visibleText: [],
          citesSlots: [],
          citesSubjects: ['subj-man', 'subj-woman', 'subj-dog'],
        },
      ],
    },
    {
      id: 'shot-3',
      index: 3,
      cutAtMs: 5000,
      cutStyle: 'the shot cuts to',
      camera: null,
      beats: [
        {
          id: 'r3',
          prose:
            'the shot cuts to a close-up of <Subject 3> (S1), the blonde woman in the light-pink shirt from ' +
            'Shot 1. Her annoyance softens as she looks toward the Samoyed. <Subject 3> (S1) replies in the ' +
            'same clear youthful voice referenced from <Audio 1> with an amused cadence, <d/> She smiles and ' +
            'raises the cookie in a small toast-like gesture. A classic canned audience laugh begins ' +
            'immediately after the line and continues through the final frame.',
          speakerId: 'sp-woman',
          dialogue: {
            language: 'English',
            text: 'Well, he has good taste at least.',
            voiceover: false,
            userSupplied: false,
          },
          visibleText: [],
          citesSlots: ['aud-voice'],
          citesSubjects: ['subj-woman'],
        },
      ],
    },
  ],

  soundscape: 'Soft indoor coffee-shop room tone continues throughout the scene.',
  music: 'N/A',
};

export const ref2vaCoffeeShopExpected = `subject_definitions:
<Subject 1> is the coffee-shop environment in <Picture 1>, featuring an exposed brick wall, an orange tufted sofa with patterned pillows, a neon sign, and a wooden coffee table.
<Subject 2> is the fluffy white Samoyed in <Picture 2>, <Picture 3>, and <Picture 4>, with thick white fur, pointed ears, a dark nose, and a curved tail.
<Subject 3> is the young blonde woman in <Video 1>, with long blonde hair and a light-pink button-down shirt with rolled-up sleeves.
<Subject 4> is the young man in <Video 2>, with short wavy brown hair and a dark-grey hoodie with drawstrings.
<Audio 1> is the voice-timbre reference for <Subject 3> (S1), containing a spoken English vocal layer.

summary:
[reference generation + audio reference] The target video shows <Subject 3> eating a cookie in <Subject 1>. <Subject 4> enters with <Subject 2>, which lunges toward the cookie. The three-shot exchange uses <Audio 1> as the voice-timbre reference for <Subject 3> and ends with a canned audience laugh.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table are retained.
<Subject 2> (appears in [Shot 1], [Shot 2]): fully_preserved - the Samoyed's thick white fur, pointed ears, dark nose, and curved tail are retained.
<Subject 3> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the blonde woman's identity, long hair, and light-pink shirt are retained.
<Subject 4> (appears in [Shot 1], [Shot 2]): fully_preserved - the young man's short wavy brown hair and dark-grey hoodie are retained.
<Audio 1>: reference - its vocal timbre guides the dialogue delivery of <Subject 3> without copying the original signal.

detailed_description:
The target video uses a realistic multi-camera sitcom style with warm indoor lighting.
[Shot 1] A medium shot establishes <Subject 1>, the coffee shop with its exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table. <Subject 3> (S1), the young woman with long blonde hair and a light-pink button-down shirt with rolled-up sleeves, sits on the sofa holding a chocolate-chip cookie. From the left, <Subject 4>, the young man with short wavy brown hair and a dark-grey hoodie with drawstrings, enters holding the leash of <Subject 2>, the thick-furred white Samoyed with pointed ears, a dark nose, and a curved tail. The dog lunges toward the cookie and pulls the leash taut. <Subject 3> (S1) jerks her hand back and, using the clear youthful voice timbre referenced from <Audio 1>, exclaims with light annoyance, <d>[English] Hey! Watch your dog!</d> She closes her lips and guards the cookie while <Subject 4> pulls the dog back.
[Shot 2] At 00:03.000, the shot cuts to a close-up of <Subject 4> (S2), the young man in the dark-grey hoodie from Shot 1, sitting beside <Subject 3> on the sofa and holding <Subject 2> securely in his arms. <Subject 4> (S2) says in a casual young male voice with a playful tone and an easy conversational pace, <d>[English] He just likes cookies more than me.</d> He closes his mouth into an apologetic smile and strokes the dog's thick white fur.
[Shot 3] At 00:05.000, the shot cuts to a close-up of <Subject 3> (S1), the blonde woman in the light-pink shirt from Shot 1. Her annoyance softens as she looks toward the Samoyed. <Subject 3> (S1) replies in the same clear youthful voice referenced from <Audio 1> with an amused cadence, <d>[English] Well, he has good taste at least.</d> She smiles and raises the cookie in a small toast-like gesture. A classic canned audience laugh begins immediately after the line and continues through the final frame.

overall_soundscape:
Soft indoor coffee-shop room tone continues throughout the scene.

non_diegetic_music:
N/A`;
