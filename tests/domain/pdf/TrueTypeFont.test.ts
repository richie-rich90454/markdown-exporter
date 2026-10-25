import { describe, expect, it } from "vitest";

import { loadKatexPdfFonts } from "../../../src/adapter/exporter/KatexPdfFonts";
import { font } from "../../../src/domain/pdf/PdfMetrics";
import type { LaidOut } from "../../../src/domain/pdf/PdfLayout";
import type { MathLayout } from "../../../src/domain/pdf/MathLayout";
import { writePdf } from "../../../src/domain/pdf/PdfWriter";
import { parseTrueType } from "../../../src/domain/pdf/TrueTypeFont";
import type { PageSetup } from "../../../src/domain/PageSetup";

const SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

const FONT_NAME = "KaTeX_Main-Regular.ttf";

describe("KaTeX TrueType PDF fonts", () => {
    it("loads the requested font and maps Unicode characters to its glyph IDs", async () => {
        const fonts = await loadKatexPdfFonts([FONT_NAME, FONT_NAME, "unknown.ttf"]);
        const bytes = fonts.get(FONT_NAME);
        expect(bytes).toBeDefined();
        expect(fonts.size).toBe(1);
        if (bytes === undefined) return;

        const font = parseTrueType(bytes);

        expect(font.unitsPerEm).toBeGreaterThan(0);
        expect(font.glyphFor("x".codePointAt(0) ?? 0)).toBeGreaterThan(0);
        expect(font.advances[font.glyphFor("x".codePointAt(0) ?? 0)]).toBeGreaterThan(0);
    });

    it("embeds fonts, glyph mappings, and ToUnicode text in the PDF", async () => {
        const math: MathLayout = {
            width: 20,
            height: 16,
            baseFontSize: 12,
            verticalAlign: 0,
            searchableText: "x^2",
            glyphs: [
                { text: "x", font: FONT_NAME, x: 0, y: 2, size: 12 },
                { text: "2", font: FONT_NAME, x: 7, y: 8, size: 8 }
            ],
            rules: [{ x: 0, y: 5, width: 8, height: 0.5 }]
        };
        const layout: LaidOut = {
            pages: [[{ kind: "math", x: 40, y: 40, scale: 1, math }]],
            images: [],
            fonts: [font(false, false, false, "serif")],
            mathFonts: [FONT_NAME]
        };
        const fonts = await loadKatexPdfFonts([FONT_NAME]);
        const pdf = new TextDecoder("latin1").decode(writePdf(layout, [], "Math", SETUP, fonts));

        expect(pdf).toContain("/Subtype /Type0");
        expect(pdf).toContain("/FontFile2");
        expect(pdf).toContain("/CIDToGIDMap");
        expect(pdf).toContain("/ToUnicode");
        expect(pdf).toContain("<0078>");
        expect(pdf).toContain("(x^2) Tj");
        expect(pdf).toContain("re f");
    });
});
