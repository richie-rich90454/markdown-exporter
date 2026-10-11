export type PageSizeId = "a4" | "letter" | "legal";
export type FontFamilyId = "serif" | "sans" | "mono";
export type ThemeId = "light" | "dark";

export interface PageSetup {
    readonly pageSize: PageSizeId;
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
    letter: { label: "Letter", widthMm: 215.9, heightMm: 279.4 },
    legal: { label: "Legal", widthMm: 215.9, heightMm: 355.6 }
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
    return PAGE_SIZES[setup.pageSize].widthMm * PT_PER_MM;
}

export function pageHeightPt(setup: PageSetup): number {
    return PAGE_SIZES[setup.pageSize].heightMm * PT_PER_MM;
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
