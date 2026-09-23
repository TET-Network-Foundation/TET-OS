# Whitepaper build — Phrack-style HTML + PDF

**The PDF is a build artifact and is no longer tracked in git.** Regenerate it on demand with the
command below. Source of truth is [`WHITEPAPER_v1.1_DRAFT.md`](./WHITEPAPER_v1.1_DRAFT.md).

## Why it is not tracked

`docs/WHITEPAPER_v1.1_DRAFT.pdf` was removed on 2026-09-18. It was generated on 2026-05-24 and
therefore still embedded the **old personal contact address**, which had since been replaced
throughout the markdown sources. Note that
`tet-network/ui/public/tet-network-whitepaper.pdf` **is** tracked — it is what the UI serves — so
it must be regenerated and re-copied whenever the whitepaper changes, or the published PDF drifts
from its source exactly the way this section describes. A rendered binary cannot be scrubbed with a text edit, and a stale
PDF that disagrees with its own source is worse than no PDF.

It is now gitignored so it cannot silently return. Regenerating after any whitepaper edit takes
about ten seconds.

## Regenerate

```bash
# from the repository root
python3 docs/scripts/render_phrack_wp_pdf.py
```

That writes **both** outputs:

| Output | Tracked? |
|--------|----------|
| `docs/WHITEPAPER_v1.1_DRAFT.phrack.html` | **yes** — it is the styled source, text-diffable |
| `docs/WHITEPAPER_v1.1_DRAFT.pdf` | **no** — gitignored build artifact |

### What the script does

1. Reads `docs/WHITEPAPER_v1.1_DRAFT.md` and `docs/styles/phrack_wp.css`
2. Emits `docs/WHITEPAPER_v1.1_DRAFT.phrack.html`
3. Prints that HTML to PDF via headless Chrome:

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome \
  --headless=new \
  --disable-gpu \
  --no-pdf-header-footer \
  --print-to-pdf-no-header \
  --print-to-pdf=docs/WHITEPAPER_v1.1_DRAFT.pdf \
  file:///…/docs/WHITEPAPER_v1.1_DRAFT.phrack.html
```

### Requirements

- **Python 3** (stdlib only — no packages needed)
- **Google Chrome** at the macOS path above. Without it the script still writes the HTML and exits
  `1` with `Chrome not found; HTML written only`. On Linux, point `chrome` in
  [`scripts/render_phrack_wp_pdf.py`](./scripts/render_phrack_wp_pdf.py) at
  `google-chrome` / `chromium`.

## Verifying a regenerated PDF

Plain byte or `zlib` searches **do not work** on this PDF — Chrome subsets the fonts, so even words
that are plainly visible (`quantum`, `Contact`) are absent from the raw bytes. A byte-level grep
returns a false negative. Use a real text extractor:

```bash
P=docs/WHITEPAPER_v1.1_DRAFT.pdf          # or tet-network/ui/public/tet-network-whitepaper.pdf

# macOS — Spotlight importer
mdimport -t -d3 $P 2>&1 | grep -ic "tetsteve"        # expect > 0  — current contact is present
mdimport -t -d3 $P 2>&1 | grep -ic "quantum"         # expect > 0  — CONTROL, see below
mdimport -t -d3 $P 2>&1 | grep -ic "tetnetwork.org"  # expect 0    — domain never registered
mdimport -t -d3 $P 2>&1 | grep -ic "yizhenxianshi"   # expect 0    — personal address, scrubbed

# elsewhere
pdftotext $P - | grep -ic "tetnetwork.org"
```

**Always run the control probe.** If a term you *know* is in the document returns 0, the extractor
is not working and every "clean" result above is a false negative, not a pass.

Check the positive probe too, not just the negatives. An empty extraction passes all three negative
checks and proves nothing; `tetsteve` returning > 0 is what shows the current address actually
reached the rendered PDF.

### Two dead addresses, not one

| Address | Why it must not appear | Removed |
|---|---|---|
| `yizhenxianshi@gmail.com` | personal address, never meant to be forward-facing | 2026-09-18 |
| `steve@tetnetwork.org` | the replacement — but `tetnetwork.org` was never registered, so it bounced | 2026-09-23 |

Current contact is **`tetsteve@proton.me`**, which exists. Both dead addresses are probed above
because a stale PDF is exactly how the first one survived a source-level scrub.

## Related

| Document | Relation |
|----------|----------|
| [`WHITEPAPER_v1.1_DRAFT.md`](./WHITEPAPER_v1.1_DRAFT.md) | Source of truth for the render |
| [`../WHITEPAPER.md`](../WHITEPAPER.md) | Canonical whitepaper (kept in sync with the draft) |
| [`scripts/render_phrack_wp_pdf.py`](./scripts/render_phrack_wp_pdf.py) | The renderer |
| [`styles/phrack_wp.css`](./styles/phrack_wp.css) | Print stylesheet |
