export class HtmlEscaper {
    static escape(value: string): string {
        let result = "";
        let start = 0;
        for (let index = 0; index < value.length; index += 1) {
            const replacement = HtmlEscaper.replacement(value.charCodeAt(index));
            if (replacement === null) {
                continue;
            }
            result += value.slice(start, index) + replacement;
            start = index + 1;
        }
        return start === 0 ? value : result + value.slice(start);
    }

    private static replacement(code: number): string | null {
        switch (code) {
            case 38: // &
                return "&amp;";
            case 60: // <
                return "&lt;";
            case 62: // >
                return "&gt;";
            case 34: // "
                return "&quot;";
            case 39: // '
                return "&#39;";
            default:
                return null;
        }
    }
}
