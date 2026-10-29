import type { DraftRecovery, RecoveredDraft } from "../../port/DraftRecovery";
import { validateBookProject, type BookProject } from "../../domain/BookProject";

const DATABASE_NAME = "markdown-exporter-local";
const STORE_NAME = "drafts";
const DRAFT_KEY = "active-document";
const LOCAL_STORAGE_KEY = "markdown-exporter:recovery-draft";
let recoveryWriteQueue: Promise<void> = Promise.resolve();
let recoveryClockInitialized = false;
let latestRecoverySavedAt = 0;

async function loadRecoveryDraft(): Promise<RecoveredDraft | null> {
    const localDraft = loadLocalStorageDraft();
    try {
        const database = await openDatabase();
        if (database !== null) {
            try {
                const indexedDbDraft = await readDraft(database);
                const latest = chooseLatestRecoveryDraft(indexedDbDraft, localDraft);
                rememberRecoveryTime(latest);
                return latest;
            } finally {
                database.close();
            }
        }
    } catch {
        // Browser privacy settings can disable IndexedDB; use localStorage below.
    }
    rememberRecoveryTime(localDraft);
    return localDraft;
}

async function saveRecoveryDraft(
    source: string,
    bookProject?: BookProject,
    activeEntryId?: string
): Promise<void> {
    if (!recoveryClockInitialized) rememberRecoveryTime(await loadRecoveryDraft());
    const savedAt = Math.max(Date.now(), latestRecoverySavedAt + 1);
    latestRecoverySavedAt = savedAt;
    const draft: RecoveredDraft = {
        source,
        // Preserve a strict ordering even for multiple saves in the same millisecond or a clock correction.
        savedAt,
        ...(bookProject === undefined ? {} : { bookProject }),
        ...(activeEntryId === undefined ? {} : { activeEntryId })
    };
    try {
        const database = await openDatabase();
        if (database !== null) {
            try {
                await writeDraft(database, draft);
                return;
            } finally {
                database.close();
            }
        }
    } catch {
        // Keep recovery available in browsers with blocked or unavailable IndexedDB.
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft, encodeBinary));
}

function rememberRecoveryTime(draft: RecoveredDraft | null): void {
    if (draft !== null) latestRecoverySavedAt = Math.max(latestRecoverySavedAt, draft.savedAt);
    recoveryClockInitialized = true;
}

export class BrowserDraftRecovery implements DraftRecovery {
    load(): Promise<RecoveredDraft | null> {
        return loadRecoveryDraft();
    }

    save(source: string, bookProject?: BookProject, activeEntryId?: string): Promise<void> {
        const pending = recoveryWriteQueue.then(() => saveRecoveryDraft(source, bookProject, activeEntryId));
        // A failed write should be reported to its caller but must not prevent later edits from being saved.
        recoveryWriteQueue = pending.catch(() => undefined);
        return pending;
    }
}

function openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
            reject(request.error ?? new Error("Could not open local recovery storage."));
        request.onblocked = () => reject(new Error("Local recovery storage is blocked."));
    });
}

function readDraft(database: IDBDatabase): Promise<RecoveredDraft | null> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(DRAFT_KEY);
        request.onsuccess = () => {
            resolve(normalizeDraft(request.result as Partial<RecoveredDraft> | undefined));
        };
        request.onerror = () =>
            reject(request.error ?? new Error("Could not load the recovery draft."));
        transaction.onabort = () =>
            reject(transaction.error ?? new Error("Recovery read was interrupted."));
    });
}

function normalizeDraft(value: Partial<RecoveredDraft> | null | undefined): RecoveredDraft | null {
    if (value === null || value === undefined || typeof value.source !== "string") return null;
    let bookProject: BookProject | undefined;
    try {
        if (value.bookProject !== undefined) bookProject = validateBookProject(value.bookProject);
    } catch {
        // A damaged book snapshot should not prevent recovering its active Markdown text.
    }
    const activeEntryId = typeof value.activeEntryId === "string" &&
        bookProject?.manifest.entries.some((entry) => entry.id === value.activeEntryId)
        ? value.activeEntryId
        : undefined;
    return {
        source: value.source,
        savedAt: typeof value.savedAt === "number" && Number.isFinite(value.savedAt)
            ? Math.max(0, Math.trunc(value.savedAt))
            : 0,
        ...(bookProject === undefined ? {} : { bookProject }),
        ...(activeEntryId === undefined ? {} : { activeEntryId })
    };
}

/** Prefers the most recently saved copy when both local recovery backends contain a draft. */
export function chooseLatestRecoveryDraft(
    indexedDbDraft: RecoveredDraft | null,
    localStorageDraft: RecoveredDraft | null
): RecoveredDraft | null {
    if (indexedDbDraft === null) return localStorageDraft;
    if (localStorageDraft === null) return indexedDbDraft;
    return indexedDbDraft.savedAt >= localStorageDraft.savedAt ? indexedDbDraft : localStorageDraft;
}

function loadLocalStorageDraft(): RecoveredDraft | null {
    try {
        const value = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (value === null) return null;
        const parsed = JSON.parse(value, decodeBinary) as Partial<RecoveredDraft>;
        return normalizeDraft(parsed);
    } catch {
        return null;
    }
}

function encodeBinary(_key: string, value: unknown): unknown {
    if (!(value instanceof Uint8Array)) return value;
    let binary = "";
    for (let offset = 0; offset < value.length; offset += 0x8000) {
        binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
    }
    return { __binary: "uint8", data: btoa(binary) };
}

function decodeBinary(_key: string, value: unknown): unknown {
    if (typeof value !== "object" || value === null || !("__binary" in value) || !("data" in value)) return value;
    const encoded = value as { readonly __binary?: unknown; readonly data?: unknown };
    if (encoded.__binary !== "uint8" || typeof encoded.data !== "string") return value;
    try {
        const binary = atob(encoded.data);
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
        return value;
    }
}

function writeDraft(database: IDBDatabase, draft: RecoveredDraft): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(draft, DRAFT_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
            reject(transaction.error ?? new Error("Could not save the recovery draft."));
        transaction.onabort = () =>
            reject(transaction.error ?? new Error("Recovery write was interrupted."));
    });
}
