import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * OpenTUI starts a Tree-sitter `Worker` from `parser.worker.js`. Under Bun,
 * resolution via `new URL("./parser.worker.js", import.meta.url)` can point at
 * the wrong place when the client lives in a hashed bundle chunk, and the
 * package `"exports"` entry for `./parser.worker` may not match on-disk files.
 *
 * OpenCode fixes compiled builds with `define.OTUI_TREE_SITTER_WORKER_PATH`
 * plus a separate bundle entry; we set `process.env` early for `bun run` and
 * as a fallback for other cases.
 */
declare var OTUI_TREE_SITTER_WORKER_PATH: string | undefined;

if (!process.env.OTUI_TREE_SITTER_WORKER_PATH?.trim()) {
  // Compiled builds set the bare global OTUI_TREE_SITTER_WORKER_PATH via
  // Bun.build define; @opentui/core's TreeSitterClient picks it up directly.
  // Skip the fallback in that case to avoid require.resolve() on a package
  // that doesn't exist in the compiled $bunfs environment.
  if (typeof OTUI_TREE_SITTER_WORKER_PATH === "string" && OTUI_TREE_SITTER_WORKER_PATH.trim()) {
    // no-op — compiled mode, worker path already available as bare global
  } else {
    const require = createRequire(import.meta.url);
    const coreRoot = dirname(require.resolve("@opentui/core/package.json"));
    const candidates = [
      join(coreRoot, "parser.worker.js"),
      join(coreRoot, "lib", "tree-sitter", "parser.worker.js"),
    ];
    const workerFile = candidates.find((p) => existsSync(p));
    if (workerFile) {
      process.env.OTUI_TREE_SITTER_WORKER_PATH = pathToFileURL(workerFile).href;
    }
  }
}
