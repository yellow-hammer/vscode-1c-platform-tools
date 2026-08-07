// Просмотр управляемой формы: дерево элементов, схематичное превью, данные формы и свойства.
// Модель приходит из md-sparrow через window.__FORM_DATA__.

(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const data = window.__FORM_DATA__ || {};
	let content = data.content || {};
	// Умолчания раскладки: в файле лежит только изменённое, поэтому пустое свойство берём отсюда.
	const layoutDefaults = data.layoutDefaults || {};
	// Без заголовка платформа подписывает поле синонимом реквизита, а не именем элемента.
	const dataPathTitles = data.dataPathTitles || {};
	// Кнопку без заголовка платформа подписывает синонимом команды, на которую та ссылается.
	const commandTitles = data.commandTitles || {};

	/** Элементы, которые в конфигураторе видны, но на превью только мешают. */
	const SERVICE_TYPES = new Set(['ExtendedTooltip', 'ContextMenu']);

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

	const state = {
		selected: null,
		collapsed: new Set(),
		showService: false,
		dataTab: 'attributes',
	};

	/** Плоский список элементов с ключами пути: ключ переживает перерисовку. */
	function withKeys(items, prefix) {
		return (items || []).map((item, index) => {
			const key = prefix + '/' + index;
			return { item: item, key: key, children: withKeys(item.items, key) };
		});
	}

	let tree = withKeys(content.items, '');

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

	function visibleNodes(nodes) {
		return state.showService ? nodes : nodes.filter((node) => !SERVICE_TYPES.has(node.item.type));
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
		renderTree();
		renderPreview();
		const node = findNode(tree, key);
		vscode.postMessage({ type: 'select', item: node ? itemProperties(node.item) : undefined });
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
		const root = element('div', 'pv-group is-vertical');
		root.style.border = 'none';
		for (const node of nodes) {
			root.append(previewNode(node));
		}
		host.append(root);
	}

	function previewNode(node) {
		const item = node.item;
		const type = item.type;
		let box;
		if (type === 'UsualGroup' || type === 'Page' || type === 'Pages' || type === 'ColumnGroup') {
			box = previewGroup(node);
		} else if (type === 'CommandBar' || type === 'AutoCommandBar' || type === 'ButtonGroup' || type === 'Popup') {
			box = previewCommandBar(node);
		} else if (type === 'Table') {
			box = previewTable(node);
		} else if (type === 'SearchStringAddition' || type === 'SearchControlAddition' || type === 'ViewStatusAddition') {
			box = previewAddition(node);
		} else if (type === 'Button') {
			box = element('button', 'pv-button', buttonLabel(item));
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
			const synonym = commandTitles[command] || commandTitles[tail];
			if (synonym) {
				return synonym;
			}
		}
		return item.name;
	}

	// Текст рядом с переключателем и флажком платформа берёт из списка выбора, а не из заголовка.
	function choiceLabel(item) {
		return item.choicePresentation || item.title || fieldLabel(item);
	}

	function previewField(node) {
		const row = element('div', 'pv-field');
		if (effective(node.item, 'TitleLocation', node.item.titleLocation) !== 'None') {
			row.append(element('span', 'pv-label', fieldLabel(node.item)));
		}
		const input = element('div', 'pv-input', '');
		if (node.item.width) {
			input.style.flex = 'none';
			input.style.width = Math.max(40, Number(node.item.width) * 8) + 'px';
		}
		row.append(input);
		return row;
	}

	/** Строка поиска и состояние просмотра платформа рисует прямо в командной панели. */
	function previewAddition(node) {
		const box = element('div', 'pv-addition');
		box.append(element('span', 'pv-addition-text', node.item.type === 'ViewStatusAddition' ? 'Состояние просмотра' : 'Поиск'));
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

	function previewGroup(node) {
		const group = effective(node.item, 'Group', node.item.group);
		const horizontal = group === 'Horizontal' || group === 'HorizontalIfPossible' || group === 'AlwaysHorizontal';
		const representation = effective(node.item, 'Representation', node.item.representation);
		const decoration = groupDecoration(representation);
		const box = element('div', 'pv-group ' + (horizontal ? 'is-horizontal' : 'is-vertical') + decoration);
		const showTitle = effective(node.item, 'ShowTitle', node.item.showTitle);
		if (node.item.title && showTitle !== 'false' && decoration === ' is-framed') {
			box.append(element('div', 'pv-group-title', node.item.title));
		}
		for (const child of visibleNodes(node.children)) {
			box.append(previewNode(child));
		}
		return box;
	}

	function previewCommandBar(node) {
		const box = element('div', 'pv-commandbar');
		for (const child of visibleNodes(node.children)) {
			box.append(previewNode(child));
		}
		if (box.childElementCount === 0 && node.item.type !== 'ButtonGroup') {
			box.append(element('span', 'pv-unknown', typeLabel(node.item.type)));
		}
		return box;
	}

	function previewTable(node) {
		const box = element('div', 'pv-table');
		const bars = visibleNodes(node.children).filter((child) => isBar(child.item.type));
		for (const bar of bars) {
			box.append(previewNode(bar));
		}
		const head = element('div', 'pv-table-head');
		const columns = visibleNodes(node.children).filter((child) => !isBar(child.item.type));
		for (const column of columns) {
			const cell = element('div', 'pv-table-cell', fieldLabel(column.item));
			cell.addEventListener('click', (event) => {
				event.stopPropagation();
				select(column.key);
			});
			if (state.selected === column.key) {
				cell.classList.add('pv-selected');
			}
			head.append(cell);
		}
		box.append(head);
		for (let i = 0; i < 3; i += 1) {
			const row = element('div', 'pv-table-row');
			for (let c = 0; c < Math.max(columns.length, 1); c += 1) {
				row.append(element('div', 'pv-table-cell', ' '));
			}
			box.append(row);
		}
		return box;
	}

	function isBar(type) {
		return type === 'CommandBar' || type === 'AutoCommandBar' || type === 'SearchStringAddition'
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

	document.getElementById('showService').addEventListener('change', (event) => {
		state.showService = event.target.checked;
		renderTree();
		renderPreview();
	});

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
		if (state.selected && !findNode(tree, state.selected)) {
			state.selected = null;
		}
		renderTree();
		renderPreview();
		renderData();
	});

	renderTree();
	renderPreview();
	renderData();
})();
