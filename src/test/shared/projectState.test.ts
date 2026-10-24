import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	ACTIVE_ENV_OVERRIDES_STATE,
	ACTIVE_ENV_PROFILE_STATE,
	ACTIVE_ENVIRONMENT_STATE,
	PROJECT_STATE_PREFIX,
	WINDOW_STATE_PREFIX,
	projectMemento,
	projectStateKey,
	readProjectLaunch,
	windowMemento,
} from '../../shared/projectState';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { projectRootKey, runWithProject } from '../../shared/workspaceProjects';

suite('состояние проекта', () => {
	test('ключи разных проектов не пересекаются', async () => {
		const first = projectMemento(path.resolve('/w/первый'));
		const second = projectMemento(path.resolve('/w/второй'));

		await first.update('профиль', 'env.json');

		assert.strictEqual(first.get('профиль'), 'env.json');
		assert.strictEqual(second.get('профиль'), undefined);
		assert.strictEqual(second.get('профиль', 'нет'), 'нет');
		assert.deepStrictEqual(first.keys(), ['профиль']);
		assert.deepStrictEqual(second.keys(), []);

		await first.update('профиль', undefined);
		assert.deepStrictEqual(first.keys(), []);
	});

	test('полный ключ содержит закодированный корень проекта', () => {
		const root = path.resolve('/w/проект');

		assert.strictEqual(projectStateKey(root, 'ключ'), `${PROJECT_STATE_PREFIX}${encodeURIComponent(projectRootKey(root))}:ключ`);
	});

	test('корень с двоеточием не видит ключи соседнего проекта', async () => {
		const short = projectMemento(path.resolve('/w/a'));
		const long = projectMemento(path.resolve('/w/a:b'));

		await long.update('x:ключ', 1);

		assert.deepStrictEqual(short.keys(), []);
		assert.strictEqual(short.get('b:x:ключ'), undefined);
		assert.deepStrictEqual(long.keys(), ['x:ключ']);
	});

	test('на Windows корень с другим регистром даёт тот же ключ', () => {
		const root = path.resolve('/w/Проект');
		const other = process.platform === 'win32' ? root.toUpperCase() : root;

		assert.strictEqual(projectStateKey(other, 'ключ'), projectStateKey(root, 'ключ'));
	});

	test('без корня берётся проект вызова', async () => {
		const root = path.resolve('/w/вызов');
		await projectMemento(root).update('ключ', 1);

		assert.strictEqual(runWithProject(root, () => projectMemento().get('ключ')), 1);
	});

	test('без корня состояние принадлежит окну и хранится в том же workspaceState', async () => {
		const values = new Map<string, unknown>();
		const base = {
			keys: () => [...values.keys()],
			get: (key: string, defaultValue?: unknown) => (values.has(key) ? values.get(key) : defaultValue),
			update: async (key: string, value: unknown) => {
				values.set(key, value);
			},
		} as vscode.Memento;
		const root = path.resolve('/w/окно');

		await windowMemento(base).update(ACTIVE_ENV_PROFILE_STATE, 'dev');
		await projectMemento(root, base).update(ACTIVE_ENV_PROFILE_STATE, 'ci');

		assert.strictEqual(values.get(`${WINDOW_STATE_PREFIX}${ACTIVE_ENV_PROFILE_STATE}`), 'dev');
		assert.strictEqual(windowMemento(base).get(ACTIVE_ENV_PROFILE_STATE), 'dev');
		assert.deepStrictEqual(windowMemento(base).keys(), [ACTIVE_ENV_PROFILE_STATE]);
		assert.strictEqual(projectMemento(root, base).get(ACTIVE_ENV_PROFILE_STATE), 'ci');
		assert.deepStrictEqual(projectMemento(root, base).keys(), [ACTIVE_ENV_PROFILE_STATE]);
	});

	test('профиль и окружение другого проекта читаются без кода запуска, «По умолчанию» не именованный', async () => {
		const root = path.resolve('/w/профили');
		const nothing = { profile: undefined, environment: undefined };

		assert.deepStrictEqual(readProjectLaunch(root), nothing);
		await projectMemento(root).update(ACTIVE_ENV_PROFILE_STATE, 'dev');
		await projectMemento(root).update(ACTIVE_ENVIRONMENT_STATE, 'ci');
		assert.deepStrictEqual(readProjectLaunch(root), { profile: 'dev', environment: 'ci' });
		await projectMemento(root).update(ACTIVE_ENV_PROFILE_STATE, 'default');
		assert.strictEqual(readProjectLaunch(root).profile, undefined);
		assert.deepStrictEqual(readProjectLaunch(path.resolve('/w/другой')), nothing);
	});

	test('профиль и временные параметры, выбранные запуском, принадлежат проекту', async () => {
		const vrunner = VRunnerManager.getInstance();
		const first = path.resolve('/w/запуск-первый');
		const second = path.resolve('/w/запуск-второй');
		const fallback = await vrunner.runWithProjectRoot(second, async () => vrunner.getActiveEnvProfileId());

		await vrunner.runWithProjectRoot(first, async () => {
			await vrunner.setActiveEnvProfileId('env.dev.json');
			await vrunner.setActiveEnvOverrides({ dbUser: 'admin' });
		});

		assert.strictEqual(readProjectLaunch(first).profile, 'env.dev.json');
		assert.strictEqual(readProjectLaunch(second).profile, undefined);
		assert.deepStrictEqual(projectMemento(first).get(ACTIVE_ENV_OVERRIDES_STATE), { dbUser: 'admin' });
		assert.deepStrictEqual(
			await vrunner.runWithProjectRoot(first, async () => [vrunner.getActiveEnvProfileId(), vrunner.hasActiveEnvOverrides()]),
			['env.dev.json', true]
		);
		assert.deepStrictEqual(
			await vrunner.runWithProjectRoot(second, async () => [vrunner.getActiveEnvProfileId(), vrunner.hasActiveEnvOverrides()]),
			[fallback, false]
		);
	});
});
