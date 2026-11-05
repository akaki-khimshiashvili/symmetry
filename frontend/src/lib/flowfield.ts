/**
 * Flow field: a quiet WebGL canvas of contour lines drifting through a noise field, the
 * parametric idea behind Symmetry's panels rendered as moving form. The pointer bends the
 * lines locally. One responsibility (the About hero backdrop); the page is complete without it.
 */
import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer } from 'three';

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uRes;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uPower;
  uniform float uNarrow;
  uniform vec3 uGround;
  uniform vec3 uGround2;
  uniform vec3 uInk;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 p = vec2(vUv.x * aspect, vUv.y);
    vec2 m = vec2(uMouse.x * aspect, uMouse.y);

    float t = uTime * 0.035;
    float d = distance(p, m);
    float bend = uPower * exp(-d * d * 9.0) * 0.22;

    // Height field: a slow slope, warped by drifting noise. Its iso-lines are the "ribs".
    float h = p.y * 1.25 + p.x * 0.18
            + fbm(p * 1.15 + vec2(t, -t * 0.7)) * 1.05
            + sin(p.x * 2.4 + t * 2.6) * 0.05
            + bend;

    float n = 26.0;
    float g = h * n;
    float f = fract(g);
    float w = fwidth(g);
    float line = 1.0 - smoothstep(0.0, w * 1.3, min(f, 1.0 - f));
    // Every fifth line slightly stronger, like a contour map's index lines.
    float idx = 1.0 - step(0.5, mod(floor(g + 0.5), 5.0));

    // Keep the text side calm: lines fade toward the copy (left on wide screens, top on narrow).
    float wide = smoothstep(0.18, 0.78, vUv.x);
    float narrow = smoothstep(0.42, 0.95, 1.0 - vUv.y);
    float calm = mix(wide, narrow, uNarrow);

    float strength = line * mix(0.07, 0.42, calm) * mix(0.75, 1.25, idx);
    vec3 base = mix(uGround, uGround2, smoothstep(0.0, 1.0, vUv.x * 0.6 + (1.0 - vUv.y) * 0.4));
    gl_FragColor = vec4(mix(base, uInk, strength), 1.0);
  }
`;

function cssColor(value: string): Vector3 {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = value;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  // Shader writes straight to the sRGB canvas, so keep the colour as-is.
  return new Vector3(d[0] / 255, d[1] / 255, d[2] / 255);
}

export function mountFlowField(host: HTMLElement, opts: { onReady?: () => void; onFail?: () => void } = {}) {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch {
    opts.onFail?.();
    return () => {};
  }
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fb: string) => cssColor(css.getPropertyValue(name).trim() || fb);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new PlaneGeometry(2, 2);
  const uniforms = {
    uRes: { value: new Vector2(1, 1) },
    uTime: { value: 0 },
    uMouse: { value: new Vector2(0.7, 0.5) },
    uPower: { value: 0 },
    uNarrow: { value: 0 },
    uGround: { value: read('--ground', '#f1ebe1') },
    uGround2: { value: read('--ground-2', '#e8e0d3') },
    uInk: { value: read('--wood-lo', '#2a1d14') },
  };
  const material = new ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  scene.add(new Mesh(geometry, material));

  const target = new Vector2(0.7, 0.5);
  let targetPower = 0;
  let raf = 0;
  let visible = true;
  let last = performance.now();
  let started = false;

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w, h);
    uniforms.uNarrow.value = w < 760 ? 1 : 0;
  };

  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    uniforms.uTime.value += dt;
    const k = 1 - Math.pow(0.0025, dt); // frame-rate independent easing
    uniforms.uMouse.value.lerp(target, k);
    uniforms.uPower.value += (targetPower - uniforms.uPower.value) * k;
    renderer.render(scene, camera);
    if (!started) { started = true; opts.onReady?.(); }
    loop();
  };
  const loop = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  // Pointer: store the target only; the frame loop does the work, so moves are effectively throttled.
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const r = host.getBoundingClientRect();
    target.set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
    targetPower = 1;
  };
  const onLeave = () => { targetPower = 0; };
  const onVis = () => (document.hidden ? stop() : loop());
  const onLost = (e: Event) => { e.preventDefault(); stop(); opts.onFail?.(); };

  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; visible ? loop() : stop(); });
  const ro = new ResizeObserver(resize);

  const zone = host.parentElement ?? host;
  zone.addEventListener('pointermove', onMove, { passive: true });
  zone.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  document.addEventListener('visibilitychange', onVis);
  canvas.addEventListener('webglcontextlost', onLost);
  io.observe(host);
  ro.observe(host);
  resize();
  loop();

  return () => {
    stop();
    io.disconnect();
    ro.disconnect();
    zone.removeEventListener('pointermove', onMove);
    zone.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    document.removeEventListener('visibilitychange', onVis);
    canvas.removeEventListener('webglcontextlost', onLost);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    canvas.remove();
  };
}
