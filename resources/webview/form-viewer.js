// Просмотр управляемой формы: дерево элементов, схематичное превью, данные формы и свойства.
// Модель приходит из md-sparrow через window.__FORM_DATA__.

(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const data = window.__FORM_DATA__ || {};
	const content = data.content || {};

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

	const tree = withKeys(content.items, '');

	function typeLabel(type) {
		return TYPE_LABELS[type] || type || 'Элемент';
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
		renderProperties();
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
		} else if (type === 'Button') {
			box = element('button', 'pv-button', item.title || item.name);
		} else if (type === 'LabelDecoration' || type === 'PictureDecoration') {
			box = element('div', 'pv-decoration', item.title || item.name);
		} else if (type === 'CheckBoxField') {
			box = element('div', 'pv-radio', '☐ ' + (item.title || fieldLabel(item)));
		} else if (type === 'RadioButtonField') {
			box = element('div', 'pv-radio', '◉ ' + (item.title || fieldLabel(item)));
		} else if (type) {
			box = previewField(node);
		} else {
			box = element('div', 'pv-unknown', item.name);
		}
		if (state.selected === node.key) {
			box.classList.add('pv-selected');
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
		if (item.name) {
			return item.name;
		}
		const parts = String(item.dataPath || '').split('.');
		return parts[parts.length - 1];
	}

	function previewField(node) {
		const row = element('div', 'pv-field');
		if (node.item.titleLocation !== 'NONE') {
			row.append(element('span', 'pv-label', fieldLabel(node.item) + ':'));
		}
		const input = element('div', 'pv-input', '');
		if (node.item.width) {
			input.style.flex = 'none';
			input.style.width = Math.max(40, Number(node.item.width) * 8) + 'px';
		}
		row.append(input);
		return row;
	}

	function previewGroup(node) {
		const horizontal = node.item.group === 'HORIZONTAL' || node.item.group === 'HORIZONTAL_IF_POSSIBLE';
		const box = element('div', 'pv-group ' + (horizontal ? 'is-horizontal' : 'is-vertical'));
		if (node.item.title && node.item.showTitle !== 'FALSE') {
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
		if (box.childElementCount === 0) {
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
				row.append(element('div', 'pv-table-cell', '—'));
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
			for (const attribute of attributes) {
				list.append(dataRow(attribute.name, typeText(attribute.type), attribute.main ? 'основной' : ''));
				for (const column of attribute.columns || []) {
					const row = dataRow(column.name, typeText(column.type), '');
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
			for (const command of commands) {
				const row = element('div', 'data-row');
				row.append(element('span', 'data-name', command.name));
				if (command.action) {
					row.append(handlerLink(command.action));
				}
				list.append(row);
			}
		} else if (state.dataTab === 'parameters') {
			const parameters = content.parameters || [];
			if (parameters.length === 0) {
				host.append(element('div', 'empty-note', 'Параметров нет'));
				return;
			}
			for (const parameter of parameters) {
				list.append(dataRow(parameter.name, typeText(parameter.type), parameter.key ? 'ключевой' : ''));
			}
		} else {
			const events = content.events || [];
			if (events.length === 0) {
				host.append(element('div', 'empty-note', 'Обработчиков нет'));
				return;
			}
			for (const event of events) {
				const row = element('div', 'data-row');
				row.append(element('span', 'data-name', event.name));
				row.append(handlerLink(event.handler));
				list.append(row);
			}
		}
		host.append(list);
	}

	function dataRow(name, note, extra) {
		const row = element('div', 'data-row');
		row.append(element('span', 'data-name', name));
		const noteText = [note, extra].filter(Boolean).join(', ');
		if (noteText) {
			row.append(element('span', 'data-note', noteText));
		}
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

	// Свойства выделенного элемента

	const PROPERTY_LABELS = [
		['name', 'Имя'],
		['type', 'Тип элемента'],
		['title', 'Заголовок'],
		['dataPath', 'Путь к данным'],
		['group', 'Группировка'],
		['showTitle', 'Отображать заголовок'],
		['titleLocation', 'Положение заголовка'],
		['representation', 'Представление'],
		['visible', 'Видимость'],
		['enabled', 'Доступность'],
		['readOnly', 'Только просмотр'],
		['width', 'Ширина'],
		['height', 'Высота'],
		['horizontalStretch', 'Растягивать по горизонтали'],
		['verticalStretch', 'Растягивать по вертикали'],
		['id', 'Идентификатор'],
	];

	function renderProperties() {
		const host = document.getElementById('properties');
		host.textContent = '';
		const node = state.selected ? findNode(tree, state.selected) : null;
		if (!node) {
			host.append(element('div', 'empty-note', 'Выберите элемент'));
			return;
		}
		for (const pair of PROPERTY_LABELS) {
			const value = node.item[pair[0]];
			if (value === undefined || value === null || value === '') {
				continue;
			}
			const row = element('div', 'prop-row');
			row.append(element('div', 'prop-name', pair[1]));
			row.append(element('div', 'prop-value', pair[0] === 'type' ? typeLabel(value) : String(value)));
			host.append(row);
		}
		for (const event of node.item.events || []) {
			const row = element('div', 'prop-row');
			row.append(element('div', 'prop-name', event.name));
			const value = element('div', 'prop-value');
			value.append(handlerLink(event.handler));
			row.append(value);
			host.append(row);
		}
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

	renderTree();
	renderPreview();
	renderData();
	renderProperties();
})();
