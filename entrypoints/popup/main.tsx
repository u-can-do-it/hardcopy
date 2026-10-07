import { render } from "preact";

import "@/assets/tailwind.css";
import { App } from "./App";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");

render(<App />, root);
