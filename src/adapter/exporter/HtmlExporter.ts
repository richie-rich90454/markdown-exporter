import { ExportFormat } from "../../domain/ExportFormat";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";
import { HtmlEscaper } from "../../util/HtmlEscaper";

const STYLESHEET = [
    "body{margin:0;padding:24px;background:#fff;color:#0a0a0a;font:16px/1.6 Georgia,'Times New Roman',serif}",
    "h1,h2,h3,h4,h5,h6{font-weight:600;line-height:1.3;margin:1.4em 0 .5em}",
    "h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}",
    "p,ul,ol,table,blockquote,pre{margin:0 0 1em}",
    "a{color:#0a0a0a;text-decoration:underline}",
    "code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875em}",
    "pre{padding:12px;background:#f7f7f7;overflow:auto}",
    "table{border-collapse:collapse;width:100%}",
    "th,td{border:1px solid #e4e4e4;padding:6px 8px;text-align:left}",
    "th{font-weight:600}",
    "blockquote{border-left:2px solid #6b6b6b;margin-left:0;padding-left:12px;color:#6b6b6b}",
    "img{max-width:100%}",
    "hr{border:none;border-top:1px solid #e4e4e4}"
].join("\n");

export class HtmlExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.HTML;

    constructor(private readonly fileSaver: FileSaver) {}

    export(request: ExportRequest): Promise<ExportResult> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`HtmlExporter cannot export ${request.format}`);
        }
        const body = new XMLSerializer().serializeToString(request.content);
        const html =
            `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
            `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
            `<title>${HtmlEscaper.escape(request.title || "Document")}</title>\n` +
            `<style>\n${STYLESHEET}\n</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        this.fileSaver.saveBlob(blob, `${slug(request.title)}.html`);
        return Promise.resolve(ExportResults.success(this.supportedFormat));
    }
}

function slug(title: string): string {
    const value = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return value.length > 0 ? value : "document";
}
