/**
 * Правки СКД из сообщений `{type: 'dcs/<операция>', …поля}`: спеки и разбор в параметры мутаций.
 *
 * Модуль без зависимости от vscode: формы сообщений разбирает панель редактора
 * ({@link module:dcsEditorPanel}), а node-тесты проверяют тот же разбор без VS Code.
 *
 * @module dcsPanelMessages
 */

import type { MdSparrowOp, MdSparrowParams } from './mdSparrowParams';

/** Сообщение webview; состав полей зависит от типа сообщения. */
export interface DcsPanelMessage {
	type?: string;
	dataSet?: string;
	text?: string;
	dataPath?: string;
	expression?: string;
	title?: string;
	name?: string;
	newName?: string;
	/** Вид нового набора данных: query, object или union. */
	dataSetType?: string;
	dataSource?: string;
	/** Вариант настроек, которого касается правка или ленивая загрузка. */
	variant?: string;
	/** Порядковый номер связи или ресурса. */
	index?: number;
	/** DTO полезной нагрузки операции; уходит в payloadJson как строка. */
	payload?: unknown;
	/** Операции пакета (`dcs/settings-wizard`): формы `{op, variant, payload}` и `{op, name, payload?}`. */
	operations?: unknown;
	/**
	 * Ссылочный тип в `dcs/describe-type` (`cfg:CatalogRef.Валюты`): поле не называется `type` —
	 * это имя занято типом самого сообщения.
	 */
	typeName?: string;
	/** Таблица языка запросов в `dcs/describe-type` (`Справочник.Валюты`, `РегистрНакопления.Х.Остатки`). */
	queryTable?: string;
	/** Язык имён в ответе cf-md-query-tables (`dcs/describe-type`, `dcs/query-tables`): `ru` по умолчанию или `en`. */
	lang?: string;
	/** Файл объекта от корня выгрузки в `dcs/query-tables` — relativePath из ответа дерева. */
	relativePath?: string;
	/** Имена `&`-параметров, которые `dcs/apply-query` объявляет в схеме (только имя, без типа). */
	addParameters?: unknown;
	/** `dcs/apply-query`: заполнить поля набора по новому тексту (autoFillFields набора). */
	autofill?: unknown;
	/** `dcs/remove-total-fields`: номера ресурсов к удалению одним пакетом («<<» закладки «Ресурсы»). */
	indexes?: unknown;
	/**
	 * `dcs/add-total-fields`: payload новых ресурсов одним пакетом («>>» закладки «Ресурсы») — каждый в форме payload
	 * `dcs/add-total-field` `{dataPath, expression, groups?}`.
	 */
	payloads?: unknown;
}

/** Правка СКД из сообщения webview: параметры мутации без файла и версии схемы. */
export type DcsMutation = Pick<
	MdSparrowParams,
	'op' | 'name' | 'newName' | 'dataSet' | 'dataPath' | 'variant' | 'index' | 'type' | 'dataSource' | 'payloadJson'
>;

/** Сообщения правок СКД начинаются с этого префикса. */
export const DCS_MESSAGE_PREFIX = 'dcs/';

/** Что нужно операции от сообщения: адресация строками, номер элемента и полезная нагрузка. */
export interface DcsMessageSpec {
	op: MdSparrowOp;
	/** Обязательные непустые строковые поля сообщения; уходят в одноимённые параметры. */
	strings?: ReadonlyArray<'name' | 'newName' | 'dataSet' | 'dataPath' | 'variant'>;
	/** Сообщение адресует элемент порядковым номером `index`. */
	index?: boolean;
	/** Сообщение несёт DTO полезной нагрузки `payload`. */
	payload?: boolean;
	/** Полезная нагрузка допускается, но не обязательна (представление нового варианта). */
	optionalPayload?: boolean;
}

export const DCS_MESSAGE_SPECS: Record<string, DcsMessageSpec> = {
	'dcs/add-data-set': { op: 'cf-dcs-add-data-set', strings: ['name'] },
	'dcs/remove-data-set': { op: 'cf-dcs-remove-data-set', strings: ['name'] },
	'dcs/rename-data-set': { op: 'cf-dcs-rename-data-set', strings: ['name', 'newName'] },
	'dcs/set-data-set-props': { op: 'cf-dcs-set-data-set-props', strings: ['name'], payload: true },
	'dcs/add-field': { op: 'cf-dcs-add-field', strings: ['dataSet'], payload: true },
	'dcs/set-field': { op: 'cf-dcs-set-field', strings: ['dataSet', 'dataPath'], payload: true },
	'dcs/remove-field': { op: 'cf-dcs-remove-field', strings: ['dataSet', 'dataPath'] },
	'dcs/add-link': { op: 'cf-dcs-add-link', payload: true },
	'dcs/set-link': { op: 'cf-dcs-set-link', index: true, payload: true },
	'dcs/remove-link': { op: 'cf-dcs-remove-link', index: true },
	'dcs/set-calculated-field': { op: 'cf-dcs-set-calculated-field', strings: ['dataPath'], payload: true },
	'dcs/remove-calculated-field': { op: 'cf-dcs-remove-calculated-field', strings: ['dataPath'] },
	'dcs/add-total-field': { op: 'cf-dcs-add-total-field', payload: true },
	'dcs/set-total-field': { op: 'cf-dcs-set-total-field', index: true, payload: true },
	'dcs/remove-total-field': { op: 'cf-dcs-remove-total-field', index: true },
	'dcs/add-parameter': { op: 'cf-dcs-add-parameter', payload: true },
	'dcs/set-parameter': { op: 'cf-dcs-set-parameter', strings: ['name'], payload: true },
	'dcs/remove-parameter': { op: 'cf-dcs-remove-parameter', strings: ['name'] },
	// Варианты настроек: сам вариант адресуется именем, его правки — полем variant,
	// узел внутри варианта — путём path в payload.
	'dcs/add-settings-variant': { op: 'cf-dcs-add-settings-variant', strings: ['name'], optionalPayload: true },
	'dcs/remove-settings-variant': { op: 'cf-dcs-remove-settings-variant', strings: ['name'] },
	'dcs/set-settings-variant-props': { op: 'cf-dcs-set-settings-variant-props', strings: ['name'], payload: true },
	'dcs/add-structure-item': { op: 'cf-dcs-add-structure-item', strings: ['variant'], payload: true },
	'dcs/remove-structure-item': { op: 'cf-dcs-remove-structure-item', strings: ['variant'], payload: true },
	'dcs/move-structure-item': { op: 'cf-dcs-move-structure-item', strings: ['variant'], payload: true },
	'dcs/set-group-fields': { op: 'cf-dcs-set-group-fields', strings: ['variant'], payload: true },
	'dcs/set-selection': { op: 'cf-dcs-set-selection', strings: ['variant'], payload: true },
	'dcs/set-order': { op: 'cf-dcs-set-order', strings: ['variant'], payload: true },
	'dcs/set-filter': { op: 'cf-dcs-set-filter', strings: ['variant'], payload: true },
	'dcs/set-parameter-value': { op: 'cf-dcs-set-parameter-value', strings: ['variant'], payload: true },
	'dcs/add-appearance-item': { op: 'cf-dcs-add-appearance-item', strings: ['variant'], payload: true },
	'dcs/set-appearance-item': { op: 'cf-dcs-set-appearance-item', strings: ['variant'], payload: true },
	'dcs/remove-appearance-item': { op: 'cf-dcs-remove-appearance-item', strings: ['variant'], payload: true },
	// Автозаполнение полей набора-запроса; ответ мутации несёт added/skipped
	'dcs/autofill-fields': { op: 'cf-dcs-autofill-fields', strings: ['dataSet'] },
};

/** Виды нового набора данных. */
const DCS_DATA_SET_TYPES: ReadonlySet<string> = new Set(['query', 'object', 'union']);

/**
 * Собирает правку СКД из сообщения webview `{type: 'dcs/<операция>', …поля}`.
 *
 * Тип сообщения переходит в операцию md-sparrow по правилу `dcs/<операция>` → `cf-dcs-<операция>`;
 * поля сообщений:
 * - `dcs/add-data-set` `{name, dataSetType: query|object|union, dataSource}`;
 * - `dcs/remove-data-set` `{name}`; `dcs/rename-data-set` `{name, newName}`;
 * - `dcs/set-data-set-props` `{name, payload: {autoFillFields?, dataSource?, objectName?}}`;
 * - `dcs/add-field` `{dataSet, payload: {dataPath, field, title?}}`;
 * - `dcs/set-field` `{dataSet, dataPath, payload: {newDataPath?, field?, title?, useRestriction?,
 *   attributeUseRestriction?, role?}}`; `dcs/remove-field` `{dataSet, dataPath}`;
 * - `dcs/add-link` `{payload: {sourceDataSet, destinationDataSet, sourceExpression,
 *   destinationExpression, parameter?, parameterListAllowed?, linkConditionExpression?,
 *   startExpression?}}` — `required` окно не шлёт: платформа флаг не хранит, md-sparrow на true отказывает;
 *   `parameterListAllowed` окно шлёт только `true` и только с `parameter`: «нет» у связи с параметром md-sparrow
 *   пишет сам, как платформа, а без параметра загрузка флажок не хранит;
 * - `dcs/set-link` `{index, payload}` и `dcs/remove-link` `{index}` — связь адресуется номером; в payload
 *   правки `required` бывает только `false` (снять флажок, записанный в файле), `parameterListAllowed` — `true` или
 *   `false` у связи с параметром и `null` у связи без параметра (снять флаг вместе с параметром или флаг, записанный
 *   без параметра: без параметра загрузка его не хранит);
 * - `dcs/set-calculated-field` `{dataPath, payload: {newDataPath?, expression?, title?}}`;
 *   `dcs/remove-calculated-field` `{dataPath}`;
 * - `dcs/add-total-field` `{payload: {dataPath, expression, groups?}}`;
 *   `dcs/set-total-field` `{index, payload}`; `dcs/remove-total-field` `{index}`;
 * - `dcs/add-parameter` `{payload: {name, title?, expression?, use?, useRestriction?}}`;
 *   `dcs/set-parameter` `{name, payload: {newName?, …}}`; `dcs/remove-parameter` `{name}`.
 *
 * Варианты настроек:
 * - `dcs/add-settings-variant` `{name, payload?: {presentation?}}`;
 * - `dcs/remove-settings-variant` `{name}`;
 * - `dcs/set-settings-variant-props` `{name, payload: {newName?, presentation?}}`;
 * - правки внутри варианта адресуются `{variant}`, узел — путём в payload:
 *   `dcs/add-structure-item` `{variant, payload: {parentPath, list, index?, kind?, groupFields?}}`;
 *   `dcs/remove-structure-item` `{variant, payload: {path}}`;
 *   `dcs/move-structure-item` `{variant, payload: {path, newIndex}}`;
 *   `dcs/set-group-fields`, `dcs/set-selection`, `dcs/set-order`, `dcs/set-filter` —
 *   `{variant, payload: {path, items}}` (замена списка целиком);
 *   `dcs/set-parameter-value` `{variant, payload: {section, path?, parameter, value?, use?, remove?}}`;
 *   `dcs/add-appearance-item` `{variant, payload: {path, index?, item}}`;
 *   `dcs/set-appearance-item` `{variant, payload: {path, index, item}}`;
 *   `dcs/remove-appearance-item` `{variant, payload: {path, index}}`.
 * Автозаполнение: `dcs/autofill-fields` `{dataSet}` — заполнение полей набора-запроса по его тексту.
 * Нутро payload маппер не проверяет — пути, номера и элементы валидирует md-sparrow.
 *
 * @param message Сообщение webview.
 * @returns Параметры мутации без файла и версии схемы; undefined — сообщение не разобрано.
 */
export function dcsMutationOf(message: DcsPanelMessage): DcsMutation | undefined {
	const spec = DCS_MESSAGE_SPECS[message.type ?? ''];
	if (!spec) {
		return undefined;
	}
	const mutation: DcsMutation = { op: spec.op };
	for (const field of spec.strings ?? []) {
		const value = message[field];
		if (typeof value !== 'string' || value === '') {
			return undefined;
		}
		mutation[field] = value;
	}
	if (spec.index) {
		if (typeof message.index !== 'number' || !Number.isInteger(message.index) || message.index < 0) {
			return undefined;
		}
		mutation.index = message.index;
	}
	if (spec.payload || (spec.optionalPayload && message.payload !== undefined)) {
		if (typeof message.payload !== 'object' || message.payload === null || Array.isArray(message.payload)) {
			return undefined;
		}
		mutation.payloadJson = JSON.stringify(message.payload);
	}
	if (spec.op === 'cf-dcs-add-data-set') {
		// Поля нового набора лежат в самом сообщении: вид набора и источник обязательны
		if (
			!DCS_DATA_SET_TYPES.has(message.dataSetType ?? '') ||
			typeof message.dataSource !== 'string' ||
			message.dataSource === ''
		) {
			return undefined;
		}
		mutation.type = message.dataSetType;
		mutation.dataSource = message.dataSource;
	}
	return mutation;
}

/**
 * Вариант, настройки которого панель перечитывает после удачной правки.
 *
 * Правки внутри варианта возвращают его адрес, добавление — имя нового варианта, правка свойств —
 * новое имя после переименования (иначе прежнее). После удаления варианта перечитывать нечего,
 * как и после правок самой схемы — там настройки вариантов не меняются.
 *
 * @param mutation Разобранная правка СКД (см. {@link dcsMutationOf}).
 * @returns Имя варианта для cf-dcs-settings-info; undefined — настройки не перечитываются.
 */
export function dcsAffectedSettingsVariant(mutation: DcsMutation): string | undefined {
	if (mutation.variant !== undefined) {
		return mutation.variant;
	}
	if (mutation.op === 'cf-dcs-add-settings-variant') {
		return mutation.name;
	}
	if (mutation.op === 'cf-dcs-set-settings-variant-props') {
		// payloadJson собран маппером из объекта — разбирается без отказа
		const payload = JSON.parse(mutation.payloadJson ?? '{}') as { newName?: unknown };
		return typeof payload.newName === 'string' && payload.newName !== '' ? payload.newName : mutation.name;
	}
	return undefined;
}

// ------------------------------------------------------------------ пакеты операций

/**
 * Канал пакета `apply-mutation op:"batch"` — вид составной правки, по которому выбирается белый
 * каталог её операций: `settings` — конструктор настроек, `query` — конструктор запроса, `totals` — ресурсы
 * пачкой на закладке «Ресурсы»: удаление «<<» и добавление «>>».
 */
export type DcsBatchChannel = 'settings' | 'query' | 'totals';

/** Операция пакета: правка СКД без файла и версии схемы; набор запроса адресуется tag, как у cf-dcs-set-query. */
export type DcsBatchMutation = DcsMutation & Pick<MdSparrowParams, 'tag'>;

/** Разобранный пакет либо отказ в форме md-sparrow «Операция N (имя): причина». */
export type DcsBatchMapping = { mutations: DcsBatchMutation[]; variant: string } | { error: string };

/** Сообщение конструктора настроек: пакет правок одного варианта, а не одна правка. */
export const DCS_SETTINGS_WIZARD_MESSAGE = 'dcs/settings-wizard';

/** Создание варианта: в пакете мастера — только первой операцией (путь «В новый вариант…»). */
const ADD_VARIANT_OP: MdSparrowOp = 'cf-dcs-add-settings-variant';

/**
 * Белые каталоги пакетов по каналу.
 *
 * Мастер настроек правит один вариант: в каталог входят мутации варианта, адресованные полем variant,
 * и создание варианта. Удаление и переименование варианта сюда не входят — мастер их не делает, а
 * переименование посреди пакета сбило бы адрес следующих операций. Каталог выводится из спеков
 * сообщений, чтобы новая мутация варианта не разошлась с пакетом.
 *
 * Конструктор запроса пишет текст набора, недостающие параметры и автозаполнение полей — правки
 * схемы, а не варианта: в пакет мастера они не попадают, как и правки варианта — в пакет запроса.
 */
export const DCS_BATCH_OPS: Readonly<Record<DcsBatchChannel, ReadonlySet<MdSparrowOp>>> = {
	settings: new Set<MdSparrowOp>([
		ADD_VARIANT_OP,
		...Object.values(DCS_MESSAGE_SPECS)
			.filter((spec) => spec.strings?.includes('variant') === true)
			.map((spec) => spec.op),
	]),
	query: new Set<MdSparrowOp>(['cf-dcs-set-query', 'cf-dcs-add-parameter', 'cf-dcs-autofill-fields']),
	totals: new Set<MdSparrowOp>(['cf-dcs-remove-total-field', 'cf-dcs-add-total-field']),
};

const BATCH_CHANNEL_LABELS: Readonly<Record<DcsBatchChannel, string>> = {
	settings: 'конструктора настроек',
	query: 'конструктора запроса',
	totals: 'ресурсов',
};

/** Тип сообщения панели по операции: поля операции пакета разбирает тот же маппер, что одиночные правки. */
const MESSAGE_TYPE_BY_OP: ReadonlyMap<string, string> = new Map(
	Object.entries(DCS_MESSAGE_SPECS).map(([type, spec]) => [spec.op, type])
);

/**
 * Поля операции пакета мастера — адрес и payload. Файл, версию схемы и флаги пакета (dryRun,
 * ignoreSupport) подставляет панель: из webview они не принимаются.
 */
const VARIANT_OPERATION_FIELDS: ReadonlySet<string> = new Set(['op', 'variant', 'payload']);
const ADD_VARIANT_FIELDS: ReadonlySet<string> = new Set(['op', 'name', 'payload']);

/** Отказ с номером операции от единицы и её именем — так отвечает и md-sparrow, текст не зависит от того, кто отказал. */
function batchRefusal(index: number, op: string | undefined, reason: string): { error: string } {
	return { error: `Операция ${index + 1}${op ? ` (${op})` : ''}: ${reason}` };
}

/**
 * Разбирает пакет конструктора настроек `{type: 'dcs/settings-wizard', variant, operations}`.
 *
 * Операции — формы мутаций варианта (`{op, variant, payload}`), первой может идти
 * `{op: 'cf-dcs-add-settings-variant', name, payload?}` с name, равным variant пакета. Проверки до
 * запуска jar: операция из каталога {@link DCS_BATCH_OPS}.settings, вариант у всех один, создание
 * варианта — только первым, лишних полей нет, адрес и payload разбираются маппером одиночных правок
 * ({@link dcsMutationOf}). Нутро payload проверяет md-sparrow.
 *
 * @param message Сообщение webview.
 * @returns Правки пакета и вариант для перечитки либо отказ «Операция N (имя): причина».
 */
export function dcsSettingsWizardBatchOf(message: DcsPanelMessage): DcsBatchMapping {
	const variant = message.variant;
	if (typeof variant !== 'string' || variant === '') {
		return { error: 'Пакет конструктора настроек не разобран: не назван вариант настроек.' };
	}
	const operations = message.operations;
	if (!Array.isArray(operations) || operations.length === 0) {
		return { error: 'Пакет конструктора настроек не разобран: в нём нет операций.' };
	}
	const catalog = DCS_BATCH_OPS.settings;
	const mutations: DcsBatchMutation[] = [];
	for (let index = 0; index < operations.length; index += 1) {
		const raw: unknown = operations[index];
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
			return batchRefusal(index, undefined, 'операция должна быть объектом.');
		}
		const fields = raw as Record<string, unknown>;
		const op = fields.op;
		if (typeof op !== 'string' || op === '') {
			return batchRefusal(index, undefined, 'не задано имя операции (op).');
		}
		if (!catalog.has(op as MdSparrowOp)) {
			return batchRefusal(index, op, `не входит в каталог правок ${BATCH_CHANNEL_LABELS.settings}.`);
		}
		const adding = op === ADD_VARIANT_OP;
		const foreign = Object.keys(fields).find((key) => !(adding ? ADD_VARIANT_FIELDS : VARIANT_OPERATION_FIELDS).has(key));
		if (foreign !== undefined) {
			return batchRefusal(index, op, `поле «${foreign}» в операции пакета не задаётся.`);
		}
		if (adding) {
			if (index > 0) {
				return batchRefusal(index, op, 'новый вариант создаётся только первой операцией пакета.');
			}
			if (fields.name !== variant) {
				return batchRefusal(
					index,
					op,
					`имя нового варианта «${String(fields.name ?? '')}» не совпадает с вариантом пакета «${variant}».`
				);
			}
		} else if (fields.variant !== variant) {
			return batchRefusal(
				index,
				op,
				typeof fields.variant === 'string' && fields.variant !== ''
					? `вариант «${fields.variant}» не совпадает с вариантом пакета «${variant}».`
					: 'не назван вариант настроек (variant).'
			);
		}
		const type = MESSAGE_TYPE_BY_OP.get(op);
		const mutation = type === undefined ? undefined : dcsMutationOf({ ...fields, type } as DcsPanelMessage);
		if (!mutation) {
			return batchRefusal(
				index,
				op,
				adding ? 'payload, если задан, должен быть объектом.' : 'нужен payload (объект полезной нагрузки).'
			);
		}
		mutations.push(mutation);
	}
	return { mutations, variant };
}

/**
 * Проверка пакета перед запуском: операции есть и каждая — из каталога канала. Пакет мастера уже
 * разобран {@link dcsSettingsWizardBatchOf}, пакет конструктора запроса собирает сама панель
 * ({@link dcsQueryBatchOf}) — проверка общая, чтобы канал не пропустил в jar чужую правку ни из
 * сообщения, ни из кода.
 *
 * У канала запроса ещё два правила: все операции с адресом набора (текст и автозаполнение) смотрят
 * в один набор — в первый названный, и новый параметр объявляется только именем. Пакет пишет один
 * запрос: правка соседнего набора посреди него — ошибка сборки, а не воля пользователя, а тип
 * нового параметра конструктор не задаёт.
 *
 * @returns Текст отказа; undefined — пакет можно запускать.
 */
export function dcsBatchProblem(channel: DcsBatchChannel, mutations: readonly DcsBatchMutation[]): string | undefined {
	if (mutations.length === 0) {
		return `Пакет ${BATCH_CHANNEL_LABELS[channel]} пуст: в нём нет операций.`;
	}
	const catalog = DCS_BATCH_OPS[channel];
	let dataSet: string | undefined;
	for (let index = 0; index < mutations.length; index += 1) {
		const mutation = mutations[index];
		const op = mutation.op;
		if (!catalog.has(op)) {
			return batchRefusal(index, op, `не входит в каталог правок ${BATCH_CHANNEL_LABELS[channel]}.`).error;
		}
		if (channel !== 'query') {
			continue;
		}
		if (op === 'cf-dcs-add-parameter') {
			const problem = queryParameterProblem(mutation.payloadJson);
			if (problem !== undefined) {
				return batchRefusal(index, op, problem).error;
			}
			continue;
		}
		// Текст набора адресуется tag, автозаполнение — dataSet: оба — путь набора от корня схемы
		const address = op === 'cf-dcs-set-query' ? mutation.tag : mutation.dataSet;
		if (typeof address !== 'string' || address === '') {
			return batchRefusal(index, op, 'не назван набор данных.').error;
		}
		if (dataSet === undefined) {
			dataSet = address;
		} else if (address !== dataSet) {
			return batchRefusal(index, op, `набор «${address}» не совпадает с набором пакета «${dataSet}».`).error;
		}
	}
	return undefined;
}

/** Новый параметр пакета запроса: payload — объект ровно с одним полем name (идентификатор). */
function queryParameterProblem(payloadJson: string | undefined): string | undefined {
	let payload: unknown;
	try {
		payload = JSON.parse(payloadJson ?? '');
	} catch {
		return 'нужен payload (объект с именем параметра).';
	}
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		return 'нужен payload (объект с именем параметра).';
	}
	const fields = payload as Record<string, unknown>;
	const foreign = Object.keys(fields).find((key) => key !== 'name');
	if (foreign !== undefined) {
		return `поле «${foreign}» конструктор запроса не задаёт: новый параметр объявляется только именем.`;
	}
	if (typeof fields.name !== 'string' || !MD_NAME_RE.test(fields.name)) {
		return `«${String(fields.name ?? '')}» это не имя параметра.`;
	}
	return undefined;
}

/**
 * Параметры apply-mutation для пакета: файл схемы и версия подставляются в каждую операцию, payload
 * уже строкой. ignoreSupport, когда поддержка выключена, ставит запуск — у пакета целиком
 * (md-sparrow отказывает, если поле есть у операции).
 */
export function dcsBatchParamsOf(
	mutations: readonly DcsBatchMutation[],
	objectXml: string,
	schemaVersion: string
): MdSparrowParams {
	return { op: 'batch', operations: mutations.map((mutation) => ({ ...mutation, objectXml, schemaVersion })) };
}

// ------------------------------------------------------------------ ресурсы пачкой: «<<» и «>>»

/** Сообщение «<<» закладки «Ресурсы»: удалить ресурсы с этими номерами одним пакетом. */
export const DCS_REMOVE_TOTAL_FIELDS_MESSAGE = 'dcs/remove-total-fields';

/**
 * Разбирает `{type: 'dcs/remove-total-fields', indexes}` в пакет `cf-dcs-remove-total-field`. Номера — непустой список
 * разных целых ≥ 0; операции идут от большего номера к меньшему: удаление ресурса сдвигает номера тех, что за ним, и
 * прямой порядок удалил бы не те. Пакет атомарен: номер вне списка ресурсов md-sparrow отклонит, и файл не
 * изменится вовсе — частичного удаления не бывает.
 *
 * @param message Сообщение webview.
 * @returns Операции пакета канала totals либо отказ.
 */
export function dcsRemoveTotalFieldsBatchOf(message: DcsPanelMessage): { mutations: DcsBatchMutation[] } | { error: string } {
	const raw = message.indexes;
	if (!Array.isArray(raw) || raw.length === 0) {
		return { error: 'Ресурсы не удалены: не названы номера ресурсов (indexes).' };
	}
	const indexes: number[] = [];
	for (const value of raw) {
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
			return { error: `Ресурсы не удалены: «${String(value)}» это не номер ресурса.` };
		}
		if (indexes.includes(value)) {
			return { error: `Ресурсы не удалены: номер ${value} назван дважды.` };
		}
		indexes.push(value);
	}
	indexes.sort((a, b) => b - a);
	return { mutations: indexes.map((index): DcsBatchMutation => ({ op: 'cf-dcs-remove-total-field', index })) };
}

/** Сообщение «>>» закладки «Ресурсы»: добавить ресурсы по этим полям одним пакетом. */
export const DCS_ADD_TOTAL_FIELDS_MESSAGE = 'dcs/add-total-fields';

/** Поля payload нового ресурса — те же, что у одиночного `dcs/add-total-field`. */
const TOTAL_FIELD_PAYLOAD_KEYS: ReadonlySet<string> = new Set(['dataPath', 'expression', 'groups']);

/**
 * Разбирает `{type: 'dcs/add-total-fields', payloads}` в пакет `cf-dcs-add-total-field` — «>>» закладки «Ресурсы».
 * payloads — непустой список payload в форме одиночного `dcs/add-total-field`: `{dataPath, expression, groups?}`, поле и
 * выражение — непустые строки, groups — список непустых строк, других полей нет. Ресурсы встают в конец списка в том же
 * порядке. Пакет атомарен: если md-sparrow отклонит хоть один ресурс, файл не изменится вовсе.
 *
 * @param message Сообщение webview.
 * @returns Операции пакета канала totals либо отказ.
 */
export function dcsAddTotalFieldsBatchOf(message: DcsPanelMessage): { mutations: DcsBatchMutation[] } | { error: string } {
	const raw = message.payloads;
	if (!Array.isArray(raw) || raw.length === 0) {
		return { error: 'Ресурсы не добавлены: не названы новые ресурсы (payloads).' };
	}
	const mutations: DcsBatchMutation[] = [];
	for (let index = 0; index < raw.length; index += 1) {
		const problem = totalFieldPayloadProblem(raw[index]);
		if (problem !== undefined) {
			return { error: `Ресурсы не добавлены, ресурс ${index + 1}: ${problem}` };
		}
		mutations.push({ op: 'cf-dcs-add-total-field', payloadJson: JSON.stringify(raw[index]) });
	}
	return { mutations };
}

/** Что не так с payload нового ресурса пакета; undefined — форма верна (нутро — поле и выражение — проверяет md-sparrow). */
function totalFieldPayloadProblem(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return 'не объект.';
	}
	const fields = value as Record<string, unknown>;
	const foreign = Object.keys(fields).find((key) => !TOTAL_FIELD_PAYLOAD_KEYS.has(key));
	if (foreign !== undefined) {
		return `поле «${foreign}» у ресурса не задаётся.`;
	}
	if (typeof fields.dataPath !== 'string' || fields.dataPath.trim() === '') {
		return 'не задано поле (dataPath).';
	}
	if (typeof fields.expression !== 'string' || fields.expression.trim() === '') {
		return 'не задано выражение (expression).';
	}
	if (
		fields.groups !== undefined &&
		(!Array.isArray(fields.groups) || fields.groups.some((group) => typeof group !== 'string' || group === ''))
	) {
		return '«Рассчитывать по» (groups) задано не списком полей.';
	}
	return undefined;
}

// ------------------------------------------------------------------ запись конструктора запроса

/** Сообщение конструктора запроса: текст набора, недостающие параметры и автозаполнение одним пакетом. */
export const DCS_APPLY_QUERY_MESSAGE = 'dcs/apply-query';

/** Разобранный `dcs/apply-query`: путь набора, новый текст, имена параметров к объявлению, автозаполнение. */
export interface DcsApplyQueryRequest {
	/** Путь набора от корня схемы: имя набора верхнего уровня или `Объединение/Дочерний`. */
	dataSet: string;
	text: string;
	addParameters: string[];
	autofill: boolean;
}

/**
 * Разбирает `{type: 'dcs/apply-query', dataSet, text, addParameters?, autofill?}`.
 *
 * Поля сообщения проверяются по форме: набор — непустой путь без пустых звеньев, текст — строка,
 * addParameters — массив имён-идентификаторов (без `&`), autofill — булево. Что набор есть и что
 * он запрос, сверяет уже панель по свежей модели (dcsQueryDataSetProblem).
 */
export function dcsApplyQueryRequestOf(message: DcsPanelMessage): DcsApplyQueryRequest | { error: string } {
	const dataSet = typeof message.dataSet === 'string' ? message.dataSet.trim() : '';
	if (dataSet === '' || dataSet.split('/').some((part) => part.trim() === '')) {
		return { error: 'Запрос не записан: не назван набор данных (dataSet: имя или путь «Объединение/Дочерний»).' };
	}
	if (typeof message.text !== 'string') {
		return { error: 'Запрос не записан: нет текста запроса (text).' };
	}
	const rawNames = message.addParameters ?? [];
	if (!Array.isArray(rawNames)) {
		return { error: 'Запрос не записан: addParameters должен быть списком имён параметров.' };
	}
	const addParameters: string[] = [];
	for (const raw of rawNames) {
		if (typeof raw !== 'string' || !MD_NAME_RE.test(raw)) {
			return { error: `Запрос не записан: «${String(raw)}» это не имя параметра (без «&», буквы, цифры и _).` };
		}
		addParameters.push(raw);
	}
	if (message.autofill !== undefined && typeof message.autofill !== 'boolean') {
		return { error: 'Запрос не записан: autofill должен быть булевым значением.' };
	}
	return { dataSet, text: message.text, addParameters, autofill: message.autofill === true };
}

/** Набор схемы для адресации запроса: только поля, которые нужны проверке. */
interface QueryAddressedDataSet {
	name?: string;
	type?: string;
	items?: QueryAddressedDataSet[];
	query?: string;
	autoFillFields?: boolean;
}

/**
 * Набор по пути так, как его ищет cf-dcs-set-query: имя без `/` — только среди наборов
 * верхнего уровня, путь — по звеньям через вложенные наборы объединений.
 */
export function dcsQueryDataSetOf(info: unknown, dataSet: string): QueryAddressedDataSet | undefined {
	const parts = dataSet.split('/');
	let level = (info as { dataSets?: unknown } | null)?.dataSets;
	let found: QueryAddressedDataSet | undefined;
	for (const part of parts) {
		if (!Array.isArray(level)) {
			return undefined;
		}
		found = (level as QueryAddressedDataSet[]).find((item) => typeof item === 'object' && item !== null && item.name === part);
		if (!found) {
			return undefined;
		}
		level = found.items;
	}
	return found;
}

/**
 * Почему в набор нельзя записать запрос: его нет, это объединение (текст ушёл бы в первый дочерний —
 * запись не туда) или набор-объект. undefined — набор-запрос найден.
 */
export function dcsQueryDataSetProblem(info: unknown, dataSet: string): string | undefined {
	const found = dcsQueryDataSetOf(info, dataSet);
	if (!found) {
		return `Набор данных «${dataSet}» не найден: имя без «/» ищется среди наборов верхнего уровня, вложенный набор адресуется путём «Объединение/Дочерний».`;
	}
	if (found.type === 'union') {
		return `Набор «${dataSet}» это объединение: запрос пишется в его дочерний набор, укажите путь «${dataSet}/<Дочерний>».`;
	}
	if (found.type !== undefined && found.type !== 'query') {
		return `Набор «${dataSet}» это не набор-запрос: текста запроса у него нет.`;
	}
	return undefined;
}

/** Имена параметров схемы из модели cf-dcs-info: с ними сверяются новые параметры запроса. */
export function dcsDeclaredParameterNames(info: unknown): string[] {
	const parameters = (info as { parameters?: unknown } | null)?.parameters;
	if (!Array.isArray(parameters)) {
		return [];
	}
	return parameters
		.map((parameter) => (typeof parameter === 'object' && parameter !== null ? (parameter as { name?: unknown }).name : undefined))
		.filter((name): name is string => typeof name === 'string' && name !== '');
}

/**
 * Пакет записи конструктора запроса: `cf-dcs-set-query` (текст в набор по пути), затем
 * `cf-dcs-add-parameter` с одним именем на каждый новый параметр и, если просили,
 * `cf-dcs-autofill-fields` по новому тексту — в этом порядке: автозаполнение читает уже записанный
 * запрос.
 *
 * Имена параметров сверяются без учёта регистра — как их различает язык запросов и md-sparrow:
 * уже объявленные и повторы в самом списке пропускаются, а не уходят в jar отказом.
 * Тип нового параметра не задаётся.
 *
 * @param request Разобранный запрос записи ({@link dcsApplyQueryRequestOf}).
 * @param declared Имена параметров, уже объявленных в схеме.
 * @returns Операции пакета и имена параметров, которые он объявит.
 */
export function dcsQueryBatchOf(
	request: DcsApplyQueryRequest,
	declared: readonly string[]
): { mutations: DcsBatchMutation[]; addedParameters: string[] } {
	const taken = new Set(declared.map(upperName));
	const addedParameters: string[] = [];
	for (const name of request.addParameters) {
		const key = upperName(name);
		if (!taken.has(key)) {
			taken.add(key);
			addedParameters.push(name);
		}
	}
	const mutations: DcsBatchMutation[] = [{ op: 'cf-dcs-set-query', tag: request.dataSet, payloadJson: request.text }];
	for (const name of addedParameters) {
		mutations.push({ op: 'cf-dcs-add-parameter', payloadJson: JSON.stringify({ name }) });
	}
	if (request.autofill) {
		mutations.push({ op: 'cf-dcs-autofill-fields', dataSet: request.dataSet });
	}
	return { mutations, addedParameters };
}

/** Ответ пакета — JSON-массив ответов операций строками в их порядке; не массив строк — undefined. */
export function dcsBatchAnswersOf(stdout: string): string[] | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout.trim());
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
		return undefined;
	}
	return parsed as string[];
}

/**
 * Итог автозаполнения из ответа правки: у одиночной cf-dcs-autofill-fields — весь stdout, у пакета —
 * ответ его операции автозаполнения (пакет конструктора запроса). Правки без автозаполнения — undefined.
 */
export function dcsAutofillOfResult(params: MdSparrowParams, stdout: string): DcsAutofillResultDto | undefined {
	if (params.op === 'cf-dcs-autofill-fields') {
		return dcsAutofillResultOf(stdout);
	}
	if (params.op !== 'batch') {
		return undefined;
	}
	const index = (params.operations ?? []).findIndex((operation) => operation.op === 'cf-dcs-autofill-fields');
	if (index < 0) {
		return undefined;
	}
	const answer = dcsBatchAnswersOf(stdout)?.[index];
	return answer === undefined ? undefined : dcsAutofillResultOf(answer);
}

/** Итог автозаполнения полей: добавленные пути и пропущенные выражения с причинами. */
export interface DcsAutofillResultDto {
	added: string[];
	skipped: Array<{ expression?: string; reason?: string }>;
}

/**
 * Разбирает ответ мутации cf-dcs-autofill-fields: `{added, skipped}` из stdout.
 *
 * Ответ разбирается терпимо: недостающие списки становятся пустыми, а не-JSON — undefined,
 * потому что правка уже применена и падать из-за формы ответа поздно.
 *
 * @param stdout Вывод apply-mutation.
 * @returns Итог для плашки webview; undefined — ответ не разобран.
 */
export function dcsAutofillResultOf(stdout: string): DcsAutofillResultDto | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout.trim());
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return undefined;
	}
	const raw = parsed as { added?: unknown; skipped?: unknown };
	const added = Array.isArray(raw.added) ? raw.added.filter((item): item is string => typeof item === 'string') : [];
	const skipped = Array.isArray(raw.skipped)
		? raw.skipped
				.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
				.map((item) => ({
					expression: typeof item.expression === 'string' ? item.expression : undefined,
					reason: typeof item.reason === 'string' ? item.reason : undefined,
				}))
		: [];
	return { added, skipped };
}

/** Ошибка строгой проверки схемы; строка и колонка — когда валидатор их назвал. */
export interface DcsValidationErrorDto {
	message?: string;
	line?: number;
	column?: number;
}

/**
 * Предупреждение строгой проверки: на `ok` не влияет. `kind` — вид:
 * `undeclaredQueryParameter` (с `dataSet`), `valueListPresentationsLost` (список значений
 * параметра схемы старой записи, чьи представления потеряет загрузка) или `linkListFlagWithoutParameter`
 * (флажок «Список параметров» у связи без параметра: вместо `parameter` — `link`, номер связи с нуля).
 */
export interface DcsValidationWarningDto {
	message?: string;
	parameter?: string;
	dataSet?: string;
	link?: number;
	kind?: string;
}

/** Вердикт строгой проверки для webview. */
export interface DcsValidationDto {
	ok: boolean;
	errors: DcsValidationErrorDto[];
	warnings: DcsValidationWarningDto[];
}

/** Строковое поле объекта ответа или undefined. */
function stringField(item: Record<string, unknown>, key: string): string | undefined {
	const value = item[key];
	return typeof value === 'string' ? value : undefined;
}

/**
 * Разбирает ответ cf-dcs-validate в вердикт для плашки webview.
 *
 * Строгий режим отвечает `{ok, errors: [{message, line?, column?}], warnings: [{message, parameter?,
 * dataSet?, link?, kind?}]}`.
 *
 * @param stdout Вывод read-json.
 * @returns Вердикт; `{error}` — ответ не разобран.
 */
export function dcsValidationOf(stdout: string): DcsValidationDto | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout.trim());
	} catch {
		return { error: 'Ответ проверки схемы не разобран.' };
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return { error: 'Ответ проверки схемы не разобран.' };
	}
	const raw = parsed as { ok?: unknown; errors?: unknown; warnings?: unknown };
	if (typeof raw.ok === 'boolean') {
		const errors = Array.isArray(raw.errors)
			? raw.errors
					.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
					.map((item) => ({
						message: typeof item.message === 'string' ? item.message : undefined,
						line: typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : undefined,
						column: typeof item.column === 'number' && Number.isFinite(item.column) ? item.column : undefined,
					}))
			: [];
		const warnings = Array.isArray(raw.warnings)
			? raw.warnings
					.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
					.map((item) => ({
						message: stringField(item, 'message'),
						parameter: stringField(item, 'parameter'),
						dataSet: stringField(item, 'dataSet'),
						// Номер связи — только у предупреждения о связи: прочим ключ не добавляется
						...(typeof item.link === 'number' && Number.isInteger(item.link) && item.link >= 0 ? { link: item.link } : {}),
						kind: stringField(item, 'kind'),
					}))
			: [];
		return { ok: raw.ok, errors, warnings };
	}
	return { error: 'Ответ проверки схемы не разобран.' };
}

/** Объект конфигурации в дереве конструктора запроса. */
export interface DcsMetadataObjectDto {
	objectType: string;
	name: string;
	/** Путь описания объекта от корня выгрузки: адрес для раскрытия структуры. */
	relativePath: string;
	synonym?: string;
}

/** Группа дерева объектов конструктора запроса: подпись и объекты. */
export interface DcsMetadataGroupDto {
	label: string;
	items: DcsMetadataObjectDto[];
}

/** Элемент дерева метаданных md-sparrow; форма не проверяется заранее — поля читаются терпимо. */
interface RawMetadataItem {
	objectType?: unknown;
	name?: unknown;
	relativePath?: unknown;
	synonym?: unknown;
}

/** Объекты группы дерева: без имени, вида или файла объект в диалог не попадает. */
function metadataItemsOf(rawItems: unknown): DcsMetadataObjectDto[] {
	if (!Array.isArray(rawItems)) {
		return [];
	}
	const items: DcsMetadataObjectDto[] = [];
	for (const raw of rawItems as RawMetadataItem[]) {
		if (typeof raw !== 'object' || raw === null) {
			continue;
		}
		const { objectType, name, relativePath, synonym } = raw;
		if (
			typeof objectType !== 'string' ||
			objectType === '' ||
			typeof name !== 'string' ||
			name === '' ||
			typeof relativePath !== 'string' ||
			relativePath === ''
		) {
			continue;
		}
		items.push({
			objectType,
			name,
			relativePath,
			synonym: typeof synonym === 'string' && synonym !== '' ? synonym : undefined,
		});
	}
	return items;
}

/**
 * Группы дерева объектов для диалога конструктора из ответа project-metadata-tree.
 *
 * Группы всех источников идут подряд, подгруппы «Общих» становятся своими группами —
 * диалогу хватает плоского списка. Пустые после отбора группы не показываются; отбор
 * по виду объекта (есть ли у него таблица запроса) делает webview, у которого живёт
 * таблица соответствий видов.
 *
 * @param parsed Разобранный JSON ответа project-metadata-tree.
 * @returns Группы с объектами; кривой ответ даёт пустой список.
 */
export function dcsMetadataGroupsOf(parsed: unknown): DcsMetadataGroupDto[] {
	if (typeof parsed !== 'object' || parsed === null) {
		return [];
	}
	const sources = (parsed as { sources?: unknown }).sources;
	if (!Array.isArray(sources)) {
		return [];
	}
	const groups: DcsMetadataGroupDto[] = [];
	const push = (label: unknown, items: unknown): void => {
		const mapped = metadataItemsOf(items);
		if (mapped.length > 0) {
			groups.push({ label: typeof label === 'string' && label !== '' ? label : 'Объекты', items: mapped });
		}
	};
	for (const source of sources) {
		if (typeof source !== 'object' || source === null) {
			continue;
		}
		const sourceGroups = (source as { groups?: unknown }).groups;
		if (!Array.isArray(sourceGroups)) {
			continue;
		}
		for (const group of sourceGroups) {
			if (typeof group !== 'object' || group === null) {
				continue;
			}
			const { label, items, subgroups } = group as { label?: unknown; items?: unknown; subgroups?: unknown };
			push(label, items);
			if (!Array.isArray(subgroups)) {
				continue;
			}
			for (const subgroup of subgroups) {
				if (typeof subgroup !== 'object' || subgroup === null) {
					continue;
				}
				const sub = subgroup as { label?: unknown; items?: unknown };
				push(sub.label, sub.items);
			}
		}
	}
	return groups;
}

/**
 * Ветки дерева «База данных» конструктора запроса: виды объектов с таблицами языка запросов в порядке
 * веток конструктора конфигуратора (критерии отбора первыми, последовательности — сразу после
 * документов) и подписи веток. В списке только виды, таблицы которых описывает cf-md-query-tables:
 * внешних источников данных нет, а узел без полей в дереве только путал бы.
 */
export const DCS_QUERY_TREE_KINDS: ReadonlyArray<{ objectType: string; label: string }> = [
	{ objectType: 'FilterCriterion', label: 'Критерии отбора' },
	{ objectType: 'ExchangePlan', label: 'Планы обмена' },
	{ objectType: 'Constant', label: 'Константы' },
	{ objectType: 'Catalog', label: 'Справочники' },
	{ objectType: 'Document', label: 'Документы' },
	{ objectType: 'Sequence', label: 'Последовательности' },
	{ objectType: 'DocumentJournal', label: 'Журналы документов' },
	{ objectType: 'Enum', label: 'Перечисления' },
	{ objectType: 'ChartOfCharacteristicTypes', label: 'Планы видов характеристик' },
	{ objectType: 'ChartOfAccounts', label: 'Планы счетов' },
	{ objectType: 'ChartOfCalculationTypes', label: 'Планы видов расчета' },
	{ objectType: 'InformationRegister', label: 'Регистры сведений' },
	{ objectType: 'AccumulationRegister', label: 'Регистры накопления' },
	{ objectType: 'AccountingRegister', label: 'Регистры бухгалтерии' },
	{ objectType: 'CalculationRegister', label: 'Регистры расчета' },
	{ objectType: 'BusinessProcess', label: 'Бизнес-процессы' },
	{ objectType: 'Task', label: 'Задачи' },
];

/** Группа дерева конструктора запроса: вид объектов (objectType) задаёт и порядок, и таблицы. */
export interface DcsQueryTreeGroupDto extends DcsMetadataGroupDto {
	objectType: string;
}

/**
 * Дерево «База данных» из ответа project-metadata-tree: только виды {@link DCS_QUERY_TREE_KINDS} и в
 * их порядке, по группе на вид. Дерево md-sparrow раскладывает объекты по-своему (планы обмена и
 * критерии отбора — в «Общих», последовательности — подгруппой под документами), поэтому объекты
 * собираются по виду, а не по группам ответа. Порядок объектов внутри вида — как в ответе.
 */
export function dcsQueryMetadataGroupsOf(parsed: unknown): DcsQueryTreeGroupDto[] {
	const byType = new Map<string, DcsMetadataObjectDto[]>();
	for (const group of dcsMetadataGroupsOf(parsed)) {
		for (const item of group.items) {
			const items = byType.get(item.objectType) ?? [];
			items.push(item);
			byType.set(item.objectType, items);
		}
	}
	const groups: DcsQueryTreeGroupDto[] = [];
	for (const kind of DCS_QUERY_TREE_KINDS) {
		const items = byType.get(kind.objectType);
		if (items && items.length > 0) {
			groups.push({ label: kind.label, objectType: kind.objectType, items });
		}
	}
	return groups;
}

// ------------------------------------------------------------------ таблицы языка запросов объекта

/** Чтение таблиц языка запросов объекта по файлу из дерева конструктора: ответ cf-md-query-tables. */
export const DCS_QUERY_TABLES_MESSAGE = 'dcs/query-tables';

/**
 * Язык имён в ответе cf-md-query-tables из сообщения: без поля — `ru` (как пишет конструктор
 * русской конфигурации), иначе только `ru` или `en`; прочее — undefined (отказ).
 */
export function dcsQueryLangOf(message: DcsPanelMessage): 'ru' | 'en' | undefined {
	if (message.lang === undefined || message.lang === '') {
		return 'ru';
	}
	return message.lang === 'ru' || message.lang === 'en' ? message.lang : undefined;
}

/**
 * Разбирает `{type: 'dcs/query-tables', relativePath, lang?}`: путь файла объекта от корня выгрузки
 * (relativePath дерева) и язык ответа. Путь проверяется только по форме — выход за выгрузку, которую
 * знает лишь панель, отсекает resolveDcsQueryTablesTarget.
 */
export function dcsQueryTablesRequestOf(message: DcsPanelMessage): { relativePath: string; lang: 'ru' | 'en' } | { error: string } {
	const relativePath = typeof message.relativePath === 'string' ? message.relativePath.trim() : '';
	if (relativePath === '') {
		return { error: 'Таблицы объекта не запрошены: нужен relativePath (файл объекта из дерева конструктора).' };
	}
	const lang = dcsQueryLangOf(message);
	if (lang === undefined) {
		return { error: `Язык «${String(message.lang)}» не поддержан (lang: ru или en).` };
	}
	return { relativePath, lang };
}

// ------------------------------------------------------------------ описание объекта для подсказки

/** Чтение подсказки через точку: описание объекта конфигурации по типу или таблице языка запросов. */
export const DCS_DESCRIBE_TYPE_MESSAGE = 'dcs/describe-type';

/**
 * Вид объекта языка запросов: русское и английское имя вида таблицы, каталог выгрузки и вид
 * ссылочного типа, если он у вида есть. Тот же состав, что у OBJECT_KINDS webview
 * (dcs-editor-field-types.js) и у видов cf-md-query-tables md-sparrow.
 */
interface DcsQueryObjectKind {
	ru: string;
	en: string;
	folder: string;
	ref?: string;
}

const DCS_QUERY_OBJECT_KINDS: readonly DcsQueryObjectKind[] = [
	{ ru: 'Справочник', en: 'Catalog', folder: 'Catalogs', ref: 'CatalogRef' },
	{ ru: 'Документ', en: 'Document', folder: 'Documents', ref: 'DocumentRef' },
	{ ru: 'ЖурналДокументов', en: 'DocumentJournal', folder: 'DocumentJournals' },
	{ ru: 'Перечисление', en: 'Enum', folder: 'Enums', ref: 'EnumRef' },
	{ ru: 'ПланВидовХарактеристик', en: 'ChartOfCharacteristicTypes', folder: 'ChartsOfCharacteristicTypes', ref: 'ChartOfCharacteristicTypesRef' },
	{ ru: 'ПланСчетов', en: 'ChartOfAccounts', folder: 'ChartsOfAccounts', ref: 'ChartOfAccountsRef' },
	{ ru: 'ПланВидовРасчета', en: 'ChartOfCalculationTypes', folder: 'ChartsOfCalculationTypes', ref: 'ChartOfCalculationTypesRef' },
	{ ru: 'ПланОбмена', en: 'ExchangePlan', folder: 'ExchangePlans', ref: 'ExchangePlanRef' },
	{ ru: 'БизнесПроцесс', en: 'BusinessProcess', folder: 'BusinessProcesses', ref: 'BusinessProcessRef' },
	{ ru: 'Задача', en: 'Task', folder: 'Tasks', ref: 'TaskRef' },
	{ ru: 'РегистрСведений', en: 'InformationRegister', folder: 'InformationRegisters' },
	{ ru: 'РегистрНакопления', en: 'AccumulationRegister', folder: 'AccumulationRegisters' },
	{ ru: 'РегистрБухгалтерии', en: 'AccountingRegister', folder: 'AccountingRegisters' },
	{ ru: 'РегистрРасчета', en: 'CalculationRegister', folder: 'CalculationRegisters' },
	{ ru: 'Константа', en: 'Constant', folder: 'Constants' },
	{ ru: 'КритерийОтбора', en: 'FilterCriterion', folder: 'FilterCriteria' },
	{ ru: 'Последовательность', en: 'Sequence', folder: 'Sequences' },
];

/**
 * Имя объекта метаданных: оно станет именем файла, поэтому разделители каталогов, `..` и прочее
 * вне идентификатора отклоняются до файловой системы.
 */
const MD_NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** Разобранный запрос dcs/describe-type: эхо запроса для ответа, каталог и имя файла объекта. */
export interface DcsDescribeRequest {
	echo: { typeName: string } | { queryTable: string };
	/** Каталог вида в выгрузке (`Catalogs`). */
	folder: string;
	/** Имя объекта (`Валюты`). */
	name: string;
}

function upperName(value: string): string {
	return value.toUpperCase();
}

/**
 * Разбирает `{type: 'dcs/describe-type', typeName}` или `{…, queryTable}` — ровно одно из двух.
 *
 * typeName — ссылочный тип формы `cfg:CatalogRef.Валюты` (вид — из ссылочных видов; наборы ссылок
 * вида, «любая ссылка», характеристики и определяемые типы объект не называют); queryTable — имя
 * таблицы языка запросов по-русски или по-английски (`Справочник.Валюты`, `Document.Счет.Товары`,
 * `РегистрНакопления.Остатки.ОстаткиИОбороты`).
 *
 * @returns Каталог и имя файла объекта либо отказ для ответа webview.
 */
export function dcsDescribeRequestOf(message: DcsPanelMessage): DcsDescribeRequest | { error: string } {
	const typeName = typeof message.typeName === 'string' ? message.typeName.trim() : '';
	const queryTable = typeof message.queryTable === 'string' ? message.queryTable.trim() : '';
	if ((typeName === '') === (queryTable === '')) {
		return { error: 'Описание объекта не запрошено: нужен ровно один из typeName (ссылочный тип) и queryTable (таблица запроса).' };
	}
	if (typeName !== '') {
		const match = /^[A-Za-z0-9]+:([A-Za-z]+Ref)\.(.+)$/.exec(typeName);
		const kind = match ? DCS_QUERY_OBJECT_KINDS.find((candidate) => candidate.ref === match[1]) : undefined;
		if (!match || !kind || !MD_NAME_RE.test(match[2])) {
			return { error: `Тип «${typeName}» не называет объект конфигурации с таблицей запроса.` };
		}
		return { echo: { typeName }, folder: kind.folder, name: match[2] };
	}
	const segments = queryTable.split('.');
	const kind =
		segments.length >= 2
			? DCS_QUERY_OBJECT_KINDS.find(
					(candidate) => upperName(candidate.ru) === upperName(segments[0]) || upperName(candidate.en) === upperName(segments[0])
				)
			: undefined;
	if (!kind || !segments.slice(1).every((segment) => MD_NAME_RE.test(segment))) {
		return { error: `Таблица «${queryTable}» не называет объект конфигурации.` };
	}
	return { echo: { queryTable }, folder: kind.folder, name: segments[1] };
}
