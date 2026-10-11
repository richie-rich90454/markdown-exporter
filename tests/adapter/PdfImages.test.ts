import { describe, expect, it } from "vitest";

import { PdfExporter } from "../../src/adapter/exporter/PdfExporter";
import { ExportFormat } from "../../src/domain/ExportFormat";
import { ExportRequest } from "../../src/domain/ExportRequest";
import type { PageSetup } from "../../src/domain/PageSetup";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { FileSaver } from "../../src/port/FileSaver";
import { parseBlocks } from "../../src/adapter/exporter/pdf/PdfLayout";
import { paginate } from "../../src/adapter/exporter/pdf/PdfPaginate";
import type { PdfImage } from "../../src/adapter/exporter/pdf/PdfWriter";
import { writePdf } from "../../src/adapter/exporter/pdf/PdfWriter";

const SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

const NONE = new Map<string, boolean>();
const EMBEDDED = new Map([["a.png", true] as const]);

class MemorySaver implements FileSaver {
    blobs: { blob: Blob; name: string }[] = [];

    saveBlob(blob: Blob, name: string): void {
        this.blobs.push({ blob, name });
    }
}

function flow(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
}

function withSize(image: HTMLImageElement, width: number, height: number): HTMLImageElement {
    Object.defineProperty(image, "naturalWidth", { value: width, configurable: true });
    Object.defineProperty(image, "naturalHeight", { value: height, configurable: true });
    Object.defineProperty(image, "currentSrc", {
        value: image.getAttribute("src") ?? "",
        configurable: true
    });
    return image;
}

function built(html: string, embeds = EMBEDDED) {
    const host = flow(html);
    for (const image of Array.from(host.querySelectorAll("img"))) {
        withSize(image, 120, 60);
    }
    return paginate(parseBlocks(host), SETUP, embeds);
}

describe("images in the PDF", () => {
    it("carries a decoded image through to an embedded object", () => {
        const layout = built('<p><img src="a.png" alt="A badge"></p>');
        expect(layout.images).toEqual([{ src: "a.png", alt: "A badge", width: 120, height: 60 }]);
        expect(layout.pages.flat().some((op) => op.kind === "image")).toBe(true);

        const bytes = writePdf(
            layout,
            [
                { data: new Uint8Array([1, 2, 3]), width: 120, height: 60, jpeg: true, gray: false }
            ] as PdfImage[],
            "Notes",
            SETUP
        );
        const text = new TextDecoder("latin1").decode(bytes);
        expect(text).toContain("/Subtype /Image");
        expect(text).toContain("/Width 120");
        expect(text).toContain("/Im1 Do");
    });

    it("draws a labelled box when the image never decoded", () => {
        const host = flow('<p><img src="missing.png" alt="Missing picture"></p>');
        const layout = paginate(parseBlocks(host), SETUP, NONE);

        expect(layout.images).toEqual([]);
        const texts = layout.pages
            .flat()
            .filter((op) => op.kind === "text")
            .map((op) => (op.kind === "text" ? op.text : ""))
            .join(" ");
        expect(texts).toContain("Missing");
        expect(texts).toContain("1 / 1");
        expect(writePdf(layout, [], "Notes", SETUP).length).toBeGreaterThan(0);
    });

    it("keeps an image that shares its paragraph with words", () => {
        const layout = built('<p>Before <img src="a.png" alt="Mid"> after</p>');
        const kinds = layout.pages.flat().map((op) => op.kind);
        expect(kinds).toContain("image");
        expect(layout.images).toHaveLength(1);
        expect(
            writePdf(
                layout,
                [{ data: new Uint8Array([1]), width: 1, height: 1, jpeg: false, gray: false }],
                "Notes",
                SETUP
            ).length
        ).toBeGreaterThan(0);
    });

    it("does not reference an image object that was not supplied", () => {
        const host = flow('<p><img src="a.png" alt="A"></p><p><img src="b.png" alt="B"></p>');
        for (const image of Array.from(host.querySelectorAll("img"))) {
            withSize(image, 10, 10);
        }
        const layout = paginate(
            parseBlocks(host),
            SETUP,
            new Map([
                ["a.png", false],
                ["b.png", false]
            ])
        );
        expect(layout.images).toEqual([]);

        const text = new TextDecoder("latin1").decode(
            writePdf(layout, [null, null], "Notes", SETUP)
        );
        expect(text).not.toContain("/Im1 Do");
        expect(text).not.toContain("/Im2 Do");
        expect(text).toContain("%%EOF");
    });
});

describe("an unreadable image source", () => {
    it("still produces a file", async () => {
        const host = flow('<p><img src="https://example.invalid/x.png" alt="Blocked"></p>');
        const saver = new MemorySaver();
        const request = new ExportRequest(
            ExportFormat.PDF,
            new RenderedDocument(document.createDocumentFragment(), "Notes", 0),
            "Notes",
            host,
            SETUP
        );

        await expect(new PdfExporter(saver).export(request)).resolves.toEqual({
            kind: "success",
            format: ExportFormat.PDF
        });
        expect(saver.blobs[0]?.blob.type).toBe("application/pdf");
        expect(saver.blobs[0]?.name).toBe("notes.pdf");
    });
});
