import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  /** Resolves with a base64 encoded PNG of the mounted native view. */
  capture(reactTag: number): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('VrtCapture');
