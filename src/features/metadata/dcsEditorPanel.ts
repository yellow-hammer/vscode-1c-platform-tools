/**
 * Вкладка схемы компоновки данных: структура по cf-dcs-info, настройки вариантов
 * по cf-dcs-settings-info и правки через операции cf-dcs-*.
 *
 * Правки приходят сообщениями webview `{type: 'dcs/<операция>', …поля}` (разбор — {@link dcsMutationOf}),
 * применяются по одной и отвечают сообщением `{type: 'saved', ok, model | error}`; после правки настроек
 * в ответ добавляются перечитанные настройки затронутого варианта ({@link dcsAffectedSettingsVariant}).
 * Содержимое варианта webview грузит лениво сообщением `dcs/load-variant {variant}` — это не правка,
 * ответ `{type: 'variant', variant, settings | error}`.
 *
 * Ответ на `dcs/autofill-fields` несёт итог `autofill` (added/skipped) для плашки,
 * а `dcs/validate` — чтение строгой проверки, ответ `{type: 'validation', ok, errors, warnings | error}`.
 *
 * `dcs/type-dictionary` — чтение словаря окна «Тип значения» (cf-dcs-type-dictionary),
 * ответ `{type: 'typeDictionary', dictionary | error}`; кэширует его сам webview на время вкладки.
 * `dcs/settings-wizard {variant, operations}` — пакет конструктора настроек: операции проверяются
 * каналом пакета ({@link dcsSettingsWizardBatchOf}), уходят одним `apply-mutation op:"batch"` через ту
 * же очередь, что одиночные правки, ответ — тот же `saved` с перечитанным вариантом.
 * `dcs/describe-type {typeName} | {queryTable}, lang?` — чтение для подсказки через точку:
 * cf-md-query-tables объекта из выгрузки над макетом, ответ `{type: 'describeType', эхо запроса, lang,
 * description | outside | error}`; кэширует описания webview на время вкладки (ключ — с языком).
 *
 * Конструктор запроса:
 * - `dcs/list-metadata` — дерево «База данных»: только виды с таблицами запроса, в порядке
 *   веток конструктора; дерево держит кэш хоста по выгрузке и времени изменения Configuration.xml.
 *   Ответы: `{type: 'metadata', loading: true}` — дерева в кэше нет, идёт загрузка (на большой
 *   выгрузке — минуты); затем `{type: 'metadata', groups}` — готово, либо `{type: 'metadata', error}` —
 *   отказ (не кэшируется, повтор запроса загрузит заново).
 * - `dcs/query-tables {relativePath, lang?}` — таблицы языка запросов объекта (cf-md-query-tables)
 *   по файлу из дерева, в выгрузке или проекте EDT над макетом; ответ `{type: 'queryTables',
 *   relativePath, lang, description | outside | error}`; кэширует webview (ключ — с языком).
 * - `dcs/apply-query {dataSet, text, addParameters, autofill}` — запись по ОК: пакет канала query
 *   (текст, недостающие параметры только именем, автозаполнение), ответ — `saved` с перечитанной
 *   моделью, итогом автозаполнения и `addedParameters`.
 *
 * Закладка «Ресурсы»: `dcs/remove-total-fields {indexes}` — «<<», удаление ресурсов одним
 * пакетом канала totals ({@link dcsRemoveTotalFieldsBatchOf}); `dcs/add-total-fields {payloads}` — «>>», ресурсы
 * `Сумма(<поле>)` по числовым полям одним пакетом того же канала ({@link dcsAddTotalFieldsBatchOf}). Ответ обоих — тот
 * же `saved` с перечитанной моделью.
 *
 * @module dcsEditorPanel
 */

import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerFormPanel } from '../editors/formPanels';
import { revealOpenPanel, trackOpenPanel } from '../editors/openPanels';
import {
	dcsCommonAttributeNames,
	dcsEditorUnsupportedReason,
	findConfigurationXmlAbove,
	isConfigurationExtensionXml,
	resolveDcsDescribeTarget,
	resolveDcsQueryTablesTarget,
} from './dcsTargets';
import { createDcsMetadataTreeCache } from './dcsMetadataTreeCache';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import {
	runMdSparrowParamsMutation,
	runMdSparrowParamsRead,
	type MdSparrowParams,
} from './mdSparrowParams';
import {
	DCS_ADD_TOTAL_FIELDS_MESSAGE,
	DCS_APPLY_QUERY_MESSAGE,
	DCS_DESCRIBE_TYPE_MESSAGE,
	DCS_MESSAGE_PREFIX,
	DCS_QUERY_TABLES_MESSAGE,
	DCS_REMOVE_TOTAL_FIELDS_MESSAGE,
	DCS_SETTINGS_WIZARD_MESSAGE,
	dcsAddTotalFieldsBatchOf,
	dcsAffectedSettingsVariant,
	dcsApplyQueryRequestOf,
	dcsAutofillOfResult,
	dcsBatchParamsOf,
	dcsBatchProblem,
	dcsDeclaredParameterNames,
	dcsDescribeRequestOf,
	dcsMutationOf,
	dcsQueryBatchOf,
	dcsQueryDataSetProblem,
	dcsQueryLangOf,
	dcsQueryMetadataGroupsOf,
	dcsQueryTablesRequestOf,
	dcsRemoveTotalFieldsBatchOf,
	dcsSettingsWizardBatchOf,
	dcsValidationOf,
	type DcsApplyQueryRequest,
	type DcsAutofillResultDto,
	type DcsBatchChannel,
	type DcsBatchMutation,
	type DcsMetadataGroupDto,
	type DcsPanelMessage,
	type DcsQueryTreeGroupDto,
	type DcsValidationErrorDto,
	type DcsValidationWarningDto,
} from './dcsPanelMessages';
import { logger } from '../../shared/logger';

const log = logger.scope('metadata');

/**
 * Деревья «База данных» конструктора запроса на все вкладки СКД: кэш webview живёт до закрытия
 * вкладки, а холодный project-metadata-tree большой выгрузки — минуты, поэтому дерево помнит хост.
 */
const metadataTreeCache = createDcsMetadataTreeCache<DcsQueryTreeGroupDto[]>();

/** Ограничения использования поля или его реквизитов: где поле недоступно. */
export interface DcsUseRestrictionDto {
	field?: boolean;
	condition?: boolean;
	group?: boolean;
	order?: boolean;
}

/** Роль поля набора в итогах: измерение, обязательность, период, счета и остатки. */
export interface DcsFieldRoleDto {
	dimension?: boolean;
	required?: boolean;
	periodNumber?: number;
	periodType?: string;
	account?: boolean;
	balance?: boolean;
	balanceType?: string;
	accountField?: string;
	ignoreNullValues?: boolean;
}

/**
 * Структурный тип значения (`docs/cf-dcs.md` md-sparrow, «Типы значений»): та же форма
 * уходит обратно в `payload.valueType` мутаций; `editable`/`readOnlyReason` писатель не читает.
 */
export interface DcsValueTypeDto {
	types: string[];
	typeSets: string[];
	typeIds: string[];
	/** Имена определяемых типов по порядку typeIds; нет — выгрузка не найдена или UUID неизвестен. */
	definedTypes?: string[];
	stringQualifiers?: { length?: string; allowedLength?: string };
	numberQualifiers?: { digits?: string; fractionDigits?: string; allowedSign?: string };
	dateQualifiers?: { dateFractions?: string };
	binaryDataQualifiers?: { length?: string; allowedLength?: string };
	editable?: boolean;
	readOnlyReason?: string;
}

/** Поле набора данных. */
export interface DcsDataSetFieldDto {
	dataPath?: string;
	field?: string;
	title?: string;
	/** Вид записи: обычное поле, папка или вложенный набор. */
	kind?: 'field' | 'folder' | 'nested';
	/** Заголовок по языкам конфигурации. */
	titleLangs?: Record<string, string>;
	useRestriction?: DcsUseRestrictionDto;
	attributeUseRestriction?: DcsUseRestrictionDto;
	role?: DcsFieldRoleDto;
	/** Тип значения подписью. */
	valueTypePresentation?: string;
	/** Структурный тип значения; ключа нет — тип в файле не записан. */
	valueType?: DcsValueTypeDto;
	/** У поля записано условное оформление. */
	hasAppearance?: boolean;
	/** У поля записаны параметры редактирования. */
	hasInputParameters?: boolean;
}

/** Набор данных; у набора-объединения вложенные наборы лежат в items. */
export interface DcsDataSetDto {
	name?: string;
	query?: string;
	fields?: DcsDataSetFieldDto[];
	type?: 'query' | 'object' | 'union';
	dataSource?: string;
	objectName?: string;
	autoFillFields?: boolean;
	items?: DcsDataSetDto[];
}

/** Связь наборов данных. */
export interface DcsDataSetLinkDto {
	source?: string;
	destination?: string;
	sourceExpression?: string;
	destinationExpression?: string;
	parameter?: string;
	parameterListAllowed?: boolean;
	linkConditionExpression?: string;
	startExpression?: string;
	required?: boolean;
}

/** Вычисляемое поле: имя приходит путём к данным, значение — выражением. */
export interface DcsCalculatedFieldDto {
	name?: string;
	value?: string;
	title?: string;
	useRestriction?: DcsUseRestrictionDto;
	hasAppearance?: boolean;
	/** Структурный тип значения; ключа нет — тип в файле не записан. */
	valueType?: DcsValueTypeDto;
}

/** Ресурс (итоговое поле). */
export interface DcsTotalFieldDto {
	/** Путь к данным. */
	name?: string;
	/** Выражение; ключа нет — выражение пустое. */
	value?: string;
	/** Группировки, по которым рассчитывается итог. */
	groups?: string[];
}

/** Параметр схемы. */
export interface DcsParameterDto {
	name?: string;
	value?: string;
	title?: string;
	type?: string;
	expression?: string;
	useRestriction?: boolean;
	/** Использование параметра. */
	use?: 'Always' | 'Auto';
	availableAsField?: boolean;
	denyIncompleteValues?: boolean;
	valueListAllowed?: boolean;
	/** Значение подписью; сложные значения правит только конфигуратор. */
	valuePresentation?: string;
	/** Структурный тип значения; ключа нет — тип в файле не записан. */
	valueType?: DcsValueTypeDto;
	/** Значение в форме значений настроек (то же принимает `value` у cf-dcs-set-parameter); нет — `<value>` не записан. */
	valueTyped?: DcsValueDto;
	/** В файле есть доступные значения: смена типа может их рассогласовать. */
	hasAvailableValues?: boolean;
	/** В файле есть параметры выбора: смена типа может их рассогласовать. */
	hasInputParameters?: boolean;
}

/** Источник данных. */
export interface DcsDataSourceDto {
	name?: string;
	connectionString?: string;
	type?: string;
}

/** Структура схемы из cf-dcs-info; наполнение целиком приходит от md-sparrow. */
export interface DcsInfoDto {
	dataSets?: DcsDataSetDto[];
	dataSources?: DcsDataSourceDto[];
	dataSetLinks?: DcsDataSetLinkDto[];
	calculatedFields?: DcsCalculatedFieldDto[];
	totalFields?: DcsTotalFieldDto[];
	parameters?: DcsParameterDto[];
	settingsVariants?: Array<{ name?: string; value?: string }>;
	nestedSchemas?: Array<{ name?: string; value?: string }>;
	/**
	 * Признак панели, не md-sparrow: конструктор запроса доступен — макет лежит внутри
	 * выгрузки конфигурации. Кладётся только в стартовую модель webview: доступность не
	 * меняется, пока вкладка открыта, поэтому перечитанные модели признак не несут.
	 */
	queryConstructor?: boolean;
	/**
	 * Признак панели, не md-sparrow: макет лежит в выгрузке расширения конфигурации. Кладётся только в
	 * стартовую модель вместе с queryConstructor: webview по нему выключает проверку имён запроса по
	 * метаданным — объектов основной конфигурации в выгрузке расширения нет, а описания
	 * заимствованных неполные.
	 */
	configurationExtension?: boolean;
	/**
	 * Признак панели, не md-sparrow: имена общих реквизитов выгрузки, в которой лежит макет (только в
	 * стартовой модели). Общие реквизиты — поля таблиц объектов, которых описания md-sparrow перечисляют
	 * не у всех таблиц: проверка имён запроса о таких полях молчит.
	 */
	configurationCommonAttributes?: string[];
}

/** Хвост пользовательской настройки: режим показа, идентификатор и представление — passthrough, не редактируются. */
export interface DcsUserSettingTailDto {
	viewMode?: string;
	userSettingID?: string;
	userSettingPresentation?: string;
}

/**
 * Секция настроек (выбранные поля, отбор, сортировка, параметры данных и вывода, условное оформление):
 * элементы и passthrough-хвост секции.
 */
export interface DcsSettingsSectionDto<TItem> extends DcsUserSettingTailDto {
	items?: TItem[];
}

/** Типизированное значение настроек: `xsi:type` из текста файла и разобранные ветки по виду. */
export interface DcsValueDto {
	/** `xsi:type` как в файле; пустая строка — тип не записан. */
	type?: string;
	text?: string;
	nil?: true;
	/** Скалярное значение надёжных типов. */
	decoded?: string | number | boolean;
	/** Стандартный период `v8:StandardPeriod`. */
	period?: { variant: string; startDate?: string; endDate?: string };
	/** Стандартная дата начала `v8:StandardBeginningDate`. */
	beginningDate?: { variant: string; date?: string };
	/** Список значений `v8:ValueListType`. */
	list?: { items?: Array<{ value?: DcsValueDto; presentation?: string }> };
	/** Атрибуты элементов Font/Picture/Line. */
	attrs?: Record<string, string>;
	/** Тип вне белого списка записи: показывается read-only, перезапись — отказ. */
	opaque?: true;
}

/** Пользовательское поле (read-only): поле-выражение или поле-выбор. */
export interface DcsUserFieldDto {
	kind?: 'expression' | 'case';
	dataPath: string;
	title?: string;
	detailExpression?: string;
	totalExpression?: string;
	/** Число ветвей поля-выбора. */
	casesCount?: number;
}

/** Элемент выбранных полей: поле, авто-элемент или папка с вложенными элементами. */
export interface DcsSelItemDto {
	kind: 'field' | 'auto' | 'folder';
	use?: boolean;
	field?: string;
	/** Заголовок строкой на языке конфигурации. */
	title?: string;
	/** Исходная форма заголовка в файле: локализованная строка или обычная. */
	titleKind?: 'lws' | 'string';
	/** Расположение вложенных полей (только у папки). */
	placement?: string;
	items?: DcsSelItemDto[];
	viewMode?: string;
}

/** Элемент отбора: сравнение или группа И/ИЛИ/НЕ с вложенными элементами. */
export interface DcsFilterItemDto extends DcsUserSettingTailDto {
	kind: 'comparison' | 'group';
	use?: boolean;
	left?: string;
	comparisonType?: string;
	/** Значения сравнения; по XSD повторяемы — повторы показываются read-only. */
	right?: DcsValueDto[];
	presentation?: string;
	application?: string;
	groupType?: string;
	items?: DcsFilterItemDto[];
}

/** Элемент сортировки: поле с направлением или авто-элемент. */
export interface DcsOrderItemDto {
	kind: 'field' | 'auto';
	use?: boolean;
	field?: string;
	orderType?: 'Asc' | 'Desc';
	autoOrder?: boolean;
	distinctNullValues?: boolean;
	viewMode?: string;
}

/** Значение параметра данных или вывода. */
export interface DcsParamValueDto extends DcsUserSettingTailDto {
	use?: boolean;
	parameter: string;
	/** Значения массивом, обычно одно; `xsi:nil` приходит `[{nil: true}]`. */
	value?: DcsValueDto[];
	/** Вложенные под-параметры (read-only). */
	items?: DcsParamValueDto[];
}

/** Признак области применения условного оформления; отсутствие — по умолчанию платформы. */
export type DcsCaUse = 'Use' | 'DontUse';

/** Элемент условного оформления: оформляемые поля, условие и параметры оформления. */
export interface DcsCaItemDto extends DcsUserSettingTailDto {
	use?: boolean;
	fields?: Array<{ use?: boolean; field: string }>;
	filter?: DcsFilterItemDto[];
	appearance?: DcsParamValueDto[];
	presentation?: string;
	/** Области применения оформления. */
	useIn?: {
		group?: DcsCaUse;
		hierarchicalGroup?: DcsCaUse;
		overall?: DcsCaUse;
		fieldsHeader?: DcsCaUse;
		header?: DcsCaUse;
		parameters?: DcsCaUse;
		filter?: DcsCaUse;
		resourceFieldsHeader?: DcsCaUse;
		overallHeader?: DcsCaUse;
		overallResourceFieldsHeader?: DcsCaUse;
	};
}

/** Поле группировки: тип группировки и дополнение периода полной пятёркой, как пишет платформа. */
export interface DcsGroupFieldDto {
	field: string;
	groupType: 'Items' | 'Hierarchy' | 'HierarchyOnly';
	/** Дополнение периода: enum на 23 значения из core XSD. */
	periodAdditionType: string;
	periodAdditionBegin?: DcsValueDto;
	periodAdditionEnd?: DcsValueDto;
}

/**
 * Узел структуры варианта: группировка, таблица, диаграмма или вложенный отчёт.
 *
 * Поля узла зависят от вида: groupFields/filter/order/structure — у группировок (и групп
 * строк/колонок/точек/серий), columns/rows — у таблицы, points/series — у диаграммы,
 * objectID — у вложенного отчёта (read-only, его настройки не раскрываются).
 */
export interface DcsNodeDto extends DcsUserSettingTailDto {
	kind: 'group' | 'table' | 'chart' | 'nestedObject';
	use?: boolean;
	name?: string;
	groupFields?: DcsGroupFieldDto[];
	filter?: DcsSettingsSectionDto<DcsFilterItemDto>;
	order?: DcsSettingsSectionDto<DcsOrderItemDto>;
	selection?: DcsSettingsSectionDto<DcsSelItemDto>;
	conditionalAppearance?: DcsSettingsSectionDto<DcsCaItemDto>;
	outputParameters?: DcsSettingsSectionDto<DcsParamValueDto>;
	structure?: DcsNodeDto[];
	columns?: DcsNodeDto[];
	rows?: DcsNodeDto[];
	points?: DcsNodeDto[];
	series?: DcsNodeDto[];
	objectID?: string;
}

/** Настройки варианта из cf-dcs-settings-info; наполнение целиком приходит от md-sparrow. */
export interface DcsSettingsDto {
	/** Пользовательские поля: только показ, без правки. */
	userFields?: DcsUserFieldDto[];
	selection?: DcsSettingsSectionDto<DcsSelItemDto>;
	filter?: DcsSettingsSectionDto<DcsFilterItemDto>;
	dataParameters?: DcsSettingsSectionDto<DcsParamValueDto>;
	order?: DcsSettingsSectionDto<DcsOrderItemDto>;
	conditionalAppearance?: DcsSettingsSectionDto<DcsCaItemDto>;
	outputParameters?: DcsSettingsSectionDto<DcsParamValueDto>;
	structure?: DcsNodeDto[];
	/** У настроек записаны дополнительные свойства (passthrough). */
	hasAdditionalProperties?: true;
	itemsViewMode?: string;
	itemsUserSettingID?: string;
	itemsUserSettingPresentation?: string;
}

/** Вариант настроек из cf-dcs-settings-info; настройки приходят только при загрузке по имени. */
export interface DcsSettingsVariantDto {
	name?: string;
	/** Представление строкой на языке конфигурации. */
	presentation?: string;
	settings?: DcsSettingsDto;
}

/** Ответ cf-dcs-settings-info: без `variant` — все варианты без настроек, с ним — один вариант с настройками. */
export interface DcsSettingsInfoDto {
	variants: DcsSettingsVariantDto[];
}

export interface DcsEditorInput {
	/** Файл содержимого схемы: `Templates/<Имя>/Ext/Template.xml`. */
	templateXmlFsPath: string;
	title: string;
	cwd: string;
	schemaFlag: string;
	/**
	 * Общая очередь правок md-sparrow: выгрузку правят и дерево, и другие вкладки, а параллельные
	 * CLI столкнулись бы на одних файлах (макет удаляют из дерева, пока вкладка пишет схему).
	 */
	enqueueMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** Открывает вкладку схемы компоновки: структура, правка запроса, вычисляемые поля. */
export async function openDcsEditorPanel(
	context: vscode.ExtensionContext,
	input: DcsEditorInput
): Promise<void> {
	// Формат проверяется до запуска md-sparrow, с любого входа в редактор: схему 2.10 и 2.11 он всё равно
	// не прочитает, и вместо его ошибки пользователь получает одну понятную причину
	const unsupported = dcsEditorUnsupportedReason(input.schemaFlag);
	if (unsupported) {
		void vscode.window.showInformationMessage(unsupported);
		return;
	}
	if (revealOpenPanel('dcsEditor', input.templateXmlFsPath)) {
		return;
	}
	const runtime = await ensureMdSparrowRuntime(context);

	async function readInfo(): Promise<DcsInfoDto | string> {
		const res = await runMdSparrowParamsRead(
			runtime,
			{ op: 'cf-dcs-info', objectXml: input.templateXmlFsPath, schemaVersion: input.schemaFlag },
			{ cwd: input.cwd }
		);
		if (res.exitCode !== 0) {
			return (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
		}
		try {
			return JSON.parse(res.stdout.trim()) as DcsInfoDto;
		} catch {
			return 'Не удалось разобрать структуру схемы.';
		}
	}

	/** Настройки варианта по имени: cf-dcs-settings-info читает один вариант лениво. */
	async function readSettings(variant: string): Promise<DcsSettingsDto | string> {
		const res = await runMdSparrowParamsRead(
			runtime,
			{ op: 'cf-dcs-settings-info', objectXml: input.templateXmlFsPath, schemaVersion: input.schemaFlag, variant },
			{ cwd: input.cwd }
		);
		if (res.exitCode !== 0) {
			return (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
		}
		try {
			const parsed = JSON.parse(res.stdout.trim()) as DcsSettingsInfoDto;
			// С variant ответ несёт ровно названный вариант с настройками: неизвестное имя md-sparrow отклоняет сам
			return parsed.variants[0].settings!;
		} catch {
			return 'Не удалось разобрать настройки варианта.';
		}
	}

	const info = await readInfo();
	if (typeof info === 'string') {
		void vscode.window.showErrorMessage(`Схема компоновки не прочитана. ${info}`);
		return;
	}

	// Конструктор запроса строит дерево по выгрузке, в которой лежит макет: вне её кнопки нет
	const constructorConfigurationXml = await findConfigurationXmlAbove(input.templateXmlFsPath);
	// Выгрузка расширения: проверка имён запроса по ней дала бы ложные предупреждения
	const constructorExtension = constructorConfigurationXml !== undefined && (await isConfigurationExtensionXml(constructorConfigurationXml));
	// Общие реквизиты — поля таблиц, которых нет в описаниях md-sparrow: о них проверка имён молчит
	const constructorCommonAttributes =
		constructorConfigurationXml === undefined ? [] : await dcsCommonAttributeNames(path.dirname(constructorConfigurationXml));

	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel(
		'1cDcsEditor',
		`СКД: ${input.title}`,
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [webviewRoot] }
	);
	registerFormPanel(panel);
	trackOpenPanel('dcsEditor', input.templateXmlFsPath, panel);
	panel.webview.html = await loadHtml(
		panel.webview,
		context.extensionUri,
		constructorConfigurationXml === undefined
			? info
			: {
					...info,
					queryConstructor: true,
					...(constructorExtension ? { configurationExtension: true } : {}),
					...(constructorCommonAttributes.length > 0 ? { configurationCommonAttributes: constructorCommonAttributes } : {}),
				},
		input.title
	);

	// Правки идут по одной в общей очереди; внутри задачи очереди новая задача не ставится — та ждала бы сама себя
	const runMutation = input.enqueueMutation;

	/** Ответ webview; вкладка могла закрыться, не дождавшись правки из очереди. */
	function post(
		message:
			| {
					type: 'saved';
					ok: boolean;
					model?: DcsInfoDto;
					settings?: { variant: string; data: DcsSettingsDto };
					/** Итог автозаполнения полей: webview показывает added/skipped плашкой. */
					autofill?: DcsAutofillResultDto;
					/** Параметры, которые объявил пакет конструктора запроса (dcs/apply-query). */
					addedParameters?: string[];
					error?: string;
			  }
			| { type: 'variant'; variant: string; settings?: DcsSettingsDto; error?: string }
			| { type: 'validation'; ok?: boolean; errors?: DcsValidationErrorDto[]; warnings?: DcsValidationWarningDto[]; error?: string }
			| {
					/**
					 * Ответ конструктору запроса: дерево объектов. loading — дерева в кэше хоста нет, загрузка
					 * началась (готовое дерево придёт следующим сообщением).
					 */
					type: 'metadata';
					groups?: DcsMetadataGroupDto[];
					loading?: true;
					error?: string;
			  }
			| {
					/**
					 * Таблицы языка запросов объекта (dcs/query-tables): эхо пути и языка — по ним webview
					 * находит ожидающий ключ кэша; outside — макет вне выгрузки, это не ошибка.
					 */
					type: 'queryTables';
					relativePath?: string;
					lang?: 'ru' | 'en';
					description?: unknown;
					outside?: true;
					note?: string;
					error?: string;
			  }
			| {
					/** Словарь окна «Тип значения»: ответ cf-dcs-type-dictionary как есть. */
					type: 'typeDictionary';
					dictionary?: unknown;
					error?: string;
			  }
			| {
					/**
					 * Описание объекта для подсказки через точку: эхо запроса (по нему webview находит
					 * ожидающий ключ) и ответ cf-md-query-tables как есть; outside — макет вне выгрузки
					 * конфигурации, это не ошибка.
					 */
					type: 'describeType';
					typeName?: string;
					queryTable?: string;
					lang?: 'ru' | 'en';
					description?: unknown;
					outside?: true;
					error?: string;
			  }
	): void {
		try {
			void panel.webview.postMessage(message);
		} catch {
			// Закрытая вкладка ответ уже не ждёт
		}
	}

	panel.webview.onDidReceiveMessage(
		(msg: DcsPanelMessage) => {
			if (!msg || typeof msg !== 'object') {
				return;
			}
			if (msg.type === 'setQuery' && typeof msg.text === 'string') {
				void applyAndReport({
					op: 'cf-dcs-set-query',
					objectXml: input.templateXmlFsPath,
					schemaVersion: input.schemaFlag,
					tag: msg.dataSet || undefined,
					payloadJson: msg.text,
				});
				return;
			}
			if (msg.type === 'addCalculatedField' && typeof msg.dataPath === 'string') {
				void applyAndReport({
					op: 'cf-dcs-add-calculated-field',
					objectXml: input.templateXmlFsPath,
					schemaVersion: input.schemaFlag,
					payloadJson: JSON.stringify({
						dataPath: msg.dataPath,
						expression: msg.expression ?? '',
						title: msg.title ?? '',
					}),
				});
				return;
			}
			if (msg.type === 'dcs/load-variant') {
				// Ленивая загрузка содержимого варианта; это и следующие сообщения — чтения, очередь мутаций они не занимают
				if (typeof msg.variant !== 'string' || msg.variant === '') {
					log.warn('СКД: сообщение не разобрано: dcs/load-variant без варианта');
					post({ type: 'variant', variant: '', error: 'Вариант настроек не назван.' });
					return;
				}
				void loadVariantAndReport(msg.variant);
				return;
			}
			if (msg.type === 'dcs/validate') {
				void validateAndReport();
				return;
			}
			if (msg.type === 'dcs/list-metadata') {
				void listMetadataAndReport();
				return;
			}
			if (msg.type === 'dcs/type-dictionary') {
				void typeDictionaryAndReport();
				return;
			}
			if (msg.type === 'dcs/describe-type') {
				void describeTypeAndReport(msg);
				return;
			}
			if (msg.type === 'dcs/query-tables') {
				void queryTablesAndReport(msg);
				return;
			}
			if (msg.type === 'dcs/apply-query') {
				// ОК конструктора запроса: пакет канала query собирает и проверяет панель, а не webview
				const request = dcsApplyQueryRequestOf(msg);
				if ('error' in request) {
					log.warn(`СКД: ${DCS_APPLY_QUERY_MESSAGE}: ${request.error}`);
					post({ type: 'saved', ok: false, error: request.error });
					return;
				}
				void applyQueryAndReport(request);
				return;
			}
			if (msg.type === DCS_REMOVE_TOTAL_FIELDS_MESSAGE) {
				// «<<» закладки «Ресурсы»: все выбранные ресурсы одним пакетом канала totals, файл меняется целиком или никак
				const batch = dcsRemoveTotalFieldsBatchOf(msg);
				if ('error' in batch) {
					log.warn(`СКД: пакет не разобран: ${DCS_REMOVE_TOTAL_FIELDS_MESSAGE}: ${batch.error}`);
					post({ type: 'saved', ok: false, error: batch.error });
					return;
				}
				void applyBatchAndReport('totals', batch.mutations);
				return;
			}
			if (msg.type === DCS_ADD_TOTAL_FIELDS_MESSAGE) {
				// «>>» закладки «Ресурсы»: ресурсы по всем числовым полям одним пакетом канала totals — все или ни одного
				const batch = dcsAddTotalFieldsBatchOf(msg);
				if ('error' in batch) {
					log.warn(`СКД: пакет не разобран: ${DCS_ADD_TOTAL_FIELDS_MESSAGE}: ${batch.error}`);
					post({ type: 'saved', ok: false, error: batch.error });
					return;
				}
				void applyBatchAndReport('totals', batch.mutations);
				return;
			}
			if (msg.type === 'dcs/settings-wizard') {
				// Конструктор настроек: пакет правок одного варианта, проверка до jar — каналом пакета
				const batch = dcsSettingsWizardBatchOf(msg);
				if ('error' in batch) {
					log.warn(`СКД: пакет не разобран: ${DCS_SETTINGS_WIZARD_MESSAGE}: ${batch.error}`);
					post({ type: 'saved', ok: false, error: batch.error });
					return;
				}
				void applyBatchAndReport('settings', batch.mutations, batch.variant);
				return;
			}
			if (typeof msg.type === 'string' && msg.type.startsWith(DCS_MESSAGE_PREFIX)) {
				const mutation = dcsMutationOf(msg);
				if (!mutation) {
					log.warn(`СКД: сообщение не разобрано: ${msg.type}`);
					post({ type: 'saved', ok: false, error: `Правка не разобрана: ${msg.type}` });
					return;
				}
				void applyAndReport(
					{
						...mutation,
						objectXml: input.templateXmlFsPath,
						schemaVersion: input.schemaFlag,
					},
					dcsAffectedSettingsVariant(mutation)
				);
			}
		},
		undefined,
		context.subscriptions
	);

	/**
	 * Ставит правку в очередь; после успеха перечитывает схему и отвечает webview.
	 *
	 * Правка настроек называет затронутый вариант — тогда перечитываются и его настройки
	 * (после переименования — под новым именем), ответ несёт их в `settings`.
	 */
	async function applyAndReport(params: MdSparrowParams, settingsVariant?: string): Promise<void> {
		await runMutation(() => applyNow(params, settingsVariant));
	}

	/**
	 * Тело правки без очереди: его зовёт и {@link applyAndReport}, и пакет конструктора запроса, который
	 * сначала перечитывает схему в той же очереди. extra — поля ответа сверх модели (объявленные
	 * параметры пакета запроса).
	 */
	async function applyNow(
		params: MdSparrowParams,
		settingsVariant?: string,
		extra?: { addedParameters?: string[] }
	): Promise<void> {
		try {
			const res = await runMdSparrowParamsMutation(runtime, params, { cwd: input.cwd });
			if (res.exitCode !== 0) {
				const error = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
				log.error(`${params.op}: ${error}`);
				post({ type: 'saved', ok: false, error });
				return;
			}
			// Автозаполнение отвечает итогом added/skipped (в пакете — ответом своей операции):
			// webview показывает его плашкой
			const autofill = dcsAutofillOfResult(params, res.stdout);
			const next = await readInfo();
			const model = typeof next === 'string' ? undefined : next;
			if (!settingsVariant) {
				post({ type: 'saved', ok: true, model, autofill, ...extra });
				return;
			}
			const settings = await readSettings(settingsVariant);
			if (typeof settings === 'string') {
				// Правка прошла, а перечитка настроек нет: webview дозапросит вариант сам
				log.warn(`cf-dcs-settings-info (${settingsVariant}): ${settings}`);
				post({ type: 'saved', ok: true, model });
				return;
			}
			post({ type: 'saved', ok: true, model, settings: { variant: settingsVariant, data: settings } });
		} catch (e) {
			const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
			log.error(`${params.op}: ${error}`);
			post({ type: 'saved', ok: false, error });
		}
	}

	/**
	 * ОК конструктора запроса (dcs/apply-query): в очереди мутаций — свежая модель (какие параметры уже
	 * объявлены и есть ли набор-запрос по этому пути), пакет канала query ({@link dcsQueryBatchOf}),
	 * его проверка каталогом и одним apply-mutation op:"batch", затем перечитка. Модель читается внутри
	 * очереди: правка, стоявшая раньше, могла объявить параметр или переименовать набор.
	 */
	async function applyQueryAndReport(request: DcsApplyQueryRequest): Promise<void> {
		await runMutation(async () => {
			const info = await readInfo();
			if (typeof info === 'string') {
				log.error(`cf-dcs-info: ${info}`);
				post({ type: 'saved', ok: false, error: `Запрос не записан: схема не перечитана. ${info}` });
				return;
			}
			const problem = dcsQueryDataSetProblem(info, request.dataSet);
			if (problem !== undefined) {
				log.warn(`СКД: ${DCS_APPLY_QUERY_MESSAGE}: ${problem}`);
				post({ type: 'saved', ok: false, error: problem });
				return;
			}
			const batch = dcsQueryBatchOf(request, dcsDeclaredParameterNames(info));
			const refusal = dcsBatchProblem('query', batch.mutations);
			if (refusal !== undefined) {
				log.warn(`СКД: пакет не запущен: ${refusal}`);
				post({ type: 'saved', ok: false, error: refusal });
				return;
			}
			await applyNow(dcsBatchParamsOf(batch.mutations, input.templateXmlFsPath, input.schemaFlag), undefined, {
				addedParameters: batch.addedParameters,
			});
		});
	}

	/**
	 * Пакет правок одним `apply-mutation op:"batch"`: конструктор настроек и ресурсы пачкой. Операции
	 * сверяются с каталогом канала ещё раз — чужая правка не должна дойти до jar ни из сообщения, ни
	 * из кода. Файл и версия схемы подставляются в каждую операцию; очередь, отказ «Операция N (имя):
	 * причина» от md-sparrow и перечитка модели и варианта — те же, что у одиночной правки
	 * ({@link applyAndReport}).
	 */
	async function applyBatchAndReport(
		channel: DcsBatchChannel,
		mutations: readonly DcsBatchMutation[],
		settingsVariant?: string
	): Promise<void> {
		const problem = dcsBatchProblem(channel, mutations);
		if (problem !== undefined) {
			log.warn(`СКД: пакет не запущен: ${problem}`);
			post({ type: 'saved', ok: false, error: problem });
			return;
		}
		await applyAndReport(dcsBatchParamsOf(mutations, input.templateXmlFsPath, input.schemaFlag), settingsVariant);
	}

	/** Строгая проверка схемы (cf-dcs-validate): вердикт уходит webview сообщением `validation`. */
	async function validateAndReport(): Promise<void> {
		try {
			const res = await runMdSparrowParamsRead(
				runtime,
				{ op: 'cf-dcs-validate', objectXml: input.templateXmlFsPath, schemaVersion: input.schemaFlag, strict: true },
				{ cwd: input.cwd }
			);
			if (res.exitCode !== 0) {
				const error = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
				log.error(`cf-dcs-validate: ${error}`);
				post({ type: 'validation', error });
				return;
			}
			const verdict = dcsValidationOf(res.stdout);
			if ('error' in verdict) {
				log.error(`cf-dcs-validate: ${verdict.error}`);
				post({ type: 'validation', error: verdict.error });
				return;
			}
			post({ type: 'validation', ok: verdict.ok, errors: verdict.errors, warnings: verdict.warnings });
		} catch (e) {
			const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
			log.error(`cf-dcs-validate: ${error}`);
			post({ type: 'validation', error });
		}
	}

	/**
	 * Дерево «База данных» конструктора запроса: project-metadata-tree по корню выгрузки, в которой лежит
	 * макет, только виды с таблицами запроса в порядке веток конструктора
	 * ({@link dcsQueryMetadataGroupsOf}); ответ держит кэш хоста по выгрузке и времени изменения
	 * Configuration.xml, а пока дерева в кэше нет, webview узнаёт о загрузке сообщением `loading`.
	 */
	async function listMetadataAndReport(): Promise<void> {
		try {
			if (constructorConfigurationXml === undefined) {
				post({
					type: 'metadata',
					error: 'Конструктор запроса доступен только для макета внутри выгрузки конфигурации.',
				});
				return;
			}
			const dumpRoot = path.dirname(constructorConfigurationXml);
			const answer = await metadataTreeCache.get(
				constructorConfigurationXml,
				() => loadMetadataTree(dumpRoot),
				() => post({ type: 'metadata', loading: true })
			);
			if ('error' in answer) {
				post({ type: 'metadata', error: answer.error });
				return;
			}
			post({ type: 'metadata', groups: answer.groups });
		} catch (e) {
			const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
			log.error(`dcs/list-metadata: ${error}`);
			post({ type: 'metadata', error });
		}
	}

	/** Холодная загрузка дерева для кэша: дерево строится по самой выгрузке — её корень и проект, и каталог конфигурации. */
	async function loadMetadataTree(dumpRoot: string): Promise<{ groups: DcsQueryTreeGroupDto[] } | { error: string }> {
		const params: MdSparrowParams = { op: 'project-metadata-tree', projectRoot: dumpRoot, cfDir: '.' };
		const res = await runMdSparrowParamsRead(runtime, params, { cwd: dumpRoot });
		if (res.exitCode !== 0) {
			const error = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
			log.error(`${params.op}: ${error}`);
			return { error };
		}
		try {
			return { groups: dcsQueryMetadataGroupsOf(JSON.parse(res.stdout.trim()) as unknown) };
		} catch {
			return { error: `Ответ ${params.op} не разобран.` };
		}
	}

	/**
	 * Таблицы языка запросов объекта (dcs/query-tables) для дерева конструктора: файл по relativePath —
	 * в выгрузке или проекте EDT над макетом ({@link resolveDcsQueryTablesTarget}), ответ
	 * cf-md-query-tables на языке запроса уходит webview как есть. Вне выгрузки — `outside` без
	 * ошибки. Кэш — у webview на время вкладки, по пути и языку.
	 */
	async function queryTablesAndReport(msg: DcsPanelMessage): Promise<void> {
		const request = dcsQueryTablesRequestOf(msg);
		if ('error' in request) {
			log.warn(`СКД: ${DCS_QUERY_TABLES_MESSAGE}: ${request.error}`);
			post({
				type: 'queryTables',
				relativePath: typeof msg.relativePath === 'string' ? msg.relativePath : undefined,
				lang: dcsQueryLangOf(msg),
				error: request.error,
			});
			return;
		}
		const echo = { relativePath: request.relativePath, lang: request.lang };
		try {
			const resolved = await resolveDcsQueryTablesTarget(input.templateXmlFsPath, request.relativePath);
			if ('outside' in resolved) {
				post({ type: 'queryTables', ...echo, outside: true, note: 'Макет вне выгрузки конфигурации: таблиц объектов нет.' });
				return;
			}
			if ('missing' in resolved || 'error' in resolved) {
				post({ type: 'queryTables', ...echo, error: 'missing' in resolved ? resolved.missing : resolved.error });
				return;
			}
			const description = await readQueryTables(resolved.target, request.lang);
			if ('error' in description) {
				post({ type: 'queryTables', ...echo, error: description.error });
				return;
			}
			post({ type: 'queryTables', ...echo, description: description.json });
		} catch (e) {
			const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
			log.error(`cf-md-query-tables: ${error}`);
			post({ type: 'queryTables', ...echo, error });
		}
	}

	/** cf-md-query-tables файла объекта на языке lang: общий для dcs/describe-type и dcs/query-tables. */
	async function readQueryTables(
		target: { objectXml: string; cwd: string; schemaVersion: string },
		lang: 'ru' | 'en'
	): Promise<{ json: unknown } | { error: string }> {
		const params: MdSparrowParams = { op: 'cf-md-query-tables', objectXml: target.objectXml, lang };
		if (target.schemaVersion !== '') {
			// У проекта EDT версию знает метамодель сборки: пустой флаг не передаётся вовсе
			params.schemaVersion = target.schemaVersion;
		}
		const res = await runMdSparrowParamsRead(runtime, params, { cwd: target.cwd });
		if (res.exitCode !== 0) {
			const error = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
			log.error(`cf-md-query-tables: ${error}`);
			return { error };
		}
		try {
			return { json: JSON.parse(res.stdout.trim()) as unknown };
		} catch {
			return { error: 'Ответ cf-md-query-tables не разобран.' };
		}
	}

	/**
	 * Словарь окна «Тип значения» (cf-dcs-type-dictionary) по файлу макета: выгрузку над ним
	 * md-sparrow ищет сам, вне выгрузки отвечает `configurationFound: false` и одними примитивами.
	 * Ответ уходит webview как есть — разбирает его dcs-editor-types.js.
	 */
	async function typeDictionaryAndReport(): Promise<void> {
		try {
			const res = await runMdSparrowParamsRead(
				runtime,
				{ op: 'cf-dcs-type-dictionary', objectXml: input.templateXmlFsPath, schemaVersion: input.schemaFlag },
				{ cwd: input.cwd }
			);
			if (res.exitCode !== 0) {
				const error = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
				log.error(`cf-dcs-type-dictionary: ${error}`);
				post({ type: 'typeDictionary', error });
				return;
			}
			let dictionary: unknown;
			try {
				dictionary = JSON.parse(res.stdout.trim()) as unknown;
			} catch {
				post({ type: 'typeDictionary', error: 'Ответ cf-dcs-type-dictionary не разобран.' });
				return;
			}
			post({ type: 'typeDictionary', dictionary });
		} catch (e) {
			const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
			log.error(`cf-dcs-type-dictionary: ${error}`);
			post({ type: 'typeDictionary', error });
		}
	}

	/**
	 * Описание объекта конфигурации для подсказки через точку (dcs/describe-type): по ссылочному
	 * типу или таблице языка запросов — файл объекта в выгрузке над макетом и cf-md-query-tables
	 * на языке lang (по умолчанию русском: стандартные реквизиты в путях СКД пишутся по-русски;
	 * английский — для таблиц английского текста запроса). Вне выгрузки — ответ `outside` без ошибки:
	 * webview перестаёт спрашивать. Кэш — у webview на время вкладки, по объекту и языку.
	 */
	async function describeTypeAndReport(msg: DcsPanelMessage): Promise<void> {
		const request = dcsDescribeRequestOf(msg);
		// Язык — часть ключа кэша webview: эхо несёт его всегда, и при отказе тоже
		const lang = dcsQueryLangOf(msg);
		const echo = {
			typeName: typeof msg.typeName === 'string' && msg.typeName !== '' ? msg.typeName : undefined,
			queryTable: typeof msg.queryTable === 'string' && msg.queryTable !== '' ? msg.queryTable : undefined,
			lang,
		};
		if ('error' in request || lang === undefined) {
			const error = 'error' in request ? request.error : `Язык «${String(msg.lang)}» не поддержан (lang: ru или en).`;
			log.warn(`СКД: ${DCS_DESCRIBE_TYPE_MESSAGE}: ${error}`);
			post({ type: 'describeType', ...echo, error });
			return;
		}
		const answerEcho = { ...request.echo, lang };
		try {
			const resolved = await resolveDcsDescribeTarget(input.templateXmlFsPath, request.folder, request.name);
			if ('outside' in resolved) {
				post({ type: 'describeType', ...answerEcho, outside: true });
				return;
			}
			if ('missing' in resolved || 'error' in resolved) {
				const error = 'missing' in resolved ? resolved.missing : resolved.error;
				post({ type: 'describeType', ...answerEcho, error });
				return;
			}
			// Английский текст запроса называет таблицы по-английски (AccumulationRegister.Х.Balance):
			// описание на его языке сопоставляет хвост имени без таблицы перевода в расширении
			const description = await readQueryTables(resolved.target, lang);
			if ('error' in description) {
				post({ type: 'describeType', ...answerEcho, error: description.error });
				return;
			}
			post({ type: 'describeType', ...answerEcho, description: description.json });
		} catch (e) {
			const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
			log.error(`cf-md-query-tables: ${error}`);
			post({ type: 'describeType', ...answerEcho, error });
		}
	}

	/** Читает настройки варианта и отвечает webview сообщением `variant`. */
	async function loadVariantAndReport(variant: string): Promise<void> {
		try {
			const settings = await readSettings(variant);
			if (typeof settings === 'string') {
				log.error(`cf-dcs-settings-info (${variant}): ${settings}`);
				post({ type: 'variant', variant, error: settings });
				return;
			}
			post({ type: 'variant', variant, settings });
		} catch (e) {
			const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
			log.error(`cf-dcs-settings-info (${variant}): ${error}`);
			post({ type: 'variant', variant, error });
		}
	}
}

async function loadHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	info: DcsInfoDto,
	title: string
): Promise<string> {
	const templateUri = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);
	const baseCssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-object.css')
	);
	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor.js'));
	// Логика без DOM — отдельными скриптами: их же исполняют node-тесты
	const highlightJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-highlight.js')
	);
	const dialogsJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-dialogs.js')
	);
	const completeJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-complete.js')
	);
	const typesJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-types.js')
	);
	const settingsWizardJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-settings-wizard.js')
	);
	const queryModelJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-query-model.js')
	);
	const fieldTypesJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-field-types.js')
	);
	const queryEditJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-query-edit.js')
	);
	// Окно конструктора запроса — после основного скрипта: оно берёт его API (window.DcsEditorApi)
	const queryDialogJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-query-dialog.js')
	);
	const formatJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-format.js')
	);
	// Закладки: скрипты до основного, он создаёт их в конце запуска и отдаёт объект ядра
	const schemaJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-schema.js')
	);
	const settingsPanelsJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-settings-panels.js')
	);
	const settingsJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor-settings.js')
	);
	const nonce = randomUUID();
	const initialJson = JSON.stringify(info).replaceAll('<', String.raw`\u003c`);
	return template
		.replaceAll('{{CSP_SOURCE}}', () => webview.cspSource)
		.replaceAll('{{NONCE}}', () => nonce)
		.replaceAll('{{BASE_CSS_URI}}', () => baseCssUri.toString())
		.replaceAll('{{CSS_URI}}', () => cssUri.toString())
		.replaceAll('{{JS_URI}}', () => jsUri.toString())
		.replaceAll('{{HIGHLIGHT_JS_URI}}', () => highlightJsUri.toString())
		.replaceAll('{{DIALOGS_JS_URI}}', () => dialogsJsUri.toString())
		.replaceAll('{{COMPLETE_JS_URI}}', () => completeJsUri.toString())
		.replaceAll('{{TYPES_JS_URI}}', () => typesJsUri.toString())
		.replaceAll('{{SETTINGS_WIZARD_JS_URI}}', () => settingsWizardJsUri.toString())
		.replaceAll('{{QUERY_MODEL_JS_URI}}', () => queryModelJsUri.toString())
		.replaceAll('{{QUERY_EDIT_JS_URI}}', () => queryEditJsUri.toString())
		.replaceAll('{{QUERY_DIALOG_JS_URI}}', () => queryDialogJsUri.toString())
		.replaceAll('{{FIELD_TYPES_JS_URI}}', () => fieldTypesJsUri.toString())
		.replaceAll('{{FORMAT_JS_URI}}', () => formatJsUri.toString())
		.replaceAll('{{SCHEMA_JS_URI}}', () => schemaJsUri.toString())
		.replaceAll('{{SETTINGS_PANELS_JS_URI}}', () => settingsPanelsJsUri.toString())
		.replaceAll('{{SETTINGS_JS_URI}}', () => settingsJsUri.toString())
		.replaceAll('{{TITLE}}', () => escapeHtml(title))
		.replaceAll('{{INITIAL_JSON}}', () => initialJson);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
