import type { ExportFormat } from "./ExportFormat";

export type ExportResult = ExportSuccess | ExportCancelled | ExportFailure;

export interface ExportSuccess {
    readonly kind: "success";
    readonly format: ExportFormat;
}

export interface ExportCancelled {
    readonly kind: "cancelled";
    readonly format: ExportFormat;
}

export interface ExportFailure {
    readonly kind: "failure";
    readonly format: ExportFormat;
    readonly message: string;
}

export const ExportResults = {
    success(format: ExportFormat): ExportResult {
        return { kind: "success", format };
    },
    cancelled(format: ExportFormat): ExportResult {
        return { kind: "cancelled", format };
    },
    failure(format: ExportFormat, message: string): ExportResult {
        return { kind: "failure", format, message };
    }
};

export function isExportSuccess(result: ExportResult): result is ExportSuccess {
    return result.kind === "success";
}
