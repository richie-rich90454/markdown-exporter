import { baseFont } from "./PdfMetrics";
import type { LaidOut, PdfImageSource } from "./PdfLayout";
import { pageHeightPt, pageWidthPt, type PageSetup } from "../PageSetup";

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
    setup: PageSetup
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

    const pagesIndex = reserve();
    const pageIndexes = layout.pages.map(() => reserve());
    const fontIndexes = fontBases.map(() => reserve());
    const imageIndexes = images.map(() => reserve());

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
                    stream.push(
                        `${shade(op.gray)} BT /F${id} ${num(op.size)} Tf ${num(op.x)} ${num(op.y)} Td ${literal(op.text)} Tj ET`
                    );
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
                    links.push(
                        `<< /Type /Annot /Subtype /Link /Rect [${num(op.x)} ${num(op.y)} ${num(op.x + op.w)} ${num(op.y + op.h)}] /Border [0 0 0] /A << /S /URI /URI ${literal(op.uri)} >> >>`
                    );
                    break;
                }
            }
        }
        const content = stream.join("\n");
        const contentIndex = reserve();
        put(contentIndex, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

        const fontDict = fontIndexes
            .map((fontIndex, index) => `/F${index + 1} ${fontIndex} 0 R`)
            .join(" ");
        const imageDict = imageIndexes
            .map((imageIndex, index) =>
                images[index] === undefined || images[index] === null
                    ? ""
                    : `/Im${index + 1} ${imageIndex} 0 R`
            )
            .filter((entry) => entry.length > 0)
            .join(" ");
        const resources = `<< /Font << ${fontDict} >> /XObject << ${imageDict} >> >>`;
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
    put(catalogIndex, `<< /Type /Catalog /Pages ${pagesIndex} 0 R /Lang (en) >>`);

    const infoIndex = reserve();
    put(infoIndex, `<< /Title ${literal(title)} /Producer ${literal("Markdown Exporter")} >>`);

    let output = "%PDF-1.4\n";
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
