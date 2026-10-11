export const ExportFormat = {
    PDF: "pdf",
    HTML: "html"
} as const;

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export const EXPORT_FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
    [ExportFormat.PDF]: "PDF",
    [ExportFormat.HTML]: "HTML"
};
