# Markdown Exporter

A local-first Markdown writing and publishing app for the browser. Documents stay on the device; the app can be hosted as a static site and works offline after its shell and used assets have been cached.

## Writing

- Rich editing opens by default, with CodeMirror source and inline-markdown modes available from the editor toolbar.
- Formatting commands cover headings, emphasis, links, tables, images, code, footnotes, and math. Source Markdown remains the saved document format.
- The paginated preview and PDF exporter use the same page-layout engine. Page presets include A4, A5, 6 × 9 inches, Letter, Legal, and custom dimensions.
- The manuscript sidebar supports chapters, front and back matter, reorder, rename, delete, outlines, cross-section search and replacement, and per-section and total word counts.
- Recovery stores the current book project in IndexedDB, with a local-storage fallback. Folder and `.mdbook` saves keep assets and metadata with the Markdown chapters.

## Publishing

- PDF keeps selectable text, searchable math, page numbers, running book-title headers, and book title and contents pages.
- Standalone HTML embeds its styles, math fonts, and local images for offline use.
- EPUB 3 includes navigation, metadata, local assets, math output, and optional generated references.
- DOCX preserves semantic headings, tables, page breaks, MathML equations where supported, selected page dimensions and margins, running book-title headers, and page-number fields.
- Local BibTeX and CSL files support cite-key markers such as `[@smith2020]`; APA is the default style. Manually authored references and footnotes remain Markdown content.

For the supported Markdown syntax and known gaps, see the [conformance snapshot](docs/markdown-conformance.md). For the book folder and `.mdbook` schema, see [book project format](docs/book-project-format.md).

## Run locally

```sh
pnpm install
pnpm dev
```

## Privacy

The app has no account, upload service, or telemetry. It uses local file-picker and folder APIs only after the author selects them. Browsers without folder access can open files through a picker and save through downloads. The production build removes analytics injection and external analytics permissions.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

MIT. Author richie-rich90454.
