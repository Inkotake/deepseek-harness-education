#!/usr/bin/env node
/** Entry point for teacher-publish. All logic lives in ../src/cli.mjs. */
import { run } from '../src/cli.mjs';

run().then((code) => {
  process.exitCode = code;
});
