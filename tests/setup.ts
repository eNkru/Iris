import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-unmount React components between tests so the DOM does not
// accumulate renders across the file (matches the recommended pattern at
// https://testing-library.com/docs/react-testing-library/api#cleanup).
afterEach(() => {
  cleanup();
});