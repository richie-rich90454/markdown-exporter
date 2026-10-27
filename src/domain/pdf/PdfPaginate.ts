import {
    bodySizePt,
    codeSizePt,
    headingSizePt,
    marginPt,
    pageHeightPt,
    pageWidthPt,
    type PageSetup
} from "../PageSetup";
import { font, textWidth, type FontKey } from "./PdfMetrics";
import type { Block, DrawOp, ImageRef, LaidOut, Run } from "./PdfLayout";

const INK = 0;
const MUTED = 0.42;
const HAIRLINE = 0.894;
const CODE_BG = 0.969;
const CODE_PAD = 6;
const QUOTE_INDENT = 14;
const QUOTE_BAR = 2;
const LIST_GUTTER = 18;
const CELL_PAD = 5;
const RULE_GAP = 6;
const FOOTER_SIZE = 9;
const PLACEHOLDER_WIDTH = 160;
const PLACEHOLDER_HEIGHT = 90;

interface Area {
    readonly x: number;
    readonly width: number;
}

interface Piece {
    readonly text: string;
    readonly key: FontKey;
    readonly size: number;
    readonly link?: string | undefined;
    readonly searchableText?: string | undefined;
    readonly math?: Run["math"] | undefined;
    readonly mathScale?: number | undefined;
}

interface Line {
    readonly pieces: readonly Piece[];
    readonly height: number;
}

class Cursor {
    readonly pages: DrawOp[][] = [[]];
    page = 0;
    y: number;
    readonly images: ImageRef[] = [];
    readonly fonts = new Set<FontKey>();
    readonly mathFonts = new Set<string>();
    lastText: { readonly page: number; readonly y: number } | undefined;

    constructor(readonly setup: PageSetup) {
        this.y = this.top;
    }

    get top(): number {
        return pageHeightPt(this.setup) - marginPt(this.setup);
    }

    get bottom(): number {
        return marginPt(this.setup);
    }

    get outer(): Area {
        return {
            x: marginPt(this.setup),
            width: pageWidthPt(this.setup) - 2 * marginPt(this.setup)
        };
    }

    newPage(): void {
        this.page += 1;
        if (this.pages[this.page] === undefined) {
            this.pages.push([]);
        }
        this.y = this.top;
        this.lastText = undefined;
    }

    emit(op: DrawOp): void {
        if (op.kind === "text") {
            this.fonts.add(op.font);
            this.lastText = { page: this.page, y: op.y };
        } else if (op.kind === "math") {
            for (const glyph of op.math.glyphs) this.mathFonts.add(glyph.font);
            this.lastText = { page: this.page, y: op.y };
        }
        this.pages[this.page]?.push(op);
    }

    registerImage(src: string, alt: string, width: number, height: number): number {
        const existing = this.images.findIndex((entry) => entry.src === src);
        if (existing >= 0) {
            return existing;
        }
        this.images.push({ src, alt, width, height });
        return this.images.length - 1;
    }
}

export function paginate(
    blocks: readonly Block[],
    setup: PageSetup,
    embeds: ReadonlyMap<string, boolean>
): LaidOut {
    const cursor = new Cursor(setup);

    blocks.forEach((block, index) => {
        place(block, cursor, cursor.outer, embeds, index === 0 || cursor.y >= cursor.top);
    });

    const pages = cursor.pages.map((ops, index) => [
        ...ops,
        footer(index + 1, cursor.pages.length, setup)
    ]);
    return {
        pages,
        images: cursor.images,
        fonts: [...cursor.fonts],
        mathFonts: [...cursor.mathFonts]
    };
}

function footer(page: number, total: number, setup: PageSetup): DrawOp {
    const key = font(false, false, false, setup.fontFamily);
    const width = textWidth(`${page} / ${total}`, key, FOOTER_SIZE);
    return {
        kind: "text",
        x: (pageWidthPt(setup) - width) / 2,
        y: marginPt(setup) / 2,
        text: `${page} / ${total}`,
        font: key,
        size: FOOTER_SIZE,
        gray: MUTED
    };
}

function place(
    block: Block,
    cursor: Cursor,
    area: Area,
    embeds: ReadonlyMap<string, boolean>,
    firstOnPage = false
): void {
    if (block.kind === "pageBreak") {
        if (cursor.y < cursor.top) cursor.newPage();
        return;
    }
    // Blocks keep their own breathing room, the way a styled document does,
    // except at the top of a page where a gap would just waste space.
    if (!firstOnPage) {
        cursor.y -= gapFor(block, cursor);
    }
    switch (block.kind) {
        case "group": {
            block.blocks.forEach((child, index) => {
                place(child, cursor, area, embeds, index === 0 || cursor.y >= cursor.top);
            });
            return;
        }
        case "quote": {
            const startPage = cursor.page;
            const startY = cursor.y;
            const inner: Area = { x: area.x + QUOTE_INDENT, width: area.width - QUOTE_INDENT };
            block.blocks.forEach((child, index) => {
                place(child, cursor, inner, embeds, index === 0 || cursor.y >= cursor.top);
            });
            // The bar stops at the last line the quote actually drew instead of
            // wherever the cursor came to rest.
            const end = cursor.lastText;
            const endY = end !== undefined && end.page === cursor.page ? end.y : cursor.y;
            drawQuoteBar(cursor, area, startPage, startY, cursor.page, endY);
            return;
        }
        case "heading": {
            const size = headingSizePt(cursor.setup, block.level);
            const lines = wrap(block.runs, area.width, cursor, size, true);
            const height = lines.reduce((total, line) => total + line.height, 0);
            const bodyLine = bodySizePt(cursor.setup) * cursor.setup.lineHeight;
            // A heading alone at the foot of a page reads as a mistake, so it
            // moves when not even one body line fits under it.
            if (cursor.y - height - bodyLine < cursor.bottom && cursor.y < cursor.top) {
                cursor.newPage();
            }
            drawLines(lines, area.x, cursor);
            return;
        }
        case "paragraph": {
            const size = bodySizePt(cursor.setup);
            flow(wrap(block.runs, area.width, cursor, size, false), area.x, cursor);
            return;
        }
        case "math": {
            placeMath(block.math, cursor, area);
            return;
        }
        case "code": {
            placeCode(block.lines, cursor, area);
            return;
        }
        case "list": {
            placeList(block.ordered, block.items, cursor, area, embeds);
            return;
        }
        case "table": {
            placeTable(block.head, block.body, cursor, area);
            return;
        }
        case "image": {
            placeImage(block.src, block.alt, block.width, block.height, cursor, area, embeds);
            return;
        }
        case "rule": {
            cursor.emit({
                kind: "line",
                x1: area.x,
                y1: cursor.y,
                x2: area.x + area.width,
                y2: cursor.y,
                width: 0.5,
                gray: HAIRLINE
            });
            cursor.y -= RULE_GAP;
            return;
        }
    }
}

// Space above a block, as a share of a body line. Headings lean back, list
// items barely separate at all.
function gapFor(block: Block, cursor: Cursor): number {
    const line = bodySizePt(cursor.setup) * cursor.setup.lineHeight;
    switch (block.kind) {
        case "heading":
            return line * (block.level <= 2 ? 1.1 : 0.85);
        case "paragraph":
        case "group":
            return line * 0.55;
        case "math":
            return line * 0.75;
        case "code":
        case "table":
        case "image":
        case "quote":
            return line * 0.75;
        case "rule":
            return line * 0.75;
        case "pageBreak":
            return 0;
        case "list":
            return line * 0.6;
    }
}

function drawQuoteBar(
    cursor: Cursor,
    area: Area,
    startPage: number,
    startY: number,
    endPage: number,
    endY: number
): void {
    for (let page = startPage; page <= endPage; page += 1) {
        cursor.pages[page]?.push({
            kind: "line",
            x1: area.x,
            y1: page === startPage ? startY : cursor.top,
            x2: area.x,
            y2: page === endPage ? endY : cursor.bottom,
            width: QUOTE_BAR,
            gray: HAIRLINE
        });
    }
}

function flow(lines: readonly Line[], x: number, cursor: Cursor): void {
    let index = 0;
    while (index < lines.length) {
        const available = cursor.y - cursor.bottom;
        let count = 0;
        let used = 0;
        while (index + count < lines.length) {
            const line = lines[index + count];
            if (line === undefined || used + line.height > available) break;
            used += line.height;
            count += 1;
        }
        if (count === 0) {
            if (cursor.y < cursor.top) {
                cursor.newPage();
                continue;
            }
            // A single inline formula may be taller than the page. wrap() caps
            // its scale to the printable height, so this is only a safeguard.
            const line = lines[index];
            if (line === undefined) break;
            count = 1;
            used = line.height;
        }
        let offset = 0;
        for (let step = 0; step < count; step += 1) {
            const line = lines[index + step];
            if (line !== undefined) {
                offset += line.height;
                drawLine(line, x, cursor.y - offset, cursor);
            }
        }
        cursor.y -= used;
        index += count;
        if (index < lines.length) {
            cursor.newPage();
        }
    }
}

function drawLines(lines: readonly Line[], x: number, cursor: Cursor): void {
    let y = cursor.y;
    for (const line of lines) {
        y -= line.height;
        drawLine(line, x, y, cursor);
    }
    cursor.y = y;
}

// Consecutive words in the same style are written as one string, so the
// content stream stays close to a word count instead of one show per word.
function drawLine(line: Line, x: number, baseline: number, cursor: Cursor): void {
    let position = x;
    let groupStart = x;
    let pending: Piece | undefined;
    let pendingWidth = 0;

    const flush = (): void => {
        if (pending === undefined) {
            return;
        }
        cursor.emit({
            kind: "text",
            x: groupStart,
            y: baseline,
            text: pending.text,
            font: pending.key,
            size: pending.size,
            gray: INK
        });
        if (pending.searchableText !== undefined) {
            cursor.emit({
                kind: "text",
                x: groupStart,
                y: baseline,
                text: pending.searchableText,
                font: pending.key,
                size: pending.size,
                gray: INK,
                renderMode: "invisible"
            });
        }
        if (pending.link !== undefined) {
            cursor.emit({
                kind: "rect",
                x: groupStart,
                y: baseline - 1.5,
                w: pendingWidth,
                h: 0.6,
                gray: INK
            });
            cursor.emit({
                kind: "link",
                x: groupStart,
                y: baseline - 1.5,
                w: pendingWidth,
                h: line.height,
                uri: pending.link
            });
        }
        pending = undefined;
        pendingWidth = 0;
    };

    for (const piece of line.pieces) {
        if (piece.math !== undefined) {
            flush();
            const scale = piece.mathScale ?? 1;
            cursor.emit({
                kind: "math",
                x: position,
                y: baseline + piece.math.verticalAlign * scale,
                scale,
                math: piece.math
            });
            position += piece.math.width * scale;
            groupStart = position;
            continue;
        }
        const width = textWidth(piece.text, piece.key, piece.size);
        const continues =
            pending !== undefined &&
            pending.key === piece.key &&
            pending.size === piece.size &&
            pending.link === piece.link &&
            pending.searchableText === undefined &&
            piece.searchableText === undefined;
        if (pending !== undefined && !continues) {
            flush();
        }
        if (pending === undefined) {
            groupStart = position;
            pending = {
                text: piece.text,
                key: piece.key,
                size: piece.size,
                link: piece.link,
                searchableText: piece.searchableText
            };
            pendingWidth = width;
        } else {
            pending = {
                text: `${pending.text}${piece.text}`,
                key: pending.key,
                size: pending.size,
                link: pending.link,
                searchableText: pending.searchableText
            };
            pendingWidth += width;
        }
        position += width;
    }
    flush();
}

function wrap(
    runs: readonly Run[],
    width: number,
    cursor: Cursor,
    size: number,
    bold: boolean
): Line[] {
    const family = cursor.setup.fontFamily;
    const atoms: (Piece | null)[] = [];
    for (const run of runs) {
        const key = font(run.bold || bold, run.italic, run.mono, family);
        if (run.math !== undefined) {
            const fontScale = size / run.math.baseFontSize;
            const widthScale = run.math.width > 0 ? width / (run.math.width * fontScale) : 1;
            const printableHeight = pageHeightPt(cursor.setup) - 2 * marginPt(cursor.setup);
            const mathHeight = run.math.height - run.math.verticalAlign;
            const heightScale = mathHeight > 0 ? printableHeight / mathHeight : fontScale;
            const mathScale = Math.min(fontScale, widthScale, heightScale);
            atoms.push({
                text: "",
                key,
                size,
                link: run.link,
                searchableText: run.math.searchableText,
                math: run.math,
                mathScale
            });
            continue;
        }
        const segments = run.text.split("\n");
        for (let index = 0; index < segments.length; index += 1) {
            if (index > 0) {
                atoms.push(null);
            }
            let searchableText = index === 0 ? run.searchableText : undefined;
            for (const word of (segments[index] ?? "").split(" ")) {
                if (word.length > 0) {
                    atoms.push({ text: word, key, size, link: run.link, searchableText });
                    searchableText = undefined;
                    atoms.push({ text: " ", key, size, link: run.link });
                }
            }
        }
    }
    while (atoms.length > 0 && atoms[atoms.length - 1]?.text === " ") {
        atoms.pop();
    }

    const lines: Line[] = [];
    let current: Piece[] = [];
    let used = 0;

    const flush = (): void => {
        while (current.length > 0 && current[current.length - 1]?.text === " ") {
            current.pop();
        }
        const mathHeight = current.reduce((height, piece) => {
            if (piece.math === undefined) return height;
            const scale = piece.mathScale ?? 1;
            return Math.max(height, piece.math.height * scale - piece.math.verticalAlign * scale);
        }, 0);
        lines.push({
            pieces: current,
            height: Math.max(size * cursor.setup.lineHeight, mathHeight)
        });
        current = [];
        used = 0;
    };

    for (const atom of atoms) {
        if (atom === null) {
            flush();
            continue;
        }
        const atomWidth = pieceWidth(atom);
        if (atom.text === " ") {
            if (current.length === 0 || used + atomWidth > width) {
                continue;
            }
            current.push(atom);
            used += atomWidth;
            continue;
        }
        if (used + atomWidth > width && current.length > 0) {
            flush();
        }
        if (atomWidth > width && atom.math === undefined) {
            let searchableText = atom.searchableText;
            for (const char of atom.text) {
                const charWidth = textWidth(char, atom.key, atom.size);
                if (used + charWidth > width && current.length > 0) {
                    flush();
                }
                current.push({
                    text: char,
                    key: atom.key,
                    size: atom.size,
                    link: atom.link,
                    searchableText
                });
                searchableText = undefined;
                used += charWidth;
            }
            continue;
        }
        current.push(atom);
        used += atomWidth;
    }
    if (current.length > 0 || lines.length === 0) {
        flush();
    }
    return lines;
}

function pieceWidth(piece: Piece): number {
    if (piece.math !== undefined) return piece.math.width * (piece.mathScale ?? 1);
    return textWidth(piece.text, piece.key, piece.size);
}

function lineAscent(line: Line, fallbackSize: number): number {
    return line.pieces.reduce((ascent, piece) => {
        if (piece.math === undefined) return Math.max(ascent, piece.size * 0.85);
        const scale = piece.mathScale ?? 1;
        return Math.max(ascent, (piece.math.height + piece.math.verticalAlign) * scale);
    }, fallbackSize * 0.85);
}

function lineDescent(line: Line, fallbackSize: number): number {
    return line.pieces.reduce((descent, piece) => {
        if (piece.math === undefined) return Math.max(descent, piece.size * 0.2);
        const scale = piece.mathScale ?? 1;
        return Math.max(descent, -piece.math.verticalAlign * scale);
    }, fallbackSize * 0.2);
}

function placeMath(math: NonNullable<Run["math"]>, cursor: Cursor, area: Area): void {
    const bodySize = bodySizePt(cursor.setup);
    const fontScale = bodySize / math.baseFontSize;
    const widthScale = math.width > 0 ? area.width / (math.width * fontScale) : 1;
    let scale = Math.min(fontScale, widthScale);
    let height = math.height * scale;
    let available = cursor.y - cursor.bottom;
    if (height > available && cursor.y < cursor.top) {
        cursor.newPage();
        available = cursor.y - cursor.bottom;
    }
    // A single equation can be taller than a page. Shrink it uniformly so its
    // glyphs and rules stay together inside the printable area.
    if (height > available && height > 0) {
        scale *= available / height;
        height = available;
    }
    const width = math.width * scale;
    const x = area.x + Math.max(0, (area.width - width) / 2);
    const y = cursor.y - height;
    cursor.emit({ kind: "math", x, y, scale, math });
    cursor.y = y;
}

// A code block longer than a page continues on the next one, and each part
// keeps its shaded background.
function placeCode(lines: readonly string[], cursor: Cursor, area: Area): void {
    const setup = cursor.setup;
    const size = codeSizePt(setup);
    const key = font(false, false, true, setup.fontFamily);
    const rows: string[] = [];
    for (const line of lines) {
        let carry = "";
        for (const char of line) {
            carry += char;
            if (textWidth(carry, key, size) > area.width - 2 * CODE_PAD) {
                rows.push(carry.slice(0, -1));
                carry = char === " " ? "" : char;
            }
        }
        rows.push(carry);
    }
    const perLine = size * setup.lineHeight;

    let index = 0;
    while (index < rows.length) {
        let room = Math.floor((cursor.y - cursor.bottom - CODE_PAD) / perLine);
        if (room <= 0) {
            if (cursor.y < cursor.top) {
                cursor.newPage();
                continue;
            }
            room = 1;
        }
        const count = Math.min(room, rows.length - index);
        const height = count * perLine + 2 * CODE_PAD;
        const top = cursor.y;
        cursor.emit({
            kind: "rect",
            x: area.x,
            y: top - height,
            w: area.width,
            h: height,
            gray: CODE_BG
        });
        let y = top - CODE_PAD - size * 0.85;
        for (let step = 0; step < count; step += 1) {
            const row = rows[index + step];
            if (row !== undefined && row.length > 0) {
                cursor.emit({
                    kind: "text",
                    x: area.x + CODE_PAD,
                    y,
                    text: row,
                    font: key,
                    size,
                    gray: INK
                });
            }
            y -= perLine;
        }
        cursor.y = top - height;
        index += count;
        if (index < rows.length) {
            cursor.newPage();
        }
    }
}

function placeList(
    ordered: boolean,
    items: readonly (readonly Block[])[],
    cursor: Cursor,
    area: Area,
    embeds: ReadonlyMap<string, boolean>
): void {
    const size = bodySizePt(cursor.setup);
    const marker = font(false, false, false, cursor.setup.fontFamily);
    const inner: Area = { x: area.x + LIST_GUTTER, width: area.width - LIST_GUTTER };
    const itemGap = size * cursor.setup.lineHeight * 0.2;
    let number = 1;
    items.forEach((item, index) => {
        if (index > 0) {
            cursor.y -= itemGap;
        }
        const start = cursor.y;
        const firstPage = cursor.page;
        const previousPageLengths = cursor.pages.map((page) => page.length);
        item.forEach((block, blockIndex) => {
            place(block, cursor, inner, embeds, blockIndex === 0 || cursor.y >= cursor.top);
        });
        let markerPage = firstPage;
        let markerY = start - size * cursor.setup.lineHeight;
        for (let page = firstPage; page <= cursor.page; page += 1) {
            const operations = cursor.pages[page] ?? [];
            const offset = page === firstPage ? (previousPageLengths[page] ?? 0) : 0;
            const firstLine = operations
                .slice(offset)
                .find((operation) => operation.kind === "text" || operation.kind === "math");
            if (firstLine === undefined) continue;
            markerPage = page;
            markerY =
                firstLine.kind === "math"
                    ? firstLine.y - firstLine.math.verticalAlign * firstLine.scale
                    : firstLine.y;
            break;
        }
        const markerOp: Extract<DrawOp, { kind: "text" }> = {
            kind: "text",
            x: area.x,
            y: markerY,
            text: ordered ? `${number}.` : "\u2022",
            font: marker,
            size,
            gray: INK
        };
        cursor.pages[markerPage]?.push(markerOp);
        cursor.fonts.add(marker);
        number += 1;
    });
}

function placeTable(
    head: readonly (readonly Run[])[],
    body: readonly (readonly (readonly Run[])[])[],
    cursor: Cursor,
    area: Area
): void {
    const setup = cursor.setup;
    const size = codeSizePt(setup) + 0.5;
    const columns = Math.max(head.length, ...body.map((row) => row.length), 1);
    const weights: number[] = [];
    for (let column = 0; column < columns; column += 1) {
        const widest = Math.max(
            30,
            ...body.map((row) => maxCellWidth(row[column] ?? [], cursor, size)),
            ...head.map((row) => maxCellWidth(row ?? [], cursor, size))
        );
        weights.push(Number.isFinite(widest) ? widest : 30);
    }
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const widths = weights.map((weight) => (area.width * weight) / total);
    const fullWidth = widths.reduce((sum, width) => sum + width, 0);

    const prepareRow = (cells: readonly (readonly Run[])[], strong: boolean) => {
        const runs = cells.map((cell) => cell.map((run) => ({ ...run, bold: strong || run.bold })));
        const linesPerCell = runs.map((cell, column) =>
            wrap(cell, (widths[column] ?? 40) - 2 * CELL_PAD, cursor, size, false)
        );
        const contentHeight = Math.max(
            size * setup.lineHeight,
            ...linesPerCell.map((lines) => {
                if (lines.length === 0) return 0;
                const first = lines[0];
                const last = lines[lines.length - 1];
                if (first === undefined || last === undefined) return 0;
                const stackedHeight = lines
                    .slice(1)
                    .reduce((height, line) => height + line.height, 0);
                const totalHeight = lines.reduce((height, line) => height + line.height, 0);
                return Math.max(
                    totalHeight,
                    lineAscent(first, size) + stackedHeight + lineDescent(last, size)
                );
            })
        );
        return {
            linesPerCell,
            firstAscent: linesPerCell.map((lines) => {
                const first = lines[0];
                return first === undefined ? size * 0.85 : lineAscent(first, size);
            }),
            height: contentHeight + 2 * CELL_PAD
        };
    };

    // Every row draws its own top edge; the bottom edge is only closed when the
    // next row lands on another page or the table ends.
    let openBottom: number | undefined;

    const closeRow = (): void => {
        if (openBottom === undefined) {
            return;
        }
        cursor.emit({
            kind: "line",
            x1: area.x,
            y1: openBottom,
            x2: area.x + fullWidth,
            y2: openBottom,
            width: 0.5,
            gray: HAIRLINE
        });
        openBottom = undefined;
    };

    const drawRow = (row: ReturnType<typeof prepareRow>): void => {
        if (row.linesPerCell.length === 0) {
            return;
        }
        const rowHeight = row.height;
        const top = cursor.y;
        let x = area.x;
        for (let column = 0; column < columns; column += 1) {
            const width = widths[column] ?? 40;
            const lines = row.linesPerCell[column] ?? [];
            let y = top - CELL_PAD - (row.firstAscent[column] ?? size * 0.85);
            for (const [index, line] of lines.entries()) {
                if (index > 0) y -= line.height;
                drawLine(line, x + CELL_PAD, y, cursor);
            }
            if (column > 0) {
                cursor.emit({
                    kind: "line",
                    x1: x,
                    y1: top,
                    x2: x,
                    y2: top - rowHeight,
                    width: 0.5,
                    gray: HAIRLINE
                });
            }
            x += width;
        }
        cursor.emit({
            kind: "line",
            x1: area.x,
            y1: top,
            x2: x,
            y2: top,
            width: 0.5,
            gray: HAIRLINE
        });
        cursor.y = top - rowHeight;
        openBottom = top - rowHeight;
    };

    // The header row belongs above the body on every page the table reaches,
    // not only after a break, and it repeats after each one.
    let headerDrawn = false;
    const headerRow = prepareRow(head, true);
    const drawHeader = (): void => {
        if (headerDrawn || head.length === 0) {
            return;
        }
        if (cursor.y - headerRow.height < cursor.bottom && cursor.y < cursor.top) {
            closeRow();
            cursor.newPage();
        }
        drawRow(headerRow);
        headerDrawn = true;
    };

    for (const row of body) {
        const preparedRow = prepareRow(row, false);
        const pendingHeader = !headerDrawn && head.length > 0 ? headerRow.height : 0;
        if (
            cursor.y - preparedRow.height - pendingHeader < cursor.bottom &&
            cursor.y < cursor.top
        ) {
            closeRow();
            cursor.newPage();
            headerDrawn = false;
        }
        drawHeader();
        drawRow(preparedRow);
    }
    drawHeader();
    closeRow();
}

function maxCellWidth(cell: readonly Run[], cursor: Cursor, size: number): number {
    const key = font(false, false, false, cursor.setup.fontFamily);
    return cell.reduce((widest, run) => Math.max(widest, textWidth(run.text, key, size)), 0);
}

// An image whose bytes could not be read becomes a bordered box with its alt
// text, which is what a browser shows for a broken image.
function placeImage(
    src: string,
    alt: string,
    width: number,
    height: number,
    cursor: Cursor,
    area: Area,
    embeds: ReadonlyMap<string, boolean>
): void {
    const decodable = width > 0 && height > 0;
    const embeddable = decodable && embeds.get(src) === true;
    const drawWidth = decodable ? Math.min(width, area.width) : PLACEHOLDER_WIDTH;
    const drawHeight = decodable ? (height / width) * drawWidth : PLACEHOLDER_HEIGHT;

    if (cursor.y - drawHeight < cursor.bottom && cursor.y < cursor.top) {
        cursor.newPage();
    }
    const top = cursor.y;

    if (embeddable) {
        cursor.emit({
            kind: "image",
            x: area.x,
            y: top - drawHeight,
            w: drawWidth,
            h: drawHeight,
            index: cursor.registerImage(src, alt, width, height)
        });
    } else {
        cursor.emit({
            kind: "rect",
            x: area.x,
            y: top - drawHeight,
            w: drawWidth,
            h: drawHeight,
            gray: HAIRLINE
        });
        const lines = wrap(
            [{ text: alt.length > 0 ? alt : "Image", bold: false, italic: false, mono: false }],
            drawWidth - 2 * CELL_PAD,
            cursor,
            FOOTER_SIZE,
            false
        );
        const blockHeight = lines.length * FOOTER_SIZE * cursor.setup.lineHeight;
        let y = top - (drawHeight - blockHeight) / 2 - FOOTER_SIZE * 0.85;
        for (const line of lines) {
            drawLine(line, area.x + CELL_PAD, y, cursor);
            y -= FOOTER_SIZE * cursor.setup.lineHeight;
        }
    }
    cursor.y = top - drawHeight;
}
