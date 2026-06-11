import { defineConfig } from "vitest/config";

// Unit / integration tests for game logic modules.
// Uses jsdom (a real DOM + localStorage implementation, not stubs) so the
// real module code runs unmodified.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    globals: false,
    restoreMocks: true,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      reporter: ["text", "html"],
    },
  },
});
