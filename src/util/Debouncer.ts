export class Debouncer {
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly delayMs: number,
        // The callback reads what it needs from the store when it fires, so a
        // scheduled render never pins a copy of the source it started with.
        private readonly callback: () => void
    ) {}

    schedule(): void {
        this.cancel();
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.callback();
        }, this.delayMs);
    }

    cancel(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    get isPending(): boolean {
        return this.timer !== undefined;
    }
}
