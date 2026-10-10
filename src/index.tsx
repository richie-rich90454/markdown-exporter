import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/print-document.css";

import { render } from "solid-js/web";

import { createApplicationContext } from "./ApplicationContext";
import { App } from "./ui/App";

const root = document.getElementById("root");
if (root === null) {
    throw new Error("Missing #root element");
}

render(() => <App context={createApplicationContext()} />, root);
