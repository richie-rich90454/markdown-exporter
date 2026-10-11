import { ExportFormat } from "../../domain/ExportFormat";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";
import type { LaidOut } from "./pdf/PdfLayout";
import { parseBlocks } from "./pdf/PdfLayout";
import { paginate } from "./pdf/PdfPaginate";
import type { PdfImage } from "./pdf/PdfWriter";
import { writePdf } from "./pdf/PdfWriter";

// A wall clock image is never worth the memory: the PDF caps it here.
const MAX_PIXELS = 4096;

export class PdfExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.PDF;

    constructor(private readonly fileSaver: FileSaver) {}

    async export(request: ExportRequest): Promise<ExportResult> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`PdfExporter cannot export ${request.format}`);
        }
        const resolved = await collectImages(request.content);
        const embeds = new Map<string, boolean>();
        for (const [src, image] of resolved) {
            embeds.set(src, image !== null);
        }
        const layout: LaidOut = paginate(parseBlocks(request.content), request.pageSetup, embeds);
        const bytes: Uint8Array = writePdf(
            layout,
            layout.images.map((image) => resolved.get(image.src) ?? null),
            request.title,
            request.pageSetup
        );
        this.fileSaver.saveBlob(
            new Blob([bytes as BlobPart], { type: "application/pdf" }),
            `${slug(request.title)}.pdf`
        );
        return ExportResults.success(this.supportedFormat);
    }
}

async function collectImages(root: Node): Promise<Map<string, PdfImage | null>> {
    const resolved = new Map<string, PdfImage | null>();
    if (!(root instanceof Element)) {
        return resolved;
    }
    for (const element of Array.from(root.querySelectorAll("img"))) {
        const src = element.currentSrc || element.src;
        if (src.length > 0 && !resolved.has(src)) {
            resolved.set(src, await loadImage(src, element));
        }
    }
    return resolved;
}

async function loadImage(src: string, element: HTMLImageElement): Promise<PdfImage | null> {
    // The browser already decoded this for the preview, so asking it for the
    // bitmap is both the cheapest and the most forgiving path.
    if (element.complete && element.naturalWidth > 0) {
        const bitmap = await decode(element);
        if (bitmap !== undefined) {
            const drawn = await rasterize(bitmap);
            if (drawn !== null) {
                return drawn;
            }
        }
    }
    let bytes: Uint8Array;
    try {
        const response = await fetch(src);
        if (!response.ok) {
            return null;
        }
        bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
        return null;
    }
    if (bytes.length < 2) {
        return null;
    }
    // A JPEG travels straight through, grayscale included, which saves both the
    // decode and the memory of a pixel copy.
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        const frame = jpegFrame(bytes);
        return frame === null
            ? null
            : {
                  data: bytes,
                  width: frame.width,
                  height: frame.height,
                  jpeg: true,
                  gray: frame.components === 1
              };
    }
    return rasterize(bytes);
}

function jpegFrame(
    bytes: Uint8Array
): { width: number; height: number; components: number } | null {
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = bytes[offset + 1] ?? 0;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
            offset += 2;
            continue;
        }
        const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
        const isStartOfFrame =
            marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc;
        if (isStartOfFrame) {
            return {
                height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
                width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
                components: bytes[offset + 9] ?? 3
            };
        }
        offset += 2 + length;
    }
    return null;
}

async function decode(source: HTMLImageElement | Uint8Array): Promise<ImageBitmap | undefined> {
    try {
        return source instanceof Uint8Array
            ? await createImageBitmap(new Blob([source as BlobPart]))
            : await createImageBitmap(source);
    } catch {
        // A broken image, or one the browser refuses to hand out.
        return undefined;
    }
}

async function rasterize(source: ImageBitmap | Uint8Array): Promise<PdfImage | null> {
    const decoded = source instanceof Uint8Array ? await decode(source) : source;
    if (decoded === undefined) {
        return null;
    }
    const bitmap = decoded;
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let pixels: Uint8ClampedArray | undefined;
    if (context !== null) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        try {
            pixels = context.getImageData(0, 0, width, height).data;
        } catch {
            // A cross-origin image without CORS headers taints the canvas.
            pixels = undefined;
        }
    }
    bitmap.close();
    if (pixels === undefined) {
        return null;
    }

    const samples = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
        const from = index * 4;
        const to = index * 3;
        samples[to] = pixels[from] ?? 0;
        samples[to + 1] = pixels[from + 1] ?? 0;
        samples[to + 2] = pixels[from + 2] ?? 0;
    }
    return { data: await deflate(samples), width, height, jpeg: false, gray: false };
}

async function deflate(samples: Uint8Array): Promise<Uint8Array> {
    if (typeof CompressionStream === "undefined") {
        return samples;
    }
    try {
        const stream = new Blob([samples as BlobPart])
            .stream()
            .pipeThrough(new CompressionStream("deflate"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return samples;
    }
}

function slug(title: string): string {
    const value = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return value.length > 0 ? value : "document";
}
