/**
 * Parametric slat wall, rendered with Three.js.
 *
 * Solid oak slats (rounded edges, per-slat grain and tone) stand off a wall. One wave formula
 * sets every slat's depth and twist. The wall is a shadow-only plane, so the slats sit on the page.
 *
 * Opening (≈3.4s): slats rise into place from the centre out, turn from edge-on to face the room,
 * then their depth ripples outward from the middle. Meanwhile the key light sweeps across like
 * morning sun (shadows travel). The camera starts in its resting view.
 * Scroll: the camera orbits, the wave travels along the wall and the light shifts a little.
 *
 * Performance: one InstancedMesh (single draw call), 1024² soft shadow map, DPR capped,
 * rendering paused off screen / in background tabs. Loaded as a separate chunk.
 */
import {
  ACESFilmicToneMapping, CanvasTexture, Color, DirectionalLight, HemisphereLight, InstancedBufferAttribute,
  InstancedMesh, MathUtils, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry,
  RepeatWrapping, SRGBColorSpace, Scene, ShadowMaterial, VSMShadowMap, WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const N = 38;
const PITCH = 0.34;
const SLAT_W = 0.22;
const SLAT_H = 3.6;
const TOTAL = (N - 1) * PITCH + SLAT_W;
const CENTER = (N - 1) / 2;

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

/** Procedural oak: long vertical grain with gentle waviness, darker late-wood lines and fine noise. */
function oakTexture(base: [number, number, number]) {
  const w = 128, h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
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
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (p: number) => 1 - Math.pow(1 - clamp01(p), 4);
const easeInOut = (p: number) => { const t = clamp01(p); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** A soft overshoot for the rise, so slats settle like something placed by hand. */
const easeBack = (p: number) => { const t = clamp01(p); const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

export function mountSlatWall(host: HTMLElement, opts: { reduce: boolean; woodColor: string; onReady?: () => void }) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = VSMShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 2, 0.1, 100);

  /* ---------- Light ---------- */
  const key = new DirectionalLight(0xffe4c2, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 5, bottom: -5, near: 1, far: 30 });
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

  const material = new MeshStandardMaterial({ map: oakTexture(cssColor(opts.woodColor)), roughness: 0.55, metalness: 0 });
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
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const narrow = camera.aspect < 1.5;
    const fit = narrow ? TOTAL * 0.72 : TOTAL * 1.32;
    dist = Math.max(fit / (2 * tanHalf * camera.aspect), (SLAT_H * (narrow ? 1.8 : 1.7)) / (2 * tanHalf));
    camera.updateProjectionMatrix();
  };

  /* ---------- Timeline ---------- */
  const RISE = 0.9, TURN = 1.3, RIPPLE = 1.4;
  const STEP = 0.028;
  const SPREAD = CENTER * STEP;
  const INTRO = 0.2 + SPREAD + RISE + 0.35 + TURN + 0.25 + RIPPLE;

  let progress = 0, smoothP = 0;
  let visible = true;
  let raf = 0;
  let t0 = -1;
  let ready = false;

  const frame = (now: number) => {
    if (t0 < 0) t0 = now;
    const t = opts.reduce ? 999 : (now - t0) / 1000;
    smoothP += (progress - smoothP) * (opts.reduce ? 1 : 0.075);

    const breathe = opts.reduce ? 0 : Math.max(0, t - INTRO) * 0.07;
    const phase = breathe + smoothP * 3.2;

    for (let i = 0; i < N; i++) {
      const fromC = Math.abs(i - CENTER) * STEP;
      // 1. rise into place
      const r = easeBack((t - 0.2 - fromC) / RISE);
      // 2. turn from edge-on to face
      const q = easeInOut((t - 0.2 - SPREAD - RISE * 0.6 - fromC * 0.8) / TURN);
      // 3. depth ripples out from the middle
      const d = easeOut((t - 0.2 - SPREAD - RISE * 0.6 - TURN * 0.7 - fromC * 1.2) / RIPPLE);

      const depth = 0.03 + (depthAt(i, phase) - 0.03) * d;
      dummy.position.set(-TOTAL / 2 + SLAT_W / 2 + i * PITCH, -0.6 * (1 - r), 0);
      dummy.rotation.set(0, (Math.PI / 2) * 0.96 * (1 - q) + twistAt(i, phase) * q, 0);
      dummy.scale.set(1, Math.max(0.001, clamp01(r * 1.02)), depth);
      dummy.updateMatrix();
      slats.setMatrixAt(i, dummy.matrix);
    }
    slats.instanceMatrix.needsUpdate = true;

    // Light sweeps across during the opening, then follows the scroll a little.
    const sweep = easeInOut(t / (INTRO * 0.85));
    key.position.set(MathUtils.lerp(6, -6, sweep) + smoothP * 2, 5.5, 7);
    key.intensity = MathUtils.lerp(0.9, 2.6, sweep);
    wallMat.opacity = MathUtils.lerp(0.1, 0.24, sweep);

    // Camera starts in its resting, centred view; only the scroll moves it.
    const angle = -0.14 + smoothP * 0.34;
    camera.position.set(Math.sin(angle) * dist, 0.6 + smoothP * 0.6, Math.cos(angle) * dist);
    camera.lookAt(0, 0.05, 0.35);

    renderer.render(scene, camera);
    if (!ready) { ready = true; opts.onReady?.(); }

    const settling = Math.abs(progress - smoothP) > 0.0005;
    if (visible && (!opts.reduce || settling)) raf = requestAnimationFrame(frame);
    else raf = 0;
  };
  const kick = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };

  const onScroll = () => {
    const r = host.getBoundingClientRect();
    progress = clamp01((innerHeight - r.top) / (innerHeight + r.height));
    kick();
  };

  const ro = new ResizeObserver(() => { resize(); kick(); });
  ro.observe(host);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; kick(); }, { rootMargin: '120px' });
  io.observe(host);
  const onVis = () => { visible = !document.hidden; kick(); };
  document.addEventListener('visibilitychange', onVis);
  addEventListener('scroll', onScroll, { passive: true });

  resize();
  onScroll();
  kick();

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVis);
    geo.dispose();
    material.map?.dispose();
    material.dispose();
    renderer.dispose();
  };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
