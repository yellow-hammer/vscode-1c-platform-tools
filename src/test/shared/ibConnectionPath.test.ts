import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	resolveFileIbAbsolutePath,
	resolveFileIbConnectionString,
	quoteFileIbConnection,
} from '../../shared/ibConnectionPath';

suite('ibConnectionPath', () => {
	const workspaceRoot = path.join('C:', 'projects', 'my-app');
	const absoluteIbPath = path.join('D:', 'bases', 'file-ib');

	test('resolveFileIbAbsolutePath: относительный путь от корня проекта', () => {
		assert.strictEqual(
			resolveFileIbAbsolutePath('/F./build/ib', workspaceRoot),
			path.join(workspaceRoot, 'build', 'ib')
		);
	});

	test('resolveFileIbAbsolutePath: абсолютный путь в кавычках (vanessa-runner)', () => {
		assert.strictEqual(
			resolveFileIbAbsolutePath('/F"D:\\bases\\file-ib"', workspaceRoot),
			absoluteIbPath
		);
	});

	test('resolveFileIbAbsolutePath: абсолютный путь без кавычек', () => {
		assert.strictEqual(
			resolveFileIbAbsolutePath('/FD:\\bases\\file-ib', workspaceRoot),
			absoluteIbPath
		);
	});

	test('resolveFileIbConnectionString: серверная ИБ не меняется', () => {
		const server = '/Slocalhost\\MyBase';
		assert.strictEqual(resolveFileIbConnectionString(server, workspaceRoot), server);
	});

	test('resolveFileIbConnectionString: файловая ИБ с кавычками', () => {
		assert.strictEqual(
			resolveFileIbConnectionString('/F"D:\\bases\\file-ib"', workspaceRoot),
			'/F' + absoluteIbPath
		);
	});
	test('quoteFileIbConnection: путь с пробелом закавычивается', () => {
		assert.strictEqual(
			quoteFileIbConnection(String.raw`/FC:\каталог с пробелом\ib`),
			String.raw`/F"C:\каталог с пробелом\ib"`
		);
	});

	test('quoteFileIbConnection: путь без пробелов не меняется', () => {
		assert.strictEqual(quoteFileIbConnection('/F./build/ib'), '/F./build/ib');
	});

	test('quoteFileIbConnection: уже закавыченный путь не удваивает кавычки', () => {
		const quoted = String.raw`/F"C:\каталог с пробелом\ib"`;
		assert.strictEqual(quoteFileIbConnection(quoted), quoted);
	});

	test('quoteFileIbConnection: серверная строка не меняется', () => {
		const server = String.raw`/Sсервер\база`;
		assert.strictEqual(quoteFileIbConnection(server), server);
	});
});
