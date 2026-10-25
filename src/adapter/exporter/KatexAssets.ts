import katexStyles from "../../styles/katex.min.txt?raw";
import ams from "../../assets/katex-fonts/KaTeX_AMS-Regular.woff2?inline";
import caligraphicBold from "../../assets/katex-fonts/KaTeX_Caligraphic-Bold.woff2?inline";
import caligraphicRegular from "../../assets/katex-fonts/KaTeX_Caligraphic-Regular.woff2?inline";
import frakturBold from "../../assets/katex-fonts/KaTeX_Fraktur-Bold.woff2?inline";
import frakturRegular from "../../assets/katex-fonts/KaTeX_Fraktur-Regular.woff2?inline";
import mainBold from "../../assets/katex-fonts/KaTeX_Main-Bold.woff2?inline";
import mainBoldItalic from "../../assets/katex-fonts/KaTeX_Main-BoldItalic.woff2?inline";
import mainItalic from "../../assets/katex-fonts/KaTeX_Main-Italic.woff2?inline";
import mainRegular from "../../assets/katex-fonts/KaTeX_Main-Regular.woff2?inline";
import mathBoldItalic from "../../assets/katex-fonts/KaTeX_Math-BoldItalic.woff2?inline";
import mathItalic from "../../assets/katex-fonts/KaTeX_Math-Italic.woff2?inline";
import sansBold from "../../assets/katex-fonts/KaTeX_SansSerif-Bold.woff2?inline";
import sansItalic from "../../assets/katex-fonts/KaTeX_SansSerif-Italic.woff2?inline";
import sansRegular from "../../assets/katex-fonts/KaTeX_SansSerif-Regular.woff2?inline";
import scriptRegular from "../../assets/katex-fonts/KaTeX_Script-Regular.woff2?inline";
import size1Regular from "../../assets/katex-fonts/KaTeX_Size1-Regular.woff2?inline";
import size2Regular from "../../assets/katex-fonts/KaTeX_Size2-Regular.woff2?inline";
import size3Regular from "../../assets/katex-fonts/KaTeX_Size3-Regular.woff2?inline";
import size4Regular from "../../assets/katex-fonts/KaTeX_Size4-Regular.woff2?inline";
import typewriterRegular from "../../assets/katex-fonts/KaTeX_Typewriter-Regular.woff2?inline";

const FONT_DATA: Readonly<Record<string, string>> = {
    "KaTeX_AMS-Regular.woff2": ams,
    "KaTeX_Caligraphic-Bold.woff2": caligraphicBold,
    "KaTeX_Caligraphic-Regular.woff2": caligraphicRegular,
    "KaTeX_Fraktur-Bold.woff2": frakturBold,
    "KaTeX_Fraktur-Regular.woff2": frakturRegular,
    "KaTeX_Main-Bold.woff2": mainBold,
    "KaTeX_Main-BoldItalic.woff2": mainBoldItalic,
    "KaTeX_Main-Italic.woff2": mainItalic,
    "KaTeX_Main-Regular.woff2": mainRegular,
    "KaTeX_Math-BoldItalic.woff2": mathBoldItalic,
    "KaTeX_Math-Italic.woff2": mathItalic,
    "KaTeX_SansSerif-Bold.woff2": sansBold,
    "KaTeX_SansSerif-Italic.woff2": sansItalic,
    "KaTeX_SansSerif-Regular.woff2": sansRegular,
    "KaTeX_Script-Regular.woff2": scriptRegular,
    "KaTeX_Size1-Regular.woff2": size1Regular,
    "KaTeX_Size2-Regular.woff2": size2Regular,
    "KaTeX_Size3-Regular.woff2": size3Regular,
    "KaTeX_Size4-Regular.woff2": size4Regular,
    "KaTeX_Typewriter-Regular.woff2": typewriterRegular
};

/** Returns KaTeX's stylesheet with every font stored inside the exported HTML. */
export function katexStylesWithEmbeddedFonts(): string {
    return katexStyles.replace(
        /url\((['"]?)([^)'"]+\.(?:woff2|woff|ttf))\1\)/g,
        (match, _quote: string, path: string) => {
            const filename = path.slice(path.lastIndexOf("/") + 1);
            const base = filename.replace(/\.(?:woff2|woff|ttf)$/, "");
            const data = FONT_DATA[`${base}.woff2`];
            return data === undefined ? match : `url("${data}")`;
        }
    );
}
