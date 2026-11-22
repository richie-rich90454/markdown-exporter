import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

import { DOCUMENT_TEMPLATES, type DocumentTemplate } from "../../domain/DocumentTemplates";

export function NewDocumentDialog(props: {
    hasCurrentDocument: boolean;
    desktop?: boolean;
    onCreate: (template: DocumentTemplate, title: string) => Promise<void>;
    onClose: () => void;
}) {
    const [selected, setSelected] = createSignal(DOCUMENT_TEMPLATES[0]!);
    const [title, setTitle] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    let dialog: HTMLDialogElement | undefined;

    onMount(() => dialog?.showModal());
    onCleanup(() => dialog?.close());

    return (
        <dialog
            class="new-document"
            ref={(element) => {
                dialog = element;
            }}
            aria-labelledby="new-document-title"
            aria-describedby="new-document-description"
            onCancel={(event) => {
                event.preventDefault();
                if (!busy()) props.onClose();
            }}
        >
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (busy()) return;
                    setBusy(true);
                    setError("");
                    void props
                        .onCreate(selected(), title())
                        .catch((issue: unknown) => {
                            setError(
                                issue instanceof Error
                                    ? issue.message
                                    : "Could not create the document. Try again."
                            );
                        })
                        .finally(() => setBusy(false));
                }}
            >
                <div class="new-document__header">
                    <div>
                        <p class="new-document__eyebrow">A useful starting point</p>
                        <h2 id="new-document-title">What are you working on?</h2>
                    </div>
                    <button
                        type="button"
                        class="button button--ghost"
                        disabled={busy()}
                        onClick={() => props.onClose()}
                    >
                        Close
                    </button>
                </div>
                <p id="new-document-description">
                    Start fresh or use a structure you can make your own.
                </p>
                <fieldset class="template-options" disabled={busy()}>
                    <legend class="sr-only">Document template</legend>
                    <For each={DOCUMENT_TEMPLATES}>
                        {(template) => (
                            <label
                                class="template-option"
                                classList={{
                                    "template-option--selected": selected().id === template.id
                                }}
                            >
                                <input
                                    type="radio"
                                    name="template"
                                    value={template.id}
                                    checked={selected().id === template.id}
                                    onChange={() => setSelected(template)}
                                />
                                <span>
                                    <strong>{template.name}</strong>
                                    <span>{template.description}</span>
                                </span>
                            </label>
                        )}
                    </For>
                </fieldset>
                <label class="new-document__title-input">
                    Document name
                    <input
                        type="text"
                        maxLength={120}
                        value={title()}
                        placeholder={selected().title}
                        disabled={busy()}
                        onInput={(event) => setTitle(event.currentTarget.value)}
                    />
                </label>
                <Show when={props.hasCurrentDocument}>
                    <p class="new-document__notice">
                        {props.desktop
                            ? "Save a backup of your current work before the new document opens."
                            : "Your current work will download as a backup before the new document opens."}
                        Books include all chapters and assets. Keep that backup to reopen your work
                        later.
                    </p>
                </Show>
                <Show when={error()}>
                    <p class="new-document__error" role="alert">
                        {error()}
                    </p>
                </Show>
                <div class="new-document__footer">
                    <span>Private by default. No account needed.</span>
                    <button type="submit" class="button button--primary" disabled={busy()}>
                        {busy()
                            ? "Creating…"
                            : props.hasCurrentDocument
                              ? props.desktop
                                  ? "Save backup & create"
                                  : "Download backup & create"
                              : "Create document"}
                    </button>
                </div>
            </form>
        </dialog>
    );
}
