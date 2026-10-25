import { ExportFormat } from "../../domain/ExportFormat";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";
import type { LaidOut, PdfImageSource } from "../../domain/pdf/PdfLayout";
import { parseBlocks } from "../../domain/pdf/PdfLayout";
import { paginate } from "../../domain/pdf/PdfPaginate";
import { resolveImages, rasterize } from "../../domain/pdf/ImageDecode";
import { writePdf } from "../../domain/pdf/PdfWriter";

export class PdfExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.PDF;

    constructor(private readonly fileSaver: FileSaver) {}

    async export(request: ExportRequest): Promise<ExportResult> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`PdfExporter cannot export ${request.format}`);
        }
        const decoded = await resolveImages(request.content);
        const embeds = new Map<string, boolean>();
        const drawn = new Map<string, PdfImageSource | null>();
        for (const [src, bitmap] of decoded) {
            const image = bitmap === null ? null : await rasterize(bitmap);
            embeds.set(src, image !== null);
            drawn.set(src, image);
        }
        const layout: LaidOut = paginate(parseBlocks(request.content), request.pageSetup, embeds);
        const katexFonts =
            layout.mathFonts.length > 0
                ? (await import("./KatexPdfFonts")).loadKatexPdfFonts(layout.mathFonts)
                : undefined;
        const bytes: Uint8Array = writePdf(
            layout,
            layout.images.map((image) => drawn.get(image.src) ?? null),
            request.title,
            request.pageSetup,
            katexFonts
        );
        this.fileSaver.saveBlob(
            new Blob([bytes as BlobPart], { type: "application/pdf" }),
            `${slug(request.title)}.pdf`
        );
        return ExportResults.success(this.supportedFormat);
    }
}

function slug(title: string): string {
    const value = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return value.length > 0 ? value : "document";
}
