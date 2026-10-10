import { createSignal, type Accessor, type Setter } from "solid-js";

import { ExportFormat } from "../domain/ExportFormat";
import type { ExportResult } from "../domain/ExportResult";
import { isExportSuccess } from "../domain/ExportResult";

export class ExportStore {
    readonly activeFormat: Accessor<ExportFormat>;

    readonly isBusy: Accessor<boolean>;

    readonly lastStatus: Accessor<string>;

    private readonly setFormat: Setter<ExportFormat>;

    private readonly setBusy: Setter<boolean>;

    private readonly setStatus: Setter<string>;

    constructor() {
        const [activeFormat, setFormat] = createSignal<ExportFormat>(ExportFormat.PDF);
        const [isBusy, setBusy] = createSignal(false);
        const [lastStatus, setStatus] = createSignal("");
        this.activeFormat = activeFormat;
        this.setFormat = setFormat;
        this.isBusy = isBusy;
        this.setBusy = setBusy;
        this.lastStatus = lastStatus;
        this.setStatus = setStatus;
    }

    setActiveFormat(format: ExportFormat): void {
        this.setFormat(format);
    }

    begin(): void {
        this.setBusy(true);
        this.setStatus("");
    }

    fail(message: string): void {
        this.setBusy(false);
        this.setStatus(message);
    }

    settle(result: ExportResult): void {
        this.setBusy(false);
        if (result.kind === "failure") {
            this.setStatus(result.message);
            return;
        }
        if (isExportSuccess(result)) {
            this.setStatus(`Saved ${result.format.toUpperCase()}`);
            return;
        }
        this.setStatus("Export cancelled");
    }
}
