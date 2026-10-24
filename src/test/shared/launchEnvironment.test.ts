import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { DEFAULT_PROFILE_ID } from '../../shared/envProfiles';
import { writeLocalRunner } from '../fixtures/helpers/vrunnerStub';

const INHERITED = 'ONECPT_ENVIRONMENT_TEST_INHERITED';

/**
 * Окружение запуска: какие переменные получит процесс, как оно сочетается с
 * профилем и когда запуск не начинается.
 */
suite('окружение запуска', () => {
	const vrunner = VRunnerManager.getInstance();
	let root: string;

	setup(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-env-'));
		writeLocalRunner(root, '3.0.0');
		process.env[INHERITED] = 'наследованное';
	});

	teardown(() => {
		delete process.env[INHERITED];
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	});

	function write(file: string, text: string): void {
		fs.writeFileSync(path.join(root, file), text, 'utf8');
	}

	test('файлы окружения поверх общих, личный поверх общего, переменная окружения сильнее унаследованной', async () => {
		write('autumn-properties.json', '{"vrunner": {}}');
		write('.env', `SHARED=база\n${INHERITED}=из-окружения\n`);
		write('.env.local', 'SHARED=лично\n');
		write('.env.dev', 'RUN_INTEGRATION=true\nRUN_SLOW=false\nURL=${SHARED}/db\n');
		write('.env.dev.local', 'RUN_SLOW=true\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.setActiveEnvironmentId('dev');
			const environment = vrunner.activeEnvironment();
			assert.deepStrictEqual(environment.files, ['.env', '.env.local', '.env.dev', '.env.dev.local']);
			assert.deepStrictEqual(environment.variables, {
				SHARED: 'лично',
				[INHERITED]: 'из-окружения',
				RUN_INTEGRATION: 'true',
				RUN_SLOW: 'true',
				URL: 'лично/db',
			});
			const env = vrunner.launchEnv({ CALL: 'вызов' });
			assert.strictEqual(env[INHERITED], 'из-окружения');
			assert.strictEqual(env.RUN_INTEGRATION, 'true');
			assert.strictEqual(env.CALL, 'вызов');
		});
	});

	test('окружение выбирается отдельно от профиля: .env.<имя> профилем не становится', async () => {
		write('autumn-properties.json', '{"vrunner": {}}');
		write('autumn-properties.dev.json', '{"vrunner": {}}');
		write('.env.ci', 'VRUNNER_IBCMD=true\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			assert.deepStrictEqual(vrunner.discoverEnvProfiles().map((profile) => profile.id), [DEFAULT_PROFILE_ID, 'dev']);
			assert.deepStrictEqual(vrunner.discoverEnvironments(), [{ id: 'ci', files: ['.env.ci'] }]);
			await vrunner.setActiveEnvProfileId('dev');
			await vrunner.setActiveEnvironmentId('ci');
			assert.deepStrictEqual(vrunner.getActiveSettingsParamIfExists(), ['--settings', 'autumn-properties.dev.json']);
			assert.strictEqual(vrunner.launchEnv().VRUNNER_IBCMD, 'true');
			assert.strictEqual(vrunner.launchProblem(), undefined);
		});
	});

	test('выбранного окружения нет в проекте: команды и прогоны не начинаются, и с явным файлом настроек тоже', async () => {
		write('autumn-properties.json', '{"vrunner": {}}');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvironmentId('stage');
			assert.match(vrunner.launchProblem() ?? '', /Окружение «stage» не найдено/);
			const state = vrunner.describeSettingsState();
			assert.strictEqual(state.ready, false);
			assert.strictEqual(state.fileReady, true, 'файл настроек годен: отказ из-за окружения');
			assert.strictEqual(vrunner.profileProblem(), undefined);
			assert.match(vrunner.settingsProblemMessage(state), /«stage» не найдено/);
			assert.strictEqual(vrunner.launchFix(vrunner.launchProblem() ?? '').command, '1c-platform-tools.env.selectEnvironment');
			assert.strictEqual(vrunner.describeSettingsState('autumn-properties.json').ready, false);
			assert.strictEqual(await vrunner.ensureProfileSettingsFile(false), false);
			await vrunner.setActiveEnvironmentId(undefined);
			assert.strictEqual(vrunner.launchProblem(), undefined);
			assert.strictEqual(vrunner.ensureLaunchReady(), true);
			assert.strictEqual(vrunner.ensureEnvironmentReady(), true);
		});
	});

	test('выбранного профиля нет в проекте: команды не начинаются, явный файл настроек вызова его заменяет', async () => {
		write('autumn-properties.json', '{"vrunner": {}}');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvProfileId('dev');
			assert.match(vrunner.launchProblem() ?? '', /Профиль запуска «dev» не найден/);
			assert.strictEqual(vrunner.launchFix(vrunner.launchProblem() ?? '').command, '1c-platform-tools.env.selectProfile');
			assert.strictEqual(vrunner.describeSettingsState().ready, false);
			assert.strictEqual(vrunner.describeSettingsState('autumn-properties.json').ready, true);
			assert.strictEqual(vrunner.ensureEnvironmentReady(), true, 'запуску без профиля пропавший профиль не мешает');
		});
	});

	test('личный файл vanessa-runner 3 из ключа settings не профиль, но его значения видны', async () => {
		write('autumn-properties.json', '{"vrunner": {"settings": "autumn-properties.local.json", "ibconnection": "/F./build/ib"}}');
		write('autumn-properties.local.json', '{"vrunner": {"ibconnection": "/F./build/личная"}}');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			assert.deepStrictEqual(vrunner.discoverEnvProfiles().map((profile) => profile.id), [DEFAULT_PROFILE_ID]);
			assert.deepStrictEqual(vrunner.settingsLayerFiles('autumn-properties.json'), ['autumn-properties.local.json', 'autumn-properties.json']);
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/личная');
		});
	});

	test('VRUNNER_SETTINGS из окружения выбирает накладку вместо ключа settings', async () => {
		fs.mkdirSync(path.join(root, 'tools'));
		write('autumn-properties.json', '{"vrunner": {"settings": "autumn-properties.local.json"}}');
		write('tools/vrunner.json', '{"vrunner": {"ibconnection": "/F./build/ci"}}');
		write('.env.ci', 'VRUNNER_SETTINGS=tools/vrunner.json\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvironmentId('ci');
			assert.deepStrictEqual(vrunner.settingsLayerFiles('autumn-properties.json'), ['tools/vrunner.json', 'autumn-properties.json']);
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/ci');
		});
	});

	test('база и платформа из окружения у vanessa-runner 3 сильнее файла настроек', async () => {
		write('autumn-properties.json', '{"vrunner": {"ibconnection": "/F./build/ib", "v8version": "8.3.25"}}');
		write('.env.ci', 'VRUNNER_IBCONNECTION=/F./build/ci\nVRUNNER_V8VERSION=8.3.27\nRUNNER_DBUSER=из-2.x\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvironmentId('ci');
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/ci');
			assert.strictEqual(await vrunner.getActiveV8Version(), '8.3.27');
			assert.deepStrictEqual(await vrunner.getIbCredentials(), { user: '', password: '' });
		});
	});

	test('база из окружения у vanessa-runner 2 сильнее env.json', async () => {
		writeLocalRunner(root, '2.6.1');
		write('env.json', '{"default": {"--ibconnection": "/F./build/ib", "--db-user": "Админ"}}');
		write('.env.ci', 'RUNNER_IBCONNECTION=/F./build/ci\nVRUNNER_DBUSER=из-3.x\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvironmentId('ci');
			assert.strictEqual(await vrunner.getActiveIbConnectionValue(), '/F./build/ci');
			assert.deepStrictEqual(await vrunner.getIbCredentials(), { user: 'Админ', password: '' });
		});
	});
});
