import { RenderedDocument } from "../domain/RenderedDocument";
import type { MarkdownDocument } from "../domain/MarkdownDocument";
import type { Clock } from "../port/Clock";
import type { MarkdownRenderer } from "../port/MarkdownRenderer";

export class EditorController {
    constructor(
        private readonly renderer: MarkdownRenderer,
        private readonly clock: Clock
    ) {}

    async render(source: MarkdownDocument): Promise<RenderedDocument> {
        if (source.isEmpty) {
            return new RenderedDocument(
                document.createDocumentFragment(),
                "",
                this.clock.nowEpochMs()
            );
        }
        return this.renderer.render(source);
    }

    async renderIncremental(
        previous: RenderedDocument,
        next: MarkdownDocument
    ): Promise<RenderedDocument> {
        if (next.isEmpty || previous.isEmpty) {
            return this.render(next);
        }
        return this.renderer.renderIncremental(previous, next);
    }
}
