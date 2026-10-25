import type { Element, Root, RootContent } from "hast";
import type { DomRenderer } from "../../port/DomRenderer";

const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const MATHML_TAGS = new Set([
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mn",
    "mo",
    "mtext",
    "mspace",
    "mstyle",
    "msup",
    "msub",
    "msubsup",
    "mover",
    "munder",
    "munderover",
    "mfrac",
    "msqrt",
    "mroot",
    "mtable",
    "mtr",
    "mtd",
    "mpadded",
    "menclose",
    "mmultiscripts",
    "mprescripts",
    "none"
]);
// KaTeX emits layout-critical style strings after rehype-sanitize has removed
// user-authored HTML styles. Preserve its bounded layout/color vocabulary only.
const KATEX_STYLE_PROPERTIES = new Set([
    "background-color",
    "border",
    "border-bottom-width",
    "border-color",
    "border-left-width",
    "border-right-width",
    "border-style",
    "border-top-width",
    "border-width",
    "bottom",
    "color",
    "height",
    "left",
    "margin-left",
    "margin-right",
    "margin-top",
    "margin-bottom",
    "max-height",
    "max-width",
    "min-width",
    "min-height",
    "padding-left",
    "padding-right",
    "padding-top",
    "padding-bottom",
    "top",
    "right",
    "vertical-align",
    "width"
]);
const CSS_LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|ex|px|pt|pc|mm|cm|in|rem|%)?$/i;
const CSS_COLOR = /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.%\s,]+\)|hsla?\([\d.%\s,]+\))$/i;
const CSS_BORDER_STYLE = /^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i;

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
        const element = MATHML_TAGS.has(node.tagName)
            ? (document.createElementNS(MATHML_NAMESPACE, node.tagName) as unknown as HTMLElement)
            : document.createElement(node.tagName);
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
        const declarations: [string, string][] =
            typeof value === "string"
                ? value.split(";").flatMap((declaration): [string, string][] => {
                      const colon = declaration.indexOf(":");
                      return colon < 0
                          ? []
                          : [
                                [
                                    declaration.slice(0, colon).trim(),
                                    declaration.slice(colon + 1).trim()
                                ]
                            ];
                  })
                : typeof value === "object" && value !== null && !Array.isArray(value)
                  ? Object.entries(value).map(([property, entry]): [string, string] => [
                        property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`),
                        String(entry)
                    ])
                  : [];

        for (const [property, entry] of declarations) {
            if (
                KATEX_STYLE_PROPERTIES.has(property.toLowerCase()) &&
                DirectDomWriter.isSafeStyleValue(property.toLowerCase(), entry)
            ) {
                element.style.setProperty(property.toLowerCase(), entry);
            }
        }
    }

    private static isSafeStyleValue(property: string, value: string): boolean {
        if (
            property === "color" ||
            property === "background-color" ||
            property === "border-color"
        ) {
            return CSS_COLOR.test(value);
        }
        if (property === "border-style") {
            return value.split(/\s+/).every((style) => CSS_BORDER_STYLE.test(style));
        }
        if (property === "border") {
            const parts = value.split(/\s+/);
            return (
                parts.length <= 3 &&
                parts.every(
                    (part) =>
                        CSS_LENGTH.test(part) || CSS_COLOR.test(part) || CSS_BORDER_STYLE.test(part)
                )
            );
        }
        return CSS_LENGTH.test(value);
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
