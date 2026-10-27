import { afterEach, describe, expect, it, vi } from "vitest";

import { HtmlExporter } from "../../src/adapter/exporter/HtmlExporter";
import { ExportFormat } from "../../src/domain/ExportFormat";
import { ExportRequest } from "../../src/domain/ExportRequest";
import type { PageSetup } from "../../src/domain/PageSetup";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { FileSaver } from "../../src/port/FileSaver";
import { createSingleChapterBook } from "../../src/domain/BookProject";

const SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

class MemorySaver implements FileSaver {
    blob: Blob | undefined;

    saveBlob(blob: Blob): void {
        this.blob = blob;
    }
}

function request(content: HTMLElement): ExportRequest {
    return new ExportRequest(
        ExportFormat.HTML,
        new RenderedDocument(document.createDocumentFragment(), "Math notes", 0),
        "Math notes",
        content,
        SETUP
    );
}

describe("HtmlExporter", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("keeps ordinary documents lightweight", async () => {
        const saver = new MemorySaver();
        const content = document.createElement("div");
        content.innerHTML = "<p>Plain Markdown</p>";

        await new HtmlExporter(saver).export(request(content));

        expect(await saver.blob?.text()).not.toContain("KaTeX_Main-Regular");
    });

    it("embeds KaTeX styles and fonts for offline math", async () => {
        const saver = new MemorySaver();
        const content = document.createElement("div");
        content.innerHTML =
            '<span class="katex"><span class="katex-html">x</span>' +
            '<span class="katex-mathml"><math><mi>x</mi></math></span></span>';

        await new HtmlExporter(saver).export(request(content));
        const html = await saver.blob?.text();

        expect(html).toContain(".katex-html");
        expect(html).toContain("data:font/woff2;base64,");
        expect(html).toContain("<math");
        expect(html).not.toContain("url(fonts/KaTeX_");
    });

    it("embeds only the KaTeX font families used by rendered math", async () => {
        vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
            const mathItalic = element.classList.contains("mathnormal");
            return {
                fontFamily: mathItalic ? "KaTeX_Math" : "KaTeX_Main",
                fontWeight: "400",
                fontStyle: mathItalic ? "italic" : "normal"
            } as CSSStyleDeclaration;
        });
        const saver = new MemorySaver();
        const content = document.createElement("div");
        content.innerHTML =
            '<span class="katex"><span class="katex-html"><span class="mathnormal">x</span></span>' +
            '<span class="katex-mathml"><math><mi>x</mi></math></span></span>';

        await new HtmlExporter(saver).export(request(content));
        const html = await saver.blob?.text();

        expect(html?.match(/data:font\/woff2;base64,/g)).toHaveLength(2);
        expect(html).not.toContain("url(fonts/KaTeX_Main-Regular.woff2)");
        expect(html).not.toContain("url(fonts/KaTeX_Math-Italic.woff2)");
        expect(html).not.toContain("url(fonts/KaTeX_");
    });

    it("embeds image data and removes responsive image URLs for offline use", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                blob: () => Promise.resolve(new Blob(["pixels"], { type: "image/png" }))
            })
        );
        const saver = new MemorySaver();
        const content = document.createElement("div");
        content.innerHTML =
            '<picture><source srcset="https://example.com/large.png 2x">' +
            '<img src="https://example.com/small.png" alt="Diagram" ' +
            'srcset="https://example.com/small.png 1x"></picture>';

        await new HtmlExporter(saver).export(request(content));
        const html = await saver.blob?.text();

        expect(html).toContain('src="data:image/png;base64,');
        expect(html).not.toContain("https://example.com/");
        expect(html).toContain('alt="Diagram"');
    });

    it("replaces images that cannot be embedded with an offline alt-text fallback", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unavailable")));
        const saver = new MemorySaver();
        const content = document.createElement("div");
        content.innerHTML = '<img src="https://example.com/diagram.png" alt="A diagram">';

        await new HtmlExporter(saver).export(request(content));
        const html = await saver.blob?.text();

        expect(html).not.toContain("https://example.com/diagram.png");
        expect(html).toContain('class="offline-image-fallback"');
        expect(html).toContain("Image unavailable offline: A diagram");
    });

    it("exports ordered chapters, book metadata, and the chosen print trim size", async () => {
        const base = createSingleChapterBook("First chapter body.", "A local book");
        const project = {
            ...base,
            manifest: {
                ...base.manifest,
                metadata: { ...base.manifest.metadata, subtitle: "Short subtitle", authors: ["A. Writer"] },
                entries: [
                    { ...base.manifest.entries[0]!, title: "Opening" },
                    { id: "chapter-2", role: "chapter" as const, path: "chapters/chapter-2.md", title: "Next" }
                ]
            },
            files: { ...base.files, "chapters/chapter-2.md": "Second chapter body." }
        };
        const content = document.createElement("div");
        const saver = new MemorySaver();
        const exportRequest = new ExportRequest(
            ExportFormat.HTML,
            new RenderedDocument(content.cloneNode(true) as DocumentFragment, "A local book", 0),
            "A local book",
            content,
            { ...SETUP, pageSize: "six-by-nine" },
            project,
            (source) => {
                const fragment = document.createDocumentFragment();
                const paragraph = document.createElement("p");
                paragraph.textContent = source;
                fragment.append(paragraph);
                return Promise.resolve(fragment);
            }
        );
        await new HtmlExporter(saver).export(exportRequest);
        const html = await saver.blob?.text();
        expect(html).toContain("Opening");
        expect(html).toContain("Second chapter body.");
        expect(html).toContain("A. Writer");
        expect(html).toContain("size:152.4mm 228.6mm");
        expect(html).toContain("href=\"#section-2\"");
    });
});
