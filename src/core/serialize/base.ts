/**
 * The base contract: T2VA, I2VA, FL2VA, L2VA.
 *
 * Shape, from guide section 2.2:
 *
 *   <alignment line>            (absent for T2VA)
 *                               (one blank line)
 *   integrated_multimodal_description: [Shot 1] ... [Shot 2] At 00:03.500, ...
 *
 *   overall_soundscape: ...
 *
 *   non_diegetic_music: ...
 *
 * Shots run inline inside the one description field -- the guide's worked
 * examples put them in a single continuous paragraph, not on separate lines.
 */

import type { H3Document, NormalizedContext } from '../ir/types';
import { Emitter } from './emitter';
import type { SourceSpan } from './emitter';
import { renderAlignmentLine, renderBeats, renderShotHeader, trimStyleTail } from './shared';

export function serializeBase(
  doc: H3Document,
  ctx: NormalizedContext,
): { text: string; map: SourceSpan[] } {
  const e = new Emitter();

  const alignment = renderAlignmentLine(doc, ctx);
  if (alignment) {
    e.writeAt('alignment', alignment);
    e.newline(2);
  }

  // --- integrated_multimodal_description ---------------------------------
  e.write('integrated_multimodal_description: ');
  e.block('shots', () => {
    doc.shots.forEach((shot, shotIndex) => {
      if (shotIndex > 0) e.write(' ');
      const shotPath = `shots[${shotIndex}]`;

      e.block(shotPath, () => {
        e.write(renderShotHeader(shot));
        e.write(' ');

        // The style opens Shot 1 inline, before the first beat's prose.
        if (shotIndex === 0 && doc.style.trim() !== '') {
          e.writeAt('style', trimStyleTail(doc.style));
          e.write(', ');
        }

        renderBeats(shot).forEach((prose, beatIndex) => {
          if (beatIndex > 0) e.write(' ');
          e.writeAt(`${shotPath}.beats[${beatIndex}].prose`, prose);
        });
      });
    });
  });
  e.newline(2);

  // --- overall_soundscape -------------------------------------------------
  e.write('overall_soundscape: ');
  e.writeAt('soundscape', doc.soundscape.trim());
  e.newline(2);

  // --- non_diegetic_music -------------------------------------------------
  e.write('non_diegetic_music: ');
  e.writeAt('music', doc.music.trim());

  return e.build();
}
