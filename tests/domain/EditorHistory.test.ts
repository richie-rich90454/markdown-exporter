import { describe, expect, it } from "vitest";
import { EditorHistory } from "../../src/domain/EditorHistory";

describe("shared source-based editor history", () => {
    it("groups adjacent typing into one undo action and redoes it", () => {
        const history = new EditorHistory("");

        expect(
            history.recordPatch(
                { from: 0, removed: "", inserted: "a" },
                {
                    kind: "typing",
                    timestamp: 100
                }
            )
        ).toBe(true);
        expect(
            history.recordPatch(
                { from: 1, removed: "", inserted: "b" },
                {
                    kind: "typing",
                    timestamp: 200
                }
            )
        ).toBe(true);
        expect(history.current()).toBe("ab");
        expect(history.retainedSteps()).toBe(2);

        expect(history.undo()).toBe("");
        expect(history.canRedo()).toBe(true);
        expect(history.redo()).toBe("ab");
        expect(history.undo()).toBe("");
    });

    it("groups backward deletion and restores the deleted text in order", () => {
        const history = new EditorHistory("abc");
        history.recordPatch(
            { from: 2, removed: "c", inserted: "" },
            {
                kind: "deletion",
                timestamp: 10
            }
        );
        history.recordPatch(
            { from: 1, removed: "b", inserted: "" },
            {
                kind: "deletion",
                timestamp: 20
            }
        );

        expect(history.current()).toBe("a");
        expect(history.undo()).toBe("abc");
        expect(history.redo()).toBe("a");
    });

    it("starts a separate typing group after an editor mode switch", () => {
        const history = new EditorHistory("");
        history.recordPatch(
            { from: 0, removed: "", inserted: "rich" },
            {
                kind: "typing",
                timestamp: 100
            }
        );

        history.breakGroup();
        history.recordPatch(
            { from: 4, removed: "", inserted: " source" },
            {
                kind: "typing",
                timestamp: 101
            }
        );

        expect(history.undo()).toBe("rich");
        expect(history.undo()).toBe("");
        expect(history.redo()).toBe("rich");
        expect(history.redo()).toBe("rich source");
    });

    it("applies and reverses a replacement patch", () => {
        const history = new EditorHistory("alpha");
        expect(
            history.recordPatch(
                { from: 0, removed: "alpha", inserted: "beta" },
                {
                    kind: "format",
                    timestamp: 1
                }
            )
        ).toBe(true);

        expect(history.undo()).toBe("alpha");
        expect(history.redo()).toBe("beta");
    });

    it("places external manuscript actions between earlier and later source edits", () => {
        const history = new EditorHistory("A source");
        history.recordPatch(
            { from: 8, removed: "", inserted: "!" },
            {
                kind: "typing",
                timestamp: 100
            }
        );
        history.recordExternalTransition("manuscript-replace-1", "A replacement!");
        history.recordPatch(
            { from: 14, removed: "", inserted: "?" },
            {
                kind: "typing",
                timestamp: 101
            }
        );

        expect(history.undoStep()).toEqual({ type: "source", source: "A replacement!" });
        expect(history.nextUndoStep()).toEqual({
            type: "external",
            actionId: "manuscript-replace-1"
        });
        expect(history.undoStep()).toEqual({
            type: "external",
            actionId: "manuscript-replace-1",
            source: "A source!"
        });
        expect(history.undo()).toBe("A source");

        expect(history.redoStep()).toEqual({ type: "source", source: "A source!" });
        expect(history.nextRedoStep()).toEqual({
            type: "external",
            actionId: "manuscript-replace-1"
        });
        expect(history.redoStep()).toEqual({
            type: "external",
            actionId: "manuscript-replace-1",
            source: "A replacement!"
        });
        expect(history.redo()).toBe("A replacement!?");
    });

    it("keeps external actions as grouping boundaries even when the active chapter is unchanged", () => {
        const history = new EditorHistory("");
        history.recordPatch(
            { from: 0, removed: "", inserted: "a" },
            { kind: "typing", timestamp: 1 }
        );
        history.recordExternalTransition("other-chapters-only", "a");
        history.recordPatch(
            { from: 1, removed: "", inserted: "b" },
            { kind: "typing", timestamp: 2 }
        );

        expect(history.undo()).toBe("a");
        expect(history.nextUndoStep()).toEqual({
            type: "external",
            actionId: "other-chapters-only"
        });
        expect(history.undoStep()).toEqual({
            type: "external",
            actionId: "other-chapters-only",
            source: "a"
        });
        expect(history.undo()).toBe("");
    });

    it("invalidates an undone external action when a new source edit is recorded", () => {
        const history = new EditorHistory("before");
        history.recordExternalTransition("replace-all-2", "after");
        expect(history.undoStep()).toMatchObject({
            type: "external",
            actionId: "replace-all-2",
            source: "before"
        });
        expect(history.canRedo()).toBe(true);

        history.recordPatch({ from: 6, removed: "", inserted: "!" }, { kind: "paste" });

        expect(history.canRedo()).toBe(false);
        expect(history.nextRedoStep()).toBeUndefined();
        expect(history.undo()).toBe("before");
        expect(history.nextUndoStep()).toBeUndefined();
    });

    it("charges retained project patches to the bounded history budget", () => {
        const history = new EditorHistory("a", { maxBytes: 80, maxSteps: 10 });
        history.recordExternalTransition("first", "b", 50);
        expect(history.hasExternalAction("first")).toBe(true);

        history.recordExternalTransition("second", "c", 50);

        expect(history.hasExternalAction("first")).toBe(false);
        expect(history.hasExternalAction("second")).toBe(true);
        expect(history.nextUndoStep()).toEqual({ type: "external", actionId: "second" });
        expect(history.retainedBytes()).toBeLessThanOrEqual(80);
    });

    it("clears both history stacks when a document is replaced", () => {
        const history = new EditorHistory("first");
        history.recordPatch({ from: 5, removed: "", inserted: " edit" }, { kind: "paste" });
        history.undo();
        expect(history.canRedo()).toBe(true);

        history.reset("second document");

        expect(history.current()).toBe("second document");
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);
        expect(history.retainedBytes()).toBe(0);
        expect(history.retainedSteps()).toBe(0);
    });

    it("resets safely when undo or redo receives a source outside its history", () => {
        const history = new EditorHistory("a");
        history.recordPatch({ from: 1, removed: "", inserted: "b" }, { kind: "paste" });

        expect(history.undo("external source")).toBeUndefined();
        expect(history.current()).toBe("external source");
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);

        history.recordPatch({ from: 14, removed: "", inserted: "!" }, { kind: "paste" });
        expect(history.redo("another external source")).toBeUndefined();
        expect(history.current()).toBe("another external source");
        expect(history.canUndo()).toBe(false);
    });

    it("evicts the oldest actions at the step and byte budgets", () => {
        const stepLimited = new EditorHistory("", { maxSteps: 2, maxBytes: 1024 });
        stepLimited.recordPatch({ from: 0, removed: "", inserted: "a" }, { kind: "paste" });
        stepLimited.recordPatch({ from: 1, removed: "", inserted: "b" }, { kind: "paste" });
        stepLimited.recordPatch({ from: 2, removed: "", inserted: "c" }, { kind: "paste" });
        expect(stepLimited.retainedSteps()).toBe(2);
        expect(stepLimited.undo()).toBe("ab");
        expect(stepLimited.undo()).toBe("a");
        expect(stepLimited.undo()).toBeUndefined();

        const byteLimited = new EditorHistory("", { maxSteps: 10, maxBytes: 30 });
        byteLimited.recordPatch({ from: 0, removed: "", inserted: "a" }, { kind: "paste" });
        byteLimited.recordPatch({ from: 1, removed: "", inserted: "b" }, { kind: "paste" });
        expect(byteLimited.retainedBytes()).toBeLessThanOrEqual(30);
        expect(byteLimited.retainedSteps()).toBe(1);
        expect(byteLimited.undo()).toBe("a");
        expect(byteLimited.undo()).toBeUndefined();
    });

    it("clears history when one edit exceeds the byte budget", () => {
        const history = new EditorHistory("start", { maxBytes: 32 });
        const largeText = "x".repeat(40);

        expect(
            history.recordPatch({ from: 5, removed: "", inserted: largeText }, { kind: "paste" })
        ).toBe(false);
        expect(history.current()).toBe(`start${largeText}`);
        expect(history.canUndo()).toBe(false);
        expect(history.retainedBytes()).toBe(0);
    });
});
