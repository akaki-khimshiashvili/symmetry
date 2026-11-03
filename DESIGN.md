# Symmetry — Design System

Recorded from the built site (frontend/src). Direction: **Veneer Specimen Book**. The catalogue is a wood-sample book; *symmetry* is book-matching, where two leaves of one relief are mirrored on a spine.

## World

- **Hero:** an open spread. The copy sits on the left page. On the right page, two book-matched relief leaves open outward from a spine, with shop-drawing dimension callouts (width below, height to the right) and a specimen caption.
- **Products are specimens:** each product has an italic specimen number (`№ 04`), a name, its material, and a "from" price. The catalogue alternates wide and narrow leaves (7/5 then 5/7 columns), so it never becomes a uniform card grid.
- **Imagery:** until real photography exists, every product is drawn by `lib/relief.ts`, a parametric height-field renderer (wave, dune, ripple, twist, prism, mosaic) lit from the upper left. No colours are baked in: each face uses a 12-step shade class mixed between `--wood-lo` and `--wood-hi`, so every relief reskins with the palette. Uploaded photos replace the relief automatically.

## Palette

One palette only: **white oak and dark oak** (`frontend/src/styles/palettes.css`, shared with the admin). White oak is the ground; a deep dark oak is the second colour, used for text, buttons and the relief shadows. Tokens: `--ground`, `--ground-2`, `--ground-3`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--wood-lo`, `--wood-hi`, `--accent`, `--accent-ink`, `--gap`.

## Brand mark

- The wordmark matches the company logo: **Montserrat 800** for `SYMMETRY` with a tracked Montserrat 600 `3D WALL ART` line, beside a circular mark of flowing wooden ribs.

## Type

- **FiraGO** (OFL) for everything: headings 500 (hero 600), text 400. Self-hosted from `frontend/public/fonts/firago`, subset to Latin and Georgian (about 40 KB per weight). Regular and Medium are preloaded.
- The wordmark stays in Montserrat to match the logo.
- No italics anywhere. Georgian labels are not uppercased.

## Grid & rhythm

- One master grid: 12 columns, `--gutter` clamp(1rem…2rem), `--margin` clamp(1rem…4.5rem), max width 1440px.
- Section padding: `--s-6` clamp(5rem…10rem). Denser bands (craft, team, "more patterns") sit on `--ground-2` between hairline rules.

## Components

- **Buttons:** 2px radius. `btn-solid` (accent) and `btn-line` (hairline). All press to `scale(0.97)`.
- **Selection:** shown by a rotated-square notch that fills with the accent, never by a colour change alone. Used in size rows, form choices and the palette list.
- **Dimension callouts:** `.dim` (hairline with a label, end ticks via `border-inline`) and vertical callouts for height. On the product page they track the selected size.
- **Forms:** underline inputs, notch radio chips, inline errors, a honeypot field, and a success state that replaces the form.
- **Order drawer:** a `<dialog>` that slides in from the right using the iOS drawer curve.

## Motion

- Easing: `--ease-out` cubic-bezier(.23,1,.32,1), `--ease-in-out` (.77,0,.175,1), `--ease-drawer` (.32,.72,0,1).
- Content reveal: opacity, translateY(14px) and blur(6px) to rest over 0.9–1.1s, staggered 70ms through `--d`. Content stays visible without JS.
- Hero: centred copy above a real-time **3D parametric slat wall** (`frontend/src/lib/slatwall.ts`, Three.js). Rounded oak slats with procedural grain and per-board tone, one InstancedMesh, soft VSM shadows on a shadow-only wall so the slats sit on the page. Opening (~3.4s): slats rise from the centre out, turn from edge-on to face, then depth ripples outward while the key light sweeps across and the camera glides back. Scroll orbits the camera, moves the wave and shifts the light; gentle idle breathing. Loaded as a separate chunk (~133 KB gzip) in parallel with paint; paused off screen; static SVG fallback without WebGL; reduced motion renders a still.
- Buttons: 6px corners, no arrows. Solid is a dark oak plank carrying the round wave mark from the logo; on hover a fine light frame settles inside it and the mark turns a quarter. Outline: on hover dark oak wipes across from the left and the label turns light.
- Clip reveals clip the child element, never the observed element.
- Product size change: the panel morphs width and height over 700ms. This is the one deliberate layout animation.
- Every hover is gated by `(hover: hover) and (pointer: fine)`. Reduced motion falls back to opacity only.

## Admin

The admin runs in Operate mode on a light oak surface with a walnut sidebar and a honey accent for badges. Headings use Noto Serif Georgian and text uses Noto Sans Georgian. The interface is Georgian only.
