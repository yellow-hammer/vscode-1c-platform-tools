import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { DEFAULT_PROFILE_ID } from '../../shared/envProfiles';
import { writeLocalRunner } from '../fixtures/helpers/vrunnerStub';

const INHERITED = 'ONECPT_PROFILE_TEST_INHERITED';

/**
 * Окружение профиля запуска: какие переменные получит процесс, какой файл
 * настроек увидит vanessa-runner и когда запуск не начинается.
 */
suite('окружение профиля запуска', () => {
	const vrunner = VRunnerManager.getInstance();
	let root: string;

	setup(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-env-'));
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

	test('файлы профиля поверх «По умолчанию», личный поверх общего, переменная профиля сильнее унаследованной', async () => {
		write('autumn-properties.json', '{"vrunner": {}}');
		write('.env', `SHARED=база\n${INHERITED}=из-профиля\n`);
		write('.env.local', 'SHARED=лично\n');
		write('.env.sqlite', 'TESTRUNNER_RUN_SQLITE_TESTS=true\nTESTRUNNER_RUN_POSTGRES_TESTS=false\nURL=${SHARED}/db\n');
		write('.env.sqlite.local', 'TESTRUNNER_RUN_POSTGRES_TESTS=true\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.setActiveEnvProfileId('sqlite');
			const environment = vrunner.profileEnvironment();
			assert.deepStrictEqual(environment.files, ['.env', '.env.local', '.env.sqlite', '.env.sqlite.local']);
			assert.deepStrictEqual(environment.variables, {
				SHARED: 'лично',
				[INHERITED]: 'из-профиля',
				TESTRUNNER_RUN_SQLITE_TESTS: 'true',
				TESTRUNNER_RUN_POSTGRES_TESTS: 'true',
				URL: 'лично/db',
			});
			const env = vrunner.launchEnv({ CALL: 'вызов' });
			assert.strictEqual(env[INHERITED], 'из-профиля');
			assert.strictEqual(env.TESTRUNNER_RUN_SQLITE_TESTS, 'true');
			assert.strictEqual(env.CALL, 'вызов');
		});
	});

	test('профиль из одного .env работает на базовом файле настроек, без --settings', async () => {
		write('autumn-properties.json', '{"vrunner": {}}');
		write('.env.ci', 'VRUNNER_IBCMD=true\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvProfileId('ci');
			assert.deepStrictEqual(vrunner.getActiveSettingsParamIfExists(), []);
			assert.strictEqual(vrunner.getActiveEnvFile(), 'autumn-properties.json');
			assert.strictEqual(vrunner.launchProfileProblem(), undefined);
			assert.strictEqual(vrunner.describeSettingsState().ready, true);
		});
	});

	test('выбранного профиля нет в проекте: команды и прогоны не начинаются', async () => {
		write('autumn-properties.json', '{"vrunner": {}}');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvProfileId('postgres');
			assert.match(vrunner.launchProfileProblem() ?? '', /«postgres» не найден/);
			const state = vrunner.describeSettingsState();
			assert.strictEqual(state.ready, false);
			assert.match(vrunner.settingsProblemMessage(state), /«postgres» не найден/);
			assert.strictEqual(await vrunner.ensureProfileSettingsFile(false), false);
			await vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			assert.strictEqual(vrunner.launchProfileProblem(), undefined);
		});
	});

	test('личный файл vanessa-runner 3 из ключа settings не профиль, но его значения видны', async () => {
		write('autumn-properties.json', '{"vrunner": {"settings": "autumn-properties.local.json", "ibconnection": "/F./build/ib"}}');
		write('autumn-properties.local.json', '{"vrunner": {"ibconnection": "/F./build/личная"}}');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			assert.deepStrictEqual(vrunner.discoverEnvProfiles().map((profile) => profile.id), [DEFAULT_PROFILE_ID]);
			assert.deepStrictEqual(vrunner.settingsLayerFiles('autumn-properties.json'), ['autumn-properties.local.json', 'autumn-properties.json']);
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/личная');
		});
	});

	test('база и платформа из окружения профиля vanessa-runner 3 сильнее файла настроек', async () => {
		write('autumn-properties.json', '{"vrunner": {"ibconnection": "/F./build/ib", "v8version": "8.3.25"}}');
		write('.env.ci', 'VRUNNER_IBCONNECTION=/F./build/ci\nVRUNNER_V8VERSION=8.3.27\nRUNNER_DBUSER=из-2.x\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvProfileId('ci');
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/ci');
			assert.strictEqual(await vrunner.getActiveV8Version(), '8.3.27');
			assert.deepStrictEqual(await vrunner.getIbCredentials(), { user: '', password: '' });
		});
	});

	test('база из окружения профиля vanessa-runner 2 сильнее env.json', async () => {
		writeLocalRunner(root, '2.6.1');
		write('env.json', '{"default": {"--ibconnection": "/F./build/ib", "--db-user": "Админ"}}');
		write('.env.ci', 'RUNNER_IBCONNECTION=/F./build/ci\nVRUNNER_DBUSER=из-3.x\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvProfileId('ci');
			assert.strictEqual(await vrunner.getActiveIbConnectionValue(), '/F./build/ci');
			assert.deepStrictEqual(await vrunner.getIbCredentials(), { user: 'Админ', password: '' });
		});
	});

	test('VRUNNER_SETTINGS из окружения профиля выбирает накладку вместо ключа settings', async () => {
		fs.mkdirSync(path.join(root, 'tools'));
		write('autumn-properties.json', '{"vrunner": {"settings": "autumn-properties.local.json"}}');
		write('tools/vrunner.json', '{"vrunner": {"ibconnection": "/F./build/ci"}}');
		write('.env.ci', 'VRUNNER_SETTINGS=tools/vrunner.json\n');
		await vrunner.runWithProjectRoot(root, async () => {
			await vrunner.getVRunnerVersion();
			await vrunner.setActiveEnvProfileId('ci');
			assert.deepStrictEqual(vrunner.settingsLayerFiles('autumn-properties.json'), ['tools/vrunner.json', 'autumn-properties.json']);
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/ci');
		});
	});
});
