import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VRunnerManager } from '../../shared/vrunnerManager';

/**
 * Схема файла настроек зависит от версии раннера, а версия известна только после
 * детекта. Панели, построенные до него, перестраиваются по событию, поэтому
 * первое определение обязано его поднять.
 */
suite('версия vanessa-runner: событие первого определения', () => {
	const vrunner = VRunnerManager.getInstance();
	let root: string;

	/** Локальный vanessa-runner проекта, отвечающий на запрос версии сразу. */
	function writeLocalRunner(version: string): void {
		const bin = path.join(root, 'oscript_modules', 'bin');
		fs.mkdirSync(bin, { recursive: true });
		if (process.platform === 'win32') {
			fs.writeFileSync(path.join(bin, 'vrunner.bat'), `@echo ${version}\r\n`, 'utf8');
			return;
		}
		const runner = path.join(bin, 'vrunner');
		fs.writeFileSync(runner, `#!/bin/sh\necho ${version}\n`, 'utf8');
		fs.chmodSync(runner, 0o755);
	}

	setup(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrunner-version-'));
	});

	teardown(() => {
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	});

	test('первое определение оповещает подписчиков и меняет схему настроек', async () => {
		writeLocalRunner('3.0.0');
		let fired = 0;
		const subscription = vrunner.onDidChangeVRunnerVersion(() => {
			fired++;
		});
		try {
			await vrunner.runWithProjectRoot(root, async () => {
				assert.strictEqual(vrunner.getActiveSettingsSchema(), 'v2', 'до детекта схема считается 2.x');

				await vrunner.getVRunnerVersion();
				assert.strictEqual(fired, 1, 'после первого определения панели должны перестроиться');
				assert.strictEqual(vrunner.getActiveSettingsSchema(), 'v3');

				await vrunner.getVRunnerVersion();
				assert.strictEqual(fired, 1, 'ответ из кэша событие не поднимает');
			});
		} finally {
			subscription.dispose();
		}
	});
});
