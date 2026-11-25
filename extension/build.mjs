// Builds the browser extension into extension/dist. Load that folder unpacked in Chrome, Edge or Brave.
// npm run build:extension runs it from the repo root.

import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = import.meta.dirname;
const src = path.join(root, "src");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    background: path.join(src, "background.ts"),
    popup: path.join(src, "popup.ts"),
    content: path.join(src, "content.ts"),
  },
  bundle: true,
  outdir: dist,
  // Each file runs as a classic script: the service worker, the popup page, and the script in the lesson page.
  format: "iife",
  platform: "browser",
  target: "chrome120",
  legalComments: "none",
  logLevel: "info",
});

await copyFile(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));
await copyFile(path.join(src, "popup.html"), path.join(dist, "popup.html"));
await copyFile(path.join(src, "popup.css"), path.join(dist, "popup.css"));
