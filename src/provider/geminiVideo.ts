/**
 * Video reference analysis via Google GenAI Files API and Agentic Video Understanding.
 *
 * Videos cannot travel inline as base64 in the Interactions API; they are uploaded
 * to Google's Files API, polled until processed, and referenced by URI in the interaction
 * with `processing: "agentic"` (or "static").
 */

import { GoogleGenAI } from '@google/genai';
import { DEFAULT_MODEL, type GeminiConfig } from './gemini';
import { trace } from '../debug';

export interface VideoAnalysisResult {
  description: string;
  uri: string;
  name: string;
}

export interface AnalyzeVideoParams {
  apiKey: string;
  file: File;
  config?: GeminiConfig;
  onProgress?: (status: string) => void;
  signal?: AbortSignal;
}

/**
 * Uploads a video file to the Files API, polls until PROCESSING completes,
 * and analyzes it using Gemini's Agentic Video Understanding.
 */
export async function analyzeVideoWithGemini(
  params: AnalyzeVideoParams,
): Promise<VideoAnalysisResult> {
  const { apiKey, file, config, onProgress, signal } = params;
  if (!apiKey) throw new Error('Gemini API key is required to analyze video.');

  const ai = new GoogleGenAI({ apiKey });
  const model = config?.model ?? DEFAULT_MODEL;
  const processing = config?.videoProcessing ?? 'agentic';

  onProgress?.('Uploading video to Google Files API…');
  trace('provider', 'provider.video.upload', `Uploading ${file.name} (${Math.round(file.size / 1024)} KB) to Files API`);

  const mimeType = file.type || 'video/mp4';
  let uploadedFile = await ai.files.upload({
    file,
    config: { mimeType },
  });

  if (!uploadedFile.name) {
    throw new Error('Video upload succeeded but no resource name was returned.');
  }
  const fileName = uploadedFile.name;

  trace('provider', 'provider.video.uploaded', `Video uploaded: ${fileName}, state: ${uploadedFile.state}`);

  try {
    // Poll until ACTIVE (handles STATE_UNSPECIFIED and PROCESSING)
    const maxAttempts = 60; // 2 minutes max
    let attempts = 0;
    while (uploadedFile.state !== 'ACTIVE') {
      if (signal?.aborted) throw new Error('Video analysis was aborted.');
      if (uploadedFile.state === 'FAILED') {
        const detail = JSON.stringify((uploadedFile as { error?: unknown }).error ?? '');
        throw new Error(`Video processing failed on Gemini server: ${detail}`);
      }

      attempts++;
      if (attempts > maxAttempts) {
        throw new Error(`Video processing timed out after ${maxAttempts * 2}s.`);
      }

      onProgress?.(`Processing video on Gemini server (attempt ${attempts}/${maxAttempts})…`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      uploadedFile = await ai.files.get({ name: fileName });
    }

    onProgress?.(`Analyzing video (${processing} mode)…`);
    trace('provider', 'provider.video.analyze', `Analyzing ${fileName} with ${model} (processing: ${processing})`);

    const prompt =
      'Analyze this reference video for a MiniMax H3 prompt compiler.\n' +
      'Provide a concise, descriptive breakdown of:\n' +
      '1. Visual setting, atmosphere, lighting, and color palette.\n' +
      '2. Main characters/subjects: physical traits, clothing, and distinguishing features.\n' +
      '3. Key actions, movements, and shot progression.\n' +
      '4. Camera motions and framing.\n' +
      '5. Any notable dialogue, voiceover, or diegetic sound events.\n' +
      'Write purely descriptive sentences suitable for scene prompt conditioning.';

    const interaction = await ai.interactions.create(
      {
        model,
        input: [
          {
            type: 'video',
            uri: uploadedFile.uri ?? '',
            mime_type: uploadedFile.mimeType ?? mimeType,
            processing,
            ...(config?.videoResolution ? { resolution: config.videoResolution } : {}),
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
        store: false,
        generation_config: {
          thinking_level: config?.plannerThinkingLevel ?? 'medium',
          ...(config?.thinkingSummaries ? { thinking_summaries: config.thinkingSummaries } : {}),
          ...(config?.maxOutputTokens ? { max_output_tokens: config.maxOutputTokens } : {}),
        },
      },
      signal ? ({ signal } as never) : undefined,
    );

    const status = String((interaction as { status?: unknown }).status ?? 'unknown');
    const description = String((interaction as { output_text?: unknown }).output_text ?? '').trim();
    const interactionId = (interaction as { id?: string }).id;

    if (status !== 'completed') {
      throw new Error(`Video interaction ended with status "${status}" (ID: ${interactionId ?? 'unknown'}).`);
    }

    trace('provider', 'provider.video.analyzed', `Video analysis completed: ${description.length} chars`, {
      model,
      uri: uploadedFile.uri,
      status,
    });

    return {
      description,
      uri: uploadedFile.uri ?? '',
      name: fileName,
    };
  } finally {
    // Preserve zero-retention privacy: immediately purge video from Google Files API
    try {
      await ai.files.delete({ name: fileName });
      trace('provider', 'provider.video.cleanup', `Cleaned up temporary video file ${fileName}`);
    } catch (cleanupErr) {
      trace('provider', 'provider.video.cleanup.error', `Failed to delete temporary file ${fileName}`, cleanupErr);
    }
  }
}
