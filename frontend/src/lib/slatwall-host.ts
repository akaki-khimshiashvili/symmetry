/**
 * Page side of the slat wall (see slatwall.ts). Owns the canvas and every DOM listener: size, scroll,
 * visibility and pointer events are measured here and handed to the wall.
 *
 * Where the browser can draw WebGL into an OffscreenCanvas, the wall runs in a Web Worker, so three.js is
 * downloaded, parsed and rendered without ever blocking the main thread (no long tasks, smooth scrolling).
 * Otherwise (or if the worker can't get a WebGL context) it runs on the main thread as a lazy chunk.
 * Rejects when WebGL is unavailable altogether; the caller then keeps the flat drawing.
 */
import type { WallPointer, WallQuality } from './slatwall';
import type { FromWorker, ToWorker } from './slatwall.worker';

interface Sink {
  resize(width: number, height: number, dpr: number): void;
  progress(p: number): void;
  visible(v: boolean): void;
  pointer(e: WallPointer): void;
  blur(): void;
}

/** Resolve any CSS colour (oklch included) to sRGB by painting one pixel. */
function cssColor(value: string): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = value;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * How much the wall may ask of this device. 'off' keeps the flat drawing (no WebGL at all): very weak
 * hardware or the user asked to save data. Touch devices start at the light level; the wall then steps
 * down further by itself if frames come in slowly.
 */
export function wallQuality(): WallQuality | 'off' {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 8; // not reported by Safari / Firefox
  if (nav.connection?.saveData || mem <= 2 || cores <= 2) return 'off';
  const touch = matchMedia('(pointer: coarse)').matches;
  if (mem <= 4 || cores <= 4) return touch ? 2 : 1;
  return touch ? 1 : 0;
}

export async function mountSlatWall(host: HTMLElement, opts: { reduce: boolean; quality: WallQuality; woodColor: string; onReady?: () => void }) {
  const wood = cssColor(opts.woodColor);
  let sink: Sink | null = null;
  let canvas: HTMLCanvasElement | undefined;
  let dragId = -1;

  const size = () => ({ width: host.clientWidth, height: host.clientHeight, dpr: devicePixelRatio || 1 });
  const progressNow = () => {
    const r = host.getBoundingClientRect();
    return clamp01((innerHeight - r.top) / (innerHeight + r.height));
  };
  let inView = true;
  const visibleNow = () => inView && !document.hidden;

  /* ---------- Canvas & pointer ---------- */
  const newCanvas = () => {
    const c = document.createElement('canvas');
    c.style.touchAction = 'pan-y'; // horizontal drags are ours; vertical swipes still scroll the page
    c.style.cursor = 'grab';
    const send = (kind: WallPointer['kind'], e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      sink?.pointer({ kind, ndcX: fx * 2 - 1, ndcY: -((e.clientY - r.top) / r.height) * 2 + 1, fx, id: e.pointerId, mouse: e.pointerType === 'mouse', t: e.timeStamp });
    };
    c.addEventListener('pointerenter', (e) => send('enter', e));
    c.addEventListener('pointerdown', (e) => {
      dragId = e.pointerId;
      c.style.cursor = 'grabbing';
      send('down', e);
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId === dragId && e.pointerType !== 'mouse' && !c.hasPointerCapture(e.pointerId)) c.setPointerCapture(e.pointerId);
      send('move', e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === dragId) { dragId = -1; c.style.cursor = 'grab'; }
      send('up', e);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', (e) => send('leave', e));
    host.appendChild(c);
    return c;
  };

  /* ---------- Page listeners (shared by both paths) ---------- */
  new ResizeObserver(() => { const s = size(); sink?.resize(s.width, s.height, s.dpr); sink?.progress(progressNow()); }).observe(host);
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; sink?.visible(visibleNow()); }, { rootMargin: '120px' }).observe(host);
  document.addEventListener('visibilitychange', () => sink?.visible(visibleNow()));
  addEventListener('scroll', () => sink?.progress(progressNow()), { passive: true });
  addEventListener('blur', () => { dragId = -1; if (canvas) canvas.style.cursor = 'grab'; sink?.blur(); });

  /* ---------- Main thread ---------- */
  const onMain = async () => {
    const { createSlatWall } = await import('./slatwall');
    const c = (canvas = newCanvas());
    try {
      sink = await createSlatWall(c, { reduce: opts.reduce, quality: opts.quality, wood, ...size(), onReady: opts.onReady });
    } catch (e) {
      c.remove();
      throw e;
    }
    sink.progress(progressNow());
    sink.visible(visibleNow());
  };

  /* ---------- Worker ---------- */
  const canWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;
  if (!canWorker) return onMain();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let worker: Worker;
    const fallback = () => {
      if (settled) return;
      settled = true;
      sink = null;
      worker?.terminate();
      canvas?.remove(); // a transferred canvas can't get a context on this thread: start with a fresh one
      onMain().then(resolve, reject);
    };
    try {
      worker = new Worker(new URL('./slatwall.worker.ts', import.meta.url), { type: 'module' });
      const c = (canvas = newCanvas());
      const offscreen = c.transferControlToOffscreen();
      const post = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
      worker.onmessage = (ev: MessageEvent<FromWorker>) => {
        if (ev.data.type === 'ready') {
          if (settled) return;
          settled = true;
          opts.onReady?.();
          resolve();
        } else fallback();
      };
      worker.onerror = fallback; // the worker script failed to load or threw
      post({ type: 'init', canvas: offscreen, opts: { reduce: opts.reduce, quality: opts.quality, wood, ...size() } }, [offscreen]);
      sink = {
        resize: (width, height, dpr) => post({ type: 'resize', width, height, dpr }),
        progress: (value) => post({ type: 'progress', value }),
        visible: (value) => post({ type: 'visible', value }),
        pointer: (e) => post({ type: 'pointer', e }),
        blur: () => post({ type: 'blur' }),
      };
      sink.progress(progressNow());
      sink.visible(visibleNow());
    } catch {
      fallback();
    }
  });
}
