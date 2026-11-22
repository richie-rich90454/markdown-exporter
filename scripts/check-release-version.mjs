import { readFile } from "node:fs/promises";

const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const wailsManifest = JSON.parse(await readFile(new URL("../wails.json", import.meta.url), "utf8"));
const packageVersion = packageManifest.version;
const desktopVersion = wailsManifest.info?.productVersion;

if (packageVersion !== desktopVersion) {
    throw new Error(
        `Release versions differ: package.json is ${packageVersion}, wails.json is ${desktopVersion}.`
    );
}

const tag = process.argv[2];
if (tag !== undefined && tag !== "") {
    const tagVersion = tag.replace(/^v/, "");
    if (tagVersion !== packageVersion) {
        throw new Error(
            `Release tag ${tag} does not match package.json version ${packageVersion}.`
        );
    }
}

process.stdout.write(`Release metadata is consistent at version ${packageVersion}.\n`);
