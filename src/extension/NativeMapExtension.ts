import type { MapViewControllerInterface } from '../controller/MapViewControllerInterface';

export interface NativeMapExtensionDescriptor {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface NativeMapExtensionEvent {
  readonly extensionId: string;
  readonly eventName: string;
  readonly payload: Record<string, unknown>;
}

export type NativeMapExtensionEventHandler = (event: NativeMapExtensionEvent) => void;

export interface NativeMapExtensionCapable extends MapViewControllerInterface {
  upsertNativeMapExtension(
    extension: NativeMapExtensionDescriptor,
    eventHandler?: NativeMapExtensionEventHandler | null,
  ): void;
  removeNativeMapExtension(extensionId: string): void;
}

export function isNativeMapExtensionCapable(
  controller: MapViewControllerInterface | null,
): controller is NativeMapExtensionCapable {
  if (controller == null) return false;
  const candidate = controller as Partial<NativeMapExtensionCapable>;
  return typeof candidate.upsertNativeMapExtension === 'function' &&
    typeof candidate.removeNativeMapExtension === 'function';
}
