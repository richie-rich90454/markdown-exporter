import { ExportFormat } from "../../domain/ExportFormat";
import type { BookFileData, BookProject } from "../../domain/BookProject";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";
import { HtmlEscaper } from "../../util/HtmlEscaper";
import type { Zippable } from "fflate";
import { createBookTitlePage, renderBookSections, resolveBookImageReferences, serializeContent as serializeNodeContent } from "./BookExportContent";
import { addCitationReferences } from "./CitationPublisher";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const EPUB_NS = "http://www.idpf.org/2007/ops";
const BASE_STYLES = [
    "html{font-family:serif;line-height:1.6}",
    "body{max-width:42rem;margin:0 auto;padding:1.5rem;color:#171717}",
    "h1,h2,h3,h4,h5,h6{line-height:1.25;break-after:avoid}",
    ".chapter{break-before:page;page-break-before:always}",
    "img,svg{max-width:100%;height:auto}",
    "pre{white-space:pre-wrap;overflow-wrap:anywhere}",
    "table{border-collapse:collapse;width:100%}",
    "th,td{border:1px solid #777;padding:.35rem .5rem;vertical-align:top}",
    "blockquote{margin-left:0;padding-left:1rem;border-left:2px solid #888}",
    ".katex-display{display:block;text-align:center;margin:1rem 0}",
    ".title-page{min-height:80vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}.book-cover{max-width:min(100%, 16rem);max-height:40vh;object-fit:contain}.book-subtitle{font-size:1.2em}.book-authors{margin-top:2em}.csl-entry{margin:0 0 .75em 2em;text-indent:-2em}",
    ".markdown-diagram{width:100%;height:auto}"
].join("\n");

export class EpubExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.EPUB;

    constructor(private readonly fileSaver: FileSaver) {}

    async export(request: ExportRequest): Promise<ExportResult> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`EpubExporter cannot export ${request.format}`);
        }
        const project = request.bookProject;
        const sections = await renderBookSections(request);
        await addCitationReferences(sections, project);
        const chapters = sections.map((section, index) => {
            resolveBookImageReferences(section.content, project, section.entry?.path);
            if (section.entry !== undefined && project !== undefined) {
                resolveProjectImages(section.content, project, section.entry.path);
            }
            return {
                id: section.entry?.id ?? `chapter-${index + 1}`,
                title: section.title,
                sourcePath: section.entry?.path ?? "",
                content: section.content
            };
        });

        const resources: EpubResource[] = [];
        const chapterRecords: ChapterRecord[] = [];
        let hasMath = false;
        for (const [index, chapter] of chapters.entries()) {
            const content = chapter.content.cloneNode(true);
            hasMath ||= contentHasMath(content);
            const chapterResources = await packageImages(content, index + 1);
            resources.push(...chapterResources);
            const headings = collectHeadings(content);
            chapterRecords.push({
                id: safeId(chapter.id, index + 1),
                title: chapter.title,
                href: `chapter-${index + 1}.xhtml`,
                body: serializeContent(content),
                headings
            });
        }

        const metadata = project?.manifest.metadata;
        const title = publicationTitle(project, request.title);
        let epubCoverPath: string | undefined;
        if (metadata?.coverPath !== undefined && project !== undefined) {
            const cover = project.files[metadata.coverPath];
            if (cover !== undefined) {
                const resource = packageCover(metadata.coverPath, cover);
                resources.push(resource);
                epubCoverPath = resource.path;
            }
        }
        const katexStyles = hasMath
            ? await (await import("./KatexAssets")).katexStylesWithEmbeddedFonts(
                chapters.find((chapter) => contentHasMath(chapter.content))?.content ?? document.createDocumentFragment()
            )
            : "";
        const stylesheet = `${BASE_STYLES}\n${katexStyles}`;
        const identifier = createIdentifier();
        const titlePageNode = (project?.manifest.entries.length ?? 0) > 1
            ? createBookTitlePage(project, title)
            : undefined;
        if (titlePageNode !== undefined && epubCoverPath !== undefined) {
            const cover = titlePageNode.querySelector<HTMLImageElement>(".book-cover");
            cover?.setAttribute("src", epubCoverPath);
        }
        const titlePage = titlePageNode === undefined ? "" : serializeNodeContent(titlePageNode);
        const files: Zippable = {
            mimetype: [encode("application/epub+zip"), { level: 0 }],
            "META-INF/container.xml": encode(containerXml()),
            "OEBPS/package.opf": encode(packageDocument(title, identifier, chapterRecords, resources, hasMath, metadata, titlePage.length > 0)),
            "OEBPS/nav.xhtml": encode(navigationDocument(title, chapterRecords, metadata?.language ?? "en")),
            "OEBPS/style.css": encode(stylesheet)
        };
        if (titlePage.length > 0) files["OEBPS/titlepage.xhtml"] = encode(titlePageDocument(title, titlePage, metadata?.language ?? "en"));
        for (const chapter of chapterRecords) {
            files[`OEBPS/${chapter.href}`] = encode(chapterDocument(chapter.title, chapter.body, chapter.id));
        }
        for (const resource of resources) files[`OEBPS/${resource.path}`] = resource.data;

        const { zipSync } = await import("fflate");
        const archive = zipSync(files, { level: 6 });
        this.fileSaver.saveBlob(
            new Blob([archive], { type: "application/epub+zip" }),
            `${slug(title)}.epub`
        );
        return ExportResults.success(this.supportedFormat);
    }
}

function publicationTitle(project: BookProject | undefined, documentTitle: string): string {
    const metadataTitle = project?.manifest.metadata.title;
    const isBook = (project?.manifest.entries.length ?? 0) > 1;
    return (isBook ? metadataTitle : undefined) || documentTitle || metadataTitle || "Untitled manuscript";
}

interface EpubResource {
    readonly path: string;
    readonly data: Uint8Array;
    readonly mediaType: string;
}

interface HeadingRecord {
    readonly level: number;
    readonly title: string;
    readonly id: string;
}

interface ChapterRecord {
    readonly id: string;
    readonly title: string;
    readonly href: string;
    readonly body: string;
    readonly headings: readonly HeadingRecord[];
}

async function packageImages(content: Node, chapterNumber: number): Promise<EpubResource[]> {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return [];
    const resources: EpubResource[] = [];
    const images = Array.from(content.querySelectorAll<HTMLImageElement>("img"));
    for (const [index, image] of images.entries()) {
        const source = image.getAttribute("src") ?? "";
        const resolved = await readLocalImage(source);
        if (resolved === null) {
            const fallback = document.createElement("span");
            fallback.className = "offline-image-fallback";
            fallback.textContent = image.alt.length > 0 ? `[Image: ${image.alt}]` : "[Image unavailable]";
            image.replaceWith(fallback);
            continue;
        }
        const path = `images/chapter-${chapterNumber}-${index + 1}.${extensionForMime(resolved.mediaType)}`;
        image.setAttribute("src", path);
        resources.push({ path, data: resolved.data, mediaType: resolved.mediaType });
    }
    return resources;
}

function resolveProjectImages(content: Node, project: BookProject, chapterPath: string): void {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return;
    const parent = chapterPath.split("/").slice(0, -1);
    for (const image of Array.from(content.querySelectorAll<HTMLImageElement>("img"))) {
        const source = image.getAttribute("src") ?? "";
        if (source.length === 0 || /^(?:data:|blob:|https?:|\/\/|\/)/i.test(source)) continue;
        let decoded: string;
        try { decoded = decodeURIComponent(source.split(/[?#]/, 1)[0] ?? source); }
        catch { continue; }
        const segments = [...parent];
        let safe = true;
        for (const part of decoded.split("/")) {
            if (part === "" || part === ".") continue;
            if (part === "..") {
                if (segments.length === 0) { safe = false; break; }
                segments.pop();
            } else segments.push(part);
        }
        if (!safe) continue;
        const file = project.files[segments.join("/")];
        if (!(file instanceof Uint8Array)) continue;
        const mediaType = mimeForPath(segments.at(-1) ?? "");
        image.setAttribute("src", `data:${mediaType};base64,${encodeBase64(file)}`);
    }
}

async function readLocalImage(source: string): Promise<{ data: Uint8Array; mediaType: string } | null> {
    if (source.startsWith("data:image/")) return decodeDataImage(source);
    let url: URL;
    try { url = new URL(source, document.baseURI); }
    catch { return null; }
    const isBlob = url.protocol === "blob:";
    const isLocal = url.origin === window.location.origin && (url.protocol === "http:" || url.protocol === "https:");
    if (!isBlob && !isLocal) return null;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const mediaType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
        if (mediaType === undefined || !mediaType.startsWith("image/")) return null;
        return { data: new Uint8Array(await response.arrayBuffer()), mediaType };
    } catch { return null; }
}

function decodeDataImage(value: string): { data: Uint8Array; mediaType: string } | null {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
    if (match?.[1] === undefined || match[2] === undefined) return null;
    try {
        const binary = atob(match[2]);
        return { data: Uint8Array.from(binary, (character) => character.charCodeAt(0)), mediaType: match[1].toLowerCase() };
    } catch { return null; }
}

function packageCover(path: string, data: BookFileData): EpubResource {
    const mediaType = mimeForPath(path);
    return { path: `images/cover.${extensionForMime(mediaType)}`, mediaType, data: data instanceof Uint8Array ? data : encode(data) };
}

function mimeForPath(path: string): string {
    switch (path.toLowerCase().split(".").at(-1)) {
        case "jpg": case "jpeg": return "image/jpeg";
        case "gif": return "image/gif";
        case "webp": return "image/webp";
        case "svg": return "image/svg+xml";
        case "avif": return "image/avif";
        default: return "image/png";
    }
}

function extensionForMime(mime: string): string {
    switch (mime) {
        case "image/jpeg": return "jpg";
        case "image/svg+xml": return "svg";
        case "image/gif": return "gif";
        case "image/webp": return "webp";
        case "image/avif": return "avif";
        default: return "png";
    }
}

function collectHeadings(content: Node): HeadingRecord[] {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return [];
    return Array.from(content.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")).map((heading, index) => {
        const id = heading.id || `section-${index + 1}`;
        heading.id = id;
        return { level: Number(heading.tagName.slice(1)), title: heading.textContent?.trim() || `Section ${index + 1}`, id };
    });
}

function contentHasMath(content: Node): boolean {
    return (content instanceof Element || content instanceof DocumentFragment) && content.querySelector(".katex") !== null;
}

function serializeContent(content: Node): string {
    if (content instanceof DocumentFragment) return Array.from(content.childNodes).map((node) => new XMLSerializer().serializeToString(node)).join("\n");
    return new XMLSerializer().serializeToString(content);
}

function containerXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

function packageDocument(
    title: string,
    identifier: string,
    chapters: readonly ChapterRecord[],
    resources: readonly EpubResource[],
    hasMath: boolean,
    metadata: BookProject["manifest"]["metadata"] | undefined,
    hasTitlePage: boolean
): string {
    const imageItems = resources.map((resource, index) => `<item id="image-${index + 1}" href="${xmlEscape(resource.path)}" media-type="${xmlEscape(resource.mediaType)}"${resource.path.startsWith("images/cover.") ? " properties=\"cover-image\"" : ""}/>`).join("");
    const chapterItems = chapters.map((chapter) => `<item id="${xmlEscape(chapter.id)}" href="${xmlEscape(chapter.href)}" media-type="application/xhtml+xml"/>`).join("");
    const titlePageItem = hasTitlePage ? "<item id=\"titlepage\" href=\"titlepage.xhtml\" media-type=\"application/xhtml+xml\"/>" : "";
    const authors = (metadata?.authors ?? []).map((author) => `<dc:creator>${xmlEscape(author)}</dc:creator>`).join("");
    const publisher = metadata?.publisher ? `<dc:publisher>${xmlEscape(metadata.publisher)}</dc:publisher>` : "";
    const description = metadata?.description ? `<dc:description>${xmlEscape(metadata.description)}</dc:description>` : "";
    const language = xmlEscape(metadata?.language || "en");
    const cover = metadata?.coverPath ? `<meta name="cover" content="image-${resources.findIndex((resource) => resource.path.startsWith("images/cover.")) + 1}"/>` : "";
    const mathMetadata = hasMath ? "<meta property=\"schema:accessMode\">textual</meta>" : "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}" prefix="schema: http://schema.org/"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xmlEscape(title)}</dc:title>${authors}<dc:language>${language}</dc:language>${publisher}${description}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>${mathMetadata}${cover}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>${titlePageItem}${chapterItems}${imageItems}</manifest><spine>${hasTitlePage ? "<itemref idref=\"titlepage\"/>" : ""}${chapters.map((chapter) => `<itemref idref="${xmlEscape(chapter.id)}"/>`).join("")}</spine></package>`;
}

function navigationDocument(title: string, chapters: readonly ChapterRecord[], language: string): string {
    const items = chapters.map((chapter) => {
        const sections = chapter.headings.map((heading) => `<li><a href="${xmlEscape(chapter.href)}#${encodeURIComponent(heading.id)}">${xmlEscape(heading.title)}</a></li>`).join("");
        return `<li><a href="${xmlEscape(chapter.href)}">${xmlEscape(chapter.title)}</a>${sections ? `<ol>${sections}</ol>` : ""}</li>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="${XHTML_NS}" xmlns:epub="${EPUB_NS}" xml:lang="${xmlEscape(language)}"><head><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${items}</ol></nav></body></html>`;
}

function chapterDocument(title: string, body: string, id: string): string {
    const heading = /^\s*<h1\b/i.test(body) ? "" : `<h1>${xmlEscape(title)}</h1>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="${XHTML_NS}" xml:lang="en"><head><meta charset="utf-8"/><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><main class="chapter" id="${xmlEscape(id)}">${heading}${body}</main></body></html>`;
}

function titlePageDocument(title: string, body: string, language: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="${XHTML_NS}" xml:lang="${xmlEscape(language)}"><head><meta charset="utf-8"/><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><main class="title-page">${body}</main></body></html>`;
}

function xmlEscape(value: string): string {
    return HtmlEscaper.escape(value).replaceAll("&#x27;", "&apos;");
}

function safeId(value: string, index: number): string {
    const id = value.replace(/[^A-Za-z0-9_-]/g, "-");
    return id.length > 0 ? id : `chapter-${index}`;
}

function encode(value: string): Uint8Array { return new TextEncoder().encode(value); }

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}

function createIdentifier(): string {
    const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `urn:uuid:${uuid}`;
}

function slug(title: string): string {
    const value = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return value.length > 0 ? value : "book";
}
