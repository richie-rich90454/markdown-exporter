import { describe, expect, it } from "vitest";

import { DirectDomWriter } from "../../src/adapter/renderer/DirectDomWriter";
import type { Root } from "hast";

const tree: Root = {
    type: "root",
    children: [
        {
            type: "element",
            tagName: "div",
            properties: { className: ["wrapper"], id: "root", tabIndex: 0, hidden: false },
            children: [
                {
                    type: "element",
                    tagName: "h1",
                    properties: {},
                    children: [{ type: "text", value: "Title" }]
                },
                { type: "element", tagName: "span", properties: { dataFoo: "bar" }, children: [] },
                { type: "text", value: " tail" },
                { type: "comment", value: " note " }
            ]
        },
        {
            type: "element",
            tagName: "p",
            properties: {},
            children: [{ type: "text", value: "Body" }]
        }
    ]
};

describe("DirectDomWriter", () => {
    it("builds a DOM fragment without materializing any HTML string", () => {
        const fragment = new DirectDomWriter().renderFragment(tree);

        const div = fragment.querySelector("div");
        expect(div).not.toBeNull();
        expect(div?.className).toBe("wrapper");
        expect(div?.id).toBe("root");
        expect(div?.getAttribute("tabindex")).toBe("0");
        expect(div?.hasAttribute("hidden")).toBe(false);

        expect(fragment.querySelector("h1")?.textContent).toBe("Title");
        expect(fragment.querySelector("span")?.getAttribute("data-foo")).toBe("bar");
        expect(div?.textContent).toBe("Title tail");
        expect(div?.childNodes[2]?.nodeType).toBe(Node.TEXT_NODE);
        expect(div?.childNodes[3]?.nodeType).toBe(Node.COMMENT_NODE);
        expect(fragment.querySelector("p")?.textContent).toBe("Body");
    });

    it("never assigns innerHTML or outerHTML", () => {
        const unsafe = new DirectDomWriter();
        const fragment = unsafe.renderFragment({
            type: "root",
            children: [
                {
                    type: "element",
                    tagName: "div",
                    properties: {},
                    children: [{ type: "text", value: "<img src=x onerror=alert(1)>" }]
                }
            ]
        });
        expect(fragment.querySelector("div")?.innerHTML).toBe("&lt;img src=x onerror=alert(1)&gt;");
        expect(fragment.querySelector("img")).toBeNull();
    });
});
