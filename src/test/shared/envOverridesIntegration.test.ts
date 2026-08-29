/**
 * Интеграционный прогон перекрытий профиля запуска: реальный VRunnerManager
 * на временном каталоге с .git/HEAD, env.json и env.local.json.
 *
 * Проверяется сквозной путь, которым пользуются команды vrunner:
 * getActiveEnvOverrideArgs (флаги к каждой команде), эффективные значения и
 * подстановка ${gitBranch} — включая переключение ветки без перезагрузки окна.
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { LOCAL_OVERRIDES_FILE } from '../../shared/envProfiles';

function writeJson(root: string, fileName: string, data: unknown): void {
	fs.writeFileSync(path.join(root, fileName), JSON.stringify(data, null, 2), 'utf8');
}

function writeHead(root: string, content: string): void {
	fs.mkdirSync(path.join(root, '.git'), { recursive: true });
	fs.writeFileSync(path.join(root, '.git', 'HEAD'), content, 'utf8');
}

suite('перекрытия профиля запуска (интеграция)', () => {
	const roots: string[] = [];
	const vrunner = VRunnerManager.getInstance();

	function makeProject(): string {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'envOverrides-test-'));
		roots.push(root);
		return root;
	}

	suiteSetup(async () => {
		// временные параметры из workspaceState тестового профиля не должны
		// влиять на ожидаемые флаги
		await vrunner.setActiveEnvOverrides(undefined);
	});

	suiteTeardown(() => {
		for (const root of roots) {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('${gitBranch} из профиля материализуется флагом с подставленной веткой', async () => {
		const root = makeProject();
		writeHead(root, 'ref: refs/heads/feature/RS-123\n');
		writeJson(root, 'env.json', { default: { '--ibconnection': '/F./build/${gitBranch}', '--v8version': '8.3.27' } });

		await vrunner.runWithProjectRoot(root, async () => {
			assert.strictEqual(vrunner.getGitBranchDirName(), 'feature-RS-123');
			// значение с переменной — флагом, значение без переменной — нет
			assert.deepStrictEqual(
				vrunner.getActiveEnvOverrideArgs(),
				['--ibconnection', '/F./build/feature-RS-123']
			);
			// чтение опций профиля тоже возвращает подставленное значение
			assert.strictEqual(vrunner.readActiveProfileSettingSync('ibconnection'), '/F./build/feature-RS-123');
			assert.strictEqual(await vrunner.getActiveIbConnectionValue(), '/F./build/feature-RS-123');
			assert.strictEqual(await vrunner.getActiveV8Version(), '8.3.27');
		});
	});

	test('переключение ветки подхватывается следующим вызовом, без перезагрузки', async () => {
		const root = makeProject();
		writeHead(root, 'ref: refs/heads/dev\n');
		writeJson(root, 'env.json', { default: { '--ibconnection': '/F./build/${gitBranch}' } });

		await vrunner.runWithProjectRoot(root, async () => {
			assert.deepStrictEqual(vrunner.getActiveEnvOverrideArgs(), ['--ibconnection', '/F./build/dev']);

			writeHead(root, 'ref: refs/heads/hotfix/x\n');
			assert.deepStrictEqual(vrunner.getActiveEnvOverrideArgs(), ['--ibconnection', '/F./build/hotfix-x']);

			// отсоединённый HEAD — первые 8 символов хэша
			writeHead(root, 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n');
			assert.deepStrictEqual(vrunner.getActiveEnvOverrideArgs(), ['--ibconnection', '/F./build/a1b2c3d4']);
		});
	});

	test('env.local.json перекрывает профиль и читается на лету', async () => {
		const root = makeProject();
		writeHead(root, 'ref: refs/heads/main\n');
		writeJson(root, 'env.json', { default: { '--ibconnection': '/F./build/${gitBranch}' } });
		writeJson(root, LOCAL_OVERRIDES_FILE, { '--ibconnection': '/F./build/local-${gitBranch}', '--db-user': 'admin' });

		await vrunner.runWithProjectRoot(root, async () => {
			assert.strictEqual(vrunner.hasLocalEnvOverrides(), true);
			// приоритет env.local.json над профилем, переменная работает и в нём
			assert.deepStrictEqual(
				vrunner.getActiveEnvOverrideArgs(),
				['--ibconnection', '/F./build/local-main', '--db-user', 'admin']
			);

			// правка файла (git-хук) действует сразу
			writeJson(root, LOCAL_OVERRIDES_FILE, { '--db-user': 'ci' });
			assert.deepStrictEqual(
				vrunner.getActiveEnvOverrideArgs(),
				['--ibconnection', '/F./build/main', '--db-user', 'ci']
			);

			// удаление файла возвращает чистый профиль
			fs.rmSync(path.join(root, LOCAL_OVERRIDES_FILE));
			assert.strictEqual(vrunner.hasLocalEnvOverrides(), false);
			assert.deepStrictEqual(vrunner.getActiveEnvOverrideArgs(), ['--ibconnection', '/F./build/main']);
		});
	});

	test('профиль без переменных не дублируется флагами', async () => {
		const root = makeProject();
		writeHead(root, 'ref: refs/heads/main\n');
		writeJson(root, 'env.json', { default: { '--ibconnection': '/F./build/ib', '--v8version': '8.3.27' } });

		await vrunner.runWithProjectRoot(root, async () => {
			assert.deepStrictEqual(vrunner.getActiveEnvOverrideArgs(), []);
			assert.strictEqual(vrunner.getEffectiveEnvOverrides(), undefined);
		});
	});

	test('env.local.json не появляется в списке профилей', async () => {
		const root = makeProject();
		writeJson(root, 'env.json', { default: {} });
		writeJson(root, 'env.dev.json', { default: {} });
		writeJson(root, LOCAL_OVERRIDES_FILE, { '--db-user': 'admin' });

		await vrunner.runWithProjectRoot(root, async () => {
			assert.deepStrictEqual(
				vrunner.discoverEnvProfiles().map((profile) => profile.fileName),
				['env.json', 'env.dev.json']
			);
		});
	});

	test('вне репозитория git значение остаётся сырым и команда не падает', async () => {
		const root = makeProject();
		writeJson(root, 'env.json', { default: { '--ibconnection': '/F./build/${gitBranch}' } });

		await vrunner.runWithProjectRoot(root, async () => {
			assert.strictEqual(vrunner.getGitBranchDirName(), undefined);
			assert.deepStrictEqual(
				vrunner.getActiveEnvOverrideArgs(),
				['--ibconnection', '/F./build/${gitBranch}']
			);
			assert.strictEqual(await vrunner.getActiveIbConnectionValue(), '/F./build/${gitBranch}');
		});
	});

	test('битый env.local.json не роняет команды и не даёт флагов', async () => {
		const root = makeProject();
		writeHead(root, 'ref: refs/heads/main\n');
		writeJson(root, 'env.json', { default: { '--ibconnection': '/F./build/ib' } });
		fs.writeFileSync(path.join(root, LOCAL_OVERRIDES_FILE), '{ не json', 'utf8');

		await vrunner.runWithProjectRoot(root, async () => {
			assert.strictEqual(vrunner.hasLocalEnvOverrides(), false);
			assert.deepStrictEqual(vrunner.getActiveEnvOverrideArgs(), []);
		});
	});
});
