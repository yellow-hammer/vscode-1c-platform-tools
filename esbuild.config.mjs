/**
 * Сборка расширения через esbuild: один бандл с встроенными зависимостями (minimatch, glob)
 * + browser bundle для webview-canvas (Cytoscape + ELK).
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

const extensionOptions = {
	entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
	bundle: true,
	outfile: path.join(__dirname, 'out', 'extension.js'),
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	external: ['vscode'],
	sourcemap: true,
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

const erCanvasOptions = {
	entryPoints: [path.join(__dirname, 'src', 'webviews', 'metadataErCanvas', 'index.ts')],
	bundle: true,
	outfile: path.join(__dirname, 'out', 'webviews', 'metadataErCanvas', 'index.js'),
	platform: 'browser',
	format: 'iife',
	target: ['es2022', 'chrome120'],
	sourcemap: true,
	logLevel: 'info',
	define: { 'process.env.NODE_ENV': '"production"' },
	loader: { '.js': 'js' },
};

if (watch) {
	const extCtx = await esbuild.context(extensionOptions);
	await extCtx.watch();
	const erCtx = await esbuild.context(erCanvasOptions);
	await erCtx.watch();
	if (testEntryPoints.length > 0) {
		const testCtx = await esbuild.context(testOptions);
		await testCtx.watch();
	}
	console.log('watching...');
} else {
	await esbuild.build(extensionOptions);
	await esbuild.build(erCanvasOptions);
	if (testEntryPoints.length > 0) {
		await esbuild.build(testOptions);
	}
}
