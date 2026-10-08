import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../shared/logger';
import { notifyQuiet } from '../shared/notify';
import { currentRoot, workspaceFolderOf } from '../shared/workspaceProjects';

const log = logger.scope('skills');

/** Папка рабочей области текущего проекта: каталоги навыков агента лежат в ней. */
function skillsWorkspaceRoot(): string | undefined {
	const root = currentRoot();
	return root === undefined ? undefined : workspaceFolderOf(root)?.uri.fsPath ?? root;
}

const CC_1C_SKILLS_ZIP_URL =
	'https://github.com/Nikolay-Shirokov/cc-1c-skills/archive/refs/heads/main.zip';
const CC_1C_SKILLS_ARCHIVE_ROOT = 'cc-1c-skills-main';
const CC_1C_SKILLS_SOURCE_SUBDIR = '.claude/skills';

const DESTINATION_OPTIONS = [
	{ id: 'cursor', label: 'Для Cursor', folder: '.cursor/skills' },
	{ id: 'copilot', label: 'Для GitHub Copilot', folder: '.github/skills' },
	{ id: 'claude', label: 'Для Claude Code', folder: '.claude/skills' },
	{ id: 'custom', label: 'Указать папку…', folder: '' }
] as const;

const AGENT_CATALOGS = {
	onescript: {
		title: 'OneScript',
		zipUrl: 'https://github.com/yellow-hammer/skills-onescript/archive/refs/heads/main.zip',
		archiveRoot: 'skills-onescript-main'
	},
	'vanessa-automation': {
		title: 'Vanessa Automation',
		zipUrl: 'https://github.com/yellow-hammer/skills-vanessa-automation/archive/refs/heads/main.zip',
		archiveRoot: 'skills-vanessa-automation-main'
	},
	yaxunit: {
		title: 'YAxUnit',
		zipUrl: 'https://github.com/yellow-hammer/skills-yaxunit/archive/refs/heads/main.zip',
		archiveRoot: 'skills-yaxunit-main'
	},
	xunit: {
		title: 'xUnit',
		zipUrl: 'https://github.com/yellow-hammer/skills-xunit/archive/refs/heads/main.zip',
		archiveRoot: 'skills-xunit-main'
	}
} as const;

type AgentCatalogId = keyof typeof AGENT_CATALOGS;

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
	'1c-platform-tools-mcp',
	'1c-platform-tools-edt',
	'1c-platform-tools-session',
	'1c-platform-tools-server',
	'1c-platform-tools-tasks',
	'1c-platform-tools-odata',
	'1c-platform-tools-pipelines',
	'1c-platform-tools-debug'
] as const;

/**
 * Разрешает назначение установки навыков без интерактива.
 *
 * @param destination - Идентификатор агента ('claude', 'cursor', 'copilot') или путь к папке
 * @param workspaceRoot - Корень открытого проекта
 * @returns Абсолютный путь к папке навыков, либо null при ошибке (с сообщением)
 */
function resolveDestination(destination: string, workspaceRoot: string | undefined): string | null {
	const known = DESTINATION_OPTIONS.find(
		(option) => option.id !== 'custom' && option.id === destination.trim().toLowerCase()
	);
	if (known) {
		if (!workspaceRoot) {
			vscode.window.showWarningMessage('Откройте папку проекта или укажите путь к папке навыков');
			return null;
		}
		return path.join(workspaceRoot, known.folder);
	}
	if (path.isAbsolute(destination)) {
		return destination;
	}
	if (workspaceRoot) {
		return path.join(workspaceRoot, destination);
	}
	vscode.window.showWarningMessage('Откройте папку проекта или укажите абсолютный путь к папке навыков');
	return null;
}

async function pickFolder(): Promise<string | null> {
	const selected = await vscode.window.showOpenDialog({
		canSelectFolders: true,
		canSelectMany: false,
		title: 'Выберите папку для навыков',
		openLabel: 'Выбрать папку'
	});
	return selected?.[0]?.fsPath ?? null;
}

/** Без открытой папки проекта остаётся только выбор папки вручную. */
async function pickDestination(workspaceRoot: string | undefined): Promise<string | null> {
	if (!workspaceRoot) {
		return pickFolder();
	}
	const destChoice = await vscode.window.showQuickPick(
		DESTINATION_OPTIONS.map((o) => ({
			...o,
			description: path.join(workspaceRoot, o.folder)
		})),
		{
			title: 'Куда установить навыки?',
			placeHolder: 'Выберите папку (относительно корня проекта)',
			ignoreFocusOut: true
		}
	);
	if (!destChoice) {
		return null;
	}
	if (destChoice.id === 'custom') {
		return pickFolder();
	}
	return path.join(workspaceRoot, destChoice.folder);
}

/** Папка навыков для сообщения: внутри проекта относительно его корня. */
function displayDestination(targetDir: string, workspaceRoot: string | undefined): string {
	if (workspaceRoot) {
		const relative = path.relative(workspaceRoot, targetDir);
		if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
			return relative.split(path.sep).join('/');
		}
	}
	return targetDir;
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

function inferAgentFolderPrefix(targetDir: string): string | null {
	const normalizedTargetDir = targetDir.replaceAll('\\', '/').toLowerCase();
	if (/\/\.cursor\/skills(?:\/|$)/.test(normalizedTargetDir)) {
		return '.cursor';
	}
	if (/\/\.github\/(?:copilot\/)?skills(?:\/|$)/.test(normalizedTargetDir)) {
		return '.github';
	}
	if (/\/\.claude\/skills(?:\/|$)/.test(normalizedTargetDir)) {
		return '.claude';
	}
	return null;
}

async function collectSkillMarkdownFiles(sourceDir: string): Promise<string[]> {
	const skillFiles: string[] = [];
	const entries = await fs.readdir(sourceDir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(sourceDir, entry.name);
		if (entry.isDirectory()) {
			const nestedSkillFiles = await collectSkillMarkdownFiles(entryPath);
			skillFiles.push(...nestedSkillFiles);
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
			skillFiles.push(entryPath);
		}
	}
	return skillFiles;
}

function replaceClaudeFolderPrefix(content: string, targetPrefix: string): string {
	const contentWithForwardSlashes = content.replaceAll('.claude/', `${targetPrefix}/`);
	return contentWithForwardSlashes.replaceAll('.claude\\', `${targetPrefix}\\`);
}

async function rewriteSkillPathPrefixes(targetDir: string): Promise<number> {
	const targetPrefix = inferAgentFolderPrefix(targetDir);
	if (!targetPrefix || targetPrefix === '.claude') {
		return 0;
	}

	const skillFiles = await collectSkillMarkdownFiles(targetDir);
	let rewrittenFiles = 0;
	for (const skillFile of skillFiles) {
		const skillContent = await fs.readFile(skillFile, 'utf8');
		const rewrittenContent = replaceClaudeFolderPrefix(skillContent, targetPrefix);
		if (rewrittenContent === skillContent) {
			continue;
		}
		await fs.writeFile(skillFile, rewrittenContent, 'utf8');
		rewrittenFiles++;
	}

	return rewrittenFiles;
}

/** Куда положить правила рядом с выбранной папкой навыков. */
type RuleLayout = 'cursor' | 'claude' | 'copilot' | 'plain';

function rulePlacement(skillsTarget: string): { dir: string; layout: RuleLayout } {
	const normalized = skillsTarget.replaceAll('\\', '/');
	const lower = normalized.toLowerCase();
	const markers: { marker: string; layout: RuleLayout; rulesFolder: string }[] = [
		{ marker: '/.cursor/skills', layout: 'cursor', rulesFolder: '.cursor/rules' },
		{ marker: '/.claude/skills', layout: 'claude', rulesFolder: '.claude/rules' },
		{ marker: '/.github/copilot/skills', layout: 'copilot', rulesFolder: '.github/instructions' },
		{ marker: '/.github/skills', layout: 'copilot', rulesFolder: '.github/instructions' }
	];
	for (const item of markers) {
		const index = lower.lastIndexOf(item.marker);
		if (index < 0) {
			continue;
		}
		const after = lower.charAt(index + item.marker.length);
		if (after !== '' && after !== '/') {
			continue;
		}
		return {
			dir: path.join(normalized.slice(0, index), ...item.rulesFolder.split('/')),
			layout: item.layout
		};
	}
	return { dir: path.join(path.dirname(skillsTarget), 'rules'), layout: 'plain' };
}

function splitRule(content: string): { globs: string; alwaysApply: boolean; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) {
		return { globs: '', alwaysApply: false, body: content };
	}
	let globs = '';
	let alwaysApply = false;
	for (const line of match[1].split(/\r?\n/)) {
		const separator = line.indexOf(':');
		if (separator < 0) {
			continue;
		}
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
		if (key === 'globs') {
			globs = value;
		}
		if (key === 'alwaysApply') {
			alwaysApply = value === 'true';
		}
	}
	return { globs, alwaysApply, body: match[2].replace(/^\r?\n/, '') };
}

/** Пишет правило в формате выбранного агента. Исходник в каталоге — .mdc для Cursor. */
async function writeAgentRule(sourcePath: string, rulesDir: string, layout: RuleLayout): Promise<void> {
	const raw = await fs.readFile(sourcePath, 'utf8');
	const baseName = path.basename(sourcePath, path.extname(sourcePath));
	if (layout === 'cursor' || layout === 'plain') {
		await fs.copyFile(sourcePath, path.join(rulesDir, path.basename(sourcePath)));
		return;
	}
	const rule = splitRule(raw);
	if (layout === 'claude') {
		const header = rule.alwaysApply || !rule.globs ? '' : `---\npaths: "${rule.globs}"\n---\n\n`;
		await fs.writeFile(path.join(rulesDir, `${baseName}.md`), header + rule.body, 'utf8');
		return;
	}
	const applyTo = rule.alwaysApply || !rule.globs ? '**' : rule.globs;
	await fs.writeFile(
		path.join(rulesDir, `${baseName}.instructions.md`),
		`---\napplyTo: "${applyTo}"\n---\n\n${rule.body}`,
		'utf8'
	);
}

export class SkillsCommands {
	/**
	 * Добавляет навыки разработки 1С (cc-1c-skills) из GitHub: XML, формы, роли, СКД, метаданные, EPF/ERF и т.д.
	 * Скачивает архив репозитория, распаковывает и копирует содержимое .claude/skills в выбранную папку.
	 */
	async addDevSkills(context: vscode.ExtensionContext, destination?: string): Promise<void> {
		const workspaceRoot = skillsWorkspaceRoot();
		// строковый аргумент — неинтерактивный вызов (агент, web-сессия agent-клиента)
		const targetDir = destination
			? resolveDestination(destination, workspaceRoot)
			: await pickDestination(workspaceRoot);
		if (!targetDir) {
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Загрузка навыков cc-1c-skills с GitHub, лицензия MIT',
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
					const rewrittenFiles = await rewriteSkillPathPrefixes(targetDir);
					if (rewrittenFiles > 0) {
						log.info(
							`В навыках разработки 1С обновлены префиксы путей для агента: ${rewrittenFiles}`
						);
					}
					notifyQuiet(`Навыки разработки 1С установлены в ${displayDestination(targetDir, workspaceRoot)}`);
				} catch (error) {
					const errMsg = error instanceof Error ? error.message : String(error);
					log.error(`Не удалось установить навыки разработки 1С (cc-1c-skills): ${errMsg}`);
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
	async add1cptSkills(context: vscode.ExtensionContext, destination?: string): Promise<void> {
		const extensionPath = context.extensionPath;
		const workspaceRoot = skillsWorkspaceRoot();
		// строковый аргумент — неинтерактивный вызов (агент, web-сессия agent-клиента)
		const targetBaseDir = destination
			? resolveDestination(destination, workspaceRoot)
			: await pickDestination(workspaceRoot);
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
				log.debug(`Пропуск навыка ${skillId}: SKILL.md не найден`);
				continue;
			}
			const targetDir = path.join(targetBaseDir, skillId);
			try {
				await fs.mkdir(path.dirname(targetDir), { recursive: true });
				await fs.cp(sourceDir, targetDir, { recursive: true });
				copied++;
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				log.error(`Не удалось скопировать навык ${skillId}: ${errMsg}`);
			}
		}
		if (copied > 0) {
			const rewrittenFiles = await rewriteSkillPathPrefixes(targetBaseDir);
			if (rewrittenFiles > 0) {
				log.info(`В навыках расширения обновлены префиксы путей для агента: ${rewrittenFiles}`);
			}
			notifyQuiet(`Установлено навыков расширения в ${displayDestination(targetBaseDir, workspaceRoot)}: ${copied}`);
		} else {
			vscode.window.showWarningMessage(
				'Не найдено ни одного шаблона навыка в расширении. Обратитесь к разработчикам.'
			);
		}
	}

	/** Навыки OneScript, Autumn и Winow и правила в каталог выбранного агента. */
	async addOnescriptSkills(context: vscode.ExtensionContext, destination?: string): Promise<void> {
		return this.addAgentCatalog(context, 'onescript', destination);
	}

	/** Навыки и правила Vanessa Automation. */
	async addVanessaAutomationSkills(context: vscode.ExtensionContext, destination?: string): Promise<void> {
		return this.addAgentCatalog(context, 'vanessa-automation', destination);
	}

	/** Навыки и правила YAxUnit. Движок тестов эта команда не ставит. */
	async addYaxunitSkills(context: vscode.ExtensionContext, destination?: string): Promise<void> {
		return this.addAgentCatalog(context, 'yaxunit', destination);
	}

	/** Навыки и правила xUnit (Vanessa-ADD). */
	async addXunitSkills(context: vscode.ExtensionContext, destination?: string): Promise<void> {
		return this.addAgentCatalog(context, 'xunit', destination);
	}

	private async addAgentCatalog(
		_context: vscode.ExtensionContext,
		catalogId: AgentCatalogId,
		destination?: string
	): Promise<void> {
		const source = AGENT_CATALOGS[catalogId];
		const title = source.title;
		const workspaceRoot = skillsWorkspaceRoot();
		const skillsTarget = destination
			? resolveDestination(destination, workspaceRoot)
			: await pickDestination(workspaceRoot);
		if (!skillsTarget) {
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Загрузка навыков ${title} с GitHub`,
				cancellable: false
			},
			async () => {
				let zipPath: string | null = null;
				try {
					zipPath = await downloadToTemp(source.zipUrl);
					const extractDir = await extractZip(zipPath);
					const catalogDir = path.join(extractDir, source.archiveRoot);
					const skillsSource = path.join(catalogDir, 'skills');
					try {
						await fs.access(skillsSource);
					} catch {
						throw new Error(`В архиве не найдена папка ${source.archiveRoot}/skills`);
					}
					let copied = 0;
					const entries = await fs.readdir(skillsSource, { withFileTypes: true });
					for (const entry of entries) {
						if (!entry.isDirectory()) {
							continue;
						}
						const sourceDir = path.join(skillsSource, entry.name);
						try {
							await fs.access(path.join(sourceDir, 'SKILL.md'));
						} catch {
							continue;
						}
						await fs.cp(sourceDir, path.join(skillsTarget, entry.name), { recursive: true });
						copied++;
					}
					if (copied === 0) {
						throw new Error(`В архиве нет навыков ${title}`);
					}

					const rulesDir = path.join(catalogDir, 'rules');
					const placement = rulePlacement(skillsTarget);
					let rulesCopied = 0;
					try {
						await fs.access(rulesDir);
						const ruleFiles = await fs.readdir(rulesDir);
						await fs.mkdir(placement.dir, { recursive: true });
						for (const fileName of ruleFiles) {
							if (!fileName.toLowerCase().endsWith('.mdc')) {
								continue;
							}
							await writeAgentRule(path.join(rulesDir, fileName), placement.dir, placement.layout);
							rulesCopied++;
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						log.info(`Правила ${title} в архиве не установлены: ${errMsg}`);
					}

					const where = displayDestination(skillsTarget, workspaceRoot);
					const rulesWhere = displayDestination(placement.dir, workspaceRoot);
					notifyQuiet(
						rulesCopied > 0
							? `Навыки ${title} установлены в ${where}, правила — в ${rulesWhere}`
							: `Навыки ${title} установлены в ${where}`
					);
				} catch (error) {
					const errMsg = error instanceof Error ? error.message : String(error);
					log.error(`Не удалось установить навыки ${title}: ${errMsg}`);
					vscode.window.showErrorMessage(
						`Не удалось установить навыки ${title}: ${errMsg}. Проверьте подключение к интернету и доступ к GitHub.`
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
}
