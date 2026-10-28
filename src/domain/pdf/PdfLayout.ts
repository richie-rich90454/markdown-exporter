import type { FontKey } from "./PdfMetrics";
import { readMathLayout, type MathLayout } from "./MathLayout";

export interface Run {
    readonly text: string;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly mono: boolean;
    readonly link?: string | undefined;
    /** TeX source is emitted as invisible PDF text so formulas remain searchable. */
    readonly searchableText?: string | undefined;
    readonly math?: MathLayout | undefined;
}

export type Block =
    | { readonly kind: "heading"; readonly level: number; readonly runs: readonly Run[]; readonly id?: string | undefined }
    | { readonly kind: "paragraph"; readonly runs: readonly Run[] }
    | { readonly kind: "math"; readonly math: MathLayout }
    | { readonly kind: "code"; readonly lines: readonly string[] }
    | { readonly kind: "quote"; readonly blocks: readonly Block[] }
    | { readonly kind: "group"; readonly blocks: readonly Block[] }
    | {
          readonly kind: "list";
          readonly ordered: boolean;
          readonly items: readonly (readonly Block[])[];
      }
    | {
          readonly kind: "table";
          readonly head: readonly (readonly Run[])[];
          readonly body: readonly (readonly (readonly Run[])[])[];
      }
    | {
          readonly kind: "image";
          readonly src: string;
          readonly alt: string;
          readonly width: number;
          readonly height: number;
      }
    | { readonly kind: "rule" }
    | { readonly kind: "pageBreak" };

export type DrawOp =
    | {
          readonly kind: "text";
          readonly x: number;
          readonly y: number;
          readonly text: string;
          readonly font: FontKey;
          readonly size: number;
          readonly gray: number;
          readonly renderMode?: "visible" | "invisible" | undefined;
      }
    | {
          readonly kind: "math";
          readonly x: number;
          readonly y: number;
          readonly scale: number;
          readonly math: MathLayout;
      }
    | {
          readonly kind: "rect";
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
          readonly gray: number;
      }
    | {
          readonly kind: "line";
          readonly x1: number;
          readonly y1: number;
          readonly x2: number;
          readonly y2: number;
          readonly width: number;
          readonly gray: number;
      }
    | {
          readonly kind: "image";
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
          readonly index: number;
      }
    | {
          readonly kind: "link";
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
          readonly uri: string;
      }
    | {
          readonly kind: "anchor";
          readonly id: string;
          readonly y: number;
      };

export interface ImageRef {
    readonly src: string;
    readonly alt: string;
    readonly width: number;
    readonly height: number;
}

export interface PdfImageSource {
    readonly data: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly jpeg: boolean;
    readonly gray: boolean;
}

export interface LaidOut {
    readonly pages: readonly (readonly DrawOp[])[];
    readonly images: readonly ImageRef[];
    readonly fonts: readonly FontKey[];
    readonly mathFonts: readonly string[];
}

const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
    "NOSCRIPT",
    "INPUT",
    "BUTTON",
    "SELECT",
    "TEXTAREA",
    "CANVAS",
    "VIDEO",
    "AUDIO",
    "IFRAME",
    "OBJECT",
    "SOURCE",
    "TRACK",
    "MAP",
    "AREA",
    "DIALOG"
]);

const NO_TEXT_TAGS = new Set(["IMG"]);

export function parseBlocks(root: Node): Block[] {
    const blocks: Block[] = [];
    for (const child of Array.from(root.childNodes)) {
        const block = parseBlock(child);
        if (block !== null) {
            blocks.push(block);
        }
    }
    return blocks;
}

function parseBlock(node: Node): Block | null {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = collapse(node.textContent ?? "");
        return text.length === 0
            ? null
            : { kind: "paragraph", runs: [{ text, bold: false, italic: false, mono: false }] };
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }
    const element = node as HTMLElement;
    if (SKIP_TAGS.has(element.tagName) || element.classList.contains("page-spacer")) {
        return null;
    }
    if (element.classList.contains("book-page-break")) return { kind: "pageBreak" };
    if (element.classList.contains("katex-display")) {
        const math = readMathLayout(element.querySelector<HTMLElement>(".katex") ?? element);
        if (math !== null) return { kind: "math", math };
    }
    switch (element.tagName.toUpperCase()) {
        case "H1":
        case "H2":
        case "H3":
        case "H4":
        case "H5":
        case "H6":
            return {
                kind: "heading",
                level: Number(element.tagName.slice(1)),
                runs: inlineRuns(element),
                id: element.id || undefined
            };
        case "P":
        case "DIV":
        case "SECTION":
        case "ARTICLE":
        case "ASIDE":
        case "MAIN":
        case "HEADER":
        case "FOOTER":
        case "NAV":
        case "FIGURE":
            return parseFlow(element);
        case "PRE": {
            const lines = (element.textContent ?? "").replace(/\n$/, "").split("\n");
            return { kind: "code", lines };
        }
        case "BLOCKQUOTE":
            return { kind: "quote", blocks: parseBlocks(element) };
        case "UL":
        case "OL": {
            const items: Block[][] = [];
            for (const item of Array.from(element.children)) {
                if (item.tagName !== "LI") {
                    continue;
                }
                items.push(parseListItem(item as HTMLElement));
            }
            return items.length === 0
                ? null
                : { kind: "list", ordered: element.tagName === "OL", items };
        }
        case "TABLE": {
            return parseTable(element);
        }
        case "IMG":
            return imageBlock(element as HTMLImageElement);
        case "SVG":
            return svgBlock(element as unknown as SVGSVGElement);
        case "HR":
            return { kind: "rule" };
        default: {
            const children = parseBlocks(element);
            return children.length === 0 ? null : { kind: "group", blocks: children };
        }
    }
}

/**
 * A paragraph is plain text unless it holds images. An inline image cannot be
 * typeset on a text line here, so the paragraph is broken into the blocks that
 * make it up: text, image, text, and so on.
 */
function parseFlow(
    element: HTMLElement,
    nodes: readonly Node[] = Array.from(element.childNodes)
): Block | null {
    const images = nodes.flatMap((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return [];
        const child = node as HTMLElement;
        const tagName = child.tagName.toUpperCase();
        return [
            ...(tagName === "IMG" || tagName === "SVG" ? [child] : []),
            ...Array.from(child.querySelectorAll("img, svg"))
        ];
    });
    const containsNestedBlocks = nodes.some(
        (node) => node.nodeType === Node.ELEMENT_NODE &&
            (isBlockTag((node as HTMLElement).tagName) || /^H[1-6]$/.test((node as HTMLElement).tagName))
    );
    if (images.length === 0 && !containsNestedBlocks) {
        const runs = inlineRuns(element, nodes);
        return runs.length === 0 ? null : { kind: "paragraph", runs };
    }

    const blocks: Block[] = [];
    let pending: Run[] = [];

    const flush = (): void => {
        if (pending.length === 0) {
            return;
        }
        blocks.push({ kind: "paragraph", runs: pending });
        pending = [];
    };

    const walk = (children: readonly Node[]): void => {
        for (const child of children) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = collapse(child.textContent ?? "");
                if (text.length > 0) {
                    pending.push({ text, bold: false, italic: false, mono: false });
                }
                continue;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) {
                continue;
            }
            const childElement = child as HTMLElement;
            if (SKIP_TAGS.has(childElement.tagName)) {
                continue;
            }
            const tagName = childElement.tagName.toUpperCase();
            if (tagName === "IMG") {
                const image = imageBlock(childElement as HTMLImageElement);
                if (image === null) {
                    continue;
                }
                flush();
                blocks.push(image);
                continue;
            }
            if (tagName === "SVG") {
                const diagram = svgBlock(childElement as unknown as SVGSVGElement);
                if (diagram !== null) {
                    flush();
                    blocks.push(diagram);
                }
                continue;
            }
            if (tagName === "BR") {
                flush();
                continue;
            }
            if (NO_TEXT_TAGS.has(childElement.tagName)) {
                continue;
            }
            if (isBlockTag(childElement.tagName)) {
                const nested = parseBlock(childElement);
                if (nested !== null) {
                    flush();
                    blocks.push(nested);
                }
                continue;
            }
            for (const run of inlineRuns(childElement)) {
                pending.push(run);
            }
        }
    };

    walk(nodes);
    flush();
    if (blocks.length === 0) {
        return null;
    }
    return blocks.length === 1 && blocks[0] !== undefined ? blocks[0] : { kind: "group", blocks };
}

/** Tight list items contain inline children directly instead of a paragraph wrapper. */
function parseListItem(item: HTMLElement): Block[] {
    const blocks: Block[] = [];
    let inlineNodes: Node[] = [];

    const flushInline = (): void => {
        if (inlineNodes.length === 0) return;
        const block = parseFlow(item, inlineNodes);
        if (block !== null) blocks.push(block);
        inlineNodes = [];
    };

    for (const child of Array.from(item.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && isBlockTag((child as HTMLElement).tagName)) {
            flushInline();
            const block = parseBlock(child);
            if (block !== null) blocks.push(block);
        } else {
            inlineNodes.push(child);
        }
    }
    flushInline();
    return blocks;
}

function isBlockTag(tag: string): boolean {
    return (
        /^H[1-6]$/.test(tag) ||
        tag === "P" ||
        tag === "DIV" ||
        tag === "PRE" ||
        tag === "BLOCKQUOTE" ||
        tag === "UL" ||
        tag === "OL" ||
        tag === "TABLE" ||
        tag === "FIGURE" ||
        tag === "SECTION" ||
        tag === "ARTICLE" ||
        tag === "ASIDE" ||
        tag === "MAIN" ||
        tag === "HEADER" ||
        tag === "FOOTER" ||
        tag === "NAV"
    );
}

function imageBlock(image: HTMLImageElement): Block | null {
    const src = image.currentSrc || image.src;
    if (src.length === 0) {
        return null;
    }
    return {
        kind: "image",
        src,
        alt: image.alt,
        width: image.naturalWidth,
        height: image.naturalHeight
    };
}

function svgBlock(svg: SVGSVGElement): Block | null {
    const markup = new XMLSerializer().serializeToString(svg);
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    const viewBox = svg
        .getAttribute("viewBox")
        ?.split(/[\s,]+/)
        .map(Number);
    const width = parseSvgLength(svg.getAttribute("width")) ?? viewBox?.[2] ?? 600;
    const height = parseSvgLength(svg.getAttribute("height")) ?? viewBox?.[3] ?? 360;
    const embeddedHtml = svg.querySelector("foreignObject") !== null;
    const alt = embeddedHtml
        ? "Embedded HTML diagram; see the editor preview."
        : (svg.getAttribute("aria-label") ?? "Diagram");
    return { kind: "image", src, alt, width, height };
}

function parseSvgLength(value: string | null): number | null {
    if (value === null) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTable(element: HTMLElement): Block | null {
    const rows: Run[][][] = [];
    for (const row of Array.from(element.querySelectorAll("tr"))) {
        const cells: Run[][] = [];
        for (const cell of Array.from(row.children) as HTMLElement[]) {
            if (cell.tagName !== "TD" && cell.tagName !== "TH") {
                continue;
            }
            cells.push(inlineRuns(cell));
        }
        if (cells.length > 0) {
            rows.push(cells);
        }
    }
    if (rows.length === 0) {
        return null;
    }
    const firstRowIsHeader = element.querySelector("th") !== null;
    const head = firstRowIsHeader ? (rows[0] ?? []) : [];
    const body = firstRowIsHeader ? rows.slice(1) : rows;
    return { kind: "table", head, body };
}

function inlineRuns(
    root: HTMLElement,
    nodes: readonly Node[] = Array.from(root.childNodes)
): Run[] {
    const runs: Run[] = [];
    collectNodes(nodes, { bold: false, italic: false, mono: false }, undefined);
    return runs;

    function collect(
        node: Node,
        style: { bold: boolean; italic: boolean; mono: boolean },
        link: string | undefined
    ): void {
        collectNodes(Array.from(node.childNodes), style, link);
    }

    function collectNodes(
        children: readonly Node[],
        style: { bold: boolean; italic: boolean; mono: boolean },
        link: string | undefined
    ): void {
        for (const child of children) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = collapse(child.textContent ?? "");
                if (text.length > 0) {
                    runs.push({
                        text,
                        bold: style.bold,
                        italic: style.italic,
                        mono: style.mono,
                        link
                    });
                }
                continue;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) {
                continue;
            }
            const element = child as HTMLElement;
            const tag = element.tagName;
            if (SKIP_TAGS.has(tag)) {
                continue;
            }
            if (tag === "BR") {
                runs.push({
                    text: "\n",
                    bold: style.bold,
                    italic: style.italic,
                    mono: style.mono,
                    link
                });
                continue;
            }
            if (tag === "IMG") {
                // A cell or a heading keeps the alt text, since there is no room
                // to typeset the image next to words.
                const image = element as HTMLImageElement;
                const label = image.alt.length > 0 ? `[${image.alt}]` : "[image]";
                runs.push({
                    text: label,
                    bold: style.bold,
                    italic: style.italic,
                    mono: style.mono,
                    link
                });
                continue;
            }
            if (element.classList.contains("katex")) {
                const visible = element.querySelector<HTMLElement>(".katex-html");
                const annotation = element.querySelector(
                    "annotation[encoding='application/x-tex']"
                );
                const text = (visible?.textContent ?? annotation?.textContent ?? "")
                    .replace(/[\u200b\u2061\u2062\u2063]/g, "")
                    .replace(/\s+/g, " ")
                    .trim();
                const math = readMathLayout(element);
                if (math !== null) {
                    runs.push({
                        text,
                        bold: style.bold,
                        italic: style.italic,
                        mono: style.mono,
                        link,
                        searchableText: math.searchableText,
                        math
                    });
                } else if (text.length > 0) {
                    runs.push({
                        text,
                        bold: style.bold,
                        italic: style.italic,
                        mono: style.mono,
                        link,
                        searchableText: annotation?.textContent ?? text
                    });
                }
                continue;
            }
            if (isBlockTag(tag)) {
                for (const run of inlineRuns(element)) {
                    runs.push(run);
                }
                continue;
            }
            collect(
                element,
                {
                    bold: style.bold || tag === "B" || tag === "STRONG",
                    italic: style.italic || tag === "I" || tag === "EM",
                    mono: style.mono || tag === "CODE"
                },
                tag === "A" ? (element.getAttribute("href") ?? link) : link
            );
        }
    }
}

function collapse(text: string): string {
    return text.replace(/\s+/g, " ");
}
