/**
 * Команды для артефактов: точечная сборка/разборка, запуск Vanessa.
 * @module artifactCommands
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';

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

	private async pickOutputPath(
		defaultPath: string,
		title: string
	): Promise<string | undefined> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return undefined;
		}

		const DEFAULT_LABEL = '$(folder-opened) По умолчанию';
		const picked = await vscode.window.showQuickPick(
			[
				{ label: DEFAULT_LABEL, description: defaultPath },
				{ label: '$(file-directory) Выбрать каталог...', description: '' },
			],
			{ title, placeHolder: 'Каталог для выходных файлов' }
		);
		if (!picked) {
			return undefined;
		}
		if (picked.label === DEFAULT_LABEL) {
			return defaultPath;
		}

		const uris = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectMany: false,
			defaultUri: vscode.Uri.file(workspaceRoot),
			title,
		});
		return uris?.length
			? vscode.workspace.asRelativePath(uris[0], false).replaceAll('\\', '/')
			: undefined;
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
		const args = this.addIbcmdIfNeeded(['compile', '--src', srcRel, '--out', outFile]);
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Собрать конфигурацию: ${path.basename(artifactUri.fsPath)}`,
		});
	}

	/** Разобрать .cf в исходники. */
	async decompileConfiguration(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		const defaultPath = this.vrunner.getCfPath();
		const outDir = await this.pickOutputPath(defaultPath, 'Каталог для разборки конфигурации');
		if (!outDir) {
			return;
		}
		const inRel = getRelativePath(artifactUri);
		const args = this.addIbcmdIfNeeded(['decompile', '--in', inRel, '--out', outDir]);
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Разобрать конфигурацию: ${path.basename(artifactUri.fsPath)}`,
		});
	}

	/** Собрать расширение из исходников. */
	async buildExtension(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		const defaultPath = path.join(this.vrunner.getOutPath(), 'cfe');
		const outPath = await this.pickOutputPath(defaultPath, 'Каталог для сборки расширения');
		if (!outPath) {
			return;
		}
		const srcRel = getRelativePath(artifactUri);
		const name = path.basename(artifactUri.fsPath);
		const outFile = path.join(outPath, `${name}.cfe`);
		const args = this.addIbcmdIfNeeded(['compileexttocfe', '--src', srcRel, '--out', outFile]);
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Собрать расширение: ${name}`,
		});
	}

	/** Разобрать .cfe в исходники. */
	async decompileExtension(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		const defaultPath = this.vrunner.getCfePath();
		const outDir = await this.pickOutputPath(defaultPath, 'Каталог для разборки расширения');
		if (!outDir) {
			return;
		}
		const extensionName = path.basename(artifactUri.fsPath).replace(/\.cfe$/i, '');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded(['decompileext', extensionName, outDir, ...ibConnectionParam]);
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Разобрать расширение: ${path.basename(artifactUri.fsPath)}`,
		});
	}

	/** Собрать внешнюю обработку из исходников. */
	async buildProcessor(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		const defaultPath = path.join(this.vrunner.getOutPath(), 'epf');
		const outDir = await this.pickOutputPath(defaultPath, 'Каталог для сборки обработки');
		if (!outDir) {
			return;
		}
		const srcRel = getRelativePath(artifactUri);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['compileepf', srcRel, outDir, ...ibConnectionParam];
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Собрать обработку: ${path.basename(artifactUri.fsPath)}`,
		});
	}

	/** Разобрать .epf в исходники. */
	async decompileProcessor(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		const defaultPath = this.vrunner.getEpfPath();
		const epfPath = await this.pickOutputPath(defaultPath, 'Каталог для разборки обработки');
		if (!epfPath) {
			return;
		}
		const inRel = getRelativePath(artifactUri);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['decompileepf', inRel, epfPath, ...ibConnectionParam];
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Разобрать обработку: ${path.basename(artifactUri.fsPath)}`,
		});
	}

	/** Собрать внешний отчёт из исходников. */
	async buildReport(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		const defaultPath = path.join(this.vrunner.getOutPath(), 'erf');
		const outDir = await this.pickOutputPath(defaultPath, 'Каталог для сборки отчёта');
		if (!outDir) {
			return;
		}
		const srcRel = getRelativePath(artifactUri);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['compileepf', srcRel, outDir, ...ibConnectionParam];
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Собрать отчёт: ${path.basename(artifactUri.fsPath)}`,
		});
	}

	/** Разобрать .erf в исходники. */
	async decompileReport(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		const defaultPath = this.vrunner.getErfPath();
		const erfPath = await this.pickOutputPath(defaultPath, 'Каталог для разборки отчёта');
		if (!erfPath) {
			return;
		}
		const inRel = getRelativePath(artifactUri);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['decompileepf', inRel, erfPath, ...ibConnectionParam];
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Разобрать отчёт: ${path.basename(artifactUri.fsPath)}`,
		});
	}

	/** Открыть артефакт в редакторе или проводнике. */
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

	/** Запустить Vanessa-тест (feature-файл или каталог). */
	async runVanessa(artifactUri: vscode.Uri): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		const settingsPath = this.vrunner.getVRunnerInitSettingsPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const targetRel = getRelativePath(artifactUri);
		const args = ['vanessa', '--settings', settingsPath, ...ibConnectionParam, '--path', targetRel];
		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: `Vanessa: ${path.basename(artifactUri.fsPath)}`,
		});
	}
}
