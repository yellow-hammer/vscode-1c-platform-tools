/**
 * Просмотр управляемой формы: дерево элементов, данные формы и схематичное превью.
 *
 * Содержимое `Ext/Form.xml` читает md-sparrow (`cf-form-content-get`), расширение разбором XML
 * не занимается.
 *
 * @module formViewerPanel
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsMutation, runMdSparrowParamsRead } from './mdSparrowParams';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import { logger } from '../../shared/logger';
import { ensureBslModuleFile } from './bslModuleFile';
import type {
	PropertyControlKind,
	PropertyGroup,
	PropertyPaletteState,
	PropertyPaletteViewProvider,
	PropertyRow,
} from '../properties/propertyPaletteView';
import { PROPERTY_GROUP_ORDER, enumValueLabel, propertyGroupName, propertyLabel } from './formItemPropertySpec';

/** Обработчик события формы или элемента. */
export interface FormEventDto {
	name?: string;
	handler?: string;
	callType?: string;
}

/** Элемент формы с вложенными элементами. */
/** Свойство вида элемента формы из словаря md-sparrow. */
export interface FormItemPropertySpecDto {
	name: string;
	kind: string;
	defaultValue?: string;
	values?: string[];
	/** Свойство записано атрибутом стартового тега: точечная запись его не меняет. */
	attribute?: boolean;
}

/** Словарь: вид элемента формы -> состав его свойств. */
export type FormItemPropertyDictionary = Record<string, FormItemPropertySpecDto[]>;

export interface FormItemDto {
	type?: string;
	name?: string;
	id?: string;
	title?: string;
	dataPath?: string;
	group?: string;
	showTitle?: string;
	titleLocation?: string;
	representation?: string;
	visible?: boolean;
	enabled?: boolean;
	readOnly?: boolean;
	width?: string;
	height?: string;
	horizontalStretch?: string;
	verticalStretch?: string;
	events?: FormEventDto[];
	items?: FormItemDto[];
	/** Свойства, записанные в файле: имя узла XML -> значение. */
	properties?: Record<string, string>;
}

/** Реквизит формы; у реквизита-таблицы заполнены колонки. */
export interface FormAttributeDto {
	name?: string;
	title?: string;
	type?: { types?: string[] };
	main?: boolean;
	columns?: FormAttributeDto[];
}

/** Содержимое формы, как его отдаёт md-sparrow. */
export interface FormContentDto {
	title?: string;
	items?: FormItemDto[];
	attributes?: FormAttributeDto[];
	commands?: { name?: string; title?: string; action?: string }[];
	parameters?: { name?: string; type?: { types?: string[] }; key?: boolean }[];
	events?: FormEventDto[];
}

/** Параметры открытия просмотра формы. */
export interface OpenFormViewerParams {
	/** Файл `Ext/Form.xml`. */
	formXmlFsPath: string;
	/** Модуль формы `Ext/Form/Module.bsl` рядом с содержимым. */
	moduleFsPath: string;
	/** Заголовок вкладки: имя формы с владельцем. */
	title: string;
	cwd: string;
	cfgPath?: string;
	schemaFlag?: string;
	/** Панель «Свойства»: показывает выделенный элемент формы. */
	propertyPalette?: PropertyPaletteViewProvider;
}

const log = logger.scope('metadata');

/** Состав свойств элементов зависит только от версии формата, поэтому читаем его один раз за сеанс. */
const itemPropertyDictionaryCache = new Map<string, FormItemPropertyDictionary>();

async function loadItemPropertyDictionary(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	schema: string,
	cwd: string
): Promise<FormItemPropertyDictionary | undefined> {
	const cached = itemPropertyDictionaryCache.get(schema);
	if (cached) {
		return cached;
	}
	const result = await runMdSparrowParamsRead(runtime, { op: 'cf-form-item-properties', schemaVersion: schema }, { cwd });
	if (result.exitCode !== 0) {
		log.warn(`состав свойств элементов формы недоступен: ${result.stderr.trim() || `код ${result.exitCode}`}`);
		return undefined;
	}
	try {
		const dictionary = JSON.parse(result.stdout.trim()) as FormItemPropertyDictionary;
		itemPropertyDictionaryCache.set(schema, dictionary);
		return dictionary;
	} catch (e) {
		log.warn(`состав свойств элементов формы не разобран: ${e instanceof Error ? e.message : String(e)}`);
		return undefined;
	}
}

const ERR_PREVIEW = 400;

/** Путь к `Ext/Form.xml` формы объекта: `<Объект>/Forms/<Форма>/Ext/Form.xml`. */
export function objectFormXmlPath(objectXmlFsPath: string, objectName: string, formName: string): string {
	return path.join(path.dirname(objectXmlFsPath), objectName, 'Forms', formName, 'Ext', 'Form.xml');
}

/** Путь к `Ext/Form.xml` общей формы: у неё содержимое лежит прямо в каталоге объекта. */
export function commonFormXmlPath(objectXmlFsPath: string, objectName: string): string {
	return path.join(path.dirname(objectXmlFsPath), objectName, 'Ext', 'Form.xml');
}

/** Модуль формы рядом с её содержимым. */
export function formModulePath(formXmlFsPath: string): string {
	return path.join(path.dirname(formXmlFsPath), 'Form', 'Module.bsl');
}

/**
 * Открывает вкладку просмотра формы.
 *
 * @param context Контекст расширения (нужен для ресурсов webview и среды md-sparrow).
 * @param params Пути формы, рабочий каталог и способ определить версию формата.
 */
export async function openFormViewer(
	context: vscode.ExtensionContext,
	params: OpenFormViewerParams
): Promise<void> {
	let schema: string;
	try {
		schema = params.cfgPath
			? await mdSparrowSchemaFlagFromConfigurationXml(params.cfgPath)
			: (params.schemaFlag ?? '');
		if (!schema) {
			throw new Error('Не удалось определить схему XSD для чтения формы.');
		}
	} catch (e) {
		void vscode.window.showErrorMessage((e instanceof Error ? e.message : String(e)).slice(0, ERR_PREVIEW));
		return;
	}

	const runtime = await ensureMdSparrowRuntime(context);
	let content: FormContentDto;
	let dictionary: FormItemPropertyDictionary | undefined;
	try {
		[content, dictionary] = await Promise.all([
			readFormContent(runtime, params.formXmlFsPath, schema, params.cwd),
			loadItemPropertyDictionary(runtime, schema, params.cwd),
		]);
	} catch (e) {
		void vscode.window.showErrorMessage(
			`Не удалось прочитать форму. ${e instanceof Error ? e.message : String(e)}`.slice(0, ERR_PREVIEW)
		);
		return;
	}

	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel('1cFormViewer', params.title, vscode.ViewColumn.Active, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [webviewRoot],
	});

	const paletteOwner = params.formXmlFsPath;

	const showProperties = (item: FormItemDto): void => {
		const specs = dictionary?.[item.type ?? ''] ?? [];
		const itemId = item.id;
		params.propertyPalette?.show(
			paletteOwner,
			formItemProperties(item, dictionary),
			itemId === undefined ? undefined : (edits) => applyEdits(itemId, specs, edits)
		);
	};

	/** Записывает правки палитры и отдаёт свойства элемента из перечитанной формы. */
	const applyEdits = async (
		itemId: string,
		specs: FormItemPropertySpecDto[],
		edits: Record<string, string>
	): Promise<PropertyPaletteState> => {
		const changes = Object.entries(edits).map(([property, value]) => ({
			itemId,
			property,
			// Значение по умолчанию платформа в файл не пишет, поэтому такое свойство убираем из файла.
			value: isDefaultValue(specs, property, value) ? undefined : value,
		}));
		const written = await runMdSparrowParamsMutation(
			runtime,
			{
				op: 'cf-form-item-properties-set',
				formXml: params.formXmlFsPath,
				schemaVersion: schema,
				payloadJson: JSON.stringify(changes),
			},
			{ cwd: params.cwd }
		);
		if (written.exitCode !== 0) {
			throw new Error(written.stderr.trim() || written.stdout.trim() || `код ${written.exitCode}`);
		}
		content = await readFormContent(runtime, params.formXmlFsPath, schema, params.cwd);
		void panel.webview.postMessage({ type: 'content', content });
		return formItemProperties(findItemById(content.items ?? [], itemId) ?? {}, dictionary);
	};

	panel.webview.onDidReceiveMessage(
		async (message: { type?: string; handler?: string; item?: FormItemDto }) => {
			if (message?.type === 'openHandler' || message?.type === 'openModule') {
				await openFormModuleAt(params.moduleFsPath, message.handler, panel.viewColumn);
				return;
			}
			if (message?.type === 'select') {
				if (message.item) {
					showProperties(message.item);
				} else {
					params.propertyPalette?.clear(paletteOwner);
				}
			}
		},
		undefined,
		context.subscriptions
	);
	panel.onDidDispose(() => params.propertyPalette?.clear(paletteOwner), undefined, context.subscriptions);

	try {
		panel.webview.html = await loadFormViewerHtml(panel.webview, context.extensionUri, {
			title: params.title,
			formTitle: content.title ?? '',
			content,
		});
	} catch (e) {
		log.error(`шаблон формы: ${e instanceof Error ? e.message : String(e)}`);
		void vscode.window.showErrorMessage('Не удалось загрузить просмотр формы.');
		panel.dispose();
	}
}

/** Содержимое формы от md-sparrow; ошибка чтения приходит текстом. */
async function readFormContent(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	formXmlFsPath: string,
	schema: string,
	cwd: string
): Promise<FormContentDto> {
	const result = await runMdSparrowParamsRead(
		runtime,
		{ op: 'cf-form-content-get', formXml: formXmlFsPath, schemaVersion: schema },
		{ cwd }
	);
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || `код ${result.exitCode}`);
	}
	try {
		return JSON.parse(result.stdout.trim()) as FormContentDto;
	} catch (e) {
		log.error(`форма: некорректный JSON от md-sparrow: ${e instanceof Error ? e.message : String(e)}`);
		throw new Error('ответ md-sparrow по форме не разобран');
	}
}

/** Элемент формы по идентификатору: он уникален среди элементов формы. */
function findItemById(items: FormItemDto[], itemId: string): FormItemDto | undefined {
	for (const item of items) {
		if (item.id === itemId) {
			return item;
		}
		const nested = findItemById(item.items ?? [], itemId);
		if (nested) {
			return nested;
		}
	}
	return undefined;
}

/** Значение совпало со значением по умолчанию: в файле такого свойства быть не должно. */
function isDefaultValue(specs: FormItemPropertySpecDto[], property: string, value: string): boolean {
	return value === '' || value === (specs.find((spec) => spec.name === property)?.defaultValue ?? '');
}

/** Вид элемента формы по-русски: то же название, что в дереве элементов. */
const ITEM_KIND_LABELS: Record<string, string> = {
	UsualGroup: 'Группа',
	ColumnGroup: 'Группа колонок',
	Pages: 'Страницы',
	Page: 'Страница',
	InputField: 'Поле ввода',
	LabelField: 'Поле надписи',
	LabelDecoration: 'Надпись',
	PictureDecoration: 'Картинка',
	CheckBoxField: 'Поле флажка',
	RadioButtonField: 'Поле переключателя',
	PictureField: 'Поле картинки',
	Table: 'Таблица',
	Button: 'Кнопка',
	ButtonGroup: 'Группа кнопок',
	CommandBar: 'Командная панель',
	AutoCommandBar: 'Командная панель',
	ContextMenu: 'Контекстное меню',
	Popup: 'Подменю',
	ExtendedTooltip: 'Расширенная подсказка',
	SearchStringAddition: 'Строка поиска',
	SearchControlAddition: 'Управление поиском',
	ViewStatusAddition: 'Состояние просмотра',
};

function controlKind(kind: string): PropertyControlKind {
	switch (kind) {
		case 'boolean':
			return 'boolean';
		case 'number':
			return 'number';
		case 'enum':
			return 'select';
		case 'localString':
		case 'formattedString':
			return 'multiline';
		default:
			return 'text';
	}
}

/** Свойства, которые md-sparrow пишет точечно: атрибуты и составные значения он не меняет. */
function editableSpec(spec: FormItemPropertySpecDto): boolean {
	return spec.attribute !== true && spec.kind !== 'complex';
}

/**
 * Свойства элемента формы для панели «Свойства».
 *
 * Состав берём из словаря формата: в файле лежат только изменённые свойства, а показывать нужно
 * весь набор вида элемента - со значениями по умолчанию там, где в файле ничего нет.
 * Без словаря (старая сборка md-sparrow) показываем то, что записано в файле.
 */
export function formItemProperties(item: FormItemDto, dictionary?: FormItemPropertyDictionary): PropertyPaletteState {
	const written = item.properties ?? {};
	const specs: FormItemPropertySpecDto[] = dictionary?.[item.type ?? ''] ??
		Object.keys(written).map((name) => ({ name, kind: 'string' }));

	const byGroup = new Map<string, PropertyRow[]>();
	for (const spec of specs) {
		const value = written[spec.name] ?? spec.defaultValue;
		const row: PropertyRow = {
			key: spec.name,
			label: propertyLabel(spec.name),
			kind: controlKind(spec.kind),
			value: value === '' ? undefined : value,
			readonly: !editableSpec(spec),
			hint: written[spec.name] === undefined ? `${spec.name}, по умолчанию` : spec.name,
			options: spec.values?.map((constant) => ({ value: constant, label: enumValueLabel(spec.name, constant) })),
		};
		const group = propertyGroupName(spec.name);
		byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
	}
	for (const event of item.events ?? []) {
		const row: PropertyRow = {
			key: `event.${event.name}`,
			label: event.name ?? '',
			kind: 'text',
			value: event.handler,
			readonly: true,
			hint: 'Обработчик события',
		};
		byGroup.set('События', [...(byGroup.get('События') ?? []), row]);
	}

	const groups: PropertyGroup[] = [];
	for (const name of PROPERTY_GROUP_ORDER) {
		const rows = byGroup.get(name);
		if (rows && rows.length > 0) {
			groups.push({ title: name, rows });
		}
	}
	return {
		title: item.name || ITEM_KIND_LABELS[item.type ?? ''] || 'Элемент формы',
		subtitle: ITEM_KIND_LABELS[item.type ?? ''] ?? item.type,
		groups,
	};
}

/**
 * Открывает модуль формы соседней вкладкой и ставит курсор на процедуру-обработчик.
 * Модуля может не быть на диске: конфигуратор заводит его по факту файла, поэтому создаём пустой.
 */
async function openFormModuleAt(
	moduleFsPath: string,
	handler?: string,
	column?: vscode.ViewColumn
): Promise<void> {
	try {
		await ensureBslModuleFile(moduleFsPath);
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(moduleFsPath));
		const editor = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: column });
		if (!handler) {
			return;
		}
		const line = findHandlerLine(doc.getText(), handler);
		if (line >= 0) {
			const position = new vscode.Position(line, 0);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
		}
	} catch {
		void vscode.window.showWarningMessage(`Не удалось открыть модуль формы: ${path.basename(moduleFsPath)}`);
	}
}

/** Номер строки объявления процедуры или функции обработчика (-1, если не нашли). */
export function findHandlerLine(moduleText: string, handler: string): number {
	const lines = moduleText.split(/\r?\n/);
	const declaration = new RegExp(`^\\s*(Процедура|Функция|Procedure|Function)\\s+${escapeRegExp(handler)}\\s*\\(`, 'i');
	return lines.findIndex((line) => declaration.test(line));
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

interface FormViewerViewModel {
	title: string;
	formTitle: string;
	content: FormContentDto;
}

async function loadFormViewerHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	viewModel: FormViewerViewModel
): Promise<string> {
	const templatePath = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'form-viewer.html');
	const template = await fs.readFile(templatePath.fsPath, 'utf8');
	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'form-viewer.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'form-viewer.js'));
	const nonce = createNonce();
	const initialJson = JSON.stringify(viewModel).replaceAll('<', String.raw`<`);
	return template
		.replaceAll('{{CSP_SOURCE}}', webview.cspSource)
		.replaceAll('{{NONCE}}', nonce)
		.replaceAll('{{CSS_URI}}', cssUri.toString())
		.replaceAll('{{JS_URI}}', jsUri.toString())
		.replaceAll('{{INITIAL_JSON}}', initialJson)
		.replaceAll('{{FORM_TITLE}}', escapeHtml(viewModel.formTitle || viewModel.title));
}

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i += 1) {
		nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return nonce;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
