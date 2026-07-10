import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import { logger } from '../shared/logger';
import { readTemplate } from '../features/serviceFiles/templates';
import { SERVICE_FILES, getServiceFileSpec, type ServiceFileSpec } from '../features/serviceFiles/registry';
import { buildEnvJsonWithSections } from '../features/serviceFiles/envJsonBuilder';
import { ENV_DEFAULTS, AUTUMN_DEFAULTS, VRUNNER_DEFAULTS, VRUNNER_INIT_DEFAULTS, HOOKS_DEFAULTS } from '../features/serviceFiles/envDefaults';
import { DEFAULT_PROFILE_ID } from '../shared/envProfiles';

const log = logger.scope('serviceFiles');

/**
 * Команды создания служебных файлов проекта 1С из шаблонов.
 *
 * Источник шаблонов — `resources/templates/`. Файлы не перезатираются: если файл
 * есть — он открывается, если нет — создаётся из шаблона.
 */
export class ServiceFilesCommands extends BaseCommand {
	private refreshTree(): void {
		void vscode.commands.executeCommand('1c-platform-tools.refresh');
	}

	private refreshProfileStatusBar(): void {
		void vscode.commands.executeCommand('1c-platform-tools.env.statusBarRefresh').then(undefined, () => undefined);
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
			} else {
				vscode.window.showInformationMessage(`${spec.relPath} уже существует`);
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
		log.info(`Создан служебный файл ${spec.relPath}`);
		vscode.window.showInformationMessage(`Создан ${spec.relPath}`);
		return true;
	}

	/**
	 * Открывает существующий служебный файл, либо создаёт отсутствующий.
	 * Точка входа для клика по элементу дерева «Служебные файлы».
	 *
	 * @param specId - Идентификатор файла из реестра
	 */
	async ensure(specId: string): Promise<void> {
		// «Профиль запуска» и его конкретные формы обрабатываются до реестра:
		// файл зависит от схемы установленного vanessa-runner.
		if (specId === 'launchProfile') {
			await this.vrunner.getVRunnerVersion();
			if (this.vrunner.getActiveSettingsSchema() === 'v3') {
				await this.ensureAutumnProperties();
			} else {
				await this.ensureEnv();
			}
			return;
		}
		if (specId === 'env') {
			await this.ensureEnv();
			return;
		}
		if (specId === 'autumnProperties') {
			await this.ensureAutumnProperties();
			return;
		}
		const spec = getServiceFileSpec(specId);
		if (!spec) {
			log.warn(`Неизвестный служебный файл: ${specId}`);
			return;
		}
		if (spec.id === 'vrunner' || spec.id === 'vrunnerInit') {
			await this.ensureFromDefaults(spec, spec.id === 'vrunner' ? VRUNNER_DEFAULTS : VRUNNER_INIT_DEFAULTS);
			return;
		}
		if (spec.id === 'hooks') {
			await this.ensureFromDefaults(spec, HOOKS_DEFAULTS);
			return;
		}
		if (await this.createFromSpec(spec, true)) {
			this.refreshTree();
		}
	}

	/**
	 * Открывает файл служебного файла без шаблона, создавая его из кода при отсутствии.
	 *
	 * @param spec - Описание файла
	 * @param defaults - Объект-дефолт для сериализации в JSON
	 */
	private async ensureFromDefaults(spec: ServiceFileSpec, defaults: object): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const fullPath = path.join(workspaceRoot, spec.relPath);
		if (!fsSync.existsSync(fullPath)) {
			await fs.mkdir(path.dirname(fullPath), { recursive: true });
			await fs.writeFile(fullPath, `${JSON.stringify(defaults, null, 4)}\n`, 'utf8');
			log.info(`Создан служебный файл ${spec.relPath}`);
			vscode.window.showInformationMessage(`Создан ${spec.relPath}`);
			this.refreshTree();
		}
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
		await vscode.window.showTextDocument(doc);
	}

	/**
	 * Открывает autumn-properties.json (настройки vanessa-runner 3), либо создаёт его.
	 *
	 * vrunner 3 — другой инструмент с другим форматом настроек: env.json он не
	 * читает, а `autumn-properties.json` подхватывает из корня проекта
	 * автоматически. Файл создаётся из рукописного v3-дефолта. Перенос настроек
	 * из env.json — осознанное действие пользователя официальным инструментом
	 * `tools/migrate26to30.os` из состава vanessa-runner (расширение не тащит
	 * копию логики миграции).
	 */
	private async ensureAutumnProperties(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const relPath = 'autumn-properties.json';
		const fullPath = path.join(workspaceRoot, relPath);
		if (!fsSync.existsSync(fullPath)) {
			await fs.writeFile(fullPath, `${JSON.stringify(AUTUMN_DEFAULTS, null, 4)}\n`, 'utf8');
			log.info(`Создан служебный файл ${relPath} из v3-дефолта`);
			vscode.window.showInformationMessage(
				`Создан ${relPath} (шаблон vanessa-runner 3). Перенести настройки из env.json: oscript tools/migrate26to30.os.`
			);
			this.refreshTree();
		}
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
		await vscode.window.showTextDocument(doc);
	}

	/**
	 * Открывает env.json, либо создаёт его с выбором секций команд (vanessa/xunit/...)
	 */
	private async ensureEnv(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const fullPath = path.join(workspaceRoot, 'env.json');
		if (fsSync.existsSync(fullPath)) {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
			await vscode.window.showTextDocument(doc);
			return;
		}
		if (await this.createEnvWithSections(fullPath)) {
			await this.vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			this.refreshTree();
			this.refreshProfileStatusBar();
		}
	}

	/**
	 * Создаёт файл настроек профиля запуска по схеме установленного vanessa-runner
	 * (без диалогов): env.json для 2.x, autumn-properties.json для 3.x.
	 *
	 * @param workspaceRoot - Корень рабочей области
	 * @returns true, если файл создан
	 */
	private async createLaunchProfileDefault(workspaceRoot: string): Promise<boolean> {
		await this.vrunner.getVRunnerVersion();
		if (this.vrunner.getActiveSettingsSchema() !== 'v3') {
			return this.createEnvDefault(path.join(workspaceRoot, 'env.json'));
		}
		const fullPath = path.join(workspaceRoot, 'autumn-properties.json');
		if (fsSync.existsSync(fullPath)) {
			vscode.window.showInformationMessage('autumn-properties.json уже существует');
			return false;
		}
		await fs.writeFile(fullPath, `${JSON.stringify(AUTUMN_DEFAULTS, null, 4)}\n`, 'utf8');
		log.info('Создан autumn-properties.json');
		vscode.window.showInformationMessage('Создан autumn-properties.json');
		return true;
	}

	/**
	 * Создаёт env.json из канонического дефолта без интерактивного выбора секций.
	 * Используется при пакетном создании рекомендованного набора.
	 *
	 * @param fullPath - Абсолютный путь к создаваемому env.json
	 * @returns true, если файл создан
	 */
	private async createEnvDefault(fullPath: string): Promise<boolean> {
		if (fsSync.existsSync(fullPath)) {
			vscode.window.showInformationMessage('env.json уже существует');
			return false;
		}
		await fs.writeFile(fullPath, `${JSON.stringify(ENV_DEFAULTS, null, 4)}\n`, 'utf8');
		log.info('Создан env.json');
		vscode.window.showInformationMessage('Создан env.json');
		return true;
	}

	/**
	 * Создаёт env.json: базовая секция default + выбранные флажками секции команд
	 *
	 * @param fullPath - Абсолютный путь к создаваемому env.json
	 * @returns true, если файл создан
	 */
	private async createEnvWithSections(fullPath: string): Promise<boolean> {
		const content = await buildEnvJsonWithSections();
		if (content === undefined) {
			return false;
		}
		await fs.writeFile(fullPath, content, 'utf8');
		log.info('Создан env.json');
		vscode.window.showInformationMessage('Создан env.json');
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
	 * Создаёт рекомендованный набор служебных файлов (только отсутствующие)
	 */
	async createRecommendedSet(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		let changed = false;
		let envCreated = false;
		for (const spec of SERVICE_FILES.filter((s) => s.recommended)) {
			let created: boolean;
			if (spec.id === 'launchProfile') {
				created = await this.createLaunchProfileDefault(workspaceRoot);
				envCreated = created || envCreated;
			} else {
				created = await this.createFromSpec(spec, false);
			}
			changed = created || changed;
		}
		if (envCreated) {
			await this.vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			this.refreshProfileStatusBar();
		}
		if (changed) {
			this.refreshTree();
		}
		vscode.window.showInformationMessage('Базовый набор служебных файлов готов.');
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
		const items: FileItem[] = [
			{ label: '$(checklist) Базовый набор', description: '.gitignore + .gitattributes + env.json', action: 'recommended' },
		];
		for (const spec of SERVICE_FILES) {
			const exists = fsSync.existsSync(path.join(workspaceRoot, spec.relPath));
			items.push({
				label: `${exists ? '$(check)' : '$(add)'} ${spec.label}`,
				description: spec.description,
				action: spec.id,
			});
		}
		const picked = await vscode.window.showQuickPick(items, {
			title: 'Служебные файлы 1С',
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
}
