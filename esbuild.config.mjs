/**
 * Сборка расширения через esbuild: один бандл с встроенными зависимостями (minimatch, glob).
 * node_modules не нужен в VSIX.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const srcTestDir = path.join(__dirname, 'src', 'test');
const testEntryPoints = fs.existsSync(srcTestDir)
	? fs.readdirSync(srcTestDir, { recursive: true })
		.filter((f) => typeof f === 'string' && f.endsWith('.test.ts'))
		.map((f) => path.join(srcTestDir, f))
	: [];

// Шим для minimatch: CJS-сборка экспортирует .minimatch, а код из glob ожидает .default.
// Патчим через Module.prototype.require, чтобы сработало при любой загрузке.
const minimatchShimBanner = `
(function(){var r=require('module').prototype.require;require('module').prototype.require=function(id){var m=r.apply(this,arguments);if(id==='minimatch'&&m&&typeof m.minimatch==='function')m.default=m.minimatch;return m;};})();
`;

const extensionOptions = {
	entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
	bundle: true,
	outfile: path.join(__dirname, 'out', 'extension.js'),
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	external: ['vscode', 'minimatch'],
	sourcemap: true,
	banner: { js: minimatchShimBanner },
	// Предпочтение CJS-сборок зависимостей для корректного бандлинга в format: 'cjs'
	mainFields: ['main', 'module'],
};

const testOptions = {
	entryPoints: testEntryPoints,
	bundle: true,
	outbase: path.join(__dirname, 'src'),
	outdir: path.join(__dirname, 'out'),
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	external: ['vscode'],
	sourcemap: true,
	mainFields: ['main', 'module'],
};

if (watch) {
	const extCtx = await esbuild.context(extensionOptions);
	await extCtx.watch();
	if (testEntryPoints.length > 0) {
		const testCtx = await esbuild.context(testOptions);
		await testCtx.watch();
	}
	console.log('watching...');
} else {
	await esbuild.build(extensionOptions);
	if (testEntryPoints.length > 0) {
		await esbuild.build(testOptions);
	}
}
