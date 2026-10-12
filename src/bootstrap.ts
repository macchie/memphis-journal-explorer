import "./style.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { initLocale } from "./i18n";

// Resolve the UI language from the ?lang= URL parameter (default: Italian)
// before mounting so the first render is already in the right locale.
initLocale();

const target = document.querySelector<HTMLDivElement>("#app");

if (!target) {
  throw new Error("The application root (#app) is missing.");
}

mount(App, { target });