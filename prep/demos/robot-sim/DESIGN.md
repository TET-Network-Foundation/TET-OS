# Design of the demo pages: an instrument, not a show

The simulation page (`page.html`, with `view3d.js`) and the agent console
(`../agent-console/page.html`) share one style. This file says what the style is and why, so a later
change can be checked against it.

## Three references, described in words

1. **A mission-control console of a space agency.** Dense, calm, every number labelled with its unit,
   status shown by a word and a shape as well as a colour, nothing moving that does not carry
   information. Taken from it: the status bar, the telemetry table, status marks that differ by shape.
2. **A national laboratory's data viewer.** White page, a thin grid, plots with axes, ticks and
   units, a legend in words, one accent colour for "this is the thing you can press". Taken from it:
   light background by default, the plot style of the strip, the numbered figures.
3. **A flight test report.** Numbered figures with captions that say where each line comes from
   ("Fig. 2: altitude, live and from the signed log"), a methods box, a section on limits, and a
   line on how to cite the run. Taken from it: captions, the methods box, "how to cite this run".

## Rules

- **Background**: light by default (warm white paper, dark ink); a dark option behind a button,
  remembered in the browser. The dark option is a dark grey, not black, and has no glow.
- **Colour**: one accent (a deep blue) for controls and the selected record. Status colours are a
  green, a red and an amber, and each always comes with a shape and a word: checked = filled circle
  and "checked", refused = cross and "refused", changed copy = triangle and "≠ live".
- **Type**: a serif (Charter / Georgia / the system serif) for text; a monospace for data, ids,
  telemetry and the log. No web fonts are fetched: the page loads nothing.
- **Grid**: a 12-column page grid; figures and panels sit on it. Thin rules (1 px), square corners,
  no shadows, no gradients.
- **Figures**: numbered (Fig. 1 the view, Fig. 2 the strip, Fig. 3 the log), each with a caption that
  says what is drawn and where it comes from. The strip has units on both axes (the quantity and its
  unit on the vertical axis, the record number on the horizontal one).
- **Methods box**: what runs, where, with which key, how the check is made; in plain words.
- **Three panels**, EN | 日本語: "What this shows", "What this does not show (as it stands
  today)", "Where this is going". Every line of the last panel is marked 設計中 / planned and has no
  date. Strengths are taken only from `prep/answers/what-works-today.md` and
  `prep/answers/how-is-it-different.md`.
- **Status bar**: run id, seeds, software versions (Python, tet-cli) and the commit, filled in by the
  page server when it serves the page; and "how to cite this run" built from the same values.
- **Honesty marks stay**: the SIMULATION label on the view, "nothing here flew or drove", and the
  sentence that the check shows the order of the log it is given (a test holds that sentence).
- **Not allowed**: gradients on black, glow, neon, emoji, stock "AI" imagery, animated decoration.

## Accessibility

- Contrast at least WCAG AA (4.5:1 for text) in both themes; the chosen colours are listed in the
  `:root` blocks of the page with their contrast on the background.
- Keyboard order follows reading order: switches, view, view buttons, log rows, try buttons, panels.
  Every control shows a visible focus ring.
- `prefers-reduced-motion`: the view stops easing the camera and the rotors stand still; nothing
  else on the page moves.
- Phone: one column under 820 px, buttons at least 40 px high, the log and the view keep their
  touch handling.

## What the page layer may change, and what it may not

The style, the text and the layout are the page's (`page.html`, the colour table and the strip's
axes in `view3d.js`, the meta line the server puts into the page). What is signed, what is checked,
the simulation and the tamper actions belong to `robotsim.py` and `tools/machine-notebook` and are
not touched here.
