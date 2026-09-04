import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { writeLocalRunner } from '../fixtures/helpers/vrunnerStub';

/**
 * Схема файла настроек зависит от версии раннера, а версия известна только после
 * детекта. Панели, построенные до него, перестраиваются по событию, поэтому
 * первое определение обязано его поднять.
 */
suite('версия vanessa-runner: событие первого определения', () => {
	const vrunner = VRunnerManager.getInstance();
	let root: string;

	setup(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrunner-version-'));
	});

	teardown(() => {
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	});

	test('первое определение оповещает подписчиков и меняет схему настроек', async () => {
		writeLocalRunner(root, '3.0.0');
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
