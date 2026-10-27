import { ExportFormat } from "../../domain/ExportFormat";
import type { BookProject } from "../../domain/BookProject";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";
import { pageDimensions } from "../../domain/PageSetup";
import { createBookContentsPage, createBookTitlePage, renderBookSections, resolveBookImageReferences, serializeContent } from "./BookExportContent";
import { addCitationReferences } from "./CitationPublisher";

export class DocxExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.DOCX;

    constructor(private readonly fileSaver: FileSaver) {}

    async export(request: ExportRequest): Promise<ExportResult> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`DocxExporter cannot export ${request.format}`);
        }
        const project = request.bookProject;
        const sections = await renderBookSections(request);
        await addCitationReferences(sections, project);

        const [
            { Document, Packer, Paragraph, PageBreak, AlignmentType, Header, Footer, PageNumberElement, TextRun },
            { htmlToContent }
        ] = await Promise.all([
            import("docx"),
            import("docx/html")
        ]);
        const warnings: string[] = [];
        const documentChildren = [];
        const isBook = (project?.manifest.entries.length ?? 0) > 1;
        if (isBook) {
            documentChildren.push(...htmlToContent(serializeContent(createBookTitlePage(project, request.title))));
            documentChildren.push(new Paragraph({ children: [new PageBreak()] }));
            documentChildren.push(...htmlToContent(serializeContent(createBookContentsPage(sections))));
            documentChildren.push(new Paragraph({ children: [new PageBreak()] }));
        }
        for (const [index, section] of sections.entries()) {
            const content = section.content;
            resolveBookImageReferences(content, project, section.entry?.path);
            await embedProjectImages(content, project, section.entry?.path ?? "");
            if (index > 0 && section.entry?.role !== "front-matter") documentChildren.push(new Paragraph({ children: [new PageBreak()] }));
            preserveDiagramAltText(content);
            documentChildren.push(...htmlToContent(
                serializeContent(content),
                {
                    notes: "footnotes",
                    styleMap: { table: "TableGrid", pre: "SourceCode", code: "InlineCode" },
                    onWarning: (warning) => warnings.push(warning.message)
                }
            ));
        }

        const metadata = project?.manifest.metadata;
        const title = publicationTitle(project, request.title);
        const dimensions = pageDimensions(request.pageSetup);
        const toTwips = (millimeters: number): number => Math.round((millimeters * 1440) / 25.4);
        const marginTwips = toTwips(request.pageSetup.marginMm);
        const header = isBook
            ? new Header({ children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun(title)]
            })] })
            : undefined;
        const footer = new Footer({ children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun("Page "), new TextRun({ children: [new PageNumberElement()] })]
        })] });
        const document = new Document({
            creator: metadata?.authors.join(", ") || "Markdown Exporter",
            title,
            ...(metadata?.description === undefined ? {} : { subject: metadata.description }),
            ...(metadata?.isbn === undefined ? {} : { keywords: `ISBN ${metadata.isbn}` }),
            ...(warnings.length === 0 ? {} : { description: warnings.join("\n") }),
            sections: [{
                ...(header === undefined ? {} : {
                    headers: { default: header, first: new Header({ children: [] }) }
                }),
                footers: {
                    default: footer,
                    ...(isBook ? { first: new Footer({ children: [] }) } : {})
                },
                properties: {
                    titlePage: isBook,
                    page: {
                        size: {
                            width: toTwips(dimensions.widthMm),
                            height: toTwips(dimensions.heightMm)
                        },
                        margin: {
                            top: marginTwips,
                            right: marginTwips,
                            bottom: marginTwips,
                            left: marginTwips,
                            header: Math.min(720, Math.round(marginTwips / 2)),
                            footer: Math.min(720, Math.round(marginTwips / 2))
                        }
                    }
                },
                children: documentChildren
            }]
        });
        const blob = await Packer.toBlob(document);
        this.fileSaver.saveBlob(blob, `${slug(title)}.docx`);
        return ExportResults.success(this.supportedFormat);
    }
}

function publicationTitle(project: BookProject | undefined, documentTitle: string): string {
    const metadataTitle = project?.manifest.metadata.title;
    const isBook = (project?.manifest.entries.length ?? 0) > 1;
    return (isBook ? metadataTitle : undefined) || documentTitle || metadataTitle || "Untitled manuscript";
}

function preserveDiagramAltText(content: Node): void {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return;
    for (const svg of Array.from(content.querySelectorAll<SVGSVGElement>("svg"))) {
        const fallback = document.createElement("p");
        fallback.textContent = `Diagram: ${svg.getAttribute("aria-label") ?? "illustration"}`;
        svg.replaceWith(fallback);
    }
}

async function embedProjectImages(content: Node, project: BookProject | undefined, chapterPath: string): Promise<void> {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return;
    const images = Array.from(content.querySelectorAll<HTMLImageElement>("img"));
    await Promise.all(images.map(async (image) => {
        const source = image.getAttribute("src") ?? "";
        if (source.startsWith("data:image/")) return;
        if (project !== undefined && !/^(?:blob:|https?:|\/\/|\/)/i.test(source)) {
            const local = findProjectFile(project, chapterPath, source);
            if (local instanceof Uint8Array) {
                const mime = mimeForPath(source);
                image.setAttribute("src", `data:${mime};base64,${encodeBase64(local)}`);
                return;
            }
        }
        let url: URL;
        try { url = new URL(source, document.baseURI); }
        catch { markImageMissing(image); return; }
        const localUrl = url.protocol === "blob:" ||
            ((url.protocol === "http:" || url.protocol === "https:") && url.origin === window.location.origin);
        if (!localUrl) { markImageMissing(image); return; }
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Image could not be read.");
            const blob = await response.blob();
            const mimeType = (blob.type || response.headers.get("content-type") || "").split(";")[0]?.toLowerCase();
            if (mimeType === undefined || !mimeType.startsWith("image/")) throw new Error("The local resource is not an image.");
            image.setAttribute("src", `data:${mimeType};base64,${encodeBase64(new Uint8Array(await blob.arrayBuffer()))}`);
        } catch { markImageMissing(image); }
    }));
}

function findProjectFile(project: BookProject, chapterPath: string, source: string): string | Uint8Array | undefined {
    let decoded: string;
    try { decoded = decodeURIComponent(source.split(/[?#]/, 1)[0] ?? source); }
    catch { return undefined; }
    const parts = chapterPath.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") { if (parts.length === 0) return undefined; parts.pop(); }
        else parts.push(part);
    }
    return project.files[parts.join("/")];
}

function mimeForPath(path: string): string {
    switch (path.toLowerCase().split(".").at(-1)) {
        case "jpg": case "jpeg": return "image/jpeg";
        case "gif": return "image/gif";
        case "webp": return "image/webp";
        case "svg": return "image/svg+xml";
        default: return "image/png";
    }
}

function markImageMissing(image: HTMLImageElement): void {
    const fallback = document.createElement("span");
    fallback.textContent = image.alt.trim().length > 0 ? `[Image: ${image.alt.trim()}]` : "[Image unavailable]";
    fallback.setAttribute("role", "img");
    fallback.setAttribute("aria-label", image.alt.trim().length > 0 ? image.alt.trim() : "Image unavailable");
    image.replaceWith(fallback);
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}

function slug(title: string): string {
    const value = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return value.length > 0 ? value : "book";
}
