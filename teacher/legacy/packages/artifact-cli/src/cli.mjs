import { error, log } from './common.mjs';

const [, , command, ...args] = process.argv;

function usage() {
  log(`
teacher-artifact - Teacher DSH artifact toolchain

Usage:
  teacher-artifact init <name> --template <template> [--skip-install]
  teacher-artifact build [--base <base>]
  teacher-artifact preview [--port <port>] [--open]
  teacher-artifact check
  teacher-artifact pack [--name <zip-name>]

Templates: basic, three, math, physics-2d, chart, diagram, classroom-game

Examples:
  teacher-artifact init gravity --template three
  teacher-artifact build
  teacher-artifact check
  teacher-artifact preview --open
`);
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    process.exit(command ? 0 : 1);
  }

  try {
    switch (command) {
      case 'init': {
        const { initArtifact } = await import('./init.mjs');
        process.exitCode = await initArtifact(args);
        break;
      }
      case 'build': {
        const { buildArtifact } = await import('./build.mjs');
        process.exitCode = await buildArtifact(args);
        break;
      }
      case 'preview': {
        const { previewArtifact } = await import('./preview.mjs');
        process.exitCode = await previewArtifact(args);
        break;
      }
      case 'check': {
        const { checkArtifact } = await import('./check.mjs');
        process.exitCode = await checkArtifact(args);
        break;
      }
      case 'pack': {
        const { packArtifact } = await import('./pack.mjs');
        process.exitCode = await packArtifact(args);
        break;
      }
      default:
        error(`Unknown command: ${command}`);
        usage();
        process.exitCode = 1;
    }
  } catch (err) {
    error(err.message);
    process.exitCode = 1;
  }
}

main();