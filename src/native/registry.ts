import type React from 'react';
import type { View } from 'react-native';

export type NativeView = React.ComponentRef<typeof View>;

/** Mutable state owned by one mounted VrtBoundary. */
export type BoundaryState = {
  view: NativeView | null;
  laidOut: boolean;
  holds: number;
  settleMs: number | undefined;
  error: { id: string; error: Error } | null;
};

const boundaries = new Map<string, BoundaryState>();
const POLL_MS = 16;

export function createBoundaryState(): BoundaryState {
  return { view: null, laidOut: false, holds: 0, settleMs: undefined, error: null };
}

/** Registers a boundary under a story id. Returns a function that removes it again. */
export function registerBoundary(id: string, state: BoundaryState): () => void {
  boundaries.set(id, state);
  return () => {
    if (boundaries.get(id) === state) boundaries.delete(id);
  };
}

export function getBoundary(id: string): BoundaryState | undefined {
  return boundaries.get(id);
}

function isReady(state: BoundaryState | undefined): state is BoundaryState {
  return !!state && !!state.view && state.laidOut && state.holds === 0;
}

function describeWait(id: string, state: BoundaryState | undefined, timeoutMs: number): string {
  const prefix = `Story "${id}" was not ready within ${timeoutMs} ms`;
  if (!state) return `${prefix}: no VrtBoundary with this id was mounted. Check that the story exists and that the withVrt decorator is installed.`;
  if (!state.view || !state.laidOut) return `${prefix}: its VrtBoundary has not been laid out with a nonzero size.`;
  return `${prefix}: ${state.holds} useVrtPending hold(s) were never released.`;
}

/** Waits until the boundary for `id` is mounted, laid out, and not held by useVrtPending. */
export async function waitForBoundary(id: string, timeoutMs: number): Promise<BoundaryState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = boundaries.get(id);
    if (state?.error && state.error.id === id) throw state.error.error;
    if (isReady(state)) return state;
    if (Date.now() >= deadline) throw new Error(describeWait(id, state, timeoutMs));
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }
}
