import { ExportFormat } from "../../domain/ExportFormat";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";
import { HtmlEscaper } from "../../util/HtmlEscaper";
import { createBookTitlePage, renderBookSections, resolveBookImageReferences } from "./BookExportContent";
import { pageDimensions } from "../../domain/PageSetup";
import { addCitationReferences } from "./CitationPublisher";

const STYLESHEET = [
    "body{margin:0;padding:24px;background:#fff;color:#0a0a0a;font:16px/1.6 Georgia,'Times New Roman',serif}",
    "h1,h2,h3,h4,h5,h6{font-weight:600;line-height:1.3;margin:1.4em 0 .5em}",
    "h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}",
    "p,ul,ol,table,blockquote,pre{margin:0 0 1em}",
    "a{color:#0a0a0a;text-decoration:underline}",
    "code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875em}",
    "pre{padding:12px;background:#f7f7f7;overflow:auto}",
    "table{border-collapse:collapse;width:100%}",
    "th,td{border:1px solid #e4e4e4;padding:6px 8px;text-align:left}",
    "th{font-weight:600}",
    "blockquote{border-left:2px solid #6b6b6b;margin-left:0;padding-left:12px;color:#6b6b6b}",
    "blockquote.markdown-alert--note{border-color:#4477aa}blockquote.markdown-alert--tip{border-color:#438a5e}",
    "blockquote.markdown-alert--important{border-color:#7252a0}blockquote.markdown-alert--warning,blockquote.markdown-alert--caution{border-color:#bd5a31}",
    ".markdown-alert__title{font-weight:700;color:#0a0a0a;margin-bottom:.25em}",
    "ul.markdown-toc{padding-left:1.4em}",
    "mark{background:#fff1a8;color:inherit;padding:.08em .18em}",
    "sub,sup{font-size:.75em;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}",
    ".markdown-diagram{display:block;width:100%;max-height:720px;margin:1em auto;overflow:visible}",
    ".diagram-error__message{margin:0 0 .5em;color:#b42318;font-size:.875em}",
    "img{max-width:100%}",
    ".book-title-page{min-height:70vh;display:grid;align-content:center;justify-items:center;text-align:center;break-after:page}.book-title-page h1{font-size:2.6em}.book-cover{max-width:min(100%, 16rem);max-height:40vh;object-fit:contain}.book-subtitle{font-size:1.25em}.book-authors{margin-top:2em}.book-table-of-contents{break-after:page}.book-chapter{break-before:page;page-break-before:always}.generated-references{break-before:page}.csl-entry{margin:0 0 .75em 2em;text-indent:-2em}",
    ".offline-image-fallback{display:inline-block;padding:.25em .5em;border:1px solid #e4e4e4;color:#6b6b6b;font: .875em/1.4 ui-sans-serif,system-ui,sans-serif}",
    "hr{border:none;border-top:1px solid #e4e4e4}"
].join("\n");

export class HtmlExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.HTML;

    constructor(private readonly fileSaver: FileSaver) {}

    async export(request: ExportRequest): Promise<ExportResult> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`HtmlExporter cannot export ${request.format}`);
        }
        const sections = await renderBookSections(request);
        await addCitationReferences(sections, request.bookProject);
        const isBook = (request.bookProject?.manifest.entries.length ?? 0) > 1;
        const root = document.createElement("main");
        if (isBook) {
            root.append(createBookTitlePage(request.bookProject, request.title));
            root.append(createTableOfContents(sections));
        }
        for (const [index, section] of sections.entries()) {
            resolveBookImageReferences(section.content, request.bookProject, section.entry?.path);
            const wrapper = document.createElement("section");
            wrapper.className = section.entry?.role === "chapter" && index > 0 ? "book-chapter" : "book-section";
            wrapper.id = `section-${index + 1}`;
            if (section.content instanceof DocumentFragment) wrapper.append(section.content);
            else wrapper.append(section.content.cloneNode(true));
            root.append(wrapper);
        }
        await embedImages(root);
        const body = new XMLSerializer().serializeToString(root);
        const contentRoot = root;
        const hasMath = contentRoot.querySelector(".katex") !== null;
        const katexStyles = !hasMath
            ? ""
            : await (await import("./KatexAssets")).katexStylesWithEmbeddedFonts(contentRoot);
        const dimensions = pageDimensions(request.pageSetup);
        const styles = `${STYLESHEET}\n@page{size:${dimensions.widthMm}mm ${dimensions.heightMm}mm;margin:${request.pageSetup.marginMm}mm}\n${katexStyles}\n.katex-error{color:#b42318}`;
        const metadata = request.bookProject?.manifest.metadata;
        const authors = metadata?.authors.map((author) => `<meta name="author" content="${HtmlEscaper.escape(author)}">`).join("\n") ?? "";
        const html =
            `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
            `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
            `<meta name="description" content="${HtmlEscaper.escape(metadata?.description ?? "")}">\n${authors}\n` +
            `<meta name="language" content="${HtmlEscaper.escape(metadata?.language ?? "en")}">\n` +
            `<title>${HtmlEscaper.escape(request.title || "Document")}</title>\n` +
            `<style>\n${styles}\n</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        this.fileSaver.saveBlob(blob, `${slug(request.title)}.html`);
        return ExportResults.success(this.supportedFormat);
    }
}

function createTableOfContents(sections: Awaited<ReturnType<typeof renderBookSections>>): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "book-table-of-contents";
    nav.setAttribute("aria-label", "Table of contents");
    const heading = document.createElement("h1");
    heading.textContent = "Contents";
    const list = document.createElement("ol");
    for (const [index, section] of sections.entries()) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#section-${index + 1}`;
        link.textContent = section.title;
        item.append(link);
        list.append(item);
    }
    nav.append(heading, list);
    return nav;
}

async function embedImages(content: Node): Promise<void> {
    if (
        !(
            content instanceof Element ||
            content instanceof Document ||
            content instanceof DocumentFragment
        )
    ) {
        return;
    }
    const images = Array.from(content.querySelectorAll<HTMLImageElement>("img"));
    const sources = images.map((image) => image.currentSrc || image.getAttribute("src") || "");
    for (const source of Array.from(content.querySelectorAll("source"))) {
        source.removeAttribute("srcset");
        source.removeAttribute("src");
    }
    await Promise.all(images.map((image, index) => embedImage(image, sources[index] ?? "")));
}

async function embedImage(image: HTMLImageElement, source: string): Promise<void> {
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    if (source.startsWith("data:image/")) {
        image.setAttribute("src", source);
        return;
    }

    try {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Image request failed with status ${response.status}.`);
        const imageBlob = await response.blob();
        const mimeType = imageBlob.type || response.headers.get("content-type") || "";
        if (!mimeType.toLowerCase().startsWith("image/")) {
            throw new Error("The image response did not contain an image.");
        }
        const bytes = new Uint8Array(await imageBlob.arrayBuffer());
        image.setAttribute("src", `data:${mimeType};base64,${encodeBase64(bytes)}`);
    } catch {
        const fallback = document.createElement("span");
        const alt = image.alt.trim();
        fallback.className = "offline-image-fallback";
        fallback.setAttribute("role", "img");
        fallback.setAttribute(
            "aria-label",
            alt.length > 0 ? `Image unavailable offline: ${alt}` : "Image unavailable offline"
        );
        fallback.textContent =
            alt.length > 0 ? `Image unavailable offline: ${alt}` : "Image unavailable offline";
        image.replaceWith(fallback);
    }
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function slug(title: string): string {
    const value = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return value.length > 0 ? value : "document";
}
