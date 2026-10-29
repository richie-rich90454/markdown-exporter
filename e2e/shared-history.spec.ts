import { expect, test } from "@playwright/test";

test("undo and redo share one history across rich and source modes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Rich", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
    );

    const richEditor = page.getByLabel("Markdown editor");
    await richEditor.pressSequentially("Draft");
    await page.getByRole("button", { name: "Source", exact: true }).click();

    const sourceEditor = page.getByLabel("Markdown editor");
    await sourceEditor.press("Control+End");
    await sourceEditor.pressSequentially(" source");
    await expect(sourceEditor).toContainText("Draft source");

    await page.getByRole("button", { name: "Rich", exact: true }).click();
    await richEditor.press("Control+z");
    await expect(richEditor).toContainText("Draft");
    await expect(richEditor).not.toContainText("source");

    await richEditor.press("Control+y");
    await expect(richEditor).toContainText("Draft source");
    await richEditor.press("Control+z");
    await expect(richEditor).toContainText("Draft");
    await expect(richEditor).not.toContainText("source");
});
