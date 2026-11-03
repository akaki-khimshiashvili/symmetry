# Symmetry — Design System

Recorded from the built site (frontend/src). Direction: **Veneer Specimen Book**. The catalogue is a wood-sample book; *symmetry* is book-matching, where two leaves of one relief are mirrored on a spine.

## World

- **Hero:** an open spread. The copy sits on the left page. On the right page, two book-matched relief leaves open outward from a spine, with shop-drawing dimension callouts (width below, height to the right) and a specimen caption.
- **Products are specimens:** each product has an italic specimen number (`№ 04`), a name, its material, and a "from" price. The catalogue alternates wide and narrow leaves (7/5 then 5/7 columns), so it never becomes a uniform card grid.
- **Imagery:** until real photography exists, every product is drawn by `lib/relief.ts`, a parametric height-field renderer (wave, dune, ripple, twist, prism, mosaic) lit from the upper left. No colours are baked in: each face uses a 12-step shade class mixed between `--wood-lo` and `--wood-hi`, so every relief reskins with the palette. Uploaded photos replace the relief automatically.

## Palettes (switchable)

Defined in `frontend/src/styles/palettes.css` and shared with the admin. Each palette applies to `<html data-palette>` or to any element (that's how the swatches work).

| Key | Name | Scene |
|---|---|---|
| walnut | Walnut | Dark chocolate ground, honey accent |
| ebony | Macassar ebony | Near-black, amber accent |
| oak (default) | White & dark oak | White oak ground; dark oak for text, accent and relief shadows |
| teak | Teak | Golden ground, deep-brown accent |
| sapele | Sapele | Red-brown ground, gold accent |
| smoked | Smoked oak | Grey-brown ground, pale-gold accent |

Tokens per palette: `--ground`, `--ground-2`, `--ground-3`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--wood-lo`, `--wood-hi`, `--accent`, `--accent-ink`, `--gap`. Visitors switch with the floating "Wood" control (stored in localStorage). The admin sets the default under Settings.

## Brand mark

- The wordmark matches the company logo: **Montserrat 800** for `SYMMETRY` with a tracked Montserrat 600 `3D WALL ART` line, beside a circular mark of flowing wooden ribs.

## Type

- Display: **Bodoni Moda** (optical sizing) for Latin, with **Noto Serif Georgian** for Georgian. Weight 400 (350 for Georgian), tracking -0.02em, `text-wrap: balance`.
- Text: **Manrope** for Latin, with **Noto Sans Georgian** for Georgian. Line height 1.65 (1.75 for Georgian).
- Scale: `--t-xs` .75rem through `--t-4xl` clamp(…6rem). Display never exceeds 6rem.
- Labels: `.label` is 600 weight, uppercase, tracked .16em (.08em in Georgian).
- Specimen numbers: Bodoni italic, lining figures.

## Product types

- Every product is **portrait** (vertical) or **landscape** (horizontal). The homepage collection opens with one tile per type, and the products page filters by type (`?type=portrait`). Card frames follow the product's type.

## Copy

- No em dashes anywhere in site or admin copy. Use commas, colons, parentheses or separate sentences.

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
- Signature moment: the hero leaves unfold from the spine (clip-path, 1.5s) once per page load.
- Clip reveals clip the child element, never the observed element.
- Product size change: the panel morphs width and height over 700ms. This is the one deliberate layout animation.
- Every hover is gated by `(hover: hover) and (pointer: fine)`. Reduced motion falls back to opacity only.

## Admin

The admin runs in Operate mode on a light oak surface with a walnut sidebar and a honey accent for badges. Headings use Noto Serif Georgian and text uses Noto Sans Georgian. The interface is Georgian only.
