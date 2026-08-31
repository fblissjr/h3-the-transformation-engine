/**
 * Client-side image downscaling.
 *
 * `/v1/messages` has no resize parameter -- deliberately, because Messages
 * clients are expected to resize before sending. Gemini accepts a large inline
 * image and downscales it server-side, so the reference images in a slot are
 * whatever the user dropped in, at whatever a phone camera produces. Sent
 * unchanged to a local vision tower that is one machine with one GPU, that is
 * paid for twice: in visual tokens and in prefill time, on a server that runs
 * one generation at a time for this app.
 *
 * The targets match what heylook's own frontend does: longest edge around
 * 2048px, photos re-encoded to JPEG at 0.85, PNG kept as PNG, EXIF orientation
 * honoured.
 *
 * This is the one piece of the provider layer that needs the DOM, which is why
 * it is here and not in `src/core/`. When the APIs it needs are absent -- a
 * test run, a Node script -- it returns the attachment untouched rather than
 * throwing, so the request still goes out with a working image. Callers get a
 * smaller image or the original, never a failure.
 */

import type { ImageAttachment } from '../types';

export const MAX_EDGE = 2048;
export const JPEG_QUALITY = 0.85;

/** PNG survives as PNG so that flat-colour reference art keeps its edges. */
const KEEP_FORMAT = new Set(['image/png']);

/**
 * True when this runtime can actually resize.
 *
 * Exported so a caller can tell "the image was already small enough" from "this
 * build cannot resize at all", which are the same return value otherwise.
 */
export function canResize(): boolean {
  return typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';
}

export async function resizeAttachment(
  attachment: ImageAttachment,
  maxEdge: number = MAX_EDGE,
): Promise<ImageAttachment> {
  if (!canResize()) return attachment;

  try {
    const source = await blobFrom(attachment);
    // `from-image` is what honours EXIF orientation; the default ignores it and
    // a phone photo arrives rotated.
    const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });

    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxEdge) {
      bitmap.close();
      return attachment;
    }

    const scale = maxEdge / longest;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return attachment;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const mimeType = KEEP_FORMAT.has(attachment.mimeType) ? attachment.mimeType : 'image/jpeg';
    const blob = await canvas.convertToBlob({ type: mimeType, quality: JPEG_QUALITY });
    return { base64: await base64Of(blob), mimeType };
  } catch {
    // A corrupt or unsupported image is not a reason to fail the whole call.
    // The server gets the original and decides for itself.
    return attachment;
  }
}

export function resizeAll(
  attachments: ImageAttachment[],
  maxEdge: number = MAX_EDGE,
): Promise<ImageAttachment[]> {
  return Promise.all(attachments.map((a) => resizeAttachment(a, maxEdge)));
}

async function blobFrom(attachment: ImageAttachment): Promise<Blob> {
  const binary = atob(attachment.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: attachment.mimeType });
}

async function base64Of(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) on a multi-megabyte image overflows
  // the argument limit and throws, which is a crash rather than a large image.
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
