# Markdown Exporter identity

The folded folio combines the familiar Markdown M with two leaves of paper. The central crease is the transition from writing to a finished document. Two small baseline rules recall the edges of a manuscript.

The palette is deep ink green (`#152522`), warm paper (`#F9F4E8`), and aged brass (`#C5AE83`). Color belongs to the app identity; document exports keep their own typography and paper settings.

- `public/brand/icon.svg`: master application icon; resolution independent, with no embedded bitmap or external resource.
- `public/brand/mark.svg`: one-color symbol using `currentColor`.
- `public/brand/logo.svg`: symbol and custom drawn wordmark; every letter is a vector path, so no font installation is needed.
- `build/appicon.png` and `build/windows/icon.ico`: packaging derivatives, checked in for reproducible desktop builds.

Leave at least half a stem's width around the mark. Use the monochrome mark at small sizes or on busy backgrounds; keep the full wordmark at least 180px wide. Do not stretch, outline, rotate, or add effects to the symbol.

To regenerate packaging assets after editing the master SVG, install the Playwright Chromium browser and run `pnpm icons:build`. This is only needed when changing the artwork.
