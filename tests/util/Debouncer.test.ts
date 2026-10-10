import { describe, expect, it } from "vitest";

import { Debouncer } from "../../src/util/Debouncer";

describe("Debouncer", () => {
    it("fires once after the delay", async () => {
        let calls = 0;
        const debouncer = new Debouncer(5, () => {
            calls += 1;
        });
        debouncer.schedule();
        debouncer.schedule();
        debouncer.schedule();
        expect(debouncer.isPending).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(calls).toBe(1);
        expect(debouncer.isPending).toBe(false);
    });

    it("can be cancelled", async () => {
        let calls = 0;
        const debouncer = new Debouncer(5, () => {
            calls += 1;
        });
        debouncer.schedule();
        debouncer.cancel();
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(calls).toBe(0);
    });
});
