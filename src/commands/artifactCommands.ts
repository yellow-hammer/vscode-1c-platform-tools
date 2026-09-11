/**
 * Команды для артефактов: точечная сборка/разборка.
 * @module artifactCommands
 */

import { CONVENTIONAL_PATHS } from '../shared/projectPaths';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import { resolveExtensionNameFromSrc } from '../features/extensions/extensionNames';
import {
	extensionContaining,
	extensionEntries,
	newExtensionDir,
	NO_PLACE_FOR_EDT_EXTENSION
} from '../features/extensions/extensionRoots';
import { cfeStem, findExtension, type ExtensionScope } from '../features/extensions/extensionSelection';
import { BUILD_SUBDIRS } from '../shared/pathDefaults';
import { isTestPath } from '../shared/projectLayout';
import type { VRunnerIntent } from '../shared/vrunnerCli';

function getRelativePath(uri: vscode.Uri): string {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders?.length) {
		return uri.fsPath;
	}
	return vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/');
}

/**
 * Команды для артефактов (точечная сборка/разборка, запуск тестов)
 */
export class ArtifactCommands extends BaseCommand {

	/**
	 * Относится ли артефакт к тестовым расширениям: исходники под каталогом тестов,
	 * собранные `*.cfe` - в своём каталоге сборки. От этого зависят каталоги по
	 * умолчанию: иначе кнопка увела бы тестовое расширение к расширениям решения.
	 *
	 * @param artifactUri - Файл или каталог артефакта
	 * @returns true, если артефакт лежит в каталогах тестовых расширений
	 */
	private isTestsScopeArtifact(artifactUri: vscode.Uri): boolean {
		const rel = getRelativePath(artifactUri);
		const builtTests = path.join(this.vrunner.getOutPath(), BUILD_SUBDIRS.testsCfe)
			.replaceAll('\\', '/')
			.replace(/^\.?\//, '');
		const workspaceRoot = vscode.workspace.getWorkspaceFolder(artifactUri)?.uri.fsPath;
		return (
			rel === builtTests ||
			rel.startsWith(`${builtTests}/`) ||
			(workspaceRoot !== undefined && isTestPath(workspaceRoot, artifactUri.fsPath))
		);
	}

	private async pickOutputFile(
		defaultDir: string,
		defaultName: string,
		title: string,
		filters: Record<string, string[]>
	): Promise<string | undefined> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return undefined;
		}

		const DEFAULT_LABEL = '$(file-opened) По умолчанию';
		const defaultPath = path.join(defaultDir, defaultName);
		const picked = await vscode.window.showQuickPick(
			[
				{ label: DEFAULT_LABEL, description: defaultPath },
				{ label: '$(file-directory) Выбрать файл...', description: '' },
			],
			{ title, placeHolder: 'Файл для сохранения' }
		);
		if (!picked) {
			return undefined;
		}
		if (picked.label === DEFAULT_LABEL) {
			return defaultPath;
		}

		const defaultUri = vscode.Uri.file(path.join(workspaceRoot, defaultName));
		const fileUri = await vscode.window.showSaveDialog({
			defaultUri,
			title,
			filters,
		});
		return fileUri
			? vscode.workspace.asRelativePath(fileUri, false).replaceAll('\\', '/')
			: undefined;
	}

	/** Собрать конфигурацию из исходников. */
	async buildConfiguration(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}
		const defaultDir = this.vrunner.getOutPath();
		const outFile = await this.pickOutputFile(
			defaultDir,
			'1Cv8.cf',
			'Сохранить конфигурацию',
			{ 'Конфигурация 1С (*.cf)': ['cf'], 'Все файлы': ['*'] }
		);
		if (!outFile) {
			return;
		}
		const srcRel = getRelativePath(artifactUri);
		const intent: VRunnerIntent = { kind: 'cf.build', src: srcRel, out: outFile };
		await this.runPlanned([intent], {
			cwd: workspaceRoot,
			name: `Собрать конфигурацию: ${path.basename(artifactUri.fsPath)}`,
			appendOverrides: false,
		});
	}

	/** Разобрать .cf в исходники. */
	async decompileConfiguration(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}
		const defaultPath = (await this.activeCfPath()) ?? CONVENTIONAL_PATHS.cf;
		const outDir = await this.pickOutputPath(defaultPath, 'Каталог для разборки конфигурации');
		if (!outDir) {
			return;
		}
		const inRel = getRelativePath(artifactUri);
		const intent: VRunnerIntent = { kind: 'cf.decompileFile', file: inRel, out: outDir };
		await this.runPlanned([intent], {
			cwd: workspaceRoot,
			name: `Разобрать конфигурацию: ${path.basename(artifactUri.fsPath)}`,
			appendOverrides: false,
		});
	}

	/** Собрать расширение из исходников. */
	async buildExtension(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}
		const defaultPath = path.join(
			this.vrunner.getOutPath(),
			this.isTestsScopeArtifact(artifactUri) ? BUILD_SUBDIRS.testsCfe : BUILD_SUBDIRS.cfe
		);
		const outPath = await this.pickOutputPath(defaultPath, 'Каталог для сборки расширения');
		if (!outPath) {
			return;
		}
		// Путь внутри расширения раскладки ведёт к самому расширению: файл зовётся
		// по его каталогу, как и у сборки всех расширений
		const root = extensionContaining(extensionEntries(await this.paths(), 'all'), workspaceRoot, artifactUri.fsPath);
		const srcRel = root?.dir ?? getRelativePath(artifactUri);
		const name = root?.folder ?? path.basename(artifactUri.fsPath);
		const outFile = path.join(outPath, `${name}.cfe`);
		const extensionName = root?.name ?? (await resolveExtensionNameFromSrc(artifactUri.fsPath));
		const intent: VRunnerIntent = { kind: 'cfe.buildCfe', src: srcRel, out: outFile, extensionName };
		await this.runPlanned([intent], {
			cwd: workspaceRoot,
			name: `Собрать расширение: ${name}`,
			appendOverrides: false,
		});
	}

	/**
	 * Разобрать .cfe в исходники.
	 *
	 * План зависит от версии vrunner: 2.x не умеет разбирать .cfe напрямую,
	 * поэтому файл сначала загружается в рабочую ИБ и выгружается из неё
	 * (loadext + decompileext по цепочке); 3.x разбирает файл одной командой
	 * `cfe decompile --cfe-file` во временной ИБ, не затрагивая рабочую.
	 *
	 * Файл зовётся по каталогу расширения, поэтому по умолчанию раскладывается в
	 * каталог этого расширения из раскладки под его именем из метаданных; файл
	 * без такого расширения идёт в новый каталог по своему имени. Выбранный
	 * вручную каталог получает подкаталог по имени файла.
	 */
	async decompileExtension(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}
		const scope: ExtensionScope = this.isTestsScopeArtifact(artifactUri) ? 'tests' : 'solution';
		const paths = await this.paths();
		const cfeName = path.basename(artifactUri.fsPath);
		const stem = cfeStem(cfeName);
		const root =
			findExtension(extensionEntries(paths, scope), stem) ?? findExtension(extensionEntries(paths, 'all'), stem);
		const defaultDir = root?.dir ?? newExtensionDir(paths, stem, scope);
		if (defaultDir === undefined) {
			void vscode.window.showErrorMessage(NO_PLACE_FOR_EDT_EXTENSION);
			return;
		}
		const outDir = await this.pickOutputPath(defaultDir, 'Каталог для разборки расширения');
		if (!outDir) {
			return;
		}
		const targetRel = outDir === defaultDir ? defaultDir : path.posix.join(outDir, stem);
		// Имя внутри файла то же, куда бы его ни разложили
		const extensionName =
			root?.name ?? (await resolveExtensionNameFromSrc(path.join(workspaceRoot, targetRel), stem));
		const cfeRel = getRelativePath(artifactUri);
		const targetDir = this.pathForCmd(targetRel);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const intent: VRunnerIntent = {
			kind: 'cfe.decompileCfeFile',
			file: cfeRel,
			extensionName,
			out: targetDir,
			common: ibConnectionParam,
		};
		await this.runPlanned([intent], {
			cwd: workspaceRoot,
			name: `Разобрать расширение: ${cfeName}`,
			appendOverrides: false,
		});
	}

	/** Собрать внешнюю обработку из исходников. */
	async buildProcessor(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}
		const defaultPath = path.join(this.vrunner.getOutPath(), BUILD_SUBDIRS.epf);
		const outDir = await this.pickOutputPath(defaultPath, 'Каталог для сборки обработки');
		if (!outDir) {
			return;
		}
		const srcRel = getRelativePath(artifactUri);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const intent: VRunnerIntent = { kind: 'epf.build', src: srcRel, out: outDir, common: ibConnectionParam };
		await this.runPlanned([intent], {
			cwd: workspaceRoot,
			name: `Собрать обработку: ${path.basename(artifactUri.fsPath)}`,
			appendOverrides: false,
		});
	}

	/** Разобрать .epf в исходники. */
	async decompileProcessor(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}
		const defaultPath = await this.processorsContainer();
		const epfPath = await this.pickOutputPath(defaultPath, 'Каталог для разборки обработки');
		if (!epfPath) {
			return;
		}
		const inRel = getRelativePath(artifactUri);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const intent: VRunnerIntent = { kind: 'epf.decompile', input: inRel, out: epfPath, common: ibConnectionParam };
		await this.runPlanned([intent], {
			cwd: workspaceRoot,
			name: `Разобрать обработку: ${path.basename(artifactUri.fsPath)}`,
			appendOverrides: false,
		});
	}

	/** Собрать внешний отчёт из исходников. */
	async buildReport(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}
		const defaultPath = path.join(this.vrunner.getOutPath(), BUILD_SUBDIRS.erf);
		const outDir = await this.pickOutputPath(defaultPath, 'Каталог для сборки отчёта');
		if (!outDir) {
			return;
		}
		const srcRel = getRelativePath(artifactUri);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const intent: VRunnerIntent = { kind: 'epf.build', src: srcRel, out: outDir, common: ibConnectionParam };
		await this.runPlanned([intent], {
			cwd: workspaceRoot,
			name: `Собрать отчёт: ${path.basename(artifactUri.fsPath)}`,
			appendOverrides: false,
		});
	}

	/** Разобрать .erf в исходники. */
	async decompileReport(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}
		const defaultPath = await this.reportsContainer();
		const erfPath = await this.pickOutputPath(defaultPath, 'Каталог для разборки отчёта');
		if (!erfPath) {
			return;
		}
		const inRel = getRelativePath(artifactUri);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const intent: VRunnerIntent = { kind: 'epf.decompile', input: inRel, out: erfPath, common: ibConnectionParam };
		await this.runPlanned([intent], {
			cwd: workspaceRoot,
			name: `Разобрать отчёт: ${path.basename(artifactUri.fsPath)}`,
			appendOverrides: false,
		});
	}

	/**
	 * Открыть в редакторе. URI уже разрешён: для исходников артефактов — корневой XML, не каталог.
	 */
	async open(artifactUri: vscode.Uri): Promise<void> {
		await vscode.commands.executeCommand('vscode.open', artifactUri);
	}

	/** Удалить артефакт (файл или каталог). */
	async delete(artifactUri: vscode.Uri): Promise<void> {
		const name = path.basename(artifactUri.fsPath);
		const confirm = await vscode.window.showWarningMessage(
			`Удалить «${name}»?`,
			{ modal: true },
			'Удалить'
		);
		if (confirm !== 'Удалить') {
			return;
		}
		await vscode.workspace.fs.delete(artifactUri, { recursive: true });
		await vscode.commands.executeCommand('1c-platform-tools.artifacts.refresh');
	}
}
