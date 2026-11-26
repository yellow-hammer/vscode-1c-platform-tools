/**
 * Подсказка «через точку» редактора СКД: дети по типу значения и вывод типов полей
 * наборов-запросов. Чистые функции без DOM: webview берёт их из window.DcsFieldTypes,
 * node-тесты из module.exports.
 *
 * Описания объектов (ответ cf-md-query-tables) хранит кэш webview. Функции получают
 * lookup(ключ) → описание | null (описания нет) | undefined (ещё не загружено) и возвращают
 * недостающее списком pending [{key, request}]: обвязка запрашивает его и зовёт функцию снова.
 *
 * Определяемые типы и характеристики приходят набором (`cfg:DefinedType.X`, UUID в typeIds), их
 * состав лежит в ключе ответа typeCompositions: attachTypeCompositions пришивает его к типам,
 * expandedTypes раскрывает.
 *
 * Тип полей наборов-запросов обычно не записан (платформа узнаёт его при выполнении запроса),
 * поэтому он выводится по тексту запроса: колонка последнего запроса пакета → `Алиас.Путь` →
 * источник (таблица, временная таблица, вложенный запрос) → поле из описания. В файл выведенный
 * тип не пишется; не вывелся: детей нет.
 */
(function (root) {
	'use strict';

	/**
	 * Виды объектов языка запросов: имя вида таблицы (ru, en) и вид ссылочного типа, если он есть.
	 * Внешних источников данных нет: их таблицы адресуются четырьмя сегментами.
	 */
	const OBJECT_KINDS = Object.freeze([
		Object.freeze({ ru: 'Справочник', en: 'Catalog', ref: 'CatalogRef' }),
		Object.freeze({ ru: 'Документ', en: 'Document', ref: 'DocumentRef' }),
		Object.freeze({ ru: 'ЖурналДокументов', en: 'DocumentJournal', ref: '' }),
		Object.freeze({ ru: 'Перечисление', en: 'Enum', ref: 'EnumRef' }),
		Object.freeze({ ru: 'ПланВидовХарактеристик', en: 'ChartOfCharacteristicTypes', ref: 'ChartOfCharacteristicTypesRef' }),
		Object.freeze({ ru: 'ПланСчетов', en: 'ChartOfAccounts', ref: 'ChartOfAccountsRef' }),
		Object.freeze({ ru: 'ПланВидовРасчета', en: 'ChartOfCalculationTypes', ref: 'ChartOfCalculationTypesRef' }),
		Object.freeze({ ru: 'ПланОбмена', en: 'ExchangePlan', ref: 'ExchangePlanRef' }),
		Object.freeze({ ru: 'БизнесПроцесс', en: 'BusinessProcess', ref: 'BusinessProcessRef' }),
		Object.freeze({ ru: 'Задача', en: 'Task', ref: 'TaskRef' }),
		Object.freeze({ ru: 'РегистрСведений', en: 'InformationRegister', ref: '' }),
		Object.freeze({ ru: 'РегистрНакопления', en: 'AccumulationRegister', ref: '' }),
		Object.freeze({ ru: 'РегистрБухгалтерии', en: 'AccountingRegister', ref: '' }),
		Object.freeze({ ru: 'РегистрРасчета', en: 'CalculationRegister', ref: '' }),
		Object.freeze({ ru: 'Константа', en: 'Constant', ref: '' }),
		Object.freeze({ ru: 'КритерийОтбора', en: 'FilterCriterion', ref: '' }),
		Object.freeze({ ru: 'Последовательность', en: 'Sequence', ref: '' }),
	]);

	/**
	 * Общая таблица констант `Константы` / `Constants` (без учёта регистра), колонка на константу.
	 * Однословное имя обычно значит ВТ пакета, но ВТ с таким именем тоже считается таблицей констант.
	 * Копия правила в DcsQueryEdit.isConstantsTable (модуль без зависимостей), совпадение проверяет
	 * node-тест.
	 */
	const CONSTANTS_TABLES = Object.freeze({ КОНСТАНТЫ: 'ru', CONSTANTS: 'en' });

	/** Колонка общей таблицы констант: поле «Значение» таблицы `Константа.<колонка>`. */
	const CONSTANT_VALUE = Object.freeze({ ru: 'Значение', en: 'Value' });

	const DATE_TIME = Object.freeze({ types: ['xs:dateTime'], typeSets: [], typeIds: [], dateQualifiers: { dateFractions: 'DATE_TIME' } });

	/** Свойства стандартного периода (`&Период.ДатаОкончания`); Вариант: элемент variant в XSD. */
	const STANDARD_PERIOD_CHILDREN = Object.freeze([
		Object.freeze({ name: 'ДатаНачала', title: 'Дата начала', valueType: DATE_TIME }),
		Object.freeze({ name: 'ДатаОкончания', title: 'Дата окончания', valueType: DATE_TIME }),
		Object.freeze({ name: 'Вариант', title: 'Вариант', valueType: Object.freeze({ types: ['v8:StandardPeriodVariant'], typeSets: [], typeIds: [] }) }),
	]);

	/** Свойства стандартной даты начала (элементы XSD). */
	const STANDARD_BEGINNING_DATE_CHILDREN = Object.freeze([
		Object.freeze({ name: 'Дата', title: 'Дата', valueType: DATE_TIME }),
		Object.freeze({ name: 'Вариант', title: 'Вариант', valueType: Object.freeze({ types: ['v8:StandardBeginningDateVariant'], typeSets: [], typeIds: [] }) }),
	]);

	const STATIC_CHILDREN = {
		'v8:StandardPeriod': STANDARD_PERIOD_CHILDREN,
		'v8:StandardBeginningDate': STANDARD_BEGINNING_DATE_CHILDREN,
	};

	/**
	 * Предел ссылок в составном типе (с раскрытыми составами), выше которого дети не собираются:
	 * у «Регистратора» или «ЗначениеДоступа» видов десятки, и список реквизитов был бы огромен.
	 */
	const MAX_UNION_REFS = 6;

	/**
	 * Ссылочный тип с именем объекта (`cfg:CatalogRef.Валюты`); наборы вида и «любая ссылка» не
	 * подходят. Копия в dcs-editor-query-edit.js (модуль без зависимостей), совпадение проверяет
	 * node-тест.
	 */
	const REF_TYPE_RE = /^[A-Za-z0-9]+:[A-Za-z]+Ref\.[^.]+$/;

	/** Предел вложенности источников (ВТ пакета, вложенные запросы): защита от цикла ВТ на себя. */
	const MAX_DEPTH = 8;

	const IDENT = '[\\p{L}_][\\p{L}\\p{N}_]*';
	const IDENT_RE = new RegExp('^' + IDENT + '$', 'u');
	const PATH_RE = new RegExp('^' + IDENT + '(?:\\.' + IDENT + ')*$', 'u');
	const CALL_RE = new RegExp('^(' + IDENT + ')\\s*\\(', 'u');

	/** Функции, у которых тип результата берётся из первого аргумента-пути. */
	const PASS_THROUGH = new Set(['ЕСТЬNULL', 'ISNULL', 'МАКСИМУМ', 'MAX', 'МИНИМУМ', 'MIN']);

	function list(value) {
		return Array.isArray(value) ? value : [];
	}

	function text(value) {
		return typeof value === 'string' ? value : '';
	}

	/** Ключ имён языка запросов: идентификаторы платформы сравниваются без учёта регистра. */
	function upper(value) {
		return text(value).toUpperCase();
	}

	function kindByName(name) {
		const key = upper(name);
		return OBJECT_KINDS.find((kind) => upper(kind.ru) === key || upper(kind.en) === key) || null;
	}

	/**
	 * Язык таблицы по имени её вида (`AccumulationRegister.Х.Balance`: en). Имена виртуальных таблиц
	 * и суффиксы полей пишутся на языке вида, а не ключевых слов текста.
	 */
	function tableLang(tableName) {
		const head = upper(text(tableName).split('.')[0]);
		return OBJECT_KINDS.some((kind) => upper(kind.en) === head) ? 'en' : 'ru';
	}

	/** Ключ кэша описаний: имя объекта, у английского описания с меткой `EN:` (в именах двоеточий нет). */
	function describeKey(object, lang) {
		return lang === 'en' ? 'EN:' + upper(object) : upper(object);
	}

	/** Запрос описания: язык передаётся только английский, русский панель берёт по умолчанию. */
	function describeRequest(fields, lang) {
		if (lang === 'en') {
			fields.lang = 'en';
		}
		return fields;
	}

	// ---------- адреса объектов ----------

	/**
	 * Объект ссылочного типа: `cfg:CatalogRef.Валюты` → `Справочник.Валюты`. Для наборов вида,
	 * «любой ссылки», характеристик и определяемых типов null.
	 *
	 * В основной таблице стандартные реквизиты есть под обоими именами (name и nameEn), поэтому
	 * по умолчанию описание русское.
	 *
	 * @param {string} typeName Тип (`cfg:CatalogRef.Валюты`).
	 * @param {'ru'|'en'} [lang] Язык описания.
	 * @returns {{object: string, key: string, request: {typeName: string, lang?: 'en'}}|null}
	 */
	function refObjectOf(typeName, lang) {
		const value = text(typeName);
		const match = /^[A-Za-z0-9]+:([A-Za-z]+Ref)\.(.+)$/.exec(value);
		if (!match || !IDENT_RE.test(match[2])) {
			return null;
		}
		const kind = OBJECT_KINDS.find((candidate) => candidate.ref === match[1]);
		if (!kind) {
			return null;
		}
		const object = kind.ru + '.' + match[2];
		return { object: object, key: describeKey(object, lang), request: describeRequest({ typeName: value }, lang) };
	}

	/**
	 * Объект таблицы языка запросов: `РегистрНакопления.Х.Остатки` → `РегистрНакопления.Х` и хвост
	 * `['Остатки']`. Без lang ключ русский. С lang 'en' ключ и запрос английского описания: хвост
	 * `Balance` найдётся только в нём (см. tableLang).
	 *
	 * @param {string} tableName Имя таблицы после ИЗ.
	 * @param {'ru'|'en'} [lang] Язык описания.
	 * @returns {{object: string, key: string, tail: string[], request: {queryTable: string, lang?: 'en'}}|null}
	 */
	function tableObjectOf(tableName, lang) {
		const value = text(tableName).trim();
		if (!PATH_RE.test(value)) {
			return null;
		}
		const segments = value.split('.');
		const kind = segments.length >= 2 ? kindByName(segments[0]) : null;
		if (!kind) {
			return null;
		}
		const object = kind.ru + '.' + segments[1];
		return { object: object, key: describeKey(object, lang), tail: segments.slice(2), request: describeRequest({ queryTable: value }, lang) };
	}

	/**
	 * Общая ли это таблица констант (`Константы` / `Constants`). Своего описания у неё нет: тип
	 * колонки берётся из поля «Значение» таблицы константы.
	 *
	 * @param {string} tableName Имя таблицы после ИЗ.
	 * @returns {boolean}
	 */
	function isConstantsTable(tableName) {
		return Object.prototype.hasOwnProperty.call(CONSTANTS_TABLES, upper(text(tableName).trim()));
	}

	/**
	 * Таблица константы за колонкой общей таблицы: `Константы` + `ВалютаУчета` →
	 * `Константа.ВалютаУчета`; у `Constants` английская таблица и поле `Value`. Колонка не
	 * идентификатор: null.
	 *
	 * @returns {{table: string, lang: 'ru'|'en', field: string}|null}
	 */
	function constantColumnTable(tableName, column) {
		if (!isConstantsTable(tableName) || !IDENT_RE.test(text(column))) {
			return null;
		}
		const lang = CONSTANTS_TABLES[upper(text(tableName).trim())];
		const kind = OBJECT_KINDS.find((candidate) => candidate.en === 'Constant');
		return { table: (lang === 'en' ? kind.en : kind.ru) + '.' + column, lang: lang, field: CONSTANT_VALUE[lang] };
	}

	/**
	 * Ключ кэша по ответу панели (`describeType`): по эху запроса и языка, как в refObjectOf и
	 * tableObjectOf, потому что у ответа «вне выгрузки» описания нет.
	 */
	function answerKeyOf(message) {
		const msg = message && typeof message === 'object' ? message : {};
		const lang = msg.lang === 'en' ? 'en' : 'ru';
		const byType = refObjectOf(msg.typeName, lang);
		if (byType) {
			return byType.key;
		}
		const byTable = tableObjectOf(msg.queryTable, lang);
		if (byTable) {
			return byTable.key;
		}
		return msg.description && typeof msg.description === 'object' ? describeKey(msg.description.object, lang) : '';
	}

	/** Таблица описания по хвосту имени; пустой хвост: основная таблица. */
	function findTable(description, tail) {
		const tables = list(description && description.tables);
		const want = list(tail).map(upper).join('.');
		if (!want) {
			return tables.find((table) => table && table.kind === 'main') || null;
		}
		return (
			tables.find((table) => {
				const segments = text(table && table.name).split('.');
				return segments.length > 2 && segments.slice(2).map(upper).join('.') === want;
			}) || null
		);
	}

	/** Поле таблицы по русскому или английскому имени: английский запрос пишет стандартные реквизиты по-английски. */
	function findField(table, name) {
		const want = upper(name);
		if (!want) {
			return null;
		}
		return list(table && table.fields).find((field) => field && (upper(field.name) === want || upper(field.nameEn) === want)) || null;
	}

	// ---------- типы ----------

	function hasTypes(dto) {
		return Boolean(dto && typeof dto === 'object' && (list(dto.types).length > 0 || list(dto.typeSets).length > 0 || list(dto.typeIds).length > 0));
	}

	// ---------- составы определяемых типов и характеристик ----------

	/**
	 * Записи typeCompositions с источником: `cfg:DefinedType.X`, `cfg:Characteristic.X` или UUID из
	 * typeIds. Прочее отбрасывается.
	 */
	function compositionRecords(value) {
		return list(value).filter((record) => record && typeof record === 'object' && text(record.source) !== '');
	}

	/**
	 * Записи по источнику без учёта регистра: UUID в схеме и в ответе бывают в разном регистре.
	 * Побеждает первая запись.
	 */
	function compositionIndex(records) {
		const index = new Map();
		for (const record of records) {
			const key = upper(record.source);
			if (!index.has(key)) {
				index.set(key, record);
			}
		}
		return index;
	}

	/** Объект типа значения: есть хотя бы один список типов. */
	function isTypeObject(value) {
		return Array.isArray(value.types) || Array.isArray(value.typeSets) || Array.isArray(value.typeIds);
	}

	/**
	 * Пришивает составы из ключа typeCompositions (cf-md-query-tables, cf-dcs-info) к каждому типу
	 * {types, typeSets, typeIds}, у которого источник записи есть в typeSets или typeIds:
	 * type.compositions = [записи]. Списки типа не меняются, а payload мутаций берёт только известные
	 * ключи, так что составы в файл не попадают. Ответ меняется на месте.
	 *
	 * Обходится весь ответ, а не известные места: новое место с типом не останется без составов.
	 *
	 * @param {object} answer Ответ cf-md-query-tables или модель cf-dcs-info.
	 * @returns {object} Тот же ответ.
	 */
	function attachTypeCompositions(answer) {
		if (!answer || typeof answer !== 'object') {
			return answer;
		}
		const index = compositionIndex(compositionRecords(answer.typeCompositions));
		if (index.size === 0) {
			return answer;
		}
		const seen = new Set();
		const stack = [answer];
		while (stack.length > 0) {
			const node = stack.pop();
			if (!node || typeof node !== 'object' || seen.has(node)) {
				continue;
			}
			seen.add(node);
			if (Array.isArray(node)) {
				for (const item of node) {
					stack.push(item);
				}
				continue;
			}
			if (isTypeObject(node)) {
				const found = [];
				for (const name of list(node.typeSets).concat(list(node.typeIds))) {
					const record = typeof name === 'string' ? index.get(upper(name)) : undefined;
					if (record && found.indexOf(record) < 0) {
						found.push(record);
					}
				}
				if (found.length > 0) {
					node.compositions = found;
				}
			}
			for (const key of Object.keys(node)) {
				// Записи составов не типы полей: обход их пропускает
				if (key === 'compositions' || (node === answer && key === 'typeCompositions')) {
					continue;
				}
				const child = node[key];
				if (child && typeof child === 'object') {
					stack.push(child);
				}
			}
		}
		return answer;
	}

	/**
	 * Тип с раскрытыми составами: элементы typeSets и typeIds с записью в compositions заменены её
	 * types и typeSets. Уровень один: вложенные составы раскрывает md-sparrow. Списки без повторов.
	 *
	 * @param {object|null} dto Тип значения.
	 * @returns {{types: string[], typeSets: string[], typeIds: string[]}}
	 */
	function expandedTypes(dto) {
		const out = { types: [], typeSets: [], typeIds: [] };
		if (!dto || typeof dto !== 'object') {
			return out;
		}
		const index = compositionIndex(compositionRecords(dto.compositions));
		const push = (target, name) => {
			if (typeof name === 'string' && target.indexOf(name) < 0) {
				target.push(name);
			}
		};
		for (const name of list(dto.types)) {
			push(out.types, name);
		}
		for (const [names, own] of [
			[dto.typeSets, out.typeSets],
			[dto.typeIds, out.typeIds],
		]) {
			for (const name of list(names)) {
				const record = typeof name === 'string' ? index.get(upper(name)) : undefined;
				if (!record) {
					push(own, name);
					continue;
				}
				for (const inner of list(record.types)) {
					push(out.types, inner);
				}
				for (const inner of list(record.typeSets)) {
					push(out.typeSets, inner);
				}
			}
		}
		return out;
	}

	/**
	 * Ссылочные типы для разыменования и связей: `cfg:<Вид>Ref.<Имя>` из раскрытых типов, без повторов.
	 *
	 * @param {object|null} dto Тип значения.
	 * @returns {string[]}
	 */
	function refTypeNames(dto) {
		return expandedTypes(dto).types.filter((name) => REF_TYPE_RE.test(name));
	}

	/**
	 * Объединение типов без повторов (части объединения, тёзки полей разных наборов). Один тип
	 * возвращается как есть, с квалификаторами для подписи «Строка(100)». Составы тоже объединяются,
	 * иначе тёзка с определяемым типом после слияния перестал бы раскрываться.
	 */
	function mergeTypes(dtos) {
		const present = list(dtos).filter(hasTypes);
		if (present.length === 0) {
			return null;
		}
		if (present.length === 1) {
			return present[0];
		}
		const types = [];
		const typeSets = [];
		const typeIds = [];
		const compositions = [];
		const sources = new Set();
		for (const dto of present) {
			for (const [source, target] of [
				[dto.types, types],
				[dto.typeSets, typeSets],
				[dto.typeIds, typeIds],
			]) {
				for (const name of list(source)) {
					if (typeof name === 'string' && target.indexOf(name) < 0) {
						target.push(name);
					}
				}
			}
			for (const record of compositionRecords(dto.compositions)) {
				const key = upper(record.source);
				if (!sources.has(key)) {
					sources.add(key);
					compositions.push(record);
				}
			}
		}
		const merged = { types: types, typeSets: typeSets, typeIds: typeIds };
		// Тип без составов не меняет формы
		if (compositions.length > 0) {
			merged.compositions = compositions;
		}
		return merged;
	}

	/** Объекты ссылок раскрытого типа: определяемый тип и характеристика дают ссылки состава. */
	function refTypesOf(dto) {
		return refTypeNames(dto)
			.map((name) => refObjectOf(name))
			.filter(Boolean);
	}

	/** Есть ли у типа дети уровня «через точку»: стрелка у строки списка. */
	function expandable(dto) {
		if (!dto) {
			return false;
		}
		if (expandedTypes(dto).types.some((name) => STATIC_CHILDREN[name])) {
			return true;
		}
		const refs = refTypesOf(dto);
		return refs.length > 0 && refs.length <= MAX_UNION_REFS;
	}

	/** Подпись типа по умолчанию: локальные имена через запятую (обвязка подставляет подпись модуля типов). */
	function plainTypeText(dto) {
		const parts = [];
		for (const name of list(dto && dto.types).concat(list(dto && dto.typeSets))) {
			const value = text(name);
			const colon = value.indexOf(':');
			parts.push(colon >= 0 ? value.slice(colon + 1) : value);
		}
		return parts.filter(Boolean).join(', ');
	}

	function collector() {
		const pending = [];
		const seen = new Set();
		return {
			pending: pending,
			want(target) {
				if (target && !seen.has(target.key)) {
					seen.add(target.key);
					pending.push({ key: target.key, request: target.request });
				}
			},
			merge(other) {
				for (const item of list(other)) {
					this.want(item);
				}
			},
		};
	}

	/** Описание объекта через lookup: undefined (запрос ушёл в pending) или null (описания нет). */
	function describe(target, lookup, sink) {
		if (!target || typeof lookup !== 'function') {
			return null;
		}
		const description = lookup(target.key);
		if (description === undefined) {
			sink.want(target);
			return undefined;
		}
		return description && typeof description === 'object' ? description : null;
	}

	/**
	 * Дети типа: свойства стандартного периода и даты начала, у ссылки поля основной таблицы
	 * объекта. У составного типа дети всех ссылок; тёзки сливаются в строку с объединённым типом
	 * (реквизит есть хотя бы у одного вида). Больше MAX_UNION_REFS ссылок: детей нет. Определяемый
	 * тип и характеристика дают детей по составу.
	 *
	 * @param {object|null} dto Тип значения (MdTypeDescriptionDto / valueType cf-dcs-info).
	 * @param {function} lookup Ключ объекта → описание | null | undefined.
	 * @param {{typeText?: function}} [options] typeText(dto): подпись типа строки.
	 * @returns {{children: object[], pending: object[]}} Строки в форме узлов каталога подсказки.
	 */
	function typeChildren(dto, lookup, options) {
		const sink = collector();
		const children = [];
		if (!dto) {
			return { children: children, pending: sink.pending };
		}
		const typeText = options && typeof options.typeText === 'function' ? options.typeText : plainTypeText;
		const byName = new Map();
		function add(name, title, valueType, nameEn) {
			const key = upper(name);
			const existing = byName.get(key);
			if (existing) {
				existing.valueType = mergeTypes([existing.valueType, valueType]);
				existing.title = existing.title || text(title);
				existing.typeText = existing.valueType ? typeText(existing.valueType) : '';
				existing.expandable = expandable(existing.valueType);
				return;
			}
			const row = {
				name: name,
				kind: 'field',
				title: text(title),
				valueType: valueType || null,
				typeText: valueType ? typeText(valueType) : '',
				expandable: expandable(valueType),
			};
			if (nameEn && nameEn !== name) {
				row.nameEn = nameEn;
			}
			byName.set(key, row);
			children.push(row);
		}
		for (const name of expandedTypes(dto).types) {
			for (const child of STATIC_CHILDREN[name] || []) {
				add(child.name, child.title, child.valueType);
			}
		}
		const refs = refTypesOf(dto);
		if (refs.length > MAX_UNION_REFS) {
			return { children: children, pending: sink.pending };
		}
		for (const ref of refs) {
			const description = describe(ref, lookup, sink);
			const table = description ? findTable(description, []) : null;
			for (const field of list(table && table.fields)) {
				if (field && text(field.name)) {
					add(field.name, field.synonym, field.type || null, text(field.nameEn));
				}
			}
		}
		return { children: children, pending: sink.pending };
	}

	/**
	 * Тип по пути (`Контрагент.Владелец`). Сегмент, которого нет среди детей, обрывает путь: type null.
	 *
	 * @returns {{type: object|null, pending: object[]}}
	 */
	function walkType(dto, segments, lookup) {
		const sink = collector();
		let current = dto || null;
		for (const segment of list(segments)) {
			if (!current) {
				break;
			}
			const step = typeChildren(current, lookup);
			sink.merge(step.pending);
			const want = upper(segment);
			const child = step.children.find((row) => upper(row.name) === want || upper(row.nameEn) === want);
			current = child ? child.valueType : null;
		}
		return { type: current, pending: sink.pending };
	}

	/**
	 * Дети по пути от типа узла каталога: `Контрагент.Владелец.` даёт тип Контрагента и ['Владелец'].
	 *
	 * @returns {{children: object[], pending: object[]}}
	 */
	function childrenAt(dto, segments, lookup, options) {
		const walked = walkType(dto, segments, lookup);
		const step = typeChildren(walked.type, lookup, options);
		const sink = collector();
		sink.merge(walked.pending);
		sink.merge(step.pending);
		return { children: step.children, pending: sink.pending };
	}

	// ---------- выражения запроса ----------

	/** Выражение в одну строку без комментариев: по нему ищутся скобки и запятые верхнего уровня. */
	function stripComments(value) {
		let out = '';
		let i = 0;
		const source = text(value);
		while (i < source.length) {
			const ch = source[i];
			if (ch === '"') {
				let j = i + 1;
				while (j < source.length) {
					if (source[j] === '"') {
						if (source[j + 1] === '"') {
							j += 2;
							continue;
						}
						j += 1;
						break;
					}
					j += 1;
				}
				out += source.slice(i, j);
				i = j;
				continue;
			}
			if (ch === '/' && source[i + 1] === '/') {
				while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
					i += 1;
				}
				out += ' ';
				continue;
			}
			out += ch;
			i += 1;
		}
		return out.replace(/\s+/g, ' ').trim();
	}

	/**
	 * Позиция закрывающей скобки к открывающей в from (строки пропускаются); -1, если не закрыта.
	 * Запятые верхнего уровня собираются в commas.
	 */
	function closingParen(value, from, commas) {
		let depth = 0;
		for (let i = from; i < value.length; i += 1) {
			const ch = value[i];
			if (ch === '"') {
				i += 1;
				while (i < value.length && !(value[i] === '"' && value[i + 1] !== '"')) {
					i += value[i] === '"' ? 2 : 1;
				}
				continue;
			}
			if (ch === '(') {
				depth += 1;
			} else if (ch === ')') {
				depth -= 1;
				if (depth === 0) {
					return i;
				}
			} else if (ch === ',' && depth === 1 && commas) {
				commas.push(i);
			}
		}
		return -1;
	}

	/** Вызов `Имя(аргументы)` во всё выражение: имя в верхнем регистре и аргументы текстом; иначе null. */
	function callOf(value) {
		const match = CALL_RE.exec(value);
		if (!match) {
			return null;
		}
		const open = match[0].length - 1;
		const commas = [];
		const close = closingParen(value, open, commas);
		if (close !== value.length - 1) {
			return null;
		}
		const args = [];
		let start = open + 1;
		for (const comma of commas) {
			args.push(value.slice(start, comma).trim());
			start = comma + 1;
		}
		args.push(value.slice(start, close).trim());
		return { name: upper(match[1]), args: args };
	}

	/**
	 * Что выражение поля выборки говорит о типе: путь (`Т.Контрагент`, в т. ч. под ЕСТЬNULL,
	 * МАКСИМУМ, МИНИМУМ), ссылочный тип из `ВЫРАЗИТЬ(… КАК Справочник.Х)`, NULL (часть объединения
	 * без значения) или ничего.
	 *
	 * @returns {{kind: 'path', path: string}|{kind: 'type', type: object}|{kind: 'null'}|{kind: 'unknown'}}
	 */
	function classifyExpression(expr) {
		let value = stripComments(expr);
		for (let guard = 0; guard < 16 && value[0] === '(' && closingParen(value, 0) === value.length - 1; guard += 1) {
			value = value.slice(1, -1).trim();
		}
		if (upper(value) === 'NULL') {
			return { kind: 'null' };
		}
		if (PATH_RE.test(value)) {
			const head = upper(value);
			// Литералы языка запросов похожи на путь из одного слова
			if (head === 'ИСТИНА' || head === 'ЛОЖЬ' || head === 'TRUE' || head === 'FALSE' || head === 'НЕОПРЕДЕЛЕНО' || head === 'UNDEFINED') {
				return { kind: 'unknown' };
			}
			return { kind: 'path', path: value };
		}
		const call = callOf(value);
		if (!call) {
			return { kind: 'unknown' };
		}
		if (PASS_THROUGH.has(call.name) && call.args.length >= 1) {
			const inner = classifyExpression(call.args[0]);
			return inner.kind === 'path' ? inner : { kind: 'unknown' };
		}
		if ((call.name === 'ВЫРАЗИТЬ' || call.name === 'CAST') && call.args.length === 1) {
			const cast = new RegExp('\\s(?:КАК|AS)\\s+(' + IDENT + '\\.' + IDENT + ')$', 'iu').exec(call.args[0]);
			const kind = cast ? kindByName(cast[1].split('.')[0]) : null;
			if (kind && kind.ref) {
				return { kind: 'type', type: { types: ['cfg:' + kind.ref + '.' + cast[1].split('.')[1]], typeSets: [], typeIds: [] } };
			}
		}
		return { kind: 'unknown' };
	}

	/** Примитивный тип без квалификаторов: длину и разрядность выражение не задаёт. */
	function primitive(name) {
		return { types: [name], typeSets: [], typeIds: [] };
	}

	/** Функции языка запросов с числовым результатом: части даты, разность дат и агрегаты. */
	const NUMBER_FUNCTIONS = new Set([
		'ГОД',
		'YEAR',
		'КВАРТАЛ',
		'QUARTER',
		'МЕСЯЦ',
		'MONTH',
		'ДЕНЬГОДА',
		'DAYOFYEAR',
		'ДЕНЬ',
		'DAY',
		'НЕДЕЛЯ',
		'WEEK',
		'ДЕНЬНЕДЕЛИ',
		'WEEKDAY',
		'ЧАС',
		'HOUR',
		'МИНУТА',
		'MINUTE',
		'СЕКУНДА',
		'SECOND',
		'РАЗНОСТЬДАТ',
		'DATEDIFF',
		'СУММА',
		'SUM',
		'СРЕДНЕЕ',
		'AVG',
		'КОЛИЧЕСТВО',
		'COUNT',
	]);
	/** Функции с результатом-датой. */
	const DATE_FUNCTIONS = new Set(['НАЧАЛОПЕРИОДА', 'BEGINOFPERIOD', 'КОНЕЦПЕРИОДА', 'ENDOFPERIOD', 'ДОБАВИТЬКДАТЕ', 'DATEADD', 'ДАТАВРЕМЯ', 'DATETIME']);
	/** Функции со строковым результатом (длина результата не выводится). */
	const STRING_FUNCTIONS = new Set(['ПРЕДСТАВЛЕНИЕ', 'PRESENTATION', 'ПРЕДСТАВЛЕНИЕССЫЛКИ', 'REFPRESENTATION', 'ПОДСТРОКА', 'SUBSTRING']);
	/** Примитив приведения `ВЫРАЗИТЬ(… КАК Число(…))`: имя типа языка запросов → тип формы valueType. */
	const CAST_PRIMITIVES = new Map([
		['ЧИСЛО', 'xs:decimal'],
		['NUMBER', 'xs:decimal'],
		['СТРОКА', 'xs:string'],
		['STRING', 'xs:string'],
		['ДАТА', 'xs:dateTime'],
		['DATE', 'xs:dateTime'],
		['БУЛЕВО', 'xs:boolean'],
		['BOOLEAN', 'xs:boolean'],
	]);
	const BOOLEAN_WORDS = new Set(['ИСТИНА', 'ЛОЖЬ', 'TRUE', 'FALSE']);
	/** Ключевые слова перед скобкой не вызов: `КОГДА (Т.А > 0)` остаётся словом и группой. */
	const KEYWORDS = new Set([
		'ВЫБОР',
		'CASE',
		'КОГДА',
		'WHEN',
		'ТОГДА',
		'THEN',
		'ИНАЧЕ',
		'ELSE',
		'КОНЕЦ',
		'END',
		'И',
		'AND',
		'ИЛИ',
		'OR',
		'НЕ',
		'NOT',
		'В',
		'IN',
		'МЕЖДУ',
		'BETWEEN',
		'ПОДОБНО',
		'LIKE',
		'ЕСТЬ',
		'IS',
		'ССЫЛКА',
		'REFS',
		'ИЕРАРХИИ',
		'HIERARCHY',
	]);
	const WORD_RE = new RegExp('^&?' + IDENT + '(?:\\.' + IDENT + ')*', 'u');
	const NUMBER_RE = /^\d+(?:\.\d+)?/;

	/**
	 * Лексемы верхнего уровня выражения (без комментариев): числа, строки, слова (путь или `&`-параметр),
	 * вызовы и скобочные группы целиком, операторы `+ - * /`, прочее other. null, если скобки не сходятся.
	 */
	function topTokens(value) {
		const out = [];
		let i = 0;
		while (i < value.length) {
			const ch = value[i];
			if (ch === ' ') {
				i += 1;
				continue;
			}
			const start = i;
			if (ch === '"') {
				i += 1;
				while (i < value.length && !(value[i] === '"' && value[i + 1] !== '"')) {
					i += value[i] === '"' ? 2 : 1;
				}
				i += 1;
				out.push({ kind: 'string', start: start, end: i });
				continue;
			}
			if (ch === '(') {
				const close = closingParen(value, i);
				if (close < 0) {
					return null;
				}
				i = close + 1;
				out.push({ kind: 'group', start: start, end: i });
				continue;
			}
			if (ch === ')') {
				return null;
			}
			const number = NUMBER_RE.exec(value.slice(i));
			if (number) {
				i += number[0].length;
				out.push({ kind: 'number', start: start, end: i });
				continue;
			}
			const word = WORD_RE.exec(value.slice(i));
			if (word) {
				i += word[0].length;
				let next = i;
				while (value[next] === ' ') {
					next += 1;
				}
				if (value[next] === '(' && word[0][0] !== '&' && word[0].indexOf('.') < 0 && !KEYWORDS.has(upper(word[0]))) {
					const close = closingParen(value, next);
					if (close < 0) {
						return null;
					}
					i = close + 1;
					out.push({ kind: 'call', start: start, end: i, word: upper(word[0]) });
					continue;
				}
				out.push({ kind: 'word', start: start, end: i, word: upper(word[0]) });
				continue;
			}
			i += 1;
			out.push({ kind: '+-*/'.indexOf(ch) >= 0 ? 'op' : 'other', start: start, end: i, op: ch });
		}
		return out;
	}

	/** Части `ВЫБОР … КОНЕЦ` во всё выражение: результаты веток ТОГДА и ИНАЧЕ; иначе null. */
	function caseBranches(value, tokens) {
		const last = tokens[tokens.length - 1];
		if (last.kind !== 'word' || (last.word !== 'КОНЕЦ' && last.word !== 'END')) {
			return null;
		}
		const branches = [];
		let depth = 0;
		let from = -1;
		let hasElse = false;
		for (let k = 0; k < tokens.length; k += 1) {
			const word = tokens[k].kind === 'word' ? tokens[k].word : '';
			if (word === 'ВЫБОР' || word === 'CASE') {
				depth += 1;
				continue;
			}
			const closes = word === 'КОНЕЦ' || word === 'END';
			const level = depth === 1;
			if (level && from >= 0 && (closes || word === 'КОГДА' || word === 'WHEN' || word === 'ИНАЧЕ' || word === 'ELSE')) {
				branches.push(value.slice(tokens[from].start, tokens[k - 1].end));
				from = -1;
			}
			if (level && (word === 'ТОГДА' || word === 'THEN' || word === 'ИНАЧЕ' || word === 'ELSE')) {
				if (k + 1 >= tokens.length) {
					return null;
				}
				hasElse = hasElse || word === 'ИНАЧЕ' || word === 'ELSE';
				from = k + 1;
			}
			if (closes) {
				depth -= 1;
				if (depth === 0 && k !== tokens.length - 1) {
					return null;
				}
			}
		}
		return depth === 0 && branches.length > 0 ? { branches: branches, hasElse: hasElse } : null;
	}

	/**
	 * Форма значения выражения, когда classifyExpression типа не даёт: для деления «>>» на
	 * «Группировке» и суммы нечислового (`Т.Количество * Т.Цена` число, место ему в суммируемых).
	 * Выводится только то, что следует из языка запросов:
	 * - `* / -` и унарный минус: число; `+`: kind 'plus', слагаемые типизирует вызывающий;
	 * - литералы: число, строка, ИСТИНА/ЛОЖЬ;
	 * - `ВЫБОР … КОНЕЦ` и ЕСТЬNULL, МАКСИМУМ, МИНИМУМ не от пути: kind 'merge';
	 * - функции с известным типом результата и ВЫРАЗИТЬ к примитиву.
	 * Сравнения, логика и прочее: unknown, чтобы поле не попало не в тот список.
	 *
	 * @returns {{kind: 'type', type: object}|{kind: 'merge', parts: string[]}|{kind: 'plus', operands: string[]}|{kind: 'unknown'}}
	 */
	function valueShape(expr) {
		const unknown = { kind: 'unknown' };
		let value = stripComments(expr);
		for (let guard = 0; guard < 16 && value[0] === '(' && closingParen(value, 0) === value.length - 1; guard += 1) {
			value = value.slice(1, -1).trim();
		}
		const tokens = value ? topTokens(value) : null;
		if (!tokens || tokens.length === 0) {
			return unknown;
		}
		const head = tokens[0].kind === 'word' ? tokens[0].word : '';
		if (head === 'ВЫБОР' || head === 'CASE') {
			const found = caseBranches(value, tokens);
			// Без ИНАЧЕ результат может быть NULL, типа это не меняет
			return found ? { kind: 'merge', parts: found.branches } : unknown;
		}
		if (tokens.some((token) => token.kind === 'op')) {
			// Арифметика: каждое слагаемое одна лексема, иначе в выражении сравнение, логика или ВЫБОР
			const operands = [];
			let numeric = false;
			let expectOperand = true;
			for (const token of tokens) {
				if (token.kind === 'op') {
					if (expectOperand && token.op !== '-' && token.op !== '+') {
						return unknown;
					}
					numeric = numeric || token.op !== '+';
					expectOperand = true;
					continue;
				}
				if (!expectOperand || token.kind === 'other') {
					return unknown;
				}
				operands.push(value.slice(token.start, token.end));
				expectOperand = false;
			}
			if (expectOperand) {
				return unknown;
			}
			return numeric ? { kind: 'type', type: primitive('xs:decimal') } : { kind: 'plus', operands: operands };
		}
		if (tokens.length !== 1) {
			return unknown;
		}
		const token = tokens[0];
		if (token.kind === 'number') {
			return { kind: 'type', type: primitive('xs:decimal') };
		}
		if (token.kind === 'string') {
			return { kind: 'type', type: primitive('xs:string') };
		}
		if (token.kind === 'word') {
			return BOOLEAN_WORDS.has(token.word) ? { kind: 'type', type: primitive('xs:boolean') } : unknown;
		}
		const call = token.kind === 'call' ? callOf(value) : null;
		if (!call) {
			return unknown;
		}
		if (NUMBER_FUNCTIONS.has(call.name)) {
			return { kind: 'type', type: primitive('xs:decimal') };
		}
		if (DATE_FUNCTIONS.has(call.name)) {
			return { kind: 'type', type: primitive('xs:dateTime') };
		}
		if (STRING_FUNCTIONS.has(call.name)) {
			return { kind: 'type', type: primitive('xs:string') };
		}
		if (PASS_THROUGH.has(call.name) && call.args.length >= 1) {
			// ЕСТЬNULL: тип первого или второго аргумента; МАКСИМУМ и МИНИМУМ: тип аргумента
			return { kind: 'merge', parts: call.name === 'ЕСТЬNULL' || call.name === 'ISNULL' ? call.args.slice(0, 2) : call.args.slice(0, 1) };
		}
		if ((call.name === 'ВЫРАЗИТЬ' || call.name === 'CAST') && call.args.length === 1) {
			const cast = new RegExp('\\s(?:КАК|AS)\\s+(' + IDENT + ')\\s*(?:\\([^()]*\\))?$', 'iu').exec(call.args[0]);
			const name = cast ? CAST_PRIMITIVES.get(upper(cast[1])) : undefined;
			if (name) {
				return { kind: 'type', type: primitive(name) };
			}
		}
		return unknown;
	}

	/** Простой примитив выражения: 'number', 'string' или ''. */
	function scalarKindOf(type) {
		const expanded = expandedTypes(type);
		if (expanded.typeSets.length > 0 || expanded.typeIds.length > 0 || expanded.types.length !== 1) {
			return '';
		}
		return expanded.types[0] === 'xs:decimal' ? 'number' : expanded.types[0] === 'xs:string' ? 'string' : '';
	}

	// ---------- источники запроса ----------

	/** Источники части объединения с алиасами: ИЗ через запятую и все соединения, вложенные тоже. */
	function partSources(part) {
		const out = [];
		function joins(items) {
			for (const join of list(items)) {
				if (join && join.source) {
					out.push(join.source);
				}
				joins(join && join.joins);
			}
		}
		for (const entry of list(part && part.from)) {
			if (entry && entry.source) {
				out.push(entry.source);
			}
			joins(entry && entry.joins);
		}
		return out;
	}

	function columnIndex(queryModel, statement, column) {
		const want = upper(column);
		return list(queryModel.outputFields(statement)).findIndex((name) => name !== null && upper(name) === want);
	}

	/** Итоги вывода: known (тип известен, у NULL пустой), waiting (ждёт описаний), unknown (не выводится). */
	const UNKNOWN = Object.freeze({ type: null, state: 'unknown' });
	const WAITING = Object.freeze({ type: null, state: 'waiting' });

	function known(type) {
		return { type: type || null, state: 'known' };
	}

	/**
	 * Вывод типов по разобранному пакету: пакет, кэш описаний и сборщик недостающих описаний общие
	 * на один вывод. outer: временные таблицы внешнего пакета ({name, statement, batch}), потому что
	 * у вложенного конструктора запроса своя модель, а ВТ созданы снаружи.
	 */
	function inferer(queryModel, batch, lookup, sink, outer) {
		/**
		 * Тип колонки запроса: объединение типов её выражений во всех частях. Часть без типа делает
		 * невыводимой всю колонку: неполный тип дал бы неполный список. Части обходятся все, чтобы
		 * описания запросились разом. byValue: выражение типизируется и по форме значения (valueType),
		 * так тип поля ресурса узнаёт число у `Т.Количество * Т.Цена` и `КОЛИЧЕСТВО(…)`.
		 */
		function statementColumn(statement, statementIndex, column, depth, byValue) {
			if (!statement || statement.type !== 'select' || depth > MAX_DEPTH) {
				return UNKNOWN;
			}
			const index = columnIndex(queryModel, statement, column);
			if (index < 0) {
				return UNKNOWN;
			}
			const found = [];
			let state = 'known';
			for (const part of list(statement.parts)) {
				const field = list(part && part.fields)[index];
				const result = field ? (byValue ? valueType : expressionType)(part, field.expr, statementIndex, depth) : UNKNOWN;
				if (result.state === 'unknown') {
					state = 'unknown';
				} else if (result.state === 'waiting' && state === 'known') {
					state = 'waiting';
				}
				found.push(result.type);
			}
			return state === 'known' ? known(mergeTypes(found)) : state === 'waiting' ? WAITING : UNKNOWN;
		}

		function expressionType(part, expr, statementIndex, depth) {
			const shape = classifyExpression(expr);
			if (shape.kind === 'null') {
				return known(null);
			}
			if (shape.kind === 'type') {
				return known(shape.type);
			}
			if (shape.kind !== 'path') {
				return UNKNOWN;
			}
			return pathType(part, shape.path.split('.'), statementIndex, depth);
		}

		/**
		 * Тип значения выражения части для «Группировки»: как у колонки (expressionType), иначе по
		 * форме значения (valueShape). Колонкам наборов это не нужно: им нужны только ссылки.
		 * Ветки и слагаемые обходятся все, чтобы описания запросились разом.
		 */
		function valueType(part, expr, statementIndex, depth) {
			const direct = expressionType(part, expr, statementIndex, depth);
			if (direct.state !== 'unknown' || depth > MAX_DEPTH) {
				return direct;
			}
			const shape = valueShape(expr);
			if (shape.kind === 'type') {
				return known(shape.type);
			}
			if (shape.kind !== 'merge' && shape.kind !== 'plus') {
				return UNKNOWN;
			}
			const results = (shape.kind === 'merge' ? shape.parts : shape.operands).map((item) => valueType(part, item, statementIndex, depth + 1));
			const waiting = results.some((result) => result.state === 'waiting');
			if (shape.kind === 'merge') {
				if (results.some((result) => result.state === 'unknown')) {
					return UNKNOWN;
				}
				return waiting ? WAITING : known(mergeTypes(results.map((result) => result.type)));
			}
			// Число среди слагаемых делает сумму числом, строка строкой
			const kinds = results.map((result) => (result.state === 'known' ? scalarKindOf(result.type) : ''));
			if (kinds.indexOf('number') >= 0) {
				return known(primitive('xs:decimal'));
			}
			if (kinds.indexOf('string') >= 0) {
				return known(primitive('xs:string'));
			}
			return waiting ? WAITING : UNKNOWN;
		}

		/**
		 * Путь в части: `Алиас.Поле…` от источника с этим алиасом, путь без алиаса от единственного
		 * источника с таким первым полем. Неоднозначность: не выводится; пока описания не пришли, ждёт.
		 */
		function pathType(part, segments, statementIndex, depth) {
			const sources = partSources(part);
			const head = upper(segments[0]);
			const aliased = segments.length > 1 ? sources.find((source) => upper(source && source.alias) === head) : null;
			if (aliased) {
				return sourcePath(aliased, segments.slice(1), statementIndex, depth);
			}
			let result = UNKNOWN;
			let hits = 0;
			let waiting = false;
			for (const source of sources) {
				const attempt = sourcePath(source, segments, statementIndex, depth);
				if (attempt.state === 'known') {
					hits += 1;
					result = attempt;
				} else if (attempt.state === 'waiting') {
					waiting = true;
				}
			}
			if (waiting) {
				return WAITING;
			}
			return hits === 1 ? result : UNKNOWN;
		}

		/** Путь от источника: первое имя колонка источника, остальное по типам через описания. */
		function sourcePath(source, segments, statementIndex, depth) {
			if (!source || segments.length === 0) {
				return UNKNOWN;
			}
			const first = sourceColumn(source, segments[0], statementIndex, depth);
			if (first.state !== 'known' || segments.length === 1) {
				return first;
			}
			const walked = walkType(first.type, segments.slice(1), lookup);
			sink.merge(walked.pending);
			if (walked.type) {
				return known(walked.type);
			}
			return walked.pending.length > 0 ? WAITING : UNKNOWN;
		}

		function sourceColumn(source, column, statementIndex, depth) {
			if (source.kind === 'subquery') {
				return statementColumn(source.query, statementIndex, column, depth + 1);
			}
			if (source.kind !== 'table') {
				return UNKNOWN;
			}
			const name = text(source.table);
			const constant = constantColumnTable(name, column);
			if (constant) {
				const own = tableObjectOf(constant.table, constant.lang);
				const described = describe(own, lookup, sink);
				if (described === undefined) {
					return WAITING;
				}
				const value = described ? findField(findTable(described, own.tail), constant.field) : null;
				return value && hasTypes(value.type) ? known(value.type) : UNKNOWN;
			}
			if (isConstantsTable(name)) {
				return UNKNOWN;
			}
			if (name.indexOf('.') < 0) {
				// Без точки: временная таблица пакета, тип по создавшему её запросу
				const temp = list(queryModel.tempTables(batch, statementIndex)).find((table) => upper(table.name) === upper(name));
				if (temp) {
					return statementColumn(batch.statements[temp.statement], temp.statement, column, depth + 1);
				}
				// Иначе ВТ внешнего пакета
				const external = list(outer).find((table) => table && table.batch && upper(table.name) === upper(name));
				if (!external) {
					return UNKNOWN;
				}
				const statements = list(external.batch.statements);
				return inferer(queryModel, external.batch, lookup, sink, outer).statementColumn(statements[external.statement], external.statement, column, depth + 1);
			}
			// Описание на языке вида таблицы (см. tableLang): таблицы соответствия EN→RU нет
			const target = tableObjectOf(name, tableLang(name));
			const description = describe(target, lookup, sink);
			if (description === undefined) {
				return WAITING;
			}
			if (!description) {
				return UNKNOWN;
			}
			const field = findField(findTable(description, target.tail), column);
			return field && hasTypes(field.type) ? known(field.type) : UNKNOWN;
		}

		return { statementColumn: statementColumn, expressionType: expressionType, valueType: valueType };
	}

	/**
	 * Тип колонки результата запроса: колонка последнего запроса выборки пакета (не уничтожение и
	 * не помещение в ВТ), по которому платформа строит поля набора. `column` с точкой
	 * (`Контрагент.ИНН`): колонка и путь по типам от неё.
	 *
	 * @param {string} queryText Текст запроса набора.
	 * @param {string} column Имя колонки (поле `field` поля набора).
	 * @param {function} lookup Ключ объекта → описание | null | undefined.
	 * @param {{queryModel: object, parse?: function}} options queryModel: модуль DcsQueryModel;
	 *   parse(text): разбор с кэшем обвязки (по умолчанию queryModel.parse).
	 * @returns {{type: object|null, pending: object[]}}
	 */
	function queryColumnType(queryText, column, lookup, options) {
		const result = queryColumnResult(queryText, column, lookup, options);
		return { type: result.state === 'known' ? result.type : null, pending: result.pending };
	}

	/**
	 * Колонка результата запроса с итогом вывода: общее тело queryColumnType и resourceFieldType.
	 * state: known, waiting или unknown; present: есть ли в запросе такая колонка, null, если разбор
	 * этого не скажет. options.byValue: типизация и по форме значения (см. statementColumn).
	 *
	 * @returns {{state: string, type: object|null, present: boolean|null, pending: object[]}}
	 */
	function queryColumnResult(queryText, column, lookup, options) {
		const sink = collector();
		const opts = options || {};
		const queryModel = opts.queryModel;
		const segments = text(column).split('.');
		const blind = { state: 'unknown', type: null, present: null, pending: sink.pending };
		if (!queryModel || typeof queryModel.parse !== 'function' || !text(queryText) || segments.some((segment) => !IDENT_RE.test(segment))) {
			return blind;
		}
		const parsed = typeof opts.parse === 'function' ? opts.parse(queryText) : queryModel.parse(queryText);
		// Разбор с диагностикой мог разложить текст не так, как платформа: тип по нему был бы догадкой
		if (!parsed || !parsed.model || list(parsed.diagnostics).length > 0) {
			return blind;
		}
		const statements = list(parsed.model.statements);
		const index = queryModel.lastSelectIndex(statements);
		if (index < 0) {
			return blind;
		}
		const present = columnIndex(queryModel, statements[index], segments[0]) >= 0;
		const result = inferer(queryModel, parsed.model, lookup, sink).statementColumn(statements[index], index, segments[0], 0, opts.byValue === true);
		if (result.state !== 'known' || !result.type || segments.length === 1) {
			return { state: result.state, type: result.state === 'known' ? result.type : null, present: present, pending: sink.pending };
		}
		const walked = walkType(result.type, segments.slice(1), lookup);
		sink.merge(walked.pending);
		return {
			state: walked.type ? 'known' : walked.pending.length > 0 ? 'waiting' : 'unknown',
			type: walked.type,
			present: present,
			pending: sink.pending,
		};
	}

	/**
	 * Тип колонки запроса пакета по номеру: так конструктор запроса узнаёт типы колонок ВТ, чтобы
	 * разыменовать ссылочное поле и предложить связь. Правила те же, что у queryColumnType; пакет:
	 * разобранная модель окна, в том числе не записанная.
	 *
	 * @param {object} batch Модель запроса (DcsQueryModel.parse(...).model или модель конструктора).
	 * @param {number} statementIndex Номер запроса пакета.
	 * @param {string} column Имя колонки.
	 * @param {function} lookup Ключ объекта → описание | null | undefined.
	 * @param {{queryModel: object}} options queryModel: модуль DcsQueryModel.
	 * @returns {{type: object|null, pending: object[]}}
	 */
	function batchColumnType(batch, statementIndex, column, lookup, options) {
		const sink = collector();
		const queryModel = options && options.queryModel;
		const statements = list(batch && batch.statements);
		if (!queryModel || typeof queryModel.outputFields !== 'function' || !statements[statementIndex] || !IDENT_RE.test(text(column))) {
			return { type: null, pending: sink.pending };
		}
		const result = inferer(queryModel, batch, lookup, sink).statementColumn(statements[statementIndex], statementIndex, column, 0);
		return { type: result.state === 'known' ? result.type : null, pending: sink.pending };
	}

	/** Модуль разбора умеет то, на чём стоит вывод по модели конструктора: колонки запроса и ВТ пакета. */
	function canInfer(queryModel) {
		return Boolean(queryModel && typeof queryModel.outputFields === 'function' && typeof queryModel.tempTables === 'function');
	}

	/**
	 * Тип выражения поля части запроса: по правилам колонки набора, а сверх них по форме значения
	 * (valueShape). Так конструктор запроса делит поля на «Группировке» на групповые и суммируемые;
	 * для суммируемого поля обвязка передаёт аргумент агрегата. ВТ видны по пакету до statementIndex
	 * и в options.outerTemp. Тип не вывелся или ждёт описаний: null, недостающее в pending.
	 *
	 * @param {object} batch Модель запроса (пакет), в которой лежит часть.
	 * @param {number} statementIndex Номер запроса части в пакете.
	 * @param {object} part Часть объединения (её источники разрешают алиасы выражения).
	 * @param {string} expr Выражение.
	 * @param {function} lookup Ключ объекта → описание | null | undefined.
	 * @param {{queryModel: object, outerTemp?: object[]}} options queryModel: модуль DcsQueryModel;
	 *   outerTemp: ВТ внешнего пакета {name, statement, batch}.
	 * @returns {{type: object|null, pending: object[]}}
	 */
	function partExpressionType(batch, statementIndex, part, expr, lookup, options) {
		const sink = collector();
		const opts = options || {};
		if (!canInfer(opts.queryModel) || !part || typeof part !== 'object' || !text(expr).trim()) {
			return { type: null, pending: sink.pending };
		}
		const own = batch && typeof batch === 'object' ? batch : { statements: [] };
		const result = inferer(opts.queryModel, own, lookup, sink, opts.outerTemp).valueType(part, expr, statementIndex, 0);
		return { type: result.state === 'known' ? result.type : null, pending: sink.pending };
	}

	/**
	 * Тип колонки вложенного запроса (`(ВЫБРАТЬ …) КАК Вл`): по нему ссылочное поле подзапроса
	 * раскрывается в «Таблицах» и даёт связи. Вывод как у колонки набора; ВТ видны по пакету до
	 * statementIndex и в options.outerTemp.
	 *
	 * @param {object} batch Модель запроса, в которой лежит часть с подзапросом.
	 * @param {number} statementIndex Номер запроса этой части в пакете.
	 * @param {object} subquery Запрос источника (source.query).
	 * @param {string} column Имя колонки подзапроса.
	 * @param {function} lookup Ключ объекта → описание | null | undefined.
	 * @param {{queryModel: object, outerTemp?: object[]}} options Как у partExpressionType.
	 * @returns {{type: object|null, pending: object[]}}
	 */
	function subqueryColumnType(batch, statementIndex, subquery, column, lookup, options) {
		const sink = collector();
		const opts = options || {};
		if (!canInfer(opts.queryModel) || !subquery || typeof subquery !== 'object' || !IDENT_RE.test(text(column))) {
			return { type: null, pending: sink.pending };
		}
		const own = batch && typeof batch === 'object' ? batch : { statements: [] };
		// Глубина 1: подзапрос уже вложенный источник
		const result = inferer(opts.queryModel, own, lookup, sink, opts.outerTemp).statementColumn(subquery, statementIndex, column, 1);
		return { type: result.state === 'known' ? result.type : null, pending: sink.pending };
	}

	// ---------- проверка имён запроса ----------

	/**
	 * Окружение проверки имён запроса (DcsQueryEdit.nameProblems) по кэшу описаний, общее для webview
	 * и node-тестов.
	 * - describe(имяТаблицы): таблица из описания на языке вида таблицы; объект описан, а таблицы нет:
	 *   {state: 'none', description}, по нему проверка находит опечатку в хвосте; общую таблицу
	 *   констант даёт options.constants;
	 * - pathType: тип пути через partExpressionType;
	 * - members(тип): реквизиты типа из одних ссылок с описаниями, не больше MAX_UNION_REFS: поля
	 *   основных таблиц (русские и английские имена) и табличные части. Иначе known: false, проверка
	 *   молчит.
	 * Недостающие описания копятся в env.pending: обвязка запрашивает их и проверяет снова.
	 *
	 * @param {function} lookup Ключ объекта → описание | null | undefined.
	 * @param {{queryModel: object, outerTemp?: object[], constants?: function, objectExists?: function,
	 *   commonAttributes?: string[]}} options
	 *   queryModel: модуль DcsQueryModel; outerTemp: ВТ внешнего пакета; constants(имяТаблицы) →
	 *   {state, table}: общая таблица констант; objectExists(видRu, имя) → true|false|null по дереву
	 *   «База данных»; commonAttributes: имена общих реквизитов, которых описания могут не перечислять.
	 * @returns {{pending: object[], describe: function, objectOf: function, objectExists: function,
	 *   outerTemp: object[], commonAttributes: string[], pathType: function, members: function}}
	 */
	function nameCheckEnv(lookup, options) {
		const opts = options || {};
		const sink = collector();
		function describeTable(tableName) {
			if (isConstantsTable(tableName)) {
				const constants = typeof opts.constants === 'function' ? opts.constants(tableName) : null;
				return constants && typeof constants === 'object' ? constants : { state: 'none' };
			}
			const target = tableObjectOf(tableName, tableLang(tableName));
			if (!target) {
				return { state: 'none' };
			}
			const description = describe(target, lookup, sink);
			if (description === undefined) {
				return { state: 'loading' };
			}
			if (!description) {
				return { state: 'none' };
			}
			const table = findTable(description, target.tail);
			return table ? { state: 'ready', table: table, description: description } : { state: 'none', description: description };
		}
		function members(type) {
			const expanded = expandedTypes(type);
			if (expanded.typeIds.length > 0 || expanded.typeSets.length > 0 || expanded.types.length === 0 || !expanded.types.every((name) => REF_TYPE_RE.test(name))) {
				return { known: false };
			}
			const refs = refTypesOf(type);
			if (refs.length === 0 || refs.length > MAX_UNION_REFS) {
				return { known: false };
			}
			const names = [];
			let waiting = false;
			let missing = false;
			for (const ref of refs) {
				const description = describe(ref, lookup, sink);
				if (description === undefined) {
					waiting = true;
					continue;
				}
				const table = description ? findTable(description, []) : null;
				if (!table) {
					missing = true;
					continue;
				}
				for (const field of list(table.fields)) {
					for (const name of [text(field && field.name), text(field && field.nameEn)]) {
						if (name) {
							names.push(name);
						}
					}
				}
				for (const own of list(description.tables)) {
					if (own && (own.kind === 'tabularSection' || own.kind === 'standardTabularSection')) {
						const name = text(own.name);
						names.push(name.slice(name.lastIndexOf('.') + 1));
					}
				}
			}
			return waiting || missing ? { known: false, loading: waiting } : { known: true, names: names };
		}
		return {
			pending: sink.pending,
			describe: describeTable,
			objectOf: (tableName) => tableObjectOf(tableName),
			objectExists: typeof opts.objectExists === 'function' ? opts.objectExists : () => null,
			outerTemp: list(opts.outerTemp),
			commonAttributes: list(opts.commonAttributes).filter((name) => typeof name === 'string'),
			pathType(batch, statementIndex, part, expr) {
				const result = partExpressionType(batch, statementIndex, part, expr, lookup, { queryModel: opts.queryModel, outerTemp: opts.outerTemp });
				sink.merge(result.pending);
				return { type: result.type };
			},
			members: members,
		};
	}

	// ---------- поля наборов ----------

	/**
	 * Набор по имени или пути «Объединение/Дочерний», как у каталога подсказки: имя без пути ищется
	 * сначала на верхнем уровне, затем во вложенных.
	 */
	function findDataSet(model, name) {
		const parts = text(name).split('/').filter(Boolean);
		if (parts.length === 0) {
			return null;
		}
		let level = list(model && model.dataSets);
		if (parts.length > 1) {
			let found = null;
			for (const part of parts) {
				found = level.find((item) => item && item.name === part) || null;
				if (!found) {
					return null;
				}
				level = list(found.items);
			}
			return found;
		}
		function walk(sets) {
			const own = sets.find((item) => item && item.name === parts[0]);
			if (own) {
				return own;
			}
			for (const item of sets) {
				const nested = item ? walk(list(item.items)) : null;
				if (nested) {
					return nested;
				}
			}
			return null;
		}
		return walk(level);
	}

	/**
	 * Тип поля набора по пути данных: записанный; у набора-запроса выведенный по колонке `field` (у
	 * не описанного поля по колонке с именем пути: автозаполнение платформы даёт его и без описания);
	 * у объединения объединение типов вложенных наборов; у набора-объекта не выводится.
	 *
	 * @param {object} model Модель cf-dcs-info.
	 * @param {string} dataPath Путь поля.
	 * @param {function} lookup Ключ объекта → описание | null | undefined.
	 * @param {{queryModel: object, parse?: function, dataSet?: string, fieldIndex?: Map}} options
	 *   dataSet: искать только в этом наборе, без него во всех, тёзки складываются. fieldIndex: пустой
	 *   Map вызывающего на время одной модели, чтобы поля набора раскладывались по пути один раз.
	 * @returns {{type: object|null, pending: object[]}}
	 */
	function dataSetFieldType(model, dataPath, lookup, options) {
		const opts = options || {};
		const sink = collector();
		const want = upper(dataPath);
		const found = [];
		function fieldOf(dataSet) {
			const index = opts.fieldIndex instanceof Map ? opts.fieldIndex : null;
			if (!index) {
				return list(dataSet.fields).find((item) => item && item.kind !== 'folder' && item.kind !== 'nested' && upper(item.dataPath) === want);
			}
			let byPath = index.get(dataSet);
			if (!byPath) {
				byPath = new Map();
				for (const item of list(dataSet.fields)) {
					const key = item && item.kind !== 'folder' && item.kind !== 'nested' ? upper(item.dataPath) : '';
					// Первое вхождение, как у find без раскладки
					if (key && !byPath.has(key)) {
						byPath.set(key, item);
					}
				}
				index.set(dataSet, byPath);
			}
			return byPath.get(want);
		}
		function fromSet(dataSet, depth) {
			if (!dataSet || depth > MAX_DEPTH) {
				return;
			}
			const field = fieldOf(dataSet);
			if (field && hasTypes(field.valueType)) {
				found.push(field.valueType);
				return;
			}
			if (dataSet.type === 'query' && (field || dataSet.autoFillFields !== false)) {
				const result = queryColumnType(dataSet.query, field ? text(field.field) || text(field.dataPath) : text(dataPath), lookup, opts);
				sink.merge(result.pending);
				if (result.type) {
					found.push(result.type);
				}
				return;
			}
			if (dataSet.type === 'union') {
				for (const item of list(dataSet.items)) {
					fromSet(item, depth + 1);
				}
			}
		}
		if (opts.dataSet) {
			fromSet(findDataSet(model, opts.dataSet), 0);
		} else {
			for (const dataSet of list(model && model.dataSets)) {
				fromSet(dataSet, 0);
			}
		}
		return { type: mergeTypes(found), pending: sink.pending };
	}

	// ---------- тип поля ресурса ----------

	/** Итог по нескольким наборам: unknown у одного даёт unknown, затем waiting, иначе объединение типов. */
	function combineStates(parts) {
		if (parts.some((part) => part.state === 'unknown')) {
			return { state: 'unknown', type: null };
		}
		if (parts.some((part) => part.state === 'waiting')) {
			return { state: 'waiting', type: null };
		}
		return { state: 'known', type: mergeTypes(parts.map((part) => part.type)) };
	}

	/**
	 * Тип поля для ресурса по умолчанию `Сумма(<поле>)`: «>>» на «Ресурсах» берёт только поля с известным числовым
	 * типом, а «>» предупреждает о сумме по нечисловому. Строже dataSetFieldType: тип известен, только если его знает
	 * каждый набор, где поле есть, потому что тип одного набора не говорит за другой.
	 * - Вычисляемое поле (kind 'calc'): записанный тип, выражение не разбирается.
	 * - Поле набора: записанный тип; у набора-запроса без него колонка запроса с формой значения (queryColumnResult);
	 *   у объединения каждый вложенный набор, где поле есть; у набора-объекта только записанный.
	 * Набор, где поля нет, не в счёт. Набор-запрос с автозаполнением, о колонках которого разбор не скажет, делает тип
	 * неизвестным: такая колонка в нём может быть. waiting: тип ждёт описаний из pending.
	 *
	 * @param {object} model Модель cf-dcs-info.
	 * @param {string} path Путь поля набора или имя вычисляемого поля.
	 * @param {string} kind Вид узла дерева «Доступные поля»: 'calc' для вычисляемого поля, иначе поле набора.
	 * @param {function} lookup Ключ объекта → описание | null | undefined.
	 * @param {{queryModel: object, parse?: function}} options Как у dataSetFieldType.
	 * @returns {{state: 'known'|'waiting'|'unknown', type: object|null, pending: object[]}}
	 */
	function resourceFieldType(model, path, kind, lookup, options) {
		const want = upper(path);
		if (kind === 'calc') {
			const calc = list(model && model.calculatedFields).find((item) => item && upper(item.name) === want);
			return calc && hasTypes(calc.valueType) ? { state: 'known', type: calc.valueType, pending: [] } : { state: 'unknown', type: null, pending: [] };
		}
		const opts = Object.assign({}, options || {}, { byValue: true });
		const sink = collector();
		// Вклад набора: null, если поля в наборе нет, иначе {state, type}
		function fromSet(dataSet, depth) {
			if (!dataSet || depth > MAX_DEPTH) {
				return null;
			}
			const field = list(dataSet.fields).find((item) => item && item.kind !== 'folder' && item.kind !== 'nested' && upper(item.dataPath) === want);
			if (field && hasTypes(field.valueType)) {
				return { state: 'known', type: field.valueType };
			}
			if (dataSet.type === 'union') {
				const parts = list(dataSet.items)
					.map((item) => fromSet(item, depth + 1))
					.filter(Boolean);
				if (parts.length === 0) {
					return field ? { state: 'unknown', type: null } : null;
				}
				return combineStates(parts);
			}
			if (dataSet.type === 'query' && (field || dataSet.autoFillFields !== false)) {
				const result = queryColumnResult(dataSet.query, field ? text(field.field) || text(field.dataPath) : text(path), lookup, opts);
				// Не описанное поле есть в наборе, только если в запросе есть такая колонка
				if (!field && result.present !== true) {
					return result.present === false || !text(dataSet.query) ? null : { state: 'unknown', type: null };
				}
				sink.merge(result.pending);
				return { state: result.state, type: result.type };
			}
			return field ? { state: 'unknown', type: null } : null;
		}
		const parts = list(model && model.dataSets)
			.map((dataSet) => fromSet(dataSet, 0))
			.filter(Boolean);
		if (parts.length === 0) {
			return { state: 'unknown', type: null, pending: [] };
		}
		const merged = combineStates(parts);
		return { state: merged.state, type: merged.type, pending: merged.state === 'waiting' ? sink.pending : [] };
	}

	/**
	 * Слова языка выражений, которыми путь поля не может начинаться без квадратных скобок: ключевые слова (ВЫБОР, И, В…) и
	 * литералы (ИСТИНА, NULL…). ССЫЛКА и ИЕРАРХИИ исключены: на месте операнда это имя поля (`ВЫБРАТЬ Ссылка`).
	 */
	const EXPRESSION_WORDS = new Set(
		Array.from(KEYWORDS)
			.filter((word) => ['ССЫЛКА', 'REFS', 'ИЕРАРХИИ', 'HIERARCHY'].indexOf(word) < 0)
			.concat(['ИСТИНА', 'ЛОЖЬ', 'TRUE', 'FALSE', 'NULL', 'НЕОПРЕДЕЛЕНО', 'UNDEFINED'])
	);

	/**
	 * Прочитает ли выражение `Сумма(<путь>)` путь как поле: сегменты идентификаторы, первый не из EXPRESSION_WORDS
	 * (после точки слово уже имя реквизита). Неподходящие поля «>>» пропускает, а «>» добавляет с предупреждением.
	 *
	 * @param {string} path Путь поля.
	 * @returns {boolean}
	 */
	function plainFieldPath(path) {
		const value = text(path);
		return PATH_RE.test(value) && !EXPRESSION_WORDS.has(upper(value.split('.')[0]));
	}

	/**
	 * Наборы, чей состав без typeCompositions неизвестен: в определяемом типе или характеристике может оказаться и
	 * число. Прочие наборы (вид ссылок, «любая ссылка») заведомо не числа.
	 */
	const OPEN_SET_RE = /^[A-Za-z0-9]+:(?:DefinedType|Characteristic)\./;

	/**
	 * Числовой ли раскрытый тип:
	 * - numeric: только `xs:decimal`, без наборов и UUID;
	 * - other: тип известен целиком и числа в нём нет;
	 * - mixed: число вместе с другим или неизвестным;
	 * - unknown: типа нет, или в нём набор либо UUID без состава.
	 * Копия правила DcsQueryEdit.numericKind (модуль без зависимостей), совпадение проверяет node-тест.
	 *
	 * @returns {'numeric'|'other'|'mixed'|'unknown'}
	 */
	function numericKind(dto) {
		const expanded = expandedTypes(dto);
		const hasNumber = expanded.types.indexOf('xs:decimal') >= 0;
		const others = expanded.types.filter((name) => name !== 'xs:decimal').length + expanded.typeSets.filter((name) => !OPEN_SET_RE.test(name)).length;
		const open = expanded.typeIds.length + expanded.typeSets.filter((name) => OPEN_SET_RE.test(name)).length;
		if (hasNumber) {
			return others === 0 && open === 0 ? 'numeric' : 'mixed';
		}
		return open > 0 || others === 0 ? 'unknown' : 'other';
	}

	/** Наборы, поля которых видит место ввода подсказки: у связи и роли поля названные, иначе null (все). */
	function scopeDataSets(scope) {
		const raw = text(scope);
		const colon = raw.indexOf(':');
		const head = colon >= 0 ? raw.slice(0, colon) : raw;
		const arg = colon >= 0 ? raw.slice(colon + 1) : '';
		if (head === 'link-source' || head === 'link-dest' || head === 'field-of-set') {
			return arg ? [arg] : [];
		}
		if (head === 'link-both') {
			return arg.split('|').filter(Boolean);
		}
		return null;
	}

	/**
	 * Точка расширения extraChildren подсказки для места ввода: тип последнего узла каталога на
	 * пути (записанный или выведенный по запросу набора) и сегменты после него.
	 *
	 * @param {{mode?: string, chain?: object[]}} info Режим контекста и цепочка узлов каталога от
	 *   корня до последнего найденного по parentPath (из childrenOf).
	 * @param {string} parentPath Путь до точки.
	 * @param {{model: object, scope: string, lookup: function, queryModel?: object, parse?: function,
	 *   typeText?: function, fieldIndex?: Map}} env Модель схемы, место ввода, кэш описаний и подпись
	 *   типа; fieldIndex: раскладка полей наборов вызывающего (см. dataSetFieldType).
	 * @returns {{children: object[], pending: object[]}}
	 */
	function extraChildrenFor(info, parentPath, env) {
		const empty = { children: [], pending: [] };
		const chain = list(info && info.chain);
		const options = env || {};
		if (chain.length === 0) {
			return empty;
		}
		const last = chain[chain.length - 1];
		const segments = text(parentPath).split('.');
		const rest = segments.slice(chain.length);
		let base = hasTypes(last.valueType) ? last.valueType : null;
		const sink = collector();
		// Параметры живут своим пространством имён: выводятся только поля наборов
		if (!base && (!info || info.mode !== 'param') && last.kind !== 'param' && last.kind !== 'dataParam') {
			const sets = scopeDataSets(options.scope);
			const results = (sets === null ? [null] : sets).map((name) =>
				dataSetFieldType(options.model, last.path, options.lookup, {
					queryModel: options.queryModel,
					parse: options.parse,
					dataSet: name || undefined,
					fieldIndex: options.fieldIndex,
				})
			);
			for (const result of results) {
				sink.merge(result.pending);
			}
			base = mergeTypes(results.map((result) => result.type));
		}
		if (!base) {
			return { children: [], pending: sink.pending };
		}
		const result = childrenAt(base, rest, options.lookup, { typeText: options.typeText });
		sink.merge(result.pending);
		return { children: result.children, pending: sink.pending };
	}

	const api = {
		OBJECT_KINDS: OBJECT_KINDS,
		MAX_UNION_REFS: MAX_UNION_REFS,
		refObjectOf: refObjectOf,
		tableObjectOf: tableObjectOf,
		isConstantsTable: isConstantsTable,
		constantColumnTable: constantColumnTable,
		answerKeyOf: answerKeyOf,
		findTable: findTable,
		findField: findField,
		mergeTypes: mergeTypes,
		attachTypeCompositions: attachTypeCompositions,
		expandedTypes: expandedTypes,
		refTypeNames: refTypeNames,
		expandable: expandable,
		typeChildren: typeChildren,
		walkType: walkType,
		classifyExpression: classifyExpression,
		valueShape: valueShape,
		queryColumnType: queryColumnType,
		batchColumnType: batchColumnType,
		partExpressionType: partExpressionType,
		subqueryColumnType: subqueryColumnType,
		nameCheckEnv: nameCheckEnv,
		dataSetFieldType: dataSetFieldType,
		resourceFieldType: resourceFieldType,
		plainFieldPath: plainFieldPath,
		numericKind: numericKind,
		scopeDataSets: scopeDataSets,
		extraChildrenFor: extraChildrenFor,
	};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (root) {
		root.DcsFieldTypes = api;
	}
})(typeof window === 'undefined' ? globalThis : window);
