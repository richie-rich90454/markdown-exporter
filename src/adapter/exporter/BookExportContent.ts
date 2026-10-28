import type { BookEntry, BookProject } from "../../domain/BookProject";
import type { ExportRequest } from "../../domain/ExportRequest";

export interface RenderedBookSection {
    readonly entry: BookEntry | undefined;
    readonly title: string;
    readonly anchorId: string;
    readonly content: Node;
}

/** Render every ordered manuscript entry with the same renderer used by preview. */
export async function renderBookSections(request: ExportRequest): Promise<RenderedBookSection[]> {
    const project = request.bookProject;
    const entries = project?.manifest.entries ?? [];
    if (project === undefined || entries.length === 0) {
        return [{ entry: undefined, title: request.title || "Untitled manuscript", anchorId: "", content: request.content.cloneNode(true) }];
    }
    if (entries.length > 1 && request.renderSource === undefined) {
        throw new Error("The book cannot be exported because its Markdown renderer is unavailable.");
    }

    const sections: RenderedBookSection[] = [];
    for (const entry of entries) {
        const source = project.files[entry.path];
        if (typeof source !== "string") {
            throw new Error(`The Markdown file for “${entry.title}” is missing.`);
        }
        const rendered = request.renderSource === undefined
            ? request.content.cloneNode(true)
            : await request.renderSource(source);
        sections.push({
            entry,
            title: entry.title,
            anchorId: chapterAnchorId(entry.id),
            content: entries.length > 1 ? withSectionHeading(rendered, entry.title, chapterAnchorId(entry.id)) : rendered
        });
    }
    return sections;
}

export function resolveBookImageReferences(
    content: Node,
    project: BookProject | undefined,
    chapterPath: string | undefined
): void {
    if (project === undefined || chapterPath === undefined || !(content instanceof Element || content instanceof DocumentFragment)) return;
    for (const image of Array.from(content.querySelectorAll<HTMLImageElement>("img"))) {
        const source = image.getAttribute("src") ?? "";
        if (source.length === 0 || /^(?:data:|blob:|https?:|\/\/|\/)/i.test(source)) continue;
        const file = project.files[resolveProjectPath(chapterPath, source)];
        if (file === undefined) continue;
        const bytes = typeof file === "string" ? new TextEncoder().encode(file) : file;
        image.setAttribute("src", `data:${mimeForPath(source)};base64,${encodeBase64(bytes)}`);
    }
}

export function createBookTitlePage(project: BookProject | undefined, title: string): HTMLElement {
    const page = document.createElement("section");
    page.className = "book-title-page";
    const metadata = project?.manifest.metadata;
    const coverPath = metadata?.coverPath;
    const cover = coverPath === undefined ? undefined : project?.files[coverPath];
    if (cover !== undefined && coverPath !== undefined) {
        const image = document.createElement("img");
        image.className = "book-cover";
        image.alt = `Cover of ${metadata?.title || title || "Untitled manuscript"}`;
        image.src = `data:${mimeForPath(coverPath)};base64,${encodeBase64(
            typeof cover === "string" ? new TextEncoder().encode(cover) : cover
        )}`;
        page.append(image);
    }
    const heading = document.createElement("h1");
    heading.textContent = project?.manifest.metadata.title || title || "Untitled manuscript";
    page.append(heading);
    if (metadata?.subtitle) {
        const subtitle = document.createElement("p");
        subtitle.className = "book-subtitle";
        subtitle.textContent = metadata.subtitle;
        page.append(subtitle);
    }
    if (metadata?.authors.length) {
        const authors = document.createElement("p");
        authors.className = "book-authors";
        authors.textContent = metadata.authors.join(", ");
        page.append(authors);
    }
    if (metadata?.publisher) {
        const publisher = document.createElement("p");
        publisher.className = "book-publisher";
        publisher.textContent = metadata.publisher;
        page.append(publisher);
    }
    if (metadata?.isbn) {
        const isbn = document.createElement("p");
        isbn.className = "book-isbn";
        isbn.textContent = `ISBN ${metadata.isbn}`;
        page.append(isbn);
    }
    return page;
}

export function createBookContentsPage(sections: readonly RenderedBookSection[]): HTMLElement {
    const page = document.createElement("section");
    page.className = "book-contents-page";
    const heading = document.createElement("h1");
    heading.textContent = "Contents";
    const list = document.createElement("ol");
    for (const section of sections) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#${section.anchorId}`;
        link.textContent = section.title;
        item.append(link);
        list.append(item);
    }
    page.append(heading, list);
    return page;
}

export function serializeContent(content: Node): string {
    if (content instanceof DocumentFragment) {
        return Array.from(content.childNodes)
            .map((node) => new XMLSerializer().serializeToString(node))
            .join("\n");
    }
    return new XMLSerializer().serializeToString(content);
}

export function chapterAnchorId(entryId: string): string {
    const id = entryId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return `book-chapter-${id || "untitled"}`;
}

function withSectionHeading(content: Node, title: string, anchorId: string): Node {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return content;
    const children = Array.from(content.childNodes).filter(
        (node) => node.nodeType !== Node.TEXT_NODE || (node.textContent ?? "").trim().length > 0
    );
    const first = children.find((node) => node.nodeType === Node.ELEMENT_NODE) as HTMLElement | undefined;
    if (first?.tagName === "H1" && first.textContent?.trim() === title.trim()) {
        first.id = anchorId;
        return content;
    }

    const section = document.createDocumentFragment();
    const heading = document.createElement("h1");
    heading.id = anchorId;
    heading.textContent = title;
    section.append(heading);
    if (content instanceof DocumentFragment) section.append(content);
    else section.append(content.cloneNode(true));
    return section;
}

function resolveProjectPath(chapterPath: string, source: string): string {
    let decoded = source.split(/[?#]/, 1)[0] ?? source;
    try { decoded = decodeURIComponent(decoded); } catch { return ""; }
    const parts = chapterPath.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
            if (parts.length === 0) return "";
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return parts.join("/");
}

function mimeForPath(path: string): string {
    switch (path.toLowerCase().split(".").at(-1)) {
        case "jpg": case "jpeg": return "image/jpeg";
        case "gif": return "image/gif";
        case "svg": return "image/svg+xml";
        case "webp": return "image/webp";
        case "avif": return "image/avif";
        default: return "image/png";
    }
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}
