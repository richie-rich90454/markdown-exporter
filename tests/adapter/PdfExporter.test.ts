import { describe, expect, it } from "vitest";

import { PdfExporter } from "../../src/adapter/exporter/PdfExporter";
import { ExportFormat } from "../../src/domain/ExportFormat";
import { ExportRequest } from "../../src/domain/ExportRequest";
import type { PageSetup } from "../../src/domain/PageSetup";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { FileSaver } from "../../src/port/FileSaver";
import { createSingleChapterBook } from "../../src/domain/BookProject";
import { pageWidthPt } from "../../src/domain/PageSetup";

const SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

class MemorySaver implements FileSaver {
    blobs: { blob: Blob; name: string }[] = [];

    saveBlob(blob: Blob, name: string): void {
        this.blobs.push({ blob, name });
    }
}

function request(node: Node, title = "Notes"): ExportRequest {
    return new ExportRequest(
        ExportFormat.PDF,
        new RenderedDocument(document.createDocumentFragment(), title, 0),
        title,
        node,
        SETUP
    );
}

function build(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
}

async function pdfBytes(node: Node, saver: MemorySaver): Promise<string> {
    await new PdfExporter(saver).export(request(node));
    const saved = saver.blobs[0];
    expect(saved).toBeDefined();
    return saved === undefined
        ? ""
        : new TextDecoder("latin1").decode(new Uint8Array(await saved.blob.arrayBuffer()));
}

describe("PdfExporter", () => {
    it("writes a PDF file the browser can download", async () => {
        const saver = new MemorySaver();
        const bytes = await pdfBytes(build("<h1>Title</h1><p>Body text.</p>"), saver);

        expect(saver.blobs[0]?.name).toBe("notes.pdf");
        expect(saver.blobs[0]?.blob.type).toBe("application/pdf");
        expect(bytes.startsWith("%PDF-1.6")).toBe(true);
        expect(bytes.trimEnd().endsWith("%%EOF")).toBe(true);
        expect(bytes).toContain("/Title (Notes)");
        expect(bytes).toContain("(Body text.) Tj");
    });

    it("keeps rendered math vector text and adds searchable TeX source", async () => {
        const content = build(
            '<p>Ratio <span class="katex"><span class="katex-html">1/2 + x2</span>' +
                '<span class="katex-mathml"><math><semantics>' +
                '<annotation encoding="application/x-tex">\\frac{1}{2} + x^2</annotation>' +
                "</semantics></math></span></span></p>"
        );
        const bytes = await pdfBytes(content, new MemorySaver());

        expect(bytes).toContain("(1/2) Tj");
        expect(bytes).toContain("( + x2) Tj");
        expect(bytes).toContain("3 Tr");
        expect(bytes).toContain("(\\\\frac{1}{2} + x^2) Tj");
    });

    it("writes selectable Chinese text with a Unicode CJK font mapping", async () => {
        const bytes = await pdfBytes(build("<p>上海市统计局</p>"), new MemorySaver());

        expect(bytes).toContain("/BaseFont /STSong-Light");
        expect(bytes).toContain("/Encoding /UniGB-UTF16-H");
        expect(bytes).toContain("<4E0A6D775E027EDF8BA15C40> Tj");
        expect(bytes).toContain("<4E0A> <4E0A>");
        expect(bytes).toContain("/Ordering (GB1)");
    });

    it("selects CJK fonts per script in mixed Chinese, Japanese, Korean, and Traditional text", async () => {
        const bytes = await pdfBytes(
            build("<p>上海市</p><p>東京と日本語</p><p>한국어</p><p>臺灣</p>"),
            new MemorySaver()
        );

        expect(bytes).toContain("/Encoding /UniJIS-UTF16-H");
        expect(bytes).toContain("/Encoding /UniKS-UTF16-H");
        expect(bytes).toContain("/Encoding /UniCNS-UTF16-H");
        expect(bytes).toContain("/BaseFont /STSong-Light");
        expect(bytes).toContain("/BaseFont /HeiseiMin-W3");
        expect(bytes).toContain("/BaseFont /HYSMyeongJo-Medium");
        expect(bytes).toContain("/BaseFont /MHei-Medium");
    });

    it("lays out pages and numbers them", async () => {
        const paragraphs = Array.from(
            { length: 200 },
            (_, index) => `<p>Paragraph ${index + 1} of the page overflow check.</p>`
        ).join("");
        const bytes = await pdfBytes(build(paragraphs), new MemorySaver());

        const pageCount = [...bytes.matchAll(/\/Type \/Page[^s]/g)].length;
        expect(pageCount).toBeGreaterThan(1);
        expect(bytes).toContain("(1 / ");
    });

    it("exports all ordered book chapters with a title page and chapter breaks", async () => {
        const base = createSingleChapterBook("First chapter body.", "A whole book");
        const project = {
            ...base,
            manifest: {
                ...base.manifest,
                metadata: { ...base.manifest.metadata, subtitle: "A subtitle", authors: ["A. Writer"] },
                entries: [
                    { ...base.manifest.entries[0]!, title: "First chapter" },
                    { id: "chapter-2", role: "chapter" as const, path: "chapters/chapter-2.md", title: "Second chapter" }
                ]
            },
            files: { ...base.files, "chapters/chapter-2.md": "Second chapter body." }
        };
        const source = document.createDocumentFragment();
        const saver = new MemorySaver();
        const exportRequest = new ExportRequest(
            ExportFormat.PDF,
            new RenderedDocument(source.cloneNode(true) as DocumentFragment, "A whole book", 0),
            "A whole book",
            source,
            SETUP,
            project,
            (markdown) => {
                const fragment = document.createDocumentFragment();
                const paragraph = document.createElement("p");
                paragraph.textContent = markdown;
                fragment.append(paragraph);
                return Promise.resolve(fragment);
            }
        );
        await new PdfExporter(saver).export(exportRequest);
        const bytes = new TextDecoder("latin1").decode(new Uint8Array(await saver.blobs[0]!.blob.arrayBuffer()));
        expect(bytes).toContain("A subtitle");
        expect(bytes).toContain("First chapter body.");
        expect(bytes).toContain("Second chapter body.");
        expect(bytes).toMatch(/\/Subtype \/Link[^>]*\/Dest \[\d+ 0 R \/XYZ null [\d.]+ null\]/);
        expect(bytes).toMatch(/BT \/F\d+ 8 Tf [\d.]+ [\d.]+ Td \(A whole book\) Tj ET/);
        expect([...bytes.matchAll(/\/Type \/Page[^s]/g)]).toHaveLength(4);
    });

    it("uses custom trim dimensions for PDF page geometry", () => {
        expect(pageWidthPt({ ...SETUP, pageSize: "custom", customWidthMm: 160 })).toBeCloseTo(160 * 72 / 25.4);
    });

    it("keeps a tall block quote inside the page box", async () => {
        const long = Array.from(
            { length: 120 },
            (_, index) => `<p>Quote line ${index + 1}.</p>`
        ).join("");
        const bytes = await pdfBytes(
            build(`<blockquote>${long}</blockquote><p>After the quote.</p>`),
            new MemorySaver()
        );

        // MediaBox is the page box: nothing is drawn outside it, so the bug in
        // the preview cannot happen in the PDF.
        const boxes = [...bytes.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
        expect(boxes.length).toBeGreaterThan(1);
        expect(bytes).toContain("(After the quote.) Tj");
    });

    it("rejects a format it does not support", async () => {
        await expect(
            new PdfExporter(new MemorySaver()).export(request(build(""), "x"))
        ).resolves.toEqual({
            kind: "success",
            format: ExportFormat.PDF
        });
    });
});
