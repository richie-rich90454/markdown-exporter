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
    const bibliography = bibliographyPath === undefined ? undefined : project?.files[bibliographyPath];
    if (typeof bibliography !== "string") return;
    if (!sections.some((section) => section.content.textContent?.includes("[@"))) return;

    try {
        const [{ Cite, plugins }] = await Promise.all([
            import("@citation-js/core"),
            import("@citation-js/plugin-bibtex"),
            import("@citation-js/plugin-csl")
        ]);
        const stylePath = manifest?.citationStylePath;
        let style = "apa";
        if (stylePath !== undefined) {
            const styleSource = project?.files[stylePath];
            if (typeof styleSource === "string") {
                style = `local-${stylePath}`;
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

        if (cited.size === 0) return;
        const generated = new Cite(references.data.filter((entry) => cited.has(String(entry.id))));
        const html = generated.format("bibliography", {
            style,
            lang: manifest?.metadata.language || "en-US",
            format: "html"
        });
        const wrapper = document.createElement("section");
        wrapper.className = "generated-references";
        const heading = document.createElement("h1");
        heading.textContent = "References";
        wrapper.append(heading);
        const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
        for (const child of Array.from(parsed.body.childNodes)) {
            wrapper.append(document.importNode(child, true));
        }
        if (unresolved.size > 0) {
            const diagnostic = document.createElement("p");
            diagnostic.className = "citation-error";
            diagnostic.textContent = `Unresolved citation keys: ${[...unresolved].join(", ")}. Their source markers remain visible.`;
            wrapper.append(diagnostic);
        }
        sections.push({ entry: undefined, title: "References", content: wrapper });
    } catch (error) {
        const diagnostic = document.createElement("section");
        diagnostic.className = "generated-references citation-error";
        const heading = document.createElement("h1");
        heading.textContent = "References could not be generated";
        const message = document.createElement("p");
        message.textContent = error instanceof Error ? error.message : "The local bibliography could not be read.";
        diagnostic.append(heading, message);
        sections.push({ entry: undefined, title: "References", content: diagnostic });
    }
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
