# brand

`og-card.html` is the source of the Open Graph card served at `/og.png`, 1200x630. This
directory is not served; it exists so the card can be re-rendered rather than re-drawn.

## Token scope

The card imports `src/styles/global.css` and consumes its shared paper, ink, amber, surface,
and border tokens. It declares no separate palette. The `.brand-card` scope retains the
established editorial social-card typography: `--font-display` is Source Serif 4 and
`--font-body` is Inter. This scope preserves the approved card family; the reference site's
navigation and documentation retain their own display and body fonts. Text remains live HTML,
not outlined glyphs. Essential content fits within the centered 630px square crop.

## Asset provenance

The card loads its existing, unmodified Inter and Source Serif 4 families from Google Fonts
at render time. No font software is bundled or redistributed; only the rendered PNG ships.
Both families use SIL Open Font License 1.1, which permits this rendered-document use without
applying the font-software license to the resulting image:

- Inter: copyright 2020 The Inter Project Authors; [upstream project](https://github.com/rsms/inter),
  [authoritative license](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt).
- Source Serif 4: copyright 2014 The Source Serif 4 Project Authors;
  [upstream project](https://github.com/adobe-fonts/source-serif),
  [authoritative license](https://github.com/google/fonts/blob/main/ofl/sourceserif4/OFL.txt).

These are the existing Google Fonts API assets, not a newly vendored or version-pinned font
package. The renderer rejects failed font loads instead of capturing a fallback face.

The dial is the existing Model Citizen “Concept 09, Dial pointer” mark by Jake Selby,
from `vendor/agent-harness/docs/assets/brand/mark.svg` at commit
`7f89545a907817420020becfaf487e7e8b816222`, SHA-256
`0333719aa6c3e2414b523647a77b646fea73ee8c7ea4a455eb510d9709118d38`.
The [source mark](https://github.com/JakeSelby/model-citizen/blob/7f89545a907817420020becfaf487e7e8b816222/docs/assets/brand/mark.svg)
and [repository MIT license](https://github.com/JakeSelby/model-citizen/blob/7f89545a907817420020becfaf487e7e8b816222/LICENSE)
retain its provenance. The card keeps the circle and pointer geometry, applies shared site
colors, and retains its existing rounded frame. No external illustration was added.

## Render

Regenerate from the repository root with `./brand/render-og-card.sh`. It needs Node.js 22,
network access, Pillow, and Google Chrome at the path it names. Chrome uses an isolated
temporary profile and waits for `document.fonts.ready` plus the required font faces before
capturing. The PNG dimensions are asserted after capture. The favicons come from the same
mark in the harness repository.
