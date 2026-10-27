import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";

import { DocxExporter } from "../../src/adapter/exporter/DocxExporter";
import { EpubExporter } from "../../src/adapter/exporter/EpubExporter";
import { ExportFormat } from "../../src/domain/ExportFormat";
import { ExportRequest } from "../../src/domain/ExportRequest";
import { createSingleChapterBook } from "../../src/domain/BookProject";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { PageSetup } from "../../src/domain/PageSetup";
import type { FileSaver } from "../../src/port/FileSaver";

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

function request(format: ExportFormat, bookProject?: ReturnType<typeof createSingleChapterBook>): ExportRequest {
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
    math.innerHTML = "<math><semantics><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow><annotation encoding=\"application/x-tex\">x=2</annotation></semantics></math>";
    content.append(title, paragraph, table, math);
    const rendered = new RenderedDocument(content.cloneNode(true) as DocumentFragment, "A test book", 0);
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
        }
    );
}

describe("publishing exporters", () => {
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
            () => Promise.resolve(document.createDocumentFragment())
        );
        await new EpubExporter(epubSaver).export(source);
        const epub = unzipSync(new Uint8Array(await (epubSaver.blob as Blob).arrayBuffer()));
        expect(new TextDecoder().decode(epub["OEBPS/package.opf"])).toContain("<dc:title>A real title</dc:title>");
        expect(epubSaver.filename).toBe("a-real-title.epub");

        const docxSaver = new MemoryFileSaver();
        const docxRequest = new ExportRequest(
            ExportFormat.DOCX,
            source.rendered,
            source.title,
            source.content,
            source.pageSetup,
            project,
            source.renderSource
        );
        await new DocxExporter(docxSaver).export(docxRequest);
        const docx = unzipSync(new Uint8Array(await (docxSaver.blob as Blob).arrayBuffer()));
        expect(new TextDecoder().decode(docx["docProps/core.xml"])).toContain("<dc:title>A real title</dc:title>");
        expect(docxSaver.filename).toBe("a-real-title.docx");
    });

    it("publishes every ordered book section with metadata", async () => {
        const base = createSingleChapterBook("Chapter one body.", "A test book");
        const project = {
            ...base,
            manifest: {
                ...base.manifest,
                metadata: { ...base.manifest.metadata, authors: ["A. Writer"], publisher: "Local Press" },
                entries: [
                    { ...base.manifest.entries[0]!, title: "First chapter" },
                    { id: "chapter-2", role: "chapter" as const, path: "chapters/chapter-2.md", title: "Second chapter" }
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
        expect(new TextDecoder().decode(epub["OEBPS/chapter-2.xhtml"])).toContain("Second chapter body.");

        const docxSaver = new MemoryFileSaver();
        await new DocxExporter(docxSaver).export(request(ExportFormat.DOCX, project));
        const docx = unzipSync(new Uint8Array(await (docxSaver.blob as Blob).arrayBuffer()));
        const documentXml = new TextDecoder().decode(docx["word/document.xml"]);
        expect(documentXml).toContain("First chapter");
        expect(documentXml).toContain("Second chapter");
        expect(documentXml).toContain("w:type=\"page\"");
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
                "references.bib": "@book{smith2020, author={John Smith}, title={A Book}, year={2020}, publisher={Local Press}}"
            }
        };
        const saver = new MemoryFileSaver();
        await new EpubExporter(saver).export(request(ExportFormat.EPUB, project));
        const epub = unzipSync(new Uint8Array(await (saver.blob as Blob).arrayBuffer()));
        expect(new TextDecoder().decode(epub["OEBPS/chapter-1.xhtml"])).toContain("(Smith, 2020)");
        expect(new TextDecoder().decode(epub["OEBPS/chapter-2.xhtml"])).toContain("A Book");
    });
});
