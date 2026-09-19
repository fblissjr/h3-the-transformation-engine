/**
 * Golden tests against the official guides' worked examples.
 *
 * Byte equality, deliberately. A "close enough" assertion here would let the
 * exact strings the format depends on drift silently, which is the one failure
 * this project exists to prevent.
 *
 * Against the examples less their header cut times, which this build does not
 * write (owner ruling, `shot-header-no-cut-time` in the contract). Everything
 * else in them is still compared byte for byte.
 */

import { describe, expect, it } from 'vitest';
import { serialize, spanAt, rangeOf } from '../src/core/serialize';
import { speakerRef } from '../src/core/serialize/shared';
import { contextFor } from '../src/core/normalize';
import { validate } from '../src/core/validate';
import { withoutHeaderTimes } from '../src/core/ir/examples';
import {
  fl2vaUmbrella,
  fl2vaUmbrellaExpected,
  i2vaTrain,
  i2vaTrainExpected,
  l2vaGlass,
  l2vaGlassExpected,
  t2vaBaker,
  t2vaBakerExpected,
} from './fixtures/guide-examples';
import { ref2vaCoffeeShop, ref2vaCoffeeShopExpected } from './fixtures/ref-example';

const cases = [
  { name: 'T2VA (base guide case 1)', doc: t2vaBaker, vendor: t2vaBakerExpected },
  { name: 'I2VA (base guide case 2)', doc: i2vaTrain, vendor: i2vaTrainExpected },
  { name: 'FL2VA (base guide case 3)', doc: fl2vaUmbrella, vendor: fl2vaUmbrellaExpected },
  { name: 'L2VA (base guide case 4)', doc: l2vaGlass, vendor: l2vaGlassExpected },
  { name: 'Ref2VA (ref guide section 7)', doc: ref2vaCoffeeShop, vendor: ref2vaCoffeeShopExpected },
].map((c) => ({ ...c, expected: withoutHeaderTimes(c.vendor) }));

describe('serializer reproduces the official worked examples, less their header cut times', () => {
  for (const { name, doc, expected } of cases) {
    it(name, () => {
      const { text } = serialize(doc, contextFor(doc));
      expect(text).toBe(expected);
    });
  }

  // The comparison above cannot see the ruling on its own: a serializer still
  // writing the times, paired with a withoutHeaderTimes that did nothing, would
  // agree with it perfectly. These two read each half directly.
  it('writes the later header with no cut time, the cut phrase opening the sentence', () => {
    const { text } = serialize(t2vaBaker, contextFor(t2vaBaker));
    expect(text).toContain('[Shot 2] The camera cuts to a close-up of steam');
  });

  it('does not read cutAtMs into the prompt at all', () => {
    const moved = structuredClone(t2vaBaker);
    moved.shots[1].cutAtMs = 7250;
    expect(serialize(moved, contextFor(moved)).text).toBe(serialize(t2vaBaker, contextFor(t2vaBaker)).text);
  });
});

describe('withoutHeaderTimes', () => {
  // Two copies of one pattern, because a /g regex carries lastIndex between
  // .test() calls and would skip matches in the filter below.
  const timed = /\[Shot \d+\] At \d{2}:\d{2}\.\d{3},/;
  const everyTimed = new RegExp(timed.source, 'g');

  it('removes every header cut time the vendor examples carry', () => {
    // The baker's Shot 2 and the coffee shop's Shots 2 and 3. Counted, so a
    // pattern that stopped matching reads as a failure, not as nothing to do.
    expect(cases.flatMap((c) => c.vendor.match(everyTimed) ?? [])).toHaveLength(3);
    for (const { expected } of cases) expect(expected).not.toMatch(timed);
  });

  it('changes nothing but the time and the letter after it', () => {
    expect(withoutHeaderTimes(t2vaBakerExpected)).toBe(
      t2vaBakerExpected.replace('[Shot 2] At 00:05.000, the camera', '[Shot 2] The camera'),
    );
    for (const { vendor } of cases.filter((c) => !timed.test(c.vendor))) {
      expect(withoutHeaderTimes(vendor)).toBe(vendor);
    }
  });
});

describe('official examples validate clean', () => {
  for (const { name, doc } of cases) {
    it(`${name} has no errors`, () => {
      const result = validate(doc, contextFor(doc));
      expect(result.diagnostics).toEqual([]);
    });
  }
});

describe('source map', () => {
  it('attributes every beat to a span in the rendered text', () => {
    const { text, map } = serialize(t2vaBaker, contextFor(t2vaBaker));
    const range = rangeOf(map, 'shots[0].beats[0].prose');
    expect(range).toBeDefined();
    expect(text.slice(range!.start, range!.end)).toBe(t2vaBaker.shots[0].beats[0].prose);
  });

  it('resolves an offset back to the innermost owning node', () => {
    const { text, map } = serialize(t2vaBaker, contextFor(t2vaBaker));
    const needle = text.indexOf('steam rising');
    const span = spanAt(map, needle);
    expect(span?.path).toBe('shots[1].beats[0].prose');
  });

  it('attributes the alignment line so an edit can highlight it', () => {
    const { text, map } = serialize(i2vaTrain, contextFor(i2vaTrain));
    const range = rangeOf(map, 'alignment');
    expect(range).toBeDefined();
    expect(text.slice(range!.start, range!.end)).toContain('<Picture 1> (from [Shot 1]) is fully referenced.');
  });

  it('leaves scaffolding unattributed rather than inventing an owner', () => {
    const { text, map } = serialize(t2vaBaker, contextFor(t2vaBaker));
    // The section header belongs to no document node.
    expect(spanAt(map, text.indexOf('integrated_multimodal'))).toBeUndefined();
  });
});

describe('derived values follow the document', () => {
  it('recomputes the FL2VA alignment line when a shot is added', () => {
    const twoShot = {
      ...fl2vaUmbrella,
      shots: [
        fl2vaUmbrella.shots[0],
        { ...fl2vaUmbrella.shots[0], id: 'shot-2', index: 2, cutAtMs: 4000, beats: fl2vaUmbrella.shots[0].beats },
      ],
    };
    const { text } = serialize(twoShot, contextFor(twoShot));
    expect(text).toContain('Picture 2 (from Shot 2) aligns with the 8.00-second mark');
  });

  it('recomputes the L2VA duration when the document duration changes', () => {
    const longer = { ...l2vaGlass, durationSeconds: 10.5 };
    const { text } = serialize(longer, contextFor(longer));
    expect(text).toContain('aligns with the 10.50-second mark');
  });

  it('is a pure function of the document', () => {
    const a = serialize(ref2vaCoffeeShop, contextFor(ref2vaCoffeeShop));
    const b = serialize(ref2vaCoffeeShop, contextFor(ref2vaCoffeeShop));
    expect(a.text).toBe(b.text);
    expect(a.map).toEqual(b.map);
  });
});

// ---------------------------------------------------------------------------
// The compound speaker id
// ---------------------------------------------------------------------------

/**
 * `speakerRef` is the one renderer for `(S1)` and `(S1,S2)`. The serializer
 * does not call it -- the planner writes the id into the prose, as the guide
 * asks -- but the validator does, to check the prose against the annotation,
 * and it had grown its own copy that sorted the ordinals as strings. Two
 * implementations of one format is the thing being guarded here; the ten-
 * speaker case is what tells them apart.
 */
describe('speakerRef', () => {
  const speakers = [
    { id: 'a', ordinal: 2, descriptor: 'first' },
    { id: 'b', ordinal: 10, descriptor: 'second' },
    { id: 'pair', ordinal: 11, descriptor: 'both', compoundOf: ['a', 'b'] },
  ];

  it('renders a single speaker', () => {
    expect(speakerRef(speakers[0], speakers)).toBe('(S2)');
  });

  it('orders compound members numerically, not as strings', () => {
    expect(speakerRef(speakers[2], speakers)).toBe('(S2,S10)');
  });

  it('drops a member that is not a declared speaker rather than rendering a hole', () => {
    const orphan = { id: 'x', ordinal: 3, descriptor: 'x', compoundOf: ['a', 'ghost'] };
    expect(speakerRef(orphan, speakers)).toBe('(S2)');
  });

  /**
   * With nothing resolvable there is no id. `()` would have the validator
   * telling the user their prose must contain `()`, alongside the
   * undeclared-member diagnostic that is the real problem.
   */
  it('is null when no member resolves at all', () => {
    const ghosts = { id: 'x', ordinal: 3, descriptor: 'x', compoundOf: ['ghost-1', 'ghost-2'] };
    expect(speakerRef(ghosts, speakers)).toBeNull();
  });
});
