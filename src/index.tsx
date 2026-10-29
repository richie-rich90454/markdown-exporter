import "./styles/tokens.css";
import "./styles/app.css";
import "@fontsource-variable/noto-sans/wght.css";

import { render } from "solid-js/web";

import { createApplicationContext } from "./ApplicationContext";
import { App } from "./ui/App";

const root = document.getElementById("root");
if (root === null) {
    throw new Error("Missing #root element");
}

const context = createApplicationContext();
document.documentElement.dataset.theme = context.settingsStore.theme();

if (import.meta.env.PROD && "serviceWorker" in navigator && location.protocol === "https:") {
    const serviceWorkerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, location.href);
    void navigator.serviceWorker
        .register(serviceWorkerUrl, { scope: import.meta.env.BASE_URL })
        .catch(() => undefined);
}

render(() => <App context={context} />, root);
