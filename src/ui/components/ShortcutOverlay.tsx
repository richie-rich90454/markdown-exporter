import { For, onCleanup, onMount } from "solid-js";

export interface ShortcutOverlayProps {
    onClose: () => void;
}

const SHORTCUTS: ReadonlyArray<{ readonly keys: string; readonly action: string }> = [
    { keys: "Ctrl or Cmd + E", action: "Export" },
    { keys: "Ctrl or Cmd + ,", action: "Open page setup" },
    { keys: "Ctrl or Cmd + \\", action: "Toggle split or stacked" },
    { keys: "Ctrl or Cmd + /", action: "Show this overlay" },
    { keys: "Arrow keys on divider", action: "Resize panes by 16 px" },
    { keys: "Home or End on divider", action: "Snap to 25 and 75 percent" },
    { keys: "Enter on divider", action: "Snap to 50 / 50" },
    { keys: "Arrow keys in preview", action: "Move between pages" },
    { keys: "Escape", action: "Close the sheet or overlay, or return to the editor" }
];

export function ShortcutOverlay(props: ShortcutOverlayProps) {
    let panel: HTMLDivElement | undefined;

    onMount(() => {
        panel?.focus();
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                event.preventDefault();
                props.onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        onCleanup(() => window.removeEventListener("keydown", onKeyDown));
    });

    return (
        <div
            class="overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    props.onClose();
                }
            }}
        >
            <div
                class="overlay__panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shortcuts-title"
                tabIndex={-1}
                ref={(element) => {
                    panel = element;
                }}
            >
                <header class="overlay__header">
                    <h2 class="overlay__title" id="shortcuts-title">
                        Keyboard shortcuts
                    </h2>
                    <button
                        type="button"
                        class="button button--ghost"
                        onClick={() => props.onClose()}
                    >
                        Close
                    </button>
                </header>
                <dl class="overlay__list">
                    <For each={SHORTCUTS}>
                        {(shortcut) => (
                            <div class="overlay__row">
                                <dt class="overlay__keys">{shortcut.keys}</dt>
                                <dd class="overlay__action">{shortcut.action}</dd>
                            </div>
                        )}
                    </For>
                </dl>
            </div>
        </div>
    );
}
