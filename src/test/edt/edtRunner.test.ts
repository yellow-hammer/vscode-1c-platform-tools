import * as assert from 'node:assert';
import * as path from 'node:path';
import { buildEdtArgs, edtWorkspaceDir, type EdtSettings } from '../../features/edt/edtRunner';

/** Настройки по умолчанию для сборки вызова. */
function settings(overrides: Partial<EdtSettings> = {}): EdtSettings {
	return { path: '', version: '', workspace: '', timeoutSeconds: 3600, vmargs: [], ...overrides };
}

suite('запуск команд EDT', () => {
	test('рабочая область и общие параметры идут до -command', () => {
		const args = buildEdtArgs(
			{
				command: 'validate',
				args: ['--project-list', 'ssl31'],
				title: 'Проверить проект EDT',
				workspaceDir: 'C:/проект/build/edt-workspace',
				cwd: 'C:/проект',
			},
			settings()
		);

		assert.deepStrictEqual(args, [
			'-data',
			'C:/проект/build/edt-workspace',
			'-timeout',
			'3600',
			'-command',
			'validate',
			'--project-list',
			'ssl31',
		]);
	});

	test('каждый аргумент JVM передаётся своим -vmargs', () => {
		const args = buildEdtArgs(
			{ command: 'build', args: [], title: 'Сборка', workspaceDir: 'ws', cwd: '.' },
			settings({ vmargs: ['-Xmx8g', '-Dfile.encoding=UTF-8'] })
		);

		assert.deepStrictEqual(args.slice(4, 8), ['-vmargs', '-Xmx8g', '-vmargs', '-Dfile.encoding=UTF-8']);
		assert.strictEqual(args[8], '-command');
	});

	test('таймаут берётся из настроек', () => {
		const args = buildEdtArgs(
			{ command: 'export', args: [], title: 'Выгрузка', workspaceDir: 'ws', cwd: '.' },
			settings({ timeoutSeconds: 7200 })
		);

		assert.strictEqual(args[args.indexOf('-timeout') + 1], '7200');
	});

	test('рабочая область по умолчанию лежит в каталоге сборки', () => {
		const dir = edtWorkspaceDir('C:/проект', 'build', settings());

		assert.strictEqual(dir, path.join('C:/проект', 'build', 'edt-workspace'));
	});

	test('настроенная рабочая область может быть относительной и абсолютной', () => {
		assert.strictEqual(
			edtWorkspaceDir('C:/проект', 'build', settings({ workspace: 'едт' })),
			path.join('C:/проект', 'едт')
		);
		assert.strictEqual(edtWorkspaceDir('C:/проект', 'build', settings({ workspace: 'D:/ws' })), 'D:/ws');
	});
});
