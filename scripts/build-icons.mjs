// SVG is the source of truth. Packaging derivatives are checked in so a normal
// Wails build needs neither a browser nor a network connection to regenerate art.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const glyphs = {
    M: [26, "M0 32V0L13 18L26 0V32"],
    A: [26, "M0 32L13 0L26 32M5 21H21"],
    R: [24, "M0 32V0H12C27 0 27 16 12 16H0M12 16L25 32"],
    K: [24, "M0 0V32M24 0L0 20M10 12L26 32"],
    D: [25, "M0 0V32H8C31 32 31 0 8 0H0"],
    O: [26, "M13 0C-5 0-5 32 13 32C31 32 31 0 13 0Z"],
    W: [36, "M0 0L8 32L18 8L28 32L36 0"],
    N: [26, "M0 32V0L26 32V0"],
    E: [22, "M22 0H0V32H22M0 15H18"],
    X: [25, "M0 0L25 32M25 0L0 32"],
    P: [23, "M0 32V0H11C27 0 27 17 11 17H0"],
    T: [26, "M0 0H26M13 0V32"]
};
function word(value, x, y, scale, spacing) {
    return [...value]
        .map((letter) => {
            const [width, path] = glyphs[letter];
            const output = `<path d="${path}" transform="translate(${x} ${y}) scale(${scale})"/>`;
            x += (width + spacing) * scale;
            return output;
        })
        .join("");
}
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 168" fill="none"><title>Markdown Exporter</title><desc>Original folded folio monogram and custom drawn wordmark. No fonts or external resources.</desc><g fill="currentColor"><path d="M12 133V29H38L78 82L118 29H144V133H117V78L78 128L39 78V133H12Z"/><path d="M12 143H39M117 143H144" stroke="currentColor" stroke-width="2"/></g><g stroke="currentColor" stroke-width="2.8" stroke-linecap="square" stroke-linejoin="miter">${word("MARKDOWN", 184, 37, 1.48, 10)}${word("EXPORTER", 185, 109, 0.65, 20)}</g></svg>\n`;
await writeFile("public/brand/logo.svg", logo);

await mkdir("build/windows", { recursive: true });
const svg = await readFile("public/brand/icon.svg", "utf8");
const browser = await chromium.launch();
try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`
    );
    await page.setViewportSize({ width: 1024, height: 1024 });
    await page.screenshot({ path: "build/appicon.png", omitBackground: true });
    const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
    const pngs = [];
    for (const size of sizes) {
        await page.setViewportSize({ width: size, height: size });
        pngs.push(await page.screenshot({ omitBackground: true }));
    }
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
        const entry = 6 + 16 * index;
        header[entry] = size === 256 ? 0 : size;
        header[entry + 1] = size === 256 ? 0 : size;
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(pngs[index].length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += pngs[index].length;
    });
    await writeFile("build/windows/icon.ico", Buffer.concat([header, ...pngs]));
} finally {
    await browser.close();
}
process.stdout.write("Created vector wordmark, 1024px app icon, and eight-size Windows icon.\n");
