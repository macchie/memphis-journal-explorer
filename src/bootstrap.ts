import "./style.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.querySelector<HTMLDivElement>("#app");

if (!target) {
  throw new Error("The application root (#app) is missing.");
}

mount(App, { target });