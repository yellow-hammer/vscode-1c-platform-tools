import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ArtifactCommands } from '../../commands/artifactCommands';
import { runWithProject } from '../../shared/workspaceProjects';
import { VRunnerManager } from '../../shared/vrunnerManager';
import type { VRunnerIntent } from '../../shared/vrunnerCli';

suite('разборка из дерева метаданных', () => {
	for (const selection of ['default', 'file', 'cancel'] as const) {
		test(`разборка после выбора файла без отдельного подтверждения (${selection})`, async () => {
			const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-decompile-'));
			const source = path.join(root, 'src', 'cf');
			const build = path.join(root, 'build');
			const runner = VRunnerManager.getInstance();
			const window = vscode.window as {
				showQuickPick: (items: Array<vscode.QuickPickItem>, options: vscode.QuickPickOptions) => Thenable<vscode.QuickPickItem | undefined>;
				showOpenDialog: typeof vscode.window.showOpenDialog;
				showWarningMessage: (message: string) => Thenable<string | undefined>;
			};
			const { showQuickPick, showOpenDialog, showWarningMessage } = window;
			const { getOutPath, getIbConnectionParam, ensureProfileSettingsFile } = runner;
			const launched: VRunnerIntent[] = [];
			let refreshed = 0;

			class TestArtifactCommands extends ArtifactCommands {
				protected override async ensureOscriptAvailable(): Promise<boolean> {
					return true;
				}

				protected override async runPlanned(intents: readonly VRunnerIntent[]): Promise<boolean> {
					launched.push(...intents);
					return true;
				}
			}

			try {
				await fs.mkdir(build);
				await fs.writeFile(path.join(build, '1Cv8.cf'), '');
				runner.getOutPath = () => 'build';
				runner.getIbConnectionParam = async () => [];
				runner.ensureProfileSettingsFile = async () => true;
				window.showQuickPick = async (items, options) => {
					assert.equal(options.title, `Разобрать в «${path.join('src', 'cf')}»`);
					assert.deepEqual(items.map((item) => item.label), ['По умолчанию', 'Выбрать файл...']);
					if (selection === 'cancel') {
						return undefined;
					}
					return items[selection === 'default' ? 0 : 1];
				};
				window.showOpenDialog = async () => {
					assert.equal(selection, 'file');
					return [vscode.Uri.file(path.join(root, 'Выбранный.cf'))];
				};
				window.showWarningMessage = async (message) => assert.fail(message);

				await runWithProject(root, () => new TestArtifactCommands().decompileMetadata(
					{ kind: 'configuration', sourceUri: vscode.Uri.file(source) },
					async () => { refreshed++; }
				));

				assert.deepEqual(launched, selection === 'cancel' ? [] : [{
					kind: 'cf.decompileFile',
					file: selection === 'file' ? 'Выбранный.cf' : 'build/1Cv8.cf',
					out: 'src/cf',
					common: [],
				}]);
				assert.equal(refreshed, selection === 'cancel' ? 0 : 1);
			} finally {
				Object.assign(window, { showQuickPick, showOpenDialog, showWarningMessage });
				Object.assign(runner, { getOutPath, getIbConnectionParam, ensureProfileSettingsFile });
				await fs.rm(root, { recursive: true, force: true });
			}
		});
	}
	test('разборка отчёта vrunner 3 переносит описание и модуль под именем выбранного исходника', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-decompile-erf-'));
		const source = path.join(root, 'src', 'erf', '_ДемоОтчетНоменклатураОперации');
		const descriptor = path.join(source, '_ДемоНоменклатураОперации.xml');
		const binary = path.join(root, 'Выбранный.erf');
		const runner = VRunnerManager.getInstance();
		const window = vscode.window as {
			showQuickPick: (items: vscode.QuickPickItem[]) => Thenable<vscode.QuickPickItem | undefined>;
			showOpenDialog: typeof vscode.window.showOpenDialog;
		};
		const { showQuickPick, showOpenDialog } = window;
		const { getOutPath, getIbConnectionParam, ensureProfileSettingsFile } = runner;
		const xml = '<MetaDataObject><ExternalReport><Properties><Name>_ДемоОтчетНоменклатураОперации</Name></Properties></ExternalReport></MetaDataObject>';
		let refreshed = false;
		let temporary: string | undefined;

		class TestArtifactCommands extends ArtifactCommands {
			protected override async ensureOscriptAvailable(): Promise<boolean> {
				return true;
			}

			protected override async runPlanned([intent]: readonly VRunnerIntent[]): Promise<boolean> {
				assert.equal(intent.kind, 'epf.decompile');
				temporary = path.dirname(path.resolve(root, intent.input));
				const dump = path.resolve(root, intent.out, '_ДемоНоменклатураОперации');
				const platformStem = '_ДемоОтчетНоменклатураОперации';
				const moduleDir = path.join(dump, platformStem, 'Ext');
				await fs.mkdir(moduleDir, { recursive: true });
				await fs.writeFile(path.join(dump, `${platformStem}.xml`), xml);
				await fs.writeFile(path.join(moduleDir, 'ObjectModule.bsl'), '// Новый модуль');
				await fs.writeFile(path.join(dump, 'Служебный.xml'), '<Log/>');
				return true;
			}
		}

		try {
			await fs.mkdir(source, { recursive: true });
			await fs.writeFile(descriptor, 'старое описание');
			await fs.writeFile(path.join(source, 'README.md'), 'Заметка');
			await fs.writeFile(binary, 'erf');
			runner.getOutPath = () => 'build';
			runner.getIbConnectionParam = async () => [];
			runner.ensureProfileSettingsFile = async () => true;
			window.showQuickPick = async (items) => items[0];
			window.showOpenDialog = async () => [vscode.Uri.file(binary)];

			await runWithProject(root, () => new TestArtifactCommands().decompileMetadata(
				{ kind: 'report', sourceUri: vscode.Uri.file(source), descriptor },
				async () => { refreshed = true; }
			));

			assert.equal(await fs.readFile(descriptor, 'utf8'), xml);
			assert.equal(await fs.readFile(path.join(source, '_ДемоНоменклатураОперации', 'Ext', 'ObjectModule.bsl'), 'utf8'), '// Новый модуль');
			assert.deepEqual((await fs.readdir(source)).sort(), [
				'README.md', '_ДемоНоменклатураОперации', '_ДемоНоменклатураОперации.xml',
			].sort());
			assert.ok(refreshed);
			assert.ok(temporary);
			await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
		} finally {
			Object.assign(window, { showQuickPick, showOpenDialog });
			Object.assign(runner, { getOutPath, getIbConnectionParam, ensureProfileSettingsFile });
			await fs.rm(root, { recursive: true, force: true });
		}
	});

});
