# Book project format

## Folder layout

A book is an ordinary folder with a versioned `book.json`, Markdown section files, and optional local assets, bibliography, and citation style files:

```text
my-book/
  book.json
  front-matter/preface.md
  chapters/01-opening.md
  chapters/02-next-steps.md
  back-matter/references.md
  assets/cover.png
  references/library.bib
  styles/custom.csl
```

The manifest stores metadata and the display order. Paths use `/` separators and are relative to the project root.

```json
{
  "formatVersion": 1,
  "metadata": {
    "title": "A Local Book",
    "subtitle": "A short subtitle",
    "authors": ["A. Writer"],
    "language": "en",
    "publisher": "Local Press",
    "isbn": "",
    "description": "A book written in Markdown.",
    "coverPath": "assets/cover.png"
  },
  "entries": [
    { "id": "front-matter-1", "role": "front-matter", "path": "front-matter/preface.md", "title": "Preface" },
    { "id": "chapter-1", "role": "chapter", "path": "chapters/01-opening.md", "title": "Opening" },
    { "id": "chapter-2", "role": "chapter", "path": "chapters/02-next-steps.md", "title": "Next steps" },
    { "id": "back-matter-1", "role": "back-matter", "path": "back-matter/references.md", "title": "References" }
  ],
  "bibliographyPath": "references/library.bib",
  "citationStylePath": "styles/custom.csl"
}
```

Front matter in a chapter remains in that Markdown file. The renderer removes YAML or TOML front matter from the visible body while preserving it in the source file.

## `.mdbook` archive

`.mdbook` is a ZIP containing the same root-level `book.json` and files as the folder format. It is imported and exported locally. The reader rejects traversal paths, symbolic links, encrypted and multi-disk archives, and packages larger than the configured archive, file, and expanded-size limits.

## Markdown and assets

Chapter Markdown is UTF-8. Relative image paths resolve from the Markdown file's folder. Shared images can live in `assets/` and be referenced with an appropriate relative path. Unreferenced project files remain in the project when saved.

BibTeX entries can be cited with markers such as `[@smith2020]` and `[@smith2020; @lee2022]`. An imported local CSL style takes precedence over the built-in APA style. Unknown cite keys remain visible as written. A manually authored references section and footnotes remain ordinary Markdown.

## Saving and recovery

An opened `.md` file is represented as a single-section project and is still saved as Markdown unless the author chooses a book-folder or `.mdbook` save. Book recovery stores the manifest, chapter text, local assets, and active section on this device. Folder APIs are used only when available and authorized by the browser; otherwise file-picker and download flows remain available.
