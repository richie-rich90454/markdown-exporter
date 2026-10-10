import type { Root as HastRoot } from "hast";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import type { MarkdownDocument } from "../../domain/MarkdownDocument";
import { RenderedDocument } from "../../domain/RenderedDocument";
import type { Clock } from "../../port/Clock";
import type { DomRenderer } from "../../port/DomRenderer";
import type { MarkdownRenderer } from "../../port/MarkdownRenderer";

// rehype-highlight emits <code class="language-x"> and <span class="hljs-*">,
// which the GitHub schema would strip, so both are re-allowed here.
const sanitizeSchema: SanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        code: [["className", /^language-/]],
        span: [["className", /^hljs-/]]
    }
};

function createProcessor() {
    return unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeSanitize, sanitizeSchema)
        .use(rehypeHighlight);
}

export class UnifiedMarkdownRenderer implements MarkdownRenderer {
    protected readonly processor = createProcessor();

    constructor(
        protected readonly domWriter: DomRenderer,
        protected readonly clock: Clock
    ) {}

    async render(document: MarkdownDocument): Promise<RenderedDocument> {
        const hast = await this.toHast(document.source);
        const content = this.domWriter.renderFragment(hast);
        return new RenderedDocument(
            content,
            titleOfSource(document.source),
            this.clock.nowEpochMs()
        );
    }

    async renderIncremental(
        previous: RenderedDocument,
        next: MarkdownDocument
    ): Promise<RenderedDocument> {
        return this.render(next);
    }

    protected async toHast(source: string): Promise<HastRoot> {
        const mdast = this.processor.parse(source);
        const hast = await this.processor.run(mdast);
        // remark-rehype keeps the blank lines between blocks as root level
        // whitespace text nodes. They carry no content and would break the
        // one node per top level block mapping the paginator and the
        // incremental renderer rely on.
        hast.children = hast.children.filter(
            (child) => !(child.type === "text" && child.value.trim().length === 0)
        );
        return hast;
    }
}

export function titleOfSource(source: string): string {
    let offset = 0;
    while (offset < source.length) {
        const newline = source.indexOf("\n", offset);
        const lineEnd = newline === -1 ? source.length : newline;
        const line = source.slice(offset, lineEnd).trim();
        const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading !== null) {
            const title = heading[1] ?? "";
            return title.replace(/[*_`~]/g, "").trim();
        }
        if (newline === -1) {
            break;
        }
        offset = newline + 1;
    }
    return "";
}
