export interface TrueTypeFont {
    readonly data: Uint8Array;
    readonly unitsPerEm: number;
    readonly ascent: number;
    readonly descent: number;
    readonly capHeight: number;
    readonly bounds: readonly [number, number, number, number];
    readonly advances: readonly number[];
    glyphFor(codePoint: number): number;
}

interface Table {
    readonly offset: number;
    readonly length: number;
}

interface Cmap12Group {
    readonly first: number;
    readonly last: number;
    readonly glyph: number;
}

export function parseTrueType(data: Uint8Array): TrueTypeFont {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tables = readTables(view);
    const head = requiredTable(tables, "head");
    const hhea = requiredTable(tables, "hhea");
    const hmtx = requiredTable(tables, "hmtx");
    const maxp = requiredTable(tables, "maxp");
    const unitsPerEm = view.getUint16(head.offset + 18);
    const bounds = [
        view.getInt16(head.offset + 36),
        view.getInt16(head.offset + 38),
        view.getInt16(head.offset + 40),
        view.getInt16(head.offset + 42)
    ] as const;
    const ascent = view.getInt16(hhea.offset + 4);
    const descent = view.getInt16(hhea.offset + 6);
    const metricsCount = view.getUint16(hhea.offset + 34);
    const glyphCount = view.getUint16(maxp.offset + 4);
    const advances: number[] = [];
    let lastAdvance = 0;
    for (let index = 0; index < glyphCount; index += 1) {
        if (index < metricsCount) {
            lastAdvance = view.getUint16(hmtx.offset + index * 4);
        }
        advances.push(lastAdvance);
    }

    const os2 = tables.get("OS/2");
    const capHeight =
        os2 !== undefined && os2.length >= 90 && view.getUint16(os2.offset) >= 2
            ? view.getInt16(os2.offset + 88)
            : ascent;
    const cmap = parseCmap(view, requiredTable(tables, "cmap"));
    return { data, unitsPerEm, ascent, descent, capHeight, bounds, advances, glyphFor: cmap };
}

function readTables(view: DataView): Map<string, Table> {
    const tables = new Map<string, Table>();
    const count = view.getUint16(4);
    for (let index = 0; index < count; index += 1) {
        const offset = 12 + index * 16;
        const tag = String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3)
        );
        tables.set(tag, {
            offset: view.getUint32(offset + 8),
            length: view.getUint32(offset + 12)
        });
    }
    return tables;
}

function requiredTable(tables: ReadonlyMap<string, Table>, name: string): Table {
    const table = tables.get(name);
    if (table === undefined) throw new Error(`KaTeX font is missing the ${name} table.`);
    return table;
}

function parseCmap(view: DataView, cmap: Table): (codePoint: number) => number {
    const count = view.getUint16(cmap.offset + 2);
    let format12: number | undefined;
    let format4: number | undefined;
    for (let index = 0; index < count; index += 1) {
        const record = cmap.offset + 4 + index * 8;
        const platform = view.getUint16(record);
        const encoding = view.getUint16(record + 2);
        const offset = cmap.offset + view.getUint32(record + 4);
        const format = view.getUint16(offset);
        if (format === 12 && (platform === 0 || (platform === 3 && encoding === 10))) {
            format12 = offset;
            if (platform === 3 && encoding === 10) break;
        } else if (format === 4 && (platform === 0 || (platform === 3 && encoding === 1))) {
            format4 ??= offset;
        }
    }

    if (format12 !== undefined) {
        const groups: Cmap12Group[] = [];
        const number = view.getUint32(format12 + 12);
        for (let index = 0; index < number; index += 1) {
            const offset = format12 + 16 + index * 12;
            groups.push({
                first: view.getUint32(offset),
                last: view.getUint32(offset + 4),
                glyph: view.getUint32(offset + 8)
            });
        }
        return (codePoint) => {
            let low = 0;
            let high = groups.length - 1;
            while (low <= high) {
                const mid = (low + high) >>> 1;
                const group = groups[mid];
                if (group === undefined) break;
                if (codePoint < group.first) high = mid - 1;
                else if (codePoint > group.last) low = mid + 1;
                else return group.glyph + codePoint - group.first;
            }
            return 0;
        };
    }
    if (format4 === undefined) throw new Error("KaTeX font has no Unicode cmap table.");

    const base = format4;
    const segmentCount = view.getUint16(base + 6) / 2;
    const endCodes = base + 14;
    const startCodes = endCodes + segmentCount * 2 + 2;
    const deltas = startCodes + segmentCount * 2;
    const rangeOffsets = deltas + segmentCount * 2;
    return (codePoint) => {
        if (codePoint > 0xffff) return 0;
        for (let index = 0; index < segmentCount; index += 1) {
            const end = view.getUint16(endCodes + index * 2);
            if (codePoint > end) continue;
            const start = view.getUint16(startCodes + index * 2);
            if (codePoint < start) return 0;
            const delta = view.getInt16(deltas + index * 2);
            const range = view.getUint16(rangeOffsets + index * 2);
            if (range === 0) return (codePoint + delta) & 0xffff;
            const address = rangeOffsets + index * 2 + range + 2 * (codePoint - start);
            const glyph = view.getUint16(address);
            return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
        }
        return 0;
    };
}
