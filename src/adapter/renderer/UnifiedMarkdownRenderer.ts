import type { Root as HastRoot } from "hast";
import type { Pluggable, PluggableList } from "unified";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import type { MarkdownDocument } from "../../domain/MarkdownDocument";
import { PHYSICS_MACROS } from "../../domain/KatexMacros";
import { hasPandocTex, normalizePandocTexSource } from "../../domain/PandocTex";
import { RenderedDocument } from "../../domain/RenderedDocument";
import type { Clock } from "../../port/Clock";
import type { DomRenderer } from "../../port/DomRenderer";
import type { MarkdownRenderer } from "../../port/MarkdownRenderer";

// rehype-highlight emits <code class="language-x"> and <span class="hljs-*">,
// which the GitHub schema would strip, so both are re-allowed here. Data URLs
// are re-allowed on src for pasted images: only img, picture and source can
// carry src in this schema, and an SVG inside an img never runs script.
const sanitizeSchema: SanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), "mark", "sub", "sup"],
    protocols: {
        ...defaultSchema.protocols,
        src: [...(defaultSchema.protocols?.src ?? []), "data"]
    },
    attributes: {
        ...defaultSchema.attributes,
        blockquote: [["className", /^markdown-alert(?:--[a-z]+)?$/]],
        code: [["className", /^language-/]],
        p: [["className", /^markdown-alert__title$/]],
        span: [["className", /^hljs-/]],
        ul: [["className", /^markdown-toc$/]]
    }
};


function createProcessor(
    mathRemark?: Pluggable,
    katexPlugin?: Pluggable,
    rawHtmlPlugin?: Pluggable,
    highlightPlugin?: Pluggable
) {
    const processor = unified().use(remarkParse).use(remarkGfm, { singleTilde: false });
    if (mathRemark !== undefined) {
        processor.use([mathRemark, equationReferences as unknown as Pluggable] as PluggableList);
    }
    processor
        .use(remarkGemoji)
        .use(remarkFrontmatter, ["yaml", "toml"])
        .use(markdownFeatures)
        .use(remarkRehype, { allowDangerousHtml: true });
    if (rawHtmlPlugin !== undefined) processor.use([rawHtmlPlugin] as PluggableList);
    processor.use(rehypeSanitize, sanitizeSchema).use(normalizeFootnoteIds);
    if (highlightPlugin !== undefined) processor.use([highlightPlugin] as PluggableList);
    if (katexPlugin !== undefined) {
        const configuredKatex = [katexPlugin, { macros: PHYSICS_MACROS }] as unknown as Pluggable;
        processor.use([configuredKatex] as PluggableList);
    }
    return processor;
}

export class UnifiedMarkdownRenderer implements MarkdownRenderer {
    private readonly processorPromises = new Map<
        string,
        Promise<ReturnType<typeof createProcessor>>
    >();

    constructor(
        protected readonly domWriter: DomRenderer,
        protected readonly clock: Clock
    ) {}

    async render(document: MarkdownDocument): Promise<RenderedDocument> {
        const hast = await this.toHast(document.source);
        const content = await this.renderContent(hast);
        return new RenderedDocument(
            content,
            titleOfSource(document.source),
            this.clock.nowEpochMs()
        );
    }

    async renderIncremental(
        previous: RenderedDocument,
        next: MarkdownDocument
    ): Promise<RenderedDocument> {
        return this.render(next);
    }

    protected async renderContent(hast: HastRoot): Promise<DocumentFragment> {
        const content = this.domWriter.renderFragment(hast);
        const blocks = Array.from(content.querySelectorAll<HTMLPreElement>("pre")).filter(
            (block) => {
                const code = block.querySelector("code");
                return code !== null && diagramKind(code) !== null;
            }
        );
        if (blocks.length === 0) return content;

        // Keep Mermaid's large parser/runtime behind a second feature boundary.
        // The Markdown renderer is on the normal writing path, but ordinary
        // documents should not download any diagram code.
        const { renderMermaid } = await import("./MermaidRuntime");

        for (const block of blocks) {
            const code = block.querySelector("code");
            if (code === null) continue;
            try {
                const source = normalizeDiagram(code.textContent ?? "", diagramKind(code));
                const svg = safeSvg(await renderMermaid(source, /^\s*zenuml\b/i.test(source)));
                if (svg === null)
                    throw new Error("Mermaid returned an SVG that could not be sanitized.");
                block.replaceWith(svg);
            } catch (error) {
                block.classList.add("diagram-error");
                block.title = error instanceof Error ? error.message : "Unknown diagram error.";
                block.setAttribute(
                    "aria-label",
                    "Diagram could not be rendered. Source is preserved."
                );
                const message = document.createElement("p");
                message.className = "diagram-error__message";
                message.textContent =
                    "Diagram could not be rendered. The source is preserved below.";
                block.before(message);
            }
        }
        return content;
    }

    protected async toHast(source: string): Promise<HastRoot> {
        const currencySafeSource = escapeCurrencyDelimiters(source);
        const usesMath = hasMathSyntax(currencySafeSource);
        const usesChemistry = usesMath && /\\(?:ce|pu)\s*\{/.test(currencySafeSource);
        const usesRawHtml = hasRawHtml(source);
        const usesHighlight = hasHighlightedCode(source);
        const processor = await this.getProcessor(usesMath, usesChemistry, usesRawHtml, usesHighlight);
        const texNormalizedSource = usesMath
            ? normalizePandocTexSource(currencySafeSource)
            : currencySafeSource;
        const preparedSource = usesMath
            ? rewriteAlternateDelimiters(texNormalizedSource)
            : texNormalizedSource;
        const mdast = processor.parse(normalizeSpacedPipeTables(preparedSource));
        const hast = (await processor.run(mdast)) as HastRoot;
        // remark-rehype keeps the blank lines between blocks as whitespace text
        // nodes. Pagination and the incremental split both assume one node per
        // top-level block, so they go.
        hast.children = hast.children.filter(
            (child) => !(child.type === "text" && child.value.trim().length === 0)
        );
        return hast;
    }

    private async getProcessor(
        usesMath: boolean,
        usesChemistry: boolean,
        usesRawHtml: boolean,
        usesHighlight: boolean
    ): Promise<ReturnType<typeof createProcessor>> {
        const key = `${usesMath ? "m" : ""}${usesChemistry ? "c" : ""}${usesRawHtml ? "r" : ""}${usesHighlight ? "h" : ""}`;
        let processorPromise = this.processorPromises.get(key);
        if (processorPromise === undefined) {
            processorPromise = (async () => {
                const [math, , rawHtml, highlight] = await Promise.all([
                    usesMath
                        ? Promise.all([
                              import("remark-math"),
                              import("rehype-katex"),
                              import("katex/dist/katex.min.css")
                          ])
                        : Promise.resolve(null),
                    // mhchem registers \ce and \pu with the shared KaTeX
                    // runtime. Keep its code out of ordinary math documents,
                    // and let KaTeX display its usual formula diagnostic if
                    // this optional extension cannot be loaded.
                    usesChemistry
                        ? import("katex/contrib/mhchem").catch(() => null)
                        : Promise.resolve(null),
                    usesRawHtml ? import("rehype-raw") : Promise.resolve(null),
                    usesHighlight ? import("rehype-highlight") : Promise.resolve(null)
                ]);
                return createProcessor(
                    math?.[0].default,
                    math?.[1].default,
                    rawHtml?.default,
                    highlight?.default
                );
            })();
            this.processorPromises.set(key, processorPromise);
        }
        return processorPromise;
    }
}

/**
 * WebKit can insert paragraph separators between pasted lines in a contenteditable
 * editor. Recover the GFM table only when a pipe-table header and delimiter make
 * the structure unambiguous; leave all other blank lines alone.
 */
function normalizeSpacedPipeTables(source: string): string {
    const lines = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
    const content = (line: string): string => line.replace(/(?:\r\n|\n|\r)$/, "");
    const pipeCount = (line: string): number =>
        Array.from(line.matchAll(/(?<!\\)\|/g)).length;
    const isPipeRow = (line: string): boolean => pipeCount(line) > 0;
    const isDelimiter = (line: string): boolean =>
        /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
    const output: string[] = [];

    for (let index = 0; index < lines.length; ) {
        const header = content(lines[index] ?? "");
        if (!isPipeRow(header)) {
            output.push(lines[index] ?? "");
            index += 1;
            continue;
        }

        let delimiterIndex = index + 1;
        while (delimiterIndex < lines.length && content(lines[delimiterIndex] ?? "").trim() === "") {
            delimiterIndex += 1;
        }
        const delimiter = content(lines[delimiterIndex] ?? "");
        const columns = pipeCount(header);
        if (
            delimiterIndex === index + 1 ||
            !isDelimiter(delimiter) ||
            pipeCount(delimiter) !== columns
        ) {
            output.push(lines[index] ?? "");
            index += 1;
            continue;
        }

        output.push(lines[index] ?? "", lines[delimiterIndex] ?? "");
        index = delimiterIndex + 1;
        while (index < lines.length) {
            const row = content(lines[index] ?? "");
            if (row.trim() === "") {
                let nextRowIndex = index + 1;
                while (
                    nextRowIndex < lines.length &&
                    content(lines[nextRowIndex] ?? "").trim() === ""
                ) {
                    nextRowIndex += 1;
                }
                const nextRow = content(lines[nextRowIndex] ?? "");
                if (!isPipeRow(nextRow) || pipeCount(nextRow) !== columns) break;
                output.push(lines[nextRowIndex] ?? "");
                index = nextRowIndex + 1;
                continue;
            }
            if (!isPipeRow(row) || pipeCount(row) !== columns) break;
            output.push(lines[index] ?? "");
            index += 1;
        }
    }
    return output.join("");
}

function hasRawHtml(source: string): boolean {
    const prose = source
        .replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$/gm, "")
        .replace(/(`+)[\s\S]*?\1/g, "");
    return (
        /(?<!\\)<(?:\/?[a-z][a-z\d-]*(?=[\s/>])|!|\?)/i.test(prose) ||
        /^\s{0,3}>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im.test(prose)
    );
}

function hasHighlightedCode(source: string): boolean {
    return /(?:^|\n)\s{0,3}(?:`{3,}|~{3,})\s*[^\s`~{][^\n]*(?:\n|$)/.test(source);
}

function diagramKind(code: HTMLElement): "mermaid" | "sequence" | "flow" | null {
    if (code.classList.contains("language-mermaid")) return "mermaid";
    if (code.classList.contains("language-sequence")) return "sequence";
    if (code.classList.contains("language-flow")) return "flow";
    return null;
}

function normalizeDiagram(source: string, kind: "mermaid" | "sequence" | "flow" | null): string {
    const trimmed = source.trim();
    if (kind === "sequence") {
        return normalizeLegacySequence(trimmed);
    }
    if (kind !== "flow") return trimmed;

    if (/^(?:flowchart|graph)\b/i.test(trimmed)) return trimmed;

    const labels = new Map<string, { readonly shape: string; readonly text: string }>();
    const edges: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
        const definition = /^\s*([\w-]+)\s*=>\s*([\w-]+)(?:\(([^)]*)\))?\s*(?::\s*(.*?))?\s*$/.exec(
            line
        );
        if (definition !== null) {
            const id = definition[1] ?? "node";
            const type = (definition[2] ?? "operation").toLowerCase();
            const definitionText = definition[4] ?? definition[3] ?? id;
            const text = definitionText
                .replace(/[{}<>]/g, "")
                .replaceAll("[", "")
                .replaceAll("]", "");
            const shape =
                type === "start" || type === "end" || type === "stop"
                    ? `([${text}])`
                    : type === "condition"
                      ? `{${text}}`
                      : type === "inputoutput"
                        ? `[/${text}/]`
                        : type === "subroutine"
                          ? `[[${text}]]`
                          : `[${text}]`;
            labels.set(id, { shape, text });
            continue;
        }
        const chain = line.split(/\s*->\s*/);
        if (chain.length < 2) continue;
        const nodes = chain.map((part) => /^([\w-]+)(?:\(([^)]+)\))?$/.exec(part.trim()));
        if (nodes.some((node) => node === null)) continue;
        for (let index = 1; index < nodes.length; index += 1) {
            const from = nodes[index - 1];
            const to = nodes[index];
            if (from === undefined || from === null || to === undefined || to === null) continue;
            const label = from[2];
            const edge =
                label === undefined
                    ? `${from[1]} --> ${to[1]}`
                    : `${from[1]} -->|${label}| ${to[1]}`;
            edges.push(edge);
        }
    }
    if (labels.size === 0 && edges.length === 0) return trimmed;
    const nodes = [...labels].map(([id, entry]) => `${id}${entry.shape}`).join("\n");
    return `flowchart TD\n${nodes}\n${edges.join("\n")}`;
}

function normalizeLegacySequence(source: string): string {
    if (/^sequenceDiagram\b/i.test(source)) return source;

    const participants = new Map<string, string>();
    const body: string[] = [];
    const participantId = (name: string): string => {
        const participant = name.trim();
        let id = participants.get(participant);
        if (id === undefined) {
            id = `Actor${participants.size + 1}`;
            participants.set(participant, id);
        }
        return id;
    };

    for (const line of source.split(/\r?\n/)) {
        const message = /^\s*(.+?)\s*(--?>|->)\s*(.+?)\s*:\s*(.*?)\s*$/.exec(line);
        if (message !== null) {
            const [, sender = "", arrow = "->", receiver = "", text = ""] = message;
            const mermaidArrow = arrow.startsWith("--") ? "-->>" : "->>";
            body.push(`${participantId(sender)}${mermaidArrow}${participantId(receiver)}: ${text}`);
            continue;
        }

        const note = /^\s*Note\s+(left|right)\s+of\s+(.+?)\s*:\s*(.*?)\s*$/i.exec(line);
        if (note !== null) {
            const [, side = "right", actor = "", text = ""] = note;
            body.push(`Note ${side.toLowerCase()} of ${participantId(actor)}: ${text}`);
            continue;
        }

        if (/^\s*(?:participant|actor)\b/i.test(line)) {
            body.push(line.trim());
        } else if (line.trim().length > 0 && /^\s*(?:Note\s+over\b)/i.test(line)) {
            body.push(line.trim());
        }
    }

    if (participants.size === 0 && body.length === 0) return `sequenceDiagram\n${source}`;
    const declarations = [...participants]
        .map(([name, id]) => `participant ${id} as ${name}`)
        .join("\n");
    return `sequenceDiagram\n${declarations}\n${body.join("\n")}`;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SAFE_SVG_TAGS = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polygon",
    "polyline",
    "text",
    "tspan",
    "defs",
    "marker",
    "clipPath",
    "mask",
    "foreignObject",
    "pattern",
    "linearGradient",
    "radialGradient",
    "stop",
    "title",
    "desc",
    "style"
]);
const SAFE_SVG_ATTRIBUTES = new Set([
    "xmlns",
    "viewBox",
    "width",
    "height",
    "role",
    "aria-label",
    "aria-roledescription",
    "class",
    "id",
    "d",
    "fill",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "transform",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "points",
    "text-anchor",
    "dominant-baseline",
    "font-size",
    "font-family",
    "font-weight",
    "marker-start",
    "marker-end",
    "clip-path",
    "mask",
    "opacity",
    "preserveAspectRatio",
    "style",
    "stop-color",
    "offset",
    "gradientUnits",
    "gradientTransform",
    "orient",
    "markerWidth",
    "markerHeight",
    "refX",
    "refY",
    "viewTarget",
    "focusable"
]);
const SAFE_FOREIGN_HTML_TAGS = new Set(["div", "span", "p", "br"]);
const SAFE_FOREIGN_HTML_ATTRIBUTES = new Set(["class", "style", "role", "aria-label"]);

function safeSvg(source: string): SVGSVGElement | null {
    const strict = new DOMParser().parseFromString(source, "image/svg+xml");
    let root: Element | null =
        strict.documentElement.localName.toLowerCase() === "svg" &&
        strict.querySelector("parsererror") === null
            ? strict.documentElement
            : null;
    if (root === null) {
        // Mermaid's ZenUML plugin emits XHTML labels inside foreignObject; its
        // HTML serialization is valid in a browser but can be malformed XML.
        root = new DOMParser().parseFromString(source, "text/html").querySelector("svg");
    }
    if (root === null) return null;
    const result = copySvgElement(root);
    if (result === null || result.localName !== "svg") return null;
    result.setAttribute("xmlns", SVG_NAMESPACE);
    result.setAttribute("role", "img");
    result.setAttribute("aria-label", "Diagram");
    result.classList.add("markdown-diagram");
    return result as SVGSVGElement;
}

function copySvgElement(source: Element): SVGElement | null {
    if (!SAFE_SVG_TAGS.has(source.localName)) return null;
    const element = document.createElementNS(SVG_NAMESPACE, source.localName);
    for (const attribute of Array.from(source.attributes)) {
        if (!SAFE_SVG_ATTRIBUTES.has(attribute.name) || /^on/i.test(attribute.name)) continue;
        const value = attribute.value;
        if (/(?:javascript:|data:text\/html|expression\s*\(|@import)/i.test(value)) continue;
        if (/href$/i.test(attribute.name) && !value.startsWith("#")) continue;
        if (attribute.name === "style" && /url\(\s*(?!#)/i.test(value)) continue;
        element.setAttribute(attribute.name, value);
    }
    if (source.localName === "style") {
        const css = source.textContent ?? "";
        if (/(?:url\(\s*(?!#)|javascript:|expression\s*\(|@import)/i.test(css)) return null;
        element.textContent = css;
        return element;
    }
    for (const child of Array.from(source.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            element.appendChild(document.createTextNode(child.textContent ?? ""));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const safeChild =
                source.localName === "foreignObject"
                    ? copyForeignHtmlElement(child as Element)
                    : copySvgElement(child as Element);
            if (safeChild !== null) element.appendChild(safeChild);
        }
    }
    return element;
}

function copyForeignHtmlElement(source: Element): Element | null {
    const tag = source.localName.toLowerCase();
    if (!SAFE_FOREIGN_HTML_TAGS.has(tag)) return null;
    const element = document.createElementNS(XHTML_NAMESPACE, tag);
    for (const attribute of Array.from(source.attributes)) {
        if (!SAFE_FOREIGN_HTML_ATTRIBUTES.has(attribute.name)) continue;
        if (
            attribute.name === "style" &&
            /(?:url\s*\(|expression\s*\(|@import|javascript:)/i.test(attribute.value)
        ) {
            continue;
        }
        element.setAttribute(attribute.name, attribute.value);
    }
    for (const child of Array.from(source.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            element.appendChild(document.createTextNode(child.textContent ?? ""));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const safeChild = copyForeignHtmlElement(child as Element);
            if (safeChild !== null) element.appendChild(safeChild);
        }
    }
    return element;
}

function hasMathSyntax(source: string): boolean {
    const prose = source
        .replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$/gm, "")
        .replace(/\\\$/g, "");
    const hasRawTex = hasPandocTex(prose);
    const mathProse = prose.replace(/(`+)[\s\S]*?\1/g, "");
    return (
        /(^|\n)\s*(```|~~~)\s*math\b/i.test(source) ||
        hasRawTex ||
        /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(mathProse) ||
        /(?<!\\)\$\$?[\s\S]*?\S(?<!\\)\$\$?/.test(mathProse)
    );
}

function rewriteAlternateDelimiters(source: string): string {
    return transformOutsideFences(source, (prose) =>
        transformProseSegments(prose, (text) =>
            text
                .replace(/\\\(([\s\S]+?)\\\)/g, (_match, formula: string) => `$${formula}$`)
                .replace(
                    /\\\[([\s\S]+?)\\\]/g,
                    (_match, formula: string) => `\n$$\n${formula}\n$$\n`
                )
        )
    );
}

function transformOutsideFences(source: string, transform: (text: string) => string): string {
    const lines = source.split(/(?<=\n)/);
    let fence: string | undefined;
    const prose: string[] = [];
    const output: string[] = [];
    const flush = (): void => {
        output.push(transform(prose.join("")));
        prose.length = 0;
    };

    for (const line of lines) {
        const marker = /^\s{0,3}(`{3,}|~{3,})[^\n]*/.exec(line);
        if (marker !== null) {
            if (fence === undefined) {
                flush();
                fence = marker[1];
                output.push(line);
            } else if (
                marker[1]?.[0] === fence[0] &&
                (marker[1]?.length ?? 0) >= fence.length &&
                /^\s{0,3}(?:`{3,}|~{3,})\s*(?:\n)?$/.test(line)
            ) {
                output.push(line);
                fence = undefined;
            } else {
                output.push(line);
            }
        } else if (fence === undefined) {
            prose.push(line);
        } else {
            output.push(line);
        }
    }
    flush();
    return output.join("");
}

function transformProseSegments(source: string, transform: (text: string) => string): string {
    const parts = source.split(/(`+[\s\S]*?`+)/g);
    return parts
        .map((part, index) => {
            if (index % 2 === 1) return part;
            return transform(part);
        })
        .join("");
}

function escapeCurrencyDelimiters(source: string): string {
    return transformOutsideFences(source, (prose) =>
        transformProseSegments(prose, (text) =>
            text.replace(
                /(?<!\\)\$(\d+(?:[,.]\d+)*)(\s+(?:and|or|to|for|costs?|was|is|per)\s+[^$\n]*?)\$(?=\d)/gi,
                (_match, amount: string, rest: string) => `\\$${amount}${rest}\\$`
            )
        )
    );
}

interface AstNode {
    type: string;
    value?: string;
    children?: AstNode[];
    url?: string;
    spread?: boolean | null;
    checked?: boolean | null;
    data?: {
        hName?: string;
        hProperties?: Record<string, unknown>;
    };
    properties?: Record<string, unknown>;
}

const normalizeFootnoteIds = () => (tree: AstNode) => {
    walk(tree, (node) => {
        const id = node.properties?.id;
        if (typeof id === "string" && id.startsWith("user-content-user-content-fn")) {
            node.properties = {
                ...node.properties,
                id: id.replace(/^user-content-user-content-fn/, "user-content-fn")
            };
        }
    });
};

const equationReferences = () => (tree: AstNode) => {
    const labels = new Map<string, string>();
    let number = 0;
    walk(tree, (node) => {
        if (node.type !== "math" && node.type !== "inlineMath") return;
        const value = node.value as string;
        const label = /\\label\{([^}]+)\}/.exec(value)?.[1];
        if (label === undefined) return;
        const explicitTag = /\\tag\*?\{([^}]+)\}/.exec(value)?.[1];
        number += 1;
        labels.set(label, explicitTag ?? String(number));
        let cleaned = value.replace(/\\label\{[^}]+\}/g, "");
        if (node.type === "math" && explicitTag === undefined) cleaned += `\\tag{${number}}`;
        node.value = cleaned;
    });
    walk(tree, (node) => {
        if (node.type !== "text") return;
        node.value = (node.value as string).replace(
            /\\(eqref|ref)\{([^}]+)\}/g,
            (match, kind: string, label: string) => {
                const value = labels.get(label);
                return value === undefined ? match : kind === "eqref" ? `(${value})` : value;
            }
        );
    });
};

const markdownFeatures = () => (tree: AstNode) => {
    if (tree.children === undefined) return;
    tree.children = tree.children.filter((node) => node.type !== "yaml" && node.type !== "toml");

    const headings: { readonly title: string; readonly slug: string }[] = [];
    const usedSlugs = new Map<string, number>();
    walk(tree, (node) => {
        if (node.type !== "heading") return;
        const title = textOf(node).trim();
        const base = slugifyHeading(title);
        const count = (usedSlugs.get(base) ?? 0) + 1;
        usedSlugs.set(base, count);
        const slug = count === 1 ? base : `${base}-${count}`;
        node.data = {
            ...node.data,
            hProperties: { ...node.data?.hProperties, id: slug }
        };
        headings.push({ title, slug });
    });

    tree.children = tree.children.map((node) => {
        if (node.type === "paragraph" && textOf(node).trim().toLowerCase() === "[toc]") {
            return {
                type: "list",
                ordered: false,
                spread: false,
                data: { hProperties: { className: ["markdown-toc"] } },
                children: headings.map(({ title, slug }) => ({
                    type: "listItem",
                    spread: false,
                    checked: null,
                    children: [
                        {
                            type: "paragraph",
                            children: [
                                {
                                    type: "link",
                                    url: `#user-content-${slug}`,
                                    children: [{ type: "text", value: title }]
                                }
                            ]
                        }
                    ]
                }))
            } as AstNode;
        }
        return node;
    });

    walk(tree, (node) => {
        if (node.type === "blockquote" && node.children?.[0]?.type === "paragraph") {
            const first = node.children[0];
            const marker =
                /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*\n([\s\S]*))?$/i.exec(
                    textOf(first)
                );
            const kind = marker?.[1]?.toLowerCase();
            if (kind !== undefined) {
                node.data = {
                    ...node.data,
                    hProperties: { ...node.data?.hProperties, className: `markdown-alert--${kind}` }
                };
                const content = (marker?.[2] ?? "").trim();
                node.children[0] = {
                    type: "paragraph",
                    data: { hProperties: { className: "markdown-alert__title" } },
                    children: [{ type: "text", value: kind[0]?.toUpperCase() + kind.slice(1) }]
                };
                if (content.length > 0) {
                    node.children.splice(1, 0, {
                        type: "paragraph",
                        children: [{ type: "text", value: content }]
                    });
                }
            }
        }
    });
    transformInlineText(tree);
};

function transformInlineText(parent: AstNode): void {
    if (parent.children === undefined) return;
    const output: AstNode[] = [];
    for (const node of parent.children) {
        if (node.type !== "text" || node.value === undefined) {
            transformInlineText(node);
            output.push(node);
            continue;
        }
        const parts = node.value.split(/(==[^=\n]+==|(?<!~)~[^~\n]+~|\^[^^\n]+\^)/g);
        if (parts.length === 1) {
            output.push(node);
            continue;
        }
        for (const part of parts) {
            const match = /^(==([^=\n]+)==|~([^~\n]+)~|\^([^^\n]+)\^)$/.exec(part);
            if (match === null) {
                output.push({ type: "text", value: part });
                continue;
            }
            const tag = match[2] !== undefined ? "mark" : match[3] !== undefined ? "sub" : "sup";
            const text = match[2] ?? match[3] ?? match[4] ?? "";
            output.push({
                type: "inlineFeature",
                data: { hName: tag },
                children: [{ type: "text", value: text }]
            });
        }
    }
    parent.children = output;
}

function textOf(node: AstNode): string {
    if (node.type === "text") return node.value ?? "";
    return (node.children ?? []).map(textOf).join("");
}

function slugifyHeading(title: string): string {
    const slug = title
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
    return slug || "section";
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
    visit(node);
    const children = node.children;
    if (children !== undefined) {
        for (const child of children) {
            walk(child, visit);
        }
    }
}

export function titleOfSource(source: string): string {
    let offset = 0;
    while (offset < source.length) {
        const newline = source.indexOf("\n", offset);
        const lineEnd = newline === -1 ? source.length : newline;
        const line = source.slice(offset, lineEnd).trim();
        const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading !== null) {
            const title = heading[1] ?? "";
            return title.replace(/[*_`~]/g, "").trim();
        }
        if (newline === -1) {
            break;
        }
        offset = newline + 1;
    }
    return "";
}
