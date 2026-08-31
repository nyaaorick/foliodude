/**
 * Stable per-device identity, used by the single-writer model (PLAN.md §5
 * Phase 4) to tell "this device wrote the snapshot" from "another device did".
 *
 * `localStorage` rather than the database: the database is the thing being
 * synced, so anything stored there would travel to the other device and stop
 * identifying this one. This is device-local by definition.
 */
import { deviceStore } from './storage';

const DEVICE_ID_KEY = 'foliodude:device-id';
const DEVICE_NAME_KEY = 'foliodude:device-name';

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  const platform = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Device';

  // The extension and the PWA are separate storage origins, so the same
  // physical machine is two writers. Saying which surface it is makes the
  // writer name in the UI actually actionable.
  const surface = typeof browser !== 'undefined' && browser?.runtime?.id ? 'Firefox' : 'Web';
  return `${platform} · ${surface}`;
}

export function getDeviceId(): string {
  const store = deviceStore();
  let id = store?.getItem(DEVICE_ID_KEY);

  if (!id) {
    id = crypto.randomUUID();
    store?.setItem(DEVICE_ID_KEY, id);
  }

  return id;
}

export function getDeviceName(): string {
  const store = deviceStore();
  let name = store?.getItem(DEVICE_NAME_KEY);

  if (!name) {
    name = guessDeviceName();
    store?.setItem(DEVICE_NAME_KEY, name);
  }

  return name;
}

export function setDeviceName(name: string): void {
  deviceStore()?.setItem(DEVICE_NAME_KEY, name.trim() || guessDeviceName());
}
