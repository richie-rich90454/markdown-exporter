import { describe, expect, it } from "vitest";

import { marginPt, pageHeightPt, pageWidthPt, type PageSetup } from "../../../src/domain/PageSetup";
import type { DrawOp, LaidOut } from "../../../src/domain/pdf/PdfLayout";
import type { MathLayout } from "../../../src/domain/pdf/MathLayout";
import { parseBlocks } from "../../../src/domain/pdf/PdfLayout";
import { baseFont, font, textWidth } from "../../../src/domain/pdf/PdfMetrics";
import { paginate } from "../../../src/domain/pdf/PdfPaginate";

const SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

const LEFT = marginPt(SETUP);
const RIGHT = pageWidthPt(SETUP) - marginPt(SETUP);
const TOP = pageHeightPt(SETUP) - marginPt(SETUP);
const BOTTOM = marginPt(SETUP);

function layout(html: string): LaidOut {
    const host = document.createElement("div");
    host.innerHTML = html;
    return paginate(parseBlocks(host), SETUP, new Map<string, boolean>());
}

function texts(page: readonly DrawOp[]): Extract<DrawOp, { kind: "text" }>[] {
    // The page number lives in the bottom margin by design.
    return page.filter(
        (op): op is Extract<DrawOp, { kind: "text" }> =>
            op.kind === "text" && op.y >= marginPt(SETUP)
    );
}

function footers(page: readonly DrawOp[]): string[] {
    return page
        .filter((op): op is Extract<DrawOp, { kind: "text" }> => op.kind === "text")
        .map((op) => op.text)
        .filter((text) => /^\d+ \/ \d+$/.test(text));
}

function repeated(count: number, build: (index: number) => string): string {
    return Array.from({ length: count }, (_, index) => build(index)).join("");
}

describe("page geometry", () => {
    it("starts a new page at an explicit book chapter break without a blank page", () => {
        const host = document.createElement("div");
        host.innerHTML = '<h1>Chapter one</h1><p>First section.</p><div class="book-page-break"></div><h1>Chapter two</h1><p>Second section.</p>';
        const paginated = paginate(parseBlocks(host), SETUP, new Map());
        expect(paginated.pages).toHaveLength(2);
        expect(texts(paginated.pages[0] ?? []).map((op) => op.text).join(" ")).toContain("First section.");
        expect(texts(paginated.pages[0] ?? []).map((op) => op.text).join(" ")).not.toContain("Chapter two");
        expect(texts(paginated.pages[1] ?? []).map((op) => op.text).join(" ")).toContain("Chapter two");
    });

    it("keeps every run inside the margins of its page", () => {
        const doc = layout(
            `<h1>Heading one</h1><p>${repeated(400, (index) => `Word ${index} of the body text. `)}</p>` +
                `<blockquote>${repeated(40, (index) => `<p>Quoted line ${index + 1}.</p>`)}</blockquote>` +
                `<ul>${repeated(30, (index) => `<li>Item ${index + 1}</li>`)}</ul>` +
                `<pre>${repeated(40, (index) => `line ${index + 1}`)}</pre>`
        );

        expect(doc.pages.length).toBeGreaterThan(3);
        for (const page of doc.pages) {
            for (const op of texts(page)) {
                const width = textWidth(op.text, op.font, op.size);
                expect(op.x).toBeGreaterThanOrEqual(LEFT);
                expect(op.x + width, `${op.text} runs past the right margin`).toBeLessThanOrEqual(
                    RIGHT
                );
                expect(op.y).toBeGreaterThanOrEqual(BOTTOM);
                expect(op.y).toBeLessThanOrEqual(TOP);
            }
        }
    });

    it("never draws two runs on top of each other", () => {
        const doc = layout(
            `<p>Plain <strong>bold words</strong> then <em>italic words</em> then ` +
                `<code>code words</code> and a <a href="https://example.com">link</a> to follow, ` +
                `${repeated(120, (index) => `filler ${index}`)} with more.</p>`
        );

        for (const page of doc.pages) {
            const lines = new Map<number, Extract<DrawOp, { kind: "text" }>[]>();
            for (const op of texts(page)) {
                const key = Math.round(op.y * 100);
                const bucket = lines.get(key) ?? [];
                bucket.push(op);
                lines.set(key, bucket);
            }
            for (const [key, runs] of lines) {
                const ordered = [...runs].sort((left, right) => left.x - right.x);
                for (let index = 1; index < ordered.length; index += 1) {
                    const previous = ordered[index - 1];
                    const current = ordered[index];
                    if (previous === undefined || current === undefined) {
                        continue;
                    }
                    const end = previous.x + textWidth(previous.text, previous.font, previous.size);
                    expect(end, `overlap on line ${key}`).toBeLessThanOrEqual(current.x + 0.01);
                }
            }
        }
    });

    it("reserves extra line height for tall inline formulas", () => {
        const math: MathLayout = {
            width: 24,
            height: 54,
            baseFontSize: 12,
            verticalAlign: -3,
            searchableText: "\\frac{1}{2}",
            glyphs: [],
            rules: []
        };
        const doc = paginate(
            [
                {
                    kind: "paragraph",
                    runs: [
                        { text: "Before\n", bold: false, italic: false, mono: false },
                        { text: "", bold: false, italic: false, mono: false, math },
                        { text: "\nAfter", bold: false, italic: false, mono: false }
                    ]
                }
            ],
            SETUP,
            new Map<string, boolean>()
        );
        const page = doc.pages[0] ?? [];
        const before = page.find(
            (op): op is Extract<DrawOp, { kind: "text" }> =>
                op.kind === "text" && op.text.includes("Before")
        );
        const after = page.find(
            (op): op is Extract<DrawOp, { kind: "text" }> =>
                op.kind === "text" && op.text.includes("After")
        );
        const formula = page.find(
            (op): op is Extract<DrawOp, { kind: "math" }> => op.kind === "math"
        );

        expect(before).toBeDefined();
        expect(after).toBeDefined();
        expect(formula).toBeDefined();
        expect((formula?.y ?? 0) + math.height * (formula?.scale ?? 0)).toBeLessThanOrEqual(
            before?.y ?? 0
        );
    });

    it("keeps tall inline formulas inside their table row", () => {
        const math: MathLayout = {
            width: 24,
            height: 54,
            baseFontSize: 12,
            verticalAlign: -3,
            searchableText: "\\frac{1}{2}",
            glyphs: [],
            rules: []
        };
        const doc = paginate(
            [
                {
                    kind: "table",
                    head: [[{ text: "Value", bold: false, italic: false, mono: false }]],
                    body: [[[{ text: "", bold: false, italic: false, mono: false, math }]]],
                    alignments: ["left"]
                }
            ],
            SETUP,
            new Map<string, boolean>()
        );
        const page = doc.pages[0] ?? [];
        const formula = page.find(
            (op): op is Extract<DrawOp, { kind: "math" }> => op.kind === "math"
        );
        const borders = page
            .filter(
                (op): op is Extract<DrawOp, { kind: "line" }> =>
                    op.kind === "line" && op.x1 === LEFT && op.x2 > LEFT && op.y1 === op.y2
            )
            .sort((left, right) => right.y1 - left.y1);
        const rowTop = borders[1]?.y1;

        expect(formula).toBeDefined();
        expect(rowTop).toBeDefined();
        expect((formula?.y ?? 0) + math.height * (formula?.scale ?? 0)).toBeLessThanOrEqual(
            (rowTop ?? 0) - 5
        );
    });

    it("starts every block at the left margin", () => {
        const doc = layout(
            `<p>First paragraph with a <strong>bold</strong> middle.</p><p>Second paragraph.</p>`
        );
        const runs = texts(doc.pages[0] ?? []);
        expect(runs[0]?.x).toBe(LEFT);
    });

    it("preserves GFM table alignment and aligns PDF cell text", () => {
        const host = document.createElement("div");
        host.innerHTML =
            '<table><thead><tr><th align="left">Left</th><th align="center">Center</th>' +
            '<th align="right">Right</th></tr></thead><tbody><tr>' +
            '<td align="left">same</td><td align="center">same</td>' +
            '<td align="right">same</td></tr></tbody></table>';
        const blocks = parseBlocks(host);
        const table = blocks[0];

        expect(table?.kind).toBe("table");
        if (table?.kind !== "table") return;
        expect(table.alignments).toEqual(["left", "center", "right"]);

        const doc = paginate(blocks, SETUP, new Map<string, boolean>());
        const positions = texts(doc.pages[0] ?? [])
            .filter((op) => op.text === "same")
            .map((op) => op.x);
        expect(positions).toHaveLength(3);
        expect(positions[0]).toBeLessThan(positions[1] ?? Infinity);
        expect(positions[1]).toBeLessThan(positions[2] ?? Infinity);
    });

    it("fills every page and numbers them all", () => {
        const doc = layout(repeated(120, (index) => `<p>Paragraph ${index + 1}.</p>`));

        expect(doc.pages.length).toBeGreaterThan(1);
        for (const [index, page] of doc.pages.entries()) {
            const runs = texts(page);
            expect(runs.length).toBeGreaterThan(0);
            expect(footers(page)).toEqual([`${index + 1} / ${doc.pages.length}`]);
        }
    });

    it("moves a heading that would be stranded at the foot of a page", () => {
        // Padding that ends a few lines before the page ends leaves exactly one
        // line of room, which is not enough for a heading plus its own text.
        const padding = repeated(52, (index) => `<p>Padding line ${index + 1} of text.</p>`);
        const doc = layout(`${padding}<h2>Stranded heading</h2><p>Following paragraph.</p>`);

        for (const page of doc.pages) {
            const runs = texts(page);
            const heading = runs.findIndex((op) => op.text.includes("Stranded heading"));
            if (heading >= 0) {
                expect(heading, "heading is the last thing on the page").toBeLessThan(
                    runs.length - 1
                );
            }
        }
    });

    it("draws the quote bar down to the last line of the quote", () => {
        const doc = layout(
            `<blockquote><p>First quoted line.</p><p>Second quoted line.</p></blockquote><p>After.</p>`
        );
        const page = doc.pages[0] ?? [];
        const bar = page.find((op) => op.kind === "line" && op.x1 === op.x2);
        expect(bar).toBeDefined();
        if (bar === undefined || bar.kind !== "line") {
            return;
        }
        const quoted = texts(page).filter((op) => op.x > LEFT);
        const lowest = Math.min(...quoted.map((op) => op.y));
        expect(bar.y2).toBe(lowest);
        expect(bar.y1).toBeGreaterThan(lowest);
    });

    it("puts a list marker on the first line of its item", () => {
        const doc = layout(
            `<ol><li>First item with enough words to wrap onto a second line for the check.</li></ol>`
        );
        const runs = texts(doc.pages[0] ?? []);
        const marker = runs.find((op) => op.text === "1.");
        expect(marker).toBeDefined();
        const firstLine = Math.max(...runs.map((op) => op.y));
        expect(marker?.y).toBe(firstLine);
    });

    it("keeps inline math and its MathML fallback inside one tight-list paragraph", () => {
        const host = document.createElement("div");
        host.innerHTML =
            '<ul><li>Fit <span class="katex"><span class="katex-html">x = r</span>' +
            '<span class="katex-mathml"><math><semantics>' +
            '<annotation encoding="application/x-tex">x=r</annotation>' +
            "</semantics></math></span></span></li></ul>";
        const blocks = parseBlocks(host);
        const list = blocks[0];

        expect(list?.kind).toBe("list");
        if (list?.kind !== "list") return;
        const item = list.items[0] ?? [];
        expect(item).toHaveLength(1);
        const paragraph = item[0];
        expect(paragraph?.kind).toBe("paragraph");
        if (paragraph?.kind !== "paragraph") return;
        expect(paragraph.runs.map((run) => run.text).join("")).toBe("Fit x = r");
    });

    it("keeps a long list item's marker on the page where its content starts", () => {
        const paragraphs = repeated(
            80,
            (index) => `<p>Paragraph ${index + 1} continues the same list item.</p>`
        );
        const doc = layout(`<ul><li>${paragraphs}</li></ul>`);
        const markerPages = doc.pages.flatMap((page, index) =>
            page.some((op) => op.kind === "text" && op.text === "•") ? [index] : []
        );

        expect(doc.pages.length).toBeGreaterThan(1);
        expect(markerPages).toEqual([0]);
    });
});

describe("font selection", () => {
    it("names bold, italic and monospace base fonts", () => {
        expect(baseFont(font(false, false, false, "serif"))).toBe("Times-Roman");
        expect(baseFont(font(true, false, false, "serif"))).toBe("Times-Bold");
        expect(baseFont(font(false, true, false, "serif"))).toBe("Times-Italic");
        expect(baseFont(font(true, true, false, "serif"))).toBe("Times-BoldItalic");
        expect(baseFont(font(false, false, true, "serif"))).toBe("Courier");
        expect(baseFont(font(true, false, false, "sans"))).toBe("Helvetica-Bold");
    });

    it("typesets strong and italic runs with their own fonts", () => {
        const doc = layout("<p>plain <strong>bold</strong> <em>italic</em> <code>code</code></p>");
        const used = texts(doc.pages[0] ?? []).map((op) => baseFont(op.font));

        expect(used).toContain("Times-Roman");
        expect(used).toContain("Times-Bold");
        expect(used).toContain("Times-Italic");
        expect(used).toContain("Courier");
    });
});
