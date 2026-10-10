import { describe, expect, it } from "vitest";

import { EditorController } from "../../src/application/EditorController";
import { MarkdownDocument } from "../../src/domain/MarkdownDocument";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { Clock } from "../../src/port/Clock";
import type { MarkdownRenderer } from "../../src/port/MarkdownRenderer";

class FixedClock implements Clock {
    nowEpochMs(): number {
        return 42;
    }
}

class StubRenderer implements MarkdownRenderer {
    readonly calls: string[] = [];
    failNext = false;

    render(document: MarkdownDocument): Promise<RenderedDocument> {
        this.calls.push(`render:${document.revision}`);
        if (this.failNext) {
            return Promise.reject(new Error("Line 3: unexpected token"));
        }
        return Promise.resolve(this.documentFor(document));
    }

    renderIncremental(
        previous: RenderedDocument,
        next: MarkdownDocument
    ): Promise<RenderedDocument> {
        this.calls.push(`incremental:${next.revision}`);
        return Promise.resolve(this.documentFor(next));
    }

    private documentFor(source: MarkdownDocument): RenderedDocument {
        const fragment = document.createDocumentFragment();
        const element = document.createElement("p");
        element.textContent = source.source;
        fragment.appendChild(element);
        return new RenderedDocument(fragment, source.source, 7);
    }
}

function createController(renderer: MarkdownRenderer): EditorController {
    return new EditorController(renderer, new FixedClock());
}

describe("EditorController", () => {
    it("handles the empty document itself", async () => {
        const renderer = new StubRenderer();
        const rendered = await createController(renderer).render(MarkdownDocument.initial("   "));

        expect(rendered.isEmpty).toBe(true);
        expect(rendered.title).toBe("");
        expect(rendered.renderedAtEpochMs).toBe(42);
        expect(renderer.calls).toEqual([]);
    });

    it("delegates real documents to the renderer", async () => {
        const renderer = new StubRenderer();
        const rendered = await createController(renderer).render(MarkdownDocument.initial("# Hi"));

        expect(renderer.calls).toEqual(["render:0"]);
        expect(rendered.content.querySelector("p")?.textContent).toBe("# Hi");
    });

    it("uses the incremental path only for non-empty documents", async () => {
        const renderer = new StubRenderer();
        const controller = createController(renderer);
        const source = MarkdownDocument.initial("# Hi");
        const first = await controller.render(source);
        const second = await controller.renderIncremental(first, source.withSource("# Hi\nthere"));

        expect(renderer.calls).toEqual(["render:0", "incremental:1"]);
        expect(second.content.querySelector("p")?.textContent).toBe("# Hi\nthere");

        const blank = MarkdownDocument.initial(" ");
        const empty = await controller.renderIncremental(second, blank);
        expect(empty.isEmpty).toBe(true);
        expect(renderer.calls).toEqual(["render:0", "incremental:1"]);
    });
});
