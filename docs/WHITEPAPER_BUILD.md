# Whitepaper build — Phrack-style HTML + PDF

**The PDF is a build artifact and is no longer tracked in git.** Regenerate it on demand with the
command below. Source of truth is [`WHITEPAPER_v1.1_DRAFT.md`](./WHITEPAPER_v1.1_DRAFT.md).

## Why it is not tracked

`docs/WHITEPAPER_v1.1_DRAFT.pdf` was removed on 2026-09-18. It was generated on 2026-05-24 and
therefore still embedded the **old personal contact address**, which had since been replaced
throughout the markdown sources. A rendered binary cannot be scrubbed with a text edit, and a stale
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
# macOS — Spotlight importer
mdimport -t -d3 docs/WHITEPAPER_v1.1_DRAFT.pdf 2>&1 | grep -ic "yizhenxianshi"   # expect 0
mdimport -t -d3 docs/WHITEPAPER_v1.1_DRAFT.pdf 2>&1 | grep -ic "quantum"          # expect > 0 (sanity)

# elsewhere
pdftotext docs/WHITEPAPER_v1.1_DRAFT.pdf - | grep -ic "yizhenxianshi"
```

Always run the second probe too. If a term you *know* is in the document returns 0, the extractor is
not working and a "clean" result on the first probe means nothing.

## Related

| Document | Relation |
|----------|----------|
| [`WHITEPAPER_v1.1_DRAFT.md`](./WHITEPAPER_v1.1_DRAFT.md) | Source of truth for the render |
| [`../WHITEPAPER.md`](../WHITEPAPER.md) | Canonical whitepaper (kept in sync with the draft) |
| [`scripts/render_phrack_wp_pdf.py`](./scripts/render_phrack_wp_pdf.py) | The renderer |
| [`styles/phrack_wp.css`](./styles/phrack_wp.css) | Print stylesheet |
