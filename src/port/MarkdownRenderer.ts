import type { MarkdownDocument } from "../domain/MarkdownDocument";
import type { RenderedDocument } from "../domain/RenderedDocument";

export interface MarkdownRenderer {
    render(document: MarkdownDocument): Promise<RenderedDocument>;
    renderIncremental(
        previous: RenderedDocument,
        next: MarkdownDocument
    ): Promise<RenderedDocument>;
}
