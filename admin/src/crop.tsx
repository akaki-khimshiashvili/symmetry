import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './ui';

export type Orientation = 'portrait' | 'landscape';

/** Width / height of the frame each product type gets on the site (catalogue cards use exactly these). */
export const RATIO: Record<Orientation, number> = { portrait: 3 / 4, landscape: 4 / 3 };
const FORMATS: { key: Orientation; label: string; hint: string }[] = [
  { key: 'portrait', label: 'ვერტიკალური', hint: '3:4' },
  { key: 'landscape', label: 'ჰორიზონტალური', hint: '4:3' },
];
const MAX_ZOOM = 4;
/** Longest side of the cropped file; the server stores at most 2560 px anyway. */
const MAX_EDGE = 2560;

type Box = { w: number; h: number };
type Pos = { x: number; y: number };

/**
 * Crop step for product photos. Every chosen photo is framed at the product's shape (3:4 or 4:3)
 * before upload, so it sits on the site exactly as framed here. Drag to move, wheel / slider to zoom.
 * Switching the format also switches the product's type (the parent decides what that means).
 */
export function CropDialog({ files, orientation, onOrientation, onDone, onClose }: {
  files: File[];
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
  onDone: (cropped: File[]) => void;
  onClose: () => void;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const imgEl = useRef<HTMLImageElement>(null);
  const [idx, setIdx] = useState(0);
  const [out, setOut] = useState<File[]>([]);
  const [url, setUrl] = useState('');
  const [nat, setNat] = useState<Box | null>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ id: number; sx: number; sy: number; start: Pos } | null>(null);

  const file = files[idx];
  const ratio = RATIO[orientation];

  useEffect(() => { dlg.current?.showModal(); }, []);

  // Current photo as an object URL.
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setNat(null);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Stage size follows the dialog.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Crop frame: as large as fits the stage with a margin, centred.
  const pad = 24;
  const fw = Math.max(1, Math.min(box.w - pad * 2, (box.h - pad * 2) * ratio));
  const fh = fw / ratio;
  const fx = (box.w - fw) / 2;
  const fy = (box.h - fh) / 2;
  // Zoom 1 = the photo just covers the frame.
  const base = nat ? Math.max(fw / nat.w, fh / nat.h) : 1;
  const scale = base * zoom;

  const clamp = (p: Pos, s = scale): Pos => nat
    ? { x: Math.min(0, Math.max(fw - nat.w * s, p.x)), y: Math.min(0, Math.max(fh - nat.h * s, p.y)) }
    : p;

  // A new photo, format or stage size starts centred at zoom 1.
  useEffect(() => {
    if (!nat) return;
    setZoom(1);
    setPos({ x: (fw - nat.w * base) / 2, y: (fh - nat.h * base) / 2 });
  }, [nat, orientation, box.w, box.h]);

  /** Zoom to z, keeping the point (px, py) of the frame still. */
  const zoomTo = (z: number, px = fw / 2, py = fh / 2) => {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    const k = nz / zoom;
    setZoom(nz);
    setPos(clamp({ x: px - (px - pos.x) * k, y: py - (py - pos.y) * k }, base * nz));
  };

  const onDown = (e: PointerEvent) => {
    if (!nat) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, start: pos };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos(clamp({ x: d.start.x + e.clientX - d.sx, y: d.start.y + e.clientY - d.sy }));
  };
  const onUp = () => { drag.current = null; };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = stage.current!.getBoundingClientRect();
    zoomTo(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left - fx, e.clientY - r.top - fy);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, Pos> = { ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
    if (moves[e.key]) { e.preventDefault(); setPos(clamp({ x: pos.x + moves[e.key].x, y: pos.y + moves[e.key].y })); }
    else if (e.key === '+' || e.key === '=') zoomTo(zoom * 1.15);
    else if (e.key === '-') zoomTo(zoom / 1.15);
  };

  const next = (list: File[]) => {
    if (idx + 1 < files.length) { setOut(list); setIdx(idx + 1); }
    else { dlg.current?.close(); onDone(list); }
  };

  const confirm = async () => {
    const img = imgEl.current;
    if (!img || !nat) return;
    setBusy(true);
    try {
      // The part of the original photo inside the frame.
      const sx = -pos.x / scale, sy = -pos.y / scale, sw = fw / scale;
      const k = Math.min(1, MAX_EDGE / Math.max(sw, sw / ratio));
      const ow = Math.max(1, Math.round(sw * k));
      const oh = Math.max(1, Math.round(ow / ratio));
      const c = document.createElement('canvas');
      c.width = ow; c.height = oh;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, ow, oh);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sw / ratio, 0, 0, ow, oh);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('crop failed');
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      next([...out, new File([blob], name, { type: 'image/jpeg' })]);
    } finally { setBusy(false); }
  };

  const close = () => { dlg.current?.close(); onClose(); };

  return (
    <dialog ref={dlg} class="crop" onCancel={(e) => { e.preventDefault(); close(); }} aria-labelledby="crop-title">
      <header class="crop-head">
        <div>
          <h2 id="crop-title">ფოტოს კადრირება{files.length > 1 && <span class="muted"> · {idx + 1}/{files.length}</span>}</h2>
          <p class="muted small">გადაათრიეთ და გაადიდეთ ფოტო. საიტზე ზუსტად ჩარჩოში მოქცეული ნაწილი გამოჩნდება.</p>
        </div>
        <button type="button" class="icon-btn" onClick={close} aria-label="დახურვა"><Icon name="close" /></button>
      </header>

      <fieldset class="seg-field crop-format">
        <legend>ფორმატი (პროდუქტის ტიპი)</legend>
        <div class="seg">
          {FORMATS.map((f) => (
            <label key={f.key} class={orientation === f.key ? 'on' : ''}>
              <input type="radio" name="crop-format" value={f.key} checked={orientation === f.key} onChange={() => onOrientation(f.key)} />
              <span class={`crop-shape ${f.key}`} aria-hidden="true" />{f.label} <span class="muted small">{f.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div
        ref={stage}
        class="crop-stage"
        tabIndex={0}
        aria-label="კადრირების არე: ისრებით გადაადგილება, + და − გადიდება"
        onPointerDown={onDown as any}
        onPointerMove={onMove as any}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel as any}
        onKeyDown={onKey as any}
      >
        {url && (
          <img
            ref={imgEl}
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => { const i = e.currentTarget; setNat({ w: i.naturalWidth, h: i.naturalHeight }); }}
            style={nat ? { left: `${fx + pos.x}px`, top: `${fy + pos.y}px`, width: `${nat.w * scale}px`, height: `${nat.h * scale}px` } : { opacity: 0 }}
          />
        )}
        <div class="crop-frame" style={{ left: `${fx}px`, top: `${fy}px`, width: `${fw}px`, height: `${fh}px` }} aria-hidden="true" />
      </div>

      <div class="crop-zoom">
        <span class="muted small">−</span>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onInput={(e) => zoomTo(Number(e.currentTarget.value))} aria-label="გადიდება" />
        <span class="muted small">+</span>
      </div>

      <footer class="crop-foot">
        <button type="button" class="btn ghost" onClick={() => next(out)} disabled={busy}>{files.length > 1 ? 'ამ ფოტოს გამოტოვება' : 'გაუქმება'}</button>
        <button type="button" class="btn primary" onClick={confirm} disabled={busy || !nat}>
          <Icon name="check" />{idx + 1 < files.length ? 'შემდეგი' : 'ატვირთვა'}
        </button>
      </footer>
    </dialog>
  );
}
