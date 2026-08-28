/**
 * Path addressing for the document.
 *
 * Paths are the unit of editing. A surgical edit names the paths it touches, a
 * validator diagnostic names the path it failed on, and the serializer's source
 * map keys character ranges by path. Keeping one syntax across all three is what
 * lets a click in the rendered prompt land on the right editor field.
 *
 * Syntax is a plain subset of JS accessors: `shots[0].beats[1].prose`.
 */

export type PathSegment = string | number;

const SEGMENT_RE = /[^.[\]]+/g;

/** Split a path string into segments. Numeric segments become numbers. */
export function parsePath(path: string): PathSegment[] {
  const raw = path.match(SEGMENT_RE);
  if (!raw) return [];
  return raw.map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/** Render segments back to a path string. */
export function formatPath(segments: PathSegment[]): string {
  return segments.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    return acc === '' ? seg : `${acc}.${seg}`;
  }, '');
}

/** Append a segment to a path string. */
export function childPath(path: string, seg: PathSegment): string {
  return formatPath([...parsePath(path), seg]);
}

/** Read the value at a path. Returns undefined for any missing link in the chain. */
export function getAtPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of parsePath(path)) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<PathSegment, unknown>)[seg];
  }
  return cur;
}

/** True when every link in the chain exists, including the leaf. */
export function pathExists(root: unknown, path: string): boolean {
  const segments = parsePath(path);
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return false;
    if (!(seg in (cur as object))) return false;
    cur = (cur as Record<PathSegment, unknown>)[seg];
  }
  return true;
}

/**
 * Immutably set the value at a path, structurally sharing everything off the
 * path. Arrays stay arrays and objects stay objects, so React identity checks
 * only see the branch that actually changed.
 *
 * Throws rather than auto-vivifying: a patch naming a path that does not exist
 * is a bug in the patch, and silently creating the structure would let a
 * hallucinated path write a field nothing reads.
 */
export function setAtPath<T>(root: T, path: string, value: unknown): T {
  const segments = parsePath(path);
  if (segments.length === 0) return value as T;
  return setIn(root, segments, value, path) as T;
}

function setIn(node: unknown, segments: PathSegment[], value: unknown, fullPath: string): unknown {
  const [head, ...rest] = segments;

  if (node === null || node === undefined || typeof node !== 'object') {
    throw new Error(`Cannot set "${fullPath}": "${String(head)}" has no container to write into`);
  }

  if (Array.isArray(node)) {
    if (typeof head !== 'number') {
      throw new Error(`Cannot set "${fullPath}": array indexed with "${String(head)}"`);
    }
    if (head < 0 || head >= node.length) {
      throw new Error(`Cannot set "${fullPath}": index ${head} out of range (length ${node.length})`);
    }
    const next = node.slice();
    next[head] = rest.length === 0 ? value : setIn(node[head], rest, value, fullPath);
    return next;
  }

  const obj = node as Record<PathSegment, unknown>;
  // Checked for the leaf as well as for intermediate links. An earlier version
  // only guarded the intermediate case, so a write to a leaf that did not exist
  // silently created it -- which is exactly the auto-vivification this function
  // documents that it refuses to do.
  if (!(head in obj)) {
    throw new Error(`Cannot set "${fullPath}": "${String(head)}" does not exist`);
  }
  if (rest.length === 0) {
    return { ...obj, [head]: value };
  }
  return { ...obj, [head]: setIn(obj[head], rest, value, fullPath) };
}

/**
 * Every path a patch is permitted to write.
 *
 * Deliberately an allowlist rather than "anything that resolves". Derived values
 * -- shot indices, label ordinals, the alignment line -- must stay derived, and
 * an open patch surface is how they stop being. Anything not listed here is a
 * structural change and goes through a dedicated operation instead.
 */
export const PATCHABLE_LEAVES: readonly string[] = [
  'style',
  'soundscape',
  'music',
  'summary',
  'shots[].beats[].prose',
  'shots[].beats[].visibleText',
  'shots[].beats[].dialogue.text',
  'shots[].beats[].dialogue.language',
  'shots[].camera.type',
  'shots[].camera.amplitude',
  'shots[].camera.speed',
  'shots[].cutAtMs',
  'subjects[].traits',
  'subjects[].retention',
  'subjects[].retentionNote',
  'speakers[].descriptor',
  'retention[].marker',
  'retention[].note',
  'slots[].description',
];

/** Collapse concrete indices to `[]` so a path can be matched against the allowlist. */
export function toPathPattern(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

export function isPatchable(path: string): boolean {
  return PATCHABLE_LEAVES.includes(toPathPattern(path));
}
