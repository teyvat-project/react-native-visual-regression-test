import type React from 'react';
import { findNodeHandle, Platform } from 'react-native';
import NativeVrtCapture from './NativeVrtCapture';
import type { NativeView } from './registry';

export type CaptureTarget = NativeView | React.RefObject<NativeView | null>;

function isRefObject(target: CaptureTarget): target is React.RefObject<NativeView | null> {
  return typeof target === 'object' && target !== null && 'current' in target;
}

/** Captures a mounted native view and resolves with a base64 encoded PNG. */
export async function captureView(target: CaptureTarget): Promise<string> {
  const view = isRefObject(target) ? target.current : target;
  if (!view) throw new Error('VRT capture target is not mounted');
  const tag = findNodeHandle(view as unknown as React.Component);
  if (tag == null) throw new Error('VRT could not resolve the native view tag');
  if (!NativeVrtCapture) {
    throw new Error(
      `The VrtCapture native module is not available on ${Platform.OS}. ` +
        'Rebuild the app after installing react-native-visual-regression-test.',
    );
  }
  return NativeVrtCapture.capture(tag);
}
