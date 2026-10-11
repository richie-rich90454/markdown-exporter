import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DirectDomWriter } from "../../../src/adapter/renderer/DirectDomWriter";
import { UnifiedMarkdownRenderer } from "../../../src/adapter/renderer/UnifiedMarkdownRenderer";
import { MarkdownDocument } from "../../../src/domain/MarkdownDocument";
import { marginPt, pageHeightPt, pageWidthPt, type PageSetup } from "../../../src/domain/PageSetup";
import { parseBlocks, type DrawOp } from "../../../src/domain/pdf/PdfLayout";
import { textWidth } from "../../../src/domain/pdf/PdfMetrics";
import { paginate } from "../../../src/domain/pdf/PdfPaginate";
import { writePdf } from "../../../src/domain/pdf/PdfWriter";
import type { Clock } from "../../../src/port/Clock";

const SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

const LEFT = marginPt(SETUP);
const RIGHT = pageWidthPt(SETUP) - marginPt(SETUP);
const TOP = pageHeightPt(SETUP) - marginPt(SETUP);
const BOTTOM = marginPt(SETUP);

class FixedClock implements Clock {
    nowEpochMs(): number {
        return 1;
    }
}

// A long document in the shape of a real essay: paragraphs that mix emphasis,
// numbered sections with sub-points, quotes, code and a closing paragraph.
const SOURCE = `Yes. The problem you are describing is extremely common in AP Lang, and I think the fix is less about "making your thesis sound smarter" and more about changing how you generate the argument in the first *place*.

The biggest issue is probably this: you are treating the two reasons as two pieces of evidence for the same idea instead of two different **functions** within one argument. And then "complexity" gets bolted onto the end as a vague sentence like "Ultimately, this demonstrates that people must balance growth with responsibility."

That produces exactly the kind of thesis that sounds sophisticated but does not actually interpret the quote.

## 1. Stop writing the thesis first

When you get a quote, do not immediately think: "Okay, what are my two reasons?" Instead, go through this chain:

${"QUOTE -> MEANING -> TENSION -> CONSEQUENCE -> ARGUMENT"}

For example, suppose the quote is:

> "The price of anything is the amount of life you exchange for it."

Then ask: ${"price = life/time sacrificed"}. That gives you something much more interesting.

What tension does that create?

People evaluate purchases using money, but Thoreau asks us to evaluate them using the portion of our lives we sacrifice to obtain them. Now you have an actual interpretation.

1. What consequence follows?
2. If we think this way, then something that appears cheap financially can actually be expensive existentially.
3. Now that is complexity.

## 2. Your two reasons should answer different questions

This is probably the single most useful change for you.

- Reason 1: what does this idea change?
- Reason 2: what does this change cause?

Or put another way: **mechanism** versus **consequence**, individual versus society, immediate versus long term. They need to move the argument forward, not restate it.

| Section | Purpose |
| --- | --- |
| Introduction | interpretation and tension |
| Body | mechanism, then consequence |
| Conclusion | what the reader should now do |

## 3. Practise the move with three quotes

> "Only the weak seek revenge."

Interpretation: the claim is about strength, not about forgiveness.

Practice with each quote in turn, then write the same thesis twice: once with two reasons that repeat themselves, and once with two reasons that do not. The difference will teach you more than a template.

${"1. Underline the weirdest word.\n2. Rewrite the quote in stupidly simple English.\n3. Ask what it assumes people already believe.\n4. Ask why the assumption is worth challenging.\n5. Ask what follows if you accept the challenge."}

And honestly, I think this is the skill you should practise, rather than writing thirty polished theses.

---

Neither success nor failure should be treated as a permanent definition of one's trajectory. That distinction is much more sophisticated, and it is the difference between a thesis that interprets a quote and one that merely describes it.`;

async function renderedNodes(): Promise<Node[]> {
    const renderer = new UnifiedMarkdownRenderer(new DirectDomWriter(), new FixedClock());
    const rendered = await renderer.render(MarkdownDocument.initial(SOURCE));
    return [...Array.from(rendered.content.childNodes)];
}

function texts(page: readonly DrawOp[]): Extract<DrawOp, { kind: "text" }>[] {
    return page.filter(
        (op): op is Extract<DrawOp, { kind: "text" }> => op.kind === "text" && op.y >= BOTTOM
    );
}

describe("a long real document", () => {
    it("lays out every block inside the page box", async () => {
        const host = document.createElement("div");
        const nodes = await renderedNodes();
        for (const node of nodes) {
            host.appendChild(node);
        }

        const layout = paginate(parseBlocks(host), SETUP, new Map<string, boolean>());
        expect(layout.pages.length).toBeGreaterThan(1);

        for (const [index, page] of layout.pages.entries()) {
            const runs = texts(page);
            expect(runs.length, `page ${index + 1} is blank`).toBeGreaterThan(0);

            const byLine = new Map<number, typeof runs>();
            for (const op of runs) {
                const key = Math.round(op.y * 100);
                byLine.set(key, [...(byLine.get(key) ?? []), op]);
            }

            for (const op of runs) {
                const width = textWidth(op.text, op.font, op.size);
                expect(op.x).toBeGreaterThanOrEqual(LEFT);
                expect(op.x + width).toBeLessThanOrEqual(RIGHT);
                expect(op.y).toBeLessThanOrEqual(TOP);
            }

            for (const [, line] of byLine) {
                const ordered = [...line].sort((left, right) => left.x - right.x);
                for (let step = 1; step < ordered.length; step += 1) {
                    const previous = ordered[step - 1];
                    const current = ordered[step];
                    if (previous === undefined || current === undefined) {
                        continue;
                    }
                    const end = previous.x + textWidth(previous.text, previous.font, previous.size);
                    expect(end).toBeLessThanOrEqual(current.x + 0.01);
                }
            }

            const footer = page.filter((op) => op.kind === "text" && /^\d+ \/ \d+$/.test(op.text));
            expect(footer.length).toBe(1);
        }

        // The same bytes are written to disk for a manual look at the result.
        mkdirSync("test-results", { recursive: true });
        writeFileSync(
            "test-results/long-document.pdf",
            writePdf(layout, [], "Long document", SETUP)
        );
    });
});
