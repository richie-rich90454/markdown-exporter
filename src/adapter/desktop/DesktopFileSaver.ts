import type { FileSaver } from "../../port/FileSaver";
import { encodeBlob, selectedEntry, type DesktopBridge } from "./DesktopBridge";

export class DesktopFileSaver implements FileSaver {
    constructor(private readonly bridge: DesktopBridge) {}
    async saveBlob(blob: Blob, name: string): Promise<void> {
        const target = selectedEntry(await this.bridge.ChooseSave(name));
        await this.bridge.WriteFile(target.id, await encodeBlob(blob));
    }
}
