// Просмотр управляемой формы: дерево элементов, схематичное превью, данные формы и свойства.
// Модель приходит из md-sparrow через window.__FORM_DATA__.

(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const data = window.__FORM_DATA__ || {};

	// Форма объекта поставщика без изменения: правка запрещена, показываем причину
	(function showReadonlyNotice() {
		const notice = document.getElementById('readonlyNotice');
		if (notice && data.readonlyReason) {
			notice.textContent = data.readonlyReason;
			notice.classList.remove('hidden');
		}
	})();
	let content = data.content || {};
	// Умолчания раскладки: в файле лежит только изменённое, поэтому пустое свойство берём отсюда.
	const layoutDefaults = data.layoutDefaults || {};
	// Без заголовка платформа подписывает поле синонимом реквизита, а не именем элемента.
	const dataPathTitles = data.dataPathTitles || {};
	// Типы реквизитов объекта: в модели формы их нет, они приходят из структуры объекта-владельца.
	const dataPathTypes = data.dataPathTypes || {};
	// Кнопку без заголовка платформа подписывает синонимом команды, на которую та ссылается.
	const commandTitles = data.commandTitles || {};
	// Кнопки этих команд платформа держит у правого края панели: своего выравнивания у них нет.
	const commandsAtRight = new Set(data.commandsAtRight || []);
	// Чем платформа наполнит командную панель самой формы: в файле формы этого набора нет.
	const autoCommandBar = data.autoCommandBar || [];
	// То же для панели таблицы: набор идёт по виду её данных, а не по главному реквизиту формы.
	const tableCommandBar = data.tableCommandBar || {};
	const tableKinds = data.tableKinds || {};
	// Набор бывает пустым и у снятого вида: пометку ставим только там, где он не снят вовсе.
	const autoCommandBarKnown = Boolean(data.autoCommandBarKnown);
	// Панели самой формы: набор платформы достаётся им, а не панелям таблиц внутри формы.
	const formOwnBars = new Set();
	// Панели и группы кнопок, которым тот же набор достаётся записанным источником команд.
	const formSourceBars = new Set();
	// Панели таблиц: у каждой свой вид данных, по нему и берётся набор.
	const tableBarKinds = new Map();
	// Панель таблицы -> имя самой таблицы: по нему из набора вычитаются записанные кнопками команды.
	const tableBarNames = new Map();
	// Стандартные команды таблицы, которые форма положила своими кнопками: таблица -> имена команд.
	const tablePlacedCommands = new Map();
	// Служебные части таблиц, которые платформа держит в командной панели: панель -> её части.
	const barAdditions = new Map();

	/**
	 * Расширенную подсказку и контекстное меню платформа отдельными элементами
	 * не рисует: в дереве и на превью их нет.
	 */
	const SERVICE_TYPES = new Set(['ExtendedTooltip', 'ContextMenu']);

	/** Служебная часть таблицы -> свойство таблицы, которым платформа задаёт её положение. */
	const ADDITION_LOCATIONS = {
		SearchStringAddition: 'SearchStringLocation',
		ViewStatusAddition: 'ViewStatusLocation',
		SearchControlAddition: 'SearchControlLocation',
	};

	/** Служебные части, у которых в модели есть значение «в командной панели»: там же их «авто». */
	const IN_COMMAND_BAR_ADDITIONS = new Set(['SearchStringAddition', 'SearchControlAddition']);

	/** Часть, которую платформа при «авто» заводит только динамическому списку. */
	const DYNAMIC_LIST_ADDITIONS = new Set(['SearchControlAddition']);

	const TYPE_LABELS = {
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
		SpreadSheetDocumentField: 'Поле табличного документа',
		HTMLDocumentField: 'Поле HTML',
		FormattedDocumentField: 'Поле форматированного документа',
		CalendarField: 'Поле календаря',
		PeriodField: 'Поле периода',
		ProgressBarField: 'Индикатор',
		TrackBarField: 'Полоса регулирования',
		ChartField: 'Поле диаграммы',
		GanttChartField: 'Диаграмма Ганта',
		DendrogramField: 'Дендрограмма',
		GeographicalSchemaField: 'Географическая схема',
		GraphicalSchemaField: 'Графическая схема',
		PlannerField: 'Поле планировщика',
		PDFDocumentField: 'Поле документа PDF',
	};

	/**
	 * Кнопки поля ввода: свойство элемента -> вид кнопки.
	 *
	 * Платформа рисует кнопку, когда свойство включено. Со значением `auto` она решает по типу
	 * поля, а тип модель формы даёт только у реквизитов самой формы: у путей к данным объекта
	 * его нет, поэтому там кнопка по `auto` не появляется.
	 */
	const FIELD_BUTTONS = [
		['ChoiceButton', 'choice'],
		['ChoiceListButton', 'list'],
		['DropListButton', 'list'],
		['CreateButton', 'create'],
		['OpenButton', 'open'],
		['ClearButton', 'clear'],
		['SpinButton', 'spin'],
	];

	/** Кнопка выбора у поля даты выглядит календарём, поэтому у неё свой значок. */
	const FIELD_BUTTON_GLYPHS = {
		choice: '…',
		list: '▾',
		create: '+',
		open: '→',
		clear: '×',
		spin: '⇕',
	};

	const FIELD_BUTTON_TITLES = {
		choice: 'Кнопка выбора',
		calendar: 'Кнопка календаря',
		list: 'Кнопка выбора из списка',
		create: 'Кнопка создания',
		open: 'Кнопка открытия',
		clear: 'Кнопка очистки',
		spin: 'Кнопка регулирования',
	};

	/**
	 * Виды, которые платформа держит по размеру содержимого.
	 *
	 * Надпись и картинка занимают место текста и рисунка, кнопка - заголовка, поэтому свободное
	 * место строки достаётся им только с растяжением, записанным в файле.
	 */
	const CONTENT_SIZED_TYPES = new Set(['Button', 'LabelDecoration', 'PictureDecoration']);

	/**
	 * Виды, которые держат другие элементы.
	 *
	 * Свободное место строки платформа контейнеру со значением «авто» не отдаёт: группа занимает
	 * ровно то место, что нужно её содержимому, сосед идёт сразу за ней, а остаток строки остаётся
	 * в конце. Место контейнеру достаётся только с растяжением, записанным в файле.
	 */
	const CONTAINER_TYPES = new Set([
		'UsualGroup', 'Pages', 'Page', 'ColumnGroup',
		'CommandBar', 'AutoCommandBar', 'ButtonGroup', 'Popup', 'ContextMenu',
	]);

	/**
	 * Ключ хранения положения границ панелей.
	 *
	 * Номер в ключе меняем вместе со способом счёта долей: положение прошлых сеансов посчитано
	 * по-старому и перекосило бы раскладку.
	 */
	const SPLIT_STORAGE_KEY = 'form-viewer.split.2.';

	/** Сторона заголовка поля по свойству `TitleLocation`; со значением `Auto` платформа ставит его слева. */
	const TITLE_SIDES = {
		None: 'none',
		Left: 'left',
		Right: 'right',
		Top: 'top',
		Bottom: 'bottom',
	};

	const state = {
		selected: null,
		collapsed: new Set(),
		dataTab: 'attributes',
		/** Открытая закладка каждой группы страниц: ключ группы -> ключ страницы. */
		activePage: new Map(),
	};

	/** Плоский список элементов с ключами пути: ключ переживает перерисовку. */
	function withKeys(items, prefix) {
		return (items || []).map((item, index) => {
			const key = prefix + '/' + index;
			return { item: item, key: key, children: withKeys(item.items, key) };
		});
	}

	let tree = withKeys(content.items, '');

	/**
	 * Типы реквизитов по пути к данным.
	 *
	 * Реквизиты самой формы лежат в её содержимом, а типы за путём `Объект.<Реквизит>` приходят
	 * из структуры объекта-владельца: в модели формы их нет.
	 */
	function attributeTypes() {
		const out = new Map();
		for (const path of Object.keys(dataPathTypes)) {
			out.set(path, dataPathTypes[path]);
		}
		for (const attribute of content.attributes || []) {
			if (!attribute.name) {
				continue;
			}
			out.set(attribute.name, (attribute.type || {}).types || []);
			for (const column of attribute.columns || []) {
				if (column.name) {
					out.set(attribute.name + '.' + column.name, (column.type || {}).types || []);
				}
			}
		}
		return out;
	}

	let dataTypes = attributeTypes();

	function typeLabel(type) {
		return TYPE_LABELS[type] || type || 'Элемент';
	}

	/** Значение свойства с учётом умолчания вида элемента. */
	function effective(item, property, value) {
		if (value !== undefined && value !== null && value !== '') {
			return value;
		}
		const defaults = layoutDefaults[item.type];
		return defaults ? defaults[property] : undefined;
	}

	/** Свойство, записанное в файле: у него нет отдельного поля в модели формы. */
	function written(item, property) {
		return item.properties ? item.properties[property] : undefined;
	}

	/** Свойство самой формы: оно записано в корне файла, а не у элемента, и умолчание у него своё. */
	function formProperty(property) {
		const value = content.properties ? content.properties[property] : undefined;
		if (value !== undefined && value !== null && value !== '') {
			return value;
		}
		const defaults = layoutDefaults.Form;
		return defaults ? defaults[property] : undefined;
	}

	/**
	 * Где стоит автоматическая командная панель формы.
	 *
	 * Положение задано свойством самой формы, а не панели. «Авто» платформа рисует сверху, «нет»
	 * панели не показывает совсем. Обычной командной панели это не касается: она стоит там, где
	 * записана в составе формы.
	 */
	function formCommandBarPlace() {
		const value = formProperty('CommandBarLocation');
		if (value === 'None') {
			return '';
		}
		return value === 'Bottom' ? 'bottom' : 'top';
	}

	function visibleNodes(nodes) {
		return nodes.filter((node) => !SERVICE_TYPES.has(node.item.type));
	}

	function findNode(nodes, key) {
		for (const node of nodes) {
			if (node.key === key) {
				return node;
			}
			const found = findNode(node.children, key);
			if (found) {
				return found;
			}
		}
		return null;
	}

	/** Узлы от корня до элемента: ключ собран из положения элемента в дереве. */
	function nodeChain(key) {
		const chain = [];
		let nodes = tree;
		let current = '';
		for (const part of String(key || '').split('/').slice(1)) {
			current += '/' + part;
			const node = nodes.find((candidate) => candidate.key === current);
			if (!node) {
				return chain;
			}
			chain.push(node);
			nodes = node.children;
		}
		return chain;
	}

	function element(tag, className, text) {
		const el = document.createElement(tag);
		if (className) {
			el.className = className;
		}
		if (text !== undefined && text !== null && text !== '') {
			el.textContent = String(text);
		}
		return el;
	}

	function select(key) {
		state.selected = key;
		revealPage(key);
		renderTree();
		renderPreview();
		const node = findNode(tree, key);
		vscode.postMessage({ type: 'select', item: node ? itemProperties(node.item) : undefined });
	}

	/** Выделенный элемент должен быть виден: закладки по пути к нему открываются на его странице. */
	function revealPage(key) {
		const chain = nodeChain(key);
		for (let i = 0; i + 1 < chain.length; i += 1) {
			if (chain[i].item.type === 'Pages' && chain[i + 1].item.type === 'Page') {
				state.activePage.set(chain[i].key, chain[i + 1].key);
			}
		}
	}

	/** Свойства самого элемента, без вложенных: панель «Свойства» рисует только его. */
	function itemProperties(item) {
		const own = Object.assign({}, item);
		delete own.items;
		return own;
	}

	/** Значки элементов: рисуем сами, цвет наследуется от темы. */
	const ICON_SHAPES = {
		group: '<path d="M4 10h14l4 4h22v24H4z"/>',
		field: '<path d="M4 16h40v16H4zm3 3v10h34V19z"/>',
		label: '<path d="M6 14h36v4H6zm0 10h26v4H6zm0 10h32v4H6z"/>',
		button: '<path d="M4 16h40v16H4zm4 4v8h32v-8z"/>',
		table: '<path d="M4 10h40v28H4zm4 4v6h12v-6zm16 0v6h16v-6zM8 24v10h12V24zm16 0v10h16V24z"/>',
		bar: '<path d="M4 14h40v8H4zm0 14h24v6H4z"/>',
		page: '<path d="M10 6h18l10 10v26H10zm16 3v9h9z"/>',
		checkbox: '<path d="M8 8h32v32H8zm5 5v22h22V13zm4 11 4-4 4 4 7-7 4 4-11 11z"/>',
		radio: '<path d="M24 8a16 16 0 1 0 0 32 16 16 0 0 0 0-32zm0 4a12 12 0 1 1 0 24 12 12 0 0 1 0-24zm0 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"/>',
		search: '<path d="M20 6a14 14 0 1 0 8.5 25.1l9.7 9.7 3-3-9.7-9.7A14 14 0 0 0 20 6zm0 4a10 10 0 1 1 0 20 10 10 0 0 1 0-20z"/>',
		tooltip: '<path d="M6 8h36v24H24l-8 8v-8H6z"/>',
		type: '<path d="M6 12h36v6H6zm6 12h24v6H12zm6 12h12v6H18z"/>',
		calendar: '<path d="M12 4h5v5h14V4h5v5h6v35H6V9h6zm-2 14v22h28V18z"/>',
	};

	const ICON_BY_TYPE = {
		UsualGroup: 'group',
		ColumnGroup: 'group',
		ButtonGroup: 'bar',
		Popup: 'bar',
		CommandBar: 'bar',
		AutoCommandBar: 'bar',
		ContextMenu: 'bar',
		Pages: 'page',
		Page: 'page',
		Button: 'button',
		Table: 'table',
		LabelDecoration: 'label',
		LabelField: 'label',
		PictureDecoration: 'label',
		CheckBoxField: 'checkbox',
		RadioButtonField: 'radio',
		SearchStringAddition: 'search',
		SearchControlAddition: 'search',
		ViewStatusAddition: 'search',
		ExtendedTooltip: 'tooltip',
	};

	function icon(shapeKey) {
		const box = element('span', 'item-icon');
		const shape = ICON_SHAPES[shapeKey] || ICON_SHAPES.field;
		box.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true">' + shape + '</svg>';
		return box;
	}

	function itemIcon(type) {
		return icon(ICON_BY_TYPE[type] || 'field');
	}

	// Дерево элементов

	function renderTree() {
		const host = document.getElementById('elementsTree');
		host.textContent = '';
		const nodes = visibleNodes(tree);
		if (nodes.length === 0) {
			host.append(element('div', 'empty-note', 'Элементов нет'));
			return;
		}
		host.append(treeLevel(nodes, 0));
	}

	function treeLevel(nodes, depth) {
		const box = document.createElement('div');
		for (const node of nodes) {
			const children = visibleNodes(node.children);
			const row = element('div', 'tree-row' + (state.selected === node.key ? ' is-selected' : ''));
			row.style.paddingLeft = 4 + depth * 12 + 'px';
			const twisty = element('span', 'tree-twisty', children.length > 0 ? (state.collapsed.has(node.key) ? '▸' : '▾') : '');
			if (children.length > 0) {
				twisty.addEventListener('click', (event) => {
					event.stopPropagation();
					if (state.collapsed.has(node.key)) {
						state.collapsed.delete(node.key);
					} else {
						state.collapsed.add(node.key);
					}
					renderTree();
				});
			}
			row.append(twisty);
			row.append(itemIcon(node.item.type));
			row.append(element('span', 'tree-name', node.item.name || typeLabel(node.item.type)));
			row.append(element('span', 'tree-type', typeLabel(node.item.type)));
			row.addEventListener('click', () => select(node.key));
			box.append(row);
			if (children.length > 0) {
				const childBox = treeLevel(children, depth + 1);
				childBox.className = 'tree-children' + (state.collapsed.has(node.key) ? ' is-collapsed' : '');
				box.append(childBox);
			}
		}
		return box;
	}

	// Превью

	function renderPreview() {
		const host = document.getElementById('preview');
		host.textContent = '';
		const nodes = visibleNodes(tree);
		if (nodes.length === 0) {
			host.append(element('div', 'empty-note', 'Форма пуста'));
			return;
		}
		// Сама форма - такой же контейнер: у неё есть и группировка, и выравнивание дочерних элементов.
		const layout = groupLayout(formProperty('Group'));
		const root = element('div', 'pv-group ' + layout + alignClass(formProperty('ChildrenAlign')));
		markTitlesSide(root, formProperty('ChildrenAlign'));
		root.style.border = 'none';
		const place = formCommandBarPlace();
		const auto = (node) => node.item.type === 'AutoCommandBar';
		const bars = place === '' ? [] : nodes.filter(auto);
		formOwnBars.clear();
		formSourceBars.clear();
		tableBarKinds.clear();
		tableBarNames.clear();
		tablePlacedCommands.clear();
		barAdditions.clear();
		collectTableCommands(nodes);
		for (const bar of bars) {
			formOwnBars.add(bar.item);
		}
		collectCommandSources(nodes, bars.some((bar) => autoFilled(bar.item)));
		const body = nodes.filter((node) => !auto(node));
		assignBarAdditions(body, bars.map((bar) => bar.item));
		const boxes = body.map((node) => previewNode(node));
		if (layout.indexOf('is-horizontal') === 0) {
			stretchRow(body, boxes);
		} else {
			stretchColumn(body, boxes);
		}
		for (const box of boxes) {
			root.append(box);
		}
		// Содержимое формы занимает её целиком, поэтому свободная высота доходит до самого элемента.
		if (boxes.some((box) => box.classList.contains('is-stretched-down'))) {
			root.style.flex = '1 1 auto';
		}
		// Панель формы лежит над содержимым или под ним, а не внутри него, поэтому идёт соседом.
		const form = element('div', 'pv-form');
		for (const bar of place === 'top' ? bars : []) {
			form.append(previewNode(bar));
		}
		form.append(root);
		for (const bar of place === 'bottom' ? bars : []) {
			form.append(previewNode(bar));
		}
		host.append(form);
		foldTightGroups(host);
		alignGroupTitles(host);
		alignLabelColumns(host);
	}

	/**
	 * Раскладывает служебные части таблиц по обслуживающим их командным панелям.
	 *
	 * Строку поиска платформа рисует не отдельной строкой, а внутри той панели, которая обслуживает
	 * таблицу: собственной панели таблицы, а если та не показана - панели, которую платформа
	 * наполняет сама. На форме списка это записанная панель с источником команд, а не пустая
	 * автоматическая панель формы, и лежать она может выше самой таблицы, поэтому раскладка идёт
	 * до отрисовки.
	 */
	function assignBarAdditions(body, formBars) {
		const filled = formBars.filter((bar) => autoFilled(bar));
		const tables = [];
		const walk = (nodes, inTable) => {
			for (const node of visibleNodes(nodes)) {
				if (node.item.type === 'Table') {
					tables.push(node);
					walk(node.children, true);
					continue;
				}
				if (!inTable && isCommandBar(node.item.type) && autoFilled(node.item)) {
					filled.push(node.item);
				}
				walk(node.children, inTable);
			}
		};
		walk(body, false);
		for (const table of tables) {
			const location = effective(table.item, 'CommandBarLocation', written(table.item, 'CommandBarLocation'));
			const children = visibleNodes(table.children);
			const own = location === 'None' ? undefined : children.find((child) => isCommandBar(child.item.type));
			const serving = own ? own.item : filled[0];
			const additions = children.filter((child) => isBar(child.item.type)
				&& !isCommandBar(child.item.type)
				&& additionPlace(table.item, child.item.type) === 'bar');
			if (serving && additions.length) {
				barAdditions.set(serving, (barAdditions.get(serving) || []).concat(additions));
			}
		}
	}

	/**
	 * Группы «горизонтальная, если возможно», которым не хватило ширины, становятся вертикальными.
	 *
	 * Платформа не переносит лишние элементы на следующую строку: она кладёт группу целиком в
	 * столбик. Ширину знает только браузер, поэтому меряем уже уложенную строку.
	 */
	function foldTightGroups(host) {
		for (const group of host.querySelectorAll('.pv-group.is-if-possible')) {
			group.classList.remove('is-folded');
			group.classList.add('is-horizontal');
			group.classList.remove('is-vertical');
		}
		// Мерить надо от внешних групп к вложенным: свёрнутая внешняя меняет ширину вложенным.
		for (const group of host.querySelectorAll('.pv-group.is-if-possible')) {
			if (group.scrollWidth > group.clientWidth + 1) {
				group.classList.remove('is-horizontal');
				group.classList.add('is-vertical', 'is-folded');
			}
		}
		// Свернувшаяся группа стала многострочной, и её заголовок уходит наверх.
		for (const framed of host.querySelectorAll('.pv-groupbox')) {
			placeGroupTitle(framed);
		}
	}

	/**
	 * Общая колонка заголовков групп.
	 *
	 * Заголовок, вставший слева в строку, платформа держит колонкой на всех таких соседей: содержимое
	 * групп начинается от одной границы, хотя заголовки разной длины. Ширину задаёт самый длинный
	 * заголовок, а стоят они в колонке слева, в отличие от подписей полей.
	 *
	 * Сторону заголовка решает `foldTightGroups`, поэтому ширины сперва снимаем: свернувшаяся группа
	 * уводит заголовок наверх и из колонки выходит.
	 */
	function alignGroupTitles(host) {
		for (const title of host.querySelectorAll('.pv-group-title')) {
			title.style.width = '';
		}
		const families = new Map();
		for (const framed of host.querySelectorAll('.pv-groupbox.is-title-left')) {
			const family = framed.parentElement;
			if (family) {
				families.set(family, (families.get(family) || []).concat(framed.firstElementChild));
			}
		}
		for (const titles of families.values()) {
			if (titles.length < 2) {
				continue;
			}
			let width = 0;
			for (const title of titles) {
				width = Math.max(width, title.getBoundingClientRect().width);
			}
			for (const title of titles) {
				title.style.width = Math.ceil(width) + 'px';
			}
		}
	}

	/**
	 * Общая колонка подписей у соседних элементов.
	 *
	 * Поля соседей начинаются от общей границы, а подпись встаёт к тому краю колонки, который назван
	 * в выравнивании дочерних элементов. Ширину колонки задаёт самая длинная подпись, поэтому меряем
	 * их по месту: знаки шрифта формы разной ширины, а колонка должна вместить самую длинную подпись
	 * целиком.
	 */
	function alignLabelColumns(host) {
		const inner = new Set();
		const through = throughAlignColumns(host, inner);
		for (const group of host.querySelectorAll('.pv-group.is-vertical')) {
			if (inner.has(group) || through.has(group) || group.classList.contains('is-align-none')) {
				continue;
			}
			applyLabelColumn(columnLabels(group, [], inner), titlesSide(group));
		}
	}

	/** Сторона подписи в общей колонке: её задаёт группа, у которой эта колонка собралась. */
	function titlesSide(group) {
		return group.dataset.titles === 'right' ? 'right' : 'left';
	}

	/**
	 * Сквозное выравнивание: группы-соседи со значением «использовать» держат одну общую колонку.
	 *
	 * Общую границу задаёт самая длинная подпись среди таких групп. Соседи со значениями «не
	 * использовать» и «авто» и группа без записанного свойства в общую колонку не идут: каждая из них
	 * считает свою.
	 */
	function throughAlignColumns(host, inner) {
		const families = new Map();
		for (const group of host.querySelectorAll('.pv-group.is-vertical[data-through="use"]')) {
			// Группа с рамкой лежит в обёртке с заголовком, и соседи у неё общие с этой обёрткой.
			const slot = group.parentElement && group.parentElement.classList.contains('pv-groupbox')
				? group.parentElement
				: group;
			const family = slot.parentElement;
			if (!family || group.classList.contains('is-align-none')) {
				continue;
			}
			families.set(family, (families.get(family) || []).concat(group));
		}
		const done = new Set();
		for (const groups of families.values()) {
			const labels = [];
			for (const group of groups) {
				done.add(group);
				columnLabels(group, labels, inner);
			}
			// Колонка у соседей общая, поэтому и сторона подписи в ней одна: её задаёт первый сосед.
			applyLabelColumn(labels, titlesSide(groups[0]));
		}
		return done;
	}

	/** Подписи одной колонки: ширину задаёт самая длинная, а сторону - выравнивание группы. */
	function applyLabelColumn(labels, side) {
		if (labels.length < 2) {
			return;
		}
		let width = 0;
		for (const label of labels) {
			width = Math.max(width, label.getBoundingClientRect().width);
		}
		for (const label of labels) {
			label.classList.add('is-aligned');
			label.classList.toggle('is-titles-right', side === 'right');
			label.style.width = Math.ceil(width) + 'px';
		}
	}

	/**
	 * Подписи одной колонки.
	 *
	 * Строку вертикальной группы начинает либо само поле, либо первый элемент вложенной
	 * горизонтальной группы. Группа без рамки и отступа стоит на том же месте, что и соседи, поэтому
	 * её подписи идут в колонку внешней группы; отделённая рамкой или отступом заводит свою.
	 */
	function columnLabels(group, labels, inner) {
		for (const row of group.children) {
			if (row.classList.contains('is-vertical') && plainGroup(row)) {
				inner.add(row);
				// Группа без общей колонки своих подписей во внешнюю колонку не отдаёт.
				if (!row.classList.contains('is-align-none')) {
					columnLabels(row, labels, inner);
				}
				continue;
			}
			const label = leadingLabel(row);
			if (label) {
				labels.push(label);
			}
		}
		return labels;
	}

	/** Подпись, с которой начинается строка: у поля своя, у горизонтальной группы - первого элемента. */
	function leadingLabel(row) {
		if (row.classList.contains('pv-field')) {
			const label = row.firstElementChild;
			return row.classList.contains('is-title-left') && label ? label : null;
		}
		if (row.classList.contains('is-horizontal') && plainGroup(row)) {
			for (const child of row.children) {
				if (!child.classList.contains('pv-group-title')) {
					return leadingLabel(child);
				}
			}
		}
		return null;
	}

	/** Группа, элементы которой платформа не сдвигает относительно соседей. */
	function plainGroup(box) {
		return box.classList.contains('pv-group')
			&& !box.classList.contains('is-framed')
			&& !box.classList.contains('is-margined');
	}

	/** Ширина в знаках: платформа отмеряет её средним знаком шрифта формы. */
	function widthPx(width) {
		return Math.max(40, Number(width) * 8) + 'px';
	}

	/** Растяжение по горизонтали; пусто у видов, где такого свойства нет: флажок, переключатель. */
	function stretchValue(item) {
		return effective(item, 'HorizontalStretch', item.horizontalStretch);
	}

	/**
	 * Элемент может занять свободное место строки.
	 *
	 * Записанная ширина отменяет растяжение: элемент занимает ровно её. Надпись, картинку и кнопку
	 * платформа держит по размеру содержимого, поэтому им место достаётся только с растяжением,
	 * записанным в файле. Незаписанное свойство решает умолчание вида: у таблицы оно уже растянутое,
	 * у поля - «авто», и место такому полю достаётся, а группе со значением «авто» нет.
	 */
	function canStretch(item) {
		if (item.width) {
			return false;
		}
		if (item.horizontalStretch === 'true') {
			return true;
		}
		if (item.horizontalStretch === 'false' || CONTENT_SIZED_TYPES.has(item.type)) {
			return false;
		}
		const value = stretchValue(item);
		if (value === undefined || value === 'false') {
			return false;
		}
		return value === 'true' || !CONTAINER_TYPES.has(item.type);
	}

	/**
	 * Свободное место строки достаётся растянутым элементам, и они делят его поровну.
	 *
	 * Доставшуюся долю растянутое поле занимает целиком: два одинаковых растянутых поля делят строку
	 * ровно пополам, и рамка каждого идёт во всю его половину. Элемент с записанной шириной и
	 * элемент со снятым растяжением в дележе не участвуют: их ширину задаёт файл, и стоят они подряд
	 * от левого края, а незанятое место остаётся в конце строки.
	 */
	function stretchRow(children, boxes) {
		for (let i = 0; i < children.length; i += 1) {
			if (canStretch(children[i].item)) {
				boxes[i].style.flex = '1 1 auto';
				boxes[i].style.minWidth = '0';
				boxes[i].classList.add('is-stretched');
			}
			// В строке высоту делить не с кем: растянутый элемент занимает её целиком.
			if (canStretchDown(children[i])) {
				boxes[i].style.alignSelf = 'stretch';
			}
		}
	}

	/**
	 * Элемент может занять свободную высоту.
	 *
	 * Записанная высота растяжение отменяет. Со значением «авто» высоту набирает не сам элемент, а
	 * его содержимое: контейнер тянется вслед за вложенным элементом, который тянется, а поле
	 * остаётся в одну строку. У таблицы и поля табличного документа умолчание вида уже растянутое,
	 * поэтому свободную высоту формы платформа отдаёт им и без записанного свойства.
	 */
	function canStretchDown(node) {
		const item = node.item;
		if (item.height) {
			return false;
		}
		if (item.verticalStretch === 'true') {
			return true;
		}
		if (item.verticalStretch === 'false' || CONTENT_SIZED_TYPES.has(item.type)) {
			return false;
		}
		const value = effective(item, 'VerticalStretch', item.verticalStretch);
		if (value === undefined || value === 'false') {
			return false;
		}
		if (value === 'true') {
			return true;
		}
		return CONTAINER_TYPES.has(item.type) && renderedChildren(node).some(canStretchDown);
	}

	/**
	 * Свободная высота столбца достаётся растянутым элементам, и они делят её поровну.
	 *
	 * Таблица занимает всё, что осталось от полей, и отжимает нижнюю строку формы к низу. Без
	 * растянутого элемента высота остаётся внизу: столбик полей стоит сверху.
	 */
	function stretchColumn(children, boxes) {
		for (let i = 0; i < children.length; i += 1) {
			if (canStretchDown(children[i])) {
				boxes[i].style.flex = '1 1 auto';
				boxes[i].classList.add('is-stretched-down');
			}
		}
	}

	/**
	 * Дети, которые попадают на форму.
	 *
	 * У группы страниц это содержимое открытой закладки: остальные страницы платформа не рисует, и
	 * высоту формы задаёт та, что видна.
	 */
	function renderedChildren(node) {
		const children = visibleNodes(node.children);
		if (node.item.type !== 'Pages') {
			return children;
		}
		const representation = effective(node.item, 'PagesRepresentation', written(node.item, 'PagesRepresentation'));
		const pages = children.filter((child) => child.item.type === 'Page');
		if (representation === 'None' || pages.length === 0) {
			return children;
		}
		const active = activePageKey(node.key, pages);
		return children.filter((child) => child.item.type !== 'Page' || child.key === active);
	}

	function previewNode(node) {
		const item = node.item;
		const type = item.type;
		let box;
		if (type === 'Pages') {
			box = previewPages(node);
		} else if (type === 'UsualGroup' || type === 'Page' || type === 'ColumnGroup') {
			box = previewGroup(node);
		} else if (type === 'LabelField') {
			box = previewLabelField(node);
		} else if (type === 'CommandBar' || type === 'AutoCommandBar' || type === 'ButtonGroup') {
			box = previewCommandBar(node);
		} else if (type === 'Popup') {
			// Подменю платформа рисует одной кнопкой, а его содержимое раскрывает только нажатием.
			box = element('button', 'pv-button', buttonLabel(item) + ' ▾');
		} else if (type === 'Table') {
			box = previewTable(node);
		} else if (type === 'SearchStringAddition' || type === 'SearchControlAddition' || type === 'ViewStatusAddition') {
			box = previewAddition(node);
		} else if (type === 'Button') {
			box = element('button', 'pv-button', buttonLabel(item));
			if (effective(item, 'DefaultButton', written(item, 'DefaultButton')) === 'true') {
				box.classList.add('is-default');
			}
		} else if (type === 'LabelDecoration' || type === 'PictureDecoration') {
			box = element('div', 'pv-decoration', item.title || item.name);
		} else if (type === 'CheckBoxField') {
			box = element('div', 'pv-radio', '☐ ' + choiceLabel(item));
		} else if (type === 'RadioButtonField') {
			box = element('div', 'pv-radio', '◉ ' + choiceLabel(item));
		} else if (type) {
			box = previewField(node);
		} else {
			box = element('div', 'pv-unknown', item.name);
		}
		// Ширину поля берёт на себя его управляющая часть: заголовок платформа считает отдельно.
		if (item.width && !box.classList.contains('pv-field')) {
			box.style.flex = 'none';
			box.style.width = widthPx(item.width);
		}
		if (state.selected === node.key) {
			box.classList.add('pv-selected');
		}
		if (item.visible === false) {
			box.classList.add('pv-hidden');
		}
		box.addEventListener('click', (event) => {
			event.stopPropagation();
			select(node.key);
		});
		return box;
	}

	// Без заголовка платформа показывает синоним реквизита; его в форме нет, поэтому берём имя
	// элемента - оно совпадает с тем, что видно в конфигураторе, в отличие от английского пути к данным.
	function fieldLabel(item) {
		if (item.title) {
			return item.title;
		}
		const synonym = dataPathTitles[item.dataPath];
		if (synonym) {
			return synonym;
		}
		if (item.name) {
			return item.name;
		}
		const parts = String(item.dataPath || '').split('.');
		return parts[parts.length - 1];
	}

	/**
	 * Подпись кнопки: заголовок, иначе синоним команды.
	 * Имя команды записано ссылкой, поэтому ищем и по ней целиком, и по хвосту `Command.<Имя>`.
	 */
	function buttonLabel(item) {
		if (item.title) {
			return item.title;
		}
		const command = item.properties && item.properties.CommandName;
		if (command) {
			const tail = command.slice(command.indexOf('Command.'));
			const synonym = commandTitles[tableCommandKey(command)] || commandTitles[command] || commandTitles[tail];
			if (synonym) {
				return synonym;
			}
		}
		return item.name;
	}

	/**
	 * Ключ подписи стандартной команды таблицы.
	 *
	 * Записана она через сам элемент - `Form.Item.<Таблица>.StandardCommand.<Имя>`, - а подпись у
	 * такой команды одна на все таблицы, поэтому имя таблицы из ключа выпадает. Команда, записанная
	 * иначе, ключа не получает.
	 */
	function tableCommandKey(command) {
		const at = String(command).indexOf('.StandardCommand.');
		if (at < 0 || !String(command).startsWith('Form.Item.')) {
			return '';
		}
		return 'Form.Item' + String(command).slice(at);
	}

	/**
	 * Какие стандартные команды таблицы форма положила своими кнопками.
	 *
	 * Второй раз платформа их в панель не набирает, а кнопка может лежать где угодно, не только в
	 * самой панели таблицы, поэтому форма обходится целиком до отрисовки.
	 */
	function collectTableCommands(nodes) {
		for (const node of nodes) {
			const command = String((node.item.properties && node.item.properties.CommandName) || '');
			const at = command.indexOf('.StandardCommand.');
			if (at >= 0 && command.startsWith('Form.Item.')) {
				const table = command.slice('Form.Item.'.length, at);
				if (!tablePlacedCommands.has(table)) {
					tablePlacedCommands.set(table, new Set());
				}
				tablePlacedCommands.get(table).add(command.slice(at + '.StandardCommand.'.length));
			}
			collectTableCommands(node.children || []);
		}
	}

	/**
	 * Панели и группы кнопок с записанным источником команд: чей набор в них ложится.
	 *
	 * Источник `Form` берёт набор самой формы, `Item.<Таблица>` - набор этой таблицы. Панель формы
	 * своим автозаполнением занята тем же набором, и когда она его уже показывает, источник его не
	 * повторяет: платформа кладёт набор один раз. Прочие источники, вроде общих команд конфигурации,
	 * остаются без набора: он не снят.
	 *
	 * @param formBarFilled Панель самой формы уже наполняется платформой.
	 */
	function collectCommandSources(nodes, formBarFilled) {
		const kindOfTable = new Map();
		const tables = (list) => {
			for (const node of list) {
				if (node.item.type === 'Table' && node.item.name) {
					kindOfTable.set(String(node.item.name), tableKinds[String(node.item.dataPath || '')]);
				}
				tables(node.children || []);
			}
		};
		tables(nodes);
		const walk = (list) => {
			for (const node of list) {
				const source = String(written(node.item, 'CommandSource') || '');
				if (source === 'Form' && !formBarFilled) {
					formSourceBars.add(node.item);
				} else if (source.indexOf('Item.') === 0) {
					const table = source.slice('Item.'.length);
					const kind = kindOfTable.get(table);
					if (kind) {
						tableBarKinds.set(node.item, kind);
						tableBarNames.set(node.item, table);
					}
				}
				walk(node.children || []);
			}
		};
		walk(nodes);
	}

	// Текст рядом с переключателем и флажком платформа берёт из списка выбора, а не из заголовка.
	function choiceLabel(item) {
		return item.choicePresentation || item.title || fieldLabel(item);
	}

	/**
	 * Кнопка выбора, которую платформа даёт полю по типу реквизита формы.
	 *
	 * У даты это календарь, у перечисления - список, у прочих ссылочных типов - «…».
	 * Тип реквизита объекта модель формы не отдаёт, поэтому такому полю кнопка не достаётся.
	 */
	function autoChoiceKind(dataPath) {
		const types = dataTypes.get(dataPath);
		if (!types || types.length === 0) {
			return '';
		}
		if (types.some((type) => type.indexOf('xs:date') === 0)) {
			return 'calendar';
		}
		if (types.some((type) => type.indexOf('EnumRef.') >= 0)) {
			return 'list';
		}
		if (types.some((type) => type.indexOf('Ref.') > 0)) {
			return 'choice';
		}
		return '';
	}

	/** Виды кнопок, которые платформа нарисует справа от поля. */
	function fieldButtons(item) {
		const auto = autoChoiceKind(item.dataPath);
		const kinds = [];
		const add = (kind) => {
			if (kind && kinds.indexOf(kind) < 0) {
				kinds.push(kind);
			}
		};
		for (const pair of FIELD_BUTTONS) {
			const value = effective(item, pair[0], written(item, pair[0]));
			if (value === 'true') {
				add(pair[1] === 'choice' && auto === 'calendar' ? 'calendar' : pair[1]);
			} else if (value === 'auto' && pair[0] === 'ChoiceButton') {
				add(auto);
			}
		}
		return kinds;
	}

	function fieldButton(kind) {
		const box = element('span', 'pv-field-button');
		box.title = FIELD_BUTTON_TITLES[kind] || '';
		if (kind === 'calendar') {
			box.append(icon('calendar'));
		} else {
			box.textContent = FIELD_BUTTON_GLYPHS[kind] || '';
		}
		return box;
	}

	function titleSide(item) {
		return TITLE_SIDES[effective(item, 'TitleLocation', item.titleLocation)] || 'left';
	}

	/**
	 * Заголовок поля; отдаёт признак того, что заголовок есть.
	 *
	 * Стороны платформа отрабатывает все: слева и сверху заголовок идёт перед полем, справа и снизу
	 * после него. Двоеточие она ставит только там, где заголовок стоит перед полем.
	 *
	 * Строку с заголовком слева отмечаем: такие подписи платформа выстраивает в общую колонку,
	 * а заголовок сверху, справа или снизу стоит по-своему и в колонку не идёт.
	 */
	function appendFieldLabel(row, item, control) {
		const side = titleSide(item);
		if (side === 'none') {
			return false;
		}
		const label = element('span', 'pv-label' + (side === 'right' || side === 'bottom' ? ' is-bare' : ''),
			fieldLabel(item));
		row.classList.add('is-title-' + side);
		if ((side === 'right' || side === 'bottom') && control) {
			row.append(control);
			row.append(label);
			return true;
		}
		row.append(label);
		if (control) {
			row.append(control);
		}
		return true;
	}

	function previewField(node) {
		const row = element('div', 'pv-field');
		const control = element('div', 'pv-control');
		control.append(element('div', 'pv-input', ''));
		for (const kind of fieldButtons(node.item)) {
			control.append(fieldButton(kind));
		}
		if (node.item.width) {
			control.style.flex = 'none';
			control.style.width = widthPx(node.item.width);
		}
		if (!appendFieldLabel(row, node.item, control)) {
			row.append(control);
		}
		return row;
	}

	/**
	 * Поле надписи платформа рисует текстом, а не полем ввода.
	 *
	 * Значение подставляется при работе формы, поэтому в превью от надписи остаётся только
	 * заголовок; надпись без заголовка места не занимает.
	 */
	function previewLabelField(node) {
		const row = element('div', 'pv-field pv-labelfield');
		if (!appendFieldLabel(row, node.item)) {
			row.classList.add('is-empty');
		}
		return row;
	}

	/** Строка поиска и состояние просмотра платформа рисует прямо в командной панели. */
	function previewAddition(node) {
		const box = element('div', 'pv-addition');
		const type = node.item.type;
		const text = type === 'SearchStringAddition' ? 'Поиск (Ctrl+F)' : typeLabel(type);
		box.append(element('span', 'pv-addition-text', text));
		return box;
	}

	/** Как платформа выделяет группу: рамкой с заголовком, фоном, линией или отступом. */
	function groupDecoration(representation) {
		if (representation === 'GroupBox') {
			return ' is-framed';
		}
		if (representation === 'StrongSeparation' || representation === 'NormalSeparation'
			|| representation === 'WeakSeparation') {
			return ' is-separated';
		}
		if (representation === 'Line') {
			return ' is-lined';
		}
		if (representation === 'Margin') {
			return ' is-margined';
		}
		return '';
	}

	/**
	 * Как платформа укладывает группу по свойству `Group`.
	 *
	 * Значения расходятся тем, что происходит, когда элементы в строку не влезают:
	 * «всегда горизонтальная» держит строку и раздвигает форму, «горизонтальная» переносит лишнее
	 * на следующую строку, а «по возможности горизонтальная» бросает строку целиком и становится
	 * вертикальной. Влезают элементы или нет, видно только по месту, поэтому такую группу помечаем,
	 * а разбирается с ней `foldTightGroups` после укладки.
	 */
	function groupLayout(group) {
		if (group === 'AlwaysHorizontal') {
			return 'is-horizontal is-nowrap';
		}
		if (group === 'Horizontal') {
			return 'is-horizontal';
		}
		if (group === 'HorizontalIfPossible') {
			return 'is-horizontal is-nowrap is-if-possible';
		}
		return 'is-vertical';
	}

	/**
	 * Выравнивание дочерних элементов группы по свойству `ChildrenAlign`.
	 *
	 * Со значением «нет» платформа общую колонку подписей не заводит: поле идёт сразу за своей
	 * подписью. Значения, начинающиеся с `ItemsRight`, прижимают сами поля к правому краю группы.
	 */
	function childrenAlign(item) {
		return alignClass(effective(item, 'ChildrenAlign', written(item, 'ChildrenAlign')));
	}

	function alignClass(value) {
		if (value === 'None') {
			return ' is-align-none';
		}
		return String(value || '').indexOf('ItemsRight') === 0 ? ' is-items-right' : '';
	}

	/**
	 * Сторона, к которой платформа прижимает заголовок в общей колонке.
	 *
	 * Имя значения называет обе стороны сразу: `ItemsLeftTitlesLeft` это «элементы слева, заголовки
	 * слева», то есть заголовок встаёт по левому краю колонки. К правому краю его прижимают только
	 * значения с «заголовки справа»; со значением «авто» платформа ставит заголовки слева.
	 */
	function markTitlesSide(box, value) {
		if (String(value || '').indexOf('TitlesRight') >= 0) {
			box.dataset.titles = 'right';
		}
	}

	function previewGroup(node) {
		const group = effective(node.item, 'Group', node.item.group);
		const layout = groupLayout(group);
		const horizontal = layout.indexOf('is-horizontal') === 0;
		const representation = effective(node.item, 'Representation', node.item.representation);
		const decoration = groupDecoration(representation);
		const box = element('div', 'pv-group ' + layout + decoration + childrenAlign(node.item));
		markTitlesSide(box, effective(node.item, 'ChildrenAlign', written(node.item, 'ChildrenAlign')));
		if (effective(node.item, 'ThroughAlign', written(node.item, 'ThroughAlign')) === 'Use') {
			box.dataset.through = 'use';
		}
		const children = visibleNodes(node.children);
		const boxes = children.map((child) => previewNode(child));
		if (horizontal) {
			stretchRow(children, boxes);
		} else {
			stretchColumn(children, boxes);
		}
		for (const child of boxes) {
			box.append(child);
		}
		const showTitle = effective(node.item, 'ShowTitle', node.item.showTitle);
		if (!node.item.title || showTitle === 'false' || decoration !== ' is-framed') {
			return box;
		}
		const framed = element('div', 'pv-groupbox');
		if (effective(node.item, 'United', written(node.item, 'United')) === 'false') {
			framed.dataset.titleLeft = 'true';
		}
		framed.append(element('div', 'pv-group-title', node.item.title));
		framed.append(box);
		placeGroupTitle(framed);
		return framed;
	}

	/**
	 * Сторона заголовка группы с рамкой.
	 *
	 * Слева в ту же строку платформа ставит его только у группы со снятым объединением, содержимое
	 * которой лежит в одну строку. В остальных случаях заголовок стоит сверху, а слева от содержимого
	 * идёт вертикальная линия. Уложилось содержимое в строку или свернулось в столбик, видно только
	 * по месту, поэтому сторону пересчитывает `foldTightGroups` после укладки.
	 */
	function placeGroupTitle(framed) {
		const content = framed.lastElementChild;
		const left = framed.dataset.titleLeft === 'true' && content.classList.contains('is-horizontal');
		framed.classList.toggle('is-title-left', left);
		framed.classList.toggle('is-title-top', !left);
	}

	/**
	 * Страницы: ряд закладок, содержимое только у открытой.
	 *
	 * Отображение закладок выключают свойством `PagesRepresentation`: со значением `None` платформа
	 * рисует страницы подряд, поэтому такая группа остаётся обычной.
	 */
	function previewPages(node) {
		const representation = effective(node.item, 'PagesRepresentation', written(node.item, 'PagesRepresentation'));
		const children = visibleNodes(node.children);
		const pages = children.filter((child) => child.item.type === 'Page');
		if (representation === 'None' || pages.length === 0) {
			return previewGroup(node);
		}
		const box = element('div', 'pv-pages is-' + tabsSide(representation));
		const active = activePageKey(node.key, pages);
		const strip = element('div', 'pv-tabs');
		for (const page of pages) {
			const tab = element('button', 'pv-tab' + (page.key === active ? ' is-active' : ''), fieldLabel(page.item));
			tab.type = 'button';
			if (page.item.visible === false) {
				tab.classList.add('pv-hidden');
			}
			tab.addEventListener('click', (event) => {
				event.stopPropagation();
				state.activePage.set(node.key, page.key);
				select(page.key);
			});
			strip.append(tab);
		}
		box.append(strip);
		const body = element('div', 'pv-pages-body');
		const shown = children.filter((child) => child.item.type !== 'Page' || child.key === active);
		const boxes = shown.map((child) => previewNode(child));
		stretchColumn(shown, boxes);
		for (const child of boxes) {
			body.append(child);
		}
		box.append(body);
		return box;
	}

	/** Сторона, с которой платформа рисует закладки страниц. */
	function tabsSide(representation) {
		if (representation === 'TabsOnBottom') {
			return 'bottom';
		}
		if (representation === 'TabsOnLeftHorizontal') {
			return 'left';
		}
		if (representation === 'TabsOnRightHorizontal') {
			return 'right';
		}
		return 'top';
	}

	/** Открытая закладка: выбранная пользователем, иначе первая страница. */
	function activePageKey(pagesKey, pages) {
		const chosen = state.activePage.get(pagesKey);
		if (chosen && pages.some((page) => page.key === chosen)) {
			return chosen;
		}
		return pages[0].key;
	}

	/**
	 * Командная панель: слева кнопки, справа «Еще» и стандартные команды правой части.
	 *
	 * Подменю «Еще» платформа держит у автоматической командной панели: туда уходят и команды,
	 * которые она набирает сама, и кнопки с расположением в подменю. В самой панели такой кнопки
	 * не видно, поэтому в превью её тоже нет.
	 */
	function previewCommandBar(node) {
		const box = element('div', 'pv-commandbar' + commandBarAlign(node.item));
		const right = [];
		// Набранные платформой команды стоят перед записанными кнопками, кроме помеченных стороной.
		const filled = autoFilled(node.item) ? standardCommandButtons(node.item) : null;
		if (filled) {
			for (const button of filled.before) {
				box.append(button);
			}
			right.push(...filled.right);
			if (filled.before.length + filled.after.length + filled.right.length === 0
				&& !knowsStandardCommands(node.item)) {
				box.append(standardCommandsNote());
			}
		}
		let inSubmenu = 0;
		for (const child of visibleNodes(node.children)) {
			if (effective(child.item, 'LocationInCommandBar', written(child.item, 'LocationInCommandBar')) === 'InAdditionalSubmenu') {
				inSubmenu += 1;
				continue;
			}
			if (atRightOfCommandBar(child.item)) {
				right.push(previewNode(child));
				continue;
			}
			box.append(previewNode(child));
		}
		for (const button of filled ? filled.after : []) {
			box.append(button);
		}
		// Строка поиска таблицы стоит в панели, у правого края: своей строкой платформа её не рисует.
		const additions = barAdditions.get(node.item) || [];
		if (additions.length) {
			const tail = element('div', 'pv-commandbar-additions');
			for (const addition of additions) {
				tail.append(previewNode(addition));
			}
			box.append(tail);
		}
		if (hasMoreMenu(node.item, inSubmenu, node.children)) {
			box.append(element('span', 'pv-commandbar-more', 'Еще ▾'));
		}
		if (right.length) {
			const tail = element('div', 'pv-commandbar-right');
			for (const button of right) {
				tail.append(button);
			}
			box.append(tail);
		}
		// Панель без кнопок платформа не рисует: наполнять её нечем, и места она не занимает.
		if (box.childElementCount === 0) {
			box.classList.add('is-empty');
		}
		return box;
	}

	/**
	 * Кнопки, которыми платформа наполняет панель самой формы.
	 *
	 * Набор приходит из md-sparrow по виду главного реквизита формы, а у панели таблицы - по виду
	 * её данных; из него уже вычтены команды, которые форма положила своими кнопками. Группа кнопок
	 * берёт набор того источника команд, который у неё записан.
	 *
	 * Команды панели таблицы записаны через сам элемент и подписаны своим словарём, поэтому имя
	 * команды приводится к ключу той панели, в которую кнопка встаёт.
	 *
	 * Кнопки расходятся на три части: перед записанными кнопками панели, после них и у правого
	 * края. Сторону задаёт сам набор, а правый край - список стандартных команд правой части.
	 */
	function standardCommandButtons(item) {
		const before = [];
		const after = [];
		const right = [];
		const prefix = ownsFormSet(item) ? 'Form.StandardCommand.' : 'Form.Item.StandardCommand.';
		for (const button of standardCommandSet(item)) {
			const name = button.command ? prefix + button.command : '';
			const label = button.label || commandTitles[name] || button.command || '';
			// Значка у команды нет, и назвать её нечем: на месте подписи встаёт нейтральная точка.
			const box = label
				? element('button', 'pv-button is-standard', button.submenu ? label + ' ▾' : label)
				: element('button', 'pv-button is-standard is-picture', '•');
			box.title = label
				? 'Кнопку ставит платформа: в файле формы её нет'
				: 'Кнопку со значком ставит платформа: команду по ней не назвать';
			if (button.defaultButton) {
				box.classList.add('is-default');
			}
			if (name && commandsAtRight.has(name)) {
				right.push(box);
			} else {
				(button.afterOwnButtons ? after : before).push(box);
			}
		}
		return { before, after, right };
	}

	/** Набор самой формы достаётся её панели и группе кнопок с источником команд «Форма». */
	function ownsFormSet(item) {
		return formOwnBars.has(item) || formSourceBars.has(item);
	}

	/**
	 * Набор, которым платформа наполнит эту панель.
	 *
	 * У панели самой формы набор идёт по виду главного реквизита, у панели таблицы - по виду её
	 * данных. Панель с записанным источником команд берёт набор своего источника.
	 *
	 * Из набора таблицы выпадают команды, которые форма положила своими кнопками: их платформа
	 * второй раз не набирает. У панели формы то же вычитание сделано до отправки в превью.
	 */
	function standardCommandSet(item) {
		if (ownsFormSet(item)) {
			return autoCommandBar;
		}
		const set = tableCommandBar[tableBarKinds.get(item)] || [];
		const placed = tablePlacedCommands.get(tableBarNames.get(item));
		return placed ? set.filter((button) => !button.command || !placed.has(button.command)) : set;
	}

	/**
	 * Набор этой панели снят, пусть даже он пуст.
	 *
	 * Пустым набор бывает и у снятого вида: у обработки без справочной информации в нём не остаётся
	 * ни одной кнопки. Пометка «Стандартные команды» нужна только там, где набора нет вовсе.
	 */
	function knowsStandardCommands(item) {
		if (ownsFormSet(item)) {
			return autoCommandBarKnown;
		}
		const kind = tableBarKinds.get(item);
		return Boolean(kind && tableCommandBar[kind]);
	}

	/**
	 * Кнопка стоит у правого края панели.
	 *
	 * Своего выравнивания у такой кнопки нет, а умолчание у панели левое: правый край ей задаёт
	 * то, что команда стандартная. Набор таких команд приходит от md-sparrow.
	 */
	function atRightOfCommandBar(item) {
		const command = item.properties && item.properties.CommandName;
		return Boolean(command) && commandsAtRight.has(command);
	}

	/**
	 * Куда панель складывает кнопки: свойство `HorizontalAlign` у автоматической панели и
	 * `HorizontalLocation` у обычной.
	 */
	function commandBarAlign(item) {
		const property = item.type === 'CommandBar' ? 'HorizontalLocation' : 'HorizontalAlign';
		const value = effective(item, property, written(item, property));
		if (value === 'Right') {
			return ' is-align-right';
		}
		return value === 'Center' ? ' is-align-center' : '';
	}

	/**
	 * Пометка о том, что панель наполняет платформа.
	 *
	 * Ставится там, где набор команд неизвестен: у панели таблицы, у группы кнопок с источником
	 * команд и у формы, вид главного реквизита которой не снят. Иначе пустая строка с одним «Еще»
	 * выглядит ошибкой.
	 */
	function standardCommandsNote() {
		const note = element('span', 'pv-commandbar-auto', 'Стандартные команды');
		note.title = 'Состав команд платформа набирает сама по виду формы';
		return note;
	}

	/**
	 * Панель наполняет платформа сама.
	 *
	 * У автоматической панели это её свойство автозаполнения. У обычной панели и у группы кнопок
	 * тем же занят источник команд: с записанным источником платформа кладёт туда его стандартные
	 * команды рядом с кнопками, которые записаны в файле.
	 */
	function autoFilled(item) {
		if (item.type === 'AutoCommandBar') {
			return effective(item, 'Autofill', written(item, 'Autofill')) !== 'false';
		}
		if (item.type !== 'CommandBar' && item.type !== 'ButtonGroup') {
			return false;
		}
		return Boolean(written(item, 'CommandSource'));
	}

	/**
	 * «Еще» есть у панели, которую наполняет платформа: часть набранных команд уходит в подменю.
	 *
	 * Обычная панель с источником команд показывает его так же, как автоматическая. Наполнить
	 * панель платформа может и через лежащую в ней группу кнопок с источником команд: «Еще» тогда
	 * всё равно её, а не группы. Кнопки с записанным расположением в подменю заводят «Еще» и без
	 * наполнения: иначе до них было бы не добраться. Группа кнопок своего «Еще» не заводит: она
	 * лежит внутри панели.
	 */
	function hasMoreMenu(item, inSubmenu, children) {
		if (item.type === 'ButtonGroup') {
			return false;
		}
		if (autoFilled(item) || inSubmenu > 0) {
			return true;
		}
		return (children || []).some((child) => autoFilled(child.item));
	}

	/**
	 * Командную панель таблицы платформа ставит по свойству `CommandBarLocation`.
	 *
	 * С положением «нет» панели не видно совсем: её команды остаются в контекстном меню, а команды
	 * таблицы обычно вынесены отдельной командной панелью формы. Служебные части таблицы платформа
	 * держит в той панели, которая эту таблицу обслуживает: в её собственной, а если та не
	 * показана - в панели самой формы.
	 */
	function previewTable(node) {
		const box = element('div', 'pv-table');
		const location = effective(node.item, 'CommandBarLocation', written(node.item, 'CommandBarLocation'));
		const children = visibleNodes(node.children);
		const bars = children.filter((child) => isBar(child.item.type)
			&& !(location === 'None' && isCommandBar(child.item.type))
			&& (isCommandBar(child.item.type) || ['top', 'bottom'].indexOf(additionPlace(node.item, child.item.type)) >= 0));
		const atBottom = (child) => (isCommandBar(child.item.type)
			? location === 'Bottom'
			: additionPlace(node.item, child.item.type) === 'bottom');
		// Набор панели таблицы идёт по виду её данных: панель узнаёт его по своей таблице.
		const kind = tableKinds[String(node.item.dataPath || '')];
		for (const bar of bars) {
			if (kind && isCommandBar(bar.item.type)) {
				tableBarKinds.set(bar.item, kind);
				tableBarNames.set(bar.item, String(node.item.name || ''));
			}
		}
		for (const bar of bars.filter((child) => !atBottom(child))) {
			box.append(previewNode(bar));
		}
		const columns = children.filter((child) => !isBar(child.item.type));
		const head = element('div', 'pv-table-head');
		for (const column of columns) {
			head.append(tableColumnHead(column));
		}
		box.append(head);
		for (let i = 0; i < 3; i += 1) {
			const row = element('div', 'pv-table-row');
			if (columns.length === 0) {
				row.append(element('div', 'pv-table-cell', ' '));
			}
			for (const column of columns) {
				row.append(tableColumnBody(column));
			}
			box.append(row);
		}
		for (const bar of bars.filter(atBottom)) {
			box.append(previewNode(bar));
		}
		return box;
	}

	/**
	 * Где платформа рисует служебную часть таблицы: в командной панели, сверху, снизу или нигде.
	 *
	 * Положение задано свойством таблицы. Строка поиска и управление поиском умеют стоять в
	 * командной панели, и «авто» платформа решает именно так. Строку поиска она заводит любой
	 * таблице, а управление поиском - только динамическому списку: у табличной части его на снимке
	 * нет. Состояние просмотра значения «в панели» не имеет и при «авто» не рисуется: его не видно
	 * ни на одном снимке. Командной панели это не касается, у неё своё свойство.
	 */
	function additionPlace(table, type) {
		const property = ADDITION_LOCATIONS[type];
		if (!property) {
			return 'top';
		}
		const value = effective(table, property, written(table, property));
		if (value === 'None') {
			return '';
		}
		if (value === 'CommandBar') {
			return 'bar';
		}
		if (value === undefined || value === 'Auto') {
			if (!IN_COMMAND_BAR_ADDITIONS.has(type)) {
				return '';
			}
			return DYNAMIC_LIST_ADDITIONS.has(type) && !isDynamicListPath(table.dataPath) ? '' : 'bar';
		}
		return value === 'Bottom' ? 'bottom' : 'top';
	}

	/**
	 * Данные таблицы - сам динамический список: поиск и отборы платформа заводит ему сама.
	 *
	 * Путь внутрь списка сюда не годится: по нему идут таблицы настроек списка, а не он сам.
	 */
	function isDynamicListPath(dataPath) {
		const types = dataTypes.get(String(dataPath || '')) || [];
		return types.some((type) => type.indexOf('DynamicList') >= 0);
	}

	/**
	 * Шапка колонки таблицы.
	 *
	 * Группу колонок платформа раскладывает по её свойству группировки: вертикальная держит колонки
	 * ярусами внутри одной колонки таблицы, горизонтальная разводит их соседними колонками под общим
	 * заголовком, «в ячейке» ставит их рядом в одной ячейке.
	 */
	function tableColumnHead(node) {
		const item = node.item;
		const columns = columnGroupChildren(node);
		if (columns.length === 0) {
			return tableHeadCell(node, columnTitle(item));
		}
		if (columnGrouping(item) === 'InCell') {
			return tableHeadCell(node, inCellTitle(columns), 'is-incell-head');
		}
		const box = columnGroupBox(item);
		if (columnGrouping(item) !== 'Horizontal') {
			for (const column of columns) {
				box.append(tableColumnHead(column));
			}
			return box;
		}
		// Полосы с общим заголовком над горизонтальной группой платформа не рисует: её колонки
		// просто стоят соседними, а собственный заголовок группы в шапку не попадает.
		const row = element('div', 'pv-table-colgroup-row');
		for (const column of columns) {
			row.append(tableColumnHead(column));
		}
		box.append(row);
		return box;
	}

	/** Пустая ячейка строки: повторяет укладку шапки, чтобы колонки стояли в общих границах. */
	function tableColumnBody(node) {
		const columns = columnGroupChildren(node);
		if (columns.length === 0) {
			return columnWidth(node.item, element('div', 'pv-table-cell', ' '));
		}
		// «В ячейке» шапка занимает одну ячейку, поэтому и строка под ней должна быть одной ячейкой.
		if (columnGrouping(node.item) === 'InCell') {
			return element('div', 'pv-table-cell', ' ');
		}
		const box = columnGroupBox(node.item);
		const host = columnGrouping(node.item) === 'Horizontal' ? element('div', 'pv-table-colgroup-row') : box;
		for (const column of columns) {
			host.append(tableColumnBody(column));
		}
		if (host !== box) {
			box.append(host);
		}
		return box;
	}

	/**
	 * Заголовок колонки, собранной группировкой «в ячейке».
	 *
	 * Собственный заголовок группы платформа в шапку не выносит: она перечисляет через запятую
	 * заголовки колонок, которые свела в одну ячейку.
	 */
	function inCellTitle(columns) {
		const titles = [];
		for (const column of columns) {
			const title = columnGroupChildren(column).length > 0
				? inCellTitle(columnGroupChildren(column))
				: columnTitle(column.item);
			if (title) {
				titles.push(title);
			}
		}
		return titles.join(', ');
	}

	/**
	 * Подпись колонки таблицы.
	 *
	 * Со снятым расположением заголовка платформа шапку колонки не подписывает: служебная колонка
	 * отступа стоит с пустой шапкой, хотя заголовок у элемента записан.
	 */
	function columnTitle(item) {
		return titleSide(item) === 'none' ? '' : fieldLabel(item);
	}

	function columnGroupChildren(node) {
		if (node.item.type !== 'ColumnGroup') {
			return [];
		}
		return visibleNodes(node.children).filter((child) => !isBar(child.item.type));
	}

	function columnGroupBox(item) {
		return element('div', 'pv-table-colgroup' + (columnGrouping(item) === 'InCell' ? ' is-incell' : ''));
	}

	function columnGrouping(item) {
		return effective(item, 'Group', written(item, 'Group'));
	}

	/**
	 * Ширина колонки в знаках.
	 *
	 * Колонку с записанной шириной платформа держит ровно такой, а не делит на неё ширину таблицы:
	 * колонки шире таблицы уводят её в горизонтальную прокрутку.
	 */
	function columnWidth(item, cell) {
		if (item.width) {
			// Колонке в один знак платформа отводит ровно знак: у поля такой нижней границы нет.
			const px = Math.max(8, Number(item.width) * 8) + 'px';
			cell.style.flex = 'none';
			cell.style.width = px;
			cell.style.minWidth = px;
		}
		return cell;
	}

	function tableHeadCell(node, text, extra) {
		const cell = columnWidth(node.item, element('div', 'pv-table-cell' + (extra ? ' ' + extra : ''), text));
		cell.addEventListener('click', (event) => {
			event.stopPropagation();
			select(node.key);
		});
		if (state.selected === node.key) {
			cell.classList.add('pv-selected');
		}
		return cell;
	}

	function isCommandBar(type) {
		return type === 'CommandBar' || type === 'AutoCommandBar';
	}

	function isBar(type) {
		return isCommandBar(type) || type === 'SearchStringAddition'
			|| type === 'SearchControlAddition' || type === 'ViewStatusAddition' || type === 'ContextMenu';
	}

	// Данные формы

	function renderData() {
		const host = document.getElementById('dataBody');
		host.textContent = '';
		const list = element('div', 'data-list');
		if (state.dataTab === 'attributes') {
			const attributes = content.attributes || [];
			if (attributes.length === 0) {
				host.append(element('div', 'empty-note', 'Реквизитов нет'));
				return;
			}
			list.append(dataHead('Реквизит', 'Тип'));
			for (const attribute of attributes) {
				list.append(dataRow(attribute.name, typeText(attribute.type), attribute.main ? 'основной' : '', 'type'));
				for (const column of attribute.columns || []) {
					const row = dataRow(column.name, typeText(column.type), '', 'type');
					row.classList.add('is-column');
					list.append(row);
				}
			}
		} else if (state.dataTab === 'commands') {
			const commands = content.commands || [];
			if (commands.length === 0) {
				host.append(element('div', 'empty-note', 'Команд нет'));
				return;
			}
			list.append(dataHead('Команда', 'Действие'));
			for (const command of commands) {
				const row = element('div', 'data-row');
				row.append(icon('button'));
				row.append(element('span', 'data-name', command.title || command.name));
				const action = element('span', 'data-note');
				if (command.action) {
					action.append(handlerLink(command.action));
				}
				row.append(action);
				list.append(row);
			}
		} else if (state.dataTab === 'parameters') {
			const parameters = content.parameters || [];
			if (parameters.length === 0) {
				host.append(element('div', 'empty-note', 'Параметров нет'));
				return;
			}
			list.append(dataHead('Параметр', 'Тип'));
			for (const parameter of parameters) {
				list.append(dataRow(parameter.name, typeText(parameter.type), parameter.key ? 'ключевой' : '', 'type'));
			}
		} else {
			const events = content.events || [];
			if (events.length === 0) {
				host.append(element('div', 'empty-note', 'Обработчиков нет'));
				return;
			}
			list.append(dataHead('Событие', 'Обработчик'));
			for (const event of events) {
				const row = element('div', 'data-row');
				row.append(element('span', 'data-name', event.name));
				const handler = element('span', 'data-note');
				handler.append(handlerLink(event.handler));
				row.append(handler);
				list.append(row);
			}
		}
		host.append(list);
	}

	function dataHead(nameTitle, noteTitle) {
		const head = element('div', 'data-head');
		head.append(element('span', 'data-name', nameTitle));
		head.append(element('span', 'data-note', noteTitle));
		return head;
	}

	function dataRow(name, note, extra, shapeKey) {
		const row = element('div', 'data-row');
		if (shapeKey) {
			row.append(icon(shapeKey));
		}
		row.append(element('span', 'data-name', name));
		const noteText = [note, extra].filter(Boolean).join(', ');
		row.append(element('span', 'data-note', noteText));
		return row;
	}

	function typeText(type) {
		if (!type || !type.types || type.types.length === 0) {
			return '';
		}
		return type.types.join(', ');
	}

	function handlerLink(handler) {
		const button = element('button', 'link-button', handler || '');
		button.type = 'button';
		button.addEventListener('click', () => {
			vscode.postMessage({ type: 'openHandler', handler: handler });
		});
		return button;
	}

	// Запуск

	for (const tab of document.querySelectorAll('.pane-tab')) {
		tab.addEventListener('click', () => {
			state.dataTab = tab.dataset.tab;
			for (const other of document.querySelectorAll('.pane-tab')) {
				other.classList.toggle('is-active', other === tab);
			}
			renderData();
		});
	}

	// Нижние вкладки: «Форма» - эта вкладка, «Модуль» открывает модуль формы соседней вкладкой редактора.
	document.getElementById('tabModule').addEventListener('click', () => {
		vscode.postMessage({ type: 'openModule' });
	});
	document.getElementById('tabForm').addEventListener('click', () => {
		document.getElementById('tabForm').classList.add('is-active');
		document.getElementById('tabModule').classList.remove('is-active');
	});

	// После записи свойств расширение присылает перечитанную форму: выделение остаётся на месте.
	window.addEventListener('message', (event) => {
		if (!event.data || event.data.type !== 'content') {
			return;
		}
		content = event.data.content || {};
		tree = withKeys(content.items, '');
		dataTypes = attributeTypes();
		if (state.selected && !findNode(tree, state.selected)) {
			state.selected = null;
		}
		renderTree();
		renderPreview();
		renderData();
	});

	setUpSplitters();
	watchPreviewWidth();

	renderTree();
	renderPreview();
	renderData();

	/**
	 * Пересчёт укладки при смене ширины просмотра.
	 *
	 * От ширины зависит, влезает ли группа «горизонтальная, если возможно» в строку, а ширину меняют
	 * и границы панелей, и само окно. Следим за шириной, а не за каждым событием: свои же правки
	 * укладки высоту меняют, ширину нет, поэтому пересчёт себя не вызывает.
	 */
	function watchPreviewWidth() {
		const host = document.getElementById('preview');
		if (!host || typeof ResizeObserver !== 'function') {
			return;
		}
		let known = 0;
		new ResizeObserver(() => {
			const width = Math.round(host.clientWidth);
			if (width === known) {
				return;
			}
			known = width;
			foldTightGroups(host);
			alignGroupTitles(host);
			alignLabelColumns(host);
		}).observe(host);
	}

	/**
	 * Границы панелей тянутся мышью.
	 *
	 * Положение держим долями, а не пикселями: окно меняет размер, а раскладка должна оставаться
	 * такой же по виду. Запоминаем на форму, чтобы у списка и у элемента были свои пропорции.
	 */
	function setUpSplitters() {
		const layout = document.getElementById('layout');
		if (!layout) {
			return;
		}
		const key = SPLIT_STORAGE_KEY + (document.title || '');
		const saved = readSplit(key);
		if (saved.x) {
			layout.style.setProperty('--split-x', saved.x);
		}
		if (saved.y) {
			layout.style.setProperty('--split-y', saved.y);
		}
		drag(document.getElementById('splitV'), 'x');
		drag(document.getElementById('splitH'), 'y');

		function drag(handle, axis) {
			if (!handle) {
				return;
			}
			handle.addEventListener('pointerdown', (event) => {
				event.preventDefault();
				handle.setPointerCapture(event.pointerId);
				handle.classList.add('is-dragging');
				const grabbed = handle.getBoundingClientRect();
				// Место захвата внутри разделителя: без него граница прыгает под курсор при нажатии.
				const grab = axis === 'x' ? event.clientX - grabbed.left : event.clientY - grabbed.top;
				const thickness = axis === 'x' ? grabbed.width : grabbed.height;
				const move = (moveEvent) => {
					const box = layout.getBoundingClientRect();
					// Разделитель занимает своё место в раскладке, поэтому доли делят остаток.
					const whole = (axis === 'x' ? box.width : box.height) - thickness;
					const pointer = axis === 'x' ? moveEvent.clientX - box.left : moveEvent.clientY - box.top;
					const share = Math.min(0.85, Math.max(0.15, (pointer - grab) / whole));
					// Вторая доля остаётся 1fr, поэтому храним отношение первой ко второй, а не проценты.
					const value = (share / (1 - share)).toFixed(4) + 'fr';
					layout.style.setProperty(axis === 'x' ? '--split-x' : '--split-y', value);
				};
				const up = () => {
					handle.classList.remove('is-dragging');
					window.removeEventListener('pointermove', move);
					window.removeEventListener('pointerup', up);
					writeSplit(key, {
						x: layout.style.getPropertyValue('--split-x'),
						y: layout.style.getPropertyValue('--split-y'),
					});
				};
				window.addEventListener('pointermove', move);
				window.addEventListener('pointerup', up);
			});
		}
	}

	/** Положение границ прошлого сеанса; недоступное хранилище просто означает раскладку по умолчанию. */
	function readSplit(key) {
		try {
			return JSON.parse(localStorage.getItem(key) || '{}');
		} catch (error) {
			return {};
		}
	}

	function writeSplit(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch (error) {
			// Хранилище может быть недоступно: раскладка просто не запомнится.
		}
	}
})();
