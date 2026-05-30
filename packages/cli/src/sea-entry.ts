#!/usr/bin/env node
/**
 * SEA binary entry point.
 * This file is bundled into the SEA blob and executes the CLI.
 */
import { main } from './main';

main().then((exitCode) => {
  process.exit(exitCode);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
