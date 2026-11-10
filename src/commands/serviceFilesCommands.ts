import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import { logger } from '../shared/logger';
import { readTemplate } from '../features/serviceFiles/templates';
import { serviceFilesFor, getServiceFileSpec, resolveLaunchProfileSpec, serviceFileLabel, type ServiceFileSpec } from '../features/serviceFiles/registry';
import { canRecreateServiceFile, oneScriptLaunchProfileText, recreatePicksParts, recreateServiceFile } from '../features/serviceFiles/recreate';
import { PIPELINES_FILE_REL_PATH } from '../shared/pipelines/pipelineTypes';
import { isPipelineTemplatesNode, serviceRowOf } from '../features/serviceFiles/serviceFilesTree';
import { isOneScriptProject } from '../shared/workspaceProjects';
import { buildEnvJsonWithSections, buildAutumnPropertiesWithSections } from '../features/serviceFiles/envJsonBuilder';
import {
	VRUNNER_DEFAULTS,
	VRUNNER_INIT_DEFAULTS,
	VRUNNER_DEFAULTS_V3,
	VRUNNER_INIT_DEFAULTS_V3,
	HOOKS_DEFAULTS,
	PIPELINES_DEFAULTS,
} from '../features/serviceFiles/envDefaults';
import {
	BASE_AUTUMN_FILE,
	BASE_ENV_FILE,
	DEFAULT_PROFILE_ID,
	baseSettingsFileName,
} from '../shared/envProfiles';
import { notifyQuiet } from '../shared/notify';
import { newEnvironmentText } from '../shared/environments';
import { projectEnvironmentVariables } from '../features/launch/projectEnvironmentVariables';
import { writeBuildFile } from '../features/serviceFiles/buildFile';
import { variantPath, type ServiceFileKind } from '../features/serviceFiles/catalog';
import { isVrunnerFile, writeVrunnerLink } from '../features/serviceFiles/vrunnerLink';

const log = logger.scope('serviceFiles');

/**
 * Команды создания служебных файлов проекта 1С из шаблонов.
 *
 * Источник шаблонов — `resources/templates/`. Файлы не перезатираются: если файл
 * есть — он открывается, если нет — создаётся из шаблона.
 */
export class ServiceFilesCommands extends BaseCommand {
	private refreshTree(): void {
		void vscode.commands.executeCommand('1c-platform-tools.tools.refresh', { silent: true });
	}

	private refreshProfileStatusBar(): void {
		void vscode.commands.executeCommand('1c-platform-tools.env.statusBarRefresh').then(undefined, () => undefined);
	}

	/** Открывает файл текстом. Создание из панели файл не открывает: это делает следующий щелчок. */
	private async openText(fullPath: string, createOnly: boolean): Promise<void> {
		if (createOnly) {
			return;
		}
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
		await vscode.window.showTextDocument(doc);
	}

	/**
	 * Создаёт файл из шаблона, если его ещё нет
	 *
	 * @param spec - Описание файла
	 * @param openExisting - Открыть файл, если он уже существует
	 * @returns true, если файл создан
	 */
	private async createFromSpec(spec: ServiceFileSpec, openExisting: boolean): Promise<boolean> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return false;
		}
		const fullPath = path.join(workspaceRoot, spec.relPath);

		if (fsSync.existsSync(fullPath)) {
			if (openExisting) {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
				await vscode.window.showTextDocument(doc);
			}
			return false;
		}

		if (!spec.templateName) {
			log.warn(`createFromSpec вызван для файла без шаблона: ${spec.id}`);
			return false;
		}

		const extensionPath = this.vrunner.getExtensionPath();
		if (!extensionPath) {
			vscode.window.showErrorMessage('Расширение не активировано, путь к ресурсам недоступен');
			return false;
		}

		let template: string;
		try {
			template = await readTemplate(extensionPath, spec.templateName);
		} catch (error) {
			const errMsg = (error as Error).message;
			log.error(`Не удалось прочитать шаблон ${spec.templateName}: ${errMsg}`);
			vscode.window.showErrorMessage(`Не найден шаблон ${spec.templateName}`);
			return false;
		}

		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, template, 'utf8');
		return true;
	}

	/**
	 * Открывает существующий служебный файл, либо создаёт отсутствующий.
	 * Из панели отсутствующий файл только создаётся: createOnly не открывает редактор.
	 *
	 * @param specId - Идентификатор файла из реестра
	 */
	async ensure(specId: string, nonInteractive = false, createOnly = false): Promise<void> {
		// «Профиль запуска» и его конкретные формы обрабатываются до реестра:
		// файл зависит от схемы установленного vanessa-runner.
		if (specId === 'launchProfile') {
			await this.vrunner.getVRunnerVersion();
			const workspaceRoot = this.ensureWorkspace();
			if (workspaceRoot && isOneScriptProject(workspaceRoot)) {
				await this.ensureOneScriptLaunchProfile(workspaceRoot, createOnly);
				return;
			}
			if (this.vrunner.getActiveSettingsSchema() === 'v3') {
				await this.ensureAutumnProperties(nonInteractive, createOnly);
			} else {
				await this.ensureEnv(nonInteractive, createOnly);
			}
			return;
		}
		if (specId === 'environment' || specId === 'environmentLocal') {
			await this.ensureDotEnv(specId === 'environmentLocal' ? '.env.local' : '.env', createOnly);
			return;
		}
		if (specId === 'env') {
			await this.ensureEnv(nonInteractive);
			return;
		}
		if (specId === 'autumnProperties') {
			await this.ensureAutumnProperties(nonInteractive);
			return;
		}
		const spec = getServiceFileSpec(specId);
		if (!spec) {
			log.warn(`Неизвестный служебный файл: ${specId}`);
			return;
		}
		if (spec.id === 'vrunner' || spec.id === 'vrunnerInit') {
			// Формат файла зависит от установленного vanessa-runner: 2.x — env-формат,
			// 3.x — autumn (каскад vrunner.test.vanessa.*).
			await this.vrunner.getVRunnerVersion();
			const v3 = this.vrunner.getActiveSettingsSchema() === 'v3';
			const defaults = spec.id === 'vrunnerInit'
				? (v3 ? VRUNNER_INIT_DEFAULTS_V3 : VRUNNER_INIT_DEFAULTS)
				: (v3 ? VRUNNER_DEFAULTS_V3 : VRUNNER_DEFAULTS);
			await this.ensureFromDefaults(spec, defaults, createOnly);
			return;
		}
		if (spec.id === 'hooks') {
			await this.ensureFromDefaults(spec, HOOKS_DEFAULTS, createOnly);
			return;
		}
		if (spec.id === 'pipelines') {
			await this.ensureFromDefaults(spec, PIPELINES_DEFAULTS, createOnly);
			return;
		}
		if (await this.createFromSpec(spec, !createOnly)) {
			this.refreshTree();
			notifyQuiet(`Создан ${spec.relPath}`);
		}
	}

	/**
	 * Открывает файл окружения. Если его нет, создаёт с переменными из кода проекта.
	 *
	 * @param relPath - `.env` или личный `.env.local`
	 */
	private async ensureDotEnv(relPath: '.env' | '.env.local', createOnly = false): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const fullPath = path.join(workspaceRoot, relPath);
		if (!fsSync.existsSync(fullPath)) {
			const text = newEnvironmentText(await projectEnvironmentVariables(workspaceRoot));
			await fs.writeFile(fullPath, text, 'utf8');
			log.info(`Создан ${relPath}`);
			notifyQuiet(`Создан ${relPath}`);
		}
		this.refreshTree();
		this.refreshProfileStatusBar();
		await this.openText(fullPath, createOnly);
	}

	/**
	 * Открывает файл служебного файла без шаблона, создавая его из кода при отсутствии.
	 *
	 * @param spec - Описание файла
	 * @param defaults - Объект-дефолт для сериализации в JSON
	 */
	private async ensureFromDefaults(spec: ServiceFileSpec, defaults: object, createOnly = false): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const fullPath = path.join(workspaceRoot, spec.relPath);
		if (!fsSync.existsSync(fullPath)) {
			await fs.mkdir(path.dirname(fullPath), { recursive: true });
			await fs.writeFile(fullPath, `${JSON.stringify(defaults, null, 4)}\n`, 'utf8');
			log.info(`Создан служебный файл ${spec.relPath}`);
			notifyQuiet(`Создан ${spec.relPath}`);
			this.refreshTree();
		}
		await this.openText(fullPath, createOnly);
	}

	/**
	 * Открывает autumn-properties.json (настройки vanessa-runner 3), либо создаёт его.
	 *
	 * vrunner 3 — другой инструмент с другим форматом настроек: env.json он не
	 * читает, а `autumn-properties.json` подхватывает из корня проекта
	 * автоматически. Файл создаётся из рукописного v3-дефолта. Перенос настроек
	 * из env.json пользователь выполняет сам скриптом из пакета vanessa-runner.
	 */
	private async ensureAutumnProperties(nonInteractive = false, createOnly = false): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const fullPath = path.join(workspaceRoot, BASE_AUTUMN_FILE);
		if (fsSync.existsSync(fullPath)) {
			await this.openText(fullPath, createOnly);
			return;
		}
		if (await this.createAutumnWithSections(fullPath, nonInteractive)) {
			await this.vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			this.refreshTree();
			this.refreshProfileStatusBar();
		}
	}

	/**
	 * Создаёт autumn-properties.json: базовые настройки + выбранные флажками
	 * секции команд (vanessa/xunit/syntax-check) в формате vanessa-runner 3.0.
	 *
	 * @param fullPath - Абсолютный путь к создаваемому файлу
	 * @returns true, если файл создан
	 */
	private async createAutumnWithSections(fullPath: string, nonInteractive = false): Promise<boolean> {
		const content = await buildAutumnPropertiesWithSections(nonInteractive);
		if (content === undefined) {
			return false;
		}
		await fs.writeFile(fullPath, content, 'utf8');
		log.info(`Создан ${BASE_AUTUMN_FILE}`);
		notifyQuiet(`Создан ${BASE_AUTUMN_FILE}`);
		return true;
	}

	/**
	 * Открывает env.json, либо создаёт его с выбором секций команд (vanessa/xunit/...)
	 */
	private async ensureEnv(nonInteractive = false, createOnly = false): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const fullPath = path.join(workspaceRoot, BASE_ENV_FILE);
		if (fsSync.existsSync(fullPath)) {
			await this.openText(fullPath, createOnly);
			return;
		}
		if (await this.createEnvWithSections(fullPath, nonInteractive)) {
			await this.vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			this.refreshTree();
			this.refreshProfileStatusBar();
		}
	}

	/**
	 * Профиль приложения на Осени.
	 *
	 * Имя и версия читаются из `packagedef` и записываются в `autumn-properties.json`.
	 *
	 * @param workspaceRoot - Корень проекта
	 */
	private async ensureOneScriptLaunchProfile(workspaceRoot: string, createOnly = false): Promise<void> {
		const fullPath = path.join(workspaceRoot, BASE_AUTUMN_FILE);
		if (!fsSync.existsSync(fullPath)) {
			await fs.writeFile(fullPath, oneScriptLaunchProfileText(workspaceRoot), 'utf8');
			log.info(`Создан ${BASE_AUTUMN_FILE}`);
			await this.vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			this.refreshTree();
			this.refreshProfileStatusBar();
			notifyQuiet(`Создан ${BASE_AUTUMN_FILE}`);
		}
		await this.openText(fullPath, createOnly);
	}

	/**
	 * Создаёт env.json: базовая секция default + выбранные флажками секции команд
	 *
	 * @param fullPath - Абсолютный путь к создаваемому env.json
	 * @returns true, если файл создан
	 */
	private async createEnvWithSections(fullPath: string, nonInteractive = false): Promise<boolean> {
		const content = await buildEnvJsonWithSections(nonInteractive);
		if (content === undefined) {
			return false;
		}
		await fs.writeFile(fullPath, content, 'utf8');
		log.info(`Создан ${BASE_ENV_FILE}`);
		notifyQuiet(`Создан ${BASE_ENV_FILE}`);
		return true;
	}

	/**
	 * Создаёт .gitignore для проекта 1С (если его нет)
	 */
	async createGitignore(): Promise<void> {
		await this.ensure('gitignore');
	}

	/**
	 * Создаёт .gitattributes (если его нет)
	 */
	async createGitattributes(): Promise<void> {
		await this.ensure('gitattributes');
	}

	/**
	 * Создаёт базовый env.json (если его нет)
	 */
	async createEnvJson(): Promise<void> {
		await this.ensure('env');
	}

	/**
	 * Создаёт рекомендованный набор служебных файлов (только отсутствующие).
	 * Профиль пишется со всеми секциями команд.
	 */
	async createRecommendedSet(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const specs = serviceFilesFor(isOneScriptProject(workspaceRoot)).filter((spec) => spec.recommended);
		const profileWanted = specs.some((spec) => spec.id === 'launchProfile');
		let profileName = '';
		let profilePath = '';
		let profileContent: string | undefined;
		if (profileWanted) {
			await this.vrunner.getVRunnerVersion();
			const schema = this.vrunner.getActiveSettingsSchema();
			profileName = baseSettingsFileName(schema);
			profilePath = path.join(workspaceRoot, profileName);
			if (!fsSync.existsSync(profilePath)) {
				profileContent = schema === 'v3'
					? await buildAutumnPropertiesWithSections(true)
					: await buildEnvJsonWithSections(true);
			}
		}
		const created: string[] = [];
		let envCreated = false;
		for (const spec of specs) {
			if (spec.id === 'launchProfile') {
				if (profileContent !== undefined && !fsSync.existsSync(profilePath)) {
					await fs.writeFile(profilePath, profileContent, 'utf8');
					log.info(`Создан ${profileName}`);
					created.push(profileName);
					envCreated = true;
				}
			} else if (await this.createFromSpec(spec, false)) {
				created.push(spec.relPath);
			}
		}
		if (envCreated) {
			await this.vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			this.refreshProfileStatusBar();
		}
		if (created.length > 0) {
			this.refreshTree();
			notifyQuiet(`Базовый набор служебных файлов готов, созданы: ${created.join(', ')}`);
		} else {
			notifyQuiet('Базовый набор служебных файлов уже есть');
		}
	}

	/**
	 * QuickPick выбора служебного файла для создания (с пометкой наличия)
	 */
	async pickAndCreate(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		interface FileItem extends vscode.QuickPickItem {
			action: string;
		}
		// «Осн. профиль запуска» зависит от версии vrunner (env.json / autumn-properties.json)
		await this.vrunner.getVRunnerVersion();
		const schema = this.vrunner.getActiveSettingsSchema();
		const oneScript = isOneScriptProject(workspaceRoot);
		const items: FileItem[] = [
			{
				label: '$(checklist) Базовый набор',
				description: oneScript ? '.gitignore, .gitattributes' : '.gitignore, .gitattributes, профиль запуска',
				action: 'recommended',
			},
		];
		for (const staticSpec of serviceFilesFor(oneScript)) {
			const spec = staticSpec.id === 'launchProfile' ? resolveLaunchProfileSpec(schema, oneScript) : staticSpec;
			const exists = fsSync.existsSync(path.join(workspaceRoot, spec.relPath));
			items.push({
				label: `${exists ? '$(check)' : '$(add)'} ${spec.label}`,
				description: spec.description,
				action: spec.id,
			});
		}
		const picked = await vscode.window.showQuickPick(items, {
			title: 'Служебные файлы',
			placeHolder: 'Выберите служебный файл',
			ignoreFocusOut: true,
		});
		if (!picked) {
			return;
		}
		if (picked.action === 'recommended') {
			await this.createRecommendedSet();
			return;
		}
		await this.ensure(picked.action);
	}

	/**
	 * Записывает в активный профиль ссылку на файл vrunner.
	 *
	 * @param relPath - Путь от корня проекта
	 */
	async linkVrunner(relPath: unknown): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || typeof relPath !== 'string' || !isVrunnerFile(relPath)) {
			return;
		}
		await this.vrunner.getVRunnerVersion();
		const schema = this.vrunner.getActiveSettingsSchema();
		const profilePath = path.join(workspaceRoot, this.vrunner.getActiveEnvFile());
		if (!fsSync.existsSync(profilePath)) {
			void vscode.window.showWarningMessage('Сначала создайте профиль запуска');
			return;
		}
		const current = JSON.parse(await fs.readFile(profilePath, 'utf8')) as unknown;
		const next = writeVrunnerLink(current, schema, relPath);
		await fs.writeFile(profilePath, `${JSON.stringify(next, null, 4)}\n`, 'utf8');
		notifyQuiet(`Выбран ${serviceFileLabel(relPath)}`);
		this.refreshProfileStatusBar();
	}

	/**
	 * Записывает лежащий файл строки заново из шаблона, если человек подтвердил.
	 *
	 * Строка типовых пайплайнов пересоздаёт тот же файл пайплайнов.
	 *
	 * @param element - Строка панели «Служебные файлы»
	 */
	async recreate(element: unknown): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		const relPath = isPipelineTemplatesNode(element) ? PIPELINES_FILE_REL_PATH : serviceRowOf(element)?.relPath;
		if (!workspaceRoot || !relPath) {
			return;
		}
		const oneScript = isOneScriptProject(workspaceRoot);
		if (!canRecreateServiceFile(relPath, oneScript) || !fsSync.existsSync(path.join(workspaceRoot, relPath))) {
			return;
		}
		if (!recreatePicksParts(relPath)) {
			const answer = await vscode.window.showWarningMessage(
				`Пересоздать ${relPath}? Текущее содержимое будет потеряно.`,
				{ modal: true },
				'Пересоздать'
			);
			if (answer !== 'Пересоздать') {
				return;
			}
		}
		try {
			await this.vrunner.getVRunnerVersion();
			const written = await recreateServiceFile(workspaceRoot, relPath, {
				schema: this.vrunner.getActiveSettingsSchema(),
				oneScript,
				extensionPath: this.vrunner.getExtensionPath(),
			});
			if (!written) {
				return;
			}
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			log.error(`Не удалось пересоздать ${relPath}: ${errMsg}`);
			void vscode.window.showErrorMessage(`Не удалось пересоздать ${relPath}: ${errMsg}`);
			return;
		}
		log.info(`Пересоздан ${relPath}`);
		notifyQuiet(`Пересоздан ${relPath}`);
		this.refreshProfileStatusBar();
	}

	/**
	 * Создаёт файл сборки или открывает уже лежащий.
	 *
	 * @param relPath - Путь от корня, например tools/vrunner.ci.json
	 */
	async createBuildFile(relPath: unknown, createOnly = false): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || typeof relPath !== 'string') {
			return;
		}
		const normalized = relPath.replace(/\\/g, '/');
		const known = knownBuildSpec(normalized);
		if (known) {
			await this.ensure(known, false, createOnly);
			return;
		}
		const fullPath = path.join(workspaceRoot, normalized);
		if (!fsSync.existsSync(fullPath)) {
			await this.vrunner.getVRunnerVersion();
			const schema = this.vrunner.getActiveSettingsSchema();
			await writeBuildFile(workspaceRoot, normalized, schema, this.vrunner.getExtensionPath());
			if (!fsSync.existsSync(fullPath)) {
				void vscode.window.showErrorMessage(`Не удалось создать ${normalized}`);
				return;
			}
			notifyQuiet(`Создан ${normalized}`);
			this.refreshTree();
		}
		await this.openText(fullPath, createOnly);
	}

	/**
	 * Спрашивает идентификатор и создаёт tools/<имя>.<id>.json.
	 *
	 * @param kind - Вид файла: vrunner, vanessa, xunit или yaxunit
	 */
	async addVariant(kind: unknown): Promise<void> {
		if (!isVariantKind(kind)) {
			return;
		}
		const pattern = variantPath(kind, 'dev')?.replace('.dev.json', '.<id>.json');
		if (!pattern) {
			return;
		}
		const input = await vscode.window.showInputBox({
			title: 'Новый файл',
			prompt: `Идентификатор, файл ${pattern}`,
			placeHolder: 'dev',
			ignoreFocusOut: true,
			validateInput: (value) => {
				const trimmed = value.trim();
				if (!trimmed) {
					return 'Укажите идентификатор';
				}
				if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
					return 'Допустимы латиница, цифры, точка, дефис и подчёркивание';
				}
				return undefined;
			},
		});
		if (input === undefined) {
			return;
		}
		const relPath = variantPath(kind, input.trim());
		if (relPath) {
			await this.createBuildFile(relPath, true);
		}
	}
}

function isVariantKind(kind: unknown): kind is ServiceFileKind {
	return kind === 'vrunner' || kind === 'vanessa' || kind === 'xunit' || kind === 'yaxunit';
}

function knownBuildSpec(relPath: string): string | undefined {
	switch (relPath) {
		case '.gitignore':
			return 'gitignore';
		case '.gitattributes':
			return 'gitattributes';
		case '.1cpt/hooks.json':
			return 'hooks';
		case '.1cpt/pipelines.json':
			return 'pipelines';
		case 'tools/syntax-check-excludes.txt':
			return 'syntaxExcludes';
		// В имени нет идентификатора, writeBuildFile такие файлы не собирает.
		case 'tools/vrunner.json':
			return 'vrunner';
		case 'tools/vrunner.init.json':
			return 'vrunnerInit';
		case 'tools/VAParams.json':
			return 'vaParams';
		case 'tools/VAParams.init.json':
			return 'vaParamsInit';
		case 'tools/xUnitParams.json':
			return 'xunit';
		case 'tools/yaxunit.json':
			return 'yaxunit';
		default:
			return undefined;
	}
}
