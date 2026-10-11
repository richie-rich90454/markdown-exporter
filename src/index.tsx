import "./styles/tokens.css";
import "./styles/app.css";

import { render } from "solid-js/web";

import { createApplicationContext } from "./ApplicationContext";
import { App } from "./ui/App";

const root = document.getElementById("root");
if (root === null) {
    throw new Error("Missing #root element");
}

const context = createApplicationContext();
document.documentElement.dataset.theme = context.settingsStore.theme();

render(() => <App context={context} />, root);
