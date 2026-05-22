#!/usr/bin/env python3
"""Render WHITEPAPER markdown to Phrack-style PDF via headless Chrome."""
from __future__ import annotations

import html
import re
import subprocess
import sys
from pathlib import Path

HEX_MAP: dict[str, str] = {
    "1": "0x01", "2": "0x02", "3": "0x03", "4": "0x04", "5": "0x05",
    "6": "0x06", "7": "0x07", "8": "0x08", "9": "0x09", "10": "0x0A",
    "11": "0x0B", "12": "0x0C", "13": "0x0D", "14": "0x0E", "15": "0x0F",
    "16": "0x10", "17": "0x11", "18": "0x12", "19": "0x13", "20": "0x14",
    "21": "0x15", "22": "0x16",
}

BANNER = r"""
+------------------------------------------------------------------------------+
|  TET NETWORK Issue #1 -- Phrack-Style WP v1.1                                |
|  Fluid P2P Compute-Energy Resource Protocol / AI-Native Sovereign Layer 1    |
+------------------------------------------------------------------------------+
"""

SEPARATOR = "--==[ TET NETWORK / WHITEPAPER v1.1 ]==----------------------------------"

# ~52 chars fit one column at 10pt; full page ~78 chars at 10pt, ~110 at 7pt, ~140 at 5.5pt
COL_THRESHOLD = 48
FULL_WIDTH_CHARS = 76


def max_line_width(text: str) -> int:
    return max((len(line) for line in text.splitlines()), default=0)


def width_classes(width: int, *, always_span: bool = False) -> str:
    classes = []
    if always_span or width > COL_THRESHOLD:
        classes.append("span-all")
    if width > 200:
        classes.append("mega-ascii")
    elif width > 105:
        classes.append("ultra-ascii")
    elif width > FULL_WIDTH_CHARS:
        classes.append("wide-ascii")
    return " ".join(classes)


def frame_title(title: str, hex_id: str | None) -> str:
    label = f"[ {hex_id} ] {title}" if hex_id else title
    inner = label.center(70)[:70]
    lines = [
        "=" * 78,
        f"|{inner}|",
        "=" * 78,
    ]
    return "\n".join(lines)


def md_inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        r'<a href="\2" class="fn-ref">\1</a>',
        text,
    )
    return text


def parse_table(lines: list[str], start: int) -> tuple[str, int]:
    rows: list[list[str]] = []
    i = start
    while i < len(lines) and "|" in lines[i]:
        row = [c.strip() for c in lines[i].strip().strip("|").split("|")]
        if row and not all(re.match(r"^[-:]+$", c) for c in row):
            rows.append(row)
        i += 1
    if not rows:
        return "", start
    col_widths = [max(len(rows[r][c]) for r in range(len(rows)) if c < len(rows[r])) for c in range(len(rows[0]))]

    def fmt_row(cells: list[str]) -> str:
        parts = []
        for ci, cell in enumerate(cells):
            w = col_widths[ci] if ci < len(col_widths) else len(cell)
            parts.append(cell.ljust(w)[:w])
        return "| " + " | ".join(parts) + " |"

    rendered = [
        "+" + "-+-".join("-" * (w + 2) for w in col_widths) + "+",
        fmt_row(rows[0]),
        "+" + "-+-".join("-" * (w + 2) for w in col_widths) + "+",
    ]
    for row in rows[1:]:
        rendered.append(fmt_row(row))
    rendered.append("+" + "-+-".join("-" * (w + 2) for w in col_widths) + "+")
    block = "\n".join(rendered)
    cls = width_classes(max_line_width(block), always_span=True)
    if "mega-ascii" in cls:
        out = [
            '<div class="ascii-wrap mega-wrap">',
            f'<pre class="ascii-table {cls}">',
            block,
            "</pre></div>",
        ]
    else:
        out = [f'<pre class="ascii-table {cls}">', block, "</pre>"]
    return "\n".join(out), i


def md_to_html(md: str) -> str:
    lines = md.splitlines()
    body: list[str] = [
        f'<pre class="banner span-all">{html.escape(BANNER.strip())}</pre>',
        f'<p class="sep span-all">{html.escape(SEPARATOR)}</p>',
        '<p class="meta">Phrack-Style WP -- 2026-05-22 | 2-column monospace | hex chapters</p>',
    ]
    footnotes: list[str] = []
    fn_idx = 0
    i = 0
    in_code = False
    code_buf: list[str] = []

    def flush_code():
        nonlocal code_buf
        if code_buf:
            block = chr(10).join(code_buf)
            cls = width_classes(max_line_width(block))
            if max_line_width(block) > 55:
                cls = (cls + " ascii-figure").strip()
            if any(ch in block for ch in "Σ∈_{}·") or "verified_tasks" in block:
                cls = (cls + " math").strip()
            if "_" in block and "(" in block and max_line_width(block) < 55:
                cls = (cls + " identifier-line").strip()
            body.append(f'<pre class="code {cls}">{html.escape(block)}</pre>')
            code_buf = []

    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                in_code = True
            i += 1
            continue
        if in_code:
            code_buf.append(line)
            i += 1
            continue
        if line.strip() == "---":
            body.append(f'<p class="sep span-all">{html.escape("=" * 78)}</p>')
            i += 1
            continue
        if line.startswith("# "):
            flush_code()
            t = line[2:].strip()
            body.append(f'<p class="sep span-all">{html.escape(SEPARATOR)}</p>')
            body.append(f'<pre class="part-banner span-all">{html.escape("+" + "-" * 76 + "+")}</pre>')
            body.append(f'<h1 class="part">{md_inline(t)}</h1>')
            body.append(f'<pre class="part-banner span-all">{html.escape("+" + "-" * 76 + "+")}</pre>')
            i += 1
            continue
        if line.startswith("## "):
            flush_code()
            t = line[3:].strip()
            m = re.match(r"^(\d+)\.\s", t)
            hex_id = HEX_MAP.get(m.group(1)) if m else None
            frame = frame_title(t, hex_id)
            body.append(f'<pre class="frame span-all">{html.escape(frame)}</pre>')
            body.append(f'<p class="sep span-all">{html.escape(SEPARATOR)}</p>')
            body.append(f'<h2 id="s{fn_idx}">{md_inline(t)}</h2>')
            i += 1
            continue
        if line.startswith("### "):
            flush_code()
            t = line[4:].strip()
            m = re.match(r"^(\d+)\.(\d+)", t)
            sub_hex = None
            if m:
                sub_hex = f"0x{int(m.group(1)):02X}.{int(m.group(2)):02X}"
            body.append(f'<p class="sep minor">{html.escape("-" * 40)}</p>')
            body.append(f'<h3><span class="hex">{sub_hex or ""}</span> {md_inline(t)}</h3>')
            i += 1
            continue
        if line.strip().startswith("|"):
            flush_code()
            tbl, i = parse_table(lines, i)
            body.append(tbl)
            continue
        if line.strip().startswith(">"):
            flush_code()
            body.append(f'<blockquote>{md_inline(line.strip().lstrip("> ").strip())}</blockquote>')
            i += 1
            continue
        if re.match(r"^\[\d+\]", line.strip()):
            footnotes.append(f"<li>{md_inline(line.strip())}</li>")
            i += 1
            continue
        if not line.strip():
            i += 1
            continue
        flush_code()
        if re.search(r"\[.+\]\(.+\)", line):
            fn_idx += 1
            body.append(f'<p>{md_inline(line)} <sup class="fn">[{fn_idx}]</sup></p>')
        else:
            body.append(f"<p>{md_inline(line)}</p>")
        i += 1
    flush_code()
    if footnotes:
        body.append('<div class="footnotes"><p class="sep span-all">--==[ REFERENCES ]==--</p><ol>')
        body.extend(footnotes)
        body.append("</ol></div>")
    return "\n".join(body)


def build_html(md_path: Path, css_path: Path) -> str:
    md = md_path.read_text(encoding="utf-8")
    body = md_to_html(md)
    css = css_path.read_text(encoding="utf-8")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>TET Network Issue #1 -- Phrack-Style WP v1.1</title>
<style>{css}</style>
</head>
<body>
{body}
</body>
</html>"""


def main() -> int:
    docs = Path(__file__).resolve().parent.parent
    md_path = docs / "WHITEPAPER_v1.1_DRAFT.md"
    css_path = docs / "styles" / "phrack_wp.css"
    html_path = docs / "WHITEPAPER_v1.1_DRAFT.phrack.html"
    pdf_path = docs / "WHITEPAPER_v1.1_DRAFT.pdf"
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if not md_path.exists():
        print(f"Missing {md_path}", file=sys.stderr)
        return 1
    html_path.write_text(build_html(md_path, css_path), encoding="utf-8")
    if not chrome.exists():
        print("Chrome not found; HTML written only:", html_path, file=sys.stderr)
        return 1
    cmd = [
        str(chrome),
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        "--print-to-pdf-no-header",
        f"--print-to-pdf={pdf_path}",
        html_path.as_uri(),
    ]
    subprocess.run(cmd, check=True, timeout=120)
    print(f"PDF: {pdf_path} ({pdf_path.stat().st_size} bytes)")
    print(f"HTML: {html_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
