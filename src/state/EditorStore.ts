import { createSignal, type Accessor, type Setter } from "solid-js";

import { MarkdownDocument } from "../domain/MarkdownDocument";

export class EditorStore {
    readonly current: Accessor<MarkdownDocument>;

    private readonly setDocument: Setter<MarkdownDocument>;

    constructor() {
        const [document, setDocument] = createSignal(MarkdownDocument.initial());
        this.current = document;
        this.setDocument = setDocument;
    }

    update(source: string): void {
        this.setDocument((previous) => previous.withSource(source));
    }
}
