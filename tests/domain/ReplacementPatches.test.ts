import { describe, expect, it } from "vitest";

import { applyReplacementPatches, findReplacementPatches } from "../../src/domain/ReplacementPatches";

describe("manuscript replacement patches", () => {
    it("undoes and redoes repeated replacements whose lengths change offsets", () => {
        const source = "North star, north star, NORTH star.";
        const patches = findReplacementPatches(source, "north star", "a much longer phrase");
        const replaced = applyReplacementPatches(source, patches, true);

        expect(replaced).toBe("a much longer phrase, a much longer phrase, a much longer phrase.");
        expect(applyReplacementPatches(replaced ?? "", patches, false)).toBe(source);
        expect(applyReplacementPatches(source, patches, true)).toBe(replaced);
    });

    it("treats search terms as literal text and safely returns no patches for an empty query", () => {
        expect(findReplacementPatches("a+b a+b", "a+b", "sum")).toEqual([
            { from: 0, removed: "a+b", inserted: "sum" },
            { from: 4, removed: "a+b", inserted: "sum" }
        ]);
        expect(findReplacementPatches("anything", "", "x")).toEqual([]);
    });

    it("does not apply an inverse when the document no longer matches the recorded replacements", () => {
        const patches = findReplacementPatches("one one", "one", "two");

        expect(applyReplacementPatches("two changed", patches, false)).toBeUndefined();
        expect(applyReplacementPatches("one one", patches, false)).toBeUndefined();
    });
});
