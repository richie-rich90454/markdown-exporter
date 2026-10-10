import { createSignal, type Accessor, type Setter } from "solid-js";

import type { RenderedDocument } from "../domain/RenderedDocument";

export class PreviewStore {
    readonly current: Accessor<RenderedDocument | null>;

    readonly isRendering: Accessor<boolean>;

    readonly renderDurationMs: Accessor<number>;

    readonly pageCount: Accessor<number>;

    readonly lastError: Accessor<string | null>;

    private readonly setRendered: Setter<RenderedDocument | null>;

    private readonly setRendering: Setter<boolean>;

    private readonly setDuration: Setter<number>;

    private readonly setPages: Setter<number>;

    private readonly setError: Setter<string | null>;

    constructor() {
        const [current, setRendered] = createSignal<RenderedDocument | null>(null);
        const [isRendering, setRendering] = createSignal(false);
        const [duration, setDuration] = createSignal(0);
        const [pages, setPages] = createSignal(0);
        const [error, setError] = createSignal<string | null>(null);
        this.current = current;
        this.setRendered = setRendered;
        this.isRendering = isRendering;
        this.setRendering = setRendering;
        this.renderDurationMs = duration;
        this.setDuration = setDuration;
        this.pageCount = pages;
        this.setPages = setPages;
        this.lastError = error;
        this.setError = setError;
    }

    beginRender(): void {
        this.setRendering(true);
        this.setError(null);
    }

    setRenderedDocument(document: RenderedDocument, durationMs: number): void {
        this.setRendered(document);
        this.setDuration(Math.round(durationMs));
        this.setRendering(false);
        this.setError(null);
    }

    fail(message: string): void {
        this.setRendering(false);
        this.setError(message);
    }

    setPageCount(count: number): void {
        this.setPages(count);
    }
}
