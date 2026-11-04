/**
 * Редактор профиля запуска vanessa-runner (custom editor поверх JSON-файла).
 *
 * Открывает env*.json (2.x) и autumn-properties*.json (3.x) формой: параметры
 * сгруппированы по смыслу (подключение, платформа, ibcmd…), у каждого —
 * описание из vanessa-runner и контрол по типу. Добавление параметров и
 * командных секций — через нативный QuickPick VS Code с поиском по имени и
 * описанию. Файл остаётся источником истины: правки вносятся точечно
 * (jsonc-parser), форма перерисовывается при любом изменении документа.
 */

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { SettingsSchema } from '../../shared/envProfiles';
import { loadEditorSections, EditorSection, OptionGroup, CatalogOption } from './optionsCatalog';
import { chromeStyles, CHROME_LABELS } from '../editors/webviewChrome';
import { fillWebviewTemplate, loadWebviewTemplate } from '../../shared/webviewTemplate';

import { pickerFor } from './valuePickers';

export const PROFILE_EDITOR_VIEW_TYPE = '1c-platform-tools.profileEditor';

/** Заданный в файле параметр секции (для модели формы). */
interface ModelEntry {
	key: string;
	value: unknown;
	type: string;
	description: string;
	default?: unknown;
	enum?: unknown[];
	enumLabels?: Record<string, string>;
	itemsEnum?: unknown[];
	group: string;
	/** Ключ найден в каталоге опций (иначе — нестандартный параметр) */
	known: boolean;
	/** Подпись кнопки подбора значения; без неё параметр только вписывается руками. */
	picker?: string;
}

interface ModelSection {
	id: string;
	label: string;
	isMain: boolean;
	entries: ModelEntry[];
	/** В каталоге есть что добавить в эту секцию */
	canAdd: boolean;
}

interface EditorModel {
	schema: SettingsSchema;
	schemaLabel: string;
	fileName: string;
	error?: string;
	groups: OptionGroup[];
	sections: ModelSection[];
	/** Есть командные секции, доступные к добавлению (3.x и секции 2.x) */
	canAddSection: boolean;
}

type WebviewMessage =
	| { type: 'set'; sectionId: string; key: string; value: unknown }
	| { type: 'remove'; sectionId: string; key: string }
	| { type: 'pick'; sectionId: string; key: string }
	| { type: 'pickAdd'; sectionId: string }
	| { type: 'pickSection' }
	| { type: 'openJson' };

export class ProfileEditorProvider implements vscode.CustomTextEditorProvider {
	constructor(
		private readonly extensionPath: string,
		private readonly extensionUri: vscode.Uri
	) {}

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			PROFILE_EDITOR_VIEW_TYPE,
			new ProfileEditorProvider(context.extensionPath, context.extensionUri),
			{ webviewOptions: { retainContextWhenHidden: true } }
		);
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = await buildHtml(this.extensionUri);

		const postModel = (): void => {
			void webviewPanel.webview.postMessage({ type: 'model', model: this.buildModel(document) });
		};

		const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() === document.uri.toString()) {
				postModel();
			}
		});
		webviewPanel.onDidDispose(() => changeSubscription.dispose());

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			switch (message.type) {
				case 'openJson':
					await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
					return;
				case 'set':
					await this.setValue(document, message.sectionId, message.key, message.value);
					return;
				case 'remove':
					await this.setValue(document, message.sectionId, message.key, undefined);
					return;
				case 'pick':
					await this.pickValue(document, message.sectionId, message.key);
					return;
				case 'pickAdd':
					await this.pickAndAddOption(document, message.sectionId);
					return;
				case 'pickSection':
					await this.pickAndAddSection(document);
					return;
			}
		});

		postModel();
	}

	private sectionsFor(document: vscode.TextDocument): { sections: EditorSection[]; groups: OptionGroup[] } {
		return loadEditorSections(this.extensionPath, detectSchema(document));
	}

	/** Подставляет подобранное значение в параметр; отказ пользователя ничего не меняет. */
	private async pickValue(document: vscode.TextDocument, sectionId: string, key: string): Promise<void> {
		const value = await pickerFor(key)?.pick();
		if (value !== undefined) {
			await this.setValue(document, sectionId, key, value);
		}
	}

	private async setValue(
		document: vscode.TextDocument,
		sectionId: string,
		key: string,
		value: unknown
	): Promise<void> {
		const { sections } = this.sectionsFor(document);
		const section = sections.find((candidate) => candidate.id === sectionId);
		const jsonPath = [...(section?.jsonPath ?? [sectionId]), key];
		const edits = jsonc.modify(document.getText(), jsonPath, value, { formattingOptions: FORMATTING });
		await applyJsoncEdits(document, edits);
	}

	/** Нативный QuickPick: добавить параметр из каталога в секцию. */
	private async pickAndAddOption(document: vscode.TextDocument, sectionId: string): Promise<void> {
		const { sections, groups } = this.sectionsFor(document);
		const section = sections.find((candidate) => candidate.id === sectionId);
		if (!section) {
			return;
		}
		const existing = sectionValues(document, section);
		const addable = section.options.filter((option) => !(option.key in existing));
		if (addable.length === 0) {
			void vscode.window.showInformationMessage('Все параметры этой секции уже заданы.');
			return;
		}

		const groupLabel = new Map(groups.map((group) => [group.id, group.label]));
		const items: (vscode.QuickPickItem & { option?: CatalogOption })[] = [];
		let lastGroup: string | undefined;
		for (const option of addable) {
			if (section.isMain && option.group !== lastGroup) {
				lastGroup = option.group;
				items.push({ label: groupLabel.get(option.group) ?? option.group, kind: vscode.QuickPickItemKind.Separator });
			}
			items.push({
				label: option.key,
				description: option.description.length > 110 ? `${option.description.slice(0, 110)}…` : option.description,
				option,
			});
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: `Добавить параметр - ${section.label}`,
			placeHolder: 'Поиск по имени или описанию…',
			matchOnDescription: true,
		});
		if (!picked?.option) {
			return;
		}
		await this.setValue(document, sectionId, picked.option.key, initialValue(picked.option));
	}

	/** Нативный QuickPick: добавить секцию команды и сразу первый параметр в неё. */
	private async pickAndAddSection(document: vscode.TextDocument): Promise<void> {
		const { sections } = this.sectionsFor(document);
		const commandSections = sections.filter((section) => !section.isMain && section.advertised);
		const picked = await vscode.window.showQuickPick(
			commandSections.map((section) => ({
				label: section.label.replace(/^Команда: /, ''),
				description: `${section.options.length} параметров`,
				detail: section.hint,
				section,
			})),
			{ title: 'Параметры для команды', placeHolder: 'Команда vanessa-runner…' }
		);
		if (!picked) {
			return;
		}
		await this.pickAndAddOption(document, picked.section.id);
	}

	/** Собирает модель формы: заданные значения документа + метаданные каталога. */
	private buildModel(document: vscode.TextDocument): EditorModel {
		const schema = detectSchema(document);
		const fileName = document.uri.path.split('/').pop() ?? document.uri.path;
		const base: EditorModel = {
			schema,
			schemaLabel: schema === 'v3' ? 'vanessa-runner 3 · autumn-properties' : 'vanessa-runner 2 · env.json',
			fileName,
			groups: [],
			sections: [],
			canAddSection: false,
		};

		let root: unknown;
		try {
			root = document.getText().trim() === '' ? {} : jsonc.parse(document.getText());
		} catch {
			root = undefined;
		}
		if (typeof root !== 'object' || root === null || Array.isArray(root)) {
			return { ...base, error: 'Файл не является JSON-объектом - исправьте его в текстовом редакторе.' };
		}

		const { sections, groups } = this.sectionsFor(document);
		base.groups = groups;
		base.canAddSection = sections.some((section) => !section.isMain);

		for (const section of sections) {
			const values = sectionValues(document, section, root);
			const catalogByKey = new Map(section.options.map((option) => [option.key, option]));

			const entries: ModelEntry[] = [];
			for (const [key, value] of Object.entries(values)) {
				// вложенные объекты (подсекции 3.x) редактируются в своих секциях
				if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
					continue;
				}
				const option = catalogByKey.get(key);
				entries.push({
					key,
					value,
					type: option?.type ?? typeOfValue(value),
					description: option?.description ?? 'Нестандартный параметр (нет в каталоге vanessa-runner)',
					default: option?.default,
					enum: option?.enum,
					enumLabels: option?.enumLabels,
					itemsEnum: option?.itemsEnum,
					group: option?.group ?? 'other',
					known: option !== undefined,
					picker: pickerFor(key)?.label,
				});
			}
			entries.sort((a, b) => {
				const orderA = catalogByKey.get(a.key)?.order ?? Number.MAX_SAFE_INTEGER;
				const orderB = catalogByKey.get(b.key)?.order ?? Number.MAX_SAFE_INTEGER;
				return orderA - orderB || a.key.localeCompare(b.key);
			});

			const canAdd = section.options.some((option) => !(option.key in values));
			// командные секции показываем только когда в них что-то задано;
			// добавить новую можно через «Параметры команды…»
			if (!section.isMain && entries.length === 0) {
				continue;
			}
			base.sections.push({ id: section.id, label: section.label, isMain: section.isMain, entries, canAdd });
		}
		return base;
	}
}

const FORMATTING: jsonc.FormattingOptions = { insertSpaces: false, tabSize: 4, eol: '\n' };

/** Начальное значение добавляемого параметра: default каталога или нейтральное по типу. */
function initialValue(option: CatalogOption): unknown {
	if (option.default !== undefined) {
		return option.default;
	}
	switch (option.type) {
		case 'boolean':
			return true;
		case 'array':
			return [];
		case 'number':
		case 'integer':
			return 0;
		default:
			return option.enum?.length ? String(option.enum[0]) : '';
	}
}

/** Значения секции из документа (плоский объект секции). */
function sectionValues(
	document: vscode.TextDocument,
	section: EditorSection,
	parsedRoot?: unknown
): Record<string, unknown> {
	const root = parsedRoot ?? safeParse(document);
	const value = valueAtPath(root, section.jsonPath);
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function safeParse(document: vscode.TextDocument): unknown {
	try {
		return document.getText().trim() === '' ? {} : jsonc.parse(document.getText());
	} catch {
		return {};
	}
}

/** Схема файла: по корневому ключу `vrunner`, затем по имени файла. */
function detectSchema(document: vscode.TextDocument): SettingsSchema {
	const root = safeParse(document);
	if (typeof root === 'object' && root !== null && 'vrunner' in root) {
		return 'v3';
	}
	const fileName = document.uri.path.split('/').pop() ?? '';
	return fileName.startsWith('autumn-properties') ? 'v3' : 'v2';
}

function valueAtPath(root: unknown, jsonPath: string[]): unknown {
	let current: unknown = root;
	for (const segment of jsonPath) {
		if (typeof current !== 'object' || current === null) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function typeOfValue(value: unknown): string {
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	if (typeof value === 'number') {
		return 'number';
	}
	if (Array.isArray(value)) {
		return 'array';
	}
	return 'string';
}

async function applyJsoncEdits(document: vscode.TextDocument, edits: jsonc.Edit[]): Promise<void> {
	const workspaceEdit = new vscode.WorkspaceEdit();
	for (const edit of edits) {
		const start = document.positionAt(edit.offset);
		const end = document.positionAt(edit.offset + edit.length);
		workspaceEdit.replace(document.uri, new vscode.Range(start, end), edit.content);
	}
	await vscode.workspace.applyEdit(workspaceEdit);
	await document.save();
}

/** HTML формы: рендер модели в инлайн-скрипте, правки уходят в extension. */
async function buildHtml(extensionUri: vscode.Uri): Promise<string> {
	const nonce = Math.random().toString(36).slice(2);
	const template = await loadWebviewTemplate(extensionUri, 'profile-editor.html');
	return fillWebviewTemplate(template, {
		NONCE: nonce,
		CHROME_STYLES: chromeStyles(),
		ADD_LABEL: CHROME_LABELS.add,
		JSON_LABEL: CHROME_LABELS.json,
	});
}
