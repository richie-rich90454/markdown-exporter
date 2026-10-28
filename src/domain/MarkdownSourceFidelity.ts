interface MarkdownBlock {
    readonly source: string;
    readonly signature: string;
}

/**
 * Restores the original spelling of unchanged top-level blocks after a rich
 * editor serialization. Opaque syntax that the rich editor cannot represent
 * is anchored to its nearest surviving neighbors and kept verbatim.
 */
export function preserveMarkdownSource(
    originalSource: string,
    baselineSerialization: string,
    currentSerialization: string
): string {
    const original = splitBlocks(originalSource);
    const baseline = splitBlocks(baselineSerialization);
    const current = splitBlocks(currentSerialization);
    if (original.length === 0 || current.length === 0) return currentSerialization;

    const baselineIndexBySource = new Map<number, number>();
    let baselineCursor = 0;
    for (let sourceIndex = 0; sourceIndex < original.length; sourceIndex += 1) {
        const block = original[sourceIndex];
        if (block === undefined) continue;
        const match = findBlock(baseline, block.signature, baselineCursor);
        if (match >= 0) {
            baselineIndexBySource.set(sourceIndex, match);
            baselineCursor = match + 1;
        }
    }

    const currentIndexBySource = new Map<number, number>();
    const replacements = new Map<number, string>();
    let currentCursor = 0;
    for (const [sourceIndex, baselineIndex] of baselineIndexBySource) {
        const sourceBlock = original[sourceIndex];
        const baselineBlock = baseline[baselineIndex];
        if (sourceBlock === undefined || baselineBlock === undefined) continue;
        const match = findBlock(current, baselineBlock.signature, currentCursor);
        if (match < 0) continue;
        currentIndexBySource.set(sourceIndex, match);
        replacements.set(match, sourceBlock.source);
        currentCursor = match + 1;
    }

    const insertions = new Map<number, MarkdownBlock[]>();
    for (let sourceIndex = 0; sourceIndex < original.length; sourceIndex += 1) {
        const block = original[sourceIndex];
        if (block === undefined || !isOpaque(block.source)) continue;
        if (current.some((candidate) => candidate.signature === block.signature)) continue;

        let insertionIndex = current.length;
        for (let next = sourceIndex + 1; next < original.length; next += 1) {
            const nextIndex = currentIndexBySource.get(next);
            if (nextIndex !== undefined) {
                insertionIndex = nextIndex;
                break;
            }
        }
        if (insertionIndex === current.length) {
            for (let previous = sourceIndex - 1; previous >= 0; previous -= 1) {
                const previousIndex = currentIndexBySource.get(previous);
                if (previousIndex !== undefined) {
                    insertionIndex = previousIndex + 1;
                    break;
                }
            }
        }
        const bucket = insertions.get(insertionIndex) ?? [];
        bucket.push(block);
        insertions.set(insertionIndex, bucket);
    }

    const output: string[] = [];
    for (let index = 0; index <= current.length; index += 1) {
        output.push(...(insertions.get(index) ?? []).map((block) => block.source));
        if (index === current.length) break;
        output.push(replacements.get(index) ?? current[index]?.source ?? "");
    }
    return output.join("\n\n");
}

function findBlock(blocks: readonly MarkdownBlock[], signature: string, from: number): number {
    for (let index = from; index < blocks.length; index += 1) {
        if (blocks[index]?.signature === signature) return index;
    }
    return -1;
}

function isOpaque(source: string): boolean {
    return (
        /^---\s*\n[\s\S]*\n---\s*$/.test(source) ||
        /^\+\+\+\s*\n[\s\S]*\n\+\+\+\s*$/.test(source) ||
        /^\[\^[^\]]+\]:/m.test(source) ||
        /^:{3,}(?:\s|\w|$)/m.test(source) ||
        /^<!--[\s\S]*-->\s*$/.test(source) ||
        /^<(?:[a-z][\w-]*(?:\s|>|\/)|!DOCTYPE\b)/i.test(source) ||
        /^\[[^\]]+\]:\s*\S+/m.test(source)
    );
}

function splitBlocks(source: string): MarkdownBlock[] {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const blocks: MarkdownBlock[] = [];
    let pending: string[] = [];
    let fence: { readonly marker: string; readonly length: number } | undefined;
    let firstLine = 0;
    const frontMatterMarker = /^\s*(---|\+\+\+)\s*$/.exec(lines[0] ?? "")?.[1];
    if (frontMatterMarker !== undefined) {
        const closing = lines.findIndex((line, index) => index > 0 && line.trim() === frontMatterMarker);
        if (closing > 0) {
            const frontMatter = lines.slice(0, closing + 1).join("\n");
            blocks.push({ source: frontMatter, signature: signature(frontMatter) });
            firstLine = closing + 1;
        }
    }
    let directiveDepth = 0;

    const flush = (): void => {
        while (pending[0] === "") pending.shift();
        while (pending.at(-1) === "") pending.pop();
        if (pending.length > 0) {
            const value = pending.join("\n");
            blocks.push({ source: value, signature: signature(value) });
        }
        pending = [];
    };

    for (const line of lines.slice(firstLine)) {
        const trimmed = line.trimStart();
        const open = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
        if (fence === undefined && open !== undefined) {
            fence = { marker: open[0] ?? "`", length: open.length };
        } else if (fence !== undefined && new RegExp(`^${fence.marker}{${fence.length},}\\s*$`).test(trimmed)) {
            fence = undefined;
        }

        if (fence === undefined && /^:{3,}(?:\s|\w|$)/.test(trimmed)) {
            directiveDepth += /^:{3,}\s*\w/.test(trimmed) ? 1 : -1;
            directiveDepth = Math.max(directiveDepth, 0);
        }

        if (fence === undefined && directiveDepth === 0 && line.trim().length === 0) {
            flush();
            continue;
        }
        pending.push(line);
    }
    flush();
    return blocks;
}

function signature(value: string): string {
    const normalized = value.replace(/\r\n?/g, "\n").trim();
    if (/^\s{0,3}(?:`{3,}|~{3,})/.test(normalized)) return normalized;
    const setext = /^([^\n]+)\n\s*(=+|-+)\s*$/.exec(normalized);
    const heading = setext === null ? normalized : `${setext[2]?.[0] === "=" ? "#" : "##"} ${setext[1]}`;
    let hardBreakCount = 0;
    const withTokens = heading
        .replace(/ {2,}\n/g, () => `__HARD_BREAK_${hardBreakCount++}__`)
        .replace(/(`+)([^`]*?)\1/g, (code) => `__CODE_${encodeURIComponent(code)}__`);
    return withTokens.replace(/\s+/g, " ").trim();
}
