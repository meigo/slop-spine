import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

// Dark is slop-spine's default appearance; slop-animator's tokens are light-first with a `.dark`
// override, and adopting them without this would flip us to light mode.
document.documentElement.classList.add("dark");

export default mount(App, { target: document.getElementById("app")! });
