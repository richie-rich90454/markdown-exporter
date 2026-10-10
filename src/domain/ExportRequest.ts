import type { ExportFormat } from "./ExportFormat";
import type { RenderedDocument } from "./RenderedDocument";

export class ExportRequest {
    constructor(
        readonly format: ExportFormat,
        readonly rendered: RenderedDocument,
        readonly title: string,
        // The live preview subtree, serialized by exporters that need HTML.
        readonly content: Node
    ) {}
}
