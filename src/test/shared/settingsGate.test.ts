import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { writeLocalRunner } from '../fixtures/helpers/vrunnerStub';

const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'launchProfiles');

/**
 * Панель, статус-бар и команды судят о файле настроек по одному состоянию:
 * файл с BOM или комментарием годится, файл другой схемы или с ошибкой
 * синтаксиса блокирует команды с понятной причиной.
 */
suite('файл настроек профиля: команды видят то же, что панель', () => {
	const vrunner = VRunnerManager.getInstance();
	let root: string;

	setup(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-gate-'));
	});

	teardown(() => {
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	});

	function useFixture(fixture: string, target: string): void {
		fs.copyFileSync(path.join(FIXTURES, fixture), path.join(root, target));
	}

	test('autumn-properties.json с BOM и комментарием годится для vanessa-runner 3', async () => {
		writeLocalRunner(root, '3.0.0');
		useFixture('autumn-properties.bom.json', 'autumn-properties.json');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			const state = vrunner.describeSettingsState();
			assert.strictEqual(state.ready, true, JSON.stringify(state));
			assert.strictEqual(await vrunner.ensureProfileSettingsFile(false), true);
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/ib-bom');
		});
	});

	test('env.json с BOM годится для vanessa-runner 2', async () => {
		writeLocalRunner(root, '2.6.1');
		useFixture('env.bom.json', 'env.json');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			assert.strictEqual(vrunner.describeSettingsState().ready, true);
			assert.strictEqual(await vrunner.ensureProfileSettingsFile(false), true);
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/ib-bom');
		});
	});

	test('файл другой схемы блокирует команды и называет формат', async () => {
		writeLocalRunner(root, '3.0.0');
		useFixture('autumn-properties.v2-format.json', 'autumn-properties.json');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			const state = vrunner.describeSettingsState();
			assert.strictEqual(state.exists, true);
			assert.strictEqual(state.formatMismatch, true);
			assert.strictEqual(state.ready, false);
			assert.strictEqual(await vrunner.ensureProfileSettingsFile(false), false);
			assert.match(vrunner.settingsProblemMessage(state), /в формате vanessa-runner 2\.x/);
		});
	});

	test('нечитаемый файл блокирует команды и называет строку ошибки', async () => {
		writeLocalRunner(root, '3.0.0');
		useFixture('autumn-properties.broken.json', 'autumn-properties.json');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			const state = vrunner.describeSettingsState();
			assert.strictEqual(state.exists, true);
			assert.ok(state.readError, 'причина разбора');
			assert.strictEqual(state.ready, false);
			assert.strictEqual(await vrunner.ensureProfileSettingsFile(false), false);
			assert.match(vrunner.settingsProblemMessage(state), /не прочитан: .*строка \d+/);
		});
	});

	test('без файла профиль не создан', async () => {
		writeLocalRunner(root, '3.0.0');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			const state = vrunner.describeSettingsState();
			assert.strictEqual(state.exists, false);
			assert.strictEqual(state.fileName, 'autumn-properties.json');
			assert.strictEqual(await vrunner.ensureProfileSettingsFile(false), false);
		});
	});
});
