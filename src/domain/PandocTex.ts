const MATH_DELIMITERS =
    /(?<!\\)(\\{1,2}\[)([\s\S]*?)(?<!\\)(\\{1,2}\])|(\$\$)([\s\S]*?)(\$\$)|(?<!\\)(\\{1,2}\()([\s\S]*?)(?<!\\)(\\{1,2}\))|(?<!\\)(\$)(?!\$)((?:\\.|[^$\n])+?)(?<!\\)(\$)(?!\$)(?!\d)/g;
const PANDOC_TEX_SEQUENCE =
    /(?:`+[^`\n]+?`+\s*\{=tex\}(?:\\{1,2}[_^](?:\{[^}\n]*\}|[A-Za-z0-9]+))?)+/g;

export function hasPandocTex(source: string): boolean {
    return /`+[^`\n]+?`+\s*\{=tex\}/.test(source);
}

export function normalizeTexFormula(formula: string): string {
    return formula
        .replace(/(?<!\\)\\\\(?=[A-Za-z_^])/g, "\\")
        .replace(/`+([^`\n]+?)`+\s*\{=tex\}/g, "$1")
        .replace(/\\([_^])(?=\{|[A-Za-z0-9])/g, "$1");
}

export interface PandocTexSequence {
    readonly from: number;
    readonly to: number;
    readonly formula: string;
}

export function findPandocTexSequences(source: string): PandocTexSequence[] {
    return Array.from(source.matchAll(PANDOC_TEX_SEQUENCE), (match) => {
        const from = match.index ?? 0;
        return {
            from,
            to: from + match[0].length,
            formula: normalizeTexFormula(match[0])
        };
    });
}

/**
 * Convert Pandoc's inline raw-TeX spans into math Markdown while preserving
 * ordinary code spans and code fences. Raw spans inside existing math are
 * unwrapped as part of the formula instead of becoming nested math.
 */
export function normalizePandocTexSource(source: string): string {
    const output: string[] = [];
    const prose: string[] = [];
    const flushProse = (): void => {
        if (prose.length === 0) return;
        output.push(normalizeProse(prose.join("")));
        prose.length = 0;
    };
    let fence:
        | { readonly marker: string; readonly size: number; readonly math: boolean }
        | undefined;

    for (const line of source.match(/[^\n]*(?:\n|$)/g) ?? []) {
        if (line.length === 0) continue;
        const open = /^\s{0,3}(`{3,}|~{3,})([^\n]*)/.exec(line);
        if (fence === undefined && open !== null) {
            flushProse();
            const marker = open[1] ?? "```";
            fence = {
                marker: marker[0] ?? "`",
                size: marker.length,
                math: /^\s*math(?:\s|$)/i.test(open[2] ?? "")
            };
            output.push(line);
            continue;
        }

        if (fence !== undefined) {
            const close = /^\s{0,3}(`{3,}|~{3,})\s*(?:\n)?$/.exec(line);
            if (close !== null && close[1]?.[0] === fence.marker && close[1].length >= fence.size) {
                output.push(line);
                fence = undefined;
            } else {
                output.push(fence.math ? normalizeTexFormula(line) : line);
            }
            continue;
        }

        prose.push(line);
    }

    flushProse();
    return output.join("");
}

function normalizeProse(source: string): string {
    const parts: string[] = [];
    let cursor = 0;
    const tokens = new RegExp(
        `${MATH_DELIMITERS.source}|(${PANDOC_TEX_SEQUENCE.source})|(` + "`+[^`\\n]+?`+" + ")",
        "g"
    );

    for (const match of source.matchAll(tokens)) {
        const token = match[0];
        const start = match.index ?? 0;
        parts.push(source.slice(cursor, start));

        MATH_DELIMITERS.lastIndex = 0;
        const math = MATH_DELIMITERS.exec(token);
        if (math !== null) {
            const opening = math[1] ?? math[4] ?? math[7] ?? math[10] ?? "";
            const formula = normalizeTexFormula(math[2] ?? math[5] ?? math[8] ?? math[11] ?? "");
            const closing = math[3] ?? math[6] ?? math[9] ?? math[12] ?? "";
            parts.push(
                `${normalizeTexDelimiter(opening)}${formula}${normalizeTexDelimiter(closing)}`
            );
        } else if (match[13] !== undefined) {
            parts.push(`\\(${normalizeTexFormula(token)}\\)`);
        } else {
            parts.push(token);
        }
        cursor = start + token.length;
    }

    parts.push(source.slice(cursor));
    return parts.join("");
}

function normalizeTexDelimiter(delimiter: string): string {
    return delimiter.startsWith("\\\\") ? delimiter.slice(1) : delimiter;
}
