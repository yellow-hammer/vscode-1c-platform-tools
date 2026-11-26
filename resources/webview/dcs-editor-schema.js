/**
 * Закладки схемы редактора СКД: наборы данных с текстом запроса, связи наборов, вычисляемые поля, ресурсы, параметры,
 * вложенные схемы; окно «Тип значения» и форма роли и ограничений поля.
 *
 * Подключается до dcs-editor.js и задаёт фабрику window.DcsEditorSchema. Основной скрипт вызывает её в конце запуска
 * с объектом ядра (JSDoc у const core в dcs-editor.js): других имён редактора закладки не видят. Общее изменяемое
 * состояние читается и пишется через аксессоры ядра (core.model, core.saving…), не копией. Фабрика возвращает
 * отрисовку закладок и обработчики ответов.
 */
window.DcsEditorSchema = function (core) {
	'use strict';

	const {
		actionsCell, actionSelect, announceCompletion, attachCompletion, autofillNoticeLines, BUSY, calculatedFieldPaths,
		cell, checkbox, checkRow, closeDialog, codeEditor, completer, completionTypeOptions, confirmRemove, dataSetFieldPaths,
		dataSetNames, dataTable, describeComposition, describeLookup, el, emptyNote, expressionInput, fieldPaths, fieldTree,
		fieldTreeKey, fieldTypes, focusKey, focusKeys, formRow, groupTitle, HIGHLIGHT_DEBOUNCE_MS, iconButton, keyed,
		kindLabel, list, listSection, listToolbar, nameCheckAvailable, nameEl, nameTaken, numberInput, openDialog,
		parseQueryCached, postEdit, pruneVariantCache, pushDialog, queryModelApi, queryNameProblems, renderContent,
		renderTabs, replyFocus, requestDescriptions, requestTypeDictionary, selectInput, send, setHint, setNameText,
		setStatus, setTransferState, showNotice, suggestName, tableDropZone, textInput, transferButtons, typeCompositionOf,
		typeLabelOf, typeRules, valueSummary, whenIdle, withTypeCompositions,
	} = core;

	// ---------- ограничения и роль поля ----------

	const RESTRICTION_FLAGS = [
		{ key: 'field', label: 'Поле' },
		{ key: 'condition', label: 'Условие' },
		{ key: 'group', label: 'Группировка' },
		{ key: 'order', label: 'Упорядочивание' },
	];

	function restrictionBoxes(host, restriction) {
		const inputs = {};
		const boxes = [];
		for (const flag of RESTRICTION_FLAGS) {
			const box = checkbox(flag.label, restriction && restriction[flag.key]);
			inputs[flag.key] = box.input;
			boxes.push(box);
		}
		checkRow(host, boxes);
		return inputs;
	}

	function restrictionOf(inputs) {
		return {
			field: inputs.field.checked,
			condition: inputs.condition.checked,
			group: inputs.group.checked,
			order: inputs.order.checked,
		};
	}

	function restrictionChanged(inputs, original) {
		const current = restrictionOf(inputs);
		const was = original || {};
		return RESTRICTION_FLAGS.some((flag) => current[flag.key] !== Boolean(was[flag.key]));
	}

	function roleSummary(role) {
		if (!role) {
			return '';
		}
		const parts = [];
		if (role.dimension) {
			parts.push('измерение');
		}
		if (role.required) {
			parts.push('обязательное');
		}
		if (typeof role.periodNumber === 'number' && role.periodNumber > 0) {
			parts.push('период ' + role.periodNumber + (role.periodType === 'Additional' ? ' (доп.)' : ''));
		}
		if (role.account) {
			parts.push('счёт');
		}
		if (role.balanceType === 'OpeningBalance') {
			parts.push('начальный остаток');
		} else if (role.balanceType === 'ClosingBalance') {
			parts.push('конечный остаток');
		} else if (role.balance) {
			parts.push('остаток');
		}
		if (role.accountField) {
			parts.push('поле счёта: ' + role.accountField);
		}
		if (role.ignoreNullValues) {
			parts.push('игнорировать NULL');
		}
		return parts.join(', ');
	}

	/** Поля роли; setName: набор, из которого подсказывается поле счёта. */
	function roleForm(body, role, setName) {
		const dimension = checkbox('Измерение', role.dimension);
		const required = checkbox('Обязательное', role.required);
		const ignoreNull = checkbox('Игнорировать NULL', role.ignoreNullValues);
		const account = checkbox('Счёт', role.account);
		const balance = checkbox('Остаток', role.balance);
		checkRow(body, [dimension, required, ignoreNull, account, balance]);
		const periodNumber = formRow(body, 'Номер периода', numberInput(role.periodNumber));
		const periodType = formRow(
			body,
			'Тип периода',
			selectInput(
				[
					{ value: '', label: '' },
					{ value: 'Main', label: 'Основной' },
					{ value: 'Specify', label: 'Указывается' },
					{ value: 'Additional', label: 'Дополнительный' },
				],
				role.periodType || ''
			)
		);
		const balanceType = formRow(
			body,
			'Тип остатка',
			selectInput(
				[
					{ value: '', label: '' },
					{ value: 'None', label: 'Нет' },
					{ value: 'OpeningBalance', label: 'Начальный остаток' },
					{ value: 'ClosingBalance', label: 'Конечный остаток' },
				],
				role.balanceType || ''
			)
		);
		const accountField = formRow(body, 'Поле счёта', textInput(role.accountField));
		if (setName) {
			attachCompletion(accountField, () => 'field-of-set:' + setName);
		}

		// Снятые уточнения (пустой номер, тип, поле счёта) в payload не входят и в схеме не очищаются
		function current() {
			const value = {
				dimension: dimension.input.checked,
				required: required.input.checked,
				account: account.input.checked,
				balance: balance.input.checked,
				ignoreNullValues: ignoreNull.input.checked,
			};
			const raw = periodNumber.value.trim();
			if (raw !== '') {
				value.periodNumber = Number(raw);
			}
			if (periodType.value) {
				value.periodType = periodType.value;
			}
			if (balanceType.value) {
				value.balanceType = balanceType.value;
			}
			const field = accountField.value.trim();
			if (field) {
				value.accountField = field;
			}
			return value;
		}

		function changed() {
			const now = current();
			return (
				now.dimension !== Boolean(role.dimension) ||
				now.required !== Boolean(role.required) ||
				now.account !== Boolean(role.account) ||
				now.balance !== Boolean(role.balance) ||
				now.ignoreNullValues !== Boolean(role.ignoreNullValues) ||
				(now.periodNumber || 0) !== (role.periodNumber || 0) ||
				(now.periodType || '') !== (role.periodType || '') ||
				(now.balanceType || '') !== (role.balanceType || '') ||
				(now.accountField || '') !== (role.accountField || '')
			);
		}

		function validate() {
			const raw = periodNumber.value.trim();
			if (raw !== '' && (!Number.isInteger(Number(raw)) || Number(raw) < 1)) {
				return 'Укажите целый номер периода, от 1.';
			}
			return undefined;
		}

		return { current: current, changed: changed, validate: validate };
	}

	// ---------- тип значения: колонка «Тип» и окно «Тип значения» ----------

	/** Предел строк одного вида в дереве: объектов бывают тысячи, нужный ищут поиском. */
	const TYPE_TREE_ROW_LIMIT = 300;

	/** Квалифицируемые примитивы в порядке панели квалификаторов. */
	const QUALIFIED_PRIMITIVES = ['xs:string', 'xs:decimal', 'xs:dateTime'];

	const ALLOWED_LENGTH_OPTIONS = [
		{ value: 'VARIABLE', label: 'Переменная' },
		{ value: 'FIXED', label: 'Фиксированная' },
	];

	const DATE_FRACTIONS_OPTIONS = [
		{ value: 'DATE', label: 'Дата' },
		{ value: 'TIME', label: 'Время' },
		{ value: 'DATE_TIME', label: 'Дата и время' },
	];

	/** Приводит значение квалификатора (текст файла или имя константы) к значению списка выбора. */
	function qualifierConstant(value, fallback) {
		const text = String(value || '').trim();
		const map = { Variable: 'VARIABLE', Fixed: 'FIXED', Any: 'ANY', Nonnegative: 'NONNEGATIVE', Date: 'DATE', Time: 'TIME', DateTime: 'DATE_TIME' };
		return map[text] || text || fallback;
	}

	/** Ячейка «Тип»: с onOpen кнопка окна типа, без него подпись текстом. */
	function typeCell(tr, valueType, fallback, what, onOpen) {
		const td = el('td', 'dcs-cell-type');
		const text = typeLabelOf(valueType, fallback);
		const composition = typeCompositionOf(valueType);
		if (!onOpen) {
			setNameText(td, text || '');
			describeComposition(td, composition);
			tr.appendChild(td);
			return td;
		}
		const button = nameEl('button', 'dcs-type-link', text || '…');
		button.type = 'button';
		const readOnly = Boolean(valueType && valueType.editable === false);
		if (readOnly) {
			button.classList.add('dcs-type-ro');
		}
		button.title = (text ? 'Тип значения: ' + text : 'Тип не задан') + (readOnly ? ' (правится в конфигураторе)' : '');
		button.setAttribute('aria-label', 'Тип значения ' + what + ': ' + (text || 'не задан'));
		describeComposition(button, composition);
		button.addEventListener('click', onOpen);
		td.appendChild(button);
		tr.appendChild(td);
		return td;
	}

	/** Что станет со значением, которое не подходит к новому типу. */
	function clearingText(change) {
		if (change.blocked) {
			return 'Значение правится в конфигураторе: к новому типу его здесь не привести, тип не сохранится.';
		}
		if (change.value === null) {
			return 'Значение не подходит к новому типу и при сохранении будет снято: у такого типа нет одного пустого значения.';
		}
		const summary = valueSummary(change.value);
		return (
			'Значение не подходит к новому типу и при сохранении будет заменено ' +
			(summary ? 'значением «' + summary + '».' : 'пустым значением типа.')
		);
	}

	/** Исходные данные параметра, с которыми typeEditPayload сравнивает итог диалога. */
	function parameterOriginal(param) {
		return {
			valueType: param.valueType,
			value: param.valueTyped,
			valueListAllowed: param.valueListAllowed,
			availableAsField: param.availableAsField,
			denyIncompleteValues: param.denyIncompleteValues,
		};
	}

	/** Предупреждения о данных владельца, которые смена типа может рассогласовать. */
	function typeOwnerWarnings(owner) {
		const out = [];
		if (owner.hasAvailableValues) {
			out.push('У параметра записаны доступные значения: после смены типа проверьте их в конфигураторе.');
		}
		if (owner.hasInputParameters) {
			out.push('Записаны параметры редактирования: после смены типа проверьте их в конфигураторе.');
		}
		return out;
	}

	/**
	 * Окно «Тип значения»: новый уровень стека окон. Правит копию типа, ОК передаёт итог в spec.onDone.
	 *
	 * spec: {title, valueType, readOnlyReason? (только просмотр), warnings? (о данных владельца),
	 * parameter? ({value, valueListAllowed}: блок «Значение» и флажок «Доступен список значений»),
	 * onDone(edited, level): текст ошибки или undefined}. edited: {valueType, valueListAllowed?}.
	 */
	function openTypeDialog(spec) {
		requestTypeDictionary();
		const source = spec.valueType || null;
		const sourceReadOnly = Boolean(source && source.editable === false);
		const readOnlyReason = spec.readOnlyReason || (sourceReadOnly ? source.readOnlyReason : '');
		const readOnly = readOnlyReason !== '';
		const parameter = spec.parameter || null;
		const state = {
			// Копия: поля квалификаторов пишут в неё, а не в модель
			type: JSON.parse(JSON.stringify(source || { types: [], typeSets: [], typeIds: [] })),
			composite: typeRules.typeItems(source).length > 1,
			query: '',
			expanded: new Set(['primitives']),
			listAllowed: Boolean(parameter && parameter.valueListAllowed),
		};
		let platesHost;
		let compositeBox;
		let chipsHost;
		let treeHost;
		let qualifiersHost;
		let qualifiersSignature = null;
		let qualifierErrors = {};
		let changeWarnEl;
		let valueWarnEl;
		let summaryEl;
		let treeRows = [];

		function renderPlates() {
			platesHost.textContent = '';
			if (readOnly) {
				platesHost.appendChild(el('div', 'dcs-plate', 'Только просмотр: ' + readOnlyReason));
			}
			if (!core.typeDictionary && core.typeDictionaryError === '') {
				platesHost.appendChild(el('div', 'dcs-plate', 'Загрузка словаря типов…'));
			} else if (core.typeDictionaryError !== '') {
				const plate = el('div', 'dcs-plate dcs-plate-error', 'Словарь типов не загружен: ' + core.typeDictionaryError + ' Доступны только примитивы.');
				const retry = el('button', 'ghost-btn dcs-btn-small', 'Повторить');
				retry.type = 'button';
				retry.addEventListener('click', () => {
					core.typeDictionaryError = '';
					requestTypeDictionary();
					renderAll();
				});
				plate.appendChild(retry);
				platesHost.appendChild(plate);
			} else if (core.typeDictionary.configurationFound === false) {
				platesHost.appendChild(
					el(
						'div',
						'dcs-plate',
						'Макет вне выгрузки конфигурации: новыми можно выбрать только примитивы и «любую ссылку», а записанные ссылочные типы можно снять.'
					)
				);
			}
		}

		function toggle(value) {
			if (readOnly) {
				return;
			}
			state.type = typeRules.toggleType(state.type, value, state.composite);
			// Определяемый тип в составной не входит: флажок «Составной» при нём снят и заблокирован
			if (state.type.typeIds.length > 0) {
				state.composite = false;
			}
			selectionChanged();
		}

		function renderChips() {
			chipsHost.textContent = '';
			const items = typeRules.typeItems(state.type, core.typeDictionary);
			if (items.length === 0) {
				chipsHost.appendChild(el('span', 'dcs-ro-note', 'Тип не задан.'));
				return;
			}
			for (const item of items) {
				const chip = el('span', 'dcs-type-chip');
				chip.appendChild(nameEl('span', '', item.label));
				if (!readOnly) {
					// Снять можно и то, чего нет в дереве: записанную ссылку вне выгрузки, тип с чужим именем
					const remove = el('button', 'dcs-type-chip-remove', '×');
					remove.type = 'button';
					remove.title = 'Убрать «' + item.label + '»';
					remove.setAttribute('aria-label', 'Убрать тип ' + item.label);
					remove.addEventListener('click', () => {
						toggle(item.value);
					});
					chip.appendChild(remove);
				}
				chipsHost.appendChild(chip);
			}
		}

		function syncTreeChecks() {
			for (const row of treeRows) {
				if (row.input) {
					row.input.checked = typeRules.hasType(state.type, row.value);
					row.el.setAttribute('aria-checked', String(row.input.checked));
				}
			}
		}

		function focusTreeRow(index) {
			const row = treeRows[index];
			if (!row) {
				return;
			}
			for (const other of treeRows) {
				other.el.tabIndex = -1;
			}
			row.el.tabIndex = 0;
			row.el.focus();
		}

		function onTreeKey(event, index) {
			const row = treeRows[index];
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				focusTreeRow(index + (event.key === 'ArrowDown' ? 1 : -1));
			} else if (event.key === 'ArrowRight' && row.node && !row.open) {
				event.preventDefault();
				setExpanded(row.key, true);
			} else if (event.key === 'ArrowLeft') {
				event.preventDefault();
				if (row.node && row.open) {
					setExpanded(row.key, false);
				} else if (row.parentKey) {
					focusTreeRow(treeRows.findIndex((candidate) => candidate.key === row.parentKey));
				}
			} else if (event.key === ' ' && row.input && !row.input.disabled) {
				event.preventDefault();
				toggle(row.value);
			}
		}

		function setExpanded(key, open) {
			if (open) {
				state.expanded.add(key);
			} else {
				state.expanded.delete(key);
			}
			renderTree(key);
		}

		function addTreeRow(spec, depth) {
			const rowEl = el('div', 'dcs-tree-row dcs-type-tree-row');
			rowEl.setAttribute('role', 'treeitem');
			// Строки дерева без role=group: глубину читалке передаёт aria-level
			rowEl.setAttribute('aria-level', String(depth + 1));
			rowEl.style.paddingLeft = 8 + depth * 18 + 'px';
			rowEl.tabIndex = treeRows.length === 0 ? 0 : -1;
			const row = { el: rowEl, key: spec.key, value: spec.value, node: Boolean(spec.node), open: Boolean(spec.open), parentKey: spec.parentKey || '' };
			const twist = el('span', 'dcs-tree-twist', spec.node ? (spec.open ? '▾' : '▸') : '');
			if (spec.node) {
				rowEl.setAttribute('aria-expanded', String(Boolean(spec.open)));
				twist.addEventListener('click', (event) => {
					event.stopPropagation();
					setExpanded(spec.key, !spec.open);
				});
			}
			rowEl.appendChild(twist);
			if (spec.value !== undefined) {
				const input = el('input', 'edit-check');
				input.type = 'checkbox';
				// Tab останавливается на строке, флажок ставится пробелом или щелчком
				input.tabIndex = -1;
				input.checked = typeRules.hasType(state.type, spec.value);
				input.disabled = readOnly;
				input.setAttribute('aria-label', spec.checkLabel || spec.label);
				input.addEventListener('click', (event) => {
					event.stopPropagation();
				});
				input.addEventListener('change', () => {
					toggle(spec.value);
				});
				rowEl.setAttribute('aria-checked', String(input.checked));
				rowEl.appendChild(input);
				row.input = input;
			}
			rowEl.appendChild(nameEl('span', 'dcs-tree-label', spec.label));
			if (spec.hint) {
				rowEl.appendChild(nameEl('span', 'dcs-tree-name', spec.hint));
			}
			if (spec.count !== undefined) {
				rowEl.appendChild(el('span', 'dcs-tree-badge', String(spec.count)));
			}
			// Щелчок по узлу раскрывает его, по листу ставит флажок; флажок узла обрабатывает щелчок сам
			rowEl.addEventListener('click', () => {
				if (spec.node) {
					setExpanded(spec.key, !spec.open);
				} else if (row.input && !row.input.disabled) {
					toggle(spec.value);
				}
			});
			const index = treeRows.length;
			rowEl.addEventListener('keydown', (event) => {
				onTreeKey(event, index);
			});
			treeRows.push(row);
			treeHost.appendChild(rowEl);
		}

		/** Ключ строки дерева: по нему после перерисовки возвращается фокус. */
		function rowKey(value) {
			return 'type:' + (value && typeof value === 'object' ? String(value.typeId || '').toLowerCase() : String(value));
		}

		function renderTree(focusKey) {
			const active = document.activeElement;
			const activeRow = treeRows.find((row) => row.el === active);
			const keep = focusKey || (activeRow ? activeRow.key : '');
			treeHost.textContent = '';
			treeRows = [];
			const nodes = typeRules.typeTree(core.typeDictionary, state.query);
			if (nodes.length === 0) {
				treeHost.appendChild(el('div', 'dcs-plate', 'По запросу «' + state.query.trim() + '» типов нет.'));
				return;
			}
			for (const node of nodes) {
				if (node.kind === 'row') {
					addTreeRow({ key: node.key, value: node.value, label: node.label }, 0);
					continue;
				}
				const open = Boolean(node.open) || state.expanded.has(node.key);
				const nodeSpec = { key: node.key, label: node.label, node: true, open: open, count: node.total };
				if (node.kind === 'kind') {
					// Флажок вида означает «любая ссылка вида» (TypeSet)
					nodeSpec.value = node.typeSet;
					nodeSpec.hint = node.platformName;
					nodeSpec.checkLabel = 'Любая ссылка вида «' + node.label + '»';
				}
				addTreeRow(nodeSpec, 0);
				if (!open) {
					continue;
				}
				const limit = Math.min(node.rows.length, TYPE_TREE_ROW_LIMIT);
				for (let index = 0; index < limit; index += 1) {
					const item = node.rows[index];
					addTreeRow({ key: rowKey(item.value), value: item.value, label: item.label, parentKey: node.key }, 1);
				}
				if (node.rows.length > limit) {
					treeHost.appendChild(
						el('div', 'dcs-type-more', 'Показаны первые ' + limit + ' из ' + node.rows.length + ', уточните поиск.')
					);
				}
			}
			if (keep) {
				const index = treeRows.findIndex((row) => row.key === keep);
				if (index >= 0 && (focusKey || activeRow)) {
					focusTreeRow(index);
				}
			}
		}

		/** Числовое поле квалификатора; max только для спиннера, границу проверяет validateQualifiers. */
		function qualifierInput(host, label, value, field, onInput, max) {
			const input = el('input', 'edit-input dcs-input-number');
			input.type = 'number';
			input.min = '0';
			if (max !== undefined) {
				input.max = String(max);
			}
			input.step = '1';
			input.value = value === undefined || value === null ? '' : String(value);
			input.disabled = readOnly;
			input.addEventListener('input', () => {
				onInput(input.value.trim());
			});
			formRow(host, label, input);
			const error = el('div', 'dcs-type-qerror');
			error.setAttribute('aria-live', 'polite');
			host.appendChild(error);
			qualifierErrors[field] = { el: error, input: input };
			return input;
		}

		function qualifierSelect(host, label, options, value, field, onChange) {
			const select = selectInput(options, value);
			select.disabled = readOnly;
			select.addEventListener('change', () => {
				onChange(select.value);
			});
			formRow(host, label, select);
			const error = el('div', 'dcs-type-qerror');
			host.appendChild(error);
			qualifierErrors[field] = { el: error, input: select };
			return select;
		}

		/** Пишет поле квалификатора в новый объект, прочитанный не трогается. */
		function setQualifier(key, name, value) {
			const next = Object.assign({}, state.type[key] || {});
			next[name] = value;
			state.type[key] = next;
			qualifiersChanged();
		}

		/**
		 * Панель квалификаторов строится заново, только когда сменился состав отмеченных
		 * примитивов: иначе ввод длины перерисовывал бы поле под курсором.
		 */
		function renderQualifiers() {
			const present = QUALIFIED_PRIMITIVES.filter((type) => state.type.types.indexOf(type) >= 0);
			const signature = present.join('|');
			if (signature === qualifiersSignature) {
				return;
			}
			qualifiersSignature = signature;
			qualifiersHost.textContent = '';
			qualifierErrors = {};
			if (present.indexOf('xs:string') >= 0) {
				const q = state.type.stringQualifiers || {};
				groupTitle(qualifiersHost, 'Строка');
				qualifierInput(qualifiersHost, 'Длина (0 = без ограничения)', q.length, 'stringQualifiers.length', (value) => {
					setQualifier('stringQualifiers', 'length', value);
				});
				qualifierSelect(
					qualifiersHost,
					'Допустимая длина',
					ALLOWED_LENGTH_OPTIONS,
					qualifierConstant(q.allowedLength, 'VARIABLE'),
					'stringQualifiers.allowedLength',
					(value) => {
						setQualifier('stringQualifiers', 'allowedLength', value);
					}
				);
			}
			if (present.indexOf('xs:decimal') >= 0) {
				const q = state.type.numberQualifiers || {};
				groupTitle(qualifiersHost, 'Число');
				qualifierInput(
					qualifiersHost,
					'Разрядность',
					q.digits,
					'numberQualifiers.digits',
					(value) => {
						setQualifier('numberQualifiers', 'digits', value);
					},
					typeRules.MAX_DIGITS
				);
				qualifierInput(qualifiersHost, 'Дробная часть', q.fractionDigits, 'numberQualifiers.fractionDigits', (value) => {
					setQualifier('numberQualifiers', 'fractionDigits', value);
				});
				const sign = checkbox('Неотрицательное', qualifierConstant(q.allowedSign, 'ANY') === 'NONNEGATIVE');
				sign.input.disabled = readOnly;
				sign.input.addEventListener('change', () => {
					setQualifier('numberQualifiers', 'allowedSign', sign.input.checked ? 'NONNEGATIVE' : 'ANY');
				});
				checkRow(qualifiersHost, [sign]);
			}
			if (present.indexOf('xs:dateTime') >= 0) {
				const q = state.type.dateQualifiers || {};
				groupTitle(qualifiersHost, 'Дата');
				qualifierSelect(
					qualifiersHost,
					'Состав даты',
					DATE_FRACTIONS_OPTIONS,
					qualifierConstant(q.dateFractions, 'DATE_TIME'),
					'dateQualifiers.dateFractions',
					(value) => {
						setQualifier('dateQualifiers', 'dateFractions', value);
					}
				);
			}
		}

		/** Ошибка квалификатора выводится у своего поля, общая (квалификатор без типа) у первого поля вида. */
		function paintQualifierErrors() {
			const errors = typeRules.validateQualifiers(state.type);
			for (const field of Object.keys(qualifierErrors)) {
				const slot = qualifierErrors[field];
				const own = errors.find((error) => error.field === field || field.indexOf(error.field + '.') === 0);
				slot.el.textContent = own ? own.message : '';
				if (own) {
					slot.input.setAttribute('aria-invalid', 'true');
				} else {
					slot.input.removeAttribute('aria-invalid');
				}
			}
			return errors;
		}

		function paintComposite() {
			const items = typeRules.typeItems(state.type).length;
			compositeBox.input.checked = state.composite;
			// Выключение составного при нескольких типах молча выбросило бы лишние: их снимают вручную
			compositeBox.input.disabled = readOnly || state.type.typeIds.length > 0 || (state.composite && items > 1);
			compositeBox.wrap.title =
				state.type.typeIds.length > 0
					? 'Определяемый тип в составной не входит'
					: state.composite && items > 1
						? 'Снимите лишние типы, чтобы выключить составной тип'
						: '';
		}

		function changed() {
			return !typeRules.sameType(source, state.type);
		}

		function paintChangeWarnings() {
			if (changeWarnEl) {
				const warnings = changed() ? spec.warnings || [] : [];
				changeWarnEl.textContent = warnings.join(' ');
			}
			if (valueWarnEl) {
				const change = changed() ? typeRules.valueClearing(state.type, parameter.value, core.typeDictionary) : null;
				valueWarnEl.textContent = change ? clearingText(change) : '';
			}
		}

		function paintSummary() {
			const text = typeRules.typePresentation(state.type, core.typeDictionary);
			summaryEl.textContent = 'Итог: ' + (text || 'тип не задан');
		}

		function qualifiersChanged() {
			paintQualifierErrors();
			paintSummary();
			paintChangeWarnings();
		}

		function selectionChanged() {
			renderChips();
			syncTreeChecks();
			renderQualifiers();
			paintQualifierErrors();
			paintComposite();
			paintChangeWarnings();
			paintSummary();
		}

		function renderAll() {
			renderPlates();
			renderTree();
			selectionChanged();
		}

		function build(body) {
			platesHost = el('div', 'dcs-type-plates');
			body.appendChild(platesHost);
			const toolbar = el('div', 'dcs-type-toolbar');
			const search = el('input', 'edit-input dcs-type-search');
			search.type = 'search';
			search.placeholder = 'Поиск типа';
			search.setAttribute('aria-label', 'Поиск типа по имени');
			search.addEventListener('input', () => {
				state.query = search.value;
				renderTree();
			});
			toolbar.appendChild(search);
			compositeBox = checkbox('Составной тип данных', state.composite);
			compositeBox.input.addEventListener('change', () => {
				state.composite = compositeBox.input.checked;
				paintComposite();
			});
			toolbar.appendChild(compositeBox.wrap);
			body.appendChild(toolbar);
			chipsHost = el('div', 'dcs-type-chips');
			chipsHost.setAttribute('aria-label', 'Выбранные типы');
			body.appendChild(chipsHost);
			treeHost = el('div', 'dcs-tree dcs-type-tree');
			treeHost.setAttribute('role', 'tree');
			treeHost.setAttribute('aria-label', 'Типы');
			body.appendChild(treeHost);
			qualifiersHost = el('div', 'dcs-type-qualifiers');
			body.appendChild(qualifiersHost);
			changeWarnEl = el('div', 'dcs-warn dcs-type-warn');
			body.appendChild(changeWarnEl);
			if (parameter) {
				groupTitle(body, 'Значение');
				const value = parameter.value;
				const current = value === undefined ? 'не задано' : valueSummary(value) || 'пустое';
				body.appendChild(el('div', 'dcs-type-value', 'Сейчас: ' + current));
				if (schemaListDropsNil(value)) {
					body.appendChild(el('div', 'dcs-warn dcs-list-nil-warn', SCHEMA_LIST_NIL_WARNING));
				}
				const presentationWarning = schemaListPresentationWarning(value, parameter.valueListAllowed, valueSummary);
				if (presentationWarning) {
					body.appendChild(el('div', 'dcs-warn dcs-list-presentation-warn', presentationWarning));
				}
				valueWarnEl = el('div', 'dcs-warn dcs-type-warn');
				valueWarnEl.setAttribute('aria-live', 'polite');
				body.appendChild(valueWarnEl);
				const listBox = checkbox('Доступен список значений', state.listAllowed);
				listBox.input.disabled = Boolean(spec.readOnlyReason);
				listBox.input.addEventListener('change', () => {
					state.listAllowed = listBox.input.checked;
				});
				checkRow(body, [listBox]);
			}
			summaryEl = el('div', 'dcs-type-summary');
			summaryEl.setAttribute('aria-live', 'polite');
			body.appendChild(summaryEl);
			renderAll();
		}

		function submit(level) {
			if (changed()) {
				const errors = paintQualifierErrors();
				if (errors.length > 0) {
					return errors[0].message;
				}
			}
			const edited = { valueType: state.type };
			if (parameter) {
				edited.valueListAllowed = state.listAllowed;
			}
			return spec.onDone(edited, level);
		}

		// Флажок списка параметра правится и при нередактируемом типе: тип тогда уходит без изменений
		const okDisabled = readOnly && !(parameter && !spec.readOnlyReason);
		const level = pushDialog({
			title: spec.title,
			width: 'wide',
			build: build,
			buttons: [
				{ id: 'ok', label: 'ОК', primary: true, disabled: okDisabled, onClick: submit },
				{ id: 'cancel', label: okDisabled ? 'Закрыть' : 'Отмена' },
			],
			onClose: () => {
				if (core.typeRerender === renderAll) {
					core.typeRerender = null;
				}
			},
		});
		if (level.isOpen()) {
			core.typeRerender = renderAll;
		}
		return level;
	}

	/**
	 * ОК окна типа из таблицы: пустой payload закрывает окно без записи. Отправляет вызывающий литеральным
	 * send: по таким вызовам проверки сверяют типы сообщений с панелью.
	 */
	function submitTypeEdit(original, edited, sendEdit) {
		const result = typeRules.typeEditPayload(original, edited, core.typeDictionary);
		if (result.error) {
			return result.error;
		}
		if (Object.keys(result.payload).length === 0) {
			closeDialog();
			return undefined;
		}
		return sendEdit(result.payload) ? undefined : BUSY;
	}

	/** Окно типа поля набора; у вложенного набора только просмотр. */
	function openFieldTypeDialog(setName, field, nestedSet) {
		const dataPath = field.dataPath || '';
		closeDialog();
		openTypeDialog({
			title: 'Тип значения поля «' + dataPath + '»',
			valueType: field.valueType,
			readOnlyReason: nestedSet
				? 'поле вложенного набора объединения: правятся поля наборов верхнего уровня.'
				: '',
			warnings: typeOwnerWarnings({ hasInputParameters: field.hasInputParameters }),
			onDone: (edited) =>
				submitTypeEdit({ valueType: field.valueType }, edited, (payload) =>
					send('dcs/set-field', { dataSet: setName, dataPath: dataPath, payload: payload })
				),
		});
	}

	function openCalculatedTypeDialog(field) {
		const dataPath = field.name || '';
		closeDialog();
		openTypeDialog({
			title: 'Тип значения вычисляемого поля «' + dataPath + '»',
			valueType: field.valueType,
			onDone: (edited) =>
				submitTypeEdit({ valueType: field.valueType }, edited, (payload) =>
					send('dcs/set-calculated-field', { dataPath: dataPath, payload: payload })
				),
		});
	}

	/** Окно типа параметра с блоком «Значение» и флажком списка; несовместимое с типом значение очищается. */
	function openParameterTypeDialog(param) {
		const name = param.name || '';
		closeDialog();
		openTypeDialog({
			title: 'Тип значения параметра «' + name + '»',
			valueType: param.valueType,
			parameter: { value: param.valueTyped, valueListAllowed: param.valueListAllowed },
			warnings: typeOwnerWarnings(param),
			onDone: (edited) =>
				submitTypeEdit(parameterOriginal(param), edited, (payload) => send('dcs/set-parameter', { name: name, payload: payload })),
		});
	}

	/**
	 * Строка «Тип» в диалоге поля или параметра: подпись и кнопка окна типа. Выбранный тип хранится
	 * в строке и уходит одной правкой с ОК владельца.
	 *
	 * options: {title(), fallback?, readOnlyReason?, warnings?, onChange?}. Возвращает
	 * {valueType()}: текущий выбор.
	 */
	function typeRow(body, initial, options) {
		let current = initial;
		let touched = false;
		const box = el('div', 'dcs-type-row');
		const text = el('span', 'dcs-type-text');
		const readOnly = Boolean(options.readOnlyReason) || Boolean(initial && initial.editable === false);
		const button = el('button', 'ghost-btn dcs-btn-small', readOnly ? 'Просмотр…' : 'Изменить…');
		button.type = 'button';
		const buttonTitle = readOnly ? 'Показать тип значения' : 'Выбрать тип значения';
		box.appendChild(text);
		box.appendChild(button);
		formRow(body, 'Тип', box);
		function paint() {
			setNameText(text, typeLabelOf(current, touched ? '' : options.fallback) || 'не задан');
			// Состав определяемого типа есть и у подписи, и у кнопки: подпись вне порядка Tab,
			// читалка услышит состав на кнопке
			text.title = '';
			button.title = buttonTitle;
			text.removeAttribute('aria-description');
			button.removeAttribute('aria-description');
			const composition = typeCompositionOf(current);
			describeComposition(text, composition);
			describeComposition(button, composition);
		}
		paint();
		button.addEventListener('click', () => {
			openTypeDialog({
				title: options.title(),
				valueType: current,
				readOnlyReason: options.readOnlyReason || '',
				warnings: options.warnings || [],
				onDone: (edited, level) => {
					current = edited.valueType;
					touched = true;
					paint();
					level.close();
					if (options.onChange) {
						options.onChange();
					}
					return undefined;
				},
			});
		});
		return {
			valueType: function () {
				return current;
			},
		};
	}

	// ---------- вкладка «Наборы данных» ----------
	// Слева дерево наборов, справа выбранный набор.

	/** Путь имён выбранного набора от верхнего уровня. */
	let dataSetPath = [];
	/** Свёрнутые объединения; ключ: путь имён через «/», в именах 1С её нет. */
	const collapsedSets = new Set();
	/** После перерисовки вернуть фокус на выбранную строку дерева. */
	let focusSetTree = false;
	/** Горизонтальная прокрутка таблицы полей, сохраняется между перерисовками. */
	let fieldsScrollLeft = 0;

	function setKey(names) {
		return names.join('/');
	}

	function dataSetAt(names) {
		let items = list('dataSets');
		let found = null;
		for (const name of names) {
			found = items.find((candidate) => (candidate.name || '') === name) || null;
			if (!found) {
				return null;
			}
			items = Array.isArray(found.items) ? found.items : [];
		}
		return found;
	}

	/** Пропавший после перечитки набор заменяется ближайшим предком или первым набором. */
	function ensureDataSetSelection() {
		// Нового набора ещё нет, ответ правки не пришёл: pendingDataSet снимет его обработчик
		if (core.pendingDataSet && dataSetAt([core.pendingDataSet])) {
			dataSetPath = [core.pendingDataSet];
			core.pendingDataSet = '';
		}
		while (dataSetPath.length > 0 && !dataSetAt(dataSetPath)) {
			dataSetPath = dataSetPath.slice(0, -1);
		}
		if (dataSetPath.length === 0) {
			const first = list('dataSets').find((candidate) => candidate.name);
			dataSetPath = first ? [first.name] : [];
		}
	}

	/** Строки дерева в порядке показа: для стрелок вверх и вниз. */
	function visibleSetPaths() {
		const paths = [];
		function walk(items, prefix) {
			for (const item of items) {
				if (!item.name) {
					continue;
				}
				const names = prefix.concat([item.name]);
				paths.push(names);
				const children = Array.isArray(item.items) ? item.items : [];
				if (children.length > 0 && !collapsedSets.has(setKey(names))) {
					walk(children, names);
				}
			}
		}
		walk(list('dataSets'), []);
		return paths;
	}

	function selectDataSet(names, keepFocus) {
		// Черновик запроса записывается до смены набора
		flushQueryEdits('nav');
		if (setKey(names) !== setKey(dataSetPath)) {
			fieldsScrollLeft = 0;
		}
		dataSetPath = names;
		focusSetTree = Boolean(keepFocus);
		renderContent();
	}

	function renderDataSets(host) {
		ensureDataSetSelection();
		const layout = el('div', 'dcs-sets');
		const side = el('div', 'dcs-sets-side');
		renderDataSetTree(side);
		renderDataSources(side);
		layout.appendChild(side);
		const body = el('div', 'dcs-sets-body');
		const selected = dataSetPath.length > 0 ? dataSetAt(dataSetPath) : null;
		if (selected) {
			renderDataSetBody(body, selected, dataSetPath.length > 1);
		} else {
			emptyNote(body, 'Наборов данных нет: добавьте набор кнопкой «+ Добавить» над деревом.');
		}
		layout.appendChild(body);
		host.appendChild(layout);
		// Прокрутку можно вернуть только элементу в документе
		const fieldsWrap = body.querySelector('.dcs-fields-wrap');
		if (fieldsWrap && fieldsScrollLeft > 0) {
			fieldsWrap.scrollLeft = fieldsScrollLeft;
		}
		if (focusSetTree) {
			focusSetTree = false;
			const row = side.querySelector('.dcs-tree-selected');
			if (row) {
				row.focus();
			}
		}
	}

	function renderDataSetTree(host) {
		const bar = el('div', 'dcs-tree-toolbar dcs-sets-toolbar');
		// Ключи сохраняют фокус при перерисовке по ответу правки
		bar.appendChild(keyed(addSetControl(), focusKey(['settool', 'add'])));
		const topName = dataSetPath.length === 1 ? dataSetPath[0] : '';
		const nestedHint = dataSetPath.length > 1 ? 'Наборы внутри объединения только просматриваются' : '';
		bar.appendChild(
			keyed(
				iconButton({
					icon: 'rename',
					name: 'Переименовать выбранный набор',
					shortcut: 'F2',
					note: nestedHint,
					disabled: !topName,
					className: 'ghost-btn dcs-btn-small dcs-sets-icon',
					onClick: () => {
						if (topName) {
							openRenameDataSetDialog(topName);
						}
					},
				}),
				focusKey(['settool', 'rename'])
			)
		);
		bar.appendChild(
			keyed(
				iconButton({
					icon: 'delete',
					name: 'Удалить выбранный набор',
					shortcut: 'Delete',
					note: nestedHint,
					disabled: !topName,
					className: 'ghost-btn dcs-btn-small dcs-btn-danger dcs-sets-icon',
					onClick: () => {
						if (topName) {
							askRemoveDataSet(topName);
						}
					},
				}),
				focusKey(['settool', 'delete'])
			)
		);
		host.appendChild(bar);

		const tree = el('div', 'dcs-tree dcs-sets-tree');
		tree.setAttribute('role', 'tree');
		tree.setAttribute('aria-label', 'Наборы данных');
		const root = el('div', 'dcs-tree-row dcs-tree-root');
		root.appendChild(el('span', 'dcs-tree-twist', '▾'));
		root.appendChild(nameEl('span', 'dcs-tree-label', 'Наборы данных'));
		tree.appendChild(root);
		appendSetRows(tree, list('dataSets'), [], 1);
		host.appendChild(tree);
	}

	function appendSetRows(tree, items, prefix, depth) {
		for (const item of items) {
			if (!item.name) {
				continue;
			}
			const names = prefix.concat([item.name]);
			const key = setKey(names);
			const children = Array.isArray(item.items) ? item.items : [];
			const expandable = children.length > 0;
			const expanded = expandable && !collapsedSets.has(key);
			const selected = key === setKey(dataSetPath);
			const row = el('div', 'dcs-tree-row' + (selected ? ' dcs-tree-selected' : ''));
			row.style.paddingLeft = 8 + depth * 16 + 'px';
			// В порядке Tab только выбранная строка
			row.tabIndex = selected ? 0 : -1;
			keyed(row, focusKey(['set', key]));
			row.setAttribute('role', 'treeitem');
			row.setAttribute('aria-selected', String(selected));
			if (expandable) {
				row.setAttribute('aria-expanded', String(expanded));
			}
			const twist = el('span', 'dcs-tree-twist', expandable ? (expanded ? '▾' : '▸') : '');
			if (expandable) {
				twist.addEventListener('click', (event) => {
					event.stopPropagation();
					toggleSet(key, expanded);
				});
			}
			row.appendChild(twist);
			row.appendChild(nameEl('span', 'dcs-tree-label', item.name));
			if (item.type) {
				row.appendChild(el('span', 'dcs-tree-name dcs-tree-kind', kindLabel(item.type).toLowerCase()));
			}
			const count = Array.isArray(item.fields) ? item.fields.length : 0;
			if (count > 0) {
				const badge = el('span', 'dcs-tree-badge', String(count));
				badge.title = 'Полей: ' + count;
				row.appendChild(badge);
			}
			row.addEventListener('click', () => {
				selectDataSet(names, false);
			});
			row.addEventListener('keydown', (event) => {
				onSetTreeKey(event, names, expandable, expanded);
			});
			tree.appendChild(row);
			if (expanded) {
				appendSetRows(tree, children, names, depth + 1);
			}
		}
	}

	function toggleSet(key, expanded) {
		if (expanded) {
			collapsedSets.add(key);
			// Выбор внутри сворачиваемого объединения переходит на само объединение
			if (setKey(dataSetPath).startsWith(key + '/')) {
				dataSetPath = key.split('/');
			}
		} else {
			collapsedSets.delete(key);
		}
		focusSetTree = true;
		renderContent();
	}

	function onSetTreeKey(event, names, expandable, expanded) {
		const key = setKey(names);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const paths = visibleSetPaths();
			const index = paths.findIndex((candidate) => setKey(candidate) === key);
			const next = paths[index + (event.key === 'ArrowDown' ? 1 : -1)];
			if (next) {
				selectDataSet(next, true);
			}
		} else if (event.key === 'ArrowRight' && expandable && !expanded) {
			event.preventDefault();
			toggleSet(key, false);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			if (expandable && expanded) {
				toggleSet(key, true);
			} else if (names.length > 1) {
				selectDataSet(names.slice(0, -1), true);
			}
		} else if (event.key === 'Delete' && names.length === 1) {
			event.preventDefault();
			askRemoveDataSet(names[0]);
		} else if (event.key === 'F2' && names.length === 1) {
			event.preventDefault();
			openRenameDataSetDialog(names[0]);
		}
	}

	function askRemoveDataSet(name) {
		confirmRemove('Удалить набор данных «' + name + '»?', () => {
			if (!send('dcs/remove-data-set', { name: name })) {
				return BUSY;
			}
			return undefined;
		});
	}

	/** Источники данных под деревом, без правки. */
	function renderDataSources(host) {
		const sources = list('dataSources');
		if (sources.length === 0) {
			return;
		}
		const box = el('div', 'dcs-sets-sources');
		box.appendChild(el('div', 'dcs-sets-caption', 'Источники данных'));
		listSection(
			box,
			sources.map((source) => ({
				name: source.name || '',
				value: source.type || '',
				right: source.connectionString || '',
			}))
		);
		host.appendChild(box);
	}

	function addSetControl() {
		const select = el('select', 'edit-ref-add-select');
		const first = document.createElement('option');
		first.value = '';
		first.textContent = '+ Добавить';
		select.title = 'Добавить набор данных';
		select.appendChild(first);
		for (const kind of ['query', 'object', 'union']) {
			const option = document.createElement('option');
			option.value = kind;
			option.textContent = kindLabel(kind);
			select.appendChild(option);
		}
		// Стрелки на закрытом списке только выбирают вид, окно открывает Enter или щелчок
		actionSelect(select, (type) => {
			openAddDataSetDialog(type);
		});
		return select;
	}

	function sourceOptions() {
		const names = list('dataSources')
			.map((source) => source.name || '')
			.filter(Boolean);
		if (names.length === 0) {
			names.push('ИсточникДанных1');
		}
		return names.map((name) => ({ value: name, label: name }));
	}

	function openAddDataSetDialog(type) {
		const names = dataSetNames();
		const options = sourceOptions();
		let nameInput;
		let sourceSelect;
		openDialog(
			'Новый набор данных: ' + kindLabel(type).toLowerCase(),
			'Добавить',
			(body) => {
				nameInput = formRow(body, 'Имя', textInput(suggestName('НаборДанных', names)));
				sourceSelect = formRow(body, 'Источник данных', selectInput(options, options[0].value));
			},
			() => {
				const name = nameInput.value.trim();
				if (!name) {
					return 'Укажите имя набора.';
				}
				if (nameTaken(names, name)) {
					return 'Набор с таким именем уже есть.';
				}
				if (!send('dcs/add-data-set', { name: name, dataSetType: type, dataSource: sourceSelect.value })) {
					return BUSY;
				}
				core.pendingDataSet = name;
				return undefined;
			}
		);
	}

	function openRenameDataSetDialog(name) {
		const names = dataSetNames();
		let nameInput;
		openDialog(
			'Переименование набора «' + name + '»',
			'Сохранить',
			(body) => {
				nameInput = formRow(body, 'Новое имя', textInput(name));
			},
			() => {
				const newName = nameInput.value.trim();
				if (!newName) {
					return 'Укажите имя набора.';
				}
				if (newName === name) {
					closeDialog();
					return undefined;
				}
				if (nameTaken(names, newName, name)) {
					return 'Набор с таким именем уже есть.';
				}
				if (!send('dcs/rename-data-set', { name: name, newName: newName })) {
					return BUSY;
				}
				if (dataSetPath[0] === name) {
					core.pendingDataSet = newName;
				}
				return undefined;
			}
		);
	}

	/** Свойства и поля вложенного набора доступны для просмотра, запрос меняется в конструкторе. */
	function renderDataSetBody(host, dataSet, nested) {
		const hasQuery = typeof dataSet.query === 'string';
		const head = el('div', 'dcs-set-head');
		head.appendChild(nameEl('span', 'dcs-set-title', dataSet.name || ''));
		if (dataSet.type) {
			head.appendChild(el('span', 'dcs-kind', kindLabel(dataSet.type)));
		}
		host.appendChild(head);
		if (nested) {
			host.appendChild(
				el(
					'div',
					'dcs-plate',
					hasQuery
						? 'Запрос вложенного набора меняется в конструкторе. Ручная правка полей и свойств недоступна.'
						: 'Поля и свойства вложенного набора доступны только для просмотра.'
				)
			);
		} else {
			const props = dataSetProps(dataSet);
			if (props.childElementCount > 0) {
				host.appendChild(props);
			}
		}
		// Наборы объединения видны в дереве слева: строка нужна только пустому объединению
		if (dataSet.type === 'union' && !(Array.isArray(dataSet.items) && dataSet.items.some((item) => item && item.name))) {
			host.appendChild(el('div', 'dcs-sets-note', 'В объединении нет наборов.'));
		}
		host.appendChild(el('div', 'dcs-sets-caption', 'Поля'));
		renderFieldsTable(host, dataSet, nested);
		if (hasQuery) {
			renderQueryEditor(host, dataSet, nested);
		}
	}

	/**
	 * Текст запроса набора. Записывается по концу правки: при потере фокуса, смене набора или закладки, открытии
	 * конструктора; при «Автозаполнении» следом заполняются поля. Черновик хранится в queryDrafts.
	 */
	function renderQueryEditor(host, dataSet, readOnly) {
		const setName = dataSet.name || '';
		const key = setKey(dataSetPath);
		host.appendChild(el('div', 'dcs-sets-caption', 'Запрос'));
		const draft = readOnly ? null : queryDrafts.get(key) || null;
		const editor = codeEditor(draft ? draft.text : dataSet.query, 'dcs-query');
		editor.input.readOnly = readOnly;
		editor.input.setAttribute('aria-label', 'Текст запроса набора ' + setName);
		host.appendChild(editor.box);
		// Под полем сначала ошибки текста и записи, затем предупреждения проверки имён
		const status = el('div', 'dcs-query-status');
		status.id = 'dcsQueryStatus';
		editor.box.appendChild(status);
		const rebaseNames = attachNameCheck(editor.box, editor.input, dataSet.query);
		const described = [status.id];
		if (editor.input.getAttribute('aria-describedby')) {
			described.push(editor.input.getAttribute('aria-describedby'));
		}
		editor.input.setAttribute('aria-describedby', described.join(' '));
		if (readOnly) {
			// Набор внутри объединения правится только конструктором: он пишет запрос по пути «Объединение/Дочерний»
			renderQueryStatus(status, key, editor.input.value, false);
			const readOnlyActions = el('div', 'dcs-actions');
			readOnlyActions.appendChild(queryConstructorButton(dataSet, key, editor.input));
			host.appendChild(readOnlyActions);
			return;
		}
		keyed(editor.input, focusKey(['query', key]));
		// Подсказываются только &-параметры: по буквам список всплывал бы на каждом слове запроса
		const completion = attachCompletion(editor.input, () => 'query', { letters: false });
		// Фокус на «⋯» сохраняется при перерисовке по ответу записи
		keyed(completion.more, focusKey(['qmore', key]));
		const autoFill = dataSet.autoFillFields === true;
		const repaint = () => renderQueryStatus(status, key, editor.input.value, autoFill, editor.input);
		repaint();
		core.queryStatusRefresh = { key: key, repaint: repaint, rebase: rebaseNames || null };
		let timer = 0;
		editor.input.addEventListener('input', () => {
			noteQueryDraft(key, editor.input.value);
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				timer = 0;
				if (status.isConnected) {
					repaint();
				}
			}, NAME_CHECK_DEBOUNCE_MS);
		});
		editor.input.addEventListener('blur', () => {
			// Blur от перерисовки не конец правки: фокус вернёт restoreFocus
			if (core.renderingContent || !editor.input.isConnected) {
				return;
			}
			// Окно потеряло фокус, правка не закончена: пишется только текст, без заполнения и повтора отклонённого
			const mode = windowHasFocus() ? 'edit' : 'passive';
			const emptyRefused = commitQueryDraft(key, mode);
			if (!status.isConnected) {
				return;
			}
			const state = repaint();
			if (mode !== 'edit' || !state) {
				return;
			}
			// Строка под полем не живая область, чтобы не шуметь при наборе: об отказе и ошибке читалка слышит при уходе
			if (emptyRefused) {
				showNotice('error', 'Запрос не сохранён', [{ text: EMPTY_QUERY_PROBLEM }]);
			} else if (state.kind === 'parse') {
				announceCompletion('');
				announceCompletion(state.text);
			}
		});
		const actions = el('div', 'dcs-actions');
		actions.appendChild(queryConstructorButton(dataSet, setName, editor.input));
		host.appendChild(actions);
	}

	// ---------- запись текста запроса по концу правки ----------

	/**
	 * Незаписанный текст запроса по пути набора: {text, base, retry}. base: текст модели при начале правки; если модель
	 * сменила его иначе (записал конструктор), черновик уступает. retry: вид отложенной записи ('edit', 'nav', 'passive'),
	 * она уйдёт после ответа текущей правки.
	 */
	const queryDrafts = new Map();
	/**
	 * Отказ записи текста или заполнения полей по пути набора: {text, message, refused}; виден, пока текст тот же.
	 * refused: md-sparrow не принял текст; повтор только при уходе из поля внутри страницы (отказ бывает временным: файл
	 * занят).
	 */
	const queryErrors = new Map();
	/**
	 * Наборы с «Автозаполнением», чей текст записан, а поля ещё не заполнены: текст ушёл при уходе из окна (md-sparrow
	 * поля только добавляет, и недописанный текст оставил бы лишние), заполнение отклонено или флажок только что включили.
	 * Заполнение уходит при следующем конце правки в странице. {retry}: канал был занят, повтор после ответа.
	 */
	const pendingFills = new Map();
	/** Выражения, пропущенные прошлым заполнением набора: те же причины плашкой не повторяются. */
	const lastFillSkips = new Map();

	const EMPTY_QUERY_PROBLEM = 'Запрос пуст: пустой текст не сохраняется.';

	/** Текст запроса по пути набора; null, если набора нет или это не запрос. */
	function queryTextAt(key) {
		const dataSet = key ? dataSetAt(key.split('/')) : null;
		return dataSet && typeof dataSet.query === 'string' ? dataSet.query : null;
	}

	/**
	 * Первая ошибка разбора текста: {line, message} или null. Внутренние ошибки разборщика не показываются: текст
	 * разберут платформа и md-sparrow.
	 */
	function queryParseProblem(text) {
		if (String(text).trim() === '') {
			return null;
		}
		const parsed = parseQueryCached(text);
		const first = parsed && parsed.diagnostics.find((item) => !item.internal);
		if (!first) {
			return null;
		}
		const line = typeof first.offset === 'number' ? text.slice(0, first.offset).split('\n').length : first.line || 1;
		return { line: line, message: String(first.message || '') };
	}

	/** Строка под полем: отказ записи, пустой текст или ошибка разбора; иначе null. kind: saved, empty или parse. */
	function queryStatusText(key, text, autoFill) {
		const error = queryErrors.get(key);
		if (error && error.text === text) {
			return { tone: 'error', text: error.message, kind: 'saved' };
		}
		if (String(text).trim() === '') {
			return queryDrafts.has(key) ? { tone: 'error', text: EMPTY_QUERY_PROBLEM, kind: 'empty' } : null;
		}
		const problem = queryParseProblem(text);
		if (problem) {
			const message = problem.message.replace(/[.\s]+$/, '');
			return {
				tone: 'error',
				text: 'Ошибка в запросе, строка ' + problem.line + ': ' + message + '.' + (autoFill ? ' Поля по нему не заполняются, пока ошибка есть.' : ''),
				kind: 'parse',
			};
		}
		return null;
	}

	/** Строка под полем и aria-invalid поля, чтобы читалка слышала ошибку на самом поле. */
	function renderQueryStatus(line, key, text, autoFill, input) {
		const state = queryStatusText(key, text, autoFill);
		line.textContent = state ? state.text : '';
		line.className = 'dcs-query-status' + (state ? ' dcs-query-status-' + state.tone : '');
		if (input) {
			if (state && state.tone === 'error') {
				input.setAttribute('aria-invalid', 'true');
			} else {
				input.removeAttribute('aria-invalid');
			}
		}
		return state;
	}

	function refreshQueryStatus(key) {
		if (core.queryStatusRefresh && core.queryStatusRefresh.key === key) {
			core.queryStatusRefresh.repaint();
		}
	}

	/** Набранный текст становится черновиком; совпавший с моделью не черновик, если его не пишет фоновая запись. */
	function noteQueryDraft(key, text) {
		const current = queryTextAt(key);
		if (current === null) {
			return;
		}
		const draft = queryDrafts.get(key);
		// Пока пишется прежняя правка, возврат к тексту модели остаётся черновиком: ответ сменит модель
		if (text === current && !(core.background && core.background.key === key)) {
			queryDrafts.delete(key);
			return;
		}
		if (draft) {
			draft.text = text;
		} else {
			queryDrafts.set(key, { text: text, base: current, retry: false });
		}
	}

	/** Сила конца правки: отложенная запись уходит с самым сильным из запрошенных. */
	const COMMIT_RANK = { passive: 0, nav: 1, edit: 2 };

	/**
	 * Конец правки текста набора: изменённый черновик уходит через setQuery, при «Автозаполнении» и без ошибки разбора
	 * следом dcs/autofill-fields. Пустой текст не уходит (md-sparrow его не примет), черновик остаётся. Занятый канал
	 * откладывает запись (retry).
	 * mode:
	 * - 'edit' (по умолчанию): уход фокуса внутри страницы; отклонённый текст уходит снова, без черновика уходит
	 *   отложенное заполнение;
	 * - 'nav': смена набора или закладки, конструктор, проверка схемы; отклонённый неизменённый текст не повторяется,
	 *   иначе каждая стрелка в дереве слала бы тот же отказ;
	 * - 'passive': уход из окна или со страницы; пишется только текст, поля заполнятся при следующем конце правки.
	 * Возвращает true, если не ушёл пустой текст.
	 */
	function commitQueryDraft(key, mode) {
		const how = mode === 'nav' || mode === 'passive' ? mode : 'edit';
		const draft = queryDrafts.get(key);
		if (!draft) {
			if (how !== 'passive') {
				startPendingFill(key);
			}
			return false;
		}
		const refusal = queryErrors.get(key);
		if (how !== 'edit' && refusal && refusal.refused && refusal.text === draft.text) {
			return false;
		}
		const current = queryTextAt(key);
		if (current === null) {
			queryDrafts.delete(key);
			return false;
		}
		if (draft.text === current && !(core.background && core.background.key === key)) {
			queryDrafts.delete(key);
			queryErrors.delete(key);
			if (how !== 'passive') {
				startPendingFill(key);
			}
			return false;
		}
		if (draft.text.trim() === '') {
			queryErrors.set(key, { text: draft.text, message: EMPTY_QUERY_PROBLEM });
			refreshQueryStatus(key);
			return true;
		}
		if (core.background && core.background.key === key && core.background.text === draft.text) {
			return false;
		}
		if (core.saving) {
			if (!draft.retry || COMMIT_RANK[how] > COMMIT_RANK[draft.retry]) {
				draft.retry = how;
			}
			return false;
		}
		draft.retry = false;
		const dataSet = dataSetAt(key.split('/'));
		const fill = Boolean(dataSet && dataSet.autoFillFields === true) && !queryParseProblem(draft.text);
		// Новый текст заполнит поля сам или отложит заполнение заново
		pendingFills.delete(key);
		core.background = {
			key: key,
			text: draft.text,
			autofill: fill && how !== 'passive',
			fillLater: fill && how === 'passive',
			stage: 'text',
		};
		postEdit('setQuery', { dataSet: key, text: draft.text });
		setStatus('Сохраняем запрос…', false);
		return false;
	}

	/**
	 * Отложенное заполнение набора: уходит, если «Автозаполнение» включено, а текст модели не пуст и разбирается; при
	 * занятом канале после ответа. Набор с черновиком заполнится при его записи.
	 */
	function startPendingFill(key) {
		const pending = pendingFills.get(key);
		if (!pending || queryDrafts.has(key)) {
			return;
		}
		const dataSet = dataSetAt(key.split('/'));
		const text = dataSet && typeof dataSet.query === 'string' ? dataSet.query : '';
		if (!dataSet || dataSet.autoFillFields !== true || text.trim() === '' || queryParseProblem(text)) {
			pendingFills.delete(key);
			return;
		}
		if (core.saving) {
			pending.retry = true;
			return;
		}
		pendingFills.delete(key);
		core.background = { key: key, text: text, autofill: true, fillLater: false, stage: 'fill' };
		postEdit('dcs/autofill-fields', { dataSet: key });
		setStatus('Заполняем поля из запроса…', false);
	}

	/** Записать все черновики; mode как у commitQueryDraft. */
	function flushQueryEdits(mode) {
		for (const key of Array.from(queryDrafts.keys())) {
			commitQueryDraft(key, mode);
		}
	}

	/** Отложенные записи и заполнения после ответа правки, занимавшей канал. */
	function retryQueryDrafts() {
		for (const [key, draft] of Array.from(queryDrafts)) {
			if (draft.retry && !core.saving) {
				commitQueryDraft(key, draft.retry);
			}
		}
		for (const [key, pending] of Array.from(pendingFills)) {
			if (pending.retry && !core.saving) {
				startPendingFill(key);
			}
		}
	}

	/**
	 * Модель без текста запроса набора верхнего уровня key: по ней видно, поменялось ли что-то кроме текста. null:
	 * сравнить нельзя, нужна перерисовка.
	 */
	function modelShapeWithoutQuery(source, key) {
		if (!source || typeof source !== 'object' || !key || key.indexOf('/') >= 0) {
			return null;
		}
		const sets = Array.isArray(source.dataSets)
			? source.dataSets.map((item) => (item && item.name === key ? Object.assign({}, item, { query: null }) : item))
			: source.dataSets;
		try {
			return JSON.stringify(Object.assign({}, source, { dataSets: sets }));
		} catch (error) {
			return null;
		}
	}

	/**
	 * Черновики после новой модели: записанные и черновики пропавших наборов забываются; черновик уступает тексту,
	 * записанному не им (ОК конструктора, начатого с этого черновика).
	 */
	function reconcileQueryDrafts() {
		for (const [key, draft] of Array.from(queryDrafts)) {
			const current = queryTextAt(key);
			if (current === null || current === draft.text || current !== draft.base) {
				queryDrafts.delete(key);
			}
		}
		for (const key of Array.from(queryErrors.keys())) {
			if (queryTextAt(key) === null) {
				queryErrors.delete(key);
			}
		}
		for (const key of Array.from(pendingFills.keys())) {
			if (queryTextAt(key) === null) {
				pendingFills.delete(key);
			}
		}
	}

	/**
	 * Ответ фоновой записи; открытые окна не закрываются. Вкладка перерисовывается, только если модель поменялась не
	 * одним текстом набора: иначе перерисовка заменила бы узел с фокусом, и читалка назвала бы его заново. Отказ
	 * показывается под полем и плашкой, ведь из поля уже ушли. После текста при «Автозаполнении» уходит заполнение,
	 * затем правка из очереди или отложенная запись.
	 */
	function onBackgroundSaved(msg) {
		const job = core.background;
		if (!msg.ok) {
			core.background = null;
			const error = String(msg.error || 'Ошибка сохранения');
			const head = job.stage === 'text' ? 'Запрос не сохранён' : 'Поля из запроса не заполнены';
			queryErrors.set(job.key, { text: job.text, message: head + ': ' + error, refused: job.stage === 'text' });
			if (job.stage === 'fill') {
				// Заполнение повторит следующий конец правки
				pendingFills.set(job.key, { retry: false });
			}
			setStatus(error, true);
			showNotice('error', head, [{ text: error }]);
			afterBackground(false, job.key);
			return;
		}
		if (job.stage === 'text') {
			queryErrors.delete(job.key);
			const draft = queryDrafts.get(job.key);
			if (draft) {
				// Набранное после отправки остаётся черновиком от отправленного текста
				draft.base = job.text;
			}
			if (job.fillLater) {
				pendingFills.set(job.key, { retry: false });
			}
		}
		let changed = false;
		if (msg.model) {
			const before = modelShapeWithoutQuery(core.model, job.key);
			core.model = withTypeCompositions(msg.model);
			pruneVariantCache();
			reconcileQueryDrafts();
			pruneFieldPathDrafts();
			const after = modelShapeWithoutQuery(core.model, job.key);
			changed = before === null || after === null || before !== after;
		}
		if (job.stage === 'text' && job.autofill) {
			job.stage = 'fill';
			postEdit('dcs/autofill-fields', { dataSet: job.key });
			setStatus('Заполняем поля из запроса…', false);
			repaintAfterBackground(changed, job.key);
			return;
		}
		core.background = null;
		if (job.stage === 'fill' && msg.autofill) {
			const added = Array.isArray(msg.autofill.added) ? msg.autofill.added : [];
			const skipped = Array.isArray(msg.autofill.skipped) ? msg.autofill.skipped : [];
			// Плашка только при новостях: запись идёт на каждый уход из поля, и одни и те же пропуски не повторяются
			const skips = JSON.stringify(skipped.map((miss) => String((miss && miss.expression) || '')));
			const newSkips = skipped.length > 0 && lastFillSkips.get(job.key) !== skips;
			lastFillSkips.set(job.key, skips);
			if (added.length > 0 || newSkips) {
				showNotice('ok', 'Заполнение из запроса', autofillNoticeLines(msg.autofill));
			}
		}
		setStatus('Сохранено', false);
		afterBackground(changed, job.key);
	}

	/**
	 * При changed перерисовка вкладки, иначе обновляются строка под полем и записанный текст проверки имён (по нему
	 * запрашиваются описания таблиц).
	 */
	function repaintAfterBackground(changed, key) {
		if (changed) {
			renderAfterBackground();
			return;
		}
		if (core.queryStatusRefresh && core.queryStatusRefresh.key === key) {
			core.queryStatusRefresh.repaint();
			if (core.queryStatusRefresh.rebase) {
				const text = queryTextAt(key);
				if (text !== null) {
					core.queryStatusRefresh.rebase(text);
				}
			}
		}
	}

	/**
	 * Пока кнопка мыши нажата, перерисовка по ответу фоновой записи ждёт отпускания: запись уходит по blur на нажатии,
	 * и перерисовка убрала бы узел под курсором вместе со щелчком. Без отпускания (за окном) перерисовка через 1,5 с.
	 */
	let pointerHeld = false;
	let renderHeld = false;
	let renderHeldTimer = 0;

	function renderAfterBackground() {
		if (pointerHeld) {
			renderHeld = true;
			if (!renderHeldTimer) {
				renderHeldTimer = setTimeout(releasePointer, 1500);
			}
			return;
		}
		renderTabs();
		renderContent();
	}

	function releasePointer() {
		pointerHeld = false;
		if (renderHeldTimer) {
			clearTimeout(renderHeldTimer);
			renderHeldTimer = 0;
		}
		if (renderHeld) {
			renderHeld = false;
			// После click того же нажатия. Перенос тоже даёт pointercancel: тогда перерисовка ждёт его конца
			setTimeout(() => {
				whenIdle(() => {
					renderTabs();
					renderContent();
				});
			}, 0);
		}
	}

	document.addEventListener(
		'pointerdown',
		() => {
			pointerHeld = true;
		},
		true
	);
	document.addEventListener('pointerup', releasePointer, true);
	document.addEventListener('pointercancel', releasePointer, true);

	function afterBackground(changed, key) {
		repaintAfterBackground(changed, key);
		const next = core.deferred;
		core.deferred = null;
		if (next) {
			postEdit(next.type, next.fields);
			core.editOrigin = next.origin || null;
			return;
		}
		retryQueryDrafts();
	}

	// Уход со страницы или из окна: записывается только текст, без заполнения полей
	window.addEventListener('pagehide', () => flushQueryEdits('passive'));
	window.addEventListener('blur', () => flushQueryEdits('passive'));
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			flushQueryEdits('passive');
		}
	});

	/** Пауза перепроверки имён после ввода: разбор и проверка не должны идти на каждом символе. */
	const NAME_CHECK_DEBOUNCE_MS = 400;
	/** Сколько предупреждений проверки имён показывать поштучно, остальные числом. */
	const NAME_CHECK_SHOWN = 5;
	/** Перепроверка имён открытого набора; null, если строки нет на экране. */
	let nameCheckRefresh = null;
	let nameCheckTimer = 0;

	/** Перепроверка имён после ответов описаний и дерева: одна на пачку, ответы приходят подряд. */
	function scheduleNameCheck() {
		if (!nameCheckRefresh || nameCheckTimer) {
			return;
		}
		nameCheckTimer = setTimeout(() => {
			nameCheckTimer = 0;
			if (nameCheckRefresh) {
				nameCheckRefresh();
			}
		}, HIGHLIGHT_DEBOUNCE_MS);
	}

	/**
	 * Строка проверки имён по метаданным под текстом набора: неизвестные таблицы, поля и алиасы. Только
	 * предупреждает, сохранению не мешает; неразобранный текст не проверяется. Описания таблиц запрашиваются
	 * только для записанного текста savedText, иначе каждая пауза в наборе слала бы запросы по недописанным
	 * именам.
	 */
	function attachNameCheck(box, input, savedText) {
		if (!nameCheckAvailable) {
			return null;
		}
		let saved = typeof savedText === 'string' ? savedText : input.value;
		const line = el('div', 'dcs-query-names');
		// Не живая область: предупреждения читалка слышит через aria-describedby поля
		line.id = 'dcsQueryNames';
		input.setAttribute('aria-describedby', line.id);
		box.appendChild(line);
		let timer = 0;
		function refresh() {
			timer = 0;
			if (!line.isConnected) {
				if (nameCheckRefresh === refresh) {
					nameCheckRefresh = null;
				}
				return;
			}
			renderNameCheck(line, input.value, input.value === saved ? 'later' : false);
		}
		input.addEventListener('input', () => {
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(refresh, NAME_CHECK_DEBOUNCE_MS);
		});
		nameCheckRefresh = refresh;
		renderNameCheck(line, input.value, input.value === saved ? 'later' : false);
		// Текст записан без перерисовки: он больше не черновик, и проверка просит описания
		return (text) => {
			saved = text;
			if (timer) {
				clearTimeout(timer);
			}
			refresh();
		};
	}

	function renderNameCheck(line, text, ask) {
		line.textContent = '';
		const parsed = text.trim() !== '' ? parseQueryCached(text) : null;
		const problems = parsed && parsed.diagnostics.length === 0 ? queryNameProblems(parsed.model, [], { quiet: true, ask: ask }) : [];
		if (problems.length === 0) {
			return;
		}
		line.appendChild(
			el('div', 'dcs-query-names-title', 'Проверка имён по метаданным (' + problems.length + '): запрос можно сохранить, но платформа может его не принять.')
		);
		const several = parsed.model.statements.length > 1;
		for (const problem of problems.slice(0, NAME_CHECK_SHOWN)) {
			const where =
				typeof problem.offset === 'number'
					? 'строка ' + (text.slice(0, problem.offset).split('\n').length) + ': '
					: several
						? 'запрос пакета ' + (problem.statement + 1) + ': '
						: '';
			line.appendChild(el('div', '', where + problem.message));
		}
		if (problems.length > NAME_CHECK_SHOWN) {
			line.appendChild(el('div', '', 'И ещё ' + (problems.length - NAME_CHECK_SHOWN) + ': все видны в конструкторе запроса на вкладке «Таблицы и поля».'));
		}
	}

	/** Кнопка «Конструктор…»: скрипт окна конструктора подключается позже, поэтому окно ищется при нажатии. */
	function queryConstructorButton(dataSet, path, queryInput) {
		const construct = el('button', 'ghost-btn dcs-btn-small', 'Конструктор…');
		construct.type = 'button';
		construct.title = 'Конструктор запроса: таблицы и поля по вкладкам, запись текста по ОК.';
		keyed(construct, focusKey(['qbuild', path]));
		construct.addEventListener('click', () => {
			// Черновик записывается до открытия: фоновая запись окно не закроет, ОК конструктора встанет в очередь за ней
			flushQueryEdits('nav');
			const dialog = window.DcsQueryDialog;
			if (dialog) {
				dialog.open({ dataSet: path, text: queryInput.value, autoFill: dataSet.autoFillFields === true });
				return;
			}
			showNotice('error', 'Конструктор запроса', [{ text: 'Конструктор запроса не загрузился: откройте вкладку схемы заново.' }]);
		});
		return construct;
	}

	/** Свойства набора записываются сразу по изменению. */
	function dataSetProps(dataSet) {
		const setName = dataSet.name || '';
		const box = el('div', 'dcs-props');
		const sourceNames = list('dataSources')
			.map((source) => source.name || '')
			.filter(Boolean);
		if (dataSet.dataSource && sourceNames.indexOf(dataSet.dataSource) < 0) {
			sourceNames.unshift(dataSet.dataSource);
		}
		if (sourceNames.length > 0) {
			const wrap = el('label', 'dcs-prop');
			wrap.appendChild(el('span', 'dcs-prop-label', 'Источник данных'));
			const options = sourceNames.map((name) => ({ value: name, label: name }));
			if (!dataSet.dataSource) {
				options.unshift({ value: '', label: '' });
			}
			const select = selectInput(options, dataSet.dataSource || '');
			keyed(select, focusKey(['setprop', setName, 'source']));
			select.addEventListener('change', () => {
				if (!select.value || !send('dcs/set-data-set-props', { name: setName, payload: { dataSource: select.value } })) {
					select.value = dataSet.dataSource || '';
				}
			});
			wrap.appendChild(select);
			box.appendChild(wrap);
		}
		if (dataSet.type === 'query' || typeof dataSet.autoFillFields === 'boolean') {
			const auto = checkbox('Автозаполнение', dataSet.autoFillFields);
			keyed(auto.input, focusKey(['setprop', setName, 'auto']));
			auto.input.addEventListener('change', () => {
				if (!send('dcs/set-data-set-props', { name: setName, payload: { autoFillFields: auto.input.checked } })) {
					auto.input.checked = Boolean(dataSet.autoFillFields);
					return;
				}
				if (auto.input.checked && dataSet.type === 'query') {
					// Поля заполняются после ответа на флажок, а не при следующей правке текста
					pendingFills.set(setName, { retry: true });
				}
			});
			box.appendChild(auto.wrap);
		}
		if (dataSet.type === 'object' || typeof dataSet.objectName === 'string') {
			const wrap = el('label', 'dcs-prop');
			wrap.appendChild(el('span', 'dcs-prop-label', 'Имя объекта'));
			const input = textInput(dataSet.objectName);
			keyed(input, focusKey(['setprop', setName, 'object']));
			input.addEventListener('change', () => {
				const value = input.value.trim();
				if (value === (dataSet.objectName || '')) {
					return;
				}
				if (!send('dcs/set-data-set-props', { name: setName, payload: { objectName: value } })) {
					input.value = dataSet.objectName || '';
				}
			});
			wrap.appendChild(input);
			box.appendChild(wrap);
		}
		return box;
	}

	function fieldKindText(field) {
		if (field.kind === 'folder') {
			return 'папка';
		}
		if (field.kind === 'nested') {
			return 'вложенный набор';
		}
		return field.field || '';
	}

	function editableField(field) {
		return (!field.kind || field.kind === 'field') && typeof field.dataPath === 'string' && field.dataPath !== '';
	}

	/**
	 * Колонки флажков ограничений: label в шапке целиком (сокращения читалка произносила бы словами), name в подсказке
	 * и доступном имени флажка, hint в title.
	 */
	const RESTRICTION_COLUMNS = [
		{ key: 'field', label: 'Поле', name: 'Поле', hint: 'нельзя выбрать в выбранные поля' },
		{ key: 'condition', label: 'Условие', name: 'Условие', hint: 'нельзя использовать в отборе' },
		{ key: 'group', label: 'Группа', name: 'Группа', hint: 'нельзя группировать' },
		{ key: 'order', label: 'Упорядочивание', name: 'Упорядочивание', hint: 'нельзя упорядочивать' },
	];

	/** Две группы флажков: ограничение самого поля и его реквизитов (полей через точку). */
	const RESTRICTION_GROUPS = [
		{ key: 'useRestriction', title: 'Ограничение поля', subject: 'поле' },
		{ key: 'attributeUseRestriction', title: 'Ограничение реквизитов', subject: 'реквизиты поля' },
	];

	/** Подсказка флажка: «Ограничение поля «Условие»: поле нельзя использовать в отборе». */
	function restrictionHint(group, column) {
		return group.title + ' «' + column.name + '»: ' + group.subject + ' ' + column.hint;
	}

	/**
	 * Проверка пути к данным для ячейки и окна поля: пустой путь и занятый в наборе (без учёта регистра, как в
	 * md-sparrow; смена регистра своего пути разрешена). undefined: путь подходит.
	 */
	function fieldPathProblem(paths, dataPath, original) {
		if (!dataPath) {
			return 'Укажите путь к данным.';
		}
		if (dataPath !== (original || '') && nameTaken(paths, dataPath, original)) {
			return 'Поле с таким путём к данным уже есть в наборе.';
		}
		return undefined;
	}

	/**
	 * Непринятые пути из ячеек по focusKey набора и прежнего пути: {text, problem, refused}; живут до исправления или
	 * Esc, переживают перерисовку. refused: путь отклонил md-sparrow, повторно его шлёт только Enter.
	 */
	const fieldPathDrafts = new Map();
	let cellErrorCount = 0;

	/** Забыть черновики путей полей, которых в модели больше нет. */
	function pruneFieldPathDrafts() {
		for (const draftKey of Array.from(fieldPathDrafts.keys())) {
			const parts = draftKey.split('\n');
			if (dataSetFieldPaths(parts[0]).indexOf(parts.slice(1).join('\n')) < 0) {
				fieldPathDrafts.delete(draftKey);
			}
		}
	}

	/**
	 * Есть ли фокус у окна: уход из панели даёт полю blur и change, но правка не закончена. Без document.hasFocus
	 * считается, что фокус есть.
	 */
	function windowHasFocus() {
		return typeof document.hasFocus !== 'function' || document.hasFocus() !== false;
	}

	/**
	 * Автозаголовок из пути, как его строит платформа: «ЧасовРаботы» → «Часов работы»;
	 * аббревиатуры остаются заглавными («СуммаНДС» → «Сумма НДС»).
	 */
	function autoTitle(dataPath) {
		return String(dataPath || '')
			.split('.')
			.map((part) => {
				const words = part
					.replace(/_/g, ' ')
					.replace(/([a-zа-яё0-9])([A-ZА-ЯЁ])/g, '$1 $2')
					.replace(/([A-ZА-ЯЁ]+)([A-ZА-ЯЁ][a-zа-яё])/g, '$1 $2')
					.trim()
					.split(/\s+/);
				return words
					.map((word, index) => (index > 0 && /^[A-ZА-ЯЁ][a-zа-яё0-9]*$/.test(word) ? word.toLowerCase() : word))
					.join(' ');
			})
			.join('.');
	}

	/** Правка в строке таблицы; при занятом канале значение откатывается. */
	function sendInline(type, fields, revert) {
		if (send(type, fields)) {
			return true;
		}
		revert();
		setStatus(BUSY, true);
		// Строка состояния не живая область: отказ объявляется читалке отдельно
		announceCompletion(BUSY);
		return false;
	}

	/** Канал занят: набранный путь остаётся в ячейке до повтора. */
	const PATH_BUSY = 'Не отправлено: предыдущая правка ещё сохранялась. Нажмите Enter ещё раз.';

	function headCell(tr, text, opts) {
		const th = el('th', opts.className || '', text);
		if (opts.rowSpan) {
			th.rowSpan = opts.rowSpan;
		}
		if (opts.colSpan) {
			th.colSpan = opts.colSpan;
		}
		if (opts.title) {
			th.title = opts.title;
		}
		if (opts.label) {
			th.setAttribute('aria-label', opts.label);
		}
		tr.appendChild(th);
	}

	/** Таблица полей набора; правятся обычные поля, папки и вложенные наборы только показываются. */
	function renderFieldsTable(host, dataSet, readOnly) {
		const setName = dataSet.name || '';
		const fields = Array.isArray(dataSet.fields) ? dataSet.fields : [];
		if (!readOnly) {
			listToolbar(host, [{ icon: 'add', name: 'Добавить поле…', onClick: () => openFieldDialog(setName, null) }]);
		}
		if (fields.length === 0) {
			emptyNote(host, readOnly ? 'Полей нет.' : 'Полей нет: добавьте поле или заполните поля из запроса.');
		} else {
			const wrap = el('div', 'dcs-table-wrap dcs-fields-wrap');
			const table = el('table', 'dcs-table dcs-fields-table');
			const thead = document.createElement('thead');
			const top = document.createElement('tr');
			const sub = document.createElement('tr');
			// Колонка «Поле» закреплена: при прокрутке вбок имя поля остаётся на виду
			headCell(top, 'Поле', { rowSpan: 2, className: 'dcs-col-pin' });
			for (const title of ['Путь к данным', 'Заголовок', 'Тип']) {
				headCell(top, title, { rowSpan: 2 });
			}
			for (const group of RESTRICTION_GROUPS) {
				headCell(top, group.title, { colSpan: RESTRICTION_COLUMNS.length, className: 'dcs-th-group dcs-col-sep' });
				RESTRICTION_COLUMNS.forEach((column, index) => {
					// Группу читалка называет по заголовку над колонками
					headCell(sub, column.label, {
						className: 'dcs-th-check' + (index === 0 ? ' dcs-col-sep' : ''),
						title: restrictionHint(group, column),
					});
				});
			}
			headCell(top, 'Роль', { rowSpan: 2, className: 'dcs-col-sep' });
			headCell(top, '', { rowSpan: 2 });
			thead.appendChild(top);
			thead.appendChild(sub);
			table.appendChild(thead);
			const tbody = document.createElement('tbody');
			for (const field of fields) {
				tbody.appendChild(fieldRow(setName, field, readOnly || !editableField(field), readOnly));
			}
			// ↑ ↓ ведут в ту же колонку соседней строки, ← → у флажков в соседний флажок
			tbody.addEventListener('keydown', onFieldCellKey);
			fieldRowStops(tbody, setName);
			table.appendChild(tbody);
			wrap.appendChild(table);
			wrap.addEventListener('scroll', () => {
				fieldsScrollLeft = wrap.scrollLeft;
			});
			wrap.addEventListener('focusin', (event) => {
				revealFromUnderPin(wrap, event && event.target);
			});
			host.appendChild(wrap);
		}
	}

	/** Строка таблицы полей с остановкой Tab, сохраняется между перерисовками. */
	let fieldsRowStop = { set: '', path: '' };

	/** Доступные поля, флажки и кнопки строки (прямые дети ячеек); строка только с недоступными остановкой не станет. */
	function fieldRowControls(tr) {
		return Array.from(tr.children).flatMap((td) =>
			Array.from(td.children).filter((node) => (node.tagName === 'INPUT' || node.tagName === 'BUTTON') && !node.disabled)
		);
	}

	/**
	 * В обходе Tab одна строка таблицы полей, иначе Tab проходил бы каждую строку по 13 остановок. Строку меняют ↑ ↓
	 * и щелчок: остановка идёт за фокусом.
	 */
	function fieldRowStops(tbody, setName) {
		const rows = Array.from(tbody.children);
		const usable = rows.filter((tr) => fieldRowControls(tr).length > 0);
		const remembered = fieldsRowStop.set === setName ? rows.find((tr) => tr.getAttribute('data-dcs-row') === fieldsRowStop.path && fieldRowControls(tr).length > 0) : null;
		const apply = (stop) => {
			for (const tr of rows) {
				for (const control of fieldRowControls(tr)) {
					control.tabIndex = tr === stop ? 0 : -1;
				}
			}
		};
		apply(remembered || usable[0] || null);
		tbody.addEventListener('focusin', (event) => {
			const tr = event && event.target ? rowOf(event.target) : null;
			if (!tr || rows.indexOf(tr) < 0 || fieldRowControls(tr).indexOf(event.target) < 0) {
				return;
			}
			fieldsRowStop = { set: setName, path: tr.getAttribute('data-dcs-row') || '' };
			apply(tr);
		});
	}

	/**
	 * Браузер не прокручивает к полю под закреплённой колонкой: формально оно в области видимости. Фокус в такое поле
	 * сдвигает таблицу.
	 */
	function revealFromUnderPin(wrap, target) {
		const tr = target ? rowOf(target) : null;
		const pin = tr && tr.children ? tr.children[0] : null;
		if (!pin || pin === target.parentElement || typeof target.getBoundingClientRect !== 'function' || typeof pin.getBoundingClientRect !== 'function') {
			return;
		}
		const box = target.getBoundingClientRect();
		const edge = pin.getBoundingClientRect();
		if (box.left < edge.right) {
			wrap.scrollLeft = Math.max(0, (wrap.scrollLeft || 0) - (edge.right - box.left + 4));
		}
	}

	/**
	 * Строка поля; nestedSet: набор внутри объединения, тип открывается только на просмотр. Путь, заголовок
	 * и флажки правятся в строке, остальное в окне поля.
	 */
	function fieldRow(setName, field, readOnly, nestedSet) {
		const tr = document.createElement('tr');
		const dataPath = field.dataPath || '';
		tr.setAttribute('data-dcs-row', dataPath);
		cell(tr, fieldKindText(field), 'dcs-col-pin');
		const pathTd = el('td', 'dcs-cell-title dcs-cell-path');
		if (readOnly) {
			setNameText(pathTd, dataPath);
		} else {
			fieldPathEditor(pathTd, setName, dataPath);
		}
		tr.appendChild(pathTd);
		const titleTd = el('td', 'dcs-cell-title');
		if (readOnly) {
			setNameText(titleTd, field.title || '');
		} else {
			fieldTitleEditor(titleTd, setName, field);
		}
		tr.appendChild(titleTd);
		// У папки и поля-вложенного набора своего типа нет: подпись без окна
		const typeTd = typeCell(
			tr,
			field.valueType,
			field.valueTypePresentation,
			'поля ' + dataPath,
			editableField(field)
				? () => {
						openFieldTypeDialog(setName, field, Boolean(nestedSet));
					}
				: null
		);
		if (typeTd.children[0] && typeTd.children[0].tagName === 'BUTTON') {
			keyed(typeTd.children[0], focusKey(['ftype', setName, dataPath]));
			// Колонка для ↑ ↓ (onFieldCellKey)
			typeTd.children[0].setAttribute('data-dcs-col', 'type');
		}
		for (const group of RESTRICTION_GROUPS) {
			restrictionCells(tr, setName, field, group, readOnly);
		}
		cell(tr, roleSummary(field.role), 'dcs-col-sep');
		if (readOnly) {
			cell(tr, '');
		} else {
			actionsCell(tr, [
				{
					svg: 'edit',
					title: 'Свойства поля: путь, заголовок, тип, ограничения, роль',
					key: focusKey(['fedit', setName, dataPath]),
					onClick: () => {
						openFieldDialog(setName, field);
					},
				},
				{
					svg: 'delete',
					title: 'Удалить поле',
					danger: true,
					key: focusKey(['fdel', setName, dataPath]),
					onClick: () => {
						confirmRemove('Удалить поле «' + dataPath + '»?', () => {
							if (!send('dcs/remove-field', { dataSet: setName, dataPath: dataPath })) {
								return BUSY;
							}
							return undefined;
						});
					},
				},
			]);
			// Кнопки строки тоже колонки для ↑ ↓
			const rowButtons = tr.children[tr.children.length - 1].children;
			['edit', 'delete'].forEach((col, at) => {
				if (rowButtons[at]) {
					rowButtons[at].setAttribute('data-dcs-col', col);
				}
			});
		}
		return tr;
	}

	/**
	 * Правка ячейки уходит по Enter или change. Пока нет ответа, тот же текст не шлётся повторно: Enter и следом
	 * уход из поля дали бы две правки, и вторая получила бы отказ.
	 */
	function cellCommitter(commit) {
		let sent = null;
		return (value) => {
			if (sent !== null && value === sent && core.saving) {
				return;
			}
			sent = commit(value) ? value : null;
		};
	}

	/** Заголовок поля в ячейке; пустой означает автозаголовок, он виден в placeholder. */
	function fieldTitleEditor(td, setName, field) {
		const dataPath = field.dataPath || '';
		const original = field.title || '';
		const input = el('input', 'dcs-cell-input');
		input.type = 'text';
		input.value = original;
		input.placeholder = autoTitle(dataPath);
		input.title = 'Заголовок поля; пустой заголовок означает автозаголовок';
		input.setAttribute('aria-label', 'Заголовок поля ' + dataPath);
		input.setAttribute('data-dcs-col', 'title');
		keyed(input, focusKey(['ftitle', setName, dataPath]));
		const commit = cellCommitter((value) => {
			if (value === original) {
				return false;
			}
			// При занятом канале набранное не откатывается
			return sendInline('dcs/set-field', { dataSet: setName, dataPath: dataPath, payload: { title: value } }, () => undefined);
		});
		input.addEventListener('keydown', (event) => {
			if (event.isComposing) {
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				commit(input.value.trim());
			} else if (event.key === 'Escape' && input.value !== original) {
				// Esc откатывает набранное; без правки он остаётся клавишей страницы
				event.preventDefault();
				input.value = original;
			}
		});
		// Уход в другое окно правку не заканчивает
		input.addEventListener('change', () => {
			if (windowHasFocus()) {
				commit(input.value.trim());
			}
		});
		// Поле после restoreFocus может не дать change: браузер сравнивает значение с тем, что было при получении фокуса.
		// Blur от перерисовки не коммитит
		input.addEventListener('blur', () => {
			if (!core.renderingContent && input.isConnected && windowHasFocus()) {
				commit(input.value.trim());
			}
		});
		td.appendChild(input);
	}

	/**
	 * Путь к данным в ячейке: dcs/set-field с newDataPath и проверка fieldPathProblem, как у окна поля. При отказе
	 * текст остаётся для исправления, причина под полем; Esc возвращает прежний путь.
	 */
	function fieldPathEditor(td, setName, original) {
		const draftKey = focusKey([setName, original]);
		const draft = fieldPathDrafts.get(draftKey) || null;
		const input = el('input', 'dcs-cell-input');
		input.type = 'text';
		input.value = draft ? draft.text : original;
		input.spellcheck = false;
		input.title = 'Путь к данным: имя поля в схеме';
		input.setAttribute('aria-label', 'Путь к данным поля ' + original);
		input.setAttribute('data-dcs-col', 'path');
		keyed(input, focusKey(['fpath', setName, original]));
		const error = el('div', 'dcs-cell-error');
		error.id = 'dcsCellError' + ++cellErrorCount;
		// Живая область: aria-describedby у поля в фокусе читалка заново не читает
		error.setAttribute('aria-live', 'polite');
		td.appendChild(input);
		td.appendChild(error);
		function showProblem(problem, refused) {
			error.textContent = problem || '';
			if (problem) {
				input.setAttribute('aria-invalid', 'true');
				input.setAttribute('aria-describedby', error.id);
				fieldPathDrafts.set(draftKey, refused ? { text: input.value, problem: problem, refused: true } : { text: input.value, problem: problem });
			} else {
				input.removeAttribute('aria-invalid');
				input.removeAttribute('aria-describedby');
				fieldPathDrafts.delete(draftKey);
			}
		}
		if (draft) {
			showProblem(draft.problem, draft.refused);
		}
		const commit = cellCommitter((value) => {
			if (value === original) {
				showProblem('');
				input.value = original;
				return false;
			}
			const problem = fieldPathProblem(dataSetFieldPaths(setName), value, original);
			if (problem) {
				showProblem(problem);
				return false;
			}
			if (!send('dcs/set-field', { dataSet: setName, dataPath: original, payload: { newDataPath: value } })) {
				// Канал занят: набранное остаётся с причиной, уход из ячейки пошлёт его снова.
				// pendingRename и pendingPathCommit другой правки не трогаются
				showProblem(PATH_BUSY);
				return false;
			}
			showProblem('');
			// Ключи строки содержат путь: после ответа фокус ищется под новым
			core.pendingRename = { scope: setName, from: original, to: value };
			core.pendingPathCommit = { draftKey: draftKey, value: value };
			return true;
		});
		/** Конец правки без Enter: отклонённый md-sparrow путь не повторяется, уход в другое окно не считается. */
		const commitOnLeave = () => {
			const refused = fieldPathDrafts.get(draftKey);
			if (!windowHasFocus() || (refused && refused.refused && refused.text === input.value.trim())) {
				return;
			}
			commit(input.value.trim());
		};
		input.addEventListener('keydown', (event) => {
			if (event.isComposing) {
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				commit(input.value.trim());
			} else if (event.key === 'Escape' && (input.value !== original || fieldPathDrafts.has(draftKey))) {
				event.preventDefault();
				input.value = original;
				showProblem('');
			}
		});
		input.addEventListener('change', commitOnLeave);
		// Как у заголовка: change после перерисовки может не прийти
		input.addEventListener('blur', () => {
			if (!core.renderingContent && input.isConnected) {
				commitOnLeave();
			}
		});
	}

	function rowOf(node) {
		let row = node;
		while (row && row.tagName !== 'TR') {
			row = row.parentElement;
		}
		return row;
	}

	/** Поле или флажок строки с колонкой col (data-dcs-col), доступные для фокуса. */
	function cellControl(row, col) {
		const walk = (node) => {
			for (const child of Array.from(node.children || [])) {
				if (typeof child.getAttribute === 'function' && child.getAttribute('data-dcs-col') === col && !child.disabled) {
					return child;
				}
				const found = walk(child);
				if (found) {
					return found;
				}
			}
			return null;
		};
		return walk(row);
	}

	function onFieldCellKey(event) {
		if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
			return;
		}
		const target = event.target;
		const col = target && typeof target.getAttribute === 'function' ? target.getAttribute('data-dcs-col') : null;
		const row = col ? rowOf(target) : null;
		if (!row || !row.parentElement) {
			return;
		}
		let next = null;
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			const rows = Array.from(row.parentElement.children);
			const step = event.key === 'ArrowDown' ? 1 : -1;
			for (let k = rows.indexOf(row) + step; k >= 0 && k < rows.length && !next; k += step) {
				next = cellControl(rows[k], col);
			}
		} else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && target.type === 'checkbox') {
			const flags = [];
			for (const group of RESTRICTION_GROUPS) {
				for (const column of RESTRICTION_COLUMNS) {
					flags.push('flag:' + group.key + ':' + column.key);
				}
			}
			const step = event.key === 'ArrowRight' ? 1 : -1;
			for (let k = flags.indexOf(col) + step; k >= 0 && k < flags.length && !next; k += step) {
				next = cellControl(row, flags[k]);
			}
		} else {
			return;
		}
		// Край таблицы: клавиша гасится, чтобы поле не прыгало кареткой в начало или конец
		event.preventDefault();
		if (next) {
			next.focus();
		}
	}

	/** Флажки группы ограничений; правка уходит всем ограничением группы. */
	function restrictionCells(tr, setName, field, group, readOnly) {
		const key = group.key;
		const current = field[key] || {};
		RESTRICTION_COLUMNS.forEach((column, index) => {
			const td = el('td', 'dcs-cell-check' + (index === 0 ? ' dcs-col-sep' : ''));
			const box = el('input', 'edit-check');
			box.type = 'checkbox';
			box.checked = Boolean(current[column.key]);
			box.disabled = readOnly;
			box.title = restrictionHint(group, column);
			box.setAttribute('aria-label', group.title + ' «' + (field.dataPath || '') + '»: ' + column.name);
			box.setAttribute('aria-description', group.subject + ' ' + column.hint);
			box.setAttribute('data-dcs-col', 'flag:' + key + ':' + column.key);
			keyed(box, focusKey(['fflag', setName, field.dataPath || '', key, column.key]));
			box.addEventListener('change', () => {
				const next = {};
				for (const flag of RESTRICTION_COLUMNS) {
					next[flag.key] = Boolean(current[flag.key]);
				}
				next[column.key] = box.checked;
				const payload = {};
				payload[key] = next;
				sendInline('dcs/set-field', { dataSet: setName, dataPath: field.dataPath || '', payload: payload }, () => {
					box.checked = !box.checked;
				});
			});
			td.appendChild(box);
			tr.appendChild(td);
		});
	}

	function openFieldDialog(setName, field) {
		const original = field || {};
		let pathInput;
		let fieldInput;
		let titleInput;
		let useBoxes;
		let attrBoxes;
		let role;
		let typeChoice = null;
		openDialog(
			field ? 'Поле «' + (original.dataPath || '') + '»' : 'Новое поле набора «' + setName + '»',
			field ? 'Сохранить' : 'Добавить',
			(body) => {
				pathInput = formRow(body, 'Путь к данным', textInput(original.dataPath));
				fieldInput = formRow(body, 'Поле', textInput(original.field));
				titleInput = formRow(body, 'Заголовок', textInput(original.title));
				if (field) {
					// add-field тип не принимает: тип задаётся у созданного поля
					typeChoice = typeRow(body, original.valueType, {
						title: () => 'Тип значения поля «' + (pathInput.value.trim() || original.dataPath || '') + '»',
						fallback: original.valueTypePresentation,
						warnings: typeOwnerWarnings({ hasInputParameters: original.hasInputParameters }),
					});
					groupTitle(body, 'Ограничение поля');
					useBoxes = restrictionBoxes(body, original.useRestriction);
					groupTitle(body, 'Ограничение реквизитов');
					attrBoxes = restrictionBoxes(body, original.attributeUseRestriction);
					groupTitle(body, 'Роль');
					role = roleForm(body, original.role || {}, setName);
				}
			},
			() => {
				const dataPath = pathInput.value.trim();
				const fieldName = fieldInput.value.trim();
				const title = titleInput.value.trim();
				const pathProblem = fieldPathProblem(dataSetFieldPaths(setName), dataPath, original.dataPath);
				if (pathProblem) {
					return pathProblem;
				}
				if (!field) {
					if (!fieldName) {
						return 'Укажите поле.';
					}
					const payload = { dataPath: dataPath, field: fieldName };
					if (title) {
						payload.title = title;
					}
					if (!send('dcs/add-field', { dataSet: setName, payload: payload })) {
						return BUSY;
					}
					return undefined;
				}
				const roleError = role.validate();
				if (roleError) {
					return roleError;
				}
				const payload = {};
				if (dataPath !== (original.dataPath || '')) {
					payload.newDataPath = dataPath;
				}
				// После ответа фокус вернётся на карандаш строки под новым путём
				core.pendingRename = payload.newDataPath ? { scope: setName, from: original.dataPath || '', to: dataPath } : null;
				if (fieldName && fieldName !== (original.field || '')) {
					payload.field = fieldName;
				}
				if (title !== (original.title || '')) {
					payload.title = title;
				}
				if (restrictionChanged(useBoxes, original.useRestriction)) {
					payload.useRestriction = restrictionOf(useBoxes);
				}
				if (restrictionChanged(attrBoxes, original.attributeUseRestriction)) {
					payload.attributeUseRestriction = restrictionOf(attrBoxes);
				}
				if (role.changed()) {
					payload.role = role.current();
				}
				const typed = typeRules.typeEditPayload({ valueType: original.valueType }, { valueType: typeChoice.valueType() });
				if (typed.error) {
					return typed.error;
				}
				Object.assign(payload, typed.payload);
				if (Object.keys(payload).length === 0) {
					closeDialog();
					return undefined;
				}
				if (!send('dcs/set-field', { dataSet: setName, dataPath: original.dataPath || '', payload: payload })) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	// ---------- вкладка «Связи наборов данных» ----------

	/**
	 * Флажок required связи платформа 8.3.27 при загрузке схемы не хранит ни при каком составе связи.
	 * md-sparrow на required=true отказывает, false снимает элемент. Поэтому флажок есть только у связи,
	 * где он уже записан, и только чтобы его снять.
	 */
	const LINK_REQUIRED_REASON = 'загрузка схемы в платформу этот флажок не хранит';

	function linkTitle(link) {
		return '«' + (link.source || '') + ' → ' + (link.destination || '') + '»';
	}

	/** Однозначное имя связи: номер строки, наборы и выражения; связей между парой наборов бывает несколько. */
	function linkLabel(link, index) {
		return (
			'№' +
			(index + 1) +
			' ' +
			linkTitle(link) +
			' (' +
			(link.sourceExpression || '') +
			' = ' +
			(link.destinationExpression || '') +
			')'
		);
	}

	/** Флажок «Обязательная связь» показывается только у связи, где он записан. */
	function linkRequiredOffered(link) {
		return Boolean(link) && link.required === true;
	}

	/** Значение флажка для правки: false при снятии записанного, иначе undefined. */
	function linkRequiredChange(link, checked) {
		return linkRequiredOffered(link) && !checked ? false : undefined;
	}

	/**
	 * Флажок «Список параметров» хранится только с параметром связи: без параметра платформа 8.3.27 при загрузке
	 * отбрасывает и «да», и «нет», а md-sparrow на «да» отказывает. Без параметра флажок недоступен, кроме уже
	 * записанного «да»: его можно снять.
	 */
	const LINK_LIST_FLAG_REASON = 'без параметра связи загрузка схемы в платформу этот флажок не хранит';

	/** Параметр задан, если непуст после обрезки пробелов, как считает md-sparrow. */
	function linkParameterSet(parameter) {
		return typeof parameter === 'string' && parameter.trim() !== '';
	}

	/** У связи без параметра записано «да». */
	function linkListFlagLegacy(link) {
		return Boolean(link) && link.parameterListAllowed === true && !linkParameterSet(link.parameter);
	}

	/** Доступен ли флажок «Список параметров»: с параметром всегда, без него только при записанном «да». */
	function linkListFlagOffered(link, parameter) {
		return linkParameterSet(parameter) || linkListFlagLegacy(link);
	}

	/** Флажок «Список параметров» новой связи: уходит только true и только с параметром; false md-sparrow пишет сам. */
	function linkListFlagNew(checked, parameter) {
		return checked && linkParameterSet(parameter) ? true : undefined;
	}

	/**
	 * Значение флажка «Список параметров» для правки связи (undefined: без изменения). parameter: поле «Параметр»
	 * после правки, edited: меняются ли другие свойства связи.
	 * С параметром «не задано» и «нет» равны: уходит true или false, если флажок расходится с записанным.
	 * Без параметра true не уходит. Записанный флаг убирается null при снятии параметра, при снятии записанного «да»,
	 * а «нет» только вместе с другой правкой, чтобы окно без изменений не меняло файл.
	 */
	function linkListFlagChange(link, parameter, checked, edited) {
		const recorded = link ? link.parameterListAllowed : undefined;
		if (linkParameterSet(parameter)) {
			return checked !== Boolean(recorded) ? checked : undefined;
		}
		if (recorded !== true && recorded !== false) {
			return undefined;
		}
		if (linkParameterSet(link.parameter)) {
			return null;
		}
		if (recorded === true) {
			return checked ? undefined : null;
		}
		return edited ? null : undefined;
	}

	/** Плашка над таблицей о связях с «да» без параметра; пустая строка: плашки нет. */
	function linkListFlagPlate(links) {
		const labels = [];
		links.forEach((link, index) => {
			if (linkListFlagLegacy(link)) {
				labels.push(linkLabel(link, index));
			}
		});
		if (labels.length === 0) {
			return '';
		}
		return (
			(labels.length === 1 ? 'У связи ' : 'У связей ') +
			labels.join(', ') +
			' флажок «Список параметров» записан без параметра: ' +
			LINK_LIST_FLAG_REASON +
			'. Откройте связь (строка с пометкой «без параметра») и снимите флажок или задайте параметр.'
		);
	}

	/**
	 * Строка плашки «Проверить схему» о флажке «Список параметров» без параметра: связь названа как в таблице
	 * (linkLabel), warning.link считается с нуля. Если связи нет или модель расходится с предупреждением, текст
	 * md-sparrow как есть.
	 */
	function linkListFlagWarningLine(warning, links) {
		const message =
			warning && typeof warning.message === 'string' && warning.message !== '' ? warning.message : 'Предупреждение без описания';
		const index = warning ? warning.link : undefined;
		if (!Number.isInteger(index) || index < 0 || !Array.isArray(links) || index >= links.length) {
			return message;
		}
		const link = links[index];
		const recorded = link ? link.parameterListAllowed : undefined;
		if ((recorded !== true && recorded !== false) || linkParameterSet(link.parameter)) {
			return message;
		}
		const named = /parameterListAllowed=(true|false)/.exec(message);
		if (named && (named[1] === 'true') !== recorded) {
			return message;
		}
		return (
			'Связь ' +
			linkLabel(link, index) +
			': флажок «Список параметров» («' +
			(recorded ? 'да' : 'нет') +
			'») записан без параметра: ' +
			LINK_LIST_FLAG_REASON +
			'.'
		);
	}

	/** Плашка над таблицей о связях с записанной «Обязательной связью»; пустая строка: плашки нет. */
	function linkRequiredPlate(links) {
		const labels = [];
		links.forEach((link, index) => {
			if (linkRequiredOffered(link)) {
				labels.push(linkLabel(link, index));
			}
		});
		if (labels.length === 0) {
			return '';
		}
		return (
			(labels.length === 1 ? 'У связи ' : 'У связей ') +
			labels.join(', ') +
			' записан флажок «Обязательная связь»: ' +
			LINK_REQUIRED_REASON +
			'. Откройте связь (строка с пометкой «обязательная») и снимите флажок.'
		);
	}

	function renderLinks(host) {
		const links = list('dataSetLinks');
		const toolbar = [{ icon: 'add', name: 'Добавить связь…', onClick: () => openLinkDialog(null, -1) }];
		if (links.length === 0) {
			listToolbar(host, toolbar);
			emptyNote(host, 'Связей между наборами нет.');
		} else {
			const plate = linkRequiredPlate(links);
			if (plate) {
				host.appendChild(el('div', 'dcs-plate dcs-plate-warn', plate));
			}
			const listPlate = linkListFlagPlate(links);
			if (listPlate) {
				host.appendChild(el('div', 'dcs-plate dcs-plate-warn', listPlate));
			}
			listToolbar(host, toolbar);
			const tbody = dataTable(host, [
				'Источник',
				'Приёмник',
				'Выражение источника',
				'Выражение приёмника',
				'Параметр',
				'Список параметров',
				'Условие связи',
				'Начальное значение',
				'',
			]);
			links.forEach((link, index) => {
				const tr = document.createElement('tr');
				const sourceTd = cell(tr, link.source || '');
				if (linkRequiredOffered(link)) {
					// Плашка называет связь номером, пометка показывает строку
					const mark = el('span', 'dcs-us-badge dcs-link-required-mark', 'обязательная');
					const why = 'Записан флажок «Обязательная связь»: ' + LINK_REQUIRED_REASON + '. Откройте связь и снимите флажок.';
					mark.title = why;
					mark.setAttribute('aria-label', why);
					sourceTd.appendChild(mark);
				}
				cell(tr, link.destination || '');
				cell(tr, link.sourceExpression || '');
				cell(tr, link.destinationExpression || '');
				cell(tr, link.parameter || '');
				const listTd = cell(tr, link.parameterListAllowed ? '✓' : '', 'dcs-cell-check');
				if (linkListFlagLegacy(link)) {
					const mark = el('span', 'dcs-us-badge dcs-link-list-flag-mark', 'без параметра');
					const why = 'Флажок «Список параметров» записан без параметра: ' + LINK_LIST_FLAG_REASON + '. Откройте связь и снимите флажок или задайте параметр.';
					mark.title = why;
					mark.setAttribute('aria-label', why);
					listTd.appendChild(mark);
				}
				cell(tr, link.linkConditionExpression || '');
				cell(tr, link.startExpression || '');
				actionsCell(tr, [
					{
						svg: 'edit',
						title: 'Править',
						onClick: () => {
							openLinkDialog(link, index);
						},
					},
					{
						svg: 'delete',
						title: 'Удалить',
						danger: true,
						onClick: () => {
							confirmRemove('Удалить связь ' + linkLabel(link, index) + '?', () => {
								if (!send('dcs/remove-link', { index: index })) {
									return BUSY;
								}
								return undefined;
							});
						},
					},
				]);
				tbody.appendChild(tr);
			});
		}
	}

	function openLinkDialog(link, index) {
		const original = link || {};
		const names = dataSetNames();
		for (const extra of [original.source, original.destination]) {
			if (extra && names.indexOf(extra) < 0) {
				names.push(extra);
			}
		}
		const options = names.map((name) => ({ value: name, label: name }));
		let sourceSelect;
		let destinationSelect;
		let sourceExpr;
		let destinationExpr;
		let parameterInput;
		let listBox;
		let requiredBox;
		let conditionInput;
		let startInput;
		openDialog(
			link ? 'Связь наборов данных' : 'Новая связь наборов данных',
			link ? 'Сохранить' : 'Добавить',
			(body) => {
				sourceSelect = formRow(body, 'Источник связи', selectInput(options, original.source || names[0] || ''));
				destinationSelect = formRow(
					body,
					'Приёмник связи',
					selectInput(options, original.destination || names[1] || names[0] || '')
				);
				// Наборы связи читаются при каждом открытии списка: подсказка следует за выбором в форме
				sourceExpr = expressionInput(body, 'Выражение источника', original.sourceExpression, () => 'link-source:' + sourceSelect.value);
				destinationExpr = expressionInput(
					body,
					'Выражение приёмника',
					original.destinationExpression,
					() => 'link-dest:' + destinationSelect.value
				);
				parameterInput = formRow(body, 'Параметр', textInput(original.parameter));
				attachCompletion(parameterInput, () => 'param-name');
				listBox = checkbox('Список параметров', original.parameterListAllowed);
				requiredBox = linkRequiredOffered(link) ? checkbox('Обязательная связь', true) : null;
				checkRow(body, requiredBox ? [listBox, requiredBox] : [listBox]);
				// Без параметра флажок снят и недоступен; выбор при параметре возвращается, когда параметр снова задан
				let listChoice = listBox.input.checked;
				const syncListBox = () => {
					const offered = linkListFlagOffered(link, parameterInput.value);
					if (offered && listBox.input.disabled) {
						listBox.input.checked = listChoice;
					} else if (!offered && !listBox.input.disabled) {
						listChoice = listBox.input.checked;
						listBox.input.checked = false;
					}
					listBox.input.disabled = !offered;
					if (offered) {
						listBox.input.title = '';
						listBox.input.removeAttribute('aria-description');
					} else {
						const why = 'Флажок доступен, когда задан параметр: ' + LINK_LIST_FLAG_REASON;
						listBox.input.title = why;
						listBox.input.setAttribute('aria-description', why);
					}
				};
				syncListBox();
				parameterInput.addEventListener('input', syncListBox);
				if (linkListFlagLegacy(link)) {
					const listWarn = el(
						'div',
						'dcs-warn',
						'Флажок «Список параметров» записан раньше без параметра, но ' + LINK_LIST_FLAG_REASON + ': снимите его или задайте параметр.'
					);
					listWarn.id = 'dcsLinkListFlagWarn';
					listBox.input.setAttribute('aria-describedby', listWarn.id);
					body.appendChild(listWarn);
				}
				if (requiredBox) {
					const warn = el(
						'div',
						'dcs-warn',
						'Флажок «Обязательная связь» записан раньше, но ' + LINK_REQUIRED_REASON + ': снимите его.'
					);
					// Читалка слышит причину вместе с флажком
					warn.id = 'dcsLinkRequiredWarn';
					requiredBox.input.setAttribute('aria-describedby', warn.id);
					body.appendChild(warn);
				}
				const bothSets = () => 'link-both:' + sourceSelect.value + '|' + destinationSelect.value;
				conditionInput = expressionInput(body, 'Условие связи', original.linkConditionExpression, bothSets);
				startInput = expressionInput(body, 'Начальное значение', original.startExpression, bothSets);
			},
			() => {
				const source = sourceSelect.value;
				const destination = destinationSelect.value;
				if (!source || !destination) {
					return 'Укажите наборы данных связи.';
				}
				const sourceExpression = sourceExpr.value.trim();
				const destinationExpression = destinationExpr.value.trim();
				const parameter = parameterInput.value.trim();
				const condition = conditionInput.value.trim();
				const start = startInput.value.trim();
				if (!link) {
					if (!sourceExpression || !destinationExpression) {
						return 'Заполните выражения источника и приёмника.';
					}
					const payload = {
						sourceDataSet: source,
						destinationDataSet: destination,
						sourceExpression: sourceExpression,
						destinationExpression: destinationExpression,
					};
					if (parameter) {
						payload.parameter = parameter;
					}
					const listFlag = linkListFlagNew(listBox.input.checked, parameter);
					if (listFlag !== undefined) {
						payload.parameterListAllowed = listFlag;
					}
					if (condition) {
						payload.linkConditionExpression = condition;
					}
					if (start) {
						payload.startExpression = start;
					}
					if (!send('dcs/add-link', { payload: payload })) {
						return BUSY;
					}
					return undefined;
				}
				const payload = {};
				if (source !== (original.source || '')) {
					payload.sourceDataSet = source;
				}
				if (destination !== (original.destination || '')) {
					payload.destinationDataSet = destination;
				}
				if (sourceExpression !== (original.sourceExpression || '')) {
					payload.sourceExpression = sourceExpression;
				}
				if (destinationExpression !== (original.destinationExpression || '')) {
					payload.destinationExpression = destinationExpression;
				}
				if (parameter !== (original.parameter || '')) {
					payload.parameter = parameter;
				}
				if (condition !== (original.linkConditionExpression || '')) {
					payload.linkConditionExpression = condition;
				}
				if (start !== (original.startExpression || '')) {
					payload.startExpression = start;
				}
				const required = linkRequiredChange(link, Boolean(requiredBox && requiredBox.input.checked));
				if (required !== undefined) {
					payload.required = required;
				}
				// Флажок списка последним: «нет» без параметра убирается только вместе с другой правкой
				const listFlag = linkListFlagChange(link, parameter, listBox.input.checked, Object.keys(payload).length > 0);
				if (listFlag !== undefined) {
					payload.parameterListAllowed = listFlag;
				}
				if (Object.keys(payload).length === 0) {
					closeDialog();
					return undefined;
				}
				if (!send('dcs/set-link', { index: index, payload: payload })) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	// ---------- вкладка «Вычисляемые поля» ----------

	function renderCalculated(host) {
		const fields = list('calculatedFields');
		listToolbar(host, [{ icon: 'add', name: 'Добавить вычисляемое поле…', onClick: () => openCalculatedDialog(null) }]);
		if (fields.length === 0) {
			emptyNote(host, 'Вычисляемых полей нет.');
		} else {
			const tbody = dataTable(host, ['Путь к данным', 'Выражение', 'Заголовок', 'Тип', '']);
			for (const field of fields) {
				const tr = document.createElement('tr');
				cell(tr, field.name || '');
				cell(tr, field.value || '');
				cell(tr, field.title || '');
				typeCell(tr, field.valueType, '', 'вычисляемого поля ' + (field.name || ''), () => {
					openCalculatedTypeDialog(field);
				});
				actionsCell(tr, [
					{
						svg: 'edit',
						title: 'Править',
						onClick: () => {
							openCalculatedDialog(field);
						},
					},
					{
						svg: 'delete',
						title: 'Удалить',
						danger: true,
						onClick: () => {
							confirmRemove('Удалить вычисляемое поле «' + (field.name || '') + '»?', () => {
								if (!send('dcs/remove-calculated-field', { dataPath: field.name || '' })) {
									return BUSY;
								}
								return undefined;
							});
						},
					},
				]);
				tbody.appendChild(tr);
			}
		}
	}

	function openCalculatedDialog(field) {
		const original = field || {};
		let pathInput;
		let exprInput;
		let titleInput;
		let typeChoice = null;
		openDialog(
			field ? 'Вычисляемое поле «' + (original.name || '') + '»' : 'Новое вычисляемое поле',
			field ? 'Сохранить' : 'Добавить',
			(body) => {
				pathInput = formRow(body, 'Путь к данным', textInput(original.name));
				exprInput = expressionInput(body, 'Выражение', original.value, () => 'expr-calc');
				titleInput = formRow(body, 'Заголовок', textInput(original.title));
				// Операция добавления тип не принимает: тип задаётся у созданного поля
				if (field) {
					typeChoice = typeRow(body, original.valueType, {
						title: () => 'Тип значения вычисляемого поля «' + (pathInput.value.trim() || original.name || '') + '»',
					});
				}
			},
			() => {
				const dataPath = pathInput.value.trim();
				const expression = exprInput.value.trim();
				const title = titleInput.value.trim();
				if (!dataPath) {
					return 'Укажите путь к данным.';
				}
				if (dataPath !== (original.name || '') && nameTaken(calculatedFieldPaths(), dataPath, original.name)) {
					return 'Вычисляемое поле с таким путём к данным уже есть.';
				}
				if (!field) {
					if (!expression) {
						return 'Укажите выражение.';
					}
					if (!send('addCalculatedField', { dataPath: dataPath, expression: expression, title: title })) {
						return BUSY;
					}
					return undefined;
				}
				const payload = {};
				if (dataPath !== (original.name || '')) {
					payload.newDataPath = dataPath;
				}
				if (expression !== (original.value || '')) {
					payload.expression = expression;
				}
				if (title !== (original.title || '')) {
					payload.title = title;
				}
				const typed = typeRules.typeEditPayload({ valueType: original.valueType }, { valueType: typeChoice.valueType() });
				if (typed.error) {
					return typed.error;
				}
				Object.assign(payload, typed.payload);
				if (Object.keys(payload).length === 0) {
					closeDialog();
					return undefined;
				}
				if (!send('dcs/set-calculated-field', { dataPath: original.name || '', payload: payload })) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	// ---------- вкладка «Ресурсы» ----------

	function totalFieldPath(item) {
		return item.name || '';
	}

	function totalFieldExpression(item) {
		return item.value || '';
	}

	/** Состояние закладки «Ресурсы» между перерисовками: дерево доступных полей и выбранная строка таблицы. */
	const resourceUi = { tree: { selected: '', expanded: new Set() }, selected: 0 };

	/** Ресурс считается по полю набора или вычисляемому полю: папку и промежуточный узел пути выбрать нельзя. */
	function resourcePickable(node) {
		return Boolean(node) && (node.kind === 'field' || node.kind === 'calc');
	}

	/** Узлы «Доступных полей»: поля всех наборов и вычисляемые, каталог подсказки total-field. */
	function resourceFieldNodes() {
		return completer.buildCatalog(core.model, null, 'total-field', completionTypeOptions()).nodes;
	}

	// Подсказки называют выражение: «>» и «>>» пишут файл сразу, без окна
	const RESOURCE_ADD_TITLE = 'Добавить ресурс Сумма(поле) по выбранному полю';
	const RESOURCE_ADD_ALL_TITLE = 'Добавить ресурсы Сумма(поле) по всем числовым полям';
	const RESOURCE_TREE_HINT = 'Enter и двойной щелчок по полю добавляют ресурс Сумма(поле).';
	/** Сколько полей плашка «>>» называет по имени, остальные числом. */
	const RESOURCE_NAMES_SHOWN = 5;
	const RESOURCE_PICK_NOTE = 'Выберите поле в «Доступных полях» (не папку).';
	const RESOURCE_NO_FIELDS_NOTE = 'Недоступно: полей нет.';
	/** «>>» до прочтения описаний ничего не пишет: отбор по недочитанному типу был бы догадкой. */
	const RESOURCE_TYPES_LOADING = 'Типы полей ещё читаются из метаданных. Нажмите «>>» ещё раз через мгновение.';

	/** Выражение ресурса по умолчанию; путь вставляется без квадратных скобок, как в подсказке выражений. */
	function resourceExpression(path) {
		return 'Сумма(' + path + ')';
	}

	/**
	 * Вид типа поля для ресурса: {kind, type, pending}. kind: numeric, other, mixed, unknown (тип известен, только если
	 * его знает каждый набор с этим полем) или waiting (ждёт описаний объектов из pending).
	 */
	function resourceFieldKind(node) {
		const result = fieldTypes.resourceFieldType(core.model, node.path, node.kind, describeLookup, {
			queryModel: queryModelApi,
			parse: parseQueryCached,
		});
		if (result.state === 'waiting') {
			return { kind: 'waiting', type: null, pending: result.pending };
		}
		return { kind: result.state === 'known' ? fieldTypes.numericKind(result.type) : 'unknown', type: result.type, pending: [] };
	}

	/** Годится ли путь в выражение как есть: сегменты идентификаторы, первый не слово языка. */
	function resourcePathPlain(path) {
		return fieldTypes.plainFieldPath(path);
	}

	/**
	 * Строки плашки после «>»: что добавлено, предупреждения о нечисловом поле и о пути, который выражение может прочитать
	 * не как поле. Составной тип с числом и неизвестный тип не предупреждаются: Сумма по ним может работать.
	 */
	function resourceAddedLines(path, expression, typing, plain) {
		const lines = [{ text: 'Добавлен ресурс ' + expression + '.' }];
		if (typing.kind === 'other') {
			const label = typeLabelOf(typing.type, '');
			lines.push({
				text:
					'Поле «' + path + '» не числовое' + (label ? ' (' + label + ')' : '') + ': при формировании отчёта Сумма по нему выдаст ошибку. ' +
					'Замените выражение, например на Количество(' + path + ').',
			});
		}
		if (plain === false) {
			lines.push({ text: 'Путь «' + path + '» в выражении может прочитаться не как поле: проверьте выражение ресурса.' });
		}
		return lines;
	}

	/**
	 * План «>>» по полям дерева без ресурса, в порядке дерева: add (числовой тип), unknown (тип неизвестен), unsafe (путь
	 * не годится в выражение), pending (описания, без которых тип не известен; тогда «>>» ничего не пишет). Нечисловые
	 * и составные поля в план не входят. kindOf: resourceFieldKind, plainOf: resourcePathPlain.
	 */
	function resourceAddAllPlan(nodes, taken, kindOf, plainOf) {
		const plan = { add: [], unknown: [], unsafe: [], pending: [] };
		const seen = new Set(taken);
		const walk = (level) => {
			for (const node of level) {
				const key = resourcePickable(node) ? fieldTreeKey(node.path) : '';
				if (key && !seen.has(key)) {
					seen.add(key);
					const typing = plainOf(node.path) ? kindOf(node) : { kind: 'unsafe' };
					if (typing.kind === 'numeric') {
						plan.add.push(node.path);
					} else if (typing.kind === 'unknown') {
						plan.unknown.push(node.path);
					} else if (typing.kind === 'unsafe') {
						plan.unsafe.push(node.path);
					} else if (typing.kind === 'waiting') {
						plan.pending.push(...typing.pending);
					}
				}
				walk(Array.isArray(node.children) ? node.children : []);
			}
		};
		walk(nodes);
		return plan;
	}

	/** Пути полей для плашки: первые RESOURCE_NAMES_SHOWN через запятую, остальные числом. */
	function resourceNameList(paths) {
		const shown = paths.slice(0, RESOURCE_NAMES_SHOWN).join(', ');
		return paths.length > RESOURCE_NAMES_SHOWN ? shown + ' и ещё ' + (paths.length - RESOURCE_NAMES_SHOWN) : shown;
	}

	/** Строки плашки после «>>»: добавленные ресурсы и пропущенные поля по имени, чтобы их можно было добавить «>». */
	function resourceAddAllLines(added, unknown, unsafe) {
		const lines = [
			{ text: added.length > 0 ? 'Добавлено ресурсов: ' + added.length + ' (' + resourceNameList(added) + ').' : 'Полей с известным числовым типом без ресурса нет.' },
		];
		if (unknown.length > 0) {
			lines.push({ text: 'Пропущены поля без известного типа: ' + resourceNameList(unknown) + '. Их можно добавить кнопкой «>».' });
		}
		if (unsafe.length > 0) {
			lines.push({
				text: 'Пропущены поля, путь которых в выражении может прочитаться не как поле: ' + resourceNameList(unsafe) + '. Добавьте их кнопкой «>» и проверьте выражение.',
			});
		}
		return lines;
	}

	/**
	 * Есть ли у поля ресурс с тем же выражением (без учёта регистра и пробелов) и пустым «Рассчитывать по». Ресурс
	 * с другим выражением или группировками не повтор.
	 */
	function resourceRepeats(totals, path, expression) {
		const same = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();
		return totals.some(
			(item) =>
				fieldTreeKey(totalFieldPath(item)) === fieldTreeKey(path) &&
				same(totalFieldExpression(item)) === same(expression) &&
				!(Array.isArray(item.groups) && item.groups.some(Boolean))
		);
	}

	/**
	 * Плашка после удачного ответа правки ресурсов. У «>» строки строятся по модели ответа: описания, пришедшие за время
	 * записи, уже учтены. У окна «Новый ресурс» плашки нет (null).
	 */
	function resourceReplyNotice(reply) {
		if (reply.add) {
			const plain = resourcePathPlain(reply.add.path);
			const lines = resourceAddedLines(reply.add.path, reply.add.expression, resourceFieldKind({ path: reply.add.path, kind: reply.add.kind }), plain);
			return { tone: lines.length > 1 ? 'info' : 'ok', lines: lines };
		}
		if (reply.batch) {
			return { tone: 'ok', lines: resourceAddAllLines(reply.batch.add, reply.batch.unknown, reply.batch.unsafe) };
		}
		return null;
	}

	/**
	 * Отказ пакета «>>» (от md-sparrow или проверки панели) называет ресурс номером операции, которого пользователь
	 * не видел: номер заменяется полем плана. Пакет атомарен, поэтому текст начинается с «Ресурсы не добавлены». Прочие
	 * отказы как есть.
	 */
	function resourceRefusalText(reply, error) {
		const paths = reply && reply.batch ? reply.batch.add : null;
		const match = paths ? /^(?:Операция (\d+) \(cf-dcs-add-total-field\): |Ресурсы не добавлены, ресурс (\d+): )/.exec(String(error || '')) : null;
		const path = match ? paths[Number(match[1] || match[2]) - 1] : undefined;
		return path === undefined ? error : 'Ресурсы не добавлены, ресурс по полю «' + path + '»: ' + String(error).slice(match[0].length);
	}

	function hasResourceFields(nodes) {
		return nodes.some((node) => resourcePickable(node) || hasResourceFields(Array.isArray(node.children) ? node.children : []));
	}

	/** Автоповтор Enter на «>» и «>>» гасится: каждое нажатие пишет ресурс в файл. */
	function ignoreEnterRepeat(button) {
		button.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && event.repeat) {
				event.preventDefault();
			}
		});
	}

	/**
	 * Закладка «Ресурсы»: слева «Доступные поля», посередине кнопки переноса, справа таблица ресурсов. «>», Enter,
	 * двойной щелчок и перенос поля сразу добавляют ресурс Сумма(<поле>), «>>» то же по всем числовым полям одним
	 * пакетом. «<» и «<<» удаляют после подтверждения: правка пишется в файл сразу, отмены нет.
	 */
	function renderResources(host) {
		const totals = list('totalFields');
		resourceUi.selected = Math.max(0, Math.min(resourceUi.selected, totals.length - 1));
		const layout = el('div', 'dcs-res');
		const left = el('div', 'dcs-res-col');
		left.appendChild(el('div', 'dcs-qd-col-head', 'Доступные поля'));
		const taken = new Set(totals.map((item) => fieldTreeKey(totalFieldPath(item))));
		let addButton = null;
		const syncAdd = (node) => {
			if (addButton) {
				setTransferState(addButton, RESOURCE_ADD_TITLE, !resourcePickable(node), resourcePickable(node) ? '' : RESOURCE_PICK_NOTE);
			}
		};
		const nodes = resourceFieldNodes();
		const tree = fieldTree(left, {
			label: 'Доступные поля',
			nodes: nodes,
			state: resourceUi.tree,
			keyPrefix: 'resavail',
			empty: 'Полей нет: здесь будут поля наборов и вычисляемые поля.',
			note: (node) => (resourcePickable(node) && taken.has(fieldTreeKey(node.path)) ? 'ресурс' : ''),
			pickable: resourcePickable,
			onActivate: (node) => addResourceFor(node),
			onSelect: syncAdd,
			// Ресурс, брошенный на «Доступные поля», удаляется как «<». Сначала он выбирается, чтобы выбор
			// не ушёл на другой ресурс
			drag: {
				id: 'resavail',
				scope: 'schema',
				from: {
					resgrid: (payload) => {
						const index = Number(payload.key);
						if (table) {
							table.pick(payload.key);
						} else {
							resourceUi.selected = index;
						}
						removeResource(index, '');
					},
				},
			},
		});
		layout.appendChild(left);
		const removeNote = totals.length === 0 ? 'Недоступно: ресурсов нет.' : '';
		// «>>» недоступна, только когда полей нет вовсе; иначе нажатие объясняет итог, даже если добавить нечего
		const noFields = !hasResourceFields(nodes);
		const moves = transferButtons(layout, [
			{ label: '>', title: RESOURCE_ADD_TITLE, onClick: () => addResourceFor(tree.selected()) },
			{
				label: '>>',
				title: RESOURCE_ADD_ALL_TITLE,
				unavailable: noFields,
				note: noFields ? RESOURCE_NO_FIELDS_NOTE : '',
				onClick: () => (noFields ? showNotice('info', 'Ресурсы', [{ text: RESOURCE_NO_FIELDS_NOTE }]) : addAllResources(nodes, taken)),
			},
			{ label: '<', title: 'Удалить выбранный ресурс', unavailable: totals.length === 0, note: removeNote, onClick: () => removeResource(resourceUi.selected, '') },
			{ label: '<<', title: 'Удалить все ресурсы', unavailable: totals.length === 0, note: removeNote, onClick: removeAllResources },
		]);
		moves.buttons.forEach((button) => keyed(button, focusKey(['resmove', button.textContent])));
		addButton = moves.buttons[0];
		ignoreEnterRepeat(moves.buttons[0]);
		ignoreEnterRepeat(moves.buttons[1]);
		syncAdd(tree.selected());
		setHint(tree.element, RESOURCE_TREE_HINT);
		// Описания для типов полей запрашиваются заранее, чтобы к нажатию «>» и «>>» они были в кэше
		setTimeout(() => requestDescriptions(resourceAddAllPlan(nodes, new Set(), resourceFieldKind, resourcePathPlain).pending), HIGHLIGHT_DEBOUNCE_MS);
		const right = el('div', 'dcs-res-col');
		right.appendChild(el('div', 'dcs-qd-col-head', 'Ресурсы'));
		listToolbar(right, [{ icon: 'add', name: 'Добавить ресурс…', onClick: () => openTotalFieldDialog(null, -1) }]);
		let table = null;
		if (totals.length === 0) {
			emptyNote(right, 'Ресурсов нет: выберите поле в «Доступных полях» и нажмите «>».');
		} else {
			table = resourceGrid(right, totals);
		}
		// Поле, брошенное в колонку ресурсов, добавляется как «>». Порядка ресурсов операция не знает: новый ресурс
		// встаёт в конец, сброса внутри списка нет
		tableDropZone(right, {
			id: 'resgrid',
			scope: 'schema',
			head: table ? table.head : null,
			rows: () => (table ? table.rows : []),
			keys: table ? table.keys : null,
			drag: () => 'resource',
			pick: table ? table.pick : undefined,
			from: {
				resavail: (payload) => {
					const node = tree.nodeOf(payload.key);
					if (!resourcePickable(node)) {
						return false;
					}
					addResourceFor(node);
					return undefined;
				},
			},
			place: 'zone',
			effect: 'copy',
		});
		layout.appendChild(right);
		host.appendChild(layout);
		if (core.focusResourceRow) {
			core.focusResourceRow = false;
			// Без строк фокус на «<»: кнопка есть всегда
			const row = focusKeys.get(focusKey(['resrow', resourceUi.selected])) || focusKeys.get(focusKey(['resmove', '<']));
			if (row) {
				row.focus();
			}
		}
	}

	/** Канал занят: сказать в строке состояния и читалке, строка состояния не живая область. */
	function resourceBusy() {
		setStatus(BUSY, true);
		announceCompletion(BUSY);
	}

	/**
	 * Ресурс Сумма(<поле>) без окна: та же правка dcs/add-total-field, что у окна нового ресурса. Точный повтор (то же
	 * выражение по всем группировкам) не пишется, чтобы лишний ресурс не появился от повторного нажатия.
	 */
	function addResourceFor(node) {
		if (!resourcePickable(node)) {
			showNotice('info', 'Ресурсы', [{ text: RESOURCE_PICK_NOTE }]);
			return;
		}
		const expression = resourceExpression(node.path);
		if (resourceRepeats(list('totalFields'), node.path, expression)) {
			showNotice('info', 'Ресурсы', [
				{ text: 'Ресурс ' + expression + ' уже есть. Второй ресурс по этому полю нужен с другим «Рассчитывать по», добавьте его окном «Добавить ресурс…».' },
			]);
			return;
		}
		const typing = resourceFieldKind(node);
		if (typing.kind === 'waiting') {
			// Ресурс добавляется сразу; описания, пришедшие до ответа, учтёт плашка
			requestDescriptions(typing.pending);
		}
		if (!send('dcs/add-total-field', { payload: { dataPath: node.path, expression: expression } })) {
			resourceBusy();
			return;
		}
		core.resourceReply = { row: list('totalFields').length, add: { path: node.path, kind: node.kind, expression: expression } };
	}

	/**
	 * «>>»: ресурсы Сумма(<поле>) по числовым полям без ресурса одним атомарным пакетом. Пропущенные поля называет
	 * плашка; пока типы ждут описаний, ничего не пишется.
	 */
	function addAllResources(nodes, taken) {
		const plan = resourceAddAllPlan(nodes, taken, resourceFieldKind, resourcePathPlain);
		if (plan.pending.length > 0) {
			requestDescriptions(plan.pending);
			showNotice('info', 'Ресурсы', [{ text: RESOURCE_TYPES_LOADING }]);
			return;
		}
		if (plan.add.length === 0) {
			showNotice('info', 'Ресурсы', resourceAddAllLines([], plan.unknown, plan.unsafe));
			return;
		}
		const payloads = plan.add.map((path) => ({ dataPath: path, expression: resourceExpression(path) }));
		if (!send('dcs/add-total-fields', { payloads: payloads })) {
			resourceBusy();
			return;
		}
		core.resourceReply = { row: list('totalFields').length, batch: { add: plan.add, unknown: plan.unknown, unsafe: plan.unsafe } };
	}

	/**
	 * Удаление ресурса после вопроса. from: 'grid' (Delete в таблице), 'row' (кнопка строки), '' («<» или перенос).
	 * Удачный ответ ставит фокус на строку после Delete в таблице и после удаления кнопкой последней строки: этой
	 * кнопки больше нет.
	 */
	function removeResource(index, from) {
		const item = list('totalFields')[index];
		if (!item) {
			showNotice('info', 'Ресурсы', [{ text: 'Ресурсов нет.' }]);
			return;
		}
		confirmRemove('Удалить ресурс «' + totalFieldPath(item) + '»?', () => {
			if (!send('dcs/remove-total-field', { index: index })) {
				return BUSY;
			}
			replyFocus.resources = from === 'grid' || (from === 'row' && index === list('totalFields').length - 1);
			return undefined;
		});
	}

	/** «<<»: все ресурсы одним атомарным пакетом. */
	function removeAllResources() {
		const totals = list('totalFields');
		if (totals.length === 0) {
			showNotice('info', 'Ресурсы', [{ text: 'Ресурсов нет.' }]);
			return;
		}
		confirmRemove('Удалить все ресурсы (' + totals.length + ')?', () => {
			if (!send('dcs/remove-total-fields', { indexes: totals.map((item, index) => index) })) {
				return BUSY;
			}
			resourceUi.selected = 0;
			return undefined;
		});
	}

	/**
	 * Таблица ресурсов: сетка с одной остановкой Tab, кнопки доступны с клавиатуры только у выбранной строки.
	 * Возвращает для переноса мышью {head, rows, keys: строка → номер ресурса, pick(номер)}.
	 */
	function resourceGrid(host, totals) {
		const wrap = el('div', 'dcs-table-wrap');
		const table = el('table', 'dcs-table dcs-res-table');
		table.setAttribute('role', 'grid');
		table.setAttribute('aria-label', 'Ресурсы');
		const thead = document.createElement('thead');
		const head = document.createElement('tr');
		head.setAttribute('role', 'row');
		for (const title of ['Поле', 'Выражение', 'Рассчитывать по…', '']) {
			const th = el('th', '', title);
			th.setAttribute('role', 'columnheader');
			if (!title) {
				th.setAttribute('aria-label', 'Команды строки');
			}
			head.appendChild(th);
		}
		thead.appendChild(head);
		table.appendChild(thead);
		const tbody = document.createElement('tbody');
		const rows = [];
		const keys = new WeakMap();
		const controlsOfRow = (tr) => Array.from(tr.children).flatMap((td) => Array.from(td.children).filter((node) => node.tagName === 'BUTTON'));
		const setStop = (index, focus) => {
			resourceUi.selected = index;
			rows.forEach((tr, at) => {
				const on = at === index;
				tr.classList.toggle('dcs-tree-selected', on);
				tr.setAttribute('aria-selected', String(on));
				tr.tabIndex = on ? 0 : -1;
				for (const control of controlsOfRow(tr)) {
					control.tabIndex = on ? 0 : -1;
				}
			});
			if (focus && rows[index]) {
				rows[index].focus();
			}
		};
		totals.forEach((item, index) => {
			const tr = document.createElement('tr');
			tr.setAttribute('role', 'row');
			keyed(tr, focusKey(['resrow', index]));
			const cells = [
				cell(tr, totalFieldPath(item)),
				cell(tr, totalFieldExpression(item), 'dcs-res-expr'),
				cell(tr, Array.isArray(item.groups) ? item.groups.join(', ') : ''),
			];
			// Строку тащат за ячейку поля: в строке есть кнопки
			cells[0].draggable = true;
			keys.set(tr, String(index));
			for (const td of cells) {
				td.setAttribute('role', 'gridcell');
			}
			// Имя строки для читалки включает все три колонки
			const groups = Array.isArray(item.groups) ? item.groups.filter(Boolean) : [];
			tr.setAttribute(
				'aria-label',
				totalFieldPath(item) + ': ' + totalFieldExpression(item).replace(/\s+/g, ' ') + (groups.length > 0 ? '; рассчитывать по: ' + groups.join(', ') : '')
			);
			actionsCell(tr, [
				{
					svg: 'edit',
					title: 'Править',
					key: focusKey(['resedit', index]),
					onClick: () => {
						openTotalFieldDialog(item, index);
					},
				},
				{
					svg: 'delete',
					title: 'Удалить',
					danger: true,
					key: focusKey(['resdel', index]),
					onClick: () => removeResource(index, 'row'),
				},
			]);
			tr.children[tr.children.length - 1].setAttribute('role', 'gridcell');
			tr.addEventListener('click', (event) => {
				if (!event || !event.target || event.target === tr || event.target.tagName === 'TD') {
					setStop(index, false);
				}
			});
			// Фокус в кнопке строки переносит сюда остановку Tab
			tr.addEventListener('focusin', () => {
				if (resourceUi.selected !== index) {
					setStop(index, false);
				}
			});
			tr.addEventListener('keydown', (event) => {
				if (event.target !== tr || event.defaultPrevented) {
					return;
				}
				let to = -1;
				if (event.key === 'ArrowDown') {
					to = Math.min(totals.length - 1, index + 1);
				} else if (event.key === 'ArrowUp') {
					to = Math.max(0, index - 1);
				} else if (event.key === 'Home') {
					to = 0;
				} else if (event.key === 'End') {
					to = totals.length - 1;
				} else if (event.key === 'Enter') {
					event.preventDefault();
					openTotalFieldDialog(item, index);
					return;
				} else if (event.key === 'Delete') {
					event.preventDefault();
					removeResource(index, 'grid');
					return;
				} else {
					return;
				}
				event.preventDefault();
				setStop(to, true);
			});
			rows.push(tr);
			tbody.appendChild(tr);
		});
		table.appendChild(tbody);
		wrap.appendChild(table);
		host.appendChild(wrap);
		setStop(resourceUi.selected, false);
		return { head: head, rows: rows, keys: keys, pick: (key) => setStop(Number(key), false) };
	}

	/** Окно ресурса: правка выбранного или новый ресурс с пустыми полем и выражением. */
	function openTotalFieldDialog(item, index) {
		const original = item || {};
		const originalGroups = Array.isArray(original.groups) ? original.groups : [];
		let pathInput;
		let exprInput;
		const groupBoxes = [];
		openDialog(
			item ? 'Ресурс «' + totalFieldPath(original) + '»' : 'Новый ресурс',
			item ? 'Сохранить' : 'Добавить',
			(body) => {
				pathInput = formRow(body, 'Поле', textInput(totalFieldPath(original)));
				attachCompletion(pathInput, () => 'total-field');
				const known = fieldPaths();
				exprInput = expressionInput(body, 'Выражение', totalFieldExpression(original), () => 'expr-total');
				groupTitle(body, 'Рассчитывать по');
				const groupOptions = known.slice();
				for (const group of originalGroups) {
					if (groupOptions.indexOf(group) < 0) {
						groupOptions.push(group);
					}
				}
				if (groupOptions.length > 0) {
					const listEl = el('div', 'dcs-check-list');
					listEl.setAttribute('role', 'group');
					listEl.setAttribute('aria-label', 'Рассчитывать по');
					setHint(listEl, 'Без отметок ресурс считается по всем группировкам.');
					for (const group of groupOptions) {
						const box = checkbox(group, originalGroups.indexOf(group) >= 0);
						groupBoxes.push({ name: group, input: box.input });
						listEl.appendChild(box.wrap);
					}
					body.appendChild(listEl);
				} else {
					emptyNote(body, 'Полей нет: ресурс считается по всем группировкам.');
				}
			},
			() => {
				const dataPath = pathInput.value.trim();
				const expression = exprInput.value.trim();
				if (!dataPath) {
					return 'Укажите поле.';
				}
				if (!expression) {
					return 'Укажите выражение.';
				}
				const groups = groupBoxes.filter((box) => box.input.checked).map((box) => box.name);
				if (!item) {
					const payload = { dataPath: dataPath, expression: expression };
					if (groups.length > 0) {
						payload.groups = groups;
					}
					if (!send('dcs/add-total-field', { payload: payload })) {
						return BUSY;
					}
					// Новый ресурс встаёт в конец: после ответа выбрана его строка
					core.resourceReply = { row: list('totalFields').length };
					return undefined;
				}
				const payload = {};
				if (dataPath !== totalFieldPath(original)) {
					payload.dataPath = dataPath;
				}
				if (expression !== totalFieldExpression(original)) {
					payload.expression = expression;
				}
				const sameGroups =
					groups.length === originalGroups.length && originalGroups.every((group) => groups.indexOf(group) >= 0);
				if (!sameGroups) {
					payload.groups = groups;
				}
				if (Object.keys(payload).length === 0) {
					closeDialog();
					return undefined;
				}
				if (!send('dcs/set-total-field', { index: index, payload: payload })) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	// ---------- вкладка «Параметры» ----------

	function useLabel(use) {
		if (use === 'Always') {
			return 'Всегда';
		}
		if (use === 'Auto') {
			return 'Авто';
		}
		return use || '';
	}

	/**
	 * Есть ли в списке значений «Неопределено» рядом с другими значениями. Платформа 8.3.27 при загрузке отбрасывает
	 * такой элемент (одиночный хранит), md-sparrow такой список не пишет; прочитанный показывается с предупреждением.
	 */
	function schemaListDropsNil(value) {
		const items = value && value.list && Array.isArray(value.list.items) ? value.list.items : [];
		return items.length > 1 && items.some((item) => Boolean(item && item.value && item.value.nil));
	}

	const SCHEMA_LIST_NIL_WARNING =
		'«Неопределено» рядом с другими значениями списка загрузка схемы в платформу отбрасывает: после загрузки останутся только заданные значения.';

	/** Плашка над таблицей о параметрах с таким списком; пустая строка: плашки нет. */
	function schemaListNilPlate(params) {
		const names = params.filter((param) => schemaListDropsNil(param.valueTyped)).map((param) => '«' + (param.name || '') + '»');
		if (names.length === 0) {
			return '';
		}
		return (names.length === 1 ? 'У параметра ' : 'У параметров ') + names.join(', ') + ' в списке значений ' + SCHEMA_LIST_NIL_WARNING;
	}

	/**
	 * Элементы с представлениями в списке старой записи (одно значение v8:ValueListType), которые потеряет загрузка;
	 * пусто: потерь нет. Платформа 8.3.27 при признаке «Доступен список значений» разворачивает такой список
	 * в отдельные значения и молча теряет представления. Старая запись не переписывается; правило то же, что
	 * у предупреждения valueListPresentationsLost в md-sparrow.
	 */
	function schemaListPresentedItems(value, valueListAllowed) {
		if (valueListAllowed !== true || !value || value.type !== 'v8:ValueListType') {
			return [];
		}
		const items = value.list && Array.isArray(value.list.items) ? value.list.items : [];
		return items.filter((item) => Boolean(item) && typeof item.presentation === 'string' && item.presentation !== '');
	}

	/** Сколько элементов с представлениями назвать, остальные числом, как у md-sparrow. */
	const SCHEMA_LIST_NAMED_ITEMS = 3;

	/**
	 * Что будет со старым списком при загрузке и в файле. При dropsNil сказано «Заданные значения», чтобы не спорить
	 * с предупреждением о «Неопределено». many: о нескольких списках.
	 */
	function schemaListPresentationLoss(dropsNil, many) {
		return (
			'загрузка схемы в платформу развернёт ' +
			(many ? 'их' : 'его') +
			' в отдельные значения, а представления потеряет. ' +
			(dropsNil ? 'Заданные значения' : 'Значения') +
			' останутся; в файле ' +
			(many ? 'такие списки хранятся' : 'такой список хранится') +
			' как есть.'
		);
	}

	/**
	 * Предупреждение о списке с представлениями для ячейки, диалога параметра и окна типа; пусто: предупреждать
	 * не о чем. describe: сводка значения элемента (valueSummary).
	 */
	function schemaListPresentationWarning(value, valueListAllowed, describe) {
		const items = schemaListPresentedItems(value, valueListAllowed);
		if (items.length === 0) {
			return '';
		}
		const named = items
			.slice(0, SCHEMA_LIST_NAMED_ITEMS)
			.map((item) => (describe(item.value) || 'пустое') + ': «' + item.presentation + '»');
		const rest = items.length > SCHEMA_LIST_NAMED_ITEMS ? ' и ещё ' + (items.length - SCHEMA_LIST_NAMED_ITEMS) : '';
		return (
			'Список значений записан старой формой, с представлениями элементов (' +
			named.join(', ') +
			rest +
			'): ' +
			schemaListPresentationLoss(schemaListDropsNil(value), false)
		);
	}

	/** Плашка над таблицей о параметрах со старым списком с представлениями; пустая строка: плашки нет. */
	function schemaListPresentationPlate(params) {
		const marked = params.filter((param) => schemaListPresentedItems(param.valueTyped, param.valueListAllowed).length > 0);
		if (marked.length === 0) {
			return '';
		}
		const names = marked.map((param) => '«' + (param.name || '') + '»');
		const dropsNil = marked.some((param) => schemaListDropsNil(param.valueTyped));
		if (names.length === 1) {
			return 'Список значений параметра ' + names[0] + ' записан старой формой, с представлениями элементов: ' + schemaListPresentationLoss(dropsNil, false);
		}
		return 'Списки значений параметров ' + names.join(', ') + ' записаны старой формой, с представлениями элементов: ' + schemaListPresentationLoss(dropsNil, true);
	}

	/** Предупреждения ячейки «Значение» параметра схемы: «Неопределено» среди значений и старый список с представлениями. */
	function schemaValueWarnings(param, describe) {
		const warnings = [];
		if (schemaListDropsNil(param.valueTyped)) {
			warnings.push(SCHEMA_LIST_NIL_WARNING);
		}
		const presentations = schemaListPresentationWarning(param.valueTyped, param.valueListAllowed, describe);
		if (presentations) {
			warnings.push(presentations);
		}
		return warnings;
	}

	function renderParameters(host) {
		const params = list('parameters');
		const toolbar = [{ icon: 'add', name: 'Добавить параметр…', onClick: () => openParameterDialog(null) }];
		if (params.length === 0) {
			listToolbar(host, toolbar);
			emptyNote(host, 'Параметров нет.');
		} else {
			for (const plate of [schemaListNilPlate(params), schemaListPresentationPlate(params)]) {
				if (plate) {
					host.appendChild(el('div', 'dcs-plate dcs-plate-warn', plate));
				}
			}
			listToolbar(host, toolbar);
			const tbody = dataTable(host, [
				'Имя',
				'Заголовок',
				'Тип',
				'Значение',
				'Выражение',
				'Использование',
				'Ограничение доступности',
				'',
			]);
			for (const param of params) {
				const tr = document.createElement('tr');
				cell(tr, param.name || '');
				cell(tr, param.title || '');
				typeCell(tr, param.valueType, param.type, 'параметра ' + (param.name || ''), () => {
					openParameterTypeDialog(param);
				});
				const valueTd = cell(tr, param.valueTyped ? valueSummary(param.valueTyped) : param.valuePresentation || '');
				const valueWarnings = schemaValueWarnings(param, valueSummary);
				if (valueWarnings.length > 0) {
					valueTd.title = valueWarnings.join('\n');
					valueTd.setAttribute('aria-description', valueWarnings.join(' '));
				}
				cell(tr, param.expression || '');
				cell(tr, useLabel(param.use));
				cell(tr, param.useRestriction ? '✓' : '', 'dcs-cell-check');
				actionsCell(tr, [
					{
						svg: 'edit',
						title: 'Править',
						onClick: () => {
							openParameterDialog(param);
						},
					},
					{
						svg: 'delete',
						title: 'Удалить',
						danger: true,
						onClick: () => {
							confirmRemove('Удалить параметр «' + (param.name || '') + '»?', () => {
								if (!send('dcs/remove-parameter', { name: param.name || '' })) {
									return BUSY;
								}
								return undefined;
							});
						},
					},
				]);
				tbody.appendChild(tr);
			}
		}
	}

	function openParameterDialog(param) {
		const original = param || {};
		const names = list('parameters')
			.map((item) => item.name || '')
			.filter(Boolean);
		let nameInput;
		let titleInput;
		let exprInput;
		let useSelect;
		let restrictionBox;
		let typeChoice;
		let listBox = null;
		let asFieldBox = null;
		let denyBox = null;
		/** Что окажется в payload по текущему выбору: тип, очистка значения, признаки параметра. */
		function typedPayload() {
			if (!param) {
				// add-parameter принимает тип, но не признаки: их правят у созданного параметра
				return typeRules.typeEditPayload({}, { valueType: typeChoice.valueType() });
			}
			return typeRules.typeEditPayload(
				parameterOriginal(original),
				{
					valueType: typeChoice.valueType(),
					valueListAllowed: listBox.input.checked,
					availableAsField: asFieldBox.input.checked,
					denyIncompleteValues: denyBox.input.checked,
				},
				core.typeDictionary
			);
		}
		openDialog(
			param ? 'Параметр «' + (original.name || '') + '»' : 'Новый параметр',
			param ? 'Сохранить' : 'Добавить',
			(body) => {
				nameInput = formRow(body, 'Имя', textInput(original.name));
				titleInput = formRow(body, 'Заголовок', textInput(original.title));
				let valueWarn = null;
				typeChoice = typeRow(body, original.valueType, {
					title: () => 'Тип значения параметра «' + (nameInput.value.trim() || original.name || '') + '»',
					fallback: original.type,
					warnings: typeOwnerWarnings(original),
					onChange: () => {
						if (valueWarn) {
							const change = typedPayload().valueChange;
							valueWarn.textContent = change ? clearingText(change) : '';
						}
					},
				});
				if (param) {
					const value = original.valueTyped;
					const valueBox = el('div', 'dcs-type-value-box');
					valueBox.appendChild(
						el('span', 'dcs-type-value', value === undefined ? 'не задано' : valueSummary(value) || 'пустое')
					);
					if (schemaListDropsNil(value)) {
						valueBox.appendChild(el('div', 'dcs-warn dcs-list-nil-warn', SCHEMA_LIST_NIL_WARNING));
					}
					const presentationWarning = schemaListPresentationWarning(value, original.valueListAllowed, valueSummary);
					if (presentationWarning) {
						valueBox.appendChild(el('div', 'dcs-warn dcs-list-presentation-warn', presentationWarning));
					}
					valueWarn = el('div', 'dcs-warn dcs-type-warn');
					valueWarn.setAttribute('aria-live', 'polite');
					valueBox.appendChild(valueWarn);
					formRow(body, 'Значение', valueBox);
				}
				// Сам параметр в своём выражении не предлагается, у нового берётся набранное имя
				exprInput = expressionInput(
					body,
					'Выражение',
					original.expression,
					() => 'expr-param:' + (original.name || nameInput.value.trim())
				);
				useSelect = formRow(
					body,
					'Использование',
					selectInput(
						[
							{ value: 'Auto', label: 'Авто' },
							{ value: 'Always', label: 'Всегда' },
						],
						original.use === 'Always' ? 'Always' : 'Auto'
					)
				);
				restrictionBox = checkbox('Ограничение доступности', original.useRestriction);
				if (param) {
					// Признак, которого нет в файле, принимает умолчание md-sparrow
					const defaults = typeRules.PARAMETER_FLAG_DEFAULTS;
					const flag = (key) => (typeof original[key] === 'boolean' ? original[key] : defaults[key]);
					listBox = checkbox('Доступен список значений', flag('valueListAllowed'));
					asFieldBox = checkbox('Доступен как поле', flag('availableAsField'));
					denyBox = checkbox('Запрещать незаполненные значения', flag('denyIncompleteValues'));
					checkRow(body, [restrictionBox, listBox, asFieldBox, denyBox]);
				} else {
					checkRow(body, [restrictionBox]);
				}
			},
			() => {
				const name = nameInput.value.trim();
				const title = titleInput.value.trim();
				const expression = exprInput.value.trim();
				if (!name) {
					return 'Укажите имя параметра.';
				}
				const typed = typedPayload();
				if (typed.error) {
					return typed.error;
				}
				if (!param) {
					// Имена параметров регистр не различают
					if (names.some((taken) => taken.toLowerCase() === name.toLowerCase())) {
						return 'Параметр с таким именем уже есть.';
					}
					const payload = { name: name };
					if (title) {
						payload.title = title;
					}
					if (expression) {
						payload.expression = expression;
					}
					if (useSelect.value === 'Always') {
						payload.use = 'Always';
					}
					if (restrictionBox.input.checked) {
						payload.useRestriction = true;
					}
					if (typed.payload.valueType) {
						payload.valueType = typed.payload.valueType;
					}
					if (!send('dcs/add-parameter', { payload: payload })) {
						return BUSY;
					}
					return undefined;
				}
				const payload = {};
				if (name !== (original.name || '')) {
					// Смена регистра своего имени разрешена
					if (names.some((taken) => taken !== original.name && taken.toLowerCase() === name.toLowerCase())) {
						return 'Параметр с таким именем уже есть.';
					}
					payload.newName = name;
				}
				if (title !== (original.title || '')) {
					payload.title = title;
				}
				if (expression !== (original.expression || '')) {
					payload.expression = expression;
				}
				if (useSelect.value !== (original.use === 'Always' ? 'Always' : 'Auto')) {
					payload.use = useSelect.value;
				}
				if (restrictionBox.input.checked !== Boolean(original.useRestriction)) {
					payload.useRestriction = restrictionBox.input.checked;
				}
				Object.assign(payload, typed.payload);
				if (Object.keys(payload).length === 0) {
					closeDialog();
					return undefined;
				}
				if (!send('dcs/set-parameter', { name: original.name || '', payload: payload })) {
					return BUSY;
				}
				return undefined;
			}
		);
	}

	// ---------- вкладка «Вложенные схемы» (только просмотр) ----------

	function renderNested(host) {
		const nested = list('nestedSchemas');
		if (nested.length === 0) {
			emptyNote(host, 'Вложенных схем нет.');
			return;
		}
		listSection(host, nested.map((item) => ({ name: item.name || '', value: item.value || '' })));
	}

	return Object.freeze({
		fieldPathDrafts, flushQueryEdits, linkListFlagWarningLine, onBackgroundSaved, pruneFieldPathDrafts,
		reconcileQueryDrafts, renderCalculated, renderDataSets, renderLinks, renderNested, renderParameters, renderResources,
		resourceRefusalText, resourceReplyNotice, resourceUi, retryQueryDrafts, scheduleNameCheck,
	});
};
