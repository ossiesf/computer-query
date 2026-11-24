import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) =>
{
  // `vite --mode e2e` swaps the real WebLLM library for a fake one,
  // so end-to-end tests run without a GPU or a model download.
  const alias: Record<string, string> =
    mode === "e2e" ? { "@mlc-ai/web-llm": "/tests/fixtures/webllm-fake.ts" } : {};

  return {
    // Relative asset paths so the build also works on GitHub Pages under /computer-query/.
    base: "./",
    resolve: { alias },
    server: { port: 5173 },
    // WebLLM (the in-browser model runtime) is a single ~5.5 MB chunk, loaded lazily. That is expected.
    build: { chunkSizeWarningLimit: 6000 },
    test: {
      include: ["tests/unit/**/*.test.ts"],
      environment: "node",
    },
  };
});
