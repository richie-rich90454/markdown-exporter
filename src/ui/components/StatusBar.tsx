import { Show } from "solid-js";

import type { ApplicationContext } from "../../ApplicationContext";

export function StatusBar(props: { context: ApplicationContext }) {
    const document = props.context.editorStore.current;
    const store = props.context.previewStore;
    const exportStore = props.context.exportStore;

    return (
        <footer class="statusbar">
            <div class="statusbar__group">
                <span class="statusbar__item">
                    <span class="statusbar__label">Chars</span>
                    <span class="statusbar__value">{document().length}</span>
                </span>
                <span class="statusbar__item">
                    <span class="statusbar__label">Words</span>
                    <span class="statusbar__value">{document().wordCount}</span>
                </span>
                <span class="statusbar__item">
                    <span class="statusbar__label">Pages</span>
                    <span class="statusbar__value">{store.pageCount()}</span>
                </span>
                <span class="statusbar__item">
                    <span class="statusbar__label">Render</span>
                    <span class="statusbar__value">{store.renderDurationMs()} ms</span>
                </span>
                <Show when={exportStore.lastStatus().length > 0}>
                    <span class="statusbar__item">
                        <span class="statusbar__status" role="status">
                            {exportStore.lastStatus()}
                        </span>
                    </span>
                </Show>
            </div>
        </footer>
    );
}
