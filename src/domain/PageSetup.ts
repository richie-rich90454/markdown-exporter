export type PageSizeId = "a4" | "a5" | "six-by-nine" | "letter" | "legal" | "custom";
export type FontFamilyId = "serif" | "sans" | "mono";
export type ThemeId = "light" | "dark";

export interface PageSetup {
    readonly pageSize: PageSizeId;
    readonly customWidthMm?: number;
    readonly customHeightMm?: number;
    readonly marginMm: number;
    readonly fontFamily: FontFamilyId;
    readonly fontSizePt: number;
    readonly lineHeight: number;
}

export const PAGE_SIZES: Readonly<
    Record<
        PageSizeId,
        { readonly label: string; readonly widthMm: number; readonly heightMm: number }
    >
> = {
    a4: { label: "A4", widthMm: 210, heightMm: 297 },
    a5: { label: "A5", widthMm: 148, heightMm: 210 },
    "six-by-nine": { label: "6 × 9 in", widthMm: 152.4, heightMm: 228.6 },
    letter: { label: "Letter", widthMm: 215.9, heightMm: 279.4 },
    legal: { label: "Legal", widthMm: 215.9, heightMm: 355.6 },
    custom: { label: "Custom", widthMm: 152.4, heightMm: 228.6 }
};

export const MARGIN_OPTIONS: readonly number[] = [10, 20, 30];

export const FONT_OPTIONS: Readonly<Record<FontFamilyId, string>> = {
    serif: "Georgia",
    sans: "System sans",
    mono: "System mono"
};

export const PT_PER_MM = 72 / 25.4;
export const PX_PER_MM = 96 / 25.4;
export const HEADING_SCALE = 1.25;

export function pageWidthPt(setup: PageSetup): number {
    return pageDimensions(setup).widthMm * PT_PER_MM;
}

export function pageHeightPt(setup: PageSetup): number {
    return pageDimensions(setup).heightMm * PT_PER_MM;
}

export function pageDimensions(setup: PageSetup): { readonly widthMm: number; readonly heightMm: number } {
    if (setup.pageSize !== "custom") return PAGE_SIZES[setup.pageSize];
    const fallback = PAGE_SIZES.custom;
    return {
        widthMm: boundedDimension(setup.customWidthMm, fallback.widthMm),
        heightMm: boundedDimension(setup.customHeightMm, fallback.heightMm)
    };
}

function boundedDimension(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) ? Math.max(80, Math.min(500, value)) : fallback;
}

export function marginPt(setup: PageSetup): number {
    return setup.marginMm * PT_PER_MM;
}

export function bodySizePt(setup: PageSetup): number {
    return setup.fontSizePt;
}

export function headingSizePt(setup: PageSetup, level: number): number {
    const steps = Math.max(0, 4 - level);
    return setup.fontSizePt * HEADING_SCALE ** steps;
}

export function codeSizePt(setup: PageSetup): number {
    return setup.fontSizePt * 0.9;
}
