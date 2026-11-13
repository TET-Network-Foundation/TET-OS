# Home page wordmark — three variants (exploration, not shipped)

The founder asked for three looks for the centred home screen, to pick from. The shipped page is
unchanged until one is picked.

| | wordmark | text | Japanese fallback |
|---|---|---|---|
| **A** 1999 search-engine feel | "TET" in Libre Baskerville Bold, each letter a different colour from TET's own verdict palette: indigo `#1a237e` (named), forest `#1f5132` (verified), oxblood `#8a1f1f` (refused); lighter tints in dark mode | Libre Baskerville | Shippori Mincho |
| **B** hacker terminal | `> TET_` in JetBrains Mono; amber on black in dark mode, dark green on paper in light mode | JetBrains Mono | M PLUS 1 Code |
| **C** modern minimal | "TET." in Archivo Black-weight, expanded; black and white plus one accent (`#2f6bff`) | Archivo | Zen Kaku Gothic New |

In all three the live strip stays monospace (JetBrains Mono), and the logo sits beside the
wordmark at the same size. Its dark-mode ring is the site's own.

- **Fonts:** all SIL Open Font License, from google/fonts, self-hosted. No Inter, no system UI
  font. They aren't committed (the Japanese ones are megabytes); `src/fetch-fonts.sh` fetches
  them, licences included.
- **The strip is real data:** a snapshot of blocks 8965–8969 from the local testnet node
  (`src/blocks.json`, from `GET /explorer/blocks/recent`), rendered as on the page. No hashes
  were made up.
- **Shots:** desktop in English, phone in Japanese (to exercise the fallback), each in light
  and dark. `sheet-all.png` has all three side by side; `sheet-a/b/c.png` have one each.
- **Rebuild:** `python3 src/gen.py` writes `src/a.html`, `b.html`, `c.html`; open them with the
  fonts fetched; `?lang=ja` switches to Japanese.
- **"Club board"** in the continue line is a real board on the local node, standing in for
  "your last board".
