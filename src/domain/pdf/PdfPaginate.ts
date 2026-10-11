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

    for (const block of blocks) {
        place(block, cursor, cursor.outer, embeds);
    }

    const pages = cursor.pages.map((ops, index) => [
        ...ops,
        footer(index + 1, cursor.pages.length, setup)
    ]);
    return { pages, images: cursor.images, fonts: [...cursor.fonts] };
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
    embeds: ReadonlyMap<string, boolean>
): void {
    switch (block.kind) {
        case "group": {
            for (const child of block.blocks) {
                place(child, cursor, area, embeds);
            }
            return;
        }
        case "quote": {
            const startPage = cursor.page;
            const startY = cursor.y;
            const inner: Area = { x: area.x + QUOTE_INDENT, width: area.width - QUOTE_INDENT };
            for (const child of block.blocks) {
                place(child, cursor, inner, embeds);
            }
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
            const height = lines.length * size * cursor.setup.lineHeight;
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
            flow(wrap(block.runs, area.width, cursor, size, false), size, area.x, cursor);
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

function flow(lines: readonly Line[], size: number, x: number, cursor: Cursor): void {
    let index = 0;
    while (index < lines.length) {
        const perLine = size * cursor.setup.lineHeight;
        let fits = Math.floor((cursor.y - cursor.bottom) / perLine);
        if (fits <= 0) {
            if (cursor.y >= cursor.top) {
                fits = 1;
            } else {
                cursor.newPage();
                continue;
            }
        }
        const count = Math.min(fits, lines.length - index);
        for (let step = 0; step < count; step += 1) {
            const line = lines[index + step];
            if (line !== undefined) {
                drawLine(line, x, cursor.y - (step + 1) * perLine, cursor);
            }
        }
        cursor.y -= count * perLine;
        index += count;
        if (index < lines.length) {
            cursor.newPage();
        }
    }
}

function drawLines(lines: readonly Line[], x: number, cursor: Cursor): void {
    const size = lines[0]?.pieces[0]?.size ?? bodySizePt(cursor.setup);
    let y = cursor.y;
    for (const line of lines) {
        y -= size * cursor.setup.lineHeight;
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
        const width = textWidth(piece.text, piece.key, piece.size);
        const continues =
            pending !== undefined &&
            pending.key === piece.key &&
            pending.size === piece.size &&
            pending.link === piece.link;
        if (pending !== undefined && !continues) {
            flush();
        }
        if (pending === undefined) {
            groupStart = position;
            pending = { text: piece.text, key: piece.key, size: piece.size, link: piece.link };
            pendingWidth = width;
        } else {
            pending = {
                text: `${pending.text}${piece.text}`,
                key: pending.key,
                size: pending.size,
                link: pending.link
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
        const segments = run.text.split("\n");
        for (let index = 0; index < segments.length; index += 1) {
            if (index > 0) {
                atoms.push(null);
            }
            for (const word of (segments[index] ?? "").split(" ")) {
                if (word.length > 0) {
                    atoms.push({ text: word, key, size, link: run.link });
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
        lines.push({ pieces: current, height: size * cursor.setup.lineHeight });
        current = [];
        used = 0;
    };

    for (const atom of atoms) {
        if (atom === null) {
            flush();
            continue;
        }
        const atomWidth = textWidth(atom.text, atom.key, atom.size);
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
        if (atomWidth > width) {
            for (const char of atom.text) {
                const charWidth = textWidth(char, atom.key, atom.size);
                if (used + charWidth > width && current.length > 0) {
                    flush();
                }
                current.push({ text: char, key: atom.key, size: atom.size, link: atom.link });
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
    let number = 1;
    for (const item of items) {
        const start = cursor.y;
        for (const block of item) {
            place(block, cursor, inner, embeds);
        }
        cursor.emit({
            kind: "text",
            x: area.x,
            y: start - size * cursor.setup.lineHeight,
            text: ordered ? `${number}.` : "\u2022",
            font: marker,
            size,
            gray: INK
        });
        number += 1;
    }
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

    const drawRow = (cells: readonly (readonly Run[])[], strong: boolean): void => {
        if (cells.length === 0) {
            return;
        }
        const runs = cells.map((cell) => cell.map((run) => ({ ...run, bold: strong || run.bold })));
        const linesPerCell = runs.map((cell, column) =>
            wrap(cell, (widths[column] ?? 40) - 2 * CELL_PAD, cursor, size, false)
        );
        const tallest = Math.max(...linesPerCell.map((lines) => lines.length), 0);
        const rowHeight = tallest * size * setup.lineHeight + 2 * CELL_PAD;
        const top = cursor.y;
        let x = area.x;
        for (let column = 0; column < columns; column += 1) {
            const width = widths[column] ?? 40;
            let y = top - CELL_PAD - size * 0.85;
            for (const line of linesPerCell[column] ?? []) {
                drawLine(line, x + CELL_PAD, y, cursor);
                y -= size * setup.lineHeight;
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

    for (const row of body) {
        if (cursor.y - (size * setup.lineHeight + 2 * CELL_PAD) < cursor.bottom) {
            closeRow();
            cursor.newPage();
            if (head.length > 0) {
                drawRow(head, true);
            }
        }
        drawRow(row, false);
    }
    if (body.length === 0 && head.length > 0) {
        drawRow(head, true);
    }
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
