import type { DesktopCommand, DesktopHost } from "../../port/DesktopHost";

export interface NativeEntry {
    id: string;
    name: string;
    kind: "file" | "directory";
}

export interface DesktopBridge {
    ChooseFile(book: boolean): Promise<NativeEntry | null>;
    ChooseSave(name: string): Promise<NativeEntry | null>;
    ChooseFolder(): Promise<NativeEntry | null>;
    Child(
        id: string,
        name: string,
        kind: "file" | "directory",
        create: boolean
    ): Promise<NativeEntry>;
    List(id: string): Promise<NativeEntry[]>;
    ReadFile(id: string): Promise<{ data: string; modified: number }>;
    WriteFile(id: string, data: string): Promise<void>;
    RemoveFile(id: string, name: string): Promise<void>;
    LoadRecovery(): Promise<string>;
    SaveRecovery(snapshot: string): Promise<void>;
    Ready(): Promise<void>;
    ConfirmClose(): Promise<void>;
    ShowPrivacy(): Promise<void>;
}

declare global {
    interface Window {
        go?: { main?: { App?: DesktopBridge } };
        runtime?: {
            EventsOn: (name: string, callback: (...args: unknown[]) => void) => () => void;
        };
    }
}

export function desktopBridge(): DesktopBridge | undefined {
    return window.go?.main?.App;
}

export function nativeError(issue: unknown): Error {
    if (issue instanceof Error) return issue;
    const message = String(issue);
    return message.startsWith("NotFoundError:")
        ? new DOMException(message, "NotFoundError")
        : new Error(message);
}

export function selectedEntry(entry: NativeEntry | null): NativeEntry {
    if (entry === null) throw new DOMException("Save or open cancelled.", "AbortError");
    return entry;
}

export function encodeBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error("Could not read file data."));
        reader.onload = () => {
            if (typeof reader.result !== "string") {
                reject(new Error("Could not encode file data."));
                return;
            }
            resolve(reader.result.split(",")[1] ?? "");
        };
        reader.readAsDataURL(blob);
    });
}

export function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createDesktopHost(bridge: DesktopBridge): DesktopHost {
    return {
        onCommand: (handler) =>
            window.runtime?.EventsOn("desktop:command", (command) => {
                if (typeof command === "string") handler(command as DesktopCommand);
            }) ?? (() => undefined),
        onBeforeClose: (handler) =>
            window.runtime?.EventsOn("desktop:before-close", handler) ?? (() => undefined),
        ready: () => bridge.Ready(),
        confirmClose: () => bridge.ConfirmClose(),
        showPrivacy: () => bridge.ShowPrivacy()
    };
}
