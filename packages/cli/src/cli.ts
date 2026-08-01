#!/usr/bin/env node
import { main } from "./main.js";

/**
 * The process entrypoint, and nothing else. Everything a test would want to
 * drive lives in `main.ts`; what is left here is the pair of things a test
 * cannot have — the real `process.argv` and a real `process.exit`.
 */
main(process.argv.slice(2)).then((code) => process.exit(code));
