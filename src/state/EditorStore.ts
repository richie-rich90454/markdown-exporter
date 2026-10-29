import { createSignal, type Accessor, type Setter } from "solid-js";

import {
    EditorHistory,
    type EditorHistoryChangeKind,
    type EditorHistoryStepInfo,
    type EditorHistoryStepResult,
    type EditorHistoryPatch
} from "../domain/EditorHistory";
import { MarkdownDocument } from "../domain/MarkdownDocument";

export class EditorStore {
    readonly current: Accessor<MarkdownDocument>;

    private readonly setDocument: Setter<MarkdownDocument>;
    private readonly history = new EditorHistory("");

    constructor() {
        const [document, setDocument] = createSignal(MarkdownDocument.initial());
        this.current = document;
        this.setDocument = setDocument;
    }

    update(source: string, patch?: EditorHistoryPatch, kind?: EditorHistoryChangeKind): void {
        this.setDocument((previous) => {
            if (source === previous.source) return previous;

            if (this.history.current() !== previous.source) {
                this.history.reset(previous.source);
            }
            const recorded =
                patch === undefined
                    ? this.history.record(source, { ...(kind === undefined ? {} : { kind }) })
                    : this.history.recordPatch(patch, { ...(kind === undefined ? {} : { kind }) });
            if (!recorded && this.history.current() !== source) {
                // If an adapter supplied a stale or malformed patch, preserve
                // the edit with a safe diff instead of dropping its history.
                this.history.record(source, { ...(kind === undefined ? {} : { kind }) });
            }
            return previous.withSource(source);
        });
    }

    reset(source: string): void {
        this.history.reset(source);
        this.setDocument((previous) => previous.withSource(source));
    }

    /** Creates an undo grouping boundary without changing document history. */
    breakGroup(): void {
        this.history.breakGroup();
    }

    /** Records a book-wide action and moves this chapter's source in the same history step. */
    recordExternalTransition(
        actionId: string,
        nextSource: string,
        retainedPayloadBytes = 0
    ): boolean {
        const current = this.current();
        if (this.history.current() !== current.source) this.history.reset(current.source);
        const recorded = this.history.recordExternalTransition(
            actionId,
            nextSource,
            retainedPayloadBytes
        );
        this.setDocument((previous) => previous.withSource(nextSource));
        return recorded;
    }

    hasExternalAction(actionId: string): boolean {
        return this.history.hasExternalAction(actionId);
    }

    /** Describes the next undo action without changing the document. */
    nextUndoStep(): EditorHistoryStepInfo | undefined {
        return this.history.nextUndoStep();
    }

    /** Describes the next redo action without changing the document. */
    nextRedoStep(): EditorHistoryStepInfo | undefined {
        return this.history.nextRedoStep();
    }

    undo(): boolean {
        return this.undoStep() !== undefined;
    }

    /** Applies one history action and returns an external action ID when present. */
    undoStep(): EditorHistoryStepResult | undefined {
        const step = this.history.undoStep(this.current().source);
        if (step === undefined) return undefined;
        this.setDocument((previous) => previous.withSource(step.source));
        return step;
    }

    redo(): boolean {
        return this.redoStep() !== undefined;
    }

    /** Reapplies one history action and returns an external action ID when present. */
    redoStep(): EditorHistoryStepResult | undefined {
        const step = this.history.redoStep(this.current().source);
        if (step === undefined) return undefined;
        this.setDocument((previous) => previous.withSource(step.source));
        return step;
    }
}
