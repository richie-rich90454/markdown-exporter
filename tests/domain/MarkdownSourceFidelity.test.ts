import { describe, expect, it } from "vitest";
import { preserveMarkdownSource } from "../../src/domain/MarkdownSourceFidelity";

describe("rich-editor Markdown source fidelity", () => {
    it("keeps unchanged authored blocks byte-for-byte while accepting an edited block", () => {
        const original =
            "A setext title\n===============\n\nA  carefully wrapped\nparagraph.\n\nKeep this *emphasis* exactly.";
        const baseline =
            "# A setext title\n\nA carefully wrapped paragraph.\n\nKeep this *emphasis* exactly.";
        const current =
            "# A setext title\n\nA carefully wrapped paragraph, revised.\n\nKeep this *emphasis* exactly.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "A setext title\n===============\n\nA carefully wrapped paragraph, revised.\n\nKeep this *emphasis* exactly."
        );
    });

    it("retains front matter, footnote definitions, and directives omitted by the rich schema", () => {
        const original = [
            "---\ntitle: Field Notes\n\nauthor: A. Writer\n---",
            "# Chapter one",
            "Text with a note.[^source]",
            "[^source]: Primary source, 2026.",
            "::: warning\nKeep this author callout.\n:::"
        ].join("\n\n");
        const baseline = "# Chapter one\n\nText with a note.[^source]";
        const current = "# Chapter one\n\nRevised text with a note.[^source]";

        const result = preserveMarkdownSource(original, baseline, current);
        expect(result).toContain("---\ntitle: Field Notes\n\nauthor: A. Writer\n---");
        expect(result).toContain("[^source]: Primary source, 2026.");
        expect(result).toContain("::: warning\nKeep this author callout.\n:::");
        expect(result).toContain("Revised text with a note.");
    });

    it("does not duplicate opaque syntax that the rich serializer kept", () => {
        const original = "# Chapter\n\n<!-- editor note -->\n\nBody.";
        const serialized = "# Chapter\n\n<!-- editor note -->\n\nBody.";
        expect(
            preserveMarkdownSource(original, serialized, serialized).match(/editor note/g)
        ).toHaveLength(1);
    });

    it("preserves an unsupported wiki link when the surrounding paragraph is edited", () => {
        const original = "Read [[field-notes|the field notes]] before continuing.";
        const baseline = "Read the field notes before continuing.";
        const current = "Please read the field notes before continuing today.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "Please read [[field-notes|the field notes]] before continuing today."
        );
    });

    it("restores an escaped wiki link when nearby source is edited", () => {
        const original =
            "Read [[field-notes|the field notes]] before continuing<!-- author note -->.";
        const baseline = "Read \\[\\[field-notes|the field notes]] before continuing.";
        const current = "Please Read \\[\\[field-notes|the field notes]] before continuing.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "Please Read [[field-notes|the field notes]] before continuing<!-- author note -->."
        );
    });

    it("keeps a wiki link after a whole-paragraph rewrite when the baseline escaped it", () => {
        const original = "Original prose [[private-page]] with no stable words.";
        const baseline = "Original prose \\[\\[private-page]] with no stable words.";
        const current = "Entirely rewritten wording.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "Entirely [[private-page]] rewritten wording."
        );
    });

    it("anchors inline comments and attribute syntax to surviving paragraph text", () => {
        const original = "We can retain<!-- author note --> this sentence{.smallcaps}.";
        const baseline = "We can retain this sentence.";
        const current = "We can preserve this sentence.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "We can<!-- author note --> preserve this sentence{.smallcaps}."
        );
    });

    it("keeps an inline citation attached to its surviving sentence when nearby wording changes", () => {
        const original = "The claim is strongly supported [@smith2024] by the evidence.";
        const baseline = "The claim is strongly supported by the evidence.";
        const current = "The claim is now strongly supported by the evidence.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "The claim is now strongly supported [@smith2024] by the evidence."
        );
    });

    it("keeps an unanchorable inline token near its authored position after a full rewrite", () => {
        const original = "Original phrase [[private-page]] with no stable words.";
        const baseline = "Original phrase private-page with no stable words.";
        const current = "Entirely rewritten wording.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "Entirely [[private-page]] rewritten wording."
        );
    });

    it("keeps untouched mixed line endings and anchors omitted HTML and reference definitions", () => {
        const original = [
            "Opening paragraph.",
            "",
            '[source]: https://example.test/source "Primary source"',
            "",
            "<details>",
            "<summary>Author note</summary>",
            "Keep this block even when the rich schema cannot model it.",
            "</details>",
            "",
            "Closing paragraph."
        ]
            .join("\r\n")
            .replace("Opening paragraph.\r\n\r\n[source]", "Opening paragraph.\n\n[source]");
        const baseline = "Opening paragraph.\n\nClosing paragraph.";
        const current = "Revised opening paragraph.\n\nClosing paragraph.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            'Revised opening paragraph.\n\n[source]: https://example.test/source "Primary source"' +
                "\r\n\r\n<details>\r\n<summary>Author note</summary>\r\n" +
                "Keep this block even when the rich schema cannot model it.\r\n</details>\r\n\r\n" +
                "Closing paragraph."
        );
    });

    it("preserves original line endings around an edited block and at document boundaries", () => {
        const original = "\r\n# Chapter\r\n\r\nFirst paragraph.\n\nSecond paragraph.\r\n";
        const baseline = "# Chapter\n\nFirst paragraph.\n\nSecond paragraph.";
        const current = "# Chapter\n\nFirst paragraph revised.\n\nSecond paragraph.";

        expect(preserveMarkdownSource(original, baseline, current)).toBe(
            "\r\n# Chapter\r\n\r\nFirst paragraph revised.\n\nSecond paragraph.\r\n"
        );
    });
});
