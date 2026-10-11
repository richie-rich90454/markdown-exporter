import type { ExportFormat } from "./ExportFormat";
import type { PageSetup } from "./PageSetup";
import type { RenderedDocument } from "./RenderedDocument";

export class ExportRequest {
    constructor(
        readonly format: ExportFormat,
        readonly rendered: RenderedDocument,
        readonly title: string,
        // The live preview subtree, serialized or re-laid-out by exporters.
        readonly content: Node,
        readonly pageSetup: PageSetup
    ) {}
}
