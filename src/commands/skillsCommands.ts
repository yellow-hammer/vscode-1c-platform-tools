import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../logger';

const CC_1C_SKILLS_ZIP_URL =
	'https://github.com/Nikolay-Shirokov/cc-1c-skills/archive/refs/heads/main.zip';
const CC_1C_SKILLS_ARCHIVE_ROOT = 'cc-1c-skills-main';
const CC_1C_SKILLS_SOURCE_SUBDIR = '.claude/skills';

const DESTINATION_OPTIONS = [
	{ id: 'cursor', label: 'Для Cursor', folder: '.cursor/skills' },
	{ id: 'copilot', label: 'Для GitHub Copilot', folder: '.github/copilot/skills' },
	{ id: 'claude', label: 'Для Claude Code', folder: '.claude/skills' },
	{ id: 'custom', label: 'Указать папку…', folder: '' }
] as const;

const ONE_CPT_SKILL_IDS = [
	'1c-platform-tools',
	'1c-platform-tools-configuration',
	'1c-platform-tools-extensions',
	'1c-platform-tools-infobase',
	'1c-platform-tools-external',
	'1c-platform-tools-run',
	'1c-platform-tools-test',
	'1c-platform-tools-dependencies',
	'1c-platform-tools-support',
	'1c-platform-tools-setversion',
	'1c-platform-tools-config',
	'1c-platform-tools-mcp'
] as const;

async function pickDestination(workspaceRoot: string | undefined): Promise<string | null> {
	const destChoice = await vscode.window.showQuickPick(
		DESTINATION_OPTIONS.map((o) => ({
			...o,
			description: workspaceRoot ? path.join(workspaceRoot, o.folder) : undefined
		})),
		{
			title: 'Куда установить навыки?',
			placeHolder: workspaceRoot
				? 'Выберите папку (относительно корня проекта)'
				: 'Нет открытой папки — выберите «Указать папку»',
			ignoreFocusOut: true
		}
	);
	if (!destChoice) {
		return null;
	}
	if (destChoice.id === 'custom') {
		const selected = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectMany: false,
			title: 'Выберите папку для навыков',
			openLabel: 'Выбрать папку'
		});
		if (!selected?.length) {
			return null;
		}
		return selected[0].fsPath;
	}
	if (workspaceRoot) {
		return path.join(workspaceRoot, destChoice.folder);
	}
	vscode.window.showWarningMessage('Откройте папку проекта или выберите «Указать папку»');
	return null;
}

/**
 * Скачивает архив по URL и возвращает путь к временному файлу.
 */
async function downloadToTemp(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}
	const buffer = await response.arrayBuffer();
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), '1cpt-skills-'));
	const zipPath = path.join(tmpDir, 'archive.zip');
	await fs.writeFile(zipPath, new Uint8Array(buffer));
	return zipPath;
}

/**
 * Распаковывает ZIP во временную папку. Возвращает путь к папке с распакованным содержимым.
 */
async function extractZip(zipPath: string): Promise<string> {
	const extractDir = path.join(path.dirname(zipPath), 'extracted');
	await fs.mkdir(extractDir, { recursive: true });
	if (process.platform === 'win32') {
		execSync(
			`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}' -Force"`,
			{ stdio: 'pipe' }
		);
	} else {
		execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });
	}
	return extractDir;
}

/**
 * Копирует содержимое папки sourceDir (все подпапки и файлы) в targetDir.
 */
async function copyContents(sourceDir: string, targetDir: string): Promise<void> {
	await fs.mkdir(targetDir, { recursive: true });
	const entries = await fs.readdir(sourceDir, { withFileTypes: true });
	for (const entry of entries) {
		const src = path.join(sourceDir, entry.name);
		const dest = path.join(targetDir, entry.name);
		await fs.cp(src, dest, { recursive: true });
	}
}

export class SkillsCommands {
	/**
	 * Добавляет навыки разработки 1С (cc-1c-skills) из GitHub: XML, формы, роли, СКД, метаданные, EPF/ERF и т.д.
	 * Скачивает архив репозитория, распаковывает и копирует содержимое .claude/skills в выбранную папку.
	 */
	async addDevSkills(context: vscode.ExtensionContext): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const targetDir = await pickDestination(workspaceRoot);
		if (!targetDir) {
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Навыки разработки 1С (cc-1c-skills)',
				cancellable: false
			},
			async () => {
				let zipPath: string | null = null;
				try {
					zipPath = await downloadToTemp(CC_1C_SKILLS_ZIP_URL);
					const extractDir = await extractZip(zipPath);
					const sourceSkillsPath = path.join(
						extractDir,
						CC_1C_SKILLS_ARCHIVE_ROOT,
						CC_1C_SKILLS_SOURCE_SUBDIR
					);
					try {
						await fs.access(sourceSkillsPath);
					} catch {
						throw new Error(
							`В архиве не найдена папка ${CC_1C_SKILLS_ARCHIVE_ROOT}/${CC_1C_SKILLS_SOURCE_SUBDIR}`
						);
					}
					await copyContents(sourceSkillsPath, targetDir);
					logger.info(`Навыки разработки 1С (cc-1c-skills) установлены в ${targetDir}`);
					vscode.window.showInformationMessage(
						'Навыки разработки 1С (cc-1c-skills) установлены (источник: GitHub, MIT). Агент сможет использовать инструкции по XML, формам, ролям, СКД, метаданным и др.'
					);
				} catch (error) {
					const errMsg = error instanceof Error ? error.message : String(error);
					logger.error(`Не удалось установить навыки разработки 1С (cc-1c-skills): ${errMsg}`);
					vscode.window.showErrorMessage(
						`Не удалось установить навыки разработки 1С (cc-1c-skills): ${errMsg}. Проверьте подключение к интернету и доступ к GitHub.`
					);
				} finally {
					if (zipPath) {
						try {
							await fs.rm(path.dirname(zipPath), { recursive: true, force: true });
						} catch {
							// ignore cleanup errors
						}
					}
				}
			}
		);
	}

	/**
	 * Добавляет все навыки 1c-platform-tools (полный + по доменам) в выбранную папку.
	 * Без выбора домена — копируются все папки из resources/skills.
	 */
	async add1cptSkills(context: vscode.ExtensionContext): Promise<void> {
		const extensionPath = context.extensionPath;
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const targetBaseDir = await pickDestination(workspaceRoot);
		if (!targetBaseDir) {
			return;
		}

		const skillsSourceDir = path.join(extensionPath, 'resources', 'skills');
		let copied = 0;
		for (const skillId of ONE_CPT_SKILL_IDS) {
			const sourceDir = path.join(skillsSourceDir, skillId);
			try {
				await fs.access(path.join(sourceDir, 'SKILL.md'));
			} catch {
				logger.debug(`Пропуск навыка ${skillId}: SKILL.md не найден`);
				continue;
			}
			const targetDir = path.join(targetBaseDir, skillId);
			try {
				await fs.mkdir(path.dirname(targetDir), { recursive: true });
				await fs.cp(sourceDir, targetDir, { recursive: true });
				copied++;
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				logger.error(`Не удалось скопировать навык ${skillId}: ${errMsg}`);
			}
		}
		if (copied > 0) {
			logger.info(`Установлено навыков расширения (команды и MCP): ${copied} в ${targetBaseDir}`);
			vscode.window.showInformationMessage(
				`Установлено навыков расширения (команды и MCP): ${copied}. Агент будет использовать команды расширения и MCP.`
			);
		} else {
			vscode.window.showWarningMessage(
				'Не найдено ни одного шаблона навыка в расширении. Обратитесь к разработчикам.'
			);
		}
	}
}
