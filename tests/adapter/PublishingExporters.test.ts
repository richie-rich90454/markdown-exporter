import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";

import { DocxExporter } from "../../src/adapter/exporter/DocxExporter";
import { HtmlExporter } from "../../src/adapter/exporter/HtmlExporter";
import { EpubExporter } from "../../src/adapter/exporter/EpubExporter";
import { PdfExporter } from "../../src/adapter/exporter/PdfExporter";
import { publicationSlug } from "../../src/adapter/exporter/BookExportContent";
import { DirectDomWriter } from "../../src/adapter/renderer/DirectDomWriter";
import { UnifiedMarkdownRenderer } from "../../src/adapter/renderer/UnifiedMarkdownRenderer";
import { ExportFormat } from "../../src/domain/ExportFormat";
import { ExportRequest } from "../../src/domain/ExportRequest";
import { createSingleChapterBook } from "../../src/domain/BookProject";
import { MarkdownDocument } from "../../src/domain/MarkdownDocument";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { PageSetup } from "../../src/domain/PageSetup";
import type { Clock } from "../../src/port/Clock";
import type { FileSaver } from "../../src/port/FileSaver";
import { CONFORMANCE_MARKDOWN } from "../fixtures/markdownConformance";

const PAGE_SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

class MemoryFileSaver implements FileSaver {
    blob: Blob | undefined;
    filename = "";

    saveBlob(blob: Blob, name: string): void {
        this.blob = blob;
        this.filename = name;
    }
}

class FixedClock implements Clock {
    nowEpochMs(): number {
        return 1_700_000_000_000;
    }
}

function request(
    format: ExportFormat,
    bookProject?: ReturnType<typeof createSingleChapterBook>,
    isBookProject = bookProject !== undefined
): ExportRequest {
    const content = document.createDocumentFragment();
    const title = document.createElement("h1");
    title.textContent = "A test book";
    title.id = "a-test-book";
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "An <strong>editable</strong> paragraph.";
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Term</th></tr></thead><tbody><tr><td>Value</td></tr></tbody>";
    const math = document.createElement("span");
    math.className = "katex";
    math.innerHTML =
        '<math><semantics><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow><annotation encoding="application/x-tex">x=2</annotation></semantics></math>';
    content.append(title, paragraph, table, math);
    const rendered = new RenderedDocument(
        content.cloneNode(true) as DocumentFragment,
        "A test book",
        0
    );
    return new ExportRequest(
        format,
        rendered,
        "A test book",
        content,
        PAGE_SETUP,
        bookProject,
        (source) => {
            const chapter = document.createDocumentFragment();
            const paragraph = document.createElement("p");
            paragraph.textContent = source;
            chapter.append(paragraph);
            return Promise.resolve(chapter);
        },
        isBookProject
    );
}

function multilingualBook() {
    const base = createSingleChapterBook("Preface body", "Metadata title");
    const first = base.manifest.entries[0];
    if (first === undefined) throw new Error("The fixture needs one initial chapter.");
    return {
        ...base,
        manifest: {
            ...base.manifest,
            metadata: {
                ...base.manifest.metadata,
                title: "A multilingual book",
                subtitle: "A short subtitle",
                authors: ["A. Writer"],
                language: "zh-CN",
                publisher: "Local Press",
                isbn: "9781234567890",
                description: "A short description of the book."
            },
            entries: [
                { ...first, id: "opening", role: "front-matter" as const, title: "前言" },
                {
                    id: "chapter 1",
                    role: "chapter" as const,
                    path: "chapters/chapter-2.md",
                    title: "第一章"
                },
                {
                    id: "chapter/1",
                    role: "back-matter" as const,
                    path: "chapters/chapter-3.md",
                    title: "尾声"
                }
            ]
        },
        files: {
            ...base.files,
            "chapters/chapter-2.md":
                "First chapter body with diagram and footnote[^source].\n\n[^source]: Footnote detail.",
            "chapters/chapter-3.md": "Afterword body[^source].\n\n[^source]: A second footnote."
        }
    };
}

function bookRequest(
    format: ExportFormat,
    bookProject: ReturnType<typeof multilingualBook>,
    title = "Toolbar title"
): ExportRequest {
    const content = document.createDocumentFragment();
    const rendered = new RenderedDocument(content.cloneNode(true) as DocumentFragment, title, 0);
    return new ExportRequest(
        format,
        rendered,
        title,
        content,
        PAGE_SETUP,
        bookProject,
        (source) => {
            const chapter = document.createDocumentFragment();
            const paragraph = document.createElement("p");
            paragraph.textContent = source
                .replace(/\n\n\[\^source\]:[\s\S]*$/, "")
                .replace("[^source]", "");
            chapter.append(paragraph);
            const repeatedHeading = document.createElement("h2");
            repeatedHeading.id = "shared-heading";
            repeatedHeading.textContent = "Repeated heading";
            const localLink = document.createElement("a");
            localLink.href = "#shared-heading";
            localLink.textContent = "Jump to repeated heading";
            chapter.append(repeatedHeading, localLink);
            if (source.includes("diagram")) {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("width", "120");
                svg.setAttribute("height", "60");
                svg.setAttribute("viewBox", "0 0 120 60");
                svg.setAttribute("aria-label", "A labeled diagram");
                const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
                line.setAttribute("d", "M 5 30 L 115 30");
                line.setAttribute("stroke", "black");
                svg.append(line);
                chapter.append(svg);

                const mathContainer = document.createElement("span");
                mathContainer.className = "katex";
                const math = document.createElementNS("http://www.w3.org/1998/Math/MathML", "math");
                const semantics = document.createElementNS(
                    "http://www.w3.org/1998/Math/MathML",
                    "semantics"
                );
                const row = document.createElementNS("http://www.w3.org/1998/Math/MathML", "mrow");
                const identifier = document.createElementNS(
                    "http://www.w3.org/1998/Math/MathML",
                    "mi"
                );
                identifier.textContent = "x";
                row.append(identifier);
                const annotation = document.createElementNS(
                    "http://www.w3.org/1998/Math/MathML",
                    "annotation"
                );
                annotation.setAttribute("encoding", "application/x-tex");
                annotation.textContent = "x";
                semantics.append(row, annotation);
                math.append(semantics);
                mathContainer.append(math);
                chapter.append(mathContainer);
            }
            if (source.includes("[^source]")) {
                const reference = document.createElement("sup");
                const link = document.createElement("a");
                link.href = "#user-content-fn-source";
                link.id = "user-content-fnref-source";
                link.setAttribute("data-footnote-ref", "");
                link.textContent = "1";
                reference.append(link);
                paragraph.append(reference);

                const notes = document.createElement("section");
                notes.className = "footnotes";
                notes.setAttribute("data-footnotes", "");
                const list = document.createElement("ol");
                const note = document.createElement("li");
                note.id = "user-content-fn-source";
                const noteBody = document.createElement("p");
                noteBody.textContent =
                    /\[\^source\]:\s*([^\r\n]+)/.exec(source)?.[1] ?? "Footnote detail.";
                const backlink = document.createElement("a");
                backlink.href = "#user-content-fnref-source";
                backlink.setAttribute("data-footnote-backref", "");
                backlink.textContent = "↩";
                noteBody.append(backlink);
                note.append(noteBody);
                list.append(note);
                notes.append(list);
                chapter.append(notes);
            }
            return Promise.resolve(chapter);
        }
    );
}

function conformanceProject() {
    const base = createSingleChapterBook(CONFORMANCE_MARKDOWN, "Conformance manuscript");
    const chapterPath = base.manifest.entries[0]!.path;
    return {
        ...base,
        manifest: {
            ...base.manifest,
            metadata: { ...base.manifest.metadata, authors: ["A. Writer"], language: "zh-CN" },
            bibliographyPath: "references.bib"
        },
        files: {
            ...base.files,
            [chapterPath]: CONFORMANCE_MARKDOWN,
            "references.bib":
                "@book{smith2020, author={John Smith}, title={A Book}, year={2020}, publisher={Local Press}}"
        }
    };
}

function conformanceRequest(
    format: ExportFormat,
    project: ReturnType<typeof conformanceProject>,
    renderedCorpus: DocumentFragment
): ExportRequest {
    const content = document.createDocumentFragment();
    const rendered = new RenderedDocument(
        content.cloneNode(true) as DocumentFragment,
        "Conformance manuscript",
        0
    );
    return new ExportRequest(
        format,
        rendered,
        "Conformance manuscript",
        content,
        PAGE_SETUP,
        project,
        () => Promise.resolve(renderedCorpus.cloneNode(true) as DocumentFragment)
    );
}

async function readExportText(saver: MemoryFileSaver, format: ExportFormat): Promise<string> {
    const blob = saver.blob;
    if (blob === undefined) throw new Error("The exporter did not save a publication.");
    if (format === ExportFormat.HTML) return blob.text();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (format === ExportFormat.PDF) return new TextDecoder("latin1").decode(bytes);
    return Object.entries(unzipSync(bytes))
        .filter(
            ([path]) => path.endsWith(".xml") || path.endsWith(".xhtml") || path.endsWith(".svg")
        )
        .map(([, file]) => new TextDecoder().decode(file))
        .join("\n");
}

async function withSvgMeasurements<T>(run: () => Promise<T>): Promise<T> {
    const svgPrototype = SVGElement.prototype;
    const htmlPrototype = HTMLElement.prototype;
    const originalBox = Object.getOwnPropertyDescriptor(svgPrototype, "getBBox");
    const originalSvgLength = Object.getOwnPropertyDescriptor(
        svgPrototype,
        "getComputedTextLength"
    );
    const originalHtmlLength = Object.getOwnPropertyDescriptor(
        htmlPrototype,
        "getComputedTextLength"
    );
    Object.defineProperty(svgPrototype, "getBBox", {
        configurable: true,
        value: () => ({ x: 0, y: 0, width: 120, height: 36 })
    });
    const measureText = function (this: Element): number {
        return (this.textContent?.length ?? 0) * 8;
    };
    Object.defineProperty(svgPrototype, "getComputedTextLength", {
        configurable: true,
        value: measureText
    });
    Object.defineProperty(htmlPrototype, "getComputedTextLength", {
        configurable: true,
        value: measureText
    });
    try {
        return await run();
    } finally {
        if (originalBox === undefined) Reflect.deleteProperty(svgPrototype, "getBBox");
        else Object.defineProperty(svgPrototype, "getBBox", originalBox);
        if (originalSvgLength === undefined)
            Reflect.deleteProperty(svgPrototype, "getComputedTextLength");
        else Object.defineProperty(svgPrototype, "getComputedTextLength", originalSvgLength);
        if (originalHtmlLength === undefined)
            Reflect.deleteProperty(htmlPrototype, "getComputedTextLength");
        else Object.defineProperty(htmlPrototype, "getComputedTextLength", originalHtmlLength);
    }
}

function cslWithCitationPrefix(prefix: string): string {
    return (
        `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">` +
        `<info><title>${prefix} test style</title><id>http://example.com/styles/${prefix.toLowerCase()}</id>` +
        `<link href="http://example.com/styles/${prefix.toLowerCase()}" rel="self"/><updated>2020-01-01T00:00:00+00:00</updated></info>` +
        `<citation><layout prefix="${prefix}[" suffix="]"><text variable="title"/></layout></citation>` +
        `<bibliography><layout><text variable="title"/></layout></bibliography></style>`
    );
}

describe("publishing exporters", () => {
    it("publishes a one-chapter book with its metadata, title page, contents, and chapter anchor", async () => {
        const project = createSingleChapterBook(
            "# Opening chapter\n\nThe first page.",
            "A one-chapter book"
        );
        const exporters = [
            [ExportFormat.HTML, HtmlExporter],
            [ExportFormat.EPUB, EpubExporter],
            [ExportFormat.DOCX, DocxExporter],
            [ExportFormat.PDF, PdfExporter]
        ] as const;

        for (const [format, Exporter] of exporters) {
            const saver = new MemoryFileSaver();
            await new Exporter(saver).export(request(format, project, true));
            const output = await readExportText(saver, format);
            expect(output).toContain("A one-chapter book");
            expect(output).toContain("Contents");
            expect(output).toContain("Opening chapter");
        }

        const htmlSaver = new MemoryFileSaver();
        await new HtmlExporter(htmlSaver).export(request(ExportFormat.HTML, project, true));
        const html = await (htmlSaver.blob as Blob).text();
        expect(html).toContain("book-title-page");
        expect(html).toContain("book-table-of-contents");
        expect(html).toContain('id="book-chapter-chapter-1"');
        expect(html).toContain('id="section-1"');
        expect(html).toContain('href="#section-1"');
    });

    it("writes an EPUB 3 package with navigation and semantic content", async () => {
        const saver = new MemoryFileSaver();
        const result = await new EpubExporter(saver).export(request(ExportFormat.EPUB));
        const blob = saver.blob;
        expect(result.kind).toBe("success");
        expect(saver.filename).toBe("a-test-book.epub");
        expect(blob).toBeDefined();
        const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
        const nameLength = new DataView(bytes.buffer).getUint16(26, true);
        expect(new TextDecoder().decode(bytes.subarray(30, 30 + nameLength))).toBe("mimetype");
        expect(new DataView(bytes.buffer).getUint16(8, true)).toBe(0);
        const files = unzipSync(bytes);
        expect(new TextDecoder().decode(files["mimetype"])).toBe("application/epub+zip");
        const packageXml = new TextDecoder().decode(files["OEBPS/package.opf"]);
        const navigation = new TextDecoder().decode(files["OEBPS/nav.xhtml"]);
        const chapter = new TextDecoder().decode(files["OEBPS/chapter-1.xhtml"]);
        expect(packageXml).toContain('version="3.0"');
        expect(packageXml).toContain("application/xhtml+xml");
        expect(navigation).toContain("A test book");
        expect(navigation).toContain("chapter-1.xhtml#a-test-book");
        expect(chapter).toContain("application/x-tex");
        expect(chapter).toContain("editable");
    });

    it("writes a semantic Word package with headings, tables, and native math", async () => {
        const saver = new MemoryFileSaver();
        const result = await new DocxExporter(saver).export(request(ExportFormat.DOCX));
        expect(result.kind).toBe("success");
        expect(saver.filename).toBe("a-test-book.docx");
        expect(saver.blob).toBeDefined();
        const archive = unzipSync(new Uint8Array(await (saver.blob as Blob).arrayBuffer()));
        const documentXml = new TextDecoder().decode(archive["word/document.xml"]);
        expect(documentXml).toContain("Heading1");
        expect(documentXml).toContain("editable");
        expect(documentXml).toContain("<w:tbl>");
        expect(documentXml).toContain("<m:oMath");
    });

    it("uses the Markdown heading as the title for single-file publishing", async () => {
        const project = createSingleChapterBook("The chapter body.");
        const epubSaver = new MemoryFileSaver();
        const content = document.createDocumentFragment();
        const source = new ExportRequest(
            ExportFormat.EPUB,
            new RenderedDocument(content.cloneNode(true) as DocumentFragment, "A real title", 0),
            "A real title",
            content,
            PAGE_SETUP,
            project,
            () => Promise.resolve(document.createDocumentFragment()),
            false
        );
        await new EpubExporter(epubSaver).export(source);
        const epub = unzipSync(new Uint8Array(await (epubSaver.blob as Blob).arrayBuffer()));
        expect(new TextDecoder().decode(epub["OEBPS/package.opf"])).toContain(
            '<dc:title id="pub-title">A real title</dc:title>'
        );
        expect(epubSaver.filename).toBe("a-real-title.epub");

        const docxSaver = new MemoryFileSaver();
        const docxRequest = new ExportRequest(
            ExportFormat.DOCX,
            source.rendered,
            source.title,
            source.content,
            source.pageSetup,
            project,
            source.renderSource,
            false
        );
        await new DocxExporter(docxSaver).export(docxRequest);
        const docx = unzipSync(new Uint8Array(await (docxSaver.blob as Blob).arrayBuffer()));
        expect(new TextDecoder().decode(docx["docProps/core.xml"])).toContain(
            "<dc:title>A real title</dc:title>"
        );
        expect(docxSaver.filename).toBe("a-real-title.docx");
    });

    it("publishes every ordered book section with metadata", async () => {
        const base = createSingleChapterBook("Chapter one body.", "A test book");
        const project = {
            ...base,
            manifest: {
                ...base.manifest,
                metadata: {
                    ...base.manifest.metadata,
                    authors: ["A. Writer"],
                    publisher: "Local Press"
                },
                entries: [
                    { ...base.manifest.entries[0]!, title: "First chapter" },
                    {
                        id: "chapter-2",
                        role: "chapter" as const,
                        path: "chapters/chapter-2.md",
                        title: "Second chapter"
                    }
                ]
            },
            files: { ...base.files, "chapters/chapter-2.md": "Second chapter body." }
        };
        const epubSaver = new MemoryFileSaver();
        await new EpubExporter(epubSaver).export(request(ExportFormat.EPUB, project));
        const epub = unzipSync(new Uint8Array(await (epubSaver.blob as Blob).arrayBuffer()));
        const packageXml = new TextDecoder().decode(epub["OEBPS/package.opf"]);
        const nav = new TextDecoder().decode(epub["OEBPS/nav.xhtml"]);
        expect(packageXml).toContain("A. Writer");
        expect(packageXml).toContain("Local Press");
        expect(packageXml.match(/<itemref /g)).toHaveLength(3);
        expect(packageXml).toContain('prefix="schema: http://schema.org/"');
        expect(new TextDecoder().decode(epub["OEBPS/titlepage.xhtml"])).toContain("A. Writer");
        expect(nav).toContain("First chapter");
        expect(nav).toContain("Second chapter");
        expect(new TextDecoder().decode(epub["OEBPS/chapter-2.xhtml"])).toContain(
            "Second chapter body."
        );

        const docxSaver = new MemoryFileSaver();
        await new DocxExporter(docxSaver).export(request(ExportFormat.DOCX, project));
        const docx = unzipSync(new Uint8Array(await (docxSaver.blob as Blob).arrayBuffer()));
        const documentXml = new TextDecoder().decode(docx["word/document.xml"]);
        expect(documentXml).toContain("First chapter");
        expect(documentXml).toContain("Second chapter");
        expect(documentXml).toContain('w:type="page"');
        expect(documentXml).toMatch(/<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/);
        expect(documentXml).toContain('w:pgMar w:top="1134"');
        expect(new TextDecoder().decode(docx["word/header1.xml"])).toContain("A test book");
        expect(new TextDecoder().decode(docx["word/footer1.xml"])).toContain("<w:pgNum/>");
        const core = new TextDecoder().decode(docx["docProps/core.xml"]);
        expect(core).toContain("A. Writer");
    });

    it("formats local cite-key markers and adds a generated APA reference list", async () => {
        const base = createSingleChapterBook("An idea [@smith2020].", "A test book");
        const project = {
            ...base,
            manifest: { ...base.manifest, bibliographyPath: "references.bib" },
            files: {
                ...base.files,
                [base.manifest.entries[0]!.path]: "An idea [@smith2020].",
                "references.bib":
                    "@book{smith2020, author={John Smith}, title={A Book}, year={2020}, publisher={Local Press}}"
            }
        };
        const exporters = [
            [ExportFormat.HTML, HtmlExporter],
            [ExportFormat.EPUB, EpubExporter],
            [ExportFormat.DOCX, DocxExporter],
            [ExportFormat.PDF, PdfExporter]
        ] as const;
        for (const [format, Exporter] of exporters) {
            const saver = new MemoryFileSaver();
            await new Exporter(saver).export(request(format, project));
            const bytes = new Uint8Array(await (saver.blob as Blob).arrayBuffer());
            const output =
                format === ExportFormat.HTML
                    ? await (saver.blob as Blob).text()
                    : format === ExportFormat.PDF
                      ? new TextDecoder("latin1").decode(bytes)
                      : Object.entries(unzipSync(bytes))
                            .filter(([path]) => path.endsWith(".xml") || path.endsWith(".xhtml"))
                            .map(([, file]) => new TextDecoder().decode(file))
                            .join("\n");
            expect(output).toContain("Smith");
            expect(output).toContain("A Book");
        }
    });

    it("keeps unresolved local cite keys visible and reports them", async () => {
        const base = createSingleChapterBook("An idea [@missing].", "A test book");
        const project = {
            ...base,
            manifest: { ...base.manifest, bibliographyPath: "references.bib" },
            files: {
                ...base.files,
                "references.bib":
                    "@book{known, author={A Writer}, title={Another Book}, year={2020}}"
            }
        };
        const saver = new MemoryFileSaver();
        await new HtmlExporter(saver).export(request(ExportFormat.HTML, project));
        const html = await (saver.blob as Blob).text();
        expect(html).toContain("[@missing]");
        expect(html).toContain("Unresolved citation keys: missing");
    });

    it("publishes a shared Markdown conformance corpus in every format", async () => {
        const project = conformanceProject();
        const markdownRenderer = new UnifiedMarkdownRenderer(
            new DirectDomWriter(),
            new FixedClock()
        );
        const renderedCorpus = await withSvgMeasurements(
            async () =>
                (await markdownRenderer.render(MarkdownDocument.initial(CONFORMANCE_MARKDOWN)))
                    .content
        );
        expect(renderedCorpus.querySelector(".hljs-keyword")?.textContent).toBe("const");
        expect(renderedCorpus.querySelector("svg.markdown-diagram")).not.toBeNull();
        expect(renderedCorpus.querySelector(".diagram-error code")?.textContent).toContain(
            "not a valid diagram"
        );
        const exporters = [
            [ExportFormat.HTML, HtmlExporter],
            [ExportFormat.EPUB, EpubExporter],
            [ExportFormat.DOCX, DocxExporter],
            [ExportFormat.PDF, PdfExporter]
        ] as const;

        for (const [format, Exporter] of exporters) {
            const saver = new MemoryFileSaver();
            await new Exporter(saver).export(conformanceRequest(format, project, renderedCorpus));
            const output = await readExportText(saver, format);

            expect(output).toContain("Corpus chapter");
            expect(output).toContain("Corpus table cell");
            expect(output).toContain("Typora TOC target");
            expect(output).toContain("highlighted");
            expect(output).toContain("struck text");
            expect(output).toContain("Completed task");
            expect(output).toContain("local reference");
            expect(output).toContain("Warning prose remains in every publication format.");
            expect(output).toContain("inline HTML");
            expect(output).toContain("Corpus footnote detail.");
            expect(output).toContain("Smith");
            expect(output).toContain("A Book");
            expect(output).toContain("frac");
            expect(output).toContain("not a valid diagram");
            expect(output).toContain("Content after malformed blocks remains visible.");
            expect(output).not.toContain("Excluded chapter metadata");
            expect(output).not.toContain("UNSAFE_SCRIPT");

            if (format === ExportFormat.PDF) {
                expect(output).toContain("/Lang (zh-CN)");
                expect(output).toMatch(/4E2D6587/);
                expect(output).toContain("x=2");
                expect(output.includes("Diagram") || output.includes("/Subtype /Image")).toBe(true);
            } else {
                expect(output).toContain("zh-CN");
                expect(output).toContain("中文");
                expect(output).toContain("markdown-diagram");
                if (format === ExportFormat.DOCX) expect(output).toContain("<m:oMath");
                else expect(output).toContain("application/x-tex");
            }
        }
    }, 30_000);

    it("uses updated local CSL content when a style file is replaced at the same path", async () => {
        const base = createSingleChapterBook("An idea [@smith2020].", "A test book");
        const stylePath = "styles/custom.csl";
        const bibliographyPath = "references.bib";
        const citedSource = "An idea [@smith2020].";
        const baseProject = {
            ...base,
            manifest: {
                ...base.manifest,
                bibliographyPath,
                citationStylePath: stylePath
            },
            files: {
                ...base.files,
                [base.manifest.entries[0]!.path]: citedSource,
                [bibliographyPath]:
                    "@book{smith2020, author={John Smith}, title={A Book}, year={2020}}"
            }
        };

        for (const prefix of ["FIRST", "SECOND"]) {
            const project = {
                ...baseProject,
                files: { ...baseProject.files, [stylePath]: cslWithCitationPrefix(prefix) }
            };
            const saver = new MemoryFileSaver();
            await new HtmlExporter(saver).export(request(ExportFormat.HTML, project));
            const html = await readExportText(saver, ExportFormat.HTML);
            expect(html).toContain(`${prefix}[A Book]`);
        }
    }, 30_000);

    it("publishes citations with each bundled APA, Harvard, and Vancouver style", async () => {
        const base = createSingleChapterBook("An idea [@smith2020].", "A test book");
        const bibliographyPath = "references/library.bib";
        const bibliography =
            "@book{smith2020, author={John Smith}, title={A Book}, year={2020}, publisher={Local Press}}";
        const outputs = new Map<string, string>();

        for (const style of ["apa", "harvard1", "vancouver"] as const) {
            const project = {
                ...base,
                manifest: { ...base.manifest, bibliographyPath, citationStyleId: style },
                files: { ...base.files, [bibliographyPath]: bibliography }
            };
            const saver = new MemoryFileSaver();
            await new HtmlExporter(saver).export(request(ExportFormat.HTML, project));
            const html = await readExportText(saver, ExportFormat.HTML);
            expect(html).toContain("A Book");
            expect(html).toContain("Smith");
            outputs.set(style, html);
        }

        expect(new Set(outputs.values()).size).toBe(3);
        expect(outputs.get("vancouver")).toMatch(/\[1\]|\(1\)/);
    }, 30_000);

    it("publishes manuscript language and metadata with unique, semantic EPUB navigation", async () => {
        const project = multilingualBook();
        const epubSaver = new MemoryFileSaver();
        await new EpubExporter(epubSaver).export(bookRequest(ExportFormat.EPUB, project));
        const epub = unzipSync(new Uint8Array(await (epubSaver.blob as Blob).arrayBuffer()));
        const packageXml = new TextDecoder().decode(epub["OEBPS/package.opf"]);
        const nav = new TextDecoder().decode(epub["OEBPS/nav.xhtml"]);
        const frontMatter = new TextDecoder().decode(epub["OEBPS/chapter-1.xhtml"]);
        const bodyMatter = new TextDecoder().decode(epub["OEBPS/chapter-2.xhtml"]);
        const backMatter = new TextDecoder().decode(epub["OEBPS/chapter-3.xhtml"]);
        const chapterIds = [
            ...packageXml.matchAll(/<item id="([^"]+)" href="chapter-\d+\.xhtml"/g)
        ].map((match) => match[1]);

        expect(packageXml).toContain('<dc:title id="pub-title">A multilingual book</dc:title>');
        expect(packageXml).toContain("A short subtitle");
        expect(packageXml).toContain("9781234567890");
        expect(packageXml).toContain("<dc:language>zh-CN</dc:language>");
        expect(packageXml).toContain(
            "<dc:description>A short description of the book.</dc:description>"
        );
        expect(packageXml).toContain(
            '<meta property="schema:accessibilityFeature">alternativeText</meta>'
        );
        expect(packageXml).toContain(
            'href="chapter-2.xhtml" media-type="application/xhtml+xml" properties="mathml svg"'
        );
        expect(new Set(chapterIds).size).toBe(3);
        expect(chapterIds.every((id) => id?.startsWith("book-chapter-"))).toBe(true);
        expect(nav).toContain('epub:type="landmarks"');
        expect(nav).toContain('epub:type="titlepage" href="titlepage.xhtml"');
        expect(nav).toContain('epub:type="bodymatter" href="chapter-2.xhtml"');
        expect(nav).toContain('epub:type="backmatter" href="chapter-3.xhtml"');
        expect(frontMatter).toContain('xml:lang="zh-CN"');
        expect(frontMatter).toContain('lang="zh-CN"');
        expect(frontMatter).toContain('epub:type="frontmatter"');
        expect(bodyMatter).toContain('epub:type="bodymatter chapter"');
        expect(bodyMatter).toContain('epub:type="noteref"');
        expect(bodyMatter).toContain('epub:type="footnote"');
        expect(bodyMatter).toContain('role="doc-endnotes"');
        expect(backMatter).toContain('epub:type="backmatter"');

        const htmlSaver = new MemoryFileSaver();
        await new HtmlExporter(htmlSaver).export(bookRequest(ExportFormat.HTML, project));
        const html = await (htmlSaver.blob as Blob).text();
        expect(html).toContain('<html lang="zh-CN">');
        expect(html).toContain("<title>A multilingual book</title>");
        expect(html).toContain(
            '<meta name="description" content="A short description of the book.">'
        );
        expect(html).toContain('<meta name="language" content="zh-CN">');
        expect(html).toContain('<meta name="isbn" content="9781234567890">');
        expect(html).toContain("@media print{body{padding:0}}");
        const headingIds = [...html.matchAll(/id="([^"]+-shared-heading)"/g)].map(
            (match) => match[1]
        );
        expect(headingIds).toHaveLength(3);
        expect(new Set(headingIds).size).toBe(3);
        for (const id of headingIds) expect(html).toContain(`href="#${id}"`);
        const footnoteIds = [...html.matchAll(/id="([^"]+-user-content-fn-source)"/g)].map(
            (match) => match[1]
        );
        expect(footnoteIds).toHaveLength(2);
        expect(new Set(footnoteIds).size).toBe(2);
    });

    it("keeps DOCX manuscript language, description, and accessible diagram assets", async () => {
        const saver = new MemoryFileSaver();
        await new DocxExporter(saver).export(bookRequest(ExportFormat.DOCX, multilingualBook()));
        const archive = unzipSync(new Uint8Array(await (saver.blob as Blob).arrayBuffer()));
        const core = new TextDecoder().decode(archive["docProps/core.xml"]);
        const styles = new TextDecoder().decode(archive["word/styles.xml"]);
        const documentXml = new TextDecoder().decode(archive["word/document.xml"]);
        const footnotes = new TextDecoder().decode(archive["word/footnotes.xml"]);

        expect(core).toContain("A multilingual book");
        expect(core).toContain("A short description of the book.");
        expect(styles).toContain('w:val="zh-CN"');
        expect(documentXml).toContain("A labeled diagram");
        expect(
            Object.keys(archive).some(
                (path) => path.startsWith("word/media/") && path.endsWith(".svg")
            )
        ).toBe(true);
        expect(footnotes).toContain("A second footnote.");
    });

    it("uses Unicode-safe publication filenames for every export format", async () => {
        const title = "数学入门 — résumé";
        expect(publicationSlug(title)).toBe("数学入门-resume");
        const content = document.createDocumentFragment();
        const chapter = document.createElement("article");
        chapter.innerHTML = "<h1>数学入门</h1><p>Chapter body</p>";
        content.append(chapter);
        const rendered = new RenderedDocument(
            content.cloneNode(true) as DocumentFragment,
            title,
            0
        );
        const exporters = [
            [ExportFormat.HTML, HtmlExporter],
            [ExportFormat.EPUB, EpubExporter],
            [ExportFormat.DOCX, DocxExporter],
            [ExportFormat.PDF, PdfExporter]
        ] as const;

        for (const [format, Exporter] of exporters) {
            const saver = new MemoryFileSaver();
            const exportRequest = new ExportRequest(format, rendered, title, content, PAGE_SETUP);
            await new Exporter(saver).export(exportRequest);
            expect(saver.filename).toBe("数学入门-resume." + format);
        }
    });
});
