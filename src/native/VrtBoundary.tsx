import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import { createBoundaryState, registerBoundary, type BoundaryState, type NativeView } from './registry';

type HoldContext = { hold(): () => void };
const VrtContext = createContext<HoldContext | null>(null);

export type VrtBoundaryProps = ViewProps & {
  /** Identifier used by the agent to find this element. Storybook decorators pass `context.id`. */
  id: string;
  /** Extra wait after this boundary is ready, in milliseconds. */
  settleMs?: number;
  children?: React.ReactNode;
};

type ErrorBoundaryProps = { id: string; onError(id: string, error: Error): void; children?: React.ReactNode };

class StoryErrorBoundary extends React.Component<ErrorBoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(this.props.id, error instanceof Error ? error : new Error(String(error)));
  }

  render() {
    if (this.state.error) return <Text style={styles.error}>{`VRT: story threw ${this.state.error.message}`}</Text>;
    return this.props.children;
  }
}

/**
 * Marks the element that the agent captures. The boundary is a plain View that is never flattened,
 * so its bounds are exactly the screenshot bounds.
 */
export function VrtBoundary({ id, settleMs, onLayout, children, ...props }: VrtBoundaryProps) {
  const stateRef = useRef<BoundaryState | null>(null);
  stateRef.current ??= createBoundaryState();
  const state = stateRef.current;

  useLayoutEffect(() => {
    state.settleMs = settleMs;
  }, [state, settleMs]);
  useLayoutEffect(() => registerBoundary(id, state), [id, state]);

  const setRef = useCallback((view: NativeView | null) => { state.view = view; }, [state]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    state.laidOut = width > 0 && height > 0;
    onLayout?.(event);
  }, [state, onLayout]);
  const handleError = useCallback((errorId: string, error: Error) => { state.error = { id: errorId, error }; }, [state]);
  const holds = useMemo<HoldContext>(() => ({
    hold() {
      state.holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        state.holds -= 1;
      };
    },
  }), [state]);

  return (
    <VrtContext.Provider value={holds}>
      <View {...props} ref={setRef} collapsable={false} onLayout={handleLayout}>
        <StoryErrorBoundary key={id} id={id} onError={handleError}>{children}</StoryErrorBoundary>
      </View>
    </VrtContext.Provider>
  );
}

/**
 * Delays the capture of the surrounding VrtBoundary while `pending` is true,
 * for example until an image has loaded. Start with `true` on the first render.
 */
export function useVrtPending(pending: boolean): void {
  const context = useContext(VrtContext);
  useLayoutEffect(() => (pending && context ? context.hold() : undefined), [pending, context]);
}

const styles = StyleSheet.create({
  error: { color: '#b00020', padding: 8 },
});
