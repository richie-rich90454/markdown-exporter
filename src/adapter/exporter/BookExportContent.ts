import type { BookEntry, BookProject } from "../../domain/BookProject";
import type { ExportRequest } from "../../domain/ExportRequest";

export interface RenderedBookSection {
    readonly entry: BookEntry | undefined;
    readonly title: string;
    readonly anchorId: string;
    readonly content: Node;
}

/** Resolve a single publication title consistently across every export format. */
export function publicationTitle(
    project: BookProject | undefined,
    documentTitle: string,
    isBookProject = project !== undefined
): string {
    const metadataTitle = project?.manifest.metadata.title?.trim();
    const requestedTitle = documentTitle.trim();
    if (isBookProject) return metadataTitle || requestedTitle || "Untitled manuscript";
    return requestedTitle || "document";
}

/** Keep useful Unicode letters in filenames while removing path/control characters. */
export function publicationSlug(title: string, fallback = "document"): string {
    const value = title
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
    const shortened = Array.from(value).slice(0, 120).join("");
    const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(shortened);
    return shortened.length === 0 ? fallback : windowsReservedName ? `_${shortened}` : shortened;
}

/** Render every ordered manuscript entry with the same renderer used by preview. */
export async function renderBookSections(request: ExportRequest): Promise<RenderedBookSection[]> {
    const project = request.bookProject;
    const entries = project?.manifest.entries ?? [];
    if (project === undefined || entries.length === 0) {
        return [
            {
                entry: undefined,
                title: request.title || "Untitled manuscript",
                anchorId: "",
                content: request.content.cloneNode(true)
            }
        ];
    }
    if (request.isBookProject && request.renderSource === undefined) {
        throw new Error(
            "The book cannot be exported because its Markdown renderer is unavailable."
        );
    }

    const sections: RenderedBookSection[] = [];
    const usedAnchorIds = new Set<string>();
    for (const [index, entry] of entries.entries()) {
        const source = project.files[entry.path];
        if (typeof source !== "string") {
            throw new Error(`The Markdown file for “${entry.title}” is missing.`);
        }
        const rendered =
            request.renderSource === undefined
                ? request.content.cloneNode(true)
                : await request.renderSource(source);
        const anchorId = request.isBookProject
            ? uniqueAnchorId(entry.id, index + 1, usedAnchorIds)
            : "";
        const content = request.isBookProject
            ? withSectionHeading(rendered, entry.title, anchorId)
            : rendered;
        if (request.isBookProject) namespaceSectionIds(content, anchorId);
        sections.push({
            entry,
            title: entry.title,
            anchorId,
            content
        });
    }
    return sections;
}

export function resolveBookImageReferences(
    content: Node,
    project: BookProject | undefined,
    chapterPath: string | undefined
): void {
    if (
        project === undefined ||
        chapterPath === undefined ||
        !(content instanceof Element || content instanceof DocumentFragment)
    )
        return;
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
    for (const [index, section] of sections.entries()) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        const anchorId = section.anchorId || `book-section-${index + 1}`;
        if (section.anchorId.length === 0) {
            const heading =
                section.content instanceof Element || section.content instanceof DocumentFragment
                    ? section.content.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6")
                    : null;
            if (heading !== null) heading.id = anchorId;
        }
        link.href = `#${anchorId}`;
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
    const id = entryId
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `book-chapter-${id || "untitled"}`;
}

function uniqueAnchorId(entryId: string, index: number, used: Set<string>): string {
    const base = chapterAnchorId(entryId);
    let anchorId = base;
    let suffix = 2;
    while (used.has(anchorId)) anchorId = `${base}-${suffix++}`;
    used.add(anchorId);
    return anchorId || `book-section-${index}`;
}

/** Namespace in-document IDs so chapters can be combined into one HTML/PDF/DOCX document safely. */
function namespaceSectionIds(content: Node, sectionId: string): void {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return;
    const elements = [
        ...(content instanceof Element ? [content] : []),
        ...Array.from(content.querySelectorAll<Element>("*"))
    ];
    const ids = new Map<string, string>();
    const used = new Set<string>();
    for (const element of elements) {
        const original = element.getAttribute("id");
        if (original === null || original.length === 0) continue;
        if (original === sectionId) {
            ids.set(original, original);
            used.add(original);
            continue;
        }
        const safeSuffix = original.replace(/[^\p{L}\p{N}_.:-]+/gu, "-") || "id";
        const base = `${sectionId}-${safeSuffix}`;
        let namespaced = base;
        let suffix = 2;
        while (used.has(namespaced)) namespaced = `${base}-${suffix++}`;
        used.add(namespaced);
        if (!ids.has(original)) ids.set(original, namespaced);
        element.setAttribute("id", namespaced);
    }

    for (const element of elements) {
        for (const attribute of ["href", "xlink:href"]) {
            const value = element.getAttribute(attribute);
            if (value === null || !value.startsWith("#")) continue;
            const fragment = decodeFragment(value.slice(1));
            const namespaced = ids.get(fragment);
            if (namespaced !== undefined)
                element.setAttribute(attribute, `#${encodeURIComponent(namespaced)}`);
        }
        for (const attribute of [
            "aria-labelledby",
            "aria-describedby",
            "aria-controls",
            "aria-owns",
            "aria-flowto",
            "aria-details",
            "aria-errormessage",
            "for",
            "headers",
            "list"
        ]) {
            const value = element.getAttribute(attribute);
            if (value === null) continue;
            const namespaced = value
                .split(/\s+/)
                .map((id) => ids.get(id) ?? id)
                .join(" ");
            if (namespaced !== value) element.setAttribute(attribute, namespaced);
        }
    }
}

function decodeFragment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function withSectionHeading(content: Node, title: string, anchorId: string): Node {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return content;
    const children = Array.from(content.childNodes).filter(
        (node) => node.nodeType !== Node.TEXT_NODE || (node.textContent ?? "").trim().length > 0
    );
    const first = children.find((node) => node.nodeType === Node.ELEMENT_NODE) as
        | HTMLElement
        | undefined;
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
    try {
        decoded = decodeURIComponent(decoded);
    } catch {
        return "";
    }
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
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "gif":
            return "image/gif";
        case "svg":
            return "image/svg+xml";
        case "webp":
            return "image/webp";
        case "avif":
            return "image/avif";
        default:
            return "image/png";
    }
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}
