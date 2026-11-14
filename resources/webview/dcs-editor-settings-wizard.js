/**
 * Конструктор настроек СКД (мастер «Список / Таблица / Диаграмма»): чистые функции без DOM.
 *
 * Как и dcs-editor-highlight.js, файл живёт двумя жизнями: webview подключает его отдельным
 * <script> и берёт функции из window.DcsSettingsWizard, а node-тесты исполняют его в песочнице и
 * читают module.exports. Главные расчёты:
 * - initialWizardState — разбор DTO варианта (cf-dcs-settings-info) в состояние мастера, чтобы
 *   повторный запуск открывался с тем, что уже собрано;
 * - planWizardOperations — список мутаций настроек для одного пакета `batch`.
 * Рядом — то, что диалогу нужно без DOM: шаги по виду отчёта, дерево предпросмотра, предупреждения
 * шагов и проверка пути «Другого поля…» — их проверяют те же node-тесты.
 *
 * Мастер заменяет только структуру, выбранные поля и порядок варианта: отбор, параметры, условное
 * оформление и пользовательские поля остаются. Пересобирается только изменённое: неизменённые узлы
 * сохраняют свои байты и пользовательские настройки (userSettingID).
 */
(function (root) {
	'use strict';

	/** Виды отчёта мастера: первый шаг. */
	var REPORT_TYPES = Object.freeze([
		Object.freeze({ value: 'list', label: 'Список' }),
		Object.freeze({ value: 'table', label: 'Таблица' }),
		Object.freeze({ value: 'chart', label: 'Диаграмма' }),
	]);

	/**
	 * Цели группировок по виду отчёта. «Таблицы» у таблицы и диаграммы — группировки над узлом:
	 * цепочка групп в корне, а таблица или диаграмма лежит в самой глубокой.
	 */
	var TARGETS = Object.freeze({
		list: Object.freeze(['levels']),
		table: Object.freeze(['tables', 'rows', 'columns']),
		chart: Object.freeze(['tables', 'points', 'series']),
	});

	var TARGET_LABELS = Object.freeze({
		levels: 'Группировки',
		tables: 'Таблицы',
		rows: 'Строки',
		columns: 'Колонки',
		points: 'Точки',
		series: 'Серии',
	});

	/** Подпись `Items` — «Без иерархии», как у типа группировки в панели настроек. */
	var GROUP_TYPES = Object.freeze([
		Object.freeze({ value: 'Items', label: 'Без иерархии' }),
		Object.freeze({ value: 'Hierarchy', label: 'Иерархия' }),
		Object.freeze({ value: 'HierarchyOnly', label: 'Только иерархия' }),
	]);

	var ORDER_TYPES = Object.freeze([
		Object.freeze({ value: 'Asc', label: 'По возрастанию' }),
		Object.freeze({ value: 'Desc', label: 'По убыванию' }),
	]);

	var CHART_TYPE_GROUPS = Object.freeze([
		Object.freeze({ id: 'lines', label: 'Графики' }),
		Object.freeze({ id: 'columns', label: 'Гистограммы' }),
		Object.freeze({ id: 'bars', label: 'Горизонтальные гистограммы' }),
		Object.freeze({ id: 'pies', label: 'Круговые и кольцевые' }),
		Object.freeze({ id: 'stock', label: 'Биржевые' }),
		Object.freeze({ id: 'isometric', label: 'Изометрические' }),
		Object.freeze({ id: 'surfaces', label: 'Поверхности' }),
		Object.freeze({ id: 'radar', label: 'Радарные' }),
		Object.freeze({ id: 'other', label: 'Прочие' }),
	]);

	function chart(value, label, group, since) {
		var item = { value: value, label: label, group: group };
		if (since) {
			item.since = since;
		}
		return Object.freeze(item);
	}

	/**
	 * Все 47 лексем перечисления ChartType из XSD data-ui (одинаковы во всех форматах 2.10–2.21).
	 * Подписи свои — по смыслу имён значений. У кольцевых since — версия появления по модели EDT
	 * (8.3.15): окно её показывает, но кольцевые не скрывает.
	 */
	var CHART_TYPES = Object.freeze([
		chart('Line', 'График', 'lines'),
		chart('Step', 'Ступенчатый график', 'lines'),
		chart('StackedLine', 'График с накоплением', 'lines'),
		chart('Area', 'Области', 'lines'),
		chart('StackedArea', 'Области с накоплением', 'lines'),
		chart('NormalizedArea', 'Нормированные области', 'lines'),
		chart('Column', 'Гистограмма', 'columns'),
		chart('StackedColumn', 'Гистограмма с накоплением', 'columns'),
		chart('NormalizedColumn', 'Нормированная гистограмма', 'columns'),
		chart('Column3D', 'Объёмная гистограмма', 'columns'),
		chart('StackedColumn3D', 'Объёмная гистограмма с накоплением', 'columns'),
		chart('NormalizedColumn3D', 'Объёмная нормированная гистограмма', 'columns'),
		chart('Bar', 'Горизонтальная гистограмма', 'bars'),
		chart('StackedBar', 'Горизонтальная гистограмма с накоплением', 'bars'),
		chart('NormalizedBar', 'Горизонтальная нормированная гистограмма', 'bars'),
		chart('Bar3D', 'Горизонтальная объёмная гистограмма', 'bars'),
		chart('StackedBar3D', 'Горизонтальная объёмная гистограмма с накоплением', 'bars'),
		chart('NormalizedBar3D', 'Горизонтальная объёмная нормированная гистограмма', 'bars'),
		chart('Pie', 'Круговая', 'pies'),
		chart('Pie3D', 'Объёмная круговая', 'pies'),
		chart('Donut', 'Кольцевая', 'pies', '8.3.15'),
		chart('Donut3D', 'Объёмная кольцевая', 'pies', '8.3.15'),
		chart('Stock', 'Биржевая', 'stock'),
		chart('OpenHighLowClose', 'Биржевая со свечами', 'stock'),
		chart('BarGraph', 'Изометрическая столбчатая', 'isometric'),
		chart('CeilGraph', 'Изометрическая сплошная', 'isometric'),
		chart('TapeGraph', 'Изометрическая ленточная', 'isometric'),
		chart('PyramidGraph', 'Изометрическая пирамидальная', 'isometric'),
		chart('WireframeSurface', 'Каркасная поверхность', 'surfaces'),
		chart('Surface', 'Поверхность', 'surfaces'),
		chart('ConvexSurface', 'Выпуклая поверхность', 'surfaces'),
		chart('ConcaveSurface', 'Вогнутая поверхность', 'surfaces'),
		chart('ShadedSurface', 'Поверхность с тенями', 'surfaces'),
		chart('RadarLine', 'Радар', 'radar'),
		chart('RadarArea', 'Радар с областями', 'radar'),
		chart('RadarStackedLine', 'Радар с накоплением', 'radar'),
		chart('RadarStackedArea', 'Радар с областями и накоплением', 'radar'),
		chart('RadarNormalizedArea', 'Радар с нормированными областями', 'radar'),
		chart('Waterfall', 'Каскадная', 'other'),
		chart('Honeycomb', 'Сотовая', 'other'),
		chart('Gauge', 'Шкала', 'other'),
		chart('Funnel', 'Воронка', 'other'),
		chart('Funnel3D', 'Объёмная воронка', 'other'),
		chart('NormalizedFunnel', 'Нормированная воронка', 'other'),
		chart('NormalizedFunnel3D', 'Объёмная нормированная воронка', 'other'),
		chart('Scatter', 'Точечная', 'other'),
		chart('Bubble', 'Пузырьковая', 'other'),
	]);

	/** Тип новой диаграммы, если в варианте его нет. */
	var DEFAULT_CHART_TYPE = 'Column';

	var CHART_TYPE_PARAMETER = 'ТипДиаграммы';

	var CHART_TYPE_VALUE = 'v8ui:ChartType';

	/** Свойства элементов, которые принимают мутации настроек: прочее md-sparrow отвергает. */
	var SELECTION_KEYS = ['kind', 'use', 'field', 'title', 'titleKind', 'placement', 'items', 'viewMode'];
	var ORDER_KEYS = ['kind', 'use', 'field', 'orderType', 'autoOrder', 'distinctNullValues', 'viewMode'];
	var GROUP_FIELD_KEYS = ['field', 'groupType', 'periodAdditionType', 'periodAdditionBegin', 'periodAdditionEnd'];

	/** Умолчания пятёрки GroupItemField у писателя: с ними `{field}` и прочитанное поле — одно. */
	var GROUP_FIELD_DEFAULTS = {
		groupType: 'Items',
		periodAdditionType: 'None',
		periodAdditionBegin: { type: 'xs:dateTime', text: '0001-01-01T00:00:00' },
		periodAdditionEnd: { type: 'xs:dateTime', text: '0001-01-01T00:00:00' },
	};

	function isObject(value) {
		return value !== null && typeof value === 'object' && !Array.isArray(value);
	}

	function arrayOf(value) {
		return Array.isArray(value) ? value : [];
	}

	function itemsOf(section) {
		return isObject(section) ? arrayOf(section.items) : [];
	}

	/**
	 * Ключи объектов сортируются: DTO из jar и из webview совпадают по содержимому, но порядок
	 * ключей у них разный, а разница в порядке — не повод писать файл.
	 */
	function canonical(value) {
		if (Array.isArray(value)) {
			var list = [];
			for (var i = 0; i < value.length; i += 1) {
				list.push(canonical(value[i]));
			}
			return list;
		}
		if (isObject(value)) {
			var keys = Object.keys(value).sort();
			var out = {};
			for (var j = 0; j < keys.length; j += 1) {
				if (value[keys[j]] !== undefined) {
					out[keys[j]] = canonical(value[keys[j]]);
				}
			}
			return out;
		}
		return value;
	}

	function sameJson(a, b) {
		return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
	}

	function pick(value, keys) {
		var out = {};
		for (var i = 0; i < keys.length; i += 1) {
			if (value[keys[i]] !== undefined) {
				out[keys[i]] = value[keys[i]];
			}
		}
		return out;
	}

	function structureStep() {
		return { list: 'structure', index: 0 };
	}

	/** Путь цепочки по первым элементам `structure`: у распознанной формы ветвлений нет. */
	function chainPath(depth) {
		var path = [];
		for (var i = 0; i < depth; i += 1) {
			path.push(structureStep());
		}
		return path;
	}

	function concatPath(path, steps) {
		var out = [];
		for (var i = 0; i < path.length; i += 1) {
			out.push({ list: path[i].list, index: path[i].index });
		}
		for (var j = 0; j < steps.length; j += 1) {
			out.push(steps[j]);
		}
		return out;
	}

	function chartTypeLexeme(lexeme) {
		for (var i = 0; i < CHART_TYPES.length; i += 1) {
			if (CHART_TYPES[i].value === lexeme) {
				return lexeme;
			}
		}
		return '';
	}

	/**
	 * Параметр `ТипДиаграммы` секции вывода: значение-лексема и признак `use`. Другие типы значения
	 * не считаются типом диаграммы.
	 */
	function chartParameterOf(outputParameters) {
		var items = itemsOf(outputParameters);
		for (var i = 0; i < items.length; i += 1) {
			var item = items[i] || {};
			if (item.parameter !== CHART_TYPE_PARAMETER) {
				continue;
			}
			var value = arrayOf(item.value)[0];
			var lexeme = isObject(value) && value.type === CHART_TYPE_VALUE && typeof value.text === 'string' ? value.text : '';
			return { value: lexeme, use: item.use !== false };
		}
		return null;
	}

	function emptyGroupings() {
		return { levels: [], tables: [], rows: [], columns: [], points: [], series: [] };
	}

	function onlyAuto(section) {
		var items = itemsOf(section);
		for (var i = 0; i < items.length; i += 1) {
			if (!items[i] || items[i].kind !== 'auto') {
				return false;
			}
		}
		return true;
	}

	function fieldNameOf(node) {
		var field = arrayOf(node.groupFields)[0];
		return field && typeof field.field === 'string' ? field.field : '';
	}

	/**
	 * Почему группировку нельзя показать уровнем мастера; пусто — можно. Мастер пишет группы
	 * с одним полем и Auto в сортировке и выборе, без отбора и оформления: всё, что сверх этого,
	 * — ручная настройка, и при пересборке она бы молча пропала.
	 */
	function groupProblem(node) {
		var name = fieldNameOf(node);
		var label = name ? '«' + name + '»' : 'детальных записей';
		if (node.use === false) {
			return 'группировка ' + label + ' выключена';
		}
		var fields = arrayOf(node.groupFields);
		if (fields.length > 1) {
			return 'у группировки ' + label + ' несколько полей';
		}
		if (fields.length === 1 && (!isObject(fields[0]) || typeof fields[0].field !== 'string' || fields[0].field === '')) {
			return 'у группировки поле без пути';
		}
		if (itemsOf(node.filter).length > 0) {
			return 'у группировки ' + label + ' есть отбор';
		}
		if (itemsOf(node.conditionalAppearance).length > 0) {
			return 'у группировки ' + label + ' есть условное оформление';
		}
		if (!onlyAuto(node.order)) {
			return 'у группировки ' + label + ' своя сортировка';
		}
		if (!onlyAuto(node.selection)) {
			return 'у группировки ' + label + ' свои выбранные поля';
		}
		return '';
	}

	function containerProblem(node) {
		var label = node.kind === 'chart' ? 'диаграммы' : 'таблицы';
		if (node.use === false) {
			return (node.kind === 'chart' ? 'диаграмма' : 'таблица') + ' выключена';
		}
		if (itemsOf(node.conditionalAppearance).length > 0) {
			return 'у ' + label + ' есть условное оформление';
		}
		if (!onlyAuto(node.selection)) {
			return 'у ' + label + ' свои выбранные поля';
		}
		return '';
	}

	var SIBLING_PROBLEMS = {
		rows: 'у таблицы соседние строки',
		columns: 'у таблицы соседние колонки',
		points: 'у диаграммы соседние точки',
		series: 'у диаграммы соседние серии',
	};

	/**
	 * Цепочка строк, колонок, точек или серий: следующее поле той же цели — вложенный безтиповой
	 * элемент; соседние элементы одной цели мастер не строит.
	 */
	function readTarget(nodes, target) {
		var list = arrayOf(nodes);
		if (list.length === 0) {
			return { fields: [] };
		}
		if (list.length > 1) {
			return { problem: SIBLING_PROBLEMS[target] };
		}
		var fields = [];
		var node = list[0];
		while (node) {
			var problem = groupProblem(node);
			if (problem) {
				return { problem: problem };
			}
			if (arrayOf(node.groupFields).length === 0) {
				return { problem: TARGET_LABELS[target] + ': детальные записи внутри цели' };
			}
			fields.push(node.groupFields[0]);
			var children = arrayOf(node.structure);
			if (children.length > 1) {
				return { problem: TARGET_LABELS[target] + ': у «' + fieldNameOf(node) + '» несколько вложенных элементов' };
			}
			node = children[0] || null;
			if (node && node.kind !== 'group') {
				return { problem: TARGET_LABELS[target] + ': внутри цели не группировка' };
			}
		}
		return { fields: fields };
	}

	/**
	 * Разбор варианта с подробностями для планировщика: кроме состояния мастера — где лежит
	 * тип диаграммы (в корне или в самой диаграмме) и сколько узлов в корне структуры. У пустой
	 * структуры `details` — `false`, как в файле: такое состояние без правок даёт пустой план.
	 */
	function analyze(settings) {
		var source = isObject(settings) ? settings : {};
		var state = {
			recognized: true,
			type: 'list',
			selection: itemsOf(source.selection).slice(),
			order: itemsOf(source.order).slice(),
			groupings: emptyGroupings(),
			details: false,
			chartType: null,
		};
		var rootChart = chartParameterOf(source.outputParameters);
		if (rootChart && rootChart.use && chartTypeLexeme(rootChart.value)) {
			state.chartType = rootChart.value;
		}
		var structure = arrayOf(source.structure);
		var result = { state: state, rootChart: rootChart, nodeChart: null, rootCount: structure.length };
		if (structure.length === 0) {
			return result;
		}
		if (structure.length > 1) {
			return unrecognized(result, 'в корне структуры несколько элементов');
		}
		var node = structure[0];
		var chain = [];
		while (node && node.kind === 'group') {
			var problem = groupProblem(node);
			if (problem) {
				return unrecognized(result, problem);
			}
			var children = arrayOf(node.structure);
			if (arrayOf(node.groupFields).length === 0) {
				if (children.length > 0) {
					return unrecognized(result, 'детальные записи стоят не последним уровнем');
				}
				state.groupings.levels = chain;
				state.details = true;
				return result;
			}
			chain.push(node.groupFields[0]);
			if (children.length === 0) {
				state.groupings.levels = chain;
				return result;
			}
			if (children.length > 1) {
				return unrecognized(result, 'у группировки «' + fieldNameOf(node) + '» несколько вложенных элементов');
			}
			node = children[0];
		}
		if (!node || (node.kind !== 'table' && node.kind !== 'chart')) {
			return unrecognized(result, node && node.kind === 'nestedObject' ? 'в структуре вложенный отчёт' : 'неизвестный элемент структуры');
		}
		var containerIssue = containerProblem(node);
		if (containerIssue) {
			return unrecognized(result, containerIssue);
		}
		var targets = node.kind === 'table' ? ['rows', 'columns'] : ['points', 'series'];
		for (var i = 0; i < targets.length; i += 1) {
			var target = readTarget(node[targets[i]], targets[i]);
			if (target.problem) {
				return unrecognized(result, target.problem);
			}
			state.groupings[targets[i]] = target.fields;
		}
		state.type = node.kind;
		state.groupings.tables = chain;
		// У таблицы и диаграммы флаг не действует; при смене вида на список детальные записи
		// добавляются последним уровнем, как у мастера платформы
		state.details = true;
		if (node.kind === 'chart') {
			result.nodeChart = chartParameterOf(node.outputParameters);
			// Тип у самой диаграммы перекрывает корневой: мастер показывает тот, что выведется
			if (result.nodeChart && result.nodeChart.use && chartTypeLexeme(result.nodeChart.value)) {
				state.chartType = result.nodeChart.value;
			}
		}
		return result;
	}

	/**
	 * Нераспознанная структура: мастер стартует с полями и порядком корня и пустыми
	 * группировками, а при ОК структура пересобирается целиком (детальными записями, если
	 * пользователь ничего не выбрал).
	 */
	function unrecognized(result, reason) {
		result.state.recognized = false;
		result.state.reason = reason;
		result.state.type = 'list';
		result.state.groupings = emptyGroupings();
		result.state.details = true;
		return result;
	}

	// ------------------------------------------------------------------ планирование

	function selectionItem(item) {
		if (typeof item === 'string') {
			return { kind: 'field', field: item };
		}
		var out = pick(isObject(item) ? item : {}, SELECTION_KEYS);
		if (Array.isArray(out.items)) {
			var nested = [];
			for (var i = 0; i < out.items.length; i += 1) {
				nested.push(selectionItem(out.items[i]));
			}
			out.items = nested;
		}
		return out;
	}

	function orderItem(item) {
		if (typeof item === 'string') {
			return { kind: 'field', field: item, orderType: 'Asc' };
		}
		return pick(isObject(item) ? item : {}, ORDER_KEYS);
	}

	function groupField(item) {
		if (typeof item === 'string') {
			return { field: item };
		}
		return pick(isObject(item) ? item : {}, GROUP_FIELD_KEYS);
	}

	/** Поле группировки со всеми умолчаниями писателя: так сравниваются прочитанное и новое. */
	function fullGroupField(item) {
		var out = groupField(item);
		for (var key in GROUP_FIELD_DEFAULTS) {
			if (Object.prototype.hasOwnProperty.call(GROUP_FIELD_DEFAULTS, key) && out[key] === undefined) {
				out[key] = GROUP_FIELD_DEFAULTS[key];
			}
		}
		return out;
	}

	function sameGroupField(a, b) {
		return sameJson(fullGroupField(a), fullGroupField(b));
	}

	function listOf(items, map) {
		var out = [];
		var source = arrayOf(items);
		for (var i = 0; i < source.length; i += 1) {
			out.push(map(source[i]));
		}
		return out;
	}

	/** Состояние из UI в форме для планировщика: только цели своего вида и поля с путём. */
	function normalizeState(state) {
		var source = isObject(state) ? state : {};
		var type = source.type === undefined ? 'list' : source.type;
		if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(TARGETS, type)) {
			throw new Error('Неизвестный вид отчёта мастера: ' + String(type) + '.');
		}
		var groupings = emptyGroupings();
		var sourceGroupings = isObject(source.groupings) ? source.groupings : {};
		var targets = TARGETS[type];
		for (var i = 0; i < targets.length; i += 1) {
			var entries = listOf(sourceGroupings[targets[i]], groupField);
			for (var j = 0; j < entries.length; j += 1) {
				if (typeof entries[j].field === 'string' && entries[j].field.trim() !== '') {
					groupings[targets[i]].push(entries[j]);
				}
			}
		}
		var chartType = null;
		if (type === 'chart') {
			chartType = source.chartType === undefined || source.chartType === null || source.chartType === '' ? DEFAULT_CHART_TYPE : source.chartType;
			if (!chartTypeLexeme(chartType)) {
				throw new Error('Неизвестный тип диаграммы: ' + String(chartType) + '.');
			}
		}
		return {
			type: type,
			selection: listOf(source.selection, selectionItem),
			order: listOf(source.order, orderItem),
			groupings: groupings,
			details: type === 'list' ? source.details !== false : false,
			chartType: chartType,
		};
	}

	function operation(op, variant, payload) {
		return { op: op, variant: variant, payload: payload };
	}

	function addItem(variant, parentPath, list, kind, field) {
		var payload = { parentPath: concatPath(parentPath, []), list: list };
		if (kind) {
			payload.kind = kind;
		}
		if (field) {
			payload.groupFields = [field];
		}
		return operation('cf-dcs-add-structure-item', variant, payload);
	}

	/**
	 * Цепочка групп от `parentPath`: каждое следующее поле — внутри предыдущего, как строит мастер
	 * платформы. Возвращает путь самой глубокой группы.
	 */
	function addGroupChain(ops, variant, parentPath, fields) {
		var path = parentPath;
		for (var i = 0; i < fields.length; i += 1) {
			ops.push(addItem(variant, path, 'structure', 'group', fields[i]));
			path = concatPath(path, [structureStep()]);
		}
		return path;
	}

	/** Строки, колонки, точки или серии: первое поле — в цель узла, следующие — вложенными группами. */
	function addTargetChain(ops, variant, containerPath, target, fields) {
		if (fields.length === 0) {
			return;
		}
		ops.push(addItem(variant, containerPath, target, '', fields[0]));
		addGroupChain(ops, variant, concatPath(containerPath, [{ list: target, index: 0 }]), fields.slice(1));
	}

	/** Поля группировки, которые изменились на том же уровне: правка на месте вместо пересборки. */
	function editLevels(ops, variant, path, steps, current, next) {
		var levelPath = path;
		for (var i = 0; i < next.length; i += 1) {
			levelPath = i === 0 ? concatPath(path, steps) : concatPath(levelPath, [structureStep()]);
			if (!sameGroupField(current[i], next[i])) {
				ops.push(operation('cf-dcs-set-group-fields', variant, { path: concatPath(levelPath, []), items: [next[i]] }));
			}
		}
	}

	function sameShape(current, next) {
		if (!current.recognized || current.type !== next.type) {
			return false;
		}
		if (next.type === 'list') {
			return current.groupings.levels.length === next.groupings.levels.length && current.details === next.details;
		}
		return current.groupings.tables.length === next.groupings.tables.length;
	}

	/**
	 * Операции пакета `batch` для мастера настроек — формы мутаций настроек (`DCS_MESSAGE_SPECS`):
	 * `{op, variant, payload}`, у нового варианта — `{op: 'cf-dcs-add-settings-variant', name, payload?}`.
	 *
	 * Порядок: [новый вариант] → удаления (всегда индекс 0) → выбранные поля корня → порядок корня →
	 * правки полей уровней → цепочки добавления (пути считаются заранее) → `selection=[Auto]` новой
	 * диаграммы → `ТипДиаграммы`. Пересобирается только изменённое:
	 * - выбранные поля и порядок — только при отличии; элементы уходят прочитанными DTO, поэтому
	 *   сплайс md-sparrow сохраняет байты неизменённых, папок, Auto и выключенных полей;
	 * - структура той же формы (вид отчёта, число уровней списка и детальные записи, число
	 *   «Таблиц») не удаляется: изменившееся поле или тип иерархии уровня правится
	 *   `cf-dcs-set-group-fields` (узел сохраняет userSettingID); у таблицы и диаграммы цель с
	 *   другим числом полей пересобирается отдельно, остальные цели и сам узел остаются;
	 * - иначе — все узлы корня удаляются и структура собирается заново;
	 * - `ТипДиаграммы` пишется в корневые параметры вывода; если у сохранённой диаграммы свой
	 *   тип, правится он — иначе корневой не подействовал бы. У списка и таблицы корневой тип не
	 *   трогается (параметры мастер не заменяет).
	 * Нет изменений — пустой список: диалог закрывается без записи.
	 *
	 * @param settings DTO варианта из cf-dcs-settings-info (для нового варианта не нужен)
	 * @param state состояние мастера (форма initialWizardState)
	 * @param variant имя варианта; при `options.newVariant` — имя создаваемого
	 * @param options `{newVariant?: true, presentation?: string}` — путь «В новый вариант…»
	 */
	function planWizardOperations(settings, state, variant, options) {
		if (typeof variant !== 'string' || variant.trim() === '') {
			throw new Error('Не задано имя варианта настроек.');
		}
		var opts = isObject(options) ? options : {};
		var head = [];
		var analysis;
		if (opts.newVariant) {
			var created = { op: 'cf-dcs-add-settings-variant', name: variant };
			if (typeof opts.presentation === 'string' && opts.presentation !== '') {
				created.payload = { presentation: opts.presentation };
			}
			head.push(created);
			// Новый вариант пуст: планируется так, будто прежних настроек нет
			analysis = analyze(null);
		} else {
			analysis = analyze(settings);
		}
		var current = analysis.state;
		var next = normalizeState(state);
		var removals = [];
		var roots = [];
		var edits = [];
		var adds = [];
		var tail = [];

		var selection = next.selection;
		if (!sameJson(listOf(current.selection, selectionItem), selection)) {
			roots.push(operation('cf-dcs-set-selection', variant, { path: [], items: selection }));
		}
		if (!sameJson(listOf(current.order, orderItem), next.order)) {
			roots.push(operation('cf-dcs-set-order', variant, { path: [], items: next.order }));
		}

		var keepContainer = sameShape(current, next);
		var tablesDepth = next.groupings.tables.length;
		var containerPath = chainPath(tablesDepth + 1);
		if (keepContainer && next.type === 'list') {
			editLevels(edits, variant, [], [structureStep()], current.groupings.levels, next.groupings.levels);
		} else if (keepContainer) {
			editLevels(edits, variant, [], [structureStep()], current.groupings.tables, next.groupings.tables);
			var targets = next.type === 'table' ? ['columns', 'rows'] : ['points', 'series'];
			for (var t = 0; t < targets.length; t += 1) {
				var target = targets[t];
				var was = current.groupings[target];
				var will = next.groupings[target];
				if (was.length === will.length) {
					editLevels(edits, variant, containerPath, [{ list: target, index: 0 }], was, will);
				} else {
					if (was.length > 0) {
						removals.push(operation('cf-dcs-remove-structure-item', variant, {
							path: concatPath(containerPath, [{ list: target, index: 0 }]),
						}));
					}
					addTargetChain(adds, variant, containerPath, target, will);
				}
			}
		} else {
			for (var r = 0; r < analysis.rootCount; r += 1) {
				removals.push(operation('cf-dcs-remove-structure-item', variant, { path: [structureStep()] }));
			}
			if (next.type === 'list') {
				var last = addGroupChain(adds, variant, [], next.groupings.levels);
				if (next.details) {
					adds.push(addItem(variant, last, 'structure', 'group', null));
				}
			} else {
				var deepest = addGroupChain(adds, variant, [], next.groupings.tables);
				adds.push(addItem(variant, deepest, 'structure', next.type, null));
				var fresh = next.type === 'table' ? ['columns', 'rows'] : ['points', 'series'];
				for (var f = 0; f < fresh.length; f += 1) {
					addTargetChain(adds, variant, containerPath, fresh[f], next.groupings[fresh[f]]);
				}
				if (next.type === 'chart') {
					// Скаффолд пишет пустую диаграмму, а у диаграммы платформы есть selection=[Auto]
					tail.push(operation('cf-dcs-set-selection', variant, {
						path: concatPath(containerPath, []),
						items: [{ kind: 'auto' }],
					}));
				}
			}
		}

		if (next.type === 'chart') {
			var nodeChart = keepContainer ? analysis.nodeChart : null;
			var value = { type: CHART_TYPE_VALUE, text: next.chartType };
			if (nodeChart && nodeChart.use) {
				if (nodeChart.value !== next.chartType) {
					tail.push(operation('cf-dcs-set-parameter-value', variant, {
						section: 'output',
						path: concatPath(containerPath, []),
						parameter: CHART_TYPE_PARAMETER,
						value: value,
					}));
				}
			} else {
				var rootChart = analysis.rootChart;
				if (!rootChart || !rootChart.use || rootChart.value !== next.chartType) {
					var payload = { section: 'output', path: [], parameter: CHART_TYPE_PARAMETER, value: value };
					if (rootChart && !rootChart.use) {
						payload.use = true;
					}
					tail.push(operation('cf-dcs-set-parameter-value', variant, payload));
				}
			}
		}
		return head.concat(removals, roots, edits, adds, tail);
	}

	// ------------------------------------------------------------------ подтверждение замены

	function countNodes(nodes, summary) {
		var list = arrayOf(nodes);
		for (var i = 0; i < list.length; i += 1) {
			var node = list[i] || {};
			summary.nodes += 1;
			if (node.kind === 'table') {
				summary.tables += 1;
			} else if (node.kind === 'chart') {
				summary.charts += 1;
			} else if (node.kind === 'nestedObject') {
				summary.nestedObjects += 1;
			} else {
				summary.groups += 1;
			}
			if (typeof node.userSettingID === 'string' && node.userSettingID !== '') {
				summary.userSettings += 1;
			}
			var lists = ['columns', 'rows', 'points', 'series', 'structure'];
			for (var j = 0; j < lists.length; j += 1) {
				countNodes(node[lists[j]], summary);
			}
		}
	}

	function countFields(items) {
		var count = 0;
		var list = arrayOf(items);
		for (var i = 0; i < list.length; i += 1) {
			var item = list[i] || {};
			if (item.kind === 'field') {
				count += 1;
			} else if (item.kind === 'folder') {
				count += countFields(item.items);
			}
		}
		return count;
	}

	/**
	 * Что заменит мастер — для подтверждения «Заменить / В новый вариант… / Отмена»: узлы
	 * структуры по видам, выбранные поля, поля порядка и узлы с пользовательскими настройками.
	 * `empty` — заменять нечего, подтверждение не нужно.
	 */
	function replacementSummary(settings) {
		var source = isObject(settings) ? settings : {};
		var summary = { nodes: 0, groups: 0, tables: 0, charts: 0, nestedObjects: 0, userSettings: 0 };
		countNodes(source.structure, summary);
		summary.selection = countFields(itemsOf(source.selection));
		summary.order = countFields(itemsOf(source.order));
		summary.empty = summary.nodes === 0 && summary.selection === 0 && summary.order === 0;
		return summary;
	}

	// ------------------------------------------------------------------ диалог: шаги, старт, предпросмотр, проверки

	/** Шаги диалога в порядке мастера платформы; «Тип диаграммы» — только у диаграммы. */
	var STEPS = Object.freeze([
		Object.freeze({ id: 'type', label: 'Тип отчёта' }),
		Object.freeze({ id: 'fields', label: 'Поля' }),
		Object.freeze({ id: 'groups', label: 'Группировки' }),
		Object.freeze({ id: 'order', label: 'Порядок' }),
		Object.freeze({ id: 'chart', label: 'Тип диаграммы', type: 'chart' }),
	]);

	/** Шаги для вида отчёта: у списка и таблицы мастер кончается на «Порядке». */
	function stepsFor(type) {
		var out = [];
		for (var i = 0; i < STEPS.length; i += 1) {
			if (!STEPS[i].type || STEPS[i].type === type) {
				out.push(STEPS[i]);
			}
		}
		return out;
	}

	/**
	 * Состояние, с которым открывается диалог, по DTO варианта (повторный запуск открывается с тем,
	 * что собрано):
	 * - `type` — `list` (цепочка групп с одним полем, детальные записи последним уровнем),
	 *   `table` или `chart` (цепочка групп «Таблицы», в самой глубокой — таблица или диаграмма
	 *   с цепочками строк/колонок или точек/серий);
	 * - `selection`, `order` — элементы корня как прочитаны: папки, Auto и выключенные поля
	 *   остаются на местах, чтобы планировщик вернул их байт в байт;
	 * - `groupings` — по целям (`levels` у списка; `tables`, `rows`, `columns`, `points`, `series`)
	 *   прочитанные GroupField `{field, groupType, …}`, тип иерархии — `groupType`;
	 * - `details` — у списка последний уровень — детальные записи. У пустой структуры тоже `true`:
	 *   диалог собирает новый список так, как платформа (ОК после «Полей» даёт детальные записи), и
	 *   предпросмотр показывает это сразу; у таблицы, диаграммы и нераспознанной формы — `true` на
	 *   случай смены вида;
	 * - `chartType` — лексема ChartType, действующая для диаграммы (своя у узла главнее корневой);
	 * - `recognized: false` и `reason` — форма не мастерская (несколько узлов в корне, отбор или
	 *   оформление у группы, группа с несколькими полями, соседние строки, вложенный отчёт…).
	 */
	function initialWizardState(settings) {
		var analysis = analyze(settings);
		if (analysis.rootCount === 0) {
			analysis.state.details = true;
		}
		return analysis.state;
	}

	function groupFieldText(field) {
		var name = isObject(field) && typeof field.field === 'string' ? field.field : '';
		var type = isObject(field) ? field.groupType : '';
		if (type === 'Hierarchy') {
			return name + ' (иерархия)';
		}
		if (type === 'HierarchyOnly') {
			return name + ' (только иерархия)';
		}
		return name;
	}

	function chartTypeLabel(lexeme) {
		for (var i = 0; i < CHART_TYPES.length; i += 1) {
			if (CHART_TYPES[i].value === lexeme) {
				return CHART_TYPES[i].label;
			}
		}
		return lexeme;
	}

	/** Цепочка полей одной цели: первое — в цели, следующие вложены в предыдущее, как строит план. */
	function previewChain(lines, fields, depth) {
		for (var i = 0; i < fields.length; i += 1) {
			lines.push({ depth: depth + i, text: groupFieldText(fields[i]), kind: 'group' });
		}
	}

	/**
	 * Дерево результата для живого предпросмотра: строки `{depth, text, kind}` от корня «Отчет»
	 * (kind: root, group, details, container, target, empty). Правила те же, что у planWizardOperations:
	 * уровни списка цепочкой, «Таблицы» — группы над таблицей или диаграммой, колонки раньше строк
	 * и точки раньше серий — как в файле и в дереве структуры.
	 */
	function previewLines(state) {
		var next = normalizeState(state);
		var lines = [{ depth: 0, text: 'Отчет', kind: 'root' }];
		if (next.type === 'list') {
			previewChain(lines, next.groupings.levels, 1);
			if (next.details) {
				lines.push({ depth: next.groupings.levels.length + 1, text: 'Детальные записи', kind: 'details' });
			} else if (next.groupings.levels.length === 0) {
				lines.push({ depth: 1, text: 'Структура пуста', kind: 'empty' });
			}
			return lines;
		}
		var tables = next.groupings.tables;
		previewChain(lines, tables, 1);
		var depth = tables.length + 1;
		var targets = next.type === 'table' ? ['columns', 'rows'] : ['points', 'series'];
		lines.push({
			depth: depth,
			text: next.type === 'table' ? 'Таблица' : 'Диаграмма: ' + chartTypeLabel(next.chartType).toLowerCase(),
			kind: 'container',
		});
		var shown = 0;
		for (var t = 0; t < targets.length; t += 1) {
			var fields = next.groupings[targets[t]];
			if (fields.length === 0) {
				continue;
			}
			shown += 1;
			lines.push({ depth: depth + 1, text: TARGET_LABELS[targets[t]], kind: 'target' });
			previewChain(lines, fields, depth + 2);
		}
		if (shown === 0) {
			lines.push({
				depth: depth + 1,
				text: next.type === 'table' ? 'Без строк и колонок' : 'Без точек и серий',
				kind: 'empty',
			});
		}
		return lines;
	}

	function foldName(value) {
		return typeof value === 'string' ? value.toLowerCase() : '';
	}

	/**
	 * Пути выбранных полей: поля с путём, в том числе внутри папок; выключенные (`use=false`) — только
	 * при `withDisabled` (дубль ищется и среди них, а ресурс в выводе — только среди включённых).
	 */
	function selectedFieldNames(items, withDisabled) {
		var out = [];
		var list = arrayOf(items);
		for (var i = 0; i < list.length; i += 1) {
			var item = list[i] || {};
			if (item.kind === 'folder') {
				out = out.concat(selectedFieldNames(item.items, withDisabled));
			} else if ((item.kind === undefined || item.kind === 'field') && typeof item.field === 'string' && item.field !== '') {
				if (withDisabled || item.use !== false) {
					out.push(item.field);
				}
			}
		}
		return out;
	}

	/** Ресурсы схемы по пути без учёта регистра: путь и группировки, по которым они считаются. */
	function resourcesOf(schema) {
		var out = {};
		var totals = isObject(schema) ? arrayOf(schema.totalFields) : [];
		for (var i = 0; i < totals.length; i += 1) {
			var total = totals[i] || {};
			var path = total.name;
			if (typeof path === 'string' && path !== '') {
				out[foldName(path)] = { path: path, groups: arrayOf(total.groups) };
			}
		}
		return out;
	}

	function groupingNames(next) {
		var out = [];
		var targets = TARGETS[next.type];
		for (var i = 0; i < targets.length; i += 1) {
			var fields = next.groupings[targets[i]];
			for (var j = 0; j < fields.length; j += 1) {
				out.push(fields[j].field);
			}
		}
		return out;
	}

	function quoted(names) {
		var out = [];
		for (var i = 0; i < names.length; i += 1) {
			out.push('«' + names[i] + '»');
		}
		return out.join(', ');
	}

	/**
	 * Предупреждения шагов (не блокируют ОК): `{step, text}`. schema — ответ cf-dcs-info: по нему
	 * видно, какие поля — ресурсы и по каким группировкам ресурс считается. Мастер ресурсы не создаёт
	 * (так и платформа), поэтому таблица и диаграмма без ресурса — частая ошибка, о ней и говорим.
	 */
	function wizardWarnings(state, schema) {
		var next = normalizeState(state);
		var resources = resourcesOf(schema);
		var out = [];
		var shown = selectedFieldNames(next.selection, false);
		var chosenResources = [];
		var plain = [];
		for (var i = 0; i < shown.length; i += 1) {
			if (Object.prototype.hasOwnProperty.call(resources, foldName(shown[i]))) {
				chosenResources.push(resources[foldName(shown[i])]);
			} else {
				plain.push(shown[i]);
			}
		}
		if (next.type !== 'list') {
			var where = next.type === 'table' ? 'в ячейках таблицы' : 'значениями диаграммы';
			if (chosenResources.length === 0) {
				out.push({ step: 'fields', text: 'Не выбран ни один ресурс: ' + where + ' выводятся ресурсы схемы.' });
			}
			if (plain.length > 0) {
				out.push({
					step: 'fields',
					text:
						'Не ресурсы схемы: ' + quoted(plain) + '. Итогов по группировкам у них не будет. Конструктор ресурсы не ' +
						'создаёт: ресурс добавляется на закладке «Ресурсы».',
				});
			}
			if (next.type === 'table' && next.groupings.rows.length === 0 && next.groupings.columns.length === 0) {
				out.push({ step: 'groups', text: 'У таблицы нет ни строк, ни колонок: выведутся только общие итоги.' });
			}
			if (next.type === 'chart' && next.groupings.points.length === 0 && next.groupings.series.length === 0) {
				out.push({ step: 'groups', text: 'У диаграммы нет ни точек, ни серий: выведется одно значение на ресурс.' });
			}
			if (next.type === 'table') {
				var rows = {};
				for (var r = 0; r < next.groupings.rows.length; r += 1) {
					rows[foldName(next.groupings.rows[r].field)] = true;
				}
				var both = [];
				for (var c = 0; c < next.groupings.columns.length; c += 1) {
					var column = next.groupings.columns[c].field;
					if (rows[foldName(column)] && both.indexOf(column) < 0) {
						both.push(column);
					}
				}
				if (both.length > 0) {
					out.push({ step: 'groups', text: 'И в строках, и в колонках: ' + quoted(both) + '.' });
				}
			}
		}
		var grouped = groupingNames(next);
		for (var k = 0; k < chosenResources.length; k += 1) {
			var groups = chosenResources[k].groups;
			if (groups.length === 0) {
				continue;
			}
			var allowed = {};
			for (var g = 0; g < groups.length; g += 1) {
				allowed[foldName(groups[g])] = true;
			}
			var outside = [];
			for (var n = 0; n < grouped.length; n += 1) {
				if (!allowed[foldName(grouped[n])] && outside.indexOf(grouped[n]) < 0) {
					outside.push(grouped[n]);
				}
			}
			if (outside.length > 0) {
				out.push({
					step: 'groups',
					text:
						'Ресурс «' + chosenResources[k].path + '» считается только по группировкам ' + quoted(groups) +
						': по ' + quoted(outside) + ' его итога не будет.',
				});
			}
		}
		return out;
	}

	/** Часть пути поля: имя из букв, цифр и «_», не с цифры — как у путей данных схемы. */
	var PATH_SEGMENT_RE = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/;

	/** Почему путь из «Другого поля…» не годится; пусто — годится. */
	function fieldPathProblem(path) {
		var value = typeof path === 'string' ? path.trim() : '';
		if (value === '') {
			return 'Укажите путь поля.';
		}
		var segments = value.split('.');
		for (var i = 0; i < segments.length; i += 1) {
			if (!PATH_SEGMENT_RE.test(segments[i])) {
				return 'Путь «' + value + '» не разобран: нужны имена из букв, цифр и «_» через точку.';
			}
		}
		return '';
	}

	var api = {
		REPORT_TYPES: REPORT_TYPES,
		TARGETS: TARGETS,
		TARGET_LABELS: TARGET_LABELS,
		GROUP_TYPES: GROUP_TYPES,
		ORDER_TYPES: ORDER_TYPES,
		CHART_TYPE_GROUPS: CHART_TYPE_GROUPS,
		CHART_TYPES: CHART_TYPES,
		DEFAULT_CHART_TYPE: DEFAULT_CHART_TYPE,
		planWizardOperations: planWizardOperations,
		replacementSummary: replacementSummary,
		stepsFor: stepsFor,
		initialWizardState: initialWizardState,
		previewLines: previewLines,
		selectedFieldNames: selectedFieldNames,
		wizardWarnings: wizardWarnings,
		fieldPathProblem: fieldPathProblem,
	};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (root) {
		root.DcsSettingsWizard = api;
	}
})(typeof window === 'undefined' ? globalThis : window);
