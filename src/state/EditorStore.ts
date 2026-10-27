import { createSignal, type Accessor, type Setter } from "solid-js";

import { MarkdownDocument } from "../domain/MarkdownDocument";

export class EditorStore {
    readonly current: Accessor<MarkdownDocument>;

    private readonly setDocument: Setter<MarkdownDocument>;
    private history: string[] = [""];
    private historyIndex = 0;
    private lastEditAt = 0;

    constructor() {
        const [document, setDocument] = createSignal(MarkdownDocument.initial());
        this.current = document;
        this.setDocument = setDocument;
    }

    update(source: string): void {
        this.setDocument((previous) => {
            if (source === previous.source) return previous;
            const now = Date.now();
            if (this.historyIndex < this.history.length - 1) {
                this.history = this.history.slice(0, this.historyIndex + 1);
            }
            if (now - this.lastEditAt < 750 && this.historyIndex > 0) {
                this.history[this.historyIndex] = source;
            } else {
                this.history.push(source);
                this.historyIndex = this.history.length - 1;
            }
            this.lastEditAt = now;
            return previous.withSource(source);
        });
    }

    reset(source: string): void {
        this.history = [source];
        this.historyIndex = 0;
        this.lastEditAt = 0;
        this.setDocument((previous) => previous.withSource(source));
    }

    undo(): boolean {
        if (this.historyIndex === 0) return false;
        this.historyIndex -= 1;
        this.restoreHistoryEntry();
        return true;
    }

    redo(): boolean {
        if (this.historyIndex >= this.history.length - 1) return false;
        this.historyIndex += 1;
        this.restoreHistoryEntry();
        return true;
    }

    private restoreHistoryEntry(): void {
        const source = this.history[this.historyIndex] ?? "";
        this.lastEditAt = 0;
        this.setDocument((previous) => previous.withSource(source));
    }
}
