import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { buildServerArgs } from '../../features/launch/platformServerManager';
import type { ServerArgsSettings } from '../../features/launch/platformServerManager';

const DATA_DIR = 'C:/proj/build/ibsrv';
const CONFIG_PATH = 'C:/proj/build/ibsrv/publication.yaml';

/** Настройки, влияющие на командную строку, при пустой пользовательской конфигурации. */
function defaultSettings(): ServerArgsSettings {
	const config = vscode.workspace.getConfiguration('1c-platform-tools.server');
	return {
		debug: config.get<boolean>('debug', false),
		debugPort: config.get<number>('debugPort', 1550),
		directRegPort: config.get<string>('directRegPort', '').trim(),
		directRange: config.get<string>('directRange', '').trim(),
	};
}

suite('buildServerArgs', () => {
	test('настройки по умолчанию дают прежнюю командную строку', () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools.server');
		assert.strictEqual(config.inspect<string>('directRegPort')?.defaultValue, '');
		assert.strictEqual(config.inspect<string>('directRange')?.defaultValue, '');

		assert.deepStrictEqual(buildServerArgs(DATA_DIR, CONFIG_PATH, defaultSettings()), [
			`--data=${DATA_DIR}`,
			`--config=${CONFIG_PATH}`,
		]);
	});

	test('заданные порты прямого соединения уходят отдельными аргументами', () => {
		const settings: ServerArgsSettings = {
			debug: false,
			debugPort: 1550,
			directRegPort: '1641',
			directRange: '1660:1691',
		};

		assert.deepStrictEqual(buildServerArgs(DATA_DIR, CONFIG_PATH, settings), [
			`--data=${DATA_DIR}`,
			`--config=${CONFIG_PATH}`,
			'--direct-regport=1641',
			'--direct-range=1660:1691',
		]);
	});

	test('порт регистрации и диапазон задаются независимо', () => {
		const onlyPort = buildServerArgs(DATA_DIR, CONFIG_PATH, {
			debug: false,
			debugPort: 1550,
			directRegPort: '1641',
			directRange: '',
		});
		const onlyRange = buildServerArgs(DATA_DIR, CONFIG_PATH, {
			debug: false,
			debugPort: 1550,
			directRegPort: '',
			directRange: '1660:1691',
		});

		assert.ok(onlyPort.includes('--direct-regport=1641'));
		assert.ok(!onlyPort.some((arg) => arg.startsWith('--direct-range')));
		assert.ok(onlyRange.includes('--direct-range=1660:1691'));
		assert.ok(!onlyRange.some((arg) => arg.startsWith('--direct-regport')));
	});

	test('отладка добавляется после портов прямого соединения', () => {
		const settings: ServerArgsSettings = {
			debug: true,
			debugPort: 1551,
			directRegPort: '1641',
			directRange: '1660:1691',
		};

		assert.deepStrictEqual(buildServerArgs(DATA_DIR, CONFIG_PATH, settings), [
			`--data=${DATA_DIR}`,
			`--config=${CONFIG_PATH}`,
			'--direct-regport=1641',
			'--direct-range=1660:1691',
			'--debug=http',
			'--debug-port=1551',
		]);
	});
});
