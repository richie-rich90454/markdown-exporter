import { baseFont, isCjkCodePoint, textWidth } from "./PdfMetrics";
import type { LaidOut, PdfImageSource } from "./PdfLayout";
import { pageHeightPt, pageWidthPt, type PageSetup } from "../PageSetup";
import { parseTrueType, type TrueTypeFont } from "./TrueTypeFont";

interface EmbeddedMathFont {
    readonly name: string;
    readonly resource: string;
    readonly font: TrueTypeFont;
    readonly cids: ReadonlyMap<number, number>;
    readonly type0: number;
    readonly descendant: number;
    readonly descriptor: number;
    readonly fontFile: number;
    readonly cidMap: number;
    readonly toUnicode: number;
    readonly codePoints: readonly number[];
}

export interface PdfDocumentMetadata {
    readonly language?: string;
    readonly author?: string;
    readonly subject?: string;
    readonly keywords?: string;
}

interface CjkFontConfiguration {
    readonly id: "simplifiedChinese" | "traditionalChinese" | "japanese" | "korean";
    readonly baseName: string;
    readonly encoding: string;
    readonly ordering: string;
    readonly supplement: number;
    readonly resource: string;
}

interface EmbeddedCjkFont extends CjkFontConfiguration {
    readonly type0: number;
    readonly descendant: number;
    readonly descriptor: number;
    readonly toUnicode: number;
    readonly codePoints: readonly number[];
}

const CJK_FONT_CONFIGURATIONS: readonly CjkFontConfiguration[] = [
    {
        id: "simplifiedChinese",
        baseName: "STSong-Light",
        encoding: "UniGB-UTF16-H",
        ordering: "GB1",
        supplement: 4,
        resource: "/CJK-GB"
    },
    {
        id: "traditionalChinese",
        baseName: "MHei-Medium",
        encoding: "UniCNS-UTF16-H",
        ordering: "CNS1",
        supplement: 4,
        resource: "/CJK-CNS"
    },
    {
        id: "japanese",
        baseName: "HeiseiMin-W3",
        encoding: "UniJIS-UTF16-H",
        ordering: "Japan1",
        supplement: 5,
        resource: "/CJK-JIS"
    },
    {
        id: "korean",
        baseName: "HYSMyeongJo-Medium",
        encoding: "UniKS-UTF16-H",
        ordering: "Korea1",
        supplement: 2,
        resource: "/CJK-KS"
    }
];

// Windows ANSI beyond ASCII, which is what the base 14 fonts encode through
// /WinAnsiEncoding.
const WIN_ANSI: Record<string, number> = {
    "\u20ac": 128,
    "\u201a": 130,
    "\u0192": 131,
    "\u201e": 132,
    "\u2026": 133,
    "\u2020": 134,
    "\u2021": 135,
    "\u02c6": 136,
    "\u2030": 137,
    "\u0160": 138,
    "\u2039": 139,
    "\u0152": 140,
    "\u017d": 142,
    "\u2018": 145,
    "\u2019": 146,
    "\u201c": 147,
    "\u201d": 148,
    "\u2022": 149,
    "\u2013": 150,
    "\u2014": 151,
    "\u02dc": 152,
    "\u2122": 153,
    "\u0161": 154,
    "\u203a": 155,
    "\u0153": 156,
    "\u017e": 158,
    "\u0178": 159
};

export function writePdf(
    layout: LaidOut,
    images: readonly (PdfImageSource | null)[],
    title: string,
    setup: PageSetup,
    katexFontData: ReadonlyMap<string, Uint8Array> = new Map(),
    metadata: PdfDocumentMetadata = {}
): Uint8Array {
    const pageWidth = pageWidthPt(setup);
    const pageHeight = pageHeightPt(setup);

    const fontIds = new Map<string, number>();
    const fontBases: string[] = [];
    for (const key of layout.fonts) {
        const id = `${key.family}|${key.bold}|${key.italic}|${key.mono}`;
        if (fontIds.has(id)) {
            continue;
        }
        fontIds.set(id, fontBases.length + 1);
        fontBases.push(baseFont(key));
    }

    const objects: (Uint8Array | null)[] = [];
    const reserve = (): number => {
        objects.push(null);
        return objects.length;
    };
    const put = (index: number, body: string): void => {
        objects[index - 1] = encode(body);
    };
    const putBytes = (index: number, body: Uint8Array): void => {
        objects[index - 1] = body;
    };

    const pagesIndex = reserve();
    const pageIndexes = layout.pages.map(() => reserve());
    const fontIndexes = fontBases.map(() => reserve());
    const imageIndexes = images.map(() => reserve());
    const mathFonts = prepareMathFonts(layout, katexFontData, reserve);
    const cjkFonts = prepareCjkFonts(layout, reserve);
    const destinations = new Map<string, { readonly pageIndex: number; readonly y: number }>();
    layout.pages.forEach((ops, pageIndex) => {
        for (const op of ops) {
            if (op.kind === "anchor" && !destinations.has(op.id)) {
                destinations.set(op.id, { pageIndex, y: op.y });
            }
        }
    });

    pageIndexes.forEach((pageIndex, order) => {
        const ops = layout.pages[order] ?? [];
        const links: string[] = [];
        const stream: string[] = [];

        for (const op of ops) {
            switch (op.kind) {
                case "text": {
                    const id =
                        fontIds.get(
                            `${op.font.family}|${op.font.bold}|${op.font.italic}|${op.font.mono}`
                        ) ?? 1;
                    const hasCjk = [...op.text].some((character) =>
                        isCjkCodePoint(character.codePointAt(0) ?? 0)
                    );
                    stream.push(
                        ...(!hasCjk
                            ? [writeText(op, `/F${id}`, op.x, op.text)]
                            : writeTextWithCjk(op, id, cjkFonts))
                    );
                    break;
                }
                case "math": {
                    for (const glyph of op.math.glyphs) {
                        const face = mathFonts.find((font) => font.name === glyph.font);
                        const codePoint = glyph.text.codePointAt(0) ?? 0;
                        const cid = face?.cids.get(codePoint);
                        if (face === undefined || cid === undefined) continue;
                        stream.push(
                            `0 g BT ${face.resource} ${num(glyph.size * op.scale)} Tf ${num(op.x + glyph.x * op.scale)} ${num(op.y + glyph.y * op.scale)} Td <${hex4(cid)}> Tj ET`
                        );
                    }
                    for (const rule of op.math.rules) {
                        stream.push(
                            `0 g ${num(op.x + rule.x * op.scale)} ${num(op.y + rule.y * op.scale)} ${num(rule.width * op.scale)} ${num(rule.height * op.scale)} re f`
                        );
                    }
                    if (op.math.searchableText.length > 0) {
                        stream.push(
                            `0 g BT /F1 3 Tf 3 Tr ${num(op.x)} ${num(op.y)} Td ${literal(op.math.searchableText)} Tj 0 Tr ET`
                        );
                    }
                    break;
                }
                case "rect": {
                    stream.push(
                        `${shade(op.gray)} ${num(op.x)} ${num(op.y)} ${num(op.w)} ${num(op.h)} re f`
                    );
                    break;
                }
                case "line": {
                    stream.push(
                        `${shade(op.gray)} ${num(op.width)} w ${num(op.x1)} ${num(op.y1)} m ${num(op.x2)} ${num(op.y2)} l S`
                    );
                    break;
                }
                case "image": {
                    const image = images[op.index];
                    if (image === undefined || image === null) {
                        // The bytes never arrived, so nothing is drawn.
                        break;
                    }
                    stream.push(
                        `q ${num(op.w)} 0 0 ${num(op.h)} ${num(op.x)} ${num(op.y)} cm /Im${op.index + 1} Do Q`
                    );
                    break;
                }
                case "link": {
                    const rect = `/Rect [${num(op.x)} ${num(op.y)} ${num(op.x + op.w)} ${num(op.y + op.h)}] /Border [0 0 0]`;
                    if (op.uri.startsWith("#")) {
                        const target = destinations.get(op.uri.slice(1));
                        if (target !== undefined) {
                            const targetPage = pageIndexes[target.pageIndex];
                            if (targetPage !== undefined) {
                                links.push(
                                    `<< /Type /Annot /Subtype /Link ${rect} /Dest [${targetPage} 0 R /XYZ null ${num(target.y)} null] >>`
                                );
                            }
                        }
                    } else {
                        links.push(
                            `<< /Type /Annot /Subtype /Link ${rect} /A << /S /URI /URI ${literal(op.uri)} >> >>`
                        );
                    }
                    break;
                }
                case "anchor":
                    break;
            }
        }
        const content = stream.join("\n");
        const contentIndex = reserve();
        put(contentIndex, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

        const fontDict = fontIndexes
            .map((fontIndex, index) => `/F${index + 1} ${fontIndex} 0 R`)
            .join(" ");
        const mathFontDict = mathFonts
            .map((font) => `${font.resource} ${font.type0} 0 R`)
            .join(" ");
        const cjkFontDict = cjkFonts.map((font) => `${font.resource} ${font.type0} 0 R`).join(" ");
        const imageDict = imageIndexes
            .map((imageIndex, index) =>
                images[index] === undefined || images[index] === null
                    ? ""
                    : `/Im${index + 1} ${imageIndex} 0 R`
            )
            .filter((entry) => entry.length > 0)
            .join(" ");
        const resources = `<< /Font << ${fontDict} ${mathFontDict} ${cjkFontDict} >> /XObject << ${imageDict} >> >>`;
        const annots = links.length > 0 ? ` /Annots [${links.join(" ")}]` : "";
        put(
            pageIndex,
            `<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}] ` +
                `/Resources ${resources} /Contents ${contentIndex} 0 R${annots} >>`
        );
    });

    fontIndexes.forEach((fontIndex, index) => {
        put(
            fontIndex,
            `<< /Type /Font /Subtype /Type1 /BaseFont /${fontBases[index] ?? "Times-Roman"} /Encoding /WinAnsiEncoding >>`
        );
    });

    for (const font of mathFonts) writeEmbeddedMathFont(font, put, putBytes);
    for (const font of cjkFonts) writeCjkFont(font, put);

    imageIndexes.forEach((imageIndex, index) => {
        const image = images[index];
        if (image === undefined || image === null) {
            // A blocked image leaves a hole in the numbering; the pages never
            // reference an object that is not an image.
            put(imageIndex, "<< >>");
            return;
        }
        const filter = image.jpeg ? "/DCTDecode" : "/FlateDecode";
        const colorSpace = image.gray ? "/DeviceGray" : "/DeviceRGB";
        const head =
            `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
            `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter ${filter} /Length ${image.data.length} >>`;
        objects[imageIndex - 1] = concat(
            encode(`${head}\nstream\n`),
            image.data,
            encode("\nendstream")
        );
    });

    put(
        pagesIndex,
        `<< /Type /Pages /Kids [${pageIndexes.map((index) => `${index} 0 R`).join(" ")}] /Count ${pageIndexes.length} >>`
    );

    const catalogIndex = reserve();
    put(
        catalogIndex,
        `<< /Type /Catalog /Pages ${pagesIndex} 0 R /Lang ${literal(metadata.language || "en")} >>`
    );

    const infoIndex = reserve();
    const info = [
        `/Title ${pdfTextString(title)}`,
        `/Producer ${literal("Markdown Exporter")}`,
        ...(metadata.author?.trim() ? [`/Author ${pdfTextString(metadata.author.trim())}`] : []),
        ...(metadata.subject?.trim() ? [`/Subject ${pdfTextString(metadata.subject.trim())}`] : []),
        ...(metadata.keywords?.trim()
            ? [`/Keywords ${pdfTextString(metadata.keywords.trim())}`]
            : [])
    ];
    put(infoIndex, `<< ${info.join(" ")} >>`);

    let output = "%PDF-1.6\n";
    const offsets: number[] = [];
    for (let index = 0; index < objects.length; index += 1) {
        const body = objects[index] ?? new Uint8Array();
        offsets.push(output.length);
        output += `${index + 1} 0 obj\n${decode(body)}\nendobj\n`;
    }

    const xref = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        output += `${offset.toString().padStart(10, "0")} 00000 n \n`;
    }
    output +=
        `trailer\n<< /Size ${objects.length + 1} /Root ${catalogIndex} 0 R /Info ${infoIndex} 0 R >>\n` +
        `startxref\n${xref}\n%%EOF`;

    return encode(output);
}

function shade(value: number): string {
    return value <= 0 ? "0 g" : value >= 1 ? "1 g" : `${value.toFixed(3)} g`;
}

function prepareMathFonts(
    layout: LaidOut,
    data: ReadonlyMap<string, Uint8Array>,
    reserve: () => number
): EmbeddedMathFont[] {
    const codePointsByFont = new Map<string, Set<number>>();
    for (const name of layout.mathFonts) codePointsByFont.set(name, new Set());
    for (const page of layout.pages) {
        for (const op of page) {
            if (op.kind !== "math") continue;
            for (const glyph of op.math.glyphs) {
                const points = codePointsByFont.get(glyph.font);
                const codePoint = glyph.text.codePointAt(0);
                if (points !== undefined && codePoint !== undefined) points.add(codePoint);
            }
        }
    }

    const fonts: EmbeddedMathFont[] = [];
    let index = 0;
    for (const [name, codePoints] of codePointsByFont) {
        const bytes = data.get(name);
        if (bytes === undefined || codePoints.size === 0) continue;
        const font = parseTrueType(bytes);
        const orderedPoints = [...codePoints].sort((left, right) => left - right);
        const cids = new Map<number, number>();
        orderedPoints.forEach((point, order) => cids.set(point, order + 1));
        fonts.push({
            name,
            resource: `/M${++index}`,
            font,
            cids,
            codePoints: orderedPoints,
            type0: reserve(),
            descendant: reserve(),
            descriptor: reserve(),
            fontFile: reserve(),
            cidMap: reserve(),
            toUnicode: reserve()
        });
    }
    return fonts;
}

function prepareCjkFonts(layout: LaidOut, reserve: () => number): EmbeddedCjkFont[] {
    const codePoints = new Map<CjkFontConfiguration["id"], Set<number>>();
    for (const configuration of CJK_FONT_CONFIGURATIONS) {
        codePoints.set(configuration.id, new Set());
    }
    for (const page of layout.pages) {
        for (const op of page) {
            if (op.kind !== "text") continue;
            const defaultConfiguration = cjkConfigurationForText(op.text);
            for (const character of op.text) {
                const point = character.codePointAt(0);
                if (point === undefined) continue;
                const configuration = cjkConfigurationForCodePoint(point, defaultConfiguration);
                if (configuration === undefined) continue;
                codePoints.get(configuration.id)?.add(point);
            }
        }
    }

    return CJK_FONT_CONFIGURATIONS.flatMap((configuration) => {
        const points = codePoints.get(configuration.id);
        if (points === undefined || points.size === 0) return [];
        return [
            {
                ...configuration,
                type0: reserve(),
                descendant: reserve(),
                descriptor: reserve(),
                toUnicode: reserve(),
                codePoints: [...points].sort((left, right) => left - right)
            }
        ];
    });
}

function cjkConfigurationForText(text: string): CjkFontConfiguration | undefined {
    const hasCjk = [...text].some((character) => isCjkCodePoint(character.codePointAt(0) ?? 0));
    if (!hasCjk) return undefined;

    if (/[\u3040-\u30ff\u31f0-\u31ff]/u.test(text)) {
        return CJK_FONT_CONFIGURATIONS.find((font) => font.id === "japanese");
    }
    if (/[\u3100-\u312f]/u.test(text) || /[繁體臺灣與國學為這個資訊電腦網路發展]/u.test(text)) {
        return CJK_FONT_CONFIGURATIONS.find((font) => font.id === "traditionalChinese");
    }
    if (/[\uac00-\ud7af]/u.test(text)) {
        return CJK_FONT_CONFIGURATIONS.find((font) => font.id === "korean");
    }
    return CJK_FONT_CONFIGURATIONS.find((font) => font.id === "simplifiedChinese");
}

function cjkConfigurationForCodePoint(
    codePoint: number,
    defaultConfiguration: CjkFontConfiguration | undefined
): CjkFontConfiguration | undefined {
    if (!isCjkCodePoint(codePoint)) return undefined;
    if (codePoint >= 0xac00 && codePoint <= 0xd7af) {
        return CJK_FONT_CONFIGURATIONS.find((font) => font.id === "korean");
    }
    if (
        (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
        (codePoint >= 0x31f0 && codePoint <= 0x31ff)
    ) {
        return CJK_FONT_CONFIGURATIONS.find((font) => font.id === "japanese");
    }
    if (codePoint >= 0x3100 && codePoint <= 0x312f) {
        return CJK_FONT_CONFIGURATIONS.find((font) => font.id === "traditionalChinese");
    }
    if (/[繁體臺灣與國學為這個資訊電腦網路發展]/u.test(String.fromCodePoint(codePoint))) {
        return CJK_FONT_CONFIGURATIONS.find((font) => font.id === "traditionalChinese");
    }
    return defaultConfiguration;
}

function writeCjkFont(embedded: EmbeddedCjkFont, put: (index: number, body: string) => void): void {
    const { baseName, ordering, supplement } = embedded;
    const cmap = toCjkUnicodeCmap(embedded.codePoints);
    put(embedded.toUnicode, `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
    put(
        embedded.descriptor,
        `<< /Type /FontDescriptor /FontName /${baseName} /Flags 4 ` +
            `/FontBBox [0 -250 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 ` +
            `/CapHeight 700 /StemV 80 >>`
    );
    put(
        embedded.descendant,
        `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${baseName} ` +
            `/CIDSystemInfo << /Registry (Adobe) /Ordering (${ordering}) /Supplement ${supplement} >> ` +
            `/FontDescriptor ${embedded.descriptor} 0 R /DW 1000 >>`
    );
    put(
        embedded.type0,
        `<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /${embedded.encoding} ` +
            `/DescendantFonts [${embedded.descendant} 0 R] /ToUnicode ${embedded.toUnicode} 0 R >>`
    );
}

function toCjkUnicodeCmap(codePoints: readonly number[]): string {
    const entries = codePoints.map((point) => `<${utf16Hex(point)}> <${utf16Hex(point)}>`);
    const blocks: string[] = [];
    for (let index = 0; index < entries.length; index += 100) {
        const block = entries.slice(index, index + 100);
        blocks.push(`${block.length} beginbfchar\n${block.join("\n")}\nendbfchar`);
    }
    return [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /Adobe-Identity-UCS def",
        "/CMapType 2 def",
        "2 begincodespacerange",
        "<0000> <FFFF>",
        "<D800DC00> <DBFFDFFF>",
        "endcodespacerange",
        ...blocks,
        "endcmap",
        "CMapName currentdict /CMap defineresource pop",
        "end",
        "end"
    ].join("\n");
}

function writeText(
    op: Extract<LaidOut["pages"][number][number], { kind: "text" }>,
    fontResource: string,
    x: number,
    text: string
): string {
    const renderMode = op.renderMode === "invisible" ? "3 Tr " : "";
    const resetRenderMode = op.renderMode === "invisible" ? " 0 Tr" : "";
    return `${shade(op.gray)} BT ${fontResource} ${num(op.size)} Tf ${renderMode}${num(x)} ${num(op.y)} Td ${literal(text)} Tj${resetRenderMode} ET`;
}

function writeTextWithCjk(
    op: Extract<LaidOut["pages"][number][number], { kind: "text" }>,
    baseFontId: number,
    cjkFonts: readonly EmbeddedCjkFont[]
): string[] {
    const defaultConfiguration = cjkConfigurationForText(op.text);
    const segments: { text: string; configuration: CjkFontConfiguration | undefined }[] = [];
    for (const character of op.text) {
        const configuration = cjkConfigurationForCodePoint(
            character.codePointAt(0) ?? 0,
            defaultConfiguration
        );
        const previous = segments[segments.length - 1];
        if (previous !== undefined && previous.configuration?.id === configuration?.id) {
            previous.text += character;
        } else {
            segments.push({ text: character, configuration });
        }
    }

    let x = op.x;
    return segments.map((segment) => {
        const cjkFont = cjkFonts.find((font) => font.id === segment.configuration?.id);
        const command =
            cjkFont !== undefined
                ? writeCjkText(op, cjkFont.resource, x, segment.text)
                : writeText(op, `/F${baseFontId}`, x, segment.text);
        x += textWidth(segment.text, op.font, op.size);
        return command;
    });
}

function writeCjkText(
    op: Extract<LaidOut["pages"][number][number], { kind: "text" }>,
    fontResource: string,
    x: number,
    text: string
): string {
    const renderMode = op.renderMode === "invisible" ? "3 Tr " : "";
    const resetRenderMode = op.renderMode === "invisible" ? " 0 Tr" : "";
    const unicodeHex = [...text]
        .map((character) => utf16Hex(character.codePointAt(0) ?? 0))
        .join("");
    return `${shade(op.gray)} BT ${fontResource} ${num(op.size)} Tf ${renderMode}${num(x)} ${num(op.y)} Td <${unicodeHex}> Tj${resetRenderMode} ET`;
}

function writeEmbeddedMathFont(
    embedded: EmbeddedMathFont,
    put: (index: number, body: string) => void,
    putBytes: (index: number, body: Uint8Array) => void
): void {
    const { font, name } = embedded;
    const baseName = name.replace(/\.ttf$/i, "");
    const glyphIds = embedded.codePoints.map((point) => font.glyphFor(point));
    const cidBytes = new Uint8Array((glyphIds.length + 1) * 2);
    glyphIds.forEach((glyph, index) => {
        cidBytes[(index + 1) * 2] = (glyph >>> 8) & 0xff;
        cidBytes[(index + 1) * 2 + 1] = glyph & 0xff;
    });
    const cidMapHeader = encode(`<< /Length ${cidBytes.length} >>\nstream\n`);
    putBytes(embedded.cidMap, concat(cidMapHeader, cidBytes, encode("\nendstream")));

    const cmap = toUnicodeCmap(embedded.cids);
    put(embedded.toUnicode, `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
    const fontFileHeader = encode(
        `<< /Length ${font.data.length} /Length1 ${font.data.length} >>\nstream\n`
    );
    putBytes(embedded.fontFile, concat(fontFileHeader, font.data, encode("\nendstream")));

    const fontFlags = /(?:Size|AMS|Symbol)/.test(baseName) ? 4 : 32;
    const metricsScale = 1000 / font.unitsPerEm;
    put(
        embedded.descriptor,
        `<< /Type /FontDescriptor /FontName /${baseName} /Flags ${fontFlags} ` +
            `/FontBBox [${font.bounds.map((value) => Math.round(value * metricsScale)).join(" ")}] /ItalicAngle 0 ` +
            `/Ascent ${Math.round(font.ascent * metricsScale)} /Descent ${Math.round(font.descent * metricsScale)} ` +
            `/CapHeight ${Math.round(font.capHeight * metricsScale)} ` +
            `/StemV 80 /FontFile2 ${embedded.fontFile} 0 R >>`
    );
    const widths = glyphIds.map((glyph) => {
        const advance = font.advances[glyph] ?? font.unitsPerEm / 2;
        return Math.round((advance / font.unitsPerEm) * 1000);
    });
    put(
        embedded.descendant,
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseName} ` +
            `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
            `/FontDescriptor ${embedded.descriptor} 0 R /DW 1000 ` +
            `/W [1 [${widths.join(" ")}]] /CIDToGIDMap ${embedded.cidMap} 0 R >>`
    );
    put(
        embedded.type0,
        `<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H ` +
            `/DescendantFonts [${embedded.descendant} 0 R] /ToUnicode ${embedded.toUnicode} 0 R >>`
    );
}

function toUnicodeCmap(cids: ReadonlyMap<number, number>): string {
    const entries = [...cids].map(([codePoint, cid]) => `<${hex4(cid)}> <${utf16Hex(codePoint)}>`);
    const blocks: string[] = [];
    for (let index = 0; index < entries.length; index += 100) {
        const block = entries.slice(index, index + 100);
        blocks.push(`${block.length} beginbfchar\n${block.join("\n")}\nendbfchar`);
    }
    return [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /Adobe-Identity-UCS def",
        "/CMapType 2 def",
        "1 begincodespacerange",
        "<0000> <FFFF>",
        "endcodespacerange",
        ...blocks,
        "endcmap",
        "CMapName currentdict /CMap defineresource pop",
        "end",
        "end"
    ].join("\n");
}

function utf16Hex(codePoint: number): string {
    if (codePoint <= 0xffff) return hex4(codePoint);
    const value = codePoint - 0x10000;
    return `${hex4(0xd800 + (value >>> 10))}${hex4(0xdc00 + (value & 0x3ff))}`;
}

function hex4(value: number): string {
    return value.toString(16).toUpperCase().padStart(4, "0");
}

function num(value: number): string {
    return (Math.round(value * 100) / 100).toString();
}

function literal(text: string): string {
    let out = "(";
    for (const char of text) {
        const code = char.codePointAt(0) ?? 63;
        if (char === "(" || char === ")" || char === "\\") {
            out += `\\${char}`;
        } else if (code < 32) {
            out += `\\${code.toString(8).padStart(3, "0")}`;
        } else if (code < 127) {
            out += char;
        } else {
            const mapped = WIN_ANSI[char];
            out += mapped === undefined ? byte(code <= 255 ? code : 63) : byte(mapped);
        }
    }
    return `${out})`;
}

/** PDF text strings use UTF-16BE when WinAnsi cannot preserve the metadata. */
function pdfTextString(text: string): string {
    if (
        [...text].every((character) => {
            const code = character.codePointAt(0) ?? 0;
            return code < 127 || (code >= 160 && code <= 255) || WIN_ANSI[character] !== undefined;
        })
    ) {
        return literal(text);
    }
    const words = [0xfeff];
    for (let index = 0; index < text.length; index += 1) words.push(text.charCodeAt(index));
    return `<${words
        .map((word) => word.toString(16).padStart(4, "0"))
        .join("")
        .toUpperCase()}>`;
}

function byte(value: number): string {
    return String.fromCharCode(value);
}

// WinAnsi keeps every byte below 256, so a byte-wise pass keeps the xref
// offsets honest.
function encode(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
        bytes[index] = text.charCodeAt(index) & 0xff;
    }
    return bytes;
}

function decode(bytes: Uint8Array): string {
    let out = "";
    for (const value of bytes) {
        out += String.fromCharCode(value);
    }
    return out;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
