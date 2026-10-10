import { describe, expect, it } from "vitest";

import { MarkdownDocument } from "../../src/domain/MarkdownDocument";

describe("MarkdownDocument", () => {
    it("starts at revision zero", () => {
        const document = MarkdownDocument.initial("# Title");
        expect(document.revision).toBe(0);
        expect(document.source).toBe("# Title");
    });

    it("returns a new instance on withSource", () => {
        const first = MarkdownDocument.initial("alpha");
        const second = first.withSource("beta");
        expect(second).not.toBe(first);
        expect(second.revision).toBe(1);
        expect(first.source).toBe("alpha");
        expect(second.source).toBe("beta");
    });

    it("keeps the same instance when the source is unchanged", () => {
        const first = MarkdownDocument.initial("alpha");
        expect(first.withSource("alpha")).toBe(first);
    });

    it("reports empty for blank sources", () => {
        expect(MarkdownDocument.initial("").isEmpty).toBe(true);
        expect(MarkdownDocument.initial("  \n\t").isEmpty).toBe(true);
        expect(MarkdownDocument.initial("a").isEmpty).toBe(false);
    });

    it("counts words without allocating", () => {
        expect(MarkdownDocument.initial("one two\nthree").wordCount).toBe(3);
        expect(MarkdownDocument.initial("   ").wordCount).toBe(0);
    });
});
