import type { BookProject } from "../../domain/BookProject";
import type { RenderedBookSection } from "./BookExportContent";

const registeredStyles = new Set<string>();
const CITATION = /\[((?:-?@[\w:./-]+)(?:\s*;\s*-?@[\w:./-]+)*)\]/g;

/** Resolve local cite-key markers and append a generated reference list when a local .bib exists. */
export async function addCitationReferences(
    sections: RenderedBookSection[],
    project: BookProject | undefined
): Promise<void> {
    const manifest = project?.manifest;
    const bibliographyPath = manifest?.bibliographyPath;
    const bibliography =
        bibliographyPath === undefined ? undefined : project?.files[bibliographyPath];
    if (typeof bibliography !== "string") return;
    if (!sections.some((section) => section.content.textContent?.includes("[@"))) return;

    try {
        const [{ Cite, plugins }] = await Promise.all([
            import("@citation-js/core"),
            import("@citation-js/plugin-bibtex"),
            import("@citation-js/plugin-csl")
        ]);
        const stylePath = manifest?.citationStylePath;
        let style: string = manifest?.citationStyleId ?? "apa";
        if (stylePath !== undefined) {
            const styleSource = project?.files[stylePath];
            if (typeof styleSource === "string") {
                style = `local-${hashStyle(styleSource)}`;
                if (!registeredStyles.has(style)) {
                    plugins.config.get("@csl").styles.add(style, styleSource);
                    registeredStyles.add(style);
                }
            }
        }
        const references = new Cite(bibliography);
        const known = new Set(references.getIds());
        const cited = new Set<string>();
        const unresolved = new Set<string>();

        for (const section of sections) {
            replaceCitationMarkers(section.content, (marker, keys) => {
                const missing = keys.filter((key) => !known.has(key));
                if (missing.length > 0) {
                    for (const key of missing) unresolved.add(key);
                    return marker;
                }
                for (const key of keys) cited.add(key);
                return references.format("citation", {
                    entry: keys,
                    style,
                    lang: manifest?.metadata.language || "en-US",
                    format: "text",
                    citationsPre: [],
                    citationsPost: []
                });
            });
        }

        if (cited.size === 0 && unresolved.size === 0) return;
        const wrapper = document.createElement("section");
        wrapper.className = "generated-references";
        if (cited.size > 0) {
            const generated = new Cite(
                references.data.filter((entry) => cited.has(String(entry.id)))
            );
            const html = generated.format("bibliography", {
                style,
                lang: manifest?.metadata.language || "en-US",
                format: "html"
            });
            const heading = document.createElement("h1");
            heading.textContent = "References";
            wrapper.append(heading);
            wrapper.append(sanitizeCitationHtml(html));
        }
        if (unresolved.size > 0) {
            const diagnostic = document.createElement("p");
            diagnostic.className = "citation-error";
            diagnostic.textContent = `Unresolved citation keys: ${[...unresolved].join(", ")}. Their source markers remain visible.`;
            wrapper.append(diagnostic);
        }
        sections.push({ entry: undefined, title: "References", anchorId: "", content: wrapper });
    } catch (error) {
        const diagnostic = document.createElement("section");
        diagnostic.className = "generated-references citation-error";
        const heading = document.createElement("h1");
        heading.textContent = "References could not be generated";
        const message = document.createElement("p");
        message.textContent =
            error instanceof Error ? error.message : "The local bibliography could not be read.";
        diagnostic.append(heading, message);
        sections.push({ entry: undefined, title: "References", anchorId: "", content: diagnostic });
    }
}

/** Keep citation markup useful to exports without trusting CSL or bibliography HTML. */
export function sanitizeCitationHtml(source: string): DocumentFragment {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    const fragment = document.createDocumentFragment();
    for (const child of Array.from(parsed.body.childNodes)) {
        const safe = sanitizeCitationNode(child);
        if (safe !== undefined) fragment.append(safe);
    }
    return fragment;
}

const citationTags = new Set(["DIV", "P", "SPAN", "I", "EM", "B", "STRONG", "A", "SUP", "SUB"]);
const citationDangerousTags = new Set([
    "SCRIPT",
    "STYLE",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "SVG",
    "MATH"
]);

function sanitizeCitationNode(node: Node): Node | undefined {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? "");
    if (!(node instanceof Element)) return undefined;
    if (citationDangerousTags.has(node.tagName)) return undefined;
    if (!citationTags.has(node.tagName)) {
        const unwrapped = document.createDocumentFragment();
        for (const child of Array.from(node.childNodes)) {
            const safe = sanitizeCitationNode(child);
            if (safe !== undefined) unwrapped.append(safe);
        }
        return unwrapped;
    }

    const element = document.createElement(node.tagName.toLowerCase());
    const className = node.getAttribute("class");
    if (className !== null) {
        const safeClasses = className.split(/\s+/).filter((value) => /^csl-[\w-]+$/.test(value));
        if (safeClasses.length > 0) element.className = safeClasses.join(" ");
    }
    if (node.tagName === "A") {
        const href = node.getAttribute("href");
        if (href !== null && isSafeCitationHref(href)) {
            element.setAttribute("href", href);
            element.setAttribute("rel", "noopener noreferrer");
        }
    }
    for (const child of Array.from(node.childNodes)) {
        const safe = sanitizeCitationNode(child);
        if (safe !== undefined) element.append(safe);
    }
    return element;
}

function isSafeCitationHref(value: string): boolean {
    try {
        const url = new URL(value, document.baseURI);
        return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
    } catch {
        return false;
    }
}

function hashStyle(source: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
        hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function replaceCitationMarkers(
    root: Node,
    format: (marker: string, keys: string[]) => string
): void {
    if (!(root instanceof Element || root instanceof DocumentFragment)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode()) !== null) {
        const parent = node.parentElement;
        if (parent?.closest("code,pre,a,.katex,svg,script,style") !== null) continue;
        if (node.textContent?.includes("[@") === true) nodes.push(node as Text);
    }
    for (const textNode of nodes) {
        const source = textNode.textContent ?? "";
        let output = "";
        let offset = 0;
        for (const match of source.matchAll(CITATION)) {
            const start = match.index ?? 0;
            output += source.slice(offset, start);
            const marker = match[0];
            const keys = (match[1] ?? "").split(";").map((key) => key.trim().replace(/^-?@/, ""));
            output += format(marker, keys);
            offset = start + marker.length;
        }
        output += source.slice(offset);
        textNode.textContent = output;
    }
}
