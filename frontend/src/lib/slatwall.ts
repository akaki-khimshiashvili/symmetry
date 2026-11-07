/**
 * Parametric slat wall, rendered with Three.js.
 *
 * Solid oak slats (rounded edges, per-slat grain and tone) stand off a wall. One wave formula
 * sets every slat's depth and twist. The wall is a shadow-only plane, so the slats sit on the page.
 *
 * Opening (≈2.6s): every slat is already full width and height, lying flat on the wall; then it grows
 * out in 3D to its depth on the wave (and eases into its twist), centre slat first, rippling outward. Meanwhile the key light sweeps across like
 * morning sun (shadows travel). The camera starts in its resting view.
 * Scroll: the camera orbits, the wave travels along the wall and the light shifts a little.
 * Pointer (mouse, pen, finger): slats near the pointer lean out and part around it; a horizontal drag
 * scrubs the wave (with momentum on release); a click / tap sends a ripple along the wall.
 * Touch keeps vertical page scrolling (touch-action: pan-y).
 *
 * This module never touches the DOM: it draws into a canvas or an OffscreenCanvas and is driven through the
 * returned controller. slatwall-host.ts runs it in a Web Worker where the browser can (three.js is then
 * parsed, built and rendered off the main thread) or on the main thread otherwise, and forwards the page's
 * size, scroll, visibility and pointer events to it.
 *
 * Performance: one InstancedMesh (single draw call), 2048² soft shadow map, DPR capped,
 * rendering paused off screen / in background tabs. Loaded as a separate chunk.
 */
import {
  ACESFilmicToneMapping, CanvasTexture, Color, DirectionalLight, HemisphereLight, InstancedBufferAttribute,
  InstancedMesh, MathUtils, Mesh, Plane, Raycaster, Vector2, Vector3, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry,
  RepeatWrapping, SRGBColorSpace, Scene, ShadowMaterial, VSMShadowMap, WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const N = 38;
const PITCH = 0.34;
const SLAT_W = 0.22;
const SLAT_H = 3.6;
const TOTAL = (N - 1) * PITCH + SLAT_W;
const CENTER = (N - 1) / 2;

export interface WallOptions {
  reduce: boolean;
  wood: [number, number, number]; // sRGB 0–255, resolved from the palette by the host
  dpr: number;
  width: number;
  height: number;
  onReady?: () => void;
}

/** A pointer event, already reduced to what the wall needs (the host measures it against the canvas). */
export interface WallPointer {
  kind: 'enter' | 'down' | 'move' | 'up' | 'leave';
  ndcX: number;      // -1..1 across the canvas
  ndcY: number;      // -1..1 up the canvas
  fx: number;        // 0..1 across the canvas (drag distance)
  id: number;
  mouse: boolean;
  t: number;         // event timestamp, ms
}

export interface WallController {
  resize(width: number, height: number, dpr: number): void;
  progress(p: number): void;
  visible(v: boolean): void;
  pointer(e: WallPointer): void;
  blur(): void;
  dispose(): void;
}

/** Procedural oak: long vertical grain with gentle waviness, darker late-wood lines and fine noise. */
function oakTexture(base: [number, number, number]) {
  const w = 128, h = 512;
  const c: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < h; y++) {
    const wy1 = 5 * Math.sin(y * 0.009 + 1.3);
    for (let x = 0; x < w; x++) {
      const warp = wy1 + 2 * Math.sin(y * 0.031 + x * 0.04);
      const ring = Math.sin((x + warp) * 0.45);
      const late = Math.pow(ring * 0.5 + 0.5, 8);          // thin dark late-wood lines
      const fine = Math.sin((x + warp * 0.5) * 2.1) * 0.3;
      const v = 0.94 + 0.04 * ring - 0.1 * late + 0.02 * fine + (rnd() - 0.5) * 0.045;
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, base[0] * v);
      data[i + 1] = Math.min(255, base[1] * v);
      data[i + 2] = Math.min(255, base[2] * v * 0.97);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c as HTMLCanvasElement);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (p: number) => { const t = clamp01(p); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

/** Give the thread back between setup steps, so building the scene never makes one long task. */
const yieldNow = () =>
  new Promise<void>((r) => {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (s?.yield) s.yield().then(r);
    else setTimeout(r, 0);
  });

// Dedicated workers have requestAnimationFrame in current browsers; fall back to a 60fps timer.
const nextFrame: (cb: (now: number) => void) => number = typeof requestAnimationFrame === 'function'
  ? (cb) => requestAnimationFrame(cb)
  : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const cancelFrame: (id: number) => void = typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

/** Builds the wall in `canvas`. Throws (rejects) when WebGL is unavailable. */
export async function createSlatWall(canvas: HTMLCanvasElement | OffscreenCanvas, opts: WallOptions): Promise<WallController> {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(opts.dpr, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = VSMShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  await yieldNow();

  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 2, 0.1, 100);

  /* ---------- Light ---------- */
  const key = new DirectionalLight(0xffe4c2, 2.6);
  key.castShadow = true;
  // The shadow box must cover the whole visible wall for every light position (intro sweep + scroll);
  // otherwise its edge shows up as a straight line travelling across the wall.
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -16, right: 16, top: 9, bottom: -9, near: 1, far: 30 });
  key.shadow.bias = -0.0006;
  key.shadow.radius = 12;
  key.shadow.blurSamples = 16;
  scene.add(key, key.target);
  const fill = new HemisphereLight(0xfff6ea, 0x6b4f36, 0.8);
  const rim = new DirectionalLight(0xfff0dc, 0.45);
  rim.position.set(7, 1.5, 4);
  scene.add(fill, rim);

  /* ---------- Wall: shadows only ---------- */
  const wallMat = new ShadowMaterial({ opacity: 0.24 });
  const wall = new Mesh(new PlaneGeometry(60, 30), wallMat);
  wall.receiveShadow = true;
  scene.add(wall);

  /* ---------- Slats: one instanced mesh ---------- */
  const geo = new RoundedBoxGeometry(SLAT_W, SLAT_H, 1, 2, 0.018);
  geo.translate(0, 0, 0.5); // back face on the wall; scale.z = depth off the wall
  // Each slat reads its own stretch of grain.
  const offsets = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { offsets[i * 2] = (i * 0.37) % 1; offsets[i * 2 + 1] = (i * 0.61) % 1; }
  geo.setAttribute('aOff', new InstancedBufferAttribute(offsets, 2));

  await yieldNow();
  const material = new MeshStandardMaterial({ map: oakTexture(opts.wood), roughness: 0.55, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aOff;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv += aOff;\n#endif');
  };

  const slats = new InstancedMesh(geo, material, N);
  slats.castShadow = true;
  slats.receiveShadow = true;
  slats.frustumCulled = false;
  const tone = new Color();
  for (let i = 0; i < N; i++) {
    const v = 0.9 + 0.12 * ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1; // gentle board-to-board variation
    slats.setColorAt(i, tone.setScalar(v));
  }
  scene.add(slats);
  const dummy = new Object3D();

  /* ---------- Parametric wave ---------- */
  const depthAt = (i: number, ph: number) => 0.08 + 0.78 * (0.5 + 0.5 * Math.sin(i * 0.27 + ph));
  const twistAt = (i: number, ph: number) => 0.42 * Math.sin(i * 0.17 - ph * 0.8 + 0.6);

  /* ---------- Sizing ---------- */
  let dist = 12;
  const resize = (w: number, h: number, dpr: number) => {
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(dpr, 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const narrow = camera.aspect < 1.5;
    const fit = narrow ? TOTAL * 0.72 : TOTAL * 1.32;
    dist = Math.max(fit / (2 * tanHalf * camera.aspect), (SLAT_H * (narrow ? 1.8 : 1.7)) / (2 * tanHalf));
    camera.updateProjectionMatrix();
  };

  /* ---------- Timeline ---------- */
  const GROW = 1.8;
  const STEP = 0.03;
  const SPREAD = CENTER * STEP;
  const INTRO = 0.15 + SPREAD + GROW;

  /* ---------- Interaction state ---------- */
  const infl = new Float32Array(N);          // per-slat pointer influence, eased (gives a little lag)
  let hoverTarget = 0, hoverAmt = 0;         // is a pointer over the wall
  let pxTarget = 0, px = 0;                  // pointer x in world units, on the slat plane
  let dragging = false, dragId = -1, lastX = 0, lastT = 0;
  let dragPhase = 0, dragVel = 0;            // wave offset from dragging, and its momentum
  const ripples: { x: number; t: number }[] = [];
  const ray = new Raycaster();
  const ndc = new Vector2();
  const hitPlane = new Plane(new Vector3(0, 0, 1), -0.4);
  const hit = new Vector3();

  let progress = 0, smoothP = 0;
  let visible = true;
  let raf = 0;
  let t0 = -1;
  let ready = false;
  let started = false;

  const frame = (now: number) => {
    if (t0 < 0) t0 = now;
    const t = opts.reduce ? 999 : (now - t0) / 1000;
    smoothP += (progress - smoothP) * (opts.reduce ? 1 : 0.075);

    const breathe = opts.reduce ? 0 : Math.max(0, t - INTRO) * 0.07;
    // Pointer: ease hover in/out and follow the pointer; after a drag, the wave coasts and slows.
    hoverAmt += (hoverTarget - hoverAmt) * 0.08;
    px += (pxTarget - px) * 0.2;
    if (!dragging) { dragPhase += dragVel; dragVel *= 0.94; if (Math.abs(dragVel) < 1e-5) dragVel = 0; }
    const nowS = now / 1000;
    for (let r = ripples.length - 1; r >= 0; r--) if (nowS - ripples[r].t > 2.4) ripples.splice(r, 1);

    const phase = breathe + smoothP * 3.2 + dragPhase;
    let moving = false;

    for (let i = 0; i < N; i++) {
      const fromC = Math.abs(i - CENTER) * STEP;
      // Full width and height from the first frame; only the depth off the wall grows.
      const g = easeInOut((t - 0.15 - fromC) / GROW);
      const x = -TOTAL / 2 + SLAT_W / 2 + i * PITCH;
      const dx = x - px;
      const target = hoverAmt * Math.exp(-(dx * dx) / (2 * 0.8 * 0.8));
      infl[i] += (target - infl[i]) * 0.14;
      if (Math.abs(target - infl[i]) > 0.001) moving = true;
      let wave = 0;
      for (const rp of ripples) {
        const age = nowS - rp.t;
        const d = Math.abs(x - rp.x) - age * 5.5;
        wave += Math.exp(-(d * d) / 0.3) * Math.exp(-age * 1.5);
      }
      const depth = 0.015 + (depthAt(i, phase) - 0.015) * g + (0.5 * infl[i] + 0.38 * wave) * g;
      // Slats part around the pointer, turning their faces away from it.
      const part = 0.5 * infl[i] * Math.tanh(dx / 0.5);
      dummy.position.set(x, 0, 0);
      dummy.rotation.set(0, (twistAt(i, phase) + part + 0.25 * wave) * g, 0);
      dummy.scale.set(1, 1, depth);
      dummy.updateMatrix();
      slats.setMatrixAt(i, dummy.matrix);
    }
    slats.instanceMatrix.needsUpdate = true;

    // Light sweeps across during the opening, then follows the scroll a little.
    const sweep = easeInOut(t / (INTRO * 0.85));
    key.position.set(MathUtils.lerp(6, -6, sweep) + smoothP * 2 + px * 0.35 * hoverAmt, 5.5, 7);
    key.intensity = MathUtils.lerp(0.9, 2.6, sweep);
    wallMat.opacity = MathUtils.lerp(0.1, 0.24, sweep);

    // Camera starts in its resting, centred view; only the scroll moves it.
    const angle = -0.14 + smoothP * 0.34 + (px / TOTAL) * 0.08 * hoverAmt;
    camera.position.set(Math.sin(angle) * dist, 0.6 + smoothP * 0.6, Math.cos(angle) * dist);
    camera.lookAt(0, 0.05, 0.35);

    renderer.render(scene, camera);
    if (!ready) { ready = true; opts.onReady?.(); }

    const settling = Math.abs(progress - smoothP) > 0.0005;
    const busy = moving || dragging || dragVel !== 0 || ripples.length > 0 || Math.abs(hoverTarget - hoverAmt) > 0.001;
    if (visible && (!opts.reduce || settling || busy)) raf = nextFrame(frame);
    else raf = 0;
  };
  const kick = () => { if (started && !raf && visible) raf = nextFrame(frame); };

  /* ---------- Pointer & touch ---------- */
  const aim = (e: WallPointer) => {
    ndc.set(e.ndcX, e.ndcY);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(hitPlane, hit)) pxTarget = MathUtils.clamp(hit.x, -TOTAL / 2 - 1, TOTAL / 2 + 1);
  };
  const onEnter = (e: WallPointer) => {
    aim(e);
    if (hoverAmt < 0.02) px = pxTarget; // appear where the pointer is, don't slide in from the last spot
    hoverTarget = 1;
  };
  const onPointer = (e: WallPointer) => {
    switch (e.kind) {
      case 'enter':
        onEnter(e);
        break;
      case 'down':
        onEnter(e);
        dragging = true;
        dragId = e.id;
        lastX = e.fx;
        lastT = e.t;
        dragVel = 0;
        if (!opts.reduce) ripples.push({ x: pxTarget, t: performance.now() / 1000 });
        if (ripples.length > 4) ripples.shift();
        break;
      case 'move':
        aim(e);
        hoverTarget = 1;
        if (dragging && e.id === dragId) {
          const d = (e.fx - lastX) * 5;
          const dt = Math.max(1, e.t - lastT);
          dragPhase -= d;
          dragVel = MathUtils.lerp(dragVel, (-d * 16) / dt, 0.5); // per-frame momentum (~16ms frames)
          lastX = e.fx;
          lastT = e.t;
        }
        break;
      case 'up':
        if (e.id !== dragId) return;
        dragging = false;
        dragId = -1;
        if (e.t - lastT > 80) dragVel = 0; // held still before letting go: no fling
        if (!e.mouse) hoverTarget = 0; // a lifted finger no longer hovers
        break;
      case 'leave':
        if (dragging && e.id === dragId) return;
        hoverTarget = 0;
        break;
    }
    kick();
  };

  resize(opts.width, opts.height, opts.dpr);
  // Compile the shaders in parallel first (KHR_parallel_shader_compile where the GPU driver has it),
  // so the first frame doesn't stall; then start drawing.
  await renderer.compileAsync(scene, camera).catch(() => {});
  started = true;
  kick();

  return {
    resize: (w, h, dpr) => { resize(w, h, dpr); kick(); },
    progress: (p) => { progress = p; kick(); },
    visible: (v) => { visible = v; kick(); },
    pointer: onPointer,
    blur: () => { dragging = false; hoverTarget = 0; kick(); },
    dispose: () => {
      cancelFrame(raf);
      geo.dispose();
      material.map?.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
