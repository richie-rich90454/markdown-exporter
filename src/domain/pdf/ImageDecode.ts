import type { PdfImageSource } from "./PdfLayout";

// A wall clock image is never worth the memory: the PDF caps it here.
const MAX_PIXELS = 4096;

// Decoded once per source and shared by the preview and the exporter, so an
// image is never read twice for the same document.
const cache = new Map<string, ImageBitmap | null>();

async function read(
    src: string,
    element: HTMLImageElement | undefined
): Promise<ImageBitmap | null> {
    // The browser already decoded this for the preview, so asking it for the
    // bitmap is both the cheapest and the most forgiving path.
    if (element !== undefined && element.complete && element.naturalWidth > 0) {
        try {
            return await createImageBitmap(element);
        } catch {
            // Some images decode for the page but not for the encoder.
        }
    }
    try {
        const response = await fetch(src);
        if (!response.ok) {
            return null;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length < 2) {
            return null;
        }
        return await createImageBitmap(new Blob([bytes]));
    } catch {
        // A broken image, or one the browser refuses to hand out.
        return null;
    }
}

export async function decodeImage(
    src: string,
    element?: HTMLImageElement
): Promise<ImageBitmap | null> {
    const cached = cache.get(src);
    if (cached !== undefined) {
        return cached;
    }
    const bitmap = await read(src, element);
    cache.set(src, bitmap);
    return bitmap;
}

export async function resolveImages(root: Node): Promise<Map<string, ImageBitmap | null>> {
    const resolved = new Map<string, ImageBitmap | null>();
    if (!(root instanceof Element)) {
        return resolved;
    }
    for (const element of Array.from(root.querySelectorAll("img"))) {
        const src = element.currentSrc || element.src;
        if (src.length > 0 && !resolved.has(src)) {
            resolved.set(src, await decodeImage(src, element));
        }
    }
    return resolved;
}

export async function rasterize(bitmap: ImageBitmap): Promise<PdfImageSource | null> {
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
