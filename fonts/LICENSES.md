# Hebrew font licenses

Every face here is subset to the Hebrew range (`U+0590–05FF`, `U+FB1D–FB4F`
plus a few marks) with `fontTools`, retaining all OpenType layout features so
nikud and cantillation positioning survives. Files are named
`he-<selector-id>-<weight>.woff2`; the selector ids come from `FONTS` in
`build/lib/manifest.mjs`.

| id | Family shipped | Weights | License | Upstream |
| --- | --- | --- | --- | --- |
| `ruehl` | Frank Ruehl CLM | 400 (Medium), 700 (Bold) | **GNU GPL v2 + font exception** | <https://opensiddur.org/wp-content/uploads/fonts/FrankRuehlCLM/FrankRuehlCLM.zip> (Culmus Project) |
| `noto` | Noto Serif Hebrew | 400, 500 | SIL OFL 1.1 | Google Fonts |
| `cardo` | Cardo | 400 only — see note | SIL OFL 1.1 | Google Fonts |
| `stam` | Shlomo SemiStam | 400 | SIL OFL 1.1 | <https://opensiddur.org/wp-content/uploads/fonts/ShlomoSemiStam/ShlomoSemiStam.zip> (derivative of Ezra SIL SR) |
| `times` | Tinos | 400, 700 | Apache 2.0 | Google Fonts |
| `arial` | Arimo | 400, 500 | Apache 2.0 | Google Fonts |

## Why Cardo ships without a bold

Google's Cardo 700 hebrew subset has an entirely empty `GPOS` and `GSUB` table
— no `mark` attachment, no `ccmp`. Verified byte-identical to upstream, so it
is an upstream defect rather than a subsetting error. Shipping it would render
every nikud and ta'am inside a `<b>` at its default unpositioned location, and
`<b>` opens most sections of the liturgy. Cardo therefore ships regular-only
and `<b>` is synthesised from it, which keeps mark positioning correct.

## Frank Ruehl CLM — GPL obligations

`he-ruehl-400.woff2` / `he-ruehl-700.woff2` are the only GPL-licensed files
here, and they are the site's **default** Hebrew face. The full license text
ships alongside them as `FrankRuehlCLM-LICENSE.txt` and
`FrankRuehlCLM-GNU-GPL-v2.txt`, and the upstream URL above is the
corresponding source. The font exception means embedding these faces in a
document does not place the document under the GPL.

Copyright 2007–2010 Yoram Gnat; Latin glyphs (URW)++ Design & Development;
Hebrew vowel-mark positioning © 2010 Yoram Gnat. Packaged for the Culmus
Project via OpenSiddur.

## Why "Arial" and "Times New Roman" ship as Arimo and Tinos

Arial and Times New Roman are proprietary and cannot be self-hosted. Arimo and
Tinos are their metric-compatible open counterparts and are what those two
selector entries actually load.

A `local('Arial')` / `local('Times New Roman')` shortcut was deliberately NOT
used. Those families are metric-compatible for **Latin** only — measured against
real Hebrew letters, Arimo's Hebrew is ~14% taller than Arial's and Tinos' is
~6% shorter than Times'. Since a single `@font-face` carries one `size-adjust`,
a `local()` chain would make Hebrew text size jump depending on whether the
reader happens to have the Monotype fonts installed. Always serving the webfont
keeps rendering identical on every platform.
