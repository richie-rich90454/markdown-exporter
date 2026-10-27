import { createSignal, type Accessor, type Setter } from "solid-js";

import {
    FONT_OPTIONS,
    MARGIN_OPTIONS,
    PAGE_SIZES,
    type PageSetup,
    type ThemeId
} from "../domain/PageSetup";

const DEFAULT_SETUP: PageSetup = {
    pageSize: "a4",
    customWidthMm: 152.4,
    customHeightMm: 228.6,
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

function preferredTheme(): ThemeId {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export class SettingsStore {
    readonly current: Accessor<PageSetup>;
    readonly theme: Accessor<ThemeId>;

    private readonly patchSetup: Setter<PageSetup>;
    private readonly setTheme: Setter<ThemeId>;

    constructor() {
        const [current, patchSetup] = createSignal(DEFAULT_SETUP);
        const [theme, setTheme] = createSignal(preferredTheme());
        this.current = current;
        this.patchSetup = patchSetup;
        this.theme = theme;
        this.setTheme = setTheme;
    }

    patch(partial: Partial<PageSetup>): void {
        this.patchSetup((previous) => ({ ...previous, ...partial }));
    }

    toggleTheme(): void {
        this.setTheme((current) => (current === "dark" ? "light" : "dark"));
    }
}

export { FONT_OPTIONS, MARGIN_OPTIONS, PAGE_SIZES };
export type { PageSetup, ThemeId };
