import { createSignal, type Accessor, type Setter } from "solid-js";

export type PageSizeId = "a4" | "letter" | "legal";
export type FontFamilyId = "serif" | "sans" | "mono";

export interface PageSettings {
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

const DEFAULT_SETTINGS: PageSettings = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

export class SettingsStore {
    readonly current: Accessor<PageSettings>;

    private readonly patchSettings: Setter<PageSettings>;

    constructor() {
        const [current, patchSettings] = createSignal(DEFAULT_SETTINGS);
        this.current = current;
        this.patchSettings = patchSettings;
    }

    patch(partial: Partial<PageSettings>): void {
        this.patchSettings((previous) => ({ ...previous, ...partial }));
    }
}
