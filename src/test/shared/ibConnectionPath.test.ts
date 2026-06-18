import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	resolveFileIbAbsolutePath,
	resolveFileIbConnectionString,
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
});
