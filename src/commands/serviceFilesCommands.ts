import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import { logger } from '../shared/logger';
import { readTemplate } from '../features/serviceFiles/templates';
import { SERVICE_FILES, getServiceFileSpec, type ServiceFileSpec } from '../features/serviceFiles/registry';
import { ENV_OPTIONAL_SECTIONS, mergeEnvSections } from '../features/serviceFiles/envSections';

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
		const spec = getServiceFileSpec(specId);
		if (!spec) {
			log.warn(`Неизвестный служебный файл: ${specId}`);
			return;
		}
		// env.json создаётся с выбором секций команд (флажки), остальное — копия шаблона
		if (spec.id === 'env') {
			await this.ensureEnv();
			return;
		}
		if (await this.createFromSpec(spec, true)) {
			this.refreshTree();
		}
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
			this.refreshTree();
		}
	}

	/**
	 * Создаёт env.json: базовая секция default + выбранные флажками секции команд
	 *
	 * @param fullPath - Абсолютный путь к создаваемому env.json
	 * @returns true, если файл создан
	 */
	private async createEnvWithSections(fullPath: string): Promise<boolean> {
		const extensionPath = this.vrunner.getExtensionPath();
		let baseObj: Record<string, unknown> = {
			$schema: 'https://raw.githubusercontent.com/vanessa-opensource/vanessa-runner/develop/vanessa-runner-schema.json',
			default: {
				'--ibconnection': '/F./build/ib',
				'--db-user': '',
				'--db-pwd': '',
				'--root': '.',
				'--workspace': '.',
				'--v8version': '8.3',
				'--locale': 'ru',
				'--language': 'ru',
			},
		};
		if (extensionPath) {
			try {
				baseObj = JSON.parse(await readTemplate(extensionPath, 'env.json.template'));
			} catch {
				// нет шаблона/битый JSON — используем встроенный default
			}
		}

		const picked = await vscode.window.showQuickPick(
			ENV_OPTIONAL_SECTIONS.map((option) => ({ label: option.id, description: option.description })),
			{
				canPickMany: true,
				title: 'Секции команд в env.json',
				placeHolder: 'Отметьте нужные секции команд (секция default добавляется всегда)',
				ignoreFocusOut: true,
			}
		);
		if (picked === undefined) {
			return false;
		}

		const obj = mergeEnvSections(baseObj, picked.map((item) => item.label));
		await fs.writeFile(fullPath, `${JSON.stringify(obj, null, 4)}\n`, 'utf8');
		log.info('Создан env.json с секциями: ' + (picked.map((i) => i.label).join(', ') || 'default'));
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
		if (!this.ensureWorkspace()) {
			return;
		}
		let changed = false;
		for (const spec of SERVICE_FILES.filter((s) => s.recommended)) {
			changed = (await this.createFromSpec(spec, false)) || changed;
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
