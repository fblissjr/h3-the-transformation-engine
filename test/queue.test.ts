/**
 * The serial queue behind direct edits.
 *
 * Extracted rather than written inline in `useEngine` for the reason this repo
 * keeps rediscovering: there is no React renderer in the devDependencies, so a
 * guard written inside the hook is one nothing can reach. What is asserted here
 * is the property the edits need -- one at a time, in order, and a failure does
 * not strand the queue.
 */

import { describe, expect, it } from 'vitest';
import { createSerialQueue } from '../src/ui/queue';

const defer = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createSerialQueue', () => {
  it('never runs two tasks at once, even when they are handed over together', async () => {
    const run = createSerialQueue();
    let running = 0;
    let overlapped = false;
    const task = async () => {
      running += 1;
      if (running > 1) overlapped = true;
      await Promise.resolve();
      running -= 1;
    };
    await Promise.all([run(task), run(task), run(task)]);
    expect(overlapped).toBe(false);
  });

  it('keeps the order they were handed over in', async () => {
    const run = createSerialQueue();
    const order: number[] = [];
    const task = (n: number) => async () => {
      await Promise.resolve();
      order.push(n);
    };
    await Promise.all([run(task(1)), run(task(2)), run(task(3))]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('holds a task until the one before it settles', async () => {
    const run = createSerialQueue();
    const first = defer();
    let secondRan = false;
    const pending = run(() => first.promise);
    void run(async () => {
      secondRan = true;
    });
    await Promise.resolve();
    expect(secondRan).toBe(false);
    first.resolve(null);
    await pending;
    await Promise.resolve();
    await Promise.resolve();
    expect(secondRan).toBe(true);
  });

  it('runs the next task after one rejects, and still reports the rejection', async () => {
    // A stalled queue would be the worse failure: one edit that throws would
    // silently swallow every edit after it.
    const run = createSerialQueue();
    const failed = run(async () => {
      throw new Error('nope');
    });
    await expect(failed).rejects.toThrow('nope');
    await expect(run(async () => 'after')).resolves.toBe('after');
  });

  it('gives each caller the value of its own task', async () => {
    const run = createSerialQueue();
    expect(await Promise.all([run(async () => 'a'), run(async () => 'b')])).toEqual(['a', 'b']);
  });
});
