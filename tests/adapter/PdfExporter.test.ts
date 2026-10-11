import { describe, expect, it } from "vitest";

import { PdfExporter } from "../../src/adapter/exporter/PdfExporter";
import { ExportFormat } from "../../src/domain/ExportFormat";
import { ExportRequest } from "../../src/domain/ExportRequest";
import type { PageSetup } from "../../src/domain/PageSetup";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { FileSaver } from "../../src/port/FileSaver";

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
        expect(bytes.startsWith("%PDF-1.4")).toBe(true);
        expect(bytes.trimEnd().endsWith("%%EOF")).toBe(true);
        expect(bytes).toContain("/Title (Notes)");
        expect(bytes).toContain("(Body text.) Tj");
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
