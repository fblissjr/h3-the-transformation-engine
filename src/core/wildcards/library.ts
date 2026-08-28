/**
 * The wildcard library.
 *
 * A wildcard is a category name written into the idea as `{setting}`. Rolling
 * substitutes a value drawn from the category, so one idea becomes many, and
 * the same idea rolled twice is two different clips.
 *
 * These are content, not style. The pack tables next door decide how a clip
 * looks; these decide what is in it -- who, where, what goes wrong. Keeping
 * them apart is what lets you hold a style fixed and vary the subject, which is
 * the only way a comparison between two prompts means anything.
 *
 * Two constraints on every value here, both inherited from the planner prompt
 * rather than invented:
 *
 * 1. Concrete and observable. The planner is told to write what is visible and
 *    audible, never what it means or how it should feel, so a value that names
 *    a mood hands it something it is forbidden to use. `test/wildcards.test.ts`
 *    checks the whole library against the same list of abstractions the prompt
 *    rejects.
 * 2. A fragment, not a sentence. Values are spliced mid-sentence into whatever
 *    the user wrote around them, so they carry no leading capital and no
 *    terminal punctuation.
 */

export interface WildcardCategory {
  readonly id: string;
  /** What the category is for, shown in the picker. */
  readonly description: string;
  readonly values: readonly string[];
}

export const WILDCARDS = [
  {
    id: 'subject',
    description: 'Who or what the clip is about',
    values: [
      'a night-shift baker',
      'a bicycle courier with a cracked phone screen',
      'a lighthouse keeper',
      'a woman repairing a neon sign',
      'a boy carrying a fish tank',
      'a street sweeper on an empty avenue',
      'an elderly diver checking her gauges',
      'a puppeteer between shows',
      'a locksmith working a stubborn cylinder',
      'two sisters sharing one umbrella',
      'a beekeeper in a cheap suit',
      'a projectionist threading film',
      'a snow-plough driver eating lunch',
      'a violin maker sanding a scroll',
    ],
  },
  {
    id: 'action',
    description: 'What physically happens',
    values: [
      'unlocks a door that has swollen in the damp',
      'carries something too heavy across a courtyard',
      'wipes condensation off a window and looks through it',
      'sorts a pile of objects into two uneven stacks',
      'lights a burner that catches on the third try',
      'unwraps something slowly and stops halfway',
      'climbs a ladder to change a bulb',
      'counts coins onto a countertop',
      'pulls a sheet off furniture in an empty room',
      'ties a knot, checks it, and unties it again',
      'runs a hand along a wall looking for a switch',
      'pours liquid until it nearly overflows',
      'folds a large map badly',
      'catches something falling without looking up',
    ],
  },
  {
    id: 'setting',
    description: 'Where it happens',
    values: [
      'a municipal swimming pool after closing',
      'a stairwell with one working light',
      'the loading bay behind a theatre',
      'a laundrette at four in the morning',
      'a greenhouse with taped-up panes',
      'a ferry waiting room',
      'a rooftop covered in gravel and aerials',
      'a corridor lined with filing cabinets',
      'an underpass with standing water',
      'a taxidermy workshop',
      'a car park on the top level',
      'a school gym set up for something else',
      'a shop that is being either stocked or emptied',
      'a railway signal box',
    ],
  },
  {
    id: 'time',
    description: 'When',
    values: [
      'twenty minutes before sunrise',
      'the last hour of a long afternoon',
      'just after a power cut ends',
      'midday under thick cloud',
      'the blue hour after sunset',
      'the middle of the night',
      'during a lunch break',
      'right as the lights come on',
    ],
  },
  {
    id: 'weather',
    description: 'Air and sky',
    values: [
      'fine rain that never quite stops',
      'wind strong enough to move loose paper',
      'fog thick enough to soften the far wall',
      'hard flat sunlight with no cloud',
      'wet snow that melts on contact',
      'still humid air before a storm',
      'frost on every horizontal surface',
      'heat shimmer over dark ground',
    ],
  },
  {
    id: 'prop',
    description: 'One object that matters',
    values: [
      'a thermos with a dented lid',
      'a single unmatched glove',
      'a ring of keys, most of them unlabelled',
      'a birthday cake in a plain box',
      'a folding chair with a broken hinge',
      'a bucket half full of something',
      'a transistor radio',
      'a plant that has outgrown its pot',
      'a ticket stub kept in a pocket',
      'a mirror leaning against a wall',
      'a stack of unopened post',
      'a torch with failing batteries',
    ],
  },
  {
    id: 'complication',
    description: 'The thing that goes sideways',
    values: [
      'the object turns out to be heavier than expected',
      'something spills and is only half cleaned up',
      'a second person arrives at the worst moment',
      'the light fails and comes back',
      'a door closes on its own',
      'the wrong item has been brought',
      'something breaks quietly and nobody notices yet',
      'an animal gets into the space',
      'the floor is more slippery than it looks',
      'a phone rings and is ignored',
      'a queue forms behind them',
      'the power tool will not start',
    ],
  },
  {
    id: 'sound',
    description: 'One audible event',
    values: [
      'a fluorescent tube ticking as it warms up',
      'a distant train passing every so often',
      'water moving in a pipe behind the wall',
      'a fan cycling on and off',
      'gulls arguing on a roof',
      'a shutter being pulled down somewhere nearby',
      'the hum of a chest freezer',
      'footsteps on a floor above',
      'rain finding a loose gutter',
      'a kettle reaching the boil',
    ],
  },
  {
    id: 'material',
    description: 'A surface or texture in frame',
    values: [
      'chipped enamel',
      'wet galvanised steel',
      'unfinished plywood',
      'cracked vinyl upholstery',
      'condensation-beaded glass',
      'flaking municipal paint',
      'oiled brass',
      'salt-stained concrete',
      'worn terrazzo',
      'sun-bleached tarpaulin',
    ],
  },
  {
    id: 'creature',
    description: 'Something alive that is not the subject',
    values: [
      'a heron standing in shallow water',
      'a cat asleep somewhere inconvenient',
      'moths circling a work light',
      'a dog waiting at the edge of frame',
      'pigeons on a ledge',
      'a wasp against the inside of a window',
      'koi under a dark surface',
      'a horse in a field beyond the fence',
    ],
  },
  {
    id: 'era',
    description: 'When the world of the clip is set',
    values: [
      'the present day',
      'the late 1970s',
      'the mid 1990s',
      'the 1930s',
      'a near future with visibly older infrastructure',
      'the early 2000s',
    ],
  },
  {
    id: 'scale',
    description: 'How big the moment is',
    values: [
      'one small task, start to finish',
      'the tail end of something much larger',
      'a handover between two people',
      'the moment before a decision',
      'an interruption to a routine',
      'the last of a repeated action',
    ],
  },
] as const satisfies readonly WildcardCategory[];

/** Derived from the table, so adding a category is a one-place edit. */
export type WildcardCategoryId = (typeof WILDCARDS)[number]['id'];

const byId: ReadonlyMap<string, WildcardCategory> = new Map(WILDCARDS.map((c) => [c.id, c]));

/** Takes a bare string: the name comes out of user-typed text. */
export function getCategory(id: string): WildcardCategory | undefined {
  return byId.get(id);
}

export const CATEGORY_IDS: readonly string[] = WILDCARDS.map((c) => c.id);
