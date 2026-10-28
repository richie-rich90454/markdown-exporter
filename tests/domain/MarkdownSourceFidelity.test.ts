import { describe, expect, it } from "vitest";
import { preserveMarkdownSource } from "../../src/domain/MarkdownSourceFidelity";

describe("rich-editor Markdown source fidelity", () => {
    it("keeps unchanged authored blocks byte-for-byte while accepting an edited block", () => {
        const original = "A setext title\n===============\n\nA  carefully wrapped\nparagraph.\n\nKeep this *emphasis* exactly.";
        const baseline = "# A setext title\n\nA carefully wrapped paragraph.\n\nKeep this *emphasis* exactly.";
        const current = "# A setext title\n\nA carefully wrapped paragraph, revised.\n\nKeep this *emphasis* exactly.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "A setext title\n===============\n\nA carefully wrapped paragraph, revised.\n\nKeep this *emphasis* exactly."
        );
    });

    it("retains front matter, footnote definitions, and directives omitted by the rich schema", () => {
        const original = [
            "---\ntitle: Field Notes\nauthor: A. Writer\n---",
            "# Chapter one",
            "Text with a note.[^source]",
            "[^source]: Primary source, 2026.",
            "::: warning\nKeep this author callout.\n:::"
        ].join("\n\n");
        const baseline = "# Chapter one\n\nText with a note.[^source]";
        const current = "# Chapter one\n\nRevised text with a note.[^source]";

        const result = preserveMarkdownSource(original, baseline, current);
        expect(result).toContain("---\ntitle: Field Notes\nauthor: A. Writer\n---");
        expect(result).toContain("[^source]: Primary source, 2026.");
        expect(result).toContain("::: warning\nKeep this author callout.\n:::");
        expect(result).toContain("Revised text with a note.");
    });

    it("does not duplicate opaque syntax that the rich serializer kept", () => {
        const original = "# Chapter\n\n<!-- editor note -->\n\nBody.";
        const serialized = "# Chapter\n\n<!-- editor note -->\n\nBody.";
        expect(preserveMarkdownSource(original, serialized, serialized).match(/editor note/g)).toHaveLength(1);
    });
});
