import katexStyles from "../../styles/katex.min.txt?raw";

type InlineFontModule = { readonly default: string };
type FontLoader = () => Promise<InlineFontModule>;

const FONT_LOADERS: Readonly<Record<string, FontLoader>> = {
    "KaTeX_AMS-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_AMS-Regular"),
    "KaTeX_Caligraphic-Bold.woff2": () => import("./katexHtmlFonts/KaTeX_Caligraphic-Bold"),
    "KaTeX_Caligraphic-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Caligraphic-Regular"),
    "KaTeX_Fraktur-Bold.woff2": () => import("./katexHtmlFonts/KaTeX_Fraktur-Bold"),
    "KaTeX_Fraktur-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Fraktur-Regular"),
    "KaTeX_Main-Bold.woff2": () => import("./katexHtmlFonts/KaTeX_Main-Bold"),
    "KaTeX_Main-BoldItalic.woff2": () => import("./katexHtmlFonts/KaTeX_Main-BoldItalic"),
    "KaTeX_Main-Italic.woff2": () => import("./katexHtmlFonts/KaTeX_Main-Italic"),
    "KaTeX_Main-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Main-Regular"),
    "KaTeX_Math-BoldItalic.woff2": () => import("./katexHtmlFonts/KaTeX_Math-BoldItalic"),
    "KaTeX_Math-Italic.woff2": () => import("./katexHtmlFonts/KaTeX_Math-Italic"),
    "KaTeX_SansSerif-Bold.woff2": () => import("./katexHtmlFonts/KaTeX_SansSerif-Bold"),
    "KaTeX_SansSerif-Italic.woff2": () => import("./katexHtmlFonts/KaTeX_SansSerif-Italic"),
    "KaTeX_SansSerif-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_SansSerif-Regular"),
    "KaTeX_Script-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Script-Regular"),
    "KaTeX_Size1-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Size1-Regular"),
    "KaTeX_Size2-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Size2-Regular"),
    "KaTeX_Size3-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Size3-Regular"),
    "KaTeX_Size4-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Size4-Regular"),
    "KaTeX_Typewriter-Regular.woff2": () => import("./katexHtmlFonts/KaTeX_Typewriter-Regular")
};

/** Returns KaTeX's stylesheet with only the font files used by this document embedded. */
export async function katexStylesWithEmbeddedFonts(content: Node): Promise<string> {
    const requested = fontsUsedByMath(content) ?? Object.keys(FONT_LOADERS);
    const loaded = await Promise.all(
        requested.map(async (name) => {
            const load = FONT_LOADERS[name];
            if (load === undefined) throw new Error(`Unknown KaTeX font: ${name}`);
            return [name, (await load()).default] as const;
        })
    );
    const data = new Map(loaded);

    const woff2Styles = katexStyles.replace(/@font-face\{[^}]+\}/g, (rule) => {
        const woff2Source = /url\((['"]?)([^)'" ]+\.woff2)\1\)\s*format\(['"]?woff2['"]?\)/.exec(
            rule
        )?.[0];
        if (woff2Source === undefined) return rule;
        const path = /url\((['"]?)([^)'" ]+\.woff2)\1\)/.exec(woff2Source)?.[2];
        if (path === undefined || !data.has(path.slice(path.lastIndexOf("/") + 1))) return "";
        return rule.replace(/src:[^}]+/, `src:${woff2Source}`);
    });

    return woff2Styles.replace(
        /url\((['"]?)([^)'" ]+\.(?:woff2|woff|ttf))\1\)/g,
        (match, _quote: string, path: string) => {
            const filename = path.slice(path.lastIndexOf("/") + 1);
            const base = filename.replace(/\.(?:woff2|woff|ttf)$/, "");
            const embedded = data.get(`${base}.woff2`);
            return embedded === undefined ? match : `url("${embedded}")`;
        }
    );
}

function fontsUsedByMath(content: Node): string[] | null {
    if (
        !(
            content instanceof Element ||
            content instanceof Document ||
            content instanceof DocumentFragment
        )
    ) {
        return null;
    }

    const formulas = Array.from(content.querySelectorAll<HTMLElement>(".katex"));
    if (document.defaultView === null || formulas.length === 0) return null;

    const measure = document.createElement("div");
    measure.style.cssText =
        "position:absolute;visibility:hidden;pointer-events:none;left:-100000px";
    for (const formula of formulas) measure.append(formula.cloneNode(true));
    document.body.append(measure);

    const used = new Set<string>();
    try {
        for (const formula of Array.from(measure.querySelectorAll<HTMLElement>(".katex"))) {
            for (const element of [formula, ...formula.querySelectorAll<HTMLElement>("*")]) {
                const style = document.defaultView.getComputedStyle(element);
                const family = style.fontFamily
                    .split(",")[0]
                    ?.trim()
                    .replace(/^['"]|['"]$/g, "");
                if (family === undefined || !family.startsWith("KaTeX_")) continue;
                const font = fontFileForStyle(family, style.fontWeight, style.fontStyle);
                if (font === null) return null;
                used.add(font);
            }
        }
    } finally {
        measure.remove();
    }
    return used.size === 0 ? null : [...used];
}

function fontFileForStyle(family: string, weight: string, style: string): string | null {
    const bold = weight === "bold" || Number.parseInt(weight, 10) >= 600;
    const italic = style === "italic" || style === "oblique";
    const suffix = (value: string): string => `${family}-${value}.woff2`;

    switch (family) {
        case "KaTeX_Main":
            return suffix(bold ? (italic ? "BoldItalic" : "Bold") : italic ? "Italic" : "Regular");
        case "KaTeX_Math":
            return italic ? suffix(bold ? "BoldItalic" : "Italic") : null;
        case "KaTeX_SansSerif":
            if (bold && italic) return null;
            return suffix(bold ? "Bold" : italic ? "Italic" : "Regular");
        case "KaTeX_Caligraphic":
        case "KaTeX_Fraktur":
            if (italic) return null;
            return suffix(bold ? "Bold" : "Regular");
        case "KaTeX_AMS":
        case "KaTeX_Script":
        case "KaTeX_Typewriter":
            return bold || italic ? null : suffix("Regular");
        case "KaTeX_Size1":
        case "KaTeX_Size2":
        case "KaTeX_Size3":
        case "KaTeX_Size4":
            return bold || italic ? null : suffix("Regular");
        default:
            return null;
    }
}
