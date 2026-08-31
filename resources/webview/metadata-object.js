(function () {
	'use strict';

	/** @type {HTMLElement | null} */
	const initialEl = document.getElementById('metadata-object-initial');
	const raw = initialEl ? initialEl.textContent : '{}';
	/** @type {{tabs?: Array<{id:string,title:string,count?:number,render:string,data?:unknown}>, warnings?: string[], internalName?: string, objectKind?: string, objectKindLabel?: string, objectType?: string, synonymRu?: string, comment?: string, objectXmlPath?: string, technicalJson?: string}} */
	let model = {};
	try {
		model = JSON.parse(raw || '{}');
	} catch {
		model = {};
	}

	/** @type {HTMLElement | null} */
	const tabsRoot = document.getElementById('tabs');
	/** @type {HTMLElement | null} */
	const contentRoot = document.getElementById('content');
	/** @type {HTMLElement | null} */
	const warningsRoot = document.getElementById('warnings');
	/** @type {HTMLElement | null} */
	const technicalRoot = document.getElementById('technical');
	/** @type {HTMLElement | null} */
	const technicalJsonRoot = document.getElementById('technicalJson');
	/** @type {HTMLButtonElement | null} */
	const toggleTechnicalButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('toggleTechnical'));

	const tabs = Array.isArray(model.tabs) ? model.tabs : [];
	let activeTabId =
		model.initialTabId && tabs.some((tab) => tab.id === model.initialTabId)
			? model.initialTabId
			: tabs[0]
				? tabs[0].id
				: '';
	let technicalVisible = false;

	const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
	const editable = model.editable && typeof model.editable === 'object' ? model.editable : null;
	let editedProps = editable ? deepClone(editable.props) : null;
	let editedStructure =
		model.structureLists && structureEditable(model.structureLists)
			? structureEditsFromLists(model.structureLists)
			: null;
	let editFilter = '';

	/** Синоним из имени по правилу 1С: «ВалютаБанка» → «Валюта банка», «БИКБанка» → «БИК банка». */
	function synonymFromName(name) {
		const text = String(name || '').trim();
		if (!text) {
			return '';
		}
		const words = [];
		let current = '';
		const isUpper = (ch) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();
		const isLower = (ch) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();
		const isDigit = (ch) => ch >= '0' && ch <= '9';
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (ch === '_') {
				if (current) {
					words.push(current);
					current = '';
				}
				continue;
			}
			if (current) {
				const prev = current[current.length - 1];
				const next = i + 1 < text.length ? text[i + 1] : '';
				const boundary =
					(isUpper(ch) && isLower(prev)) ||
					(isDigit(ch) !== isDigit(prev)) ||
					(isUpper(ch) && isUpper(prev) && next && isLower(next));
				if (boundary) {
					words.push(current);
					current = '';
				}
			}
			current += ch;
		}
		if (current) {
			words.push(current);
		}
		return words
			.map((word, idx) => {
				if (idx === 0) {
					return word;
				}
				const isAbbrev = word.length > 1 && word === word.toUpperCase() && !isDigit(word[0]);
				return isAbbrev ? word : word.toLowerCase();
			})
			.join(' ');
	}

	/** Правится хотя бы один список состава. */
	function structureEditable(lists) {
		const items = lists && Array.isArray(lists.lists) ? lists.lists : [];
		return items.some((list) => list.editable);
	}

	function structRowFrom(r) {
		const item = typeof r === 'object' && r !== null ? r : {};
		return {
			originalName: typeof item.name === 'string' ? item.name : '',
			name: typeof item.name === 'string' ? item.name : '',
			synonymRu: typeof item.synonymRu === 'string' ? item.synonymRu : '',
			baselineSynonymRu: typeof item.synonymRu === 'string' ? item.synonymRu : '',
			comment: typeof item.comment === 'string' ? item.comment : '',
			deleted: false,
		};
	}

	function structureEditsFromLists(lists) {
		const items = Array.isArray(lists.lists) ? lists.lists : [];
		return {
			lists: items
				.filter((list) => list.editable)
				.map((list) => ({
					kind: list.key,
					title: list.title,
					addLabel: list.addLabel,
					rows: (Array.isArray(list.rows) ? list.rows : []).map(structRowFrom),
				})),
			tabularSections: (Array.isArray(lists.tabularSections) ? lists.tabularSections : []).map(function (t) {
				const row = structRowFrom(t);
				row.attributes = (Array.isArray(t.attributes) ? t.attributes : []).map(structRowFrom);
				return row;
			}),
		};
	}

	function eachStructRow(fn) {
		if (!editedStructure) {
			return;
		}
		for (const list of editedStructure.lists) {
			for (const row of list.rows) {
				fn(row);
			}
		}
		for (const ts of editedStructure.tabularSections) {
			fn(ts);
			for (const row of ts.attributes) {
				fn(row);
			}
		}
	}

	function structRowDirty(row) {
		return row.deleted || !row.originalName || row.name !== row.originalName || row.synonymRu !== row.baselineSynonymRu;
	}

	function structOrderKey(structure) {
		if (!structure) {
			return '';
		}
		const attr = structure.lists
			.map((list) => list.kind + ':' + list.rows.map((row) => row.originalName || '+').join(','))
			.join('|');
		const ts = structure.tabularSections
			.map((t) => (t.originalName || '+') + ':' + t.attributes.map((row) => row.originalName || '+').join(','))
			.join('|');
		return attr + '#' + ts;
	}

	let structBaselineOrderKey = structOrderKey(editedStructure);

	function isStructDirty() {
		let dirty = false;
		eachStructRow(function (row) {
			if (structRowDirty(row)) {
				dirty = true;
			}
		});
		return dirty || structOrderKey(editedStructure) !== structBaselineOrderKey;
	}

	const STRUCT_NAME_RE = /^[A-Za-zА-ЯЁа-яё_][A-Za-zА-ЯЁа-яё0-9_]*$/;

	function structNameValid(name) {
		return STRUCT_NAME_RE.test(String(name || '').trim());
	}

	/** Первая ошибка имён структуры или пустая строка. */
	function structValidationError() {
		if (!editedStructure) {
			return '';
		}
		const topSeen = new Set();
		const listRows = editedStructure.lists.flatMap((list) => list.rows);
		for (const row of [...listRows, ...editedStructure.tabularSections]) {
			if (row.deleted) {
				continue;
			}
			if (!structNameValid(row.name)) {
				return 'Исправьте некорректные имена';
			}
			const key = row.name.trim().toLowerCase();
			if (topSeen.has(key)) {
				return `Дублируется имя «${row.name.trim()}»`;
			}
			topSeen.add(key);
		}
		for (const ts of editedStructure.tabularSections) {
			if (ts.deleted) {
				continue;
			}
			const nestedSeen = new Set();
			for (const row of ts.attributes) {
				if (row.deleted) {
					continue;
				}
				if (!structNameValid(row.name)) {
					return 'Исправьте некорректные имена';
				}
				const key = row.name.trim().toLowerCase();
				if (nestedSeen.has(key)) {
					return `Дублируется имя «${row.name.trim()}» в ТЧ «${ts.name}»`;
				}
				nestedSeen.add(key);
			}
		}
		return '';
	}

	function serializeStructureEdits() {
		if (!editedStructure || !isStructDirty()) {
			return null;
		}
		const rowOut = function (row) {
			return {
				originalName: row.originalName || undefined,
				name: String(row.name || '').trim(),
				synonymRu: row.synonymRu,
				deleted: Boolean(row.deleted),
			};
		};
		return {
			lists: editedStructure.lists.map((list) => ({ kind: list.kind, rows: list.rows.map(rowOut) })),
			tabularSections: editedStructure.tabularSections.map(function (ts) {
				const out = rowOut(ts);
				out.attributes = ts.attributes.map(rowOut);
				return out;
			}),
		};
	}
	let saving = false;
	let saveError = '';
	let savedFlash = false;

	function deepClone(value) {
		return JSON.parse(JSON.stringify(value ?? null));
	}

	function getPath(source, path) {
		let current = source;
		for (const part of String(path).split('.')) {
			if (typeof current !== 'object' || current === null) {
				return undefined;
			}
			current = current[part];
		}
		return current;
	}

	function setPath(target, path, value) {
		const parts = String(path).split('.');
		let current = target;
		for (const part of parts.slice(0, -1)) {
			if (typeof current[part] !== 'object' || current[part] === null) {
				return;
			}
			current = current[part];
		}
		current[parts[parts.length - 1]] = value;
	}

	function editableFields() {
		const out = [];
		if (!editable || !Array.isArray(editable.tabs)) {
			return out;
		}
		for (const tab of editable.tabs) {
			for (const group of tab.groups || []) {
				for (const field of group.fields || []) {
					if (!field.readonly && field.control !== 'staticList' && field.path) {
						out.push(field);
					}
				}
			}
		}
		return out;
	}

	function normalizeForCompare(value) {
		// Составное значение сравнивается по содержимому: editedProps - копия
		// editable.props, у копии другие ссылки, и сравнение по ссылке считало бы
		// поле изменённым сразу после открытия. Так вело себя поле «Тип».
		if (value !== null && typeof value === 'object') {
			return JSON.stringify(value);
		}
		return value === undefined || value === '' ? null : value;
	}

	/** Изменённое участие в подсистемах: путь XML подсистемы → членство. */
	const editedSubsystems = new Map();

	/** Изменённый состав: «секция ссылка» → членство. */
	const editedContent = new Map();

	/** Изменённая видимость команд подсистемы: команда → флажок. */
	const editedCommandVisibility = new Map();

	/** Изменённое размещение команд: команда → группа. */
	const editedCommandPlacement = new Map();

	/** Изменённый порядок команд: копия списка после первой перестановки. */
	let editedCommandOrder = null;

	/** Изменённый порядок подсистем и групп командного интерфейса. */
	let editedSubsystemsOrder = null;
	let editedGroupsOrder = null;

	/** Стрелки порядка тем же видом, что в списках состава. */
	function moveButtons(index, total, move) {
		const actions = document.createElement('span');
		actions.className = 'struct-actions-inline';
		for (const spec of [
			['↑', -1, 'Вверх'],
			['↓', 1, 'Вниз'],
		]) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'struct-btn';
			btn.textContent = spec[0];
			btn.title = spec[2];
			const target = index + spec[1];
			btn.disabled = target < 0 || target >= total;
			btn.addEventListener('click', function () {
				move(index, target);
			});
			actions.appendChild(btn);
		}
		return actions;
	}

	function orderListDirty(edited, base) {
		if (!edited) {
			return false;
		}
		return edited.some((value, index) => (base || [])[index] !== value);
	}

	function commandPlacementGroup(entry) {
		return editedCommandPlacement.has(entry.command)
			? editedCommandPlacement.get(entry.command)
			: entry.group;
	}

	function setCommandPlacement(entry, group) {
		if (group === entry.group) {
			editedCommandPlacement.delete(entry.command);
		} else {
			editedCommandPlacement.set(entry.command, group);
		}
	}

	function commandOrderDirty() {
		if (!editedCommandOrder || !model.commandInterface) {
			return false;
		}
		const base = model.commandInterface.order || [];
		return editedCommandOrder.some((entry, index) => base[index] && base[index].command !== entry.command);
	}

	function commandVisibilityBaseline(command) {
		const model_ = model.commandInterface;
		const entry = model_ && model_.visibility.find((item) => item.command === command);
		return entry ? entry.common : false;
	}

	function commandVisibilityChecked(command) {
		return editedCommandVisibility.has(command)
			? editedCommandVisibility.get(command)
			: commandVisibilityBaseline(command);
	}

	function toggleCommandVisibility(command, common) {
		if (common === commandVisibilityBaseline(command)) {
			editedCommandVisibility.delete(command);
		} else {
			editedCommandVisibility.set(command, common);
		}
	}

	/** Изменённые права роли: «объект право» → выдано. */
	const editedRoleRights = new Map();

	/** Изменённые флаги прав по умолчанию роли. */
	const editedRoleFlags = new Map();

	function roleFlagBaseline(name) {
		return Boolean(model.roleRights && model.roleRights[name]);
	}

	function roleFlagChecked(name) {
		return editedRoleFlags.has(name) ? editedRoleFlags.get(name) : roleFlagBaseline(name);
	}

	function toggleRoleFlag(name, value) {
		if (value === roleFlagBaseline(name)) {
			editedRoleFlags.delete(name);
		} else {
			editedRoleFlags.set(name, value);
		}
	}

	/** Право тянет зависимые, как конфигуратор: изменение и удаление требуют чтения. */
	function applyRightDependencies(objectName, rightName, value) {
		const set = (name, v) => toggleRoleRight(objectName, name, v);
		if (value) {
			if (rightName === 'Update' || rightName === 'Delete') {
				set('Read', true);
			}
			if (rightName === 'Posting' || rightName === 'UndoPosting') {
				set('Update', true);
				set('Read', true);
			}
			if (rightName === 'InteractiveInsert') {
				set('Insert', true);
			}
			if (rightName === 'InteractiveDelete' || rightName === 'InteractiveDeleteMarked') {
				set('Delete', true);
				set('Read', true);
			}
		} else {
			if (rightName === 'Read') {
				for (const dependent of ['Update', 'Delete', 'Posting', 'UndoPosting', 'InteractiveDelete', 'InteractiveDeleteMarked']) {
					set(dependent, false);
				}
			}
			if (rightName === 'Update') {
				set('Posting', false);
				set('UndoPosting', false);
			}
			if (rightName === 'Insert') {
				set('InteractiveInsert', false);
			}
			if (rightName === 'Delete') {
				set('InteractiveDelete', false);
				set('InteractiveDeleteMarked', false);
			}
		}
	}

	function roleRightKey(objectName, rightName) {
		return objectName + ' ' + rightName;
	}

	function roleRightBaseline(objectName, rightName) {
		const model_ = model.roleRights;
		const object = model_ && model_.objects.find((item) => item.name === objectName);
		const right = object && object.rights.find((item) => item.name === rightName);
		return right ? right.value : false;
	}

	function roleRightChecked(objectName, rightName) {
		const key = roleRightKey(objectName, rightName);
		return editedRoleRights.has(key) ? editedRoleRights.get(key) : roleRightBaseline(objectName, rightName);
	}

	function toggleRoleRight(objectName, rightName, value) {
		const key = roleRightKey(objectName, rightName);
		if (value === roleRightBaseline(objectName, rightName)) {
			editedRoleRights.delete(key);
		} else {
			editedRoleRights.set(key, value);
		}
	}

	function contentEditKey(sectionKey, ref) {
		return sectionKey + ' ' + ref;
	}

	function contentBaselineChecked(section, ref) {
		return Array.isArray(section.refs) && section.refs.includes(ref);
	}

	function contentBaselineMode(section, ref) {
		if (!section.modes) {
			return '';
		}
		return section.modes.byRef[ref] || section.modes.defaultValue;
	}

	function setContentEdit(section, ref, member, mode) {
		const key = contentEditKey(section.key, ref);
		const sameMember = member === contentBaselineChecked(section, ref);
		const sameMode = !section.modes || mode === contentBaselineMode(section, ref);
		if (sameMember && sameMode) {
			editedContent.delete(key);
		} else {
			editedContent.set(key, { member, mode });
		}
	}

	function contentEdit(section, ref) {
		const key = contentEditKey(section.key, ref);
		if (editedContent.has(key)) {
			return editedContent.get(key);
		}
		return { member: contentBaselineChecked(section, ref), mode: contentBaselineMode(section, ref) };
	}

	function contentChecked(section, ref) {
		return contentEdit(section, ref).member;
	}

	/** Флажок вернулся к исходному: правка не считается. */
	function toggleSubsystem(node, member) {
		if (member === node.member) {
			editedSubsystems.delete(node.xmlPath);
		} else {
			editedSubsystems.set(node.xmlPath, member);
		}
	}

	function subsystemChecked(node) {
		return editedSubsystems.has(node.xmlPath) ? editedSubsystems.get(node.xmlPath) : node.member;
	}

	function isDirty() {
		if (!editable || !editedProps) {
			return false;
		}
		if (
			editedSubsystems.size > 0 ||
			editedContent.size > 0 ||
			editedCommandVisibility.size > 0 ||
			editedCommandPlacement.size > 0 ||
			commandOrderDirty() ||
			orderListDirty(editedSubsystemsOrder, model.commandInterface && model.commandInterface.subsystemsOrder) ||
			orderListDirty(editedGroupsOrder, model.commandInterface && model.commandInterface.groupsOrder) ||
			editedRoleRights.size > 0 ||
			editedRoleFlags.size > 0
		) {
			return true;
		}
		for (const field of editableFields()) {
			if (normalizeForCompare(getPath(editedProps, field.path)) !== normalizeForCompare(getPath(editable.props, field.path))) {
				return true;
			}
		}
		return isStructDirty();
	}

	function fieldEnabled(field) {
		if (!Array.isArray(field.enabledWhen)) {
			return true;
		}
		return field.enabledWhen.every((cond) => getPath(editedProps, cond.path) === cond.equals);
	}
	const genericValueLabels = {
		Use: 'Использовать',
		DontUse: 'Не использовать',
		Auto: 'Авто',
		Managed: 'Управляемый',
		Directly: 'Непосредственно',
		Begin: 'С начала',
		BothWays: 'Оба способа',
		String: 'Строка',
		Number: 'Число',
		Variable: 'Переменная',
		Fixed: 'Фиксированная',
		Items: 'Элементы',
		Folders: 'Группы',
		FoldersAndItems: 'Группы и элементы',
		ToItems: 'К элементам',
		ToFolders: 'К группам',
		ToFoldersAndItems: 'К группам и элементам',
		AsDescription: 'Как наименование',
		AsCode: 'Как код',
		WholeCatalog: 'Во всем справочнике',
		Adopted: 'Заимствованный',
		HierarchyFoldersAndItems: 'Иерархия групп и элементов',
	};
	const refKindLabels = {
		Catalog: 'Справочник',
		CatalogRef: 'Справочник',
		Document: 'Документ',
		DocumentRef: 'Документ',
		DocumentJournal: 'Журнал документов',
		DocumentJournalRef: 'Журнал документов',
		Enum: 'Перечисление',
		EnumRef: 'Перечисление',
		Report: 'Отчет',
		ReportRef: 'Отчет',
		DataProcessor: 'Обработка',
		DataProcessorRef: 'Обработка',
		InformationRegister: 'Регистр сведений',
		InformationRegisterRef: 'Регистр сведений',
		AccumulationRegister: 'Регистр накопления',
		AccumulationRegisterRef: 'Регистр накопления',
		AccountingRegister: 'Регистр бухгалтерии',
		AccountingRegisterRef: 'Регистр бухгалтерии',
		CalculationRegister: 'Регистр расчета',
		CalculationRegisterRef: 'Регистр расчета',
		ChartOfAccounts: 'План счетов',
		ChartOfAccountsRef: 'План счетов',
		ChartOfCharacteristicTypes: 'План видов характеристик',
		ChartOfCharacteristicTypesRef: 'План видов характеристик',
		ChartOfCalculationTypes: 'План видов расчета',
		ChartOfCalculationTypesRef: 'План видов расчета',
		BusinessProcess: 'Бизнес-процесс',
		BusinessProcessRef: 'Бизнес-процесс',
		Task: 'Задача',
		TaskRef: 'Задача',
		ExchangePlan: 'План обмена',
		ExchangePlanRef: 'План обмена',
		CommonModule: 'Общий модуль',
		CommonModuleRef: 'Общий модуль',
		Subsystem: 'Подсистема',
		SubsystemRef: 'Подсистема',
		Constant: 'Константа',
		ConstantRef: 'Константа',
	};

	function renderWarnings() {
		if (!warningsRoot) {
			return;
		}
		const warnings = Array.isArray(model.warnings) ? model.warnings : [];
		if (warnings.length === 0) {
			warningsRoot.classList.add('hidden');
			warningsRoot.innerHTML = '';
			return;
		}
		warningsRoot.classList.remove('hidden');
		warningsRoot.innerHTML = warnings
			.map((warning) => `<div class="warning-item">${escapeHtml(String(warning))}</div>`)
			.join('');
	}

	function renderTabs() {
		if (!tabsRoot) {
			return;
		}
		tabsRoot.innerHTML = '';
		for (const tab of tabs) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
			const countText = typeof tab.count === 'number' ? ` (${tab.count})` : '';
			button.textContent = `${tab.title}${countText}`;
			button.addEventListener('click', function () {
				activeTabId = tab.id;
				renderTabs();
				renderContent();
			});
			tabsRoot.appendChild(button);
		}
	}

	function renderContent() {
		if (!contentRoot) {
			return;
		}
		const tab = tabs.find((item) => item.id === activeTabId);
		if (!tab) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		switch (tab.render) {
			case 'overview':
				renderOverview();
				return;
			case 'edit':
				renderEditTab(tab.id);
				return;
			case 'named':
				renderNamed(tab);
				return;
			case 'tabular':
				renderTabular(tab);
				return;
			case 'list':
				renderList(tab.data);
				return;
			case 'kv':
				renderKv(tab.data);
				return;
			case 'json':
				renderJson(tab.data);
				return;
			case 'subsystemContent':
				renderSubsystemContent(tab.data);
				return;
			case 'subsystems':
				renderSubsystemsTab();
				return;
			case 'refContent':
				renderRefContentTab();
				return;
			case 'commandInterface':
				renderCommandInterfaceTab();
				return;
			case 'roleRights':
				renderRoleRightsTab();
				return;
			default:
				contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
		}
	}

	/** Дерево подсистем с флажками участия: как в конфигураторе. */
	function renderSubsystemsTab() {
		if (!contentRoot) {
			return;
		}
		const modelSubsystems = model.subsystems;
		if (!modelSubsystems || !Array.isArray(modelSubsystems.nodes) || modelSubsystems.nodes.length === 0) {
			contentRoot.innerHTML = '<div class="empty">Подсистем нет.</div>';
			return;
		}
		const readonly = !editable || editable.readonly === true;
		contentRoot.textContent = '';
		const filter = document.createElement('input');
		filter.type = 'text';
		filter.className = 'list-filter';
		filter.placeholder = 'Фильтр по списку...';
		contentRoot.appendChild(filter);
		const tree = document.createElement('div');
		tree.className = 'subsys-tree';
		contentRoot.appendChild(tree);

		/** Строит узел; возвращает корневой элемент и признак совпадения с фильтром. */
		function buildNode(node) {
			const wrap = document.createElement('div');
			wrap.className = 'subsys-node';
			const row = document.createElement('div');
			row.className = 'subsys-row';
			const twist = document.createElement('span');
			twist.className = 'subsys-twist';
			const hasChildren = Array.isArray(node.children) && node.children.length > 0;
			twist.textContent = hasChildren ? '▾' : '';
			row.appendChild(twist);
			const label = document.createElement('label');
			label.className = 'subsys-label';
			const box = document.createElement('input');
			box.type = 'checkbox';
			box.checked = subsystemChecked(node);
			box.disabled = readonly;
			box.addEventListener('change', function () {
				toggleSubsystem(node, box.checked);
				renderSaveBar();
			});
			label.appendChild(box);
			label.appendChild(document.createTextNode(' ' + node.name));
			row.appendChild(label);
			wrap.appendChild(row);
			let childrenBox = null;
			if (hasChildren) {
				childrenBox = document.createElement('div');
				childrenBox.className = 'subsys-children';
				for (const child of node.children) {
					childrenBox.appendChild(buildNode(child).element);
				}
				wrap.appendChild(childrenBox);
				twist.classList.add('clickable');
				twist.addEventListener('click', function () {
					const collapsed = childrenBox.classList.toggle('collapsed');
					twist.textContent = collapsed ? '▸' : '▾';
				});
			}
			wrap.dataset.name = String(node.name || '').toLowerCase();
			return { element: wrap, childrenBox };
		}

		for (const node of modelSubsystems.nodes) {
			tree.appendChild(buildNode(node).element);
		}

		filter.addEventListener('input', function () {
			const needle = String(filter.value || '').trim().toLowerCase();
			// Совпадение показывает узел и всех его предков; пустой фильтр - всё
			function apply(el) {
				let visible = !needle || el.dataset.name.includes(needle);
				const childrenBox = el.querySelector(':scope > .subsys-children');
				if (childrenBox) {
					for (const child of childrenBox.querySelectorAll(':scope > .subsys-node')) {
						if (apply(child)) {
							visible = true;
						}
					}
					if (needle) {
						childrenBox.classList.remove('collapsed');
					}
				}
				el.classList.toggle('hidden', !visible);
				return visible;
			}
			for (const root of tree.querySelectorAll(':scope > .subsys-node')) {
				apply(root);
			}
		});
	}

	/** Подписи стандартных команд: полное имя остаётся в подсказке. */
	const STANDARD_COMMAND_LABELS = new Map([
		['OpenList', 'Открыть список'],
		['Open', 'Открыть'],
		['Create', 'Создать'],
		['CreateFolder', 'Создать группу'],
	]);

	/** Подписи групп командного интерфейса; пользовательская группа остаётся именем. */
	const COMMAND_GROUP_LABELS = new Map([
		['NavigationPanelImportant', 'Панель навигации: Важное'],
		['NavigationPanelOrdinary', 'Панель навигации: Обычное'],
		['NavigationPanelSeeAlso', 'Панель навигации: См. также'],
		['ActionsPanelCreate', 'Панель действий: Создать'],
		['ActionsPanelReports', 'Панель действий: Отчеты'],
		['ActionsPanelTools', 'Панель действий: Сервис'],
	]);

	function commandGroupCaption(group) {
		const known = COMMAND_GROUP_LABELS.get(group);
		if (known) {
			return known;
		}
		const parts = String(group).split('.');
		if (parts[0] === 'CommandGroup' && parts[1]) {
			return 'Группа: ' + parts[1];
		}
		return group;
	}

	/** Командный интерфейс подсистемы: флажки общей видимости, размещение списком. */
	function renderCommandInterfaceTab() {
		if (!contentRoot) {
			return;
		}
		const model_ = model.commandInterface;
		if (!model_ || (model_.visibility.length === 0 && model_.placement.length === 0)) {
			contentRoot.innerHTML = '<div class="empty">Настроек командного интерфейса нет.</div>';
			return;
		}
		const readonly = !editable || editable.readonly === true;
		contentRoot.textContent = '';

		function commandCaption(command) {
			const parts = String(command).split('.');
			if (parts.length === 4 && parts[2] === 'StandardCommand') {
				const action = STANDARD_COMMAND_LABELS.get(parts[3]) || parts[3];
				return roleObjectCaption(parts[0] + '.' + parts[1]) + ': ' + action;
			}
			if (parts.length === 2) {
				return roleObjectCaption(command);
			}
			return command;
		}

		if (model_.visibility.length > 0) {
			const title = document.createElement('div');
			title.className = 'section-title';
			title.textContent = 'Видимость команд';
			contentRoot.appendChild(title);
			const tree = document.createElement('div');
			tree.className = 'subsys-tree';
			contentRoot.appendChild(tree);
			for (const entry of model_.visibility) {
				const row = document.createElement('div');
				row.className = 'subsys-row';
				const pad = document.createElement('span');
				pad.className = 'subsys-twist';
				row.appendChild(pad);
				const label = document.createElement('label');
				label.className = 'subsys-label';
				label.title = entry.command;
				const box = document.createElement('input');
				box.type = 'checkbox';
				box.checked = commandVisibilityChecked(entry.command);
				box.disabled = readonly;
				box.addEventListener('change', function () {
					toggleCommandVisibility(entry.command, box.checked);
					renderSaveBar();
				});
				label.appendChild(box);
				label.appendChild(document.createTextNode(' ' + commandCaption(entry.command)));
				row.appendChild(label);
				tree.appendChild(row);
			}
		}
		function namedListSection(title, rows) {
			if (rows.length === 0) {
				return;
			}
			const heading = document.createElement('div');
			heading.className = 'section-title section-title-spaced';
			heading.textContent = title;
			contentRoot.appendChild(heading);
			const list = document.createElement('div');
			list.className = 'struct-list';
			contentRoot.appendChild(list);
			for (const row of rows) {
				const item = document.createElement('div');
				item.className = 'struct-item';
				const name = document.createElement('span');
				name.className = 'struct-item-name';
				name.title = row.hint || row.name;
				name.textContent = row.name;
				item.appendChild(name);
				if (row.value) {
					const value = document.createElement('span');
					value.className = 'struct-item-syn ref-selected-mode';
					value.textContent = row.value;
					item.appendChild(value);
				}
				list.appendChild(item);
			}
		}

		// Размещение: группа панели меняется селектом и пишется своей операцией
		if (model_.placement.length > 0) {
			const heading = document.createElement('div');
			heading.className = 'section-title section-title-spaced';
			heading.textContent = 'Размещение';
			contentRoot.appendChild(heading);
			const list = document.createElement('div');
			list.className = 'struct-list';
			contentRoot.appendChild(list);
			for (const entry of model_.placement) {
				const item = document.createElement('div');
				item.className = 'struct-item';
				const name = document.createElement('span');
				name.className = 'struct-item-name';
				name.title = entry.command;
				name.textContent = commandCaption(entry.command);
				item.appendChild(name);
				const select = document.createElement('select');
				select.className = 'ci-group-select';
				select.disabled = readonly;
				const groups = [...COMMAND_GROUP_LABELS.keys()];
				if (!groups.includes(entry.group)) {
					groups.unshift(entry.group);
				}
				for (const group of groups) {
					const option = document.createElement('option');
					option.value = group;
					option.textContent = commandGroupCaption(group);
					select.appendChild(option);
				}
				select.value = commandPlacementGroup(entry);
				select.addEventListener('change', (function (placementEntry, el) {
					return function () {
						setCommandPlacement(placementEntry, el.value);
						renderSaveBar();
					};
				})(entry, select));
				item.appendChild(select);
				list.appendChild(item);
			}
		}

		// Порядок команд: строки переставляются стрелками, блок пишется целиком
		const orderEntries = editedCommandOrder || model_.order || [];
		if (orderEntries.length > 0) {
			const heading = document.createElement('div');
			heading.className = 'section-title section-title-spaced';
			heading.textContent = 'Порядок команд';
			contentRoot.appendChild(heading);
			const list = document.createElement('div');
			list.className = 'struct-list';
			contentRoot.appendChild(list);
			orderEntries.forEach(function (entry, index) {
				const item = document.createElement('div');
				item.className = 'struct-item';
				const name = document.createElement('span');
				name.className = 'struct-item-name';
				name.title = entry.command;
				name.textContent = commandCaption(entry.command);
				item.appendChild(name);
				const group = document.createElement('span');
				group.className = 'struct-item-syn ref-selected-mode';
				group.textContent = commandGroupCaption(entry.group);
				item.appendChild(group);
				if (!readonly) {
					item.appendChild(
						moveButtons(index, orderEntries.length, function (from, to) {
							if (!editedCommandOrder) {
								editedCommandOrder = (model_.order || []).map((row) => ({ command: row.command, group: row.group }));
							}
							const swap = editedCommandOrder[from];
							editedCommandOrder[from] = editedCommandOrder[to];
							editedCommandOrder[to] = swap;
							renderCommandInterfaceTab();
							renderSaveBar();
						})
					);
				}
				list.appendChild(item);
			});
		}
		reorderableSection(
			'Порядок подсистем',
			editedSubsystemsOrder || model_.subsystemsOrder || [],
			function (ref) {
				const parts = String(ref).split('.');
				return parts[parts.length - 1] || ref;
			},
			function (next) {
				editedSubsystemsOrder = next;
			}
		);
		reorderableSection(
			'Порядок групп',
			editedGroupsOrder || model_.groupsOrder || [],
			commandGroupCaption,
			function (next) {
				editedGroupsOrder = next;
			}
		);

		/** Список строк со стрелками: порядок правится, содержимое не меняется. */
		function reorderableSection(title, values, captionOf, apply) {
			if (values.length === 0) {
				return;
			}
			const heading = document.createElement('div');
			heading.className = 'section-title section-title-spaced';
			heading.textContent = title;
			contentRoot.appendChild(heading);
			const list = document.createElement('div');
			list.className = 'struct-list';
			contentRoot.appendChild(list);
			values.forEach(function (value, index) {
				const item = document.createElement('div');
				item.className = 'struct-item';
				const name = document.createElement('span');
				name.className = 'struct-item-name';
				name.title = value;
				name.textContent = captionOf(value);
				item.appendChild(name);
				if (!readonly) {
					item.appendChild(
						moveButtons(index, values.length, function (from, to) {
							const next = values.slice();
							const swap = next[from];
							next[from] = next[to];
							next[to] = swap;
							apply(next);
							renderCommandInterfaceTab();
							renderSaveBar();
						})
					);
				}
				list.appendChild(item);
			});
		}
	}

	/** Подписи прав: полное имя права остаётся в подсказке. */
	const RIGHT_LABELS = new Map([
		['Read', 'Чтение'],
		['Insert', 'Добавление'],
		['Update', 'Изменение'],
		['Delete', 'Удаление'],
		['View', 'Просмотр'],
		['Edit', 'Редактирование'],
		['InteractiveInsert', 'Интерактивное добавление'],
		['InteractiveDelete', 'Интерактивное удаление'],
		['InteractiveSetDeletionMark', 'Интерактивная пометка удаления'],
		['InteractiveClearDeletionMark', 'Интерактивное снятие пометки удаления'],
		['InteractiveDeleteMarked', 'Интерактивное удаление помеченных'],
		['Posting', 'Проведение'],
		['UndoPosting', 'Отмена проведения'],
		['InteractivePosting', 'Интерактивное проведение'],
		['InteractivePostingRegular', 'Интерактивное проведение неоперативное'],
		['InteractiveUndoPosting', 'Интерактивная отмена проведения'],
		['InteractiveChangeOfPosted', 'Интерактивное изменение проведенных'],
		['InputByString', 'Ввод по строке'],
		['TotalsControl', 'Управление итогами'],
		['Use', 'Использование'],
		['Get', 'Получение'],
		['Set', 'Установка'],
		['Start', 'Старт'],
		['InteractiveStart', 'Интерактивный старт'],
		['InteractiveActivate', 'Интерактивная активация'],
		['Execute', 'Выполнение'],
		['InteractiveExecute', 'Интерактивное выполнение'],
		['Output', 'Вывод'],
		['Administration', 'Администрирование'],
		['DataAdministration', 'Администрирование данных'],
		['UpdateDataBaseConfiguration', 'Обновление конфигурации базы данных'],
		['ConfigurationExtensionsAdministration', 'Администрирование расширений конфигурации'],
		['ExclusiveMode', 'Монопольный режим'],
		['ActiveUsers', 'Активные пользователи'],
		['EventLog', 'Журнал регистрации'],
		['ThinClient', 'Тонкий клиент'],
		['WebClient', 'Веб-клиент'],
		['MobileClient', 'Мобильный клиент'],
		['ThickClient', 'Толстый клиент'],
		['ExternalConnection', 'Внешнее соединение'],
		['Automation', 'Automation'],
		['AllFunctionsMode', 'Режим «Все функции»'],
		['TechnicalSpecialistMode', 'Режим технического специалиста'],
		['SaveUserData', 'Сохранение данных пользователя'],
		['InteractiveOpenExtDataProcessors', 'Интерактивное открытие внешних обработок'],
		['InteractiveOpenExtReports', 'Интерактивное открытие внешних отчетов'],
		['SessionOsAuthenticationChange', 'Изменение ОС-аутентификации сеанса'],
		['SessionStandardAuthenticationChange', 'Изменение стандартной аутентификации сеанса'],
		['ReadDataHistory', 'Чтение истории данных'],
		['ReadDataHistoryOfMissingData', 'Чтение истории отсутствующих данных'],
		['UpdateDataHistory', 'Изменение истории данных'],
		['UpdateDataHistoryOfMissingData', 'Изменение истории отсутствующих данных'],
		['UpdateDataHistorySettings', 'Изменение настроек истории данных'],
		['UpdateDataHistoryVersionComment', 'Изменение комментария версии истории данных'],
		['ViewDataHistory', 'Просмотр истории данных'],
		['EditDataHistoryVersionComment', 'Редактирование комментария версии истории данных'],
		['SwitchToDataHistoryVersion', 'Переход на версию истории данных'],
		['CollaborationSystemInfoBaseRegistration', 'Регистрация информационной базы системы взаимодействия'],
		['MainWindowModeNormal', 'Основной режим окна: обычный'],
		['MainWindowModeWorkplace', 'Основной режим окна: рабочее место'],
		['MainWindowModeEmbeddedWorkplace', 'Основной режим окна: встроенное рабочее место'],
		['MainWindowModeFullscreenWorkplace', 'Основной режим окна: полноэкранное рабочее место'],
		['MainWindowModeKiosk', 'Основной режим окна: киоск'],
		['AnalyticsSystemClient', 'Клиент системы аналитики'],
		['ExternalSourceTableFullAccess', 'Полный доступ к таблице внешнего источника'],
	]);

	/** Служебные сегменты пути права: в подписи остаются только имена. */
	const RIGHT_PATH_TOKENS = new Set([
		'Attribute',
		'StandardAttribute',
		'TabularSection',
		'StandardTabularSection',
		'Dimension',
		'Resource',
		'Command',
		'Form',
		'Template',
		'EnumValue',
		'AddressingAttribute',
		'AccountingFlag',
		'ExtDimensionAccountingFlag',
		'Recalculation',
		'Operation',
		'Field',
		'Table',
		'Cube',
		'DimensionTable',
		'URLTemplate',
	]);

	/** Виды, встречающиеся в правах, но не в ссылочных составах. */
	const RIGHT_KIND_LABELS = {
		Configuration: 'Конфигурация',
		SessionParameter: 'Параметр сеанса',
		CommonAttribute: 'Общий реквизит',
		CommonForm: 'Общая форма',
		CommonCommand: 'Общая команда',
		FilterCriterion: 'Критерий отбора',
		DocumentNumerator: 'Нумератор',
		Sequence: 'Последовательность',
		ScheduledJob: 'Регламентное задание',
		WebService: 'Web-сервис',
		HTTPService: 'HTTP-сервис',
		IntegrationService: 'Сервис интеграции',
		ExternalDataSource: 'Внешний источник данных',
		SettingsStorage: 'Хранилище настроек',
	};

	/** «Catalog.Номенклатура.Attribute.Артикул» → «Справочник: Номенклатура.Артикул». */
	function roleObjectCaption(name) {
		const parts = String(name).split('.');
		if (parts.length < 2) {
			return RIGHT_KIND_LABELS[parts[0]] || name;
		}
		const label = RIGHT_KIND_LABELS[parts[0]] || refKindLabels[parts[0]];
		const names = parts.slice(1).filter((part) => !RIGHT_PATH_TOKENS.has(part));
		return (label ? label + ': ' : parts[0] + '.') + names.join('.');
	}

	/** Колонки кросс-таблицы прав: имя в файле и короткая подпись шапки. */
	const RIGHT_COLUMNS = [
		['Read', 'Чтение'],
		['Insert', 'Добавление'],
		['Update', 'Изменение'],
		['Delete', 'Удаление'],
		['Posting', 'Проведение'],
		['UndoPosting', 'Отмена проведения'],
		['View', 'Просмотр'],
		['Edit', 'Редактирование'],
		['Use', 'Использование'],
		['InteractiveInsert', 'Инт. добавление'],
		['InteractiveDelete', 'Инт. удаление'],
		['InteractiveSetDeletionMark', 'Пометка удаления'],
		['InteractiveClearDeletionMark', 'Снятие пометки'],
		['InteractiveDeleteMarked', 'Удаление помеченных'],
		['InputByString', 'Ввод по строке'],
		['TotalsControl', 'Управление итогами'],
	];

	/** Строк в таблице за раз: дальше просят уточнить фильтр. */
	const RIGHTS_ROW_CAP = 1000;

	/** Состояние фильтров вкладки прав: живёт, пока открыта панель. */
	const rightsFilter = { query: '', showAll: false, tag: '' };

	/** Права роли: кросс-таблица, строки - объекты конфигурации, колонки - права. */
	function renderRoleRightsTab() {
		if (!contentRoot) {
			return;
		}
		const model_ = model.roleRights;
		if (!model_) {
			contentRoot.innerHTML = '<div class="empty">Файл прав не прочитан.</div>';
			return;
		}
		const readonly = !editable || editable.readonly === true;
		contentRoot.textContent = '';

		const flags = document.createElement('div');
		flags.className = 'struct-list';
		const flagRows = [
			['setForNewObjects', 'Устанавливать права для новых объектов'],
			['setForAttributesByDefault', 'Устанавливать права для реквизитов и табличных частей по умолчанию'],
			['independentRightsOfChildObjects', 'Независимые права подчиненных объектов'],
		];
		for (const pair of flagRows) {
			const item = document.createElement('div');
			item.className = 'struct-item';
			const label = document.createElement('label');
			label.className = 'rights-toggle struct-item-name';
			const box = document.createElement('input');
			box.type = 'checkbox';
			box.checked = roleFlagChecked(pair[0]);
			box.disabled = readonly;
			box.addEventListener('change', function () {
				toggleRoleFlag(pair[0], box.checked);
				renderSaveBar();
			});
			label.appendChild(box);
			label.appendChild(document.createTextNode(' ' + pair[1]));
			item.appendChild(label);
			flags.appendChild(item);
		}
		contentRoot.appendChild(flags);

		// Выданные права из файла: объект -> право -> значение
		const grantedByObject = new Map();
		for (const object of model_.objects || []) {
			const rights = new Map();
			for (const right of object.rights || []) {
				rights.set(right.name, right.value);
			}
			grantedByObject.set(object.name, rights);
		}

		// Строки: конфигурация, все объекты по видам, затем ссылки из файла вне списка
		const rows = [];
		rows.push({ name: 'Configuration', caption: 'Конфигурация', tag: 'Configuration' });
		const allObjects = model_.allObjects || {};
		const tags = Object.keys(allObjects).sort(function (a, b) {
			return roleObjectCaption(a + '.x').localeCompare(roleObjectCaption(b + '.x'), 'ru');
		});
		for (const tag of tags) {
			for (const name of allObjects[tag] || []) {
				rows.push({ name: tag + '.' + name, caption: roleObjectCaption(tag + '.' + name), tag });
			}
		}
		const known = new Set(rows.map(function (row) { return row.name; }));
		for (const object of model_.objects || []) {
			if (!known.has(object.name)) {
				rows.push({ name: object.name, caption: roleObjectCaption(object.name), tag: object.name.split('.')[0] });
			}
		}

		const controls = document.createElement('div');
		controls.className = 'rights-controls';
		const filter = document.createElement('input');
		filter.type = 'text';
		filter.className = 'list-filter';
		filter.placeholder = 'Фильтр по списку...';
		filter.value = rightsFilter.query;
		controls.appendChild(filter);
		const toggle = document.createElement('label');
		toggle.className = 'rights-toggle';
		const toggleBox = document.createElement('input');
		toggleBox.type = 'checkbox';
		toggleBox.checked = rightsFilter.showAll;
		toggle.appendChild(toggleBox);
		toggle.appendChild(document.createTextNode(' Все объекты'));
		controls.appendChild(toggle);
		const tagSelect = document.createElement('select');
		const anyOption = document.createElement('option');
		anyOption.value = '';
		anyOption.textContent = 'Все виды';
		tagSelect.appendChild(anyOption);
		for (const tag of tags) {
			const option = document.createElement('option');
			option.value = tag;
			option.textContent = roleObjectCaption(tag + '.x').replace(/: .*$/, '');
			tagSelect.appendChild(option);
		}
		tagSelect.value = rightsFilter.tag;
		controls.appendChild(tagSelect);
		contentRoot.appendChild(controls);

		const box = document.createElement('div');
		box.className = 'rights-table-box';
		contentRoot.appendChild(box);
		const note = document.createElement('div');
		note.className = 'empty';
		contentRoot.appendChild(note);

		function objectHasAnyRight(name) {
			const granted = grantedByObject.get(name);
			if (granted) {
				for (const value of granted.values()) {
					if (value) {
						return true;
					}
				}
			}
			// Правка в панели тоже делает строку «с правами»
			for (const key of editedRoleRights.keys()) {
				if (key.startsWith(name + ' ') && editedRoleRights.get(key)) {
					return true;
				}
			}
			return false;
		}

		function renderTable() {
			const needle = rightsFilter.query.trim().toLowerCase();
			const visible = [];
			for (const row of rows) {
				if (!rightsFilter.showAll && !objectHasAnyRight(row.name)) {
					continue;
				}
				if (rightsFilter.tag && row.tag !== rightsFilter.tag) {
					continue;
				}
				if (needle && !row.caption.toLowerCase().includes(needle) && !row.name.toLowerCase().includes(needle)) {
					continue;
				}
				visible.push(row);
				if (visible.length >= RIGHTS_ROW_CAP) {
					break;
				}
			}
			box.textContent = '';
			note.textContent = '';
			if (visible.length === 0) {
				note.textContent = rightsFilter.showAll
					? 'Ничего не найдено: уточните фильтр.'
					: 'Выданных прав нет. Флажок «Все объекты» показывает всю конфигурацию.';
				return;
			}
			if (visible.length >= RIGHTS_ROW_CAP) {
				note.textContent = 'Показаны первые ' + RIGHTS_ROW_CAP + ' строк: уточните фильтр.';
			}
			const table = document.createElement('table');
			table.className = 'rights-table';
			const thead = document.createElement('thead');
			const head = document.createElement('tr');
			const objectTh = document.createElement('th');
			objectTh.className = 'rights-object-col';
			objectTh.textContent = 'Объект';
			head.appendChild(objectTh);
			for (const column of RIGHT_COLUMNS) {
				const th = document.createElement('th');
				th.textContent = column[1];
				th.title = RIGHT_LABELS.get(column[0]) || column[0];
				head.appendChild(th);
			}
			thead.appendChild(head);
			table.appendChild(thead);
			const tbody = document.createElement('tbody');
			for (const row of visible) {
				const tr = document.createElement('tr');
				const nameTd = document.createElement('td');
				nameTd.className = 'rights-object-col';
				nameTd.title = row.name;
				nameTd.textContent = row.caption;
				tr.appendChild(nameTd);
				for (const column of RIGHT_COLUMNS) {
					const td = document.createElement('td');
					const boxInput = document.createElement('input');
					boxInput.type = 'checkbox';
					boxInput.checked = roleRightChecked(row.name, column[0]);
					boxInput.disabled = readonly;
					boxInput.addEventListener('change', (function (objectName, rightName, input) {
						return function () {
							toggleRoleRight(objectName, rightName, input.checked);
							applyRightDependencies(objectName, rightName, input.checked);
							renderTable();
							renderSaveBar();
						};
					})(row.name, column[0], boxInput));
					td.appendChild(boxInput);
					tr.appendChild(td);
				}
				tbody.appendChild(tr);
			}
			table.appendChild(tbody);
			box.appendChild(table);
			// Права вне колонок (редкие) остаются видны подсказкой
			const extras = [];
			for (const [objectName, rights] of grantedByObject) {
				for (const [rightName, value] of rights) {
					if (value && !RIGHT_COLUMNS.some(function (column) { return column[0] === rightName; })) {
						extras.push(roleObjectCaption(objectName) + ': ' + (RIGHT_LABELS.get(rightName) || rightName));
					}
				}
			}
			if (extras.length > 0 && !note.textContent) {
				note.textContent = 'Вне таблицы: ' + extras.slice(0, 6).join('; ') + (extras.length > 6 ? '…' : '');
			}
		}

		filter.addEventListener('input', function () {
			rightsFilter.query = filter.value || '';
			renderTable();
		});
		toggleBox.addEventListener('change', function () {
			rightsFilter.showAll = toggleBox.checked;
			renderTable();
		});
		tagSelect.addEventListener('change', function () {
			rightsFilter.tag = tagSelect.value;
			renderTable();
		});
		renderTable();
	}

	/** Состав объекта деревом с флажками: секции, группы по видам, реквизиты отдельным списком. */
	function renderRefContentTab() {
		if (!contentRoot) {
			return;
		}
		const refContent = model.refContent;
		const sections = refContent && Array.isArray(refContent.sections) ? refContent.sections : [];
		if (sections.length === 0) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		const readonly = !editable || editable.readonly === true;
		contentRoot.textContent = '';
		const filter = document.createElement('input');
		filter.type = 'text';
		filter.className = 'list-filter';
		filter.placeholder = 'Фильтр по списку...';
		contentRoot.appendChild(filter);

		const labelByTag = new Map();
		for (const section of sections) {
			for (const group of section.groups) {
				labelByTag.set(group.tag, group.label);
			}
		}

		/** Служебные сегменты пути выгрузки: в подписи остаются только имена. */
		const PATH_TOKENS = new Set([
			'Attribute',
			'TabularSection',
			'Dimension',
			'Resource',
			'Command',
			'Form',
			'Template',
			'Column',
			'AccountingFlag',
			'ExtDimensionAccountingFlag',
			'AddressingAttribute',
			'EnumValue',
			'Recalculation',
			'StandardAttribute',
			'Operation',
			'URLTemplate',
		]);

		const KIND_LABEL_BY_TAG = new Map([
			['Subsystem', 'Подсистема'],
			['CommonModule', 'Общий модуль'],
			['CommonForm', 'Общая форма'],
			['CommonCommand', 'Общая команда'],
			['CommonAttribute', 'Общий реквизит'],
			['SessionParameter', 'Параметр сеанса'],
			['Role', 'Роль'],
			['Constant', 'Константа'],
			['Catalog', 'Справочник'],
			['Document', 'Документ'],
			['Enum', 'Перечисление'],
			['Report', 'Отчёт'],
			['DataProcessor', 'Обработка'],
			['ChartOfCharacteristicTypes', 'План видов характеристик'],
			['ChartOfAccounts', 'План счетов'],
			['ChartOfCalculationTypes', 'План видов расчёта'],
			['InformationRegister', 'Регистр сведений'],
			['AccumulationRegister', 'Регистр накопления'],
			['AccountingRegister', 'Регистр бухгалтерии'],
			['CalculationRegister', 'Регистр расчёта'],
			['ExchangePlan', 'План обмена'],
			['BusinessProcess', 'Бизнес-процесс'],
			['Task', 'Задача'],
			['FilterCriterion', 'Критерий отбора'],
			['DocumentJournal', 'Журнал документов'],
			['Sequence', 'Последовательность'],
			['DocumentNumerator', 'Нумератор документов'],
			['FunctionalOption', 'Функциональная опция'],
			['FunctionalOptionsParameter', 'Параметр функциональных опций'],
			['SettingsStorage', 'Хранилище настроек'],
			['WebService', 'Web-сервис'],
			['HTTPService', 'HTTP-сервис'],
			['IntegrationService', 'Сервис интеграции'],
			['CommonTemplate', 'Общий макет'],
			['CommonPicture', 'Общая картинка'],
			['CommandGroup', 'Группа команд'],
			['XDTOPackage', 'XDTO-пакет'],
			['WSReference', 'WS-ссылка'],
			['Style', 'Стиль'],
			['StyleItem', 'Элемент стиля'],
			['Language', 'Язык'],
			['Interface', 'Интерфейс'],
			['Bot', 'Бот'],
			['WebSocketClient', 'WebSocket-клиент'],
			['DefinedType', 'Определяемый тип'],
			['EventSubscription', 'Подписка на событие'],
			['ScheduledJob', 'Регламентное задание'],
			['ExternalDataSource', 'Внешний источник данных'],
			['ExternalReport', 'Внешний отчёт'],
			['ExternalDataProcessor', 'Внешняя обработка'],
		]);

		/** «Document._Демо.TabularSection.Счета.Attribute.Счет» → «Документ: _Демо.Счета.Счет». */
		function refCaption(ref) {
			const parts = String(ref).split('.');
			if (parts.length < 2) {
				return ref;
			}
			const label = labelByTag.get(parts[0]) || KIND_LABEL_BY_TAG.get(parts[0]);
			const names = parts.slice(1).filter((part) => !PATH_TOKENS.has(part));
			return (label ? label + ': ' : parts[0] + '.') + names.join('.');
		}

		const rerenderSelected = [];

		function renderSection(section) {
			if (sections.length > 1) {
				const heading = document.createElement('div');
				heading.className = 'section-title section-title-spaced';
				heading.textContent = section.title;
				contentRoot.appendChild(heading);
			}
			const tree = document.createElement('div');
			tree.className = 'subsys-tree';
			contentRoot.appendChild(tree);
			const selectedBlock = document.createElement('div');
			selectedBlock.className = 'ref-selected';
			const selectedTitle = document.createElement('div');
			selectedTitle.className = 'section-title';
			selectedBlock.appendChild(selectedTitle);
			const selectedList = document.createElement('div');
			selectedList.className = 'struct-list';
			selectedBlock.appendChild(selectedList);
			contentRoot.appendChild(selectedBlock);

			function currentRefs() {
				const refs = new Set(Array.isArray(section.refs) ? section.refs : []);
				for (const [key, edit] of editedContent.entries()) {
					const space = key.indexOf(' ');
					if (key.slice(0, space) !== section.key) {
						continue;
					}
					const ref = key.slice(space + 1);
					if (edit.member) {
						refs.add(ref);
					} else {
						refs.delete(ref);
					}
				}
				return [...refs].sort((a, b) => a.localeCompare(b, 'ru'));
			}

			function renderSelected() {
				const refs = currentRefs();
				selectedTitle.textContent = 'Входит в состав (' + refs.length + ')';
				selectedList.textContent = '';
				if (refs.length === 0) {
					const empty = document.createElement('div');
					empty.className = 'edit-ref-empty';
					empty.textContent = '(пусто)';
					selectedList.appendChild(empty);
					return;
				}
				for (const ref of refs) {
					const item = document.createElement('div');
					item.className = 'struct-item';
					const name = document.createElement('span');
					name.className = 'struct-item-name';
					name.textContent = refCaption(ref);
					item.appendChild(name);
					if (section.modes) {
						const edit = contentEdit(section, ref);
						const option = section.modes.options.find((candidate) => candidate.value === edit.mode);
						const mode = document.createElement('span');
						mode.className = 'struct-item-syn ref-selected-mode';
						mode.textContent = option ? option.label : edit.mode;
						item.appendChild(mode);
					}
					selectedList.appendChild(item);
				}
			}
			rerenderSelected.push(renderSelected);

			function refRow(ref, name) {
				const row = document.createElement('div');
				row.className = 'subsys-node';
				row.dataset.name = String(name).toLowerCase();
				const inner = document.createElement('div');
				inner.className = 'subsys-row';
				const pad = document.createElement('span');
				pad.className = 'subsys-twist';
				inner.appendChild(pad);
				const label = document.createElement('label');
				label.className = 'subsys-label';
				const box = document.createElement('input');
				box.type = 'checkbox';
				box.checked = contentChecked(section, ref);
				box.disabled = readonly;
				label.appendChild(box);
				label.appendChild(document.createTextNode(' ' + name));
				inner.appendChild(label);
				let modeSelect = null;
				if (section.modes) {
					// Режим участника: у общего реквизита это использование
					modeSelect = document.createElement('select');
					modeSelect.className = 'subsys-mode';
					for (const option of section.modes.options) {
						const el = document.createElement('option');
						el.value = option.value;
						el.textContent = option.label;
						modeSelect.appendChild(el);
					}
					const current = contentEdit(section, ref);
					modeSelect.value = current.mode;
					modeSelect.disabled = readonly || !current.member;
					modeSelect.addEventListener('change', function () {
						setContentEdit(section, ref, true, modeSelect.value);
						renderSelected();
						renderSaveBar();
					});
					inner.appendChild(modeSelect);
				}
				box.addEventListener('change', function () {
					const mode = modeSelect ? modeSelect.value : '';
					setContentEdit(section, ref, box.checked, mode);
					if (modeSelect) {
						modeSelect.disabled = readonly || !box.checked;
					}
					renderSelected();
					renderSaveBar();
				});
				row.appendChild(inner);
				return row;
			}

			function groupBlock(title, rows, expanded) {
				const wrap = document.createElement('div');
				wrap.className = 'subsys-node';
				wrap.dataset.name = '';
				const head = document.createElement('div');
				head.className = 'subsys-row';
				const twist = document.createElement('span');
				twist.className = 'subsys-twist clickable';
				head.appendChild(twist);
				const caption = document.createElement('span');
				caption.className = 'subsys-group-title';
				caption.textContent = title;
				head.appendChild(caption);
				wrap.appendChild(head);
				const childrenBox = document.createElement('div');
				childrenBox.className = 'subsys-children';
				for (const row of rows) {
					childrenBox.appendChild(row);
				}
				wrap.appendChild(childrenBox);
				const setState = (collapsed) => {
					childrenBox.classList.toggle('collapsed', collapsed);
					twist.textContent = collapsed ? '▸' : '▾';
				};
				setState(!expanded);
				const toggle = () => setState(!childrenBox.classList.contains('collapsed'));
				twist.addEventListener('click', toggle);
				caption.addEventListener('click', toggle);
				return wrap;
			}

			for (const group of section.groups) {
				const rows = group.names.map((name) => refRow(group.tag + '.' + name, name));
				// Раскрыта группа, где уже есть отмеченные: остальное свёрнуто, иначе список неподъёмный
				const expanded =
					section.groups.length === 1 ||
					group.names.some((name) => contentChecked(section, group.tag + '.' + name));
				tree.appendChild(groupBlock(group.label, rows, expanded));
			}
			if (Array.isArray(section.extras) && section.extras.length > 0) {
				const rows = section.extras.map((ref) => refRow(ref, refCaption(ref)));
				tree.appendChild(groupBlock('Отдельные реквизиты', rows, true));
			}
			renderSelected();
			return tree;
		}

		const trees = sections.map((section) => renderSection(section));

		filter.addEventListener('input', function () {
			const needle = String(filter.value || '').trim().toLowerCase();
			for (const tree of trees) {
				for (const groupEl of tree.querySelectorAll(':scope > .subsys-node')) {
					const childrenBox = groupEl.querySelector(':scope > .subsys-children');
					let any = false;
					for (const row of childrenBox.querySelectorAll(':scope > .subsys-node')) {
						const visible = !needle || row.dataset.name.includes(needle);
						row.classList.toggle('hidden', !visible);
						if (visible) {
							any = true;
						}
					}
					groupEl.classList.toggle('hidden', Boolean(needle) && !any);
					if (needle && any) {
						childrenBox.classList.remove('collapsed');
						const twist = groupEl.querySelector(':scope > .subsys-row > .subsys-twist');
						twist.textContent = '▾';
					}
				}
			}
		});
	}

	function renderOverview() {
		if (!contentRoot) {
			return;
		}
		const mainFields = [
			{ label: 'Вид', value: model.objectKindLabel || model.objectKind || model.objectType || '' },
			{ label: 'Имя', value: model.internalName || '' },
			{ label: 'Синоним', value: model.synonymRu || '' },
			{ label: 'Комментарий', value: model.comment || '' },
		];
		const locationFields = [{ label: 'XML файл', value: model.objectXmlPath || '' }];
		contentRoot.innerHTML = `
			<div class="section-title">Основные</div>
			<div class="overview-grid">${mainFields
			.map(
				(field) => `<div class="field">
						<div class="field-label">${escapeHtml(field.label)}</div>
						<div class="field-value">${escapeHtml(toDisplayText(field.value))}</div>
					</div>`
			)
			.join('')}</div>
			<div class="section-title section-title-spaced">Расположение</div>
			<div class="overview-grid">${locationFields
				.map(
					(field) => `<div class="field">
						<div class="field-label">${escapeHtml(field.label)}</div>
						<div class="field-value">${escapeHtml(toDisplayText(field.value))}</div>
					</div>`
				)
				.join('')}</div>`;
	}

	/** Вид объекта приглушённым текстом после имени: имя всегда читается первым. */
	function refItemHintHtml(option) {
		if (!option || !option.hint) {
			return '';
		}
		return ` <span class="edit-ref-item-hint">${escapeHtml(option.hint)}</span>`;
	}

	/** Подбор группируем по виду объекта, если он задан. */
	// Уточнение вида (общая форма, значение из файла) идёт заголовком группы: иначе одинаковые
	// имена из разных мест выглядят одним и тем же вариантом.
	function selectOptionsHtml(options, current) {
		const optionHtml = (option) =>
			`<option value="${escapeHtml(option.value)}"${option.value === current ? ' selected' : ''}>${escapeHtml(
				option.label
			)}</option>`;
		const flat = options.filter((option) => !option.hint);
		const groups = [];
		for (const option of options) {
			if (!option.hint) {
				continue;
			}
			let group = groups.find((item) => item.hint === option.hint);
			if (!group) {
				group = { hint: option.hint, options: [] };
				groups.push(group);
			}
			group.options.push(option);
		}
		return [
			...flat.map(optionHtml),
			...groups.map(
				(group) => `<optgroup label="${escapeHtml(group.hint)}">${group.options.map(optionHtml).join('')}</optgroup>`
			),
		].join('');
	}

	function refAddOptionsHtml(options) {
		const flat = options.filter((option) => !option.hint);
		const groups = [];
		for (const option of options) {
			if (!option.hint) {
				continue;
			}
			let group = groups.find((item) => item.hint === option.hint);
			if (!group) {
				group = { hint: option.hint, options: [] };
				groups.push(group);
			}
			group.options.push(option);
		}
		const optionHtml = (option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`;
		return [
			...flat.map(optionHtml),
			...groups.map(
				(group) => `<optgroup label="${escapeHtml(group.hint)}">${group.options.map(optionHtml).join('')}</optgroup>`
			),
		].join('');
	}

	// Примитивные типы: значение — как в XML, подпись — как в конфигураторе.
	const PRIMITIVE_TYPES = [
		{ value: 'xs:string', label: 'Строка' },
		{ value: 'xs:decimal', label: 'Число' },
		{ value: 'xs:dateTime', label: 'Дата' },
		{ value: 'xs:boolean', label: 'Булево' },
		{ value: 'v8:ValueStorage', label: 'Хранилище значения' },
		{ value: 'v8:UUID', label: 'Уникальный идентификатор' },
	];

	const TYPE_DEFAULT_QUALIFIERS = {
		'xs:string': { stringQualifiers: { length: '10', allowedLength: 'VARIABLE' } },
		'xs:decimal': { numberQualifiers: { digits: '10', fractionDigits: '0', allowedSign: 'ANY' } },
		'xs:dateTime': { dateQualifiers: { dateFractions: 'DATE' } },
	};

	function primitiveTypeOf(value) {
		if (!value || !Array.isArray(value.types) || value.types.length !== 1) {
			return '';
		}
		const type = value.types[0];
		return PRIMITIVE_TYPES.some((option) => option.value === type) ? type : '';
	}

	/** Ссылочный и составной тип панель пока только показывает: правит их пикер типов. */
	function typeSummary(value) {
		if (!value || !Array.isArray(value.types) || value.types.length === 0) {
			return '(не задан)';
		}
		if (value.types.length > 1) {
			return `Составной тип (${value.types.length})`;
		}
		return value.types[0];
	}

	function typeQualifierRows(field, value, type, disabled) {
		const row = (label, html) =>
			`<div class="type-row"><span class="type-label">${escapeHtml(label)}</span>${html}</div>`;
		const num = (qualifier, key, current) =>
			`<input class="edit-input type-input" type="text" inputmode="numeric" value="${escapeHtml(
				current == null ? '' : String(current)
			)}" data-type-path="${escapeHtml(field.path)}" data-type-qualifier="${qualifier}" data-type-key="${key}"${disabled} />`;
		const select = (qualifier, key, current, options) =>
			`<select class="edit-input type-input" data-type-path="${escapeHtml(
				field.path
			)}" data-type-qualifier="${qualifier}" data-type-key="${key}"${disabled}>${options
				.map(
					(option) =>
						`<option value="${option.value}"${option.value === current ? ' selected' : ''}>${escapeHtml(
							option.label
						)}</option>`
				)
				.join('')}</select>`;
		if (type === 'xs:string') {
			const q = (value && value.stringQualifiers) || {};
			return (
				row('Длина', num('stringQualifiers', 'length', q.length)) +
				row(
					'Допустимая длина',
					select('stringQualifiers', 'allowedLength', q.allowedLength || 'VARIABLE', [
						{ value: 'VARIABLE', label: 'Переменная' },
						{ value: 'FIXED', label: 'Фиксированная' },
					])
				)
			);
		}
		if (type === 'xs:decimal') {
			const q = (value && value.numberQualifiers) || {};
			return (
				row('Длина', num('numberQualifiers', 'digits', q.digits)) +
				row('Точность', num('numberQualifiers', 'fractionDigits', q.fractionDigits)) +
				row(
					'Неотрицательное',
					select('numberQualifiers', 'allowedSign', q.allowedSign || 'ANY', [
						{ value: 'ANY', label: 'Нет' },
						{ value: 'NONNEGATIVE', label: 'Да' },
					])
				)
			);
		}
		if (type === 'xs:dateTime') {
			const q = (value && value.dateQualifiers) || {};
			return row(
				'Состав даты',
				select('dateQualifiers', 'dateFractions', q.dateFractions || 'DATE', [
					{ value: 'DATE', label: 'Дата' },
					{ value: 'TIME', label: 'Время' },
					{ value: 'DATE_TIME', label: 'Дата и время' },
				])
			);
		}
		return '';
	}

	function typeControlHtml(field, value, disabled) {
		const type = primitiveTypeOf(value);
		if (!type) {
			// Ссылочный или составной тип: показываем как есть, менять пока нечем.
			return `<div class="type-control"><span class="type-summary" title="${escapeHtml(
				(value && Array.isArray(value.types) ? value.types : []).join(', ')
			)}">${escapeHtml(typeSummary(value))}</span></div>`;
		}
		const options = PRIMITIVE_TYPES.map(
			(option) =>
				`<option value="${option.value}"${option.value === type ? ' selected' : ''}>${escapeHtml(option.label)}</option>`
		).join('');
		return `<div class="type-control">
				<select class="edit-input" data-type-path="${escapeHtml(field.path)}" data-type-primary="1"${disabled}>${options}</select>
				${typeQualifierRows(field, value, type, disabled)}
			</div>`;
	}

	function editControlHtml(field, index) {
		const value = field.path ? getPath(editedProps, field.path) : undefined;
		const disabled = field.readonly || !fieldEnabled(field) ? ' disabled' : '';
		const id = `editField_${index}`;
		switch (field.control) {
			case 'check': {
				const checked = value === true ? ' checked' : '';
				return `<input id="${id}" class="edit-check" type="checkbox" data-path="${escapeHtml(field.path)}" data-control="check"${checked}${disabled} />`;
			}
			case 'number':
				return `<input id="${id}" class="edit-input" type="number" min="0" data-path="${escapeHtml(field.path)}" data-control="number" value="${escapeHtml(value === null || value === undefined ? '' : String(value))}"${disabled} />`;
			case 'textarea':
				return `<textarea id="${id}" class="edit-input edit-textarea" data-path="${escapeHtml(field.path)}" data-control="textarea" rows="3"${disabled}>${escapeHtml(typeof value === 'string' ? value : '')}</textarea>`;
			case 'select': {
				const current = value === null || value === undefined ? '' : String(value);
				const options = Array.isArray(field.options) ? field.options.slice() : [];
				if (current && !options.some((option) => option.value === current)) {
					options.push({ value: current, label: current });
				}
				if (!current && !options.some((option) => option.value === '')) {
					options.unshift({ value: '', label: '(по умолчанию)' });
				}
				const optionsHtml = selectOptionsHtml(options, current);
				return `<select id="${id}" class="edit-input" data-path="${escapeHtml(field.path)}" data-control="select"${disabled}>${optionsHtml}</select>`;
			}
			case 'moduleLink':
				return `<button type="button" class="edit-module-link" data-module-kind="${escapeHtml(field.path)}">Открыть</button>`;
			case 'type':
				return typeControlHtml(field, value, disabled);
			case 'refList': {
				const selected = Array.isArray(value) ? value : [];
				const options = Array.isArray(field.options) ? field.options : [];
				const optionByValue = {};
				for (const option of options) {
					optionByValue[option.value] = option;
				}
				const rows = selected
					.map(
						(item, itemIdx) => `<div class="edit-ref-item">
							<span class="edit-ref-item-label" title="${escapeHtml(toDisplayText(item))}">${escapeHtml(
								(optionByValue[item] && optionByValue[item].label) || toDisplayText(item)
							)}${refItemHintHtml(optionByValue[item])}</span>
							<span class="edit-ref-item-actions">
								<button type="button" class="edit-ref-move" data-ref-move-path="${escapeHtml(field.path)}" data-ref-move-index="${itemIdx}" data-ref-move-dir="-1" title="Вверх"${itemIdx === 0 ? ' disabled' : disabled}>↑</button>
								<button type="button" class="edit-ref-move" data-ref-move-path="${escapeHtml(field.path)}" data-ref-move-index="${itemIdx}" data-ref-move-dir="1" title="Вниз"${itemIdx === selected.length - 1 ? ' disabled' : disabled}>↓</button>
								<button type="button" class="edit-ref-remove" data-ref-path="${escapeHtml(field.path)}" data-ref-index="${itemIdx}" title="Убрать"${disabled}>×</button>
							</span>
						</div>`
					)
					.join('');
				const available = options.filter((option) => !selected.includes(option.value));
				const addControl = available.length > 0
					? `<select class="edit-ref-add-select" data-ref-add-select="${escapeHtml(field.path)}"${disabled}>
							<option value="" selected>+ Добавить…</option>
							${refAddOptionsHtml(available)}
						</select>`
					: '';
				return `<div class="edit-ref-list">
						<div class="edit-ref-items">${rows || '<div class="edit-ref-empty">(пусто)</div>'}</div>
						${addControl}
					</div>`;
			}
			case 'staticList': {
				const items = Array.isArray(field.items) && field.items.length > 0
					? field.items
					: (Array.isArray(value) ? value : []);
				if (items.length === 0) {
					return '<div class="edit-static-empty">(пусто)</div>';
				}
				if (field.itemsKind === 'objectForms') {
					const addButton = editable && editable.readonly !== true
						? `<button type="button" class="struct-add-btn" data-form-create="1">+ Форма…</button>`
						: '';
					// Форма открывается щелчком, крестик удаляет её вместе с файлами
					return `<div class="edit-chips">${items
						.map(function (item) {
							const name = escapeHtml(toDisplayText(item));
							const remove = editable && editable.readonly !== true
								? `<button type="button" class="edit-chip-remove" data-form-delete="${name}" title="Удалить форму">✕</button>`
								: '';
							return `<span class="edit-chip edit-chip-action"><button type="button" class="edit-chip-open" data-form-open="${name}" title="Открыть форму">${name}</button>${remove}</span>`;
						})
						.join('')}</div><div class="struct-add-row">${addButton}</div>`;
				}
				return `<div class="edit-chips">${items
					.map((item) => `<span class="edit-chip">${escapeHtml(toDisplayText(item))}</span>`)
					.join('')}</div>`;
			}
			default:
				return `<input id="${id}" class="edit-input" type="text" data-path="${escapeHtml(field.path)}" data-control="text" value="${escapeHtml(typeof value === 'string' ? value : '')}"${disabled} />`;
		}
	}

	if (contentRoot) {
		contentRoot.addEventListener('click', function (event) {
			const open = event.target.closest ? event.target.closest('[data-form-open]') : null;
			if (open) {
				vscodeApi.postMessage({ type: 'openObjectForm', name: open.dataset.formOpen });
				return;
			}
			const remove = event.target.closest ? event.target.closest('[data-form-delete]') : null;
			if (remove) {
				vscodeApi.postMessage({ type: 'deleteObjectForm', name: remove.dataset.formDelete });
				return;
			}
			const command = event.target.closest ? event.target.closest('[data-command-open]') : null;
			if (command) {
				vscodeApi.postMessage({ type: 'openObjectCommand', name: command.dataset.commandOpen });
				return;
			}
			const create = event.target.closest ? event.target.closest('[data-form-create]') : null;
			if (create) {
				vscodeApi.postMessage({ type: 'createObjectForm' });
			}
		});
	}

	function renderEditTab(tabId) {
		if (!contentRoot || !editable || !editedProps) {
			return;
		}
		const spec = (editable.tabs || []).find((tab) => tab.id === tabId);
		if (!spec) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		let fieldIndex = 0;
		const groupsHtml = (spec.groups || [])
			.map((group) => {
				const rows = (group.fields || [])
					.map((field) => {
						const control = editControlHtml(field, fieldIndex);
						fieldIndex += 1;
						const changed = fieldChanged(field.path) ? ' edit-row-changed' : '';
						return `<div class="edit-row${changed}">
							<label class="edit-label" title="${escapeHtml(field.path)}">${escapeHtml(field.label)}</label>
							<div class="edit-control">${control}</div>
						</div>`;
					})
					.join('');
				return `<div class="edit-group">
						<div class="section-title">${escapeHtml(group.title)}</div>
						<div class="edit-fields">${rows}</div>
					</div>`;
			})
			.join('');
		// Поиск нужен там, где свойств много: на «Данных». На вкладке с тремя полями он лишний.
		const filterHtml = tabId !== 'edit_data' ? '' : `<div class="edit-filter-row">
				<span class="edit-filter-wrap">
					<input id="editFilterInput" class="edit-input edit-filter" type="text" placeholder="Поиск свойства..." value="${escapeHtml(editFilter)}" />
					<button id="editFilterClear" class="edit-filter-clear${editFilter ? '' : ' hidden'}" type="button" title="Очистить">×</button>
				</span>
			</div>`;
		const tabLists = structListsForTab(tabId);
		const withTabularSections = tabId === 'edit_data' && structSupportsTabularSections();
		if (tabLists.length > 0 || withTabularSections) {
			// Раскладка конфигуратора: слева состав, справа свойства этой же вкладки.
			const tsHtml = withTabularSections
				? `<div class="section-title section-title-spaced">Табличные части</div>${structEditTsHtml()}`
				: '';
			contentRoot.innerHTML = `${filterHtml}<div class="edit-data-layout">
					<div class="edit-data-structure">
						${structListsHtml(tabId)}
						${tsHtml}
					</div>
					${groupsHtml ? `<div class="edit-data-props">${groupsHtml}</div>` : ''}
				</div>`;
			bindEditInputs(spec);
			bindStructEditInputs(spec);
			bindEditFilter();
			return;
		}
		contentRoot.innerHTML = `${filterHtml}<div class="edit-columns">${groupsHtml}</div>`;
		bindEditInputs(spec);
		bindEditFilter();
	}

	function bindEditFilter() {
		const input = /** @type {HTMLInputElement | null} */ (document.getElementById('editFilterInput'));
		if (!input) {
			return;
		}
		const clearBtn = document.getElementById('editFilterClear');
		const sync = function () {
			editFilter = input.value;
			if (clearBtn) {
				clearBtn.classList.toggle('hidden', editFilter.length === 0);
			}
			applyEditFilter();
		};
		input.addEventListener('input', sync);
		if (clearBtn) {
			clearBtn.addEventListener('click', function () {
				input.value = '';
				sync();
				input.focus();
			});
		}
		applyEditFilter();
	}

	function applyEditFilter() {
		if (!contentRoot) {
			return;
		}
		const query = editFilter.trim().toLowerCase();
		for (const group of contentRoot.querySelectorAll('.edit-group')) {
			let visibleRows = 0;
			for (const row of group.querySelectorAll('.edit-row')) {
				const label = row.querySelector('.edit-label');
				const text = label && label.textContent ? label.textContent.toLowerCase() : '';
				const show = query.length === 0 || text.includes(query);
				row.classList.toggle('hidden', !show);
				if (show) {
					visibleRows++;
				}
			}
			group.classList.toggle('hidden', visibleRows === 0);
		}
	}

	function fieldByPath(spec, path) {
		for (const group of spec.groups || []) {
			for (const field of group.fields || []) {
				if (field.path === path) {
					return field;
				}
			}
		}
		return null;
	}

	/** Свойство отличается от того, что лежит в файле: панель помечает такие строки до сохранения. */
	function fieldChanged(path) {
		if (!editable || !editedProps || !path) {
			return false;
		}
		const before = getPath(editable.props, path);
		const after = getPath(editedProps, path);
		const norm = (value) => (value === null || value === undefined ? '' : JSON.stringify(value));
		return norm(before) !== norm(after);
	}

	function markRowChanged(input, path) {
		const row = input.closest ? input.closest('.edit-row') : null;
		if (row) {
			row.classList.toggle('edit-row-changed', fieldChanged(path));
		}
	}

	function bindEditInputs(spec) {
		if (!contentRoot) {
			return;
		}
		const inputs = contentRoot.querySelectorAll('[data-path]');
		for (const input of inputs) {
			const path = input.getAttribute('data-path');
			const control = input.getAttribute('data-control');
			if (!path || !control) {
				continue;
			}
			const handler = function () {
				if (!editedProps) {
					return;
				}
				if (control === 'check') {
					setPath(editedProps, path, Boolean(input.checked));
				} else if (control === 'select') {
					setPath(editedProps, path, input.value === '' ? null : input.value);
				} else {
					setPath(editedProps, path, input.value);
				}
				const field = fieldByPath(spec, path);
				if (control === 'check' || control === 'select') {
					// Возможна смена доступности зависимых полей.
					renderEditTab(spec.id);
				}
				void field;
				markRowChanged(input, path);
				renderSaveBar();
			};
			input.addEventListener(control === 'check' || control === 'select' ? 'change' : 'input', handler);
		}
		bindRefListButtons(spec);
		bindTypeInputs(spec);
	}

	function bindTypeInputs(spec) {
		if (!contentRoot) {
			return;
		}
		for (const input of contentRoot.querySelectorAll('[data-type-path]')) {
			const path = input.getAttribute('data-type-path');
			const isPrimary = input.hasAttribute('data-type-primary');
			input.addEventListener('change', function () {
				if (!editedProps) {
					return;
				}
				const current = getPath(editedProps, path) || {};
				if (isPrimary) {
					// Смена типа: квалификаторы заводим такие же, как платформа для нового типа.
					const next = Object.assign({ types: [input.value] }, TYPE_DEFAULT_QUALIFIERS[input.value] || {});
					setPath(editedProps, path, next);
					renderEditTab(spec.id);
					renderSaveBar();
					return;
				}
				const qualifier = input.getAttribute('data-type-qualifier');
				const key = input.getAttribute('data-type-key');
				const next = Object.assign({}, current);
				next[qualifier] = Object.assign({}, next[qualifier] || {}, { [key]: input.value });
				setPath(editedProps, path, next);
				renderSaveBar();
			});
		}
	}

	function bindRefListButtons(spec) {
		if (!contentRoot || !editedProps) {
			return;
		}
		for (const btn of contentRoot.querySelectorAll('[data-ref-index]')) {
			btn.addEventListener('click', function () {
				const path = btn.getAttribute('data-ref-path');
				const index = Number(btn.getAttribute('data-ref-index'));
				const list = getPath(editedProps, path);
				if (!Array.isArray(list) || Number.isNaN(index)) {
					return;
				}
				list.splice(index, 1);
				renderEditTab(spec.id);
				renderSaveBar();
			});
		}
		for (const select of contentRoot.querySelectorAll('[data-ref-add-select]')) {
			select.addEventListener('change', function () {
				const path = select.getAttribute('data-ref-add-select');
				if (!select.value) {
					return;
				}
				const list = getPath(editedProps, path);
				if (!Array.isArray(list) || list.includes(select.value)) {
					select.value = '';
					return;
				}
				list.push(select.value);
				renderEditTab(spec.id);
				renderSaveBar();
			});
		}
		for (const btn of contentRoot.querySelectorAll('[data-ref-move-path]')) {
			btn.addEventListener('click', function () {
				const path = btn.getAttribute('data-ref-move-path');
				const index = Number(btn.getAttribute('data-ref-move-index'));
				const dir = Number(btn.getAttribute('data-ref-move-dir'));
				const list = getPath(editedProps, path);
				const target = index + dir;
				if (!Array.isArray(list) || Number.isNaN(index) || target < 0 || target >= list.length) {
					return;
				}
				const moved = list.splice(index, 1)[0];
				list.splice(target, 0, moved);
				renderEditTab(spec.id);
				renderSaveBar();
			});
		}
		for (const btn of contentRoot.querySelectorAll('[data-module-kind]')) {
			btn.addEventListener('click', function () {
				if (vscodeApi) {
					vscodeApi.postMessage({ type: 'openModule', module: btn.getAttribute('data-module-kind') });
				}
			});
		}
	}

	function renderSaveBar() {
		const bar = document.getElementById('saveBar');
		const status = document.getElementById('saveStatus');
		const saveBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('saveBtn'));
		const resetBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('resetBtn'));
		if (!bar || !status || !saveBtn || !resetBtn) {
			return;
		}
		const dirty = isDirty();
		const structError = structValidationError();
		const visible = Boolean(editable) && (dirty || saving || Boolean(saveError) || savedFlash);
		bar.classList.toggle('hidden', !visible);
		if (!visible) {
			return;
		}
		saveBtn.disabled = saving || !dirty || Boolean(structError);
		resetBtn.disabled = saving || !dirty;
		status.classList.toggle('save-status-error', Boolean(saveError) || Boolean(structError));
		if (saving) {
			status.textContent = 'Сохранение…';
		} else if (dirty && structError) {
			status.textContent = structError;
		} else if (saveError) {
			status.textContent = saveError;
		} else if (dirty) {
			status.textContent = 'Есть несохранённые изменения';
		} else if (savedFlash) {
			status.textContent = 'Сохранено';
		} else {
			status.textContent = '';
		}
	}

	function currentTabIsEdit() {
		const tab = tabs.find((item) => item.id === activeTabId);
		return Boolean(tab && tab.render === 'edit');
	}

	function initSaveBar() {
		const saveBtn = document.getElementById('saveBtn');
		const resetBtn = document.getElementById('resetBtn');
		if (!editable || !vscodeApi || !saveBtn || !resetBtn) {
			return;
		}
		// Ctrl+S приходит командой из расширения: внутри webview его перехватывает VS Code
		window.addEventListener('message', function (event) {
			if (!event.data || event.data.type !== 'saveRequested') {
				return;
			}
			if (!saveBtn.disabled) {
				saveBtn.click();
			}
		});
		saveBtn.addEventListener('click', function () {
			if (saving || !isDirty() || structValidationError()) {
				return;
			}
			saving = true;
			saveError = '';
			savedFlash = false;
			renderSaveBar();
			vscodeApi.postMessage({
				type: 'save',
				payload: editedProps,
				structure: serializeStructureEdits(),
				subsystems: [...editedSubsystems.entries()].map(([xmlPath, member]) => ({ xmlPath, member })),
				commandVisibility:
					editedCommandVisibility.size > 0 && model.commandInterface
						? model.commandInterface.visibility
								.filter((entry) => entry.stored !== false || editedCommandVisibility.has(entry.command))
								.map((entry) => ({
									command: entry.command,
									common: commandVisibilityChecked(entry.command),
								}))
						: [],
				content: [...editedContent.entries()].map(([key, edit]) => {
					const space = key.indexOf(' ');
					return { key: key.slice(0, space), ref: key.slice(space + 1), member: edit.member, mode: edit.mode };
				}),
				roleRights: [...editedRoleRights.entries()].map(([key, value]) => {
					const space = key.indexOf(' ');
					return { object: key.slice(0, space), right: key.slice(space + 1), value };
				}),
				roleRightsFlags: Object.fromEntries(editedRoleFlags),
				commandPlacement:
					editedCommandPlacement.size > 0 && model.commandInterface
						? model.commandInterface.placement.map((entry) => ({
								command: entry.command,
								group: commandPlacementGroup(entry),
								place: entry.place || 'Auto',
							}))
						: [],
				commandOrder: commandOrderDirty() ? editedCommandOrder : [],
				subsystemsOrder: orderListDirty(
					editedSubsystemsOrder,
					model.commandInterface && model.commandInterface.subsystemsOrder
				)
					? editedSubsystemsOrder
					: [],
				groupsOrder: orderListDirty(
					editedGroupsOrder,
					model.commandInterface && model.commandInterface.groupsOrder
				)
					? editedGroupsOrder
					: [],
			});
		});
		resetBtn.addEventListener('click', function () {
			if (saving || !editable) {
				return;
			}
			editedProps = deepClone(editable.props);
			editedStructure = model.structureLists ? structureEditsFromLists(model.structureLists) : null;
			structBaselineOrderKey = structOrderKey(editedStructure);
			editedSubsystems.clear();
			editedContent.clear();
			editedCommandVisibility.clear();
			editedCommandPlacement.clear();
			editedCommandOrder = null;
			editedSubsystemsOrder = null;
			editedGroupsOrder = null;
			editedRoleRights.clear();
			editedRoleFlags.clear();
			saveError = '';
			savedFlash = false;
			if (currentTabIsEdit()) {
				renderContent();
			}
			renderSaveBar();
		});
		window.addEventListener('message', function (event) {
			const msg = event.data;
			if (msg && msg.type === 'modelUpdated') {
				if (msg.structureLists && typeof msg.structureLists === 'object') {
					model.structureLists = msg.structureLists;
				}
				if (msg.subsystems && typeof msg.subsystems === 'object') {
					model.subsystems = msg.subsystems;
				}
				if (msg.refContent && typeof msg.refContent === 'object') {
					model.refContent = msg.refContent;
				}
				if (msg.commandInterface && typeof msg.commandInterface === 'object') {
					model.commandInterface = msg.commandInterface;
				}
				if (msg.roleRights && typeof msg.roleRights === 'object') {
					model.roleRights = msg.roleRights;
				}
				editedSubsystems.clear();
				editedContent.clear();
				editedCommandVisibility.clear();
				editedCommandPlacement.clear();
				editedCommandOrder = null;
				editedSubsystemsOrder = null;
				editedGroupsOrder = null;
				editedRoleRights.clear();
				editedRoleFlags.clear();
				editedStructure = model.structureLists ? structureEditsFromLists(model.structureLists) : null;
				structBaselineOrderKey = structOrderKey(editedStructure);
				if (Array.isArray(msg.tabs)) {
					tabs.length = 0;
					for (const tab of msg.tabs) {
						tabs.push(tab);
					}
					if (!tabs.some((tab) => tab.id === activeTabId)) {
						activeTabId = tabs[0] ? tabs[0].id : '';
					}
				}
				if (editable && msg.props && typeof msg.props === 'object') {
					editable.props = msg.props;
					if (Array.isArray(msg.editableTabs)) {
						editable.tabs = msg.editableTabs;
					}
					editedProps = deepClone(editable.props);
				}
				renderTabs();
				renderContent();
				renderSaveBar();
				return;
			}
			if (!msg || msg.type !== 'saved') {
				return;
			}
			saving = false;
			if (msg.ok) {
				if (msg.props && typeof msg.props === 'object') {
					editable.props = msg.props;
					editedProps = deepClone(editable.props);
				}
				saveError = '';
				savedFlash = true;
				setTimeout(function () {
					savedFlash = false;
					renderSaveBar();
				}, 4000);
				if (currentTabIsEdit()) {
					renderContent();
				}
			} else {
				saveError = String(msg.error || 'Не удалось сохранить изменения.');
			}
			renderSaveBar();
		});
	}

	function structRowByPath(spath) {
		if (!editedStructure) {
			return null;
		}
		const parts = String(spath).split('.');
		if (parts[0] === 'l') {
			// l.<индекс списка>.<индекс строки>: списки состава идут в порядке модели.
			const list = editedStructure.lists[Number(parts[1])];
			return (list && list.rows[Number(parts[2])]) || null;
		}
		const ts = editedStructure.tabularSections[Number(parts[1])] || null;
		if (!ts) {
			return null;
		}
		if (parts[2] === 'a') {
			return ts.attributes[Number(parts[3])] || null;
		}
		return ts;
	}

	function structEditRowHtml(row, spath, options) {
		const deleted = row.deleted;
		const invalid = !deleted && !structNameValid(row.name) ? ' struct-input-invalid' : '';
		const dis = deleted ? ' disabled' : '';
		// У команды объекта модуль открывается прямо из списка: принцип тот же, что у форм
		const moduleButton = options && options.commandModule && !deleted && row.originalName
			? `<button type="button" class="struct-btn" data-command-open="${escapeHtml(row.originalName)}" title="Открыть модуль команды">⌘</button>`
			: '';
		return `<div class="struct-item${deleted ? ' struct-item-deleted' : ''}"${row.comment ? ` title="${escapeHtml(row.comment)}"` : ''}>
			<input class="edit-input struct-input struct-input-name${invalid}" data-spath="${spath}" data-sfield="name" value="${escapeHtml(row.name)}" placeholder="Имя" spellcheck="false"${dis} />
			<input class="edit-input struct-input" data-spath="${spath}" data-sfield="synonymRu" value="${escapeHtml(row.synonymRu)}" placeholder="Синоним"${dis} />
			<span class="struct-actions-inline">${moduleButton}
				<button type="button" class="struct-btn" data-smove="${spath}" data-smove-dir="-1" title="Вверх"${dis}>↑</button>
				<button type="button" class="struct-btn" data-smove="${spath}" data-smove-dir="1" title="Вниз"${dis}>↓</button>
				<button type="button" class="struct-btn${deleted ? '' : ' struct-btn-danger'}" data-sdel="${spath}" title="${deleted ? 'Вернуть' : 'Удалить'}">${deleted ? '↩' : '×'}</button>
			</span>
		</div>`;
	}

	function structLists() {
		const lists = model.structureLists && model.structureLists.lists;
		return Array.isArray(lists) ? lists : [];
	}

	/** Списки состава этой вкладки: состав объекта на «Данных», команды - на «Командах». */
	function structListsForTab(tabId) {
		return structLists().filter((list) => (list.tab || 'edit_data') === tabId);
	}

	/** Номер списка в правках структуры: правки хранятся по всем редактируемым спискам подряд. */
	function structEditIndex(list) {
		if (!editedStructure) {
			return -1;
		}
		return editedStructure.lists.findIndex((item) => item.kind === list.key);
	}

	/** Списки состава сверху вниз: правится тот, что описан как редактируемый. */
	function structListsHtml(tabId) {
		return structListsForTab(tabId)
			.map(function (list, idx) {
				const title = `<div class="section-title${idx > 0 ? ' section-title-spaced' : ''}">${escapeHtml(
					list.title
				)}</div>`;
				if (!list.editable) {
					return title + structReadonlyListHtml(list);
				}
				return title + structEditListHtml(structEditIndex(list));
			})
			.join('');
	}

	function structReadonlyListHtml(list) {
		const rows = (list.rows || [])
			.map(function (row) {
				const synonym = row.synonymRu && row.synonymRu !== row.name
					? `<span class="struct-item-syn">${escapeHtml(row.synonymRu)}</span>`
					: '';
				return `<div class="struct-item"><span class="struct-item-name">${escapeHtml(row.name)}</span>${synonym}</div>`;
			})
			.join('');
		return `<div class="struct-list">${rows || '<div class="edit-ref-empty">(пусто)</div>'}</div>`;
	}

	function structSupportsTabularSections() {
		return !model.structureLists || model.structureLists.supportsTabularSections !== false;
	}

	function structEditListHtml(listIdx) {
		if (!editedStructure || !editedStructure.lists[listIdx]) {
			return '<div class="edit-ref-empty">(нет данных)</div>';
		}
		const list = editedStructure.lists[listIdx];
		const commandModule = editedStructure.lists[listIdx] && editedStructure.lists[listIdx].kind === 'commands';
		const rows = list.rows
			.map((row, idx) => structEditRowHtml(row, `l.${listIdx}.${idx}`, { commandModule }))
			.join('');
		return `<div class="struct-list">${rows || '<div class="edit-ref-empty">(пусто)</div>'}</div>
			<div class="struct-add-row"><button type="button" class="struct-add-btn" data-sadd="l.${listIdx}">${escapeHtml(
				list.addLabel || '+ Строка…'
			)}</button></div>`;
	}

	function structEditTsHtml() {
		if (!editedStructure) {
			return '<div class="edit-ref-empty">(нет данных)</div>';
		}
		const blocks = editedStructure.tabularSections
			.map((ts, idx) => {
				const nested = ts.attributes.map((row, j) => structEditRowHtml(row, `t.${idx}.a.${j}`)).join('');
				const body = ts.deleted
					? ''
					: `<div class="struct-ts-body">
						<div class="struct-list">${nested || '<div class="edit-ref-empty">(пусто)</div>'}</div>
						<div class="struct-add-row"><button type="button" class="struct-add-btn" data-sadd="t.${idx}">+ Реквизит…</button></div>
					</div>`;
				return `<div class="struct-ts-block">${structEditRowHtml(ts, `t.${idx}`)}${body}</div>`;
			})
			.join('');
		return `${blocks || '<div class="struct-list"><div class="edit-ref-empty">(пусто)</div></div>'}
			<div class="struct-add-row"><button type="button" class="struct-add-btn" data-sadd="t">+ Табличная часть…</button></div>`;
	}

	function bindStructEditInputs(spec) {
		if (!contentRoot || !editedStructure) {
			return;
		}
		for (const input of contentRoot.querySelectorAll('[data-spath]')) {
			input.addEventListener('input', function () {
				const spath = input.getAttribute('data-spath');
				const row = structRowByPath(spath);
				const field = input.getAttribute('data-sfield');
				if (!row || !field) {
					return;
				}
				if (field === 'name') {
					// Синоним следует за именем, пока пользователь не задал его вручную.
					const followsName = row.synonymRu === '' || row.synonymRu === synonymFromName(row.name);
					row.name = input.value;
					input.classList.toggle('struct-input-invalid', !row.deleted && !structNameValid(input.value));
					if (followsName) {
						row.synonymRu = synonymFromName(input.value);
						const synInput = contentRoot.querySelector(
							`[data-spath="${CSS.escape(spath)}"][data-sfield="synonymRu"]`
						);
						if (synInput) {
							synInput.value = row.synonymRu;
						}
					}
				} else {
					row[field] = input.value;
				}
				renderSaveBar();
			});
		}
		for (const btn of contentRoot.querySelectorAll('[data-sdel]')) {
			btn.addEventListener('click', function () {
				const spath = btn.getAttribute('data-sdel');
				const row = structRowByPath(spath);
				if (!row) {
					return;
				}
				if (!row.originalName && !row.deleted) {
					// Новая строка: удаляем совсем.
					const parts = spath.split('.');
					if (parts[0] === 'l') {
						const list = editedStructure.lists[Number(parts[1])];
						if (list) {
							list.rows.splice(Number(parts[2]), 1);
						}
					} else if (parts[2] === 'a') {
						editedStructure.tabularSections[Number(parts[1])].attributes.splice(Number(parts[3]), 1);
					} else {
						editedStructure.tabularSections.splice(Number(parts[1]), 1);
					}
				} else {
					row.deleted = !row.deleted;
				}
				renderEditTab(spec.id);
				renderSaveBar();
			});
		}
		for (const btn of contentRoot.querySelectorAll('[data-smove]')) {
			btn.addEventListener('click', function () {
				const spath = btn.getAttribute('data-smove');
				const dir = Number(btn.getAttribute('data-smove-dir'));
				const parts = String(spath).split('.');
				let list = null;
				let index = -1;
				if (parts[0] === 'l') {
					const structList = editedStructure.lists[Number(parts[1])];
					list = structList ? structList.rows : null;
					index = Number(parts[2]);
				} else if (parts[2] === 'a') {
					list = editedStructure.tabularSections[Number(parts[1])]
						? editedStructure.tabularSections[Number(parts[1])].attributes
						: null;
					index = Number(parts[3]);
				} else {
					list = editedStructure.tabularSections;
					index = Number(parts[1]);
				}
				const target = index + dir;
				if (!list || Number.isNaN(index) || target < 0 || target >= list.length) {
					return;
				}
				const moved = list.splice(index, 1)[0];
				list.splice(target, 0, moved);
				renderEditTab(spec.id);
				renderSaveBar();
			});
		}
		for (const btn of contentRoot.querySelectorAll('[data-sadd]')) {
			btn.addEventListener('click', function () {
				const target = btn.getAttribute('data-sadd');
				const emptyRow = { originalName: '', name: '', synonymRu: '', baselineSynonymRu: '', comment: '', deleted: false };
				let newSpath = '';
				if (target.startsWith('l.')) {
					const listIdx = Number(target.split('.')[1]);
					const list = editedStructure.lists[listIdx];
					if (list) {
						list.rows.push({ ...emptyRow });
						newSpath = `l.${listIdx}.${list.rows.length - 1}`;
					}
				} else if (target === 't') {
					editedStructure.tabularSections.push({ ...emptyRow, attributes: [] });
					newSpath = `t.${editedStructure.tabularSections.length - 1}`;
				} else {
					const idx = Number(target.split('.')[1]);
					if (editedStructure.tabularSections[idx]) {
						editedStructure.tabularSections[idx].attributes.push({ ...emptyRow });
						newSpath = `t.${idx}.a.${editedStructure.tabularSections[idx].attributes.length - 1}`;
					}
				}
				renderEditTab(spec.id);
				if (newSpath) {
					const added = contentRoot.querySelector(
						`[data-spath="${CSS.escape(newSpath)}"][data-sfield="name"]`
					);
					if (added) {
						added.focus();
					}
				}
				renderSaveBar();
			});
		}
	}

	function readonlyStructRowHtml(item) {
		const name = toDisplayText(item.name);
		const synonymRaw = typeof item.synonymRu === 'string' ? item.synonymRu.trim() : '';
		const synonym = synonymRaw && synonymRaw !== item.name ? synonymRaw : '';
		const comment = typeof item.comment === 'string' ? item.comment.trim() : '';
		return `<div class="struct-item"${comment ? ` title="${escapeHtml(comment)}"` : ''}>
			<span class="struct-item-name">${escapeHtml(name)}</span>
			<span class="struct-item-syn">${escapeHtml(synonym)}</span>
		</div>`;
	}

	function renderNamed(tab) {
		if (!contentRoot) {
			return;
		}
		const items = Array.isArray(tab.data) ? tab.data.map((x) => asObject(x)).filter((x) => x.name) : [];
		const rows = items.map((item) => readonlyStructRowHtml(item)).join('');
		contentRoot.innerHTML = `<div class="struct-list">${rows || '<div class="edit-ref-empty">(пусто)</div>'}</div>`;
	}

	function renderTabular(tab) {
		if (!contentRoot) {
			return;
		}
		const items = Array.isArray(tab.data) ? tab.data.map((x) => asObject(x)).filter((x) => x.name) : [];
		const blocks = items
			.map((item) => {
				const attrs = Array.isArray(item.attributes) ? item.attributes.map((x) => asObject(x)).filter((x) => x.name) : [];
				const nested = attrs.map((attr) => readonlyStructRowHtml(attr)).join('');
				return `<div class="struct-ts-block">${readonlyStructRowHtml(item)}
					<div class="struct-ts-body"><div class="struct-list">${nested || '<div class="edit-ref-empty">(пусто)</div>'}</div></div>
				</div>`;
			})
			.join('');
		contentRoot.innerHTML = blocks || '<div class="empty">Нет данных.</div>';
	}

	function renderSubsystemContent(data) {
		if (!contentRoot) {
			return;
		}
		const source = asObject(data);
		const summary = Array.isArray(source.summary) ? source.summary.map((x) => asObject(x)) : [];
		const items = Array.isArray(source.items) ? source.items.map((item) => toDisplayText(item)).filter(Boolean) : [];
		const summaryHtml =
			summary.length > 0
				? `<div class="summary-list">${summary
						.map((item) => `<div class="summary-item">
							<div class="summary-key">${escapeHtml(toDisplayText(item.type))}</div>
							<div class="summary-value">${escapeHtml(toDisplayText(item.count))}</div>
						</div>`)
						.join('')}</div>`
				: '<div class="empty">Нет данных для сводки.</div>';
		const itemsHtml =
			items.length > 0
				? `<div id="subsystemContentList" class="list">${items
						.map(
							(item, index) => `<div class="list-item">
								<div class="list-index">${index + 1}.</div>
								<div class="list-text">${escapeHtml(item)}</div>
							</div>`
						)
						.join('')}</div>`
				: '<div class="empty">Нет элементов состава.</div>';

		contentRoot.innerHTML = `
			<div class="section-title">Сводка по типам</div>
			${summaryHtml}
			<div class="section-title section-title-spaced">Полный состав</div>
			<div class="list-tools">
				<input id="subsystemContentFilter" class="list-filter" type="text" placeholder="Фильтр по составу..." />
			</div>
			${itemsHtml}`;

		const filterInput = /** @type {HTMLInputElement | null} */ (document.getElementById('subsystemContentFilter'));
		const listRoot = document.getElementById('subsystemContentList');
		if (!filterInput || !listRoot) {
			return;
		}
		filterInput.addEventListener('input', function () {
			const query = filterInput.value.trim().toLowerCase();
			const rows = listRoot.querySelectorAll('.list-item');
			for (const row of rows) {
				const text = row.textContent ? row.textContent.toLowerCase() : '';
				row.classList.toggle('hidden', query.length > 0 && !text.includes(query));
			}
		});
	}

	function renderList(data) {
		if (!contentRoot) {
			return;
		}
		const items = Array.isArray(data) ? data.map((item) => toDisplayText(item)).filter(Boolean) : [];
		if (items.length === 0) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		contentRoot.innerHTML = `
			<div class="list-tools">
				<input id="listFilterInput" class="list-filter" type="text" placeholder="Фильтр по списку..." />
			</div>
			<div id="listRoot" class="list">${items
			.map(
				(item, index) => `<div class="list-item">
					<div class="list-index">${index + 1}.</div>
					<div class="list-text">${escapeHtml(item)}</div>
				</div>`
			)
			.join('')}</div>`;
		const filterInput = /** @type {HTMLInputElement | null} */ (document.getElementById('listFilterInput'));
		const listRoot = document.getElementById('listRoot');
		if (!filterInput || !listRoot) {
			return;
		}
		filterInput.addEventListener('input', function () {
			const query = filterInput.value.trim().toLowerCase();
			const rows = listRoot.querySelectorAll('.list-item');
			for (const row of rows) {
				const text = row.textContent ? row.textContent.toLowerCase() : '';
				row.classList.toggle('hidden', query.length > 0 && !text.includes(query));
			}
		});
	}

	function renderKv(data) {
		if (!contentRoot) {
			return;
		}
		const source = asObject(data);
		const entries = Object.entries(source);
		if (entries.length === 0) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		contentRoot.innerHTML = `<div class="kv-list">${entries
			.map(
				([key, value]) => `<div class="kv-row">
						<div class="kv-key">${escapeHtml(key)}</div>
						<div class="kv-value">${escapeHtml(toDisplayText(value))}</div>
					</div>`
			)
			.join('')}</div>`;
	}

	function renderJson(data) {
		if (!contentRoot) {
			return;
		}
		const formatted = JSON.stringify(data ?? {}, null, 2);
		contentRoot.innerHTML = `<pre class="code">${escapeHtml(formatted)}</pre>`;
	}

	function renderTechnical() {
		if (!technicalRoot || !technicalJsonRoot || !toggleTechnicalButton) {
			return;
		}
		if (!technicalVisible) {
			technicalRoot.classList.add('hidden');
			toggleTechnicalButton.textContent = 'Технические данные';
			return;
		}
		technicalRoot.classList.remove('hidden');
		toggleTechnicalButton.textContent = 'Скрыть технические данные';
		technicalJsonRoot.textContent = model.technicalJson || '{}';
	}

	function toDisplayText(value) {
		if (value === null || value === undefined || value === '') {
			return '(пусто)';
		}
		if (typeof value === 'string') {
			const metadataRef = humanizeMetadataReference(value.trim());
			if (metadataRef) {
				return metadataRef;
			}
			return genericValueLabels[value.trim()] || value;
		}
		if (typeof value === 'boolean') {
			return value ? 'Да' : 'Нет';
		}
		if (typeof value === 'number') {
			return String(value);
		}
		if (Array.isArray(value)) {
			return value.map((item) => toDisplayText(item)).join(', ');
		}
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}

	// Подчинённые объекты: в ссылке четыре части, читать её целиком незачем.
	const memberKindLabels = {
		StandardAttribute: 'Стандартный реквизит',
		Attribute: 'Реквизит',
		AddressingAttribute: 'Реквизит адресации',
		TabularSection: 'Табличная часть',
		Form: 'Форма',
		Template: 'Макет',
		Command: 'Команда',
		EnumValue: 'Значение',
	};

	function humanizeMetadataReference(value) {
		const parts = value.split('.');
		if (parts.length === 4 && memberKindLabels[parts[2]]) {
			return `${memberKindLabels[parts[2]]}: ${parts[3]}`;
		}
		const match = /^([A-Za-z][A-Za-z0-9]*)\.(.+)$/.exec(value);
		if (!match) {
			return '';
		}
		const label = refKindLabels[match[1]];
		if (!label || !match[2]) {
			return '';
		}
		return `${label}: ${match[2]}`;
	}

	function asObject(value) {
		return typeof value === 'object' && value !== null ? value : {};
	}

	function escapeHtml(value) {
		return String(value)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	if (toggleTechnicalButton) {
		toggleTechnicalButton.addEventListener('click', function () {
			technicalVisible = !technicalVisible;
			renderTechnical();
		});
	}

	renderWarnings();
	renderTabs();
	renderContent();
	renderTechnical();
	initSaveBar();
	renderSaveBar();
})();
