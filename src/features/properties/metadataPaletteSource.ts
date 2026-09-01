/**
 * Палитра свойств для дерева метаданных: показывает выделенное и пишет правки.
 *
 * Источники разные - объект метаданных, конфигурация или расширение, внешний отчёт и обработка, -
 * а механизм один: спека описывает свойства данными, палитра рисует по ней строки, правки уходят
 * той же set-операцией, что и из панели-вкладки.
 *
 * @module metadataPaletteSource
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	MetadataLeafTreeItem,
	MetadataObjectNodeTreeItem,
	MetadataSourceTreeItem,
	childNodeSupport,
} from '../metadata/metadataTreeView';
import type { MetadataTreeDataProvider } from '../metadata/metadataTreeView';
import type { MetadataEditTabSpec } from '../metadata/metadataObjectEditSpec';
import {
	ensureMdObjectKindLabels,
	mdObjectKindLabel,
	mdObjectKindLabels,
	objectPaletteTabs,
} from '../metadata/metadataObjectPropertiesPanel';
import { ensureMdSparrowRuntime } from '../metadata/mdSparrowBootstrap';
import { runMdSparrowParamsMutation, runMdSparrowParamsRead, type MdSparrowOp } from '../metadata/mdSparrowParams';
import { mdSparrowSchemaFlagFromConfigurationXml } from '../metadata/mdSparrowSchemaVersion';
import { logger } from '../../shared/logger';
import { applyPaletteEdits, paletteGroupsFromSpec } from './propertyPaletteSpec';
import { SOURCE_PROPERTIES_TABS } from './sourcePropertiesSpec';
import { PRIMITIVE_TYPES, applyEnumDictionary, refTypeName } from '../metadata/metadataObjectEditSpec';
import {
	applyChildNodeEdits,
	type ChildNodeDto,
	childNodeDtoList,
	findTabularAttribute,
	childNodeKindLabel,
	childNodeTabs,
	findChildNode,
} from './childNodePropertiesSpec';
import type { PropertyPaletteState, PropertyPaletteViewProvider } from './propertyPaletteView';
import { formDescriptorFileOf, templateDescriptorFileOf } from '../../shared/objectPaths';

const log = logger.scope('metadata');

/** Выделение в дереве меняется на каждое нажатие стрелки: читаем свойства, когда оно устоялось. */
const SELECTION_DEBOUNCE_MS = 200;

const PALETTE_OWNER = 'metadataTree';

/**
 * Прочитанное по файлу: ходьба по составу объекта не должна перечитывать его на каждый узел.
 *
 * Ключ - путь и время правки файла, поэтому запись через палитру или конфигуратор сбрасывает кэш
 * сама собой. Помним один файл: выделение обычно и ходит по одному объекту.
 */
const readCache = new Map<string, Record<string, unknown>>();

/** Свойства и состав объекта - два чтения на файл, плюс запас на соседние узлы дерева. */
const READ_CACHE_LIMIT = 8;

/** Словарь значений перечислений зависит только от версии формата. */
const enumsBySchema = new Map<string, Record<string, unknown>>();

async function fileKey(filePath: string): Promise<string> {
	try {
		return `${filePath}|${(await fs.stat(filePath)).mtimeMs}`;
	} catch {
		return filePath;
	}
}

export interface MetadataPaletteSourceParams {
	context: vscode.ExtensionContext;
	metadataTreeProvider: MetadataTreeDataProvider;
	metadataTreeView: vscode.TreeView<vscode.TreeItem>;
	propertyPaletteProvider: PropertyPaletteViewProvider;
}

/**
 * Палитра читает свойства выделенного объекта.
 * Общую форму не читает: у неё содержимое формы, не {@code cf-md-object-get}.
 */
export function metadataLeafReadsObjectProperties(item: MetadataLeafTreeItem): boolean {
	if (item.objectType === 'ExternalReport' || item.objectType === 'ExternalDataProcessor') {
		return true;
	}
	const tokens = new Set((item.contextValue ?? '').split(/\s+/));
	return tokens.has('metadataObjectProperties') || tokens.has('metadataObjectPropertiesSubsystem');
}

/**
 * Файл описания узла, у которого он свой: у формы и макета в выгрузке конфигуратора.
 *
 * @returns Путь либо {@code undefined}, если свойства узла лежат в объекте
 */
function childOwnXmlPath(item: MetadataObjectNodeTreeItem): string | undefined {
	const owner = item.owner;
	if (!owner.resourceUri) {
		return undefined;
	}
	if (item.nodeKind === 'form') {
		return formDescriptorFileOf(owner.resourceUri.fsPath, item.name);
	}
	if (item.nodeKind === 'template') {
		return templateDescriptorFileOf(owner.resourceUri.fsPath, item.name);
	}
	return undefined;
}

/**
 * Узел состава в свойствах объекта.
 *
 * Реквизит табличной части лежит внутри своей части, у остальных видов свой
 * список верхнего уровня.
 */
function findChildInObject(
	dto: Record<string, unknown>,
	child: { readonly nodeKind: string; readonly name: string; readonly tabularSection?: string }
): ChildNodeDto | undefined {
	// Подписи видов нужны, чтобы тип показывался «Справочник: Валюты», а не cfg:CatalogRef.Валюты
	const kindLabels = mdObjectKindLabels();
	if (child.nodeKind === 'tabularAttribute') {
		return child.tabularSection
			? findTabularAttribute(dto, child.tabularSection, child.name, kindLabels)
			: undefined;
	}
	const list = childNodeDtoList(child.nodeKind);
	return list ? findChildNode(dto, list, child.name, kindLabels) : undefined;
}

/**
 * Кандидаты в тип узла: примитивы платформы и ссылочные типы конфигурации.
 *
 * Вид объекта подписывается словарём библиотеки, поэтому в списке не появляется
 * служебное `cfg:CatalogRef.…`.
 *
 * @param refTypes - Ссылочные типы по видам объектов, как их отдал md-sparrow
 * @returns Значения для списка выбора
 */
function childNodeTypeOptions(
	refTypes: Record<string, unknown>
): { value: string; label: string; hint?: string }[] {
	const kindLabels = mdObjectKindLabels();
	const options = PRIMITIVE_TYPES.map((option) => ({ value: option.value, label: option.label }));
	for (const [objectType, types] of Object.entries(refTypes)) {
		if (!Array.isArray(types)) {
			continue;
		}
		const kind = kindLabels[objectType] ?? objectType;
		for (const type of types) {
			options.push({ value: String(type), label: `${kind}: ${refTypeName(String(type))}` });
		}
	}
	return options;
}

/** Что выделено: чем читать свойства и чем их записывать. */
interface PaletteTarget {
	readonly title: string;
	readonly subtitle: string;
	readonly readOp: MdSparrowOp;
	readonly writeOp: MdSparrowOp;
	/** Поле параметров, в которое идёт путь к файлу. */
	readonly pathField: 'objectXml' | 'configurationXml';
	readonly filePath: string;
	readonly cwd: string;
	/** Configuration.xml, по которому определяется версия формата; иначе берём сам файл. */
	readonly schemaFrom: string;
	/** Вид объекта метаданных: у объектов спека зависит от него. */
	readonly objectType?: string;
	/** Узел состава объекта: реквизит, табличная часть, значение перечисления. */
	readonly child?: { readonly nodeKind: string; readonly name: string; readonly tabularSection?: string };
	/** Объект поставщика без возможности изменения: палитра только показывает. */
	readonly locked?: boolean;
}

function targetFor(item: vscode.TreeItem): PaletteTarget | undefined {
	if (item instanceof MetadataSourceTreeItem) {
		if (!item.configurationXmlAbs || (item.sourceKind !== 'main' && item.sourceKind !== 'extension')) {
			return undefined;
		}
		return {
			title: String(item.label ?? ''),
			subtitle: item.sourceKind === 'main' ? 'Конфигурация' : 'Расширение',
			readOp: 'cf-configuration-properties-get',
			writeOp: 'cf-configuration-properties-set',
			pathField: 'configurationXml',
			filePath: item.configurationXmlAbs,
			cwd: item.metadataRootAbs ?? path.dirname(item.configurationXmlAbs),
			schemaFrom: item.configurationXmlAbs,
		};
	}
	if (item instanceof MetadataObjectNodeTreeItem) {
		const owner = item.owner;
		if (!owner.resourceUri) {
			return undefined;
		}
		// У формы и макета свой файл описания: в составе объекта от них только имя
		const ownXml = childOwnXmlPath(item);
		if (ownXml) {
			return {
				title: item.name,
				subtitle: childNodeKindLabel(item.nodeKind),
				readOp: 'cf-md-object-get',
				writeOp: 'cf-md-object-set',
				pathField: 'objectXml',
				filePath: ownXml,
				cwd: owner.metadataRootAbs ?? path.dirname(owner.resourceUri.fsPath),
				schemaFrom: owner.configurationXmlAbs ?? owner.resourceUri.fsPath,
				objectType: item.nodeKind === 'form' ? 'Form' : 'Template',
				locked: childNodeSupport(owner.support, item.support, true) === 'locked',
			};
		}
		return {
			title: item.name,
			subtitle: childNodeKindLabel(item.nodeKind),
			readOp: 'cf-md-object-get',
			writeOp: 'cf-md-object-set',
			pathField: 'objectXml',
			filePath: owner.resourceUri.fsPath,
			cwd: owner.metadataRootAbs ?? path.dirname(owner.resourceUri.fsPath),
			schemaFrom: owner.configurationXmlAbs ?? owner.resourceUri.fsPath,
			child: { nodeKind: item.nodeKind, name: item.name, tabularSection: item.tabularSectionName },
			locked: childNodeSupport(owner.support, item.support, false) === 'locked',
		};
	}
	if (!(item instanceof MetadataLeafTreeItem) || !item.resourceUri) {
		return undefined;
	}
	if (!metadataLeafReadsObjectProperties(item)) {
		return undefined;
	}
	const filePath = item.resourceUri.fsPath;
	const cwd = item.metadataRootAbs ?? path.dirname(filePath);
	const external = item.objectType === 'ExternalReport' || item.objectType === 'ExternalDataProcessor';
	return {
		title: item.name,
		subtitle: external
			? (item.objectType === 'ExternalReport' ? 'Внешний отчёт' : 'Внешняя обработка')
			: (mdObjectKindLabel(item.objectType) ?? item.objectType),
		readOp: 'cf-md-object-get',
		writeOp: 'cf-md-object-set',
		pathField: 'objectXml',
		filePath,
		cwd,
		schemaFrom: item.configurationXmlAbs ?? filePath,
		objectType: item.objectType,
		locked: item.support === 'locked',
	};
}

/**
 * Подписывает палитру на выделение в дереве метаданных.
 *
 * Свойства читаются, только когда палитра открыта: иначе каждый шаг по дереву дёргал бы md-sparrow
 * впустую. Сама панель не открывается и фокус не забирает.
 */
export function registerMetadataPaletteSource(params: MetadataPaletteSourceParams): vscode.Disposable[] {
	const { context, metadataTreeView, propertyPaletteProvider } = params;
	let timer: NodeJS.Timeout | undefined;
	/** Номер последнего запроса: ответ на устаревшее выделение показывать нельзя. */
	let generation = 0;

	const schedule = (byUser: boolean): void => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => void showSelection(byUser), SELECTION_DEBOUNCE_MS);
	};

	/**
	 * @param byUser Пользователь сам щёлкнул в дереве. Открытие панели таким действием не считается:
	 *   иначе свойства выделенного элемента формы подменились бы объектом из дерева.
	 */
	async function showSelection(byUser: boolean): Promise<void> {
		if (!propertyPaletteProvider.visible) {
			return;
		}
		const foreign = propertyPaletteProvider.owner !== undefined && propertyPaletteProvider.owner !== PALETTE_OWNER;
		if (!byUser && foreign) {
			return;
		}
		const selected = metadataTreeView.selection[0];
		const target = selected ? targetFor(selected) : undefined;
		if (!target) {
			if (!foreign) {
				propertyPaletteProvider.clear(PALETTE_OWNER);
			}
			return;
		}
		const mine = ++generation;
		try {
			const { dto, tabs, schema } = await readProperties(context, target);
			if (mine !== generation) {
				return;
			}
			const shown = state(target, tabs, dto);
			// Панель сохранения незачем показывать там, где править нечего: форма, команда, макет.
			const editable =
				!target.locked && shown.groups.some((group) => group.rows.some((row) => row.readonly !== true));
			propertyPaletteProvider.show(
				PALETTE_OWNER,
				shown,
				editable ? (edits) => writeProperties(context, target, tabs, dto, schema, edits) : undefined,
				editable ? (edits) => previewProperties(context, target, edits) : undefined
			);
		} catch (e) {
			if (mine !== generation) {
				return;
			}
			log.warn(`палитра: свойства не прочитаны: ${e instanceof Error ? e.message : String(e)}`);
			propertyPaletteProvider.clear(PALETTE_OWNER);
		}
	}

	return [
		metadataTreeView.onDidChangeSelection(() => schedule(true)),
		propertyPaletteProvider.onDidChangeVisibility(() => schedule(false)),
		new vscode.Disposable(() => {
			if (timer) {
				clearTimeout(timer);
			}
		}),
	];
}

function state(target: PaletteTarget, tabs: readonly MetadataEditTabSpec[], dto: Record<string, unknown>): PropertyPaletteState {
	return {
		title: target.title,
		subtitle: target.subtitle,
		groups: paletteGroupsFromSpec(tabs, dto),
		emptyText: 'Свойства этого вида объекта палитра пока не показывает',
	};
}

interface ReadResult {
	readonly dto: Record<string, unknown>;
	readonly tabs: readonly MetadataEditTabSpec[];
	readonly schema: string;
}

/** Читает свойства и подбирает спеку: у объекта метаданных она зависит от вида и состава. */
async function readProperties(
	context: vscode.ExtensionContext,
	target: PaletteTarget,
	objectOverride?: Record<string, unknown>
): Promise<ReadResult> {
	const schema = await mdSparrowSchemaFlagFromConfigurationXml(target.schemaFrom);
	const runtime = await ensureMdSparrowRuntime(context);
	await ensureMdObjectKindLabels(runtime, target.cwd);
	const dto = objectOverride ?? (await readJson(runtime, target.readOp, target, schema));
	if (target.readOp === 'cf-configuration-properties-get') {
		// Ключи словаря перечислений идут с видом объекта, а пути полей конфигурации - без него.
		const [enums, labels] = await Promise.all([
			readJson(runtime, 'cf-md-object-enums', target, schema).catch(() => ({})),
			readJson(runtime, 'cf-enum-labels', target, schema).catch(() => ({})),
		]);
		const forConfiguration: Record<string, string[]> = {};
		for (const [key, values] of Object.entries(enums)) {
			if (key.startsWith('configuration.') && Array.isArray(values)) {
				forConfiguration[key.slice('configuration.'.length)] = values as string[];
			}
		}
		return { dto, tabs: applyEnumDictionary(SOURCE_PROPERTIES_TABS, forConfiguration, labels), schema };
	}
	if (target.child) {
		const node = findChildInObject(dto, target.child);
		// Варианты значений свойств палитры узла приходят словарём под ключами вида
		// attribute.indexing: своего списка констант расширение не держит
		const [enums, labels] = await Promise.all([
			readJson(runtime, 'cf-md-object-enums', target, schema).catch(() => ({})),
			readJson(runtime, 'cf-enum-labels', target, schema).catch(() => ({})),
		]);
		const forNode: Record<string, string[]> = {};
		const prefix = `${target.child.nodeKind}.`;
		for (const [key, values] of Object.entries(enums)) {
			if (key.startsWith(prefix) && Array.isArray(values)) {
				forNode[key.slice(prefix.length)] = values as string[];
			}
		}
		// Кандидаты в тип: примитивы платформы и ссылочные типы конфигурации
		const typeOptions = node?.typeSingle === undefined
			? []
			: childNodeTypeOptions(await readJson(runtime, 'cf-list-ref-types', target, schema).catch(() => ({})));
		return {
			dto: node ?? { name: target.child.name },
			tabs: applyEnumDictionary(childNodeTabs(node !== undefined, node, typeOptions), forNode, labels),
			schema,
		};
	}
	const [structure, enums] = await Promise.all([
		readJson(runtime, 'cf-md-object-structure-get', target, schema).catch(() => ({})),
		readJson(runtime, 'cf-md-object-enums', target, schema).catch(() => ({})),
	]);
	const tabs = objectPaletteTabs(dto, structure, String(dto.internalName ?? target.title), enums);
	return { dto, tabs, schema };
}

async function readJson(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	op: MdSparrowOp,
	target: PaletteTarget,
	schema: string
): Promise<Record<string, unknown>> {
	if (op === 'cf-md-object-enums') {
		const cached = enumsBySchema.get(schema);
		if (cached) {
			return cached;
		}
	}
	// Ссылочные типы принадлежат конфигурации целиком, а не файлу выделенного объекта
	const forConfiguration = op === 'cf-list-ref-types';
	const filePath = forConfiguration ? target.schemaFrom : target.filePath;
	const key = `${await fileKey(filePath)}|${op}`;
	const cached = readCache.get(key);
	if (cached) {
		return cached;
	}
	const result = await runMdSparrowParamsRead(
		runtime,
		{
			op,
			[forConfiguration ? 'configurationXml' : target.pathField]: filePath,
			schemaVersion: schema,
		},
		{ cwd: target.cwd }
	);
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || `код ${result.exitCode}`);
	}
	const json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
	if (op === 'cf-md-object-enums') {
		enumsBySchema.set(schema, json);
		return json;
	}
	// Ключ несёт время правки файла, поэтому устаревшие записи не переиспользуются, а только копятся.
	if (readCache.size >= READ_CACHE_LIMIT) {
		readCache.delete(readCache.keys().next().value as string);
	}
	readCache.set(key, json);
	return json;
}

/**
 * Пересобирает показ с черновиком правок, ничего не записывая.
 *
 * Нужно свойствам, от которых зависит состав строк: выбрали тип - под ним появились
 * его квалификаторы, ещё до записи.
 *
 * @param context - Контекст расширения
 * @param target - Что выделено
 * @param edits - Черновик правок из палитры
 * @returns Свойства с учётом черновика
 */
async function previewProperties(
	context: vscode.ExtensionContext,
	target: PaletteTarget,
	edits: Readonly<Record<string, string>>
): Promise<PropertyPaletteState | undefined> {
	if (!target.child) {
		return undefined;
	}
	const withEdits = await childObjectDto(context, target, edits);
	const fresh = await readProperties(context, target, withEdits);
	return state(target, fresh.tabs, fresh.dto);
}

/** Пишет правки той же операцией, что и панель-вкладка, и отдаёт свойства из перечитанного файла. */
async function writeProperties(
	context: vscode.ExtensionContext,
	target: PaletteTarget,
	tabs: readonly MetadataEditTabSpec[],
	dto: Record<string, unknown>,
	schema: string,
	edits: Readonly<Record<string, string>>
): Promise<PropertyPaletteState> {
	const runtime = await ensureMdSparrowRuntime(context);
	const next = target.child ? await childObjectDto(context, target, edits) : applyPaletteEdits(dto, tabs, edits);
	const written = await runMdSparrowParamsMutation(
		runtime,
		{
			op: target.writeOp,
			[target.pathField]: target.filePath,
			schemaVersion: schema,
			payloadJson: JSON.stringify(next),
		},
		{ cwd: target.cwd }
	);
	if (written.exitCode !== 0) {
		throw new Error(written.stderr.trim() || written.stdout.trim() || `код ${written.exitCode}`);
	}
	const fresh = await readProperties(context, target);
	return state(target, fresh.tabs, fresh.dto);
}

/**
 * DTO объекта с правкой узла состава.
 *
 * Свойства узла живут в списке DTO объекта, поэтому объект перечитывается целиком: писать надо
 * его, а не отдельный узел.
 */
async function childObjectDto(
	context: vscode.ExtensionContext,
	target: PaletteTarget,
	edits: Readonly<Record<string, string>>
): Promise<Record<string, unknown>> {
	const child = target.child;
	const list = child ? childNodeDtoList(child.nodeKind) : undefined;
	if (!child || !list) {
		throw new Error('свойства этого узла не записываются');
	}
	const schema = await mdSparrowSchemaFlagFromConfigurationXml(target.schemaFrom);
	const runtime = await ensureMdSparrowRuntime(context);
	const objectDto = await readJson(runtime, 'cf-md-object-get', target, schema);
	const next = applyChildNodeEdits(objectDto, list, child.name, edits);
	if (!next) {
		throw new Error(`в объекте больше нет узла ${child.name}`);
	}
	return next;
}
