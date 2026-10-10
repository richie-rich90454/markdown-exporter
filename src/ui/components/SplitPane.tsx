const SPLIT_MIN = 16;
const SPLIT_MAX = 84;

export interface SplitPaneProps {
    split: number;
    onSplitChange: (percent: number) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    mainRef: () => HTMLElement | undefined;
}

export function SplitDivider(props: SplitPaneProps) {
    let divider: HTMLDivElement | undefined;

    function onPointerDown(event: PointerEvent): void {
        event.preventDefault();
        const container = props.mainRef();
        if (container === undefined) {
            return;
        }
        const bounds = container.getBoundingClientRect();
        const onMove = (move: PointerEvent): void => {
            const percent = ((move.clientX - bounds.left) / bounds.width) * 100;
            props.onSplitChange(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, percent)));
        };
        const onUp = (): void => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        divider?.focus();
    }

    return (
        <div
            class="divider"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-valuenow={Math.round(props.split)}
            aria-valuemin={SPLIT_MIN}
            aria-valuemax={SPLIT_MAX}
            aria-label="Resize editor and preview"
            ref={(element) => {
                divider = element;
            }}
            onPointerDown={onPointerDown}
            onKeyDown={(event) => props.onKeyDown(event)}
        />
    );
}

export { SPLIT_MAX, SPLIT_MIN };
