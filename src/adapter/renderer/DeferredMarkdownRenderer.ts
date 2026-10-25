import type { MarkdownDocument } from "../../domain/MarkdownDocument";
import type { RenderedDocument } from "../../domain/RenderedDocument";
import type { MarkdownRenderer } from "../../port/MarkdownRenderer";

export class DeferredMarkdownRenderer implements MarkdownRenderer {
    private rendererPromise: Promise<MarkdownRenderer> | undefined;

    constructor(private readonly loadRenderer: () => Promise<MarkdownRenderer>) {}

    async render(document: MarkdownDocument): Promise<RenderedDocument> {
        return (await this.renderer()).render(document);
    }

    async renderIncremental(
        previous: RenderedDocument,
        next: MarkdownDocument
    ): Promise<RenderedDocument> {
        return (await this.renderer()).renderIncremental(previous, next);
    }

    private renderer(): Promise<MarkdownRenderer> {
        this.rendererPromise ??= this.loadRenderer();
        return this.rendererPromise;
    }
}
