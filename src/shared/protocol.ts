// Wire format shared by the on-device agent and the Vitest host server.
// Keep this file free of React Native and Node.js imports.

/** Bump when the HTTP protocol changes incompatibly. */
export const PROTOCOL_VERSION = 1;
export const PROTOCOL_HEADER = 'x-vrt-protocol';
export const DEFAULT_PORT = 8765;

/** Story options read from `parameters.vrt` in Storybook. */
export type VrtParameters = {
  /** Leave this story out of `defineStoryTests`. */
  disable?: boolean;
  /** Extra time to wait after the story has rendered, in milliseconds. */
  settleMs?: number;
  /** pixelmatch color threshold between 0 and 1. */
  threshold?: number;
  /** Number of differing pixels that still passes. */
  maxDiffPixels?: number;
  /** Ratio of differing pixels (0 to 1) that still passes. */
  maxDiffPixelRatio?: number;
};

export type VrtStory = {
  id: string;
  title: string;
  name: string;
  tags: string[];
  parameters: VrtParameters;
};

export type VrtDevice = {
  platform: string;
  osVersion: string;
  /** Android `Build.MODEL`, when available. */
  model?: string;
  /** Window size in density-independent pixels. */
  width: number;
  height: number;
  scale: number;
  fontScale: number;
  colorScheme: string | null;
};

export type HelloRequest = { device: VrtDevice; stories: VrtStory[] };
export type HelloResponse = { sessionId: string };

export type VrtCommand = { requestId: string; storyId: string };
export type NextResponse = { command: VrtCommand | null };

export type ResultRequest = {
  sessionId: string;
  requestId: string;
  pngBase64?: string;
  error?: string;
};

export type ErrorResponse = { error: string };

const NUMERIC_PARAMETERS = ['settleMs', 'threshold', 'maxDiffPixels', 'maxDiffPixelRatio'] as const;

/** Picks the known, JSON-safe options from `parameters.vrt`. */
export function pickVrtParameters(value: unknown): VrtParameters {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const result: VrtParameters = {};
  if (typeof source.disable === 'boolean') result.disable = source.disable;
  for (const key of NUMERIC_PARAMETERS) {
    const option = source[key];
    if (typeof option === 'number' && Number.isFinite(option) && option >= 0) result[key] = option;
  }
  return result;
}
