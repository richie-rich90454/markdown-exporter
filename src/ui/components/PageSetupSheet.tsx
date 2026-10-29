import { For, onMount } from "solid-js";

import type { ApplicationContext } from "../../ApplicationContext";
import { FONT_OPTIONS, MARGIN_OPTIONS, PAGE_SIZES } from "../../domain/PageSetup";
import type { FontFamilyId, PageSizeId } from "../../domain/PageSetup";

export interface PageSetupSheetProps {
    context: ApplicationContext;
    onClose: () => void;
}

export function PageSetupSheet(props: PageSetupSheetProps) {
    const settingsStore = props.context.settingsStore;
    const settings = settingsStore.current;
    let sheet: HTMLDivElement | undefined;

    onMount(() => {
        sheet?.focus();
    });

    function onKeyDown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
        }
    }

    return (
        <div
            class="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="page-setup-title"
            tabIndex={-1}
            ref={(element) => {
                sheet = element;
            }}
            onKeyDown={(event) => onKeyDown(event)}
        >
            <header class="sheet__header">
                <h2 class="sheet__title" id="page-setup-title">
                    Page setup
                </h2>
                <button type="button" class="button button--ghost" onClick={() => props.onClose()}>
                    Close
                </button>
            </header>
            <div class="sheet__body">
                <label class="field">
                    <span class="field__label">Page size</span>
                    <select
                        class="select"
                        value={settings().pageSize}
                        onChange={(event) =>
                            settingsStore.patch({
                                pageSize: event.currentTarget.value as PageSizeId
                            })
                        }
                    >
                        <option value="a4">{PAGE_SIZES.a4.label}</option>
                        <option value="a5">{PAGE_SIZES.a5.label}</option>
                        <option value="six-by-nine">{PAGE_SIZES["six-by-nine"].label}</option>
                        <option value="letter">{PAGE_SIZES.letter.label}</option>
                        <option value="legal">{PAGE_SIZES.legal.label}</option>
                        <option value="custom">Custom</option>
                    </select>
                </label>
                {settings().pageSize === "custom" && (
                    <div class="page-setup__custom-size">
                        <label class="field">
                            <span class="field__label">Width</span>
                            <input
                                class="number"
                                type="number"
                                min="80"
                                max="500"
                                step="1"
                                value={String(settings().customWidthMm ?? 152.4)}
                                onInput={(event) =>
                                    settingsStore.patch({
                                        customWidthMm: clamp(
                                            Number(event.currentTarget.value),
                                            80,
                                            500
                                        )
                                    })
                                }
                            />
                            <span class="field__hint">Millimetres</span>
                        </label>
                        <label class="field">
                            <span class="field__label">Height</span>
                            <input
                                class="number"
                                type="number"
                                min="80"
                                max="500"
                                step="1"
                                value={String(settings().customHeightMm ?? 228.6)}
                                onInput={(event) =>
                                    settingsStore.patch({
                                        customHeightMm: clamp(
                                            Number(event.currentTarget.value),
                                            80,
                                            500
                                        )
                                    })
                                }
                            />
                            <span class="field__hint">Millimetres</span>
                        </label>
                    </div>
                )}
                <label class="field">
                    <span class="field__label">Margins</span>
                    <select
                        class="select"
                        value={String(settings().marginMm)}
                        onChange={(event) =>
                            settingsStore.patch({ marginMm: Number(event.currentTarget.value) })
                        }
                    >
                        <For each={MARGIN_OPTIONS}>
                            {(margin) => <option value={String(margin)}>{margin} mm</option>}
                        </For>
                    </select>
                </label>
                <label class="field">
                    <span class="field__label">Font</span>
                    <select
                        class="select"
                        value={settings().fontFamily}
                        onChange={(event) =>
                            settingsStore.patch({
                                fontFamily: event.currentTarget.value as FontFamilyId
                            })
                        }
                    >
                        <option value="serif">{FONT_OPTIONS.serif}</option>
                        <option value="sans">{FONT_OPTIONS.sans}</option>
                        <option value="mono">{FONT_OPTIONS.mono}</option>
                    </select>
                </label>
                <label class="field">
                    <span class="field__label">Font size</span>
                    <input
                        class="number"
                        type="number"
                        min="8"
                        max="24"
                        step="1"
                        value={String(settings().fontSizePt)}
                        onChange={(event) =>
                            settingsStore.patch({
                                fontSizePt: clamp(Number(event.currentTarget.value), 8, 24)
                            })
                        }
                    />
                    <span class="field__hint">Points</span>
                </label>
                <label class="field">
                    <span class="field__label">Line height</span>
                    <input
                        class="number"
                        type="number"
                        min="1.2"
                        max="2"
                        step="0.1"
                        value={String(settings().lineHeight)}
                        onChange={(event) =>
                            settingsStore.patch({
                                lineHeight: clamp(Number(event.currentTarget.value), 1.2, 2)
                            })
                        }
                    />
                    <span class="field__hint">Multiplier</span>
                </label>
            </div>
        </div>
    );
}

function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
}
