/**
 * Автодополнение путей полей, параметров и функций в редакторе СКД: чистые функции без DOM.
 *
 * Как и dcs-editor-highlight.js, файл живёт двумя жизнями: webview подключает его отдельным
 * <script> и берёт функции из window.DcsComplete, а node-тесты исполняют его в песочнице и
 * читают module.exports. Поэтому здесь только данные и расчёты, включая решения «открыть,
 * перефильтровать или закрыть список» и «куда встать по клавише»: сам список, события и замер
 * каретки — забота DOM-обвязки attachCompletion в dcs-editor.js.
 *
 * Каталог строится в два шага: источник даёт плоский список узлов с путями (sourceNodes по
 * модели cf-dcs-info или свой список у конструктора запроса), а catalogFromNodes раскладывает
 * их в дерево. Так окно выражения конструктора подаёт алиасы источников и их поля тем же
 * каталогом, и второй выпадающий список не нужен.
 */
(function (root) {
	'use strict';

	/** Подписи групп функций: показываются серым рядом с именем функции. */
	const FUNCTION_GROUPS = {
		aggregate: 'Агрегатные',
		date: 'Дата и время',
		string: 'Строки',
		math: 'Математические',
		other: 'Прочие',
		evaluation: 'Вычисление выражений',
	};

	function fn(name, nameEn, group) {
		return Object.freeze({ name: name, nameEn: nameEn, group: group });
	}

	/**
	 * Функции языка запросов в нормальном написании (окно выражения конструктора запроса).
	 * Состав повторяет словарь подсветки, кроме исключений, которые называет сверочный тест.
	 * Выразить — конструкция приведения типа: в подсветке это ключевое слово, но в подсказке
	 * она нужна наравне с функциями.
	 */
	const QUERY_FUNCTIONS = Object.freeze([
		fn('Сумма', 'Sum', 'aggregate'),
		fn('Количество', 'Count', 'aggregate'),
		fn('Среднее', 'Avg', 'aggregate'),
		fn('Минимум', 'Min', 'aggregate'),
		fn('Максимум', 'Max', 'aggregate'),
		fn('Год', 'Year', 'date'),
		fn('Квартал', 'Quarter', 'date'),
		fn('Месяц', 'Month', 'date'),
		fn('ДеньГода', 'DayOfYear', 'date'),
		fn('День', 'Day', 'date'),
		fn('Неделя', 'Week', 'date'),
		fn('ДеньНедели', 'WeekDay', 'date'),
		fn('Час', 'Hour', 'date'),
		fn('Минута', 'Minute', 'date'),
		fn('Секунда', 'Second', 'date'),
		fn('НачалоПериода', 'BeginOfPeriod', 'date'),
		fn('КонецПериода', 'EndOfPeriod', 'date'),
		fn('ДобавитьКДате', 'DateAdd', 'date'),
		fn('РазностьДат', 'DateDiff', 'date'),
		fn('ДатаВремя', 'DateTime', 'date'),
		fn('Подстрока', 'Substring', 'string'),
		fn('ВРег', 'Upper', 'string'),
		fn('НРег', 'Lower', 'string'),
		fn('СокрЛ', 'TrimL', 'string'),
		fn('СокрП', 'TrimR', 'string'),
		fn('СокрЛП', 'TrimAll', 'string'),
		fn('ДлинаСтроки', 'StringLength', 'string'),
		fn('СтрНайти', 'StrFind', 'string'),
		fn('СтрЗаменить', 'StrReplace', 'string'),
		fn('Лев', 'Left', 'string'),
		fn('Прав', 'Right', 'string'),
		fn('Окр', 'Round', 'math'),
		fn('Цел', 'Int', 'math'),
		fn('ACos', 'ACos', 'math'),
		fn('ASin', 'ASin', 'math'),
		fn('ATan', 'ATan', 'math'),
		fn('Cos', 'Cos', 'math'),
		fn('Sin', 'Sin', 'math'),
		fn('Tan', 'Tan', 'math'),
		fn('Exp', 'Exp', 'math'),
		fn('Log', 'Log', 'math'),
		fn('Log10', 'Log10', 'math'),
		fn('Pow', 'Pow', 'math'),
		fn('Sqrt', 'Sqrt', 'math'),
		fn('Значение', 'Value', 'other'),
		fn('Тип', 'Type', 'other'),
		fn('ТипЗначения', 'ValueType', 'other'),
		fn('ЕстьNULL', 'IsNull', 'other'),
		fn('Представление', 'Presentation', 'other'),
		fn('ПредставлениеСсылки', 'RefPresentation', 'other'),
		fn('АвтономерЗаписи', 'RecordAutoNumber', 'other'),
		fn('РазмерХранимыхДанных', 'StoredDataSize', 'other'),
		fn('Выразить', 'Cast', 'other'),
	]);

	/**
	 * Что выражения СКД (вычисляемые поля, ресурсы, параметры, связи) знают сверх языка запросов.
	 * Вычисление выражений — функции самой компоновки. Остальные — функции встроенного языка,
	 * которые вызываются в выражениях схем.
	 */
	const DCS_ONLY_FUNCTIONS = Object.freeze([
		fn('ВычислитьВыражение', 'EvalExpression', 'evaluation'),
		fn('ВычислитьВыражениеСГруппировкойМассив', 'EvalExpressionWithGroupArray', 'evaluation'),
		fn('ВычислитьВыражениеСГруппировкойТаблицаЗначений', 'EvalExpressionWithGroupValueTable', 'evaluation'),
		fn('Вычислить', 'Eval', 'evaluation'),
		fn('Уровень', 'Level', 'evaluation'),
		fn('Формат', 'Format', 'string'),
		fn('НСтр', 'NStr', 'string'),
		fn('СтрШаблон', 'StrTemplate', 'string'),
		fn('СоединитьСтроки', 'JoinStrings', 'string'),
		fn('Строка', 'String', 'string'),
		fn('ТекущаяДата', 'CurrentDate', 'date'),
		fn('ТекущаяДатаСеанса', 'CurrentSessionDate', 'date'),
		fn('УниверсальноеВремя', 'ToUniversalTime', 'date'),
		fn('Дата', 'Date', 'date'),
		fn('ПредставлениеПериода', 'PeriodPresentation', 'date'),
		fn('ЗначениеЗаполнено', 'ValueIsFilled', 'other'),
		fn('Массив', 'Array', 'other'),
	]);

	/** Функции выражений СКД: язык запросов плюс собственные функции компоновки и встроенного языка. */
	const DCS_FUNCTIONS = Object.freeze(QUERY_FUNCTIONS.concat(DCS_ONLY_FUNCTIONS));

	/** Системные поля настроек, которые предлагает подсказка. */
	const SYSTEM_FIELDS = Object.freeze([
		Object.freeze({ name: 'НомерПоПорядку', title: 'Номер по порядку' }),
		Object.freeze({ name: 'НомерПоПорядкуВГруппировке', title: 'Номер по порядку в группировке' }),
		Object.freeze({ name: 'Уровень', title: 'Уровень' }),
	]);

	/** Разделы настроек, где подсказка предлагает системные поля; в группировках и сортировке их нет. */
	const SYSTEM_FIELD_SECTIONS = ['selection', 'filter', 'any'];

	/** Раздел настроек → флаг ограничения использования поля (dcscom:DataSetFieldUseRestriction). */
	const SECTION_RESTRICTION = {
		selection: 'field',
		filter: 'condition',
		group: 'group',
		order: 'order',
	};

	/**
	 * Метка вида строки списка: буква для глаза и слово для скринридера (вид нельзя передавать
	 * только цветом). Узел с детьми DOM-обвязка помечает стрелкой сама. Разделитель и общий реквизит —
	 * поля общих реквизитов таблиц конфигурации (cf-md-query-tables): у разделителя буква «Р», у общего
	 * реквизита «О».
	 */
	const KIND_LABELS = {
		field: { letter: 'П', word: 'поле' },
		separator: { letter: 'Р', word: 'разделитель' },
		commonAttribute: { letter: 'О', word: 'общий реквизит' },
		folder: { letter: 'П', word: 'папка' },
		path: { letter: 'П', word: 'поле' },
		container: { letter: 'П', word: 'группа полей' },
		calc: { letter: 'В', word: 'вычисляемое поле' },
		total: { letter: 'Р', word: 'ресурс' },
		param: { letter: '&', word: 'параметр' },
		dataParam: { letter: '&', word: 'параметр данных' },
		userField: { letter: 'П', word: 'пользовательское поле' },
		system: { letter: 'С', word: 'системное поле' },
		table: { letter: 'Т', word: 'таблица' },
		function: { letter: 'ƒ', word: 'функция' },
	};

	/**
	 * Кто побеждает при слиянии тёзок по пути: ресурс и вычисляемое поле — это то, что видит
	 * пользователь настроек, а поле набора под ними лишь даёт тип, если своего нет.
	 */
	const MERGE_RANK = { path: 0, container: 1, field: 2, separator: 2, commonAttribute: 2, folder: 2, userField: 2, system: 2, dataParam: 2, table: 2, calc: 3, total: 4 };

	// Те же буквы, что у WORD_RE подсветки: правила контекста и токенайзера не расходятся
	const IDENT_CHAR_RE = /[A-Za-zА-Яа-яЁё0-9_]/;
	const DIGIT_RE = /[0-9]/;

	function list(value) {
		return Array.isArray(value) ? value : [];
	}

	function text(value) {
		return typeof value === 'string' ? value : '';
	}

	/** Ключ сравнения без учёта регистра и с ё = е: так ищет и конфигуратор, и люди. */
	function fold(value) {
		return text(value).toLowerCase().replace(/ё/g, 'е');
	}

	/** Ключ дублей: только регистр — ё и е в идентификаторах платформы разные буквы. */
	function pathKey(value) {
		return text(value).toLowerCase();
	}

	/** Подпись типа по структурному valueType: локальные имена через запятую. */
	function compactType(valueType) {
		if (!valueType || typeof valueType !== 'object') {
			return '';
		}
		const parts = [];
		for (const name of list(valueType.types).concat(list(valueType.typeSets))) {
			const value = text(name);
			const colon = value.indexOf(':');
			parts.push(colon >= 0 ? value.slice(colon + 1) : value);
		}
		for (const name of list(valueType.definedTypes)) {
			parts.push(text(name));
		}
		return parts.filter(Boolean).join(', ');
	}

	/**
	 * Ограничение использования поля набора или вычисляемого поля: всегда объект — нет элемента в
	 * файле, значит, всё разрешено. null остаётся у тех, у кого ограничений не бывает (ресурс,
	 * системное поле): при слиянии тёзок такой узел не снимает чужой запрет.
	 */
	function restrictionOf(value) {
		const source = value && typeof value === 'object' ? value : {};
		return {
			field: source.field === true,
			condition: source.condition === true,
			group: source.group === true,
			order: source.order === true,
		};
	}

	function attributeRestrictionOf(value) {
		return value && typeof value === 'object' ? restrictionOf(value) : null;
	}

	// ---------- источник: модель cf-dcs-info ----------

	/** Разбор scope: «вид:аргумент», у связей двух наборов — «a|b». */
	function parseScope(scope) {
		const raw = text(scope);
		const colon = raw.indexOf(':');
		return {
			head: colon >= 0 ? raw.slice(0, colon) : raw,
			arg: colon >= 0 ? raw.slice(colon + 1) : '',
		};
	}

	/**
	 * Набор по имени или по пути «Объединение/Дочерний»: имена вложенных наборов в схеме не
	 * уникальны (одно имя бывает в двух объединениях), поэтому путь — единственный точный адрес.
	 */
	function findDataSet(model, name) {
		const parts = text(name).split('/').filter(Boolean);
		if (parts.length === 0) {
			return null;
		}
		if (parts.length > 1) {
			let level = list(model.dataSets);
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
			for (const item of sets) {
				if (item && item.name === parts[0]) {
					return item;
				}
			}
			for (const item of sets) {
				const nested = item ? walk(list(item.items)) : null;
				if (nested) {
					return nested;
				}
			}
			return null;
		}
		return walk(list(model.dataSets));
	}

	/**
	 * Поля набора и, у объединения, его вложенных наборов: папки — узлы, вложенные таблицы
	 * пропускаются. Поле вложенного набора берётся, только если у самого объединения такого пути
	 * нет: снаружи схема видит поля объединения, и запрет на них копия без ограничений не снимает.
	 */
	function dataSetFieldNodes(dataSet, out) {
		const own = new Set();
		for (const field of list(dataSet.fields)) {
			if (!field || !field.dataPath || field.kind === 'nested') {
				continue;
			}
			own.add(pathKey(field.dataPath));
			out.push({
				path: field.dataPath,
				kind: field.kind === 'folder' ? 'folder' : 'field',
				title: text(field.title),
				typeText: compactType(field.valueType),
				valueType: field.valueType || null,
				restrict: restrictionOf(field.useRestriction),
				attributeRestrict: attributeRestrictionOf(field.attributeUseRestriction),
			});
		}
		for (const item of list(dataSet.items)) {
			if (!item) {
				continue;
			}
			const nested = [];
			dataSetFieldNodes(item, nested);
			for (const node of nested) {
				if (!own.has(pathKey(node.path))) {
					out.push(node);
				}
			}
		}
	}

	function calculatedNodes(model, out) {
		for (const field of list(model.calculatedFields)) {
			if (field && field.name) {
				out.push({
					path: field.name,
					kind: 'calc',
					title: text(field.title),
					typeText: compactType(field.valueType),
					valueType: field.valueType || null,
					restrict: restrictionOf(field.useRestriction),
				});
			}
		}
	}

	function totalNodes(model, out) {
		for (const total of list(model.totalFields)) {
			const path = total ? text(total.name) : '';
			if (path) {
				out.push({ path: path, kind: 'total', title: '', typeText: '' });
			}
		}
	}

	/**
	 * Параметры схемы: в выражениях — «&Имя» (отдельное пространство имён), в поле «Параметр»
	 * связи — голое имя (bare).
	 */
	function parameterNodes(model, out, options) {
		const opts = options || {};
		for (const param of list(model.parameters)) {
			if (!param || !param.name || (opts.except && pathKey(param.name) === pathKey(opts.except))) {
				continue;
			}
			out.push({
				path: param.name,
				kind: 'param',
				bare: opts.bare === true,
				title: text(param.title),
				typeText: compactType(param.valueType),
				valueType: param.valueType || null,
			});
		}
	}

	/**
	 * Параметры данных как поля настроек. md-sparrow кладёт availableAsField, только когда элемент
	 * есть в файле, а платформа пишет его лишь со значением false: отсутствие ключа значит «доступен».
	 */
	function dataParameterNodes(model, out) {
		const params = list(model.parameters).filter((param) => param && param.name && param.availableAsField !== false);
		if (params.length === 0) {
			return;
		}
		out.push({ path: 'ПараметрыДанных', kind: 'container', title: 'Параметры данных' });
		for (const param of params) {
			out.push({
				path: 'ПараметрыДанных.' + param.name,
				kind: 'dataParam',
				title: text(param.title),
				typeText: compactType(param.valueType),
				valueType: param.valueType || null,
			});
		}
	}

	function userFieldNodes(settingsDto, out) {
		const fields = list(settingsDto && settingsDto.userFields).filter((field) => field && field.dataPath);
		if (fields.length === 0) {
			return;
		}
		out.push({ path: 'ПользовательскиеПоля', kind: 'container', title: 'Пользовательские поля' });
		for (const field of fields) {
			out.push({ path: field.dataPath, kind: 'userField', title: text(field.title) });
		}
	}

	function systemFieldNodes(out) {
		out.push({ path: 'СистемныеПоля', kind: 'container', title: 'Системные поля' });
		for (const field of SYSTEM_FIELDS) {
			out.push({ path: 'СистемныеПоля.' + field.name, kind: 'system', title: field.title });
		}
	}

	/**
	 * Узлы функций списка ('dcs' — выражения СКД, 'query' — язык запросов) для каталога.
	 *
	 * @param {'dcs'|'query'} which Имя списка.
	 * @param {'ru'|'en'} [lang] Язык вставляемого имени; по умолчанию русский.
	 */
	function functionNodes(which, lang) {
		let source = [];
		if (which === 'dcs') {
			source = DCS_FUNCTIONS;
		} else if (which === 'query') {
			source = QUERY_FUNCTIONS;
		}
		return source.map((item) => ({
			path: lang === 'en' ? item.nameEn : item.name,
			kind: 'function',
			title: '',
			typeText: FUNCTION_GROUPS[item.group] || '',
			group: item.group,
		}));
	}

	/**
	 * Плоский список узлов по модели cf-dcs-info и настройкам варианта для места ввода scope.
	 *
	 * scope: query · expr-calc · expr-total · expr-param[:сам параметр] · link-source:<набор> ·
	 * link-dest:<набор> · link-both:<a>|<b> · settings:selection|filter|group|order|any ·
	 * param-name · field-of-set:<набор> · total-field. Неизвестный scope — пустой список: подсказка
	 * лучше промолчит, чем предложит чужие имена.
	 *
	 * @returns {{nodes: object[], options: {section: string, paramsAtRoot: boolean}}}
	 */
	function sourceNodes(model, settingsDto, scope) {
		const schema = model && typeof model === 'object' ? model : {};
		const parsed = parseScope(scope);
		const nodes = [];
		const options = { section: '', paramsAtRoot: false };
		function allFields() {
			for (const dataSet of list(schema.dataSets)) {
				if (dataSet) {
					dataSetFieldNodes(dataSet, nodes);
				}
			}
		}
		function setFields(name) {
			const dataSet = findDataSet(schema, name);
			if (dataSet) {
				dataSetFieldNodes(dataSet, nodes);
			}
		}
		switch (parsed.head) {
			case 'query':
				// В тексте запроса подсказываются только &-параметры схемы
				parameterNodes(schema, nodes);
				options.paramsAtRoot = true;
				break;
			case 'expr-calc':
				// Вычисляемые поля в выражениях других вычисляемых полей не предлагаются
				allFields();
				parameterNodes(schema, nodes);
				nodes.push(...functionNodes('dcs'));
				options.paramsAtRoot = true;
				break;
			case 'expr-total':
				allFields();
				calculatedNodes(schema, nodes);
				parameterNodes(schema, nodes);
				// Выражение ресурса почти всегда агрегат: агрегатные функции — в начало списка
				nodes.push(...functionNodes('dcs').map((node) => Object.assign(node, { priority: node.group === 'aggregate' ? 1 : 0 })));
				options.paramsAtRoot = true;
				break;
			case 'expr-param':
				// Выражение параметра считается до запроса: полей ещё нет, только параметры и функции
				parameterNodes(schema, nodes, { except: parsed.arg });
				nodes.push(...functionNodes('dcs'));
				options.paramsAtRoot = true;
				break;
			case 'link-source':
			case 'link-dest':
				setFields(parsed.arg);
				nodes.push(...functionNodes('dcs'));
				break;
			case 'link-both': {
				const names = parsed.arg.split('|');
				for (const name of names) {
					setFields(name);
				}
				parameterNodes(schema, nodes);
				nodes.push(...functionNodes('dcs'));
				options.paramsAtRoot = true;
				break;
			}
			case 'settings': {
				const section = Object.prototype.hasOwnProperty.call(SECTION_RESTRICTION, parsed.arg) ? parsed.arg : 'any';
				options.section = section;
				allFields();
				calculatedNodes(schema, nodes);
				totalNodes(schema, nodes);
				dataParameterNodes(schema, nodes);
				userFieldNodes(settingsDto, nodes);
				if (SYSTEM_FIELD_SECTIONS.indexOf(section) >= 0) {
					systemFieldNodes(nodes);
				}
				break;
			}
			case 'param-name':
				parameterNodes(schema, nodes, { bare: true });
				break;
			case 'field-of-set':
				setFields(parsed.arg);
				break;
			case 'total-field':
				// Поле ресурса: путь поля набора или вычисляемого поля, без параметров и функций — это
				// путь, а не выражение
				allFields();
				calculatedNodes(schema, nodes);
				break;
			default:
				break;
		}
		return { nodes: nodes, options: options };
	}

	// ---------- дерево каталога ----------

	function makeNode(name, path, kind) {
		return {
			name: name,
			path: path,
			kind: kind,
			title: '',
			typeText: '',
			children: [],
			restrict: null,
			attributeRestrict: null,
			valueType: null,
			priority: 0,
		};
	}

	/**
	 * Ограничение тёзок складывается по «И»: поле запрещено в разделе, только если запрещены все
	 * копии, у которых ограничения бывают; null (ресурс и т. п.) на итог не влияет.
	 */
	function mergeRestriction(a, b) {
		if (!a || !b) {
			return a || b || null;
		}
		return {
			field: a.field && b.field,
			condition: a.condition && b.condition,
			group: a.group && b.group,
			order: a.order && b.order,
		};
	}

	/** Сливает описание узла в существующий: вид — по рангу, пустые свойства добираются у проигравшего. */
	function mergeInto(target, source, virtual) {
		const sourceWins = virtual || (MERGE_RANK[source.kind] || 0) > (MERGE_RANK[target.kind] || 0);
		const first = sourceWins ? source : target;
		const second = sourceWins ? target : source;
		target.kind = text(first.kind) || text(second.kind) || 'field';
		target.title = text(first.title) || text(second.title);
		target.typeText = text(first.typeText) || text(second.typeText);
		target.valueType = first.valueType || second.valueType || null;
		target.restrict = virtual ? source.restrict || null : mergeRestriction(target.restrict, source.restrict || null);
		target.attributeRestrict = first.attributeRestrict || second.attributeRestrict || null;
		target.priority = Math.max(target.priority || 0, source.priority || 0);
		for (const key of ['bare', 'group', 'expandable']) {
			if (source[key] !== undefined && target[key] === undefined) {
				target[key] = source[key];
			}
		}
	}

	/** Узел из описания источника: только известные свойства, чтобы чужие поля не утекали в UI. */
	function nodeFromSpec(spec, name, path) {
		const node = makeNode(name, path, text(spec.kind) || 'field');
		mergeInto(node, spec, true);
		return node;
	}

	/** Обрезка узлов, запрещённых в разделе: узел с детьми остаётся промежуточным, чтобы дети были достижимы. */
	function pruneRestricted(nodes, flag) {
		const out = [];
		for (const node of nodes) {
			node.children = pruneRestricted(node.children, flag);
			if (node.restrict && node.restrict[flag]) {
				if (node.children.length === 0) {
					continue;
				}
				node.kind = 'path';
				node.restricted = true;
			}
			out.push(node);
		}
		return out;
	}

	/**
	 * Дерево каталога из плоского списка узлов {path, kind, title?, typeText?, valueType?,
	 * restrict?, attributeRestrict?, priority?, bare?}.
	 *
	 * Пути через точку раскладываются в промежуточные узлы (kind 'path'), дубли схлопываются без
	 * учёта регистра, тёзки сливаются по рангу вида. Параметры (kind 'param' без bare) и функции
	 * живут в своих пространствах имён: поле «Период» и параметр «&Период» — разные строки.
	 *
	 * @param {object[]} nodes Узлы источника.
	 * @param {{section?: string, paramsAtRoot?: boolean}} [options] Раздел настроек для
	 *   ограничений использования и признак «параметры видны на верхнем уровне как &Имя».
	 */
	function catalogFromNodes(nodes, options) {
		const opts = options || {};
		const section = text(opts.section);
		const flag = SECTION_RESTRICTION[section] || '';
		const rootNodes = [];
		const params = [];
		const functions = [];
		const index = new Map();

		function addFlat(target, spec) {
			const name = text(spec.path);
			if (!name) {
				return;
			}
			const key = pathKey(name);
			const existing = target.find((node) => pathKey(node.name) === key);
			if (existing) {
				mergeInto(existing, spec, false);
			} else {
				target.push(nodeFromSpec(spec, name, name));
			}
		}

		for (const spec of list(nodes)) {
			if (!spec || typeof spec !== 'object') {
				continue;
			}
			if (spec.kind === 'param' && spec.bare !== true) {
				addFlat(params, spec);
				continue;
			}
			if (spec.kind === 'function') {
				addFlat(functions, spec);
				continue;
			}
			const segments = text(spec.path).split('.');
			if (segments.some((segment) => segment === '')) {
				continue;
			}
			let level = rootNodes;
			let prefixKey = '';
			let prefixPath = '';
			for (let i = 0; i < segments.length; i += 1) {
				prefixKey = prefixKey ? prefixKey + '.' + pathKey(segments[i]) : pathKey(segments[i]);
				prefixPath = prefixPath ? prefixPath + '.' + segments[i] : segments[i];
				const last = i === segments.length - 1;
				let node = index.get(prefixKey);
				if (!node) {
					node = last ? nodeFromSpec(spec, segments[i], prefixPath) : makeNode(segments[i], prefixPath, 'path');
					index.set(prefixKey, node);
					level.push(node);
				} else if (last) {
					mergeInto(node, spec, node.kind === 'path' && !node.restricted);
				}
				// Путь детей — от написания узла, а не от регистра этого вхождения
				prefixPath = node.path;
				level = node.children;
			}
		}

		return {
			nodes: flag ? pruneRestricted(rootNodes, flag) : rootNodes,
			params: params,
			functions: functions,
			section: section,
			paramsAtRoot: opts.paramsAtRoot === true,
		};
	}

	/**
	 * Каталог для места ввода: источник по модели схемы плюс раскладка в дерево.
	 *
	 * @param {object} model Ответ cf-dcs-info.
	 * @param {object|null} settingsDto Настройки варианта (cf-dcs-settings-info) — для
	 *   пользовательских полей; вне настроек null.
	 * @param {string} scope Место ввода (см. sourceNodes).
	 * @param {{typeText?: function}} [options] typeText(valueType) — подпись типа строки списка
	 *   (обвязка подаёт русское представление модуля типов, как в колонке «Тип»); без неё —
	 *   компактные XML-имена (compactType). У узлов без структурного типа подпись пустая.
	 */
	function buildCatalog(model, settingsDto, scope, options) {
		const source = sourceNodes(model, settingsDto, scope);
		const typeText = options && typeof options.typeText === 'function' ? options.typeText : null;
		if (typeText) {
			for (const node of source.nodes) {
				// У функций в колонке типа — группа функций, а не тип значения
				if (node && node.kind !== 'function') {
					node.typeText = node.valueType ? text(typeText(node.valueType)) : '';
				}
			}
		}
		return catalogFromNodes(source.nodes, source.options);
	}

	function findByPath(nodes, path) {
		const segments = text(path).split('.');
		let level = nodes;
		let node = null;
		const chain = [];
		for (const segment of segments) {
			const key = pathKey(segment);
			node = level.find((item) => pathKey(item.name) === key) || null;
			if (!node) {
				return { node: null, chain: chain };
			}
			chain.push(node);
			level = node.children;
		}
		return { node: node, chain: chain };
	}

	/** Дети уровня 2 от точки расширения: путь достраивается, форма — как у узлов каталога. */
	function extraNodes(extraChildren, owner, parentPath, info) {
		if (typeof extraChildren !== 'function') {
			return [];
		}
		const out = [];
		for (const spec of list(extraChildren(owner, parentPath, info))) {
			if (spec && text(spec.name || spec.path)) {
				const name = text(spec.name) || text(spec.path);
				out.push(nodeFromSpec(spec, name, parentPath + '.' + name));
			}
		}
		return out;
	}

	/**
	 * Свои дети узла и дети по типу вместе: путь «Контрагент.ИНН», записанный в наборе, не
	 * должен прятать остальные реквизиты Контрагента. Записанный ребёнок главнее тёзки по типу —
	 * у него заголовок и ограничения схемы.
	 */
	function withExtra(own, extra) {
		if (extra.length === 0) {
			return own.slice();
		}
		const taken = new Set(own.map((node) => pathKey(node.name)));
		return own.concat(extra.filter((node) => !taken.has(pathKey(node.name))));
	}

	/**
	 * Варианты для контекста: дети узла по parentPath без учёта регистра.
	 *
	 * На верхнем уровне пути — узлы, функции и, если каталог так решил, параметры как «&Имя».
	 * В режиме param — параметры, после «&Имя.» — их свойства. Свои дети узла дополняются детьми
	 * точки расширения extraChildren(узел|null, parentPath, {mode, chain}) — уровня «через точку»
	 * по типу; chain — узлы каталога от корня до последнего найденного по parentPath, дальше путь
	 * идёт по типам. Дети по типу отбрасываются, если у какого-то предка в этом разделе запрещены
	 * реквизиты (attributeUseRestriction).
	 *
	 * @param {object} catalog Результат buildCatalog/catalogFromNodes.
	 * @param {{mode: string, parentPath: string}|string} ctx Контекст contextAt или parentPath пути.
	 * @param {function} [extraChildren] Дети по типу узла.
	 * @returns {object[]} Новый массив узлов (сами узлы общие с каталогом).
	 */
	function childrenOf(catalog, ctx, extraChildren) {
		const context = typeof ctx === 'string' ? { mode: 'path', parentPath: ctx } : ctx || {};
		const cat = catalog || {};
		const parentPath = text(context.parentPath);
		if (context.mode === 'param') {
			if (!parentPath) {
				return list(cat.params).slice();
			}
			const found = findByPath(list(cat.params), parentPath);
			const own = found.node ? found.node.children : [];
			return withExtra(own, extraNodes(extraChildren, found.node, parentPath, { mode: 'param', chain: found.chain }));
		}
		if (context.mode !== 'path') {
			return [];
		}
		if (!parentPath) {
			return list(cat.nodes)
				.concat(cat.paramsAtRoot ? list(cat.params) : [])
				.concat(list(cat.functions));
		}
		const found = findByPath(list(cat.nodes), parentPath);
		const own = found.node ? found.node.children : [];
		const flag = SECTION_RESTRICTION[text(cat.section)] || '';
		if (flag && found.chain.some((node) => node.attributeRestrict && node.attributeRestrict[flag])) {
			return own.slice();
		}
		return withExtra(own, extraNodes(extraChildren, found.node, parentPath, { mode: 'path', chain: found.chain }));
	}

	// ---------- контекст каретки ----------

	function isIdentChar(ch) {
		return typeof ch === 'string' && ch.length === 1 && IDENT_CHAR_RE.test(ch);
	}

	/**
	 * Каретка внутри строки или комментария — по правилам токенайзера подсветки: строка `"…"` с
	 * `""` и комментарий `//` кончаются на границе строки текста, поэтому хватает текущей строки.
	 */
	function insideLiteral(source, lineStart, caret) {
		let i = lineStart;
		while (i < caret) {
			const ch = source[i];
			if (ch === '/' && source[i + 1] === '/') {
				return i + 2 <= caret;
			}
			if (ch === '"') {
				let j = i + 1;
				let closed = false;
				while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
					if (source[j] === '"') {
						if (source[j + 1] === '"') {
							j += 2;
							continue;
						}
						closed = true;
						j += 1;
						break;
					}
					j += 1;
				}
				if (!closed || caret < j) {
					return true;
				}
				i = j;
				continue;
			}
			i += 1;
		}
		return false;
	}

	/**
	 * Что подсказывать в позиции каретки.
	 *
	 * @param {string} source Текст поля ввода.
	 * @param {number} caret Позиция каретки (selectionStart).
	 * @returns {{mode: 'path'|'param'|'none', parentPath: string, prefix: string,
	 *   replaceStart: number, replaceEnd: number}} replaceStart..replaceEnd — что заменит выбор:
	 *   набранное начало слова и хвост идентификатора справа, чтобы посреди слова не остался обрывок.
	 */
	function contextAt(source, caret) {
		const value = text(source);
		const at = Math.max(0, Math.min(typeof caret === 'number' ? caret : value.length, value.length));
		const none = { mode: 'none', parentPath: '', prefix: '', replaceStart: at, replaceEnd: at };
		const lineStart = value.lastIndexOf('\n', at - 1) + 1;
		if (insideLiteral(value, lineStart, at)) {
			return none;
		}
		let start = at;
		while (start > lineStart && (isIdentChar(value[start - 1]) || value[start - 1] === '.')) {
			start -= 1;
		}
		const tail = value.slice(start, at);
		const segments = tail.split('.');
		const prefix = segments.pop();
		// «.Поле» после скобки и «А..Б» к каталогу не привязать; сегмент с цифры — число, а не путь
		if (segments.some((segment) => segment === '') || tail.split('.').some((segment) => DIGIT_RE.test(segment.charAt(0)))) {
			return none;
		}
		let end = at;
		while (end < value.length && isIdentChar(value[end])) {
			end += 1;
		}
		return {
			mode: start > 0 && value[start - 1] === '&' ? 'param' : 'path',
			parentPath: segments.join('.'),
			prefix: prefix,
			replaceStart: at - prefix.length,
			replaceEnd: end,
		};
	}

	// ---------- ранжирование и вставка ----------

	const KIND_ORDER = ['field', 'separator', 'commonAttribute', 'folder', 'path', 'calc', 'total', 'container', 'dataParam', 'userField', 'system', 'table', 'param', 'function'];

	// Один коллатор на модуль: localeCompare на каждое сравнение заново разбирает локаль, а
	// фильтр работает на каждое нажатие по тысячам полей
	const COLLATOR = new Intl.Collator('ru');

	function kindOrder(kind) {
		const position = KIND_ORDER.indexOf(kind);
		return position < 0 ? KIND_ORDER.length : position;
	}

	/**
	 * Фильтр и порядок строк: совпадение по началу имени, затем по вхождению в имя, затем по
	 * заголовку (синониму); без учёта регистра, ё = е. Внутри группы — priority по убыванию и
	 * алфавит. Первая строка становится активной — так позиционирует и конфигуратор.
	 *
	 * @returns {{item: object, group: number, match: {on: 'name'|'title', start: number, end: number}|null}[]}
	 *   match — границы совпадения для подсветки в имени или заголовке; при пустом префиксе null.
	 */
	function rank(items, prefix) {
		const needle = fold(prefix);
		const out = [];
		for (const item of list(items)) {
			if (!item) {
				continue;
			}
			if (!needle) {
				out.push({ item: item, group: 0, match: null });
				continue;
			}
			const name = fold(item.name);
			const at = name.indexOf(needle);
			if (at >= 0) {
				out.push({ item: item, group: at === 0 ? 0 : 1, match: { on: 'name', start: at, end: at + needle.length } });
				continue;
			}
			const titleAt = fold(item.title).indexOf(needle);
			if (titleAt >= 0) {
				out.push({ item: item, group: 2, match: { on: 'title', start: titleAt, end: titleAt + needle.length } });
			}
		}
		return out.sort(
			(a, b) =>
				a.group - b.group ||
				(b.item.priority || 0) - (a.item.priority || 0) ||
				COLLATOR.compare(text(a.item.name), text(b.item.name)) ||
				kindOrder(a.item.kind) - kindOrder(b.item.kind)
		);
	}

	/**
	 * Вставка выбранной строки вместо набранного слова.
	 *
	 * Имена вставляются как есть, без квадратных скобок: пути полей — идентификаторы через точку.
	 * Функция получает «Имя(» (вторую скобку не дублирует), параметр в выражении — «&Имя».
	 *
	 * @returns {{text: string, caret: number}}
	 */
	function applyItem(source, ctx, item) {
		const value = text(source);
		if (!ctx || ctx.mode === 'none' || !item) {
			const caret = ctx && typeof ctx.replaceEnd === 'number' ? ctx.replaceEnd : value.length;
			return { text: value, caret: caret };
		}
		const start = ctx.replaceStart;
		const end = ctx.replaceEnd;
		const name = text(item.name);
		let insert = name;
		let skip = 0;
		if (item.kind === 'function') {
			if (value[end] === '(') {
				skip = 1;
			} else {
				insert = name + '(';
			}
		} else if (item.kind === 'param' && item.bare !== true && ctx.mode === 'path' && !text(ctx.parentPath)) {
			insert = '&' + name;
		}
		return {
			text: value.slice(0, start) + insert + value.slice(end),
			caret: start + insert.length + skip,
		};
	}

	/** Подпись строки для скринридера: вид словом, имя, заголовок и тип. */
	function itemLabel(item) {
		if (!item) {
			return '';
		}
		const kind = KIND_LABELS[item.kind] || KIND_LABELS.field;
		const name = item.kind === 'param' && item.bare !== true ? '&' + text(item.name) : text(item.name);
		const parts = [kind.word + ' ' + name];
		if (text(item.title) && item.title !== item.name) {
			parts.push(item.title);
		}
		if (text(item.typeText)) {
			parts.push(item.typeText);
		}
		return parts.join(', ');
	}

	// ---------- положение списка ----------

	/** Отступ списка от краёв окна: вплотную к краю его не видно за рамкой webview. */
	const POPUP_MARGIN = 4;

	/**
	 * Положение списка у якоря (метка каретки или нижний край поля): снизу, у нижнего края —
	 * вверх, по горизонтали прижатие к окну. Если не помещается ни снизу, ни сверху, список встаёт
	 * туда, где места больше, и maxHeight говорит, до какой высоты его ужать.
	 *
	 * @param {{left: number, top: number, bottom: number}} anchorRect Прямоугольник якоря в окне.
	 * @param {{width: number, height: number}} popupSize Размер списка.
	 * @param {{width: number, height: number}} viewport Размер окна.
	 * @returns {{left: number, top: number, above: boolean, maxHeight: number}}
	 */
	function placePopup(anchorRect, popupSize, viewport) {
		const anchor = anchorRect || { left: 0, top: 0, bottom: 0 };
		const width = Math.max(0, (popupSize && popupSize.width) || 0);
		const height = Math.max(0, (popupSize && popupSize.height) || 0);
		const viewWidth = (viewport && viewport.width) || 0;
		const viewHeight = (viewport && viewport.height) || 0;
		const below = viewHeight - POPUP_MARGIN - anchor.bottom;
		const aboveSpace = anchor.top - POPUP_MARGIN;
		let top = anchor.bottom;
		let above = false;
		let maxHeight = height;
		if (height > below) {
			if (height <= aboveSpace) {
				above = true;
				top = anchor.top - height;
			} else if (aboveSpace > below) {
				above = true;
				maxHeight = Math.max(0, aboveSpace);
				top = anchor.top - maxHeight;
			} else {
				maxHeight = Math.max(0, below);
			}
		}
		let left = anchor.left;
		if (left + width > viewWidth - POPUP_MARGIN) {
			left = viewWidth - POPUP_MARGIN - width;
		}
		if (left < POPUP_MARGIN) {
			left = POPUP_MARGIN;
		}
		return { left: left, top: top, above: above, maxHeight: maxHeight };
	}

	// ---------- поведение списка: решения DOM-обвязки ----------

	/** Шаг PageUp/PageDown: чуть меньше видимой высоты списка (10 строк), чтобы строка-ориентир оставалась на экране. */
	const PAGE_STEP = 8;

	/**
	 * Сколько строк рисуется за раз. На тысячах полей список строится окном вокруг активной строки:
	 * клавиши листают весь список, мышь — нарисованное окно, ввод сужает выбор.
	 */
	const MAX_ROWS = 100;

	/**
	 * Что делать со списком после ввода в поле.
	 *
	 * Буква открывает список, «.» — уровень пути, «&» — параметры. При открытом списке буквы,
	 * цифры и удаление перефильтровывают, а пробел, знак операции и выход каретки из слова
	 * закрывают. Цифра закрытый список не открывает: с неё начинаются числа. Есть ли что
	 * показать, решает обвязка: пустой список не открывается.
	 *
	 * @param {boolean} open Список сейчас открыт.
	 * @param {string} typed Введённый символ; '' — удаление, вставка из буфера, сдвиг каретки.
	 * @param {object} ctx contextAt после ввода.
	 * @param {{letters?: boolean}} [options] letters:false — буква открывает список только после
	 *   «&» (текст запроса: там подсказываются только параметры).
	 * @returns {'open'|'refilter'|'close'|'keep'} keep — закрытый список не трогать.
	 */
	function inputAction(open, typed, ctx, options) {
		const idle = open ? 'close' : 'keep';
		const context = ctx || {};
		if (context.mode !== 'path' && context.mode !== 'param') {
			return idle;
		}
		const parentPath = text(context.parentPath);
		const prefix = text(context.prefix);
		const ch = text(typed);
		if (ch === '&') {
			return context.mode === 'param' && parentPath === '' && prefix === '' ? 'open' : idle;
		}
		if (ch === '.') {
			return parentPath !== '' && prefix === '' ? 'open' : idle;
		}
		if (ch.length === 1 && isIdentChar(ch)) {
			if (open) {
				return 'refilter';
			}
			if (DIGIT_RE.test(ch)) {
				return 'keep';
			}
			return context.mode === 'param' || !options || options.letters !== false ? 'open' : 'keep';
		}
		if (ch !== '') {
			return idle;
		}
		if (!open) {
			return 'keep';
		}
		// Каретка осталась в слове (или сразу за «&», «Путь.») — список следует за ней, иначе закрывается
		return context.mode === 'param' || prefix !== '' || parentPath !== '' ? 'refilter' : 'close';
	}

	/**
	 * Активная строка после клавиши: стрелки ходят по кругу, PageUp/PageDown — на PAGE_STEP с
	 * упором в край, Home/End — к краям. Индексы — по всему ранжированному списку, а не по
	 * нарисованному окну.
	 *
	 * @returns {number} -1 — строк нет.
	 */
	function nextActive(index, count, key) {
		const total = Math.max(0, Math.floor(count || 0));
		if (total === 0) {
			return -1;
		}
		const current = typeof index === 'number' && index >= 0 ? Math.min(index, total - 1) : -1;
		switch (key) {
			case 'ArrowDown':
				return current + 1 >= total ? 0 : current + 1;
			case 'ArrowUp':
				return current <= 0 ? total - 1 : current - 1;
			case 'PageDown':
				return Math.min(total - 1, Math.max(current, 0) + PAGE_STEP);
			case 'PageUp':
				return Math.max(0, current - PAGE_STEP);
			case 'Home':
				return 0;
			case 'End':
				return total - 1;
			default:
				return Math.max(current, 0);
		}
	}

	/**
	 * Начало нарисованного окна строк. Окно сдвигается, только когда активная строка вышла за его
	 * край: так список не прыгает на каждом шаге стрелкой.
	 */
	function windowStart(active, start, count, size) {
		const limit = Math.max(1, Math.floor(size || MAX_ROWS));
		const total = Math.max(0, Math.floor(count || 0));
		if (total <= limit) {
			return 0;
		}
		let from = Math.max(0, Math.min(Math.floor(start || 0), total - limit));
		const at = Math.max(0, Math.min(typeof active === 'number' ? active : 0, total - 1));
		if (at < from) {
			from = at;
		} else if (at >= from + limit) {
			from = at - limit + 1;
		}
		return from;
	}

	/**
	 * Строка, на которой открывается полный список («⋯»): первое имя, начинающееся с набранного,
	 * затем первое с вхождением, иначе первая строка — как конфигуратор встаёт на лучшее совпадение.
	 */
	function bestIndex(ranked, prefix) {
		const rows = list(ranked);
		const needle = fold(prefix);
		if (!needle) {
			return 0;
		}
		const names = rows.map((row) => fold(row && row.item ? row.item.name : ''));
		const start = names.findIndex((name) => name.indexOf(needle) === 0);
		if (start >= 0) {
			return start;
		}
		const inside = names.findIndex((name) => name.indexOf(needle) >= 0);
		return inside >= 0 ? inside : 0;
	}

	/** Куски текста для подсветки совпадения: [{text, hit}], пустые куски отброшены. */
	function splitMatch(value, start, end) {
		const source = text(value);
		const from = Math.max(0, Math.min(typeof start === 'number' ? start : 0, source.length));
		const to = Math.max(from, Math.min(typeof end === 'number' ? end : from, source.length));
		return [
			{ text: source.slice(0, from), hit: false },
			{ text: source.slice(from, to), hit: true },
			{ text: source.slice(to), hit: false },
		].filter((part) => part.text !== '');
	}

	/**
	 * Метка вида строки: буква вида и стрелка у узла с детьми (за ним продолжается путь через
	 * точку); expandable — дети есть по типу, хотя в каталоге их ещё нет.
	 */
	function kindLetter(item) {
		const kind = (item && KIND_LABELS[item.kind]) || KIND_LABELS.field;
		const hasChildren = Boolean(item && ((Array.isArray(item.children) && item.children.length > 0) || item.expandable === true));
		return kind.letter + (hasChildren ? '▸' : '');
	}

	/**
	 * Части строки списка: метка вида, имя и заголовок кусками с совпадением, тип. Параметр в
	 * выражении показывается «&Имя» — так он и вставится; границы совпадения сдвигаются на «&».
	 */
	function rowParts(entry) {
		const item = entry && entry.item ? entry.item : {};
		const match = entry && entry.match ? entry.match : null;
		const amp = item.kind === 'param' && item.bare !== true ? '&' : '';
		const nameText = amp + text(item.name);
		const titleText = text(item.title) && item.title !== item.name ? text(item.title) : '';
		return {
			letter: kindLetter(item),
			name:
				match && match.on === 'name'
					? splitMatch(nameText, match.start + amp.length, match.end + amp.length)
					: splitMatch(nameText, 0, 0),
			title: match && match.on === 'title' ? splitMatch(titleText, match.start, match.end) : splitMatch(titleText, 0, 0),
			typeText: text(item.typeText),
		};
	}

	/** Сообщение для скринридера (aria-live) при открытии и перефильтровке. */
	function listSummary(count) {
		const total = Math.max(0, Math.floor(count || 0));
		return total === 0 ? 'Вариантов нет.' : 'Вариантов: ' + total + '.';
	}

	/** Подпись под окном строк, когда нарисованы не все: какие строки видны и что делать дальше. */
	function windowNote(start, end, count) {
		const total = Math.max(0, Math.floor(count || 0));
		const from = Math.max(0, Math.floor(start || 0));
		const to = Math.min(total, Math.max(from, Math.floor(end || 0)));
		if (from === 0 && to >= total) {
			return '';
		}
		return 'Строки ' + (from + 1) + '–' + to + ' из ' + total + ': уточните ввод или листайте клавишами.';
	}

	const api = {
		FUNCTION_GROUPS: FUNCTION_GROUPS,
		QUERY_FUNCTIONS: QUERY_FUNCTIONS,
		DCS_FUNCTIONS: DCS_FUNCTIONS,
		KIND_LABELS: KIND_LABELS,
		POPUP_MARGIN: POPUP_MARGIN,
		PAGE_STEP: PAGE_STEP,
		MAX_ROWS: MAX_ROWS,
		compactType: compactType,
		functionNodes: functionNodes,
		catalogFromNodes: catalogFromNodes,
		buildCatalog: buildCatalog,
		childrenOf: childrenOf,
		contextAt: contextAt,
		rank: rank,
		applyItem: applyItem,
		itemLabel: itemLabel,
		placePopup: placePopup,
		inputAction: inputAction,
		nextActive: nextActive,
		windowStart: windowStart,
		bestIndex: bestIndex,
		splitMatch: splitMatch,
		kindLetter: kindLetter,
		rowParts: rowParts,
		listSummary: listSummary,
		windowNote: windowNote,
	};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (root) {
		root.DcsComplete = api;
	}
})(typeof window === 'undefined' ? globalThis : window);
