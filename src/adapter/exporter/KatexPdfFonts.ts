import ams from "katex/dist/fonts/KaTeX_AMS-Regular.ttf?inline";
import caligraphicBold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.ttf?inline";
import caligraphicRegular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.ttf?inline";
import frakturBold from "katex/dist/fonts/KaTeX_Fraktur-Bold.ttf?inline";
import frakturRegular from "katex/dist/fonts/KaTeX_Fraktur-Regular.ttf?inline";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.ttf?inline";
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.ttf?inline";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.ttf?inline";
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.ttf?inline";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.ttf?inline";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.ttf?inline";
import sansBold from "katex/dist/fonts/KaTeX_SansSerif-Bold.ttf?inline";
import sansItalic from "katex/dist/fonts/KaTeX_SansSerif-Italic.ttf?inline";
import sansRegular from "katex/dist/fonts/KaTeX_SansSerif-Regular.ttf?inline";
import scriptRegular from "katex/dist/fonts/KaTeX_Script-Regular.ttf?inline";
import size1Regular from "katex/dist/fonts/KaTeX_Size1-Regular.ttf?inline";
import size2Regular from "katex/dist/fonts/KaTeX_Size2-Regular.ttf?inline";
import size3Regular from "katex/dist/fonts/KaTeX_Size3-Regular.ttf?inline";
import size4Regular from "katex/dist/fonts/KaTeX_Size4-Regular.ttf?inline";
import typewriterRegular from "katex/dist/fonts/KaTeX_Typewriter-Regular.ttf?inline";

const DATA_URIS: Readonly<Record<string, string>> = {
    "KaTeX_AMS-Regular.ttf": ams,
    "KaTeX_Caligraphic-Bold.ttf": caligraphicBold,
    "KaTeX_Caligraphic-Regular.ttf": caligraphicRegular,
    "KaTeX_Fraktur-Bold.ttf": frakturBold,
    "KaTeX_Fraktur-Regular.ttf": frakturRegular,
    "KaTeX_Main-Bold.ttf": mainBold,
    "KaTeX_Main-BoldItalic.ttf": mainBoldItalic,
    "KaTeX_Main-Italic.ttf": mainItalic,
    "KaTeX_Main-Regular.ttf": mainRegular,
    "KaTeX_Math-BoldItalic.ttf": mathBoldItalic,
    "KaTeX_Math-Italic.ttf": mathItalic,
    "KaTeX_SansSerif-Bold.ttf": sansBold,
    "KaTeX_SansSerif-Italic.ttf": sansItalic,
    "KaTeX_SansSerif-Regular.ttf": sansRegular,
    "KaTeX_Script-Regular.ttf": scriptRegular,
    "KaTeX_Size1-Regular.ttf": size1Regular,
    "KaTeX_Size2-Regular.ttf": size2Regular,
    "KaTeX_Size3-Regular.ttf": size3Regular,
    "KaTeX_Size4-Regular.ttf": size4Regular,
    "KaTeX_Typewriter-Regular.ttf": typewriterRegular
};

/** Loads the font files only when the current PDF contains KaTeX glyphs. */
export function loadKatexPdfFonts(names: readonly string[]): ReadonlyMap<string, Uint8Array> {
    const fonts = new Map<string, Uint8Array>();
    for (const name of names) {
        const uri = DATA_URIS[name];
        if (uri === undefined) continue;
        const payload = uri.slice(uri.indexOf(",") + 1);
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        fonts.set(name, bytes);
    }
    return fonts;
}
