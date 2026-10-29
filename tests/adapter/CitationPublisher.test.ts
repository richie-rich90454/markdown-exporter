import { describe, expect, it } from "vitest";

import { sanitizeCitationHtml } from "../../src/adapter/exporter/CitationPublisher";

describe("CitationPublisher", () => {
    it("preserves citation formatting while stripping executable HTML and unsafe attributes", () => {
        const safe = sanitizeCitationHtml(
            '<div class="csl-entry attacker" onclick="alert(1)"><strong>A title</strong>' +
                '<a href="https://example.test/book" target="_blank">Book</a>' +
                '<a href="javascript:alert(1)">unsafe link</a><img src="x" onerror="alert(1)">' +
                "<script>alert(1)</script></div>"
        );
        const wrapper = document.createElement("div");
        wrapper.append(safe);

        expect(wrapper.querySelector(".csl-entry")).not.toBeNull();
        expect(wrapper.querySelector(".attacker")).toBeNull();
        expect(wrapper.querySelector("strong")?.textContent).toBe("A title");
        expect(
            wrapper.querySelector('a[href="https://example.test/book"]')?.getAttribute("rel")
        ).toBe("noopener noreferrer");
        expect(wrapper.querySelector('a[href^="javascript:"]')).toBeNull();
        expect(wrapper.querySelector("img,script")).toBeNull();
        expect(wrapper.textContent).toContain("unsafe link");
    });
});
