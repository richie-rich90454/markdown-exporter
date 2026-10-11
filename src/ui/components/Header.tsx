import { For, Show, createSignal } from "solid-js";

import type { ApplicationContext } from "../../ApplicationContext";
import type { ExportFormat } from "../../domain/ExportFormat";
import { EXPORT_FORMAT_LABELS } from "../../domain/ExportFormat";

export interface HeaderProps {
    context: ApplicationContext;
    showPaneToggle: boolean;
    paneMode: "write" | "preview";
    onTogglePaneMode: () => void;
    onOpenPageSetup: () => void;
    onExport: (format: ExportFormat) => void;
    onExportActive: () => void;
}

export function Header(props: HeaderProps) {
    const [menuOpen, setMenuOpen] = createSignal(false);
    let menu: HTMLDivElement | undefined;
    let caret: HTMLButtonElement | undefined;

    const formats = props.context.exportController.availableFormats();
    const activeFormat = props.context.exportStore.activeFormat;

    function closeMenu(): void {
        setMenuOpen(false);
        caret?.focus();
    }

    function openMenu(): void {
        setMenuOpen(true);
        queueMicrotask(() => {
            menu?.querySelector<HTMLButtonElement>(".export__item")?.focus();
        });
    }

    function onMenuKeyDown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const items = Array.from(
                menu?.querySelectorAll<HTMLButtonElement>(".export__item") ?? []
            );
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = index + (event.key === "ArrowDown" ? 1 : -1);
            const target = items[(next + items.length) % items.length];
            target?.focus();
        }
    }

    return (
        <header class="header">
            <h1 class="wordmark">Markdown Exporter</h1>
            <div class="header__actions">
                <Show when={props.showPaneToggle}>
                    <button
                        type="button"
                        class="button button--ghost"
                        onClick={() => props.onTogglePaneMode()}
                    >
                        {props.paneMode === "write" ? "Preview" : "Write"}
                    </button>
                </Show>
                <button
                    type="button"
                    class="button button--ghost"
                    onClick={() => window.open("/privacy.html", "_blank", "noopener")}
                >
                    Privacy
                </button>
                <button
                    type="button"
                    class="button button--ghost"
                    onClick={() => props.onOpenPageSetup()}
                >
                    Page setup
                </button>
                <ThemeToggle context={props.context} />
                <div class="export">
                    <button
                        type="button"
                        class="button button--primary"
                        disabled={props.context.exportStore.isBusy()}
                        onClick={() => props.onExportActive()}
                    >
                        Export {EXPORT_FORMAT_LABELS[activeFormat()]}
                    </button>
                    <button
                        type="button"
                        class="button button--caret"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen()}
                        aria-label="Choose export format"
                        ref={(element) => {
                            caret = element;
                        }}
                        onClick={() => (menuOpen() ? closeMenu() : openMenu())}
                    >
                        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
                            <path
                                d="M1 1l4 4 4-4"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.5"
                            />
                        </svg>
                    </button>
                    <Show when={menuOpen()}>
                        <div
                            class="export__menu"
                            role="menu"
                            aria-label="Export format"
                            ref={(element) => {
                                menu = element;
                            }}
                            onKeyDown={(event) => onMenuKeyDown(event)}
                        >
                            <For each={formats}>
                                {(format) => (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        class="export__item"
                                        aria-current={
                                            format === activeFormat() ? "true" : undefined
                                        }
                                        onClick={() => {
                                            props.onExport(format);
                                            closeMenu();
                                        }}
                                    >
                                        {EXPORT_FORMAT_LABELS[format]}
                                    </button>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>
            </div>
        </header>
    );
}

function ThemeToggle(props: { context: ApplicationContext }) {
    const dark = () => props.context.settingsStore.theme() === "dark";

    return (
        <button
            type="button"
            class="button button--ghost"
            aria-pressed={dark()}
            aria-label={dark() ? "Switch to light theme" : "Switch to dark theme"}
            title={dark() ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => props.context.settingsStore.toggleTheme()}
        >
            {dark() ? "Light" : "Dark"}
        </button>
    );
}
