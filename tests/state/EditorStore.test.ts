import { describe, expect, it } from "vitest";

import { EditorStore } from "../../src/state/EditorStore";

describe("EditorStore shared history", () => {
    it("undoes and redoes edits from either editing surface through one source timeline", () => {
        const store = new EditorStore();
        store.reset("A chapter");
        store.update("A chapter in rich mode");
        store.update("A chapter in source mode");

        expect(store.undo()).toBe(true);
        expect(store.current().source).toBe("A chapter in rich mode");
        expect(store.undo()).toBe(true);
        expect(store.current().source).toBe("A chapter");
        expect(store.redo()).toBe(true);
        expect(store.current().source).toBe("A chapter in rich mode");
    });

    it("records CodeMirror patches without rescanning unchanged document text", () => {
        const store = new EditorStore();
        store.reset("A long existing paragraph");
        store.update("A long existing paragraph!", {
            from: "A long existing paragraph".length,
            removed: "",
            inserted: "!"
        }, "typing");

        expect(store.undo()).toBe(true);
        expect(store.current().source).toBe("A long existing paragraph");
    });

    it("records, inspects, undoes, and redoes an external manuscript transition", () => {
        const store = new EditorStore();
        store.reset("Chapter before");

        expect(store.recordExternalTransition("replace-all-17", "Chapter after")).toBe(true);
        expect(store.current().source).toBe("Chapter after");
        expect(store.nextUndoStep()).toEqual({ type: "external", actionId: "replace-all-17" });

        expect(store.undoStep()).toEqual({
            type: "external",
            actionId: "replace-all-17",
            source: "Chapter before"
        });
        expect(store.current().source).toBe("Chapter before");
        expect(store.nextRedoStep()).toEqual({ type: "external", actionId: "replace-all-17" });

        expect(store.redoStep()).toEqual({
            type: "external",
            actionId: "replace-all-17",
            source: "Chapter after"
        });
        expect(store.current().source).toBe("Chapter after");
    });

    it("keeps edits before and after a mode boundary as separate undo steps", () => {
        const store = new EditorStore();
        store.reset("");
        store.update("Rich draft", undefined, "typing");
        store.breakGroup();
        store.update("Rich draft in source mode", undefined, "typing");

        expect(store.undo()).toBe(true);
        expect(store.current().source).toBe("Rich draft");
        expect(store.undo()).toBe(true);
        expect(store.current().source).toBe("");
    });

    it("clears old history when a different file or chapter replaces the source", () => {
        const store = new EditorStore();
        store.reset("First file");
        store.update("First file edited");
        store.reset("Second file");

        expect(store.undo()).toBe(false);
        expect(store.current().source).toBe("Second file");
    });
});
