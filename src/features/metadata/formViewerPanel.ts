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
import { beginOpenPanel, endOpenPanel, revealOpenPanel, trackOpenPanel } from '../editors/openPanels';

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
	/** Представление значения списка выбора: текст рядом с переключателем и флажком. */
	choicePresentation?: string;
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
	/** Основная таблица динамического списка: по её полям идут пути к данным списка. */
	mainTable?: string;
}

/** Содержимое формы, как его отдаёт md-sparrow. */
export interface FormContentDto {
	title?: string;
	/**
	 * Свойства самой формы, записанные в корне файла: имя узла XML -> значение.
	 *
	 * Положение командной панели, автозаголовок и режим сохранения данных записаны у корня, а не у
	 * элемента, поэтому приходят отдельно от свойств элементов.
	 */
	properties?: Record<string, string>;
	/** Команды, исключённые из состава формы. */
	excludedCommands?: string[];
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

/** Кнопка набора, которым платформа наполняет командную панель. */
export interface StandardCommandDto {
	/** Имя команды без приставки; не задано, если назвать команду не вышло. */
	command?: string;
	/** Подпись, когда команду назвать не вышло; иначе она берётся из словаря подписей. */
	label?: string;
	/** Как платформа рисует кнопку: `Text` или `Picture`. */
	representation?: string;
	/** Кнопка по умолчанию. */
	defaultButton?: boolean;
	/** Кнопка раскрывает подменю. */
	submenu?: boolean;
	/** Кнопка стоит после записанных кнопок панели, а не перед ними. */
	afterOwnButtons?: boolean;
}

/** Что платформа знает про стандартные команды формы: подписи, сторона панели и наборы. */
export interface StandardCommandsDto {
	/** Имя команды без приставки -> подпись, которую ставит платформа. */
	labels?: Record<string, string>;
	/** То же для стандартных команд таблицы: у них своя приставка и свои подписи. */
	tableLabels?: Record<string, string>;
	/** Команды у правого края панели, в том порядке, в каком они там идут. */
	atRight?: string[];
	/** Вид главного реквизита формы -> кнопки, которыми платформа наполнит её панель. */
	autoCommandBar?: Record<string, StandardCommandDto[]>;
	/** Вид данных таблицы -> кнопки, которыми платформа наполнит панель самой таблицы. */
	tableCommandBar?: Record<string, StandardCommandDto[]>;
}

/** Стандартные команды задаёт платформа, а не файл, поэтому читаем их один раз за сеанс. */
let standardCommandCache: StandardCommandsDto | undefined;

/**
 * Стандартные команды формы от md-sparrow.
 *
 * Кнопка без своего заголовка подписана тем, как платформа называет команду, на которую та
 * ссылается, а часть таких кнопок платформа держит у правого края панели. Ни того, ни другого в
 * файле формы нет, поэтому и подписи, и стороны приходят из библиотеки.
 */
async function loadStandardCommands(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	cwd: string
): Promise<StandardCommandsDto> {
	if (standardCommandCache) {
		return standardCommandCache;
	}
	const result = await runMdSparrowParamsRead(runtime, { op: 'cf-form-standard-commands' }, { cwd });
	if (result.exitCode !== 0) {
		log.warn('стандартные команды недоступны: кнопки останутся подписаны именами элементов');
		return {};
	}
	try {
		standardCommandCache = JSON.parse(result.stdout.trim()) as StandardCommandsDto;
		return standardCommandCache;
	} catch (e) {
		log.warn(`стандартные команды не разобраны: ${e instanceof Error ? e.message : String(e)}`);
		return {};
	}
}

const ERR_PREVIEW = 400;

/**
 * Путь к `Ext/Form.xml` формы объекта: `<Объект>/Forms/<Форма>/Ext/Form.xml`.
 *
 * Каталог состава назван по файлу объекта: у внешнего файла каталог артефакта
 * носит имя erf, а объект внутри - своё, поэтому имя узла дерева не годится.
 */
export function objectFormXmlPath(objectXmlFsPath: string, formName: string): string {
	const stem = path.basename(objectXmlFsPath, '.xml');
	return path.join(path.dirname(objectXmlFsPath), stem, 'Forms', formName, 'Ext', 'Form.xml');
}

/**
 * Путь к XML самой формы как объекта метаданных: `<Объект>/Forms/<Форма>.xml`.
 *
 * У формы два файла: этот - свойства формы (имя, синоним, тип), и `Ext/Form.xml`
 * рядом - её содержимое с элементами и реквизитами формы.
 */
export function objectFormDescriptorXmlPath(objectXmlFsPath: string, formName: string): string {
	const stem = path.basename(objectXmlFsPath, '.xml');
	return path.join(path.dirname(objectXmlFsPath), stem, 'Forms', `${formName}.xml`);
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
	if (revealOpenPanel('form', params.formXmlFsPath)) {
		return;
	}
	// Бронь на время чтения: повторный щелчок не открывает копию вкладки
	if (!beginOpenPanel('form', params.formXmlFsPath)) {
		return;
	}
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
		endOpenPanel('form', params.formXmlFsPath);
		return;
	}

	const runtime = await ensureMdSparrowRuntime(context);
	log.info(`форма: открываем ${params.formXmlFsPath}`);
	let content: FormContentDto;
	let dictionary: FormItemPropertyDictionary | undefined;
	try {
		[content, dictionary] = await Promise.all([
			readFormContent(runtime, params.formXmlFsPath, schema, params.cwd),
			loadItemPropertyDictionary(runtime, schema, params.cwd),
		]);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		log.error(`форма: не прочитана ${params.formXmlFsPath}: ${msg}`);
		void vscode.window.showErrorMessage(`Не удалось прочитать форму. ${msg}`.slice(0, ERR_PREVIEW));
		endOpenPanel('form', params.formXmlFsPath);
		return;
	}

	const titles = await loadTitles(runtime, params, schema, content);

	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel('1cFormViewer', params.title, vscode.ViewColumn.Active, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [webviewRoot],
	});
	trackOpenPanel('form', params.formXmlFsPath, panel);
	endOpenPanel('form', params.formXmlFsPath);

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
			layoutDefaults: layoutDefaults(dictionary),
			dataPathTitles: titles.dataPaths,
			dataPathTypes: titles.types,
			commandTitles: titles.commands,
			commandsAtRight: titles.commandsAtRight,
			autoCommandBar: titles.autoCommandBar,
			tableCommandBar: titles.tableCommandBar,
			tableKinds: titles.tableKinds,
			autoCommandBarKnown: titles.autoCommandBarKnown,
		});
	} catch (e) {
		log.error(`шаблон формы: ${e instanceof Error ? e.message : String(e)}`);
		void vscode.window.showErrorMessage('Не удалось загрузить просмотр формы.');
		panel.dispose();
	}
}

/**
 * Подписи кнопок: имя команды -> её синоним.
 *
 * Команда формы подписывается своим заголовком, команда объекта - синонимом из его структуры,
 * а стандартную команду называет сама платформа. Имя команды в кнопке записано ссылкой:
 * `Form.Command.<Имя>`, `<Вид>.<Объект>.Command.<Имя>` или `Form.StandardCommand.<Имя>`.
 *
 * Стандартная команда таблицы идёт через сам элемент - `Form.Item.<Таблица>.StandardCommand.<Имя>` -
 * и подписана иначе, чем одноимённая команда формы. Имя таблицы в ключ не берём: подпись у команды
 * одна на все таблицы, а превью приводит имя команды к тому же виду.
 *
 * @param standardCommands Подписи стандартных команд формы от md-sparrow: в файле формы их нет.
 * @param tableCommands Подписи стандартных команд таблицы оттуда же.
 */
export function commandTitles(
	structure: OwnerStructureDto,
	formCommands: readonly { name?: string; title?: string }[] = [],
	standardCommands: Record<string, string> = {},
	tableCommands: Record<string, string> = {}
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, label] of Object.entries(standardCommands)) {
		out[`Form.StandardCommand.${name}`] = label;
	}
	for (const [name, label] of Object.entries(tableCommands)) {
		out[`Form.Item.StandardCommand.${name}`] = label;
	}
	for (const command of formCommands) {
		if (command.name && command.title) {
			out[`Form.Command.${command.name}`] = command.title;
		}
	}
	for (const [name, synonym] of Object.entries(structure.commandSynonyms ?? {})) {
		out[`Command.${name}`] = synonym;
	}
	return out;
}

/**
 * Имена команд, кнопки которых платформа держит у правого края панели.
 *
 * Своего выравнивания у такой кнопки нет, а умолчание у панели левое: правый край ей задаёт то,
 * что команда стандартная. Набор приходит от md-sparrow, здесь к именам добавляется приставка,
 * с которой они записаны в кнопке.
 */
export function commandsAtRight(standardCommands: StandardCommandsDto = {}): string[] {
	return (standardCommands.atRight ?? []).map((name) => `Form.StandardCommand.${name}`);
}

/**
 * Вид главного реквизита формы: по нему платформа набирает командную панель.
 *
 * Вид объекта-владельца тут ни при чём: форма обработки с главным реквизитом-справочником
 * получает набор справочника. Тип записан ссылкой на конфигурацию: `cfg:CatalogObject.Валюты`.
 */
export function mainAttributeKind(content: FormContentDto): string {
	const type = content.attributes?.find((attribute) => attribute.main)?.type?.types?.[0] ?? '';
	const name = type.startsWith('cfg:') ? type.slice('cfg:'.length) : '';
	const dot = name.indexOf('.');
	return dot < 0 ? name : name.slice(0, dot);
}

/**
 * Чем платформа наполнит командную панель формы.
 *
 * Набор идёт по виду главного реквизита, а команды, которые форма положила своими кнопками,
 * из него выпадают: их платформа второй раз не набирает. Вид без снятого набора остаётся пустым,
 * и превью помечает панель тем, что её наполняет платформа, не называя команд.
 *
 * Справку платформа ставит там, где у объекта записана справочная информация. Объект без неё
 * кнопки не получает, а неизвестный ответ её оставляет: у общей формы объекта-владельца нет.
 * Форма списка справку показывает и без неё: у списка справка идёт не от объекта.
 */
export function autoCommandBarButtons(
	content: FormContentDto,
	standardCommands: StandardCommandsDto = {},
	ownerHasHelp: boolean | undefined = undefined
): StandardCommandDto[] {
	const kind = mainAttributeKind(content);
	const set = standardCommands.autoCommandBar?.[kind] ?? [];
	const placed = placedStandardCommands(content.items ?? []);
	return set
		.filter((button) => !button.command || !placed.has(button.command))
		.filter((button) => button.command !== 'Help' || ownerHasHelp !== false || kind === 'DynamicList');
}

/**
 * Записана ли у объекта-владельца справочная информация.
 *
 * Кнопку справки платформа ставит в командную панель только объекту со справкой; в выгрузке та
 * лежит каталогом `Ext/Help` рядом с объектом. У формы без объекта-владельца ответа нет.
 */
async function ownerHasHelp(objectXml: string | undefined): Promise<boolean | undefined> {
	if (!objectXml) {
		return undefined;
	}
	const help = path.join(objectXml.slice(0, -path.extname(objectXml).length), 'Ext', 'Help');
	try {
		return (await fs.stat(help)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Снят ли набор для этой формы.
 *
 * Набор бывает пустым и у снятого вида: например у обработки без справочной информации в нём не
 * остаётся ни одной кнопки. Превью помечает панель только там, где набор не снят вовсе, поэтому
 * пустой набор и неизвестный вид приходится различать.
 */
export function knowsAutoCommandBar(
	content: FormContentDto,
	standardCommands: StandardCommandsDto = {}
): boolean {
	return Boolean(standardCommands.autoCommandBar?.[mainAttributeKind(content)]);
}

/**
 * Пути к данным, по которым лежат таблицы со своим набором команд.
 *
 * Панель такой таблицы платформа наполняет своим набором, и набор этот идёт по виду данных
 * таблицы, а не по главному реквизиту формы. У динамического списка вид записан типом реквизита
 * формы, у табличной части типа нет вовсе, и её приходится называть здесь: в структуре объекта она
 * лежит своим списком.
 */
export function tableDataKinds(
	structure: OwnerStructureDto,
	mainAttribute: string,
	formAttributes: readonly FormAttributeDto[] = []
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const attribute of formAttributes) {
		if (attribute.name && attribute.type?.types?.[0] === 'cfg:DynamicList') {
			out[attribute.name] = 'DynamicList';
		}
	}
	if (!mainAttribute || !readsOwner(formAttributes.find((attribute) => attribute.name === mainAttribute), structure)) {
		return out;
	}
	for (const section of structure.tabularSections ?? []) {
		if (section.name) {
			out[`${mainAttribute}.${section.name}`] = 'ObjectTablePart';
		}
	}
	return out;
}

/** Стандартные команды, которые форма положила своими кнопками. */
function placedStandardCommands(items: readonly FormItemDto[]): Set<string> {
	const placed = new Set<string>();
	const walk = (nodes: readonly FormItemDto[]) => {
		for (const item of nodes) {
			const command = item.properties?.CommandName ?? '';
			if (command.startsWith('Form.StandardCommand.')) {
				placed.add(command.slice('Form.StandardCommand.'.length));
			}
			walk(item.items ?? []);
		}
	};
	walk(items);
	return placed;
}

/**
 * Подписи полей формы: читает структуру объекта-владельца.
 *
 * Формы без владельца (общие) и объекты, которых md-sparrow не разбирает, просто остаются без
 * подписей: поле подпишется именем элемента, как и раньше.
 */
async function loadTitles(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	params: OpenFormViewerParams,
	schema: string,
	content: FormContentDto
): Promise<{
	dataPaths: Record<string, string>;
	types: Record<string, string[]>;
	commands: Record<string, string>;
	commandsAtRight: string[];
	autoCommandBar: StandardCommandDto[];
	tableCommandBar: Record<string, StandardCommandDto[]>;
	tableKinds: Record<string, string>;
	autoCommandBarKnown: boolean;
}> {
	const objectXml = ownerObjectXmlPath(params.formXmlFsPath);
	const main = content.attributes?.find((attribute) => attribute.main)?.name ?? '';
	const formAttributes = content.attributes ?? [];
	const formCommands = content.commands ?? [];
	let structure: OwnerStructureDto = {};
	if (objectXml) {
		const result = await runMdSparrowParamsRead(
			runtime,
			{ op: 'cf-md-object-structure-get', objectXml, schemaVersion: schema },
			{ cwd: params.cwd }
		);
		if (result.exitCode === 0) {
			try {
				structure = JSON.parse(result.stdout.trim()) as OwnerStructureDto;
			} catch {
				log.warn('форма: структура объекта не разобрана, подписи останутся именами элементов');
			}
		} else {
			log.warn('форма: структура объекта не прочитана, подписи останутся именами элементов');
		}
	}
	const standardCommands = await loadStandardCommands(runtime, params.cwd);
	return {
		dataPaths: dataPathTitles(structure, main, formAttributes),
		types: dataPathTypes(structure, main, formAttributes),
		commands: commandTitles(
			structure,
			formCommands,
			standardCommands.labels ?? {},
			standardCommands.tableLabels ?? {}
		),
		commandsAtRight: commandsAtRight(standardCommands),
		autoCommandBar: autoCommandBarButtons(content, standardCommands, await ownerHasHelp(objectXml)),
		tableCommandBar: standardCommands.tableCommandBar ?? {},
		tableKinds: tableDataKinds(structure, main, formAttributes),
		autoCommandBarKnown: knowsAutoCommandBar(content, standardCommands),
	};
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
	/** Умолчания раскладки по видам элементов: в файле лежит только изменённое. */
	layoutDefaults: LayoutDefaults;
	/** Путь к данным -> синоним реквизита: платформа подписывает поле им. */
	dataPathTitles: Record<string, string>;
	/** Путь к данным объекта -> типы реквизита: по ним платформа даёт полю кнопку выбора. */
	dataPathTypes: Record<string, string[]>;
	/** Имя команды -> её синоним: кнопку без заголовка платформа подписывает им. */
	commandTitles: Record<string, string>;
	/** Имена команд, кнопки которых платформа держит у правого края командной панели. */
	commandsAtRight: string[];
	/** Кнопки, которыми платформа наполнит командную панель самой формы. */
	autoCommandBar: StandardCommandDto[];
	/** Вид данных таблицы -> кнопки, которыми платформа наполнит панель самой таблицы. */
	tableCommandBar: Record<string, StandardCommandDto[]>;
	/** Путь к данным таблицы -> вид её данных: по нему берётся набор панели. */
	tableKinds: Record<string, string>;
	/** Снят ли набор панели формы: пустой набор и неснятый вид рисуются по-разному. */
	autoCommandBarKnown: boolean;
}

/** Реквизит объекта-владельца: имя, синоним и тип значения. */
interface OwnerAttributeDto {
	name?: string;
	synonymRu?: string;
	type?: { types?: string[] };
}

/** Структура объекта-владельца: нужны имена, синонимы и типы реквизитов. */
interface OwnerStructureDto {
	internalName?: string;
	attributes?: OwnerAttributeDto[];
	/** Синонимы полей данных: измерения, ресурсы, признаки учёта. */
	childSynonyms?: Record<string, string>;
	tabularSections?: {
		name?: string;
		synonymRu?: string;
		attributes?: OwnerAttributeDto[];
		standardAttributeSynonyms?: Record<string, string>;
	}[];
	standardAttributeSynonyms?: Record<string, string>;
	commandSynonyms?: Record<string, string>;
}

/** XML объекта, которому принадлежит форма: `<Объект>/Forms/<Имя>/Ext/Form.xml`. */
export function ownerObjectXmlPath(formXmlFsPath: string): string | undefined {
	const parts = formXmlFsPath.split(/[\\/]/);
	const forms = parts.lastIndexOf('Forms');
	if (forms < 1) {
		return undefined;
	}
	return path.join(...parts.slice(0, forms)) + '.xml';
}

/**
 * Подписи полей по пути к данным.
 *
 * Без заголовка платформа подписывает поле синонимом реквизита, а не его именем: у справочника
 * валют `Объект.Code` показывается как «Цифровой код». Синонимы стандартных реквизитов лежат
 * рядом с обычными, поэтому берутся из той же структуры; у табличной части они свои, и колонка
 * по `Объект.<ТЧ>.LineNumber` подписывается ими, а не именем элемента.
 *
 * Колонки динамического списка идут по полям его основной таблицы, поэтому синонимы объекта
 * подходят им, только когда список читает самого владельца формы.
 *
 * @param mainAttribute Имя главного реквизита формы: с него начинается путь к данным объекта.
 */
/**
 * Главный реквизит читает самого владельца формы, а не чужую таблицу.
 *
 * Основная таблица есть только у динамического списка: список над другим объектом подписывать
 * синонимами владельца нельзя, имена полей у них совпадают случайно.
 */
function readsOwner(mainAttribute: FormAttributeDto | undefined, structure: OwnerStructureDto): boolean {
	const table = mainAttribute?.mainTable;
	if (!table) {
		return true;
	}
	return Boolean(structure.internalName) && table.endsWith(`.${structure.internalName}`);
}

export function dataPathTitles(
	structure: OwnerStructureDto,
	mainAttribute: string,
	formAttributes: readonly FormAttributeDto[] = []
): Record<string, string> {
	const out: Record<string, string> = {};
	// Реквизиты самой формы: путь к данным начинается с их имени.
	for (const attribute of formAttributes) {
		if (attribute.name && attribute.title) {
			out[attribute.name] = attribute.title;
		}
		for (const column of attribute.columns ?? []) {
			if (attribute.name && column.name && column.title) {
				out[`${attribute.name}.${column.name}`] = column.title;
			}
		}
	}
	if (!mainAttribute || !readsOwner(formAttributes.find((attribute) => attribute.name === mainAttribute), structure)) {
		return out;
	}
	for (const attribute of structure.attributes ?? []) {
		if (attribute.name && attribute.synonymRu) {
			out[`${mainAttribute}.${attribute.name}`] = attribute.synonymRu;
		}
	}
	for (const [name, synonym] of Object.entries(structure.childSynonyms ?? {})) {
		out[`${mainAttribute}.${name}`] = synonym;
	}
	for (const [name, synonym] of Object.entries(structure.standardAttributeSynonyms ?? {})) {
		out[`${mainAttribute}.${name}`] = synonym;
	}
	for (const section of structure.tabularSections ?? []) {
		if (!section.name) {
			continue;
		}
		if (section.synonymRu) {
			out[`${mainAttribute}.${section.name}`] = section.synonymRu;
		}
		for (const [name, synonym] of Object.entries(section.standardAttributeSynonyms ?? {})) {
			out[`${mainAttribute}.${section.name}.${name}`] = synonym;
		}
		for (const column of section.attributes ?? []) {
			if (column.name && column.synonymRu) {
				out[`${mainAttribute}.${section.name}.${column.name}`] = column.synonymRu;
			}
		}
	}
	return out;
}

/**
 * Типы реквизитов объекта по пути к данным.
 *
 * Кнопку выбора и календарь платформа даёт полю по типу реквизита, а не по его имени. Типы
 * реквизитов самой формы лежат в её содержимом, а типы за путём `Объект.<Реквизит>` приходят
 * только из структуры объекта-владельца.
 *
 * @param mainAttribute Имя главного реквизита формы: с него начинается путь к данным объекта.
 */
export function dataPathTypes(
	structure: OwnerStructureDto,
	mainAttribute: string,
	formAttributes: readonly FormAttributeDto[] = []
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	if (!mainAttribute || !readsOwner(formAttributes.find((attribute) => attribute.name === mainAttribute), structure)) {
		return out;
	}
	for (const attribute of structure.attributes ?? []) {
		if (attribute.name && attribute.type?.types?.length) {
			out[`${mainAttribute}.${attribute.name}`] = attribute.type.types;
		}
	}
	for (const section of structure.tabularSections ?? []) {
		for (const column of section.attributes ?? []) {
			if (section.name && column.name && column.type?.types?.length) {
				out[`${mainAttribute}.${section.name}.${column.name}`] = column.type.types;
			}
		}
	}
	return out;
}

/** Вид элемента -> имя свойства -> значение по умолчанию. */
export type LayoutDefaults = Record<string, Record<string, string>>;

/** Свойства, от которых зависит вид превью; остальные умолчания webview не нужны. */
const LAYOUT_PROPERTIES = [
	'Group',
	'PagesRepresentation',
	'Representation',
	'ShowTitle',
	'TitleLocation',
	// Объединение: у группы со снятым заголовок встаёт слева в строку, а не сверху.
	'United',
	// Выравнивание в группе: по нему подписи и поля соседей встают в общие колонки.
	'ChildrenAlign',
	// Сквозное выравнивание: группы-соседи с ним ставят подписи в одну общую колонку.
	'ThroughAlign',
	// Растяжение: по нему свободное место строки и свободная высота формы достаются элементу.
	'HorizontalStretch',
	'VerticalStretch',
	// Командная панель: кнопка по умолчанию, состав подменю «Еще» и положение панели таблицы.
	'DefaultButton',
	'LocationInCommandBar',
	'Autofill',
	// Источник команд: с ним обычная панель и группа кнопок наполняются стандартными командами.
	'CommandSource',
	'CommandBarLocation',
	// Выравнивание кнопок: у автоматической панели своё свойство, у обычной своё.
	'HorizontalAlign',
	'HorizontalLocation',
	// Служебные части таблицы: строка поиска, состояние просмотра и управление поиском.
	'SearchStringLocation',
	'ViewStatusLocation',
	'SearchControlLocation',
	// Кнопки поля ввода: платформа рисует их справа от поля.
	'ChoiceButton',
	'ChoiceListButton',
	'DropListButton',
	'CreateButton',
	'OpenButton',
	'ClearButton',
	'SpinButton',
];

/**
 * Умолчания раскладки из словаря формата.
 *
 * Платформа пишет в файл только изменённые свойства, поэтому без умолчаний превью раскладывало бы
 * группу без записанной группировки вертикально, а платформа кладёт её элементы в строку.
 */
export function layoutDefaults(dictionary?: FormItemPropertyDictionary): LayoutDefaults {
	const out: LayoutDefaults = {};
	for (const [type, specs] of Object.entries(dictionary ?? {})) {
		const byName: Record<string, string> = {};
		for (const spec of specs) {
			if (LAYOUT_PROPERTIES.includes(spec.name) && spec.defaultValue !== undefined && spec.defaultValue !== '') {
				byName[spec.name] = spec.defaultValue;
			}
		}
		if (Object.keys(byName).length > 0) {
			out[type] = byName;
		}
	}
	return out;
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
