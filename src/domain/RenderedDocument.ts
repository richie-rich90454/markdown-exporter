// `content` is the DOM subtree the renderer produced, never an HTML string: the
// memory budget has no room for a serialize plus parse pair. `prefix` holds the
// nodes an incremental render proved unchanged, and `isEmpty` is snapshotted at
// construction because the preview re-parents the nodes when it mounts them.
export class RenderedDocument {
    readonly isEmpty: boolean;

    constructor(
        readonly content: DocumentFragment,
        readonly title: string,
        readonly renderedAtEpochMs: number,
        readonly prefix: readonly ChildNode[] = []
    ) {
        this.isEmpty = content.childNodes.length === 0 && prefix.length === 0;
    }
}
