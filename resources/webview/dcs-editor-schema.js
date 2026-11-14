/**
 * Закладки схемы редактора СКД: «Наборы данных» (с текстом запроса набора и его фоновой записью), «Связи наборов
 * данных», «Вычисляемые поля», «Ресурсы», «Параметры», «Вложенные схемы»; окно «Тип значения» и форма роли и
 * ограничений поля.
 *
 * Подключается до основного скрипта (dcs-editor.js) и задаёт только фабрику window.DcsEditorSchema. Её зовёт основной
 * скрипт в конце своего запуска и отдаёт объект ядра (JSDoc у const core в dcs-editor.js): других имён редактора
 * закладки не видят. Изменяемое общее состояние (модель, правка в полёте, флажки фокуса ответа) читается и пишется
 * через поля-аксессоры этого объекта (core.model, core.saving…), а не копией значения. Фабрика возвращает то, что
 * нужно ядру: отрисовку закладок и обработчики ответов панели.
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

	/** Поля роли из DTO: флажки и уточнения периода, остатка и счёта; setName — набор поля для подсказки «Поле счёта». */
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
			// Поле счёта — поле того же набора
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

	/**
	 * Столько объектов вида окно рисует за раз: в больших конфигурациях справочников тысячи,
	 * а нужный быстрее найти поиском, чем прокруткой.
	 */
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

	/** Константа квалификатора к виду списка выбора: текст файла и имя константы — одно значение. */
	function qualifierConstant(value, fallback) {
		const text = String(value || '').trim();
		const map = { Variable: 'VARIABLE', Fixed: 'FIXED', Any: 'ANY', Nonnegative: 'NONNEGATIVE', Date: 'DATE', Time: 'TIME', DateTime: 'DATE_TIME' };
		return map[text] || text || fallback;
	}

	/**
	 * Ячейка «Тип» таблицы: подпись кнопкой, щелчок открывает окно типа (только на просмотр там,
	 * где правка недоступна). Без обработчика — подпись текстом.
	 */
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

	/** Что увидит пользователь после очистки значения: подпись пустого значения или «пустое значение типа». */
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

	/** Прочитанное у параметра — то, с чем typeEditPayload сравнивает итог диалога. */
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
	 * Окно «Тип значения» — уровень стека поверх открытых окон (из таблицы — уровень 1, из
	 * диалога поля или параметра — над ним). Окно правит свою копию типа: отмена её
	 * выбрасывает, ОК отдаёт итог в spec.onDone.
	 *
	 * spec: {title, valueType — прочитанный или выбранный у владельца тип, readOnlyReason? —
	 * только просмотр, warnings? — строки о данных владельца, parameter? — блок «Значение» и флажок
	 * «Доступен список значений» ({value, valueListAllowed}), onDone(edited, level) — строка
	 * ошибки или undefined}. edited: {valueType, valueListAllowed?}.
	 */
	function openTypeDialog(spec) {
		requestTypeDictionary();
		const source = spec.valueType || null;
		const sourceReadOnly = Boolean(source && source.editable === false);
		const readOnlyReason = spec.readOnlyReason || (sourceReadOnly ? source.readOnlyReason : '');
		const readOnly = readOnlyReason !== '';
		const parameter = spec.parameter || null;
		const state = {
			// Копия: поля квалификаторов пишут прямо в неё, прочитанная модель не трогается
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
			// Строки дерева — соседи в DOM, без role=group: глубину читалке передаёт только aria-level
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
				// В дереве одна остановка Tab — сама строка: флажок ставится пробелом или щелчком
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
			// Щелчок по узлу раскрывает его (флажок «любая ссылка вида» — свой щелчок), по строке — ставит флажок
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
					// Флажок у вида — «любая ссылка вида» (TypeSet), объекты вида — его строки
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

		/** Числовое поле квалификатора; max — подсказка спиннеру, настоящую границу держит validateQualifiers. */
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

		/** Пишет поле квалификатора в копию типа: объект квалификатора новый — прочитанный не трогается. */
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

		/** Ошибки квалификаторов — у своего поля; общие (квалификатор без типа) — у первого поля вида. */
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
			// Выключить составной при нескольких типах — значит молча выбросить лишние: пусть снимут их сами
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

		// Флажок списка у параметра правится и при типе вне словаря: только сам тип переносится эхом
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
	 * ОК окна типа, открытого из таблицы: payload той же функцией, что у диалогов-владельцев; пустой —
	 * закрыть без записи. Отправку делает вызывающий литеральным send — по нему проверки сверяют типы
	 * сообщений с панелью.
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

	/** Окно типа поля набора из таблицы: правка уходит set-field, у вложенного набора — только просмотр. */
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

	/** Окно типа вычисляемого поля из таблицы: правка уходит set-calculated-field. */
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

	/**
	 * Окно типа параметра из таблицы: тип, блок «Значение» (несовместимое с новым типом значение
	 * очищается) и флажок списка; правка уходит set-parameter.
	 */
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
	 * Строка «Тип» в диалоге поля, вычисляемого поля или параметра: подпись и кнопка, которая
	 * открывает окно типа вторым уровнем стека. Выбранный тип живёт в строке до ОК владельца —
	 * мутацию шлёт он, одной правкой вместе с остальными полями формы.
	 *
	 * options: {title(), fallback?, readOnlyReason?, warnings?, onChange?}. Возвращает
	 * {valueType()} — текущий выбор (до правки — прочитанный тип).
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
			// Состав определяемого типа — как у ячейки «Тип» таблиц: наведением на подпись и
			// описанием кнопки — подпись в порядок Tab не входит, и читалка услышит состав на кнопке
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
	// Как в конфигураторе: слева дерево наборов (объединения раскрываются), справа — выбранный набор.

	/** Выбранный набор: имена от верхнего уровня; длиннее одного — набор внутри объединения. */
	let dataSetPath = [];
	/** Свёрнутые объединения дерева; ключ — путь имён через «/» (в именах 1С косой черты нет). */
	const collapsedSets = new Set();
	/** Вернуть фокус на выбранную строку дерева после перерисовки (навигация с клавиатуры). */
	let focusSetTree = false;
	/** Горизонтальная прокрутка таблицы полей: переживает перерисовку после правки флажка. */
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

	/** Выбор переживает перечитку модели; пропавший набор уступает ближайшему предку или первому. */
	function ensureDataSetSelection() {
		// Набора ещё нет — ответ правки не пришёл (перерисовка от фоновой записи запроса): ждём ответа, его
		// обработчик и снимает pendingDataSet
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
		// Правленый текст запроса записывается до смены набора: обычно его уже записал уход фокуса
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
		// Ключи панели и строк дерева: фокус на них переживает перерисовку вкладки по ответу правки
		bar.appendChild(keyed(addSetControl(), focusKey(['settool', 'add'])));
		const topName = dataSetPath.length === 1 ? dataSetPath[0] : '';
		const nestedHint = dataSetPath.length > 1 ? 'Наборы внутри объединения только просматриваются' : '';
		// Пиктограммы: название — в подсказке и доступном имени, клавиша дерева — только в подсказке; недоступные —
		// disabled
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
			// Одна точка входа в дерево с клавиатуры: фокусируется только выбранная строка
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

	/** Источники данных — под деревом: их немного, и правятся они не здесь. */
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

	/** Меню добавления набора: вид выбирается пунктом, как в конфигураторе. */
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
		// Стрелки на закрытом списке только выбирают вид, окно открывает Enter или выбор мышью (actionSelect)
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

	/** Содержимое выбранного набора; набор внутри объединения показывается только для чтения. */
	function renderDataSetBody(host, dataSet, nested) {
		const head = el('div', 'dcs-set-head');
		head.appendChild(nameEl('span', 'dcs-set-title', dataSet.name || ''));
		if (dataSet.type) {
			head.appendChild(el('span', 'dcs-kind', kindLabel(dataSet.type)));
		}
		host.appendChild(head);
		if (nested) {
			// Мутации md-sparrow адресуют наборы верхнего уровня: правка здесь испортила бы соседей
			host.appendChild(
				el(
					'div',
					'dcs-plate',
					'Набор внутри объединения «' +
						dataSetPath[0] +
						'» доступен только для просмотра: правятся наборы верхнего уровня.'
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
		if (typeof dataSet.query === 'string') {
			renderQueryEditor(host, dataSet, nested);
		}
	}

	/**
	 * Текст запроса набора. Текст записывается, когда правка закончена, — поле теряет фокус (и перед сменой набора,
	 * закладки, открытием конструктора, уходом со страницы), а поля заполняются следом, если у набора включено
	 * «Автозаполнение».
	 * Правленый текст живёт в queryDrafts и переживает перерисовку; под полем — ошибки текста и отказ записи.
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
		// Ошибки текста и записи — первой строкой под полем, предупреждения проверки имён — за ними
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
			// Текст набора внутри объединения правится только конструктором: он пишет запрос по пути
			// «Объединение/Дочерний» (dcs/apply-query), а поля такого набора остаются только для чтения
			renderQueryStatus(status, key, editor.input.value, false);
			const readOnlyActions = el('div', 'dcs-actions');
			readOnlyActions.appendChild(queryConstructorButton(dataSet, key, editor.input));
			host.appendChild(readOnlyActions);
			return;
		}
		keyed(editor.input, focusKey(['query', key]));
		// В тексте запроса подсказываются только &-параметры: буквы список не открывают,
		// иначе он всплывал бы на каждом слове ВЫБРАТЬ … ИЗ
		const completion = attachCompletion(editor.input, () => 'query', { letters: false });
		// «⋯» — следующая остановка Tab после поля: фокус на ней переживает перерисовку по ответу записи
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
			// Поле, которое убирает перерисовка, правку не заканчивает: фокус вернётся в новое поле (restoreFocus)
			if (core.renderingContent || !editor.input.isConnected) {
				return;
			}
			// Окно потеряло фокус (щелчок в проводнике VS Code, другое приложение): браузер шлёт blur и полю, но правка
			// не закончена — пишется только текст, без заполнения полей и без повтора отклонённого
			const mode = windowHasFocus() ? 'edit' : 'passive';
			const emptyRefused = commitQueryDraft(key, mode);
			if (!status.isConnected) {
				return;
			}
			const state = repaint();
			if (mode !== 'edit' || !state) {
				return;
			}
			// Строка под полем живой областью не сделана (шумела бы при наборе): о том, что текст не ушёл или в нём
			// ошибка, читалка слышит один раз — при уходе из поля
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
	 * Правленый и ещё не записанный текст запроса по пути набора (setKey): {text, base, retry}. base — текст модели,
	 * от которого правка ушла: если модель сменила текст иначе (окно конструктора записало свой), черновик уступает.
	 * retry — запись просили, пока шла другая правка (вид конца правки: 'edit', 'nav', 'passive'): она уйдёт после ответа.
	 */
	const queryDrafts = new Map();
	/**
	 * Отказ записи текста или заполнения полей по пути набора: {text, message, refused}; виден под полем, пока текст тот
	 * же. refused — md-sparrow не принял сам текст: его повторяет только уход из поля внутри страницы (отказ мог быть
	 * временным: файл занят), а не уход из окна, смена набора или закладки.
	 */
	const queryErrors = new Map();
	/**
	 * Наборы, чей текст записан, а поля по нему при включённом «Автозаполнении» ещё не заполнены: текст ушёл при уходе
	 * из окна (в поле могло остаться недописанное «Т.Ном», а md-sparrow поля только добавляет — лишнее пришлось бы
	 * удалять руками), заполнение получило отказ, «Автозаполнение» только что включили. Заполнение уходит при следующем
	 * конце правки внутри страницы, у включённого флажка — сразу после его записи. {retry} — канал был занят: после ответа.
	 */
	const pendingFills = new Map();
	/** Выражения, которые заполнение пропустило в прошлый раз (по набору): те же причины плашкой не повторяются. */
	const lastFillSkips = new Map();

	const EMPTY_QUERY_PROBLEM = 'Запрос пуст: пустой текст не сохраняется.';

	/** Текст запроса набора по пути в текущей модели; null — набора нет или это не набор-запрос. */
	function queryTextAt(key) {
		const dataSet = key ? dataSetAt(key.split('/')) : null;
		return dataSet && typeof dataSet.query === 'string' ? dataSet.query : null;
	}

	/**
	 * Первая ошибка разбора текста (разборщик конструктора): {line, message} или null. Внутренняя ошибка разборщика —
	 * не ошибка текста: о ней молчим, а платформа и md-sparrow разберут текст сами.
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

	/**
	 * Строка под полем: отказ записи этого текста, пустой текст или ошибка разбора; иначе пусто. kind — откуда: saved
	 * (отказ md-sparrow или пустой текст не ушёл), empty, parse.
	 */
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

	/** Строка под полем и признак aria-invalid поля: ошибка видна глазу и слышна читалке на самом поле. */
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

	/** Строка под полем открытого набора по новому состоянию (отказ записи, ответ). */
	function refreshQueryStatus(key) {
		if (core.queryStatusRefresh && core.queryStatusRefresh.key === key) {
			core.queryStatusRefresh.repaint();
		}
	}

	/** Набранный текст — черновик набора; текст модели черновиком не считается, пока его не пишет фоновая запись. */
	function noteQueryDraft(key, text) {
		const current = queryTextAt(key);
		if (current === null) {
			return;
		}
		const draft = queryDrafts.get(key);
		// Пока уходит прежняя правка этого текста, черновик держится и при возврате к тексту модели: ответ сменит
		// модель на отправленный текст, и только черновик помнит, что пользователь вернул старый
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

	/** Сила конца правки: отложенная запись (retry) уходит с самым сильным из тех, что о ней просили. */
	const COMMIT_RANK = { passive: 0, nav: 1, edit: 2 };

	/**
	 * Конец правки текста набора: записать черновик, если текст изменился. Пустой текст не уходит (md-sparrow его не
	 * примет) — под полем причина, черновик остаётся. Занятый канал откладывает запись до ответа (retry). Запись —
	 * сообщение setQuery; при «Автозаполнении» за ним — dcs/autofill-fields, но только если в тексте нет ошибки
	 * разбора. mode — откуда конец правки:
	 * - 'edit' (по умолчанию) — поле потеряло фокус внутри страницы: отклонённый текст уходит снова (отказ мог быть
	 *   временным), а без черновика уходит отложенное заполнение (pendingFills);
	 * - 'nav' — смена набора или закладки, «Конструктор…», «Проверить схему»: то же, но отклонённый и с тех пор не
	 *   изменённый текст не повторяется — иначе каждая стрелка в дереве наборов слала бы тот же отказ;
	 * - 'passive' — уход из окна, скрытие и закрытие страницы: правка не закончена, пишется только текст (набранное не
	 *   теряется), поля заполнятся при следующем конце правки; отклонённый текст не повторяется.
	 * Возвращает true, если пустой текст не ушёл (вызывающий скажет об этом).
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
		// Новый текст заполнит сам (или его заполнение отложится заново): прежнее отложенное заполнение не нужно
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
	 * Отложенное заполнение набора (pendingFills): уходит фоновой записью, если «Автозаполнение» включено, текст
	 * модели не пуст и разбирается; канал занят — после ответа. Черновик набора заполнит сам, когда уйдёт.
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

	/**
	 * Записать все черновики (перед сменой набора, закладки, конструктором, проверкой схемы, уходом со страницы). mode —
	 * как у commitQueryDraft: 'nav' — переход внутри страницы, 'passive' — уход со страницы или из окна.
	 */
	function flushQueryEdits(mode) {
		for (const key of Array.from(queryDrafts.keys())) {
			commitQueryDraft(key, mode);
		}
	}

	/** Отложенные записи (retry) и заполнения — после ответа той правки, что занимала канал. */
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
	 * Модель без текста запроса набора key (набор верхнего уровня): если, кроме текста, ничего не поменялось, вкладку
	 * перерисовывать незачем. null — сравнить нельзя (набор внутри объединения, модель не разобрать): перерисовать.
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
	 * Черновики после новой модели: записанный (модель — его текст) и ушедший набор забываются; черновик, чей набор
	 * получил другой текст не от него (ОК конструктора), уступает — конструктор начинал с этого черновика.
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
	 * Ответ фоновой записи: модель и черновики обновляются, окна (например, конструктор, открытый сразу после ухода из
	 * поля) остаются открытыми. Вкладка перерисовывается, только если модель поменялась не одним текстом этого набора
	 * (заполнение добавило поля); иначе обновляются строка под полем и проверка имён — перерисовка заменила бы узел с
	 * фокусом, и читалка заново назвала бы его. Отказ — под полем этого набора и плашкой (её слышит читалка, а из поля
	 * пользователь уже ушёл). После текста при «Автозаполнении» уходит заполнение полей, затем — правка, вставшая в
	 * очередь, или отложенная запись.
	 */
	function onBackgroundSaved(msg) {
		const job = core.background;
		if (!msg.ok) {
			core.background = null;
			const error = String(msg.error || 'Ошибка сохранения');
			const head = job.stage === 'text' ? 'Запрос не сохранён' : 'Поля из запроса не заполнены';
			queryErrors.set(job.key, { text: job.text, message: head + ': ' + error, refused: job.stage === 'text' });
			if (job.stage === 'fill') {
				// Заполнение повторит следующий конец правки, менять текст ради него не нужно
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
				// Модель станет отправленным текстом: набранное после отправки остаётся черновиком от него
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
			// Итог — плашкой, но только когда есть новости: запись идёт на каждый уход из поля, и одни и те же пропуски
			// (выражение без псевдонима) не повторяются после каждой правки
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
	 * После ответа фоновой записи: перерисовка вкладки, если модель поменялась не одним текстом набора key; иначе —
	 * строка под полем и записанный текст для проверки имён (по нему она запрашивает недостающие описания таблиц).
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
	 * Кнопка мыши нажата: перерисовка по ответу фоновой записи ждёт отпускания. Запись уходит по уходу фокуса, то есть
	 * на нажатии кнопки мыши; перерисовка до отпускания убрала бы узел под курсором, и щелчок (другой набор,
	 * «Конструктор…») пропал бы. Если отпускание не пришло (кнопку отпустили за окном) — перерисовка через 1,5 с.
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
			// После click того же нажатия: он уже дошёл до своего узла. Начало переноса тоже отпускает кнопку
			// (pointercancel) — тогда перерисовка ждёт конца переноса
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

	// Уход со страницы (закрытие вкладки, скрытие окна): правленый текст записывается, если канал ещё жив, — только
	// текст, без заполнения полей (commitQueryDraft, 'passive')
	window.addEventListener('pagehide', () => flushQueryEdits('passive'));
	window.addEventListener('blur', () => flushQueryEdits('passive'));
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			flushQueryEdits('passive');
		}
	});

	/** Пауза перепроверки имён после ввода: разбор и проверка не должны идти на каждом символе. */
	const NAME_CHECK_DEBOUNCE_MS = 400;
	/** Сколько предупреждений проверки имён строка под текстом набора показывает поштучно: остальные — числом. */
	const NAME_CHECK_SHOWN = 5;
	/** Перепроверка строки под текстом открытого набора (ответы описаний и дерева); null — строки на экране нет. */
	let nameCheckRefresh = null;
	let nameCheckTimer = 0;

	/**
	 * Ответ описания или дерева мог дать проверке имён недостающее: строка под текстом набора
	 * перепроверяется — одной перепроверкой на пачку ответов, они приходят подряд.
	 */
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
	 * Строка проверки имён по метаданным под текстом набора: неизвестная таблица, поле или алиас — с
	 * номером строки текста. Только предупреждение: сохранению запроса оно не мешает. Пересчёт — по
	 * паузе в наборе и по ответам описаний; текст, который не разбирается, не проверяется. Недостающие
	 * описания запрашиваются только для сохранённого текста: правленый черновик проверяется по тому, что
	 * уже прочитано, иначе каждая пауза в наборе слала бы запросы по недописанным именам таблиц.
	 * savedText — записанный текст набора: поле может открыться с черновиком, и черновик
	 * остаётся черновиком и после перерисовки.
	 */
	function attachNameCheck(box, input, savedText) {
		if (!nameCheckAvailable) {
			return null;
		}
		let saved = typeof savedText === 'string' ? savedText : input.value;
		const line = el('div', 'dcs-query-names');
		// Читалка слышит предупреждения, встав в поле текста; объявлять каждую перепроверку при наборе — шум
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
		// Текст записан без перерисовки вкладки (ответ фоновой записи): он больше не черновик, и проверка просит описания
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

	/**
	 * Кнопка «Конструктор…» набора-запроса. Многостраничный конструктор (dcs-editor-query-dialog.js)
	 * подключается после этого скрипта, поэтому ищется при нажатии, а не при отрисовке.
	 */
	function queryConstructorButton(dataSet, path, queryInput) {
		const construct = el('button', 'ghost-btn dcs-btn-small', 'Конструктор…');
		construct.type = 'button';
		construct.title = 'Конструктор запроса: таблицы и поля по вкладкам, запись текста по ОК.';
		keyed(construct, focusKey(['qbuild', path]));
		construct.addEventListener('click', () => {
			// Конструктор открывается над тем текстом, что в поле; правленый текст до этого уходит в запись:
			// фоновая запись не закрывает окно, а ОК конструктора встаёт в очередь за ней
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

	/** Свойства набора уходят сразу по изменению (set-data-set-props). */
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
			// Ключи свойств: фокус на них переживает перерисовку по ответу правки (и фоновой записи текста запроса)
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
					// Включённое «Автозаполнение» сразу заполняет поля из записанного текста (после ответа на флажок): иначе
					// поля появились бы только после правки текста
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
	 * Флажки ограничений в таблице полей: в шапке — названия целиком, как у
	 * конфигуратора (label; сокращения читались бы как отдельные слова), name — название в подсказке и доступном имени
	 * флажка, смысл — в title заголовка и флажка. Таблица шире окна прокручивается вбок внутри рамки.
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
	 * Проверка пути к данным в ячейке и в окне поля — одна: пустой путь и путь, который уже есть в наборе (без
	 * учёта регистра, как сверяет md-sparrow; смена регистра своего пути разрешена). undefined — путь подходит.
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
	 * Путь к данным, набранный в ячейке и не принятый проверкой или md-sparrow: {text, problem, refused} живут до
	 * исправления или Esc — перерисовка от другой правки их не стирает. refused — путь отклонил md-sparrow: уход из
	 * ячейки его заново не шлёт, Enter — шлёт. Ключ — набор и прежний путь (focusKey).
	 */
	const fieldPathDrafts = new Map();
	let cellErrorCount = 0;

	/** Черновики пути полей, которых в модели больше нет (переименовано окном, удалено, набор переименован). */
	function pruneFieldPathDrafts() {
		for (const draftKey of Array.from(fieldPathDrafts.keys())) {
			const parts = draftKey.split('\n');
			if (dataSetFieldPaths(parts[0]).indexOf(parts.slice(1).join('\n')) < 0) {
				fieldPathDrafts.delete(draftKey);
			}
		}
	}

	/**
	 * Окно с фокусом: щелчок в VS Code вне панели или переход в другое приложение дают полю blur (а то и change), но
	 * правка в ячейке или в тексте запроса от этого не закончена. Без document.hasFocus (заглушки) — окно с фокусом.
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

	/** Правка в строке таблицы: занятый канал откатывает значение и говорит об этом в строке статуса. */
	function sendInline(type, fields, revert) {
		if (send(type, fields)) {
			return true;
		}
		revert();
		setStatus(BUSY, true);
		// Строка состояния — не живая область: отказ слышен читалке так
		announceCompletion(BUSY);
		return false;
	}

	/** Путь из ячейки не ушёл — канал занят: набранное остаётся в ячейке, Enter или уход из неё пошлют его снова. */
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
			// Колонка «Поле» закреплена слева: на узком окне таблица прокручивается вбок внутри своей рамки,
			// а имя поля строки остаётся на виду
			headCell(top, 'Поле', { rowSpan: 2, className: 'dcs-col-pin' });
			for (const title of ['Путь к данным', 'Заголовок', 'Тип']) {
				headCell(top, title, { rowSpan: 2 });
			}
			for (const group of RESTRICTION_GROUPS) {
				headCell(top, group.title, { colSpan: RESTRICTION_COLUMNS.length, className: 'dcs-th-group dcs-col-sep' });
				RESTRICTION_COLUMNS.forEach((column, index) => {
					// Группу читалка называет заголовком над колонками: в своём заголовке колонки — только название
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
			// Стрелки вверх и вниз в поле или флажке ячейки — та же колонка соседней строки, как в таблице
			// конфигуратора; влево и вправо у флажков — соседний флажок строки
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

	/** Строка таблицы полей с остановкой Tab: {set, path} — переживает перерисовку вкладки. */
	let fieldsRowStop = { set: '', path: '' };

	/**
	 * Доступные поля ввода, флажки и кнопки строки таблицы полей (все они — прямые дети своих ячеек). Недоступные
	 * (флажки папки) в обход Tab и так не входят: строка только с ними остановкой не становится.
	 */
	function fieldRowControls(tr) {
		return Array.from(tr.children).flatMap((td) =>
			Array.from(td.children).filter((node) => (node.tagName === 'INPUT' || node.tagName === 'BUTTON') && !node.disabled)
		);
	}

	/**
	 * Одна строка таблицы полей в обходе Tab: у остальных строк поля, флажки и кнопки получают tabIndex −1, и Tab после
	 * последней кнопки строки уходит из таблицы, а не проходит все строки по 13 остановок. Строку меняют стрелки вверх
	 * и вниз (onFieldCellKey) и щелчок — остановка идёт за фокусом.
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
	 * Колонка «Поле» закреплена и непрозрачна: поле ввода, которое лежит под ней (таблица прокручена вбок), браузер не
	 * прокручивает — оно в области прокрутки, только закрыто. Фокус в такое поле сдвигает таблицу так, чтобы оно было видно.
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
	 * Строка поля; nestedSet — набор внутри объединения: тип там виден, но открывается только на просмотр.
	 * Путь к данным, заголовок и флажки ограничений правятся прямо в строке, остальное — в окне поля, его
	 * открывает карандаш.
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
			// ↑ ↓ и на кнопке типа — та же колонка соседней строки (onFieldCellKey), как в полях и флажках
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
			// Кнопки строки — тоже колонки для ↑ ↓: из конца строки в соседнюю без Shift+Tab назад
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
	 * Правка в ячейке уходит по Enter или уходу из поля (change). Enter фокус не снимает: после ответа строка
	 * перерисуется, и фокус вернётся в ту же ячейку. Пока ответ не пришёл, тот же текст второй раз не шлётся:
	 * Enter, а за ним уход из поля дали бы две правки, и вторая получила бы «ещё сохраняется».
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

	/** Заголовок поля в ячейке: пусто — автозаголовок платформы, он виден подсказкой в поле, как в конфигураторе. */
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
			// Канал занят — набранное не откатывается: оно уйдёт по Enter или уходу из ячейки
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
		// Уход в другое окно правку не заканчивает: недописанный заголовок не пишется (windowHasFocus)
		input.addEventListener('change', () => {
			if (windowHasFocus()) {
				commit(input.value.trim());
			}
		});
		// Набранное, перенесённое перерисовкой в новое поле (restoreFocus), change при уходе может не дать: браузер сверяет
		// значение с тем, что было при получении фокуса. Уход из поля коммитит и сам; поле, которое убирает перерисовка, — нет
		input.addEventListener('blur', () => {
			if (!core.renderingContent && input.isConnected && windowHasFocus()) {
				commit(input.value.trim());
			}
		});
		td.appendChild(input);
	}

	/**
	 * Путь к данным в ячейке: тот же dcs/set-field с newDataPath, что и окно поля,
	 * и та же проверка (fieldPathProblem). Отказ проверки виден под полем и связан с ним (aria-invalid,
	 * aria-describedby); набранный текст остаётся для исправления и ничего не уходит. Esc возвращает прежний путь.
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
		// Причина появляется у поля, на котором фокус: описание (aria-describedby) читалка заново не читает, живая область — да
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
				// Канал занят: набранное остаётся в ячейке с причиной под ней (не отказ md-sparrow — уход из ячейки пошлёт
				// его снова). Ожидание ответа другой правки (pendingRename, pendingPathCommit) не трогается
				showProblem(PATH_BUSY);
				return false;
			}
			showProblem('');
			// Ответ перерисует таблицу: ключи строки содержат путь, и фокус ищется под новым
			core.pendingRename = { scope: setName, from: original, to: value };
			core.pendingPathCommit = { draftKey: draftKey, value: value };
			return true;
		});
		/** Конец правки без Enter: путь, который md-sparrow уже отклонил, заново не шлётся; уход в другое окно — не конец. */
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
		// Уход из поля коммитит и сам, как у заголовка (fieldTitleEditor): change после перерисовки может не прийти
		input.addEventListener('blur', () => {
			if (!core.renderingContent && input.isConnected) {
				commitOnLeave();
			}
		});
	}

	/** Строка таблицы, в которой лежит узел ячейки. */
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

	/** Четыре флажка ограничения; правка уходит всем ограничением, как из диалога поля. */
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
					// Новое поле add-field пишет без типа (операция его не принимает): тип — у созданного поля
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
				// Та же проверка, что у пути в ячейке таблицы
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
				// Фокус после ответа вернётся на карандаш строки уже под новым путём
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
	 * Обязательность связи (required) загрузка схемы в платформу 8.3.27 (ibcmd) не хранит ни при каком
	 * составе связи: ни у простой, ни с параметром, списком параметра, условием или выражением начала.
	 * md-sparrow на required=true отказывает, а false снимает элемент. Поэтому колонки и флажка у новой
	 * связи нет; флажок появляется только у связи, где он уже записан в файле, и только чтобы его снять.
	 */
	const LINK_REQUIRED_REASON = 'загрузка схемы в платформу этот флажок не хранит';

	function linkTitle(link) {
		return '«' + (link.source || '') + ' → ' + (link.destination || '') + '»';
	}

	/**
	 * Однозначное имя связи: номер строки таблицы, наборы и выражения. Между одной парой наборов связей
	 * бывает несколько (по разным выражениям), и одной пары «источник → приёмник» мало.
	 */
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

	/** Флажок «Обязательная связь» в окне — только у связи, где он уже записан: снять можно, поставить нельзя. */
	function linkRequiredOffered(link) {
		return Boolean(link) && link.required === true;
	}

	/** Что окно шлёт о флажке: false — только снятие записанного; иначе ничего (true md-sparrow отклонит). */
	function linkRequiredChange(link, checked) {
		return linkRequiredOffered(link) && !checked ? false : undefined;
	}

	/**
	 * Флажок «Список параметров» хранится только вместе с параметром связи: у связи без параметра загрузка схемы в
	 * платформу (8.3.27) отбрасывает и «да», и «нет», а md-sparrow на «да» без параметра отказывает. Поэтому без
	 * параметра флажок в окне снят и недоступен; исключение — «да», уже записанное в файле у связи без параметра: его
	 * окно показывает, чтобы снять.
	 */
	const LINK_LIST_FLAG_REASON = 'без параметра связи загрузка схемы в платформу этот флажок не хранит';

	/** Параметр связи задан: непустой после обрезки пробелов (пустой и из пробелов md-sparrow считает «нет параметра»). */
	function linkParameterSet(parameter) {
		return typeof parameter === 'string' && parameter.trim() !== '';
	}

	/** У связи без параметра записано «да»: флажок в окне — только чтобы снять. */
	function linkListFlagLegacy(link) {
		return Boolean(link) && link.parameterListAllowed === true && !linkParameterSet(link.parameter);
	}

	/**
	 * Доступен ли флажок «Список параметров» при значении поля «Параметр» parameter: с параметром — да; без параметра —
	 * только у связи с записанным «да» без параметра (снять можно, поставить заново — лишь вернуть как было).
	 */
	function linkListFlagOffered(link, parameter) {
		return linkParameterSet(parameter) || linkListFlagLegacy(link);
	}

	/**
	 * Флажок «Список параметров» новой связи: уходит только отмеченный (true) и только с параметром. Снятый не шлётся: у
	 * связи с параметром «нет» (false) пишет сам md-sparrow, как его хранит платформа, а у связи без параметра флага нет.
	 */
	function linkListFlagNew(checked, parameter) {
		return checked && linkParameterSet(parameter) ? true : undefined;
	}

	/**
	 * Что окно правки шлёт о флажке «Список параметров» (undefined — ничего). parameter — поле «Параметр» после правки,
	 * checked — флажок, edited — уходит ли правка других свойств связи.
	 * С параметром: «не задано» и «нет» — одно значение, снятый флажок; отмеченный уходит как true, снятый у записанного
	 * «да» — как false (недостающее «нет» md-sparrow дописывает сам при настоящей правке).
	 * Без параметра true не уходит никогда (загрузка его не хранит, md-sparrow отказывает), а записанный флаг (любой)
	 * убирается null: при снятии параметра; при снятии записанного «да» без параметра (не снятое «да» остаётся, как
	 * флажок «Обязательная связь»); «нет» без параметра — вместе с настоящей правкой связи, так что окно, закрытое без
	 * изменений, файл не меняет.
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

	/** Текст плашки над таблицей связей: у каких связей записано «да» без параметра; пусто — плашки нет. */
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
	 * Строка плашки «Проверить схему» о флажке «Список параметров» без параметра. Связь названа так же, как в таблице и
	 * плашке над ней (linkLabel, номер с единицы); номер в тексте md-sparrow и ключ link считаются с нуля. Если связи с
	 * таким номером в прочитанной модели нет или модель с вердиктом расходится (параметр задан, флага нет, значение флага
	 * не то, что назвал md-sparrow), — текст md-sparrow как есть.
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

	/** Текст плашки над таблицей связей: у каких связей (по linkLabel) записан флажок; пусто — плашки нет. */
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
					// Пометка строки: плашка называет связь номером, а здесь видно, какую строку открыть
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
					// Пометка строки с «да» без параметра: плашка называет связь номером, здесь видно, какую открыть
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
				// Флажок обязательности — только у связи, где он уже записан: снять можно, поставить нельзя
				requiredBox = linkRequiredOffered(link) ? checkbox('Обязательная связь', true) : null;
				checkRow(body, requiredBox ? [listBox, requiredBox] : [listBox]);
				// Флажок списка следует за полем «Параметр»: без параметра — снят и недоступен (кроме записанного «да» без
				// параметра — его можно снять); выбор, сделанный при параметре, возвращается, когда параметр снова задан
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
					// Причина читается экранным диктором вместе с флажком, а не отдельной строкой
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
				// Уходит только снятие: true md-sparrow отклонит, а без правки флажка required не шлётся вовсе
				const required = linkRequiredChange(link, Boolean(requiredBox && requiredBox.input.checked));
				if (required !== undefined) {
					payload.required = required;
				}
				// Флажок списка — последним: «нет», записанное без параметра, убирается только вместе с настоящей правкой
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
				// Новое поле add-calculated-field пишет без типа: операция его не принимает
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

	/**
	 * Состояние закладки «Ресурсы» между перерисовками: дерево доступных полей (выбор, раскрытые ветки), выбранная строка
	 * таблицы ресурсов и признак «вернуть фокус на выбранную строку» (после удаления клавишей Delete в таблице).
	 */
	const resourceUi = { tree: { selected: '', expanded: new Set() }, selected: 0 };

	/** Ресурс считается по полю набора или вычисляемому полю: папку и промежуточный узел пути выбрать нельзя. */
	function resourcePickable(node) {
		return Boolean(node) && (node.kind === 'field' || node.kind === 'calc');
	}

	/** Узлы «Доступных полей» ресурса: поля всех наборов и вычисляемые — каталог подсказки поля ресурса (total-field). */
	function resourceFieldNodes() {
		return completer.buildCatalog(core.model, null, 'total-field', completionTypeOptions()).nodes;
	}

	// Имя говорит, какое выражение запишется: «>» и «>>» пишут файл сразу, без окна
	const RESOURCE_ADD_TITLE = 'Добавить ресурс Сумма(поле) по выбранному полю';
	const RESOURCE_ADD_ALL_TITLE = 'Добавить ресурсы Сумма(поле) по всем числовым полям';
	const RESOURCE_TREE_HINT = 'Enter и двойной щелчок по полю добавляют ресурс Сумма(поле).';
	/** Сколько полей плашка «>>» называет по имени (как проверка имён запроса): дальше — «и ещё N». */
	const RESOURCE_NAMES_SHOWN = 5;
	const RESOURCE_PICK_NOTE = 'Выберите поле в «Доступных полях» (не папку).';
	/** «>>» без полей в дереве: добавить нечего, пока в схеме не появятся поля наборов или вычисляемые. */
	const RESOURCE_NO_FIELDS_NOTE = 'Недоступно: полей нет.';
	/** «>>», пока типы полей ждут описаний объектов: ничего не пишется — деление по недочитанному типу было бы догадкой. */
	const RESOURCE_TYPES_LOADING = 'Типы полей ещё читаются из метаданных. Нажмите «>>» ещё раз через мгновение.';

	/**
	 * Выражение ресурса по умолчанию — Сумма(<путь поля>). Путь вставляется как есть, без
	 * квадратных скобок: помощника «поле в выражении СКД» у редактора нет, подсказка выражений тоже вставляет пути как есть
	 * (пути полей в выгрузках — идентификаторы через точку).
	 */
	function resourceExpression(path) {
		return 'Сумма(' + path + ')';
	}

	/**
	 * Вид типа поля для ресурса: numeric, other, mixed или unknown (DcsFieldTypes.numericKind по строгому типу
	 * resourceFieldType: записанный тип, колонка запроса набора по метаданным; тип известен, только если его знает каждый
	 * набор с этим полем) либо waiting — тип зависит от описаний объектов, которые ещё не прочитаны (они в pending).
	 * type — известный тип (для подписи в предупреждении).
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

	/**
	 * Годится ли путь поля в выражение Сумма(<путь>) как есть (DcsFieldTypes.plainFieldPath: сегменты — идентификаторы,
	 * первый — не слово языка).
	 */
	function resourcePathPlain(path) {
		return fieldTypes.plainFieldPath(path);
	}

	/**
	 * Строки плашки после «>»: что добавлено; если тип поля известен и в нём нет числа — что Сумма по такому полю,
	 * вероятно, сломает формирование отчёта и чем её заменить; если путь в выражении может прочитаться не как поле — что
	 * выражение стоит проверить. Составной тип с числом и неизвестный тип не предупреждаются: Сумма по ним может
	 * считаться. plain — годится ли путь в выражение как есть (resourcePathPlain).
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
	 * Что добавит «>>»: поля дерева «Доступные поля» (поля наборов и вычисляемые, в порядке дерева, без повторов), по
	 * которым ещё нет ресурса, с известным числовым типом. kindOf(узел) — вид типа поля (resourceFieldKind), plainOf(путь)
	 * — годится ли путь в выражение как есть (resourcePathPlain). add — пути полей к добавлению; unknown — поля без
	 * известного типа, unsafe — поля с путём, который выражение может прочитать не как поле (их «>>» пропускает, «>»
	 * добавит); pending — описания объектов, без которых тип ещё не известен (тогда «>>» их ждёт и ничего не пишет). Поля
	 * с известным нечисловым или составным типом в план не входят.
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

	/** Пути полей для плашки: первые RESOURCE_NAMES_SHOWN через запятую, остальные — числом. */
	function resourceNameList(paths) {
		const shown = paths.slice(0, RESOURCE_NAMES_SHOWN).join(', ');
		return paths.length > RESOURCE_NAMES_SHOWN ? shown + ' и ещё ' + (paths.length - RESOURCE_NAMES_SHOWN) : shown;
	}

	/**
	 * Итог «>>» для плашки: какие ресурсы добавлены (или что полей с известным числовым типом без ресурса нет) и какие
	 * поля пропущены — без известного типа и с путём, который выражение может прочитать не как поле. Поля названы по
	 * имени, как в итоге автозаполнения: без имён совет «добавьте кнопкой «>»» не к чему приложить.
	 */
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
	 * Есть ли уже у поля ресурс с тем же выражением (без учёта регистра и пробелов) и пустым «Рассчитывать по»: второй
	 * такой ничего не даёт, а запись сразу в файл отменяется только «<». Ресурс по тому же полю с другим выражением или
	 * своими группировками — не повтор.
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
	 * Плашка итога правки «Ресурсов» после удачного ответа (resourceReply): у «>» строки собираются по модели ответа —
	 * описания, пришедшие, пока правка сохранялась, уже дают предупреждение о нечисловом поле; у «>>» — названные поля
	 * плана. У окна «Новый ресурс» плашки нет (null): итог виден по окну.
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
	 * Отказ пакета «>>» называет ресурс номером операции («Операция 3 (cf-dcs-add-total-field): …» от md-sparrow, «Ресурсы
	 * не добавлены, ресурс 3: …» от проверки панели), а список операций пользователь не видел: номер заменяется полем
	 * плана. Пакет атомарен — не записан ни один ресурс, это и говорит начало текста. Прочие отказы — как есть.
	 */
	function resourceRefusalText(reply, error) {
		const paths = reply && reply.batch ? reply.batch.add : null;
		const match = paths ? /^(?:Операция (\d+) \(cf-dcs-add-total-field\): |Ресурсы не добавлены, ресурс (\d+): )/.exec(String(error || '')) : null;
		const path = match ? paths[Number(match[1] || match[2]) - 1] : undefined;
		return path === undefined ? error : 'Ресурсы не добавлены, ресурс по полю «' + path + '»: ' + String(error).slice(match[0].length);
	}

	/** Есть ли в дереве «Доступные поля» хоть одно поле, по которому можно добавить ресурс. */
	function hasResourceFields(nodes) {
		return nodes.some((node) => resourcePickable(node) || hasResourceFields(Array.isArray(node.children) ? node.children : []));
	}

	/** Повтор клавиши Enter, зажатой на «>» или «>>», не жмёт кнопку снова: каждое нажатие сразу пишет ресурс в файл. */
	function ignoreEnterRepeat(button) {
		button.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && event.repeat) {
				event.preventDefault();
			}
		});
	}

	/**
	 * Закладка «Ресурсы» как в конфигураторе: слева дерево «Доступные поля» (поля наборов и вычисляемые, у вычисляемых —
	 * «f(x)»), посередине кнопки переноса, справа таблица ресурсов «Поле | Выражение | Рассчитывать по…». «>», Enter,
	 * двойной щелчок по полю и перенос поля на таблицу сразу добавляют ресурс Сумма(<поле>), без окна; «>>» — то же по
	 * всем полям с известным числовым типом одним пакетом. «Добавить ресурс…»
	 * открывает пустое окно нового ресурса. «<» и «<<» удаляют выбранный и все ресурсы после подтверждения: правка пишется
	 * в файл сразу, отмены на вкладках схемы нет.
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
			// Перенос мышью: ресурс, брошенный на «Доступные поля», удаляется, как «<» (с вопросом): сначала он выбран,
			// как щелчком, — после ответа и после отмены вопроса выбор не уходит на другой ресурс
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
		// Enter и двойной щелчок по строке пишут ресурс без окна: это сказано подсказкой дерева, а не постоянным текстом
		setHint(tree.element, RESOURCE_TREE_HINT);
		// Типы полей для «>» и «>>» читаются заранее, после отрисовки: к нажатию описания обычно уже в кэше — предупреждение
		// о нечисловом поле и план «>>» не ждут их. Уже запрошенное (вкладкой набора, подсказкой) повторно не шлётся
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
		// Перенос мышью: поле, брошенное в колонку ресурсов, — то же, что «>» (ресурс Сумма(<поле>) сразу, без окна);
		// строку ресурса тащат за ячейку поля обратно на «Доступные поля». Порядка ресурсов операция не знает: новый ресурс
		// встаёт в конец, внутри списка — без сброса
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
			// Удалён последний ресурс — строк нет: фокус на «<», она есть всегда (без ресурсов — недоступна с причиной)
			const row = focusKeys.get(focusKey(['resrow', resourceUi.selected])) || focusKeys.get(focusKey(['resmove', '<']));
			if (row) {
				row.focus();
			}
		}
	}

	/** Канал правок занят: ресурс не отправлен — сказать об этом в строке состояния и читалке (строка — не живая область). */
	function resourceBusy() {
		setStatus(BUSY, true);
		announceCompletion(BUSY);
	}

	/**
	 * «>», Enter, двойной щелчок по полю и перенос поля на таблицу: ресурс Сумма(<поле>) сразу, без окна, — та же правка
	 * dcs/add-total-field, что у «Добавить» окна нового ресурса («Рассчитывать по» пусто — по всем группировкам), и тот же
	 * отказ. Ресурсов по одному полю бывает несколько, но если у поля уже есть ровно такой ресурс (то же выражение, по всем
	 * группировкам), второй не пишется: плашка говорит, что он есть, и как добавить ресурс с другим «Рассчитывать по», —
	 * так лишний ресурс не появится и от случайного повторного нажатия. После ответа выбран новый ресурс, фокус остаётся,
	 * где был (на «>» или строке дерева: их ключи переживают перерисовку), плашка говорит, что добавлено, а у поля с
	 * известным нечисловым типом и у пути, который выражение может прочитать не как поле, — предупреждает. По папке —
	 * подсказка, что выбрать.
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
			// Тип ждёт описаний: ресурс добавляется сразу, а описания читаются — плашка ответа соберётся уже по ним, если
			// они успеют прийти, пока правка сохраняется
			requestDescriptions(typing.pending);
		}
		if (!send('dcs/add-total-field', { payload: { dataPath: node.path, expression: expression } })) {
			resourceBusy();
			return;
		}
		core.resourceReply = { row: list('totalFields').length, add: { path: node.path, kind: node.kind, expression: expression } };
	}

	/**
	 * «>>»: ресурсы Сумма(<поле>) по всем полям с известным числовым типом, по которым ещё нет ресурса, — одним пакетом
	 * dcs/add-total-fields (все или ни одного). Поля без типа и с путём, который выражение может прочитать не как поле,
	 * пропускаются, плашка их называет; пока типы ждут описаний, ничего не пишется. После ответа выбран первый новый
	 * ресурс, фокус остаётся на «>>», плашка называет добавленные; отказ называет поле, а не номер операции пакета.
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
	 * Удаление ресурса после вопроса. from — откуда: 'grid' — клавиша Delete в таблице, 'row' — кнопка «Удалить» строки,
	 * '' — «<» или перенос мышью. После ответа выбор остаётся на том же месте — на следующем ресурсе (последний — на новом
	 * последнем). Фокус на строку ставит только удачный ответ (replyFocus.resources): из таблицы — всегда, с кнопки
	 * последней строки — потому что после ответа её нет (без строк — на «<»). Нажатая «<» фокус сохраняет: её ключ
	 * переживает перерисовку, и повторное нажатие не требует Shift+Tab.
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

	/** «<<»: все ресурсы одним пакетом (dcs/remove-total-fields): частичного удаления не бывает. */
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
	 * Таблица ресурсов — сетка с одной остановкой Tab на строках: строка выбирается щелчком и стрелками (↑ ↓ Home End),
	 * Enter открывает её окно, Delete удаляет. Кнопки строки доступны с клавиатуры только у выбранной строки (как в
	 * сетках конструктора запроса). Многострочное выражение видно в строке целиком: переносы строк сохраняются. Возвращает
	 * для переноса мышью {head — строка шапки, rows — строки, keys — строка → номер ресурса, pick(номер) — выбрать, как
	 * щелчком}; строку тащат за ячейку поля (в строке кнопки).
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
			// Ручка переноса — ячейка поля: у строки только атрибут, слушатели — у документа
			cells[0].draggable = true;
			keys.set(tr, String(index));
			for (const td of cells) {
				td.setAttribute('role', 'gridcell');
			}
			// Имя строки заменяет её ячейки для читалки: в нём все три колонки
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
			// Фокус в кнопку строки пришёл щелчком: остановка Tab переезжает в эту строку
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

	/**
	 * Окно ресурса: правка выбранного и новый ресурс («Добавить ресурс…» — поле и выражение пустые, их вводит
	 * пользователь). Ресурс Сумма(<поле>) без окна добавляет «>» (addResourceFor) той же правкой dcs/add-total-field. Поле,
	 * выбранное в «Доступных полях», окно не подставляет — как «Добавить поле…» в «Настройках».
	 */
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
				// Подсказка — пути полей наборов и вычисляемых полей
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
					// Что значит «ничего не отмечено» — подсказкой у группы флажков, а не абзацем под ней
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
					// Новый ресурс встаёт в конец таблицы: после удачного ответа выбрана его строка (итог виден по окну — без плашки)
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
	 * Список значений параметра схемы, где «Неопределено» стоит рядом с другими значениями. Загрузка схемы в
	 * платформу 8.3.27 (ibcmd) такой элемент отбрасывает и оставляет одни заданные значения (одиночный хранит),
	 * а md-sparrow такой список не пишет; прочитанный из файла показывается с предупреждением, сам список редактор
	 * не правит.
	 */
	function schemaListDropsNil(value) {
		const items = value && value.list && Array.isArray(value.list.items) ? value.list.items : [];
		return items.length > 1 && items.some((item) => Boolean(item && item.value && item.value.nil));
	}

	const SCHEMA_LIST_NIL_WARNING =
		'«Неопределено» рядом с другими значениями списка загрузка схемы в платформу отбрасывает: после загрузки останутся только заданные значения.';

	/** Текст плашки над таблицей параметров: у каких параметров такой список; пусто — плашки нет. */
	function schemaListNilPlate(params) {
		const names = params.filter((param) => schemaListDropsNil(param.valueTyped)).map((param) => '«' + (param.name || '') + '»');
		if (names.length === 0) {
			return '';
		}
		return (names.length === 1 ? 'У параметра ' : 'У параметров ') + names.join(', ') + ' в списке значений ' + SCHEMA_LIST_NIL_WARNING;
	}

	/**
	 * Элементы списка значений параметра схемы старой записи, чьи представления потеряет загрузка: пусто — потерь
	 * нет. Старая запись — список одним значением v8:ValueListType с представлениями элементов; платформа хранит
	 * список повторяющимися значениями без представлений, и загрузка схемы в 8.3.27 (параметр с признаком «Доступен
	 * список значений») такой список разворачивает, а представления молча теряет. Редактор старую запись не
	 * переписывает, а предупреждает. Правило — как у предупреждения valueListPresentationsLost строгой проверки
	 * md-sparrow: признак списка, значение-список и непустое представление хотя бы у одного элемента. У формы
	 * платформы представлений не бывает, поэтому ложного предупреждения правило не даёт; список без представлений
	 * загрузка разворачивает без потерь, а без признака списка редактор о таком списке молчит.
	 */
	function schemaListPresentedItems(value, valueListAllowed) {
		if (valueListAllowed !== true || !value || value.type !== 'v8:ValueListType') {
			return [];
		}
		const items = value.list && Array.isArray(value.list.items) ? value.list.items : [];
		return items.filter((item) => Boolean(item) && typeof item.presentation === 'string' && item.presentation !== '');
	}

	/** Сколько элементов с представлениями называет предупреждение; остальные — числом, как у md-sparrow. */
	const SCHEMA_LIST_NAMED_ITEMS = 3;

	/**
	 * Что будет с таким списком при загрузке и в файле. Значения не теряются — пугать ими незачем. Если среди них
	 * ещё и «Неопределено» рядом с другими (schemaListDropsNil), останутся только заданные: его загрузка отбрасывает,
	 * и «Значения останутся» спорило бы с соседним предупреждением. many — о нескольких списках (плашка).
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
	 * Предупреждение ячейки значения, диалога параметра и окна типа: элементы с представлениями и что с ними
	 * сделает загрузка; пусто — предупреждать не о чем. describe(value) — сводка значения элемента (valueSummary).
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

	/** Текст плашки над таблицей параметров: у каких параметров старый список с представлениями; пусто — плашки нет. */
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
				// Сам параметр в своём выражении не предлагается: у нового — по набранному имени
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
					// Умолчания признаков — как пишет md-sparrow: отсутствие в файле — умолчание
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
					// Имена параметров в запросе регистра не различают: «размер» и «Размер» — один параметр
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
					// Как при добавлении — без учёта регистра; смена регистра своего же имени не занимает чужое
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
