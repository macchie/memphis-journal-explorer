import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  // Enables TypeScript in <script lang="ts"> blocks and lets svelte-check /
  // the editor extension resolve types the same way Vite does.
  preprocess: vitePreprocess(),
};
