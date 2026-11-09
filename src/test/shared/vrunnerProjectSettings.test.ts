import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { DEFAULT_ENV, DEFAULT_PATHS, DEFAULT_VRUNNER } from '../../shared/pathDefaults';
import { DEFAULT_PROFILE_ID } from '../../shared/envProfiles';
import { sameProjectRoot } from '../../shared/workspaceProjects';

type GetConfiguration = typeof vscode.workspace.getConfiguration;

suite('настройки проекта в командах vrunner', () => {
	const vrunner = VRunnerManager.getInstance();
	const workspace = vscode.workspace as unknown as { getConfiguration: GetConfiguration };
	const original = workspace.getConfiguration;
	const root = path.resolve('/w/проект-с-настройками-папки');
	const folderValues: Record<string, string> = {
		'path.out': 'out',
		'vrunner.path.initSettings': 'tools/init.folder.json',
		'env.defaultProfile': 'ci',
	};

	setup(() => {
		workspace.getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope | null) => {
			const config = original(section, scope);
			const folder = scope instanceof vscode.Uri && sameProjectRoot(scope.fsPath, root);
			if (section !== '1c-platform-tools' || !folder) {
				return config;
			}
			return {
				get: (key: string, defaultValue?: unknown) => (key in folderValues ? folderValues[key] : config.get(key, defaultValue)),
				has: (key: string) => config.has(key),
				inspect: (key: string) => config.inspect(key),
				update: config.update.bind(config),
			} as vscode.WorkspaceConfiguration;
		}) as GetConfiguration;
	});

	teardown(() => {
		workspace.getConfiguration = original;
	});

	test('пути сборки, файл инициализации и профиль по умолчанию читаются из папки проекта вызова', async () => {
		const read = () => [vrunner.getOutPath(), vrunner.getDistPath(), vrunner.getVRunnerInitSettingsPath(), vrunner.getActiveEnvProfileId()];

		assert.deepStrictEqual(await vrunner.runWithProjectRoot(root, async () => read()), [
			'out',
			'out/dist',
			'tools/init.folder.json',
			'ci',
		]);
		assert.deepStrictEqual(await vrunner.runWithProjectRoot(path.resolve('/w/другой-проект'), async () => read()), [
			DEFAULT_PATHS.out,
			`${DEFAULT_PATHS.out}/dist`,
			DEFAULT_VRUNNER.initSettingsPath,
			DEFAULT_ENV.defaultProfile || DEFAULT_PROFILE_ID,
		]);
	});
});
