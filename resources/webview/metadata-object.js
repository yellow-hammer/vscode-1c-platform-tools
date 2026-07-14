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
	let activeTabId = tabs[0] ? tabs[0].id : '';
	let technicalVisible = false;

	const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
	const editable = model.editable && typeof model.editable === 'object' ? model.editable : null;
	let editedProps = editable ? deepClone(editable.props) : null;
	let editedStructure = model.structureLists ? structureEditsFromLists(model.structureLists) : null;
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

	function structureEditsFromLists(lists) {
		const rowFrom = function (r) {
			const item = typeof r === 'object' && r !== null ? r : {};
			return {
				originalName: typeof item.name === 'string' ? item.name : '',
				name: typeof item.name === 'string' ? item.name : '',
				synonymRu: typeof item.synonymRu === 'string' ? item.synonymRu : '',
				baselineSynonymRu: typeof item.synonymRu === 'string' ? item.synonymRu : '',
				comment: typeof item.comment === 'string' ? item.comment : '',
				deleted: false,
			};
		};
		return {
			attributes: (Array.isArray(lists.attributes) ? lists.attributes : []).map(rowFrom),
			tabularSections: (Array.isArray(lists.tabularSections) ? lists.tabularSections : []).map(function (t) {
				const row = rowFrom(t);
				row.attributes = (Array.isArray(t.attributes) ? t.attributes : []).map(rowFrom);
				return row;
			}),
		};
	}

	function eachStructRow(fn) {
		if (!editedStructure) {
			return;
		}
		for (const row of editedStructure.attributes) {
			fn(row, null);
		}
		for (const ts of editedStructure.tabularSections) {
			fn(ts, null);
			for (const row of ts.attributes) {
				fn(row, ts);
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
		const attr = structure.attributes.map((row) => row.originalName || '+').join('|');
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
		for (const row of [...editedStructure.attributes, ...editedStructure.tabularSections]) {
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
			attributes: editedStructure.attributes.map(rowOut),
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
		if (Array.isArray(value)) {
			return JSON.stringify(value);
		}
		return value === undefined || value === '' ? null : value;
	}

	function isDirty() {
		if (!editable || !editedProps) {
			return false;
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
			default:
				contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
		}
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
				const optionsHtml = options
					.map(
						(option) =>
							`<option value="${escapeHtml(option.value)}"${option.value === current ? ' selected' : ''}>${escapeHtml(option.label)}</option>`
					)
					.join('');
				return `<select id="${id}" class="edit-input" data-path="${escapeHtml(field.path)}" data-control="select"${disabled}>${optionsHtml}</select>`;
			}
			case 'moduleLink':
				return `<button type="button" class="edit-module-link" data-module-kind="${escapeHtml(field.path)}">Открыть</button>`;
			case 'refList': {
				const selected = Array.isArray(value) ? value : [];
				const options = Array.isArray(field.options) ? field.options : [];
				const labelByValue = {};
				for (const option of options) {
					labelByValue[option.value] = option.label;
				}
				const rows = selected
					.map(
						(item, itemIdx) => `<div class="edit-ref-item">
							<span class="edit-ref-item-label">${escapeHtml(labelByValue[item] || toDisplayText(item))}</span>
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
							${available
								.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
								.join('')}
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
				return `<div class="edit-chips">${items
					.map((item) => `<span class="edit-chip">${escapeHtml(toDisplayText(item))}</span>`)
					.join('')}</div>`;
			}
			default:
				return `<input id="${id}" class="edit-input" type="text" data-path="${escapeHtml(field.path)}" data-control="text" value="${escapeHtml(typeof value === 'string' ? value : '')}"${disabled} />`;
		}
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
						return `<div class="edit-row">
							<label class="edit-label">${escapeHtml(field.label)}</label>
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
		const filterHtml = tabId === 'edit_main'
			? `<div class="edit-filter-row">
				<span class="edit-filter-wrap">
					<input id="editFilterInput" class="edit-input edit-filter" type="text" placeholder="Поиск свойства..." value="${escapeHtml(editFilter)}" />
					<button id="editFilterClear" class="edit-filter-clear${editFilter ? '' : ' hidden'}" type="button" title="Очистить">×</button>
				</span>
			</div>`
			: '';
		if (tabId === 'edit_data') {
			// Раскладка EDT: слева редактируемые реквизиты и табличные части, справа группы свойств.
			contentRoot.innerHTML = `${filterHtml}<div class="edit-data-layout">
					<div class="edit-data-structure">
						<div class="section-title">Реквизиты</div>
						${structEditListHtml()}
						<div class="section-title section-title-spaced">Табличные части</div>
						${structEditTsHtml()}
					</div>
					<div class="edit-data-props">${groupsHtml}</div>
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
				renderSaveBar();
			};
			input.addEventListener(control === 'check' || control === 'select' ? 'change' : 'input', handler);
		}
		bindRefListButtons(spec);
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
			status.textContent = 'Сохранение...';
		} else if (dirty && structError) {
			status.textContent = structError;
		} else if (saveError) {
			status.textContent = saveError;
		} else if (dirty) {
			status.textContent = 'Есть несохраненные изменения';
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
		saveBtn.addEventListener('click', function () {
			if (saving || !isDirty() || structValidationError()) {
				return;
			}
			saving = true;
			saveError = '';
			savedFlash = false;
			renderSaveBar();
			vscodeApi.postMessage({ type: 'save', payload: editedProps, structure: serializeStructureEdits() });
		});
		resetBtn.addEventListener('click', function () {
			if (saving || !editable) {
				return;
			}
			editedProps = deepClone(editable.props);
			editedStructure = model.structureLists ? structureEditsFromLists(model.structureLists) : null;
			structBaselineOrderKey = structOrderKey(editedStructure);
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
		if (parts[0] === 'a') {
			return editedStructure.attributes[Number(parts[1])] || null;
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

	function structEditRowHtml(row, spath) {
		const deleted = row.deleted;
		const invalid = !deleted && !structNameValid(row.name) ? ' struct-input-invalid' : '';
		const dis = deleted ? ' disabled' : '';
		return `<div class="struct-item${deleted ? ' struct-item-deleted' : ''}"${row.comment ? ` title="${escapeHtml(row.comment)}"` : ''}>
			<input class="edit-input struct-input struct-input-name${invalid}" data-spath="${spath}" data-sfield="name" value="${escapeHtml(row.name)}" placeholder="Имя" spellcheck="false"${dis} />
			<input class="edit-input struct-input" data-spath="${spath}" data-sfield="synonymRu" value="${escapeHtml(row.synonymRu)}" placeholder="Синоним"${dis} />
			<span class="struct-actions-inline">
				<button type="button" class="struct-btn" data-smove="${spath}" data-smove-dir="-1" title="Вверх"${dis}>↑</button>
				<button type="button" class="struct-btn" data-smove="${spath}" data-smove-dir="1" title="Вниз"${dis}>↓</button>
				<button type="button" class="struct-btn${deleted ? '' : ' struct-btn-danger'}" data-sdel="${spath}" title="${deleted ? 'Вернуть' : 'Удалить'}">${deleted ? '↩' : '×'}</button>
			</span>
		</div>`;
	}

	function structEditListHtml() {
		if (!editedStructure) {
			return '<div class="edit-ref-empty">(нет данных)</div>';
		}
		const rows = editedStructure.attributes.map((row, idx) => structEditRowHtml(row, `a.${idx}`)).join('');
		return `<div class="struct-list">${rows || '<div class="edit-ref-empty">(пусто)</div>'}</div>
			<div class="struct-add-row"><button type="button" class="struct-add-btn" data-sadd="a">+ Реквизит…</button></div>`;
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
					if (parts[0] === 'a') {
						editedStructure.attributes.splice(Number(parts[1]), 1);
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
				if (parts[0] === 'a') {
					list = editedStructure.attributes;
					index = Number(parts[1]);
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
				if (target === 'a') {
					editedStructure.attributes.push({ ...emptyRow });
					newSpath = `a.${editedStructure.attributes.length - 1}`;
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

	function humanizeMetadataReference(value) {
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
