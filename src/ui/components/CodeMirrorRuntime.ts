// CodeMirror is only needed when the author opens Source or Inline mode.
// Keeping these imports behind EditorPane's dynamic import keeps the default
// rich-writing path light while preserving the full source editor on demand.
export { defaultKeymap } from "@codemirror/commands";
export { markdown } from "@codemirror/lang-markdown";
export { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
export {
    Compartment,
    EditorState,
    RangeSet,
    StateEffect,
    StateField,
    Transaction
} from "@codemirror/state";
export { Decoration, EditorView, ViewPlugin, keymap, WidgetType } from "@codemirror/view";
export { searchKeymap } from "@codemirror/search";
export { tags } from "@lezer/highlight";
