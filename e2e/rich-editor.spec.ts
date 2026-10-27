import { expect, test } from "@playwright/test";

test("opens in rich mode and edits Markdown through ProseMirror", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Rich", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
    );
    const editor = page.getByLabel("Markdown editor");
    await expect(editor).toBeFocused();
    await editor.pressSequentially("A sentence for the manuscript.");
    await expect(page.locator(".preview__flow p")).toHaveText("A sentence for the manuscript.");

    await editor.press("Control+a");
    await page.getByRole("button", { name: "Bold" }).click();
    await expect(editor.locator("strong")).toHaveText("A sentence for the manuscript.");
    await expect(page.locator(".preview__flow strong")).toHaveText("A sentence for the manuscript.");

    await editor.press("Control+z");
    await expect(editor.locator("strong")).toHaveCount(0);
});
