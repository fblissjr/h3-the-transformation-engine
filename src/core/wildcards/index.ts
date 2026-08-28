/**
 * Wildcards: one idea, many clips.
 *
 * `{setting}` in the idea text is a category name. Rolling draws a value for
 * it; the matrix draws every combination of the values you nominate. Both work
 * on the idea string alone, before anything is planned, so nothing downstream
 * ever sees a placeholder.
 *
 * Pure TypeScript, no browser or network.
 */

export type { WildcardCategory, WildcardCategoryId } from './library';
export { WILDCARDS, CATEGORY_IDS, getCategory } from './library';

export type { Placeholder, RollResult } from './expand';
export { roll, rollSeeded, rollRecord, seededRandom, newSeed, placeholdersIn, hasPlaceholders } from './expand';

export type { Matrix, MatrixCell } from './matrix';
export { experimentMatrix, MATRIX_CELL_LIMIT } from './matrix';
