/**
 * Trailing-edge debouncer.
 *
 * The scheduled callback must capture no document-sized payload. It reads
 * whatever it needs from the store when it fires, so a stale copy of the
 * source is never held alive while the user keeps typing.
 */
export class Debouncer {
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly delayMs: number,
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
