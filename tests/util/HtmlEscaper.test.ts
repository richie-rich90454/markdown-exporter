import { describe, expect, it } from "vitest";

import { HtmlEscaper } from "../../src/util/HtmlEscaper";

describe("HtmlEscaper", () => {
    it("escapes the five significant characters", () => {
        expect(HtmlEscaper.escape(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    });

    it("returns the input untouched when nothing needs escaping", () => {
        expect(HtmlEscaper.escape("plain text")).toBe("plain text");
    });
});
