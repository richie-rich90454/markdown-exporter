import { describe, expect, it } from "vitest";

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

    it("highlights code with monochrome class names", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("```js\nconst value = 1;\n```\n")
        );

        const code = rendered.content.querySelector("pre code");
        expect(code?.className).toContain("language-js");
        expect(code?.querySelector(".hljs-keyword")?.textContent).toBe("const");
    });

    it("drops raw HTML instead of injecting it", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("<script>alert(1)</script>\n\n<em>kept</em>\n")
        );

        expect(rendered.content.querySelector("script")).toBeNull();
        expect(rendered.content.querySelector("em")).toBeNull();
        expect(rendered.content.textContent).not.toContain("alert(1)");
    });

    it("keeps links as links", async () => {
        const rendered = await createRenderer().render(
            MarkdownDocument.initial("[Docs](https://example.com)\n")
        );

        expect(rendered.content.querySelector("a")?.getAttribute("href")).toBe(
            "https://example.com"
        );
    });
});
