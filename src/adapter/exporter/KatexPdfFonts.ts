type InlineFontModule = { readonly default: string };
type FontLoader = () => Promise<InlineFontModule>;

// Each font stays in its own deferred module. A PDF only asks for the font
// faces used by its math, so common formulas no longer download the full
// KaTeX TrueType collection.
const FONT_LOADERS: Readonly<Record<string, FontLoader>> = {
    "KaTeX_AMS-Regular.ttf": () => import("./katexPdfFonts/KaTeX_AMS-Regular"),
    "KaTeX_Caligraphic-Bold.ttf": () => import("./katexPdfFonts/KaTeX_Caligraphic-Bold"),
    "KaTeX_Caligraphic-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Caligraphic-Regular"),
    "KaTeX_Fraktur-Bold.ttf": () => import("./katexPdfFonts/KaTeX_Fraktur-Bold"),
    "KaTeX_Fraktur-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Fraktur-Regular"),
    "KaTeX_Main-Bold.ttf": () => import("./katexPdfFonts/KaTeX_Main-Bold"),
    "KaTeX_Main-BoldItalic.ttf": () => import("./katexPdfFonts/KaTeX_Main-BoldItalic"),
    "KaTeX_Main-Italic.ttf": () => import("./katexPdfFonts/KaTeX_Main-Italic"),
    "KaTeX_Main-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Main-Regular"),
    "KaTeX_Math-BoldItalic.ttf": () => import("./katexPdfFonts/KaTeX_Math-BoldItalic"),
    "KaTeX_Math-Italic.ttf": () => import("./katexPdfFonts/KaTeX_Math-Italic"),
    "KaTeX_SansSerif-Bold.ttf": () => import("./katexPdfFonts/KaTeX_SansSerif-Bold"),
    "KaTeX_SansSerif-Italic.ttf": () => import("./katexPdfFonts/KaTeX_SansSerif-Italic"),
    "KaTeX_SansSerif-Regular.ttf": () => import("./katexPdfFonts/KaTeX_SansSerif-Regular"),
    "KaTeX_Script-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Script-Regular"),
    "KaTeX_Size1-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Size1-Regular"),
    "KaTeX_Size2-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Size2-Regular"),
    "KaTeX_Size3-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Size3-Regular"),
    "KaTeX_Size4-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Size4-Regular"),
    "KaTeX_Typewriter-Regular.ttf": () => import("./katexPdfFonts/KaTeX_Typewriter-Regular")
};

/** Loads only the KaTeX font files actually used by the current PDF. */
export async function loadKatexPdfFonts(
    names: readonly string[]
): Promise<ReadonlyMap<string, Uint8Array>> {
    const fonts = new Map<string, Uint8Array>();
    await Promise.all(
        [...new Set(names)].map(async (name) => {
            const load = FONT_LOADERS[name];
            if (load === undefined) return;
            const uri = (await load()).default;
            const payload = uri.slice(uri.indexOf(",") + 1);
            const binary = atob(payload);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
            fonts.set(name, bytes);
        })
    );

    return fonts;
}
