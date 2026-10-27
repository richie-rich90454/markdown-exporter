# Markdown conformance snapshot

This is the fixed compatibility target for the local editor. It combines CommonMark, GFM, and the syntax documented by Typora. It is a project snapshot, not a promise to track future Typora changes automatically.

Legend: a checked item is implemented by the shared preview renderer. It does not mean that every item has complete rich-editor and every-export fixture coverage. **Partial** marks a known output limitation. The editor and exporter regression matrices are being expanded alongside implementation.

## CommonMark and GFM

- [x] Headings, paragraphs, hard and soft line breaks, thematic breaks, escapes
- [x] Emphasis, strong emphasis, nested inline formatting, block quotes
- [x] Ordered and unordered lists, nested lists, fenced and indented code
- [x] Inline code, links, images, autolinks, reference links
- [x] GFM tables, task lists, strikethrough, autolink literals, footnotes
- [x] Syntax highlighting for fenced code blocks

## Typora extensions

- [x] YAML and TOML front matter; metadata is kept out of the rendered body
- [x] `[TOC]` with generated heading anchors
- [x] GitHub-style alerts: NOTE, TIP, IMPORTANT, WARNING, and CAUTION
- [x] Emoji shortcodes
- [x] `==highlight==`, `~subscript~`, and `^superscript^`
- [x] Raw HTML is parsed and sanitized. Scripts, event handlers, unsafe URL schemes, and embeds are removed.
- [x] Legacy `sequence` fences (js-sequence message and note syntax)
- [x] Legacy `flow` fences (flowchart.js node definitions, chained edges, and labeled branches)
- [x] Mermaid code fences render locally with strict security and sanitized SVG output
- [x] Typora-documented Mermaid sequence, flowchart, Gantt, class, state, pie, requirement,
      Gitgraph, C4, mindmap, timeline, quadrant, Sankey, and XY chart syntaxes
- [x] Optional ZenUML preview; **Partial:** its embedded HTML labels cannot be drawn into the PDF, so the PDF shows a clear preview hint

## Mathematics

- [x] `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, and fenced `math`
- [x] KaTeX commands, MathML output, common physics macros, and mhchem chemistry commands
- [x] Labeled display equations, automatic labels, `\ref`, and `\eqref`
- [x] Currency delimiter guard for amounts such as `$2` and `$2 and $3`
- [x] Invalid formulas remain visible and do not interrupt later blocks
- [x] Standalone HTML embeds KaTeX CSS, local font data, HTML output, and MathML for offline viewing
- [x] Standalone HTML embeds fetchable image assets; inaccessible images become alt-text fallbacks
- [x] PDF includes visible vector text and an invisible searchable TeX text layer
- [x] PDF embeds KaTeX TrueType fonts, maps glyphs for selection/search, draws fraction/radical rules as vectors, and uses the shared preview layout for sizing and page breaks

## Files, recovery, and performance

- [x] Milkdown/ProseMirror rich editing opens by default; CodeMirror 6 source and inline modes remain available
- [x] The CodeMirror modes share one source document and history; rich editing is synchronized through the same document store
- [ ] Rich mode has exact source-preserving round trips for every unsupported extension; use Source mode for unfamiliar or unsupported syntax
- [x] Open and save individual local files when the browser supports file handles
- [x] Local folder sidebar with Markdown file discovery and open/save
- [x] Ordered book sections, metadata, local references, rename/reorder/delete, outline, word counts, and manuscript-wide search/replace
- [x] Versioned `book.json` folders and `.mdbook` ZIP packages with path and expanded-size validation
- [x] File input and download fallbacks for browsers without local file handles
- [x] Current Markdown and the complete book project recover on-device through IndexedDB, with localStorage fallback
- [x] KaTeX and Mermaid JavaScript load only when the corresponding feature is used
- [x] Inline editor decorations stay near visible ranges, with full-document fence and delimiter context
- [x] Preview canvas pages outside the visible region are released and repainted when needed
- [x] PDF, standalone HTML, EPUB 3, and DOCX exports are loaded only when selected
- [x] PDF, HTML, EPUB, and DOCX exports include the ordered book sections; the live paginated preview still shows the active section
- [x] PDF book exports include page numbers and running book-title headers
- [x] DOCX book exports apply the selected trim size and margins, with running headers and page-number fields
- [ ] PDF TOC links, full cross-browser rich editing, automated EPUBCheck, and a 100,000-word responsiveness benchmark are not yet verified

## Regression fixtures

The automated suite includes fixtures for the reported math, PDF layout, multilingual PDF text, local file recovery, book archives, EPUB/DOCX packages, chapter breaks, page-size geometry, and local citation output. It does not yet execute every checklist item through every editor mode and all four exporters. This is an explicit coverage gap, not a claim that the full Typora compatibility matrix has passed.

## References

- [CommonMark specification](https://spec.commonmark.org/)
- [GitHub Flavored Markdown specification](https://github.github.com/gfm/)
- [Typora Markdown reference](https://support.typora.io/Markdown-Reference/)
- [Typora math reference](https://support.typora.io/Math/)
- [Typora diagrams reference](https://support.typora.io/Draw-Diagrams-With-Markdown/)
- [KaTeX supported functions](https://katex.org/docs/supported)
- [KaTeX error handling](https://katex.org/docs/error)
