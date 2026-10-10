/**
 * The rendered document.
 *
 * ponytail: `content` is a DOM node subtree, not an HTML string. The project
 * memory model forbids the rehype-stringify copy, so the renderer hands the
 * hast to a DomRenderer adapter and the fragment is carried here untouched.
 * `prefix` carries nodes an incremental render proved unchanged; the caller
 * keeps them attached until it commits the new content.
 *
 * `isEmpty` is a snapshot taken at construction. The preview moves the
 * children out of `content` when it mounts them, so a live query would turn
 * non-empty documents empty the moment they are displayed.
 */
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
