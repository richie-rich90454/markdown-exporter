import type { FontKey } from "./PdfMetrics";

export interface Run {
    readonly text: string;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly mono: boolean;
    readonly link?: string | undefined;
}

export type Block =
    | { readonly kind: "heading"; readonly level: number; readonly runs: readonly Run[] }
    | { readonly kind: "paragraph"; readonly runs: readonly Run[] }
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
    | { readonly kind: "rule" };

export type DrawOp =
    | {
          readonly kind: "text";
          readonly x: number;
          readonly y: number;
          readonly text: string;
          readonly font: FontKey;
          readonly size: number;
          readonly gray: number;
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
      };

export interface ImageRef {
    readonly src: string;
    readonly alt: string;
    readonly width: number;
    readonly height: number;
}

export interface LaidOut {
    readonly pages: readonly (readonly DrawOp[])[];
    readonly images: readonly ImageRef[];
    readonly fonts: readonly FontKey[];
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
    "SVG",
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
    switch (element.tagName) {
        case "H1":
        case "H2":
        case "H3":
        case "H4":
        case "H5":
        case "H6":
            return {
                kind: "heading",
                level: Number(element.tagName.slice(1)),
                runs: inlineRuns(element)
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
                items.push(parseBlocks(item));
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
function parseFlow(element: HTMLElement): Block | null {
    const images = Array.from(element.querySelectorAll("img"));
    if (images.length === 0) {
        const runs = inlineRuns(element);
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

    const walk = (node: Node): void => {
        for (const child of Array.from(node.childNodes)) {
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
            if (childElement.tagName === "IMG") {
                const image = imageBlock(childElement as HTMLImageElement);
                if (image === null) {
                    continue;
                }
                flush();
                blocks.push(image);
                continue;
            }
            if (childElement.tagName === "BR") {
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

    walk(element);
    flush();
    if (blocks.length === 0) {
        return null;
    }
    return blocks.length === 1 && blocks[0] !== undefined ? blocks[0] : { kind: "group", blocks };
}

function isBlockTag(tag: string): boolean {
    return (
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

function inlineRuns(root: HTMLElement): Run[] {
    const runs: Run[] = [];
    collect(root, { bold: false, italic: false, mono: false }, undefined);
    return runs;

    function collect(
        node: Node,
        style: { bold: boolean; italic: boolean; mono: boolean },
        link: string | undefined
    ): void {
        for (const child of Array.from(node.childNodes)) {
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
