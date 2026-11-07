/// <reference lib="webworker" />
/**
 * Runs the slat wall off the main thread: three.js is parsed, the scene is built and every frame is
 * rendered here, into the page's canvas (transferred as an OffscreenCanvas). slatwall-host.ts sends the
 * page's size, scroll, visibility and pointer events; this answers 'ready' after the first frame, or
 * 'error' if WebGL is unavailable here (the host then falls back to the main thread).
 */
import { createSlatWall, type WallController, type WallOptions, type WallPointer } from './slatwall';

export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; opts: Omit<WallOptions, 'onReady'> }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'progress'; value: number }
  | { type: 'visible'; value: boolean }
  | { type: 'pointer'; e: WallPointer }
  | { type: 'blur' };

export type FromWorker = { type: 'ready' } | { type: 'error'; message: string };

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
let wall: WallController | null = null;
// Messages that arrive while the scene is still being built are applied once it exists.
const pending: ToWorker[] = [];

const apply = (m: ToWorker) => {
  if (!wall) return;
  if (m.type === 'resize') wall.resize(m.width, m.height, m.dpr);
  else if (m.type === 'progress') wall.progress(m.value);
  else if (m.type === 'visible') wall.visible(m.value);
  else if (m.type === 'pointer') wall.pointer(m.e);
  else if (m.type === 'blur') wall.blur();
};

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type !== 'init') {
    if (wall) apply(m);
    else pending.push(m);
    return;
  }
  try {
    wall = await createSlatWall(m.canvas, { ...m.opts, onReady: () => post({ type: 'ready' }) });
    pending.splice(0).forEach(apply);
  } catch (e) {
    post({ type: 'error', message: (e as Error)?.message ?? String(e) });
  }
};
