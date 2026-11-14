/**
 * Надёжный канал команд md-sparrow через UTF-8 JSON-файл (изменения и чтение).
 *
 * На Windows лаунчер `java.exe` декодирует `argv` через ANSI-кодовую страницу ОС
 * (её расширение не контролирует, а `-Dsun.jnu.encoding` на это не влияет — свойство read-only),
 * поэтому кириллические имена и пути, переданные как опции/аргументы, превращаются в `?`.
 * Здесь все строковые значения (пути, имена, JSON-payload) уходят в UTF-8 JSON, а в `argv`
 * остаётся только ASCII-путь к самому файлу параметров (`os.tmpdir()` ASCII во всех реальных
 * конфигурациях: кириллическое имя пользователя возможно лишь на cp1251, где argv и так не искажается).
 *
 * - `runMdSparrowParamsMutation` → подкоманда `apply-mutation` (мутации, set, scaffold);
 * - `runMdSparrowParamsRead` → подкоманда `read-json` (свойства/структура/дерево/граф/списки), JSON в stdout.
 *
 * @module mdSparrowParams
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { runMdSparrow, type MdSparrowRunResult } from './mdSparrowRunner';
import { cachedByFiles, forgetCachedReads } from './mdSparrowCache';
import { notifyMetadataFileMoved, notifyMetadataFilesChanged, type MetadataFileMove } from './metadataFileChanges';
import type { MdSparrowRuntime } from './mdSparrowBootstrap';
import { renamedObjectFileOf } from '../../shared/objectPaths';

/** Операция; значения совпадают с именами одиночных подкоманд md-sparrow. */
export type MdSparrowOp =
	// изменения (apply-mutation)
	| 'cf-md-object-delete'
	| 'cf-md-object-rename'
	| 'cf-md-object-duplicate'
	| 'cf-md-attribute-add'
	| 'cf-md-attribute-rename'
	| 'cf-md-attribute-delete'
	| 'cf-md-attribute-duplicate'
	| 'cf-md-tabular-section-add'
	| 'cf-md-tabular-section-rename'
	| 'cf-md-tabular-section-delete'
	| 'cf-md-tabular-section-duplicate'
	| 'cf-md-tabular-attribute-add'
	| 'cf-md-tabular-attribute-rename'
	| 'cf-md-tabular-attribute-delete'
	| 'cf-md-tabular-attribute-duplicate'
	| 'cf-md-attribute-reorder'
	| 'cf-md-tabular-section-reorder'
	| 'cf-md-tabular-attribute-reorder'
	| 'cf-md-enum-value-add'
	| 'cf-md-enum-value-rename'
	| 'cf-md-enum-value-delete'
	| 'cf-md-enum-value-duplicate'
	| 'cf-md-enum-value-reorder'
	| 'cf-md-accounting-flag-add'
	| 'cf-md-accounting-flag-rename'
	| 'cf-md-accounting-flag-delete'
	| 'cf-md-ext-dimension-accounting-flag-add'
	| 'cf-md-ext-dimension-accounting-flag-rename'
	| 'cf-md-ext-dimension-accounting-flag-delete'
	| 'cf-md-dimension-add'
	| 'cf-md-dimension-rename'
	| 'cf-md-dimension-delete'
	| 'cf-md-dimension-duplicate'
	| 'cf-md-dimension-reorder'
	| 'cf-md-resource-add'
	| 'cf-md-resource-rename'
	| 'cf-md-resource-delete'
	| 'cf-md-resource-duplicate'
	| 'cf-md-resource-reorder'
	| 'external-artifact-rename'
	| 'external-artifact-delete'
	| 'external-artifact-duplicate'
	| 'external-artifact-add'
	| 'external-artifact-properties-set'
	| 'cf-md-command-add'
	| 'cf-md-command-rename'
	| 'cf-md-command-delete'
	| 'cf-md-command-reorder'
	| 'cf-md-object-set'
	| 'cf-configuration-properties-set'
	| 'cf-form-item-properties-set'
	| 'init-empty-cf'
	| 'init-empty-cfe'
	| 'add-md-object'
	// чтение (read-json)
	| 'cf-md-object-get'
	| 'cf-enum-labels'
	| 'cf-format-versions'
	| 'cf-md-object-enums'
	| 'cf-list-ref-types'
	| 'cf-md-object-structure-get'
	| 'cf-form-content-get'
	| 'cf-form-item-properties'
	| 'cf-form-standard-commands'
	| 'external-artifact-properties-get'
	| 'cf-configuration-properties-get'
	| 'cf-list-child-objects'
	| 'cf-list-all-child-objects'
	| 'cfe-borrow-object'
	| 'cf-form-add'
	| 'cf-form-compile'
	| 'cf-md-form-delete'
	| 'cf-md-exchange-plan-content-get'
	| 'cf-md-exchange-plan-content-set'
	| 'cf-list-catalogs'
	| 'cf-md-subsystem-tree'
	| 'cf-md-subsystem-command-interface-get'
	| 'cf-md-subsystem-command-visibility-set'
	| 'cf-role-rights-get'
	| 'cf-role-rights-set'
	| 'cf-object-rights-get'
	| 'cf-object-rights-set'
	| 'cf-support-get'
	| 'cf-support-object-get'
	| 'cf-support-object-states'
	| 'cf-support-object-mode-set'
	| 'cf-support-element-mode-set'
	| 'cf-support-remove'
	| 'cf-md-subsystem-command-placement-set'
	| 'cf-md-subsystem-command-order-set'
	| 'cf-md-subsystem-subsystems-order-set'
	| 'cf-md-subsystem-groups-order-set'
	| 'cf-dcs-info'
	| 'cf-spreadsheet-get'
	| 'cf-spreadsheet-set-cell'
	| 'cf-dcs-set-query'
	| 'cf-dcs-add-calculated-field'
	// правки схемы компоновки: наборы, поля, связи, вычисляемые поля, ресурсы, параметры
	| 'cf-dcs-add-data-set'
	| 'cf-dcs-remove-data-set'
	| 'cf-dcs-rename-data-set'
	| 'cf-dcs-set-data-set-props'
	| 'cf-dcs-add-field'
	| 'cf-dcs-set-field'
	| 'cf-dcs-remove-field'
	| 'cf-dcs-add-link'
	| 'cf-dcs-set-link'
	| 'cf-dcs-remove-link'
	| 'cf-dcs-set-calculated-field'
	| 'cf-dcs-remove-calculated-field'
	| 'cf-dcs-add-total-field'
	| 'cf-dcs-set-total-field'
	| 'cf-dcs-remove-total-field'
	| 'cf-dcs-add-parameter'
	| 'cf-dcs-set-parameter'
	| 'cf-dcs-remove-parameter'
	// варианты настроек схемы компоновки: чтение и правки
	| 'cf-dcs-settings-info'
	| 'cf-dcs-add-settings-variant'
	| 'cf-dcs-remove-settings-variant'
	| 'cf-dcs-set-settings-variant-props'
	| 'cf-dcs-add-structure-item'
	| 'cf-dcs-remove-structure-item'
	| 'cf-dcs-move-structure-item'
	| 'cf-dcs-set-group-fields'
	| 'cf-dcs-set-selection'
	| 'cf-dcs-set-order'
	| 'cf-dcs-set-filter'
	| 'cf-dcs-set-parameter-value'
	| 'cf-dcs-add-appearance-item'
	| 'cf-dcs-set-appearance-item'
	| 'cf-dcs-remove-appearance-item'
	// автозаполнение полей, строгая проверка схемы (read-json) и макеты владельца
	| 'cf-dcs-autofill-fields'
	| 'cf-dcs-validate'
	| 'cf-dcs-template-add'
	| 'cf-dcs-template-remove'
	// словарь окна «Тип значения» (read-json)
	| 'cf-dcs-type-dictionary'
	// таблицы языка запросов объекта (read-json)
	| 'cf-md-query-tables'
	// пакет операций одним сеансом записи (apply-mutation, поле operations)
	| 'batch'
	| 'project-metadata-tree'
	| 'cf-md-graph'
	| 'cf-validate-dump';

/** Параметры команды; сериализуются в UTF-8 JSON и читаются `apply-mutation`/`read-json`. */
export interface MdSparrowParams {
	op: MdSparrowOp;
	configurationXml?: string;
	objectXml?: string;
	/** Файл содержимого формы: `Ext/Form.xml` в выгрузке конфигуратора, `Form.form` в проекте EDT. */
	formXml?: string;
	artifactsRoot?: string;
	targetCfRoot?: string;
	/** Каталог проверяемой выгрузки: src/cf или каталог расширения. */
	cfRoot?: string;
	/** Каталог создаваемого расширения (init-empty-cfe). */
	targetCfeRoot?: string;
	/** Configuration.xml расширяемой конфигурации: источник режимов совместимости. */
	mainConfigurationXml?: string;
	/** Формат новых исходников: `designer` или `edt`. */
	format?: 'designer' | 'edt';
	/** Версия платформы в манифесте проекта EDT без базовой конфигурации. */
	runtimeVersion?: string;
	/** Префикс имён объектов расширения. */
	namePrefix?: string;
	/** Назначение расширения: patch, customization или add-on. */
	purpose?: string;
	projectRoot?: string;
	/** Каталоги исходников относительно projectRoot; пусто — стандартные src/cf, src/cfe, src/epf, src/erf. */
	cfDir?: string;
	cfeDir?: string;
	epfDir?: string;
	erfDir?: string;
	/** Точные каталоги расширений и внешних объектов: заменяют перечисление подкаталогов общих каталогов. */
	cfeDirs?: string[];
	epfDirs?: string[];
	erfDirs?: string[];
	tag?: string;
	name?: string;
	oldName?: string;
	newName?: string;
	sourceName?: string;
	tabularSection?: string;
	/** Набор данных схемы компоновки, которого касается правка (операции cf-dcs-*). */
	dataSet?: string;
	/** Путь к данным поля схемы компоновки (операции cf-dcs-*). */
	dataPath?: string;
	/** Вариант настроек схемы компоновки: имя среди прямых детей корня (операции cf-dcs-*). */
	variant?: string;
	/** Порядковый номер элемента схемы без собственного ключа в формате: связи и ресурсы. */
	index?: number;
	/** Источник данных нового набора (cf-dcs-add-data-set). */
	dataSource?: string;
	/** Версия схемы в формате `V2_20` (как флаг `-v`). */
	schemaVersion?: string;
	type?: string;
	kind?: string;
	synonym?: string;
	synonymEmpty?: boolean;
	autoName?: boolean;
	/** Заполнить MainDataCompositionSchema владельца новым макетом: только у видов с этим свойством (cf-dcs-template-add). */
	makeMain?: boolean;
	/** Строгая проверка схемы компоновки: XSD с поправками «как пишет платформа» (cf-dcs-validate). */
	strict?: boolean;
	/** Язык имён видов, таблиц и стандартных реквизитов в ответе (cf-md-query-tables); по умолчанию ru. */
	lang?: 'ru' | 'en';
	/** Отпечаток прочитанных правил поддержки: правка поверх устаревшего снимка отклоняется. */
	expectedGeneration?: string;
	/** Полезная нагрузка для set-операций: JSON DTO как строка. */
	payloadJson?: string;
	/** Не смотреть на правила поддержки: правка идёт так, будто поставки нет. */
	ignoreSupport?: boolean;
	/**
	 * Операции пакета (`op: 'batch'`): идут по порядку в одном сеансе записи с одной публикацией,
	 * первый отказ отменяет весь пакет. `ignoreSupport` и `dryRun` задаются у пакета, а не у операций —
	 * md-sparrow отказывает, если они есть внутри.
	 */
	operations?: MdSparrowParams[];
}

/**
 * Учитывать ли поддержку поставщика: настройка расширения, по умолчанию включена.
 *
 * Когда её выключают, выгрузка правится так, будто поставки нет: библиотека не отказывает в
 * правке запрещённых объектов, а дерево не показывает признаков поддержки.
 */
export function supportEnabled(): boolean {
	return vscode.workspace.getConfiguration('1c-platform-tools').get<boolean>('metadata.supportEnabled') !== false;
}

/** Сквозной счётчик имён params-файлов: параллельные вызовы в одну миллисекунду не должны делить файл. */
let paramsFileSeq = 0;

async function writeParamsAndRun(
	runtime: MdSparrowRuntime,
	command: 'apply-mutation' | 'read-json',
	params: MdSparrowParams,
	options?: {
		cwd?: string;
		token?: vscode.CancellationToken;
	}
): Promise<MdSparrowRunResult> {
	paramsFileSeq += 1;
	const tmpPath = path.join(os.tmpdir(), `md-sparrow-${command}-${Date.now()}-${process.pid}-${paramsFileSeq}.json`);
	// Работа с поддержкой выключена: библиотека не смотрит на правила поставки
	const payload = supportEnabled() ? params : { ...params, ignoreSupport: true };
	await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
	try {
		return await runMdSparrow(runtime, [command, '--params', tmpPath], { ...options, label: `${command} ${params.op}` });
	} finally {
		await fs.unlink(tmpPath).catch(() => undefined);
	}
}

/**
 * Выполняет изменение метаданных через `apply-mutation --params <utf8-json>`.
 *
 * Удачная правка сообщает о файлах из своих параметров: открытые панели перечитывают их,
 * а панель переименованного или удалённого объекта уходит вслед за ним.
 *
 * @param runtime Среда выполнения md-sparrow (java + jar).
 * @param params Параметры операции (op и поля); пути, имена и payload идут в JSON, не в argv.
 * @param options cwd и токен отмены, как у {@link runMdSparrow}.
 */
export async function runMdSparrowParamsMutation(
	runtime: MdSparrowRuntime,
	params: MdSparrowParams,
	options?: {
		cwd?: string;
		token?: vscode.CancellationToken;
	}
): Promise<MdSparrowRunResult> {
	// Правка меняет файлы: прочитанное в этом сеансе больше не годится
	forgetCachedReads();
	const result = await writeParamsAndRun(runtime, 'apply-mutation', params, options);
	if (result.exitCode === 0) {
		const move = movedObjectFile(params);
		if (move) {
			notifyMetadataFileMoved(move);
		}
		notifyMetadataFilesChanged(changedFilesOf(params));
	}
	return result;
}

/**
 * Файлы правки: у пакета пути лежат в его операциях, а не на верхнем уровне. Операции пакета
 * обычно правят один файл — повторы убираются, чтобы открытые панели не перечитывали его по разу
 * на операцию.
 */
function changedFilesOf(params: MdSparrowParams): Array<string | undefined> {
	const files = [params.objectXml, params.configurationXml, params.formXml];
	for (const operation of params.operations ?? []) {
		files.push(operation.objectXml, operation.configurationXml, operation.formXml);
	}
	return [...new Set(files)];
}

/** Куда ушло описание объекта после переименования или удаления. */
function movedObjectFile(params: MdSparrowParams): MetadataFileMove | undefined {
	if (!params.objectXml) {
		return undefined;
	}
	if (params.op === 'cf-md-object-rename' && params.newName) {
		return { from: params.objectXml, to: renamedObjectFileOf(params.objectXml, params.newName) };
	}
	if (params.op === 'cf-md-object-delete') {
		return { from: params.objectXml };
	}
	return undefined;
}

/**
 * Выполняет чтение метаданных через `read-json --params <utf8-json>`; результат — JSON в `stdout`.
 *
 * @param runtime Среда выполнения md-sparrow (java + jar).
 * @param params Параметры операции (op и поля); пути идут в JSON, не в argv.
 * @param options cwd и токен отмены, как у {@link runMdSparrow}.
 */
export async function runMdSparrowParamsRead(
	runtime: MdSparrowRuntime,
	params: MdSparrowParams,
	options?: {
		cwd?: string;
		token?: vscode.CancellationToken;
	}
): Promise<MdSparrowRunResult> {
	const read = () => writeParamsAndRun(runtime, 'read-json', params, options);
	if (!CACHED_READS.has(params.op)) {
		return read();
	}
	return cachedByFiles(
		`${params.op}|${params.objectXml ?? params.configurationXml ?? params.formXml ?? ''}`,
		dependenciesOf(params),
		[runtime.releaseTag ?? runtime.jarPath, `поддержка:${supportEnabled()}`, JSON.stringify(params)],
		read,
		(result) => result.exitCode === 0 && result.stdout.length <= CACHED_ANSWER_LIMIT,
		directoriesOf(params)
	);
}

/**
 * Ответы, которые зависят только от названного файла и правил поддержки его корня.
 *
 * Панель свойств зовёт их на каждый объект, а каждый запуск это ещё и старт JVM.
 */
const CACHED_READS: ReadonlySet<string> = new Set([
	'cf-md-object-get',
	'cf-md-object-structure-get',
	'cf-configuration-properties-get',
	'cf-md-object-enums',
	'cf-enum-labels',
	'cf-format-versions',
	'cf-list-child-objects',
	'cf-md-subsystem-tree',
]);

/** Каталоги, описания в которых меняют ответ: состав подсистем лежит файлами рядом. */
export function directoriesOf(params: MdSparrowParams): string[] {
	if (params.op !== 'cf-md-subsystem-tree' || !params.configurationXml) {
		return [];
	}
	// В проекте EDT описание конфигурации лежит в своём каталоге, а подсистемы уровнем выше
	const objects = params.configurationXml.toLowerCase().endsWith('.mdo')
		? path.dirname(path.dirname(params.configurationXml))
		: path.dirname(params.configurationXml);
	return [path.join(objects, 'Subsystems')];
}

/** Ответ крупнее этого в памяти не держим: панель читает его заново. */
const CACHED_ANSWER_LIMIT = 4_000_000;

/** Сколько уровней вверх искать правила поставки: описание объекта лежит в подкаталогах корня. */
const SUPPORT_LEVELS = 5;

/** Файлы, от которых зависит ответ: сам файл, его каталог и правила поставки корня. */
function dependenciesOf(params: MdSparrowParams): string[] {
	const file = params.objectXml ?? params.configurationXml ?? params.formXml;
	if (!file) {
		return [];
	}
	const files = [file, path.dirname(file)];
	let directory = path.dirname(file);
	for (let level = 0; level < SUPPORT_LEVELS; level += 1) {
		files.push(path.join(directory, 'Ext', 'ParentConfigurations.bin'));
		files.push(path.join(directory, 'Configuration', 'Configuration.distr'));
		const parent = path.dirname(directory);
		if (parent === directory) {
			break;
		}
		directory = parent;
	}
	return files;
}
