/**
 * Golden tests against the official guides' worked examples.
 *
 * Byte equality, deliberately. A "close enough" assertion here would let the
 * exact strings the format depends on drift silently, which is the one failure
 * this project exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import { serialize, spanAt, rangeOf } from '../src/core/serialize';
import { contextFor } from '../src/core/normalize';
import { validate } from '../src/core/validate';
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
  { name: 'T2VA (base guide case 1)', doc: t2vaBaker, expected: t2vaBakerExpected },
  { name: 'I2VA (base guide case 2)', doc: i2vaTrain, expected: i2vaTrainExpected },
  { name: 'FL2VA (base guide case 3)', doc: fl2vaUmbrella, expected: fl2vaUmbrellaExpected },
  { name: 'L2VA (base guide case 4)', doc: l2vaGlass, expected: l2vaGlassExpected },
  { name: 'Ref2VA (ref guide section 7)', doc: ref2vaCoffeeShop, expected: ref2vaCoffeeShopExpected },
];

describe('serializer reproduces the official worked examples', () => {
  for (const { name, doc, expected } of cases) {
    it(name, () => {
      const { text } = serialize(doc, contextFor(doc));
      expect(text).toBe(expected);
    });
  }
});

describe('official examples validate clean', () => {
  for (const { name, doc } of cases) {
    it(`${name} has no errors`, () => {
      const result = validate(doc, contextFor(doc));
      expect(result.errors).toEqual([]);
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
