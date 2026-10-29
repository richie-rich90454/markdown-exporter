/**
 * Counts manuscript prose rather than Markdown syntax or document metadata.
 * Word segmentation follows the manuscript language, so languages without
 * whitespace between words (including Chinese and Japanese) are counted using
 * the browser's Unicode word segmenter when available.
 */
export function countMarkdownWords(source: string, locale?: string): number {
    const prose = stripNonProse(source);
    if (prose.trim().length === 0) return 0;

    try {
        const segmenter = new Intl.Segmenter(locale || undefined, { granularity: "word" });
        let count = 0;
        for (const segment of segmenter.segment(prose)) {
            if (segment.isWordLike) count += 1;
        }
        return count;
    } catch {
        // Older browsers and invalid locale tags still get a useful count.
        return prose.match(/[\p{Letter}\p{Number}]+/gu)?.length ?? 0;
    }
}

function stripNonProse(source: string): string {
    let text = source.replace(/^\uFEFF/, "");
    text = stripFrontMatter(text);
    text = stripFencedCode(text);
    text = stripFootnoteDefinitionMarkers(text);
    text = text
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/^[ \t]{0,3}\[[^\]]+\]:\s*(?:<[^>]*>|\S+).*$/gm, " ")
        .replace(/`+[^`\r\n]*`+/g, " ")
        .replace(
            /!?\[([^\]]*)\]\(\s*(?:<[^>]*>|(?:\\.|[^()\s])*(?:\([^)]*\)(?:[^()\s]*)*)?)(?:\s+["'][^"']*["'])?\s*\)/g,
            "$1"
        )
        .replace(/\[\^([^\]]+)\]/g, " ")
        .replace(/<https?:\/\/[^>]+>|<mailto:[^>]+>/gi, " ")
        .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, "")
        .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, " ")
        .replace(/\\(.)/g, (match, character: string) =>
            escapedMarkdownPunctuation.has(character) ? character : match
        )
        .replace(/(?:\*\*|__|~~|==|\*|_|~)/g, " ");

    // Indented code blocks are source, not manuscript prose.
    text = text.replace(/^(?: {4,}|\t)[^\r\n]*(?:\r?\n|$)/gm, " ");
    return text;
}

const escapedMarkdownPunctuation = new Set([
    "!",
    '"',
    "#",
    "$",
    "%",
    "&",
    "'",
    "(",
    ")",
    "*",
    "+",
    ",",
    "-",
    ".",
    "/",
    ":",
    ";",
    "<",
    "=",
    ">",
    "?",
    "@",
    "[",
    "\\",
    "]",
    "^",
    "_",
    "`",
    "{",
    "|",
    "}",
    "~"
]);

function stripFrontMatter(source: string): string {
    const lines = source.split(/\r?\n/);
    const opening = lines[0]?.trim();
    if (opening !== "---" && opening !== "+++") return source;
    const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === opening);
    if (closingIndex < 0) return source;
    return lines.slice(closingIndex + 1).join("\n");
}

function stripFencedCode(source: string): string {
    const lines = source.split(/\r?\n/);
    const proseLines: string[] = [];
    let fence: { character: string; length: number } | undefined;
    for (const line of lines) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (fence !== undefined) {
            const closing = marker?.[0] === fence.character && marker.length >= fence.length;
            if (closing) fence = undefined;
            proseLines.push("");
            continue;
        }
        if (marker !== undefined) {
            fence = { character: marker[0] ?? "`", length: marker.length };
            proseLines.push("");
            continue;
        }
        proseLines.push(line);
    }
    return proseLines.join("\n");
}

function stripFootnoteDefinitionMarkers(source: string): string {
    let insideFootnote = false;
    return source
        .split(/\r?\n/)
        .map((line) => {
            if (/^ {0,3}\[\^[^\]]+\]:/.test(line)) {
                insideFootnote = true;
                return line.replace(/^ {0,3}\[\^[^\]]+\]:[ \t]?/, "");
            }
            if (insideFootnote && /^(?: {2,}|\t)/.test(line))
                return line.replace(/^(?: {2,}|\t)/, "");
            if (line.trim().length > 0) insideFootnote = false;
            return line;
        })
        .join("\n");
}
