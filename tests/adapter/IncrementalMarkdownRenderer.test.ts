import { describe, expect, it } from "vitest";

import { DirectDomWriter } from "../../src/adapter/renderer/DirectDomWriter";
import { IncrementalMarkdownRenderer } from "../../src/adapter/renderer/IncrementalMarkdownRenderer";
import { MarkdownDocument } from "../../src/domain/MarkdownDocument";
import type { Clock } from "../../src/port/Clock";

class FixedClock implements Clock {
    nowEpochMs(): number {
        return 1;
    }
}

function createRenderer(): IncrementalMarkdownRenderer {
    return new IncrementalMarkdownRenderer(new DirectDomWriter(), new FixedClock());
}

function nodesOf(rendered: { prefix: readonly ChildNode[]; content: Node }): ChildNode[] {
    return [...rendered.prefix, ...rendered.content.childNodes];
}

function textOf(rendered: { prefix: readonly ChildNode[]; content: Node }): string {
    return nodesOf(rendered)
        .map((node) => node.textContent ?? "")
        .join("|");
}

describe("IncrementalMarkdownRenderer", () => {
    it("reuses the frozen prefix nodes when appending", async () => {
        const renderer = createRenderer();
        const first = MarkdownDocument.initial(
            "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n"
        );
        const firstRendered = await renderer.render(first);
        const prefixBefore = [...firstRendered.content.childNodes];
        expect(prefixBefore.length).toBe(3);

        const appended = first.withSource(`${first.source}\n\nThird paragraph.\n`);
        const secondRendered = await renderer.renderIncremental(firstRendered, appended);

        // The first three nodes are the exact same objects, not copies.
        expect(secondRendered.prefix.length).toBe(3);
        expect(secondRendered.prefix[0]).toBe(prefixBefore[0]);
        expect(secondRendered.prefix[1]).toBe(prefixBefore[1]);
        expect(secondRendered.prefix[2]).toBe(prefixBefore[2]);

        // Only the new tail was re-parsed.
        expect(textOf(secondRendered)).toContain("Third paragraph.");
        expect(textOf(secondRendered)).toContain("Title");
    });

    it("falls back to a full render for an edit in the middle", async () => {
        const renderer = createRenderer();
        const first = MarkdownDocument.initial("# Title\n\nAlpha\n\nBeta\n");
        const firstRendered = await renderer.render(first);

        const edited = first.withSource("# Title\n\nAlpha edited\n\nBeta\n");
        const secondRendered = await renderer.renderIncremental(firstRendered, edited);

        expect(secondRendered.prefix.length).toBe(0);
        expect(textOf(secondRendered)).toContain("Alpha edited");
        expect(textOf(secondRendered)).toContain("Beta");
    });

    it("produces the same DOM as a full render", async () => {
        const source =
            "# Title\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
        const full = await createRenderer().render(MarkdownDocument.initial(source));

        const incremental = createRenderer();
        const head = MarkdownDocument.initial("# Title\n");
        const headRendered = await incremental.render(head);
        const appended = head.withSource(source);
        const tailRendered = await incremental.renderIncremental(headRendered, appended);

        const fullText = [...full.content.childNodes].map((node) => node.textContent).join("|");
        expect(textOf(tailRendered)).toBe(fullText);
    });

    it("keeps a heading with the content that follows it", async () => {
        const renderer = createRenderer();
        const first = MarkdownDocument.initial("Intro paragraph.\n");
        const firstRendered = await renderer.render(first);

        const second = first.withSource(`${first.source}\n\n## Section\n\nBody of section.\n`);
        const rendered = await renderer.renderIncremental(firstRendered, second);
        expect(textOf(rendered)).toContain("Section");
        expect(textOf(rendered)).toContain("Body of section.");
    });

    it("re-renders TOCs when appended headings change their document-wide links", async () => {
        const renderer = createRenderer();
        const first = MarkdownDocument.initial("[TOC]\n\n# First\n");
        const firstRendered = await renderer.render(first);
        const next = first.withSource(`${first.source}\n\n# Second\n`);

        const rendered = await renderer.renderIncremental(firstRendered, next);

        expect(rendered.prefix).toHaveLength(0);
        expect(
            [...rendered.content.querySelectorAll(".markdown-toc a")].map((link) =>
                link.getAttribute("href")
            )
        ).toEqual(["#user-content-first", "#user-content-second"]);
    });

    it("re-renders equation references when the labeled equation is in the prefix", async () => {
        const renderer = createRenderer();
        const first = MarkdownDocument.initial("\\[x = 1 \\label{eq:first}\\]\n");
        const firstRendered = await renderer.render(first);
        const next = first.withSource(`${first.source}\n\nSee \\eqref{eq:first}.\n`);

        const rendered = await renderer.renderIncremental(firstRendered, next);

        expect(rendered.prefix).toHaveLength(0);
        expect(rendered.content.querySelector("p")?.textContent).toContain("(1)");
    });

    it("re-renders footnotes so appended references keep document-wide numbering", async () => {
        const renderer = createRenderer();
        const first = MarkdownDocument.initial("First[^one].\n\n[^one]: First note.\n");
        const firstRendered = await renderer.render(first);
        const next = first.withSource(`${first.source}\n\nSecond[^two].\n\n[^two]: Second note.\n`);

        const rendered = await renderer.renderIncremental(firstRendered, next);

        expect(rendered.prefix).toHaveLength(0);
        expect(rendered.content.querySelectorAll("sup a[href^='#user-content-fn']")).toHaveLength(
            2
        );
        expect(rendered.content.querySelectorAll("li[id^='user-content-fn']")).toHaveLength(2);
    });

    it("re-renders reference links when the definition is appended after its use", async () => {
        const renderer = createRenderer();
        const first = MarkdownDocument.initial("[guide][later]\n");
        const firstRendered = await renderer.render(first);
        const next = first.withSource(first.source + "\n[later]: https://example.com/guide\n");

        const rendered = await renderer.renderIncremental(firstRendered, next);

        expect(rendered.prefix).toHaveLength(0);
        expect(rendered.content.querySelector("a")?.getAttribute("href")).toBe(
            "https://example.com/guide"
        );
    });

    it("re-renders reference links when the use is appended after its definition", async () => {
        const renderer = createRenderer();
        const first = MarkdownDocument.initial("[later]: https://example.com/guide\n\n");
        const firstRendered = await renderer.render(first);
        const next = first.withSource(first.source + "[Guide][later]\n");

        const rendered = await renderer.renderIncremental(firstRendered, next);

        expect(rendered.prefix).toHaveLength(0);
        expect(rendered.content.querySelector("a")?.getAttribute("href")).toBe(
            "https://example.com/guide"
        );
    });
});
