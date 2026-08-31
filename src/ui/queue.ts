/**
 * Run tasks one at a time, in the order they arrive.
 *
 * The editor's direct edits need this because each one reads the document,
 * derives a new one and writes it, with three IndexedDB round trips in the
 * middle. Two that overlap each read the same document and the second wins,
 * so the first is lost -- and both record a version against the same parent,
 * which forks the history for an edit nobody branched. Measured against the
 * running app by blurring two fields in one tick: the soundscape edit vanished
 * from the stored document while its version stayed in the tree, parented
 * beside the music edit rather than before it.
 *
 * A failed task must not stall the queue behind it, which is why the tail is
 * followed on both settle paths. The caller still sees its own rejection.
 */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();

  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
