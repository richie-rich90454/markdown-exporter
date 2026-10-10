import type { Root } from "hast";

export interface DomRenderer {
    renderFragment(hast: Root): DocumentFragment;
}
