import * as esbuild from 'esbuild';
import { mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });
mkdirSync('public', { recursive: true });

const watch = process.argv.includes('--watch');

const backendOptions: esbuild.BuildOptions = {
  entryPoints: ['src/backend/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/backend.js',
  external: ['chokidar', 'nodemailer', 'fastify', '@fastify/static', 'js-yaml'],
  sourcemap: true,
  target: 'node20',
};

const frontendOptions: esbuild.BuildOptions = {
  entryPoints: ['src/frontend/app.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: 'public/app.js',
  sourcemap: true,
  target: ['chrome90', 'firefox90', 'safari14'],
  minify: !watch,
};

if (watch) {
  const [backendCtx, frontendCtx] = await Promise.all([
    esbuild.context(backendOptions),
    esbuild.context(frontendOptions),
  ]);
  await Promise.all([backendCtx.watch(), frontendCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(backendOptions),
    esbuild.build(frontendOptions),
  ]);
  console.log('Build complete');
}
