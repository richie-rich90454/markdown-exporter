import { beforeEach, describe, expect, it } from "vitest";

import { BrowserDraftRecovery } from "../../src/adapter/io/LocalDraftRecovery";

describe("LocalDraftRecovery", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("recovers a local draft after a reload", async () => {
        const source = "# Saved locally\n\nMath: $x^2$.";
        const recovery = new BrowserDraftRecovery();

        await recovery.save(source);
        const recovered = await recovery.load();

        expect(recovered?.source).toBe(source);
        expect(recovered?.savedAt).toBeGreaterThan(0);
    });
});
