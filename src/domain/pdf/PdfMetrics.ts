import type { FontFamilyId } from "../PageSetup";

export interface FontKey {
    readonly family: FontFamilyId;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly mono: boolean;
}

const STACKS: Record<FontFamilyId, string> = {
    serif: '"Times New Roman", Times, serif',
    sans: "Arial, Helvetica, sans-serif",
    mono: '"Courier New", Courier, monospace'
};

const BASES: Record<FontFamilyId, readonly string[]> = {
    serif: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
    sans: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
    mono: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"]
};
// Advance widths per 1000 units for ASCII 32..126. The browser measures the
// real fonts, which are metric compatible with the base 14 fonts named below;
// these tables cover the environments without a canvas.
const TABLES: Record<FontFamilyId, readonly number[]> = {
    serif: "250 333 408 500 500 833 778 180 333 333 500 564 250 333 250 278 500 500 500 500 500 500 500 500 500 500 278 278 564 564 564 444 921 722 667 667 722 611 556 722 722 333 389 722 611 889 722 722 556 722 667 556 611 722 722 944 722 722 611 333 278 333 469 500 333 444 500 444 500 444 333 500 500 278 278 500 278 778 500 500 500 500 333 389 278 500 500 722 500 500 444 480 200 480 541"
        .split(" ")
        .map(Number),
    sans: "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584"
        .split(" ")
        .map(Number),
    mono: new Array(95).fill(600)
};

let measuringContext: CanvasRenderingContext2D | undefined;
let measured = true;

export function font(bold: boolean, italic: boolean, mono: boolean, family: FontFamilyId): FontKey {
    return { family, bold, italic, mono };
}

// The CSS stack a renderer asks the browser for; metric compatible with the
// base 14 font the PDF names, which keeps preview and export in step.
export function fontStack(key: FontKey): string {
    return STACKS[key.mono ? "mono" : key.family];
}

export function baseFont(key: FontKey): string {
    const bases = BASES[key.mono ? "mono" : key.family];
    const index = (key.bold ? 1 : 0) + (key.italic ? 2 : 0);
    return bases[index] ?? "Times-Roman";
}

function canvasContext(): CanvasRenderingContext2D | undefined {
    if (!measured) {
        return undefined;
    }
    if (measuringContext === undefined) {
        const created = document.createElement("canvas").getContext("2d");
        if (created === null) {
            measured = false;
            return undefined;
        }
        measuringContext = created;
    }
    return measuringContext;
}

export function textWidth(text: string, key: FontKey, sizePt: number): number {
    const context = canvasContext();
    if (context !== undefined) {
        const style = `${key.italic ? "italic " : ""}${key.bold ? "bold " : ""}`;
        try {
            context.font = `${style}${sizePt}pt ${STACKS[key.mono ? "mono" : key.family]}`;
            const width = context.measureText(text).width;
            if (Number.isFinite(width)) {
                return width * 0.75;
            }
        } catch {
            // Some environments expose the context but not its metrics.
        }
        measuringContext = undefined;
        measured = false;
    }
    return (tableWidth(text, key) / 1000) * sizePt;
}

function tableWidth(text: string, key: FontKey): number {
    const table = TABLES[key.mono ? "mono" : key.family];
    let total = 0;
    for (const char of text) {
        const index = (char.codePointAt(0) ?? 63) - 32;
        total += (table[index] ?? 500) * (key.bold ? 1.08 : key.italic ? 0.98 : 1);
    }
    return total;
}
