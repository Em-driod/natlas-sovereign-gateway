import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const htmlPath = fileURLToPath(new URL("./index.html", import.meta.url));
let cached: string | undefined;

export function dashboardHtml(): string {
  // Re-read in dev so edits show without a restart.
  if (process.env.NODE_ENV === "production" && cached) return cached;
  cached = readFileSync(htmlPath, "utf8");
  return cached;
}
