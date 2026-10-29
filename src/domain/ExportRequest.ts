import type { ExportFormat } from "./ExportFormat";
import type { PageSetup } from "./PageSetup";
import type { RenderedDocument } from "./RenderedDocument";
import type { BookProject } from "./BookProject";

export class ExportRequest {
    constructor(
        readonly format: ExportFormat,
        readonly rendered: RenderedDocument,
        readonly title: string,
        // The live preview subtree, serialized or re-laid-out by exporters.
        readonly content: Node,
        readonly pageSetup: PageSetup,
        readonly bookProject?: BookProject,
        readonly renderSource?: (source: string) => Promise<Node>,
        readonly isBookProject: boolean = bookProject !== undefined
    ) {}
}
