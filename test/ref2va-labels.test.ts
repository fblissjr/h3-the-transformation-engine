/**
 * A slot that carries two reference labels.
 *
 * Ref 2.5: a reference video and its synchronized audio track are numbered
 * independently and can come from the same file, so one slot legitimately
 * yields both `<Video N>` and `<Audio N>`. Ref 4: "Use one line for each
 * reference label." Between those two the compiler had four defects, all of
 * them silent, and all of them reproducible on the guide's own examples:
 *
 *   - the serializer chose the label by looking at the retention marker, and
 *     `weak_reference` is in both marker vocabularies, so ref 4.1's own
 *     `<Video 1> (cut and pacing structure): weak_reference` line rendered
 *     under `<Audio 1>`
 *   - the Video label then had no line at all, and coverage keyed by slot, so
 *     one entry cleared both labels and nothing reported it
 *   - the marker-class rule treated any slot with a Video label as visual-only,
 *     so `fully_copy` on the audio line -- the correct ref 4.2 marker, and ref
 *     2.5's own example -- was an error with no way to satisfy it
 *   - `subject_definitions` read one description per slot, so the same sentence
 *     rendered twice, once describing a video under an Audio label
 *
 * The fix is that a retention target names its label kind and a slot can carry
 * a second sentence. Both are optional, so documents written before them keep
 * loading and mean the primary label, which is what they all have.
 */

import { describe, expect, it } from 'vitest';
import type { H3Document, ReferenceSlot, RetentionEntry } from '../src/core/ir/types';
import { H3DocumentSchema } from '../src/core/ir/schema';
import { contextFor } from '../src/core/normalize';
import { assignLabels } from '../src/core/normalize/labels';
import { serialize } from '../src/core/serialize';
import { validate } from '../src/core/validate';
import { ref2vaCoffeeShop } from './fixtures/ref-example';

/** The guide's case: a source video that is edited and whose audio is reused. */
const SOURCE_VIDEO: ReferenceSlot = {
  id: 'vid-source',
  order: 7,
  kind: 'video',
  roles: ['edit_source', 'soundtrack_copy'],
  description: 'is the source video for the target video edit.',
  audioDescription: 'is the synchronized audio track of <Video 3> and is reused in the target video.',
};

function docWithSourceVideo(retention: RetentionEntry[]): H3Document {
  const doc = structuredClone(ref2vaCoffeeShop);
  doc.slots.push(structuredClone(SOURCE_VIDEO));
  doc.retention = [...(doc.retention ?? []), ...retention];
  return doc;
}

const videoLine: RetentionEntry = {
  target: { type: 'slot', slotId: 'vid-source', labelKind: 'Video' },
  context: 'cut and pacing structure',
  marker: 'weak_reference',
  note: 'the cut rhythm of the source is followed loosely.',
};

const audioLine: RetentionEntry = {
  target: { type: 'slot', slotId: 'vid-source', labelKind: 'Audio' },
  context: '',
  marker: 'fully_copy',
  note: 'the original track is reused as the complete final audio.',
};

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe('a video whose soundtrack is used', () => {
  it('yields two standalone labels', () => {
    const labels = assignLabels([SOURCE_VIDEO]);
    expect(labels.map((l) => l.ref)).toEqual(['<Video 1>', '<Audio 1>']);
    expect(labels.every((l) => l.standalone)).toBe(true);
  });

  /** An ordinary reference video does not create an Audio label. Ref 2.5. */
  it('yields one when the soundtrack has no job', () => {
    const quiet = { ...SOURCE_VIDEO, roles: ['edit_source'] as ReferenceSlot['roles'] };
    expect(assignLabels([quiet]).map((l) => l.ref)).toEqual(['<Video 1>']);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('retention_analysis renders one line per label', () => {
  const doc = docWithSourceVideo([videoLine, audioLine]);
  const text = serialize(doc, contextFor(doc)).text;
  const section = text.slice(text.indexOf('retention_analysis:'), text.indexOf('detailed_description:'));

  it('puts the structural line under the Video label, not the Audio one', () => {
    expect(section).toContain('<Video 3> (cut and pacing structure): weak_reference -');
    expect(section).not.toContain('<Audio 2> (cut and pacing structure)');
  });

  it('puts the copy line under the Audio label', () => {
    expect(section).toContain('<Audio 2>: fully_copy -');
  });

  it('gives each label its own sentence in subject_definitions', () => {
    const defs = text.slice(0, text.indexOf('summary:'));
    expect(defs).toContain('<Video 3> is the source video for the target video edit.');
    expect(defs).toContain('<Audio 2> is the synchronized audio track of <Video 3> and is reused');
    // The failure this replaces: the same sentence twice, once under Audio.
    expect(defs).not.toContain('<Audio 2> is the source video');
  });

  it('falls back to the one description when a slot has no audio sentence', () => {
    const doc = docWithSourceVideo([videoLine, audioLine]);
    const slot = doc.slots.find((s) => s.id === 'vid-source')!;
    delete slot.audioDescription;
    const defs = serialize(doc, contextFor(doc)).text;
    expect(defs).toContain('<Audio 2> is the source video for the target video edit.');
  });
});

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

describe('the validator judges each label separately', () => {
  const codesFor = (doc: H3Document) => validate(doc, contextFor(doc)).diagnostics.map((d) => d.code);

  it('accepts the audio marker on the audio line of a dual-labelled slot', () => {
    expect(codesFor(docWithSourceVideo([videoLine, audioLine]))).not.toContain(
      'REF_RETENTION_MARKER_WRONG_CLASS',
    );
  });

  /** The control: an audio marker on the line that is about the Video label. */
  it('still rejects an audio marker on a visual label', () => {
    const wrong: RetentionEntry = { ...videoLine, marker: 'fully_copy' };
    expect(codesFor(docWithSourceVideo([wrong, audioLine]))).toContain(
      'REF_RETENTION_MARKER_WRONG_CLASS',
    );
  });

  it('reports a label with no line of its own', () => {
    expect(codesFor(docWithSourceVideo([audioLine]))).toContain('REF_RETENTION_MISSING');
    expect(codesFor(docWithSourceVideo([videoLine]))).toContain('REF_RETENTION_MISSING');
  });

  it('is satisfied only when both labels have one', () => {
    expect(codesFor(docWithSourceVideo([videoLine, audioLine]))).not.toContain('REF_RETENTION_MISSING');
  });
});

// ---------------------------------------------------------------------------
// Documents written before the fields existed
// ---------------------------------------------------------------------------

describe('a retention entry with no label kind', () => {
  it('is still accepted by the stored-document schema', () => {
    const doc = structuredClone(ref2vaCoffeeShop);
    const stored = JSON.parse(JSON.stringify(doc));
    expect(H3DocumentSchema.safeParse(stored).success).toBe(true);
    for (const entry of stored.retention ?? []) {
      if (entry.target.type === 'slot') expect('labelKind' in entry.target).toBe(false);
    }
  });

  /** It means the primary label, which is what every such document has. */
  it('renders under the primary label and satisfies its coverage', () => {
    const doc = structuredClone(ref2vaCoffeeShop);
    const text = serialize(doc, contextFor(doc)).text;
    expect(text).toContain('<Picture 1>');
    expect(validate(doc, contextFor(doc)).diagnostics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Where the label kind is decided
// ---------------------------------------------------------------------------

/**
 * The planner returns the two kinds in separate fields -- `pictureRetention`
 * and `audioRetention` -- so which label a line is about is known at assembly
 * and never has to be inferred downstream. That is the whole reason the
 * serializer can stop guessing from the marker, and it needs a control of its
 * own: every assertion above builds its entries by hand.
 */
describe('assemble records which label each retention line is about', () => {
  const slots: ReferenceSlot[] = [
    { id: 'pic', order: 0, kind: 'image', roles: ['first_frame'], description: 'a street at dawn.' },
    {
      id: 'vid',
      order: 1,
      kind: 'video',
      roles: ['edit_source', 'soundtrack_copy'],
      description: 'is the source video.',
      audioDescription: 'is its synchronized audio track.',
    },
  ];

  const plan = {
    style: 'The target video is cinematic.',
    speakers: [],
    subjects: [],
    shots: [
      {
        cutAtMs: null,
        cutStyle: null,
        camera: null,
        beats: [
          {
            prose: 'A wide shot holds on the street.',
            speaker: null,
            dialogue: null,
            visibleText: [],
            citesSlots: [],
            citesSubjects: [],
          },
        ],
      },
    ],
    soundscape: 'Traffic passes.',
    music: 'N/A',
    summary: 'The target video is an edited version of the source.',
    taskTypes: ['video editing', 'audio reuse'],
    pictureRetention: [
      { slotOrder: 0, context: '[Shot 1] first frame', marker: 'fully_preserved', note: 'kept.' },
      { slotOrder: 1, context: 'cut and pacing structure', marker: 'weak_reference', note: 'followed loosely.' },
    ],
    audioRetention: [{ slotOrder: 1, marker: 'fully_copy', note: 'reused whole.' }],
  };

  it('gives a picture line Picture, a video line Video, and an audio line Audio', async () => {
    const { assemble } = await import('../src/core/assemble');
    const { normalize } = await import('../src/core/normalize');
    const input = { idea: 'edit it', mode: 'Ref2VA' as const, durationFrames: 192, slots };
    const doc = assemble(plan as never, input, normalize(input), { id: 'd' });

    const kinds = (doc.retention ?? [])
      .filter((e) => e.target.type === 'slot')
      .map((e) => (e.target as { slotId: string; labelKind?: string }))
      .map((t) => `${t.slotId}:${t.labelKind}`);

    expect(kinds).toEqual(['pic:Picture', 'vid:Video', 'vid:Audio']);
  });
});
