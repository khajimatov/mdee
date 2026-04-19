#!/usr/bin/env bun
/**
 * Compile a standalone binary with Bun. Tree-sitter runs in `parser.worker.js`;
 * for `bun build --compile`, that worker must be a separate entrypoint and the
 * main bundle must receive a `$bunfs` path so `new Worker(...)` resolves inside
 * the compiled executable (same pattern as OpenCode).
 */
import { $ } from "bun";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import pkg from "../package.json" with { type: "json" };

const dir = import.meta.dirname ? path.resolve(import.meta.dirname, "..") : process.cwd();
process.chdir(dir);

const skipInstall = process.argv.includes("--skip-install");
if (!skipInstall) {
  const version = pkg.dependencies["@opentui/core"]?.replace(/^[\^~]/, "") ?? "latest";
  await $`bun install --os="*" --cpu="*" @opentui/core@${version}`.quiet();
}

const localWorker = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js");
const parserWorker = existsSync(localWorker)
  ? realpathSync(localWorker)
  : realpathSync(path.resolve(dir, "node_modules/@opentui/core/parser.worker.js"));

const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/");
const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
const otuiWorkerDefine = bunfsRoot + workerRelativePath;

const outdir = path.join(dir, "dist");
await $`rm -rf ${outdir}`.nothrow();
await $`mkdir -p ${outdir}`.quiet();

const outfile = path.join(outdir, process.platform === "win32" ? "mdee.exe" : "mdee");

const result = await Bun.build({
  entrypoints: [path.join(dir, "src/index.ts"), parserWorker],
  tsconfig: path.join(dir, "tsconfig.json"),
  format: "esm",
  minify: true,
  splitting: true,
  define: {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(otuiWorkerDefine),
  },
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    outfile,
  },
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

console.log(`Wrote ${outfile}`);
