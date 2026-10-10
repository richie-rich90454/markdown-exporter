import type { ApplicationContext } from "../../ApplicationContext";

export interface EditorPaneProps {
    context: ApplicationContext;
    onInput: (value: string) => void;
    textareaRef: (element: HTMLTextAreaElement | undefined) => void;
}

export function EditorPane(props: EditorPaneProps) {
    return (
        <section class="pane pane--editor" aria-label="Markdown source">
            <textarea
                id="editor"
                class="editor"
                spellcheck={false}
                autocomplete="off"
                autocapitalize="off"
                placeholder="Write Markdown."
                aria-label="Markdown editor"
                ref={props.textareaRef}
                onInput={(event) => props.onInput(event.currentTarget.value)}
            />
        </section>
    );
}
