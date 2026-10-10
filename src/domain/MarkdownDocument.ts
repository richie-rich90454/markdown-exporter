export class MarkdownDocument {
    private constructor(
        readonly source: string,
        readonly revision: number
    ) {}

    static initial(source = ""): MarkdownDocument {
        return new MarkdownDocument(source, 0);
    }

    withSource(source: string): MarkdownDocument {
        return source === this.source ? this : new MarkdownDocument(source, this.revision + 1);
    }

    get isEmpty(): boolean {
        return this.source.trim().length === 0;
    }

    get length(): number {
        return this.source.length;
    }

    get wordCount(): number {
        const trimmed = this.source.trim();
        if (trimmed.length === 0) {
            return 0;
        }
        let words = 0;
        let inWord = false;
        for (const char of trimmed) {
            if (char === " " || char === "\n" || char === "\r" || char === "\t") {
                inWord = false;
            } else if (!inWord) {
                inWord = true;
                words += 1;
            }
        }
        return words;
    }
}
