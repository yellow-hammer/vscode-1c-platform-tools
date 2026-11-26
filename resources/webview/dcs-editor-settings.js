/**
 * Закладка «Настройки» редактора СКД: таблица вариантов, дерево структуры и конструктор настроек (расчёты мастера
 * в dcs-editor-settings-wizard.js).
 *
 * Подключается до dcs-editor.js и задаёт фабрику window.DcsEditorSettings, которую основной скрипт зовёт с объектом
 * ядра. Общее состояние читается и пишется через его поля-аксессоры (core.model, core.pendingSelect…), а не копией.
 * Вкладки узла рисует dcs-editor-settings-panels.js.
 */
window.DcsEditorSettings = function (core) {
	'use strict';

	const {
		attachCompletion, BUSY, cell, checkbox, clearReplyFocus, closeDialog, completer, completionTypeOptions, confirmRemove,
		dragZone, dropIndex, editBusy, el, emptyNote, fieldPaths, fieldTreeKey, fieldTypes, focusKey, focusKeyed, focusKeys,
		formRow, groupTitle, iconButton, keyed, list, nameEl, openDialog, post, pushDialog, renderContent, replyFocus,
		requestDescriptions, seededVariants, selectInput, send, setHint, setStatus, showNotice, suggestName, textInput,
		typeChildrenEnv, variantCache, variantErrors,
	} = core;

	// ---------- вкладка «Настройки»: варианты и дерево структуры ----------

	/**
	 * Состояние вкладки вне модели: переживает перерисовку. nodePath: шаги {list, index}, пустой путь означает корень;
	 * ключи развёрнутости: JSON пути. Псевдо-узел «Колонки/Строки/Точки/Серии» помечен последним шагом с index −1,
	 * наружу такой шаг не уходит.
	 */
	const uiState = { variant: '', nodePath: [], panel: 'selection', expanded: new Set(), showInaccessibleParams: false };

	const NODE_LISTS = ['structure', 'columns', 'rows', 'points', 'series'];
	const PSEUDO_TITLES = { columns: 'Колонки', rows: 'Строки', points: 'Точки', series: 'Серии' };

	/** Items подписан «Без иерархии», как в мастере настроек. */
	const GROUP_TYPE_OPTIONS = [
		{ value: 'Items', label: 'Без иерархии' },
		{ value: 'Hierarchy', label: 'Иерархия' },
		{ value: 'HierarchyOnly', label: 'Только иерархия' },
	];

	/** Дополнение периода: все значения DataCompositionPeriodAdditionType из core XSD. */
	const PERIOD_ADDITION_LABELS = {
		None: 'Нет',
		Year: 'Год',
		HalfYear: 'Полугодие',
		Quarter: 'Квартал',
		Month: 'Месяц',
		TenDays: 'Декада',
		Week: 'Неделя',
		Day: 'День',
		Hour: 'Час',
		Minute: 'Минута',
		Second: 'Секунда',
		YearSinceBeginOfPeriod: 'Год с начала периода',
		HalfYearSinceBeginOfPeriod: 'Полугодие с начала периода',
		QuarterSinceBeginOfPeriod: 'Квартал с начала периода',
		MonthSinceBeginOfPeriod: 'Месяц с начала периода',
		WeekSinceBeginOfPeriod: 'Неделя с начала периода',
		DaySinceBeginOfPeriod: 'День с начала периода',
		HourSinceBeginOfPeriod: 'Час с начала периода',
		MinuteSinceBeginOfPeriod: 'Минута с начала периода',
		YearSinceBeginOfPeriod445: 'Год с начала периода 4-4-5',
		HalfYearSinceBeginOfPeriod445: 'Полугодие с начала периода 4-4-5',
		QuarterSinceBeginOfPeriod445: 'Квартал с начала периода 4-4-5',
		MonthSinceBeginOfPeriod445: 'Месяц с начала периода 4-4-5',
	};

	const PLACEMENT_OPTIONS = [
		{ value: 'Auto', label: 'Авто' },
		{ value: 'Horizontally', label: 'Горизонтально' },
		{ value: 'Vertically', label: 'Вертикально' },
		{ value: 'SpecialColumn', label: 'Отдельная колонка' },
		{ value: 'Together', label: 'Вместе' },
	];

	/** Вариант, чьи настройки меняет правка: если ответ saved их не принесёт, вариант перечитается лениво. */
	function affectedVariant(type, fields) {
		if (typeof fields.variant === 'string') {
			return fields.variant;
		}
		if (type === 'dcs/add-settings-variant' || type === 'dcs/remove-settings-variant') {
			return fields.name || '';
		}
		if (type === 'dcs/set-settings-variant-props') {
			const payload = fields.payload || {};
			return (typeof payload.newName === 'string' && payload.newName) || fields.name || '';
		}
		return '';
	}

	function pathKey(path) {
		return JSON.stringify(path);
	}

	function sectionItems(section) {
		return section && Array.isArray(section.items) ? section.items : [];
	}

	/** Узел по пути от корня настроек; для псевдо-шага (index −1) узла нет. */
	function nodeAt(settings, path) {
		let node = settings;
		for (const step of path) {
			const items = node && Array.isArray(node[step.list]) ? node[step.list] : null;
			if (!items || step.index < 0 || step.index >= items.length) {
				return null;
			}
			node = items[step.index];
		}
		return node;
	}

	function isPseudoPath(path) {
		return path.length > 0 && path[path.length - 1].index === -1;
	}

	function nodeKindAt(settings, path) {
		if (isPseudoPath(path)) {
			return 'pseudo';
		}
		if (path.length === 0) {
			return 'root';
		}
		const node = nodeAt(settings, path);
		return node ? node.kind : 'group';
	}

	function activeVariantName() {
		const names = list('settingsVariants')
			.map((item) => item.name || '')
			.filter(Boolean);
		if (names.indexOf(uiState.variant) < 0) {
			uiState.variant = names[0] || '';
		}
		return uiState.variant;
	}

	/** Вкладка узла не сбрасывается: листая варианты стрелками, смотрят одну и ту же вкладку. */
	function selectVariant(name) {
		// Ответ правки, отправленной до смены варианта, фокус не переносит
		clearReplyFocus();
		uiState.variant = name;
		uiState.nodePath = [];
		uiState.expanded = new Set();
		delete seededVariants[name];
		renderContent();
	}

	function requestVariant(name) {
		if (core.variantLoading === name) {
			return;
		}
		core.variantLoading = name;
		post('dcs/load-variant', { variant: name });
	}

	/** Первый показ варианта: дерево структуры разворачивается целиком. */
	function seedExpanded(settings) {
		uiState.expanded.add(pathKey([]));
		function walk(node, path) {
			const kind = path.length === 0 ? 'root' : node.kind;
			if (kind === 'table' || kind === 'chart') {
				uiState.expanded.add(pathKey(path));
				for (const listName of kind === 'table' ? ['columns', 'rows'] : ['points', 'series']) {
					uiState.expanded.add(pathKey(path.concat([{ list: listName, index: -1 }])));
					const items = Array.isArray(node[listName]) ? node[listName] : [];
					items.forEach((child, index) => walk(child, path.concat([{ list: listName, index: index }])));
				}
				return;
			}
			const items = Array.isArray(node.structure) ? node.structure : [];
			if (items.length > 0) {
				uiState.expanded.add(pathKey(path));
			}
			items.forEach((child, index) => walk(child, path.concat([{ list: 'structure', index: index }])));
		}
		walk(settings, []);
	}

	function expandTo(path) {
		uiState.expanded.add(pathKey([]));
		for (let i = 0; i < path.length; i++) {
			const prefix = path.slice(0, i);
			uiState.expanded.add(pathKey(prefix));
			if (path[i].list !== 'structure') {
				uiState.expanded.add(pathKey(prefix.concat([{ list: path[i].list, index: -1 }])));
			}
		}
	}

	/** Пути полей настроек: поля наборов, вычисляемые, ресурсы и доступные параметры. */
	function settingsFieldPaths() {
		const paths = fieldPaths();
		function push(path) {
			if (path && paths.indexOf(path) < 0) {
				paths.push(path);
			}
		}
		for (const total of list('totalFields')) {
			push(total.name || '');
		}
		for (const param of list('parameters')) {
			// Платформа пишет availableAsField только со значением false: без ключа параметр доступен
			if (param.availableAsField !== false && param.name) {
				push('ПараметрыДанных.' + param.name);
			}
		}
		return paths.sort((a, b) => a.localeCompare(b, 'ru'));
	}

	/** section: раздел настроек (selection, filter, group, order) для ограничений использования полей; без него any. */
	function attachFieldList(input, section) {
		attachCompletion(input, () => 'settings:' + (section || 'any'));
	}

	function optionLabel(options, value, fallback) {
		for (const option of options) {
			if (option.value === value) {
				return option.label;
			}
		}
		return value || fallback;
	}

	function periodAdditionLabel(value) {
		return PERIOD_ADDITION_LABELS[value] || value || 'Нет';
	}

	function groupFieldLabel(groupField) {
		let label = groupField.field || '<Авто>';
		if (groupField.groupType === 'Hierarchy') {
			label += ' (иерархия)';
		} else if (groupField.groupType === 'HierarchyOnly') {
			label += ' (только иерархия)';
		}
		const period = groupField.periodAdditionType;
		if (period && period !== 'None') {
			label += ' (' + periodAdditionLabel(period).toLowerCase() + ')';
		}
		return label;
	}

	function groupLabel(node) {
		const fields = Array.isArray(node.groupFields) ? node.groupFields : [];
		if (fields.length === 0) {
			return '<Детальные записи>';
		}
		return fields.map(groupFieldLabel).join(', ');
	}

	function nodeLabel(node) {
		if (node.kind === 'table') {
			return 'Таблица';
		}
		if (node.kind === 'chart') {
			return 'Диаграмма';
		}
		if (node.kind === 'nestedObject') {
			return 'Вложенный отчёт: ' + (node.objectID || '');
		}
		return groupLabel(node);
	}

	function sectionBadges(node) {
		const badges = [];
		const filterCount = sectionItems(node.filter).length;
		if (filterCount > 0) {
			badges.push({ text: 'О', hint: 'Отбор: ' + filterCount });
		}
		const orderCount = sectionItems(node.order).length;
		if (orderCount > 0) {
			badges.push({ text: 'С', hint: 'Сортировка: ' + orderCount });
		}
		const selection = sectionItems(node.selection);
		if (selection.length > 0 && !(selection.length === 1 && selection[0].kind === 'auto')) {
			badges.push({ text: 'ВП', hint: 'Выбранные поля: ' + selection.length });
		}
		const appearanceCount = sectionItems(node.conditionalAppearance).length;
		if (appearanceCount > 0) {
			badges.push({ text: 'УО', hint: 'Условное оформление: ' + appearanceCount });
		}
		const outputCount = sectionItems(node.outputParameters).length;
		if (outputCount > 0) {
			badges.push({ text: 'ДН', hint: 'Другие настройки: ' + outputCount });
		}
		return badges;
	}

	function countDescendants(node) {
		let count = 0;
		for (const listName of NODE_LISTS) {
			const items = Array.isArray(node[listName]) ? node[listName] : [];
			for (const child of items) {
				count += 1 + countDescendants(child);
			}
		}
		return count;
	}

	/** У md-sparrow нет копирования и перестановки вариантов: кнопки есть, как в конфигураторе, но недоступны. */
	const VARIANT_COPY_NOTE = 'Недоступно: варианты копируют в конфигураторе.';
	const VARIANT_MOVE_NOTE = 'Недоступно: порядок вариантов меняют в конфигураторе.';
	const WIZARD_NOTE = 'Собрать структуру, выбранные поля и порядок варианта по шагам: список, таблица или диаграмма';

	/** Щелчок по недоступной команде показывает причину плашкой, а не пропадает молча. */
	function settingsNotice(title, text) {
		showNotice('info', title, [{ text: text }]);
	}

	/** Раскладка как в конфигураторе: сверху таблица вариантов и дерево структуры, под ними вкладки узла. */
	function renderVariants(host) {
		const variants = list('settingsVariants');
		const name = activeVariantName();
		const layout = el('div', 'dcs-setv');
		const top = el('div', 'dcs-setv-top');
		const variantPane = el('div', 'dcs-setv-pane');
		renderVariantList(variantPane, variants, name);
		top.appendChild(variantPane);
		const structurePane = el('div', 'dcs-setv-pane');
		top.appendChild(structurePane);
		layout.appendChild(top);
		const bottom = el('div', 'dcs-setv-bottom');
		layout.appendChild(bottom);
		host.appendChild(layout);
		const settings = name ? loadedVariantSettings(structurePane, name) : null;
		if (!name) {
			emptyNote(structurePane, 'Вариантов настроек нет.');
		}
		if (settings) {
			if (!seededVariants[name]) {
				seededVariants[name] = true;
				seedExpanded(settings);
			}
			ensureValidSelection(settings);
			renderStructureTree(structurePane, settings, name);
			renderNodePanels(bottom, settings, name);
		} else {
			// Вариант грузится или не загрузился: пустой низ не держит высоту
			bottom.classList.add('dcs-setv-bottom-idle');
		}
		// Фокус на новой строке; если строки нет (удалён последний вариант), на «Добавить вариант…»
		if (core.focusVariantRow) {
			core.focusVariantRow = false;
			const row = focusKeys.get(focusKey(['varrow', name]));
			if (row && row.isConnected) {
				focusGridRow(row);
			} else {
				focusKeyed(focusKey(['vartool', 'add']));
			}
		}
		if (core.focusStructureRow) {
			core.focusStructureRow = false;
			focusKeyed(focusKey(['node', pathKey(uiState.nodePath)]));
		}
	}

	/** Настройки варианта или null: пока их нет, рисует плашку загрузки (с запросом) или ошибки с повтором. */
	function loadedVariantSettings(host, name) {
		if (variantErrors[name]) {
			const plate = el('div', 'dcs-plate dcs-plate-error');
			plate.appendChild(el('div', '', 'Вариант не загружен. ' + variantErrors[name]));
			const retry = el('button', 'ghost-btn dcs-btn-small', 'Повторить');
			retry.type = 'button';
			retry.addEventListener('click', () => {
				delete variantErrors[name];
				renderContent();
			});
			plate.appendChild(retry);
			host.appendChild(plate);
			return null;
		}
		const settings = variantCache[name];
		if (!settings) {
			// Ленивая загрузка: содержимое варианта придёт сообщением {type: 'variant'}
			requestVariant(name);
			host.appendChild(el('div', 'dcs-plate', 'Загружаем настройки варианта…'));
			return null;
		}
		return settings;
	}

	/**
	 * Таблица вариантов: одна остановка Tab на строке выбранного варианта; ↑ ↓ Home End выбирают соседний, Enter и F2
	 * открывают свойства, Delete удаляет.
	 */
	function renderVariantList(host, variants, name) {
		const current = variants.find((item) => (item.name || '') === name) || null;
		const none = current ? '' : 'Недоступно: вариантов нет.';
		const loaded = Boolean(current && variantCache[name]);
		let wizardBlocked = '';
		if (!current) {
			wizardBlocked = none;
		} else if (variantErrors[name]) {
			wizardBlocked = 'Недоступно: вариант не загружен.';
		} else if (!loaded) {
			wizardBlocked = 'Недоступно, пока настройки варианта загружаются.';
		}
		const tools = [
			{ id: 'add', icon: 'add', name: 'Добавить вариант…', run: openAddVariantDialog },
			{ id: 'copy', icon: 'add-copy', name: 'Скопировать вариант', note: VARIANT_COPY_NOTE },
			{ id: 'delete', icon: 'delete', name: 'Удалить вариант', shortcut: 'Delete', danger: true, note: none, run: () => removeVariant(name, variants.length) },
			{ id: 'up', icon: 'up', name: 'Переместить вариант выше', note: VARIANT_MOVE_NOTE },
			{ id: 'down', icon: 'down', name: 'Переместить вариант ниже', note: VARIANT_MOVE_NOTE },
			{ id: 'props', icon: 'edit', name: 'Свойства варианта…', shortcut: 'Enter', note: none, run: () => openVariantPropsDialog(current) },
		];
		const bar = el('div', 'dcs-list-toolbar');
		for (const tool of tools) {
			const node = iconButton({
				icon: tool.icon,
				name: tool.name,
				shortcut: tool.shortcut,
				note: tool.note,
				unavailable: Boolean(tool.note),
				className: tool.danger ? 'ghost-btn dcs-btn-small dcs-btn-danger' : undefined,
				onClick: () => {
					if (tool.note) {
						settingsNotice(tool.name, tool.note);
					} else {
						tool.run();
					}
				},
			});
			bar.appendChild(keyed(node, focusKey(['vartool', tool.id])));
		}
		// Мастер строит план по прочитанным настройкам, поэтому до загрузки варианта недоступен
		const wizardBtn = iconButton({
			icon: 'wizard',
			name: 'Конструктор настроек…',
			note: wizardBlocked || WIZARD_NOTE,
			unavailable: Boolean(wizardBlocked),
			onClick: () => {
				if (wizardBlocked) {
					settingsNotice('Конструктор настроек…', wizardBlocked);
				} else {
					startSettingsWizard(uiState.variant);
				}
			},
		});
		bar.appendChild(keyed(wizardBtn, focusKey(['vartool', 'wizard'])));
		host.appendChild(bar);
		if (variants.length === 0) {
			emptyNote(host, 'Вариантов нет: добавьте вариант кнопкой «Добавить вариант…».');
			return;
		}
		const wrap = el('div', 'dcs-table-wrap dcs-setv-scroll');
		const table = el('table', 'dcs-table dcs-setv-grid');
		table.setAttribute('role', 'grid');
		table.setAttribute('aria-label', 'Варианты отчета');
		const thead = document.createElement('thead');
		const head = document.createElement('tr');
		head.setAttribute('role', 'row');
		for (const title of ['Имя варианта', 'Представление']) {
			const th = el('th', '', title);
			th.setAttribute('role', 'columnheader');
			head.appendChild(th);
		}
		thead.appendChild(head);
		table.appendChild(thead);
		const tbody = document.createElement('tbody');
		const names = variants.map((item) => item.name || '');
		variants.forEach((item, index) => {
			const variantName = item.name || '';
			const selected = variantName === name;
			const tr = document.createElement('tr');
			tr.className = selected ? 'dcs-tree-selected' : '';
			tr.setAttribute('role', 'row');
			tr.setAttribute('aria-selected', String(selected));
			tr.tabIndex = selected ? 0 : -1;
			keyed(tr, focusKey(['varrow', variantName]));
			cell(tr, variantName).setAttribute('role', 'gridcell');
			cell(tr, item.value || '').setAttribute('role', 'gridcell');
			tr.addEventListener('click', () => {
				pickVariant(variantName, false);
			});
			tr.addEventListener('dblclick', () => {
				openVariantPropsDialog(item, true);
			});
			tr.addEventListener('keydown', (event) => {
				onVariantKey(event, names, index, item);
			});
			tbody.appendChild(tr);
		});
		table.appendChild(tbody);
		wrap.appendChild(table);
		host.appendChild(wrap);
	}

	function onVariantKey(event, names, index, item) {
		if (event.defaultPrevented) {
			return;
		}
		let to = -1;
		if (event.key === 'ArrowDown') {
			to = Math.min(names.length - 1, index + 1);
		} else if (event.key === 'ArrowUp') {
			to = Math.max(0, index - 1);
		} else if (event.key === 'Home') {
			to = 0;
		} else if (event.key === 'End') {
			to = names.length - 1;
		} else if (event.key === 'Enter' || event.key === 'F2') {
			event.preventDefault();
			openVariantPropsDialog(item, true);
			return;
		} else if (event.key === 'Delete') {
			event.preventDefault();
			removeVariant(item.name || '', names.length, true);
			return;
		} else {
			return;
		}
		event.preventDefault();
		pickVariant(names[to], true);
	}

	/** focus: выбор с клавиатуры, после перерисовки фокус встанет на строку варианта. */
	function pickVariant(variantName, focus) {
		if (variantName === uiState.variant) {
			if (focus) {
				focusKeyed(focusKey(['varrow', variantName]));
			}
			return;
		}
		core.focusVariantRow = Boolean(focus);
		selectVariant(variantName);
	}

	// ---------- варианты настроек: добавление, свойства, удаление ----------

	function openAddVariantDialog() {
		const names = list('settingsVariants').map((item) => item.name || '');
		let nameInput;
		let presentationInput;
		openDialog(
			'Новый вариант настроек',
			'Добавить',
			(body) => {
				nameInput = formRow(body, 'Имя', textInput(suggestName('Вариант', names)));
				presentationInput = formRow(body, 'Представление', textInput(''));
			},
			() => {
				const name = nameInput.value.trim();
				if (!name) {
					return 'Укажите имя варианта.';
				}
				// Без учёта регистра, как проверяет md-sparrow: отказ виден сразу, без вызова jar
				if (names.some((taken) => taken.toLowerCase() === name.toLowerCase())) {
					return 'Вариант с таким именем уже есть.';
				}
				const fields = { name: name };
				const presentation = presentationInput.value.trim();
				if (presentation) {
					fields.payload = { presentation: presentation };
				}
				if (!send('dcs/add-settings-variant', fields)) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	/** fromGrid: вызов из таблицы, после ответа фокус встанет на строку варианта под новым именем. */
	function openVariantPropsDialog(variant, fromGrid) {
		const currentName = variant.name || '';
		const names = list('settingsVariants').map((item) => item.name || '');
		let nameInput;
		let presentationInput;
		openDialog(
			'Свойства варианта «' + currentName + '»',
			'Сохранить',
			(body) => {
				nameInput = formRow(body, 'Имя', textInput(currentName));
				presentationInput = formRow(body, 'Представление', textInput(variant.value));
				// Живая область: читалка слышит предупреждение, как только имя стало другим
				const renameWarn = el('div', 'dcs-warn');
				renameWarn.setAttribute('aria-live', 'polite');
				body.appendChild(renameWarn);
				nameInput.addEventListener('input', () => {
					renameWarn.textContent =
						nameInput.value.trim() !== currentName ? 'На имя варианта могут ссылаться код конфигурации и сохранённые настройки пользователей.' : '';
				});
			},
			() => {
				const newName = nameInput.value.trim();
				if (!newName) {
					return 'Укажите имя варианта.';
				}
				const payload = {};
				if (newName !== currentName) {
					// Смена регистра своего же имени не занимает чужое
					if (names.some((taken) => taken !== currentName && taken.toLowerCase() === newName.toLowerCase())) {
						return 'Вариант с таким именем уже есть.';
					}
					payload.newName = newName;
				}
				const presentation = presentationInput.value.trim();
				if (presentation !== (variant.value || '')) {
					payload.presentation = presentation;
				}
				if (Object.keys(payload).length === 0) {
					closeDialog();
					return undefined;
				}
				if (!send('dcs/set-settings-variant-props', { name: currentName, payload: payload })) {
					return BUSY;
				}
				replyFocus.variant = Boolean(fromGrid);
				return undefined;
			}
		);
	}

	/** fromGrid: удаление клавишей Delete в таблице, после ответа фокус встанет на строку выбранного варианта. */
	function removeVariant(name, total, fromGrid) {
		let question = 'Удалить вариант настроек «' + name + '»?';
		if (total === 1) {
			question += ' Это последний вариант: отчёт останется без настроек по умолчанию.';
		}
		confirmRemove(question, () => {
			if (!send('dcs/remove-settings-variant', { name: name })) {
				return BUSY;
			}
			replyFocus.variant = Boolean(fromGrid);
			return undefined;
		});
	}

	// ---------- конструктор настроек: мастер «Список / Таблица / Диаграмма» ----------

	/** Расчёты мастера без DOM (dcs-editor-settings-wizard.js). */
	const wizardRules = window.DcsSettingsWizard;

	/** Виды строк каталога, которые выбираются как поле; папки, группы полей и промежуточные узлы пути не выбираются. */
	const WIZARD_PICK_KINDS = ['field', 'calc', 'total', 'dataParam', 'userField', 'system'];

	/** Что берёт «>>». Параметры данных, системные и пользовательские поля добавляют по одному: целиком их не выводят. */
	const WIZARD_BULK_KINDS = ['field', 'calc', 'total'];

	/**
	 * Поля, которые раскрываются реквизитами по типу. Ресурс не раскрывается: его путь совпадает с путём поля набора,
	 * и реквизиты взялись бы у поля, а не у итога. У пользовательских и системных полей типа в схеме нет.
	 */
	const WIZARD_TYPE_KINDS = ['field', 'calc', 'dataParam'];

	/** Глубина реквизитов по типу, как в деревьях полей конструктора запроса. Путь глубже вводят в «Другое поле…». */
	const WIZARD_TYPE_DEPTH = 3;

	/** Цель, куда «>» кладёт поле, пока не выбрана другая: «Таблицы» нужны реже строк и точек. */
	const WIZARD_DEFAULT_TARGET = { list: 'levels', table: 'rows', chart: 'points' };

	/** Раздел настроек шага: каталог подсказки и ограничения использования полей у них общие. */
	const WIZARD_SECTIONS = { fields: 'selection', groups: 'group', order: 'order' };

	const WIZARD_SECTION_WORDS = { fields: 'выбранных полях', groups: 'группировках', order: 'порядке' };

	const WIZARD_RESTRICTION_FLAGS = { fields: 'field', groups: 'group', order: 'order' };

	/** Подсказки карточек шага «Тип отчёта», они же описание переключателя для читалки. */
	const WIZARD_TYPE_HINTS = {
		list: 'Записи друг под другом: группировки дают вложенные уровни с итогами, последними идут детальные записи.',
		table: 'Перекрёстная таблица: группировки по строкам и колонкам, в ячейках ресурсы.',
		chart: 'Диаграмма по ресурсам: группировки дают её точки и серии.',
	};

	const WIZARD_NESTING_HINT = 'Порядок сверху вниз задаёт вложенность: следующее поле группируется внутри предыдущего.';

	/** Классы строк предпросмотра по виду строки previewLines: литералами, чтобы их видели проверки стилей. */
	const WIZARD_PREVIEW_CLASSES = {
		root: 'dcs-wizard-preview-row dcs-wizard-preview-root',
		group: 'dcs-wizard-preview-row',
		details: 'dcs-wizard-preview-row dcs-wizard-preview-details',
		container: 'dcs-wizard-preview-row dcs-wizard-preview-container',
		target: 'dcs-wizard-preview-row dcs-wizard-preview-target',
		empty: 'dcs-wizard-preview-row dcs-wizard-preview-empty',
	};

	/** Ключ дубля пути: без учёта регистра, но ё и е различаются, как в путях платформы. */
	function wizardKey(path) {
		return String(path || '').toLowerCase();
	}

	/** Ключ поиска: ещё и ё приравнена к е. */
	function wizardFold(text) {
		return wizardKey(text).replace(/ё/g, 'е');
	}

	/**
	 * Каталоги доступных полей шагов, те же, что у подсказки путей настроек; запрещённые в разделе поля уже убраны.
	 * any нужен для проверки пути, введённого вручную.
	 */
	function wizardCatalogs(settingsDto) {
		// Подписи типов как у подсказки: каталоги шагов питают и подсказку «Другого поля…»
		const typeOptions = completionTypeOptions();
		return {
			fields: completer.buildCatalog(core.model, settingsDto, 'settings:selection', typeOptions),
			groups: completer.buildCatalog(core.model, settingsDto, 'settings:group', typeOptions),
			order: completer.buildCatalog(core.model, settingsDto, 'settings:order', typeOptions),
			any: completer.buildCatalog(core.model, settingsDto, 'settings:any', typeOptions),
		};
	}

	/**
	 * Реквизиты поля по типу: {children, pending}, общее у конструктора и панелей «Настроек». chain: узлы каталога от
	 * корня до поля; scope: место ввода подсказки (settings:<раздел>); flag: ограничение раздела, при attributeRestrict
	 * реквизиты не предлагаются. Путь, который уже есть в схеме («Контрагент.ИНН»), остаётся строкой каталога.
	 * Описания здесь не запрашиваются: pending говорит, что тип или реквизиты ещё не известны. fieldIndex: поля наборов
	 * по пути для вывода типа.
	 */
	function typeAttributeLevel(node, chain, scope, flag, fieldIndex) {
		const entry = { children: [], pending: [] };
		if (chain.length === 0 || chain.some((item) => item.attributeRestrict && item.attributeRestrict[flag])) {
			return entry;
		}
		const env = typeChildrenEnv(scope, false);
		env.fieldIndex = fieldIndex;
		const result = fieldTypes.extraChildrenFor({ mode: 'path', chain: chain }, node.path, env);
		const own = new Set((node.children || []).map((child) => wizardKey(child.name)));
		entry.pending = result.pending;
		entry.children = result.children
			.filter((spec) => spec && spec.name && !own.has(wizardKey(spec.name)))
			.map((spec) => ({
				name: spec.name,
				path: node.path + '.' + spec.name,
				kind: 'field',
				title: spec.title || '',
				typeText: spec.typeText || '',
				valueType: spec.valueType || null,
				typeExpandable: Boolean(spec.expandable),
				children: [],
				typeChain: chain,
			}));
		return entry;
	}

	function wizardNodeIndex(catalog) {
		const index = new Map();
		const walk = (nodes) => {
			for (const node of nodes) {
				index.set(wizardKey(node.path), node);
				walk(node.children || []);
			}
		};
		walk(catalog.nodes || []);
		return index;
	}

	function wizardPickable(node, step) {
		if (!node || node.restricted || WIZARD_PICK_KINDS.indexOf(node.kind) < 0) {
			return false;
		}
		// Группировать по ресурсу нельзя: его итог считается по группировкам, а не наоборот
		return !(step === 'groups' && node.kind === 'total');
	}

	function wizardSummaryText(summary) {
		const parts = [];
		if (summary.nodes > 0) {
			const kinds = [];
			if (summary.groups > 0) {
				kinds.push('группировок ' + summary.groups);
			}
			if (summary.tables > 0) {
				kinds.push('таблиц ' + summary.tables);
			}
			if (summary.charts > 0) {
				kinds.push('диаграмм ' + summary.charts);
			}
			if (summary.nestedObjects > 0) {
				kinds.push('вложенных отчётов ' + summary.nestedObjects);
			}
			parts.push('структуру (узлов ' + summary.nodes + (kinds.length > 0 ? ': ' + kinds.join(', ') : '') + ')');
		}
		if (summary.selection > 0) {
			parts.push('выбранные поля (' + summary.selection + ')');
		}
		if (summary.order > 0) {
			parts.push('порядок (' + summary.order + ')');
		}
		return 'Конструктор соберёт заново ' + parts.join(', ') + '.';
	}

	function startSettingsWizard(variantName) {
		const settings = variantCache[variantName];
		if (!settings) {
			return;
		}
		if (editBusy()) {
			setStatus(BUSY, true);
			return;
		}
		const state = wizardRules.initialWizardState(settings);
		const summary = wizardRules.replacementSummary(settings);
		closeDialog();
		if (summary.empty) {
			openSettingsWizard({ variant: variantName, settings: settings, state: state });
			return;
		}
		pushDialog({
			title: 'Конструктор настроек: вариант «' + variantName + '»',
			build: (body) => {
				body.appendChild(el('div', 'dcs-confirm-text', wizardSummaryText(summary)));
				if (summary.userSettings > 0) {
					body.appendChild(
						el(
							'div',
							'dcs-warn dcs-wizard-confirm-line',
							'У заменяемых узлов есть пользовательские настройки (' + summary.userSettings + '): они пропадут, если структура изменится.'
						)
					);
				}
				if (!state.recognized) {
					body.appendChild(
						el(
							'div',
							'dcs-warn dcs-wizard-confirm-line',
							'Структура не похожа на собранную конструктором (' + state.reason + '): при ОК она будет собрана заново целиком.'
						)
					);
				}
				body.appendChild(
					el(
						'div',
						'struct-hint dcs-wizard-confirm-line',
						'Останутся как были: отбор, параметры, условное оформление и пользовательские поля варианта. Неизменённое в структуре не пересобирается.'
					)
				);
			},
			buttons: [
				{
					id: 'replace',
					label: 'Заменить',
					primary: true,
					onClick: () => {
						closeDialog();
						openSettingsWizard({ variant: variantName, settings: settings, state: state });
						return undefined;
					},
				},
				{
					id: 'newVariant',
					label: 'В новый вариант…',
					onClick: () => {
						openWizardNewVariant(settings, state);
						return undefined;
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	function wizardVariantNameProblem(name, names) {
		if (!name) {
			return 'Укажите имя варианта.';
		}
		const key = wizardKey(name);
		if (names.some((existing) => wizardKey(existing) === key)) {
			return 'Вариант с таким именем уже есть.';
		}
		return '';
	}

	/** «В новый вариант…»: шаги открываются с настройками текущего варианта как основой, сам он не меняется. */
	function openWizardNewVariant(settings, state) {
		const names = list('settingsVariants').map((item) => item.name || '');
		let nameInput;
		let presentationInput;
		pushDialog({
			title: 'Новый вариант настроек',
			build: (body) => {
				// Что текущий вариант не изменится, говорит плашка первого шага мастера
				nameInput = formRow(body, 'Имя', textInput(suggestName('Вариант', names)));
				presentationInput = formRow(body, 'Представление', textInput(''));
			},
			buttons: [
				{
					id: 'ok',
					label: 'Далее >',
					primary: true,
					onClick: () => {
						const name = nameInput.value.trim();
						const problem = wizardVariantNameProblem(name, names);
						if (problem) {
							return problem;
						}
						const presentation = presentationInput.value.trim();
						closeDialog();
						openSettingsWizard({
							variant: name,
							settings: settings,
							state: state,
							newVariant: { presentation: presentation },
						});
						return undefined;
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	/**
	 * Окно конструктора. ОК доступна на любом шаге: план строит planWizardOperations, правки уходят одним сообщением
	 * dcs/settings-wizard; без изменений окно закрывается без записи. Описания объектов читаются по раскрытию поля.
	 *
	 * ctx: {variant: куда пишет пакет; settings: прочитанные настройки текущего варианта (у нового варианта только
	 * основа шагов); state: начальное состояние (initialWizardState); newVariant?: {presentation} для «В новый вариант…»}.
	 */
	function openSettingsWizard(ctx) {
		const wz = JSON.parse(JSON.stringify(ctx.state));
		// Пользовательские поля живут в варианте: новому варианту их не предлагают
		const catalogs = wizardCatalogs(ctx.newVariant ? null : ctx.settings);
		const indexes = {
			fields: wizardNodeIndex(catalogs.fields),
			groups: wizardNodeIndex(catalogs.groups),
			order: wizardNodeIndex(catalogs.order),
			any: wizardNodeIndex(catalogs.any),
		};
		const resourceKeys = new Set(list('totalFields').map((total) => wizardKey(total.name || '')));
		const ui = {
			step: 'type',
			search: { fields: '', groups: '', order: '' },
			expanded: { fields: new Set(), groups: new Set(), order: new Set() },
			avail: { fields: '', groups: '', order: '' },
			chosen: { fields: -1, order: -1 },
			groupSel: { target: '', index: -1 },
			target: Object.assign({}, WIZARD_DEFAULT_TARGET),
			// Пути «Другого поля…», которых нет в каталоге: предупреждение, пока они в списках
			manual: new Map(),
		};
		const hosts = {};
		const keyed = new Map();
		let availRows = new Map();
		let chosenRows = new Map();
		// Выделение строки выбранных по ключу: стрелки выделяют соседнюю строку тем же путём, что щелчок
		let chosenSelectors = new Map();
		let level = null;
		// Кэш реквизитов по типу: перерисовка идёт на каждое действие, а вывод типа поля набора-запроса разбирает текст
		// запроса. Сбрасывается новым описанием (describeStamp) или моделью
		let typeCache = new Map();
		let typeCacheStamp = -1;
		let typeCacheModel = null;
		// Поля наборов, разложенные по пути для вывода типа (dataSetFieldType): живут, пока модель та же
		let typeFieldIndex = new Map();
		// Нарисованные реквизиты по ключу пути: в индексе каталога их нет, а «>» берёт выделенный реквизит
		const typeNodes = { fields: new Map(), groups: new Map(), order: new Map() };

		function planState() {
			return {
				type: wz.type,
				selection: wz.selection,
				order: wz.order,
				groupings: wz.groupings,
				details: wz.details,
				chartType: wz.chartType,
			};
		}

		/** После перерисовки keepFocus возвращает фокус на элемент с тем же ключом. */
		function keyedEl(node, key) {
			node.setAttribute('data-wizard-key', key);
			keyed.set(key, node);
			return node;
		}

		function keepFocus(redraw) {
			const active = document.activeElement;
			const key = active && typeof active.getAttribute === 'function' ? active.getAttribute('data-wizard-key') : null;
			redraw();
			if (key && document.activeElement !== active) {
				const next = keyed.get(key);
				if (next && next.isConnected) {
					next.focus();
				}
			}
		}

		function setNote(text) {
			if (hosts.note) {
				hosts.note.textContent = text || '';
			}
		}

		function steps() {
			return wizardRules.stepsFor(wz.type);
		}

		function stepIndex() {
			return steps().findIndex((item) => item.id === ui.step);
		}

		function goStep(id) {
			ui.step = id;
			level.setError('');
			keepFocus(renderAll);
			const active = document.activeElement;
			// «Далее >» на последнем шаге гаснет: фокус уходит на ОК
			if (!active || active === document.body || active.disabled) {
				level.shell.buttonEls.ok.focus();
			}
		}

		function footer() {
			const index = stepIndex();
			const all = steps();
			return [
				{
					id: 'back',
					label: '< Назад',
					disabled: index <= 0,
					onClick: () => {
						goStep(all[index - 1].id);
						return undefined;
					},
				},
				{
					id: 'next',
					label: 'Далее >',
					disabled: index >= all.length - 1,
					onClick: () => {
						goStep(all[index + 1].id);
						return undefined;
					},
				},
				{ id: 'ok', label: 'ОК', primary: true, onClick: submit },
				{ id: 'cancel', label: 'Отмена' },
			];
		}

		// ---- реквизиты по типу ----

		function typeCapable(node) {
			return Boolean(node && WIZARD_TYPE_KINDS.indexOf(node.kind) >= 0);
		}

		/** Узлы каталога шага от корня до node: у каталога есть узел на каждый префикс пути. */
		function catalogChain(step, node) {
			const chain = [];
			let prefix = '';
			for (const segment of String(node.path).split('.')) {
				prefix = prefix ? prefix + '.' + segment : segment;
				const found = indexes[step].get(wizardKey(prefix));
				if (!found) {
					return [];
				}
				chain.push(found);
			}
			return chain;
		}

		/**
		 * Реквизиты поля по типу с кэшем по шагу и пути. Цепочка и поля наборов по пути (fieldIndex) передаются готовыми:
		 * поиск по списку на каждую строку сделал бы отрисовку тысяч полей квадратичной.
		 */
		function typeLevel(step, node) {
			if (typeCacheStamp !== core.describeStamp || typeCacheModel !== core.model) {
				if (typeCacheModel !== core.model) {
					typeFieldIndex = new Map();
				}
				typeCache = new Map();
				typeCacheStamp = core.describeStamp;
				typeCacheModel = core.model;
			}
			const cacheKey = step + '\u0000' + wizardKey(node.path);
			let entry = typeCache.get(cacheKey);
			if (entry) {
				return entry;
			}
			entry = typeAttributeLevel(node, node.typeChain || catalogChain(step, node), 'settings:' + WIZARD_SECTIONS[step], WIZARD_RESTRICTION_FLAGS[step], typeFieldIndex);
			typeCache.set(cacheKey, entry);
			return entry;
		}

		/**
		 * Реквизит по пути «Другого поля…». Глубина не ограничена: путь пользователь назвал сам. request: прочитать
		 * недостающие описания, по ответу предупреждение «нет среди полей схемы» пересчитывается.
		 */
		function typeNodeByPath(step, path, request) {
			const dot = path.lastIndexOf('.');
			if (dot <= 0) {
				return null;
			}
			const parentPath = path.slice(0, dot);
			const parent = indexes[step].get(wizardKey(parentPath)) || typeNodeByPath(step, parentPath, request);
			if (!typeCapable(parent)) {
				return null;
			}
			const found = typeLevel(step, parent);
			if (request) {
				requestDescriptions(found.pending);
			}
			const want = wizardKey(path.slice(dot + 1));
			return found.children.find((child) => wizardKey(child.name) === want) || null;
		}

		/** Ответ описания (onDescribed): пересчитывает реквизиты по типу и предупреждения «Другого поля…». */
		function onWizardDescribed() {
			if (hosts.avail && hosts.avail.isConnected) {
				keepFocus(() => renderAvail(ui.step));
			}
			if (hosts.preview && hosts.preview.isConnected) {
				redrawSide();
			}
		}

		// ---- выбранное в списках шагов ----

		function takenKeys(step, target) {
			if (step === 'fields') {
				return new Set(wizardRules.selectedFieldNames(wz.selection, true).map(wizardKey));
			}
			if (step === 'order') {
				return new Set(wz.order.filter((item) => item && item.kind !== 'auto' && item.field).map((item) => wizardKey(item.field)));
			}
			return new Set((wz.groupings[target || ui.target[wz.type]] || []).map((field) => wizardKey(field.field)));
		}

		/** Поле есть в списках шага; у группировок в любой цели вида отчёта. */
		function presentOnStep(step, key) {
			if (step !== 'groups') {
				return takenKeys(step).has(key);
			}
			return wizardRules.TARGETS[wz.type].some((target) => takenKeys('groups', target).has(key));
		}

		/** Добавляет поля в список шага, у группировок в активную цель. at: номер вставки, без него в конец. */
		function addPaths(step, paths, at) {
			const target = ui.target[wz.type];
			const taken = takenKeys(step, target);
			const added = [];
			const repeated = [];
			const listRef = step === 'fields' ? wz.selection : step === 'order' ? wz.order : wz.groupings[target];
			let next = typeof at === 'number' ? at : -1;
			for (const path of paths) {
				const key = wizardKey(path);
				if (taken.has(key)) {
					repeated.push(path);
					continue;
				}
				taken.add(key);
				added.push(path);
				const index = next >= 0 ? Math.min(next, listRef.length) : listRef.length;
				if (next >= 0) {
					next = index + 1;
				}
				if (step === 'fields') {
					listRef.splice(index, 0, { kind: 'field', field: path });
					ui.chosen.fields = index;
				} else if (step === 'order') {
					listRef.splice(index, 0, { kind: 'field', field: path, orderType: 'Asc' });
					ui.chosen.order = index;
				} else {
					listRef.splice(index, 0, { field: path });
					ui.groupSel = { target: target, index: index };
				}
			}
			if (added.length === 0) {
				setNote(repeated.length > 0 ? 'Уже выбрано: «' + repeated.join('», «') + '».' : 'Нечего добавить.');
			} else if (repeated.length > 0) {
				setNote('Добавлено: ' + added.length + '; уже были выбраны: ' + repeated.length + '.');
			} else {
				setNote(added.length === 1 ? 'Добавлено: «' + added[0] + '».' : 'Добавлено полей: ' + added.length + '.');
			}
			keepFocus(redrawLists);
		}

		function addSelectedAvail(step) {
			const node = indexes[step].get(ui.avail[step]) || typeNodes[step].get(ui.avail[step]);
			if (!node) {
				setNote('Выделите поле в списке доступных.');
				return;
			}
			if (!wizardPickable(node, step)) {
				setNote('«' + node.name + '» это группа полей: раскройте её и выберите поле.');
				return;
			}
			addPaths(step, [node.path]);
		}

		function matchesSearch(node, query) {
			return (
				query === '' ||
				wizardFold(node.name).indexOf(query) >= 0 ||
				wizardFold(node.path).indexOf(query) >= 0 ||
				wizardFold(node.title).indexOf(query) >= 0
			);
		}

		function hiddenOnStep(node, step) {
			return step === 'groups' && node.kind === 'total';
		}

		function addAllAvail(step) {
			const query = wizardFold(ui.search[step].trim());
			const paths = [];
			const walk = (nodes) => {
				for (const node of nodes) {
					if (hiddenOnStep(node, step)) {
						continue;
					}
					if (WIZARD_BULK_KINDS.indexOf(node.kind) >= 0 && !node.restricted) {
						// Реквизиты поля («Контрагент.ИНН») целиком не берутся: только само поле
						if (matchesSearch(node, query)) {
							paths.push(node.path);
						}
						continue;
					}
					if (node.kind === 'folder' || node.kind === 'path') {
						walk(node.children || []);
					}
				}
			};
			walk(catalogs[step].nodes || []);
			if (paths.length === 0) {
				setNote('Добавлять целиком нечего: параметры, системные и пользовательские поля добавляются по одному.');
				return;
			}
			addPaths(step, paths);
		}

		function chosenList(step) {
			if (step === 'fields') {
				return wz.selection;
			}
			if (step === 'order') {
				return wz.order;
			}
			// Выделение могло остаться в цели другого вида отчёта: такие списки сейчас не видны
			return wizardRules.TARGETS[wz.type].indexOf(ui.groupSel.target) >= 0 ? wz.groupings[ui.groupSel.target] : null;
		}

		function chosenIndex(step) {
			return step === 'groups' ? ui.groupSel.index : ui.chosen[step];
		}

		function setChosenIndex(step, index) {
			if (step === 'groups') {
				ui.groupSel.index = index;
			} else {
				ui.chosen[step] = index;
			}
		}

		/** Папки и «Авто» в выбранных полях и порядке закреплены: конструктор их не убирает. */
		function pinnedItem(step, item) {
			return step !== 'groups' && Boolean(item) && (item.kind === 'auto' || item.kind === 'folder');
		}

		function removeChosen(step, all) {
			if (all) {
				if (step === 'groups') {
					const target = ui.target[wz.type];
					wz.groupings[target] = [];
					ui.groupSel = { target: target, index: -1 };
				} else if (step === 'fields') {
					wz.selection = wz.selection.filter((item) => pinnedItem(step, item));
					ui.chosen.fields = -1;
				} else {
					wz.order = wz.order.filter((item) => pinnedItem(step, item));
					ui.chosen.order = -1;
				}
				setNote('Список очищен' + (step === 'groups' ? '' : ': папки и «Авто» остались на местах') + '.');
				keepFocus(redrawLists);
				return;
			}
			const items = chosenList(step);
			const index = chosenIndex(step);
			if (!items || index < 0 || index >= items.length) {
				setNote('Выделите строку в списке выбранных.');
				return;
			}
			if (pinnedItem(step, items[index])) {
				setNote('Папки и «Авто» конструктор не убирает: они остаются, как были.');
				return;
			}
			const removed = items.splice(index, 1)[0];
			setChosenIndex(step, Math.min(index, items.length - 1));
			setNote('Убрано: «' + (removed.field || '') + '».');
			keepFocus(redrawLists);
		}

		function moveChosen(step, delta) {
			const items = chosenList(step);
			const index = chosenIndex(step);
			const to = index + delta;
			if (!items || index < 0 || to < 0 || to >= items.length) {
				return;
			}
			items.splice(to, 0, items.splice(index, 1)[0]);
			setChosenIndex(step, to);
			// Кнопка ↑↓ не перерисовывается и остаётся в фокусе: повторное нажатие двигает строку дальше
			keepFocus(redrawLists);
		}

		/**
		 * Переносит группировку в другую цель на место at. Тип группировки сохраняется, а «<» и затем «>» его сбросили бы.
		 * Возвращает true, если перенесено.
		 */
		function transferGroup(from, index, to, at) {
			const source = wz.groupings[from];
			const item = source ? source[index] : null;
			if (!item) {
				return false;
			}
			if (takenKeys('groups', to).has(wizardKey(item.field))) {
				setNote('Уже выбрано: «' + item.field + '» есть в «' + wizardRules.TARGET_LABELS[to] + '».');
				return false;
			}
			source.splice(index, 1);
			const list = wz.groupings[to];
			const place = Math.max(0, Math.min(at, list.length));
			list.splice(place, 0, item);
			ui.target[wz.type] = to;
			ui.groupSel = { target: to, index: place };
			setNote('Перенесено: «' + item.field + '» в «' + wizardRules.TARGET_LABELS[to] + '».');
			keepFocus(redrawLists);
			return true;
		}

		/** Кнопки «⇑» и «⇓»: перенос группировки с типом в соседнюю цель без мыши. */
		function transferSelected(delta) {
			const targets = wizardRules.TARGETS[wz.type];
			const from = ui.groupSel.target;
			const at = targets.indexOf(from);
			const items = at >= 0 ? wz.groupings[from] : null;
			if (!items || ui.groupSel.index < 0 || ui.groupSel.index >= items.length) {
				setNote('Выделите строку в списке выбранных.');
				return;
			}
			const to = targets[at + delta];
			if (!to) {
				setNote('Недоступно: «' + wizardRules.TARGET_LABELS[from] + '» уже ' + (delta < 0 ? 'первая' : 'последняя') + ' цель.');
				return;
			}
			transferGroup(from, ui.groupSel.index, to, wz.groupings[to].length);
		}

		// ---- перенос мышью: сброс зовёт те же действия, что кнопки ----

		function wizardRowKey(row, prefix) {
			const key = typeof row.getAttribute === 'function' ? row.getAttribute('data-wizard-key') : null;
			return key && key.indexOf(prefix) === 0 ? key.slice(prefix.length) : null;
		}

		/** Номер строки сброса в списке выбранных; -1: под строками. */
		function wizardDropRow(target) {
			return target && target.key !== null && target.key !== undefined ? Number(target.key) : -1;
		}

		/** Фокус на перенесённую строку: её прежний номер теперь у соседней строки. */
		function focusChosen(key) {
			const node = keyed.get(key);
			if (node && node.isConnected) {
				node.focus();
			}
		}

		function availNode(step, key) {
			const node = indexes[step].get(key) || typeNodes[step].get(key);
			return node && wizardPickable(node, step) ? node : null;
		}

		/** «Доступные поля» шага: источник переноса и зона «убрать». Папки и «Авто» сюда не бросить. */
		function availDropZone(host, step) {
			const from = {};
			if (step === 'groups') {
				for (const target of wizardRules.TARGETS[wz.type]) {
					from['wzgrp:' + target] = (payload) => {
						ui.groupSel = { target: target, index: Number(payload.key) };
						ui.target[wz.type] = target;
						removeChosen('groups', false);
					};
				}
			} else {
				from.wzchosen = (payload) => {
					ui.chosen[step] = Number(payload.key);
					removeChosen(step, false);
				};
			}
			dragZone(host, {
				id: 'wzavail',
				scope: 'wizard',
				keyOf: (row) => wizardRowKey(row, 'avail:'),
				drag: (key) => (availNode(step, key) ? 'field' : ''),
				pick: (key) => selectAvail(step, key),
				from: from,
				accept: (payload) => payload.kind !== 'pinned',
				place: 'zone',
			});
		}

		function chosenDropZone(listEl, step) {
			const items = step === 'fields' ? wz.selection : wz.order;
			dragZone(listEl, {
				id: 'wzchosen',
				scope: 'wizard',
				keyOf: (row) => wizardRowKey(row, 'chosen:'),
				drag: (key) => (items[Number(key)] ? (pinnedItem(step, items[Number(key)]) ? 'pinned' : 'field') : ''),
				pick: (key) => {
					const select = chosenSelectors.get('chosen:' + key);
					if (select) {
						select();
					}
				},
				from: {
					wzavail: (payload, target) => {
						const node = availNode(step, payload.key);
						if (!node) {
							return false;
						}
						addPaths(step, [node.path], dropIndex(items.length, -1, wizardDropRow(target), target.place));
						return undefined;
					},
					wzchosen: (payload, target) => {
						const from = Number(payload.key);
						const to = dropIndex(items.length, from, wizardDropRow(target), target.place);
						if (to === from) {
							return false;
						}
						ui.chosen[step] = from;
						moveChosen(step, to - from);
						focusChosen('chosen:' + to);
						return undefined;
					},
				},
				effect: (payload) => (payload.zone === 'wzavail' ? 'copy' : 'move'),
			});
		}

		/**
		 * Зона цели группировок: вся цель с заголовком. Сброс на заголовок ставит поле первым, у пустой цели это главное
		 * место сброса.
		 */
		function targetDropZone(box, head, listEl, target) {
			const prefix = 'chosen:' + target + ':';
			// Заголовок и строки собираются при первом обращении: во время переноса перерисовки отложены
			let rows = null;
			const from = {
				wzavail: (payload, spot) => {
					const node = availNode('groups', payload.key);
					if (!node) {
						return false;
					}
					ui.target[wz.type] = target;
					addPaths('groups', [node.path], dropIndex(wz.groupings[target].length, -1, wizardDropRow(spot), spot.place));
					return undefined;
				},
			};
			for (const other of wizardRules.TARGETS[wz.type]) {
				from['wzgrp:' + other] = (payload, spot) => {
					const index = Number(payload.key);
					if (other !== target) {
						const at = dropIndex(wz.groupings[target].length, -1, wizardDropRow(spot), spot.place);
						if (!transferGroup(other, index, target, at)) {
							return false;
						}
						focusChosen('chosen:' + target + ':' + ui.groupSel.index);
						return undefined;
					}
					const to = dropIndex(wz.groupings[target].length, index, wizardDropRow(spot), spot.place);
					if (to === index) {
						return false;
					}
					ui.groupSel = { target: target, index: index };
					ui.target[wz.type] = target;
					moveChosen('groups', to - index);
					focusChosen(prefix + to);
					return undefined;
				};
			}
			dragZone(box, {
				id: 'wzgrp:' + target,
				scope: 'wizard',
				keyOf: (row) => wizardRowKey(row, prefix),
				// Строка: ребёнок списка цели или заголовок
				rowOf: (node) => {
					for (let current = node; current && current !== box; current = current.parentElement) {
						if (current === head || current.parentElement === listEl) {
							return current;
						}
					}
					return null;
				},
				rows: () => rows || (rows = [head].concat(Array.from(listEl.children))),
				drag: (key) => (wz.groupings[target][Number(key)] ? 'field' : ''),
				pick: (key) => {
					const select = chosenSelectors.get(prefix + key);
					if (select) {
						select();
					}
				},
				from: from,
				effect: (payload) => (payload.zone === 'wzavail' ? 'copy' : 'move'),
			});
		}

		function addManual(step, input) {
			const raw = input.value.trim();
			const problem = wizardRules.fieldPathProblem(raw);
			if (problem) {
				setNote(problem);
				return;
			}
			const key = wizardKey(raw);
			const node = indexes.any.get(key);
			if (node && (node.kind === 'folder' || node.kind === 'container')) {
				setNote('«' + raw + '» это папка полей, а не поле: выберите поле внутри неё.');
				return;
			}
			const flag = WIZARD_RESTRICTION_FLAGS[step];
			if (node && node.restrict && node.restrict[flag]) {
				setNote('У поля «' + raw + '» ограничение использования: в ' + WIZARD_SECTION_WORDS[step] + ' оно недоступно.');
				return;
			}
			if (step === 'groups' && (resourceKeys.has(key) || (node && node.kind === 'total'))) {
				setNote('«' + raw + '» это ресурс схемы: по ресурсу группировать нельзя.');
				return;
			}
			// Найденное поле пишется как в схеме, реквизит по типу как в описании объекта, не найденное как введено,
			// с предупреждением
			const typed = node ? null : typeNodeByPath(step, raw, true);
			const path = node ? node.path : typed ? typed.path : raw;
			if (!node && !typed) {
				ui.manual.set(key, { path: path, step: step });
			}
			input.value = '';
			addPaths(step, [path]);
		}

		function manualWarnings() {
			const out = [];
			for (const [key, entry] of ui.manual) {
				// Реквизит по типу, чьё описание пришло после ввода, уже не «вне схемы»
				if (presentOnStep(entry.step, key) && !typeNodeByPath(entry.step, entry.path, true)) {
					out.push({ step: entry.step, text: 'Поля «' + entry.path + '» нет среди полей схемы: проверьте путь.' });
				}
			}
			return out;
		}

		function allWarnings() {
			return wizardRules.wizardWarnings(planState(), core.model).concat(manualWarnings());
		}

		// ---- отрисовка ----

		function renderSteps() {
			const host = hosts.steps;
			host.textContent = '';
			steps().forEach((item, index) => {
				if (index > 0) {
					host.appendChild(el('span', 'dcs-wizard-step-sep', '·'));
				}
				const current = item.id === ui.step;
				const button = el('button', 'dcs-wizard-step' + (current ? ' dcs-wizard-step-active' : ''), index + 1 + ' ' + item.label);
				button.type = 'button';
				if (current) {
					button.setAttribute('aria-current', 'step');
				}
				keyedEl(button, 'step:' + item.id);
				button.addEventListener('click', () => {
					goStep(item.id);
				});
				host.appendChild(button);
			});
		}

		function renderTypeStep(host) {
			if (ctx.newVariant) {
				host.appendChild(
					el(
						'div',
						'dcs-plate',
						'Новый вариант «' + ctx.variant + '»' +
							(ctx.newVariant.presentation ? ' («' + ctx.newVariant.presentation + '»)' : '') +
							': шаги начаты с настроек текущего варианта, сам он не изменится.'
					)
				);
			}
			if (!wz.recognized) {
				host.appendChild(
					el(
						'div',
						'dcs-plate dcs-wizard-warn',
						'Текущая структура не распознана (' + wz.reason + '): шаги начаты с полей и порядка корня, при ОК структура будет собрана заново целиком.'
					)
				);
			}
			const cards = el('div', 'dcs-wizard-cards');
			cards.setAttribute('role', 'radiogroup');
			cards.setAttribute('aria-label', 'Тип отчёта');
			for (const type of wizardRules.REPORT_TYPES) {
				const card = el('label', 'dcs-wizard-card' + (wz.type === type.value ? ' dcs-wizard-card-active' : ''));
				const radio = el('input', 'dcs-wizard-radio');
				radio.type = 'radio';
				radio.name = 'dcsWizardType';
				radio.value = type.value;
				radio.checked = wz.type === type.value;
				keyedEl(radio, 'type:' + type.value);
				radio.addEventListener('change', () => {
					if (radio.checked && wz.type !== type.value) {
						wz.type = type.value;
						keepFocus(renderAll);
					}
				});
				card.title = WIZARD_TYPE_HINTS[type.value];
				radio.setAttribute('aria-description', WIZARD_TYPE_HINTS[type.value]);
				card.appendChild(radio);
				const text = el('span', 'dcs-wizard-card-text');
				text.appendChild(el('span', 'dcs-wizard-card-title', type.label));
				card.appendChild(text);
				cards.appendChild(card);
			}
			host.appendChild(cards);
		}

		function moveButton(host, label, title, key, onClick) {
			const button = el('button', 'ghost-btn dcs-btn-small dcs-wizard-move', label);
			button.type = 'button';
			button.title = title;
			button.setAttribute('aria-label', title);
			keyedEl(button, 'move:' + key);
			button.addEventListener('click', onClick);
			host.appendChild(button);
			return button;
		}

		function selectAvail(step, key) {
			ui.avail[step] = key;
			for (const [rowKey, row] of availRows) {
				row.classList.toggle('dcs-tree-selected', rowKey === key);
				row.setAttribute('aria-selected', String(rowKey === key));
				row.tabIndex = rowKey === key ? 0 : -1;
			}
		}

		/**
		 * Одна остановка Tab на список: сотни строк по Tab не дали бы дойти до кнопок и подвала. Остановка на выделенной
		 * строке, без выделения на первой.
		 */
		function ensureListStop(listEl) {
			const rows = Array.from(listEl.children).filter((child) => child.classList.contains('dcs-wizard-row'));
			if (rows.length > 0 && !rows.some((row) => row.tabIndex === 0)) {
				setRowStop(rows[0], true);
			}
		}

		function toggleAvail(step, key, open) {
			const expanded = ui.expanded[step];
			const want = open === undefined ? !expanded.has(key) : open;
			let selectedInside = false;
			if (want) {
				expanded.add(key);
			} else {
				expanded.delete(key);
				// Выделенный ребёнок свёрнутой строки скрывается: выделение переходит на саму строку
				selectedInside = ui.avail[step].indexOf(key + '.') === 0;
				if (selectedInside) {
					ui.avail[step] = key;
				}
			}
			keepFocus(() => renderAvail(step));
			const row = availRows.get(key);
			const active = document.activeElement;
			// Фокус стоял на скрытом ребёнке: он переходит на родителя
			if (selectedInside && row && (!active || active === document.body || !active.isConnected)) {
				row.focus();
			}
		}

		function renderAvail(step) {
			const host = hosts.avail;
			host.textContent = '';
			availRows = new Map();
			const query = wizardFold(ui.search[step].trim());
			const taken = takenKeys(step);
			const visible = (node) => !hiddenOnStep(node, step) && (matchesSearch(node, query) || (node.children || []).some(visible));
			const expanded = ui.expanded[step];
			const rows = [];
			// typeDepth: уровень реквизитов по типу под полем каталога (у строк каталога 0). Поиск идёт только по
			// каталогу: реквизиты подгружаются раскрытием, и раскрытое поле показывает их без фильтра
			const walk = (nodes, depth, typeDepth) => {
				for (const node of nodes) {
					if (typeDepth === 0 && !visible(node)) {
						continue;
					}
					const key = wizardKey(node.path);
					if (typeDepth > 0) {
						typeNodes[step].set(key, node);
					}
					const own = typeDepth === 0 ? (node.children || []).filter(visible) : [];
					// У свёрнутого реквизита по типу стрелку решает его тип: подсчёт детей на каждую строку сделал бы
					// ответ описания объекта из M реквизитов O(M²). Дети считаются при раскрытии
					const deep = typeDepth < WIZARD_TYPE_DEPTH && typeCapable(node);
					const lazy = deep && typeDepth > 0 && !expanded.has(key);
					const typed = deep && !lazy ? typeLevel(step, node) : null;
					// Пока тип не известен (pending), стрелка есть; без реквизитов после описания она пропадёт
					const hasTyped = lazy ? node.typeExpandable === true : Boolean(typed) && (typed.children.length > 0 || typed.pending.length > 0);
					// При поиске папки раскрыты сами, реквизиты по типу только по раскрытию
					const showOwn = own.length > 0 && (query !== '' || expanded.has(key));
					const showTyped = hasTyped && expanded.has(key);
					rows.push({ node: node, key: key, depth: depth, expandable: own.length > 0 || hasTyped, open: showOwn || showTyped });
					if (showOwn) {
						walk(own, depth + 1, 0);
					}
					if (showTyped) {
						walk(typed.children, depth + 1, typeDepth + 1);
						if (typed.pending.length > 0) {
							requestDescriptions(typed.pending);
							rows.push({ loading: true, key: key + '#loading', depth: depth + 1 });
						}
					}
				}
			};
			walk(catalogs[step].nodes || [], 0, 0);
			if (rows.length === 0) {
				host.appendChild(el('div', 'dcs-wizard-empty', query ? 'Ничего не найдено.' : 'Доступных полей нет: путь можно ввести в «Другое поле».'));
				return;
			}
			// Стрелки перешагивают строку «Загрузка реквизитов…»
			const focusRow = (index) => {
				selectAvail(step, rows[index].key);
				availRows.get(rows[index].key).focus();
			};
			const liveFrom = (index, dir) => {
				for (let k = index; k >= 0 && k < rows.length; k += dir) {
					if (!rows[k].loading) {
						return k;
					}
				}
				return -1;
			};
			rows.forEach((row, position) => {
				if (row.loading) {
					const info = el('div', 'dcs-tree-row dcs-wizard-row-info', 'Загрузка реквизитов…');
					info.style.paddingLeft = 4 + row.depth * 14 + 'px';
					info.setAttribute('role', 'treeitem');
					info.setAttribute('aria-level', String(row.depth + 1));
					info.setAttribute('aria-disabled', 'true');
					info.tabIndex = -1;
					host.appendChild(info);
					return;
				}
				const node = row.node;
				const pickable = wizardPickable(node, step);
				const isTaken = pickable && taken.has(row.key);
				let className = 'dcs-tree-row dcs-wizard-row';
				if (ui.avail[step] === row.key) {
					className += ' dcs-tree-selected';
				}
				if (!pickable) {
					className += ' dcs-wizard-row-group';
				}
				if (isTaken) {
					className += ' dcs-wizard-row-taken';
				}
				const item = el('div', className);
				item.style.paddingLeft = 4 + row.depth * 14 + 'px';
				item.tabIndex = ui.avail[step] === row.key ? 0 : -1;
				item.setAttribute('role', 'treeitem');
				item.setAttribute('aria-level', String(row.depth + 1));
				item.setAttribute('aria-selected', String(ui.avail[step] === row.key));
				if (row.expandable) {
					item.setAttribute('aria-expanded', String(row.open));
				}
				keyedEl(item, 'avail:' + row.key);
				availRows.set(row.key, item);
				const twist = el('span', 'dcs-tree-twist', row.expandable ? (row.open ? '▾' : '▸') : '');
				// Состояние строки читалке называет aria-expanded, знак стрелки в её имя не входит
				twist.setAttribute('aria-hidden', 'true');
				twist.addEventListener('click', (event) => {
					event.stopPropagation();
					toggleAvail(step, row.key);
				});
				item.appendChild(twist);
				item.appendChild(nameEl('span', 'dcs-tree-label', node.name));
				if (node.title && node.title !== node.name) {
					item.appendChild(el('span', 'dcs-wizard-row-note', node.title));
				}
				if (isTaken) {
					item.appendChild(el('span', 'dcs-wizard-row-note', 'выбрано'));
				}
				item.title = pickable ? node.path : node.path + ' (группа полей)';
				const activate = () => {
					if (pickable) {
						addPaths(step, [node.path]);
					} else if (row.expandable) {
						toggleAvail(step, row.key);
					}
				};
				// Перенос мышью: у строки только атрибут, слушатели у документа
				if (pickable) {
					item.draggable = true;
				}
				item.addEventListener('click', () => {
					selectAvail(step, row.key);
				});
				item.addEventListener('dblclick', activate);
				// Клавиатура как у деревьев конструктора запроса
				item.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						selectAvail(step, row.key);
						activate();
					} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						const dir = event.key === 'ArrowDown' ? 1 : -1;
						const next = liveFrom(position + dir, dir);
						if (next >= 0) {
							focusRow(next);
						}
					} else if (event.key === 'Home' || event.key === 'End') {
						event.preventDefault();
						const edge = event.key === 'Home' ? liveFrom(0, 1) : liveFrom(rows.length - 1, -1);
						if (edge >= 0) {
							focusRow(edge);
						}
					} else if (event.key === 'ArrowRight') {
						event.preventDefault();
						if (row.expandable && !row.open) {
							toggleAvail(step, row.key, true);
							return;
						}
						const child = row.open ? liveFrom(position + 1, 1) : -1;
						// Пока у раскрытой строки только «Загрузка реквизитов…», следующая живая строка уже сосед
						if (child >= 0 && rows[child].depth > row.depth) {
							focusRow(child);
						}
					} else if (event.key === 'ArrowLeft') {
						event.preventDefault();
						// При поиске папка раскрыта сама: свернуть её нельзя, поэтому ← ведёт к родителю
						if (row.open && expanded.has(row.key)) {
							toggleAvail(step, row.key, false);
							return;
						}
						for (let k = position - 1; k >= 0; k -= 1) {
							if (!rows[k].loading && rows[k].depth < row.depth) {
								focusRow(k);
								return;
							}
						}
					}
				});
				host.appendChild(item);
			});
			ensureListStop(host);
		}

		/** Список в строке (направление, тип группировки) получает остановку Tab вместе со строкой. */
		function setRowStop(row, on) {
			row.tabIndex = on ? 0 : -1;
			const control = row.querySelector('select');
			if (control) {
				control.tabIndex = row.tabIndex;
			}
		}

		function chosenRow(step, spec) {
			let className = 'dcs-tree-row dcs-wizard-row';
			if (spec.selected) {
				className += ' dcs-tree-selected';
			}
			if (spec.pinned) {
				className += ' dcs-wizard-row-pinned';
			}
			if (spec.off) {
				className += ' dcs-wizard-row-off';
			}
			const row = el('div', className);
			row.setAttribute('role', 'option');
			row.setAttribute('aria-selected', String(spec.selected));
			keyedEl(row, spec.key);
			chosenRows.set(spec.key, row);
			const labelEl = row.appendChild(nameEl('span', 'dcs-tree-label', spec.label));
			// Строку со списком тащат только за имя, чтобы список оставался рабочим
			if (spec.control) {
				labelEl.draggable = true;
			} else {
				row.draggable = true;
			}
			for (const note of spec.notes) {
				row.appendChild(el('span', 'dcs-wizard-row-note', note));
			}
			if (spec.control) {
				// Щелчок по списку в строке не перевыделяет строку
				spec.control.addEventListener('click', (event) => {
					event.stopPropagation();
				});
				row.appendChild(spec.control);
			}
			setRowStop(row, spec.selected);
			const select = () => {
				if (spec.onSelect() === 'redraw') {
					// Строка другой цели: цель становится активной, рамка и счётчики перерисовываются
					keepFocus(redrawLists);
					return;
				}
				// Выделение меняется на месте: перерисовка увела бы фокус и закрыла бы открытый список в строке
				for (const [key, other] of chosenRows) {
					other.classList.toggle('dcs-tree-selected', key === spec.key);
					other.setAttribute('aria-selected', String(key === spec.key));
					// У каждой цели группировок свой список и своя остановка: чужие списки не трогаются
					if (other.parentNode === row.parentNode) {
						setRowStop(other, key === spec.key);
					}
				}
			};
			chosenSelectors.set(spec.key, select);
			row.addEventListener('click', select);
			row.addEventListener('dblclick', () => {
				spec.onSelect();
				removeChosen(step, false);
			});
			row.addEventListener('keydown', (event) => {
				if (event.key === 'Delete') {
					event.preventDefault();
					spec.onSelect();
					removeChosen(step, false);
				} else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.altKey) {
					event.preventDefault();
					const keys = Array.from(chosenRows.keys());
					const next = keys[keys.indexOf(spec.key) + (event.key === 'ArrowDown' ? 1 : -1)];
					if (next) {
						chosenSelectors.get(next)();
						const target = keyed.get(next);
						if (target && target.isConnected) {
							target.focus();
						}
					}
				}
			});
			return row;
		}

		function itemLabel(item) {
			if (item.kind === 'auto') {
				return 'Авто';
			}
			if (item.kind === 'folder') {
				return 'Папка «' + (item.title || '') + '»';
			}
			return item.field || '';
		}

		function itemNotes(step, item) {
			const notes = [];
			if (item.kind === 'auto') {
				notes.push(step === 'fields' ? 'поля по умолчанию' : 'порядок по умолчанию');
			} else if (item.kind === 'folder') {
				notes.push('полей: ' + wizardRules.selectedFieldNames(item.items, true).length);
			} else if (item.title) {
				notes.push(item.title);
			}
			if (item.use === false) {
				notes.push('выключено');
			}
			return notes;
		}

		function renderChosenItems(step) {
			const host = hosts.chosen;
			host.textContent = '';
			chosenRows = new Map();
			chosenSelectors = new Map();
			host.appendChild(el('div', 'dcs-wizard-col-title', step === 'fields' ? 'Выбранные поля' : 'Порядок'));
			const listEl = el('div', 'dcs-tree dcs-wizard-list');
			listEl.setAttribute('role', 'listbox');
			listEl.setAttribute('aria-label', step === 'fields' ? 'Выбранные поля' : 'Порядок');
			const items = step === 'fields' ? wz.selection : wz.order;
			chosenDropZone(listEl, step);
			if (items.length === 0) {
				listEl.appendChild(el('div', 'dcs-wizard-empty', step === 'fields' ? 'Поля не выбраны.' : 'Без сортировки.'));
			}
			items.forEach((item, index) => {
				let control = null;
				if (step === 'order' && !pinnedItem(step, item)) {
					control = selectInput(wizardRules.ORDER_TYPES, item.orderType === 'Desc' ? 'Desc' : 'Asc');
					control.classList.add('dcs-wizard-row-select');
					control.setAttribute('aria-label', 'Направление: ' + (item.field || ''));
					control.addEventListener('change', () => {
						wz.order[index] = Object.assign({}, item, { orderType: control.value });
						redrawSide();
					});
				}
				listEl.appendChild(
					chosenRow(step, {
						key: 'chosen:' + index,
						label: itemLabel(item),
						notes: itemNotes(step, item),
						pinned: pinnedItem(step, item),
						off: item.use === false,
						selected: ui.chosen[step] === index,
						control: control,
						onSelect: () => {
							ui.chosen[step] = index;
						},
					})
				);
			});
			ensureListStop(listEl);
			host.appendChild(listEl);
		}

		function renderTargets() {
			const host = hosts.chosen;
			host.textContent = '';
			chosenRows = new Map();
			chosenSelectors = new Map();
			for (const target of wizardRules.TARGETS[wz.type]) {
				const active = ui.target[wz.type] === target;
				const fields = wz.groupings[target];
				const box = el('div', 'dcs-wizard-target' + (active ? ' dcs-wizard-target-active' : ''));
				const head = el(
					'button',
					'dcs-wizard-target-title',
					wizardRules.TARGET_LABELS[target] + (fields.length > 0 ? ' (' + fields.length + ')' : '')
				);
				head.type = 'button';
				head.setAttribute('aria-pressed', String(active));
				head.title = 'Кнопки > и >> добавляют сюда';
				keyedEl(head, 'target:' + target);
				head.addEventListener('click', () => {
					ui.target[wz.type] = target;
					keepFocus(redrawLists);
				});
				box.appendChild(head);
				const listEl = el('div', 'dcs-wizard-target-list');
				listEl.setAttribute('role', 'listbox');
				listEl.setAttribute('aria-label', wizardRules.TARGET_LABELS[target]);
				setHint(listEl, WIZARD_NESTING_HINT);
				targetDropZone(box, head, listEl, target);
				if (fields.length === 0) {
					listEl.appendChild(el('div', 'dcs-wizard-empty', 'Нет полей.'));
				}
				fields.forEach((field, index) => {
					const control = selectInput(wizardRules.GROUP_TYPES, field.groupType || 'Items');
					control.classList.add('dcs-wizard-row-select');
					control.setAttribute('aria-label', 'Тип группировки: ' + (field.field || ''));
					control.addEventListener('change', () => {
						wz.groupings[target][index] = Object.assign({}, field, { groupType: control.value });
						redrawSide();
					});
					listEl.appendChild(
						chosenRow('groups', {
							key: 'chosen:' + target + ':' + index,
							label: field.field || '',
							notes: [],
							pinned: false,
							off: false,
							selected: ui.groupSel.target === target && ui.groupSel.index === index,
							control: control,
							onSelect: () => {
								ui.groupSel = { target: target, index: index };
								if (ui.target[wz.type] === target) {
									return '';
								}
								ui.target[wz.type] = target;
								return 'redraw';
							},
						})
					);
				});
				ensureListStop(listEl);
				box.appendChild(listEl);
				host.appendChild(box);
			}
			if (wz.type === 'list') {
				const details = checkbox('Детальные записи последним уровнем', wz.details);
				keyedEl(details.input, 'details');
				details.input.addEventListener('change', () => {
					wz.details = details.input.checked;
					redrawSide();
				});
				const row = el('div', 'dcs-check-row');
				row.appendChild(details.wrap);
				host.appendChild(row);
			}
		}

		function renderPickStep(host, step) {
			// Постоянной подсказки на шаге нет: о ресурсах предупреждает предпросмотр, о вложенности подсказка списка цели
			const dual = el('div', 'dcs-wizard-dual');
			const left = el('div', 'dcs-wizard-col');
			left.appendChild(el('div', 'dcs-wizard-col-title', 'Доступные поля'));
			const search = el('input', 'edit-input dcs-wizard-search');
			search.type = 'search';
			search.placeholder = 'Поиск поля';
			search.setAttribute('aria-label', 'Поиск среди доступных полей');
			search.value = ui.search[step];
			keyedEl(search, 'search');
			search.addEventListener('input', () => {
				ui.search[step] = search.value;
				renderAvail(step);
			});
			left.appendChild(search);
			hosts.avail = el('div', 'dcs-tree dcs-wizard-list');
			hosts.avail.setAttribute('role', 'tree');
			hosts.avail.setAttribute('aria-label', 'Доступные поля');
			availDropZone(hosts.avail, step);
			left.appendChild(hosts.avail);
			dual.appendChild(left);
			const moves = el('div', 'dcs-wizard-moves');
			moveButton(moves, '>', 'Добавить выделенное поле', 'add', () => addSelectedAvail(step));
			moveButton(moves, '>>', 'Добавить все поля', 'addAll', () => addAllAvail(step));
			moveButton(moves, '<', 'Убрать выделенное', 'remove', () => removeChosen(step, false));
			moveButton(moves, '<<', 'Убрать все', 'removeAll', () => removeChosen(step, true));
			dual.appendChild(moves);
			hosts.chosen = el('div', 'dcs-wizard-col');
			dual.appendChild(hosts.chosen);
			const order = el('div', 'dcs-wizard-moves');
			moveButton(order, '↑', 'Выше', 'up', () => moveChosen(step, -1));
			moveButton(order, '↓', 'Ниже', 'down', () => moveChosen(step, 1));
			if (step === 'groups' && wizardRules.TARGETS[wz.type].length > 1) {
				// Замена переноса мышью в другую цель (WCAG 2.5.7)
				moveButton(order, '⇑', 'В предыдущую цель (тип группировки сохраняется)', 'targetUp', () => transferSelected(-1));
				moveButton(order, '⇓', 'В следующую цель (тип группировки сохраняется)', 'targetDown', () => transferSelected(1));
			}
			dual.appendChild(order);
			host.appendChild(dual);
			const other = el('div', 'dcs-wizard-other');
			const label = el('label', 'dcs-wizard-other-label', 'Другое поле…');
			const input = textInput('');
			input.classList.add('dcs-wizard-other-input');
			input.placeholder = 'путь, например Контрагент.ИНН';
			input.setAttribute('aria-label', 'Другое поле: путь');
			keyedEl(input, 'other');
			const addOther = el('button', 'ghost-btn dcs-btn-small', 'Добавить');
			addOther.type = 'button';
			keyedEl(addOther, 'otherAdd');
			addOther.addEventListener('click', () => {
				addManual(step, input);
			});
			other.appendChild(label);
			other.appendChild(input);
			other.appendChild(addOther);
			host.appendChild(other);
			// Подсказка подключается раньше своего Enter: обработчики идут в порядке подписки, и только так Enter при
			// открытом списке вставляет строку списка, а не недописанный путь. Каталог тот же, что у «Доступных полей»
			// шага: у нового варианта нет пользовательских полей активного
			attachCompletion(input, () => 'settings:' + WIZARD_SECTIONS[step], { catalog: () => catalogs[step] });
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && !event.defaultPrevented) {
					event.preventDefault();
					addManual(step, input);
				}
			});
			drawLists();
		}

		function renderChartStep(host) {
			const current = wz.chartType || wizardRules.DEFAULT_CHART_TYPE;
			const box = el('div', 'dcs-wizard-charts');
			box.setAttribute('role', 'radiogroup');
			box.setAttribute('aria-label', 'Тип диаграммы');
			const labels = [];
			for (const group of wizardRules.CHART_TYPE_GROUPS) {
				const types = wizardRules.CHART_TYPES.filter((type) => type.group === group.id);
				if (types.length === 0) {
					continue;
				}
				const section = el('div', 'dcs-wizard-chart-group');
				section.appendChild(el('div', 'dcs-wizard-chart-title', group.label));
				for (const type of types) {
					const label = el('label', 'dcs-wizard-chart' + (type.value === current ? ' dcs-wizard-chart-active' : ''));
					const radio = el('input', 'dcs-wizard-radio');
					radio.type = 'radio';
					radio.name = 'dcsWizardChart';
					radio.value = type.value;
					radio.checked = type.value === current;
					keyedEl(radio, 'chart:' + type.value);
					labels.push({ label: label, value: type.value });
					radio.addEventListener('change', () => {
						if (!radio.checked) {
							return;
						}
						wz.chartType = type.value;
						for (const entry of labels) {
							entry.label.classList.toggle('dcs-wizard-chart-active', entry.value === type.value);
						}
						redrawSide();
					});
					label.appendChild(radio);
					label.appendChild(el('span', '', type.label));
					label.appendChild(el('span', 'dcs-wizard-row-note', type.value + (type.since ? ', с ' + type.since : '')));
					section.appendChild(label);
				}
				box.appendChild(section);
			}
			host.appendChild(box);
		}

		function renderPreview() {
			const host = hosts.preview;
			host.textContent = '';
			host.appendChild(el('div', 'dcs-wizard-preview-title', 'Результат'));
			const tree = el('div', 'dcs-wizard-preview-tree');
			tree.setAttribute('aria-label', 'Предпросмотр структуры');
			for (const line of wizardRules.previewLines(planState())) {
				const row = el('div', WIZARD_PREVIEW_CLASSES[line.kind] || WIZARD_PREVIEW_CLASSES.group, line.text);
				row.style.paddingLeft = line.depth * 12 + 'px';
				tree.appendChild(row);
			}
			host.appendChild(tree);
			const fields = wz.selection.filter((item) => item && item.use !== false).map(itemLabel).filter(Boolean);
			host.appendChild(el('div', 'dcs-wizard-preview-line', 'Выбранные поля: ' + (fields.length > 0 ? fields.join(', ') : 'нет')));
			const order = wz.order
				.filter((item) => item && item.use !== false)
				.map((item) => (item.kind === 'auto' ? 'Авто' : (item.field || '') + (item.orderType === 'Desc' ? ' ↓' : ' ↑')));
			host.appendChild(el('div', 'dcs-wizard-preview-line', 'Порядок: ' + (order.length > 0 ? order.join(', ') : 'нет')));
			const warnings = allWarnings();
			if (warnings.length > 0) {
				const counts = steps()
					.map((item) => ({ label: item.label, count: warnings.filter((warning) => warning.step === item.id).length }))
					.filter((entry) => entry.count > 0)
					.map((entry) => entry.label + ' (' + entry.count + ')');
				host.appendChild(el('div', 'dcs-warn dcs-wizard-preview-line', 'Предупреждения: ' + counts.join(', ')));
			}
		}

		function renderWarnings() {
			const host = hosts.warn;
			if (!host) {
				return;
			}
			host.textContent = '';
			for (const warning of allWarnings()) {
				if (warning.step === ui.step) {
					host.appendChild(el('div', 'dcs-plate dcs-wizard-warn', warning.text));
				}
			}
		}

		/** Списки шага и отметки «выбрано» без перестройки поиска и «Другого поля»: в них печатают. */
		function drawLists() {
			if (ui.step === 'groups') {
				renderTargets();
			} else if (ui.step === 'fields' || ui.step === 'order') {
				renderChosenItems(ui.step);
			}
			if (hosts.avail) {
				renderAvail(ui.step);
			}
		}

		function redrawLists() {
			drawLists();
			redrawSide();
		}

		function redrawSide() {
			renderPreview();
			renderWarnings();
		}

		function renderAll() {
			if (!steps().some((item) => item.id === ui.step)) {
				// Тип сменился с диаграммы: у нового типа её шага нет
				ui.step = 'type';
			}
			renderSteps();
			const main = hosts.main;
			main.textContent = '';
			hosts.avail = null;
			hosts.chosen = null;
			const stepHost = el('div', 'dcs-wizard-step-body');
			main.appendChild(stepHost);
			hosts.note = el('div', 'dcs-wizard-note');
			hosts.note.setAttribute('aria-live', 'polite');
			hosts.warn = el('div', 'dcs-wizard-warns');
			main.appendChild(hosts.note);
			main.appendChild(hosts.warn);
			if (ui.step === 'type') {
				renderTypeStep(stepHost);
			} else if (ui.step === 'chart') {
				renderChartStep(stepHost);
			} else {
				renderPickStep(stepHost, ui.step);
			}
			redrawSide();
			level.setButtons(footer());
		}

		function submit() {
			if (editBusy()) {
				return BUSY;
			}
			let operations;
			try {
				operations = wizardRules.planWizardOperations(
					ctx.newVariant ? null : ctx.settings,
					planState(),
					ctx.variant,
					ctx.newVariant ? { newVariant: true, presentation: ctx.newVariant.presentation } : undefined
				);
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
			if (operations.length === 0) {
				closeDialog();
				setStatus('Конструктор: изменений нет, вариант не записан.', false);
				return undefined;
			}
			if (!send('dcs/settings-wizard', { variant: ctx.variant, operations: operations })) {
				return BUSY;
			}
			// После записи выделен корень и дерево разворачивается заново: структура собрана другой
			delete seededVariants[ctx.variant];
			core.pendingSelect = [];
			return undefined;
		}

		const opened = pushDialog({
			title: (ctx.newVariant ? 'Конструктор настроек: новый вариант «' : 'Конструктор настроек: вариант «') + ctx.variant + '»',
			width: 'wide',
			onClose: () => {
				if (core.wizardRerender === onWizardDescribed) {
					core.wizardRerender = null;
				}
			},
			// Шаги рисуются внутри build: стек ставит фокус в первое поле уже нарисованного шага
			build: (body, created) => {
				level = created;
				const root = el('div', 'dcs-wizard');
				hosts.steps = el('nav', 'dcs-wizard-steps');
				hosts.steps.setAttribute('aria-label', 'Шаги конструктора');
				root.appendChild(hosts.steps);
				const layout = el('div', 'dcs-wizard-layout');
				hosts.main = el('div', 'dcs-wizard-main');
				hosts.preview = el('aside', 'dcs-wizard-preview');
				hosts.preview.setAttribute('aria-label', 'Результат');
				layout.appendChild(hosts.main);
				layout.appendChild(hosts.preview);
				root.appendChild(layout);
				body.appendChild(root);
				renderAll();
			},
			buttons: footer(),
		});
		if (opened.isOpen()) {
			core.wizardRerender = onWizardDescribed;
		}
		return opened;
	}

	// ---------- дерево структуры варианта ----------

	/** Выделение, которого после правки нет, переходит на корень. */
	function ensureValidSelection(settings) {
		const path = uiState.nodePath;
		if (isPseudoPath(path)) {
			const parent = nodeAt(settings, path.slice(0, -1));
			const listName = path[path.length - 1].list;
			const kind = parent && parent.kind;
			const valid =
				(kind === 'table' && (listName === 'columns' || listName === 'rows')) ||
				(kind === 'chart' && (listName === 'points' || listName === 'series'));
			if (!valid) {
				uiState.nodePath = [];
			}
			return;
		}
		if (!nodeAt(settings, path)) {
			uiState.nodePath = [];
		}
	}

	function selectNode(path) {
		clearReplyFocus();
		uiState.nodePath = path;
		renderContent();
	}

	/**
	 * Видимые строки дерева структуры по порядку, для стрелок: {path, key, parentKey, expandable, expanded, node}.
	 * Собираются при каждой отрисовке дерева.
	 */
	let structureRows = [];
	/** Вариант нарисованного дерева: Delete в дереве удаляет узел этого варианта. */
	let structureCtx = null;

	/** Путь path лежит внутри узла under. Пути элементов псевдо-узла той же длины, что его путь, но с настоящим номером. */
	function isUnderPath(path, under) {
		const pseudo = isPseudoPath(under);
		if (pseudo ? path.length < under.length : path.length <= under.length) {
			return false;
		}
		return under.every((step, index) => {
			const own = path[index];
			if (pseudo && index === under.length - 1) {
				return own.list === step.list && own.index !== -1;
			}
			return own.list === step.list && own.index === step.index;
		});
	}

	/** Строка дерева структуры. Имя для читалки: подпись, имя узла, «не используется» и бейджи словами. */
	function treeRow(tree, path, depth, opts) {
		const key = pathKey(path);
		const selected = key === pathKey(uiState.nodePath);
		let className = 'dcs-tree-row dcs-setv-node';
		if (selected) {
			className += ' dcs-tree-selected';
		}
		if (opts.dim) {
			className += ' dcs-tree-off';
		}
		const row = el('div', className);
		row.style.paddingLeft = 8 + depth * 16 + 'px';
		const expandedNow = Boolean(opts.expandable) && uiState.expanded.has(key);
		row.setAttribute('role', 'treeitem');
		row.setAttribute('aria-level', String(depth + 1));
		row.setAttribute('aria-selected', String(selected));
		if (opts.expandable) {
			row.setAttribute('aria-expanded', String(expandedNow));
		}
		row.tabIndex = selected ? 0 : -1;
		keyed(row, focusKey(['node', key]));
		const twist = el('span', 'dcs-tree-twist', opts.expandable ? (expandedNow ? '▾' : '▸') : '');
		twist.setAttribute('aria-hidden', 'true');
		if (opts.expandable) {
			twist.addEventListener('click', (event) => {
				event.stopPropagation();
				toggleStructureNode(path, !expandedNow, false);
			});
		}
		row.appendChild(twist);
		if (opts.check !== undefined) {
			const box = el('input', 'edit-check');
			box.type = 'checkbox';
			box.checked = opts.check;
			// Галка только показывает use, читалка слышит его в имени строки
			box.disabled = true;
			box.setAttribute('aria-hidden', 'true');
			row.appendChild(box);
		}
		const labelEl = nameEl('span', 'dcs-tree-label', opts.label);
		row.appendChild(labelEl);
		const spoken = [opts.label];
		if (opts.name) {
			row.appendChild(nameEl('span', 'dcs-tree-name', '[' + opts.name + ']'));
			spoken.push(opts.name);
		}
		if (opts.dim) {
			spoken.push('не используется');
		}
		for (const badge of opts.badges || []) {
			const badgeEl = el('span', 'dcs-tree-badge', badge.text);
			badgeEl.title = badge.hint;
			badgeEl.setAttribute('aria-hidden', 'true');
			row.appendChild(badgeEl);
			spoken.push(badge.hint);
		}
		if (opts.readOnly) {
			row.appendChild(el('span', 'dcs-tree-ro', 'только чтение'));
			spoken.push('только чтение');
		}
		row.setAttribute('aria-label', spoken.join(', '));
		// Перенос мышью: у строки только атрибут, слушатели у документа
		if (opts.node && path.length > 0 && !isPseudoPath(path)) {
			row.draggable = true;
		}
		row.addEventListener('click', () => {
			selectNode(path);
		});
		row.addEventListener('keydown', (event) => {
			onStructureKey(event, key);
		});
		tree.appendChild(row);
		structureRows.push({
			path: path,
			key: key,
			parentKey: opts.parent ? pathKey(opts.parent) : '',
			expandable: Boolean(opts.expandable),
			expanded: expandedNow,
			node: opts.node || null,
		});
		return expandedNow;
	}

	function appendStructureRows(tree, items, parentPath, depth) {
		items.forEach((node, index) => {
			appendNodeRow(tree, node, parentPath.concat([{ list: 'structure', index: index }]), depth, parentPath);
		});
	}

	function appendNodeRow(tree, node, path, depth, parentPath) {
		const kind = node.kind;
		if (kind === 'table' || kind === 'chart') {
			const expanded = treeRow(tree, path, depth, {
				label: nodeLabel(node),
				name: node.name,
				check: node.use !== false,
				dim: node.use === false,
				badges: sectionBadges(node),
				expandable: true,
				parent: parentPath,
				node: node,
			});
			if (!expanded) {
				return;
			}
			for (const listName of kind === 'table' ? ['columns', 'rows'] : ['points', 'series']) {
				appendPseudoRow(tree, node, path, listName, depth + 1);
			}
			return;
		}
		if (kind === 'nestedObject') {
			treeRow(tree, path, depth, {
				label: nodeLabel(node),
				name: node.name,
				check: node.use !== false,
				dim: node.use === false,
				readOnly: true,
				expandable: false,
				parent: parentPath,
				node: node,
			});
			return;
		}
		const children = Array.isArray(node.structure) ? node.structure : [];
		const expanded = treeRow(tree, path, depth, {
			label: nodeLabel(node),
			name: node.name,
			check: node.use !== false,
			dim: node.use === false,
			badges: sectionBadges(node),
			expandable: children.length > 0,
			parent: parentPath,
			node: node,
		});
		if (expanded) {
			appendStructureRows(tree, children, path, depth + 1);
		}
	}

	function appendPseudoRow(tree, parentNode, parentPath, listName, depth) {
		const path = parentPath.concat([{ list: listName, index: -1 }]);
		const items = Array.isArray(parentNode[listName]) ? parentNode[listName] : [];
		const expanded = treeRow(tree, path, depth, {
			label: PSEUDO_TITLES[listName],
			expandable: items.length > 0,
			parent: parentPath,
		});
		if (!expanded) {
			return;
		}
		items.forEach((node, index) => {
			appendNodeRow(tree, node, parentPath.concat([{ list: listName, index: index }]), depth + 1, path);
		});
	}

	/**
	 * Дерево структуры с панелью пиктограмм. Клавиатура как у остальных деревьев редактора, Delete удаляет узел.
	 * Выбор узла перерисовывает вкладку, фокус остаётся на его строке.
	 */
	function renderStructureTree(host, settings, variantName) {
		host.appendChild(structureToolbar(settings, variantName));
		structureRows = [];
		structureCtx = { variantName: variantName };
		const tree = el('div', 'dcs-tree dcs-setv-tree');
		tree.setAttribute('role', 'tree');
		tree.setAttribute('aria-label', 'Структура варианта');
		const rootChildren = Array.isArray(settings.structure) ? settings.structure : [];
		const expanded = treeRow(tree, [], 0, {
			label: 'Отчет',
			badges: sectionBadges(settings),
			expandable: rootChildren.length > 0,
		});
		if (expanded) {
			appendStructureRows(tree, rootChildren, [], 1);
		}
		structureDropZone(tree, settings, variantName);
		host.appendChild(tree);
		if (rootChildren.length === 0) {
			// Пустой вариант чаще всего собирают мастером: подсказка ведёт прямо к нему
			const hint = el('div', 'dcs-wizard-hint');
			hint.appendChild(el('span', '', 'Структура пуста.'));
			const start = el('button', 'ghost-btn dcs-btn-small', 'Собрать структуру конструктором');
			start.type = 'button';
			start.addEventListener('click', () => {
				startSettingsWizard(variantName);
			});
			hint.appendChild(keyed(start, focusKey(['structool', 'wizard'])));
			host.appendChild(hint);
		}
	}

	/**
	 * «Доступные поля» панелей по id зоны: поле, брошенное на дерево структуры, узнаётся по ключу строки. Запись ставит
	 * settingsFieldsLayout на каждой отрисовке.
	 */
	const settingsAvailNodes = new Map();

	function groupableField(node) {
		return settingsPickable(node) && node.kind !== 'total' && !(node.restrict && node.restrict.group);
	}

	/**
	 * Перенос мышью в дереве структуры. Узел переставляется только среди соседей того же родителя: к другому родителю
	 * dcs/move-structure-item не переносит. Линия «после» раскрытого узла рисуется под его последним видимым потомком:
	 * узел встанет за всем его содержимым. Поле из «Доступных полей» панели, брошенное на узел, открывает окно
	 * «Новая группировка» с отмеченным полем. Сводки строк собираются при первом обращении за перенос.
	 */
	function structureDropZone(tree, settings, variantName) {
		const rows = structureRows;
		let info = null;
		const infoOf = () => {
			if (!info) {
				// По ключу строки: строка, ключ родителя, номер среди строк, последний видимый потомок
				info = { byKey: new Map(), parent: new Map(), at: new Map(), last: new Map() };
				rows.forEach((row, at) => {
					info.byKey.set(row.key, row);
					info.at.set(row.key, at);
					info.parent.set(row.key, row.path.length > 0 ? pathKey(row.path.slice(0, -1)) + '\n' + row.path[row.path.length - 1].list : '');
				});
			}
			return info;
		};
		const rowOf = (key) => (key === null || key === undefined ? null : infoOf().byKey.get(key) || null);
		const fieldOf = (payload) => {
			const resolve = settingsAvailNodes.get(payload.zone);
			const node = resolve ? resolve(payload.key) : null;
			return groupableField(node) ? node : null;
		};
		const prefix = focusKey(['node', '']);
		const from = {
			struct: (payload, spot) => {
				const source = rowOf(payload.key);
				const target = rowOf(spot.key);
				if (!source || !target) {
					return false;
				}
				const last = source.path[source.path.length - 1];
				const parent = nodeAt(settings, source.path.slice(0, -1));
				const count = parent && Array.isArray(parent[last.list]) ? parent[last.list].length : 0;
				const to = dropIndex(count, last.index, target.path[target.path.length - 1].index, spot.place);
				if (to === last.index) {
					return false;
				}
				if (moveNode(variantName, source.path, to)) {
					// После ответа фокус на строке на новом месте
					replyFocus.structure = true;
				}
				return undefined;
			},
		};
		// Куда узел сброса принимает группировку (addTarget): считается раз за перенос
		let targets = null;
		const targetOf = (row) => {
			if (!targets) {
				targets = new Map();
			}
			if (!targets.has(row.key)) {
				targets.set(row.key, addTarget(settings, row.path));
			}
			return targets.get(row.key);
		};
		const fieldDrop = (payload, spot) => {
			const field = fieldOf(payload);
			const target = rowOf(spot.key);
			const place = target ? targetOf(target) : null;
			if (!field || !place) {
				return false;
			}
			openAddGroupDialog(settings, variantName, place, field.path);
			return undefined;
		};
		for (const panel of ['selection', 'filter', 'order']) {
			from['setavail:' + panel] = fieldDrop;
		}
		dragZone(tree, {
			id: 'struct',
			scope: 'settings',
			keyOf: (item) => {
				const key = item.getAttribute('data-dcs-key');
				return key && key.indexOf(prefix) === 0 ? key.slice(prefix.length) : null;
			},
			drag: (key) => {
				const row = rowOf(key);
				return row && structureMovable(row) ? 'node' : '';
			},
			pick: (key) => {
				const row = rowOf(key);
				if (row) {
					selectNode(row.path);
				}
			},
			accept: (payload) => payload.zone === 'struct' || fieldOf(payload) !== null,
			rowAccept: (payload, key) => {
				const target = rowOf(key);
				if (!target) {
					return false;
				}
				if (payload.zone !== 'struct') {
					return targetOf(target) !== null;
				}
				const source = rowOf(payload.key);
				return Boolean(source && structureMovable(target)) && infoOf().parent.get(source.key) === infoOf().parent.get(target.key);
			},
			place: (payload) => (payload.zone === 'struct' ? 'line' : 'into'),
			effect: (payload) => (payload.zone === 'struct' ? 'move' : 'copy'),
			markRow: (key, place) => {
				const at = place === 'after' ? infoOf().at.get(key) : undefined;
				const row = at === undefined ? null : rows[at];
				if (!row || !row.expanded) {
					return null;
				}
				const ends = infoOf().last;
				if (!ends.has(key)) {
					let end = at;
					while (end + 1 < rows.length && isUnderPath(rows[end + 1].path, row.path)) {
						end += 1;
					}
					ends.set(key, end);
				}
				// Строки дерева: дети контейнера в том же порядке, что structureRows
				return ends.get(key) > at ? tree.children[ends.get(key)] || null : null;
			},
			from: from,
		});
	}

	/** Переставляется любой узел, кроме «Отчета» и списков таблицы и диаграммы. */
	function structureMovable(row) {
		return Boolean(row.node) && row.path.length > 0 && !isPseudoPath(row.path);
	}

	/** Свёрнутый узел забирает выделение у скрытого внутри него. */
	function toggleStructureNode(path, open, focus) {
		const key = pathKey(path);
		if (open) {
			uiState.expanded.add(key);
		} else {
			uiState.expanded.delete(key);
			if (isUnderPath(uiState.nodePath, path)) {
				uiState.nodePath = path;
			}
		}
		if (focus) {
			uiState.nodePath = path;
			core.focusStructureRow = true;
		}
		renderContent();
	}

	function onStructureKey(event, key) {
		if (event.defaultPrevented) {
			return;
		}
		const index = structureRows.findIndex((row) => row.key === key);
		const row = structureRows[index];
		if (!row) {
			return;
		}
		let target = null;
		if (event.key === 'ArrowDown') {
			target = structureRows[Math.min(structureRows.length - 1, index + 1)];
		} else if (event.key === 'ArrowUp') {
			target = structureRows[Math.max(0, index - 1)];
		} else if (event.key === 'Home') {
			target = structureRows[0];
		} else if (event.key === 'End') {
			target = structureRows[structureRows.length - 1];
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			if (row.expandable && !row.expanded) {
				toggleStructureNode(row.path, true, true);
				return;
			}
			if (row.expanded && structureRows[index + 1]) {
				target = structureRows[index + 1];
			} else {
				return;
			}
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			if (row.expanded) {
				toggleStructureNode(row.path, false, true);
				return;
			}
			target = structureRows.find((candidate) => candidate.key === row.parentKey) || null;
			if (!target) {
				return;
			}
		} else if (event.key === 'Delete') {
			event.preventDefault();
			if (row.node && row.path.length > 0 && !isPseudoPath(row.path)) {
				removeNode(structureCtx.variantName, row.path, row.node, true);
			} else {
				settingsNotice('Удалить узел', NODE_FIXED_NOTE);
			}
			return;
		} else {
			return;
		}
		event.preventDefault();
		if (target.key === key) {
			return;
		}
		core.focusStructureRow = true;
		selectNode(target.path);
	}

	/** Контекст добавления узла: куда и какие виды можно добавить в nodePath (без него в выделенный); null, если некуда. */
	function addTarget(settings, nodePath) {
		const path = nodePath || uiState.nodePath;
		if (isPseudoPath(path)) {
			// В списках таблицы и диаграммы живут только группы
			return { parentPath: path.slice(0, -1), list: path[path.length - 1].list, kinds: ['group'] };
		}
		const kind = nodeKindAt(settings, path);
		if (kind === 'root' || kind === 'group') {
			const insideTableChart = path.some((step) => step.list !== 'structure');
			return {
				parentPath: path,
				list: 'structure',
				kinds: insideTableChart ? ['group'] : ['group', 'table', 'chart'],
			};
		}
		return null;
	}

	const ADD_NODE_NOTE = 'Недоступно: узлы добавляются в «Отчет», в группировку и в списки таблицы и диаграммы.';
	const ADD_GROUP_ONLY_NOTE = 'Недоступно: в таблице и диаграмме бывают только группировки.';
	const NODE_PICK_NOTE = 'Недоступно: выберите группировку, таблицу или диаграмму.';
	const NODE_FIXED_NOTE = 'Недоступно: «Отчет» и списки таблицы и диаграммы не удаляются.';

	/** Панель над деревом: недоступная команда остаётся в обходе Tab, щелчок по ней называет причину. */
	function structureToolbar(settings, variantName) {
		const target = addTarget(settings);
		const path = uiState.nodePath;
		const node = path.length > 0 && !isPseudoPath(path) ? nodeAt(settings, path) : null;
		let index = -1;
		let count = 0;
		if (node) {
			const last = path[path.length - 1];
			const parent = nodeAt(settings, path.slice(0, -1));
			const siblings = parent && Array.isArray(parent[last.list]) ? parent[last.list] : [];
			index = last.index;
			count = siblings.length;
		}
		const addNote = (kind) => (!target ? ADD_NODE_NOTE : target.kinds.indexOf(kind) < 0 ? ADD_GROUP_ONLY_NOTE : '');
		const addKind = (kind) => {
			if (!addStructureItem(settings, variantName, target, kind, undefined)) {
				setStatus(BUSY, true);
			}
		};
		const tools = [
			{ id: 'group', icon: 'group', name: 'Новая группировка…', note: addNote('group'), run: () => openAddGroupDialog(settings, variantName, target) },
			{ id: 'table', icon: 'table', name: 'Новая таблица', note: addNote('table'), run: () => addKind('table') },
			{ id: 'chart', icon: 'chart', name: 'Новая диаграмма', note: addNote('chart'), run: () => addKind('chart') },
			{
				id: 'up',
				icon: 'up',
				name: 'Переместить узел выше',
				note: !node ? NODE_PICK_NOTE : index === 0 ? 'Недоступно: узел уже первый.' : '',
				run: () => moveNode(variantName, path, index - 1),
			},
			{
				id: 'down',
				icon: 'down',
				name: 'Переместить узел ниже',
				note: !node ? NODE_PICK_NOTE : index >= count - 1 ? 'Недоступно: узел уже последний.' : '',
				run: () => moveNode(variantName, path, index + 1),
			},
			{ id: 'delete', icon: 'delete', name: 'Удалить узел', shortcut: 'Delete', danger: true, note: node ? '' : NODE_FIXED_NOTE, run: () => removeNode(variantName, path, node) },
		];
		const bar = el('div', 'dcs-list-toolbar');
		for (const tool of tools) {
			const button = iconButton({
				icon: tool.icon,
				name: tool.name,
				shortcut: tool.shortcut,
				note: tool.note,
				unavailable: Boolean(tool.note),
				className: tool.danger ? 'ghost-btn dcs-btn-small dcs-btn-danger' : undefined,
				onClick: () => {
					if (tool.note) {
						settingsNotice(tool.name, tool.note);
					} else {
						tool.run();
					}
				},
			});
			bar.appendChild(keyed(button, focusKey(['structool', tool.id])));
		}
		return bar;
	}

	/** После сохранения выделение перейдёт на новый узел. */
	function addStructureItem(settings, variantName, target, kind, groupFields) {
		const payload = { parentPath: target.parentPath, list: target.list };
		if (target.list === 'structure') {
			// В остальных списках вид элемента предрешён: kind допустим только в structure
			payload.kind = kind;
		}
		if (groupFields && groupFields.length > 0) {
			payload.groupFields = groupFields;
		}
		if (!send('dcs/add-structure-item', { variant: variantName, payload: payload })) {
			return false;
		}
		const parent = nodeAt(settings, target.parentPath);
		const siblings = parent && Array.isArray(parent[target.list]) ? parent[target.list] : [];
		core.pendingSelect = target.parentPath.concat([{ list: target.list, index: siblings.length }]);
		return true;
	}

	/**
	 * Окно «Новая группировка» в target (addTarget). preset: поле, брошенное мышью на узел дерева; его флажок отмечен,
	 * а если поля нет в списке, оно в «Других полях».
	 */
	function openAddGroupDialog(settings, variantName, target, preset) {
		const known = settingsFieldPaths();
		const boxes = [];
		const presetKey = preset ? fieldTreeKey(preset) : '';
		const presetKnown = Boolean(preset) && known.some((fieldPath) => fieldTreeKey(fieldPath) === presetKey);
		let extraInput;
		openDialog(
			'Новая группировка',
			'Добавить',
			(body) => {
				const noFieldsHint = 'Без полей группировка выводит детальные записи.';
				if (known.length > 0) {
					groupTitle(body, 'Поля группировки');
					const listEl = el('div', 'dcs-check-list');
					listEl.setAttribute('role', 'group');
					listEl.setAttribute('aria-label', 'Поля группировки');
					setHint(listEl, noFieldsHint);
					for (const fieldPath of known) {
						const box = checkbox(fieldPath, presetKnown && fieldTreeKey(fieldPath) === presetKey);
						boxes.push({ name: fieldPath, input: box.input });
						listEl.appendChild(box.wrap);
					}
					body.appendChild(listEl);
				}
				extraInput = formRow(body, 'Другие поля', textInput(preset && !presetKnown ? preset : ''));
				extraInput.placeholder = 'через запятую';
				if (known.length === 0) {
					setHint(extraInput, noFieldsHint);
				}
				// Запятая и пробел не входят в путь: подсказка берёт сегмент после последней запятой сама
				attachFieldList(extraInput, 'group');
			},
			() => {
				const fields = boxes.filter((box) => box.input.checked).map((box) => box.name);
				for (const raw of extraInput.value.split(',')) {
					const fieldPath = raw.trim();
					if (fieldPath && fields.indexOf(fieldPath) < 0) {
						fields.push(fieldPath);
					}
				}
				const groupFields = fields.map((fieldPath) => ({
					field: fieldPath,
					groupType: 'Items',
					periodAdditionType: 'None',
				}));
				if (!addStructureItem(settings, variantName, target, 'group', groupFields)) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	/** true: правка ушла, после ответа выбран узел. */
	function moveNode(variantName, path, newIndex) {
		if (!send('dcs/move-structure-item', { variant: variantName, payload: { path: path, newIndex: newIndex } })) {
			setStatus(BUSY, true);
			return false;
		}
		const last = path[path.length - 1];
		core.pendingSelect = path.slice(0, -1).concat([{ list: last.list, index: newIndex }]);
		return true;
	}

	/** fromTree: удаление клавишей Delete в дереве, после ответа фокус встанет на строку родителя. */
	function removeNode(variantName, path, node, fromTree) {
		const descendants = countDescendants(node);
		let question = 'Удалить узел «' + nodeLabel(node) + '»?';
		if (descendants > 0) {
			question += ' Вместе с ним удалятся вложенные узлы: ' + descendants + '.';
		}
		confirmRemove(question, () => {
			if (!send('dcs/remove-structure-item', { variant: variantName, payload: { path: path } })) {
				return BUSY;
			}
			core.pendingSelect = path.slice(0, -1);
			replyFocus.structure = Boolean(fromTree);
			return undefined;
		});
	}

	// ---------- вкладки узла (dcs-editor-settings-panels.js) ----------
	// Фабрика видит закладку только через этот объект и создаётся последней, когда объявления закладки готовы
	const settingsPanels = window.DcsEditorSettingsPanels(
		core,
		Object.freeze({
			attachFieldList, GROUP_TYPE_OPTIONS, isPseudoPath, nodeAt, nodeKindAt, nodeLabel, optionLabel, pathKey,
			PERIOD_ADDITION_LABELS, periodAdditionLabel, PLACEMENT_OPTIONS, PSEUDO_TITLES, sectionItems, settingsAvailNodes,
			settingsNotice, typeAttributeLevel, uiState, WIZARD_PICK_KINDS, WIZARD_TYPE_KINDS, wizardKey, wizardNodeIndex,
			wizardRules,
		})
	);
	const { focusGridRow, renderNodePanels, settingsPickable } = settingsPanels;

	return Object.freeze({ activeVariantName, affectedVariant, expandTo, renderVariants, uiState });
};
