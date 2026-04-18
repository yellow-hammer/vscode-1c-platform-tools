/**
 * Имена «болванок» новых объектов МД — в духе эталонных деревьев выгрузки:
 * `1c-platform-samples/snapshots/2.20/cf/empty-full-objects/` (например `Catalogs/Справочник1.xml`).
 * @module metadataBoilerplateNames
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { MdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrow } from './mdSparrowRunner';

/** Префикс имени первого/следующего справочника по снапшоту `Справочник1`, `Справочник2`, … */
export const CATALOG_BOILERPLATE_PREFIX = 'Справочник';

/** Как в `MdObjectAddType` / CLI `md-sparrow add-md-object --type`. */
export type MdBoilerplateCliKind =
	| 'CATALOG'
	| 'ENUM'
	| 'CONSTANT'
	| 'DOCUMENT'
	| 'REPORT'
	| 'DATA_PROCESSOR'
	| 'TASK'
	| 'CHART_OF_ACCOUNTS'
	| 'CHART_OF_CHARACTERISTIC_TYPES'
	| 'CHART_OF_CALCULATION_TYPES'
	| 'COMMON_MODULE'
	| 'SUBSYSTEM'
	| 'SESSION_PARAMETER'
	| 'EXCHANGE_PLAN'
	| 'COMMON_ATTRIBUTE'
	| 'COMMON_PICTURE'
	| 'DOCUMENT_NUMERATOR'
	| 'EXTERNAL_DATA_SOURCE'
	| 'ROLE';

/** Тег в `Configuration.xml` / `cf-list-child-objects --tag`. */
export const MD_BOILERPLATE_KIND_TO_XML_TAG: Record<MdBoilerplateCliKind, string> = {
	CATALOG: 'Catalog',
	ENUM: 'Enum',
	CONSTANT: 'Constant',
	DOCUMENT: 'Document',
	REPORT: 'Report',
	DATA_PROCESSOR: 'DataProcessor',
	TASK: 'Task',
	CHART_OF_ACCOUNTS: 'ChartOfAccounts',
	CHART_OF_CHARACTERISTIC_TYPES: 'ChartOfCharacteristicTypes',
	CHART_OF_CALCULATION_TYPES: 'ChartOfCalculationTypes',
	COMMON_MODULE: 'CommonModule',
	SUBSYSTEM: 'Subsystem',
	SESSION_PARAMETER: 'SessionParameter',
	EXCHANGE_PLAN: 'ExchangePlan',
	COMMON_ATTRIBUTE: 'CommonAttribute',
	COMMON_PICTURE: 'CommonPicture',
	DOCUMENT_NUMERATOR: 'DocumentNumerator',
	EXTERNAL_DATA_SOURCE: 'ExternalDataSource',
	ROLE: 'Role',
};

/** Префиксы имени по эталону из снапшота (`Перечисление1`, `Документ1`, …). */
export const MD_BOILERPLATE_PREFIX: Record<MdBoilerplateCliKind, string> = {
	CATALOG: CATALOG_BOILERPLATE_PREFIX,
	ENUM: 'Перечисление',
	CONSTANT: 'Константа',
	DOCUMENT: 'Документ',
	REPORT: 'Отчет',
	DATA_PROCESSOR: 'Обработка',
	TASK: 'Задача',
	CHART_OF_ACCOUNTS: 'ПланСчетов',
	CHART_OF_CHARACTERISTIC_TYPES: 'ПланВидовХарактеристик',
	CHART_OF_CALCULATION_TYPES: 'ПланВидовРасчета',
	COMMON_MODULE: 'ОбщийМодуль',
	SUBSYSTEM: 'Подсистема',
	SESSION_PARAMETER: 'ПараметрСеанса',
	EXCHANGE_PLAN: 'ПланОбмена',
	COMMON_ATTRIBUTE: 'ОбщийРеквизит',
	COMMON_PICTURE: 'ОбщаяКартинка',
	DOCUMENT_NUMERATOR: 'НумераторДокументов',
	EXTERNAL_DATA_SOURCE: 'ВнешнийИсточникДанных',
	ROLE: 'Роль',
};

/**
 * Подкаталог выгрузки с XML объекта — как в md-sparrow {@code MdBoilerplateKind.cfSubdir()}.
 * Нужен, чтобы учитывать имена существующих `.xml` на диске, даже если их нет в `Configuration.xml`.
 */
export const MD_BOILERPLATE_KIND_TO_CF_SUBDIR: Record<MdBoilerplateCliKind, string> = {
	CATALOG: 'Catalogs',
	ENUM: 'Enums',
	CONSTANT: 'Constants',
	DOCUMENT: 'Documents',
	REPORT: 'Reports',
	DATA_PROCESSOR: 'DataProcessors',
	TASK: 'Tasks',
	CHART_OF_ACCOUNTS: 'ChartsOfAccounts',
	CHART_OF_CHARACTERISTIC_TYPES: 'ChartsOfCharacteristicTypes',
	CHART_OF_CALCULATION_TYPES: 'ChartsOfCalculationTypes',
	COMMON_MODULE: 'CommonModules',
	SUBSYSTEM: 'Subsystems',
	SESSION_PARAMETER: 'SessionParameters',
	EXCHANGE_PLAN: 'ExchangePlans',
	COMMON_ATTRIBUTE: 'CommonAttributes',
	COMMON_PICTURE: 'CommonPictures',
	DOCUMENT_NUMERATOR: 'DocumentNumerators',
	EXTERNAL_DATA_SOURCE: 'ExternalDataSources',
	ROLE: 'Roles',
};

/**
 * Имена объектов по списку `*.xml` в `{cfRoot}/{subdir}` (без расширения).
 * Если каталога нет — пустой список.
 *
 * @param cfRoot Абсолютный путь к корню `src/cf`.
 * @param subdir Подкаталог объектов метаданных (`Catalogs`, `Documents`, ...).
 * @returns Промис, который разрешается массивом имён без расширения `.xml`.
 */
export async function readObjectNamesFromCfSubdir(cfRoot: string, subdir: string): Promise<string[]> {
	const dir = path.join(cfRoot, subdir);
	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return [];
	}
	const names: string[] = [];
	for (const name of entries) {
		if (!name.endsWith('.xml')) {
			continue;
		}
		names.push(name.slice(0, -'.xml'.length));
	}
	return names;
}

function mergeNameSets(a: readonly string[], b: readonly string[]): string[] {
	return [...new Set([...a, ...b])];
}

/** Соответствие `groupId` из дерева метаданных → вид для `add-md-object` (как в package.json). */
const METADATA_GROUP_ID_TO_KIND: Record<string, MdBoilerplateCliKind> = {
	catalogs: 'CATALOG',
	constants: 'CONSTANT',
	enums: 'ENUM',
	documents: 'DOCUMENT',
	reports: 'REPORT',
	externalReports: 'REPORT',
	dataProcessors: 'DATA_PROCESSOR',
	externalDataProcessors: 'DATA_PROCESSOR',
	tasks: 'TASK',
	chartOfCharacteristicTypes: 'CHART_OF_CHARACTERISTIC_TYPES',
	chartOfAccounts: 'CHART_OF_ACCOUNTS',
	chartOfCalculationTypes: 'CHART_OF_CALCULATION_TYPES',
	externalDataSources: 'EXTERNAL_DATA_SOURCE',
};

/** Хвост `metadataSubgroup_<это>` / `metadataSubgroupExt_<это>` из `metadataTreeView.ts`. */
const METADATA_SUBGROUP_REST_TO_KIND: Record<string, MdBoilerplateCliKind> = {
	common_common_subsystem: 'SUBSYSTEM',
	common_common_commonmodule: 'COMMON_MODULE',
	common_common_sessionparam: 'SESSION_PARAMETER',
	common_common_role: 'ROLE',
	common_common_commonattribute: 'COMMON_ATTRIBUTE',
	common_common_exchangeplan: 'EXCHANGE_PLAN',
	common_common_commonpicture: 'COMMON_PICTURE',
	documents_documentNumerators: 'DOCUMENT_NUMERATOR',
};

function kindFromMetadataTreeContextValue(contextValue: string): MdBoilerplateCliKind | undefined {
	if (contextValue.startsWith('metadataGroup_')) {
		const id = contextValue.slice('metadataGroup_'.length);
		return METADATA_GROUP_ID_TO_KIND[id];
	}
	if (contextValue.startsWith('metadataGroupExt_')) {
		const id = contextValue.slice('metadataGroupExt_'.length);
		return METADATA_GROUP_ID_TO_KIND[id];
	}
	if (contextValue.startsWith('metadataSubgroup_')) {
		const rest = contextValue.slice('metadataSubgroup_'.length);
		return METADATA_SUBGROUP_REST_TO_KIND[rest];
	}
	if (contextValue.startsWith('metadataSubgroupExt_')) {
		const rest = contextValue.slice('metadataSubgroupExt_'.length);
		return METADATA_SUBGROUP_REST_TO_KIND[rest];
	}
	return undefined;
}

function isRecordWithContextValue(a: unknown): a is { contextValue?: string } {
	return typeof a === 'object' && a !== null && 'contextValue' in a;
}

/**
 * В меню дерева VS Code передаёт `TreeItem` и `args` в разном порядке/вложенности.
 * Если строка вида `CONSTANT` не найдена — берём вид из `contextValue` узла (см. `metadataTreeView`).
 *
 * @param args Аргументы команды из палитры/контекстного меню.
 * @returns Вид метаданных для `add-md-object` или `undefined`, если определить нельзя.
 */
export function parseMdBoilerplateKindFromCommandArgs(args: readonly unknown[]): MdBoilerplateCliKind | undefined {
	for (const a of args) {
		if (typeof a === 'string' && Object.hasOwn(MD_BOILERPLATE_KIND_TO_XML_TAG, a)) {
			return a as MdBoilerplateCliKind;
		}
		if (Array.isArray(a)) {
			const nested = parseMdBoilerplateKindFromCommandArgs(a);
			if (nested !== undefined) {
				return nested;
			}
		}
	}
	for (const a of args) {
		if (isRecordWithContextValue(a) && typeof a.contextValue === 'string') {
			const fromCv = kindFromMetadataTreeContextValue(a.contextValue);
			if (fromCv !== undefined) {
				return fromCv;
			}
		}
	}
	return undefined;
}

/**
 * Первое свободное имя вида `Префикс{N}` по списку имён из Configuration.xml.
 *
 * @param prefix Префикс для генерируемого имени.
 * @param existingNames Уже занятые имена.
 * @returns Первое свободное имя с числовым суффиксом.
 */
export function nextBoilerplateNameFromPrefix(
	prefix: string,
	existingNames: readonly string[]
): string {
	const taken = new Set(existingNames);
	let n = 1;
	for (;;) {
		const candidate = `${prefix}${n}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
		n += 1;
	}
}

/**
 * Имена дочерних объектов по тегу (`md-sparrow cf-list-child-objects --tag`).
 *
 * @param runtime Подготовленный runtime md-sparrow.
 * @param configurationXmlPath Абсолютный путь к `Configuration.xml`.
 * @param schemaFlag Флаг версии схемы (`V2_20`, `V2_21`, ...).
 * @param cwd Рабочий каталог запуска CLI.
 * @param xmlTag XML-тег объекта в `Configuration/ChildObjects`.
 * @returns Либо массив имён, либо текст ошибки CLI/разбора JSON.
 */
export async function fetchChildObjectNamesFromCfList(
	runtime: MdSparrowRuntime,
	configurationXmlPath: string,
	schemaFlag: string,
	cwd: string,
	xmlTag: string
): Promise<{ names: string[] } | { error: string }> {
	const res = await runMdSparrow(
		runtime,
		['cf-list-child-objects', configurationXmlPath, '--tag', xmlTag, '-v', schemaFlag],
		{ cwd }
	);
	if (res.exitCode !== 0) {
		const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 500);
		return { error: errText };
	}
	try {
		const parsed: unknown = JSON.parse(res.stdout.trim());
		if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) {
			return { error: 'Неожиданный ответ cf-list-child-objects.' };
		}
		return { names: [...parsed] };
	} catch {
		return { error: 'Не удалось разобрать JSON списка объектов ChildObjects.' };
	}
}

/**
 * Следующее имя болванки для типа из `add-md-object --type`.
 *
 * @param runtime Подготовленный runtime md-sparrow.
 * @param configurationXmlPath Абсолютный путь к `Configuration.xml`.
 * @param schemaFlag Флаг версии схемы (`V2_20`, `V2_21`, ...).
 * @param cwd Рабочий каталог запуска CLI.
 * @param kind Тип объекта для `add-md-object --type`.
 * @returns Либо рассчитанное имя, либо текст ошибки.
 */
export async function resolveNextBoilerplateMdName(
	runtime: MdSparrowRuntime,
	configurationXmlPath: string,
	schemaFlag: string,
	cwd: string,
	kind: MdBoilerplateCliKind
): Promise<{ name: string } | { error: string }> {
	const tag = MD_BOILERPLATE_KIND_TO_XML_TAG[kind];
	const prefix = MD_BOILERPLATE_PREFIX[kind];
	const listed = await fetchChildObjectNamesFromCfList(
		runtime,
		configurationXmlPath,
		schemaFlag,
		cwd,
		tag
	);
	if ('error' in listed) {
		return { error: listed.error };
	}
	const subdir = MD_BOILERPLATE_KIND_TO_CF_SUBDIR[kind];
	const fromFs = await readObjectNamesFromCfSubdir(cwd, subdir);
	return { name: nextBoilerplateNameFromPrefix(prefix, mergeNameSets(listed.names, fromFs)) };
}
