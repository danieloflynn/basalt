/**
 * Bundles the Electron main + preload into electron-dist/*.cjs with esbuild.
 * Emitted as CommonJS with a .cjs extension on purpose: the root package.json is
 * "type": "module", so a bare .js here would be parsed as ESM and break require;
 * .cjs is unambiguous and sidesteps Electron's ESM-preload restrictions.
 * isomorphic-git (pure JS) is bundled in; only `electron` stays external.
 */
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await Promise.all([
  build({ ...shared, entryPoints: ['electron/main.ts'], outfile: 'electron-dist/main.cjs' }),
  build({ ...shared, entryPoints: ['electron/preload.ts'], outfile: 'electron-dist/preload.cjs' }),
]);
