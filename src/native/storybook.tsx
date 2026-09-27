import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { pickVrtParameters, type VrtStory } from '../shared/protocol';
import { VrtBoundary } from './VrtBoundary';

/** The parts of the Storybook React Native `view` (from storybook.requires) that the agent uses. */
export type StorybookView = {
  _ready?: boolean;
  _storyIndex?: { entries: Record<string, { id: string; title: string; name: string; type?: string; tags?: string[] }> };
  _idToPrepared?: Record<string, { tags?: string[]; parameters?: Record<string, unknown> } | undefined>;
  _channel?: { emit(event: string, ...args: unknown[]): void };
};

export type StoryAdapter = {
  getStories(): Promise<VrtStory[]>;
  selectStory(storyId: string): void | Promise<void>;
};

// Same value as SET_CURRENT_STORY in storybook/internal/core-events.
const SET_CURRENT_STORY = 'setCurrentStory';
const READY_POLL_MS = 100;

/** Adapts the Storybook React Native view to the agent. `view` is resolved lazily from `globalThis.view` by default. */
export function storybookAdapter(getView: () => StorybookView | undefined): StoryAdapter {
  const resolve = (): StorybookView => {
    const view = getView();
    if (!view?._storyIndex || !view._channel) {
      throw new Error(
        'Storybook view was not found. Import ./storybook.requires before starting the agent, or pass `view` to startVrtAgent.',
      );
    }
    return view;
  };

  return {
    async getStories() {
      let view = resolve();
      // The story mapping (tags and parameters) is filled after the Storybook UI mounts.
      while (!view._ready) {
        await new Promise<void>((done) => setTimeout(done, READY_POLL_MS));
        view = resolve();
      }
      return Object.values(view._storyIndex!.entries)
        .filter((entry) => (entry.type ?? 'story') === 'story')
        .map((entry) => {
          const prepared = view._idToPrepared?.[entry.id];
          return {
            id: entry.id,
            title: entry.title,
            name: entry.name,
            tags: prepared?.tags ?? entry.tags ?? [],
            parameters: pickVrtParameters(prepared?.parameters?.vrt),
          };
        });
    },
    selectStory(storyId) {
      const view = resolve();
      if (!view._storyIndex!.entries[storyId]) throw new Error(`Story "${storyId}" does not exist in Storybook`);
      view._channel!.emit(SET_CURRENT_STORY, { storyId, viewMode: 'story' });
    },
  };
}

type DecoratorContext = { id: string; parameters?: { vrt?: { settleMs?: number; style?: StyleProp<ViewStyle> } } };

/**
 * Storybook decorator that wraps every story in a VrtBoundary.
 * The boundary shrinks to its content; set `parameters.vrt.style` to change that per story.
 */
export function withVrt(Story: React.ComponentType, context: DecoratorContext): React.ReactElement {
  const vrt = context.parameters?.vrt;
  return (
    <VrtBoundary id={context.id} settleMs={vrt?.settleMs} style={[{ alignSelf: 'flex-start' }, vrt?.style]}>
      <Story />
    </VrtBoundary>
  );
}
