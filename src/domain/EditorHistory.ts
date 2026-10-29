export type EditorHistoryChangeKind = "typing" | "deletion" | "paste" | "format" | "replacement";

export interface EditorHistoryOptions {
    /** Maximum number of atomic source patches retained across both stacks. */
    readonly maxSteps?: number;
    /** Maximum approximate UTF-8 bytes retained across both stacks. */
    readonly maxBytes?: number;
    /** Maximum time between compatible changes that can share one undo step. */
    readonly groupDelayMs?: number;
}

export interface EditorHistoryRecordOptions {
    readonly kind?: EditorHistoryChangeKind;
    /** A monotonic timestamp supplied by the caller when deterministic grouping is needed. */
    readonly timestamp?: number;
}

export interface EditorHistoryPatch {
    readonly from: number;
    readonly removed: string;
    readonly inserted: string;
}

type SourcePatch = EditorHistoryPatch;

interface HistoryEntry {
    readonly type: "source";
    readonly patches: SourcePatch[];
    readonly kind: EditorHistoryChangeKind;
    lastChangedAt: number;
    bytes: number;
}

interface ExternalHistoryEntry {
    readonly type: "external";
    readonly actionId: string;
    readonly patch: SourcePatch;
    readonly bytes: number;
}

type UndoEntry = HistoryEntry | ExternalHistoryEntry;

export type EditorHistoryStepInfo =
    | { readonly type: "source" }
    | { readonly type: "external"; readonly actionId: string };

export type EditorHistoryStepResult = EditorHistoryStepInfo & { readonly source: string };

const DEFAULT_MAX_STEPS = 500;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_GROUP_DELAY_MS = 750;
const utf8Encoder = new TextEncoder();

/**
 * Bounded source-patch undo history shared by editors that use different
 * internal models. It stores only the changed text ranges, not whole-document
 * snapshots. Call reset whenever a file or project replaces the active source.
 */
export class EditorHistory {
    private readonly maxSteps: number;
    private readonly maxBytes: number;
    private readonly groupDelayMs: number;
    private readonly undoEntries: UndoEntry[] = [];
    private readonly redoEntries: UndoEntry[] = [];
    private source: string;
    private bytes = 0;
    private steps = 0;
    private groupingBarrier = true;

    constructor(initialSource = "", options: EditorHistoryOptions = {}) {
        this.maxSteps = positiveInteger(options.maxSteps, DEFAULT_MAX_STEPS);
        this.maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
        const groupDelay = options.groupDelayMs ?? DEFAULT_GROUP_DELAY_MS;
        this.groupDelayMs = Number.isFinite(groupDelay)
            ? Math.max(0, groupDelay)
            : DEFAULT_GROUP_DELAY_MS;
        this.source = initialSource;
    }

    /** Current source tracked by this history, primarily for adapter consistency checks. */
    current(): string {
        return this.source;
    }

    canUndo(): boolean {
        return this.undoEntries.length > 0;
    }

    canRedo(): boolean {
        return this.redoEntries.length > 0;
    }

    nextUndoStep(): EditorHistoryStepInfo | undefined {
        return describeStep(this.undoEntries.at(-1));
    }

    nextRedoStep(): EditorHistoryStepInfo | undefined {
        return describeStep(this.redoEntries.at(-1));
    }

    hasExternalAction(actionId: string): boolean {
        return (
            this.undoEntries.some(
                (entry) => entry.type === "external" && entry.actionId === actionId
            ) ||
            this.redoEntries.some(
                (entry) => entry.type === "external" && entry.actionId === actionId
            )
        );
    }

    retainedBytes(): number {
        return this.bytes;
    }

    retainedSteps(): number {
        return this.steps;
    }

    /**
     * Starts a new document session and drops history for the previous file.
     */
    reset(source: string): void {
        this.source = source;
        this.undoEntries.length = 0;
        this.redoEntries.length = 0;
        this.bytes = 0;
        this.steps = 0;
        this.groupingBarrier = true;
    }

    /**
     * Prevents the next recorded edit from merging into the current typing
     * group while keeping both undo and redo stacks intact.
     */
    breakGroup(): void {
        this.groupingBarrier = true;
    }

    /**
     * Records a source update. Typing and deletion updates within the grouping
     * window merge only when their patches are adjacent at the same caret.
     * Oversized single edits become a history reset because retaining a useful
     * inverse would exceed the configured memory budget.
     */
    record(nextSource: string, options: EditorHistoryRecordOptions = {}): boolean {
        if (nextSource === this.source) return false;
        const patch = diffSource(this.source, nextSource);
        return this.recordPatch(patch, options);
    }

    /**
     * Records a known source range change without diffing the whole document.
     * CodeMirror/ProseMirror adapters should prefer this for keystroke updates.
     */
    recordPatch(patch: EditorHistoryPatch, options: EditorHistoryRecordOptions = {}): boolean {
        const nextSource = applyPatch(this.source, patch, false);
        if (nextSource === undefined || nextSource === this.source) return false;
        const patchBytes = patchSize(patch);
        const kind = options.kind ?? inferredKind(patch);
        const changedAt = options.timestamp ?? Date.now();

        if (patchBytes > this.maxBytes || this.maxSteps < 1) {
            this.reset(nextSource);
            return false;
        }

        this.clearRedo();
        const previous = this.undoEntries.at(-1);
        const canMerge =
            !this.groupingBarrier &&
            previous !== undefined &&
            previous.type === "source" &&
            previous.kind === kind &&
            (kind === "typing" || kind === "deletion") &&
            changedAt >= previous.lastChangedAt &&
            changedAt - previous.lastChangedAt <= this.groupDelayMs &&
            previous.patches.length < this.maxSteps &&
            patchesAreAdjacent(previous.patches.at(-1), patch, kind) &&
            this.bytes + patchBytes <= this.maxBytes;

        if (canMerge && previous !== undefined && previous.type === "source") {
            previous.patches.push(patch);
            previous.lastChangedAt = changedAt;
            previous.bytes += patchBytes;
            this.bytes += patchBytes;
            this.steps += 1;
        } else {
            this.undoEntries.push({
                type: "source",
                patches: [patch],
                kind,
                lastChangedAt: changedAt,
                bytes: patchBytes
            });
            this.bytes += patchBytes;
            this.steps += 1;
        }

        this.source = nextSource;
        this.groupingBarrier = false;
        this.trimToBudget();
        return true;
    }

    /**
     * Records a non-typing operation owned by another store, such as a
     * manuscript-wide replacement. Its active-source patch occupies one
     * chronological history step alongside ordinary edits.
     */
    recordExternalTransition(
        actionId: string,
        nextSource: string,
        retainedPayloadBytes = 0
    ): boolean {
        if (actionId.trim().length === 0)
            throw new Error("An external history action needs an id.");
        if (!Number.isSafeInteger(retainedPayloadBytes) || retainedPayloadBytes < 0) {
            throw new Error("External history payload size must be a non-negative integer.");
        }
        const patch = diffSource(this.source, nextSource);
        const patchBytes = patchSize(patch) + retainedPayloadBytes;
        if (patchBytes > this.maxBytes || this.maxSteps < 1) {
            this.reset(nextSource);
            return false;
        }

        this.clearRedo();
        this.undoEntries.push({ type: "external", actionId, patch, bytes: patchBytes });
        this.source = nextSource;
        this.groupingBarrier = true;
        this.bytes += patchBytes;
        this.steps += 1;
        this.trimToBudget();
        return true;
    }

    /** Applies one grouped inverse and returns the resulting source. */
    undo(currentSource?: string): string | undefined {
        return this.undoStep(currentSource)?.source;
    }

    /** Applies the next inverse and reports whether it traversed an external action. */
    undoStep(currentSource?: string): EditorHistoryStepResult | undefined {
        if (currentSource !== undefined && currentSource !== this.source) {
            this.reset(currentSource);
            return undefined;
        }
        const entry = this.undoEntries.pop();
        if (entry === undefined) return undefined;

        const nextSource = applyEntry(this.source, entry, true);
        if (nextSource === undefined) {
            this.reset(this.source);
            return undefined;
        }

        this.source = nextSource;
        this.redoEntries.push(entry);
        this.groupingBarrier = true;
        return resultFor(entry, nextSource);
    }

    /** Reapplies one grouped change and returns the resulting source. */
    redo(currentSource?: string): string | undefined {
        return this.redoStep(currentSource)?.source;
    }

    /** Reapplies the next change and reports whether it traversed an external action. */
    redoStep(currentSource?: string): EditorHistoryStepResult | undefined {
        if (currentSource !== undefined && currentSource !== this.source) {
            this.reset(currentSource);
            return undefined;
        }
        const entry = this.redoEntries.pop();
        if (entry === undefined) return undefined;

        const nextSource = applyEntry(this.source, entry, false);
        if (nextSource === undefined) {
            this.reset(this.source);
            return undefined;
        }

        this.source = nextSource;
        this.undoEntries.push(entry);
        this.groupingBarrier = true;
        return resultFor(entry, nextSource);
    }

    private clearRedo(): void {
        for (const entry of this.redoEntries) {
            this.bytes -= entry.bytes;
            this.steps -= entryStepCount(entry);
        }
        this.redoEntries.length = 0;
    }

    private trimToBudget(): void {
        while (this.bytes > this.maxBytes || this.steps > this.maxSteps) {
            const oldest = this.undoEntries.shift() ?? this.redoEntries.shift();
            if (oldest === undefined) break;
            this.bytes -= oldest.bytes;
            this.steps -= entryStepCount(oldest);
        }
    }
}

function describeStep(entry: UndoEntry | undefined): EditorHistoryStepInfo | undefined {
    if (entry === undefined) return undefined;
    return entry.type === "external"
        ? { type: "external", actionId: entry.actionId }
        : { type: "source" };
}

function resultFor(entry: UndoEntry, source: string): EditorHistoryStepResult {
    return entry.type === "external"
        ? { type: "external", actionId: entry.actionId, source }
        : { type: "source", source };
}

function entryStepCount(entry: UndoEntry): number {
    return entry.type === "external" ? 1 : entry.patches.length;
}

function applyEntry(source: string, entry: UndoEntry, inverse: boolean): string | undefined {
    if (entry.type === "external") return applyPatch(source, entry.patch, inverse);
    let result = source;
    const patches = inverse ? [...entry.patches].reverse() : entry.patches;
    for (const patch of patches) {
        const next = applyPatch(result, patch, inverse);
        if (next === undefined) return undefined;
        result = next;
    }
    return result;
}

function positiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.max(1, Math.floor(value));
}

function diffSource(before: string, after: string): SourcePatch {
    let prefix = 0;
    const sharedLimit = Math.min(before.length, after.length);
    while (prefix < sharedLimit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
        prefix += 1;
    }

    let suffix = 0;
    const suffixLimit = sharedLimit - prefix;
    while (
        suffix < suffixLimit &&
        before.charCodeAt(before.length - suffix - 1) ===
            after.charCodeAt(after.length - suffix - 1)
    ) {
        suffix += 1;
    }

    return {
        from: prefix,
        removed: before.slice(prefix, before.length - suffix),
        inserted: after.slice(prefix, after.length - suffix)
    };
}

function patchesAreAdjacent(
    previous: SourcePatch | undefined,
    next: SourcePatch,
    kind: EditorHistoryChangeKind
): boolean {
    if (previous === undefined) return false;
    if (kind === "typing") {
        return (
            next.removed.length === 0 &&
            previous.inserted.length > 0 &&
            next.from === previous.from + previous.inserted.length
        );
    }
    if (kind === "deletion") {
        return (
            next.inserted.length === 0 &&
            previous.inserted.length === 0 &&
            (next.from === previous.from || next.from + next.removed.length === previous.from)
        );
    }
    return false;
}

function applyPatch(source: string, patch: SourcePatch, inverse: boolean): string | undefined {
    const expected = inverse ? patch.inserted : patch.removed;
    const replacement = inverse ? patch.removed : patch.inserted;
    if (
        !Number.isSafeInteger(patch.from) ||
        patch.from < 0 ||
        patch.from + expected.length > source.length
    )
        return undefined;
    if (source.slice(patch.from, patch.from + expected.length) !== expected) return undefined;
    return source.slice(0, patch.from) + replacement + source.slice(patch.from + expected.length);
}

function patchSize(patch: SourcePatch): number {
    return utf8Length(patch.removed) + utf8Length(patch.inserted) + 24;
}

function inferredKind(patch: SourcePatch): EditorHistoryChangeKind {
    if (patch.removed.length === 0 && patch.inserted.length > 0) return "typing";
    if (patch.inserted.length === 0 && patch.removed.length > 0) return "deletion";
    return "replacement";
}

function utf8Length(value: string): number {
    return utf8Encoder.encode(value).byteLength;
}
