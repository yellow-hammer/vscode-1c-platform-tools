/**
 * Нижняя часть закладки «Настройки» редактора СКД: строка «Настройки: <узел>» и вкладки узла в порядке конфигуратора
 * («Поля группировки», «Параметры», «Выбранные поля», «Отбор», «Сортировка», «Условное оформление» с окном формата,
 * «Пользовательские поля», «Другие настройки»), дерево «Доступные поля» и общий список панелей с пиктограммами,
 * переносом и уровнями.
 *
 * Подключается до dcs-editor-settings.js и задаёт только фабрику window.DcsEditorSettingsPanels(core, settingsTab).
 * Её зовёт фабрика закладки «Настройки» и отдаёт объект ядра (JSDoc у const core в dcs-editor.js) и свой объект:
 * состояние вкладки, путь узла, подписи и расчёты мастера. Изменяемое общее состояние читается и пишется через
 * поля-аксессоры (core.model, core.focusListPanel…), а не копией значения.
 */
window.DcsEditorSettingsPanels = function (core, settingsTab) {
	'use strict';

	const {
		actionsCell, actionSelect, browseSelect, BUSY, cell, checkbox, checkRow, clearReplyFocus, closeDialog,
		completionCatalog, confirmRemove, dataTable, DCS_ZERO_DATE, dropIndex, el, emptyNote, fieldTree, fieldTreeKey,
		FOCUSABLE, focusKey, focusKeyed, formRow, groupTitle, iconButton, itemAtPos, itemsDropSlot, itemsIndentSlot,
		itemsInsert, itemsLevel, itemsMove, itemsOutdentSlot, keyed, list, listDropSlot, listToolbar, nameEl, numberInput,
		openDialog, openWideDialog, pushDialog, renderContent, replyFocus, requestDescriptions, rowRemovalFocus, selectInput,
		send, setHint, setIconState, setStatus, setTransferState, STANDARD_PERIOD_LABELS, tableDropZone, textInput,
		transferButtons, valueRaw, valueSummary,
	} = core;
	const {
		attachFieldList, GROUP_TYPE_OPTIONS, isPseudoPath, nodeAt, nodeKindAt, nodeLabel, optionLabel, pathKey,
		PERIOD_ADDITION_LABELS, periodAdditionLabel, PLACEMENT_OPTIONS, PSEUDO_TITLES, sectionItems, settingsAvailNodes,
		settingsNotice, typeAttributeLevel, uiState, WIZARD_PICK_KINDS, WIZARD_TYPE_KINDS, wizardKey, wizardNodeIndex,
		wizardRules,
	} = settingsTab;

	// ---------- состояние и подписи вкладок узла ----------

	/**
	 * Выбранная строка списка панели узла по ключу «вариант, путь узла, панель»: {key — адрес строки (JSON позиции в
	 * дереве элементов), index — её номер среди видимых строк}. Номер — запасной выбор, если строки с адресом больше нет.
	 */
	const settingsListUi = new Map();
	/** Дерево «Доступные поля» панелей «Выбранные поля», «Отбор» и «Сортировка»: выбор и раскрытые ветки на раздел. */
	const settingsAvailUi = {
		selection: { selected: '', expanded: new Set() },
		filter: { selected: '', expanded: new Set() },
		order: { selected: '', expanded: new Set() },
	};

	const ORDER_TYPE_OPTIONS = [
		{ value: 'Asc', label: 'По возрастанию' },
		{ value: 'Desc', label: 'По убыванию' },
	];

	/**
	 * Панели узла по его виду (root — корень «Отчет») в порядке вкладок конфигуратора: Параметры,
	 * Выбранные поля, Отбор, Сортировка, Условное оформление, Пользовательские поля, Другие настройки. «Поля
	 * группировки» есть только у группировки — первыми, на месте «Параметров», которых у неё нет.
	 */
	const NODE_PANELS = [
		{ id: 'groupFields', title: 'Поля группировки', kinds: ['group'], render: renderGroupFieldsPanel },
		{ id: 'dataParameters', title: 'Параметры', kinds: ['root'], render: renderDataParametersPanel },
		{ id: 'selection', title: 'Выбранные поля', kinds: ['root', 'group', 'table', 'chart'], render: renderSelectionPanel },
		{ id: 'filter', title: 'Отбор', kinds: ['root', 'group'], render: renderFilterPanel },
		{ id: 'order', title: 'Сортировка', kinds: ['root', 'group'], render: renderOrderPanel },
		{ id: 'appearance', title: 'Условное оформление', kinds: ['root', 'group', 'table', 'chart'], render: renderAppearancePanel },
		{ id: 'userFields', title: 'Пользовательские поля', kinds: ['root'], render: renderUserFieldsPanel },
		{ id: 'output', title: 'Другие настройки', kinds: ['root', 'group', 'table', 'chart'], render: renderOutputPanel },
	];

	/** Панель по умолчанию, пока пользователь не выбрал другую, и когда выбранной у узла нет. */
	const DEFAULT_NODE_PANEL = 'selection';

	function cloneItems(items) {
		return JSON.parse(JSON.stringify(items));
	}

	function groupTypeLabel(value) {
		return optionLabel(GROUP_TYPE_OPTIONS, value, 'Без иерархии');
	}

	function placementLabel(value) {
		return optionLabel(PLACEMENT_OPTIONS, value, 'Авто');
	}

	function periodAdditionOptions() {
		return Object.keys(PERIOD_ADDITION_LABELS).map((value) => ({ value: value, label: PERIOD_ADDITION_LABELS[value] }));
	}

	// ---------- панели выбранного узла ----------

	/** Подпись узла в строке «Настройки: …» над вкладками — как у конфигуратора «Настройки: Отчет». */
	function nodeCaption(settings, path) {
		if (path.length === 0) {
			return 'Отчет';
		}
		if (isPseudoPath(path)) {
			return PSEUDO_TITLES[path[path.length - 1].list] || '';
		}
		const node = nodeAt(settings, path);
		return node ? nodeLabel(node) : '';
	}

	/**
	 * Низ вкладки «Настройки» на всю ширину: строка «Настройки: <узел>» и вкладки узла в порядке
	 * конфигуратора. Полоса вкладок — role tablist с одной остановкой Tab: ← → Home End переключают вкладку, фокус
	 * остаётся на ярлыке после перерисовки.
	 */
	function renderNodePanels(host, settings, variantName) {
		const path = uiState.nodePath;
		const captionText = 'Настройки: ' + nodeCaption(settings, path);
		host.appendChild(nameEl('div', 'dcs-setv-caption', captionText));
		if (isPseudoPath(path)) {
			host.appendChild(
				el(
					'div',
					'dcs-plate',
					'Колонки, строки, точки и серии настраиваются на своих группах: добавьте группу кнопкой «Новая группировка…» над деревом или выберите её в дереве.'
				)
			);
			return;
		}
		const node = nodeAt(settings, path);
		const kind = nodeKindAt(settings, path);
		if (kind === 'nestedObject') {
			host.appendChild(el('div', 'dcs-plate', 'Вложенный отчёт: настройки хранятся в его схеме и здесь не редактируются.'));
			return;
		}
		const panels = NODE_PANELS.filter((panel) => panel.kinds.indexOf(kind) >= 0);
		if (!panels.some((panel) => panel.id === uiState.panel)) {
			uiState.panel = panels.some((panel) => panel.id === DEFAULT_NODE_PANEL) ? DEFAULT_NODE_PANEL : panels[0].id;
		}
		const strip = el('nav', 'tabs dcs-subtabs');
		strip.setAttribute('role', 'tablist');
		strip.setAttribute('aria-label', captionText);
		const body = el('div', 'dcs-panel');
		body.setAttribute('role', 'tabpanel');
		body.id = 'dcsNodePanel';
		panels.forEach((panel, index) => {
			const active = panel.id === uiState.panel;
			const button = el('button', 'tab' + (active ? ' active' : ''), panel.title);
			button.type = 'button';
			button.id = 'dcsNodeTab-' + panel.id;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(active));
			button.tabIndex = active ? 0 : -1;
			if (active) {
				button.setAttribute('aria-controls', body.id);
				body.setAttribute('aria-labelledby', button.id);
			}
			keyed(button, focusKey(['subtab', panel.id]));
			button.addEventListener('click', () => {
				pickNodePanel(panel.id, false);
			});
			button.addEventListener('keydown', (event) => {
				if (event.defaultPrevented) {
					return;
				}
				const last = panels.length - 1;
				let to = -1;
				if (event.key === 'ArrowRight') {
					to = index === last ? 0 : index + 1;
				} else if (event.key === 'ArrowLeft') {
					to = index === 0 ? last : index - 1;
				} else if (event.key === 'Home') {
					to = 0;
				} else if (event.key === 'End') {
					to = last;
				}
				if (to < 0) {
					return;
				}
				event.preventDefault();
				pickNodePanel(panels[to].id, true);
			});
			strip.appendChild(button);
		});
		host.appendChild(strip);
		// Область — в документе до отрисовки: фокус, который ставит отрисовка списка, у неподключённого узла пропал бы
		host.appendChild(body);
		const active = panels.find((panel) => panel.id === uiState.panel);
		active.render(body, node, path, variantName);
		// Во вкладке нет элементов управления (пользовательских полей нет — только текст): область сама встаёт в обход Tab,
		// иначе Tab с полосы вкладок перескочил бы её, и читалка в режиме фокуса до текста не дошла бы
		if (body.querySelectorAll(FOCUSABLE).length === 0) {
			body.tabIndex = 0;
		}
	}

	/** Смена вкладки узла; focus — с клавиатуры: фокус переходит на ярлык до перерисовки и остаётся на нём после. */
	function pickNodePanel(id, focus) {
		if (focus) {
			focusKeyed(focusKey(['subtab', id]));
		}
		if (id === uiState.panel) {
			return;
		}
		clearReplyFocus();
		uiState.panel = id;
		renderContent();
	}

	// ---------- списки панелей «Выбранные поля», «Отбор», «Сортировка»: доступные поля слева, список справа ----------

	/** Узлы «Доступных полей» раздела: тот же каталог, что у подсказки поля в окнах «Добавить поле…» (settings:<раздел>). */
	function settingsFieldNodes(section) {
		return completionCatalog('settings:' + section).nodes;
	}

	/** Ограничение реквизитов, которое действует в разделе (как у подсказки поля): выбранные поля, отбор, сортировка. */
	const SETTINGS_ATTRIBUTE_FLAGS = { selection: 'field', filter: 'condition', order: 'order' };

	/**
	 * Посчитанные реквизиты по типу «Доступных полей» на раздел: {catalog, stamp, model, index — узлы каталога по пути,
	 * entries — уровень по пути поля, fieldIndex — поля наборов по пути для вывода типа}. Новый каталог (модель, вариант,
	 * словарь) или новое описание (describeStamp) сбрасывают уровни: вкладка перерисовывается на каждую правку, а вывод
	 * типа поля набора-запроса разбирает его текст.
	 */
	const settingsTypeCaches = new Map();

	/**
	 * Реквизиты по типу узла «Доступных полей» раздела «Настроек» (как в конфигураторе: Контрагент → Контрагент.ИНН):
	 * {children, pending} или null — узел по типу не раскрывается (папка, ресурс, системное и
	 * пользовательское поле; виды — как у конструктора настроек, WIZARD_TYPE_KINDS). Тот же расчёт, что у конструктора
	 * (typeAttributeLevel), с ограничением реквизитов раздела.
	 */
	function settingsTypeLevel(section, node) {
		if (!node || WIZARD_TYPE_KINDS.indexOf(node.kind) < 0) {
			return null;
		}
		const catalog = completionCatalog('settings:' + section);
		let cache = settingsTypeCaches.get(section);
		if (!cache || cache.catalog !== catalog || cache.stamp !== core.describeStamp) {
			const fieldIndex = cache && cache.model === core.model ? cache.fieldIndex : new Map();
			cache = { catalog: catalog, stamp: core.describeStamp, model: core.model, index: null, entries: new Map(), fieldIndex: fieldIndex };
			settingsTypeCaches.set(section, cache);
		}
		const key = wizardKey(node.path);
		const known = cache.entries.get(key);
		if (known) {
			return known;
		}
		let chain = node.typeChain || null;
		if (!chain) {
			// Узлы каталога от корня до поля — по префиксам пути: у каталога есть узел на каждый префикс
			if (!cache.index) {
				cache.index = wizardNodeIndex(catalog);
			}
			chain = [];
			let prefix = '';
			for (const segment of String(node.path).split('.')) {
				prefix = prefix ? prefix + '.' + segment : segment;
				const found = cache.index.get(wizardKey(prefix));
				if (!found) {
					chain = [];
					break;
				}
				chain.push(found);
			}
		}
		const entry = typeAttributeLevel(node, chain, 'settings:' + section, SETTINGS_ATTRIBUTE_FLAGS[section], cache.fieldIndex);
		cache.entries.set(key, entry);
		return entry;
	}

	/** Выбирается полем: поле набора, вычисляемое, ресурс, параметр данных, системное и пользовательское; не папка и не узел пути. */
	function settingsPickable(node) {
		return Boolean(node) && WIZARD_PICK_KINDS.indexOf(node.kind) >= 0;
	}

	const SETTINGS_PICK_NOTE = 'Выберите поле в «Доступных полях» (не папку).';
	const LIST_EMPTY_NOTE = 'Недоступно: список пуст.';
	const LIST_NO_ROW_NOTE = 'Недоступно: строка не выбрана.';
	/** Элементы управления в строке списка: их щелчки и клавиши — свои, а не строки. */
	const ROW_CONTROL_TAGS = ['INPUT', 'SELECT', 'OPTION', 'BUTTON', 'TEXTAREA'];

	/**
	 * Раскладка панелей «Выбранные поля», «Отбор» и «Сортировка»: слева дерево «Доступные поля» раздела
	 * (общий компонент fieldTree, тот же, что у «Ресурсов»), посередине «>», справа список панели (spec.list). «>», Enter и
	 * двойной щелчок по полю — spec.onAdd(узел); по папке — подсказка, что выбрать. Перенос мышью: поле из дерева
	 * тащат в список (settingsListDrop), строку списка, брошенную на дерево, удаляют — spec.onRemove(ключ строки), как
	 * пиктограмма «Удалить».
	 * spec: {id, title, addTitle, note(узел) — пометка строки дерева, onAdd(узел), onRemove(ключ строки),
	 * list(host, avail)} — avail: {zone — id зоны дерева, node(ключ) — выбираемый узел строки или null}.
	 */
	function settingsFieldsLayout(host, spec) {
		// Колонки — в документе до отрисовки списка: он ставит фокус на строку после удаления клавишей
		const layout = host.appendChild(el('div', 'dcs-setv-fields'));
		const left = layout.appendChild(el('div', 'dcs-setv-col'));
		left.appendChild(el('div', 'dcs-qd-col-head', 'Доступные поля'));
		let addBtn = null;
		const sync = (node) => {
			if (addBtn) {
				setTransferState(addBtn, spec.addTitle, !settingsPickable(node), settingsPickable(node) ? '' : SETTINGS_PICK_NOTE);
			}
		};
		const add = (node) => {
			if (!settingsPickable(node)) {
				settingsNotice(spec.title, SETTINGS_PICK_NOTE);
				return;
			}
			spec.onAdd(node);
		};
		const tree = fieldTree(left, {
			label: 'Доступные поля',
			nodes: settingsFieldNodes(spec.id),
			state: settingsAvailUi[spec.id],
			keyPrefix: 'setavail-' + spec.id,
			empty: 'Полей нет: здесь будут поля наборов, вычисляемые поля и ресурсы.',
			note: (node) => {
				const notes = [];
				if (node.kind === 'total') {
					notes.push('ресурс');
				}
				const own = settingsPickable(node) ? spec.note(node) : '';
				if (own) {
					notes.push(own);
				}
				return notes.join(', ');
			},
			pickable: settingsPickable,
			onActivate: add,
			onSelect: sync,
			// Реквизиты ссылочных полей по типу, как в конфигураторе: раскрытие читает описания объектов
			typeChildren: (node) => settingsTypeLevel(spec.id, node),
			requestTypes: (pending) => {
				core.settingsTypeWaiting = true;
				requestDescriptions(pending);
			},
			drag: {
				id: 'setavail:' + spec.id,
				scope: 'settings',
				from: { ['setlist:' + spec.id]: (payload) => spec.onRemove(payload.key) },
			},
		});
		const moves = transferButtons(layout, [{ label: '>', title: spec.addTitle, onClick: () => add(tree.selected()) }]);
		addBtn = keyed(moves.buttons[0], focusKey(['setmove', spec.id]));
		sync(tree.selected());
		const nodeOf = (key) => {
			const node = tree.nodeOf(key);
			return settingsPickable(node) ? node : null;
		};
		// Поле, брошенное на дерево структуры, узнаётся тем же деревом (structureDropZone)
		settingsAvailNodes.set('setavail:' + spec.id, nodeOf);
		spec.list(layout.appendChild(el('div', 'dcs-setv-col')), { zone: 'setavail:' + spec.id, node: nodeOf });
	}

	/**
	 * Перенос мышью в списке панели «Выбранные поля», «Отбор» или «Сортировка» — spec.drop у settingsListGrid. Поле
	 * из «Доступных полей» встаёт в место сброса тем же действием, что «>» (h.add с местом), строка списка переставляется,
	 * в том числе в папку или группу и из неё (h.move — та же правка списка целиком, что у ↑ ↓). Папка и группа (h.container)
	 * принимают сброс и «в строку» — последним в неё; остальные строки — до и после, а «после» папки с вложенными — первым в
	 * неё, там, где видна линия (listDropSlot). Брошенное на шапку или над первой строкой встаёт первым, под строками —
	 * последним на верхнем уровне. h: {add(узел, slot), move(адрес, slot), container?(элемент)}; slot — listDropSlot;
	 * items — дерево элементов списка; avail — от settingsFieldsLayout.
	 * Перенос в папку и из неё без мыши — пиктограммы «Вынести из папки» и «Перенести в папку выше» (та же h.move).
	 */
	function settingsListDrop(panelId, avail, items, h) {
		const posOf = (key) => (key === null || key === undefined ? null : JSON.parse(key));
		const slotOf = (target) => listDropSlot(items, posOf(target.key), target.place, h.container);
		return {
			kind: () => 'item',
			from: {
				[avail.zone]: (payload, target) => {
					const node = avail.node(payload.key);
					return node ? h.add(node, slotOf(target)) : false;
				},
				['setlist:' + panelId]: (payload, target) => h.move(posOf(payload.key), slotOf(target)),
			},
			place: (payload, key) => (key !== null && h.container && h.container(selItemAt(items, posOf(key))) ? 'both' : 'line'),
			effect: (payload) => (payload.zone === avail.zone ? 'copy' : 'move'),
		};
	}

	/** Ключ состояния списка панели: вариант, путь узла и панель. */
	function listStateKey(variantName, path, panelId) {
		return variantName + '\n' + pathKey(path) + '\n' + panelId;
	}

	function posKey(pos) {
		return JSON.stringify(pos);
	}

	/** Запомнить строку списка; после ответа правки выбрана она (номер — запасной, если адреса больше нет). */
	function rememberListRow(stateKey, pos, index) {
		if (!pos || pos.length === 0) {
			settingsListUi.delete(stateKey);
			return;
		}
		settingsListUi.set(stateKey, { key: posKey(pos), index: index === undefined ? Number.MAX_SAFE_INTEGER : index });
	}

	/**
	 * Снять выбор строки (Escape в списке, щелчок мимо строк, Ctrl+щелчок по выбранной): новый элемент встанет на верхний
	 * уровень. index — строка, которая остаётся остановкой Tab.
	 */
	function clearListRow(stateKey, index) {
		settingsListUi.set(stateKey, { key: '', index: index, none: true });
	}

	/**
	 * Номер выбранной строки среди видимых: по адресу, иначе по запомненному номеру (у края — последняя); без строк и со
	 * снятым выбором −1.
	 */
	function listSelection(stateKey, rows) {
		if (rows.length === 0) {
			return -1;
		}
		const saved = settingsListUi.get(stateKey);
		if (!saved) {
			return 0;
		}
		if (saved.none) {
			return -1;
		}
		const at = rows.findIndex((row) => posKey(row.pos) === saved.key);
		return at >= 0 ? at : Math.max(0, Math.min(saved.index, rows.length - 1));
	}

	/**
	 * Строки списка по дереву элементов: папки выбранных полей и группы отбора раскрыты всегда. {pos, depth, item, first,
	 * last, container — папка или группа с вложенными (у строки aria-expanded)}.
	 */
	function flattenItems(items, nested) {
		const out = [];
		const walk = (listItems, prefix, depth) => {
			listItems.forEach((item, index) => {
				const pos = prefix.concat([index]);
				const inner = nested(item) && Array.isArray(item.items) ? item.items : [];
				out.push({ pos: pos, depth: depth, item: item, first: index === 0, last: index === listItems.length - 1, container: inner.length > 0 });
				if (inner.length > 0) {
					walk(inner, pos, depth + 1);
				}
			});
		};
		walk(items, [], 0);
		return out;
	}

	/** Список, в котором лежит элемент по адресу pos, без правки исходного дерева. */
	function levelItems(items, pos) {
		let listRef = items;
		for (let i = 0; i < pos.length - 1; i++) {
			const owner = listRef[pos[i]];
			listRef = owner && Array.isArray(owner.items) ? owner.items : [];
		}
		return listRef;
	}

	/**
	 * Куда встаёт новый элемент: в выбранную папку (группу условий) последним, иначе — последним на уровне выбранной
	 * строки; без выбора (списка нет или выбор снят Escape) — в конец верхнего уровня. Результат — адрес владельца
	 * ([] — верхний уровень).
	 */
	function insertionParent(row, isContainer) {
		if (!row) {
			return [];
		}
		return isContainer(row.item) ? row.pos : row.pos.slice(0, -1);
	}

	/**
	 * Пояснение у команд добавления, когда новый элемент встанет не на верхний уровень: куда и как добавить на верхний.
	 * ownerName(элемент) — «папку «Суммы»», «группу «ИЛИ»».
	 */
	function insertionNote(row, isContainer, items, ownerName) {
		const parentPos = insertionParent(row, isContainer);
		if (parentPos.length === 0) {
			return '';
		}
		return 'Встанет в ' + ownerName(selItemAt(items, parentPos)) + '. Чтобы добавить на верхний уровень, нажмите Esc в списке.';
	}

	/** Строка, которая будет выбрана после удаления pos: следующая на месте удалённой, иначе предыдущая, иначе владелец. */
	function posAfterRemoval(items, pos) {
		const index = pos[pos.length - 1];
		if (index + 1 < levelItems(items, pos).length) {
			return pos;
		}
		if (index > 0) {
			return pos.slice(0, -1).concat([index - 1]);
		}
		return pos.slice(0, -1);
	}

	/** Слова команд уровня: папка выбранных полей и группа условий отбора. */
	const LEVEL_WORDS = Object.freeze({
		folder: Object.freeze({
			out: 'Вынести из папки',
			into: 'Перенести в папку выше',
			notInside: 'Недоступно: строка не в папке.',
			noOwner: 'Недоступно: над строкой на её уровне нет папки.',
		}),
		group: Object.freeze({
			out: 'Вынести из группы',
			into: 'Перенести в группу выше',
			notInside: 'Недоступно: строка не в группе.',
			noOwner: 'Недоступно: над строкой на её уровне нет группы.',
		}),
	});

	/**
	 * Пиктограммы уровня над списком с папками (группами): «Вынести из папки» — сразу за её строкой на уровень выше,
	 * «Перенести в папку выше» — последним в папку прямо над строкой. Тот же перенос (itemsMove → правка списка целиком),
	 * что сброс строки мышью: без них перенос в папку и из неё был бы только мышью (WCAG 2.5.7). move(строка, slot).
	 */
	function listLevelTools(items, container, words, noRow, move) {
		const outSlot = (row) => itemsOutdentSlot(items, row.pos);
		const intoSlot = (row) => itemsIndentSlot(items, row.pos, container);
		return [
			{ id: 'outdent', icon: 'outdent', name: words.out, state: (row) => (!row ? noRow() : outSlot(row) ? '' : words.notInside), run: (row) => move(row, outSlot(row)) },
			{ id: 'indent', icon: 'indent', name: words.into, state: (row) => (!row ? noRow() : intoSlot(row) ? '' : words.noOwner), run: (row) => move(row, intoSlot(row)) },
		];
	}

	/** Причина, по которой строку нельзя сдвинуть (пусто — можно). */
	function listMoveNote(row, delta, place) {
		if (!row) {
			return LIST_EMPTY_NOTE;
		}
		if (delta < 0 && row.first) {
			return 'Недоступно: строка уже первая' + (row.depth > 0 ? ' в ' + place : '') + '.';
		}
		if (delta > 0 && row.last) {
			return 'Недоступно: строка уже последняя' + (row.depth > 0 ? ' в ' + place : '') + '.';
		}
		return '';
	}

	/**
	 * Панель пиктограмм над списком панели узла. tools: [{id, icon, name, shortcut?, danger?, hint? — пояснение: строка или
	 * функция выбранной строки (куда встанет новый элемент), state?(строка) — причина недоступности или '', run(строка)}].
	 * Состояние пересчитывается при выборе строки без перерисовки (sync); недоступная команда остаётся в обходе Tab, щелчок
	 * по ней называет причину.
	 */
	function settingsListToolbar(host, panelId, tools) {
		const bar = el('div', 'dcs-list-toolbar');
		let selected = null;
		const hintOf = (tool, row) => (typeof tool.hint === 'function' ? tool.hint(row) : tool.hint || '');
		const buttons = tools.map((tool) => {
			const node = iconButton({
				icon: tool.icon,
				name: tool.name,
				shortcut: tool.shortcut,
				note: hintOf(tool, null),
				className: tool.danger ? 'ghost-btn dcs-btn-small dcs-btn-danger' : undefined,
				onClick: () => {
					const note = tool.state ? tool.state(selected) : '';
					if (note) {
						settingsNotice(tool.name, note);
						return;
					}
					tool.run(selected);
				},
			});
			bar.appendChild(keyed(node, focusKey(['nodetool', panelId, tool.id])));
			return node;
		});
		host.appendChild(bar);
		return {
			sync: (row) => {
				selected = row;
				tools.forEach((tool, index) => {
					const note = tool.state ? tool.state(row) : '';
					setIconState(buttons[index], tool.name, tool.shortcut, Boolean(note), note || hintOf(tool, row));
				});
			},
		};
	}

	/**
	 * Список панели узла — сетка с одной остановкой Tab, как таблица ресурсов: строка выбирается щелчком и стрелками
	 * (↑ ↓ Home End), Enter и двойной щелчок — окно строки, пробел — флажок «Использовать», Delete — удаление. Флажок,
	 * выпадающий список и кнопка строки — в обходе Tab только у выбранной строки. Выбор не перерисовывает список, панель
	 * пиктограмм узнаёт о нём через onSelect. Папки и группы — строки с отступом (treegrid, aria-level), раскрыты всегда.
	 * Выбор снимается Escape, щелчком мимо строк и Ctrl+щелчком по выбранной (onSelect(null)): тогда новый элемент встаёт
	 * на верхний уровень, а остановкой Tab остаётся строка, на которой был фокус. В дереве (treegrid) у папки и группы с
	 * вложенными aria-expanded, ← ведёт к владельцу, → — к первому вложенному. Имя строки для читалки — rowLabel(row) и
	 * «не используется» у снятого флажка: иначе она прочла бы ячейки подряд (имя поля дважды), а флажок — без состояния.
	 * spec: {id, label, tree, headers, rows, stateKey, cells(tr, row, controls), rowLabel(row), useLabel(row),
	 * onUse(row, checked) → отправлено ли, editable(row), onEdit(row), onDelete(row, fromGrid), onSelect(row), empty,
	 * drop? — перенос мышью (settingsListDrop): зона — колонка списка host целиком, строку тащат за ячейку имени (в строке
	 * флажок, список и кнопка), строка, которую тащили, выбирается, как щелчком}.
	 * Возвращает {selected(), pick(ключ строки) — выбрать строку, как щелчком}.
	 */
	function settingsListGrid(host, spec) {
		if (spec.rows.length === 0) {
			emptyNote(host, spec.empty);
			if (spec.drop) {
				// Пустой список — тоже зона: поле из «Доступных полей» встаёт первым
				tableDropZone(host, { id: 'setlist:' + spec.id, scope: 'settings', head: null, keys: null, from: spec.drop.from, place: spec.drop.place, effect: spec.drop.effect });
			}
			if (core.focusListPanel === spec.stateKey) {
				// Удалена последняя строка: фокус — на «Удалить», она есть всегда (без строк — недоступна с причиной)
				core.focusListPanel = '';
				focusKeyed(focusKey(['nodetool', spec.id, 'delete']));
			}
			return { selected: () => null, pick: () => {} };
		}
		const wrap = el('div', 'dcs-table-wrap dcs-setv-scroll');
		const table = el('table', 'dcs-table dcs-setv-grid');
		table.setAttribute('role', spec.tree ? 'treegrid' : 'grid');
		table.setAttribute('aria-label', spec.label);
		const thead = document.createElement('thead');
		const head = document.createElement('tr');
		head.setAttribute('role', 'row');
		spec.headers.forEach((title, index) => {
			const th = el('th', index === 0 ? 'dcs-cell-check' : '', title);
			th.setAttribute('role', 'columnheader');
			if (index === 0) {
				th.setAttribute('aria-label', 'Использовать');
			} else if (!title) {
				th.setAttribute('aria-label', 'Команды строки');
			}
			head.appendChild(th);
		});
		thead.appendChild(head);
		table.appendChild(thead);
		const tbody = document.createElement('tbody');
		const trs = [];
		const controls = [];
		// Строка → её адрес (posKey): ключ переноса мышью
		const dragKeys = new WeakMap();
		let current = listSelection(spec.stateKey, spec.rows);
		// Остановка Tab: выбранная строка, а без выбора — строка, на которой его сняли
		const saved = settingsListUi.get(spec.stateKey);
		let stop = current >= 0 ? current : Math.max(0, Math.min(saved && typeof saved.index === 'number' ? saved.index : 0, spec.rows.length - 1));
		const paint = () => {
			trs.forEach((tr, at) => {
				const on = at === current;
				tr.classList.toggle('dcs-tree-selected', on);
				tr.setAttribute('aria-selected', String(on));
				tr.tabIndex = at === stop ? 0 : -1;
				for (const control of controls[at]) {
					control.tabIndex = on ? 0 : -1;
				}
			});
		};
		const setStop = (index, focus) => {
			current = index;
			stop = index;
			rememberListRow(spec.stateKey, spec.rows[index].pos, index);
			paint();
			if (focus) {
				focusGridRow(trs[index]);
			}
			spec.onSelect(spec.rows[index]);
		};
		const clearSelection = (index) => {
			if (current < 0) {
				return;
			}
			current = -1;
			stop = index;
			clearListRow(spec.stateKey, index);
			paint();
			spec.onSelect(null);
		};
		spec.rows.forEach((row, index) => {
			const tr = document.createElement('tr');
			tr.setAttribute('role', 'row');
			if (spec.tree) {
				tr.setAttribute('aria-level', String(row.depth + 1));
				if (row.container) {
					// Папки и группы раскрыты всегда: читалка слышит, что у строки есть вложенные
					tr.setAttribute('aria-expanded', 'true');
				}
			}
			tr.setAttribute('aria-label', spec.rowLabel(row) + (row.item.use === false ? ', не используется' : ''));
			if (row.item.use === false) {
				tr.className = 'dcs-row-off';
			}
			const rowKey = posKey(row.pos);
			keyed(tr, focusKey(['setrow', spec.id, rowKey]));
			const own = [];
			const checkTd = el('td', 'dcs-cell-check');
			checkTd.setAttribute('role', 'gridcell');
			const box = el('input', 'edit-check');
			box.type = 'checkbox';
			box.checked = row.item.use !== false;
			box.setAttribute('aria-label', 'Использовать: ' + spec.useLabel(row));
			keyed(box, focusKey(['setuse', spec.id, rowKey]));
			box.addEventListener('change', () => {
				if (!spec.onUse(row, box.checked)) {
					box.checked = !box.checked;
				}
			});
			checkTd.appendChild(box);
			tr.appendChild(checkTd);
			own.push(box);
			spec.cells(tr, row, own);
			if (spec.editable(row)) {
				actionsCell(tr, [
					{ svg: 'edit', title: 'Править', key: focusKey(['setedit', spec.id, rowKey]), onClick: () => spec.onEdit(row) },
				]);
				own.push(tr.children[tr.children.length - 1].children[0]);
			} else {
				cell(tr, '', 'dcs-cell-actions');
			}
			// Перенос мышью — за ячейку имени: строке только атрибут у ячейки и ключ в WeakMap, слушатели — у документа
			if (spec.drop) {
				dragKeys.set(tr, rowKey);
				if (spec.drop.kind(row) && tr.children[1]) {
					tr.children[1].draggable = true;
				}
			}
			for (const td of tr.children) {
				td.setAttribute('role', 'gridcell');
			}
			tr.addEventListener('click', (event) => {
				if (event.target === tr || event.target.tagName === 'TD') {
					// Ctrl+щелчок по выбранной строке снимает выбор, как в списках Windows
					if ((event.ctrlKey || event.metaKey) && current === index) {
						clearSelection(index);
					} else {
						setStop(index, false);
					}
				}
			});
			// Фокус в флажок или кнопку строки пришёл щелчком: остановка Tab переезжает в эту строку. Фокус на самой строке
			// при снятом выборе (Tab, возврат фокуса после перерисовки) выбор не возвращает
			tr.addEventListener('focusin', (event) => {
				if (current !== index && !(current < 0 && event.target === tr)) {
					setStop(index, false);
				}
			});
			tr.addEventListener('dblclick', (event) => {
				// Двойной щелчок по флажку, направлению или кнопке строки — их собственное действие, не окно строки
				if (ROW_CONTROL_TAGS.indexOf(event.target.tagName) >= 0) {
					return;
				}
				if (spec.editable(row)) {
					spec.onEdit(row);
				}
			});
			tr.addEventListener('keydown', (event) => {
				if (event.target !== tr || event.defaultPrevented) {
					return;
				}
				let to = -1;
				if (event.key === 'ArrowDown') {
					to = Math.min(spec.rows.length - 1, index + 1);
				} else if (event.key === 'ArrowUp') {
					to = Math.max(0, index - 1);
				} else if (event.key === 'Home') {
					to = 0;
				} else if (event.key === 'End') {
					to = spec.rows.length - 1;
				} else if (event.key === 'ArrowLeft' && spec.tree && row.depth > 0) {
					// К владельцу: папке или группе, в которой лежит строка
					const owner = posKey(row.pos.slice(0, -1));
					to = spec.rows.findIndex((candidate) => posKey(candidate.pos) === owner);
				} else if (event.key === 'ArrowRight' && spec.tree && row.container) {
					to = index + 1;
				} else if (event.key === 'Escape') {
					// Без выбора Escape не наш: его разбирают окна выше
					if (current < 0) {
						return;
					}
					event.preventDefault();
					clearSelection(index);
					return;
				} else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Delete') {
					event.preventDefault();
					// Выбор снят: клавиша действует на строку с фокусом и выбирает её, панель пиктограмм — за ней
					if (current !== index) {
						setStop(index, false);
					}
					if (event.key === 'Enter') {
						if (spec.editable(row)) {
							spec.onEdit(row);
						}
					} else if (event.key === ' ') {
						box.checked = !box.checked;
						if (!spec.onUse(row, box.checked)) {
							box.checked = !box.checked;
						}
					} else {
						spec.onDelete(row, true);
					}
					return;
				} else {
					return;
				}
				if (to < 0) {
					return;
				}
				event.preventDefault();
				setStop(to, true);
			});
			trs.push(tr);
			controls.push(own);
			tbody.appendChild(tr);
		});
		table.appendChild(tbody);
		wrap.appendChild(table);
		if (spec.drop) {
			const rowAt = (key) => spec.rows.findIndex((row) => posKey(row.pos) === key);
			tableDropZone(host, {
				id: 'setlist:' + spec.id,
				scope: 'settings',
				head: head,
				rows: () => trs,
				keys: dragKeys,
				drag: (key) => {
					const at = rowAt(key);
					return at >= 0 ? spec.drop.kind(spec.rows[at]) : '';
				},
				pick: (key) => {
					const at = rowAt(key);
					if (at >= 0) {
						setStop(at, false);
					}
				},
				from: spec.drop.from,
				place: spec.drop.place,
				effect: spec.drop.effect,
			});
		}
		// Щелчок по пустому месту под строками снимает выбор: следующий элемент встанет на верхний уровень
		wrap.addEventListener('click', (event) => {
			if (event.target === wrap || event.target === table || event.target === tbody) {
				clearSelection(stop);
			}
		});
		host.appendChild(wrap);
		if (current >= 0) {
			setStop(current, false);
		} else {
			paint();
			spec.onSelect(null);
		}
		if (core.focusListPanel === spec.stateKey) {
			core.focusListPanel = '';
			focusGridRow(trs[stop]);
		}
		return {
			selected: () => spec.rows[current] || null,
			// Строка по адресу (posKey) становится выбранной, как щелчком: до удаления сбросом на «Доступные поля»
			pick: (key) => {
				const at = spec.rows.findIndex((row) => posKey(row.pos) === key);
				if (at >= 0) {
					setStop(at, false);
				}
			},
		};
	}

	/**
	 * Фокус на строку сетки под закреплённой шапкой: строка не должна оказаться под ней (у .dcs-setv-scroll отступ
	 * прокрутки сверху — высота шапки, scrollIntoView его учитывает).
	 */
	function focusGridRow(tr) {
		tr.focus();
		if (typeof tr.scrollIntoView === 'function') {
			tr.scrollIntoView({ block: 'nearest' });
		}
	}

	/** Правка списка панели одним сообщением; занятость показывается в строке состояния. */
	function sendPanelItems(type, variantName, path, items) {
		if (!items) {
			return false;
		}
		if (!send(type, { variant: variantName, payload: { path: path, items: items } })) {
			setStatus(BUSY, true);
			return false;
		}
		return true;
	}

	/** Копия списка с переставленным элементом; за границей — null (кнопки гаснут раньше). */
	function movedCopy(items, index, delta) {
		const target = index + delta;
		if (target < 0 || target >= items.length) {
			return null;
		}
		const next = items.slice();
		const moved = next.splice(index, 1)[0];
		next.splice(target, 0, moved);
		return next;
	}

	// ---------- панель «Поля группировки» ----------

	function boundarySummary(value) {
		if (!value) {
			return '';
		}
		if (value.nil) {
			return 'Неопределено';
		}
		const raw = value.decoded !== undefined ? String(value.decoded) : value.text || '';
		if (value.type === 'xs:dateTime') {
			return raw === DCS_ZERO_DATE ? '' : raw.replace('T', ' ');
		}
		if (value.type === 'dcscor:Field') {
			return raw;
		}
		return (value.type || 'значение') + ' (в конфигураторе)';
	}

	/**
	 * Редактор границы дополнения периода: не задано, дата, поле компоновки или «Неопределено».
	 * Нетронутое значение возвращается исходным объектом, значение незнакомого типа не правится.
	 */
	function boundaryEditor(body, labelText, original) {
		let mode = '';
		let initialText = '';
		if (original) {
			const raw = original.decoded !== undefined ? String(original.decoded) : original.text || '';
			if (original.nil) {
				mode = 'nil';
			} else if (original.type === 'xs:dateTime') {
				mode = raw === DCS_ZERO_DATE || raw === '' ? '' : 'date';
				initialText = mode === 'date' ? raw : '';
			} else if (original.type === 'dcscor:Field') {
				mode = 'field';
				initialText = raw;
			} else {
				mode = 'ro';
			}
		}
		if (mode === 'ro') {
			formRow(body, labelText, el('span', 'dcs-ro-note', 'Тип «' + (original.type || '?') + '» правится в конфигураторе.'));
			return {
				validate: () => undefined,
				value: () => original,
			};
		}
		const initialMode = mode;
		const modeSelect = selectInput(
			[
				{ value: '', label: 'Не задано' },
				{ value: 'date', label: 'Дата' },
				{ value: 'field', label: 'Поле компоновки' },
				{ value: 'nil', label: 'Неопределено' },
			],
			mode
		);
		const dateInput = el('input', 'edit-input');
		dateInput.type = 'datetime-local';
		dateInput.step = '1';
		if (mode === 'date') {
			dateInput.value = initialText.slice(0, 19);
		}
		const fieldInput = textInput(mode === 'field' ? initialText : '');
		setHint(fieldInput, 'Граница-поле видна пользователю, если параметр включён в доступные поля.');
		const wrap = el('div', 'dcs-bound');
		wrap.appendChild(modeSelect);
		wrap.appendChild(dateInput);
		// Пара «поле + ⋯» в одну строку: колонка .dcs-bound иначе унесла бы кнопку под поле
		const fieldPair = el('div', 'dcs-complete-pair');
		fieldPair.appendChild(fieldInput);
		wrap.appendChild(fieldPair);
		formRow(body, labelText, wrap);
		attachFieldList(fieldInput);
		function refresh() {
			dateInput.classList.toggle('hidden', modeSelect.value !== 'date');
			fieldInput.classList.toggle('hidden', modeSelect.value !== 'field');
			fieldPair.classList.toggle('hidden', modeSelect.value !== 'field');
		}
		modeSelect.addEventListener('change', refresh);
		refresh();
		function dateLexical() {
			let value = dateInput.value;
			if (value.length === 16) {
				value += ':00';
			}
			return value;
		}
		function unchanged() {
			if (modeSelect.value !== initialMode) {
				return false;
			}
			if (initialMode === 'date') {
				return dateLexical() === initialText;
			}
			if (initialMode === 'field') {
				return fieldInput.value.trim() === initialText;
			}
			return true;
		}
		return {
			validate: () => {
				if (modeSelect.value === 'date' && !dateInput.value) {
					return 'укажите дату';
				}
				if (modeSelect.value === 'field' && !fieldInput.value.trim()) {
					return 'укажите поле';
				}
				return undefined;
			},
			value: () => {
				if (unchanged()) {
					return original;
				}
				if (modeSelect.value === 'date') {
					return { type: 'xs:dateTime', decoded: dateLexical() };
				}
				if (modeSelect.value === 'field') {
					return { type: 'dcscor:Field', decoded: fieldInput.value.trim() };
				}
				if (modeSelect.value === 'nil') {
					return { nil: true };
				}
				return undefined;
			},
		};
	}

	function renderGroupFieldsPanel(host, node, path, variantName) {
		const items = Array.isArray(node.groupFields) ? node.groupFields : [];
		listToolbar(host, [
			{
				icon: 'add',
				name: 'Добавить поле…',
				key: focusKey(['nodetool', 'groupFields', 'add']),
				onClick: () => {
					openGroupFieldDialog(variantName, path, items, null, -1);
				},
			},
		]);
		if (items.length === 0) {
			host.appendChild(el('div', 'dcs-plate', 'Полей группировки нет: группировка выводит детальные записи.'));
		} else {
			const tbody = dataTable(host, ['Поле', 'Тип группировки', 'Дополнение периода', 'Начало', 'Конец', '']);
			const dragKeys = new WeakMap();
			const trs = [];
			const thead = tbody.parentElement.children[0];
			// Перенос мышью: поле переставляется за ячейку имени той же правкой, что «Выше» и «Ниже» (копия списка со
			// сдвигом на любое число строк). Зона — таблица целиком, шапка ставит первым
			tableDropZone(tbody.parentElement.parentElement, {
				id: 'setgrpf',
				scope: 'settings',
				head: thead && thead.tagName === 'THEAD' ? thead.children[0] : null,
				rows: () => trs,
				keys: dragKeys,
				drag: () => 'field',
				from: {
					setgrpf: (payload, target) => {
						const from = Number(payload.key);
						const to = dropIndex(items.length, from, target.key === null ? -1 : Number(target.key), target.place);
						if (to === from) {
							return false;
						}
						const moved = movedCopy(items, from, to - from);
						if (sendPanelItems('dcs/set-group-fields', variantName, path, moved)) {
							// Ячейку имени фокус не берёт: после ответа он — на «Править» переставленного поля (ключ — по полю)
							const name = moved[to].field || '<Авто>';
							const nth = moved.slice(0, to + 1).filter((item) => (item.field || '<Авто>') === name).length;
							replyFocus.fallback = focusKey(['grpf', 'edit', name, String(nth)]);
						}
						return undefined;
					},
				},
			});
			// Ключи фокуса: «Править», «Выше» и «Ниже» — по полю (фокус идёт за переставленной строкой), «Удалить» — по
			// номеру (фокус встаёт на ту же кнопку у строки, занявшей место удалённой)
			const seen = {};
			const deleteKey = (at) => focusKey(['grpf', 'delete', String(at)]);
			items.forEach((item, index) => {
				const name = item.field || '<Авто>';
				seen[name] = (seen[name] || 0) + 1;
				const own = (action) => focusKey(['grpf', action, name, String(seen[name])]);
				const firstNote = index === 0 ? 'Недоступно: поле уже первое.' : '';
				const lastNote = index === items.length - 1 ? 'Недоступно: поле уже последнее.' : '';
				const tr = document.createElement('tr');
				// Ручка переноса — ячейка имени: у строки только атрибут, слушатели — у документа
				cell(tr, name).draggable = true;
				dragKeys.set(tr, String(index));
				trs.push(tr);
				cell(tr, groupTypeLabel(item.groupType));
				cell(tr, periodAdditionLabel(item.periodAdditionType));
				cell(tr, boundarySummary(item.periodAdditionBegin));
				cell(tr, boundarySummary(item.periodAdditionEnd));
				actionsCell(tr, [
					{
						svg: 'edit',
						title: 'Править',
						key: own('edit'),
						onClick: () => {
							openGroupFieldDialog(variantName, path, items, item, index);
						},
					},
					{
						svg: 'up',
						title: 'Выше',
						key: own('up'),
						// У края — недоступна, но в обходе Tab: фокус, переехавший сюда со строкой, не пропадает
						unavailable: Boolean(firstNote),
						note: firstNote,
						onClick: () => {
							if (firstNote) {
								settingsNotice('Выше', firstNote);
							} else {
								sendPanelItems('dcs/set-group-fields', variantName, path, movedCopy(items, index, -1));
							}
						},
					},
					{
						svg: 'down',
						title: 'Ниже',
						key: own('down'),
						unavailable: Boolean(lastNote),
						note: lastNote,
						onClick: () => {
							if (lastNote) {
								settingsNotice('Ниже', lastNote);
							} else {
								sendPanelItems('dcs/set-group-fields', variantName, path, movedCopy(items, index, 1));
							}
						},
					},
					{
						svg: 'delete',
						title: 'Удалить',
						danger: true,
						key: deleteKey(index),
						onClick: () => {
							const next = items.slice();
							next.splice(index, 1);
							if (sendPanelItems('dcs/set-group-fields', variantName, path, next)) {
								rowRemovalFocus(deleteKey, index, focusKey(['nodetool', 'groupFields', 'add']));
							}
						},
					},
				]);
				tbody.appendChild(tr);
			});
		}
	}

	function openGroupFieldDialog(variantName, path, items, original, index) {
		const item = original || {};
		let fieldInput;
		let typeSelect;
		let periodSelect;
		let beginEditor;
		let endEditor;
		openDialog(
			original ? 'Поле группировки «' + (item.field || '') + '»' : 'Новое поле группировки',
			original ? 'Сохранить' : 'Добавить',
			(body) => {
				fieldInput = formRow(body, 'Поле', textInput(item.field));
				attachFieldList(fieldInput, 'group');
				typeSelect = formRow(body, 'Тип группировки', selectInput(GROUP_TYPE_OPTIONS, item.groupType || 'Items'));
				periodSelect = formRow(
					body,
					'Дополнение периода',
					selectInput(periodAdditionOptions(), item.periodAdditionType || 'None')
				);
				beginEditor = boundaryEditor(body, 'Начало дополнения', item.periodAdditionBegin);
				endEditor = boundaryEditor(body, 'Конец дополнения', item.periodAdditionEnd);
			},
			() => {
				const field = fieldInput.value.trim();
				if (!field) {
					return 'Укажите поле.';
				}
				const beginError = beginEditor.validate();
				if (beginError) {
					return 'Начало дополнения: ' + beginError + '.';
				}
				const endError = endEditor.validate();
				if (endError) {
					return 'Конец дополнения: ' + endError + '.';
				}
				const value = { field: field, groupType: typeSelect.value, periodAdditionType: periodSelect.value };
				const begin = beginEditor.value();
				if (begin !== undefined) {
					value.periodAdditionBegin = begin;
				}
				const end = endEditor.value();
				if (end !== undefined) {
					value.periodAdditionEnd = end;
				}
				const next = items.slice();
				if (original) {
					next[index] = value;
				} else {
					next.push(value);
				}
				if (!send('dcs/set-group-fields', { variant: variantName, payload: { path: path, items: next } })) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	// ---------- панель «Выбранные поля» ----------

	function selItemAt(items, pos) {
		let listRef = items;
		for (let i = 0; i < pos.length - 1; i++) {
			listRef = listRef[pos[i]].items;
		}
		return listRef[pos[pos.length - 1]];
	}

	/** Список, в котором лежит элемент по адресу pos; у папки без вложений список создаётся. */
	function selListAt(items, pos) {
		let listRef = items;
		for (let i = 0; i < pos.length - 1; i++) {
			const owner = listRef[pos[i]];
			if (!Array.isArray(owner.items)) {
				owner.items = [];
			}
			listRef = owner.items;
		}
		return listRef;
	}

	function countSelItems(items) {
		let count = 0;
		for (const item of items) {
			count += 1 + (Array.isArray(item.items) ? countSelItems(item.items) : 0);
		}
		return count;
	}

	function selItemName(item) {
		if (item.kind === 'auto') {
			return '<Авто>';
		}
		if (item.kind === 'folder') {
			return 'Папка';
		}
		return item.field || '';
	}

	/** Пути полей списка элементов (с папками) без учёта регистра — пометка «выбрано» в «Доступных полях». */
	function takenFieldKeys(items, fieldOf) {
		const keys = new Set();
		const walk = (listItems) => {
			for (const item of listItems) {
				const field = fieldOf(item);
				if (field) {
					keys.add(fieldTreeKey(field));
				}
				if (Array.isArray(item.items)) {
					walk(item.items);
				}
			}
		};
		walk(items);
		return keys;
	}

	const SEL_AUTO_HINT = 'Состав элемента «Авто» наследуется от родителя.';

	/** Имя строки «Выбранных полей» для читалки: поле и заголовок, папка — заголовком и расположением. */
	function selRowLabel(item) {
		if (item.kind === 'folder') {
			return 'Папка' + (item.title ? ' «' + item.title + '»' : '') + ', расположение: ' + placementLabel(item.placement || 'Auto').toLowerCase();
		}
		if (item.kind === 'auto') {
			return 'Авто';
		}
		return (item.field || '') + (item.title ? ', заголовок «' + item.title + '»' : '');
	}

	/**
	 * «Выбранные поля» как в конфигураторе: слева «Доступные поля», посередине «>», справа список с
	 * флажками, «<Авто>» и папками, над ним пиктограммы: добавить поле (окно), «Авто», папка, удалить, выше, ниже, вынести
	 * из папки, в папку выше. Новый элемент встаёт в выбранную папку, иначе — последним на уровне выбранной строки, и после
	 * ответа выбран он.
	 */
	function renderSelectionPanel(host, node, path, variantName) {
		const items = sectionItems(node.selection);
		const stateKey = listStateKey(variantName, path, 'selection');
		const sendItems = (next) => sendPanelItems('dcs/set-selection', variantName, path, next);
		const isFolder = (item) => item.kind === 'folder';
		const taken = takenFieldKeys(items, (item) => (item.kind === 'field' ? item.field : ''));
		let grid = null;
		// Новый элемент в место slot (itemsDropSlot): «>», «Авто» и сброс поля мышью — одна правка; после ответа выбран он
		const addAt = (slot, fresh) => {
			const made = itemsInsert(items, slot, fresh);
			if (sendItems(made.items)) {
				rememberListRow(stateKey, made.pos);
			}
		};
		const addItem = (row, fresh) => {
			const parentPos = insertionParent(row, isFolder);
			addAt(itemsDropSlot(items, parentPos, 'into'), fresh);
		};
		// Перенос строки, в том числе в папку и из неё: копия списка с перенесённой строкой, выбор — за ней. Мышью (toList)
		// фокус после ответа — на строке, пиктограммами «Вынести из папки» и «В папку выше» — остаётся на кнопке, как у ↑ ↓
		const moveAt = (from, slot, toList) => {
			const made = slot ? itemsMove(items, from, slot) : null;
			if (!made) {
				return false;
			}
			if (sendItems(made.items)) {
				rememberListRow(stateKey, made.pos);
				if (toList) {
					replyFocus.list = stateKey;
				}
			}
			return undefined;
		};
		const edit = (row) => {
			if (row.item.kind === 'folder') {
				openSelFolderDialog(variantName, path, items, row.item, row.pos, null);
			} else if (row.item.kind === 'field') {
				openSelFieldDialog(variantName, path, items, row.item, row.pos, null);
			}
		};
		const remove = (row, fromGrid) => {
			const after = posAfterRemoval(items, row.pos);
			removeSelItem(items, row.item, row.pos, sendItems, () => {
				rememberListRow(stateKey, after);
				if (fromGrid) {
					replyFocus.list = stateKey;
				}
			});
		};
		settingsFieldsLayout(host, {
			id: 'selection',
			title: 'Выбранные поля',
			addTitle: 'Добавить выбранное поле',
			note: (field) => (taken.has(fieldTreeKey(field.path)) ? 'выбрано' : ''),
			onAdd: (field) => addItem(grid.selected(), { kind: 'field', field: field.path }),
			// Строка, брошенная на «Доступные поля», удаляется, как клавишей Delete в списке: сначала она выбрана (папка с
			// вложенными — с вопросом; после отмены выбрана она, и пиктограммы действуют на неё)
			onRemove: (key) => {
				const pos = JSON.parse(key);
				grid.pick(key);
				remove({ pos: pos, item: selItemAt(items, pos) }, true);
			},
			list: (right, avail) => {
				const folderOf = (row) => {
					const parentPos = insertionParent(row, isFolder);
					return parentPos.length > 0 ? parentPos : null;
				};
				const noRow = () => (items.length > 0 ? LIST_NO_ROW_NOTE : LIST_EMPTY_NOTE);
				const where = (row) => insertionNote(row, isFolder, items, (folder) => 'папку' + (folder.title ? ' «' + folder.title + '»' : ''));
				const toolbar = settingsListToolbar(right, 'selection', [
					{ id: 'add', icon: 'add', name: 'Добавить поле…', hint: where, run: (row) => openSelFieldDialog(variantName, path, items, null, null, folderOf(row)) },
					{ id: 'auto', icon: 'auto', name: 'Добавить «Авто»', hint: (row) => [SEL_AUTO_HINT, where(row)].filter(Boolean).join(' '), run: (row) => addItem(row, { kind: 'auto' }) },
					{ id: 'folder', icon: 'folder', name: 'Добавить папку…', hint: where, run: (row) => openSelFolderDialog(variantName, path, items, null, null, folderOf(row)) },
					{ id: 'delete', icon: 'delete', name: 'Удалить', shortcut: 'Delete', danger: true, state: (row) => (row ? '' : noRow()), run: (row) => remove(row, false) },
					{ id: 'up', icon: 'up', name: 'Переместить выше', state: (row) => (row ? listMoveNote(row, -1, 'папке') : noRow()), run: (row) => moveSelRow(row, -1) },
					{ id: 'down', icon: 'down', name: 'Переместить ниже', state: (row) => (row ? listMoveNote(row, 1, 'папке') : noRow()), run: (row) => moveSelRow(row, 1) },
					...listLevelTools(items, isFolder, LEVEL_WORDS.folder, noRow, (row, slot) => moveAt(row.pos, slot, false)),
				]);
				const moveSelRow = (row, delta) => {
					if (moveSelItem(items, row.pos, delta, sendItems)) {
						rememberListRow(stateKey, row.pos.slice(0, -1).concat([row.pos[row.pos.length - 1] + delta]));
					}
				};
				grid = settingsListGrid(right, {
					id: 'selection',
					label: 'Выбранные поля',
					tree: true,
					headers: ['', 'Поле / элемент', 'Заголовок', 'Расположение', ''],
					rows: flattenItems(items, isFolder),
					stateKey: stateKey,
					cells: (tr, row) => {
						const item = row.item;
						const nameTd = cell(tr, selItemName(item));
						nameTd.style.paddingLeft = 8 + row.depth * 18 + 'px';
						if (item.kind === 'auto') {
							nameTd.title = 'Состав наследуется от родителя';
						}
						cell(tr, item.title || '');
						cell(tr, item.kind === 'folder' ? placementLabel(item.placement || 'Auto') : '');
					},
					rowLabel: (row) => selRowLabel(row.item),
					useLabel: (row) => (row.item.kind === 'folder' && row.item.title ? 'Папка «' + row.item.title + '»' : selItemName(row.item)),
					onUse: (row, checked) => {
						const next = cloneItems(items);
						const ref = selItemAt(next, row.pos);
						if (checked) {
							delete ref.use;
						} else {
							ref.use = false;
						}
						return sendItems(next);
					},
					editable: (row) => row.item.kind === 'field' || row.item.kind === 'folder',
					onEdit: edit,
					onDelete: remove,
					onSelect: (row) => toolbar.sync(row),
					empty: 'Выбранных полей нет: выберите поле в «Доступных полях» и нажмите «>».',
					drop: settingsListDrop('selection', avail, items, {
						add: (field, slot) => addAt(slot, { kind: 'field', field: field.path }),
						move: (from, slot) => moveAt(from, slot, true),
						container: isFolder,
					}),
				});
				toolbar.sync(grid.selected());
			},
		});
	}

	/** Сдвиг элемента в пределах его уровня; true — правка ушла. */
	function moveSelItem(original, pos, delta, sendItems) {
		const next = cloneItems(original);
		const listRef = selListAt(next, pos);
		const index = pos[pos.length - 1];
		const target = index + delta;
		if (target < 0 || target >= listRef.length) {
			return false;
		}
		const moved = listRef.splice(index, 1)[0];
		listRef.splice(target, 0, moved);
		return Boolean(sendItems(next));
	}

	/** Удаление элемента (папки с вложенными — после подтверждения); onSent — когда правка ушла. */
	function removeSelItem(original, item, pos, sendItems, onSent) {
		function apply() {
			const next = cloneItems(original);
			const listRef = selListAt(next, pos);
			listRef.splice(pos[pos.length - 1], 1);
			if (!sendItems(next)) {
				return BUSY;
			}
			if (onSent) {
				onSent();
			}
			return undefined;
		}
		const nested = item.kind === 'folder' && Array.isArray(item.items) ? countSelItems(item.items) : 0;
		if (nested > 0) {
			confirmRemove(
				'Удалить папку' + (item.title ? ' «' + item.title + '»' : '') + '? Вместе с ней удалятся вложенные элементы: ' + nested + '.',
				apply
			);
			return;
		}
		apply();
	}

	function openSelFieldDialog(variantName, path, original, item, pos, folderPos) {
		const current = item || {};
		let fieldInput;
		let titleInput;
		let useBox;
		openDialog(
			item ? 'Выбранное поле «' + (current.field || '') + '»' : 'Новое выбранное поле',
			item ? 'Сохранить' : 'Добавить',
			(body) => {
				fieldInput = formRow(body, 'Поле', textInput(current.field));
				attachFieldList(fieldInput, 'selection');
				titleInput = formRow(body, 'Заголовок', textInput(current.title));
				useBox = checkbox('Использовать', current.use !== false);
				checkRow(body, [useBox]);
			},
			() => {
				const field = fieldInput.value.trim();
				if (!field) {
					return 'Укажите поле.';
				}
				const title = titleInput.value.trim();
				const next = cloneItems(original);
				if (item) {
					const ref = selItemAt(next, pos);
					ref.field = field;
					if (title) {
						ref.title = title;
					} else {
						delete ref.title;
						delete ref.titleKind;
					}
					if (useBox.input.checked) {
						delete ref.use;
					} else {
						ref.use = false;
					}
				}
				let freshPos = null;
				if (!item) {
					const fresh = { kind: 'field', field: field };
					if (title) {
						fresh.title = title;
					}
					if (!useBox.input.checked) {
						fresh.use = false;
					}
					const folder = folderPos ? selItemAt(next, folderPos) : null;
					if (folder) {
						if (!Array.isArray(folder.items)) {
							folder.items = [];
						}
						folder.items.push(fresh);
						freshPos = folderPos.concat([folder.items.length - 1]);
					} else {
						next.push(fresh);
						freshPos = [next.length - 1];
					}
				}
				if (!send('dcs/set-selection', { variant: variantName, payload: { path: path, items: next } })) {
					return BUSY;
				}
				if (freshPos) {
					// После ответа в списке выбран новый элемент
					rememberListRow(listStateKey(variantName, path, 'selection'), freshPos);
				}
				return undefined;
			}
		);
	}

	/** Окно папки выбранных полей: правка по адресу pos или новая папка — в папку folderPos (null — на верхний уровень). */
	function openSelFolderDialog(variantName, path, original, item, pos, folderPos) {
		const current = item || {};
		let titleInput;
		let placementSelect;
		let useBox;
		openDialog(
			item ? 'Папка выбранных полей' : 'Новая папка выбранных полей',
			item ? 'Сохранить' : 'Добавить',
			(body) => {
				titleInput = formRow(body, 'Заголовок', textInput(current.title));
				placementSelect = formRow(body, 'Расположение', selectInput(PLACEMENT_OPTIONS, current.placement || 'Auto'));
				useBox = checkbox('Использовать', current.use !== false);
				checkRow(body, [useBox]);
			},
			() => {
				const title = titleInput.value.trim();
				const next = cloneItems(original);
				let ref;
				let freshPos = null;
				if (item) {
					ref = selItemAt(next, pos);
				} else {
					ref = { kind: 'folder' };
					const owner = folderPos ? selItemAt(next, folderPos) : null;
					if (owner) {
						if (!Array.isArray(owner.items)) {
							owner.items = [];
						}
						owner.items.push(ref);
						freshPos = folderPos.concat([owner.items.length - 1]);
					} else {
						next.push(ref);
						freshPos = [next.length - 1];
					}
				}
				if (title) {
					ref.title = title;
				} else {
					delete ref.title;
					delete ref.titleKind;
				}
				if (placementSelect.value === 'Auto') {
					delete ref.placement;
				} else {
					ref.placement = placementSelect.value;
				}
				if (useBox.input.checked) {
					delete ref.use;
				} else {
					ref.use = false;
				}
				if (!send('dcs/set-selection', { variant: variantName, payload: { path: path, items: next } })) {
					return BUSY;
				}
				if (freshPos) {
					rememberListRow(listStateKey(variantName, path, 'selection'), freshPos);
				}
				return undefined;
			}
		);
	}

	// ---------- панель «Сортировка» ----------

	/** Нередактируемые признаки элемента сортировки — серой пометкой, как пришли. */
	function orderItemExtras(item) {
		const parts = [];
		if (item.autoOrder) {
			parts.push('авто-упорядочивание');
		}
		if (item.distinctNullValues) {
			parts.push('различать NULL');
		}
		if (item.viewMode) {
			parts.push('режим: ' + item.viewMode);
		}
		return parts.join('; ');
	}

	/** Имя строки «Сортировки» для читалки: поле, направление и нередактируемые признаки. */
	function orderRowLabel(item) {
		if (item.kind === 'auto') {
			return 'Авто';
		}
		const direction = ORDER_TYPE_OPTIONS.find((option) => option.value === (item.orderType === 'Desc' ? 'Desc' : 'Asc'));
		const extras = orderItemExtras(item);
		return (item.field || '') + ', ' + direction.label.toLowerCase() + (extras ? ', ' + extras : '');
	}

	/**
	 * «Сортировка» как в конфигураторе: слева «Доступные поля», посередине «>», справа список с флажками и
	 * направлением в строке, над ним пиктограммы: добавить поле (окно), «Авто», удалить, выше, ниже. «>» добавляет поле
	 * по возрастанию последним.
	 */
	function renderOrderPanel(host, node, path, variantName) {
		const items = sectionItems(node.order);
		const stateKey = listStateKey(variantName, path, 'order');
		const sendItems = (next) => sendPanelItems('dcs/set-order', variantName, path, next);
		const taken = takenFieldKeys(items, (item) => (item.kind === 'field' ? item.field : ''));
		let grid = null;
		// Новый элемент в место slot: «>» и «Авто» — последним, сброс поля мышью — в место сброса; после ответа выбран он
		const insertAt = (slot, fresh) => {
			const made = itemsInsert(items, slot, fresh);
			if (sendItems(made.items)) {
				rememberListRow(stateKey, made.pos);
			}
		};
		const append = (fresh) => insertAt(itemsDropSlot(items, null, 'end'), fresh);
		const move = (row, delta) => {
			const index = row.pos[0];
			if (sendItems(movedCopy(items, index, delta))) {
				rememberListRow(stateKey, [index + delta]);
			}
		};
		// Перестановка мышью — та же копия списка с перенесённой строкой, что у ↑ ↓ (сдвиг на любое число строк); фокус и
		// выбор — за строкой
		const moveAt = (from, slot) => {
			const made = itemsMove(items, from, slot);
			if (!made) {
				return false;
			}
			if (sendItems(movedCopy(items, from[0], made.pos[0] - from[0]))) {
				rememberListRow(stateKey, made.pos);
				replyFocus.list = stateKey;
			}
			return undefined;
		};
		const remove = (row, fromGrid) => {
			const next = items.slice();
			next.splice(row.pos[0], 1);
			if (sendItems(next)) {
				rememberListRow(stateKey, posAfterRemoval(items, row.pos));
				if (fromGrid) {
					replyFocus.list = stateKey;
				}
			}
		};
		settingsFieldsLayout(host, {
			id: 'order',
			title: 'Сортировка',
			addTitle: 'Добавить поле в сортировку',
			note: (field) => (taken.has(fieldTreeKey(field.path)) ? 'в сортировке' : ''),
			onAdd: (field) => append({ kind: 'field', field: field.path, orderType: 'Asc' }),
			// Как клавиша Delete: строка сначала выбрана
			onRemove: (key) => {
				const pos = JSON.parse(key);
				grid.pick(key);
				remove({ pos: pos, item: items[pos[0]] }, true);
			},
			list: (right, avail) => {
				const noRow = () => (items.length > 0 ? LIST_NO_ROW_NOTE : LIST_EMPTY_NOTE);
				const toolbar = settingsListToolbar(right, 'order', [
					{ id: 'add', icon: 'add', name: 'Добавить поле…', run: () => openOrderFieldDialog(variantName, path, items, null, -1) },
					{ id: 'auto', icon: 'auto', name: 'Добавить «Авто»', run: () => append({ kind: 'auto' }) },
					{ id: 'delete', icon: 'delete', name: 'Удалить', shortcut: 'Delete', danger: true, state: (row) => (row ? '' : noRow()), run: (row) => remove(row, false) },
					{ id: 'up', icon: 'up', name: 'Переместить выше', state: (row) => (row ? listMoveNote(row, -1, '') : noRow()), run: (row) => move(row, -1) },
					{ id: 'down', icon: 'down', name: 'Переместить ниже', state: (row) => (row ? listMoveNote(row, 1, '') : noRow()), run: (row) => move(row, 1) },
				]);
				grid = settingsListGrid(right, {
					id: 'order',
					label: 'Сортировка',
					tree: false,
					headers: ['', 'Поле', 'Направление', ''],
					rows: flattenItems(items, () => false),
					stateKey: stateKey,
					cells: (tr, row, controls) => {
						const item = row.item;
						const index = row.pos[0];
						const nameTd = cell(tr, item.kind === 'auto' ? '<Авто>' : item.field || '');
						const extras = orderItemExtras(item);
						if (extras) {
							nameTd.appendChild(el('span', 'dcs-ro-note', ' (' + extras + ')'));
						}
						const dirTd = el('td');
						if (item.kind === 'field') {
							const direction = item.orderType === 'Desc' ? 'Desc' : 'Asc';
							const dirSelect = selectInput(ORDER_TYPE_OPTIONS, direction);
							dirSelect.classList.add('dcs-row-select');
							dirSelect.setAttribute('aria-label', 'Направление: ' + (item.field || ''));
							keyed(dirSelect, focusKey(['setdir', 'order', posKey(row.pos)]));
							dirSelect.addEventListener('change', () => {
								const next = cloneItems(items);
								next[index].orderType = dirSelect.value;
								if (!sendItems(next)) {
									dirSelect.value = direction;
								}
							});
							dirTd.appendChild(dirSelect);
							controls.push(dirSelect);
						}
						tr.appendChild(dirTd);
					},
					rowLabel: (row) => orderRowLabel(row.item),
					useLabel: (row) => (row.item.kind === 'auto' ? '<Авто>' : row.item.field || ''),
					onUse: (row, checked) => {
						const next = cloneItems(items);
						if (checked) {
							delete next[row.pos[0]].use;
						} else {
							next[row.pos[0]].use = false;
						}
						return sendItems(next);
					},
					editable: (row) => row.item.kind === 'field',
					onEdit: (row) => openOrderFieldDialog(variantName, path, items, row.item, row.pos[0]),
					onDelete: remove,
					onSelect: (row) => toolbar.sync(row),
					empty: 'Порядок не задан: выберите поле в «Доступных полях» и нажмите «>».',
					drop: settingsListDrop('order', avail, items, {
						add: (field, slot) => insertAt(slot, { kind: 'field', field: field.path, orderType: 'Asc' }),
						move: moveAt,
					}),
				});
				toolbar.sync(grid.selected());
			},
		});
	}

	function openOrderFieldDialog(variantName, path, items, original, index) {
		const item = original || {};
		let fieldInput;
		let dirSelect;
		openDialog(
			original ? 'Поле сортировки «' + (item.field || '') + '»' : 'Новое поле сортировки',
			original ? 'Сохранить' : 'Добавить',
			(body) => {
				fieldInput = formRow(body, 'Поле', textInput(item.field));
				attachFieldList(fieldInput, 'order');
				dirSelect = formRow(body, 'Направление', selectInput(ORDER_TYPE_OPTIONS, item.orderType === 'Desc' ? 'Desc' : 'Asc'));
			},
			() => {
				const field = fieldInput.value.trim();
				if (!field) {
					return 'Укажите поле.';
				}
				const next = cloneItems(items);
				if (original) {
					next[index].field = field;
					next[index].orderType = dirSelect.value;
				} else {
					next.push({ kind: 'field', field: field, orderType: dirSelect.value });
				}
				if (!send('dcs/set-order', { variant: variantName, payload: { path: path, items: next } })) {
					return BUSY;
				}
				if (!original) {
					rememberListRow(listStateKey(variantName, path, 'order'), [next.length - 1]);
				}
				return undefined;
			}
		);
	}

	// ---------- словари значений настроек ----------

	/** Виды сравнения отбора: 20 лексем DataCompositionComparisonType из XSD настроек. */
	const COMPARISON_LABELS = {
		Equal: 'Равно',
		NotEqual: 'Не равно',
		Less: 'Меньше',
		LessOrEqual: 'Меньше или равно',
		Greater: 'Больше',
		GreaterOrEqual: 'Больше или равно',
		Contains: 'Содержит',
		InList: 'В списке',
		InListByHierarchy: 'В списке по иерархии',
		InHierarchy: 'В иерархии',
		NotContains: 'Не содержит',
		NotInList: 'Не в списке',
		NotInListByHierarchy: 'Не в списке по иерархии',
		NotInHierarchy: 'Не в иерархии',
		Filled: 'Заполнено',
		NotFilled: 'Не заполнено',
		BeginsWith: 'Начинается с',
		NotBeginsWith: 'Не начинается с',
		Like: 'Подобно',
		NotLike: 'Не подобно',
	};

	/** Виды сравнения без значения. */
	const NO_VALUE_COMPARISONS = ['Filled', 'NotFilled'];

	/** Виды сравнения со списком значений. */
	const LIST_COMPARISONS = ['InList', 'InListByHierarchy', 'NotInList', 'NotInListByHierarchy'];

	/** Типы групп отбора DataCompositionFilterItemsGroupType; отсутствие в файле — И. */
	const FILTER_GROUP_OPTIONS = [
		{ value: 'AndGroup', label: 'И' },
		{ value: 'OrGroup', label: 'ИЛИ' },
		{ value: 'NotGroup', label: 'НЕ' },
	];

	/** Применение отбора DataCompositionFilterApplicationType; пусто — по умолчанию платформы. */
	const APPLICATION_OPTIONS = [
		{ value: '', label: 'По умолчанию' },
		{ value: 'Items', label: 'Элементы' },
		{ value: 'Hierarchy', label: 'Иерархия' },
		{ value: 'HierarchyOnly', label: 'Только иерархия' },
	];

	/** Режимы пользовательской настройки DataCompositionSettingsItemViewMode. */
	const VIEW_MODE_LABELS = {
		Normal: 'обычный',
		QuickAccess: 'быстрый доступ',
		Inaccessible: 'недоступный',
		Auto: 'авто',
	};

	function comparisonLabel(value) {
		return COMPARISON_LABELS[value] || value || '';
	}

	function comparisonOptions() {
		return Object.keys(COMPARISON_LABELS).map((value) => ({ value: value, label: COMPARISON_LABELS[value] }));
	}

	function viewModeLabel(value) {
		return VIEW_MODE_LABELS[value] || value || '';
	}

	function periodVariantOptions() {
		return Object.keys(STANDARD_PERIOD_LABELS).map((value) => ({ value: value, label: STANDARD_PERIOD_LABELS[value] }));
	}

	// ---------- сводки значений ----------

	/** Сводка массива значений (right, value): повторы перечисляются через запятую. */
	function valuesSummary(values) {
		if (!Array.isArray(values) || values.length === 0) {
			return '';
		}
		return values.map(valueSummary).join(', ');
	}

	/** Значение правится, когда оно одно (или его нет) и тип знаком редактору. */
	function editableValues(values) {
		if (!Array.isArray(values) || values.length === 0) {
			return true;
		}
		return values.length === 1 && valueModeOf(values[0]) !== 'ro';
	}

	/** Бейдж пользовательской настройки: режим и представление показываются, но не правятся. */
	function userSettingBadge(item) {
		if (!item.userSettingID && !item.viewMode && !item.userSettingPresentation) {
			return null;
		}
		const badge = el('span', 'dcs-us-badge', 'ПН');
		const parts = [];
		if (item.viewMode) {
			parts.push('режим: ' + viewModeLabel(item.viewMode));
		}
		if (item.userSettingPresentation) {
			parts.push('представление: ' + item.userSettingPresentation);
		}
		badge.title = 'Пользовательская настройка' + (parts.length > 0 ? ' (' + parts.join('; ') + ')' : '') + '. Здесь не редактируется.';
		return badge;
	}

	// ---------- общий редактор значения по типу ----------

	/** Контрол редактора по типу значения; ro — редактора нет, значение правится в конфигураторе. */
	function valueModeOf(value) {
		if (!value) {
			return '';
		}
		if (value.nil) {
			return 'nil';
		}
		if (value.opaque || value.attrs || value.beginningDate) {
			return 'ro';
		}
		if (value.list || value.type === 'v8:ValueListType') {
			return 'list';
		}
		if (value.period || value.type === 'v8:StandardPeriod') {
			return 'period';
		}
		if (value.type === 'xs:string') {
			return 'string';
		}
		if (value.type === 'v8:LocalStringType') {
			return 'lstring';
		}
		if (value.type === 'xs:boolean') {
			return 'boolean';
		}
		if (value.type === 'xs:decimal') {
			return 'number';
		}
		if (value.type === 'xs:dateTime') {
			return 'date';
		}
		if (value.type === 'dcscor:Field') {
			return 'field';
		}
		if (value.type === 'v8ui:Color') {
			return 'color';
		}
		return 'ro';
	}

	/** Режимы редактора значения; выбор вручную — когда тип значения неизвестен. */
	const VALUE_MODE_OPTIONS = [
		{ value: '', label: 'Не задано' },
		{ value: 'string', label: 'Строка' },
		{ value: 'number', label: 'Число' },
		{ value: 'boolean', label: 'Булево' },
		{ value: 'date', label: 'Дата' },
		{ value: 'period', label: 'Стандартный период' },
		{ value: 'field', label: 'Поле компоновки' },
		{ value: 'color', label: 'Цвет' },
		{ value: 'list', label: 'Список значений' },
		{ value: 'nil', label: 'Неопределено' },
	];

	/** Режимы простых значений: из них состоят строки списка значений. */
	const SIMPLE_VALUE_MODES = ['string', 'number', 'boolean', 'date', 'field', 'nil'];

	function dateTimeInput(initial) {
		const input = el('input', 'edit-input');
		input.type = 'datetime-local';
		input.step = '1';
		if (initial && initial !== DCS_ZERO_DATE) {
			input.value = initial.slice(0, 19);
		}
		return input;
	}

	function dateLexicalOf(input) {
		let value = input.value;
		if (value.length === 16) {
			value += ':00';
		}
		return value;
	}

	/**
	 * Общий редактор значения по типу: контрол выбирается по xsi:type существующего
	 * значения, пустое начинается с подсказанного режима или выбора типа вручную.
	 *
	 * result(): undefined — значение не менялось (нетронутое уходит назад как пришло),
	 * null — значение очищено, объект — новое значение. opts: typeHint — режим пустого значения
	 * (вместе с отсутствием значения он же включает «новое всегда собирается»), fixedMode — тип
	 * не переключается, simpleModes — только простые типы, attachFields(input) — подсказки полей,
	 * textButton(input) — кнопка у строкового поля (окно форматной строки у «Формат»): она правит
	 * только текст поля, тип значения остаётся тем, что выбран в контроле.
	 * Значение незнакомого типа не редактируется: вместо контрола — причина.
	 */
	function createValueControl(original, opts) {
		const options = opts || {};
		const initialMode = original ? valueModeOf(original) : options.typeHint || '';
		if (initialMode === 'ro') {
			const note = el('span', 'dcs-ro-note', 'Тип «' + (original.type || '?') + '» правится в конфигураторе.');
			return {
				root: note,
				readOnly: true,
				mode: () => 'ro',
				setMode: () => undefined,
				validate: () => undefined,
				result: () => undefined,
			};
		}
		const root = el('div', 'dcs-value-edit');
		const initialRaw = original && !original.nil ? valueRaw(original) : '';

		const modeOptions = [];
		for (const option of VALUE_MODE_OPTIONS) {
			if (options.simpleModes && SIMPLE_VALUE_MODES.indexOf(option.value) < 0) {
				continue;
			}
			modeOptions.push(option);
			if (option.value === 'string' && initialMode === 'lstring') {
				modeOptions.push({ value: 'lstring', label: 'Строка (локализуемая)' });
			}
		}
		const modeSelect = selectInput(modeOptions, initialMode);
		if (options.fixedMode) {
			modeSelect.classList.add('hidden');
		}
		root.appendChild(modeSelect);

		const textCtl = textInput(initialMode === 'string' || initialMode === 'lstring' ? initialRaw : '');
		// Поле с кнопкой — пара в одну строку (как «поле + ⋯»); прячется вместе с полем при смене типа
		const textBox = options.textButton ? el('div', 'dcs-complete-pair dcs-value-text-pair') : textCtl;
		if (options.textButton) {
			textBox.appendChild(textCtl);
			textBox.appendChild(options.textButton(textCtl));
		}
		root.appendChild(textBox);

		const numberCtl = el('input', 'edit-input dcs-input-number');
		numberCtl.type = 'number';
		if (initialMode === 'number') {
			numberCtl.value = initialRaw;
		}
		root.appendChild(numberCtl);

		const boolCtl = selectInput(
			[
				{ value: 'true', label: 'Истина' },
				{ value: 'false', label: 'Ложь' },
			],
			initialMode === 'boolean' && initialRaw === 'true' ? 'true' : 'false'
		);
		root.appendChild(boolCtl);

		const dateWrap = el('div', 'dcs-date-edit');
		const dateCtl = dateTimeInput(initialMode === 'date' ? initialRaw : '');
		const dateClear = el('button', 'ghost-btn dcs-btn-small', 'Очистить');
		dateClear.type = 'button';
		dateClear.title = 'Пустая дата платформы';
		dateClear.addEventListener('click', () => {
			dateCtl.value = '';
		});
		dateWrap.appendChild(dateCtl);
		dateWrap.appendChild(dateClear);
		root.appendChild(dateWrap);

		const fieldCtl = textInput(initialMode === 'field' ? initialRaw : '');
		// Пара «поле + ⋯» в одну строку: колонка редактора значения иначе унесла бы кнопку под поле.
		// Подсказка подключается, когда поле уже в паре, — кнопка встаёт рядом с ним
		const fieldPair = el('div', 'dcs-complete-pair');
		fieldPair.appendChild(fieldCtl);
		root.appendChild(fieldPair);
		if (options.attachFields) {
			options.attachFields(fieldCtl);
		}

		const initialPeriod = original && original.period ? original.period : null;
		const periodWrap = el('div', 'dcs-period-edit');
		const periodSelect = selectInput(periodVariantOptions(), initialPeriod ? initialPeriod.variant : 'Custom');
		const periodDates = el('div', 'dcs-period-dates');
		const periodStart = dateTimeInput(initialPeriod ? initialPeriod.startDate || '' : '');
		const periodEnd = dateTimeInput(initialPeriod ? initialPeriod.endDate || '' : '');
		periodDates.appendChild(periodStart);
		periodDates.appendChild(periodEnd);
		periodWrap.appendChild(periodSelect);
		periodWrap.appendChild(periodDates);
		root.appendChild(periodWrap);
		function refreshPeriod() {
			periodDates.classList.toggle('hidden', periodSelect.value !== 'Custom');
		}
		periodSelect.addEventListener('change', refreshPeriod);

		const colorWrap = el('div', 'dcs-color-edit');
		const colorInitial = initialMode === 'color' ? initialRaw : '';
		let colorKind = 'auto';
		if (/^#[0-9A-Fa-f]{6}$/.test(colorInitial)) {
			colorKind = 'hex';
		} else if (colorInitial && colorInitial !== 'auto') {
			colorKind = 'link';
		}
		const colorKindSelect = selectInput(
			[
				{ value: 'auto', label: 'Авто' },
				{ value: 'hex', label: 'Цвет' },
				{ value: 'link', label: 'Ссылка на стиль' },
			],
			colorKind
		);
		const colorPick = el('input', 'dcs-color-pick');
		colorPick.type = 'color';
		if (colorKind === 'hex') {
			colorPick.value = colorInitial;
		}
		const colorLink = textInput(colorKind === 'link' ? colorInitial : '');
		colorLink.placeholder = 'style:… / web:… / win:…';
		colorWrap.appendChild(colorKindSelect);
		colorWrap.appendChild(colorPick);
		colorWrap.appendChild(colorLink);
		root.appendChild(colorWrap);
		function refreshColor() {
			colorPick.classList.toggle('hidden', colorKindSelect.value !== 'hex');
			colorLink.classList.toggle('hidden', colorKindSelect.value !== 'link');
		}
		colorKindSelect.addEventListener('change', refreshColor);
		refreshColor();
		function colorLexical() {
			if (colorKindSelect.value === 'auto') {
				return 'auto';
			}
			if (colorKindSelect.value === 'hex') {
				return colorPick.value.toUpperCase();
			}
			return colorLink.value.trim();
		}

		// Список значений: строки «значение + представление», нетронутые уходят исходными объектами
		const listHost = el('div', 'dcs-list-edit');
		const listRows = [];
		let listStructureChanged = false;
		function addListRow(item) {
			const row = { original: item || null, removed: false };
			const rowEl = el('div', 'dcs-list-row');
			const rowMode = item ? valueModeOf(item.value) : 'string';
			if (item && (rowMode === 'ro' || rowMode === 'list' || rowMode === 'period')) {
				row.readOnly = true;
				rowEl.appendChild(el('span', 'dcs-ro-note', (valueSummary(item.value) || 'значение') + ': правится в конфигураторе'));
				if (item.presentation) {
					rowEl.appendChild(el('span', 'dcs-ro-note', item.presentation));
				}
			} else {
				row.control = createValueControl(item ? item.value : undefined, {
					typeHint: 'string',
					simpleModes: true,
					attachFields: options.attachFields,
				});
				rowEl.appendChild(row.control.root);
				row.presentation = textInput(item && item.presentation ? item.presentation : '');
				row.presentation.placeholder = 'представление';
				rowEl.appendChild(row.presentation);
				const removeBtn = iconButton({
					icon: 'delete',
					name: 'Убрать значение',
					className: 'struct-btn struct-btn-danger',
					onClick: () => {
						row.removed = true;
						listStructureChanged = true;
						// Кнопка с фокусом уходит вместе со строкой: фокус — на «Убрать» следующей строки, иначе предыдущей,
						// иначе на «Добавить значение»
						const at = listRows.indexOf(row);
						const live = listRows.filter((other) => !other.removed && other.removeBtn);
						const neighbour = live.find((other) => listRows.indexOf(other) > at) || live.filter((other) => listRows.indexOf(other) < at).pop();
						rowEl.remove();
						(neighbour ? neighbour.removeBtn : listAdd).focus();
					},
				});
				row.removeBtn = removeBtn;
				rowEl.appendChild(removeBtn);
			}
			listRows.push(row);
			listHost.appendChild(rowEl);
		}
		const initialList = original && original.list && Array.isArray(original.list.items) ? original.list.items : [];
		for (const item of initialList) {
			addListRow(item);
		}
		const listAdd = iconButton({
			icon: 'add',
			name: 'Добавить значение',
			className: 'struct-btn',
			onClick: () => {
				listStructureChanged = true;
				addListRow(null);
			},
		});
		root.appendChild(listHost);
		root.appendChild(listAdd);
		function listChanged() {
			if (listStructureChanged) {
				return true;
			}
			return listRows.some(
				(row) =>
					!row.removed &&
					row.control &&
					(row.control.result() !== undefined ||
						row.presentation.value.trim() !== ((row.original && row.original.presentation) || ''))
			);
		}
		function listValue() {
			const items = [];
			for (const row of listRows) {
				if (row.removed) {
					continue;
				}
				if (row.readOnly || !row.control) {
					items.push(row.original);
					continue;
				}
				const value = row.control.result();
				const presentation = row.presentation.value.trim();
				if (row.original && value === undefined && presentation === (row.original.presentation || '')) {
					items.push(row.original);
					continue;
				}
				const entry = {};
				const effective = value === undefined || value === null ? row.original && row.original.value : value;
				if (effective) {
					entry.value = effective;
				}
				if (presentation) {
					entry.presentation = presentation;
				}
				items.push(entry);
			}
			return { type: 'v8:ValueListType', list: { items: items } };
		}

		const nilNote = el('span', 'dcs-ro-note', 'Неопределено');
		root.appendChild(nilNote);

		function currentMode() {
			return options.fixedMode ? initialMode : modeSelect.value;
		}
		function refreshMode() {
			const mode = currentMode();
			textCtl.classList.toggle('hidden', mode !== 'string' && mode !== 'lstring');
			if (textBox !== textCtl) {
				textBox.classList.toggle('hidden', mode !== 'string' && mode !== 'lstring');
			}
			numberCtl.classList.toggle('hidden', mode !== 'number');
			boolCtl.classList.toggle('hidden', mode !== 'boolean');
			dateWrap.classList.toggle('hidden', mode !== 'date');
			fieldCtl.classList.toggle('hidden', mode !== 'field');
			fieldPair.classList.toggle('hidden', mode !== 'field');
			periodWrap.classList.toggle('hidden', mode !== 'period');
			colorWrap.classList.toggle('hidden', mode !== 'color');
			listHost.classList.toggle('hidden', mode !== 'list');
			listAdd.classList.toggle('hidden', mode !== 'list');
			nilNote.classList.toggle('hidden', mode !== 'nil');
			refreshPeriod();
		}
		modeSelect.addEventListener('change', refreshMode);
		refreshMode();

		function normDate(raw) {
			return raw && raw !== DCS_ZERO_DATE ? raw.slice(0, 19) : '';
		}
		function unchanged(mode) {
			if (mode !== initialMode) {
				return false;
			}
			if (mode === '' || mode === 'nil') {
				return true;
			}
			if (mode === 'string' || mode === 'lstring') {
				return textCtl.value === initialRaw;
			}
			if (mode === 'number') {
				return numberCtl.value.trim() === initialRaw;
			}
			if (mode === 'boolean') {
				return boolCtl.value === (initialRaw === 'true' ? 'true' : 'false');
			}
			if (mode === 'date') {
				return dateLexicalOf(dateCtl) === normDate(initialRaw);
			}
			if (mode === 'field') {
				return fieldCtl.value.trim() === initialRaw;
			}
			if (mode === 'color') {
				return colorLexical().toLowerCase() === initialRaw.toLowerCase();
			}
			if (mode === 'period') {
				if (!initialPeriod || periodSelect.value !== initialPeriod.variant) {
					return false;
				}
				if (periodSelect.value !== 'Custom') {
					return true;
				}
				return (
					dateLexicalOf(periodStart) === normDate(initialPeriod.startDate) &&
					dateLexicalOf(periodEnd) === normDate(initialPeriod.endDate)
				);
			}
			if (mode === 'list') {
				return !listChanged();
			}
			return true;
		}
		function build(mode) {
			if (mode === 'nil') {
				return { nil: true };
			}
			if (mode === 'string') {
				return { type: 'xs:string', decoded: textCtl.value };
			}
			if (mode === 'lstring') {
				return { type: 'v8:LocalStringType', decoded: textCtl.value };
			}
			if (mode === 'number') {
				return { type: 'xs:decimal', decoded: Number(numberCtl.value) };
			}
			if (mode === 'boolean') {
				return { type: 'xs:boolean', decoded: boolCtl.value === 'true' };
			}
			if (mode === 'date') {
				return { type: 'xs:dateTime', decoded: dateLexicalOf(dateCtl) || DCS_ZERO_DATE };
			}
			if (mode === 'field') {
				return { type: 'dcscor:Field', decoded: fieldCtl.value.trim() };
			}
			if (mode === 'color') {
				return { type: 'v8ui:Color', decoded: colorLexical() };
			}
			if (mode === 'period') {
				const period = { variant: periodSelect.value };
				if (period.variant === 'Custom') {
					period.startDate = dateLexicalOf(periodStart) || DCS_ZERO_DATE;
					period.endDate = dateLexicalOf(periodEnd) || DCS_ZERO_DATE;
				}
				return { type: 'v8:StandardPeriod', period: period };
			}
			if (mode === 'list') {
				return listValue();
			}
			// режим «не задано» — значение очищено
			return null;
		}
		return {
			root: root,
			readOnly: false,
			mode: currentMode,
			setMode: function (mode) {
				if (!options.fixedMode) {
					modeSelect.value = mode;
					refreshMode();
				}
			},
			validate: function () {
				const mode = currentMode();
				if (mode === 'number' && (numberCtl.value.trim() === '' || !Number.isFinite(Number(numberCtl.value)))) {
					return 'укажите число';
				}
				if (mode === 'field' && fieldCtl.value.trim() === '') {
					return 'укажите поле';
				}
				if (mode === 'color' && colorKindSelect.value === 'link' && colorLink.value.trim() === '') {
					return 'укажите ссылку на цвет';
				}
				if (mode === 'list') {
					for (const row of listRows) {
						if (row.removed || !row.control) {
							continue;
						}
						const error = row.control.validate();
						if (error) {
							return error;
						}
					}
				}
				return undefined;
			},
			result: function () {
				const mode = currentMode();
				// Пустое значение с подсказанным типом собирается всегда (строка нового списка)
				if (original || !options.typeHint) {
					if (unchanged(mode)) {
						return undefined;
					}
				} else if (mode === '') {
					return null;
				}
				return build(mode);
			},
		};
	}

	// ---------- панель «Отбор» ----------

	function filterGroupTypeLabel(value) {
		return optionLabel(FILTER_GROUP_OPTIONS, value || 'AndGroup', 'И');
	}

	/** Сводка элемента отбора: условие одной строкой, группа — типом и числом вложенных. */
	function filterItemSummary(item) {
		if (item.kind === 'group') {
			const size = Array.isArray(item.items) ? item.items.length : 0;
			return filterGroupTypeLabel(item.groupType) + ' (' + size + ')';
		}
		let text = (item.left || '') + ' ' + comparisonLabel(item.comparisonType || 'Equal').toLowerCase();
		const value = valuesSummary(item.right);
		if (value) {
			text += ' ' + value;
		}
		return text;
	}

	/** Сводка отбора целиком: элементы через точку с запятой; пусто — отбора нет. */
	function filterSummary(items) {
		return (Array.isArray(items) ? items : []).map(filterItemSummary).join('; ');
	}

	/**
	 * Таблица дерева отбора мини-редактора условия оформления (у панели «Отбор» — сетка settingsListGrid).
	 * ctx: items — текущий список, commit(next) — применить (false — занято), edit(pos) и add(kind, parentPos) — открыть
	 * инлайн-форму элемента, inline — правка локальной копии (подтверждение удаления не требуется), emptyText — плашка.
	 * Команды над таблицей и в строках — пиктограммы с подсказкой. Перенос мышью: строку тащат за
	 * ячейку имени (в строке флажок и кнопки), она встаёт в место сброса той же правкой копии, что ↑ ↓ (ctx.commit), в
	 * группу (серединой её строки) и из неё; с клавиатуры то же делают кнопки строки «Вынести из группы» и «Перенести в
	 * группу выше». Зона — колонка целиком: панель и шапка ставят первым, место под строками — последним. Пока открыта
	 * инлайн-форма (ctx.formOpen), строку не тащат: перерисовка убрала бы форму с набранным. Элементы управления помечены
	 * data-mini-key (miniKey): после перерисовки мини-редактор возвращает фокус на тот же элемент строки, за строкой.
	 * ctx.commit(next, focus) — focus {pos, action}: где ждать фокус после правки (новый адрес строки и действие).
	 */
	function renderFilterTable(host, ctx) {
		const zoneId = 'cafilter:' + ++filterTableSeq;
		const bar = el('div', 'dcs-list-toolbar');
		for (const adder of [
			{ icon: 'add', name: 'Добавить условие…', kind: 'comparison' },
			{ icon: 'folder', name: 'Добавить группу условий…', kind: 'group' },
		]) {
			const button = iconButton({
				icon: adder.icon,
				name: adder.name,
				onClick: () => {
					ctx.add(adder.kind, null);
				},
			});
			button.setAttribute('data-mini-key', miniKey(null, 'add-' + adder.kind));
			bar.appendChild(button);
		}
		host.appendChild(bar);
		const isGroup = (item) => item.kind === 'group';
		const drag = { trs: [], keys: new WeakMap() };
		let head = null;
		if (ctx.items.length === 0) {
			host.appendChild(el('div', 'dcs-plate', ctx.emptyText));
		} else {
			const tbody = dataTable(host, ['', 'Поле / группа', 'Вид сравнения', 'Значение', 'Представление', '']);
			head = tbody.parentElement.children[0].children[0];
			appendFilterRows(tbody, ctx, ctx.items, [], 0, drag);
		}
		const posOf = (key) => (key === null || key === undefined ? null : JSON.parse(key));
		tableDropZone(host, {
			id: zoneId,
			scope: 'settings',
			head: head,
			rows: () => drag.trs,
			keys: drag.keys,
			drag: () => (ctx.formOpen() ? '' : 'item'),
			from: {
				[zoneId]: (payload, spot) => {
					const made = itemsMove(ctx.items, posOf(payload.key), listDropSlot(ctx.items, posOf(spot.key), spot.place, isGroup));
					if (!made) {
						return false;
					}
					ctx.commit(made.items, { pos: made.pos, action: 'edit' });
					return undefined;
				},
			},
			place: (payload, key) => {
				const item = key === null ? null : itemAtPos(ctx.items, posOf(key));
				return item && isGroup(item) ? 'both' : 'line';
			},
		});
	}

	/** Номер таблицы отбора мини-редактора: у каждой своя зона переноса — строки не уходят в таблицу другого окна. */
	let filterTableSeq = 0;

	/** Ключ элемента мини-редактора условия (data-mini-key): адрес строки (у команд над таблицей — пусто) и действие. */
	function miniKey(pos, action) {
		return (pos && pos.length > 0 ? posKey(pos) : '') + '|' + action;
	}

	const MINI_FIRST_NOTE = 'Недоступно: условие уже первое на своём уровне.';
	const MINI_LAST_NOTE = 'Недоступно: условие уже последнее на своём уровне.';

	/** Строки дерева отбора мини-редактора; drag — {trs, keys}: строки по порядку и строка → адрес (posKey) для переноса. */
	function appendFilterRows(tbody, ctx, listItems, posPrefix, depth, drag) {
		listItems.forEach((item, index) => {
			const pos = posPrefix.concat([index]);
			const tr = document.createElement('tr');
			drag.trs.push(tr);
			drag.keys.set(tr, posKey(pos));
			if (item.use === false) {
				tr.className = 'dcs-row-off';
			}
			const checkTd = el('td', 'dcs-cell-check');
			const box = el('input', 'edit-check');
			box.type = 'checkbox';
			box.checked = item.use !== false;
			// У колонки флажков нет заголовка: имя флажка — условие строки
			box.setAttribute('aria-label', 'Использовать: ' + filterRowLabel(item));
			box.setAttribute('data-mini-key', miniKey(pos, 'use'));
			box.addEventListener('change', () => {
				const next = cloneItems(ctx.items);
				const ref = selItemAt(next, pos);
				if (box.checked) {
					delete ref.use;
				} else {
					ref.use = false;
				}
				if (!ctx.commit(next)) {
					box.checked = !box.checked;
				}
			});
			checkTd.appendChild(box);
			tr.appendChild(checkTd);
			const nameTd = cell(tr, item.kind === 'group' ? 'Группа ' + filterGroupTypeLabel(item.groupType) : item.left || '');
			nameTd.style.paddingLeft = 8 + depth * 18 + 'px';
			// Ручка переноса — ячейка имени: у строки только атрибут, слушатели — у документа
			nameTd.draggable = true;
			const badge = userSettingBadge(item);
			if (badge) {
				nameTd.appendChild(badge);
			}
			cell(tr, item.kind === 'group' ? '' : comparisonLabel(item.comparisonType || 'Equal'));
			cell(tr, item.kind === 'group' ? '' : valuesSummary(item.right));
			cell(tr, item.presentation || '');
			const isGroup = (candidate) => candidate.kind === 'group';
			const outSlot = itemsOutdentSlot(ctx.items, pos);
			const intoSlot = itemsIndentSlot(ctx.items, pos, isGroup);
			const actions = [
				{
					act: 'edit',
					svg: 'edit',
					title: 'Править',
					onClick: () => {
						ctx.edit(pos);
					},
				},
			];
			if (item.kind === 'group') {
				actions.push({
					act: 'add-comparison',
					svg: 'add',
					title: 'Добавить условие в группу',
					onClick: () => {
						ctx.add('comparison', pos);
					},
				});
				actions.push({
					act: 'add-group',
					svg: 'folder',
					title: 'Добавить вложенную группу',
					onClick: () => {
						ctx.add('group', pos);
					},
				});
			}
			// У края — недоступна, но в обходе Tab: фокус, оставшийся на ней после перестановки, не теряется, щелчок
			// называет причину (aria-disabled с причиной, как у остальных команд редактора)
			const firstHere = index === 0;
			const lastHere = index === listItems.length - 1;
			actions.push({
				act: 'up',
				svg: 'up',
				title: 'Выше',
				unavailable: firstHere,
				note: firstHere ? MINI_FIRST_NOTE : '',
				onClick: () => {
					if (firstHere) {
						ctx.notify(MINI_FIRST_NOTE);
						return;
					}
					moveFilterItem(ctx, pos, -1);
				},
			});
			actions.push({
				act: 'down',
				svg: 'down',
				title: 'Ниже',
				unavailable: lastHere,
				note: lastHere ? MINI_LAST_NOTE : '',
				onClick: () => {
					if (lastHere) {
						ctx.notify(MINI_LAST_NOTE);
						return;
					}
					moveFilterItem(ctx, pos, 1);
				},
			});
			// В группу и из неё без мыши (WCAG 2.5.7): тот же перенос копии, что сброс строки мышью. Кнопка — только там, где
			// она что-то делает: в плоском отборе их нет вовсе. Фокус после перерисовки — за строкой, на её новом адресе
			if (outSlot) {
				actions.push({
					act: 'outdent',
					svg: 'outdent',
					title: LEVEL_WORDS.group.out,
					onClick: () => {
						const made = itemsMove(ctx.items, pos, outSlot);
						if (made) {
							ctx.commit(made.items, { pos: made.pos });
						}
					},
				});
			}
			if (intoSlot) {
				actions.push({
					act: 'indent',
					svg: 'indent',
					title: LEVEL_WORDS.group.into,
					onClick: () => {
						const made = itemsMove(ctx.items, pos, intoSlot);
						if (made) {
							ctx.commit(made.items, { pos: made.pos });
						}
					},
				});
			}
			actions.push({
				act: 'delete',
				svg: 'delete',
				title: 'Удалить',
				danger: true,
				onClick: () => {
					removeFilterItem(ctx, item, pos);
				},
			});
			actionsCell(tr, actions);
			const buttons = tr.children[tr.children.length - 1].children;
			actions.forEach((action, at) => {
				buttons[at].setAttribute('data-mini-key', miniKey(pos, action.act));
			});
			tbody.appendChild(tr);
			if (item.kind === 'group' && Array.isArray(item.items) && item.items.length > 0) {
				appendFilterRows(tbody, ctx, item.items, pos, depth + 1, drag);
			}
		});
	}

	/** Сдвиг элемента отбора в пределах его уровня; true — правка ушла. */
	function moveFilterItem(ctx, pos, delta) {
		const next = cloneItems(ctx.items);
		const listRef = selListAt(next, pos);
		const index = pos[pos.length - 1];
		const target = index + delta;
		if (target < 0 || target >= listRef.length) {
			return false;
		}
		const moved = listRef.splice(index, 1)[0];
		listRef.splice(target, 0, moved);
		// Мини-редактор условия оформления ждёт фокус на той же кнопке строки, уже на новом месте
		return Boolean(ctx.commit(next, { pos: pos.slice(0, -1).concat([target]) }));
	}

	/** Удаление элемента отбора (группы с вложенными на панели — после подтверждения); onSent — когда правка ушла. */
	function removeFilterItem(ctx, item, pos, onSent) {
		function apply() {
			const next = cloneItems(ctx.items);
			selListAt(next, pos).splice(pos[pos.length - 1], 1);
			// Фокус мини-редактора — на «Удалить» строки, занявшей место удалённой (у последней — предыдущей)
			if (!ctx.commit(next, { pos: posAfterRemoval(ctx.items, pos), action: 'delete' })) {
				return BUSY;
			}
			if (onSent) {
				onSent();
			}
			return undefined;
		}
		const nested = item.kind === 'group' && Array.isArray(item.items) ? countSelItems(item.items) : 0;
		if (nested > 0 && !ctx.inline) {
			confirmRemove('Удалить группу отбора? Вместе с ней удалятся вложенные элементы: ' + nested + '.', apply);
			return;
		}
		apply();
	}

	/**
	 * Форма условия-сравнения; общая для диалога панели и инлайн-формы мини-редактора.
	 * apply правит переданный элемент, не трогая passthrough-поля (viewMode, userSettingID и другие).
	 */
	function buildComparisonForm(body, item) {
		const current = item || {};
		const right = Array.isArray(current.right) ? current.right : [];
		const fieldInput = formRow(body, 'Поле', textInput(current.left));
		attachFieldList(fieldInput, 'filter');
		const cmpSelect = formRow(body, 'Вид сравнения', selectInput(comparisonOptions(), current.comparisonType || 'Equal'));
		const valueHost = el('div', 'dcs-value-host');
		let editor = null;
		if (right.length > 1) {
			valueHost.appendChild(el('span', 'dcs-ro-note', 'Значений несколько, они правятся в конфигураторе.'));
		} else {
			editor = createValueControl(right[0], {
				// Поле справа тоже участвует в условии: действует то же ограничение «условие»
				attachFields: (input) => {
					attachFieldList(input, 'filter');
				},
			});
			valueHost.appendChild(editor.root);
		}
		formRow(body, 'Значение', valueHost);
		function refreshValue() {
			const noValue = NO_VALUE_COMPARISONS.indexOf(cmpSelect.value) >= 0;
			valueHost.parentElement.classList.toggle('hidden', noValue);
			if (!noValue && editor && !editor.readOnly && LIST_COMPARISONS.indexOf(cmpSelect.value) >= 0 && editor.mode() !== 'list') {
				editor.setMode('list');
			}
		}
		cmpSelect.addEventListener('change', refreshValue);
		refreshValue();
		const presentationInput = formRow(body, 'Представление', textInput(current.presentation));
		const applicationSelect = formRow(body, 'Применение', selectInput(APPLICATION_OPTIONS, current.application || ''));
		const useBox = checkbox('Использовать', current.use !== false);
		checkRow(body, [useBox]);
		return {
			focusComparison: function () {
				cmpSelect.focus();
			},
			validate: function () {
				if (!fieldInput.value.trim()) {
					return 'Укажите поле.';
				}
				if (NO_VALUE_COMPARISONS.indexOf(cmpSelect.value) >= 0) {
					return undefined;
				}
				if (editor && !editor.readOnly) {
					if (LIST_COMPARISONS.indexOf(cmpSelect.value) >= 0 && editor.mode() !== 'list') {
						return 'Для вида сравнения «' + comparisonLabel(cmpSelect.value) + '» нужен список значений.';
					}
					const error = editor.validate();
					if (error) {
						return 'Значение: ' + error + '.';
					}
				}
				return undefined;
			},
			apply: function (ref) {
				ref.kind = 'comparison';
				ref.left = fieldInput.value.trim();
				ref.comparisonType = cmpSelect.value;
				if (NO_VALUE_COMPARISONS.indexOf(cmpSelect.value) >= 0) {
					delete ref.right;
				} else if (editor) {
					const value = editor.result();
					if (value === null) {
						delete ref.right;
					} else if (value !== undefined) {
						ref.right = [value];
					}
				}
				const presentation = presentationInput.value.trim();
				if (presentation) {
					ref.presentation = presentation;
				} else {
					delete ref.presentation;
				}
				if (applicationSelect.value) {
					ref.application = applicationSelect.value;
				} else {
					delete ref.application;
				}
				if (useBox.input.checked) {
					delete ref.use;
				} else {
					ref.use = false;
				}
			},
		};
	}

	/** Форма группы отбора: тип И/ИЛИ/НЕ, представление и использование. */
	function buildGroupForm(body, item) {
		const current = item || {};
		const typeSelect = formRow(body, 'Тип группы', selectInput(FILTER_GROUP_OPTIONS, current.groupType || 'AndGroup'));
		const presentationInput = formRow(body, 'Представление', textInput(current.presentation));
		const useBox = checkbox('Использовать', current.use !== false);
		checkRow(body, [useBox]);
		return {
			validate: () => undefined,
			apply: function (ref) {
				ref.kind = 'group';
				if (typeSelect.value === 'AndGroup' && !current.groupType) {
					// отсутствие типа в файле означает И — лишний элемент не пишется
					delete ref.groupType;
				} else {
					ref.groupType = typeSelect.value;
				}
				const presentation = presentationInput.value.trim();
				if (presentation) {
					ref.presentation = presentation;
				} else {
					delete ref.presentation;
				}
				if (useBox.input.checked) {
					delete ref.use;
				} else {
					ref.use = false;
				}
			},
		};
	}

	/**
	 * Правка или добавление: применяет форму к копии списка ctx и отдаёт её commit. Новый элемент, ушедший правкой,
	 * сообщается ctx.added(адрес) — панель выбирает его строку после ответа.
	 */
	function applyFilterForm(ctx, form, pos, parentPos, index) {
		const next = cloneItems(ctx.items);
		let ref;
		let freshPos = null;
		if (pos) {
			ref = selItemAt(next, pos);
		} else {
			ref = {};
			const level = itemsLevel(next, parentPos || []);
			// Номер вставки — место сброса поля мышью; без него — последним
			const at = typeof index === 'number' ? Math.max(0, Math.min(index, level.length)) : level.length;
			level.splice(at, 0, ref);
			freshPos = (parentPos || []).concat([at]);
		}
		form.apply(ref);
		// Мини-редактор после «Применить» ставит фокус на «Править» этой строки (новой — на её месте)
		const sent = ctx.commit(next, { pos: pos || freshPos, action: 'edit' });
		if (sent && freshPos && ctx.added) {
			ctx.added(freshPos);
		}
		return sent;
	}

	/**
	 * Диалог элемента отбора: правка по адресу pos или добавление kind в группу parentPos. preset — поле нового условия
	 * («>», двойной щелчок и перенос мышью из «Доступных полей»): поле заполнено, фокус — на виде сравнения. index — номер
	 * вставки нового элемента в группе (место сброса мышью); без него — последним.
	 */
	function openFilterItemDialog(ctx, pos, kind, parentPos, preset, index) {
		const item = pos ? selItemAt(ctx.items, pos) : null;
		const isGroup = item ? item.kind === 'group' : kind === 'group';
		let form;
		openDialog(
			item ? (isGroup ? 'Группа отбора' : 'Условие отбора') : isGroup ? 'Новая группа отбора' : 'Новое условие отбора',
			item ? 'Сохранить' : 'Добавить',
			(body) => {
				form = isGroup ? buildGroupForm(body, item) : buildComparisonForm(body, item || preset || null);
			},
			() => {
				const error = form.validate();
				if (error) {
					return error;
				}
				if (!applyFilterForm(ctx, form, pos, parentPos, index)) {
					return BUSY;
				}
				return undefined;
			}
		);
		// Поле уже выбрано в «Доступных полях»: остаются вид сравнения и значение
		if (!item && preset && form && form.focusComparison) {
			form.focusComparison();
		}
	}

	/** Имя строки «Отбора» для читалки: условие одной строкой или группа с числом условий, и представление. */
	function filterRowLabel(item) {
		const head =
			item.kind === 'group'
				? 'Группа ' + filterGroupTypeLabel(item.groupType) + ', условий: ' + (Array.isArray(item.items) ? item.items.length : 0)
				: filterItemSummary(item);
		return head + (item.presentation ? ', представление «' + item.presentation + '»' : '');
	}

	/**
	 * «Отбор» как в конфигураторе: слева «Доступные поля», посередине «>», справа дерево условий с флажками,
	 * над ним пиктограммы: добавить условие (окно), группу условий, удалить, выше, ниже, вынести из группы, в группу выше.
	 * «>», Enter и двойной щелчок по полю открывают окно нового условия с этим полем: вид сравнения и значение выбирает
	 * пользователь. Новое условие встаёт в выбранную группу, иначе — последним на уровне выбранной строки.
	 */
	function renderFilterPanel(host, node, path, variantName) {
		const stateKey = listStateKey(variantName, path, 'filter');
		const isGroup = (item) => item.kind === 'group';
		const ctx = {
			items: sectionItems(node.filter),
			inline: false,
			commit: function (next) {
				return sendPanelItems('dcs/set-filter', variantName, path, next);
			},
			edit: function (pos) {
				openFilterItemDialog(ctx, pos, '', null);
			},
			add: function (kind, parentPos, preset, index) {
				openFilterItemDialog(ctx, null, kind, parentPos, preset, index);
			},
			added: function (pos) {
				rememberListRow(stateKey, pos);
			},
		};
		let grid = null;
		const parentOf = (row) => {
			const parentPos = insertionParent(row, isGroup);
			return parentPos.length > 0 ? parentPos : null;
		};
		const remove = (row, fromGrid) => {
			const after = posAfterRemoval(ctx.items, row.pos);
			removeFilterItem(ctx, row.item, row.pos, () => {
				rememberListRow(stateKey, after);
				if (fromGrid) {
					replyFocus.list = stateKey;
				}
			});
		};
		const move = (row, delta) => {
			if (moveFilterItem(ctx, row.pos, delta)) {
				rememberListRow(stateKey, row.pos.slice(0, -1).concat([row.pos[row.pos.length - 1] + delta]));
			}
		};
		// Перенос строки, в том числе в группу и из неё: копия отбора с перенесённой строкой (все свойства условия — с ней),
		// выбор — за ней. Мышью (toList) фокус после ответа — на строке, пиктограммами уровня — остаётся на кнопке
		const moveAt = (from, slot, toList) => {
			const made = slot ? itemsMove(ctx.items, from, slot) : null;
			if (!made) {
				return false;
			}
			if (ctx.commit(made.items)) {
				rememberListRow(stateKey, made.pos);
				if (toList) {
					replyFocus.list = stateKey;
				}
			}
			return undefined;
		};
		settingsFieldsLayout(host, {
			id: 'filter',
			title: 'Отбор',
			addTitle: 'Добавить условие по выбранному полю',
			note: () => '',
			onAdd: (field) => ctx.add('comparison', parentOf(grid.selected()), { left: field.path }),
			// Как клавиша Delete: строка сначала выбрана (группа с вложенными — с вопросом; после отмены выбрана она)
			onRemove: (key) => {
				const pos = JSON.parse(key);
				grid.pick(key);
				remove({ pos: pos, item: selItemAt(ctx.items, pos) }, true);
			},
			list: (right, avail) => {
				const noRow = () => (ctx.items.length > 0 ? LIST_NO_ROW_NOTE : LIST_EMPTY_NOTE);
				const where = (row) => insertionNote(row, isGroup, ctx.items, (group) => 'группу «' + filterGroupTypeLabel(group.groupType) + '»');
				const toolbar = settingsListToolbar(right, 'filter', [
					{ id: 'add', icon: 'add', name: 'Добавить условие…', hint: where, run: (row) => ctx.add('comparison', parentOf(row)) },
					{ id: 'folder', icon: 'folder', name: 'Добавить группу условий…', hint: where, run: (row) => ctx.add('group', parentOf(row)) },
					{ id: 'delete', icon: 'delete', name: 'Удалить', shortcut: 'Delete', danger: true, state: (row) => (row ? '' : noRow()), run: (row) => remove(row, false) },
					{ id: 'up', icon: 'up', name: 'Переместить выше', state: (row) => (row ? listMoveNote(row, -1, 'группе') : noRow()), run: (row) => move(row, -1) },
					{ id: 'down', icon: 'down', name: 'Переместить ниже', state: (row) => (row ? listMoveNote(row, 1, 'группе') : noRow()), run: (row) => move(row, 1) },
					...listLevelTools(ctx.items, isGroup, LEVEL_WORDS.group, noRow, (row, slot) => moveAt(row.pos, slot, false)),
				]);
				grid = settingsListGrid(right, {
					id: 'filter',
					label: 'Отбор',
					tree: true,
					headers: ['', 'Поле / группа', 'Вид сравнения', 'Значение', 'Представление', ''],
					rows: flattenItems(ctx.items, isGroup),
					stateKey: stateKey,
					cells: (tr, row) => {
						const item = row.item;
						const nameTd = cell(tr, item.kind === 'group' ? 'Группа ' + filterGroupTypeLabel(item.groupType) : item.left || '');
						nameTd.style.paddingLeft = 8 + row.depth * 18 + 'px';
						const badge = userSettingBadge(item);
						if (badge) {
							nameTd.appendChild(badge);
						}
						cell(tr, item.kind === 'group' ? '' : comparisonLabel(item.comparisonType || 'Equal'));
						cell(tr, item.kind === 'group' ? '' : valuesSummary(item.right));
						cell(tr, item.presentation || '');
					},
					rowLabel: (row) => filterRowLabel(row.item),
					useLabel: (row) => (row.item.kind === 'group' ? 'Группа ' + filterGroupTypeLabel(row.item.groupType) : filterItemSummary(row.item)),
					onUse: (row, checked) => {
						const next = cloneItems(ctx.items);
						const ref = selItemAt(next, row.pos);
						if (checked) {
							delete ref.use;
						} else {
							ref.use = false;
						}
						return ctx.commit(next);
					},
					editable: () => true,
					onEdit: (row) => ctx.edit(row.pos),
					onDelete: remove,
					onSelect: (row) => toolbar.sync(row),
					empty: 'Условий отбора нет: выберите поле в «Доступных полях» и нажмите «>».',
					// Поле, брошенное в отбор, открывает то же окно «Новое условие отбора», что «>»; условие встанет в место сброса
					drop: settingsListDrop('filter', avail, ctx.items, {
						add: (field, slot) => ctx.add('comparison', slot.parent.length > 0 ? slot.parent : null, { left: field.path }, slot.index),
						move: (from, slot) => moveAt(from, slot, true),
						container: isGroup,
					}),
				});
				toolbar.sync(grid.selected());
			},
		});
	}

	/** Первый элемент ввода внутри узла (поле, список, флажок), в порядке документа; нет — null. */
	function firstControl(root) {
		for (const child of Array.from(root.children || [])) {
			if ((child.tagName === 'INPUT' || child.tagName === 'SELECT' || child.tagName === 'TEXTAREA') && !child.disabled) {
				return child;
			}
			const found = firstControl(child);
			if (found) {
				return found;
			}
		}
		return null;
	}

	/** Узел внутри root с атрибутом name = value; нет — null. */
	function findByAttribute(root, name, value) {
		for (const child of Array.from(root.children || [])) {
			if (typeof child.getAttribute === 'function' && child.getAttribute(name) === value) {
				return child;
			}
			const found = findByAttribute(child, name, value);
			if (found) {
				return found;
			}
		}
		return null;
	}

	const MINI_FORM_OPEN = 'Примените или отмените правку условия.';

	/**
	 * Мини-редактор отбора для диалога условного оформления: правит локальную копию,
	 * формы элементов раскрываются под таблицей (вложенный диалог открыть нельзя).
	 * Таблица перерисовывается на каждую правку, и фокус возвращается по ключу элемента (miniKey): на ту же кнопку строки
	 * на её новом адресе, у края — на ту же, недоступную с причиной; удалённой строки нет — на соседнюю или «Добавить
	 * условие…». Открытая форма ставит фокус в своё первое поле, «Применить» — на «Править» строки, «Отмена» — на кнопку,
	 * открывшую форму. Пока форма открыта, перестановки, флажки, удаление и перенос мышью ждут «Применить» или «Отмена»
	 * (иначе набранное в форме пропало бы): причина — в живой строке редактора, плашка страницы лежит под окном.
	 */
	function filterMiniEditor(host, initialItems, emptyText) {
		const state = { items: cloneItems(Array.isArray(initialItems) ? initialItems : []), changed: false, formOpen: false, invoker: '' };
		const tableHost = el('div', 'dcs-mini-filter');
		const note = el('div', 'dcs-mini-note');
		note.setAttribute('role', 'status');
		note.setAttribute('aria-live', 'polite');
		const formHost = el('div', 'dcs-mini-form');
		host.appendChild(tableHost);
		host.appendChild(note);
		host.appendChild(formHost);
		const ctx = {
			items: state.items,
			inline: true,
			emptyText: emptyText,
			formOpen: () => state.formOpen,
			notify: (text) => {
				note.textContent = text;
			},
			commit: function (next, focus) {
				if (state.formOpen) {
					note.textContent = MINI_FORM_OPEN;
					return false;
				}
				state.items = next;
				ctx.items = next;
				state.changed = true;
				rerender(focus);
				return true;
			},
			edit: function (pos) {
				openForm(selItemAt(state.items, pos), pos, '', null);
			},
			add: function (kind, parentPos) {
				openForm(null, null, kind, parentPos);
			},
		};
		/** Ключ элемента редактора с фокусом; фокус не в нём — ''. */
		function focusedKey() {
			const active = document.activeElement;
			return active && typeof active.getAttribute === 'function' ? active.getAttribute('data-mini-key') || '' : '';
		}
		/**
		 * Перерисовка таблицы; focus — {pos, action} (куда ушла строка) или ключ miniKey. Без него — тот же элемент, что
		 * был с фокусом. Запасные цели — «Править» той же строки, затем «Добавить условие…».
		 */
		function rerender(focus) {
			const had = focusedKey();
			const action = had ? had.slice(had.lastIndexOf('|') + 1) : '';
			const wanted = [];
			if (typeof focus === 'string') {
				wanted.push(focus);
			} else if (focus && focus.pos) {
				wanted.push(miniKey(focus.pos, focus.action || action), miniKey(focus.pos, 'edit'));
			} else if (had) {
				wanted.push(had, had.slice(0, had.lastIndexOf('|') + 1) + 'edit');
			}
			tableHost.textContent = '';
			formHost.textContent = '';
			note.textContent = '';
			state.formOpen = false;
			renderFilterTable(tableHost, ctx);
			if (wanted.length === 0) {
				return;
			}
			wanted.push(miniKey(null, 'add-comparison'));
			for (const key of wanted) {
				const target = findByAttribute(tableHost, 'data-mini-key', key);
				if (target) {
					target.focus();
					return;
				}
			}
		}
		function openForm(item, pos, kind, parentPos) {
			// Кнопка, открывшая форму: на неё вернётся фокус после «Отмена» (у повторного открытия — прежняя)
			state.invoker = focusedKey() || state.invoker;
			formHost.textContent = '';
			note.textContent = '';
			state.formOpen = true;
			const isGroup = item ? item.kind === 'group' : kind === 'group';
			const box = el('div', 'dcs-mini-box');
			box.appendChild(el('div', 'dcs-form-group', item ? (isGroup ? 'Группа отбора' : 'Условие отбора') : isGroup ? 'Новая группа' : 'Новое условие'));
			const body = el('div');
			box.appendChild(body);
			const form = isGroup ? buildGroupForm(body, item) : buildComparisonForm(body, item);
			const errorEl = el('div', 'dcs-dialog-error');
			box.appendChild(errorEl);
			const actions = el('div', 'dcs-mini-actions');
			const okBtn = el('button', 'primary-btn dcs-btn-small', 'Применить');
			okBtn.type = 'button';
			okBtn.addEventListener('click', () => {
				const error = form.validate();
				if (error) {
					errorEl.textContent = error;
					return;
				}
				// Форма закрывается своей правкой: её commit — не та перерисовка, что потеряла бы набранное
				state.formOpen = false;
				state.invoker = '';
				applyFilterForm(ctx, form, pos, parentPos);
			});
			const cancelBtn = el('button', 'ghost-btn dcs-btn-small', 'Отмена');
			cancelBtn.type = 'button';
			cancelBtn.addEventListener('click', () => {
				const invoker = state.invoker;
				state.invoker = '';
				rerender(invoker || miniKey(null, 'add-comparison'));
			});
			actions.appendChild(okBtn);
			actions.appendChild(cancelBtn);
			box.appendChild(actions);
			formHost.appendChild(box);
			const first = firstControl(body);
			if (first) {
				first.focus();
			}
		}
		rerender();
		return {
			current: () => state.items,
			changed: () => state.changed,
			formOpen: () => state.formOpen,
		};
	}

	// ---------- панели «Параметры» и «Другие настройки» ----------

	/** Точечная правка значения параметра: value и use меняются, остальное не трогается. */
	function sendParameterValue(variantName, section, path, parameter, patch) {
		const payload = { section: section, parameter: parameter };
		if (section === 'output') {
			payload.path = path;
		}
		if (patch.value !== undefined) {
			payload.value = patch.value;
		}
		if (patch.use !== undefined) {
			payload.use = patch.use;
		}
		if (patch.remove) {
			payload.remove = true;
		}
		if (!send('dcs/set-parameter-value', { variant: variantName, payload: payload })) {
			setStatus(BUSY, true);
			return false;
		}
		return true;
	}

	function paramItemsSummary(items) {
		return items.map((item) => item.parameter || '').join(', ');
	}

	/** Значение параметра не заполнено: нет записи значения, Неопределено или пустые строка и дата. */
	function emptyParamValue(record) {
		const values = Array.isArray(record.value) ? record.value : [];
		if (values.length === 0) {
			return true;
		}
		if (values.length > 1) {
			return false;
		}
		const value = values[0];
		if (value.nil) {
			return true;
		}
		if (value.opaque || value.attrs || value.list || value.period || value.beginningDate) {
			return false;
		}
		const raw = valueRaw(value);
		return raw === '' || raw === DCS_ZERO_DATE;
	}

	function renderDataParametersPanel(host, node, path, variantName) {
		const records = sectionItems(node.dataParameters);
		const recordByName = {};
		for (const record of records) {
			recordByName[record.parameter || ''] = record;
		}
		const showBox = checkbox('Отображать недоступные', uiState.showInaccessibleParams);
		showBox.input.addEventListener('change', () => {
			uiState.showInaccessibleParams = showBox.input.checked;
			renderContent();
		});
		const bar = el('div', 'dcs-params-bar');
		bar.appendChild(showBox.wrap);
		host.appendChild(bar);
		const rows = [];
		const seen = {};
		for (const param of list('parameters')) {
			const name = param.name || '';
			seen[name] = true;
			if (param.useRestriction && !uiState.showInaccessibleParams) {
				continue;
			}
			rows.push({ name: name, param: param, record: recordByName[name] || null });
		}
		for (const record of records) {
			const name = record.parameter || '';
			if (!seen[name]) {
				// Запись варианта без параметра схемы: показывается честно, как есть
				rows.push({ name: name, param: null, record: record });
			}
		}
		if (rows.length === 0) {
			emptyNote(host, 'Параметров нет.');
			return;
		}
		const tbody = dataTable(host, ['', 'Параметр', 'Значение', '']);
		for (const row of rows) {
			appendDataParamRow(tbody, row, path, variantName);
		}
	}

	function appendDataParamRow(tbody, row, path, variantName) {
		const record = row.record;
		const tr = document.createElement('tr');
		if (record && record.use === false) {
			tr.className = 'dcs-row-off';
		}
		const checkTd = el('td', 'dcs-cell-check');
		const box = el('input', 'edit-check');
		box.type = 'checkbox';
		box.checked = record ? record.use !== false : false;
		// У колонки флажков нет заголовка: имя — параметр. Ключ — по параметру: фокус переживает перерисовку по ответу
		box.setAttribute('aria-label', 'Использовать: ' + row.name);
		keyed(box, focusKey(['dparam', 'use', row.name]));
		box.addEventListener('change', () => {
			if (!sendParameterValue(variantName, 'data', path, row.name, { use: box.checked })) {
				box.checked = !box.checked;
			}
		});
		checkTd.appendChild(box);
		tr.appendChild(checkTd);
		const nameTd = cell(tr, row.name);
		if (row.param && row.param.title && row.param.title !== row.name) {
			nameTd.title = row.param.title;
		}
		if (row.param && row.param.useRestriction) {
			nameTd.appendChild(el('span', 'dcs-ro-note', ' (недоступен)'));
		}
		if (record) {
			const badge = userSettingBadge(record);
			if (badge) {
				nameTd.appendChild(badge);
			}
		}
		const composite = record && Array.isArray(record.items) && record.items.length > 0;
		const valueTd = el('td');
		if (composite) {
			valueTd.appendChild(
				el('span', 'dcs-ro-note', 'Составное значение (' + paramItemsSummary(record.items) + ') правится в конфигураторе')
			);
		} else if (record) {
			valueTd.textContent = valuesSummary(record.value);
		} else if (row.param && (row.param.valuePresentation || row.param.value)) {
			valueTd.appendChild(el('span', 'dcs-ro-note', (row.param.valuePresentation || row.param.value) + ' (из схемы)'));
		}
		if (row.param && row.param.denyIncompleteValues && record && record.use !== false && emptyParamValue(record)) {
			valueTd.appendChild(el('span', 'dcs-warn', ' Параметр запрещает незаполненные значения.'));
		}
		tr.appendChild(valueTd);
		if (!composite && (!record || editableValues(record.value))) {
			actionsCell(tr, [
				{
					svg: 'edit',
					title: 'Править',
					// Ключ — по параметру: после ответа фокус возвращается на кнопку той же строки
					key: focusKey(['dparam', 'edit', row.name]),
					onClick: () => {
						openParamValueDialog(variantName, 'data', path, row);
					},
				},
			]);
		} else {
			cell(tr, '');
		}
		tbody.appendChild(tr);
	}

	/** Диалог значения параметра данных: редактор по типу и галка использования. */
	function openParamValueDialog(variantName, section, path, row) {
		const record = row.record;
		const values = record && Array.isArray(record.value) ? record.value : [];
		let editor;
		let useBox;
		openDialog(
			'Параметр «' + row.name + '»',
			'Сохранить',
			(body) => {
				if (row.param && row.param.type) {
					formRow(body, 'Тип', el('span', 'dcs-ro-note', row.param.type));
				}
				const host = el('div', 'dcs-value-host');
				editor = createValueControl(values[0], {
					attachFields: (input) => {
						attachFieldList(input);
					},
				});
				host.appendChild(editor.root);
				formRow(body, 'Значение', host);
				useBox = checkbox('Использовать', record ? record.use !== false : true);
				checkRow(body, [useBox]);
			},
			() => {
				const error = editor.validate();
				if (error) {
					return 'Значение: ' + error + '.';
				}
				const patch = {};
				const value = editor.result();
				if (value === null) {
					// очищенное значение параметра — Неопределено: value присутствует всегда
					patch.value = { nil: true };
				} else if (value !== undefined) {
					patch.value = value;
				}
				const use = useBox.input.checked;
				if (record ? (record.use !== false) !== use : !use) {
					patch.use = use;
				}
				if (patch.value === undefined && patch.use === undefined) {
					closeDialog();
					return undefined;
				}
				if (!sendParameterValue(variantName, section, path, row.name, patch)) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	/** Расположение итогов DataCompositionTotalPlacement (core XSD). */
	const TOTAL_PLACEMENT_OPTIONS = [
		{ value: 'Auto', label: 'Авто' },
		{ value: 'Begin', label: 'Начало' },
		{ value: 'End', label: 'Конец' },
		{ value: 'BeginAndEnd', label: 'Начало и конец' },
		{ value: 'None', label: 'Нет' },
	];

	/** Вывод текста DataCompositionTextOutputType (без «выводить заполненные»). */
	const TEXT_OUTPUT_OPTIONS = [
		{ value: 'Auto', label: 'Авто' },
		{ value: 'Output', label: 'Выводить' },
		{ value: 'DontOutput', label: 'Не выводить' },
	];

	/** Типы диаграммы — тот же список из 47 лексем, что на последнем шаге конструктора настроек. */
	const CHART_TYPE_OPTIONS = wizardRules.CHART_TYPES.map((item) => ({ value: item.value, label: item.label }));

	/**
	 * Белый словарь параметров вывода: имя → тип значения и контрол.
	 * Всё вне словаря показывается только для чтения. У ТипДиаграммы правится само значение, а его
	 * под-параметры «ТипДиаграммы.*» — только чтение: md-sparrow переносит их при правке дословно
	 * (keepsItems). Добавляется он в корне и у диаграммы — там его пишет платформа.
	 */
	const OUTPUT_PARAMS = {
		'ВыводитьЗаголовок': { control: 'enum', type: 'dcsset:DataCompositionTextOutputType', options: TEXT_OUTPUT_OPTIONS },
		'ВыводитьПараметрыДанных': { control: 'enum', type: 'dcsset:DataCompositionTextOutputType', options: TEXT_OUTPUT_OPTIONS },
		'ВыводитьОтбор': { control: 'enum', type: 'dcsset:DataCompositionTextOutputType', options: TEXT_OUTPUT_OPTIONS.concat([{ value: 'OutputFilled', label: 'Выводить заполненные' }]) },
		'Заголовок': { control: 'text', type: 'v8:LocalStringType' },
		'МакетОформления': { control: 'text', type: 'xs:string' },
		'ТипЗаголовкаПолей': { control: 'enum', type: 'dcscor:DataCompositionFieldsTitleType', options: [{ value: 'Auto', label: 'Авто' }, { value: 'Full', label: 'Полный' }, { value: 'Short', label: 'Краткий' }] },
		'РасположениеИтогов': { control: 'enum', type: 'dcscor:DataCompositionTotalPlacement', options: TOTAL_PLACEMENT_OPTIONS },
		'РасположениеОбщихИтогов': { control: 'enum', type: 'dcscor:DataCompositionTotalPlacement', options: TOTAL_PLACEMENT_OPTIONS },
		'ВертикальноеРасположениеОбщихИтогов': { control: 'enum', type: 'dcscor:DataCompositionTotalPlacement', options: TOTAL_PLACEMENT_OPTIONS },
		'ГоризонтальноеРасположениеОбщихИтогов': { control: 'enum', type: 'dcscor:DataCompositionTotalPlacement', options: TOTAL_PLACEMENT_OPTIONS },
		'РасположениеПолейГруппировки': { control: 'enum', type: 'dcsset:DataCompositionGroupFieldsPlacement', options: [{ value: 'Together', label: 'Вместе' }, { value: 'Separately', label: 'Отдельно' }, { value: 'SeparatelyAndInTotalsOnly', label: 'Отдельно и только в итогах' }] },
		'РасположениеГруппировки': { control: 'enum', type: 'dcsset:DataCompositionGroupPlacement', options: [{ value: 'Begin', label: 'Начало' }, { value: 'End', label: 'Конец' }, { value: 'BeginAndEnd', label: 'Начало и конец' }, { value: 'None', label: 'Нет' }] },
		'РасположениеРеквизитов': { control: 'enum', type: 'dcsset:DataCompositionAttributesPlacement', options: [{ value: 'Together', label: 'Вместе' }, { value: 'Separately', label: 'Отдельно' }, { value: 'WithOwnerField', label: 'Вместе с владельцем' }, { value: 'SpecialPosition', label: 'В специальной позиции' }] },
		'РасположениеРесурсов': { control: 'enum', type: 'dcsset:DataCompositionResourcesPlacement', options: [{ value: 'Horizontally', label: 'Горизонтально' }, { value: 'Vertically', label: 'Вертикально' }] },
		'АвтоПозицияРесурсов': { control: 'enum', type: 'dcsset:DataCompositionResourcesAutoPosition', options: [{ value: 'DontUse', label: 'Не использовать' }, { value: 'AfterAllFields', label: 'После всех полей' }] },
		'ФиксацияСверху': { control: 'enum', type: 'dcsset:DataCompositionFixation', options: [{ value: 'Auto', label: 'Авто' }, { value: 'DontUse', label: 'Не использовать' }] },
		'ФиксацияСлева': { control: 'enum', type: 'dcsset:DataCompositionFixation', options: [{ value: 'Auto', label: 'Авто' }, { value: 'DontUse', label: 'Не использовать' }] },
		'КоличествоЗаписей': { control: 'number', type: 'xs:decimal' },
		'ПроцентЗаписей': { control: 'number', type: 'xs:decimal', max: 100 },
		'ТипМакета': { control: 'enum', type: 'dcsset:DataCompositionGroupTemplateType', options: [{ value: 'Auto', label: 'Авто' }, { value: 'Vertical', label: 'Вертикально' }, { value: 'Horizontal', label: 'Горизонтально' }] },
		'ВариантИспользованияГруппировки': { control: 'enum', type: 'dcsset:DataCompositionGroupUseVariant', options: [{ value: 'Auto', label: 'Авто' }, { value: 'AdditionalInformation', label: 'Дополнительная информация' }], kinds: ['group'] },
		'ТипДиаграммы': { control: 'enum', type: 'v8ui:ChartType', options: CHART_TYPE_OPTIONS, defaultValue: 'Column', kinds: ['root', 'chart'], keepsItems: true },
	};

	/**
	 * Параметры вывода, которых платформа не хранит на уровне узла, — зеркало отказов md-sparrow
	 * (ROOT_, GROUP_, TABLE_, TABLE_GROUP_, CHART_ и CHART_GROUP_FORBIDDEN_OUTPUT_PARAMETERS в DcsSettingsEdit.java).
	 * Загрузка схемы в платформу (ibcmd 8.3.27) принимает их без ошибки, но молча отбрасывает: в корне варианта — пять
	 * параметров группировки; у группировки структуры — пять других (на любой глубине); у таблицы — 10 из 22 имён
	 * словаря; у группы строк и группы колонок таблицы — 7 (расположение общих итогов хранится только здесь); у
	 * диаграммы хранятся только тип диаграммы, заголовок и его вывод; у группы точек и группы серий — только количество
	 * и процент записей. Списки явные: в них только отброшенные загрузкой имена. Вложенные группы таблицы и диаграммы
	 * получают запрет своей верхней группы, как и в md-sparrow. Такие параметры не предлагаются, а уже записанные в файле
	 * показываются только для просмотра — строку можно удалить.
	 */
	const OUTPUT_PARAMS_NOT_STORED = {
		root: ['КоличествоЗаписей', 'ПроцентЗаписей', 'ТипМакета', 'РасположениеОбщихИтогов', 'ВариантИспользованияГруппировки'],
		group: ['ФиксацияСверху', 'ФиксацияСлева', 'ВыводитьПараметрыДанных', 'РасположениеОбщихИтогов', 'ГоризонтальноеРасположениеОбщихИтогов'],
		table: [
			'ФиксацияСверху',
			'ФиксацияСлева',
			'ВариантИспользованияГруппировки',
			'ВыводитьОтбор',
			'ВыводитьПараметрыДанных',
			'ТипДиаграммы',
			'РасположениеОбщихИтогов',
			'ТипМакета',
			'ПроцентЗаписей',
			'КоличествоЗаписей',
		],
		tableGroup: [
			'ФиксацияСверху',
			'ФиксацияСлева',
			'ВыводитьПараметрыДанных',
			'ТипДиаграммы',
			'ВертикальноеРасположениеОбщихИтогов',
			'ГоризонтальноеРасположениеОбщихИтогов',
			'ТипМакета',
		],
		chart: [
			'МакетОформления',
			'КоличествоЗаписей',
			'ПроцентЗаписей',
			'ТипМакета',
			'РасположениеИтогов',
			'РасположениеПолейГруппировки',
			'РасположениеГруппировки',
			'РасположениеРеквизитов',
			'РасположениеРесурсов',
			'ГоризонтальноеРасположениеОбщихИтогов',
			'РасположениеОбщихИтогов',
			'ВертикальноеРасположениеОбщихИтогов',
			'ТипЗаголовкаПолей',
			'ВыводитьПараметрыДанных',
			'ВыводитьОтбор',
			'АвтоПозицияРесурсов',
			'ФиксацияСлева',
			'ВариантИспользованияГруппировки',
			'ФиксацияСверху',
		],
		chartGroup: [
			'МакетОформления',
			'ТипМакета',
			'РасположениеИтогов',
			'РасположениеПолейГруппировки',
			'РасположениеГруппировки',
			'РасположениеРеквизитов',
			'РасположениеРесурсов',
			'ГоризонтальноеРасположениеОбщихИтогов',
			'РасположениеОбщихИтогов',
			'ВертикальноеРасположениеОбщихИтогов',
			'ТипЗаголовкаПолей',
			'ТипДиаграммы',
			'ВыводитьЗаголовок',
			'Заголовок',
			'ВыводитьПараметрыДанных',
			'ВыводитьОтбор',
			'АвтоПозицияРесурсов',
			'ФиксацияСлева',
			'ВариантИспользованияГруппировки',
			'ФиксацияСверху',
		],
	};

	/** Где параметр не хранится — продолжение фразы «платформа не хранит этот параметр …». */
	const OUTPUT_LEVEL_PLACES = {
		root: 'в корне варианта',
		group: 'у группировки',
		table: 'у таблицы',
		tableGroup: 'у группы строк или колонок таблицы',
		chart: 'у диаграммы',
		chartGroup: 'у группы точек или серий диаграммы',
	};

	/**
	 * Уровень узла для OUTPUT_PARAMS_NOT_STORED, как его различает md-sparrow: root — корень варианта;
	 * group — группировка структуры (путь идёт только по шагам structure, на любой глубине); table и chart —
	 * сами таблица и диаграмма; tableGroup и chartGroup — группы за шагами rows/columns и points/series
	 * (и вложенные в них группы).
	 */
	function outputLevelOf(node, path) {
		if (path.length === 0) {
			return 'root';
		}
		const kind = node.kind;
		if (kind !== 'group') {
			return kind;
		}
		if (path.every((step) => step.list === 'structure')) {
			return 'group';
		}
		return path.some((step) => step.list === 'points' || step.list === 'series') ? 'chartGroup' : 'tableGroup';
	}

	/** Параметр вывода name не хранится на уровне level (outputLevelOf). */
	function outputNotStored(name, level) {
		const names = OUTPUT_PARAMS_NOT_STORED[level];
		return Array.isArray(names) && names.indexOf(name) >= 0;
	}

	/**
	 * Имена «+ Добавить параметр» у узла вида kind на уровне level: словарь окна без параметров чужого вида узла
	 * (kinds словаря), без тех, что уровень не хранит, и без уже записанных (records — строки секции).
	 */
	function outputAddable(kind, level, records) {
		return Object.keys(OUTPUT_PARAMS).filter((name) => {
			const dict = OUTPUT_PARAMS[name];
			if (dict.kinds && dict.kinds.indexOf(kind) < 0) {
				return false;
			}
			if (outputNotStored(name, level)) {
				return false;
			}
			return !records.some((record) => record.parameter === name);
		});
	}

	/** Причина для строки и подсказки: «платформа не хранит этот параметр в корне варианта». */
	function outputNotStoredReason(level) {
		return 'платформа не хранит этот параметр ' + OUTPUT_LEVEL_PLACES[level] + ': загрузка его отбрасывает';
	}

	/** Доступное имя галки использования в строке параметра вывода. */
	function outputUseLabel(name) {
		return 'Использовать параметр «' + name + '»';
	}

	/** Вопрос перед удалением записанного там, где платформа его не хранит: сначала причина, потом вопрос. */
	function outputUnkeptQuestion(name, level) {
		return 'Платформа не хранит «' + name + '» ' + OUTPUT_LEVEL_PLACES[level] + '. Удалить строку?';
	}

	/** Значение словарного параметра правится, когда тип в файле не спорит со словарём. */
	function canEditOutputValue(dict, values) {
		if (values.length > 1) {
			return false;
		}
		const value = values[0];
		if (!value || value.nil) {
			return true;
		}
		if (value.opaque || value.attrs || value.list || value.period || value.beginningDate) {
			return false;
		}
		const type = value.type || '';
		if (dict.control === 'enum') {
			return type === '' || type === dict.type;
		}
		if (dict.control === 'number') {
			return type === '' || type === 'xs:decimal';
		}
		return type === '' || type === 'xs:string' || type === 'v8:LocalStringType';
	}

	function outputNumberError(dict, raw) {
		const value = Number(raw);
		if (raw.trim() === '' || !Number.isInteger(value) || value < 1 || (dict.max && value > dict.max)) {
			return 'Укажите целое число от 1' + (dict.max ? ' до ' + dict.max : '') + '.';
		}
		return undefined;
	}

	/** Встроенный контрол значения словарного параметра вывода: правка шлёт точечную мутацию. */
	function outputValueControl(dict, values, path, variantName, name) {
		const value = values[0];
		const raw = value && !value.nil ? valueRaw(value) : '';
		// Имя для читалки (у колонки значений заголовок общий) и ключ: ответ правки перерисует панель, фокус вернётся сюда
		const named = (node) => {
			node.setAttribute('aria-label', 'Значение «' + name + '»');
			return keyed(node, focusKey(['outp', 'value', name]));
		};
		if (dict.control === 'enum') {
			let options = dict.options;
			if (!raw) {
				options = [{ value: '', label: '(не задано)' }].concat(options);
			} else if (!options.some((option) => option.value === raw)) {
				options = [{ value: raw, label: raw }].concat(options);
			}
			const select = selectInput(options, raw);
			select.classList.add('dcs-row-select');
			browseSelect(
				select,
				() => {
					if (select.value === raw) {
						return;
					}
					// Пустой пункт «—» — лишь показ незаполненного значения, в enum он не пишется
					if (select.value === '' || !sendParameterValue(variantName, 'output', path, name, { value: { type: dict.type, decoded: select.value } })) {
						select.value = raw;
					}
				},
				() => {
					select.value = raw;
				}
			);
			return named(select);
		}
		if (dict.control === 'number') {
			const input = numberInput(Number(raw) > 0 ? Number(raw) : undefined);
			input.addEventListener('change', () => {
				const error = outputNumberError(dict, input.value);
				if (error) {
					setStatus('«' + name + '»: ' + error, true);
					input.value = raw;
					return;
				}
				if (!sendParameterValue(variantName, 'output', path, name, { value: { type: 'xs:decimal', decoded: Number(input.value) } })) {
					input.value = raw;
				}
			});
			return named(input);
		}
		const input = textInput(raw);
		input.classList.add('dcs-inline-input');
		input.addEventListener('change', () => {
			if (input.value === raw) {
				return;
			}
			// Существующий строковый тип сохраняется, новый берётся из словаря
			const type = value && (value.type === 'xs:string' || value.type === 'v8:LocalStringType') ? value.type : dict.type;
			if (!sendParameterValue(variantName, 'output', path, name, { value: { type: type, decoded: input.value } })) {
				input.value = raw;
			}
		});
		return named(input);
	}

	function renderOutputPanel(host, node, path, variantName) {
		const kind = path.length === 0 ? 'root' : node.kind;
		const level = outputLevelOf(node, path);
		const records = sectionItems(node.outputParameters);
		// Добавление — над таблицей, как команды остальных панелей; список, а не пиктограмма: выбирается имя
		const names = outputAddable(kind, level, records);
		if (names.length > 0) {
			const bar = el('div', 'dcs-list-toolbar');
			const select = el('select', 'edit-ref-add-select');
			select.setAttribute('aria-label', 'Добавить параметр вывода');
			const first = document.createElement('option');
			first.value = '';
			first.textContent = '+ Добавить параметр';
			select.appendChild(first);
			for (const name of names) {
				const option = document.createElement('option');
				option.value = name;
				option.textContent = name;
				select.appendChild(option);
			}
			actionSelect(select, (name) => {
				openOutputParamDialog(variantName, path, name);
			});
			bar.appendChild(keyed(select, focusKey(['nodetool', 'output', 'add'])));
			host.appendChild(bar);
		}
		if (records.length === 0) {
			host.appendChild(el('div', 'dcs-plate', 'Параметры вывода не заданы: действуют умолчания платформы.'));
		} else {
			const unkept = records.filter((record) => outputNotStored(record.parameter || '', level));
			if (unkept.length > 0) {
				host.appendChild(
					el(
						'div',
						'dcs-plate dcs-plate-warn',
						(unkept.length === 1 ? 'Параметр ' : 'Параметры ') +
							unkept.map((record) => '«' + record.parameter + '»').join(', ') +
							' платформа ' +
							OUTPUT_LEVEL_PLACES[level] +
							' не хранит: загрузка ' +
							(unkept.length === 1 ? 'его' : 'их') +
							' отбрасывает. Удалите ' +
							(unkept.length === 1 ? 'строку' : 'строки') +
							' кнопкой «Удалить» в строке.'
					)
				);
			}
			const tbody = dataTable(host, ['', 'Параметр', 'Значение', '']);
			const removable = records.filter((record) => outputRemovable(record, level)).map((record) => record.parameter || '');
			records.forEach((record) => {
				appendOutputRow(tbody, record, path, variantName, level, removable);
			});
		}
	}

	/** У строки параметра вывода есть «Удалить»: словарный без подпараметров или записанный там, где не хранится. */
	function outputRemovable(record, level) {
		const name = record.parameter || '';
		const composite = Array.isArray(record.items) && record.items.length > 0;
		return Boolean((OUTPUT_PARAMS[name] && !composite) || outputNotStored(name, level));
	}

	/** removable — имена строк с кнопкой удаления по порядку: после удаления фокус — на кнопке соседней строки. */
	function appendOutputRow(tbody, record, path, variantName, level, removable) {
		const name = record.parameter || '';
		const dict = OUTPUT_PARAMS[name];
		// Записан там, где платформа его не хранит: только просмотр и удаление (правку md-sparrow отклонит)
		const unkept = outputNotStored(name, level);
		const tr = document.createElement('tr');
		if (record.use === false || unkept) {
			tr.className = 'dcs-row-off';
		}
		const checkTd = el('td', 'dcs-cell-check');
		const box = el('input', 'edit-check');
		box.type = 'checkbox';
		box.checked = record.use !== false;
		// Имя галки — параметр, причина блокировки — описание: одного title экранный диктор не читает
		box.setAttribute('aria-label', outputUseLabel(name));
		keyed(box, focusKey(['outp', 'use', name]));
		if (unkept) {
			box.disabled = true;
			box.title = outputNotStoredReason(level);
			box.setAttribute('aria-description', outputNotStoredReason(level));
		}
		box.addEventListener('change', () => {
			// Точечная правка использования не трогает значение — доступна и вне словаря
			if (!sendParameterValue(variantName, 'output', path, name, { use: box.checked })) {
				box.checked = !box.checked;
			}
		});
		checkTd.appendChild(box);
		tr.appendChild(checkTd);
		const nameTd = cell(tr, name);
		const badge = userSettingBadge(record);
		if (badge) {
			nameTd.appendChild(badge);
		}
		const values = Array.isArray(record.value) ? record.value : [];
		const composite = Array.isArray(record.items) && record.items.length > 0;
		const valueTd = el('td');
		if (unkept) {
			valueTd.appendChild(el('span', 'dcs-ro-note', (valuesSummary(values) || 'пусто') + ' (' + outputNotStoredReason(level) + ')'));
		} else if (composite && !(dict && dict.keepsItems)) {
			valueTd.appendChild(
				el('span', 'dcs-ro-note', 'Подпараметры (' + paramItemsSummary(record.items) + ') правятся в конфигураторе')
			);
		} else if (!dict) {
			valueTd.appendChild(el('span', 'dcs-ro-note', (valuesSummary(values) || 'пусто') + ': вне словаря, правится в конфигураторе'));
		} else if (!canEditOutputValue(dict, values)) {
			valueTd.appendChild(el('span', 'dcs-ro-note', (valuesSummary(values) || 'пусто') + ': правится в конфигураторе'));
		} else {
			valueTd.appendChild(outputValueControl(dict, values, path, variantName, name));
		}
		if (composite && dict && dict.keepsItems && !unkept) {
			valueTd.appendChild(
				el(
					'div',
					'dcs-ro-note',
					'Подпараметры (' + paramItemsSummary(record.items) + ') только для просмотра, при смене значения сохраняются'
				)
			);
		}
		tr.appendChild(valueTd);
		if (outputRemovable(record, level)) {
			const question = unkept ? outputUnkeptQuestion(name, level) : 'Сбросить параметр «' + name + '» к умолчанию платформы?';
			actionsCell(tr, [
				{
					svg: 'delete',
					title: unkept ? 'Удалить: платформа его здесь не хранит' : 'Сбросить к умолчанию платформы',
					danger: true,
					key: focusKey(['outp', 'remove', name]),
					onClick: () => {
						confirmRemove(question, () => {
							if (!sendParameterValue(variantName, 'output', path, name, { remove: true })) {
								return BUSY;
							}
							// Строки больше нет: фокус — на кнопке соседней строки, а без них — на «+ Добавить параметр»
							const at = removable.indexOf(name);
							const neighbour = removable[at + 1] || removable[at - 1];
							replyFocus.fallback = neighbour ? focusKey(['outp', 'remove', neighbour]) : focusKey(['nodetool', 'output', 'add']);
							return undefined;
						});
					},
				},
			]);
		} else {
			cell(tr, '');
		}
		tbody.appendChild(tr);
	}

	/** Добавление словарного параметра вывода: значение выбирается до отправки. */
	function openOutputParamDialog(variantName, path, name) {
		const dict = OUTPUT_PARAMS[name];
		let enumSelect;
		let numberCtl;
		let textCtl;
		openDialog(
			'Параметр вывода «' + name + '»',
			'Добавить',
			(body) => {
				if (dict.control === 'enum') {
					enumSelect = formRow(body, 'Значение', selectInput(dict.options, dict.defaultValue || dict.options[0].value));
				} else if (dict.control === 'number') {
					numberCtl = formRow(body, 'Значение', numberInput(undefined));
				} else {
					textCtl = formRow(body, 'Значение', textInput(''));
				}
			},
			() => {
				let value;
				if (dict.control === 'enum') {
					value = { type: dict.type, decoded: enumSelect.value };
				} else if (dict.control === 'number') {
					const error = outputNumberError(dict, numberCtl.value);
					if (error) {
						return error;
					}
					value = { type: 'xs:decimal', decoded: Number(numberCtl.value) };
				} else {
					value = { type: dict.type, decoded: textCtl.value.trim() };
				}
				if (!sendParameterValue(variantName, 'output', path, name, { value: value })) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	// ---------- панель «Условное оформление» ----------

	/** Области применения оформления: десять флагов useIn* контракта в порядке XSD. */
	const CA_USE_IN = [
		{ key: 'group', label: 'Группировка' },
		{ key: 'hierarchicalGroup', label: 'Иерархическая группировка' },
		{ key: 'overall', label: 'Общий итог' },
		{ key: 'fieldsHeader', label: 'Заголовок полей' },
		{ key: 'header', label: 'Заголовок' },
		{ key: 'parameters', label: 'Параметры' },
		{ key: 'filter', label: 'Отбор' },
		{ key: 'resourceFieldsHeader', label: 'Заголовок полей ресурсов' },
		{ key: 'overallHeader', label: 'Заголовок общего итога' },
		{ key: 'overallResourceFieldsHeader', label: 'Заголовок полей ресурсов общего итога' },
	];

	/** Значения флага области: отсутствие — по умолчанию платформы, элемент не пишется. */
	const CA_USE_OPTIONS = [
		{ value: '', label: 'По умолчанию' },
		{ value: 'Use', label: 'Использовать' },
		{ value: 'DontUse', label: 'Не использовать' },
	];

	/** Словарь параметров оформления для добавления: надёжная лексика цветов и строк. */
	const CA_APPEARANCE_PARAMS = [
		{ name: 'ЦветФона', type: 'v8ui:Color' },
		{ name: 'ЦветТекста', type: 'v8ui:Color' },
		{ name: 'ЦветГраницы', type: 'v8ui:Color' },
		{ name: 'Текст', type: 'v8:LocalStringType' },
		{ name: 'Формат', type: 'v8:LocalStringType' },
	];

	/** Сводка оформления: включённые параметры со значениями. */
	function appearanceSummary(items) {
		const parts = [];
		for (const item of Array.isArray(items) ? items : []) {
			if (item.use === false) {
				continue;
			}
			parts.push((item.parameter || '') + ': ' + (valuesSummary(item.value) || 'пусто'));
		}
		return parts.join('; ');
	}

	/** Сводка областей применения: только изменённые флаги, «+» использовать, «−» нет. */
	function useInSummary(useIn) {
		if (!useIn) {
			return '';
		}
		const parts = [];
		for (const flag of CA_USE_IN) {
			if (useIn[flag.key] === 'Use') {
				parts.push('+ ' + flag.label.toLowerCase());
			} else if (useIn[flag.key] === 'DontUse') {
				parts.push('− ' + flag.label.toLowerCase());
			}
		}
		return parts.join(', ');
	}

	function caFieldsSummary(fields) {
		const items = Array.isArray(fields) ? fields : [];
		if (items.length === 0) {
			return '<Вся область>';
		}
		return items.map((item) => (item.use === false ? '(' + (item.field || '') + ')' : item.field || '')).join(', ');
	}

	function renderAppearancePanel(host, node, path, variantName) {
		const items = sectionItems(node.conditionalAppearance);
		listToolbar(host, [
			{
				icon: 'add',
				name: 'Добавить оформление…',
				key: focusKey(['nodetool', 'appearance', 'add']),
				onClick: () => {
					openAppearanceDialog(variantName, path, null, -1);
				},
			},
		]);
		if (items.length === 0) {
			host.appendChild(el('div', 'dcs-plate', 'Условного оформления нет.'));
		} else {
			const tbody = dataTable(host, ['', 'Оформление', 'Условие', 'Оформляемые поля', 'Представление', 'Область', '']);
			items.forEach((item, index) => {
				const tr = document.createElement('tr');
				if (item.use === false) {
					tr.className = 'dcs-row-off';
				}
				const checkTd = el('td', 'dcs-cell-check');
				const box = el('input', 'edit-check');
				box.type = 'checkbox';
				box.checked = item.use !== false;
				// Имя — элемент оформления (у колонки флажков нет заголовка); ключ — по номеру, как у кнопок строки
				box.setAttribute('aria-label', 'Использовать: ' + (item.presentation || appearanceSummary(item.appearance) || 'элемент ' + (index + 1)));
				keyed(box, focusKey(['appr', 'use', String(index)]));
				box.addEventListener('change', () => {
					const next = cloneItems([item])[0];
					if (box.checked) {
						delete next.use;
					} else {
						next.use = false;
					}
					if (!send('dcs/set-appearance-item', { variant: variantName, payload: { path: path, index: index, item: next } })) {
						setStatus(BUSY, true);
						box.checked = !box.checked;
					}
				});
				checkTd.appendChild(box);
				tr.appendChild(checkTd);
				cell(tr, appearanceSummary(item.appearance));
				cell(tr, filterSummary(item.filter));
				cell(tr, caFieldsSummary(item.fields));
				const presTd = cell(tr, item.presentation || '');
				const badge = userSettingBadge(item);
				if (badge) {
					presTd.appendChild(badge);
				}
				cell(tr, useInSummary(item.useIn));
				// Ключи — по номеру: после правки фокус на той же кнопке, после удаления — у строки, занявшей место удалённой
				const deleteKey = (at) => focusKey(['appr', 'delete', String(at)]);
				actionsCell(tr, [
					{
						svg: 'edit',
						title: 'Править',
						key: focusKey(['appr', 'edit', String(index)]),
						onClick: () => {
							openAppearanceDialog(variantName, path, item, index);
						},
					},
					{
						svg: 'delete',
						title: 'Удалить',
						danger: true,
						key: deleteKey(index),
						onClick: () => {
							confirmRemove('Удалить элемент оформления «' + (item.presentation || appearanceSummary(item.appearance) || index + 1) + '»?', () => {
								if (!send('dcs/remove-appearance-item', { variant: variantName, payload: { path: path, index: index } })) {
									return BUSY;
								}
								rowRemovalFocus(deleteKey, index, focusKey(['nodetool', 'appearance', 'add']));
								return undefined;
							});
						},
					},
				]);
				tbody.appendChild(tr);
			});
		}
	}

	/** Оформляемые поля: галка использования, путь и удаление; добавление с подсказками. */
	function caFieldsEditor(body, initialFields) {
		const state = { fields: cloneItems(Array.isArray(initialFields) ? initialFields : []), changed: false };
		const host = el('div', 'dcs-ca-fields');
		body.appendChild(host);
		const addRow = el('div', 'dcs-ca-add');
		const input = textInput('');
		input.placeholder = 'путь поля';
		input.setAttribute('aria-label', 'Путь поля');
		const button = iconButton({
			icon: 'add',
			name: 'Добавить поле',
			className: 'struct-btn',
			onClick: () => {
				const field = input.value.trim();
				if (!field) {
					input.focus();
					return;
				}
				state.fields.push({ field: field });
				state.changed = true;
				input.value = '';
				rerender();
			},
		});
		addRow.appendChild(input);
		addRow.appendChild(button);
		// Подсказка — когда поле уже в строке: кнопка «⋯» встаёт между полем и «Добавить поле»
		attachFieldList(input);
		body.appendChild(addRow);
		/** focusAt — номер строки, «Убрать» которой получит фокус (кнопка с фокусом ушла вместе со строкой). */
		function rerender(focusAt) {
			host.textContent = '';
			const removeButtons = [];
			if (state.fields.length === 0) {
				host.appendChild(el('div', 'empty', 'Полей нет: оформляется вся область действия элемента.'));
			}
			state.fields.forEach((field, index) => {
				const row = el('div', 'dcs-ca-field-row');
				const box = checkbox(field.field || '', field.use !== false);
				box.input.addEventListener('change', () => {
					if (box.input.checked) {
						delete state.fields[index].use;
					} else {
						state.fields[index].use = false;
					}
					state.changed = true;
				});
				row.appendChild(box.wrap);
				const removeBtn = iconButton({
					icon: 'delete',
					name: 'Убрать поле «' + (field.field || '') + '»',
					className: 'struct-btn struct-btn-danger',
					onClick: () => {
						state.fields.splice(index, 1);
						state.changed = true;
						rerender(index);
					},
				});
				row.appendChild(removeBtn);
				removeButtons.push(removeBtn);
				host.appendChild(row);
			});
			if (focusAt !== undefined) {
				const target = removeButtons[Math.min(focusAt, removeButtons.length - 1)] || input;
				target.focus();
			}
		}
		rerender();
		return {
			current: () => state.fields,
			changed: () => state.changed,
		};
	}

	// ---------- окно «Форматная строка» ----------

	/** Разбор, сборка и пример форматной строки (dcs-editor-format.js). */
	const formatRules = window.DcsFormat;

	/** Параметр оформления, значение которого — форматная строка: «Формат» (в английской выгрузке — Format). */
	function isFormatParameter(name) {
		const key = String(name || '')
			.trim()
			.toLowerCase();
		return key === 'формат' || key === 'format';
	}

	const FORMAT_TITLE = 'Форматная строка';

	/** Вкладки окна по виду значения; «Язык (страна)» общий для всех — он над вкладками. */
	const FORMAT_TABS = [
		{ id: 'number', title: 'Число' },
		{ id: 'date', title: 'Дата' },
		{ id: 'boolean', title: 'Логическое' },
	];

	/**
	 * Значение ключа, который включили флажком при пустом поле: иначе в строку ушло бы «ЧЦ=» без
	 * числа. Значения свои, а не умолчания платформы, — их правят тут же в поле. ЧРД — запятая, как у
	 * конструктора платформы и русской локали: точка по одному флажку переводила бы отчёт на десятичную точку.
	 */
	const FORMAT_DEFAULTS = { Л: 'ru_RU', ЧЦ: '10', ЧДЦ: '2', ЧС: '0', ЧРД: ',', ЧГ: '3,0', ЧО: '1', ДФ: 'dd.MM.yyyy', ДЛФ: 'D' };

	/** Подсказка формы значения в пустом поле. */
	const FORMAT_PLACEHOLDERS = { locale: 'ru_RU', grouping: '3,0', pattern: 'dd.MM.yyyy' };

	/** Пример по умолчанию: у отрицательного дробного числа видны группы, дробь и минус. */
	const FORMAT_SAMPLES = { number: '-1234567.891', date: '2026-03-08T09:05:07' };

	/** Пустой итог примера показывается словами: пустая строка на экране не видна. */
	const FORMAT_EMPTY_PREVIEW = '(пустая строка)';

	/** Вариант списка «как записано» для значения, которого нет среди известных: оно остаётся дословно. */
	const FORMAT_RAW_CHOICE = 'raw';

	/** Счётчик окон: id вкладок и панелей свои у каждого открытия, чтобы aria-controls не связали чужие. */
	let formatDialogCount = 0;

	/** Ошибка целого значения ключа (ЧЦ, ЧДЦ, ЧС); пусто — значение подходит. Границы свои. */
	function formatIntegerProblem(name, value) {
		if (!/^[-+]?\d+$/.test(value)) {
			return 'укажите целое число';
		}
		const number = parseInt(value, 10);
		if (name === 'ЧЦ' && number < 1) {
			return 'укажите целое число больше нуля';
		}
		if (name === 'ЧДЦ' && number < 0) {
			return 'укажите целое число не меньше нуля';
		}
		return '';
	}

	/** Варианты списка ключа: ЧО — вид отрицательного числа, ДЛФ — вид даты по локали. */
	function formatChoiceOptions(info) {
		if (info.name === 'ДЛФ') {
			return formatRules.DLF_OPTIONS.map((option) => ({ value: option.value, ru: option.ru, label: option.value + ': ' + option.label }));
		}
		return formatRules.NN_OPTIONS.map((option) => ({ value: option.value, label: option.value + ': ' + option.label }));
	}

	/** Вариант списка, которому равно записанное значение (ДЛФ — и латиницей, и кириллицей); нет такого — ''. */
	function formatChoiceOf(options, stored) {
		const text = String(stored).trim().toUpperCase();
		const found = options.find((option) => option.value.toUpperCase() === text || (option.ru && option.ru.toUpperCase() === text));
		return found ? found.value : '';
	}

	/** Строка «Прочих параметров»: параметр или сегмент без «=», как он записан в строке. */
	function formatUnknownText(item) {
		return (typeof item.raw === 'string' ? item.raw : (item.key || '') + '=' + (item.value || '')).trim();
	}

	/**
	 * Окно «Форматная строка» — уровень стека над окном оформления. Сверху «Язык (страна)», ниже
	 * вкладки Число / Дата / Логическое: у каждого ключа флажок (ключ есть в строке) и поле значения,
	 * на вкладке — пример. Внизу итоговая строка; её можно править и руками, поля тогда перечитываются.
	 *
	 * Строку собирает модуль форматной строки от разобранной: нетронутые параметры, неизвестные ключи
	 * и английские имена остаются дословно, неизменённая строка возвращается байт в байт. Поэтому ОК
	 * без правок ничего не меняет. spec: {text, onDone(text)} — onDone зовётся, только если строка
	 * изменилась.
	 */
	function openFormatDialog(spec) {
		const rules = formatRules;
		const initialText = String(spec.text == null ? '' : spec.text);
		const initial = rules.parseFormat(initialText);
		const uid = 'dcsFmt' + ++formatDialogCount;
		const state = {
			// Разобранная строка, от которой считаются правки полей: исходная или набранная руками в поле строки
			base: initial,
			tab: '',
		};
		// Ключ в подписи — на языке имён строки: у «ND=10; NFD=2» подпись «Всего цифр (ND)», как ключ записан
		const lang = initial.lang === 'en' ? 'en' : 'ru';
		const entries = [];
		const tabs = [];
		const previews = [];
		let level = null;
		let textArea = null;
		let unknownEl = null;

		function storedOf(entry) {
			return rules.getValue(state.base, entry.info.name);
		}

		/** Строка по полям: от base меняются только выключенные ключи и включённые с новым значением. */
		function current() {
			let struct = state.base;
			for (const entry of entries) {
				const stored = storedOf(entry);
				if (!entry.box.input.checked) {
					if (stored !== undefined) {
						struct = rules.removeKey(struct, entry.info.name);
					}
					continue;
				}
				const value = entry.read(stored);
				if (stored === undefined || value !== stored) {
					struct = rules.setValue(struct, entry.info.name, value);
				}
			}
			return struct;
		}

		function keyName(info) {
			return lang === 'en' ? info.en : info.name;
		}

		/** Включённый ключ с пустым полем получает значение по умолчанию: «ЧЦ=» без числа ничего не значит. */
		function fillDefault(entry) {
			const fallback = FORMAT_DEFAULTS[entry.info.name];
			if (entry.input && entry.input.value === '' && fallback !== undefined) {
				entry.input.value = fallback;
			}
		}

		/** Строка ключа: флажок с подписью «что — (ключ)» и поле значения; у флага ЧВН поля нет. */
		function entryRow(host, info, tab) {
			const label = info.label + ' (' + keyName(info) + ')';
			const row = el('div', 'dcs-fmt-row');
			const box = checkbox(label, false);
			row.appendChild(box.wrap);
			const entry = { info: info, tab: tab, box: box, control: null, input: null, read: () => '', show: () => undefined };
			if (info.kind === 'choice') {
				const options = formatChoiceOptions(info);
				// Новый ключ начинается с умолчания окна (ЧО=1 — обычный минус), а не с первого варианта списка
				const fallback = options.some((option) => option.value === FORMAT_DEFAULTS[info.name]) ? FORMAT_DEFAULTS[info.name] : options[0].value;
				const select = selectInput(options, fallback);
				select.classList.add('dcs-fmt-input');
				let rawOption = null;
				entry.read = (stored) => {
					if (select.value === FORMAT_RAW_CHOICE) {
						return stored === undefined ? '' : stored;
					}
					// Тот же вариант, что записан (ДЛФ=Д кириллицей), пишется как был: строка не меняется
					return stored !== undefined && formatChoiceOf(options, stored) === select.value ? stored : select.value;
				};
				entry.show = (stored) => {
					// Вариант «как записано» живёт, пока в строке его значение: иначе включённый ключ ушёл бы пустым
					if (rawOption) {
						rawOption.remove();
						rawOption = null;
						select.value = fallback;
					}
					if (stored === undefined) {
						return;
					}
					const known = formatChoiceOf(options, stored);
					if (known) {
						select.value = known;
						return;
					}
					rawOption = document.createElement('option');
					rawOption.value = FORMAT_RAW_CHOICE;
					rawOption.textContent = 'как записано: «' + stored + '»';
					select.appendChild(rawOption);
					select.value = FORMAT_RAW_CHOICE;
				};
				select.addEventListener('change', () => {
					box.input.checked = true;
					refresh();
				});
				entry.control = select;
			} else if (info.kind !== 'flag') {
				const input = textInput('');
				input.classList.add('dcs-fmt-input');
				if (info.kind === 'integer') {
					input.inputMode = 'numeric';
				}
				if (FORMAT_PLACEHOLDERS[info.kind]) {
					input.placeholder = FORMAT_PLACEHOLDERS[info.kind];
				}
				entry.read = (stored) => {
					if (info.kind !== 'integer') {
						return input.value;
					}
					// Число сравнивается без пробелов по краям: записанное « 15» не переписывается в «15» само
					const value = input.value.trim();
					return stored !== undefined && String(stored).trim() === value ? stored : value;
				};
				entry.show = (stored) => {
					if (stored !== undefined) {
						input.value = stored;
					}
				};
				input.addEventListener('input', () => {
					input.removeAttribute('aria-invalid');
					// Набранное значение без флажка потерялось бы: ввод сам включает ключ
					box.input.checked = true;
					refresh();
				});
				entry.control = input;
				entry.input = input;
			} else {
				// ЧВН — сам ключ: записанное значение переносится как было, новый пишется без значения
				entry.read = (stored) => (stored === undefined ? '' : stored);
			}
			if (entry.control) {
				entry.control.setAttribute('aria-label', label + ': значение');
				row.appendChild(entry.control);
			}
			box.input.addEventListener('change', () => {
				if (box.input.checked) {
					fillDefault(entry);
				}
				refresh();
			});
			host.appendChild(row);
			entries.push(entry);
			return entry;
		}

		/** Поля по разобранной строке: флажок — есть ли ключ, поле — его значение. */
		function sync() {
			for (const entry of entries) {
				const stored = storedOf(entry);
				entry.box.input.checked = stored !== undefined;
				entry.show(stored);
				if (entry.control) {
					entry.control.removeAttribute('aria-invalid');
				}
			}
		}

		/** Пример вкладки: значение для примера → как его покажет строка (своё приближение, не платформа). */
		function previewBlock(host, tab) {
			const box = el('div', 'dcs-fmt-preview');
			box.appendChild(el('span', 'dcs-fmt-preview-label', 'Пример:'));
			let sample;
			if (tab === 'number') {
				sample = textInput(FORMAT_SAMPLES.number);
				sample.inputMode = 'decimal';
			} else if (tab === 'date') {
				sample = dateTimeInput(FORMAT_SAMPLES.date);
			} else {
				sample = selectInput(
					[
						{ value: 'true', label: 'Истина' },
						{ value: 'false', label: 'Ложь' },
					],
					'true'
				);
			}
			sample.classList.add('dcs-fmt-sample');
			sample.setAttribute('aria-label', 'Значение для примера');
			sample.addEventListener(tab === 'boolean' ? 'change' : 'input', () => {
				refresh();
			});
			box.appendChild(sample);
			const arrow = el('span', 'dcs-fmt-arrow', '→');
			arrow.setAttribute('aria-hidden', 'true');
			box.appendChild(arrow);
			const result = el('span', 'dcs-fmt-result');
			// Итог примера меняется от каждого поля: читалка слышит его, не уходя с поля
			result.setAttribute('aria-live', 'polite');
			box.appendChild(result);
			host.appendChild(box);
			previews.push({
				tab: tab,
				sample: sample,
				result: result,
				paint: (struct) => {
					let value;
					if (tab === 'number') {
						const raw = sample.value.replace(/\s/g, '').replace(',', '.');
						value = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
					} else if (tab === 'date') {
						// Пустое поле — пустая дата платформы: так виден ключ «Как выводить пустую дату»
						value = dateLexicalOf(sample) || DCS_ZERO_DATE;
					} else {
						value = sample.value === 'true';
					}
					if (value === null) {
						result.textContent = 'введите число';
						return;
					}
					const text = rules.preview(struct, value);
					result.textContent = text === '' ? FORMAT_EMPTY_PREVIEW : text;
				},
			});
		}

		function pickTab(id, focus) {
			state.tab = id;
			for (const tab of tabs) {
				const active = tab.id === id;
				tab.button.classList.toggle('active', active);
				tab.button.setAttribute('aria-selected', String(active));
				// Одна остановка Tab на полосе — активная вкладка, соседние — стрелками
				tab.button.tabIndex = active ? 0 : -1;
				tab.panel.classList.toggle('hidden', !active);
				if (active && focus) {
					tab.button.focus();
				}
			}
		}

		function tabKey(event, index) {
			const last = tabs.length - 1;
			let to = -1;
			if (event.key === 'ArrowRight') {
				to = index === last ? 0 : index + 1;
			} else if (event.key === 'ArrowLeft') {
				to = index === 0 ? last : index - 1;
			} else if (event.key === 'Home') {
				to = 0;
			} else if (event.key === 'End') {
				to = last;
			}
			if (to < 0) {
				return;
			}
			event.preventDefault();
			pickTab(tabs[to].id, true);
		}

		function refresh() {
			const struct = current();
			const text = rules.buildFormat(struct);
			// Поле строки, в котором печатают, уже равно сборке: не трогаем его, чтобы не сбить каретку
			if (textArea.value !== text) {
				textArea.value = text;
			}
			const unknown = struct.unknown.map(formatUnknownText).filter(Boolean);
			unknownEl.textContent = unknown.length
				? 'Прочие параметры (окно их не разбирает и переносит как записаны): ' + unknown.join('; ')
				: '';
			for (const item of previews) {
				item.paint(struct);
			}
			if (level) {
				level.setTitle(FORMAT_TITLE, text !== initialText);
			}
		}

		function build(body, owner) {
			level = owner;
			const common = el('div', 'dcs-fmt-common');
			for (const info of rules.KEYS) {
				if (info.group === 'common') {
					entryRow(common, info, '');
				}
			}
			body.appendChild(common);
			const strip = el('div', 'tabs dcs-subtabs dcs-fmt-tabs');
			strip.setAttribute('role', 'tablist');
			strip.setAttribute('aria-label', 'Вид значения');
			body.appendChild(strip);
			FORMAT_TABS.forEach((item, index) => {
				const button = el('button', 'tab', item.title);
				button.type = 'button';
				button.id = uid + '-tab-' + item.id;
				button.setAttribute('role', 'tab');
				const panel = el('div', 'dcs-fmt-panel');
				panel.id = uid + '-panel-' + item.id;
				panel.setAttribute('role', 'tabpanel');
				panel.setAttribute('aria-labelledby', button.id);
				button.setAttribute('aria-controls', panel.id);
				button.addEventListener('click', () => {
					pickTab(item.id, false);
				});
				button.addEventListener('keydown', (event) => {
					tabKey(event, index);
				});
				strip.appendChild(button);
				for (const info of rules.KEYS) {
					if (info.group === item.id) {
						entryRow(panel, info, item.id);
					}
				}
				previewBlock(panel, item.id);
				body.appendChild(panel);
				tabs.push({ id: item.id, button: button, panel: panel });
			});
			body.appendChild(el('div', 'dcs-ro-note dcs-fmt-note', rules.PREVIEW_NOTE));
			unknownEl = el('div', 'dcs-ro-note dcs-fmt-unknown');
			body.appendChild(unknownEl);
			textArea = el('textarea', 'edit-input dcs-fmt-text');
			textArea.rows = 2;
			textArea.spellcheck = false;
			// Имя поля — видимая подпись строки: читалка и голосовое управление находят его по тому, что
			// написано на экране (WCAG 2.5.3), а не по заголовку окна
			textArea.setAttribute('aria-label', 'Итоговая строка');
			textArea.value = initialText;
			textArea.addEventListener('input', () => {
				// Строка, набранная руками, становится новой основой: поля перечитываются из неё
				state.base = rules.parseFormat(textArea.value);
				sync();
				refresh();
			});
			formRow(body, 'Итоговая строка', textArea);
			sync();
			// Открывается вкладка первого записанного ключа: у «ДФ=dd.MM.yyyy» — «Дата», у пустой строки — «Число»
			const first = FORMAT_TABS.find((item) => rules.KEYS.some((info) => info.group === item.id && rules.hasKey(initial, info.name)));
			pickTab((first || FORMAT_TABS[0]).id, false);
			refresh();
		}

		function submit(owner) {
			for (const entry of entries) {
				if (entry.info.kind !== 'integer' || !entry.box.input.checked) {
					continue;
				}
				const value = entry.read(storedOf(entry));
				// Записанное до окна не проверяем: его не трогали, и отказ на чужом значении не дал бы закрыть окно
				if (value === rules.getValue(initial, entry.info.name)) {
					continue;
				}
				const problem = formatIntegerProblem(entry.info.name, value);
				if (problem) {
					if (entry.tab) {
						pickTab(entry.tab, false);
					}
					entry.control.setAttribute('aria-invalid', 'true');
					entry.control.focus();
					return '«' + entry.info.label + '» (' + keyName(entry.info) + '): ' + problem + '.';
				}
			}
			const text = rules.buildFormat(current());
			if (text !== initialText) {
				spec.onDone(text);
			}
			owner.close();
			return undefined;
		}

		return pushDialog({
			title: FORMAT_TITLE,
			width: 'wide',
			build: build,
			buttons: [
				{ id: 'ok', label: 'ОК', primary: true, onClick: submit },
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	/** Кнопка «…» у значения «Формат»: окно форматной строки над окном оформления правит текст поля. */
	function formatStringButton(input) {
		const button = el('button', 'ghost-btn dcs-btn-small dcs-fmt-open', '…');
		button.type = 'button';
		button.title = 'Конструктор форматной строки';
		button.setAttribute('aria-label', 'Конструктор форматной строки');
		button.addEventListener('click', () => {
			openFormatDialog({
				text: input.value,
				onDone: (text) => {
					input.value = text;
				},
			});
		});
		return button;
	}

	/**
	 * Параметры оформления внутри диалога: цвета, строки и прочие простые типы правятся,
	 * шрифт и незнакомые — только показ, их строки не удаляются. Правки собираются при submit.
	 */
	function caAppearanceEditor(body, initialItems) {
		const rows = [];
		let structureChanged = false;
		// Добавление — над таблицей, как у «Других настроек»; список, а не пиктограмма: выбирается имя
		const addRow = el('div', 'dcs-ca-add');
		const addSelect = el('select', 'edit-ref-add-select');
		addSelect.setAttribute('aria-label', 'Добавить параметр оформления');
		addRow.appendChild(addSelect);
		body.appendChild(addRow);
		const host = el('div', 'dcs-ca-appearance');
		body.appendChild(host);
		const tbody = dataTable(host, ['', 'Параметр', 'Значение', '']);
		function refreshAdd() {
			addSelect.textContent = '';
			const first = document.createElement('option');
			first.value = '';
			first.textContent = '+ Добавить параметр';
			addSelect.appendChild(first);
			for (const entry of CA_APPEARANCE_PARAMS) {
				if (rows.some((row) => !row.removed && row.item.parameter === entry.name)) {
					continue;
				}
				const option = document.createElement('option');
				option.value = entry.name;
				option.textContent = entry.name;
				addSelect.appendChild(option);
			}
			addSelect.classList.toggle('hidden', addSelect.options.length === 1);
		}
		function appendRow(row) {
			const tr = document.createElement('tr');
			const checkTd = el('td', 'dcs-cell-check');
			row.useBox = el('input', 'edit-check');
			row.useBox.type = 'checkbox';
			row.useBox.checked = row.item.use !== false;
			checkTd.appendChild(row.useBox);
			tr.appendChild(checkTd);
			const nameTd = cell(tr, row.item.parameter || '');
			const badge = userSettingBadge(row.item);
			if (badge) {
				nameTd.appendChild(badge);
			}
			const values = Array.isArray(row.item.value) ? row.item.value : [];
			const valueTd = el('td');
			if (editableValues(values)) {
				// Тип существующего значения не переключается; пустое и «Неопределено» выбирают тип
				row.control = createValueControl(values[0], {
					fixedMode: Boolean(values[0]) && !values[0].nil,
					typeHint: values[0] ? undefined : 'string',
					attachFields: (input) => {
						attachFieldList(input);
					},
					// У «Формат» — «…» окна форматной строки. Окно правит текст поля, а тип имеющегося значения
					// (v8:LocalStringType или xs:string) держит сам контрол: fixedMode его не переключает
					textButton: isFormatParameter(row.item.parameter) ? formatStringButton : undefined,
				});
				valueTd.appendChild(row.control.root);
			} else {
				valueTd.appendChild(el('span', 'dcs-ro-note', (valuesSummary(values) || 'пусто') + ': правится в конфигураторе'));
			}
			tr.appendChild(valueTd);
			if (row.control) {
				actionsCell(tr, [
					{
						svg: 'delete',
						title: 'Убрать параметр «' + (row.item.parameter || '') + '»',
						danger: true,
						onClick: () => {
							row.removed = true;
							structureChanged = true;
							// Кнопка с фокусом уходит вместе со строкой: фокус — на «Убрать» следующей строки, иначе предыдущей,
							// иначе на список добавления
							const at = rows.indexOf(row);
							const live = rows.filter((other) => !other.removed && other.removeBtn);
							const neighbour = live.find((other) => rows.indexOf(other) > at) || live.filter((other) => rows.indexOf(other) < at).pop();
							tr.remove();
							refreshAdd();
							if (neighbour) {
								neighbour.removeBtn.focus();
							} else if (!addSelect.classList.contains('hidden')) {
								addSelect.focus();
							}
						},
					},
				]);
				row.removeBtn = tr.children[tr.children.length - 1].children[0];
			} else {
				cell(tr, '');
			}
			tbody.appendChild(tr);
		}
		for (const item of cloneItems(Array.isArray(initialItems) ? initialItems : [])) {
			const row = { item: item, removed: false };
			rows.push(row);
			appendRow(row);
		}
		// Стрелки на закрытом списке только выбирают имя, добавляет Enter или выбор мышью (actionSelect)
		actionSelect(addSelect, (name) => {
			const entry = CA_APPEARANCE_PARAMS.filter((candidate) => candidate.name === name)[0];
			const row = {
				item: { parameter: entry.name, value: [{ type: entry.type, decoded: entry.type === 'v8ui:Color' ? 'auto' : '' }] },
				removed: false,
				added: true,
			};
			rows.push(row);
			appendRow(row);
			structureChanged = true;
			refreshAdd();
		});
		refreshAdd();
		function rowUseChanged(row) {
			return row.useBox && row.useBox.checked !== (row.item.use !== false);
		}
		return {
			validate: function () {
				for (const row of rows) {
					if (row.removed || !row.control) {
						continue;
					}
					const error = row.control.validate();
					if (error) {
						return 'Параметр «' + (row.item.parameter || '') + '»: ' + error + '.';
					}
				}
				return undefined;
			},
			changed: function () {
				return (
					structureChanged ||
					rows.some((row) => !row.removed && (rowUseChanged(row) || (row.control && row.control.result() !== undefined)))
				);
			},
			current: function () {
				const result = [];
				for (const row of rows) {
					if (row.removed) {
						continue;
					}
					const value = row.control ? row.control.result() : undefined;
					if (!row.added && value === undefined && !rowUseChanged(row)) {
						result.push(row.item);
						continue;
					}
					const next = cloneItems([row.item])[0];
					if (!row.useBox || row.useBox.checked) {
						delete next.use;
					} else {
						next.use = false;
					}
					if (value === null) {
						next.value = [{ nil: true }];
					} else if (value !== undefined) {
						next.value = [value];
					}
					result.push(next);
				}
				return result;
			},
		};
	}

	/** Диалог элемента условного оформления: оформление, условие, поля и области применения. */
	function openAppearanceDialog(variantName, path, original, index) {
		const item = original || {};
		let useBox;
		let presentationInput;
		let appearanceEd;
		let mini;
		let fieldsEd;
		const useInSelects = {};
		openWideDialog(
			original ? 'Элемент условного оформления' : 'Новый элемент условного оформления',
			original ? 'Сохранить' : 'Добавить',
			(body) => {
				useBox = checkbox('Использовать', item.use !== false);
				checkRow(body, [useBox]);
				presentationInput = formRow(body, 'Представление', textInput(item.presentation));
				groupTitle(body, 'Параметры оформления');
				appearanceEd = caAppearanceEditor(body, item.appearance);
				groupTitle(body, 'Условие');
				mini = filterMiniEditor(body, item.filter, 'Условий нет: оформление действует всегда.');
				groupTitle(body, 'Оформляемые поля');
				fieldsEd = caFieldsEditor(body, item.fields);
				groupTitle(body, 'Область использования');
				const grid = el('div', 'dcs-usein-grid');
				for (const flag of CA_USE_IN) {
					const row = el('label', 'dcs-usein-row');
					row.appendChild(el('span', 'dcs-usein-label', flag.label));
					const select = selectInput(CA_USE_OPTIONS, (item.useIn && item.useIn[flag.key]) || '');
					useInSelects[flag.key] = select;
					row.appendChild(select);
					grid.appendChild(row);
				}
				body.appendChild(grid);
			},
			() => {
				if (mini.formOpen()) {
					return MINI_FORM_OPEN;
				}
				const appearanceError = appearanceEd.validate();
				if (appearanceError) {
					return appearanceError;
				}
				const next = original ? cloneItems([original])[0] : {};
				if (useBox.input.checked) {
					delete next.use;
				} else {
					next.use = false;
				}
				const presentation = presentationInput.value.trim();
				if (presentation) {
					next.presentation = presentation;
				} else {
					delete next.presentation;
				}
				if (!original || appearanceEd.changed()) {
					const appearance = appearanceEd.current();
					if (appearance.length > 0) {
						next.appearance = appearance;
					} else {
						delete next.appearance;
					}
				}
				if (!original || mini.changed()) {
					const filter = mini.current();
					if (filter.length > 0) {
						next.filter = filter;
					} else {
						delete next.filter;
					}
				}
				if (!original || fieldsEd.changed()) {
					const fields = fieldsEd.current();
					if (fields.length > 0) {
						next.fields = fields;
					} else {
						delete next.fields;
					}
				}
				const useIn = {};
				let hasUseIn = false;
				for (const flag of CA_USE_IN) {
					if (useInSelects[flag.key].value) {
						useIn[flag.key] = useInSelects[flag.key].value;
						hasUseIn = true;
					}
				}
				if (hasUseIn) {
					next.useIn = useIn;
				} else {
					delete next.useIn;
				}
				if (original) {
					if (!send('dcs/set-appearance-item', { variant: variantName, payload: { path: path, index: index, item: next } })) {
						return BUSY;
					}
					return undefined;
				}
				if (!send('dcs/add-appearance-item', { variant: variantName, payload: { path: path, item: next } })) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	// ---------- панель «Пользовательские поля» (только показ) ----------

	function renderUserFieldsPanel(host, node) {
		host.appendChild(el('div', 'dcs-plate', 'Пользовательские поля доступны только для просмотра.'));
		const items = Array.isArray(node.userFields) ? node.userFields : [];
		if (items.length === 0) {
			emptyNote(host, 'Пользовательских полей нет.');
			return;
		}
		for (const field of items) {
			const details = document.createElement('details');
			details.className = 'dcs-userfield';
			const summary = document.createElement('summary');
			summary.appendChild(el('span', 'dcs-kind', field.kind === 'case' ? 'Поле-выбор' : 'Поле-выражение'));
			summary.appendChild(nameEl('span', 'dcs-userfield-path', field.dataPath || ''));
			if (field.title) {
				summary.appendChild(nameEl('span', 'dcs-tree-name', field.title));
			}
			details.appendChild(summary);
			const bodyEl = el('div', 'dcs-userfield-body');
			if (field.kind === 'case') {
				bodyEl.appendChild(el('div', 'dcs-ro-note', 'Ветвей выбора: ' + (field.casesCount || 0) + '. Выражения ветвей правятся в конфигураторе.'));
			} else {
				bodyEl.appendChild(el('div', 'dcs-userfield-label', 'Детальные записи'));
				bodyEl.appendChild(el('pre', 'dcs-userfield-expr', field.detailExpression || ''));
				bodyEl.appendChild(el('div', 'dcs-userfield-label', 'Итоговые записи'));
				bodyEl.appendChild(el('pre', 'dcs-userfield-expr', field.totalExpression || ''));
			}
			details.appendChild(bodyEl);
			host.appendChild(details);
		}
	}

	return Object.freeze({ focusGridRow, renderNodePanels, settingsPickable });
};
