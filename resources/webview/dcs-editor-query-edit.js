/**
 * Операции конструктора запроса СКД над моделью запроса — чистые функции.
 *
 * Модель — та, что строит разборщик (dcs-editor-query-model.js, window.DcsQueryModel): вкладки
 * конструктора (dcs-editor-query-dialog.js) меняют её только через эти функции, а текст по ОК
 * собирает сборщик модели со сплайсом по запросам пакета. Каждая операция получает модель и адрес {statement, part}
 * (индекс запроса пакета и части объединения) и возвращает новую модель (или {model, …, warnings}),
 * исходную не трогает: окно держит исходную модель для «модель не менялась — ничего не пишем», а
 * сравнение по месту испорченного объекта ничего бы не значило.
 *
 * Файл живёт двумя жизнями, как остальные модули редактора: webview подключает его отдельным
 * <script> после модели запроса и берёт window.DcsQueryEdit (уже привязанный к window.DcsQueryModel),
 * а node-тесты исполняют его в песочнице и зовут module.exports.create(модельЗапроса). Поэтому
 * здесь нет ни DOM, ни require.
 *
 * Новые источники и параметры виртуальных таблиц строятся не руками, а разбором короткого текста
 * той же моделью: так узел источника совпадает с тем, что даст разбор собранного текста, и круг
 * «операция → сборка → разбор» не расходится (признак virtualTable, форма параметров {…}). Номера
 * групп необязательных соединений и элементы блоков {ВЫБРАТЬ} и {ГДЕ} приводятся к тому, что даст
 * разбор собранного текста, — по тому же правилу круга.
 *
 * Проверка имён таблиц и полей по метаданным (nameProblems) даёт только предупреждения; описания и
 * дерево «База данных» ей подаёт окружение DcsFieldTypes.nameCheckEnv, сам модуль их не знает.
 */
(function (root) {
	'use strict';

	const IDENT_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;
	const PATH_RE = /^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u;
	const SIMPLE_FIELD_RE = /^([\p{L}_][\p{L}\p{N}_]*)\.([\p{L}_][\p{L}\p{N}_]*)$/u;

	/** Литералы-слова: по виду путь из одного сегмента, но имени колонки не дают (как в модели запроса). */
	const LITERALS = new Set(['ИСТИНА', 'ЛОЖЬ', 'NULL', 'НЕОПРЕДЕЛЕНО', 'TRUE', 'FALSE', 'UNDEFINED']);

	/**
	 * Слова, которые разборщик примет за начало предложения или соединения: алиас с таким именем
	 * разломал бы собранный текст, поэтому переименование их не пропускает.
	 */
	const RESERVED = new Set([
		'ВЫБРАТЬ', 'РАЗРЕШЕННЫЕ', 'РАЗЛИЧНЫЕ', 'ПЕРВЫЕ', 'КАК', 'ПОМЕСТИТЬ', 'ДОБАВИТЬ', 'ИЗ', 'ГДЕ', 'СГРУППИРОВАТЬ',
		'ИМЕЮЩИЕ', 'ОБЪЕДИНИТЬ', 'ВСЕ', 'УПОРЯДОЧИТЬ', 'АВТОУПОРЯДОЧИВАНИЕ', 'ИТОГИ', 'ИНДЕКСИРОВАТЬ', 'ДЛЯ',
		'УНИЧТОЖИТЬ', 'ЛЕВОЕ', 'ПРАВОЕ', 'ПОЛНОЕ', 'ВНУТРЕННЕЕ', 'ВНЕШНЕЕ', 'СОЕДИНЕНИЕ', 'ПО', 'И', 'ИЛИ', 'НЕ',
		'МЕЖДУ', 'В', 'ВЫБОР', 'КОГДА', 'ТОГДА', 'ИНАЧЕ', 'КОНЕЦ', 'ЕСТЬ', 'ПОДОБНО', 'ССЫЛКА', 'ИЕРАРХИИ',
		'SELECT', 'ALLOWED', 'DISTINCT', 'TOP', 'AS', 'INTO', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'UNION', 'ALL',
		'ORDER', 'AUTOORDER', 'TOTALS', 'INDEX', 'FOR', 'DROP', 'LEFT', 'RIGHT', 'FULL', 'INNER', 'OUTER', 'JOIN',
		'ON', 'BY', 'AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IS', 'LIKE',
		'REFS', 'HIERARCHY',
	].concat(Array.from(LITERALS)));

	/** Метка «здесь был алиас»: по ней проверка «ссылается ли текст на алиас» обходится без своего лексера. */
	const MARK = '\u0001ПроверкаАлиаса';

	function list(value) {
		return Array.isArray(value) ? value : [];
	}

	function text(value) {
		return typeof value === 'string' ? value : '';
	}

	function upper(value) {
		return text(value).toUpperCase();
	}

	function clone(value) {
		return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
	}

	// ---------- раскрытые типы: составы определяемых типов и характеристик ----------

	/** Ссылочный тип с именем объекта (`cfg:CatalogRef.X`): наборы вида и «любая ссылка» — нет. */
	const REF_TYPE_RE = /^[A-Za-z0-9]+:[A-Za-z]+Ref\.[^.]+$/;

	/**
	 * Тип с раскрытыми составами — та же функция, что DcsFieldTypes.expandedTypes: модуль остаётся без
	 * зависимостей, поэтому правило здесь своё, а совпадение копий сверяет node-тест на всех полях
	 * фикстуры. Обвязка пришивает к типу составы ответа md-sparrow (type.compositions); элементы
	 * typeSets/typeIds, у которых есть запись (источник — без учёта регистра, первая запись
	 * побеждает), заменяются её types/typeSets, остальные остаются. Без compositions — те же списки.
	 *
	 * @returns {{types: string[], typeSets: string[], typeIds: string[]}}
	 */
	function expandedTypes(dto) {
		const out = { types: [], typeSets: [], typeIds: [] };
		if (!dto || typeof dto !== 'object') {
			return out;
		}
		const index = new Map();
		for (const record of list(dto.compositions)) {
			if (record && typeof record === 'object' && text(record.source) !== '' && !index.has(upper(record.source))) {
				index.set(upper(record.source), record);
			}
		}
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

	/** Ссылочные типы по раскрытому типу, без повторов (копия DcsFieldTypes.refTypeNames). */
	function refTypeNames(dto) {
		return expandedTypes(dto).types.filter((name) => REF_TYPE_RE.test(name));
	}

	/**
	 * Наборы, чей состав без typeCompositions неизвестен: в определяемом типе или характеристике
	 * может оказаться и число. Прочие наборы (вид ссылок, «любая ссылка») — заведомо не числа.
	 */
	const OPEN_SET_RE = /^[A-Za-z0-9]+:(?:DefinedType|Characteristic)\./;

	/**
	 * Числовой ли тип — для деления «>>» на «Группировке» и предупреждения о сумме, по
	 * раскрытому типу (тот же expandedTypes, что у связей: составы определяемых типов учтены, если
	 * обвязка их пришила или уже раскрыла):
	 * - numeric — только `xs:decimal`, без наборов и UUID;
	 * - other — тип известен целиком и числа в нём нет (ссылки, строки, даты, булево, период, UUID);
	 * - mixed — число вместе с другим или неизвестным;
	 * - unknown — типа нет, или в нём набор либо UUID без состава.
	 * Решения «в оба списка» принимает вызывающий: mixed и unknown не отсекают поле ни от одного. Копия правила —
	 * DcsFieldTypes.numericKind (тип поля ресурса на вкладке «Ресурсы»), совпадение копий сверяет node-тест.
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

	/**
	 * Тип, по которому платформа не группирует и не считает максимум и минимум: строка неограниченной
	 * длины (`xs:string` с длиной 0 в stringQualifiers самого типа) и ХранилищеЗначения. «>>» такие
	 * поля всё равно берёт в групповые (групповые — всё, кроме чисел), а вкладка только предупреждает.
	 * Длины у определяемого типа здесь нет — о нём молчим.
	 *
	 * @returns {'unlimitedString'|'valueStorage'|''}
	 */
	function ungroupableKind(dto) {
		if (!dto || typeof dto !== 'object') {
			return '';
		}
		const names = list(dto.types);
		if (names.indexOf('v8:ValueStorage') >= 0) {
			return 'valueStorage';
		}
		const length = dto.stringQualifiers && typeof dto.stringQualifiers === 'object' ? dto.stringQualifiers.length : undefined;
		return names.indexOf('xs:string') >= 0 && length !== undefined && length !== null && String(length).trim() === '0' ? 'unlimitedString' : '';
	}

	/** Пустая часть объединения — ровно такие ключи и значения даёт разборщик, иначе sameModel расходился бы. */
	function emptyPart() {
		return {
			unionAll: null,
			allowed: false,
			distinct: false,
			top: null,
			fields: [],
			dcsSelect: null,
			into: null,
			from: [],
			where: null,
			dcsWhere: null,
			groupBy: null,
			having: null,
			forUpdate: null,
			raw: [],
		};
	}

	/** Пустой запрос выборки: новый текст набора и новый вложенный запрос начинаются с него. */
	function emptyStatement() {
		return { type: 'select', parts: [emptyPart()], orderBy: null, autoOrder: false, totals: null, indexes: [], forUpdate: null, raw: [] };
	}

	/** Имя колонки поля: псевдоним, иначе последний сегмент пути; выражение без псевдонима имени не даёт. */
	function columnName(field) {
		if (!field) {
			return null;
		}
		if (text(field.alias)) {
			return field.alias;
		}
		const expr = text(field.expr).trim();
		return PATH_RE.test(expr) && !LITERALS.has(upper(expr)) ? expr.slice(expr.lastIndexOf('.') + 1) : null;
	}

	function columnNames(part) {
		return list(part && part.fields).map(columnName);
	}

	/**
	 * Источники части плоским списком: верхний уровень ИЗ и соединения любой вложенности. path —
	 * адрес в дереве: [индекс в ИЗ, индекс соединения, индекс вложенного соединения…].
	 */
	function sourcesOf(part) {
		const out = [];
		function walk(joins, depth, path) {
			list(joins).forEach((join, k) => {
				if (!join) {
					return;
				}
				const here = path.concat(k);
				out.push({ source: join.source || {}, alias: aliasOf(join.source), depth: depth, path: here, join: join });
				walk(join.joins, depth + 1, here);
			});
		}
		list(part && part.from).forEach((entry, i) => {
			if (!entry) {
				return;
			}
			out.push({ source: entry.source || {}, alias: aliasOf(entry.source), depth: 0, path: [i], join: null });
			walk(entry.joins, 1, [i]);
		});
		return out;
	}

	/**
	 * Имя, под которым на источник ссылаются поля: псевдоним, а без него — имя таблицы целиком
	 * (`Справочник.Валюты.Код`); у вложенного запроса и параметра без псевдонима имени нет.
	 */
	function aliasOf(source) {
		if (!source) {
			return '';
		}
		if (text(source.alias)) {
			return source.alias;
		}
		return source.kind === 'table' ? text(source.table) : '';
	}

	function aliasesOf(part) {
		return sourcesOf(part)
			.map((entry) => entry.alias)
			.filter(Boolean);
	}

	function findSource(part, alias) {
		const want = upper(alias);
		return sourcesOf(part).find((entry) => upper(entry.alias) === want) || null;
	}

	/** Подпись источника в списке «Таблицы»: таблица с параметрами ВТ одной строкой, вложенный запрос — словом. */
	function sourceLabel(source) {
		const value = source || {};
		if (value.kind === 'subquery') {
			return 'Вложенный запрос';
		}
		if (value.kind === 'param') {
			return '&' + text(value.name);
		}
		if (value.kind === 'group') {
			return '(' + text(value.text).replace(/\s+/g, ' ').slice(0, 60) + ')';
		}
		return text(value.table) + (Array.isArray(value.params) ? '(' + paramTexts(value).join(', ') + ')' : '');
	}

	/**
	 * Имена общей таблицы констант (без учёта регистра): по колонке на константу, своего описания у неё
	 * нет. Копия правила DcsFieldTypes.isConstantsTable (модуль без зависимостей), сверку держит node-тест.
	 */
	const CONSTANTS_TABLES = new Set(['КОНСТАНТЫ', 'CONSTANTS']);

	/**
	 * Общая таблица констант как источник (`Константы` / `Constants`): имя из одного слова, как у
	 * временной таблицы пакета, но это таблица конфигурации. Временная таблица с именем «Константы»
	 * считается таблицей констант всегда. Принимает источник модели или имя таблицы строкой.
	 */
	function isConstantsTable(source) {
		const name = typeof source === 'string' ? source : source && source.kind === 'table' ? text(source.table) : '';
		return CONSTANTS_TABLES.has(upper(name.trim()));
	}

	/**
	 * Временная таблица пакета как источник: имя из одного сегмента (у таблиц конфигурации их два и
	 * больше), кроме общей таблицы констант — её поля не по запросу пакета, а по константам.
	 */
	function isTempTable(source) {
		return Boolean(source) && source.kind === 'table' && IDENT_RE.test(text(source.table)) && !isConstantsTable(source);
	}

	// ---------------------------------------------------------------------------------------------
	// Параметры виртуальных таблиц
	// ---------------------------------------------------------------------------------------------

	/** Текст параметра ВТ по позиции так, как его печатает сборщик: блок СКД {…} — частью текста. */
	function paramText(param) {
		const value = param || {};
		const own = text(value.text);
		if (value.dcs && typeof value.dcs === 'object') {
			const block = '{' + text(value.dcs.text) + '}';
			const whole = value.dcs.kind === 'whole' || (value.dcs.kind !== 'tail' && !own);
			return whole ? block : own + ' ' + block;
		}
		return own;
	}

	function paramTexts(source) {
		return list(source && source.params).map(paramText);
	}

	/**
	 * Имя без учёта регистра, не занятое в списке: база, затем база1, база2… (имена ВТ, копий и
	 * параметров-значений по умолчанию).
	 */
	function freeName(base, taken) {
		const used = new Set(list(taken).map((name) => upper(name)));
		if (!used.has(upper(base))) {
			return base;
		}
		for (let n = 1; ; n++) {
			if (!used.has(upper(base + n))) {
				return base + n;
			}
		}
	}

	/** Имя параметра-значения по умолчанию, если описание назвало его не идентификатором. */
	const DEFAULT_VALUE_PARAM = 'Значение';

	/**
	 * Значения параметров новой таблицы по её описанию (cf-md-query-tables):
	 * - у периодичности ВТ — Авто, остальное пусто (`(, , Авто, , )`, как у таблиц, собранных
	 *   конструктором для СКД);
	 * - у обязательного параметра-значения (критерий отбора: kind 'value', required) — `&` и имя
	 *   параметра из описания (`&Значение`, у английского описания `&Value`): без значения критерий
	 *   не выбирает ничего, а `&`-параметр после ОК объявится в схеме тем же конвейером, что условия.
	 *   Имя, уже занятое в тексте (taken — имена параметров без `&`, без учёта регистра), получает
	 *   суффикс 1, 2, …: у второго критерия своё значение.
	 * Все пусты — null: таблица пишется без скобок.
	 *
	 * @param {object} table Таблица описания ({params[]}).
	 * @param {string[]} [taken] Занятые имена параметров (например, DcsQueryModel.parametersOf текста).
	 * @returns {string[]|null}
	 */
	function defaultParamTexts(table, taken) {
		const params = list(table && table.params);
		const used = list(taken).filter((name) => typeof name === 'string');
		const texts = params.map((param) => {
			if (param && param.kind === 'periodicity') {
				const auto = list(param.values).find((value) => /^(Авто|Auto)$/i.test(text(value)));
				return auto || '';
			}
			if (param && param.kind === 'value' && param.required === true) {
				const base = IDENT_RE.test(text(param.name)) ? param.name : DEFAULT_VALUE_PARAM;
				const name = freeName(base, used);
				used.push(name);
				return '&' + name;
			}
			return '';
		});
		return texts.some((value) => value.trim() !== '') ? texts : null;
	}

	/**
	 * Окно «Параметры виртуальной таблицы…» для источника: откроется ли
	 * оно, доступна ли кнопка и что сказать, если окна нет. У основной таблицы регистра параметров нет —
	 * они у его виртуальных таблиц (СрезПоследних, Остатки…), и сообщение называет их и ветку дерева
	 * «База данных», где их взять — только те, у которых параметры есть: у основной таблицы
	 * последовательности единственная виртуальная (Границы) без параметров, и сообщение короткое.
	 * Виртуальная таблица без параметров (Границы последовательности) остаётся доступной: её
	 * сообщение — «нет параметров», без отсылки к другим таблицам; без описания (вне выгрузки) — что
	 * параметры не известны, а не что их нет.
	 *
	 * @param {object|null} source Источник модели ({kind: 'table', table, virtualTable, params}).
	 * @param {string} alias Псевдоним источника (без него параметры не записать).
	 * @param {object} described Описание таблицы, как его отдаёт api.describeTable: {state: 'ready' |
	 *   'loading' | 'none', table?, description?}; у временной таблицы пакета — {state: 'none'}.
	 * @param {{metadata?: boolean}} [options] metadata: false — выгрузки конфигурации нет (EDT, внешний
	 *   отчёт, отдельный файл): в дереве «База данных» только временные таблицы, и сообщение на него не
	 *   ссылается. Без options — выгрузка есть.
	 * @returns {{state: string, available: boolean, params: object[], current: string[], table: object|null,
	 *   objectKind: string, note: string, spoken: string}} state: open — окно откроется (параметры в тексте или в
	 *   описании); loading — описание читается; virtual — виртуальная таблица без параметров; none — у таблицы
	 *   параметров нет; pick — выбрана не таблица. objectKind — вид объекта готового описания (accumulationRegister…;
	 *   без описания — пусто): по нему окно выбирает поля «Условия» (vtConditionFields). note — сообщение, когда окно
	 *   не откроется (у open — пусто); spoken — короткая причина недоступной кнопки для читалки (у доступной — пусто).
	 */
	function virtualParamsState(source, alias, described, options) {
		const out = { state: 'pick', available: false, params: [], current: [], table: null, objectKind: '', note: 'Выберите виртуальную таблицу в списке «Таблицы».', spoken: 'таблица не выбрана' };
		if (!source || source.kind !== 'table' || !text(alias)) {
			return out;
		}
		const name = text(alias);
		const info = described && typeof described === 'object' ? described : { state: 'none' };
		const metadata = !(options && options.metadata === false);
		out.current = paramTexts(source);
		const virtualByName = Boolean(source.virtualTable);
		if (info.state === 'loading') {
			// Пока описание читается, имена позиций не известны; кнопка доступна, если параметры по тексту есть наверняка.
			// Недоступной кнопке «через мгновение» не обещаем: основная таблица останется без параметров и с описанием
			out.state = 'loading';
			out.available = virtualByName || out.current.length > 0;
			out.note = out.available ? 'Описание таблицы загружается: откройте параметры через мгновение.' : 'Описание таблицы загружается.';
			out.spoken = out.available ? '' : 'описание таблицы загружается';
			return out;
		}
		out.table = info.state === 'ready' && info.table ? info.table : null;
		out.objectKind = out.table && info.description ? text(info.description.kind) : '';
		out.params = out.table ? list(out.table.params) : [];
		if (out.params.length > 0 || out.current.length > 0) {
			out.state = 'open';
			out.available = true;
			out.note = '';
			out.spoken = '';
			return out;
		}
		if (virtualByName || (out.table && out.table.kind === 'virtual')) {
			// Не «это не виртуальная таблица»: у Границ последовательности параметров нет, а таблица виртуальная.
			// Без описания «нет параметров» было бы неправдой: у СрезПоследних они есть, их просто не прочитали
			out.state = 'virtual';
			out.available = true;
			out.spoken = '';
			out.note = out.table
				? 'У таблицы «' + name + '» нет параметров.'
				: 'Параметры таблицы «' + name + '» не известны: описания объекта нет, впишите их в текст («Запрос…»).';
			return out;
		}
		out.state = 'none';
		out.spoken = 'у таблицы нет параметров: нажмите, чтобы узнать, где они';
		const virtuals =
			out.table && out.table.kind === 'main' && info.description ? list(info.description.tables).filter((table) => table && table.kind === 'virtual' && text(table.name)) : [];
		// Советовать добавить можно только таблицу с параметрами: у Границ последовательности их нет
		const siblings = virtuals.filter((table) => list(table.params).length > 0);
		if (siblings.length === 0) {
			if (virtuals.length > 0) {
				out.note = 'У таблицы «' + name + '» нет параметров.';
				out.spoken = 'у таблицы нет параметров';
			} else if (metadata) {
				out.note = 'У таблицы «' + name + '» нет параметров: они бывают у виртуальных таблиц (значок «ВТ» в дереве «База данных»).';
			} else {
				out.note = 'У таблицы «' + name + '» нет параметров: они бывают у виртуальных таблиц регистров (СрезПоследних, Остатки…). Укажите такую таблицу в тексте («Запрос…»).';
			}
			return out;
		}
		const tails = siblings.map((table) => text(table.name).split('.').slice(2).join('.'));
		const owner = text(out.table.name).split('.')[1] || name;
		out.note =
			'У основной таблицы «' +
			name +
			'» параметров нет: они есть у ' +
			(tails.length > 1 ? 'виртуальных таблиц ' + tails.join(', ') + '. Добавьте нужную' : 'виртуальной таблицы ' + tails[0] + '. Добавьте её') +
			' из ветки «' +
			owner +
			'» дерева «База данных» или замените таблицу.';
		return out;
	}

	// ---------- поля в «Условии» виртуальной таблицы ----------

	/** Сравнение имён «по имени», как упорядочивает их конфигуратор: русская сортировка, без учёта регистра. */
	const NAME_COLLATOR = new Intl.Collator('ru', { sensitivity: 'base' });

	function compareNames(a, b) {
		return NAME_COLLATOR.compare(text(a), text(b));
	}

	/**
	 * Таблицы остатков и оборотов регистров накопления и бухгалтерии (хвост имени на обоих языках): их «Условие»
	 * накладывается и на таблицу итогов, а в ней из полей есть только измерения и разделители (у регистра бухгалтерии —
	 * ещё счёт и субконто). Регистр бухгалтерии: ОборотыДтКт — тоже; ДвиженияССубконто — нет, там условие на любые поля.
	 */
	const TOTALS_TAILS = new Set(['ОСТАТКИ', 'ОБОРОТЫ', 'ОСТАТКИИОБОРОТЫ', 'BALANCE', 'TURNOVERS', 'BALANCEANDTURNOVERS']);
	const ACCOUNTING_TOTALS_TAILS = new Set(['ОБОРОТЫДТКТ', 'DRCRTURNOVERS']);

	/**
	 * Субконто строки регистра бухгалтерии: по английскому имени описания (Субконто1 — ExtDimension1, СубконтоДт1 —
	 * ExtDimensionDr1, КорСубконто1 — BalancedExtDimension1). Корреспондирующие субконто «Обороты» в «Условии» есть:
	 * так показывает конфигуратор (Хозрасчетный.Обороты).
	 */
	const SUBCONTO_EN_RE = /^(?:ExtDimension(?:Dr|Cr)?|BalancedExtDimension)\d+$/i;

	/**
	 * Счета (Счет, КорСчет, СчетДт, СчетКт) по английскому имени описания: в дереве «Условия» конфигуратор их не
	 * показывает, у них свои параметры УсловиеСчета, УсловиеКорСчета, УсловиеСчетаДт, УсловиеСчетаКт. Правило их не
	 * судит: такие поля — ни в дереве окна, ни в предупреждении.
	 */
	const ACCOUNT_EN_RE = /^(?:Account(?:Dr|Cr)?|BalancedAccount)$/i;

	/**
	 * Виды полей описания, которых в «Условии» остатков и оборотов нет: ресурсы, периоды (и УточнениеПериода), стандартные
	 * поля, реквизиты и общие реквизиты — не разделители (в таблицах итогов их нет).
	 */
	const NOT_IN_TOTALS = new Set(['resource', 'period', 'standard', 'attribute', 'commonAttribute']);

	/** Виды полей общих реквизитов cf-md-query-tables: разделитель (Разделение данных — Разделять) и прочий общий реквизит. */
	const COMMON_FIELD_KINDS = new Set(['separator', 'commonAttribute']);

	/**
	 * Вид узла каталога подсказки и деревьев полей конструктора по полю описания: у общего реквизита — свой вид (свой знак
	 * и слово, как значок разделителя в дереве конфигуратора), у остальных полей — 'field'.
	 *
	 * @param {object|null} field Поле описания {kind?}.
	 * @returns {'field'|'separator'|'commonAttribute'}
	 */
	function fieldNodeKind(field) {
		const kind = text(field && field.kind);
		return COMMON_FIELD_KINDS.has(kind) ? kind : 'field';
	}

	/** Хвост имени виртуальной таблицы (`РегистрНакопления.X.Обороты` → `ОБОРОТЫ`); имя из одного слова — оно само. */
	function vtTail(tableName) {
		const name = text(tableName);
		return upper(name.slice(name.lastIndexOf('.') + 1));
	}

	/**
	 * Правило полей «Условия» по виду объекта описания (description.kind ответа cf-md-query-tables) и имени виртуальной
	 * таблицы: 'dimensions' — измерения и разделители (остатки и обороты регистра накопления), 'dimensionsSubconto' —
	 * измерения (с их полями Кор, Дт и Кт), субконто и разделители (остатки и обороты регистра бухгалтерии, ОборотыДтКт),
	 * 'all' — любые поля таблицы (срезы регистра сведений, ДвиженияССубконто, ФактическийПериодДействия,
	 * ЗадачиПоИсполнителю и всё, чего правило не знает).
	 */
	function vtConditionRule(objectKind, tableName) {
		const tail = vtTail(tableName);
		if (objectKind === 'accumulationRegister' && TOTALS_TAILS.has(tail)) {
			return 'dimensions';
		}
		if (objectKind === 'accountingRegister' && (TOTALS_TAILS.has(tail) || ACCOUNTING_TOTALS_TAILS.has(tail))) {
			return 'dimensionsSubconto';
		}
		return 'all';
	}

	/**
	 * Можно ли поле виртуальной таблицы писать в её параметре «Условие» — правило по виду таблицы (vtConditionRule) и виду
	 * поля описания (kind: dimension, resource, standard, period…):
	 * - остатки и обороты регистра накопления: измерения и разделители (kind separator) — да (и поля через точку от них);
	 *   ресурсы, Период…, Регистратор, НомерСтроки — нет. Так показывает конфигуратор, так выходит из устройства таблиц
	 *   (условие ставится и на таблицу итогов, где их нет);
	 * - остатки и обороты регистра бухгалтерии: измерения (и ВалютаКор, ВалютаДт, ВалютаКт небалансовых), Субконто…,
	 *   КорСубконто…, СубконтоДт…, СубконтоКт… и разделители — да; ресурсы, периоды, УточнениеПериода, Регистратор,
	 *   НомерСтроки — нет. Так показывает конфигуратор у Хозрасчетный.Обороты; счета (Счет, КорСчет,
	 *   СчетДт, СчетКт) он не показывает — у них свои условия, правило их не судит ('unsure');
	 * - остальные таблицы: любое поле — да.
	 * Обычный общий реквизит (kind commonAttribute) у таблиц остатков и оборотов — нет (в таблицах итогов его нет, и
	 * md-sparrow его там не отдаёт), поле неизвестного вида — 'unsure'.
	 *
	 * @param {string} objectKind Вид объекта описания (accumulationRegister, accountingRegister, informationRegister…).
	 * @param {string} tableName Имя виртуальной таблицы из описания (`РегистрНакопления.X.Обороты`) или её хвост.
	 * @param {object} field Поле описания {name, nameEn, kind}.
	 * @returns {'allowed'|'denied'|'unsure'}
	 */
	function vtConditionAccess(objectKind, tableName, field) {
		const rule = vtConditionRule(objectKind, tableName);
		if (rule === 'all') {
			return 'allowed';
		}
		const kind = text(field && field.kind);
		if (kind === 'dimension' || kind === 'separator') {
			return 'allowed';
		}
		if (rule === 'dimensionsSubconto' && kind === 'standard') {
			const en = text(field.nameEn);
			if (SUBCONTO_EN_RE.test(en)) {
				return 'allowed';
			}
			if (ACCOUNT_EN_RE.test(en)) {
				return 'unsure';
			}
		}
		return NOT_IN_TOTALS.has(kind) ? 'denied' : 'unsure';
	}

	/**
	 * Поля виртуальной таблицы для её «Условия»: allowed — в дерево окна условия («Произвольное выражение»), в подсказку
	 * условия и в «Поля-отборы» окна для СКД, по имени (так их упорядочивает конфигуратор); denied — поля, которых в
	 * условии этой таблицы быть не может (о них предупреждение); поля 'unsure' — ни там, ни там.
	 *
	 * @param {string} objectKind Вид объекта описания.
	 * @param {object|null} table Таблица описания {name, fields[]}.
	 * @returns {{rule: string, allowed: object[], denied: object[]}}
	 */
	function vtConditionFields(objectKind, table) {
		const out = { rule: vtConditionRule(objectKind, table && table.name), allowed: [], denied: [] };
		for (const field of list(table && table.fields)) {
			if (!field || !text(field.name)) {
				continue;
			}
			const access = vtConditionAccess(objectKind, table.name, field);
			if (access === 'allowed') {
				out.allowed.push(field);
			} else if (access === 'denied') {
				out.denied.push(field);
			}
		}
		out.allowed.sort((a, b) => compareNames(a.name, b.name));
		return out;
	}

	/**
	 * Параметры-значения виртуальной таблицы: момент или граница периода, значение критерия отбора, исполнитель задачи,
	 * число проводок ДвиженияССубконто и виды субконто регистра бухгалтерии (Субконто, КорСубконто, СубконтоДт,
	 * СубконтоКт: вид субконто или их список). Это не выражения над полями таблицы, а значения: у них поле со списком
	 * параметров запроса, как у НачалоПериода в конфигураторе; ЗНАЧЕНИЕ(…) вида субконто пишется текстом.
	 */
	const VALUE_PARAM_KINDS = new Set(['periodStart', 'periodEnd', 'period', 'value', 'performer', 'top', 'extDimensions', 'corExtDimensions', 'extDimensionsDr', 'extDimensionsCr']);

	/** Условие на счёт (УсловиеСчета, УсловиеКорСчета, УсловиеСчетаДт, УсловиеСчетаКт) → английское имя своего поля счёта. */
	const ACCOUNT_PARAM_FIELDS = {
		account: 'Account',
		corAccount: 'BalancedAccount',
		accountDr: 'AccountDr',
		accountCr: 'AccountCr',
	};

	/**
	 * Поля окна выражения и подсказки позиций 'account' и 'expression' (vtParamInput). Условие на счёт ставится на своё
	 * поле счёта (Счет, КорСчет, СчетДт или СчетКт — по виду параметра и английскому имени поля описания): в дереве
	 * «Поле» и в подсказке только оно, как у конфигуратора (Хозрасчетный.Обороты). У прочих позиций (Порядок, позиция
	 * без описания) и у условия на счёт, чьего поля у таблицы нет, — все поля таблицы.
	 *
	 * @param {object|null} param Параметр описания {name, kind}.
	 * @param {object|null} table Таблица описания {name, fields[]}.
	 * @returns {object[]} Поля описания.
	 */
	function vtExpressionFields(param, table) {
		const fields = list(table && table.fields).filter((field) => field && text(field.name));
		const name = Object.prototype.hasOwnProperty.call(ACCOUNT_PARAM_FIELDS, text(param && param.kind)) ? ACCOUNT_PARAM_FIELDS[text(param.kind)] : null;
		if (!name) {
			return fields;
		}
		const own = fields.filter((field) => upper(field.nameEn) === upper(name));
		return own.length > 0 ? own : fields;
	}

	/**
	 * Чем правится позиция параметра виртуальной таблицы в окне параметров: 'list' —
	 * список значений описания (Периодичность в порядке md-sparrow, МетодДополнения); 'condition' — условие (окно
	 * выражения над полями, допустимыми в условии таблицы); 'account' — условие на счёт (УсловиеСчета, УсловиеКорСчета,
	 * УсловиеСчетаДт, УсловиеСчетаКт): окно выражения и подсказка своего поля счёта (vtExpressionFields), как у
	 * конфигуратора; 'value' — значение (VALUE_PARAM_KINDS, в том числе виды субконто): поле со списком `&`-параметров,
	 * которые уже есть в запросе; 'expression' — текст с подсказкой всех полей таблицы, параметров и функций (Порядок и
	 * позиция без описания).
	 *
	 * @param {object|null} param Параметр описания {name, kind, values?}.
	 * @returns {'list'|'condition'|'account'|'value'|'expression'}
	 */
	function vtParamInput(param) {
		if (param && Array.isArray(param.values) && param.values.length > 0) {
			return 'list';
		}
		const kind = text(param && param.kind);
		if (kind === 'condition') {
			return 'condition';
		}
		if (Object.prototype.hasOwnProperty.call(ACCOUNT_PARAM_FIELDS, kind)) {
			return 'account';
		}
		return VALUE_PARAM_KINDS.has(kind) ? 'value' : 'expression';
	}

	// ---------------------------------------------------------------------------------------------
	// Конструктор API над моделью запроса
	// ---------------------------------------------------------------------------------------------

	function create(Q) {
		if (!Q || typeof Q.parse !== 'function') {
			throw new Error('DcsQueryEdit: нужна модель запроса (DcsQueryModel).');
		}

		function fail(message) {
			return { error: message };
		}

		function statementAt(model, address) {
			const statements = list(model && model.statements);
			const statement = statements[address && address.statement];
			return statement && statement.type !== 'drop' ? statement : null;
		}

		function partAt(model, address) {
			const statement = statementAt(model, address);
			return statement ? list(statement.parts)[address.part] || null : null;
		}

		/** Копия модели и адресованная часть копии; адрес мимо — null (операция ничего не меняет). */
		function editable(model, address) {
			if (!partAt(model, address)) {
				return null;
			}
			const copy = clone(model);
			const statement = copy.statements[address.statement];
			return { model: copy, statement: statement, part: statement.parts[address.part] };
		}

		/**
		 * Новый запрос для пустого текста набора: один запрос выборки с пустой частью. Служебные поля
		 * (язык, концы строк, хвост пробелов) — от разбора самого текста.
		 */
		function newModel(sourceText, lang) {
			const model = Q.parse(text(sourceText)).model;
			model.statements = [emptyStatement()];
			if (lang === 'en' || lang === 'ru') {
				model.lang = lang;
			}
			return model;
		}

		/** Отдельная модель над вложенным запросом: второй уровень конструктора правит её, как обычную. */
		function subModel(outer, statement) {
			return {
				format: outer && outer.format,
				lang: outer && outer.lang === 'en' ? 'en' : 'ru',
				eol: outer && outer.eol === '\r\n' ? '\r\n' : '\n',
				statements: [clone(statement || emptyStatement())],
				comments: { total: 0, dropped: 0 },
				original: { count: 0, tail: '' },
			};
		}

		/**
		 * Узел источника таблицы разбором короткого текста: признак виртуальной таблицы и параметры
		 * {…} получаются те же, что после сборки и нового разбора. Ошибка — текст отказа.
		 */
		function tableSource(table, texts, alias) {
			const name = text(table).trim();
			if (!PATH_RE.test(name)) {
				return fail('«' + name + '» это не имя таблицы.');
			}
			const head = 'ВЫБРАТЬ 1 ИЗ ' + name;
			const args = Array.isArray(texts) ? '(' + texts.map((value) => text(value).trim()).join(', ') + ')' : '';
			const parsed = Q.parse(head + args + ' КАК ' + alias);
			const statement = parsed.model.statements[0];
			const entry = statement && statement.parts[0] && statement.parts[0].from[0];
			if (parsed.diagnostics.length > 0 || !entry || statement.parts[0].from.length !== 1 || entry.joins.length > 0) {
				// Позиция служебного текста пользователю ничего не скажет: только смысл ошибки
				const first = parsed.diagnostics[0];
				return fail('Параметры таблицы не разобраны' + (first ? ': ' + first.message : '') + '.');
			}
			if (Array.isArray(texts) && list(entry.source.params).length !== texts.length) {
				return fail('Параметры таблицы не разобраны: запятая внутри значения разбила позиции. Возьмите выражение в скобки.');
			}
			return { source: entry.source };
		}

		function ensureAlias(alias, taken, own) {
			const value = text(alias).trim();
			if (!IDENT_RE.test(value)) {
				return 'Псевдоним: одно слово из букв, цифр и «_», с буквы.';
			}
			if (RESERVED.has(upper(value))) {
				return '«' + value + '» это ключевое слово языка запросов, псевдонимом быть не может.';
			}
			if (list(taken).some((name) => upper(name) === upper(value) && upper(name) !== upper(own))) {
				return 'Псевдоним «' + value + '» уже есть в этой части запроса.';
			}
			return '';
		}

		/**
		 * Добавляет источник в ИЗ части отдельной строкой (без соединения: связь задают «Связи»).
		 * spec: {table, params?: string[]|null, alias?} — таблица конфигурации, временная таблица пакета
		 * или виртуальная таблица (params — тексты параметров по позициям); {subquery, alias?} —
		 * вложенный запрос (модель запроса пакета). Псевдоним по умолчанию — по правилу конструктора
		 * (Q.defaultTableAlias), уникальный в части.
		 *
		 * @returns {{model: object, alias: string}|{error: string}}
		 */
		function addSource(model, address, spec) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const value = spec || {};
			const taken = aliasesOf(target.part);
			let source;
			if (value.subquery) {
				const alias = text(value.alias) || Q.defaultTableAlias({ kind: 'subquery' }, taken);
				const problem = ensureAlias(alias, taken, '');
				if (problem) {
					return fail(problem);
				}
				source = { kind: 'subquery', query: clone(value.subquery), alias: alias };
			} else {
				const alias = text(value.alias) || Q.defaultTableAlias(text(value.table), taken);
				const problem = ensureAlias(alias, taken, '');
				if (problem) {
					return fail(problem);
				}
				const built = tableSource(value.table, value.params, alias);
				if (built.error) {
					return built;
				}
				source = built.source;
			}
			target.part.from.push({ source: source, joins: [] });
			return { model: target.model, alias: source.alias };
		}

		/** Ссылается ли выражение на алиас как на голову пути `Алиас.…` (не в строках и комментариях). */
		function refersTo(value, alias) {
			return typeof value === 'string' && value !== '' && Q.renameAliasInText(value, alias, MARK) !== value;
		}

		/**
		 * Убирает из части всё, что ссылается на алиас: поля (в объединении — значение части, колонка
		 * остаётся), условия ГДЕ, ИМЕЮЩИЕ, {ГДЕ}, соединений, группировку и порядок запроса. Возвращает
		 * подписи снятого для предупреждения: молча потерять условие было бы хуже, чем удалить таблицу.
		 */
		function dropReferences(statement, partIndex, alias) {
			const part = statement.parts[partIndex];
			const lost = [];
			const keep = (items, label) =>
				list(items).filter((item) => {
					const value = typeof item === 'string' ? item : item && (item.text || item.path || item.expr);
					if (refersTo(value, alias)) {
						lost.push(label + ': ' + text(value).replace(/\s+/g, ' '));
						return false;
					}
					return true;
				});
			// С конца: удаление колонки сдвигает следующие; подписи — в порядке выборки
			for (let k = part.fields.length - 1; k >= 0; k--) {
				if (refersTo(part.fields[k].expr, alias)) {
					lost.unshift('поле: ' + text(part.fields[k].expr).replace(/\s+/g, ' '));
					removeColumnValue(statement, partIndex, k);
				}
			}
			if (part.where) {
				part.where.conditions = keep(part.where.conditions, 'условие');
				if (part.where.conditions.length === 0) {
					part.where = null;
				}
			}
			if (part.having) {
				part.having.conditions = keep(part.having.conditions, 'условие ИМЕЮЩИЕ');
				if (part.having.conditions.length === 0) {
					part.having = null;
				}
			}
			if (part.dcsWhere) {
				const count = list(part.dcsWhere.items).length;
				part.dcsWhere.items = keep(part.dcsWhere.items, 'условие {ГДЕ}');
				if (part.dcsWhere.items.length === 0) {
					part.dcsWhere = null;
				} else if (part.dcsWhere.items.length !== count) {
					// Отметки разрыва относятся к исходным элементам: правленый блок выводится одним
					mergedBlock(part.dcsWhere);
				}
			}
			if (part.groupBy && !Array.isArray(part.groupBy.groupingSets)) {
				part.groupBy.items = keep(part.groupBy.items, 'группировка');
				if (part.groupBy.items.length === 0) {
					part.groupBy = null;
				}
			}
			if (statement.parts.length === 1 && Array.isArray(statement.orderBy)) {
				statement.orderBy = keep(statement.orderBy, 'порядок');
				if (statement.orderBy.length === 0) {
					statement.orderBy = null;
				}
			}
			const walkJoins = (joins) => {
				for (const join of list(joins)) {
					if (join.on) {
						const before = join.on.conditions.length;
						join.on.conditions = keep(join.on.conditions, 'связь');
						// Соединение без ПО — не текст запроса: оставшееся без условий соединение связывает всё
						if (before > 0 && join.on.conditions.length === 0) {
							join.on.conditions = ['ИСТИНА'];
						}
					}
					walkJoins(join.joins);
				}
			};
			for (const entry of part.from) {
				walkJoins(entry.joins);
			}
			// Модель — такой, какой её даст разбор собранного текста: блок, чьё предложение исчезло
			// (ГДЕ без условий), встаёт за предыдущим, номера групп необязательных соединений идут подряд
			settleBlocks(part, false);
			normalizeGroups(part);
			return lost;
		}

		/**
		 * Удаляет источник части по алиасу. Соединения, которые на нём висели, поднимаются на его место
		 * (у верхнего уровня — отдельными строками ИЗ без условия, у соединения — в список соединений
		 * родителя), ссылки на алиас уходят из части (dropReferences).
		 *
		 * @returns {{model: object, warnings: string[]}|{error: string}}
		 */
		function removeSource(model, address, alias) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const found = findSource(target.part, alias);
			if (!found) {
				return fail('Таблицы «' + alias + '» в части нет.');
			}
			const path = found.path;
			const from = target.part.from;
			if (path.length === 1) {
				const entry = from[path[0]];
				const promoted = list(entry.joins).map((join) => ({ source: join.source, joins: list(join.joins) }));
				from.splice(path[0], 1, ...promoted);
			} else {
				let joins = from[path[0]].joins;
				for (let k = 1; k < path.length - 1; k++) {
					joins = joins[path[k]].joins;
				}
				const join = joins[path[path.length - 1]];
				joins.splice(path[path.length - 1], 1, ...list(join.joins));
			}
			const before = columnNames(target.statement.parts[0]);
			const lost = dropReferences(target.statement, address.part, found.alias);
			const warnings = lost.length > 0 ? ['Вместе с таблицей «' + found.alias + '» удалено (' + lost.join('; ') + ').'] : [];
			warnings.push(...dropColumnReferences(target.model, address.statement, before));
			return { model: target.model, warnings: warnings };
		}

		/** Все источники части и всё, что на них ссылается. */
		function removeAllSources(model, address) {
			let current = model;
			const warnings = [];
			const part = partAt(model, address);
			if (!part) {
				return fail('Часть запроса не найдена.');
			}
			for (const entry of sourcesOf(part).reverse()) {
				if (!entry.alias) {
					continue;
				}
				const result = removeSource(current, address, entry.alias);
				if (result.error) {
					continue;
				}
				current = result.model;
				warnings.push(...result.warnings);
			}
			// Источники без имени (вложенный запрос без псевдонима) ссылок не имеют — ИЗ просто пустеет
			const target = editable(current, address);
			target.part.from = [];
			return { model: target.model, warnings: warnings };
		}

		/** Переименование алиаса с заменой ссылок во всех предложениях части и в УПОРЯДОЧИТЬ ПО запроса. */
		function renameSource(model, address, from, to) {
			const part = partAt(model, address);
			if (!part) {
				return fail('Часть запроса не найдена.');
			}
			const found = findSource(part, from);
			if (!found || !text(found.source.alias)) {
				return fail('У таблицы нет псевдонима «' + from + '».');
			}
			const value = text(to).trim();
			if (value === found.source.alias) {
				return { model: model };
			}
			const problem = ensureAlias(value, aliasesOf(part), found.source.alias);
			if (problem) {
				return fail(problem);
			}
			const copy = clone(model);
			copy.statements[address.statement] = Q.renameAliasInStatement(copy.statements[address.statement], address.part, found.source.alias, value);
			return { model: copy };
		}

		function sourceAt(part, path) {
			if (path.length === 1) {
				return { holder: part.from[path[0]], key: 'source' };
			}
			let join = part.from[path[0]].joins[path[1]];
			for (let k = 2; k < path.length; k++) {
				join = join.joins[path[k]];
			}
			return { holder: join, key: 'source' };
		}

		/**
		 * Тексты параметров виртуальной таблицы по позициям (как в окне «Параметры виртуальной
		 * таблицы»): каждый разбирается тем же разборщиком, блоки СКД {…} сохраняются. Все пусты —
		 * таблица без скобок; тексты не изменились — модель та же.
		 */
		function setVirtualParams(model, address, alias, texts) {
			const part = partAt(model, address);
			const found = part ? findSource(part, alias) : null;
			if (!found || found.source.kind !== 'table') {
				return fail('Таблицы «' + alias + '» в части нет.');
			}
			const next = list(texts).map((value) => text(value).trim());
			const current = paramTexts(found.source);
			// Окно показывает все позиции из описания таблицы: пустые хвостовые позиции сверх записанных —
			// не правка, иначе ОК без изменений дописывал бы «, » и пересобирал запрос каноном
			while (next.length > current.length && next[next.length - 1] === '') {
				next.pop();
			}
			if (Array.isArray(found.source.params) && current.length === next.length && current.every((value, k) => value.trim() === next[k])) {
				return { model: model };
			}
			const empty = next.every((value) => value === '');
			if (empty && found.source.params === null) {
				return { model: model };
			}
			const built = tableSource(found.source.table, empty ? null : next, found.source.alias || 'Т');
			if (built.error) {
				return built;
			}
			const target = editable(model, address);
			const place = sourceAt(target.part, found.path);
			const source = place.holder[place.key];
			source.params = built.source.params;
			source.virtualTable = built.source.virtualTable;
			return { model: target.model };
		}

		/** Вложенный запрос источника — модель второго уровня конструктора после его ОК. */
		function setSubquery(model, address, alias, statement) {
			const part = partAt(model, address);
			const found = part ? findSource(part, alias) : null;
			if (!found || found.source.kind !== 'subquery') {
				return fail('Вложенного запроса «' + alias + '» в части нет.');
			}
			const target = editable(model, address);
			const place = sourceAt(target.part, found.path);
			place.holder[place.key].query = clone(statement);
			return { model: target.model };
		}

		/**
		 * «Заменить таблицу»: источник получает другую таблицу; псевдоним, похожий на
		 * автоматический (по имени заменяемой таблицы), меняется на автоматический для новой — вместе со
		 * ссылками, свой псевдоним пользователя остаётся. Если известен состав полей новой таблицы
		 * (options.fields — имена), поля части `Алиас.Поле…`, которого в ней нет, удаляются с
		 * предупреждением. spec: {table, params?, defaultParams?}; без params параметры ВТ сохраняются,
		 * если это та же ВТ, иначе берутся defaultParams (умолчания новой ВТ) или таблица без скобок.
		 */
		function replaceSource(model, address, alias, spec, options) {
			const part = partAt(model, address);
			const found = part ? findSource(part, alias) : null;
			if (!found || found.source.kind !== 'table' || !text(found.source.alias)) {
				return fail('Заменить можно таблицу с псевдонимом; «' + alias + '» в части не найдена.');
			}
			const value = spec || {};
			const others = aliasesOf(part).filter((name) => upper(name) !== upper(found.source.alias));
			const oldAlias = found.source.alias;
			const auto = upper(Q.defaultTableAlias(found.source.table, others)) === upper(oldAlias);
			const newAlias = auto ? Q.defaultTableAlias(text(value.table), others) : oldAlias;
			let texts = value.params;
			const probe = tableSource(value.table, null, oldAlias);
			if (probe.error) {
				return probe;
			}
			if (texts === undefined) {
				const sameVirtual =
					probe.source.virtualTable && upper(probe.source.virtualTable) === upper(found.source.virtualTable) && Array.isArray(found.source.params);
				texts = sameVirtual ? paramTexts(found.source) : Array.isArray(value.defaultParams) ? value.defaultParams : null;
			}
			const built = tableSource(value.table, Array.isArray(texts) ? texts : null, oldAlias);
			if (built.error) {
				return built;
			}
			const target = editable(model, address);
			const place = sourceAt(target.part, found.path);
			place.holder[place.key] = built.source;
			let copy = target.model;
			if (upper(newAlias) !== upper(oldAlias)) {
				copy.statements[address.statement] = Q.renameAliasInStatement(copy.statements[address.statement], address.part, oldAlias, newAlias);
			}
			const warnings = [];
			const names = options && Array.isArray(options.fields) ? new Set(options.fields.map(upper)) : null;
			if (names) {
				const statement = copy.statements[address.statement];
				const fields = statement.parts[address.part].fields;
				const before = columnNames(statement.parts[0]);
				const lost = [];
				for (let k = fields.length - 1; k >= 0; k--) {
					const expr = text(fields[k].expr).trim();
					if (!PATH_RE.test(expr)) {
						continue;
					}
					const segments = expr.split('.');
					if (segments.length > 1 && upper(segments[0]) === upper(newAlias) && !names.has(upper(segments[1]))) {
						lost.unshift(expr);
						removeColumnValue(statement, address.part, k);
					}
				}
				if (lost.length > 0) {
					warnings.push('В новой таблице нет полей, удалены из выборки: ' + lost.join(', ') + '.');
				}
				warnings.push(...dropColumnReferences(copy, address.statement, before));
			}
			return { model: copy, alias: newAlias, warnings: warnings };
		}

		// ---------- поля ----------

		/**
		 * Добавляет поле в выборку части. Псевдоним — явный, по правилу конструктора (defaultFieldAlias,
		 * уникален среди колонок запроса). В объединении поле — новая колонка: остальные части получают
		 * NULL, псевдоним пишется в первой части (по ней называются колонки результата). Исключение —
		 * поле второй и следующих частей, чьё имя совпало с колонкой, где у этой части пусто (NULL): оно
		 * занимает эту ячейку.
		 *
		 * @returns {{model: object, index: number, alias: string}|{error: string}}
		 */
		function addField(model, address, expr, options) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const value = text(expr).trim();
			if (!value) {
				return fail('Пустое выражение поля.');
			}
			const parts = target.statement.parts;
			const names = columnNames(parts[0]);
			// Вторая и следующие части объединения: поле встаёт в пустую (NULL) ячейку колонки со своим
			// именем, а не новой колонкой — иначе обычное «А.Ссылка … ОБЪЕДИНИТЬ ВСЕ Б.Ссылка» собиралось бы
			// только перестановкой каждой ячейки. Сопоставление по имени — правило редактора
			const own = address.part > 0 && !(options && text(options.alias)) ? columnName({ expr: value, alias: null }) : null;
			if (own && aligned(target.statement)) {
				const cells = parts[address.part].fields;
				const column = names.findIndex((name, k) => name && upper(name) === upper(own) && upper(text(cells[k] && cells[k].expr).trim()) === 'NULL');
				if (column >= 0) {
					cells[column] = { expr: value, alias: null };
					return { model: target.model, index: column, alias: names[column] };
				}
			}
			const taken = names.filter(Boolean);
			const alias = options && text(options.alias) ? options.alias : Q.defaultFieldAlias(value, taken);
			const index = parts[address.part].fields.length;
			parts.forEach((part, k) => {
				part.fields.push({ expr: k === address.part ? value : 'NULL', alias: k === 0 ? alias : null });
			});
			return { model: target.model, index: index, alias: alias };
		}

		/** Несколько полей подряд (`>>` — все поля таблицы); уже выбранные выражения не повторяются. */
		function addFields(model, address, exprs) {
			let current = model;
			const added = [];
			const part = partAt(model, address);
			if (!part) {
				return fail('Часть запроса не найдена.');
			}
			const present = new Set(part.fields.map((field) => upper(text(field.expr).trim())));
			for (const expr of list(exprs)) {
				const key = upper(text(expr).trim());
				if (!key || present.has(key)) {
					continue;
				}
				const result = addField(current, address, expr);
				if (result.error) {
					return result;
				}
				present.add(key);
				added.push(result.alias);
				current = result.model;
			}
			return { model: current, added: added };
		}

		/**
		 * Значение колонки k части partIndex уходит из запроса: у запроса без объединения — поле целиком,
		 * в объединении — значение части становится NULL, а колонка удаляется, когда NULL во всех частях
		 * (пустая колонка — не колонка). Псевдоним первой части у NULL остаётся: это имя колонки.
		 */
		function removeColumnValue(statement, partIndex, k) {
			const parts = statement.parts;
			if (parts.length === 1) {
				parts[0].fields.splice(k, 1);
				return;
			}
			const field = parts[partIndex].fields[k];
			if (!field) {
				return;
			}
			field.expr = 'NULL';
			if (partIndex > 0) {
				field.alias = null;
			}
			const empty = parts.every((part) => !part.fields[k] || upper(text(part.fields[k].expr).trim()) === 'NULL');
			if (empty) {
				for (const part of parts) {
					part.fields.splice(k, 1);
				}
			}
		}

		/** Голова пути (колонка или алиас) в верхнем регистре и есть ли за ней точка; не путь — null. */
		function pathHead(value) {
			const trimmed = text(value).trim();
			if (!PATH_RE.test(trimmed)) {
				return null;
			}
			const dot = trimmed.indexOf('.');
			return { head: upper(dot < 0 ? trimmed : trimmed.slice(0, dot)), dotted: dot >= 0 };
		}

		/**
		 * Убирает ссылки по имени на колонки, которых после правки не стало: элементы УПОРЯДОЧИТЬ ПО (имя
		 * колонки или путь от неё), {ВЫБРАТЬ} первой части и поля индексов (индекс без полей уходит целиком).
		 * Самопроверка и строгая проверка схемы такую ссылку не ловят — токены целы, — а запрос с ней
		 * платформа не примет. В порядке запроса из одной части голова пути, совпавшая с алиасом таблицы, —
		 * таблица, её не трогаем (её снимает удаление таблицы). Колонку ВТ, которую читают дальше по пакету,
		 * чинить в чужих запросах не берёмся — только предупреждение.
		 *
		 * @param {object} model копия модели, уже изменённая операцией
		 * @param {string[]} before имена колонок запроса (первой части) до операции
		 * @returns {string[]} предупреждения
		 */
		function dropColumnReferences(model, index, before) {
			const statement = model.statements[index];
			const first = statement && list(statement.parts)[0];
			if (!first) {
				return [];
			}
			const now = new Set(columnNames(first).filter(Boolean).map(upper));
			const goneNames = [];
			for (const name of list(before)) {
				if (name && !now.has(upper(name)) && !goneNames.some((item) => upper(item) === upper(name))) {
					goneNames.push(name);
				}
			}
			if (goneNames.length === 0) {
				return [];
			}
			const gone = new Set(goneNames.map(upper));
			const tableAliases = new Set(aliasesOf(first).map(upper));
			const single = statement.parts.length === 1;
			const lost = [];
			if (Array.isArray(statement.orderBy)) {
				statement.orderBy = statement.orderBy.filter((item) => {
					const head = pathHead(item && item.expr);
					if (!head || !gone.has(head.head) || (single && head.dotted && tableAliases.has(head.head))) {
						return true;
					}
					lost.push('порядок: ' + text(item.expr).trim());
					return false;
				});
				if (statement.orderBy.length === 0) {
					statement.orderBy = null;
				}
			}
			if (first.dcsSelect) {
				const items = list(first.dcsSelect.items);
				const kept = items.filter((item) => {
					const head = item && typeof item.path === 'string' ? pathHead(item.path) : null;
					if (!head || !gone.has(head.head)) {
						return true;
					}
					lost.push('{ВЫБРАТЬ}: ' + item.path + (item.star ? '.*' : ''));
					return false;
				});
				if (kept.length !== items.length) {
					first.dcsSelect.items = kept;
					first.dcsSelect = kept.length > 0 ? mergedBlock(first.dcsSelect) : null;
				}
			}
			if (list(statement.indexes).length > 0) {
				statement.indexes = statement.indexes
					.map((item) => {
						const fields = list(item && item.fields).filter((field) => {
							const head = pathHead(field);
							if (!head || !gone.has(head.head)) {
								return true;
							}
							lost.push('индекс: ' + text(field).trim());
							return false;
						});
						return Object.assign({}, item, { fields: fields });
					})
					.filter((item) => item.fields.length > 0);
			}
			const warnings = lost.length > 0 ? ['Вместе с колонкой ' + goneNames.map((name) => '«' + name + '»').join(', ') + ' удалены ссылки на неё (' + lost.join('; ') + ').'] : [];
			if (statementKind(statement) === 'create') {
				const readers = tempReaders(model, index, tempTableOf(statement));
				if (readers.length > 0) {
					warnings.push(
						'Из ВТ «' + tempTableOf(statement) + '» убрана колонка ' + goneNames.map((name) => '«' + name + '»').join(', ') + ': запросы пакета ' + numbersOf(readers) + ' могут к ней обращаться, проверьте их.'
					);
				}
			}
			return warnings;
		}

		/**
		 * Ссылки по имени на переименованную колонку — УПОРЯДОЧИТЬ ПО, {ВЫБРАТЬ}, ИНДЕКСИРОВАТЬ ПО — идут
		 * за ней; в порядке запроса из одной части голова пути, совпавшая с алиасом таблицы, — таблица.
		 */
		function renameColumnReferences(statement, old, value) {
			const first = statement.parts[0];
			const tableAliases = new Set(aliasesOf(first).map(upper));
			const single = statement.parts.length === 1;
			if (Array.isArray(statement.orderBy)) {
				statement.orderBy = statement.orderBy.map((item) => {
					const expr = text(item && item.expr).trim();
					const dotted = expr.indexOf('.') > 0;
					if (single && dotted && tableAliases.has(upper(expr.slice(0, expr.indexOf('.'))))) {
						return item;
					}
					return Object.assign({}, item, { expr: renameHead(item.expr, old, value) });
				});
			}
			if (first.dcsSelect) {
				first.dcsSelect.items = list(first.dcsSelect.items).map((item) =>
					item && typeof item.path === 'string' ? Object.assign({}, item, { path: renameHead(item.path, old, value) }) : item
				);
			}
			statement.indexes = list(statement.indexes).map((item) => Object.assign({}, item, { fields: list(item && item.fields).map((f) => renameHead(f, old, value)) }));
		}

		function removeField(model, address, index) {
			const target = editable(model, address);
			if (!target || !target.part.fields[index]) {
				return fail('Поля нет.');
			}
			const before = columnNames(target.statement.parts[0]);
			removeColumnValue(target.statement, address.part, index);
			return { model: target.model, warnings: dropColumnReferences(target.model, address.statement, before) };
		}

		function removeAllFields(model, address) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const before = columnNames(target.statement.parts[0]);
			for (let k = target.part.fields.length - 1; k >= 0; k--) {
				removeColumnValue(target.statement, address.part, k);
			}
			return { model: target.model, warnings: dropColumnReferences(target.model, address.statement, before) };
		}

		/**
		 * Сдвиг поля на delta позиций. В объединении колонки позиционны: сдвигается колонка во всех
		 * частях, иначе значения разъехались бы по чужим колонкам.
		 */
		function moveField(model, address, index, delta) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const fields = target.part.fields;
			const to = index + delta;
			if (!fields[index] || to < 0 || to >= fields.length) {
				return { model: model, index: index };
			}
			const parts = target.statement.parts;
			const aligned = parts.every((part) => part.fields.length === fields.length);
			for (const part of aligned ? parts : [target.part]) {
				const moved = part.fields.splice(index, 1)[0];
				part.fields.splice(to, 0, moved);
			}
			// Имя колонки задаёт первая часть: при сдвиге псевдонимы едут вместе со значениями первой части
			return { model: target.model, index: to };
		}

		/**
		 * Новое выражение поля (окно выражения). Явный псевдоним остаётся; у поля без псевдонима,
		 * которое стало выражением, имя колонки сохраняется явным псевдонимом (бывшее неявное или
		 * ПолеN) — иначе колонка набора потеряла бы имя.
		 */
		function setFieldExpr(model, address, index, expr) {
			const target = editable(model, address);
			if (!target || !target.part.fields[index]) {
				return fail('Поля нет.');
			}
			const value = text(expr).trim();
			if (!value) {
				return fail('Пустое выражение поля.');
			}
			const field = target.part.fields[index];
			if (text(field.expr).trim() === value) {
				return { model: model };
			}
			const before = columnName(field);
			field.expr = value;
			if (!text(field.alias) && address.part === 0 && !(PATH_RE.test(value) && !LITERALS.has(upper(value)))) {
				const taken = columnNames(target.part).filter((name, k) => name && k !== index);
				field.alias = before && !taken.some((name) => upper(name) === upper(before)) ? before : Q.defaultFieldAlias(value, taken);
			}
			// Поле-путь без псевдонима сменило неявное имя колонки: ссылки по имени идут за ним, как при переименовании
			const after = address.part === 0 ? columnName(field) : before;
			if (before && after && upper(before) !== upper(after)) {
				renameColumnReferences(target.statement, before, after);
			}
			return { model: target.model };
		}

		// ---------- явный КАК у простых полей ----------

		/**
		 * Поле `Алиас.Имя` без псевдонима получает явный `КАК Имя`, если такое имя одно среди колонок
		 * части (без учёта регистра): неявное имя платформы то же, смысл не меняется, а текст выходит
		 * каноническим. Многосегментные пути и выражения без псевдонима не трогаются.
		 */
		function explicitAliases(part) {
			if (!part) {
				return part;
			}
			const aliases = new Set(aliasesOf(part).map(upper));
			const counts = new Map();
			for (const name of columnNames(part)) {
				if (name) {
					counts.set(upper(name), (counts.get(upper(name)) || 0) + 1);
				}
			}
			const copy = Object.assign({}, part);
			copy.fields = list(part.fields).map((field) => {
				if (!field || text(field.alias)) {
					return field;
				}
				const match = SIMPLE_FIELD_RE.exec(text(field.expr).trim());
				if (!match || !aliases.has(upper(match[1])) || counts.get(upper(match[2])) !== 1) {
					return field;
				}
				return Object.assign({}, field, { alias: match[2] });
			});
			return copy;
		}

		function samePart(a, b) {
			return Q.sameModel({ statements: [{ type: 'select', parts: [a] }] }, { statements: [{ type: 'select', parts: [b] }] });
		}

		/**
		 * Модель для записи по ОК: в изменённых первых частях запросов (по ним называются колонки)
		 * простые поля получают явный КАК (explicitAliases). Неизменённые части и запросы не трогаются
		 * вовсе — их сплайс выводит исходным срезом. Изменённость — по сравнению с исходной моделью:
		 * запрос пакета находится по месту в исходном тексте (original.index), новый — изменён целиком.
		 */
		function finalize(model, initial) {
			const copy = clone(model);
			const initialStatements = list(initial && initial.statements);
			list(copy.statements).forEach((statement, i) => {
				if (!statement || statement.type === 'drop' || !list(statement.parts)[0]) {
					return;
				}
				let before = null;
				if (statement.original && typeof statement.original.index === 'number') {
					before = initialStatements.find((item) => item && item.original && item.original.index === statement.original.index) || null;
				} else if (!initial || !initial.original || initial.original.count === 0) {
					// Модель без исходного текста (вложенный запрос второго уровня): сверка по месту
					before = initialStatements[i] || null;
				}
				const old = before && before.type !== 'drop' ? list(before.parts)[0] : null;
				if (old && samePart(old, statement.parts[0])) {
					return;
				}
				statement.parts[0] = explicitAliases(statement.parts[0]);
			});
			return copy;
		}

		// ---------- проверка перед ОК ----------

		/**
		 * Что мешает записать модель: запросы выборки без полей, источники без таблицы, индексы без
		 * полей (сборщик их не выведет — молча потерять индекс хуже, чем попросить поля). options.autofill —
		 * у набора включено автозаполнение: пакет без запроса выборки тогда не запишется вовсе
		 * (cf-dcs-autofill-fields откажет посреди пакета и откатит его), и отказ лучше дать в окне заранее.
		 */
		function problems(model, options) {
			const out = [];
			const statements = list(model && model.statements);
			if (statements.length === 0) {
				out.push('В запросе нет ни одного запроса пакета.');
			} else if (options && options.autofill && dataSetStatementIndex(model) < 0) {
				out.push(
					'В пакете нет запроса выборки без ПОМЕСТИТЬ, а у набора включено автозаполнение полей: им неоткуда взяться, и запрос не запишется. Верните запрос выборки на вкладке «Пакет запросов» или «Дополнительно».'
				);
			}
			statements.forEach((statement, i) => {
				if (!statement || statement.type === 'drop') {
					return;
				}
				const where = statements.length > 1 ? 'Запрос пакета ' + (i + 1) : 'Запрос';
				list(statement.indexes).forEach((index, k) => {
					if (!index || list(index.fields).length === 0) {
						out.push(where + ': у индекса ' + (k + 1) + ' нет полей, добавьте их на вкладке «Индекс» или удалите индекс.');
					}
				});
				list(statement.parts).forEach((part, k) => {
					const place = statement.parts.length > 1 ? where + ', часть ' + (k + 1) : where;
					if (list(part && part.fields).length === 0) {
						out.push(place + ': нет полей выборки, добавьте их на вкладке «Таблицы и поля».');
					}
					for (const entry of sourcesOf(part)) {
						if (entry.source.kind === 'table' && !text(entry.source.table)) {
							out.push(place + ': у источника нет таблицы.');
						}
					}
				});
			});
			return out;
		}

		// ---------- поля источников и каталог окна выражения ----------

		/**
		 * Поля источника для списка «Таблицы» и окна выражения. env.describe(имя таблицы) →
		 * {state: ready|loading|none, table?} — описание из кэша вкладки (cf-md-query-tables);
		 * env.tempTables — временные таблицы пакета до текущего запроса (tempTables модели);
		 * env.tempType(таблица, колонка) — тип колонки временной таблицы или null;
		 * env.subqueryType(источник, колонка) — тип колонки вложенного запроса или null (без него
		 * ссылочное поле подзапроса не раскрыть и связь по нему не предложить). Общая таблица констант
		 * (`Константы`) — не ВТ пакета: её поля, как у таблиц конфигурации, даёт env.describe (своего
		 * ответа md-sparrow у неё нет, описание собирает обвязка). Поле общего реквизита несёт свой вид
		 * (kind: separator | commonAttribute) — знак в деревьях полей; у прочих полей вида нет.
		 *
		 * @returns {{state: 'ready'|'loading'|'none', fields: {name, synonym, type, kind?}[]}}
		 */
		function fieldsOfSource(source, env) {
			const options = env || {};
			const value = source || {};
			if (value.kind === 'subquery') {
				const names = Q.outputFields(value.query).filter(Boolean);
				const typeOf = (name) => (typeof options.subqueryType === 'function' ? options.subqueryType(value, name) || null : null);
				return { state: 'ready', fields: names.map((name) => ({ name: name, synonym: '', type: typeOf(name) })) };
			}
			if (value.kind !== 'table') {
				return { state: 'none', fields: [] };
			}
			if (isTempTable(value)) {
				const found = list(options.tempTables).find((table) => upper(table && table.name) === upper(value.table));
				// Тип колонки ВТ — по запросу, который её создал (env.tempType обвязки, вывод DcsFieldTypes):
				// без него ссылочное поле ВТ не разыменовать и связь со справочником не предложить
				const typeOf = (name) => (typeof options.tempType === 'function' ? options.tempType(found, name) || null : null);
				return found
					? { state: 'ready', fields: list(found.fields).map((name) => ({ name: name, synonym: '', type: typeOf(name) })) }
					: { state: 'none', fields: [] };
			}
			const described = typeof options.describe === 'function' ? options.describe(value.table) : null;
			if (!described || described.state === 'none') {
				return { state: 'none', fields: [] };
			}
			if (described.state !== 'ready' || !described.table) {
				return { state: described.state === 'ready' ? 'none' : 'loading', fields: [] };
			}
			return {
				state: 'ready',
				fields: list(described.table.fields)
					.filter((field) => field && text(field.name))
					.map((field) => {
						const out = { name: field.name, synonym: text(field.synonym), type: field.type || null };
						if (fieldNodeKind(field) !== 'field') {
							out.kind = field.kind;
						}
						return out;
					}),
			};
		}

		/**
		 * Узлы каталога подсказки (DcsComplete.catalogFromNodes) для окна выражения части: алиасы
		 * источников и их поля с типами (по типам обвязка раскрывает ссылки через точку), параметры
		 * схемы. Функции языка запросов обвязка добавляет сама — их список у модуля подсказки.
		 */
		function catalogNodes(model, address, env) {
			const options = env || {};
			const part = partAt(model, address);
			const nodes = [];
			for (const entry of sourcesOf(part)) {
				if (!entry.alias) {
					continue;
				}
				// Таблица без псевдонима называется полным именем: каталог разложит его в промежуточные узлы
				nodes.push({ path: entry.alias, kind: 'table', title: sourceLabel(entry.source) });
				for (const field of fieldsOfSource(entry.source, options).fields) {
					nodes.push({ path: entry.alias + '.' + field.name, kind: fieldNodeKind(field), title: field.synonym, valueType: field.type || null });
				}
			}
			for (const param of list(options.parameters)) {
				if (param && text(param.name)) {
					nodes.push({ path: param.name, kind: 'param', title: text(param.title), valueType: param.valueType || null });
				}
			}
			return nodes;
		}

		// =========================================================================================
		// Общее вкладок «Связи», «Группировка», «Условия»: условия текстом и места блоков
		// =========================================================================================

		/** Индекс закрывающей скобки для открывающей в позиции open (строки и комментарии пропускаются); нет — -1. */
		function closingParen(value, open) {
			let depth = 0;
			for (let i = open; i < value.length; i++) {
				const ch = value[i];
				if (ch === '"') {
					// Кавычка внутри строки удваивается: "" — не конец строки
					i++;
					while (i < value.length && !(value[i] === '"' && value[i + 1] !== '"')) {
						i += value[i] === '"' ? 2 : 1;
					}
					continue;
				}
				if (ch === '/' && value[i + 1] === '/') {
					const eol = value.indexOf('\n', i);
					if (eol < 0) {
						return -1;
					}
					i = eol;
					continue;
				}
				if (ch === '(') {
					depth++;
				} else if (ch === ')') {
					depth--;
					if (depth === 0) {
						return i;
					}
				}
			}
			return -1;
		}

		/** Текст без внешних скобок вокруг всего условия: `(Т.А = Т.Б)` сопоставляется как `Т.А = Т.Б`. */
		function stripParens(value) {
			let current = text(value).trim();
			while (current.charAt(0) === '(' && closingParen(current, 0) === current.length - 1) {
				current = current.slice(1, -1).trim();
			}
			return current;
		}

		/**
		 * Условие текстом → элементы по И верхнего уровня так, как их разложит разборщик: иначе круг
		 * «сборка → разбор» дал бы другую модель. Раскладывает тот же разборщик через короткий текст
		 * запроса; предложение запроса или блок {…} внутри условия — отказ.
		 *
		 * @returns {{conditions: string[]}|{error: string}}
		 */
		function splitCondition(value) {
			const source = text(value).trim();
			if (!source) {
				return fail('Условие пустое.');
			}
			const parsed = Q.parse('ВЫБРАТЬ 1 ГДЕ\n' + source);
			const statements = parsed.model.statements;
			const statement = statements.length === 1 && statements[0].type === 'select' ? statements[0] : null;
			const part = statement && statement.parts.length === 1 ? statement.parts[0] : null;
			const clean =
				part &&
				part.where &&
				part.from.length === 0 &&
				!part.groupBy &&
				!part.having &&
				!part.dcsWhere &&
				!part.dcsSelect &&
				!part.into &&
				!part.forUpdate &&
				list(part.raw).length === 0 &&
				list(statement.raw).length === 0 &&
				!statement.orderBy &&
				!statement.totals &&
				!statement.autoOrder &&
				!statement.forUpdate &&
				list(statement.indexes).length === 0;
			if (parsed.diagnostics.length > 0 || !clean) {
				const first = parsed.diagnostics[0];
				return fail('Условие не разобрано: ' + (first ? first.message : 'в нём предложение запроса или блок {…}') + '.');
			}
			return { conditions: part.where.conditions.slice() };
		}

		/** Есть ли в условии ИЛИ верхнего уровня: разборщик тогда не делит его по И (весь текст — один элемент). */
		function hasTopLevelOr(condition) {
			const parsed = Q.parse('ВЫБРАТЬ 1 ГДЕ\n' + text(condition) + '\nИ ИСТИНА');
			const statement = parsed.model.statements[0];
			const part = statement && statement.type === 'select' ? statement.parts[0] : null;
			return Boolean(part && part.where && part.where.conditions.length === 1);
		}

		/**
		 * Список условий, которые сборщик соединит через И: элемент с ИЛИ верхнего уровня рядом с
		 * другими берётся в скобки — без них `А ИЛИ Б И В` значило бы другое.
		 */
		function joinedConditions(items) {
			const all = list(items);
			return all.length > 1 ? all.map((item) => (hasTopLevelOr(item) ? '(' + text(item).trim() + ')' : item)) : all.slice();
		}

		const PART_ANCHORS = Q.PART_PLACEMENTS;

		function anchorPresent(part, anchor) {
			switch (anchor) {
				case 'afterFields':
					return true;
				case 'afterInto':
					return Boolean(part.into);
				case 'afterFrom':
					return list(part.from).length > 0;
				case 'afterWhere':
					return Boolean(part.where) && list(part.where.conditions).length > 0;
				case 'afterGroupBy':
					return Boolean(part.groupBy) && (Array.isArray(part.groupBy.groupingSets) || list(part.groupBy.items).length > 0);
				case 'afterHaving':
					return Boolean(part.having) && list(part.having.conditions).length > 0;
				case 'afterForUpdate':
					return Array.isArray(part.forUpdate);
			}
			return false;
		}

		/**
		 * Места блоков СКД и прочих {…} части после правки предложений: блок, чьё предложение
		 * исчезло, встаёт за ближайшим предыдущим (так его выведет сборщик и найдёт разбор, и модель
		 * сходится по кругу). Первый ГДЕ забирает {ГДЕ}, стоявший сразу за ИЗ: по канону {ГДЕ} идёт за ГДЕ.
		 */
		function settleBlocks(part, whereCreated) {
			if (whereCreated && part.dcsWhere && part.dcsWhere.placement === 'afterFrom') {
				part.dcsWhere.placement = 'afterWhere';
			}
			const settle = (block) => {
				if (!block || typeof block !== 'object') {
					return;
				}
				let k = PART_ANCHORS.indexOf(block.placement);
				if (k < 0) {
					return;
				}
				while (k > 0 && !anchorPresent(part, PART_ANCHORS[k])) {
					k--;
				}
				block.placement = PART_ANCHORS[k];
			};
			settle(part.dcsSelect);
			settle(part.dcsWhere);
			list(part.raw).forEach(settle);
		}

		/** Ключ выражения для сравнения: значимые лексемы без регистра и разбивки (как в самопроверке). */
		function exprKey(value) {
			return Q.canonTokens(text(value)).join(' ');
		}

		/** Агрегатные функции языка запросов (имя в каноне лексем — русское, английское — как написано). */
		const AGGREGATE_WORDS = new Set(['СУММА', 'КОЛИЧЕСТВО', 'СРЕДНЕЕ', 'МИНИМУМ', 'МАКСИМУМ', 'SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);

		/**
		 * Есть ли в выражении агрегатная функция вне вложенного запроса: `СУММА(…)` в условии
		 * подзапроса `В (ВЫБРАТЬ …)` к группировке внешнего запроса отношения не имеет.
		 */
		function hasAggregate(value) {
			const tokens = Q.canonTokens(text(value));
			for (let i = 0; i < tokens.length; i++) {
				if (tokens[i] === '(' && upper(tokens[i + 1]) === 'ВЫБРАТЬ') {
					let depth = 0;
					for (; i < tokens.length; i++) {
						if (tokens[i] === '(') {
							depth++;
						} else if (tokens[i] === ')' && --depth === 0) {
							break;
						}
					}
					continue;
				}
				if (AGGREGATE_WORDS.has(upper(tokens[i])) && tokens[i + 1] === '(') {
					return true;
				}
			}
			return false;
		}

		function samePath(a, b) {
			return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, k) => value === b[k]);
		}

		// =========================================================================================
		// Связи
		// =========================================================================================

		/** Пометка ПРАВОГО соединения: «Все» только у второй таблицы. */
		const RIGHT_JOIN_NOTE =
			'«Все» только у второй таблицы: ПРАВОЕ СОЕДИНЕНИЕ.';

		/** Вид соединения по флажкам «Все»: оба — ПОЛНОЕ, только слева — ЛЕВОЕ, только справа — ПРАВОЕ, ни одного — ВНУТРЕННЕЕ. */
		function joinKindOf(allLeft, allRight) {
			if (allLeft && allRight) {
				return 'full';
			}
			return allLeft ? 'left' : allRight ? 'right' : 'inner';
		}

		function joinFlagsOf(kind) {
			return { allLeft: kind === 'left' || kind === 'full', allRight: kind === 'right' || kind === 'full' };
		}

		/** Узел дерева источников по адресу sourcesOf: [i] — строка ИЗ, [i, k, …] — соединение. */
		function nodeAt(part, path) {
			if (!part || !Array.isArray(path) || path.length === 0) {
				return null;
			}
			let node = list(part.from)[path[0]] || null;
			for (let k = 1; node && k < path.length; k++) {
				node = list(node.joins)[path[k]] || null;
			}
			return node;
		}

		/** Алиасы поддерева: источник узла и всё, что соединено внутри него. */
		function subtreeAliases(node) {
			const out = [];
			const walk = (item) => {
				const alias = aliasOf(item && item.source);
				if (alias) {
					out.push(alias);
				}
				list(item && item.joins).forEach(walk);
			};
			walk(node);
			return out;
		}

		/**
		 * Левая сторона соединения: источник родителя и поддеревья соединений родителя до этого. На
		 * них может ссылаться ПО соединения (у вложенного соединения — только внутри своего родителя).
		 */
		function leftSideAliases(part, path) {
			const parent = nodeAt(part, path.slice(0, -1));
			if (!parent) {
				return [];
			}
			const out = [];
			const own = aliasOf(parent.source);
			if (own) {
				out.push(own);
			}
			list(parent.joins)
				.slice(0, path[path.length - 1])
				.forEach((sibling) => out.push(...subtreeAliases(sibling)));
			return out;
		}

		const LINK_PATH = '[\\p{L}_][\\p{L}\\p{N}_]*(?:\\.[\\p{L}_][\\p{L}\\p{N}_]*)+';
		const SIMPLE_LINK_RE = new RegExp('^(' + LINK_PATH + ')\\s*(<>|<=|>=|=|<|>)\\s*(' + LINK_PATH + ')$', 'u');
		const MIRRORED = { '=': '=', '<>': '<>', '<': '>', '<=': '>=', '>': '<', '>=': '<=' };

		/** Знаки простого условия связи «поле · знак · поле». */
		const LINK_OPERATORS = Object.freeze(['=', '<>', '<', '<=', '>', '>=']);

		/**
		 * Простое условие связи: `Т1.Поле знак Т2.Поле`, где поле слева — таблицы 1, справа — таблицы 2
		 * (записанное наоборот читается с отражённым знаком). Иначе — null (условие произвольное).
		 */
		function simpleLinkOf(condition, left, right) {
			const match = SIMPLE_LINK_RE.exec(stripParens(condition));
			if (!match) {
				return null;
			}
			const headOf = (path) => path.slice(0, path.indexOf('.'));
			const a = match[1];
			const b = match[3];
			if (upper(headOf(a)) === upper(left) && upper(headOf(b)) === upper(right)) {
				return { left: a.slice(a.indexOf('.') + 1), op: match[2], right: b.slice(b.indexOf('.') + 1) };
			}
			if (upper(headOf(a)) === upper(right) && upper(headOf(b)) === upper(left)) {
				return { left: b.slice(b.indexOf('.') + 1), op: MIRRORED[match[2]], right: a.slice(a.indexOf('.') + 1) };
			}
			return null;
		}

		/**
		 * Строки вкладки «Связи»: по строке на условие каждого соединения (условия одного соединения —
		 * его строки через И). Таблица 1 — источник левой стороны, на который ссылается условие (без
		 * ссылки — родитель соединения), таблица 2 — источник соединения или вложенный в него, на
		 * который ссылается условие. Флажки «Все» — вид соединения, общий для всех его строк.
		 *
		 * @returns {{key, path: number[], condition: number, left, right, allLeft, allRight, kind, text, simple, optional, count}[]}
		 */
		function linkRows(part) {
			const rows = [];
			const walk = (node, path) => {
				list(node && node.joins).forEach((join, k) => {
					if (!join) {
						return;
					}
					const here = path.concat(k);
					const leftSide = leftSideAliases(part, here);
					const rightSide = subtreeAliases(join);
					const flags = joinFlagsOf(join.kind);
					const conditions = join.on ? list(join.on.conditions) : [];
					conditions.forEach((condition, c) => {
						const left = leftSide.find((alias) => refersTo(condition, alias)) || leftSide[0] || '';
						const right = rightSide.find((alias) => refersTo(condition, alias)) || aliasOf(join.source);
						rows.push({
							key: 'l:' + here.join('.') + '#' + c,
							path: here,
							condition: c,
							left: left,
							right: right,
							allLeft: flags.allLeft,
							allRight: flags.allRight,
							kind: join.kind,
							text: condition,
							simple: simpleLinkOf(condition, left, right),
							optional: join.optionalGroup !== null && join.optionalGroup !== undefined,
							count: conditions.length,
						});
					});
					walk(join, here);
				});
			};
			list(part && part.from).forEach((entry, i) => walk(entry, [i]));
			return rows;
		}

		function linkTarget(model, address, ref) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const join = ref && Array.isArray(ref.path) && ref.path.length >= 2 ? nodeAt(target.part, ref.path) : null;
			if (!join) {
				return fail('Связь не найдена.');
			}
			return { model: target.model, part: target.part, join: join };
		}

		/**
		 * Флажки «Все» строки связи → вид соединения (у всех строк этого соединения). Меняется только
		 * это соединение: дерево соединений исходного текста остаётся как было.
		 */
		function setLinkKind(model, address, ref, allLeft, allRight) {
			const target = linkTarget(model, address, ref);
			if (target.error) {
				return target;
			}
			const kind = joinKindOf(Boolean(allLeft), Boolean(allRight));
			if (target.join.kind === kind) {
				return { model: model, warnings: [] };
			}
			target.join.kind = kind;
			return { model: target.model, warnings: kind === 'right' ? [RIGHT_JOIN_NOTE] : [] };
		}

		/** Новый текст условия строки связи; несколько условий через И становятся строками того же соединения. */
		function setLinkCondition(model, address, ref, value) {
			const target = linkTarget(model, address, ref);
			if (target.error) {
				return target;
			}
			const current = target.join.on ? list(target.join.on.conditions) : [];
			if (!(ref.condition >= 0 && ref.condition < current.length)) {
				return fail('Связь не найдена.');
			}
			if (text(current[ref.condition]).trim() === text(value).trim()) {
				return { model: model };
			}
			const split = splitCondition(value);
			if (split.error) {
				return split;
			}
			const next = current.slice();
			next.splice(ref.condition, 1, ...split.conditions);
			target.join.on = { conditions: joinedConditions(next) };
			return { model: target.model };
		}

		/** Сборка простого условия связи из полей строки. */
		function linkConditionText(left, leftField, op, right, rightField) {
			return text(left) + '.' + text(leftField).trim() + ' ' + (LINK_OPERATORS.indexOf(op) >= 0 ? op : '=') + ' ' + text(right) + '.' + text(rightField).trim();
		}

		/**
		 * Удаляет строку связи. Последнее условие соединения уносит и само соединение: его таблица
		 * (с тем, что соединено внутри неё) становится отдельной строкой ИЗ через запятую — каждая
		 * строка с каждой, как у платформы для таблиц без связей. Если на неё
		 * ссылается другое соединение той же цепочки — отказ: без своей таблицы его ПО стало бы неверным.
		 */
		function removeLink(model, address, ref) {
			const target = linkTarget(model, address, ref);
			if (target.error) {
				return target;
			}
			const join = target.join;
			const conditions = join.on ? list(join.on.conditions) : [];
			if (conditions.length > 1) {
				const next = conditions.slice();
				next.splice(ref.condition, 1);
				join.on = { conditions: next };
				return { model: target.model, warnings: [] };
			}
			const moving = subtreeAliases(join);
			const entry = target.part.from[ref.path[0]];
			const dependents = [];
			const walk = (node) => {
				for (const other of list(node.joins)) {
					if (other === join) {
						continue;
					}
					const uses = (other.on ? list(other.on.conditions) : []).some((condition) => moving.some((alias) => refersTo(condition, alias)));
					if (uses) {
						dependents.push(aliasOf(other.source) || sourceLabel(other.source));
					}
					walk(other);
				}
			};
			walk(entry);
			if (dependents.length > 0) {
				return fail(
					'Связь не удалить: на таблицу «' + aliasOf(join.source) + '» ссылается связь таблицы «' + dependents[0] + '». Сначала удалите или измените её.'
				);
			}
			const parent = nodeAt(target.part, ref.path.slice(0, -1));
			parent.joins.splice(ref.path[ref.path.length - 1], 1);
			target.part.from.splice(ref.path[0] + 1, 0, { source: join.source, joins: list(join.joins) });
			// Ушедшее соединение могло быть необязательным: номера групп — как их прочитает разбор
			normalizeGroups(target.part);
			const alias = aliasOf(join.source) || sourceLabel(join.source);
			return {
				model: target.model,
				warnings: ['Таблица «' + alias + '» больше ни с чем не связана: в ИЗ она идёт через запятую, и каждая её строка соединится с каждой.'],
			};
		}

		/**
		 * Новая строка связи {left, right, allLeft, allRight, condition}. Таблицы уже в одной цепочке —
		 * условие уходит через И в соединение, которое их разделяет (вид — по флажкам строки). Иначе
		 * строка ИЗ, что стоит дальше, становится соединением цепочки первой: новые связи — плоской
		 * цепочкой от первой таблицы, открытое дерево соединений не перестраивается. Если таблица 1
		 * оказалась справа, флажки отражаются (смысл тот же).
		 *
		 * @returns {{model, path: number[], warnings: string[]}|{error: string}}
		 */
		function addLink(model, address, spec) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const value = spec || {};
			const part = target.part;
			const left = findSource(part, value.left);
			const right = findSource(part, value.right);
			if (!left || !right) {
				return fail('Таблицы связи нет в части запроса.');
			}
			if (upper(left.alias) === upper(right.alias)) {
				return fail('Таблица 1 и таблица 2 связи совпадают.');
			}
			const split = splitCondition(value.condition);
			if (split.error) {
				return split;
			}
			const kindFor = (swapped) => (swapped ? joinKindOf(Boolean(value.allRight), Boolean(value.allLeft)) : joinKindOf(Boolean(value.allLeft), Boolean(value.allRight)));
			let joinPath;
			if (left.path[0] === right.path[0]) {
				const a = left.path;
				const b = right.path;
				let c = 0;
				while (c < a.length && c < b.length && a[c] === b[c]) {
					c++;
				}
				let swapped;
				if (c === a.length) {
					joinPath = b.slice(0, c + 1);
					swapped = false;
				} else if (c === b.length) {
					joinPath = a.slice(0, c + 1);
					swapped = true;
				} else {
					swapped = a[c] > b[c];
					joinPath = (swapped ? a : b).slice(0, c + 1);
				}
				const join = nodeAt(part, joinPath);
				join.on = { conditions: joinedConditions((join.on ? list(join.on.conditions) : []).concat(split.conditions)) };
				join.kind = kindFor(swapped);
			} else {
				const later = Math.max(left.path[0], right.path[0]);
				const earlier = Math.min(left.path[0], right.path[0]);
				const moved = part.from.splice(later, 1)[0];
				const chain = part.from[earlier];
				chain.joins.push({
					kind: kindFor(left.path[0] === later),
					optionalGroup: null,
					source: moved.source,
					joins: list(moved.joins),
					on: { conditions: joinedConditions(split.conditions) },
				});
				joinPath = [earlier, chain.joins.length - 1];
			}
			const kind = nodeAt(part, joinPath).kind;
			return { model: target.model, path: joinPath, warnings: kind === 'right' ? [RIGHT_JOIN_NOTE] : [] };
		}

		/** Временное имя для перестановки алиасов в тексте: не совпадает ни с чем в нём. */
		function placeholder(value, k) {
			let name = '_ЗаменаПсевдонима' + k + '_';
			while (upper(value).indexOf(upper(name)) >= 0) {
				name += '_';
			}
			return name;
		}

		/** Замена алиасов-голов путей парами [было, стало] разом: обмен местами (А↔Б) не склеивает их. */
		function renameAliases(value, pairs) {
			let out = text(value);
			const back = [];
			pairs.forEach((pair, k) => {
				if (!pair[0] || upper(pair[0]) === upper(pair[1])) {
					return;
				}
				const temp = placeholder(out, k);
				out = Q.renameAliasInText(out, pair[0], temp);
				back.push([temp, pair[1]]);
			});
			for (const pair of back) {
				out = Q.renameAliasInText(out, pair[0], pair[1]);
			}
			return out;
		}

		/**
		 * Другая таблица 1 или 2 у строки связи: ссылки условия на заменяемую таблицу переходят на новую,
		 * строка уходит из своего соединения и встаёт к новой паре с теми же флажками «Все».
		 */
		function relinkRow(model, address, ref, pair) {
			const part = partAt(model, address);
			const row = part ? linkRows(part).find((item) => samePath(item.path, ref && ref.path) && item.condition === ref.condition) : null;
			if (!row) {
				return fail('Связь не найдена.');
			}
			const value = pair || {};
			const left = text(value.left) || row.left;
			const right = text(value.right) || row.right;
			if (upper(left) === upper(row.left) && upper(right) === upper(row.right)) {
				return { model: model, path: row.path, warnings: [] };
			}
			if (upper(left) === upper(right)) {
				return fail('Таблица 1 и таблица 2 связи совпадают.');
			}
			const condition = renameAliases(row.text, [
				[row.left, left],
				[row.right, right],
			]);
			const removed = removeLink(model, address, ref);
			if (removed.error) {
				return removed;
			}
			const added = addLink(removed.model, address, { left: left, right: right, allLeft: row.allLeft, allRight: row.allRight, condition: condition });
			if (added.error) {
				return added;
			}
			return { model: added.model, path: added.path, warnings: added.warnings };
		}

		const REF_NAMES = new Set(['ССЫЛКА', 'REF']);

		/**
		 * Ссылочные типы поля (`cfg:CatalogRef.X`) с раскрытыми составами определяемых типов и
		 * характеристик: по ним поле определяемого типа связывается с таблицей объекта из состава.
		 * Предела числа ссылок здесь нет — сравниваются только имена типов, описания не читаются.
		 * Наборы ссылок вида и «любая ссылка» сюда не входят.
		 */
		function refTypesOfField(field) {
			return refTypeNames(field && field.type);
		}

		/**
		 * Условие связи двух таблиц по совпадению ссылочного типа — правило редактора: 1) поле таблицы 1
		 * ссылается на объект таблицы 2 (`Т1.Поле = Т2.Ссылка`); 2) поле таблицы 2 — на объект таблицы 1
		 * (`Т1.Ссылка = Т2.Поле`); 3) тёзки с одним и тем же ссылочным типом
		 * (`Т1.Номенклатура = Т2.Номенклатура`). Поле с одним типом предпочтительнее составного (ссылки
		 * считаются по раскрытому типу: определяемый тип из одной ссылки — одиночный). Таблица сама с
		 * собой не связывается.
		 *
		 * @returns {{state: 'ready'|'loading'|'none', condition: string}}
		 */
		function suggestCondition(part, leftAlias, rightAlias, env) {
			const left = findSource(part, leftAlias);
			const right = findSource(part, rightAlias);
			const none = { state: 'none', condition: '' };
			if (!left || !right || upper(left.alias) === upper(right.alias)) {
				return none;
			}
			if (left.source.kind === 'table' && right.source.kind === 'table' && upper(left.source.table) === upper(right.source.table)) {
				return none;
			}
			const leftFields = fieldsOfSource(left.source, env);
			const rightFields = fieldsOfSource(right.source, env);
			if (leftFields.state === 'loading' || rightFields.state === 'loading') {
				return { state: 'loading', condition: '' };
			}
			if (leftFields.state !== 'ready' || rightFields.state !== 'ready') {
				return none;
			}
			const ready = (a, b) => ({ state: 'ready', condition: left.alias + '.' + a + ' = ' + right.alias + '.' + b });
			const refOf = (fields) => fields.find((field) => REF_NAMES.has(upper(field.name)) && refTypesOfField(field).length === 1) || null;
			const pointing = (fields, type) =>
				fields
					.filter((field) => refTypesOfField(field).indexOf(type) >= 0)
					.sort((a, b) => refTypesOfField(a).length - refTypesOfField(b).length)[0] || null;
			const rightRef = refOf(rightFields.fields);
			if (rightRef) {
				const found = pointing(leftFields.fields, refTypesOfField(rightRef)[0]);
				if (found) {
					return ready(found.name, rightRef.name);
				}
			}
			const leftRef = refOf(leftFields.fields);
			if (leftRef) {
				const found = pointing(rightFields.fields, refTypesOfField(leftRef)[0]);
				if (found) {
					return ready(leftRef.name, found.name);
				}
			}
			for (const field of leftFields.fields) {
				const types = refTypesOfField(field);
				if (types.length !== 1) {
					continue;
				}
				const twin = rightFields.fields.find((other) => upper(other.name) === upper(field.name) && refTypesOfField(other).length === 1 && refTypesOfField(other)[0] === types[0]);
				if (twin) {
					return ready(field.name, twin.name);
				}
			}
			return none;
		}

		/**
		 * Автопредложение связи для только что добавленной таблицы (правило редактора): она
		 * отдельная строка ИЗ без связей, а в части есть другие таблицы. Источники перебираются по
		 * порядку — первая таблица важнее; пока описание более ранней грузится, ответ — loading
		 * (обвязка повторит, когда описание придёт). Связь — ЛЕВОЕ («Все» у таблицы 1).
		 *
		 * @returns {{state: 'ready', left, right, condition, allLeft: true, allRight: false}|{state: 'loading'|'none'}}
		 */
		function suggestLink(model, address, alias, env) {
			const part = partAt(model, address);
			const added = part ? findSource(part, alias) : null;
			if (!added || added.path.length !== 1 || list(part.from[added.path[0]].joins).length > 0 || part.from.length < 2) {
				return { state: 'none' };
			}
			for (const other of sourcesOf(part)) {
				if (!other.alias || upper(other.alias) === upper(added.alias)) {
					continue;
				}
				const found = suggestCondition(part, other.alias, added.alias, env);
				if (found.state === 'loading') {
					return { state: 'loading' };
				}
				if (found.state === 'ready') {
					return { state: 'ready', left: other.alias, right: added.alias, condition: found.condition, allLeft: true, allRight: false };
				}
			}
			return { state: 'none' };
		}

		// =========================================================================================
		// Группировка
		// =========================================================================================

		/**
		 * Функции суммируемых полей вкладки «Группировка»: подпись, слово языка запросов и РАЗЛИЧНЫЕ у
		 * количества различных.
		 */
		const AGGREGATE_FUNCTIONS = Object.freeze([
			Object.freeze({ id: 'sum', label: 'Сумма', ru: 'СУММА', en: 'SUM', distinct: false }),
			Object.freeze({ id: 'count', label: 'Количество', ru: 'КОЛИЧЕСТВО', en: 'COUNT', distinct: false }),
			Object.freeze({ id: 'countDistinct', label: 'Количество различных', ru: 'КОЛИЧЕСТВО', en: 'COUNT', distinct: true }),
			Object.freeze({ id: 'max', label: 'Максимум', ru: 'МАКСИМУМ', en: 'MAX', distinct: false }),
			Object.freeze({ id: 'min', label: 'Минимум', ru: 'МИНИМУМ', en: 'MIN', distinct: false }),
			Object.freeze({ id: 'avg', label: 'Среднее', ru: 'СРЕДНЕЕ', en: 'AVG', distinct: false }),
		]);

		const DISTINCT_RE = /^(?:РАЗЛИЧНЫЕ|DISTINCT)\s+([\s\S]+)$/iu;

		/**
		 * Поле-агрегат целиком: `СУММА(арг)`, `КОЛИЧЕСТВО(РАЗЛИЧНЫЕ арг)` → {fn, arg}. Выражение, в
		 * котором агрегат лишь часть (`ЕСТЬNULL(СУММА(…), 0)`), — null: оно правится выражением.
		 */
		function aggregateOf(expr) {
			const value = text(expr).trim();
			const match = /^([\p{L}_][\p{L}\p{N}_]*)\s*\(/u.exec(value);
			if (!match) {
				return null;
			}
			const open = match[0].length - 1;
			if (closingParen(value, open) !== value.length - 1) {
				return null;
			}
			const word = upper(match[1]);
			const inner = value.slice(open + 1, -1).trim();
			const distinct = DISTINCT_RE.exec(inner);
			const fn = AGGREGATE_FUNCTIONS.find((item) => (item.ru === word || item.en === word) && item.distinct === Boolean(distinct));
			if (!fn || !inner) {
				return null;
			}
			return { fn: fn.id, arg: distinct ? distinct[1].trim() : inner };
		}

		function wrapAggregate(fnId, arg, lang) {
			const fn = AGGREGATE_FUNCTIONS.find((item) => item.id === fnId);
			if (!fn) {
				return null;
			}
			const word = lang === 'en' ? fn.en : fn.ru;
			return word + '(' + (fn.distinct ? (lang === 'en' ? 'DISTINCT ' : 'РАЗЛИЧНЫЕ ') : '') + text(arg).trim() + ')';
		}

		const WRAPPED_ARGUMENT_WORDS = new Set(['ЗНАЧЕНИЕ', 'VALUE', 'ТИП', 'TYPE']);

		/** Слова, за которыми в выражении стоит имя типа, а не путь поля (проверка имён). */
		const TYPE_NAME_WORDS = new Set(['КАК', 'AS', 'ССЫЛКА', 'REFS']);

		/** Слова периода в НАЧАЛОПЕРИОДА(…, ДЕНЬ) и подобных: по виду имя без точки, но это не поле. */
		const PERIOD_WORDS = new Set([
			'СЕКУНДА', 'МИНУТА', 'ЧАС', 'ДЕНЬ', 'НЕДЕЛЯ', 'ДЕКАДА', 'МЕСЯЦ', 'КВАРТАЛ', 'ПОЛУГОДИЕ', 'ГОД',
			'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'TENDAYS', 'MONTH', 'QUARTER', 'HALFYEAR', 'YEAR',
		]);

		/** Индекс лексемы за закрывающей скобкой для открывающей в позиции open. */
		function afterParen(tokens, open) {
			let depth = 0;
			for (let i = open; i < tokens.length; i++) {
				if (tokens[i] === '(') {
					depth++;
				} else if (tokens[i] === ')' && --depth === 0) {
					return i + 1;
				}
			}
			return tokens.length;
		}

		/**
		 * Пути полей, на которые ссылается выражение (в каноне лексем, прописными): `Алиас.Поле…` или
		 * одиночное имя (поле единственного источника). Литералы, параметры, имена функций, слова
		 * языка, пути внутри ЗНАЧЕНИЕ(…) и ТИП(…) и вложенные запросы полями не считаются.
		 */
		function fieldPathsOf(expr) {
			const tokens = Q.canonTokens(text(expr));
			const isWord = (value) => /^[\p{L}_]/u.test(text(value));
			const out = [];
			for (let i = 0; i < tokens.length; i++) {
				const token = tokens[i];
				if (token === '(' && upper(tokens[i + 1]) === 'ВЫБРАТЬ') {
					i = afterParen(tokens, i) - 1;
					continue;
				}
				if (!isWord(token) || tokens[i - 1] === '.') {
					continue;
				}
				const word = upper(token);
				if (tokens[i + 1] === '(') {
					if (WRAPPED_ARGUMENT_WORDS.has(word)) {
						i = afterParen(tokens, i + 1) - 1;
					}
					continue;
				}
				if (RESERVED.has(word) || LITERALS.has(word) || PERIOD_WORDS.has(word)) {
					continue;
				}
				let path = word;
				while (tokens[i + 1] === '.' && isWord(tokens[i + 2])) {
					path += '.' + upper(tokens[i + 2]);
					i += 2;
				}
				out.push(path);
			}
			return out;
		}

		/**
		 * Состояние вкладки «Группировка» части: групповые выражения (СГРУППИРОВАТЬ ПО), суммируемые
		 * поля (агрегат целиком — с функцией, агрегат внутри выражения — «выражение»), поля выборки
		 * вне обоих списков. Поле считается покрытым, если оно совпадает с групповым выражением или
		 * каждое поле в нём встречается в групповых выражениях либо продолжает такой путь
		 * (`Т.Склад.Владелец` при группировке по `Т.Склад`); выражение без полей — константа. Правило
		 * мягче платформы нарочно: ложное предупреждение на рабочем запросе (ВЫБОР в выборке и другой
		 * ВЫБОР по тем же полям в группировке) хуже пропущенного — запрос всё равно проверяет платформа.
		 */
		function groupingOf(part) {
			const groupBy = part && part.groupBy;
			const sets = Boolean(groupBy && Array.isArray(groupBy.groupingSets));
			const groups = sets ? [] : list(groupBy && groupBy.items).map((item, index) => ({ index: index, text: item }));
			const keys = groups.map((item) => exprKey(item.text));
			const paths = [].concat(...groups.map((item) => fieldPathsOf(item.text)));
			const grouped = (path) => paths.some((item) => path === item || path.indexOf(item + '.') === 0);
			const sums = [];
			const loose = [];
			list(part && part.fields).forEach((field, index) => {
				const expr = text(field && field.expr);
				const aggregate = aggregateOf(expr);
				if (aggregate) {
					sums.push({ field: index, fn: aggregate.fn, arg: aggregate.arg, custom: false });
					return;
				}
				if (hasAggregate(expr)) {
					sums.push({ field: index, fn: '', arg: expr.trim(), custom: true });
					return;
				}
				const covered = keys.indexOf(exprKey(expr)) >= 0 || fieldPathsOf(expr).every(grouped);
				if (!covered) {
					loose.push(index);
				}
			});
			const active = sets || groups.length > 0 || sums.length > 0;
			return { active: active, sets: sets, groups: groups, sums: sums, loose: active ? loose : [] };
		}

		/** Предупреждения вкладки «Группировка»: поля выборки вне групповых и суммируемых. */
		function groupingWarnings(part) {
			const state = groupingOf(part);
			return state.loose.map((index) => {
				const field = part.fields[index];
				return 'Поле «' + text(field.expr).replace(/\s+/g, ' ').trim() + '» не входит ни в групповые, ни в суммируемые поля. Добавьте его в один из списков.';
			});
		}

		/**
		 * Кандидаты кнопок «>>» вкладки «Группировка»: поля выборки вне обоих списков
		 * (groupingOf().loose), а без группировки — все поля без агрегата, в которых есть путь поля:
		 * константы, `&`-параметры и NULL группировать и суммировать незачем. Делятся по типу (ссылку
		 * или строку в СУММА(…) платформа не выполнит):
		 * - групповые — всё, кроме известных числовых;
		 * - суммируемые — всё, кроме известных нечисловых;
		 * - составной тип с числом и неизвестный тип (в т. ч. определяемый без состава) — в оба: решает
		 *   пользователь, а вывод типа может ошибаться.
		 * Даты и строки тоже группируют, поэтому групповые не ограничены ссылочными полями.
		 *
		 * @param {object} part Часть объединения.
		 * @param {function} typeOf (номерПоля, выражение) → тип выражения поля (форма valueType, лучше
		 *   с уже раскрытыми составами) | null — обвязка выводит его по метаданным.
		 * @returns {{groups: number[], sums: number[], skipped: {index: number, target: 'groups'|'sums', reason: 'numeric'|'nonNumeric'|'constant'}[]}}
		 *   skipped — почему поле не взято в список target (константа — в оба).
		 */
		function groupingCandidates(part, typeOf) {
			const out = { groups: [], sums: [], skipped: [] };
			const state = groupingOf(part);
			if (state.sets) {
				return out;
			}
			const fields = list(part && part.fields);
			const candidates = [];
			if (state.active) {
				candidates.push(...state.loose);
			} else {
				fields.forEach((field, index) => {
					const expr = text(field && field.expr);
					if (hasAggregate(expr)) {
						return;
					}
					if (fieldPathsOf(expr).length === 0) {
						out.skipped.push({ index: index, target: 'groups', reason: 'constant' }, { index: index, target: 'sums', reason: 'constant' });
						return;
					}
					candidates.push(index);
				});
			}
			for (const index of candidates) {
				const kind = numericKind(typeof typeOf === 'function' ? typeOf(index, text(fields[index] && fields[index].expr)) : null);
				if (kind === 'numeric') {
					out.skipped.push({ index: index, target: 'groups', reason: 'numeric' });
				} else {
					out.groups.push(index);
				}
				if (kind === 'other') {
					out.skipped.push({ index: index, target: 'sums', reason: 'nonNumeric' });
				} else {
					out.sums.push(index);
				}
			}
			return out;
		}

		/**
		 * Предупреждения о суммируемых полях с функцией «Сумма» или «Среднее» от поля известного
		 * нечислового типа: эти функции считаются только по числам. Только предупреждение, ОК не
		 * блокируется — тип выводится по метаданным и может ошибаться. Количество, максимум и минимум
		 * годятся для любого типа; агрегат внутри выражения не разбирается.
		 *
		 * @param {object} part Часть объединения.
		 * @param {function} typeOf (номерПоля, выражение) → тип | null; для суммируемого поля
		 *   спрашивается тип аргумента агрегата.
		 * @returns {string[]}
		 */
		function aggregateTypeWarnings(part, typeOf) {
			const out = [];
			list(part && part.fields).forEach((field, index) => {
				const aggregate = aggregateOf(text(field && field.expr));
				if (!aggregate || (aggregate.fn !== 'sum' && aggregate.fn !== 'avg')) {
					return;
				}
				const type = typeof typeOf === 'function' ? typeOf(index, aggregate.arg) : null;
				if (numericKind(type) !== 'other') {
					return;
				}
				const fn = AGGREGATE_FUNCTIONS.find((item) => item.id === aggregate.fn);
				// Максимум и минимум по неограниченной строке и хранилищу значения тоже не считаются
				const others = ungroupableKind(type) ? 'Количество' : 'Количество, Максимум, Минимум';
				out.push(
					'Суммируемое поле «' + aggregate.arg.replace(/\s+/g, ' ').trim() + '» не числовое, а функция «' + fn.label + '» считается только по числам. Выберите другую функцию (' + others + ').'
				);
			});
			return out;
		}

		/**
		 * Предупреждения о групповых выражениях, по которым платформа не группирует: строка
		 * неограниченной длины и ХранилищеЗначения (ungroupableKind). «>>» берёт их в групповые, а без
		 * этой строки ОК молча записал бы запрос, который не выполнится. Только предупреждение.
		 *
		 * @param {object} part Часть объединения.
		 * @param {function} typeOf (номерПоля, выражение) → тип | null; номер у группового выражения — -1.
		 * @returns {string[]}
		 */
		function groupTypeWarnings(part, typeOf) {
			if (typeof typeOf !== 'function') {
				return [];
			}
			const out = [];
			for (const group of groupingOf(part).groups) {
				const kind = ungroupableKind(typeOf(-1, group.text));
				if (!kind) {
					continue;
				}
				const name = '«' + text(group.text).replace(/\s+/g, ' ').trim() + '»';
				out.push(
					kind === 'valueStorage'
						? 'Групповое поле ' + name + ' это хранилище значения: по такому полю платформа не группирует.'
						: 'Групповое поле ' + name + ' это строка неограниченной длины: по такой строке платформа не группирует. Сократите её: ПОДСТРОКА(…, 1, N) или ВЫРАЗИТЬ(… КАК СТРОКА(N)).'
				);
			}
			return out;
		}

		function groupTarget(model, address) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			if (target.part.groupBy && Array.isArray(target.part.groupBy.groupingSets)) {
				return fail('Группировка по группирующим наборам правится текстом («Запрос…»).');
			}
			return target;
		}

		/**
		 * Групповое поле: выражение уходит в СГРУППИРОВАТЬ ПО (выражение, а не псевдоним).
		 * Поле с агрегатом группировать нельзя; повтор (без учёта регистра и разбивки) — без правки.
		 * Выборку не трогает: группировать можно и по полю, которого в выборке нет.
		 */
		function addGroupField(model, address, expr) {
			const value = text(expr).trim();
			if (!value) {
				return fail('Пустое выражение группировки.');
			}
			if (hasAggregate(value)) {
				return fail('Поле с агрегатной функцией не группируется: оно суммируемое.');
			}
			const target = groupTarget(model, address);
			if (target.error) {
				return target;
			}
			const part = target.part;
			const items = list(part.groupBy && part.groupBy.items);
			const key = exprKey(value);
			const at = items.findIndex((item) => exprKey(item) === key);
			if (at >= 0) {
				return { model: model, index: at };
			}
			part.groupBy = { items: items.concat([value]), groupingSets: null };
			settleBlocks(part, false);
			return { model: target.model, index: items.length };
		}

		/** Убирает групповое выражение; последнее снимает СГРУППИРОВАТЬ ПО целиком. */
		function removeGroupField(model, address, index) {
			const target = groupTarget(model, address);
			if (target.error) {
				return target;
			}
			const part = target.part;
			const items = list(part.groupBy && part.groupBy.items);
			if (!(index >= 0 && index < items.length)) {
				return fail('Группового поля нет.');
			}
			const next = items.slice();
			next.splice(index, 1);
			part.groupBy = next.length > 0 ? { items: next, groupingSets: null } : null;
			settleBlocks(part, false);
			return { model: target.model };
		}

		function removeAllGroupFields(model, address) {
			const target = groupTarget(model, address);
			if (target.error) {
				return target;
			}
			if (!target.part.groupBy) {
				return { model: model };
			}
			target.part.groupBy = null;
			settleBlocks(target.part, false);
			return { model: target.model };
		}

		/**
		 * Функция суммируемого поля выборки (fnId из AGGREGATE_FUNCTIONS) или null — снять агрегат.
		 * Имя колонки остаётся: у поля без псевдонима в первой части оно становится явным КАК (агрегат
		 * неявного имени не даёт). Поле, ставшее суммируемым, уходит из групповых. Агрегат внутри
		 * выражения функцией не правится — только окном выражения.
		 */
		function setFieldAggregate(model, address, fieldIndex, fnId) {
			const target = groupTarget(model, address);
			if (target.error) {
				return target;
			}
			const part = target.part;
			const field = part.fields[fieldIndex];
			if (!field) {
				return fail('Поля нет.');
			}
			const current = aggregateOf(field.expr);
			if (!current && hasAggregate(field.expr)) {
				return fail('В поле агрегатная функция внутри выражения: правьте его выражением («Таблицы и поля»).');
			}
			const base = current ? current.arg : text(field.expr).trim();
			const expr = fnId ? wrapAggregate(fnId, base, model && model.lang) : base;
			if (!expr) {
				return fail('Неизвестная функция суммируемого поля.');
			}
			if (expr === text(field.expr).trim()) {
				return { model: model };
			}
			const before = columnName(field);
			field.expr = expr;
			if (!text(field.alias) && address.part === 0 && before) {
				const taken = columnNames(part).filter((name, k) => name && k !== fieldIndex);
				field.alias = taken.some((name) => upper(name) === upper(before)) ? Q.defaultFieldAlias(expr, taken) : before;
			}
			if (fnId && part.groupBy) {
				const key = exprKey(base);
				const items = list(part.groupBy.items).filter((item) => exprKey(item) !== key);
				part.groupBy = items.length > 0 ? { items: items, groupingSets: null } : null;
				settleBlocks(part, false);
			}
			return { model: target.model };
		}

		/**
		 * Суммируемое поле по выражению (поле таблицы из дерева): такое же поле выборки без агрегата
		 * получает функцию, иначе в выборку добавляется новое `ФУНКЦИЯ(выражение)` с псевдонимом по
		 * имени поля.
		 */
		function addSummedField(model, address, expr, fnId) {
			const value = text(expr).trim();
			const part = partAt(model, address);
			if (!part) {
				return fail('Часть запроса не найдена.');
			}
			if (!value) {
				return fail('Пустое выражение поля.');
			}
			const key = exprKey(value);
			const plain = part.fields.findIndex((field) => !hasAggregate(field.expr) && exprKey(field.expr) === key);
			if (plain >= 0) {
				const result = setFieldAggregate(model, address, plain, fnId || 'sum');
				return result.error ? result : Object.assign({ index: plain }, result);
			}
			if (hasAggregate(value)) {
				return fail('В выражении уже есть агрегатная функция.');
			}
			const wrapped = wrapAggregate(fnId || 'sum', value, model && model.lang);
			if (!wrapped) {
				return fail('Неизвестная функция суммируемого поля.');
			}
			const target = groupTarget(model, address);
			if (target.error) {
				return target;
			}
			return addField(model, address, wrapped);
		}

		// =========================================================================================
		// Условия
		// =========================================================================================

		/** Виды сравнения простого условия «поле · вид · параметр» и как каждый пишется в тексте. */
		const COMPARISONS = Object.freeze([
			Object.freeze({ id: '=', label: '=' }),
			Object.freeze({ id: '<>', label: '<>' }),
			Object.freeze({ id: '<', label: '<' }),
			Object.freeze({ id: '<=', label: '<=' }),
			Object.freeze({ id: '>', label: '>' }),
			Object.freeze({ id: '>=', label: '>=' }),
			Object.freeze({ id: 'in', label: 'В' }),
			Object.freeze({ id: 'inHierarchy', label: 'В иерархии' }),
			Object.freeze({ id: 'like', label: 'Подобно' }),
		]);

		const COND_FIELD = '[\\p{L}_][\\p{L}\\p{N}_]*(?:\\.[\\p{L}_][\\p{L}\\p{N}_]*)*';
		const COND_PARAM = '&([\\p{L}_][\\p{L}\\p{N}_]*)';
		const SIMPLE_CONDITION_RES = [
			{ re: new RegExp('^(' + COND_FIELD + ')\\s*(<>|<=|>=|=|<|>)\\s*' + COND_PARAM + '$', 'u'), kind: null },
			{ re: new RegExp('^(' + COND_FIELD + ')\\s+(?:В\\s+ИЕРАРХИИ|IN\\s+HIERARCHY)\\s*\\(\\s*' + COND_PARAM + '\\s*\\)$', 'iu'), kind: 'inHierarchy' },
			{ re: new RegExp('^(' + COND_FIELD + ')\\s+(?:В|IN)\\s*\\(\\s*' + COND_PARAM + '\\s*\\)$', 'iu'), kind: 'in' },
			{ re: new RegExp('^(' + COND_FIELD + ')\\s+(?:ПОДОБНО|LIKE)\\s+' + COND_PARAM + '$', 'iu'), kind: 'like' },
		];

		/** Простое условие {field, kind, param} или null (условие произвольное). */
		function simpleConditionOf(condition) {
			const value = stripParens(condition);
			for (const entry of SIMPLE_CONDITION_RES) {
				const match = entry.re.exec(value);
				if (!match) {
					continue;
				}
				if (entry.kind) {
					return LITERALS.has(upper(match[1])) || RESERVED.has(upper(match[1])) ? null : { field: match[1], kind: entry.kind, param: match[2] };
				}
				return LITERALS.has(upper(match[1])) || RESERVED.has(upper(match[1])) ? null : { field: match[1], kind: match[2], param: match[3] };
			}
			return null;
		}

		/** Текст простого условия; язык ключевых слов — языка запроса (у сборщика выражения хранятся текстом). */
		function conditionText(field, kind, param, lang) {
			const en = lang === 'en';
			const name = '&' + text(param).trim();
			const path = text(field).trim();
			if (kind === 'in') {
				return path + (en ? ' IN (' : ' В (') + name + ')';
			}
			if (kind === 'inHierarchy') {
				return path + (en ? ' IN HIERARCHY (' : ' В ИЕРАРХИИ (') + name + ')';
			}
			if (kind === 'like') {
				return path + (en ? ' LIKE ' : ' ПОДОБНО ') + name;
			}
			return path + ' ' + (LINK_OPERATORS.indexOf(kind) >= 0 ? kind : '=') + ' ' + name;
		}

		/**
		 * Имя параметра по умолчанию — имя поля (у пути разыменования — склейка сегментов, как у
		 * псевдонима поля). Занятое имя не получает суффикса: параметр схемы с тем же
		 * именем или условие по тому же полю в другой части объединения — обычный приём СКД «один параметр
		 * фильтрует несколько наборов и частей», а с суффиксом пользователь отчёта видел бы два параметра.
		 * Второй параметр для того же поля (диапазон) пользователь переименовывает сам.
		 */
		function defaultParamName(field) {
			const segments = text(field).trim().split('.');
			return segments.length > 1 ? segments.slice(1).join('') : segments[0] || 'Параметр';
		}

		/** Пометка ИМЕЮЩИЕ: условие с агрегатной функцией уходит туда само (отдельного переключателя у платформы нет). */
		const HAVING_NOTE = 'Условие с агрегатной функцией записано в ИМЕЮЩИЕ.';

		/**
		 * Строки вкладки «Условия»: элементы ГДЕ (по И верхнего уровня), затем ИМЕЮЩИЕ (с пометкой).
		 *
		 * @returns {{key, target: 'where'|'having', index, text, simple}[]}
		 */
		function conditionRows(part) {
			const rows = [];
			for (const target of ['where', 'having']) {
				const holder = part && part[target];
				list(holder && holder.conditions).forEach((condition, index) => {
					rows.push({ key: target + ':' + index, target: target, index: index, text: condition, simple: simpleConditionOf(condition) });
				});
			}
			return rows;
		}

		/** Текст условия по spec: {text} — произвольное, {field, kind, param} — простое. */
		function conditionSpecText(spec, lang) {
			const value = spec || {};
			if (typeof value.text === 'string') {
				return { text: value.text };
			}
			const field = text(value.field).trim();
			if (!PATH_RE.test(field)) {
				return fail('Поле условия: путь вида «Таблица.Поле».');
			}
			const param = text(value.param).trim();
			if (!IDENT_RE.test(param)) {
				return fail('Имя параметра: одно слово из букв, цифр и «_», с буквы.');
			}
			if (!COMPARISONS.some((item) => item.id === value.kind)) {
				return fail('Неизвестный вид сравнения.');
			}
			return { text: conditionText(field, value.kind, param, lang) };
		}

		/**
		 * Кладёт элементы условия в ГДЕ или ИМЕЮЩИЕ части (по агрегату в элементе) на место at списка
		 * (нет — в конец). Возвращает, что куда легло, и пометку ИМЕЮЩИЕ.
		 */
		function placeConditions(part, items, at) {
			const placed = [];
			let having = false;
			let whereCreated = false;
			const offsets = { where: 0, having: 0 };
			for (const item of items) {
				const target = hasAggregate(item) ? 'having' : 'where';
				if (target === 'having') {
					having = true;
				}
				if (!part[target]) {
					part[target] = { conditions: [] };
					whereCreated = whereCreated || target === 'where';
				}
				const conditions = part[target].conditions.slice();
				const base = at && at.target === target ? at.index : conditions.length;
				const index = Math.min(base + offsets[target], conditions.length);
				conditions.splice(index, 0, item);
				offsets[target] += at && at.target === target ? 1 : 0;
				part[target] = { conditions: joinedConditions(conditions) };
				placed.push({ target: target, index: index });
			}
			settleBlocks(part, whereCreated);
			return { placed: placed, warnings: having ? [HAVING_NOTE] : [] };
		}

		/**
		 * Новое условие части: простое {field, kind, param} или произвольное {text}. Условие с
		 * агрегатом — в ИМЕЮЩИЕ (с пометкой), несколько условий через И — отдельными строками.
		 *
		 * @returns {{model, placed: {target, index}[], warnings: string[]}|{error: string}}
		 */
		function addCondition(model, address, spec) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const built = conditionSpecText(spec, model && model.lang);
			if (built.error) {
				return built;
			}
			const split = splitCondition(built.text);
			if (split.error) {
				return split;
			}
			const result = placeConditions(target.part, split.conditions, null);
			return { model: target.model, placed: result.placed, warnings: result.warnings };
		}

		function conditionRef(part, ref) {
			const holder = ref && (ref.target === 'where' || ref.target === 'having') ? part[ref.target] : null;
			const conditions = list(holder && holder.conditions);
			return ref && ref.index >= 0 && ref.index < conditions.length ? conditions : null;
		}

		/** Убирает строку условия; последнее условие снимает ГДЕ (ИМЕЮЩИЕ) целиком. */
		function removeCondition(model, address, ref) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const conditions = conditionRef(target.part, ref);
			if (!conditions) {
				return fail('Условия нет.');
			}
			const next = conditions.slice();
			next.splice(ref.index, 1);
			target.part[ref.target] = next.length > 0 ? { conditions: next } : null;
			settleBlocks(target.part, false);
			return { model: target.model };
		}

		/**
		 * Новый текст строки условия (простое или произвольное). Остаётся на своём месте; агрегат
		 * появился или пропал — строка переезжает между ГДЕ и ИМЕЮЩИЕ.
		 */
		function setCondition(model, address, ref, spec) {
			const part = partAt(model, address);
			const conditions = part ? conditionRef(part, ref) : null;
			if (!conditions) {
				return fail('Условия нет.');
			}
			const built = conditionSpecText(spec, model && model.lang);
			if (built.error) {
				return built;
			}
			if (text(conditions[ref.index]).trim() === built.text.trim()) {
				return { model: model, placed: [{ target: ref.target, index: ref.index }], warnings: [] };
			}
			const split = splitCondition(built.text);
			if (split.error) {
				return split;
			}
			const target = editable(model, address);
			const next = conditions.slice();
			next.splice(ref.index, 1);
			target.part[ref.target] = next.length > 0 ? { conditions: next } : null;
			const result = placeConditions(target.part, split.conditions, { target: ref.target, index: ref.index });
			return { model: target.model, placed: result.placed, warnings: result.warnings };
		}

		// =========================================================================================
		// Общее вкладок «Дополнительно», «Индекс», «Объединения/Псевдонимы», «Порядок», «Пакет
		// запросов», «Компоновка данных»
		// =========================================================================================

		/** Копия модели и адресованный запрос выборки копии (у запросов уровня всего запроса части нет). */
		function editableStatement(model, index) {
			if (!statementAt(model, { statement: index, part: 0 })) {
				return null;
			}
			const copy = clone(model);
			return { model: copy, statement: copy.statements[index] };
		}

		/**
		 * Разбор короткого служебного текста и первая часть его первого запроса: новые элементы блоков
		 * СКД и порядка строятся так же, как источники, — тем же разборщиком, чтобы круг «правка →
		 * сборка → разбор» сходился. Диагностика — null.
		 */
		function probe(sourceText) {
			const parsed = Q.parse(sourceText);
			const statement = parsed.model.statements[0];
			if (parsed.diagnostics.length > 0 || parsed.model.statements.length !== 1 || !statement || statement.type !== 'select') {
				return null;
			}
			return statement;
		}

		function keywordAs(lang) {
			return lang === 'en' ? 'AS' : 'КАК';
		}

		/** Сдвиг элемента массива на delta позиций; выход за край — null (ничего не меняется). */
		function shift(items, index, delta) {
			const to = index + delta;
			if (!items[index] || to < 0 || to >= items.length || delta === 0) {
				return null;
			}
			const moved = items.splice(index, 1)[0];
			items.splice(to, 0, moved);
			return to;
		}

		/**
		 * Источники запроса с вложенными запросами-источниками (у них своя область алиасов, но временные
		 * таблицы пакета видны и там): fn(source) на каждый источник любой глубины.
		 */
		function eachSourceDeep(statement, fn) {
			if (!statement || statement.type === 'drop') {
				return;
			}
			for (const part of list(statement.parts)) {
				for (const entry of sourcesOf(part)) {
					fn(entry.source);
					if (entry.source.kind === 'subquery') {
						eachSourceDeep(entry.source.query, fn);
					}
				}
			}
		}

		/** Читает ли запрос временную таблицу пакета (источник с таким именем в любой части и подзапросе). */
		function readsTemp(statement, name) {
			let found = false;
			eachSourceDeep(statement, (source) => {
				if (isTempTable(source) && upper(source.table) === upper(name)) {
					found = true;
				}
			});
			return found;
		}

		// =========================================================================================
		// Дополнительно
		// =========================================================================================

		/** Тип запроса пакета: выборка, создание ВТ, добавление в ВТ (8.3.25+), уничтожение ВТ. */
		const QUERY_KINDS = Object.freeze([
			Object.freeze({ id: 'select', label: 'Выборка данных' }),
			Object.freeze({ id: 'create', label: 'Создание временной таблицы' }),
			Object.freeze({ id: 'add', label: 'Добавление во временную таблицу' }),
			Object.freeze({ id: 'drop', label: 'Уничтожение временной таблицы' }),
		]);

		/** Имя новой временной таблицы по умолчанию. */
		const DEFAULT_TEMP_NAME = 'ВременнаяТаблица';

		function statementKind(statement) {
			if (!statement) {
				return 'select';
			}
			if (statement.type === 'drop') {
				return 'drop';
			}
			const owner = list(statement.parts).find((part) => part && part.into);
			if (!owner) {
				return 'select';
			}
			return owner.into.mode === 'add' ? 'add' : 'create';
		}

		/** Имя временной таблицы запроса: создаваемой, дополняемой или уничтожаемой; иначе ''. */
		function tempTableOf(statement) {
			if (!statement) {
				return '';
			}
			if (statement.type === 'drop') {
				return text(statement.table);
			}
			const owner = list(statement.parts).find((part) => part && part.into);
			return owner ? text(owner.into.table) : '';
		}

		function checkTempName(value) {
			if (!IDENT_RE.test(value)) {
				return 'Имя временной таблицы: одно слово из букв, цифр и «_», с буквы.';
			}
			if (RESERVED.has(upper(value))) {
				return '«' + value + '» это ключевое слово языка запросов, именем таблицы быть не может.';
			}
			if (isConstantsTable(value)) {
				// Чтение такой ВТ конструктор понимал бы как общую таблицу констант (isConstantsTable)
				return '«' + value + '» это имя общей таблицы констант: выберите другое имя временной таблицы.';
			}
			return '';
		}

		/**
		 * Запросы после index, читающие временную таблицу name, пока её не создали заново или не
		 * уничтожили: им переименование и смена типа запроса не безразличны.
		 */
		function tempReaders(model, index, name) {
			const out = [];
			const statements = list(model && model.statements);
			for (let j = index + 1; j < statements.length; j++) {
				const next = statements[j];
				if (!next) {
					continue;
				}
				if (next.type === 'drop') {
					if (upper(next.table) === upper(name)) {
						break;
					}
					continue;
				}
				if (readsTemp(next, name)) {
					out.push(j);
				}
				if (statementKind(next) === 'create' && upper(tempTableOf(next)) === upper(name)) {
					break;
				}
			}
			return out;
		}

		function numbersOf(indexes) {
			return indexes.map((j) => j + 1).join(', ');
		}

		/** Индексы бывают только при первом помещении в ВТ: смена типа их снимает — с предупреждением. */
		const INDEX_DROPPED = 'Индексы временной таблицы сняты: они задаются только при её создании.';

		/**
		 * «Первые N», «Без повторяющихся» и «Разрешенные» части объединения. flags: {top?: число |
		 * null | '', distinct?, allowed?}. «Разрешенные» в объединении относятся ко всему запросу и
		 * пишутся у первой части — флажок правит первую часть.
		 *
		 * @returns {{model, warnings: string[]}|{error: string}}
		 */
		function setPartFlags(model, address, flags) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const value = flags || {};
			const part = target.part;
			let changed = false;
			if ('top' in value) {
				const raw = value.top === null || value.top === undefined ? '' : String(value.top).trim();
				if (raw !== '' && !/^[1-9]\d{0,8}$/.test(raw)) {
					return fail('«Первые»: целое число больше нуля.');
				}
				const top = raw === '' ? null : Number(raw);
				if (String(part.top === null || part.top === undefined ? '' : part.top) !== String(top === null ? '' : top)) {
					part.top = top;
					changed = true;
				}
			}
			if ('distinct' in value && Boolean(part.distinct) !== Boolean(value.distinct)) {
				part.distinct = Boolean(value.distinct);
				changed = true;
			}
			const first = target.statement.parts[0];
			if ('allowed' in value && Boolean(first.allowed) !== Boolean(value.allowed)) {
				first.allowed = Boolean(value.allowed);
				changed = true;
			}
			return { model: changed ? target.model : model, warnings: [] };
		}

		/**
		 * Тип запроса пакета. spec: {kind: select|create|add|drop, table?, restore?}. Создание и
		 * добавление пишут ПОМЕСТИТЬ / ДОБАВИТЬ в первую часть (у остальных снимают) и переносят туда же
		 * {ВЫБРАТЬ} по канону; выборка снимает их; уничтожение заменяет запрос на УНИЧТОЖИТЬ, а заменённый
		 * запрос отдаёт в stash — окно возвращает его через restore, если тип вернули до ОК (у модели
		 * негде хранить отложенный запрос: лишний ключ ломал бы сравнение «модель не менялась»). Имя
		 * таблицы по умолчанию — ВТ, с которой запрос уже работал, у добавления — последняя созданная ВТ.
		 *
		 * @returns {{model, warnings: string[], stash?: object}|{error: string}}
		 */
		function setStatementKind(model, index, spec) {
			const statements = list(model && model.statements);
			const current = statements[index];
			if (!current) {
				return fail('Запрос пакета не найден.');
			}
			const value = spec || {};
			const kind = value.kind;
			if (!QUERY_KINDS.some((item) => item.id === kind)) {
				return fail('Неизвестный тип запроса.');
			}
			const was = statementKind(current);
			const name = text(value.table).trim();
			if (was === kind) {
				return kind !== 'select' && name && name !== tempTableOf(current) ? renameTempTable(model, index, name) : { model: model, warnings: [] };
			}
			const before = Q.tempTables(model, index);
			const exists = (table) => before.some((item) => upper(item.name) === upper(table));
			const copy = clone(model);
			const warnings = [];
			const oldName = tempTableOf(current);
			if (kind === 'drop') {
				// Пакет до этого запроса таблиц не создаёт — имя по умолчанию: поле имени у выборки недоступно,
				// и без умолчания до уничтожения было бы не дойти; предупреждение ниже просит поправить имя
				const table = name || oldName || (before.length > 0 ? before[before.length - 1].name : DEFAULT_TEMP_NAME);
				const problem = checkTempName(table);
				if (problem) {
					return fail(problem);
				}
				const node = { type: 'drop', table: table };
				if (current.original) {
					node.original = clone(current.original);
				}
				copy.statements[index] = node;
				warnings.push('Запрос заменён уничтожением ВТ «' + table + '»: его поля, таблицы и условия не запишутся (до ОК их вернёт тип «Выборка данных»).');
				if (!exists(table)) {
					warnings.push('ВТ «' + table + '» раньше в пакете не создаётся: уничтожить можно только созданную таблицу (или внешнюю).');
				}
				return { model: copy, warnings: warnings, stash: clone(current) };
			}
			let statement = copy.statements[index];
			if (was === 'drop') {
				const restored = value.restore && value.restore.type === 'select' ? clone(value.restore) : emptyStatement();
				delete restored.original;
				if (current.original) {
					restored.original = clone(current.original);
				}
				copy.statements[index] = restored;
				statement = restored;
			}
			const parts = statement.parts;
			const ownName = was === 'drop' ? tempTableOf(statement) || oldName : oldName;
			if (kind === 'select') {
				let removed = false;
				for (const part of parts) {
					if (part.into) {
						part.into = null;
						removed = true;
						settleBlocks(part, false);
					}
				}
				if (list(statement.indexes).length > 0) {
					warnings.push(INDEX_DROPPED);
				}
				statement.indexes = [];
				if (removed && ownName) {
					const readers = tempReaders(copy, index, ownName);
					if (readers.length > 0) {
						warnings.push('ВТ «' + ownName + '» больше не создаётся, а её читают запросы пакета ' + numbersOf(readers) + '.');
					}
				}
				return { model: copy, warnings: warnings };
			}
			const lastTemp = before.length > 0 ? before[before.length - 1].name : '';
			const fallback = kind === 'add' ? lastTemp : '';
			const table =
				name || ownName || fallback || freeName(DEFAULT_TEMP_NAME, list(model.statements).map(tempTableOf).filter(Boolean));
			const problem = checkTempName(table);
			if (problem) {
				return fail(problem);
			}
			if (kind === 'create' && exists(table)) {
				const owner = before.find((item) => upper(item.name) === upper(table));
				return fail('ВТ «' + table + '» уже создана запросом пакета ' + (owner.statement + 1) + ': выберите другое имя или «Добавление во временную таблицу».');
			}
			for (let k = 1; k < parts.length; k++) {
				if (parts[k].into) {
					parts[k].into = null;
					settleBlocks(parts[k], false);
				}
			}
			const first = parts[0];
			const hadInto = Boolean(first.into);
			first.into = { table: table, mode: kind === 'add' ? 'add' : 'create' };
			// По канону {ВЫБРАТЬ} идёт после ПОМЕСТИТЬ
			if (!hadInto && first.dcsSelect && first.dcsSelect.placement === 'afterFields') {
				first.dcsSelect.placement = 'afterInto';
			}
			if (kind === 'add') {
				if (list(statement.indexes).length > 0) {
					warnings.push(INDEX_DROPPED);
				}
				statement.indexes = [];
				if (!exists(table)) {
					warnings.push('ВТ «' + table + '» раньше в пакете не создаётся: добавлять можно только в созданную таблицу (или внешнюю) с тем же составом колонок.');
				}
			}
			return { model: copy, warnings: warnings };
		}

		/** Переименование временной таблицы во всех источниках запроса (и подзапросах); алиас-имя сохраняет ссылки. */
		function renameTempIn(statement, from, to) {
			let hit = false;
			eachSourceDeep(statement, (source) => {
				if (isTempTable(source) && upper(source.table) === upper(from)) {
					if (!text(source.alias)) {
						// Ссылки без алиаса идут по имени таблицы: исходное имя становится алиасом
						source.alias = source.table;
					}
					source.table = to;
					hit = true;
				}
			});
			return hit;
		}

		/**
		 * Новое имя временной таблицы запроса. У создания ВТ переименовываются и обращения к ней в
		 * следующих запросах пакета (источники, ДОБАВИТЬ, УНИЧТОЖИТЬ) — до её повторного создания или
		 * уничтожения; у источника без алиаса исходное имя становится алиасом, чтобы поля не потеряли
		 * таблицу. ВТ во вложенных запросах внутри условий (текстом) не переименовываются. У добавления
		 * и уничтожения меняется только своё имя: это выбор другой таблицы; если до этого запроса пакет
		 * её не создаёт — предупреждение, как у смены типа запроса.
		 *
		 * @returns {{model, warnings: string[]}|{error: string}}
		 */
		function renameTempTable(model, index, name) {
			const statements = list(model && model.statements);
			const current = statements[index];
			const kind = statementKind(current);
			if (!current || kind === 'select') {
				return fail('Запрос не работает с временной таблицей.');
			}
			const value = text(name).trim();
			const old = tempTableOf(current);
			if (value === old) {
				return { model: model, warnings: [] };
			}
			const problem = checkTempName(value);
			if (problem) {
				return fail(problem);
			}
			const before = Q.tempTables(model, index);
			if (kind === 'create' && upper(value) !== upper(old)) {
				const owner = before.find((item) => upper(item.name) === upper(value));
				if (owner) {
					return fail('ВТ «' + value + '» уже создана запросом пакета ' + (owner.statement + 1) + '.');
				}
			}
			const copy = clone(model);
			const statement = copy.statements[index];
			// Добавление и уничтожение выбирают таблицу по имени: опечатку в нём batchWarnings не заметит
			// (таблицу, которую пакет не создаёт вовсе, он считает внешней), поэтому — то же
			// предупреждение, что у смены типа запроса
			const unknown = !before.some((item) => upper(item.name) === upper(value));
			if (kind === 'drop') {
				statement.table = value;
				return { model: copy, warnings: unknown ? ['ВТ «' + value + '» раньше в пакете не создаётся: уничтожить можно только созданную таблицу (или внешнюю).'] : [] };
			}
			statement.parts.find((part) => part.into).into.table = value;
			if (kind === 'add') {
				return {
					model: copy,
					warnings: unknown
						? ['ВТ «' + value + '» раньше в пакете не создаётся: добавлять можно только в созданную таблицу (или внешнюю) с тем же составом колонок.']
						: [],
				};
			}
			const touched = [];
			for (let j = index + 1; j < copy.statements.length; j++) {
				const next = copy.statements[j];
				if (next.type === 'drop') {
					if (upper(next.table) === upper(old)) {
						next.table = value;
						touched.push(j);
						break;
					}
					continue;
				}
				const nextKind = statementKind(next);
				let hit = renameTempIn(next, old, value);
				if (nextKind === 'add' && upper(tempTableOf(next)) === upper(old)) {
					next.parts.find((part) => part.into).into.table = value;
					hit = true;
				}
				if (hit) {
					touched.push(j);
				}
				if (nextKind === 'create' && upper(tempTableOf(next)) === upper(old)) {
					break;
				}
			}
			return {
				model: copy,
				warnings: touched.length > 0 ? ['ВТ «' + old + '» переименована и в запросах пакета ' + numbersOf(touched) + '.'] : [],
			};
		}

		/**
		 * «Блокировать получаемые данные для последующего изменения» (ДЛЯ ИЗМЕНЕНИЯ): только просмотр —
		 * в СКД смысла не имеет. null — предложения нет; tables пусто — все таблицы.
		 */
		function forUpdateOf(statement) {
			if (!statement || statement.type === 'drop') {
				return null;
			}
			const lists = [statement.forUpdate].concat(list(statement.parts).map((part) => part && part.forUpdate)).filter(Array.isArray);
			if (lists.length === 0) {
				return null;
			}
			return { tables: [].concat(...lists).map((item) => text(item).replace(/\s+/g, ' ').trim()) };
		}

		// =========================================================================================
		// Индекс
		// =========================================================================================

		/** Колонки запроса, по которым строится индекс временной таблицы (имена колонок результата). */
		function indexColumns(statement) {
			const seen = new Set();
			const out = [];
			for (const name of Q.outputFields(statement)) {
				if (name && !seen.has(upper(name))) {
					seen.add(upper(name));
					out.push(name);
				}
			}
			return out;
		}

		function indexTarget(model, index) {
			const target = editableStatement(model, index);
			if (!target) {
				return fail('Запрос пакета не найден.');
			}
			if (statementKind(target.statement) !== 'create') {
				return fail('Индексы задаются только у запроса, который создаёт временную таблицу.');
			}
			target.statement.indexes = list(target.statement.indexes);
			return target;
		}

		/**
		 * Новый индекс (без полей: сборщик его не выводит, ОК попросит поля). Один индекс — ИНДЕКСИРОВАТЬ
		 * ПО, несколько — ИНДЕКСИРОВАТЬ ПО НАБОРАМ (8.3.25+).
		 */
		function addIndex(model, index) {
			const target = indexTarget(model, index);
			if (target.error) {
				return target;
			}
			target.statement.indexes.push({ unique: false, fields: [] });
			return { model: target.model, index: target.statement.indexes.length - 1 };
		}

		function removeIndex(model, index, k) {
			const target = indexTarget(model, index);
			if (target.error) {
				return target;
			}
			if (!target.statement.indexes[k]) {
				return fail('Индекса нет.');
			}
			target.statement.indexes.splice(k, 1);
			return { model: target.model };
		}

		/** Копия индекса сразу за ним (с полями и «Уникальностью»): основа для соседнего набора ПО НАБОРАМ. */
		function copyIndex(model, index, k) {
			const target = indexTarget(model, index);
			if (target.error) {
				return target;
			}
			const item = target.statement.indexes[k];
			if (!item) {
				return fail('Индекса нет.');
			}
			target.statement.indexes.splice(k + 1, 0, clone(item));
			return { model: target.model, index: k + 1 };
		}

		/** Сдвиг индекса в списке: порядок наборов ПО НАБОРАМ — порядок списка. */
		function moveIndex(model, index, k, delta) {
			const target = indexTarget(model, index);
			if (target.error) {
				return target;
			}
			const to = shift(target.statement.indexes, k, delta);
			return to === null ? { model: model, index: k } : { model: target.model, index: to };
		}

		function setIndexUnique(model, index, k, unique) {
			const target = indexTarget(model, index);
			if (target.error) {
				return target;
			}
			const item = target.statement.indexes[k];
			if (!item) {
				return fail('Индекса нет.');
			}
			if (Boolean(item.unique) === Boolean(unique)) {
				return { model: model };
			}
			item.unique = Boolean(unique);
			return { model: target.model };
		}

		/** Поле в индекс: только колонка запроса, без повторов в одном индексе (без учёта регистра). */
		function addIndexField(model, index, k, name) {
			const target = indexTarget(model, index);
			if (target.error) {
				return target;
			}
			const item = target.statement.indexes[k];
			if (!item) {
				return fail('Индекса нет.');
			}
			const value = text(name).trim();
			const column = indexColumns(target.statement).find((column) => upper(column) === upper(value));
			if (!column) {
				return fail('Колонки «' + value + '» в запросе нет.');
			}
			item.fields = list(item.fields);
			if (item.fields.some((field) => upper(text(field).trim()) === upper(column))) {
				return fail('Поле «' + column + '» уже в индексе.');
			}
			item.fields.push(column);
			return { model: target.model, index: item.fields.length - 1 };
		}

		function removeIndexField(model, index, k, f) {
			const target = indexTarget(model, index);
			if (target.error) {
				return target;
			}
			const item = target.statement.indexes[k];
			if (!item || !list(item.fields)[f]) {
				return fail('Поля индекса нет.');
			}
			item.fields.splice(f, 1);
			return { model: target.model };
		}

		function moveIndexField(model, index, k, f, delta) {
			const target = indexTarget(model, index);
			if (target.error) {
				return target;
			}
			const item = target.statement.indexes[k];
			const to = item ? shift(list(item.fields), f, delta) : null;
			return to === null ? { model: model, index: f } : { model: target.model, index: to };
		}

		// =========================================================================================
		// Объединения/Псевдонимы
		// =========================================================================================

		function unionTarget(model, index) {
			const target = editableStatement(model, index);
			return target || fail('Запрос пакета не найден.');
		}

		function aligned(statement) {
			const count = list(statement.parts[0] && statement.parts[0].fields).length;
			return statement.parts.every((part) => list(part.fields).length === count);
		}

		/**
		 * Таблица вкладки: части объединения (флажок «Без дублей» — ОБЪЕДИНИТЬ без ВСЕ перед частью) и
		 * колонки результата — имя колонки (по первой части) и выражение каждой части; NULL — «пусто».
		 * explicit — имя задано явным КАК в первой части (платформа выделяет такие псевдонимы жирным), а
		 * не выведено из пути поля.
		 *
		 * @returns {{parts: {index, label, noDuplicates}[], columns: {index, name, explicit, cells: {part, expr, isNull}[]}[], aligned: boolean}}
		 */
		function unionRows(statement) {
			if (!statement || statement.type === 'drop') {
				return { parts: [], columns: [], aligned: true };
			}
			const parts = list(statement.parts);
			const names = columnNames(parts[0]);
			const firstFields = list(parts[0] && parts[0].fields);
			const count = Math.max(0, ...parts.map((part) => list(part && part.fields).length));
			const columns = [];
			for (let c = 0; c < count; c++) {
				const head = firstFields[c];
				columns.push({
					index: c,
					name: names[c] === undefined ? null : names[c],
					// То же условие, по которому columnName берёт псевдоним, а не хвост пути
					explicit: Boolean(head && text(head.alias)),
					cells: parts.map((part, p) => {
						const field = list(part && part.fields)[c];
						const expr = field ? text(field.expr) : null;
						return { part: p, expr: expr, isNull: expr === null || upper(expr.trim()) === 'NULL' };
					}),
				});
			}
			return {
				parts: parts.map((part, p) => ({ index: p, label: 'Запрос ' + (p + 1), noDuplicates: p > 0 && part && part.unionAll === false })),
				columns: columns,
				aligned: aligned(statement),
			};
		}

		/** Пути `Т.Поле` в УПОРЯДОЧИТЬ ПО, голова которых — алиас таблицы, а не колонка: в объединении такой порядок неверен. */
		function orderBySources(statement) {
			const columns = new Set(columnNames(statement.parts[0]).filter(Boolean).map(upper));
			const aliases = new Set(aliasesOf(statement.parts[0]).map(upper));
			return list(statement.orderBy)
				.map((item) => text(item && item.expr).trim())
				.filter((expr) => {
					if (!PATH_RE.test(expr) || expr.indexOf('.') < 0) {
						return false;
					}
					const head = upper(expr.slice(0, expr.indexOf('.')));
					return aliases.has(head) && !columns.has(head);
				});
		}

		function unionOrderWarning(statement) {
			const items = statement.parts.length > 1 ? orderBySources(statement) : [];
			return items.length > 0
				? ['В объединении порядок задаётся по колонкам результата: поправьте «' + items.join('», «') + '» на вкладке «Порядок».']
				: [];
		}

		/**
		 * Новая часть объединения (ОБЪЕДИНИТЬ ВСЕ — флажок «Без дублей» по умолчанию снят) с NULL
		 * во всех колонках: таблицы и поля ей дают «Таблицы и поля», соответствие колонкам — эта вкладка.
		 */
		function addPart(model, index) {
			const target = unionTarget(model, index);
			if (target.error) {
				return target;
			}
			const statement = target.statement;
			const part = emptyPart();
			part.unionAll = true;
			part.fields = list(statement.parts[0].fields).map(() => ({ expr: 'NULL', alias: null }));
			statement.parts.push(part);
			return { model: target.model, index: statement.parts.length - 1, warnings: unionOrderWarning(statement) };
		}

		/**
		 * Копия части объединения сразу за ней. ПОМЕСТИТЬ и {ВЫБРАТЬ} бывают только у первой части, а
		 * псевдонимы колонок задаёт она же — у копии их нет.
		 */
		function copyPart(model, index, p) {
			const target = unionTarget(model, index);
			if (target.error) {
				return target;
			}
			const statement = target.statement;
			const source = statement.parts[p];
			if (!source) {
				return fail('Части объединения нет.');
			}
			const part = clone(source);
			part.unionAll = p === 0 || source.unionAll === null || source.unionAll === undefined ? true : source.unionAll;
			part.into = null;
			part.dcsSelect = null;
			part.fields = list(part.fields).map((field) => ({ expr: text(field && field.expr), alias: null }));
			settleBlocks(part, false);
			statement.parts.splice(p + 1, 0, part);
			return { model: target.model, index: p + 1, warnings: unionOrderWarning(statement) };
		}

		/**
		 * Первая часть уступает место другой (удаление или перестановка): имена колонок остаются за
		 * позициями (явными псевдонимами новой первой части), ПОМЕСТИТЬ и {ВЫБРАТЬ} переходят к ней.
		 */
		function handOverFirst(oldFirst, newFirst) {
			const names = columnNames(oldFirst);
			list(newFirst.fields).forEach((field, k) => {
				field.alias = names[k] || null;
			});
			newFirst.into = oldFirst.into;
			if (oldFirst.dcsSelect) {
				newFirst.dcsSelect = oldFirst.dcsSelect;
			}
			oldFirst.into = null;
			oldFirst.dcsSelect = null;
		}

		function removePart(model, index, p) {
			const target = unionTarget(model, index);
			if (target.error) {
				return target;
			}
			const parts = target.statement.parts;
			if (!parts[p]) {
				return fail('Части объединения нет.');
			}
			if (parts.length < 2) {
				return fail('Часть одна: удалить можно только одну из частей объединения.');
			}
			if (p === 0) {
				handOverFirst(parts[0], parts[1]);
				parts[1].unionAll = null;
			}
			parts.splice(p, 1);
			settleBlocks(parts[0], false);
			return { model: target.model, index: Math.min(p, parts.length - 1) };
		}

		/**
		 * Перестановка частей на любое число позиций (кнопки ↑ ↓ — на одну, перенос мышью — сразу на место).
		 * Флажок «Без дублей» едет с частью; у пары с первой частью оператор между ними сохраняется, а
		 * имена колонок, ПОМЕСТИТЬ и {ВЫБРАТЬ} остаются у первой позиции. Первой становится часть, что
		 * встаёт на место 0: при уходе первой части — следующая за ней (а не та, на чьё место она ушла:
		 * при сдвиге больше чем на одну они разные), при переносе на место 0 — переносимая.
		 */
		function movePart(model, index, p, delta) {
			const target = unionTarget(model, index);
			if (target.error) {
				return target;
			}
			const parts = target.statement.parts;
			const to = p + delta;
			if (!parts[p] || to < 0 || to >= parts.length || delta === 0) {
				return { model: model, index: p };
			}
			if (p === 0 || to === 0) {
				const oldFirst = parts[0];
				const other = parts[p === 0 ? 1 : p];
				handOverFirst(oldFirst, other);
				list(oldFirst.fields).forEach((field) => {
					field.alias = null;
				});
				oldFirst.unionAll = other.unionAll === null || other.unionAll === undefined ? true : other.unionAll;
				other.unionAll = null;
			}
			shift(parts, p, delta);
			for (const part of parts) {
				settleBlocks(part, false);
			}
			return { model: target.model, index: to };
		}

		/** «Без дублей» части p > 0: ОБЪЕДИНИТЬ перед ней; снят — ОБЪЕДИНИТЬ ВСЕ. */
		function setUnionDistinct(model, index, p, noDuplicates) {
			const target = unionTarget(model, index);
			if (target.error) {
				return target;
			}
			const part = target.statement.parts[p];
			if (!part || p === 0) {
				return fail('«Без дублей» есть только у второй и следующих частей: флажок задаёт оператор перед частью.');
			}
			if ((part.unionAll === false) === Boolean(noDuplicates)) {
				return { model: model };
			}
			part.unionAll = !noDuplicates;
			return { model: target.model };
		}

		/** Имя колонки первой части становится явным: правка значений колонки не должна менять её имя. */
		function pinColumnName(first, k) {
			const field = list(first.fields)[k];
			if (field && !text(field.alias)) {
				const name = columnName(field);
				if (name) {
					field.alias = name;
				}
			}
		}

		/**
		 * Выражение части p в колонке column (выбор в ячейке таблицы соответствия): sourceColumn — колонка
		 * той же части, чьё выражение переносится (значения меняются местами — ничего не теряется), null —
		 * «пусто» (NULL). В первой части имена колонок перед этим закрепляются явным КАК:
		 * колонку называет позиция, а не выражение.
		 */
		function setUnionCell(model, index, column, p, sourceColumn) {
			const target = unionTarget(model, index);
			if (target.error) {
				return target;
			}
			const statement = target.statement;
			if (!aligned(statement)) {
				return fail('Число полей у частей объединения разное: такой запрос правится текстом.');
			}
			const part = statement.parts[p];
			const field = part ? list(part.fields)[column] : null;
			if (!field) {
				return fail('Ячейки нет.');
			}
			const first = statement.parts[0];
			if (sourceColumn === null || sourceColumn === undefined) {
				if (upper(text(field.expr).trim()) === 'NULL') {
					return { model: model };
				}
				if (p === 0) {
					pinColumnName(first, column);
				} else {
					field.alias = null;
				}
				field.expr = 'NULL';
				return { model: target.model };
			}
			if (sourceColumn === column) {
				return { model: model };
			}
			const other = list(part.fields)[sourceColumn];
			if (!other) {
				return fail('Ячейки нет.');
			}
			if (p === 0) {
				pinColumnName(first, column);
				pinColumnName(first, sourceColumn);
				const expr = field.expr;
				field.expr = other.expr;
				other.expr = expr;
			} else {
				part.fields[column] = other;
				part.fields[sourceColumn] = field;
			}
			return { model: target.model };
		}

		/**
		 * Колонка объединения целиком (кнопка над таблицей соответствия): значение уходит из каждой части,
		 * ссылки на имя колонки — из порядка, {ВЫБРАТЬ} и индексов (dropColumnReferences, с предупреждением).
		 */
		function removeColumn(model, index, column) {
			const target = unionTarget(model, index);
			if (target.error) {
				return target;
			}
			const statement = target.statement;
			if (!aligned(statement)) {
				return fail('Число полей у частей объединения разное: такой запрос правится текстом.');
			}
			if (!list(statement.parts[0].fields)[column]) {
				return fail('Колонки нет.');
			}
			const before = columnNames(statement.parts[0]);
			for (const part of statement.parts) {
				part.fields.splice(column, 1);
			}
			return { model: target.model, index: Math.min(column, statement.parts[0].fields.length - 1), warnings: dropColumnReferences(target.model, index, before) };
		}

		/** Сдвиг колонки объединения во всех частях сразу (значения частей едут вместе с именем колонки). */
		function moveColumn(model, index, column, delta) {
			const statement = statementAt(model, { statement: index, part: 0 });
			if (!statement) {
				return fail('Запрос пакета не найден.');
			}
			if (!aligned(statement)) {
				return fail('Число полей у частей объединения разное: такой запрос правится текстом.');
			}
			return moveField(model, { statement: index, part: 0 }, column, delta);
		}

		/** Голова пути (или весь идентификатор) from → to: имена колонок в порядке, {ВЫБРАТЬ} и индексах. */
		function renameHead(value, from, to) {
			const source = text(value);
			const trimmed = source.trim();
			if (!PATH_RE.test(trimmed)) {
				return source;
			}
			const dot = trimmed.indexOf('.');
			const head = dot < 0 ? trimmed : trimmed.slice(0, dot);
			if (upper(head) !== upper(from)) {
				return source;
			}
			return to + (dot < 0 ? '' : trimmed.slice(dot));
		}

		/**
		 * Псевдоним колонки (правка «Имя поля»): явный КАК у первой части. Ссылки на колонку по имени
		 * — УПОРЯДОЧИТЬ ПО, {ВЫБРАТЬ}, ИНДЕКСИРОВАТЬ ПО — переименовываются вместе с ней; в порядке
		 * запроса из одной части голова пути, совпавшая с алиасом таблицы, — таблица, её не трогаем.
		 *
		 * @returns {{model, warnings: string[]}|{error: string}}
		 */
		function renameColumn(model, index, column, name) {
			const target = unionTarget(model, index);
			if (target.error) {
				return target;
			}
			const statement = target.statement;
			const first = statement.parts[0];
			const field = list(first.fields)[column];
			if (!field) {
				return fail('Колонки нет.');
			}
			const value = text(name).trim();
			const problem = ensureAlias(value, [], '');
			if (problem) {
				return fail(problem.replace('Псевдоним', 'Имя поля'));
			}
			const names = columnNames(first);
			if (names.some((other, k) => k !== column && other && upper(other) === upper(value))) {
				return fail('Поле «' + value + '» уже есть в запросе.');
			}
			const old = names[column];
			if (text(field.alias) === value || old === value) {
				return { model: model, warnings: [] };
			}
			field.alias = value;
			const warnings = [];
			if (old && old !== value) {
				renameColumnReferences(statement, old, value);
				if (statementKind(statement) === 'create') {
					const readers = tempReaders(target.model, index, tempTableOf(statement));
					if (readers.length > 0) {
						warnings.push(
							'Колонка ВТ «' + tempTableOf(statement) + '» переименована: запросы пакета ' + numbersOf(readers) + ' обращаются к ней по прежнему имени «' + old + '». Поправьте их.'
						);
					}
				}
			}
			return { model: target.model, warnings: warnings };
		}

		// =========================================================================================
		// Порядок
		// =========================================================================================

		/** Направления сортировки: возрастание (ВОЗР не пишется), убывание и по иерархии (ИЕРАРХИЯ [УБЫВ]). */
		const ORDER_DIRECTIONS = Object.freeze([
			Object.freeze({ id: 'asc', label: 'Возрастание' }),
			Object.freeze({ id: 'desc', label: 'Убывание' }),
			Object.freeze({ id: 'hierarchy', label: 'Иерархия (возрастание)' }),
			Object.freeze({ id: 'hierarchyDesc', label: 'Иерархия (убывание)' }),
		]);

		function directionOf(item) {
			const desc = item && item.dir === 'desc';
			if (item && item.hierarchy) {
				return desc ? 'hierarchyDesc' : 'hierarchy';
			}
			return desc ? 'desc' : 'asc';
		}

		/** Строки «Порядка»: выражение и направление. */
		function orderRows(statement) {
			if (!statement || statement.type === 'drop') {
				return [];
			}
			return list(statement.orderBy).map((item, index) => ({ index: index, expr: text(item && item.expr), direction: directionOf(item) }));
		}

		function orderTarget(model, index) {
			return editableStatement(model, index) || fail('Запрос пакета не найден.');
		}

		/**
		 * Новый элемент порядка: выражение (имя колонки или `Алиас.Поле` таблицы части) и направление.
		 * Узел — разбором короткого текста, как у источников; повтор выражения — отказ.
		 */
		function addOrder(model, index, expr, direction) {
			const target = orderTarget(model, index);
			if (target.error) {
				return target;
			}
			const value = text(expr).trim();
			if (!value) {
				return fail('Пустое поле порядка.');
			}
			const statement = target.statement;
			if (list(statement.orderBy).some((item) => exprKey(item && item.expr) === exprKey(value))) {
				return fail('«' + value + '» уже в порядке.');
			}
			const mode = ORDER_DIRECTIONS.some((item) => item.id === direction) ? direction : 'asc';
			const suffix = (mode === 'hierarchy' || mode === 'hierarchyDesc' ? ' ИЕРАРХИЯ' : '') + (mode === 'desc' || mode === 'hierarchyDesc' ? ' УБЫВ' : '');
			const parsed = probe('ВЫБРАТЬ 1 КАК Поле1\nУПОРЯДОЧИТЬ ПО\n\t' + value + suffix);
			const node = parsed && list(parsed.orderBy).length === 1 ? parsed.orderBy[0] : null;
			if (!node || text(node.expr) !== value) {
				return fail('Поле порядка не разобрано: «' + value + '».');
			}
			statement.orderBy = list(statement.orderBy).concat([node]);
			return { model: target.model, index: statement.orderBy.length - 1 };
		}

		function removeOrder(model, index, k) {
			const target = orderTarget(model, index);
			if (target.error) {
				return target;
			}
			const items = list(target.statement.orderBy);
			if (!items[k]) {
				return fail('Поля порядка нет.');
			}
			items.splice(k, 1);
			target.statement.orderBy = items.length > 0 ? items : null;
			return { model: target.model };
		}

		function moveOrder(model, index, k, delta) {
			const target = orderTarget(model, index);
			if (target.error) {
				return target;
			}
			const to = shift(list(target.statement.orderBy), k, delta);
			return to === null ? { model: model, index: k } : { model: target.model, index: to };
		}

		function setOrderDirection(model, index, k, direction) {
			const target = orderTarget(model, index);
			if (target.error) {
				return target;
			}
			const item = list(target.statement.orderBy)[k];
			if (!item) {
				return fail('Поля порядка нет.');
			}
			if (!ORDER_DIRECTIONS.some((entry) => entry.id === direction)) {
				return fail('Неизвестное направление сортировки.');
			}
			if (directionOf(item) === direction) {
				return { model: model };
			}
			item.dir = direction === 'desc' || direction === 'hierarchyDesc' ? 'desc' : 'asc';
			item.hierarchy = direction === 'hierarchy' || direction === 'hierarchyDesc';
			return { model: target.model };
		}

		/** «Автоупорядочивание» (АВТОУПОРЯДОЧИВАНИЕ): в СКД почти бесполезно, но платформа его пишет. */
		function setAutoOrder(model, index, on) {
			const target = orderTarget(model, index);
			if (target.error) {
				return target;
			}
			if (Boolean(target.statement.autoOrder) === Boolean(on)) {
				return { model: model };
			}
			target.statement.autoOrder = Boolean(on);
			return { model: target.model };
		}

		// =========================================================================================
		// Пакет запросов
		// =========================================================================================

		/** Запрос, чьи колонки станут полями набора: последний запрос выборки без ПОМЕСТИТЬ/ДОБАВИТЬ; нет — -1. */
		function dataSetStatementIndex(model) {
			const statements = list(model && model.statements);
			for (let i = statements.length - 1; i >= 0; i--) {
				if (statements[i] && statements[i].type !== 'drop' && statementKind(statements[i]) === 'select') {
					return i;
				}
			}
			return -1;
		}

		const KIND_NOTES = { select: 'выборка', create: 'создание ВТ', add: 'добавление в ВТ', drop: 'уничтожение ВТ' };

		/**
		 * Строки списка «Пакет запросов»: подпись — та же, что у вертикальной вкладки запроса справа
		 * (statementTabLabel: имя создаваемой ВТ, «Добавление в имя», «Уничтожение имя» или «Запрос пакета N»),
		 * чтобы один запрос не назывался на одном экране по-разному; вид запроса и пометка запроса, дающего
		 * поля набора.
		 *
		 * @returns {{index, label, kind, table, note, dataSet: boolean}[]}
		 */
		function batchRows(model) {
			const ds = dataSetStatementIndex(model);
			return list(model && model.statements).map((statement, index) => {
				const kind = statementKind(statement);
				const table = tempTableOf(statement);
				return { index: index, label: statementTabLabel(statement, index), kind: kind, table: table, note: KIND_NOTES[kind], dataSet: index === ds };
			});
		}

		/** Новый пустой запрос выборки сразу за after (нет — в конец); поля ему дают остальные вкладки. */
		function addStatement(model, after) {
			const copy = clone(model);
			copy.statements = list(copy.statements);
			const at = typeof after === 'number' && after >= 0 && after < copy.statements.length ? after + 1 : copy.statements.length;
			copy.statements.splice(at, 0, emptyStatement());
			return { model: copy, index: at };
		}

		/**
		 * Копия запроса пакета сразу за ним. Копия создания ВТ получает свободное имя: два создания
		 * одной таблицы в пакете — ошибка платформы.
		 */
		function copyStatement(model, index) {
			const statements = list(model && model.statements);
			const source = statements[index];
			if (!source) {
				return fail('Запрос пакета не найден.');
			}
			const copy = clone(model);
			const dup = clone(source);
			delete dup.original;
			const warnings = [];
			const kind = statementKind(dup);
			if (kind === 'create') {
				const name = freeName(tempTableOf(dup), statements.map(tempTableOf).filter(Boolean));
				dup.parts.find((part) => part.into).into.table = name;
				warnings.push('Копия создаёт ВТ «' + name + '»: одну таблицу дважды в пакете не создают.');
			} else if (kind === 'drop') {
				warnings.push('Копия снова уничтожает ВТ «' + dup.table + '»: поправьте имя или тип запроса на вкладке «Дополнительно».');
			}
			copy.statements.splice(index + 1, 0, dup);
			return { model: copy, index: index + 1, warnings: warnings };
		}

		/** Удаление запроса пакета (последний не удаляется); создававший ВТ, которую читают дальше, — с предупреждением. */
		function removeStatement(model, index) {
			const statements = list(model && model.statements);
			if (!statements[index]) {
				return fail('Запрос пакета не найден.');
			}
			if (statements.length < 2) {
				return fail('В пакете один запрос, удалять нечего.');
			}
			const removed = statements[index];
			const warnings = [];
			if (statementKind(removed) === 'create') {
				const readers = tempReaders(model, index, tempTableOf(removed));
				if (readers.length > 0) {
					warnings.push(
						'Удалён запрос, создававший ВТ «' + tempTableOf(removed) + '», а её читают запросы пакета ' + readers.map((j) => j).join(', ') + ' (номера после удаления).'
					);
				}
			}
			const copy = clone(model);
			copy.statements.splice(index, 1);
			return { model: copy, index: Math.min(index, copy.statements.length - 1), warnings: warnings };
		}

		/**
		 * Колонки ДОБАВИТЬ против колонок создания ВТ: '' — составы совпадают или сравнить нельзя, иначе
		 * пояснение для предупреждения. Имена сравниваются без учёта регистра и порядка. Если у колонки
		 * нет имени (выражение без псевдонима), по именам судить нельзя — сравнивается только число колонок.
		 */
		function addColumnsMismatch(created, added) {
			const before = Q.outputFields(created);
			const after = Q.outputFields(added);
			if (before.indexOf(null) >= 0 || after.indexOf(null) >= 0) {
				return before.length === after.length ? '' : 'колонок ' + after.length + ', а при создании ' + before.length;
			}
			// Разность мультимножеств: одинаковые имена гасят друг друга по одному
			const rest = after.map(upper);
			const missing = [];
			for (const name of before) {
				const at = rest.indexOf(upper(name));
				if (at >= 0) {
					rest[at] = null;
				} else {
					missing.push(name);
				}
			}
			const extra = after.filter((_name, k) => rest[k] !== null);
			const parts = [];
			if (missing.length > 0) {
				parts.push('нет ' + missing.map((name) => '«' + name + '»').join(', '));
			}
			if (extra.length > 0) {
				parts.push('лишние ' + extra.map((name) => '«' + name + '»').join(', '));
			}
			return parts.join('; ');
		}

		/**
		 * Нарушенные зависимости временных таблиц пакета: чтение, уничтожение или добавление раньше
		 * создания, повторное создание без уничтожения, добавление с другим составом колонок, чем у
		 * создания, нет запроса выборки для полей набора. ВТ, которую пакет не создаёт вовсе, может быть
		 * внешней — о ней молчим.
		 */
		function batchWarnings(model) {
			const statements = list(model && model.statements);
			const out = [];
			const createdAt = (name, from) => {
				for (let k = from; k < statements.length; k++) {
					if (statementKind(statements[k]) === 'create' && upper(tempTableOf(statements[k])) === upper(name)) {
						return k;
					}
				}
				return -1;
			};
			// Созданные к запросу j таблицы — только ПОМЕСТИТЬ (минус УНИЧТОЖИТЬ): tempTables модели считает
			// созданием и ДОБАВИТЬ в неизвестную таблицу, и одна ошибка порядка дала бы два предупреждения.
			// Значение — номер создавшего запроса: с ним ДОБАВИТЬ сверяет состав колонок
			const known = new Map();
			statements.forEach((statement, j) => {
				const kind = statementKind(statement);
				const own = tempTableOf(statement);
				const late = (name) => !known.has(upper(name)) && createdAt(name, j + 1) >= 0;
				const reads = new Set();
				eachSourceDeep(statement, (source) => {
					if (isTempTable(source)) {
						reads.add(source.table);
					}
				});
				for (const name of reads) {
					if (late(name)) {
						out.push('Запрос пакета ' + (j + 1) + ' читает ВТ «' + name + '», которая создаётся позже (запрос пакета ' + (createdAt(name, j + 1) + 1) + ').');
					}
				}
				if (kind === 'create' && known.has(upper(own))) {
					out.push('Запрос пакета ' + (j + 1) + ' создаёт ВТ «' + own + '» повторно: до этого её не уничтожили.');
				}
				if ((kind === 'drop' || kind === 'add') && late(own)) {
					out.push('Запрос пакета ' + (j + 1) + (kind === 'drop' ? ' уничтожает' : ' дополняет') + ' ВТ «' + own + '» раньше, чем она создаётся.');
				}
				if (kind === 'add' && known.has(upper(own))) {
					// Строки добавления ложатся в колонки созданной таблицы: другой состав — ошибка запроса
					const creator = known.get(upper(own));
					const mismatch = addColumnsMismatch(statements[creator], statement);
					if (mismatch) {
						out.push(
							'Запрос пакета ' + (j + 1) + ' добавляет в ВТ «' + own + '» другой состав колонок, чем у её создания (запрос пакета ' + (creator + 1) + '): ' + mismatch + '.'
						);
					}
				}
				if (kind === 'create') {
					known.set(upper(own), j);
				} else if (kind === 'drop') {
					known.delete(upper(own));
				}
			});
			if (statements.length > 0 && dataSetStatementIndex(model) < 0) {
				out.push('В пакете нет запроса выборки без ПОМЕСТИТЬ: у набора данных не будет полей.');
			}
			return out;
		}

		/** Перестановка запросов пакета; нарушенные зависимости ВТ — предупреждениями (порядок — выбор пользователя). */
		function moveStatement(model, index, delta) {
			const statements = list(model && model.statements);
			const to = index + delta;
			if (!statements[index] || to < 0 || to >= statements.length || delta === 0) {
				return { model: model, index: index, warnings: [] };
			}
			const copy = clone(model);
			shift(copy.statements, index, delta);
			return { model: copy, index: to, warnings: batchWarnings(copy) };
		}

		// =========================================================================================
		// Компоновка данных → Таблицы: необязательные соединения и номер группы
		// =========================================================================================

		/**
		 * Номера групп необязательных соединений так, как их даст разбор собранного текста: подряд по
		 * месту открывающей «{», соседние соединения одного уровня с одним номером — одна группа (одни
		 * скобки). Иначе круг «правка → сборка → разбор» давал бы другие номера.
		 */
		function normalizeGroups(part) {
			let counter = 0;
			const walk = (joins) => {
				let k = 0;
				while (k < joins.length) {
					const group = joins[k].optionalGroup;
					if (group === null || group === undefined) {
						walk(list(joins[k].joins));
						k++;
						continue;
					}
					const no = ++counter;
					let j = k;
					while (j < joins.length && joins[j].optionalGroup === group) {
						joins[j].optionalGroup = no;
						walk(list(joins[j].joins));
						j++;
					}
					k = j;
				}
			};
			for (const entry of list(part && part.from)) {
				walk(list(entry && entry.joins));
			}
		}

		/**
		 * Строки подвкладки «Таблицы»: источники части; соединение — с флажком «Обязательная» и номером
		 * группы, строка ИЗ — всегда обязательная (необязательным бывает только соединение).
		 *
		 * @returns {{key, alias, label, path: number[], depth, join: boolean, optional: boolean, group: number|null, virtual: boolean, kind}[]}
		 */
		function compositionTables(part) {
			return sourcesOf(part).map((entry, index) => {
				const join = entry.join;
				const group = join && join.optionalGroup !== null && join.optionalGroup !== undefined ? join.optionalGroup : null;
				return {
					key: entry.alias ? 's:' + upper(entry.alias) : 's#' + index,
					alias: entry.alias,
					label: sourceLabel(entry.source),
					path: entry.path,
					depth: entry.depth,
					join: Boolean(join),
					kind: join ? join.kind : null,
					optional: group !== null,
					group: group,
					virtual: entry.source.kind === 'table' && Boolean(entry.source.virtualTable || Array.isArray(entry.source.params)),
				};
			});
		}

		function joinTarget(model, address, path) {
			const target = editable(model, address);
			if (!target) {
				return fail('Часть запроса не найдена.');
			}
			const join = Array.isArray(path) && path.length >= 2 ? nodeAt(target.part, path) : null;
			if (!join) {
				return fail('Необязательным бывает только соединение: строка ИЗ обязательна всегда.');
			}
			return { model: target.model, part: target.part, join: join };
		}

		/**
		 * «Обязательная» у соединения: снятый флажок — фигурные скобки вокруг соединения (СКД выкинет
		 * его, когда поля таблицы не нужны), со своим номером группы.
		 */
		function setJoinRequired(model, address, path, required) {
			const target = joinTarget(model, address, path);
			if (target.error) {
				return target;
			}
			const optional = target.join.optionalGroup !== null && target.join.optionalGroup !== undefined;
			if (optional === !required) {
				return { model: model };
			}
			if (required) {
				target.join.optionalGroup = null;
			} else {
				let max = 0;
				const walk = (joins) => {
					for (const join of list(joins)) {
						max = Math.max(max, join.optionalGroup || 0);
						walk(join.joins);
					}
				};
				for (const entry of target.part.from) {
					walk(entry.joins);
				}
				target.join.optionalGroup = max + 1;
			}
			normalizeGroups(target.part);
			return { model: target.model };
		}

		/**
		 * Номер группы необязательного соединения: соседние необязательные соединения одного уровня с
		 * одним номером идут в одних скобках и выпадают вместе. Номера после правки идут
		 * подряд, как их прочитает разбор; номер, общий с несоседним соединением, скобок не объединяет —
		 * с предупреждением.
		 */
		function setJoinGroup(model, address, path, group) {
			const target = joinTarget(model, address, path);
			if (target.error) {
				return target;
			}
			if (target.join.optionalGroup === null || target.join.optionalGroup === undefined) {
				return fail('Номер группы есть только у необязательного соединения: снимите флажок «Обязательная».');
			}
			const raw = String(group === null || group === undefined ? '' : group).trim();
			if (!/^[1-9]\d{0,3}$/.test(raw)) {
				return fail('Номер группы: целое число больше нуля.');
			}
			const value = Number(raw);
			if (target.join.optionalGroup === value) {
				return { model: model, warnings: [] };
			}
			const mates = [];
			const walk = (joins) => {
				for (const join of list(joins)) {
					if (join !== target.join && join.optionalGroup === value) {
						mates.push(join);
					}
					walk(join.joins);
				}
			};
			for (const entry of target.part.from) {
				walk(entry.joins);
			}
			target.join.optionalGroup = value;
			normalizeGroups(target.part);
			const apart = mates.length > 0 && mates.every((join) => join.optionalGroup !== target.join.optionalGroup);
			return {
				model: target.model,
				warnings: apart ? ['Общие скобки бывают только у соседних необязательных соединений одного уровня: у этого соединения своя группа.'] : [],
			};
		}

		// ---------- параметры виртуальной таблицы для СКД ----------

		/** Деление по запятым верхнего уровня (скобки, блоки {…}, строки и комментарии — целиком). */
		function splitTopLevel(value) {
			const source = text(value);
			const out = [];
			let depth = 0;
			let start = 0;
			for (let i = 0; i < source.length; i++) {
				const ch = source[i];
				if (ch === '"') {
					i++;
					while (i < source.length && !(source[i] === '"' && source[i + 1] !== '"')) {
						i += source[i] === '"' ? 2 : 1;
					}
					continue;
				}
				if (ch === '/' && source[i + 1] === '/') {
					const eol = source.indexOf('\n', i);
					i = eol < 0 ? source.length : eol;
					continue;
				}
				if (ch === '(' || ch === '{') {
					depth++;
				} else if (ch === ')' || ch === '}') {
					depth--;
				} else if (ch === ',' && depth === 0) {
					out.push(source.slice(start, i).trim());
					start = i + 1;
				}
			}
			const last = source.slice(start).trim();
			if (last || out.length > 0) {
				out.push(last);
			}
			return out.filter((item) => item !== '');
		}

		const VT_FILTER_RE = /^\(\s*([\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*)\s*\)\s*(\.\s*\*)?(?:\s+(?:КАК|AS)\s+([\p{L}_][\p{L}\p{N}_]*))?$/iu;
		const VT_PARAM_RE = /^(\(\s*)?&([\p{L}_][\p{L}\p{N}_]*)(\s*\))?$/u;

		/**
		 * Параметр ВТ по позиции → значение и блок СКД (модель params[].dcs): {base, block},
		 * block — текст внутри {…} или null. «Целиком в {…}» — base пуст, «база + блок» — оба.
		 */
		function vtParamParts(param) {
			const value = param || {};
			if (value.dcs && typeof value.dcs === 'object') {
				const whole = value.dcs.kind === 'whole' || (value.dcs.kind !== 'tail' && !text(value.text));
				return { base: whole ? '' : text(value.text).trim(), block: text(value.dcs.text) };
			}
			return { base: text(value.text).trim(), block: null };
		}

		/**
		 * Элементы блока СКД параметра: поля-отборы `(Поле).* КАК Х` (filter), параметр `(&П)` или `&П`
		 * (param), прочее текстом (other) — условия `(Поле = &П)` и т. п.
		 */
		function vtBlockItems(block) {
			return splitTopLevel(block).map((item) => {
				const filter = VT_FILTER_RE.exec(item);
				if (filter) {
					return { kind: 'filter', field: filter[1], star: Boolean(filter[2]), alias: filter[3] || null };
				}
				const param = VT_PARAM_RE.exec(item);
				if (param && Boolean(param[1]) === Boolean(param[3])) {
					return { kind: 'param', name: param[2], parens: Boolean(param[1]) };
				}
				return { kind: 'other', text: item };
			});
		}

		function vtItemText(item, lang) {
			if (item.kind === 'filter') {
				return '(' + item.field + ')' + (item.star ? '.*' : '') + (text(item.alias) ? ' ' + keywordAs(lang) + ' ' + item.alias : '');
			}
			if (item.kind === 'param') {
				return item.parens ? '(&' + item.name + ')' : '&' + item.name;
			}
			return text(item.text);
		}

		/** Текст блока по элементам (через «, »). */
		function vtBlockText(items, lang) {
			return list(items)
				.map((item) => vtItemText(item, lang))
				.filter((value) => value !== '')
				.join(', ');
		}

		/** Текст параметра ВТ по значению и блоку: пустой блок — без скобок, пустое значение — «целиком в {…}». */
		function vtParamText(base, block) {
			const own = text(base).trim();
			const inner = block === null || block === undefined ? '' : text(block).trim();
			if (!inner) {
				return own;
			}
			return own ? own + ' {' + inner + '}' : '{' + inner + '}';
		}

		/**
		 * «Необязательный параметр» (`{(&П)}`): доступен, когда позиция — один параметр.
		 * @returns {{available: boolean, optional: boolean, name: string}}
		 */
		function vtOptionalState(base, block) {
			const own = text(base).trim();
			const inner = block === null || block === undefined ? '' : text(block).trim();
			const single = (value) => {
				const match = VT_PARAM_RE.exec(value);
				return match && Boolean(match[1]) === Boolean(match[3]) ? match[2] : '';
			};
			if (!inner && single(own)) {
				return { available: true, optional: false, name: single(own) };
			}
			if (!own && single(inner)) {
				return { available: true, optional: true, name: single(inner) };
			}
			return { available: false, optional: false, name: '' };
		}

		/** Переключение «необязательный»: `&П` ↔ `{(&П)}`. Недоступно — значения как были. */
		function vtSetOptional(base, block, on) {
			const state = vtOptionalState(base, block);
			if (!state.available || state.optional === Boolean(on)) {
				return { base: text(base).trim(), block: block === undefined ? null : block };
			}
			return on ? { base: '', block: '(&' + state.name + ')' } : { base: '&' + state.name, block: null };
		}

		/** Замена имени параметра `&from` → `&to` (без учёта регистра; строки и комментарии не трогаются). */
		function renameParamText(value, from, to) {
			const source = text(value);
			const want = upper(from);
			let out = '';
			let i = 0;
			while (i < source.length) {
				const ch = source[i];
				if (ch === '"') {
					let j = i + 1;
					while (j < source.length && !(source[j] === '"' && source[j + 1] !== '"')) {
						j += source[j] === '"' ? 2 : 1;
					}
					out += source.slice(i, j + 1);
					i = j + 1;
					continue;
				}
				if (ch === '/' && source[i + 1] === '/') {
					const eol = source.indexOf('\n', i);
					const end = eol < 0 ? source.length : eol;
					out += source.slice(i, end);
					i = end;
					continue;
				}
				if (ch === '&') {
					const match = /^&([\p{L}_][\p{L}\p{N}_]*)/u.exec(source.slice(i));
					if (match) {
						out += upper(match[1]) === want ? '&' + to : match[0];
						i += match[0].length;
						continue;
					}
				}
				out += ch;
				i++;
			}
			return out;
		}

		// =========================================================================================
		// Компоновка данных → Поля ({ВЫБРАТЬ}) и Условия ({ГДЕ})
		// =========================================================================================

		/** Блок без отметок разрыва: правленый блок выводится одним (разбор слитых блоков их и не даст). */
		function mergedBlock(block) {
			if (block && Object.prototype.hasOwnProperty.call(block, 'breaks')) {
				delete block.breaks;
			}
			return block;
		}

		/**
		 * Строки «Полей» — элементы {ВЫБРАТЬ} первой части (псевдонимы выборки, «Использовать дочерние»
		 * = .*); элемент не путём — текстом, только просмотр.
		 */
		function dcsSelectRows(statement) {
			if (!statement || statement.type === 'drop') {
				return [];
			}
			const block = statement.parts[0] && statement.parts[0].dcsSelect;
			return list(block && block.items).map((item, index) => ({
				index: index,
				path: item && typeof item.path === 'string' ? item.path : null,
				star: Boolean(item && item.star),
				alias: item && text(item.alias) ? item.alias : null,
				text: item && typeof item.path === 'string' ? null : text(item && item.text),
			}));
		}

		/** Колонки запроса, которых ещё нет в {ВЫБРАТЬ} (по голове пути, без учёта регистра). */
		function dcsSelectAvailable(statement) {
			const taken = new Set(dcsSelectRows(statement).filter((row) => row.path).map((row) => upper(row.path.split('.')[0])));
			return indexColumns(statement).filter((name) => !taken.has(upper(name)));
		}

		function dcsSelectNode(path, star, alias, lang) {
			const itemText = path + (star ? '.*' : '') + (text(alias) ? ' ' + keywordAs(lang) + ' ' + alias : '');
			const parsed = probe('ВЫБРАТЬ 1 КАК Поле1\n{ВЫБРАТЬ\n\t' + itemText + '}');
			const block = parsed && parsed.parts[0].dcsSelect;
			return block && block.items.length === 1 && block.items[0].path === path ? block.items[0] : null;
		}

		function dcsSelectTarget(model, index) {
			const target = editableStatement(model, index);
			if (!target) {
				return fail('Запрос пакета не найден.');
			}
			target.part = target.statement.parts[0];
			return target;
		}

		/**
		 * Колонка в {ВЫБРАТЬ} (только первая часть объединения). Новый блок встаёт по канону:
		 * после ПОМЕСТИТЬ, иначе после списка выборки.
		 */
		function addDcsSelect(model, index, path) {
			const target = dcsSelectTarget(model, index);
			if (target.error) {
				return target;
			}
			const value = text(path).trim();
			if (!PATH_RE.test(value)) {
				return fail('Поле {ВЫБРАТЬ}: псевдоним поля выборки.');
			}
			const part = target.part;
			const items = list(part.dcsSelect && part.dcsSelect.items);
			if (items.some((item) => item && typeof item.path === 'string' && upper(item.path) === upper(value))) {
				return fail('«' + value + '» уже в списке полей.');
			}
			const node = dcsSelectNode(value, false, null, model && model.lang);
			if (!node) {
				return fail('Поле {ВЫБРАТЬ} не разобрано: «' + value + '».');
			}
			if (part.dcsSelect) {
				mergedBlock(part.dcsSelect).items = items.concat([node]);
			} else {
				part.dcsSelect = { placement: part.into ? 'afterInto' : 'afterFields', items: [node] };
			}
			return { model: target.model, index: part.dcsSelect.items.length - 1 };
		}

		/** «>>»: все колонки, которых в блоке ещё нет. */
		function addAllDcsSelect(model, index) {
			const statement = statementAt(model, { statement: index, part: 0 });
			if (!statement) {
				return fail('Запрос пакета не найден.');
			}
			let current = model;
			for (const name of dcsSelectAvailable(statement)) {
				const result = addDcsSelect(current, index, name);
				if (!result.error) {
					current = result.model;
				}
			}
			return { model: current };
		}

		function removeDcsSelect(model, index, k) {
			const target = dcsSelectTarget(model, index);
			if (target.error) {
				return target;
			}
			const block = target.part.dcsSelect;
			if (!block || !list(block.items)[k]) {
				return fail('Поля нет.');
			}
			block.items.splice(k, 1);
			target.part.dcsSelect = block.items.length > 0 ? mergedBlock(block) : null;
			return { model: target.model };
		}

		function removeAllDcsSelect(model, index) {
			const target = dcsSelectTarget(model, index);
			if (target.error) {
				return target;
			}
			if (!target.part.dcsSelect) {
				return { model: model };
			}
			target.part.dcsSelect = null;
			return { model: target.model };
		}

		/** «Использовать дочерние» (.*) и псевдоним элемента {ВЫБРАТЬ}; пустой псевдоним — без КАК. */
		function setDcsSelect(model, index, k, spec) {
			const target = dcsSelectTarget(model, index);
			if (target.error) {
				return target;
			}
			const block = target.part.dcsSelect;
			const item = block ? list(block.items)[k] : null;
			if (!item || typeof item.path !== 'string') {
				return fail('Поле правится текстом: оно не путь.');
			}
			const value = spec || {};
			const star = 'star' in value ? Boolean(value.star) : Boolean(item.star);
			const alias = 'alias' in value ? text(value.alias).trim() : text(item.alias);
			if (alias) {
				const problem = ensureAlias(alias, [], '');
				if (problem) {
					return fail(problem);
				}
			}
			if (star === Boolean(item.star) && alias === text(item.alias)) {
				return { model: model };
			}
			const node = dcsSelectNode(item.path, star, alias || null, model && model.lang);
			if (!node) {
				return fail('Поле {ВЫБРАТЬ} не разобрано.');
			}
			block.items[k] = node;
			return { model: target.model };
		}

		function moveDcsSelect(model, index, k, delta) {
			const target = dcsSelectTarget(model, index);
			if (target.error) {
				return target;
			}
			const block = target.part.dcsSelect;
			const to = block ? shift(list(block.items), k, delta) : null;
			if (to === null) {
				return { model: model, index: k };
			}
			mergedBlock(block);
			return { model: target.model, index: to };
		}

		/**
		 * Строки «Условий» — элементы {ГДЕ} части: поле таблицы («Использовать дочерние» =
		 * .*, псевдоним) или условие (в скобках, обычно с параметром — необязательное).
		 */
		function dcsWhereRows(part) {
			const block = part && part.dcsWhere;
			return list(block && block.items).map((item, index) => {
				const condition = !item || item.kind === 'condition' || typeof item.path !== 'string';
				return {
					index: index,
					kind: condition ? 'condition' : 'field',
					path: condition ? null : item.path,
					star: !condition && (item.kind === 'fieldStar' || Boolean(item.star)),
					alias: item && text(item.alias) ? item.alias : null,
					text: condition ? text(item && item.text) : null,
					parens: Boolean(item && item.parens),
				};
			});
		}

		/** Узел элемента {ГДЕ} разбором короткого текста; null — текст не стал ровно одним элементом нужного вида. */
		function dcsWhereNode(itemText, kind) {
			const parsed = probe('ВЫБРАТЬ 1 КАК Поле1\nИЗ\n\tТ КАК Т\n{ГДЕ\n\t' + itemText + '}');
			const block = parsed && parsed.parts[0].dcsWhere;
			const item = block && block.items.length === 1 ? block.items[0] : null;
			if (!item || list(parsed.parts[0].raw).length > 0) {
				return null;
			}
			return (kind === 'condition') === (item.kind === 'condition') ? item : null;
		}

		function dcsWhereTarget(model, address) {
			const target = editable(model, address);
			return target || fail('Часть запроса не найдена.');
		}

		/** Новый блок {ГДЕ}: после ГДЕ, иначе после ИЗ (по канону; место схеме не важно). */
		function putDcsWhere(part, node) {
			if (part.dcsWhere) {
				mergedBlock(part.dcsWhere).items = list(part.dcsWhere.items).concat([node]);
			} else {
				part.dcsWhere = { placement: 'afterWhere', items: [node] };
				settleBlocks(part, false);
			}
			return part.dcsWhere.items.length - 1;
		}

		/** Поле таблицы части в {ГДЕ}: по нему пользователь сможет ставить отбор (повтор пути — отказ). */
		function addDcsWhereField(model, address, path) {
			const target = dcsWhereTarget(model, address);
			if (target.error) {
				return target;
			}
			const value = text(path).trim();
			if (!PATH_RE.test(value)) {
				return fail('Поле {ГДЕ}: путь вида «Таблица.Поле».');
			}
			const part = target.part;
			if (dcsWhereRows(part).some((row) => row.path && upper(row.path) === upper(value))) {
				return fail('«' + value + '» уже в условиях компоновки.');
			}
			const node = dcsWhereNode(value, 'field');
			if (!node) {
				return fail('Поле {ГДЕ} не разобрано: «' + value + '».');
			}
			return { model: target.model, index: putDcsWhere(part, node) };
		}

		/** Текст условия {ГДЕ} в скобках: так разбор отличает его от поля. */
		function dcsConditionNode(value) {
			const source = text(value).trim();
			if (!source) {
				return fail('Условие пустое.');
			}
			if (/[{}]/.test(source)) {
				return fail('Условие компоновки не содержит фигурных скобок.');
			}
			const node = dcsWhereNode('(' + source + ')', 'condition');
			if (!node) {
				return fail('Условие компоновки не разобрано: «' + source.replace(/\s+/g, ' ') + '».');
			}
			return { node: node };
		}

		/** Условие с параметром в {ГДЕ} (окно выражения): попадёт в запрос, только если параметр задан. */
		function addDcsWhereCondition(model, address, value) {
			const target = dcsWhereTarget(model, address);
			if (target.error) {
				return target;
			}
			const built = dcsConditionNode(value);
			if (built.error) {
				return built;
			}
			return { model: target.model, index: putDcsWhere(target.part, built.node) };
		}

		/**
		 * Правка элемента {ГДЕ}: у поля — {star?, alias?}; {text} — элемент становится условием (правка
		 * поля карандашом: условие с параметром).
		 */
		function setDcsWhereItem(model, address, k, spec) {
			const target = dcsWhereTarget(model, address);
			if (target.error) {
				return target;
			}
			const block = target.part.dcsWhere;
			const item = block ? list(block.items)[k] : null;
			if (!item) {
				return fail('Условия нет.');
			}
			const value = spec || {};
			const row = dcsWhereRows(target.part)[k];
			if (typeof value.text === 'string') {
				if (row.kind === 'condition' && text(row.text).trim() === value.text.trim()) {
					return { model: model };
				}
				const built = dcsConditionNode(value.text);
				if (built.error) {
					return built;
				}
				block.items[k] = built.node;
				mergedBlock(block);
				return { model: target.model };
			}
			if (row.kind !== 'field') {
				return fail('Условие правится текстом в окне выражения.');
			}
			const star = 'star' in value ? Boolean(value.star) : row.star;
			const alias = 'alias' in value ? text(value.alias).trim() : text(row.alias);
			if (alias) {
				const problem = ensureAlias(alias, [], '');
				if (problem) {
					return fail(problem);
				}
			}
			if (star === row.star && alias === text(row.alias)) {
				return { model: model };
			}
			const node = dcsWhereNode(row.path + (star ? '.*' : '') + (alias ? ' ' + keywordAs(model && model.lang) + ' ' + alias : ''), 'field');
			if (!node) {
				return fail('Поле {ГДЕ} не разобрано.');
			}
			block.items[k] = node;
			return { model: target.model };
		}

		function removeDcsWhere(model, address, k) {
			const target = dcsWhereTarget(model, address);
			if (target.error) {
				return target;
			}
			const block = target.part.dcsWhere;
			if (!block || !list(block.items)[k]) {
				return fail('Условия нет.');
			}
			block.items.splice(k, 1);
			target.part.dcsWhere = block.items.length > 0 ? mergedBlock(block) : null;
			return { model: target.model };
		}

		function removeAllDcsWhere(model, address) {
			const target = dcsWhereTarget(model, address);
			if (target.error) {
				return target;
			}
			if (!target.part.dcsWhere) {
				return { model: model };
			}
			target.part.dcsWhere = null;
			return { model: target.model };
		}

		function moveDcsWhere(model, address, k, delta) {
			const target = dcsWhereTarget(model, address);
			if (target.error) {
				return target;
			}
			const block = target.part.dcsWhere;
			const to = block ? shift(list(block.items), k, delta) : null;
			if (to === null) {
				return { model: model, index: k };
			}
			mergedBlock(block);
			return { model: target.model, index: to };
		}

		// =========================================================================================
		// Проверка имён таблиц и полей по метаданным
		// =========================================================================================

		/** Слово языка запросов (липкое: exec со своим lastIndex, без среза строки на каждую лексему). */
		const NAME_WORD_RE = /[\p{L}_][\p{L}\p{N}_]*/uy;
		const CYRILLIC_RE = /[\u0400-\u04FF]/;

		/**
		 * Хвосты таблиц, которых нет в описании md-sparrow, хотя язык запросов их знает: таблицы
		 * изменений (`Справочник.X.Изменения`), точки маршрута бизнес-процесса и таблица субконто
		 * регистра бухгалтерии. Их отсутствие среди tables[] описания — не опечатка, поэтому о них молчим.
		 */
		const UNDESCRIBED_TAILS = new Set(['ИЗМЕНЕНИЯ', 'CHANGES', 'ТОЧКИ', 'POINTS', 'СУБКОНТО', 'EXTDIMENSIONS']);

		/**
		 * Виды, чьи подчинённые таблицы описание перечисляет не полностью: у регистра расчёта таблицы
		 * базы и перерасчётов называются по другим объектам конфигурации. Их хвосты не проверяются.
		 */
		const OPEN_TAIL_KINDS = new Set(['РегистрРасчета']);

		/**
		 * Лексемы выражения для проверки имён: слова в исходном написании, `&`-параметры, строки, числа
		 * и знаки; комментарии отброшены. Свой короткий лексер, а не canonTokens модели: канон переводит
		 * английские слова в русские ключевые (`T.Order` стал бы `УПОРЯДОЧИТЬ`), а имя поля нужно таким,
		 * как оно написано. s — позиция лексемы в тексте.
		 */
		function nameTokens(value) {
			const source = text(value);
			const out = [];
			let i = 0;
			while (i < source.length) {
				const ch = source[i];
				if (/\s/u.test(ch)) {
					i++;
					continue;
				}
				if (ch === '/' && source[i + 1] === '/') {
					while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
						i++;
					}
					continue;
				}
				if (ch === '"') {
					let j = i + 1;
					while (j < source.length) {
						if (source[j] === '"') {
							if (source[j + 1] === '"') {
								j += 2;
								continue;
							}
							j++;
							break;
						}
						j++;
					}
					out.push({ k: 'str', v: source.slice(i, j), s: i });
					i = j;
					continue;
				}
				if (ch === '&') {
					NAME_WORD_RE.lastIndex = i + 1;
					const match = NAME_WORD_RE.exec(source);
					const end = match ? i + 1 + match[0].length : i + 1;
					out.push({ k: 'par', v: source.slice(i, end), s: i });
					i = end;
					continue;
				}
				NAME_WORD_RE.lastIndex = i;
				const word = NAME_WORD_RE.exec(source);
				if (word) {
					out.push({ k: 'w', v: word[0], u: word[0].toUpperCase(), s: i });
					i += word[0].length;
					continue;
				}
				if (/[0-9]/.test(ch)) {
					let j = i + 1;
					while (j < source.length && /[0-9.]/.test(source[j])) {
						j++;
					}
					out.push({ k: 'num', v: source.slice(i, j), s: i });
					i = j;
					continue;
				}
				out.push({ k: 'p', v: ch, s: i });
				i++;
			}
			return out;
		}

		function isDot(token) {
			return Boolean(token) && token.k === 'p' && token.v === '.';
		}

		/** Позиция за закрывающей скобкой к открывающей в лексеме open. */
		function afterNameParen(tokens, open) {
			let depth = 0;
			for (let i = open; i < tokens.length; i++) {
				if (tokens[i].k === 'p' && tokens[i].v === '(') {
					depth++;
				} else if (tokens[i].k === 'p' && tokens[i].v === ')' && --depth === 0) {
					return i + 1;
				}
			}
			return tokens.length;
		}

		/**
		 * Пути имён выражения в исходном написании: [{segments}] для `Алиас.Поле…` и одиночных имён.
		 * Не пути: слова за точкой (продолжение пути или параметра `&Период.ДатаНачала`), имена функций,
		 * аргументы ЗНАЧЕНИЕ(…) и ТИП(…), слова языка, литералы и слова периода. Выражение с вложенным
		 * запросом — null: у подзапроса свои алиасы, и их не отличить от опечатки внешнего.
		 */
		function namePaths(expr) {
			const tokens = nameTokens(expr);
			if (tokens.some((token) => token.k === 'w' && (token.u === 'ВЫБРАТЬ' || token.u === 'SELECT'))) {
				return null;
			}
			const out = [];
			for (let i = 0; i < tokens.length; i++) {
				const token = tokens[i];
				if (token.k !== 'w' || isDot(tokens[i - 1])) {
					continue;
				}
				const next = tokens[i + 1];
				if (next && next.k === 'p' && next.v === '(') {
					if (WRAPPED_ARGUMENT_WORDS.has(token.u)) {
						i = afterNameParen(tokens, i + 1) - 1;
					}
					continue;
				}
				if (RESERVED.has(token.u) || LITERALS.has(token.u) || PERIOD_WORDS.has(token.u)) {
					continue;
				}
				const previous = tokens[i - 1];
				const segments = [token.v];
				while (isDot(tokens[i + 1]) && tokens[i + 2] && tokens[i + 2].k === 'w') {
					segments.push(tokens[i + 2].v);
					i += 2;
				}
				// Имя типа, а не путь: ВЫРАЗИТЬ(… КАК Документ.X) и … ССЫЛКА Документ.X. Иначе псевдоним
				// таблицы «Документ» (в БСП есть «КАК Задача», «КАК ПланОбмена») принял бы имя типа за свой путь
				if (previous && previous.k === 'w' && TYPE_NAME_WORDS.has(previous.u)) {
					continue;
				}
				out.push({ segments: segments });
			}
			return out;
		}

		/** Позиция первого пути из этих сегментов в тексте (начало пути, строки и комментарии мимо); нет — -1. */
		function pathOffset(sourceText, segments) {
			const tokens = nameTokens(sourceText);
			const want = segments.map(upper);
			for (let i = 0; i < tokens.length; i++) {
				if (tokens[i].k !== 'w' || tokens[i].u !== want[0] || isDot(tokens[i - 1])) {
					continue;
				}
				let k = 1;
				while (k < want.length && isDot(tokens[i + 2 * k - 1]) && tokens[i + 2 * k] && tokens[i + 2 * k].u === want[k]) {
					k++;
				}
				if (k === want.length) {
					return tokens[i].s;
				}
			}
			return -1;
		}

		/**
		 * Начала запросов пакета в исходном тексте — только у модели, разобранной из текста и не
		 * перестроенной (у каждого запроса срез original по порядку): у правленой модели мест в тексте нет.
		 */
		function statementStarts(model) {
			const statements = list(model && model.statements);
			const starts = [];
			let at = 0;
			for (let i = 0; i < statements.length; i++) {
				const original = statements[i] && statements[i].original;
				if (!original || original.index !== i || typeof original.text !== 'string' || typeof original.before !== 'string') {
					return null;
				}
				at += original.before.length;
				starts.push(at);
				at += original.text.length;
			}
			return starts;
		}

		/**
		 * Колонки запроса-создателя ВТ без учёта регистра; выражение без псевдонима — null: имя его колонки
		 * даёт платформа, и состав колонок неполон — поля такой ВТ не проверяются.
		 */
		function tempColumns(batch, index) {
			const names = Q.outputFields(list(batch && batch.statements)[index]);
			return names.length > 0 && names.every((name) => name !== null) ? new Set(names.map(upper)) : null;
		}

		/** Временные таблицы, видные запросу statementIndex: внешнего пакета (вложенный конструктор) и свои до него. */
		function tempIndex(model, statementIndex, outerTemp) {
			const index = new Map();
			for (const table of list(outerTemp)) {
				if (table && text(table.name)) {
					index.set(upper(table.name), table.batch ? tempColumns(table.batch, table.statement) : null);
				}
			}
			for (const table of Q.tempTables(model, statementIndex)) {
				index.set(upper(table.name), tempColumns(model, table.statement));
			}
			return index;
		}

		/**
		 * Имена полей таблицы описания (русские и английские), а у основной таблицы (description) ещё и
		 * имена табличных частей объекта — то, что пишут после алиаса.
		 */
		function describedNames(table, description) {
			const names = new Set();
			for (const field of list(table && table.fields)) {
				if (field && text(field.name)) {
					names.add(upper(field.name));
				}
				if (field && text(field.nameEn)) {
					names.add(upper(field.nameEn));
				}
			}
			// ТЧ через точку от основной таблицы (`Док.Товары.Номенклатура`): поля такой нет, а путь верный
			if (description) {
				for (const own of list(description.tables)) {
					if (own && (own.kind === 'tabularSection' || own.kind === 'standardTabularSection')) {
						const name = text(own.name);
						names.add(upper(name.slice(name.lastIndexOf('.') + 1)));
					}
				}
			}
			return names;
		}

		/**
		 * `&`-параметры, которые уже есть в запросе, — список у значений параметров виртуальной таблицы (НачалоПериода,
		 * КонецПериода, Период…), как у такого поля в конфигураторе: все параметры
		 * собранного текста пакета (DcsQueryModel.parametersOf, в том числе внутри {…}), у вложенного конструктора — ещё и
		 * параметры внешнего пакета (outer) и параметры текстов, ещё не записанных в модель (typed: позиции открытого окна
		 * параметров — вписанный в одну позицию параметр пользователь уже считает частью запроса). Без повторов без учёта
		 * регистра (остаётся первое написание), по имени. Параметры схемы, которых текст не упоминает, сюда не входят:
		 * список — о том, что уже использовано в запросе. Модель, которая не собирается, даёт только outer и typed.
		 *
		 * @param {object} model Модель запроса (пакет).
		 * @param {string[]} [outer] Параметры внешнего пакета.
		 * @param {string[]} [typed] Тексты, ещё не записанные в модель (выражения, блоки {…}).
		 * @returns {string[]}
		 */
		function usedParameters(model, outer, typed) {
			let names = [];
			try {
				names = Q.parametersOf(Q.build(model));
			} catch (error) {
				names = [];
			}
			const fromTyped = [];
			for (const value of list(typed)) {
				if (typeof value === 'string' && value !== '') {
					fromTyped.push(...Q.parametersOf(value));
				}
			}
			const seen = new Set();
			const out = [];
			for (const name of names.concat(list(outer), fromTyped)) {
				if (typeof name === 'string' && name !== '' && !seen.has(upper(name))) {
					seen.add(upper(name));
					out.push(name);
				}
			}
			return out.sort(compareNames);
		}

		/**
		 * Что можно в «Условии» таблицы — для текста предупреждения: по правилу vtConditionRule (у регистра бухгалтерии ещё
		 * субконто) и по самой таблице (разделители — только если они у неё есть: в конфигурации без разделения данных слово
		 * сбивало бы). Правило 'all' предупреждений не даёт.
		 */
		function conditionRuleText(rule) {
			const words = ['измерения'];
			if (rule.rule === 'dimensionsSubconto') {
				words.push('субконто');
			}
			if (rule.allowed.some((field) => text(field.kind) === 'separator')) {
				words.push('разделители');
			}
			return 'только ' + (words.length > 1 ? words.slice(0, -1).join(', ') + ' и ' + words[words.length - 1] : words[0]);
		}

		/**
		 * Предупреждение у «Условия» виртуальной таблицы: поля таблицы, которых в условии
		 * этой таблицы быть не может (vtConditionFields → denied), а текст их уже пишет. Судится первое имя пути — в
		 * условии ВТ поля пишутся без псевдонима; строки, комментарии, `&`-параметры, функции и слова языка — мимо
		 * (namePaths), имена, которых у таблицы нет, — тоже (это дело проверки имён). Текст не правится и ОК не
		 * блокируется: правило выведено из документации и конфигуратора, а окончательно запрос проверяет платформа.
		 *
		 * @param {string} objectKind Вид объекта описания.
		 * @param {object|null} table Таблица описания {name, fields[]}.
		 * @param {string|string[]} texts Текст условия; у окна для СКД — значение, блок и поля-отборы по отдельности.
		 * @returns {{names: string[], message: string}} names — поля в написании описания, по порядку в тексте, без
		 *   повторов; message — пусто или короткое предупреждение.
		 */
		function vtConditionWarning(objectKind, table, texts) {
			const rule = vtConditionFields(objectKind, table);
			const denied = new Map();
			for (const field of rule.denied) {
				denied.set(upper(field.name), field.name);
				if (text(field.nameEn)) {
					denied.set(upper(field.nameEn), field.name);
				}
			}
			const names = [];
			if (denied.size > 0) {
				for (const value of Array.isArray(texts) ? texts : [texts]) {
					for (const path of namePaths(text(value)) || []) {
						const name = denied.get(upper(path.segments[0]));
						if (name && names.indexOf(name) < 0) {
							names.push(name);
						}
					}
				}
			}
			if (names.length === 0) {
				return { names: names, message: '' };
			}
			const quoted = names.map((name) => '«' + name + '»').join(', ');
			return {
				names: names,
				message: 'В условии этой таблицы можно использовать ' + conditionRuleText(rule) + ': ' + quoted + (names.length > 1 ? ' не подойдут.' : ' не подойдёт.'),
			};
		}

		/**
		 * Проверка имён запроса по метаданным: опечатка в имени таблицы, табличной части или
		 * виртуальной таблицы, в поле источника или в алиасе находится до записи, а не при загрузке схемы
		 * в базу. Только предупреждения и только при полном знании: чего описание не знает (ещё читается,
		 * объект не описан, тип известен не целиком), о том молчим — ложное предупреждение на рабочем
		 * запросе хуже пропущенного, а окончательно текст проверяет платформа.
		 *
		 * Что проверяется:
		 * - источник `Вид.Имя[.Хвост]`: объекта нет в дереве «База данных» и нет его описания; у объекта
		 *   с готовым описанием нет такой таблицы (кроме таблиц, которых описание не знает:
		 *   UNDESCRIBED_TAILS, OPEN_TAIL_KINDS);
		 * - путь `Алиас.Поле[.Реквизит…]` в выборке, ГДЕ, ПО соединений, СГРУППИРОВАТЬ ПО, ИМЕЮЩИЕ,
		 *   УПОРЯДОЧИТЬ ПО (у запроса без объединения), {ГДЕ} и условиях параметров ВТ: первое поле —
		 *   по полям источника (таблица описания, колонки ВТ пакета и вложенного запроса, константы
		 *   общей таблицы), дальше — по типу предыдущего сегмента, выведенному тем же выводом, что у
		 *   «Группировки» (env.pathType → DcsFieldTypes.partExpressionType), если он из одних ссылок с
		 *   описаниями (env.members);
		 * - алиас, которого нет среди источников части, если это не имя вида объекта (ЗНАЧЕНИЕ, ССЫЛКА,
		 *   ВЫРАЗИТЬ) и не поле какого-нибудь источника (путь без алиаса).
		 * Что пропускается: однословные таблицы, которых пакет не создаёт (внешние данные компоновки);
		 * таблицы неизвестного вида (внешние источники данных); выражения с вложенным ВЫБРАТЬ; запросы с
		 * блоком {ХАРАКТЕРИСТИКИ} (поля характеристик динамические); части с источником-параметром или
		 * скобками соединений, которые разбор не раскладывает; одиночные имена без алиаса. Имя, которого
		 * нет в английском описании и которое написано кириллицей (стандартный реквизит по-русски у
		 * `Catalog.X`), и хвост не на языке описания — тоже молча: языки имён в одном тексте смешивать
		 * можно, а описание у таблицы одно.
		 *
		 * Общие реквизиты (env.commonAttributes — имена из выгрузки): md-sparrow перечисляет их у основных
		 * таблиц и таблиц итогов (по составу реквизита), но не у табличных частей, констант, журналов и
		 * последовательностей. Поэтому о поле или реквизите с таким именем у таблицы конфигурации проверка
		 * молчит.
		 *
		 * @param {object} model Модель запроса.
		 * @param {{describe: function, objectOf: function, objectExists?: function, outerTemp?: object[],
		 *   commonAttributes?: string[], pathType?: function, members?: function}} env describe(имяТаблицы) →
		 *   {state: ready|loading|none, table?, description?} (description и при none, если объект описан, а
		 *   таблицы нет); objectOf(имяТаблицы) → {object: 'Вид.Имя', tail[]} | null (не вид объекта);
		 *   objectExists(видRu, имя) → true|false|null (по дереву «База данных», null — дерева нет);
		 *   outerTemp — ВТ внешнего пакета {name, statement, batch}; pathType(пакет, номерЗапроса, часть,
		 *   выражение) → {type}; members(тип) → {known, names?} — имена реквизитов типа (known false —
		 *   тип известен не целиком или ещё читается).
		 * @returns {{statement: number, part: number, text: string, message: string, offset?: number}[]}
		 *   text — имя, о котором предупреждение; offset — позиция в исходном тексте (у модели из текста).
		 */
		function nameProblems(model, env) {
			const out = [];
			if (!env || typeof env.describe !== 'function' || typeof env.objectOf !== 'function') {
				return out;
			}
			const options = Object.assign({}, env, { commonNames: new Set(list(env.commonAttributes).map(upper)) });
			const statements = list(model && model.statements);
			const starts = statementStarts(model);
			const seen = new Set();
			statements.forEach((statement, i) => {
				if (!statement || statement.type === 'drop' || characteristicsTexts(statement).length > 0) {
					return;
				}
				const temps = tempIndex(model, i, options.outerTemp);
				// Одна опечатка в выборке, группировке и порядке — одно предупреждение части
				const push = (partIndex, item) => {
					const key = i + '\u0001' + partIndex + '\u0001' + item.message;
					if (seen.has(key)) {
						return;
					}
					seen.add(key);
					const problem = { statement: i, part: partIndex, text: item.text, message: item.message };
					if (starts && statement.original) {
						const at = pathOffset(statement.original.text, item.segments);
						if (at >= 0) {
							problem.offset = starts[i] + at;
						}
					}
					out.push(problem);
				};
				checkStatementNames(model, statement, i, temps, options, push, '');
			});
			return out;
		}

		/** Части запроса и его порядок (у запроса без объединения: в объединении порядок идёт по колонкам результата). */
		function checkStatementNames(model, statement, statementIndex, temps, env, push, prefix) {
			const parts = list(statement && statement.parts);
			parts.forEach((part, k) => {
				const scope = partNameScope(model, part, statementIndex, temps, env, (item) => push(k, item), prefix);
				checkPartNames(model, part, statementIndex, scope, env, (item) => push(k, item), prefix);
				if (k === 0 && parts.length === 1 && Array.isArray(statement.orderBy)) {
					const columns = new Set(Q.outputFields(statement).filter(Boolean).map(upper));
					for (const item of statement.orderBy) {
						checkExpressionNames(model, part, statementIndex, scope, env, (problem) => push(0, problem), prefix, text(item && item.expr), { columns: columns });
					}
				}
			});
		}

		/**
		 * Что известно об источниках части: по каждому — алиас (сегментами), вид, подпись и имена полей
		 * (null — неизвестны). Попутно проверяются сами таблицы и вложенные запросы-источники.
		 */
		function partNameScope(model, part, statementIndex, temps, env, push, prefix) {
			const scope = { sources: [], opaque: false };
			for (const entry of sourcesOf(part)) {
				const source = entry.source;
				const info = { alias: entry.alias, segments: entry.alias ? entry.alias.split('.') : [], label: '', names: null, lang: 'ru', vtNames: null };
				if (source.kind === 'subquery') {
					const columns = Q.outputFields(source.query);
					info.label = 'вложенный запрос';
					info.names = columns.length > 0 && columns.every((name) => name !== null) ? new Set(columns.map(upper)) : null;
					// У вложенного запроса свои источники и алиасы: проверяются его же правилами
					const inner = prefix + 'Вложенный запрос' + (entry.alias ? ' «' + entry.alias + '»' : '') + ': ';
					checkStatementNames(model, source.query, statementIndex, temps, env, (_part, item) => push(item), inner);
				} else if (source.kind === 'table') {
					tableNameInfo(source, info, temps, env, push, prefix);
				} else {
					// Параметр-таблица и скобки соединений, которые разбор не раскладывает: их алиасы и поля неизвестны
					scope.opaque = true;
				}
				if (info.opaque) {
					scope.opaque = true;
				}
				scope.sources.push(info);
			}
			return scope;
		}

		/** Таблица-источник: объект и таблица по метаданным, имена полей, если описание готово. */
		function tableNameInfo(source, info, temps, env, push, prefix) {
			const table = text(source.table);
			info.label = table;
			if (isConstantsTable(source)) {
				const described = env.describe(table);
				info.names = described && described.state === 'ready' && described.table ? describedNames(described.table, null) : null;
				return;
			}
			if (IDENT_RE.test(table)) {
				// Однословная таблица — временная таблица пакета или внешние данные компоновки: вторые молча
				info.label = 'временная таблица ' + table;
				info.names = temps.has(upper(table)) ? temps.get(upper(table)) : null;
				return;
			}
			const object = env.objectOf(table);
			if (!object) {
				// Вид неизвестен (внешний источник данных и т. п.): ни таблицы, ни полей не знаем
				info.opaque = true;
				return;
			}
			info.lang = /^[A-Za-z]/.test(table) ? 'en' : 'ru';
			const [kindRu, name] = text(object.object).split('.');
			const exists = typeof env.objectExists === 'function' ? env.objectExists(kindRu, name) : null;
			const described = env.describe(table) || { state: 'none' };
			const segments = table.split('.');
			if (described.state === 'ready' && described.table) {
				const main = list(object.tail).length === 0;
				info.names = describedNames(described.table, main ? described.description : null);
				info.vtNames = main ? describedNames(described.table, null) : info.names;
				// У таблицы конфигурации могут быть поля общих реквизитов, которых описание не знает
				info.common = true;
				return;
			}
			if (described.state !== 'none') {
				return;
			}
			if (exists === false && !described.description) {
				// Дерево не знает объекта, и его описания нет: опечатка в имени объекта
				push({ text: table, segments: segments, message: prefix + 'Объекта «' + kindRu + '.' + name + '» нет в конфигурации (таблица «' + table + '»).' });
				return;
			}
			const tail = list(object.tail);
			if (!described.description || tail.length !== 1 || OPEN_TAIL_KINDS.has(kindRu) || UNDESCRIBED_TAILS.has(upper(tail[0]))) {
				return;
			}
			// Хвост не на языке описания может быть именем таблицы на другом языке (`РегистрНакопления.X.Balance`)
			if (CYRILLIC_RE.test(tail[0]) !== (info.lang === 'ru')) {
				return;
			}
			push({
				text: table,
				segments: segments,
				message: prefix + 'У объекта «' + kindRu + '.' + name + '» нет таблицы «' + tail[0] + '» (табличной части или виртуальной таблицы).',
			});
		}

		/** Выражения части: выборка, ГДЕ, ИМЕЮЩИЕ, СГРУППИРОВАТЬ ПО, ПО соединений, {ГДЕ} и параметры ВТ. */
		function checkPartNames(model, part, statementIndex, scope, env, push, prefix) {
			const check = (value, how) => checkExpressionNames(model, part, statementIndex, scope, env, push, prefix, value, how || {});
			for (const field of list(part && part.fields)) {
				check(text(field && field.expr));
			}
			for (const condition of list(part && part.where && part.where.conditions)) {
				check(condition);
			}
			for (const condition of list(part && part.having && part.having.conditions)) {
				check(condition);
			}
			const groupBy = part && part.groupBy;
			for (const item of list(groupBy && groupBy.items)) {
				check(item);
			}
			for (const set of list(groupBy && groupBy.groupingSets)) {
				for (const item of list(set)) {
					check(item);
				}
			}
			for (const item of list(part && part.dcsWhere && part.dcsWhere.items)) {
				if (item && text(item.path)) {
					check(item.path);
				} else if (item && text(item.text)) {
					check(item.text);
				}
			}
			sourcesOf(part).forEach((entry, k) => {
				for (const condition of list(entry.join && entry.join.on && entry.join.on.conditions)) {
					check(condition);
				}
				const info = scope.sources[k];
				for (const param of list(entry.source.kind === 'table' ? entry.source.params : null)) {
					// В параметрах ВТ поля пишутся без алиаса — свои поля таблицы; путь от алиаса части
					// проверяется, только если такого поля у самой таблицы нет
					for (const value of [text(param && param.text), text(param && param.dcs && param.dcs.text)]) {
						if (value && info && info.vtNames) {
							check(value, { vt: info.vtNames });
						}
					}
				}
			});
		}

		/** Источник по началу пути: алиас сегментами (у таблицы без псевдонима их несколько), самый длинный. */
		function sourceOfPath(scope, segments) {
			let best = null;
			for (const info of scope.sources) {
				const own = info.segments;
				if (own.length === 0 || own.length >= segments.length) {
					continue;
				}
				if (own.every((segment, k) => upper(segment) === upper(segments[k])) && (!best || own.length > best.segments.length)) {
					best = info;
				}
			}
			return best;
		}

		/**
		 * Пути одного выражения по правилам nameProblems. how.columns — колонки результата (УПОРЯДОЧИТЬ ПО:
		 * путь от имени колонки не проверяется); how.vt — поля самой ВТ (параметры ВТ: проверяются только
		 * пути от алиаса части, и только если первое имя — не поле этой ВТ).
		 */
		function checkExpressionNames(model, part, statementIndex, scope, env, push, prefix, value, how) {
			const paths = value ? namePaths(value) : null;
			for (const path of paths || []) {
				const segments = path.segments;
				if (how.columns && how.columns.has(upper(segments[0]))) {
					continue;
				}
				if (how.vt && how.vt.has(upper(segments[0]))) {
					continue;
				}
				const info = sourceOfPath(scope, segments);
				if (info) {
					checkSourcePath(model, part, statementIndex, info, segments, env, push, prefix);
					continue;
				}
				if (how.vt || segments.length < 2 || scope.opaque || env.objectOf(segments[0] + '.' + segments[1])) {
					continue;
				}
				// Путь без алиаса возможен, если первое имя — поле источника; не зная всех полей, молчим
				if (scope.sources.some((item) => !item.names || item.names.has(upper(segments[0])) || unlistedField(item, segments[0], env))) {
					continue;
				}
				push({
					text: segments.join('.'),
					segments: segments,
					message: prefix + '«' + segments.join('.') + '»: в части запроса нет таблицы с псевдонимом «' + segments[0] + '».',
				});
			}
		}

		/** Имя общего реквизита выгрузки (env.commonNames): поле таблиц объектов, которого описание может не перечислять. */
		function isCommonName(name, env) {
			return env.commonNames instanceof Set && env.commonNames.has(upper(name));
		}

		/**
		 * Поле, которого нет в списке имён источника, но которое у него может быть: английское описание не
		 * знает русских имён стандартных реквизитов, а общие реквизиты описание перечисляет не у всех таблиц.
		 */
		function unlistedField(info, name, env) {
			return (info.lang === 'en' && CYRILLIC_RE.test(name)) || (Boolean(info.common) && isCommonName(name, env));
		}

		/** Путь от источника: первое поле — по полям источника, дальше — по типам через env.pathType и env.members. */
		function checkSourcePath(model, part, statementIndex, info, segments, env, push, prefix) {
			const rest = segments.slice(info.segments.length);
			if (rest.length === 0 || !info.names) {
				return;
			}
			const shown = segments.join('.');
			if (!info.names.has(upper(rest[0]))) {
				if (unlistedField(info, rest[0], env)) {
					return;
				}
				push({
					text: shown,
					segments: segments,
					message: prefix + '«' + shown + '»: у «' + info.alias + '» (' + info.label + ') нет поля «' + rest[0] + '».',
				});
				return;
			}
			if (typeof env.pathType !== 'function' || typeof env.members !== 'function') {
				return;
			}
			for (let k = 1; k < rest.length; k++) {
				const prefixPath = info.alias + '.' + rest.slice(0, k).join('.');
				const typed = env.pathType(model, statementIndex, part, prefixPath);
				const members = typed && typed.type ? env.members(typed.type) : null;
				if (!members || members.known !== true) {
					return;
				}
				const names = new Set(list(members.names).map(upper));
				if (!names.has(upper(rest[k])) && !isCommonName(rest[k], env)) {
					push({
						text: shown,
						segments: segments,
						message: prefix + '«' + shown + '»: у «' + prefixPath + '» нет реквизита «' + rest[k] + '».',
					});
					return;
				}
			}
		}

		/** Тексты блоков {ХАРАКТЕРИСТИКИ} запроса: вкладка их только показывает (правка — текстом). */
		function characteristicsTexts(statement) {
			if (!statement || statement.type === 'drop') {
				return [];
			}
			const blocks = list(statement.raw).concat(...list(statement.parts).map((part) => list(part && part.raw)));
			return blocks.filter((block) => block && block.kind === 'characteristics').map((block) => text(block.text));
		}

		/** Подпись запроса пакета для вкладки справа (полное название): номер и что он делает с временной таблицей. */
		function statementLabel(statement, index) {
			const head = 'Запрос пакета ' + (index + 1);
			if (!statement) {
				return head;
			}
			if (statement.type === 'drop') {
				return head + ': уничтожение ' + text(statement.table);
			}
			const owner = list(statement.parts).find((part) => part && part.into);
			if (owner && owner.into) {
				return head + (owner.into.mode === 'add' ? ': добавление в ' : ': временная таблица ') + text(owner.into.table);
			}
			return head;
		}

		/**
		 * Короткая подпись вертикальной вкладки запроса пакета и строки списка
		 * «Пакет запросов» (batchRows): у временной таблицы — её имя, у добавления и уничтожения — действие с
		 * именем, у остальных — «Запрос пакета N». Подпись — часть полной (statementLabel): полная становится
		 * доступным именем вкладки, и голосовая команда по видимому тексту её находит (WCAG 2.5.3).
		 */
		function statementTabLabel(statement, index) {
			const full = statementLabel(statement, index);
			const colon = full.indexOf(': ');
			if (colon < 0) {
				return full;
			}
			const rest = full.slice(colon + 2);
			const created = 'временная таблица ';
			if (rest.indexOf(created) === 0) {
				return rest.slice(created.length);
			}
			return rest.charAt(0).toUpperCase() + rest.slice(1);
		}

		return {
			IDENT_RE: IDENT_RE,
			clone: clone,
			emptyStatement: emptyStatement,
			newModel: newModel,
			subModel: subModel,
			statementAt: statementAt,
			partAt: partAt,
			columnName: columnName,
			columnNames: columnNames,
			sourcesOf: sourcesOf,
			aliasOf: aliasOf,
			aliasesOf: aliasesOf,
			findSource: findSource,
			sourceLabel: sourceLabel,
			isTempTable: isTempTable,
			isConstantsTable: isConstantsTable,
			paramText: paramText,
			paramTexts: paramTexts,
			defaultParamTexts: defaultParamTexts,
			virtualParamsState: virtualParamsState,
			vtConditionAccess: vtConditionAccess,
			vtConditionFields: vtConditionFields,
			vtConditionWarning: vtConditionWarning,
			vtParamInput: vtParamInput,
			vtExpressionFields: vtExpressionFields,
			fieldNodeKind: fieldNodeKind,
			usedParameters: usedParameters,
			checkAlias: ensureAlias,
			addSource: addSource,
			removeSource: removeSource,
			removeAllSources: removeAllSources,
			renameSource: renameSource,
			replaceSource: replaceSource,
			setVirtualParams: setVirtualParams,
			setSubquery: setSubquery,
			addField: addField,
			addFields: addFields,
			removeField: removeField,
			removeAllFields: removeAllFields,
			moveField: moveField,
			setFieldExpr: setFieldExpr,
			refersTo: refersTo,
			finalize: finalize,
			problems: problems,
			fieldsOfSource: fieldsOfSource,
			catalogNodes: catalogNodes,
			statementLabel: statementLabel,
			statementTabLabel: statementTabLabel,
			// Общее вкладок
			hasAggregate: hasAggregate,
			stripParens: stripParens,
			// «Связи»
			LINK_OPERATORS: LINK_OPERATORS,
			RIGHT_JOIN_NOTE: RIGHT_JOIN_NOTE,
			joinKindOf: joinKindOf,
			linkRows: linkRows,
			linkConditionText: linkConditionText,
			setLinkKind: setLinkKind,
			setLinkCondition: setLinkCondition,
			removeLink: removeLink,
			addLink: addLink,
			relinkRow: relinkRow,
			suggestCondition: suggestCondition,
			suggestLink: suggestLink,
			// Раскрытые типы (составы определяемых типов и характеристик): копия правила DcsFieldTypes
			expandedTypes: expandedTypes,
			refTypeNames: refTypeNames,
			// «Группировка»
			AGGREGATE_FUNCTIONS: AGGREGATE_FUNCTIONS,
			aggregateOf: aggregateOf,
			groupingOf: groupingOf,
			groupingWarnings: groupingWarnings,
			// «>>» по типу и сумма нечислового
			groupingCandidates: groupingCandidates,
			numericKind: numericKind,
			aggregateTypeWarnings: aggregateTypeWarnings,
			groupTypeWarnings: groupTypeWarnings,
			ungroupableKind: ungroupableKind,
			addGroupField: addGroupField,
			removeGroupField: removeGroupField,
			removeAllGroupFields: removeAllGroupFields,
			setFieldAggregate: setFieldAggregate,
			addSummedField: addSummedField,
			// «Условия»
			COMPARISONS: COMPARISONS,
			HAVING_NOTE: HAVING_NOTE,
			conditionRows: conditionRows,
			conditionText: conditionText,
			defaultParamName: defaultParamName,
			addCondition: addCondition,
			setCondition: setCondition,
			removeCondition: removeCondition,
			// «Дополнительно»
			QUERY_KINDS: QUERY_KINDS,
			statementKind: statementKind,
			tempTableOf: tempTableOf,
			setPartFlags: setPartFlags,
			setStatementKind: setStatementKind,
			renameTempTable: renameTempTable,
			forUpdateOf: forUpdateOf,
			// «Индекс»
			indexColumns: indexColumns,
			addIndex: addIndex,
			removeIndex: removeIndex,
			copyIndex: copyIndex,
			moveIndex: moveIndex,
			setIndexUnique: setIndexUnique,
			addIndexField: addIndexField,
			removeIndexField: removeIndexField,
			moveIndexField: moveIndexField,
			// «Объединения/Псевдонимы»
			unionRows: unionRows,
			addPart: addPart,
			copyPart: copyPart,
			removePart: removePart,
			movePart: movePart,
			setUnionDistinct: setUnionDistinct,
			setUnionCell: setUnionCell,
			renameColumn: renameColumn,
			removeColumn: removeColumn,
			moveColumn: moveColumn,
			// «Порядок»
			ORDER_DIRECTIONS: ORDER_DIRECTIONS,
			orderRows: orderRows,
			addOrder: addOrder,
			removeOrder: removeOrder,
			moveOrder: moveOrder,
			setOrderDirection: setOrderDirection,
			setAutoOrder: setAutoOrder,
			// «Пакет запросов»
			dataSetStatementIndex: dataSetStatementIndex,
			batchRows: batchRows,
			batchWarnings: batchWarnings,
			addStatement: addStatement,
			copyStatement: copyStatement,
			removeStatement: removeStatement,
			moveStatement: moveStatement,
			// «Компоновка данных»
			compositionTables: compositionTables,
			setJoinRequired: setJoinRequired,
			setJoinGroup: setJoinGroup,
			vtParamParts: vtParamParts,
			vtBlockItems: vtBlockItems,
			vtBlockText: vtBlockText,
			vtParamText: vtParamText,
			vtOptionalState: vtOptionalState,
			vtSetOptional: vtSetOptional,
			renameParamText: renameParamText,
			dcsSelectRows: dcsSelectRows,
			dcsSelectAvailable: dcsSelectAvailable,
			addDcsSelect: addDcsSelect,
			addAllDcsSelect: addAllDcsSelect,
			removeDcsSelect: removeDcsSelect,
			removeAllDcsSelect: removeAllDcsSelect,
			setDcsSelect: setDcsSelect,
			moveDcsSelect: moveDcsSelect,
			dcsWhereRows: dcsWhereRows,
			addDcsWhereField: addDcsWhereField,
			addDcsWhereCondition: addDcsWhereCondition,
			setDcsWhereItem: setDcsWhereItem,
			removeDcsWhere: removeDcsWhere,
			removeAllDcsWhere: removeAllDcsWhere,
			moveDcsWhere: moveDcsWhere,
			characteristicsTexts: characteristicsTexts,
			// Проверка имён по метаданным
			nameProblems: nameProblems,
		};
	}

	const exported = { create: create };
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = exported;
	}
	if (root) {
		root.DcsQueryEdit = root.DcsQueryModel ? Object.assign({ create: create }, create(root.DcsQueryModel)) : exported;
	}
})(typeof window === 'undefined' ? globalThis : window);
