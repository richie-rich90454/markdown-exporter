import { expect, test, type Page } from "@playwright/test";

const VALID_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAaklEQVR4nBWNQREAQQzCkFIpSKmUSEFKpSDlbnlmmEQSIyxWICJOVEjDDB52YMhwQwfJjLFZg4k5UyMts3jZhSXLLV2kJ8APvgUO+ucUJjhsHk640PyNYw4fe++c447e3yhTXLZPkXKl5QPGe1gBrfdehAAAAABJRU5ErkJggg==";

const DOC = [
    "# Chemistry Utility",
    "",
    "> A research-grade chemistry utility for chemists, researchers, and students.",
    "",
    "Built with **Vite**, the *Lab Parchment* design system, and a WebAssembly-powered shell.",
    "",
    "---",
    "",
    "## Table of Contents",
    "",
    "- License",
    "- Contributing",
    "- Architecture",
    "",
    "## Platform",
    "",
    "| Feature | Description |",
    "| --- | --- |",
    ...Array.from(
        { length: 40 },
        (_, index) => `| Row ${index + 1} | description of row ${index + 1} |`
    ),
    "",
    "## Long list",
    "",
    ...Array.from({ length: 90 }, (_, index) => `- item ${index + 1} with enough words to wrap`),
    "",
    "![badge](" + VALID_PNG + ")",
    "",
    "![blocked](https://example.invalid/nope.png)",
    "",
    "```js",
    'const pages = document.querySelectorAll(".page-frame");',
    "```",
    "",
    "1. Open the app",
    "2. Paste a formula",
    "",
    "> Local only."
].join("\n");

async function exportPdf(page: Page, name = "chemistry-utility.pdf"): Promise<string> {
    const download = page.waitForEvent("download", { timeout: 25000 });
    await page.getByRole("button", { name: /^Export/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(name);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
    }
    return new TextDecoder("latin1").decode(Buffer.concat(chunks));
}

function pagesOf(pdf: string): string[] {
    return [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
        .map((match) => match[1] ?? "")
        .filter((body) => body.includes("Tj") || body.includes("Do"));
}

test("renders the documented Mermaid families into preview and PDF", async ({ page }) => {
    test.setTimeout(120_000);
    const examples = [
        "sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi",
        "flowchart TD\nA[Start] --> B[Finish]",
        "gantt\ntitle Release\ndateFormat YYYY-MM-DD\nsection Build\nMake: a1, 2026-01-01, 2d",
        "classDiagram\nclass User {\n+String name\n}",
        "stateDiagram-v2\n[*] --> Ready\nReady --> Done",
        'pie title Visits\n"Docs" : 60\n"Editor" : 40',
        "requirementDiagram\nrequirement req1 {\nid: 1\ntext: The system works\nrisk: low\nverifymethod: test\n}",
        "gitGraph\ncommit\nbranch feature\ncheckout feature\ncommit\ncheckout main\nmerge feature",
        'C4Context\nPerson(user, "User")\nSystem(app, "Editor")\nRel(user, app, "Uses")',
        "mindmap\nroot((Notes))\n  Ideas\n    Math",
        "timeline\ntitle Milestones\nsection 2026\nStart",
        'quadrantChart\ntitle Priorities\nx-axis Low --> High\ny-axis Low --> High\nquadrant-1 "Do now"\nquadrant-2 "Plan"\nquadrant-3 "Later"\nquadrant-4 "Delegate"\nTask A: [0.7, 0.7]',
        "sankey-beta\nA,B,10\nB,C,5",
        "zenuml\ntitle Demo\nAlice->John: Hello John, how are you?\nJohn->Alice: Great!",
        "xychart-beta\nx-axis [A, B, C]\ny-axis 0 --> 10\nline [1, 5, 3]"
    ];
    const source = examples
        .map((example, index) => `## Diagram ${index + 1}\n\n\`\`\`mermaid\n${example}\n\`\`\``)
        .join("\n\n");

    await page.goto("/");
    await page.getByLabel("Markdown editor").fill(source);
    await expect
        .poll(
            async () =>
                (await page.locator(".preview__flow svg.markdown-diagram").count()) +
                (await page.locator(".preview__flow .diagram-error").count()),
            { timeout: 90_000 }
        )
        .toBe(examples.length);
    const errors = await page
        .locator(".preview__flow pre.diagram-error")
        .evaluateAll((blocks) =>
            blocks.map(
                (block) =>
                    `${block.querySelector("code")?.textContent ?? ""}\n${block.getAttribute("title") ?? ""}`
            )
        );
    expect(errors, `malformed or unsupported diagrams:\n${errors.join("\n---\n")}`).toEqual([]);
    const pdf = await exportPdf(page, "diagram-1.pdf");

    expect([...pdf.matchAll(/\/Subtype \/Image/g)].length).toBe(examples.length - 1);
    expect(pdf).toContain("Embedded");
    for (let index = 1; index <= examples.length; index += 1) {
        expect(pdf).toContain(`Diagram ${index}`);
    }
});

test("exports every block type of a real document", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Markdown editor").fill(DOC);
    await expect(page.locator(".preview__flow blockquote p")).toHaveCount(2);

    const pdf = await exportPdf(page);
    const pages = pagesOf(pdf);

    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pages.length).toBeGreaterThan(3);

    for (const needle of [
        "Chemistry Utility",
        "Row 1",
        "Row 40",
        "item 1",
        "item 90",
        "Local only"
    ]) {
        expect(pdf).toContain(needle);
    }

    // Nothing is drawn outside the media box, and no two runs share a slot.
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf);
    const width = Number(media?.[1] ?? 0);
    const height = Number(media?.[2] ?? 0);
    const slots = new Map<string, string[]>();
    let pageIndex = 0;
    for (const body of pages) {
        pageIndex += 1;
        for (const op of body.split("\n")) {
            if (!op.includes(" Td ")) {
                continue;
            }
            const pos = /([\d.-]+) ([-\d.]+) Td/.exec(op);
            const x = Number(pos?.[1] ?? 0);
            const y = Number(pos?.[2] ?? 0);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(height);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(width);
            const key = `${pageIndex}|${x}|${y}`;
            slots.set(key, [...(slots.get(key) ?? []), /\(([^)]*)\)/.exec(op)?.[1] ?? ""]);
        }
    }
    for (const [slot, texts] of slots) {
        expect(texts.length, `runs overlapping at ${slot}`).toBeLessThanOrEqual(1);
    }
});

test("embeds a decodable image and boxes an unreachable one", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            errors.push(message.text());
        }
    });

    await page.goto("/");
    await page.getByLabel("Markdown editor").fill(DOC);
    await expect.poll(async () => page.locator(".preview__flow img").count()).toBe(2);

    const pdf = await exportPdf(page);

    expect([...pdf.matchAll(/\/Subtype \/Image/g)]).toHaveLength(1);
    expect([...pdf.matchAll(/ cm \/Im1 Do/g)]).toHaveLength(1);
    expect(pdf).toContain("/Filter /FlateDecode");

    // The blocked remote image is replaced by its alt text, never a crash.
    expect(pagesOf(pdf).some((body) => body.includes("(blocked)"))).toBe(true);
    expect(errors.filter((message) => message.includes("could not be decoded"))).toHaveLength(0);
});

test("keeps the flow intact when a big block was split", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill(DOC);

    // The table and the long list were split across pages by the layout, so
    // every row and item has to still be in the document.
    await expect(page.locator(".preview__flow table tr")).toHaveCount(41);
    await expect(page.locator(".preview__flow li")).toHaveCount(95);
    await expect(page.locator(".preview__flow img")).toHaveCount(2);

    const pdf = await exportPdf(page);
    expect(pdf).toContain("Row 40");
    expect(pdf).toContain("item 90");
});

test("breaks the preview and the exported file on the same pages", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByLabel("Markdown editor").fill(DOC);

    const frames = page.locator(".page-frame");
    await expect(page.locator(".preview__flow li")).toHaveCount(95);
    await expect.poll(async () => frames.count()).toBeGreaterThan(3);

    const pdf = await exportPdf(page);
    const pages = pagesOf(pdf);
    const previewFrames = await frames.count();

    // The preview and the export share one layout engine, so a difference here
    // means the two drifted apart again.
    expect(pages.length).toBe(previewFrames);
    expect(pages.length).toBeGreaterThan(3);

    // Every page carries its number, and no page is blank.
    for (const [index, body] of pages.entries()) {
        expect(body, `page ${index + 1} has nothing on it`).toMatch(/\(([^)]*)\) Tj/);
        expect(body).toContain(`(${index + 1} / ${pages.length}) Tj`);
    }
});

// The content stream names fonts as /F1, /F2, and the page resources point
// those names at font objects. This walks that mapping both ways.
function faceOf(pdf: string, match: RegExpExecArray | null): string | undefined {
    const name = match?.[1];
    if (name === undefined) {
        return undefined;
    }
    const resource = new RegExp(`${name} (\\d+) 0 R`).exec(pdf);
    if (resource === null) {
        return undefined;
    }
    const face = new RegExp(`${resource[1] ?? ""} 0 obj[\\s\\S]*?/BaseFont /([\\w-]+)`).exec(pdf);
    return face?.[1];
}

function runFont(pdf: string, text: string): string | undefined {
    return faceOf(
        pdf,
        new RegExp(`(\\/F\\d+) [\\d.]+ Tf [\\d.]+ [\\d.]+ Td \\([^)]*${text}[^)]*\\) Tj`).exec(pdf)
    );
}

test("typesets emphasis with the matching base fonts", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill("# Heading\n\nPlain **bold** and *italic* with `code`.");
    // The export needs a finished render, so wait for the document itself.
    await expect(page.locator(".preview__flow h1")).toHaveText("Heading");

    const pdf = await exportPdf(page, "heading.pdf");
    const fonts = [...pdf.matchAll(/\/BaseFont \/([\w-]+)/g)].map((match) => match[1] ?? "");

    // Bold and italic must not be swapped, and code needs a monospace face.
    expect(fonts).toContain("Times-Roman");
    expect(fonts).toContain("Times-Bold");
    expect(fonts).toContain("Times-Italic");
    expect(fonts).toContain("Courier");

    expect(runFont(pdf, "Heading")).toBe("Times-Bold");
    expect(runFont(pdf, "bold")).toBe("Times-Bold");
    expect(runFont(pdf, "italic")).toBe("Times-Italic");
    expect(runFont(pdf, "code")).toBe("Courier");
    expect(runFont(pdf, "Plain")).toBe("Times-Roman");
});

test("embeds selectable KaTeX glyphs and preserves the source text in PDF", async ({ page }) => {
    await page.goto("/");
    await page
        .getByLabel("Markdown editor")
        .fill("# Math export\n\n$$\n\\frac{1}{2}+x^2=\\sqrt{y}\n$$\n\nFollowing text.");
    await expect(page.locator(".preview__flow .katex-display .katex")).toHaveCount(1);

    const pdf = await exportPdf(page, "math-export.pdf");

    expect(pdf).toContain("/Subtype /Type0");
    expect(pdf).toContain("/FontFile2");
    expect(pdf).toContain("/ToUnicode");
    expect(pdf).toContain("frac{1}{2}+x^2=");
    expect(pdf).toContain("sqrt{y}");
    expect(pdf).toContain("3 Tr");
    expect(pdf).toContain("<0001> <0078>");
    expect(pdf).toContain("Following text.");
});

test("keeps PDF math geometry independent of the preview zoom", async ({ page }) => {
    await page.goto("/");
    await page
        .getByLabel("Markdown editor")
        .fill("Inline $\\frac{a}{b}+x^2$ and display:\n\n\\[\\sqrt{y}+\\frac{1}{2}\\]");
    await expect(page.locator(".preview__flow .katex")).toHaveCount(2);

    const defaultZoom = await exportPdf(page, "document.pdf");
    await page.locator(".preview__zoomer").evaluate((element) => {
        (element as HTMLElement).style.transform = "scale(0.5)";
    });
    const changedZoom = await exportPdf(page, "document.pdf");

    expect(changedZoom).toBe(defaultZoom);
});

test("fits an oversized equation to the page and keeps PDF pagination aligned", async ({
    page
}) => {
    await page.goto("/");
    const wideFormula = Array.from(
        { length: 180 },
        (_, index) => `x_{${index}}+\\frac{y_{${index}}}{z_{${index}}+1}`
    ).join("+");
    const surroundingText = Array.from(
        { length: 75 },
        (_, index) => `Paragraph ${index + 1} keeps page breaks observable after the equation.`
    ).join("\n\n");
    await page
        .getByLabel("Markdown editor")
        .fill(`# Wide equation\n\n$$\n${wideFormula}\n$$\n\n${surroundingText}`);
    await expect(page.locator(".preview__flow .katex-display .katex")).toHaveCount(1);

    const previewPages = await page.locator(".page-frame").count();
    const pdf = await exportPdf(page, "wide-equation.pdf");
    const pdfPages = pagesOf(pdf);

    expect(pdf).toContain("/FontFile2");
    expect(pdf).toContain("x_{0}+");
    expect(pdfPages.length).toBe(previewPages);
    expect(pdfPages.length).toBeGreaterThan(1);
});
