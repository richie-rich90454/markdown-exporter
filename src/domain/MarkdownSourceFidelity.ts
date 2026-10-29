interface MarkdownBlock {
    readonly source: string;
    readonly signature: string;
    readonly start: number;
    readonly end: number;
}

/**
 * Restores the original spelling of unchanged top-level blocks after a rich
 * editor serialization. Opaque blocks and recognized unsupported inline tokens
 * that the rich editor cannot represent are anchored to surviving text.
 */
export function preserveMarkdownSource(
    originalSource: string,
    baselineSerialization: string,
    currentSerialization: string
): string {
    const original = splitBlocks(originalSource);
    const baseline = splitBlocks(baselineSerialization);
    const current = splitBlocks(currentSerialization);
    if (original.length === 0) return currentSerialization;
    if (baselineSerialization === currentSerialization) return originalSource;

    const baselineLookup = indexBlocks(baseline);
    const baselineIndexBySource = new Map<number, number>();
    let baselineCursor = 0;
    for (let sourceIndex = 0; sourceIndex < original.length; sourceIndex += 1) {
        const block = original[sourceIndex];
        if (block === undefined) continue;
        const match = sourceSignatures(block.source)
            .map((candidate) => findBlock(baselineLookup, candidate, baselineCursor))
            .find((candidate) => candidate >= 0) ?? -1;
        if (match >= 0) {
            baselineIndexBySource.set(sourceIndex, match);
            baselineCursor = match + 1;
        }
    }

    const currentIndexBySource = new Map<number, number>();
    const replacements = new Map<number, string>();
    const baselineToSource = new Map<number, number>();
    for (const [sourceIndex, baselineIndex] of baselineIndexBySource) {
        baselineToSource.set(baselineIndex, sourceIndex);
    }

    const baselineToCurrent = alignBlocks(baseline, current);
    for (const [baselineIndex, currentIndex] of baselineToCurrent) {
        const sourceIndex = baselineToSource.get(baselineIndex);
        if (sourceIndex === undefined) continue;
        currentIndexBySource.set(sourceIndex, currentIndex);
        const sourceBlock = original[sourceIndex];
        const baselineBlock = baseline[baselineIndex];
        const currentBlock = current[currentIndex];
        if (sourceBlock !== undefined && baselineBlock !== undefined && currentBlock !== undefined) {
            if (baselineBlock.signature === currentBlock.signature) {
                replacements.set(currentIndex, sourceBlock.source);
            } else {
                const restored = restoreUnsupportedInlineTokens(
                    sourceBlock.source,
                    baselineBlock.source,
                    currentBlock.source
                );
                if (restored !== currentBlock.source) replacements.set(currentIndex, restored);
            }
        }
    }

    const insertions = new Map<number, { readonly block: MarkdownBlock; readonly sourceIndex: number }[]>();
    const currentSignatures = new Set(current.map((block) => block.signature));
    for (let sourceIndex = 0; sourceIndex < original.length; sourceIndex += 1) {
        const block = original[sourceIndex];
        if (block === undefined || !isOpaque(block.source)) continue;
        if (currentIndexBySource.has(sourceIndex) || currentSignatures.has(block.signature)) continue;

        let insertionIndex = current.length;
        if (sourceIndex === 0) {
            insertionIndex = 0;
        } else {
            for (let next = sourceIndex + 1; next < original.length; next += 1) {
                const nextIndex = currentIndexBySource.get(next);
                if (nextIndex !== undefined) {
                    insertionIndex = nextIndex;
                    break;
                }
            }
        }
        if (insertionIndex === current.length && sourceIndex !== 0) {
            for (let previous = sourceIndex - 1; previous >= 0; previous -= 1) {
                const previousIndex = currentIndexBySource.get(previous);
                if (previousIndex !== undefined) {
                    insertionIndex = previousIndex + 1;
                    break;
                }
            }
        }
        const bucket = insertions.get(insertionIndex) ?? [];
        bucket.push({ block, sourceIndex });
        insertions.set(insertionIndex, bucket);
    }

    const sourceByCurrent = new Map<number, number>();
    for (const [sourceIndex, currentIndex] of currentIndexBySource) {
        sourceByCurrent.set(currentIndex, sourceIndex);
    }
    const output: { readonly source: string; readonly originalIndex?: number }[] = [];
    for (let index = 0; index <= current.length; index += 1) {
        output.push(...(insertions.get(index) ?? []).map(({ block, sourceIndex }) => ({
            source: block.source,
            originalIndex: sourceIndex
        })));
        if (index === current.length) break;
        const sourceIndex = sourceByCurrent.get(index);
        output.push({
            source: replacements.get(index) ?? current[index]?.source ?? "",
            ...(sourceIndex === undefined ? {} : { originalIndex: sourceIndex })
        });
    }

    const defaultSeparator = preferredLineEnding(originalSource).repeat(2);
    const separators: string[] = [];
    for (let index = 1; index < output.length; index += 1) {
        const previous = output[index - 1];
        const next = output[index];
        const previousIndex = previous?.originalIndex;
        const nextIndex = next?.originalIndex;
        const previousBlock = previousIndex === undefined ? undefined : original[previousIndex];
        const nextBlock = nextIndex === undefined ? undefined : original[nextIndex];
        separators.push(
            previousIndex !== undefined && nextIndex === previousIndex + 1 &&
            previousBlock !== undefined && nextBlock !== undefined
                ? originalSource.slice(previousBlock.end, nextBlock.start)
                : defaultSeparator
        );
    }
    const firstIndex = output[0]?.originalIndex;
    const lastIndex = output.at(-1)?.originalIndex;
    const firstBlock = firstIndex === undefined ? undefined : original[firstIndex];
    const lastBlock = lastIndex === undefined ? undefined : original[lastIndex];
    const leading = firstIndex === 0 && firstBlock !== undefined
        ? originalSource.slice(0, firstBlock.start)
        : "";
    const trailing = lastIndex === original.length - 1 && lastBlock !== undefined
        ? originalSource.slice(lastBlock.end)
        : "";
    let result = leading;
    for (let index = 0; index < output.length; index += 1) {
        if (index > 0) result += separators[index - 1] ?? "\n\n";
        result += output[index]?.source ?? "";
    }
    result += trailing;
    return result;
}

function preferredLineEnding(source: string): string {
    const crlf = source.match(/\r\n/g)?.length ?? 0;
    const lf = source.match(/(?<!\r)\n/g)?.length ?? 0;
    const cr = source.match(/\r(?!\n)/g)?.length ?? 0;
    if (crlf >= lf && crlf >= cr && crlf > 0) return "\r\n";
    if (cr > lf && cr > 0) return "\r";
    return "\n";
}

function alignBlocks(
    baseline: readonly MarkdownBlock[],
    current: readonly MarkdownBlock[]
): Map<number, number> {
    const anchors: [number, number][] = [];
    const currentLookup = indexBlocks(current);
    let currentCursor = 0;
    for (let baselineIndex = 0; baselineIndex < baseline.length; baselineIndex += 1) {
        const block = baseline[baselineIndex];
        if (block === undefined) continue;
        const currentIndex = findBlock(currentLookup, block.signature, currentCursor);
        if (currentIndex < 0) continue;
        anchors.push([baselineIndex, currentIndex]);
        currentCursor = currentIndex + 1;
    }

    const aligned = new Map<number, number>();
    let previousBaseline = -1;
    let previousCurrent = -1;
    const boundaries: [number, number][] = [...anchors, [baseline.length, current.length]];
    for (const [baselineIndex, currentIndex] of boundaries) {
        const baselineGap = baselineIndex - previousBaseline - 1;
        const currentGap = currentIndex - previousCurrent - 1;
        if (baselineGap === currentGap) {
            for (let offset = 1; offset <= baselineGap; offset += 1) {
                aligned.set(previousBaseline + offset, previousCurrent + offset);
            }
        }
        if (baselineIndex < baseline.length && currentIndex < current.length) {
            aligned.set(baselineIndex, currentIndex);
        }
        previousBaseline = baselineIndex;
        previousCurrent = currentIndex;
    }
    return aligned;
}

function indexBlocks(blocks: readonly MarkdownBlock[]): Map<string, number[]> {
    const positions = new Map<string, number[]>();
    for (let index = 0; index < blocks.length; index += 1) {
        const signature = blocks[index]?.signature;
        if (signature === undefined) continue;
        const entries = positions.get(signature) ?? [];
        entries.push(index);
        positions.set(signature, entries);
    }
    return positions;
}

function findBlock(lookup: ReadonlyMap<string, readonly number[]>, signature: string, from: number): number {
    const positions = lookup.get(signature);
    if (positions === undefined) return -1;
    let low = 0;
    let high = positions.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((positions[middle] ?? -1) < from) low = middle + 1;
        else high = middle;
    }
    return positions[low] ?? -1;
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
    const normalized = source.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    const lineStarts: number[] = [];
    let lineOffset = 0;
    for (const line of lines) {
        lineStarts.push(lineOffset);
        lineOffset += line.length + 1;
    }
    const sourceOffsets = normalizedOffsetsToSource(source, normalized.length);
    const blocks: MarkdownBlock[] = [];
    let pending: { readonly text: string; readonly start: number }[] = [];
    let fence: { readonly marker: string; readonly length: number } | undefined;
    let firstLine = 0;
    const frontMatterMarker = /^\s*(---|\+\+\+)\s*$/.exec(lines[0] ?? "")?.[1];
    if (frontMatterMarker !== undefined) {
        const closing = lines.findIndex((line, index) => index > 0 && line.trim() === frontMatterMarker);
        if (closing > 0) {
            const frontMatter = lines.slice(0, closing + 1).join("\n");
            const normalizedStart = lineStarts[0] ?? 0;
            const normalizedEnd = (lineStarts[closing] ?? normalizedStart) + (lines[closing]?.length ?? 0);
            const start = sourceOffsets[normalizedStart] ?? normalizedStart;
            const end = sourceOffsets[normalizedEnd] ?? normalizedEnd;
            blocks.push({ source: source.slice(start, end), signature: signature(frontMatter), start, end });
            firstLine = closing + 1;
        }
    }
    let directiveDepth = 0;
    let htmlEnd: string | undefined;
    let footnoteContinuation = false;

    const flush = (): void => {
        while (pending[0]?.text === "") pending.shift();
        while (pending.at(-1)?.text === "") pending.pop();
        if (pending.length > 0) {
            const value = pending.map((line) => line.text).join("\n");
            const first = pending[0];
            const last = pending.at(-1);
            if (first !== undefined && last !== undefined) {
                blocks.push({
                    source: source.slice(
                        sourceOffsets[first.start] ?? first.start,
                        sourceOffsets[last.start + last.text.length] ?? last.start + last.text.length
                    ),
                    signature: signature(value),
                    start: sourceOffsets[first.start] ?? first.start,
                    end: sourceOffsets[last.start + last.text.length] ?? last.start + last.text.length
                });
            }
        }
        pending = [];
    };

    for (let lineIndex = firstLine; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? "";
        const start = lineStarts[lineIndex] ?? normalized.length;
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

        if (fence === undefined && htmlEnd === undefined) {
            if (trimmed.startsWith("<!--")) htmlEnd = "-->";
            else {
                const htmlTag = /^<([a-z][\w-]*)\b/i.exec(trimmed)?.[1];
                if (htmlTag !== undefined && /^(?:address|article|aside|blockquote|body|caption|center|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|main|menu|nav|ol|optgroup|option|p|pre|script|section|style|table|tbody|td|tfoot|th|thead|tr|ul)$/i.test(htmlTag)) {
                    htmlEnd = `</${htmlTag}`;
                }
            }
        }
        if (htmlEnd === "-->") {
            if (line.includes("-->")) htmlEnd = undefined;
        } else if (htmlEnd !== undefined && new RegExp(`${htmlEnd}\\s*>`, "i").test(line)) {
            htmlEnd = undefined;
        }

        if (footnoteContinuation) {
            if (line.trim().length === 0 || /^ {2,}|^\t/.test(line)) {
                pending.push({ text: line, start });
                continue;
            }
            footnoteContinuation = false;
            flush();
        }

        if (/^\[\^[^\]]+\]:/.test(trimmed)) footnoteContinuation = true;

        if (fence === undefined && directiveDepth === 0 && htmlEnd === undefined && line.trim().length === 0) {
            flush();
            continue;
        }
        pending.push({ text: line, start });
    }
    flush();
    return blocks;
}

function normalizedOffsetsToSource(source: string, normalizedLength: number): number[] {
    const offsets = new Array<number>(normalizedLength + 1);
    let sourceOffset = 0;
    let normalizedOffset = 0;
    offsets[0] = 0;
    while (sourceOffset < source.length && normalizedOffset < normalizedLength) {
        if (source[sourceOffset] === "\r") {
            sourceOffset += source[sourceOffset + 1] === "\n" ? 2 : 1;
        } else {
            sourceOffset += 1;
        }
        normalizedOffset += 1;
        offsets[normalizedOffset] = sourceOffset;
    }
    return offsets;
}

function signature(value: string): string {
    const normalized = value.replace(/\r\n?/g, "\n").trim();
    const codeFence = /^\s{0,3}(`{3,}|~{3,})([^\n]*)/.exec(normalized);
    if (codeFence !== null) {
        const marker = codeFence[1] ?? "```";
        const lines = normalized.split("\n");
        const last = lines.at(-1) ?? "";
        const closed = new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(last);
        const body = lines.slice(1, closed ? -1 : undefined).join("\n");
        const info = (codeFence[2] ?? "").trim().replace(/\s+/g, " ");
        return `__FENCED_CODE__${info}\n${body}\n${closed ? "closed" : "open"}`;
    }
    const setext = /^([^\n]+)\n\s*(=+|-+)\s*$/.exec(normalized);
    const heading = setext === null ? normalized : `${setext[2]?.[0] === "=" ? "#" : "##"} ${setext[1]}`;
    let hardBreakCount = 0;
    const protectedCode = heading
        .replace(/ {2,}\n/g, () => `__HARD_BREAK_${hardBreakCount++}__`)
        .replace(/(`+)([^`]*?)\1/g, (code) => `__CODE_${encodeURIComponent(code)}__`);
    const canonicalMarkdown = protectedCode
        // Milkdown serializes unrecognized wiki-link openers as escaped
        // brackets. Treat that spelling as the original opaque token when
        // aligning blocks; restoration below writes the authored spelling.
        .replace(/\\\[(?:\\\[[^\r\n\]]+)\]\]/g, (escapedWikiLink) =>
            escapedWikiLink.replace(/\\\[/g, "[")
        )
        .replace(/(?<![\w\\])__([^_\n]+)__(?!\w)/g, "**$1**")
        .replace(/(?<![\w\\])_([^_\n]+)_(?!\w)/g, "*$1*")
        .replace(/^(\s{0,3})[+*](\s+)/gm, "$1-$2")
        .replace(/^(\s{0,3}\d+)[)](\s+)/gm, "$1.$2");
    return canonicalMarkdown.replace(/\s+/g, " ").trim();
}

interface UnsupportedInlineToken {
    readonly raw: string;
    readonly start: number;
    readonly end: number;
    readonly comparisonText: string;
}

const unsupportedInlinePatterns: readonly {
    readonly pattern: RegExp;
    readonly comparisonText: (raw: string) => string;
}[] = [
    { pattern: /<!--[\s\S]*?-->/g, comparisonText: () => "" },
    { pattern: /!?(?:\[\[[^\]\r\n]+\]\])/g, comparisonText: wikiLinkDisplayText },
    { pattern: /\[@[^\]\r\n]+\]/g, comparisonText: () => "" },
    { pattern: /\{(?:#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*)(?:\s+(?:#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*))*\}/g, comparisonText: () => "" }
];

function wikiLinkDisplayText(raw: string): string {
    const content = raw.startsWith("!") ? raw.slice(3, -2) : raw.slice(2, -2);
    const separator = content.indexOf("|");
    return separator < 0 ? content : content.slice(separator + 1);
}

function unsupportedInlineTokens(source: string): UnsupportedInlineToken[] {
    const codeRanges = [...source.matchAll(/(?<!\\)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g)]
        .map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
    const tokens: UnsupportedInlineToken[] = [];
    for (const { pattern, comparisonText } of unsupportedInlinePatterns) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
            const raw = match[0];
            const start = match.index ?? 0;
            const end = start + raw.length;
            if (codeRanges.some((range) => start >= range.start && end <= range.end)) continue;
            tokens.push({ raw, start, end, comparisonText: comparisonText(raw) });
        }
    }
    return tokens
        .sort((left, right) => left.start - right.start)
        .filter((token, index, all) => index === 0 || token.start >= (all[index - 1]?.end ?? 0));
}

/**
 * Find the source block even when the editor serializer preserves some opaque
 * inline forms (such as wiki links) but drops others (such as HTML comments).
 * There are only a few supported opaque token classes, so considering every
 * class-presence combination is bounded and avoids guessing which extensions
 * the active Markdown parser happened to retain.
 */
function sourceSignatures(source: string): string[] {
    let variants = new Set([source]);
    for (const rule of unsupportedInlinePatterns) {
        const next = new Set(variants);
        for (const variant of variants) next.add(withoutUnsupportedInlinePattern(variant, rule));
        variants = next;
    }
    return [...variants].map(signature);
}

function withoutUnsupportedInlinePattern(
    source: string,
    rule: (typeof unsupportedInlinePatterns)[number]
): string {
    const codeRanges = [...source.matchAll(/(?<!\\)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g)]
        .map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
    rule.pattern.lastIndex = 0;
    const matches = [...source.matchAll(rule.pattern)]
        .map((match) => ({
            raw: match[0],
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length
        }))
        .filter((token) => !codeRanges.some((range) => token.start >= range.start && token.end <= range.end));
    let result = source;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
        const token = matches[index];
        if (token === undefined) continue;
        result = result.slice(0, token.start) + rule.comparisonText(token.raw) + result.slice(token.end);
    }
    return result;
}

function restoreUnsupportedInlineTokens(original: string, baseline: string, current: string): string {
    const missing = unsupportedInlineTokens(original);
    let result = current;
    for (let index = missing.length - 1; index >= 0; index -= 1) {
        const token = missing[index];
        if (token === undefined) continue;
        const escapedWikiLink = escapedWikiLinkSpelling(token.raw);
        if (escapedWikiLink !== undefined && result.includes(escapedWikiLink)) {
            result = result.replace(escapedWikiLink, token.raw);
            continue;
        }
        if (baseline.includes(token.raw) || result.includes(token.raw)) continue;
        const equivalent = token.comparisonText.length > 0
            ? findEquivalentText(result, original, token, token.comparisonText)
            : undefined;
        if (equivalent !== undefined) {
            result = result.slice(0, equivalent.start) + token.raw + result.slice(equivalent.end);
            continue;
        }
        const insertion = locateTokenFromTextAnchors(original, token, result);
        const fallback = insertion ?? locateTokenByRelativePosition(original, token, result);
        if (fallback === undefined) continue;
        result = result.slice(0, fallback.offset) + fallback.value + result.slice(fallback.offset);
    }
    return result;
}

function escapedWikiLinkSpelling(raw: string): string | undefined {
    if (!/^!?\[\[[^\]\r\n]+\]\]$/.test(raw)) return undefined;
    const imagePrefix = raw.startsWith("!") ? "!" : "";
    const content = raw.slice(imagePrefix.length + 2, -2);
    return `${imagePrefix}\\[\\[${content}]]`;
}

interface TokenInsertion {
    readonly offset: number;
    readonly value: string;
}

function locateTokenFromTextAnchors(
    original: string,
    token: UnsupportedInlineToken,
    current: string
): TokenInsertion | undefined {
    const leftWords = words(original.slice(0, token.start)).reverse();
    const rightWords = words(original.slice(token.end));
    const left = firstWordOccurrence(current, leftWords, true);
    const right = firstWordOccurrence(current, rightWords, false);
    const leadingSpace = /[ \t]*$/.exec(original.slice(0, token.start))?.[0] ?? "";
    const trailingSpace = /^[ \t]*/.exec(original.slice(token.end))?.[0] ?? "";

    if (left !== undefined && right !== undefined && left.end <= right.start) {
        return { offset: left.end, value: `${leadingSpace}${token.raw}` };
    }
    if (right !== undefined) {
        return { offset: right.start, value: `${token.raw}${trailingSpace}` };
    }
    if (left !== undefined) {
        return { offset: left.end, value: `${leadingSpace}${token.raw}` };
    }
    return undefined;
}

/** Keep unsupported syntax near its authored position when its prose was replaced wholesale. */
function locateTokenByRelativePosition(
    original: string,
    token: UnsupportedInlineToken,
    current: string
): TokenInsertion | undefined {
    if (current.length === 0) return { offset: 0, value: token.raw };
    const ratio = token.start / Math.max(1, original.length);
    const target = Math.round(current.length * ratio);
    let offset: number | undefined;
    for (let distance = 0; distance <= current.length && offset === undefined; distance += 1) {
        for (const candidate of distance === 0 ? [target] : [target - distance, target + distance]) {
            if (candidate < 0 || candidate > current.length) continue;
            const leftBoundary = candidate === 0 || /\s/.test(current[candidate - 1] ?? "");
            const rightBoundary = candidate === current.length || /\s/.test(current[candidate] ?? "");
            if (leftBoundary && rightBoundary) {
                offset = candidate;
                break;
            }
        }
    }
    if (offset === undefined) offset = target;
    const needsLeadingSpace = offset > 0 && !/\s$/.test(current.slice(0, offset));
    const needsTrailingSpace = offset < current.length && !/^\s/.test(current.slice(offset));
    return {
        offset,
        value: `${needsLeadingSpace ? " " : ""}${token.raw}${needsTrailingSpace ? " " : ""}`
    };
}

function findEquivalentText(
    current: string,
    original: string,
    token: UnsupportedInlineToken,
    text: string
): WordOccurrence | undefined {
    const leftWords = words(original.slice(0, token.start)).reverse();
    const rightWords = words(original.slice(token.end));
    const matches = literalOccurrences(current, text);
    if (matches.length === 1) return matches[0];
    for (const match of matches) {
        const left = firstWordOccurrence(current.slice(0, match.start), leftWords, true);
        const right = firstWordOccurrence(current.slice(match.end), rightWords, false);
        if (left !== undefined && right !== undefined) return match;
    }
    return undefined;
}

function literalOccurrences(source: string, value: string): WordOccurrence[] {
    const occurrences: WordOccurrence[] = [];
    let offset = 0;
    while (offset < source.length) {
        const start = source.indexOf(value, offset);
        if (start < 0) break;
        occurrences.push({ start, end: start + value.length });
        offset = start + Math.max(value.length, 1);
    }
    return occurrences;
}

interface WordOccurrence {
    readonly start: number;
    readonly end: number;
}

function words(source: string): string[] {
    return [...source.matchAll(/[\p{L}\p{N}_-]+/gu)].map((match) => match[0]);
}

function firstWordOccurrence(source: string, candidates: readonly string[], fromEnd: boolean): WordOccurrence | undefined {
    for (const word of candidates) {
        const occurrences = wordOccurrences(source, word);
        const occurrence = fromEnd ? occurrences.at(-1) : occurrences[0];
        if (occurrence !== undefined) return occurrence;
    }
    return undefined;
}

function wordOccurrences(source: string, word: string): WordOccurrence[] {
    const occurrences: WordOccurrence[] = [];
    let offset = 0;
    while (offset < source.length) {
        const start = source.indexOf(word, offset);
        if (start < 0) break;
        const end = start + word.length;
        if (!isWordCharacter(source[start - 1]) && !isWordCharacter(source[end])) {
            occurrences.push({ start, end });
        }
        offset = end;
    }
    return occurrences;
}

function isWordCharacter(value: string | undefined): boolean {
    return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}
