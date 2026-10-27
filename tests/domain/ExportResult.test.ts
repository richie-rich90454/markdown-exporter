import { describe, expect, it } from "vitest";

import { ExportFormat, EXPORT_FORMAT_LABELS } from "../../src/domain/ExportFormat";
import { ExportResults, isExportSuccess } from "../../src/domain/ExportResult";

describe("ExportFormat", () => {
    it("ships PDF, HTML, EPUB, and Word formats", () => {
        expect(Object.values(ExportFormat)).toEqual(["pdf", "html", "epub", "docx"]);
    });

    it("labels every format", () => {
        expect(EXPORT_FORMAT_LABELS[ExportFormat.PDF]).toBe("PDF");
        expect(EXPORT_FORMAT_LABELS[ExportFormat.HTML]).toBe("HTML");
        expect(EXPORT_FORMAT_LABELS[ExportFormat.EPUB]).toBe("EPUB");
        expect(EXPORT_FORMAT_LABELS[ExportFormat.DOCX]).toBe("Word document");
    });
});

describe("ExportResult", () => {
    it("is a sealed discriminated union", () => {
        expect(ExportResults.success(ExportFormat.HTML)).toEqual({
            kind: "success",
            format: "html"
        });
        expect(ExportResults.cancelled(ExportFormat.PDF)).toEqual({
            kind: "cancelled",
            format: "pdf"
        });
        expect(ExportResults.failure(ExportFormat.PDF, "no paper")).toEqual({
            kind: "failure",
            format: "pdf",
            message: "no paper"
        });
    });

    it("narrows success", () => {
        const result = ExportResults.success(ExportFormat.PDF);
        expect(isExportSuccess(result)).toBe(true);
        expect(isExportSuccess(ExportResults.failure(ExportFormat.PDF, "x"))).toBe(false);
    });
});
