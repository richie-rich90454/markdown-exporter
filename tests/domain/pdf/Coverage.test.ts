import { describe, expect, it } from "vitest";

import { DirectDomWriter } from "../../../src/adapter/renderer/DirectDomWriter";
import { UnifiedMarkdownRenderer } from "../../../src/adapter/renderer/UnifiedMarkdownRenderer";
import { MarkdownDocument } from "../../../src/domain/MarkdownDocument";
import { marginPt, pageHeightPt, type PageSetup } from "../../../src/domain/PageSetup";
import { parseBlocks, type DrawOp } from "../../../src/domain/pdf/PdfLayout";
import { paginate } from "../../../src/domain/pdf/PdfPaginate";
import type { Clock } from "../../../src/port/Clock";

const SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

class FixedClock implements Clock {
    nowEpochMs(): number {
        return 1;
    }
}

const SOURCE = [
    "# Techtools",
    "",
    "Everything the build produces lands in one place: dist/ holds the binary.",
    "",
    "```bash",
    "npm run build",
    "npm start",
    "```",
    "",
    "Then open http://127.0.0.1:8080.",
    "",
    "| Command | Purpose |",
    "| --- | --- |",
    "| npm install | Installs the frontend workspace and the repository tooling. |",
    "| npm run build | Type-checks and bundles the frontend into dist/web. |",
    "| npm start | Runs dist/techtools with data/ and dist/web/. |",
    "",
    "## Configuration",
    "",
    "| Variable | Default |",
    "| --- | --- |",
    "| CATALOG_ADMIN_TOKEN | none; npm start falls back to a placeholder |",
    "| CATALOG_BIND | 127.0.0.1:8080 |",
    "",
    "The server refuses to boot without a token in production."
].join("\n");

function texts(page: readonly DrawOp[]): string[] {
    return page
        .filter((op): op is Extract<DrawOp, { kind: "text" }> => op.kind === "text")
        .map((op) => op.text);
}

async function layoutOf(): Promise<ReturnType<typeof paginate>> {
    const renderer = new UnifiedMarkdownRenderer(new DirectDomWriter(), new FixedClock());
    const rendered = await renderer.render(MarkdownDocument.initial(SOURCE));
    const host = document.createElement("div");
    for (const node of Array.from(rendered.content.childNodes)) {
        host.appendChild(node);
    }
    return paginate(parseBlocks(host), SETUP, new Map<string, boolean>());
}

describe("a document with code and tables", () => {
    it("keeps every block of the document on its pages", async () => {
        const layout = await layoutOf();
        const all = layout.pages.flatMap(texts).join(" ");

        for (const needle of [
            "Techtools",
            "Everything the build produces",
            "npm run build",
            "npm start",
            "Then open",
            "Command",
            "Purpose",
            "npm install",
            "Installs the frontend workspace",
            "Configuration",
            "Variable",
            "CATALOG_ADMIN_TOKEN",
            "CATALOG_BIND",
            "The server refuses to boot"
        ]) {
            expect(all, `missing: ${needle}`).toContain(needle);
        }
    });

    it("starts the first page at the top margin", async () => {
        const layout = await layoutOf();
        const top = pageHeightPt(SETUP) - marginPt(SETUP);
        const first = texts(layout.pages[0] ?? [])[0];
        expect(first).toContain("Techtools");
        const firstOp = (layout.pages[0] ?? []).find(
            (op): op is Extract<DrawOp, { kind: "text" }> =>
                op.kind === "text" && op.text.includes("Techtools")
        );
        const headingLine = 11 * Math.pow(1.25, 3) * SETUP.lineHeight;
        expect(firstOp?.y).toBeCloseTo(top - headingLine, 1);
    });
});
