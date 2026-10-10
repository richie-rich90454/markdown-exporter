import type { Root as HastRoot } from "hast";

import type { MarkdownDocument } from "../../domain/MarkdownDocument";
import { RenderedDocument } from "../../domain/RenderedDocument";
import { titleOfSource, UnifiedMarkdownRenderer } from "./UnifiedMarkdownRenderer";

const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const BLOCK_QUOTE = /^\s*>/;

export class IncrementalMarkdownRenderer extends UnifiedMarkdownRenderer {
    private frozenSource = "";
    private frozenNodes: readonly ChildNode[] = [];

    override async render(document: MarkdownDocument): Promise<RenderedDocument> {
        const rendered = await super.render(document);
        this.frozenSource = document.source;
        this.frozenNodes = [...rendered.content.childNodes];
        return rendered;
    }

    override async renderIncremental(
        previous: RenderedDocument,
        next: MarkdownDocument
    ): Promise<RenderedDocument> {
        if (
            !previous.isEmpty &&
            this.frozenNodes.length > 0 &&
            next.source.startsWith(this.frozenSource) &&
            next.source.length > this.frozenSource.length
        ) {
            const incremental = await this.renderTail(next);
            if (incremental !== null) {
                return incremental;
            }
        }
        return this.render(next);
    }

    /**
     * Re-parses only the unstable tail and reuses the frozen prefix nodes.
     *
     * `content` holds just the tail nodes; `prefix` holds the nodes that stay
     * identical. Both arrays are handed to the caller so no DOM node is
     * detached until the new content is actually accepted.
     */
    private async renderTail(next: MarkdownDocument): Promise<RenderedDocument | null> {
        const boundary = findStableBoundary(next.source);
        const tailStart = this.frozenSource.length;
        if (boundary <= tailStart) {
            return null;
        }
        const hast = await this.toHast(next.source.slice(tailStart));
        // How many tail blocks are now inside the frozen prefix. Zero is a
        // normal outcome: the new blank line starts a block that is still
        // being typed, so the freeze point simply does not move.
        const frozenCount = Math.min(
            countBlocksEndingBefore(hast, boundary - tailStart),
            hast.children.length
        );

        const tailNodes = [...this.domWriter.renderFragment(hast).childNodes];
        const prefix = [...this.frozenNodes, ...tailNodes.slice(0, frozenCount)];
        const content = document.createDocumentFragment();
        for (const node of tailNodes.slice(frozenCount)) {
            content.appendChild(node);
        }

        if (frozenCount > 0) {
            this.frozenSource = next.source.slice(0, boundary);
            this.frozenNodes = prefix;
        }
        return new RenderedDocument(
            content,
            titleOfSource(next.source),
            this.clock.nowEpochMs(),
            prefix
        );
    }
}

function countBlocksEndingBefore(hast: HastRoot, offset: number): number {
    let count = 0;
    for (const child of hast.children) {
        const end = child.position?.end?.offset;
        if (end === undefined || end > offset) {
            break;
        }
        count += 1;
    }
    return count;
}

function fenceMarker(line: string): string | null {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    return match === null ? null : (match[1] ?? "");
}

/**
 * Offset of the start of the last top-level block that is safe to freeze.
 *
 * ponytail: line-based heuristic (balanced fences, no list/blockquote joins).
 * It only ever moves the freeze point; a wrong guess costs a full re-render,
 * never a wrong render, because the guards reject the ambiguous cases.
 */
function findStableBoundary(source: string): number {
    let boundary = 0;
    let fencesOpen = false;
    let offset = 0;
    let previous = "";
    while (offset < source.length) {
        const newline = source.indexOf("\n", offset);
        const lineEnd = newline === -1 ? source.length : newline;
        const line = source.slice(offset, lineEnd);
        const nextStart = newline === -1 ? source.length : newline + 1;
        const marker = fenceMarker(line);

        if (line.trim().length === 0 && !fencesOpen && nextStart < source.length) {
            const afterNewline = source.indexOf("\n", nextStart);
            const nextEnd = afterNewline === -1 ? source.length : afterNewline;
            const next = source.slice(nextStart, nextEnd);
            if (isStableJoin(previous, next)) {
                boundary = nextStart;
            }
        }
        if (marker !== null) {
            fencesOpen = !fencesOpen;
        }
        previous = line;
        offset = nextStart;
    }
    return boundary;
}

function isStableJoin(previous: string, next: string): boolean {
    if (LIST_ITEM.test(previous) || LIST_ITEM.test(next)) {
        // A blank line between list items keeps one list in CommonMark.
        return false;
    }
    if (BLOCK_QUOTE.test(previous) || BLOCK_QUOTE.test(next)) {
        // A blank line inside a blockquote keeps one blockquote.
        return false;
    }
    return fenceMarker(previous) === null && fenceMarker(next) === null;
}
