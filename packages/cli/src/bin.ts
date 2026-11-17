#!/usr/bin/env node
import { nodeContext } from "./context.js";
import { run } from "./main.js";

run(process.argv.slice(2), nodeContext()).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`予期しないエラー: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 2;
  },
);
