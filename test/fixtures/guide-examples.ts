/**
 * Documents reproducing the worked examples from the two official guides.
 *
 * These are the strongest test assets in the project: MiniMax wrote both the
 * input intent and the exact expected output, so a byte-for-byte match is
 * evidence the serializer implements the real contract rather than our reading
 * of it. Any drift here is a genuine regression, not a formatting preference.
 *
 * Sources:
 *   base-guide section 5, cases 1-4 -> t2vaBaker, i2vaTrain, fl2vaUmbrella, l2vaGlass
 *   ref-guide section 7             -> ref2vaCoffeeShop
 */

import type { H3Document } from '../../src/core/ir/types';

/** Fields every base-contract fixture shares. Not `as const`: H3Document wants mutable arrays. */
const BASE: Pick<H3Document, 'schemaVersion' | 'modeLocked' | 'subjects' | 'speakers' | 'slots'> = {
  schemaVersion: '1.0.0',
  modeLocked: true,
  subjects: [],
  speakers: [],
  slots: [],
};

// ---------------------------------------------------------------------------
// Case 1: T2VA
// ---------------------------------------------------------------------------

export const t2vaBaker: H3Document = {
  ...BASE,
  id: 't2va-baker',
  mode: 'T2VA',
  durationFrames: 192, // 17*11 + 5, exactly 8.00s at 24fps
  durationSeconds: 8,
  style: 'Live-action, cinematic',
  speakers: [
    {
      id: 'sp-baker',
      ordinal: 1,
      descriptor: 'the middle-aged baker with a calm, slightly raspy voice',
    },
  ],
  shots: [
    {
      id: 'shot-1',
      index: 1,
      cutAtMs: null,
      camera: { type: 'Push In', amplitude: 'small', speed: 'slow' },
      beats: [
        {
          id: 'b1',
          prose:
            'a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise.',
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
        {
          id: 'b2',
          prose:
            'The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm, ' +
            'slightly raspy voice (S1) places a fresh loaf on the wooden counter and says: <d/>',
          speakerId: 'sp-baker',
          dialogue: {
            language: 'English',
            text: 'First batch of the morning.',
            voiceover: false,
            userSupplied: false,
          },
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
      ],
    },
    {
      id: 'shot-2',
      index: 2,
      cutAtMs: 5000,
      cutStyle: 'the camera cuts to',
      camera: null,
      beats: [
        {
          id: 'b3',
          prose:
            'the camera cuts to a close-up of steam rising from the sliced bread while the baker’s final ' +
            'words carry over from the previous shot.',
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
      ],
    },
  ],
  soundscape:
    'Wooden shutters scrape open over a quiet street as trays clink softly inside the bakery. The doorbell ' +
    'rings once, followed by light footsteps and the crisp sound of bread being sliced.',
  music:
    'A soft acoustic-guitar pattern at a moderate tempo, joined by sparse upright-bass notes and a gentle ' +
    'fade at the end.',
};

export const t2vaBakerExpected = `integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm, slightly raspy voice (S1) places a fresh loaf on the wooden counter and says: <d>[English] First batch of the morning.</d> [Shot 2] At 00:05.000, the camera cuts to a close-up of steam rising from the sliced bread while the baker’s final words carry over from the previous shot.

overall_soundscape: Wooden shutters scrape open over a quiet street as trays clink softly inside the bakery. The doorbell rings once, followed by light footsteps and the crisp sound of bread being sliced.

non_diegetic_music: A soft acoustic-guitar pattern at a moderate tempo, joined by sparse upright-bass notes and a gentle fade at the end.`;

// ---------------------------------------------------------------------------
// Case 2: I2VA
// ---------------------------------------------------------------------------

export const i2vaTrain: H3Document = {
  ...BASE,
  id: 'i2va-train',
  mode: 'I2VA',
  durationFrames: 192,
  durationSeconds: 8,
  style: 'Live-action, cinematic',
  slots: [
    {
      id: 'slot-window',
      order: 0,
      kind: 'image',
      roles: ['first_frame'],
      filename: 'train-window.png',
      description: 'is the first frame of [Shot 1], showing a young woman beside a rain-covered train window.',
    },
  ],
  speakers: [
    { id: 'sp-woman', ordinal: 1, descriptor: 'the quiet, breathy young woman' },
  ],
  shots: [
    {
      id: 'shot-1',
      index: 1,
      cutAtMs: null,
      camera: { type: 'Truck Right', amplitude: 'small', speed: 'slow' },
      beats: [
        {
          id: 'b1',
          prose:
            'the young woman shown in <Picture 1> remains beside the rain-covered train window, preserving ' +
            'her appearance, clothing, seat position, and the carriage layout.',
          visibleText: [],
          citesSlots: ['slot-window'],
          citesSubjects: [],
        },
        {
          id: 'b2',
          prose:
            'The camera trucks right with small amplitude at slow speed as she lifts her gaze from the folded ' +
            'letter toward the passing city lights.',
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
        {
          id: 'b3',
          prose:
            'Her reflection moves across the glass while the quiet, breathy young woman (S1) says: <d/> ' +
            'She folds the letter along its existing crease.',
          speakerId: 'sp-woman',
          dialogue: {
            language: 'English',
            text: 'I get off at the next station.',
            voiceover: false,
            userSupplied: true,
          },
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
      ],
    },
  ],
  soundscape:
    'The train wheels produce a steady metallic rhythm beneath a low ventilation hum. Rain ticks against the ' +
    'window while paper rustles softly in her hands.',
  music: 'Sustained cello notes at a slow tempo with widely spaced piano tones, gradually decreasing in volume.',
};

export const i2vaTrainExpected = `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, the young woman shown in <Picture 1> remains beside the rain-covered train window, preserving her appearance, clothing, seat position, and the carriage layout. The camera trucks right with small amplitude at slow speed as she lifts her gaze from the folded letter toward the passing city lights. Her reflection moves across the glass while the quiet, breathy young woman (S1) says: <d>[English] I get off at the next station.</d> She folds the letter along its existing crease.

overall_soundscape: The train wheels produce a steady metallic rhythm beneath a low ventilation hum. Rain ticks against the window while paper rustles softly in her hands.

non_diegetic_music: Sustained cello notes at a slow tempo with widely spaced piano tones, gradually decreasing in volume.`;

// ---------------------------------------------------------------------------
// Case 3: FL2VA
// ---------------------------------------------------------------------------

export const fl2vaUmbrella: H3Document = {
  ...BASE,
  id: 'fl2va-umbrella',
  mode: 'FL2VA',
  durationFrames: 192,
  durationSeconds: 8,
  style: 'Live-action, cinematic',
  slots: [
    {
      id: 'slot-open',
      order: 0,
      kind: 'image',
      roles: ['first_frame'],
      description: 'is the first frame of [Shot 1], showing a cyclist holding a closed umbrella.',
    },
    {
      id: 'slot-close',
      order: 1,
      kind: 'image',
      roles: ['last_frame'],
      description: 'is the final frame of [Shot 1], showing the cyclist beneath the opened umbrella.',
    },
  ],
  shots: [
    {
      id: 'shot-1',
      index: 1,
      cutAtMs: null,
      camera: { type: 'Pull Out', amplitude: 'small', speed: 'slow' },
      beats: [
        {
          id: 'b1',
          prose:
            'a rain-soaked cyclist begins in the position and framing established by Picture 1, holding a ' +
            'closed black umbrella beside a silver bicycle.',
          visibleText: [],
          citesSlots: ['slot-open'],
          citesSubjects: [],
        },
        {
          id: 'b2',
          prose:
            'The camera pulls out with small amplitude at slow speed as she releases the bicycle handle, ' +
            'raises the umbrella above her shoulder, and presses the runner upward until the canopy opens.',
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
        {
          id: 'b3',
          prose:
            'Water rolls from the expanding fabric while she steps beneath it, rotates the handle into the ' +
            'final angle, and settles into the pose, spacing, and composition established by Picture 2 at the ' +
            'end of the shot.',
          visibleText: [],
          citesSlots: ['slot-close'],
          citesSubjects: [],
        },
      ],
    },
  ],
  soundscape:
    'Rain falls steadily on the pavement, followed by the metallic click of the umbrella runner and the soft ' +
    'snap of the canopy opening. Water drips from the bicycle frame as distant traffic passes.',
  music: 'N/A',
};

export const fl2vaUmbrellaExpected = `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a rain-soaked cyclist begins in the position and framing established by Picture 1, holding a closed black umbrella beside a silver bicycle. The camera pulls out with small amplitude at slow speed as she releases the bicycle handle, raises the umbrella above her shoulder, and presses the runner upward until the canopy opens. Water rolls from the expanding fabric while she steps beneath it, rotates the handle into the final angle, and settles into the pose, spacing, and composition established by Picture 2 at the end of the shot.

overall_soundscape: Rain falls steadily on the pavement, followed by the metallic click of the umbrella runner and the soft snap of the canopy opening. Water drips from the bicycle frame as distant traffic passes.

non_diegetic_music: N/A`;

// ---------------------------------------------------------------------------
// Case 4: L2VA
// ---------------------------------------------------------------------------

export const l2vaGlass: H3Document = {
  ...BASE,
  id: 'l2va-glass',
  mode: 'L2VA',
  durationFrames: null,
  durationSeconds: 6,
  style: 'Live-action, cinematic',
  slots: [
    {
      id: 'slot-broken',
      order: 0,
      kind: 'image',
      roles: ['last_frame'],
      description: 'is the final frame of [Shot 1], showing the broken glass and the hand above it.',
    },
  ],
  shots: [
    {
      id: 'shot-1',
      index: 1,
      cutAtMs: null,
      camera: { type: 'Push In', amplitude: 'small', speed: 'slow' },
      beats: [
        {
          id: 'b1',
          prose:
            'a close shot begins with an intact drinking glass near the edge of a dark wooden table, while ' +
            'the same hand and sleeve visible in <Picture 1> approach from the right.',
          visibleText: [],
          citesSlots: ['slot-broken'],
          citesSubjects: [],
        },
        {
          id: 'b2',
          prose:
            'The camera pushes in with small amplitude at slow speed as the fingertips strike the rim.',
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
        {
          id: 'b3',
          prose:
            'The glass tips, falls, and hits the floor with a sharp impact; cracks spread through it as ' +
            'fragments slide outward.',
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
        {
          id: 'b4',
          prose:
            'Toward the end, the moving pieces lose momentum and settle into the exact broken arrangement, ' +
            'hand position, camera angle, lighting, and final composition established by <Picture 1>.',
          visibleText: [],
          citesSlots: ['slot-broken'],
          citesSubjects: [],
        },
      ],
    },
  ],
  soundscape:
    'Fingertips tap the glass before it scrapes across the tabletop, falls, and breaks with a sharp crash. ' +
    'Small fragments scatter and gradually stop sliding across the floor.',
  music: 'A low electronic pulse at a slow tempo, ending immediately after the glass breaks.',
};

export const l2vaGlassExpected = `How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 6.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a close shot begins with an intact drinking glass near the edge of a dark wooden table, while the same hand and sleeve visible in <Picture 1> approach from the right. The camera pushes in with small amplitude at slow speed as the fingertips strike the rim. The glass tips, falls, and hits the floor with a sharp impact; cracks spread through it as fragments slide outward. Toward the end, the moving pieces lose momentum and settle into the exact broken arrangement, hand position, camera angle, lighting, and final composition established by <Picture 1>.

overall_soundscape: Fingertips tap the glass before it scrapes across the tabletop, falls, and breaks with a sharp crash. Small fragments scatter and gradually stop sliding across the floor.

non_diegetic_music: A low electronic pulse at a slow tempo, ending immediately after the glass breaks.`;
