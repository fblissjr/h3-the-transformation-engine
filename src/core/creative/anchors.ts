/**
 * Style reference anchors from the H3 Prompt Director Shareable Pack.
 *
 * Each anchor maps a cultural, historical, or studio reference to concrete,
 * observable craft traits. The names are descriptive rather than proprietary --
 * they translate studio aliases into visible, audible, and temporal properties.
 *
 * Source: internal/reference_prompting_h3/H3_Prompt_Director_Shareable_Pack_v2_2026-08-13/
 *   09_H3_STYLE_REFERENCE_ANCHORS.md
 */

import type { AnchorId, StyleAnchor } from './types';

export const STYLE_ANCHORS: readonly StyleAnchor[] = [
  // Animation and illustration anchors (1-20)
  {
    id: 1,
    name: 'Early surreal line animation',
    directive: 'Thin monochrome drawn lines, restless line boil, sparse staging, playful metamorphosis through clear intermediate shapes, quick pose changes, paper texture, and slight frame flicker.',
  },
  {
    id: 2,
    name: 'Early theatrical character acting',
    directive: 'Classic hand-drawn character acting with stage-like framing, clean silhouettes, deliberate anticipation, readable performance beats, and complete settles.',
  },
  {
    id: 3,
    name: 'Ornate silhouette fantasy',
    directive: 'Ornate black silhouette figures, decorative patterned environments, articulated cut-paper motion, theatrical profiles, and layered parallax depth.',
  },
  {
    id: 4,
    name: 'Jazz-age rubber-hose',
    directive: 'Monochrome rubber-hose animation with elastic limbs, looping rhythmic bounce, musical action accents, high-contrast shapes, and gentle gate weave.',
  },
  {
    id: 5,
    name: 'Golden-age storybook cel',
    directive: 'Polished hand-drawn cel acting, smooth arcs, painterly storybook backgrounds, warm soft light, strong staging, and natural overlap in hair and clothing.',
  },
  {
    id: 6,
    name: 'Urban surrealism',
    directive: 'Gritty high-contrast ink animation, urban jazz-age settings, rubber-hose motion, surreal visual gags, quick comic snaps, projector flicker, and vintage contrast.',
  },
  {
    id: 7,
    name: 'Theatrical cartoon comedy',
    directive: 'Bold facial shapes, strong key poses, sharp comic timing, controlled smear drawings, elastic squash and stretch, and uncluttered readable staging.',
  },
  {
    id: 8,
    name: 'Precision slapstick chase',
    directive: 'High-energy chase choreography, large anticipations, explosive but readable impacts, exaggerated physical reactions, rapid recoveries, and precise action-sound synchronization.',
  },
  {
    id: 9,
    name: 'Mid-century graphic modernism',
    directive: 'Flat modernist shapes, asymmetric composition, bold restrained color blocks, simplified environments, selective limited movement, and crisp poster-like staging.',
  },
  {
    id: 10,
    name: 'Antique puppet stop-motion',
    directive: 'Antique miniature puppet performance, handcrafted sets, stepped pose increments, subtle registration jitter, tiny lighting variation, soft shadows, and aged film texture.',
  },
  {
    id: 11,
    name: 'Psychedelic pop collage',
    directive: 'Saturated pop-art color, drifting cutout layers, decorative pattern, surreal scale changes, playful graphic transitions, and screen-printed texture.',
  },
  {
    id: 12,
    name: 'Foundational television anime',
    directive: 'Clean line art, flat cel shading, held key poses, selective eye and mouth movement, sparse efficient backgrounds, and dialogue-forward composition.',
  },
  {
    id: 13,
    name: 'Neo-Tokyo high-detail cel realism',
    directive: 'Dense architectural cel detail, grounded mechanical drawing, weighty human and vehicle movement, neon practical light, atmospheric urban haze, and cinematic camera placement.',
  },
  {
    id: 14,
    name: 'Atmospheric cyber-noir anime',
    directive: 'Cool rain-soaked reflections, luminous signage, dense urban atmosphere, contemplative pacing, precise minimal acting, slow motivated camera movement, and restrained bloom.',
  },
  {
    id: 15,
    name: 'Painterly Japanese magical realism',
    directive: 'Richly painted environments, warm natural light, grounded expressive acting, gentle arcs, soft secondary movement, everyday material detail, and restrained magical transformation.',
  },
  {
    id: 16,
    name: 'Prime-time animated sitcom',
    directive: 'Stable sitcom staging, clean flat color, consistent line weight, held body poses, selective mouth and eye animation, and clear shot-reverse-shot blocking.',
  },
  {
    id: 17,
    name: 'Polished feature CG acting',
    directive: 'Stylized feature-quality CG acting, smooth easing, clean arcs, expressive but controlled faces, natural hair and cloth overlap, motivated camera movement, and soft cinematic lighting.',
  },
  {
    id: 18,
    name: 'Snappy CG character comedy',
    directive: 'Bold CG facial expressions, punchy readable poses, fast anticipation and settle, energetic but controlled camera movement, bright character separation, and crisp material response.',
  },
  {
    id: 19,
    name: 'Cinematic tactile stop-motion',
    directive: 'Stepped stop-motion cadence, subtle puppet registration variation, handcrafted fabric and painted surfaces, miniature-scale depth of field, practical falloff, and tiny exposure flicker.',
  },
  {
    id: 20,
    name: 'Comic-halftone stepped hybrid',
    directive: 'Inked comic contours, halftone shading, offset color accents, stepped timing on key beats, graphic impact frames, stylized motion streaks, and dynamic panel-like camera composition.',
  },
  // Live-action, commercial, and game anchors (21-30)
  {
    id: 21,
    name: 'Symmetrical storybook live action',
    directive: 'Precise centered compositions, planar camera movement, controlled pastel production design, theatrical blocking, carefully arranged props, dry visual timing, and restrained film texture.',
  },
  {
    id: 22,
    name: 'Neon urban neo-noir',
    directive: 'Photoreal night exteriors, wet reflective surfaces, deep shadow separation, colored practical lights, volumetric haze, slow investigative camera movement, and restrained anamorphic flare.',
  },
  {
    id: 23,
    name: 'Premium technology commercial',
    directive: 'Precise product geometry, dark controlled environment, narrow moving highlights, macro surface detail, slow exact camera arcs, clean negative space, and sparse high-definition handling sounds.',
  },
  {
    id: 24,
    name: 'Beauty and fragrance campaign',
    directive: 'Soft sculpted light, controlled skin and glass highlights, shallow macro focus, elegant slow gesture, drifting atmospheric particles, deliberate negative space, and refined material detail.',
  },
  {
    id: 25,
    name: 'Sportswear kinetic commercial',
    directive: 'Decisive athletic movement, low tracking angles, short motivated speed changes, crisp silhouettes, visible fabric response, grounded impacts, and rhythmic edit accents.',
  },
  {
    id: 26,
    name: 'Observational documentary',
    directive: 'Available-light realism, responsive handheld framing, natural exposure shifts, unforced behavior, imperfect foreground occlusion, location ambience, diegetic sound only.',
  },
  {
    id: 27,
    name: '1970s 16mm documentary',
    directive: 'Handheld 16mm photography, pronounced organic grain, compact highlight latitude, slight color drift, practical zoom behavior, natural location sound, and restrained editorial cutting.',
  },
  {
    id: 28,
    name: '1990s camcorder memory',
    directive: 'Consumer camcorder framing, soft tape detail, chroma bleed, auto-exposure pumping, occasional tracking instability, onboard-microphone perspective, and low tape hiss.',
  },
  {
    id: 29,
    name: 'Third-person gameplay readability',
    directive: 'Third-person follow framing, stable horizon, controlled orbit, readable collision spacing, clear character silhouette, responsive acceleration, and minimal cinematic blur.',
  },
  {
    id: 30,
    name: 'Stylized game cinematic',
    directive: 'High-end real-time rendering, cinematic character blocking, controlled physically based materials, readable action choreography, motivated camera tracking, and coherent environmental effects.',
  },
] as const satisfies readonly StyleAnchor[];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const anchorMap = new Map(STYLE_ANCHORS.map((a) => [a.id, a]));

export function getAnchor(id: AnchorId): StyleAnchor | undefined {
  return anchorMap.get(id);
}
