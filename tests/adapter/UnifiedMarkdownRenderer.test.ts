import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { DirectDomWriter } from "../../src/adapter/renderer/DirectDomWriter";
import { UnifiedMarkdownRenderer } from "../../src/adapter/renderer/UnifiedMarkdownRenderer";
import { MarkdownDocument } from "../../src/domain/MarkdownDocument";
import type { Clock } from "../../src/port/Clock";

class FixedClock implements Clock {
    nowEpochMs(): number {
        return 1_700_000_000_000;
    }
}

function createRenderer(): UnifiedMarkdownRenderer {
    return new UnifiedMarkdownRenderer(new DirectDomWriter(), new FixedClock());
}

describe("UnifiedMarkdownRenderer", () => {
    it("renders markdown straight into DOM nodes", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("# Heading\n\nA paragraph with *emphasis*.\n")
        );

        const heading = rendered.content.querySelector("h1");
        expect(heading?.textContent).toBe("Heading");
        const paragraph = rendered.content.querySelector("p");
        expect(paragraph?.querySelector("em")?.textContent).toBe("emphasis");
        expect(rendered.title).toBe("Heading");
        expect(rendered.renderedAtEpochMs).toBe(1_700_000_000_000);
    });

    it("supports GitHub flavored markdown", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n")
        );

        expect(rendered.content.querySelectorAll("table th").length).toBe(2);
        expect(rendered.content.querySelectorAll("table td").length).toBe(2);
        expect(rendered.content.querySelectorAll("li").length).toBe(2);
        expect(rendered.content.querySelector("li input[type='checkbox']")).not.toBeNull();
    });

    it("recovers a GFM table when pasted rows have blank paragraph separators", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                "| District | Population |\n\n| --- | --- |\n\n| Huangpu | 2.5M |\n\n| Jing'an | 1.8M |\n\nAfter the table."
            )
        );

        expect(rendered.content.querySelectorAll("table th")).toHaveLength(2);
        expect(rendered.content.querySelectorAll("table tbody tr")).toHaveLength(2);
        expect(rendered.content.querySelector("p")?.textContent).toContain("After the table.");
    });

    it("renders GFM footnotes with a backlink", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                "A sentence with a note[^source].\n\n[^source]: Footnote detail.\n"
            )
        );

        expect(
            rendered.content.querySelector("sup a[href='#user-content-fn-source']")
        ).not.toBeNull();
        expect(rendered.content.querySelector("li#user-content-fn-source")?.textContent).toContain(
            "Footnote detail."
        );
        expect(rendered.content.querySelector("a[data-footnote-backref]")).not.toBeNull();
    });

    it("renders Typora front matter, TOC, alerts, emoji, and inline markup", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                [
                    "---",
                    "title: Example",
                    "---",
                    "# Guide",
                    "",
                    "[TOC]",
                    "",
                    "## Details",
                    "",
                    "==highlight== H~2~O x^2^ :smile:",
                    "",
                    "> [!NOTE]",
                    "> Keep this note."
                ].join("\n")
            )
        );

        expect(rendered.content.textContent).not.toContain("title: Example");
        expect(rendered.content.querySelector("h1#user-content-guide")).not.toBeNull();
        expect(
            rendered.content.querySelector("ul.markdown-toc a[href='#user-content-details']")
        ).not.toBeNull();
        expect(rendered.content.querySelector("mark")?.textContent).toBe("highlight");
        expect(rendered.content.querySelector("sub")?.textContent).toBe("2");
        expect(rendered.content.querySelector("sup")?.textContent).toBe("2");
        expect(rendered.content.textContent).toContain(String.fromCodePoint(0x1f604));
        expect(rendered.content.querySelector("blockquote.markdown-alert--note")).not.toBeNull();
    });

    it("renders inline, display, and fenced math with KaTeX", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                [
                    "Inline $x^2$ and \\(\\alpha\\).",
                    "",
                    "$$",
                    "\\frac{1}{2}",
                    "$$",
                    "",
                    "```math",
                    "\\sqrt{x}",
                    "```"
                ].join("\n")
            )
        );

        expect(rendered.content.querySelectorAll(".katex")).toHaveLength(4);
        expect(rendered.content.querySelector(".katex-mathml math")).not.toBeNull();
        expect(rendered.content.querySelector(".katex-mathml math")?.namespaceURI).toBe(
            "http://www.w3.org/1998/Math/MathML"
        );
        expect(rendered.content.textContent).toContain("x2");
    });

    it("loads KaTeX chemistry only for documents that use mhchem commands", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                "The reaction is $\\ce{H2O -> H+ + OH-}$. The mass is $$\\pu{2.5 kg}$$."
            )
        );

        expect(rendered.content.querySelectorAll(".katex")).toHaveLength(2);
        expect(rendered.content.querySelectorAll(".katex-error")).toHaveLength(0);
        expect(rendered.content.textContent).toContain("H2O");
        expect(rendered.content.textContent).toContain("2.5");
    });

    it("preserves KaTeX's generated dimensions for display-mode operator limits", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("\\[a \\cdot b = \\sum_{i=1}^{n} a_i b_i.\\]")
        );
        const math = rendered.content.querySelector<HTMLElement>(".katex-display .katex");
        const strut = math?.querySelector<HTMLElement>(".base .strut");
        const limitOffsets = Array.from(
            math?.querySelectorAll<HTMLElement>(
                ".op-limits > .vlist-t > .vlist-r > .vlist > span"
            ) ?? []
        ).map((row) => row.style.top);

        expect(strut?.style.height).not.toBe("");
        expect(limitOffsets.length).toBeGreaterThanOrEqual(3);
        expect(limitOffsets.slice(0, 3).every((offset) => offset.length > 0)).toBe(true);
        expect(new Set(limitOffsets.slice(0, 3)).size).toBe(3);
    });

    it("renders Pandoc raw TeX spans inside prose and display equations", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                [
                    "For vectors (a,b `\\in `{=tex}`\\mathbb{R}`{=tex}\\^n),",
                    "",
                    "\\[ a `\\cdot `{=tex}b = `\\sum`{=tex}\\_{i=1}\\^{n} a_i b_i. \\]"
                ].join("\n")
            )
        );

        expect(rendered.content.querySelectorAll(".katex")).toHaveLength(2);
        expect(rendered.content.querySelector(".katex-error")).toBeNull();
        expect(rendered.content.textContent).not.toContain("{=tex}");
        expect(rendered.content.querySelector(".katex-mathml annotation")?.textContent).toContain(
            "\\in"
        );
        expect(rendered.content.textContent).toContain("R");
    });

    it("recognizes a display equation copied with doubled delimiters", async () => {
        const slash = "\\\\";
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(`${slash}[x + y${slash}]`)
        );

        expect(rendered.content.querySelectorAll(".katex-display .katex")).toHaveLength(1);
    });

    it("renders double-escaped math blocks from copied Markdown and preserves their layout", async () => {
        const slash = "\\\\";
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                [
                    "For vectors (a,b `" +
                        slash +
                        "in `{=tex}`" +
                        slash +
                        "mathbb{R}`{=tex}" +
                        slash +
                        "^n),",
                    "",
                    slash +
                        "[ a `" +
                        slash +
                        "cdot `{=tex}b = `" +
                        slash +
                        "sum`{=tex}" +
                        slash +
                        "_{i=1}" +
                        slash +
                        "^{n} a_i b_i. " +
                        slash +
                        "]",
                    "",
                    slash +
                        "[ p" +
                        slash +
                        "_{t+1}=`" +
                        slash +
                        "alpha `{=tex}Pp_t+(1-`" +
                        slash +
                        "alpha`{=tex})u. " +
                        slash +
                        "]"
                ].join("\n")
            )
        );

        expect(rendered.content.querySelectorAll(".katex-display .katex")).toHaveLength(2);
        expect(rendered.content.querySelectorAll(".katex-error")).toHaveLength(0);
        expect(rendered.content.querySelectorAll(".katex-display .katex .katex-html")).toHaveLength(
            2
        );
        expect(rendered.content.textContent).not.toContain("{=tex}");
        expect(
            rendered.content.querySelector(
                ".katex-display annotation[encoding='application/x-tex']"
            )?.textContent
        ).toContain("\\cdot");
    });

    it("keeps currency as text and renders Typora chemistry and physics commands", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                "Price: $2 and $3 per item. Formula $\\ce{H2O}$ and derivative $\\dv{x^2}{x}$."
            )
        );

        expect(rendered.content.querySelectorAll(".katex")).toHaveLength(2);
        expect(rendered.content.querySelector(".katex-error")).toBeNull();
        expect(rendered.content.textContent).toContain("$2 and $3");
    });

    it("numbers labeled equations and resolves references", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("\\[x = 1 \\label{eq:first}\\]\n\nSee \\eqref{eq:first}.\n")
        );

        expect(rendered.content.querySelector(".katex-error")).toBeNull();
        expect(rendered.content.querySelector(".katex")?.textContent).toContain("1");
        expect(rendered.content.querySelector("p")?.textContent).toContain("(1)");
    });

    it("keeps unsupported formulas visible without stopping following blocks", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                "Bad formula $\\notARealCommand{x}$.\n\nFollowing paragraph.\n"
            )
        );

        expect(rendered.content.querySelector(".katex mstyle[mathcolor='#cc0000']")).not.toBeNull();
        expect(rendered.content.querySelector(".katex-html")?.textContent).toContain(
            "\\notARealCommand"
        );
        expect(rendered.content.textContent).toContain("Following paragraph.");
    });

    it("shows malformed TeX as an error and continues rendering", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("Malformed $\\frac{1}{$.\n\nStill rendered.\n")
        );

        expect(rendered.content.querySelector(".katex-error")).not.toBeNull();
        expect(rendered.content.textContent).toContain("Still rendered.");
    });

    it("renders Mermaid diagrams into local SVG", async () => {
        const rendered = await withSvgMeasurements(() =>
            createRenderer().render(
                MarkdownDocument.initial("```mermaid\nflowchart TD\nA[Start] --> B[Finish]\n```\n")
            )
        );

        const svg = rendered.content.querySelector("svg");
        expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
        expect(svg?.getAttribute("aria-label")).toBe("Diagram");
        expect(rendered.content.querySelector("script")).toBeNull();
    }, 20_000);

    it("converts Typora sequence and flowchart fences into local SVG", async () => {
        const source = [
            "```sequence",
            "Alice->Bob: Hello Bob",
            "Note right of Bob: Bob thinks",
            "Bob-->Alice: I am good",
            "```",
            "",
            "```flow",
            "st=>start: Start",
            "op=>operation: Operation",
            "cond=>condition: Yes or no?",
            "e=>end",
            "st->op->cond",
            "cond(yes)->e",
            "cond(no)->op",
            "```"
        ].join("\n");
        const rendered = await withSvgMeasurements(() =>
            createRenderer().render(MarkdownDocument.initial(source))
        );

        expect(rendered.content.querySelectorAll("svg.markdown-diagram")).toHaveLength(2);
        expect(rendered.content.querySelector(".diagram-error")).toBeNull();
    }, 20_000);

    it("preserves malformed diagram source and continues rendering", async () => {
        const rendered = await withSvgMeasurements(() =>
            createRenderer().render(
                MarkdownDocument.initial(
                    "```mermaid\nnot a valid diagram !!!\n```\n\nStill here.\n"
                )
            )
        );

        expect(rendered.content.querySelector(".diagram-error")).not.toBeNull();
        expect(rendered.content.textContent).toContain("not a valid diagram");
        expect(rendered.content.textContent).toContain("Still here.");
    }, 20_000);

    it("highlights code with monochrome class names", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("```js\nconst value = 1;\n```\n")
        );

        const code = rendered.content.querySelector("pre code");
        expect(code?.className).toContain("language-js");
        expect(code?.querySelector(".hljs-keyword")?.textContent).toBe("const");
    });

    it("sanitizes raw HTML while preserving safe markup", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial(
                '<script>alert(1)</script>\n\n<span style="color:red" onclick="alert(1)"><em>kept</em></span>\n'
            )
        );

        expect(rendered.content.querySelector("script")).toBeNull();
        expect(rendered.content.querySelector("em")?.textContent).toBe("kept");
        expect(rendered.content.textContent).not.toContain("alert(1)");
        expect(rendered.content.querySelector("span")?.hasAttribute("style")).toBe(false);
        expect(rendered.content.querySelector("span")?.hasAttribute("onclick")).toBe(false);
    });

    it("keeps links as links", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("[Docs](https://example.com)\n")
        );

        expect(rendered.content.querySelector("a")?.getAttribute("href")).toBe(
            "https://example.com"
        );
    });

    it("renders every copied equation in the Chinese-cities calculus sample", async () => {
        const source = await readFile("e2e/fixtures/chinese-cities-calculus.md", "utf8");
        const rendered = await createRenderer().render(MarkdownDocument.initial(source));
        const formulas = Array.from(
            rendered.content.querySelectorAll(".katex annotation[encoding='application/x-tex']")
        ).map((annotation) => annotation.textContent);

        expect(rendered.content.querySelectorAll(".katex-display .katex")).toHaveLength(6);
        expect(rendered.content.querySelectorAll(".katex")).toHaveLength(11);
        expect(rendered.content.querySelectorAll(".katex-error")).toHaveLength(0);
        expect(rendered.content.querySelectorAll(".katex-mathml math")).toHaveLength(11);
        expect(rendered.content.querySelector("table tbody tr")).not.toBeNull();
        expect(formulas[7]).toBe(" L=\\int_0^{2\\pi}\\|\\mathbf r'(t)\\|\\,dt=2\\pi R. ");
        expect(formulas[9]).toBe(" P(R)=2\\pi\\int_0^R rD_0e^{-kr}\\,dr. ");
    });
});

async function withSvgMeasurements<T>(run: () => Promise<T>): Promise<T> {
    const prototype = SVGElement.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, "getBBox");
    const originalTextLength = Object.getOwnPropertyDescriptor(prototype, "getComputedTextLength");
    Object.defineProperty(prototype, "getBBox", {
        configurable: true,
        value: () => ({ x: 0, y: 0, width: 120, height: 36 })
    });
    Object.defineProperty(prototype, "getComputedTextLength", {
        configurable: true,
        value: function (this: SVGElement): number {
            return (this.textContent?.length ?? 0) * 8;
        }
    });
    try {
        return await run();
    } finally {
        if (original === undefined) {
            Reflect.deleteProperty(prototype, "getBBox");
        } else {
            Object.defineProperty(prototype, "getBBox", original);
        }
        if (originalTextLength === undefined) {
            Reflect.deleteProperty(prototype, "getComputedTextLength");
        } else {
            Object.defineProperty(prototype, "getComputedTextLength", originalTextLength);
        }
    }
}
