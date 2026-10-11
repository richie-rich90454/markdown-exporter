import type { Element, Root, RootContent } from "hast";
import type { DomRenderer } from "../../port/DomRenderer";

// Walks hast into DOM nodes instead of building an HTML string for innerHTML,
// which would hold the document three times at once.
export class DirectDomWriter implements DomRenderer {
    renderFragment(hast: Root): DocumentFragment {
        const fragment = document.createDocumentFragment();
        for (const child of hast.children) {
            this.append(child, fragment);
        }
        return fragment;
    }

    private append(node: RootContent, parent: Node): void {
        switch (node.type) {
            case "element": {
                parent.appendChild(this.createElement(node));
                break;
            }
            case "text": {
                parent.appendChild(document.createTextNode(node.value));
                break;
            }
            case "comment": {
                parent.appendChild(document.createComment(node.value));
                break;
            }
            case "doctype":
            default: {
                // Neither a doctype nor a raw node belongs inside a fragment.
                break;
            }
        }
    }

    private createElement(node: Element): HTMLElement {
        const element = document.createElement(node.tagName);
        const properties = node.properties;
        if (properties !== undefined) {
            for (const [name, value] of Object.entries(properties)) {
                this.applyProperty(element, name, value);
            }
        }
        for (const child of node.children) {
            this.append(child, element);
        }
        return element;
    }

    private applyProperty(element: HTMLElement, name: string, value: unknown): void {
        if (value === null || value === undefined || value === false) {
            return;
        }
        if (name === "className") {
            if (Array.isArray(value)) {
                for (const entry of value) {
                    if (typeof entry === "string" && entry.length > 0) {
                        element.classList.add(entry);
                    }
                }
            }
            return;
        }
        if (name === "style") {
            this.applyStyle(element, value);
            return;
        }
        const attribute = DirectDomWriter.attributeName(name);
        const attributeValue = DirectDomWriter.attributeValue(value);
        if (attribute !== null && attributeValue !== null) {
            element.setAttribute(attribute, attributeValue);
        }
    }

    private applyStyle(element: HTMLElement, value: unknown): void {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return;
        }
        for (const [property, entry] of Object.entries(value)) {
            if (typeof entry === "string" || typeof entry === "number") {
                element.style.setProperty(property, String(entry));
            }
        }
    }

    private static readonly NAMED_ATTRIBUTES: Readonly<Record<string, string>> = {
        className: "class",
        htmlFor: "for",
        colSpan: "colspan",
        rowSpan: "rowspan",
        tabIndex: "tabindex",
        hrefLang: "hreflang"
    };

    private static attributeName(name: string): string | null {
        const named = DirectDomWriter.NAMED_ATTRIBUTES[name];
        if (named !== undefined) {
            return named;
        }
        if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) {
            return null;
        }
        return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    }

    private static attributeValue(value: unknown): string | null {
        if (typeof value === "boolean") {
            return value ? "" : null;
        }
        if (typeof value === "number") {
            return String(value);
        }
        if (typeof value === "string") {
            return value;
        }
        if (Array.isArray(value)) {
            return value
                .filter(
                    (entry): entry is string | number =>
                        typeof entry === "string" || typeof entry === "number"
                )
                .join(" ");
        }
        return null;
    }
}
