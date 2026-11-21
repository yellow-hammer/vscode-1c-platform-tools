(function () {
	'use strict';
	const vscode = acquireVsCodeApi();
	let model = withTypeCompositions(window.__INITIAL_DATA__ || {});
	const tabsRoot = document.getElementById('tabs');
	const contentRoot = document.getElementById('content');
	const statusEl = document.getElementById('status');
	const pageEl = document.getElementById('page');
	const dialogBackdrop = document.getElementById('dialogBackdrop');
	const dialogBoxEl = document.getElementById('dialogBox');
	const dialogTitleEl = document.getElementById('dialogTitle');
	const dialogBodyEl = document.getElementById('dialogBody');
	const dialogErrorEl = document.getElementById('dialogError');
	const dialogActionsEl = document.getElementById('dialogActions');
	const dialogOkBtn = document.getElementById('dialogOk');
	const dialogCancelBtn = document.getElementById('dialogCancel');
	const noticeEl = document.getElementById('notice');
	const validateBtn = document.getElementById('validateBtn');
	let saving = false;
	/**
	 * Фоновая запись текста запроса по концу правки {key, text, autofill, stage: 'text' | 'fill'} или null. Её ответ
	 * не закрывает окна и не пишет отказ в окно.
	 */
	let background = null;
	/** Правка пользователя во время фоновой записи: уходит следом за ней. */
	let deferred = null;
	/**
	 * Окно, из которого ушла правка в полёте, или null для страницы. Удачный ответ закрывает окна, только если оно ещё
	 * открыто; отказ пишется в окно, только если правка ушла из него.
	 */
	let editOrigin = null;
	/** Проверка схемы в полёте: повторный запрос не шлётся, пока не пришёл ответ validation. */
	let validating = false;
	/** Набор, который выбрать после ответа правки: новый или переименованный. */
	let pendingDataSet = '';
	/** Путь из ячейки, ждущий ответа {draftKey, value}: отказ покажется под ячейкой. */
	let pendingPathCommit = null;

	/**
	 * Итог правки ресурсов для ответа saved. row: строка, которую выбрать (новый ресурс встаёт в конец); add {path, kind,
	 * expression}: ресурс «>»; batch {add, unknown, unsafe}: план «>>»; без них: окно «Новый ресурс» без плашки. Отказ
	 * итог сбрасывает.
	 */
	let resourceReply = null;
	/** Вариант правки в полёте: если ответ saved не принёс его настройки, кэш сбрасывается. */
	let pendingVariant = '';
	/** Путь узла, который выделить после удачной правки структуры. */
	let pendingSelect = null;

	const BUSY = 'Предыдущая правка ещё сохраняется.';

	/** Открытая закладка: id из реестра TABS. */
	let activeTabId = 'dataSets';
	/** Строка под полем набора {key, repaint, rebase(text)}; rebase сверяет имена с записанным текстом. */
	let queryStatusRefresh = null;
	/** Идёт перерисовка вкладки: blur убираемого поля не считается концом правки. */
	let renderingContent = false;

	function list(key) {
		return Array.isArray(model[key]) ? model[key] : [];
	}

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) {
			node.className = className;
		}
		if (text !== undefined && text !== '') {
			node.textContent = text;
		}
		return node;
	}

	/**
	 * Имя с местами переноса на границах слов: перед заглавной после строчной или цифры и после «.,;(_». Переносы
	 * ставятся элементами wbr, поэтому текст узла и копирование дают имя целиком.
	 */
	function setNameText(node, text) {
		const parts = String(text).split(/(?<=[a-zа-яё\d])(?=[A-ZА-ЯЁ])|(?<=[.,;(_])(?=[^\s.,;)])/u);
		node.textContent = parts.length > 1 ? '' : parts[0];
		for (let index = 1; index < parts.length; index++) {
			if (index === 1) {
				node.appendChild(document.createTextNode(parts[0]));
			}
			node.appendChild(document.createElement('wbr'));
			node.appendChild(document.createTextNode(parts[index]));
		}
		return node;
	}

	/** Как el, но текст ставит setNameText. */
	function nameEl(tag, className, text) {
		const node = el(tag, className);
		if (text !== undefined && text !== null && text !== '') {
			setNameText(node, text);
		}
		return node;
	}

	/** Пояснение к элементу: подсказка и aria-description, потому что одного title экранный диктор не читает. */
	function setHint(node, text) {
		node.title = text;
		node.setAttribute('aria-description', text);
		return node;
	}

	function emptyNote(host, text) {
		host.appendChild(el('div', 'empty', text));
	}

	function setStatus(text, isError) {
		statusEl.textContent = text;
		statusEl.classList.toggle('save-status-error', Boolean(isError));
	}

	/**
	 * Шлёт правку панели; false, если предыдущая правка ещё не ответила. Во время фоновой записи текста запроса одна
	 * правка встаёт в очередь: щелчок сразу после ухода из поля запроса не должен получать отказ.
	 */
	function send(type, fields) {
		const origin = editSource();
		if (saving) {
			if (background && !deferred) {
				deferred = { type: type, fields: fields || {}, origin: origin };
				return true;
			}
			return false;
		}
		postEdit(type, fields);
		editOrigin = origin;
		return true;
	}

	/** Откуда уходит правка: верхнее окно стека или страница (null). */
	function editSource() {
		return dialogStack.depth() > 0 ? dialogStack.top() : null;
	}

	/** Отправка правки без проверки занятости. */
	function postEdit(type, fields) {
		saving = true;
		editOrigin = null;
		pendingVariant = affectedVariant(type, fields || {});
		setStatus('Сохраняем…', false);
		vscode.postMessage(Object.assign({ type: type }, fields || {}));
	}

	/** Новая правка сейчас получила бы отказ «ещё сохраняется». */
	function editBusy() {
		return saving && !(background && !deferred);
	}

	/** Шлёт панели сообщение-чтение без блокировки правок (ленивая загрузка варианта). */
	function post(type, fields) {
		vscode.postMessage(Object.assign({ type: type }, fields || {}));
	}

	function kindLabel(type) {
		if (type === 'query') {
			return 'Запрос';
		}
		if (type === 'object') {
			return 'Объект';
		}
		if (type === 'union') {
			return 'Объединение';
		}
		return '';
	}

	function dataSetNames() {
		return list('dataSets')
			.map((dataSet) => dataSet.name || '')
			.filter(Boolean);
	}

	/**
	 * Имя занято без учёта регистра, как сверяет md-sparrow. own: прежнее имя переименовываемого, смена регистра
	 * своего имени не считается занятием.
	 */
	function nameTaken(names, name, own) {
		const key = String(name).toLowerCase();
		return names.some((taken) => taken !== own && String(taken).toLowerCase() === key);
	}

	/** Пути полей набора верхнего уровня (и папок): среди них уникален путь нового или переименованного поля. */
	function dataSetFieldPaths(setName) {
		const dataSet = list('dataSets').find((item) => item && item.name === setName);
		return (dataSet && Array.isArray(dataSet.fields) ? dataSet.fields : []).map((field) => field.dataPath || '').filter(Boolean);
	}

	function calculatedFieldPaths() {
		return list('calculatedFields')
			.map((field) => field.name || '')
			.filter(Boolean);
	}

	/** Пути всех полей схемы: подсказки для ресурсов и список группировок «рассчитывать по». */
	function fieldPaths() {
		const paths = [];
		function collect(dataSet) {
			for (const field of Array.isArray(dataSet.fields) ? dataSet.fields : []) {
				if (field.dataPath && field.kind !== 'folder' && field.kind !== 'nested') {
					paths.push(field.dataPath);
				}
			}
			for (const item of Array.isArray(dataSet.items) ? dataSet.items : []) {
				collect(item);
			}
		}
		for (const dataSet of list('dataSets')) {
			collect(dataSet);
		}
		for (const field of list('calculatedFields')) {
			if (field.name) {
				paths.push(field.name);
			}
		}
		const unique = [];
		for (const path of paths) {
			if (unique.indexOf(path) < 0) {
				unique.push(path);
			}
		}
		return unique.sort((a, b) => a.localeCompare(b, 'ru'));
	}

	function suggestName(base, taken) {
		let index = 1;
		while (taken.indexOf(base + index) >= 0) {
			index += 1;
		}
		return base + index;
	}

	// ---------- стек диалогов ----------

	/** Решения стека (dcs-editor-dialogs.js): порядок уровней, Escape, Tab, возврат фокуса. */
	const dialogRules = window.DcsDialogs;
	const dialogStack = dialogRules.createStack();
	/** Счётчик id заголовков вложенных окон: aria-labelledby требует id, уникальный в документе. */
	let dialogSerial = 0;

	/** Открытый список подсказки {isOpen(), close()}: Escape закрывает сначала его, а не окно. */
	let escapePopup = null;

	/** Кандидаты в остановки Tab; скрытые и отключённые отсеивает isTabStop. */
	const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

	/** Каркас уровня 1 из разметки шаблона (dcs-editor.html); вложенные уровни собирает скрипт. */
	const baseShell = {
		root: dialogBackdrop,
		box: dialogBoxEl,
		titleEl: dialogTitleEl,
		bodyEl: dialogBodyEl,
		errorEl: dialogErrorEl,
		actionsEl: dialogActionsEl,
		buttonEls: {},
		level: null,
		nested: false,
		// Ключ нарисованного заголовка (paintDialogTitle)
		titleKey: null,
	};
	registerDialogButton(baseShell, 'ok', dialogOkBtn);
	registerDialogButton(baseShell, 'cancel', dialogCancelBtn);

	function registerDialogButton(shell, id, button) {
		shell.buttonEls[id] = button;
		button.addEventListener('click', () => {
			pressDialogButton(shell, id);
		});
	}

	/** Каркас вложенного уровня: та же структура, что у разметки уровня 1, но без её id. */
	function createDialogShell() {
		dialogSerial += 1;
		const root = el('div', 'dcs-dialog-backdrop dcs-dialog-nested');
		const box = el('div', 'dcs-dialog');
		box.setAttribute('role', 'dialog');
		box.setAttribute('aria-modal', 'true');
		box.tabIndex = -1;
		const titleEl = el('div', 'dcs-dialog-title');
		titleEl.id = 'dcsDialogTitle' + dialogSerial;
		box.setAttribute('aria-labelledby', titleEl.id);
		const bodyEl = el('div', 'dcs-dialog-body');
		const errorEl = el('div', 'dcs-dialog-error');
		errorEl.setAttribute('aria-live', 'polite');
		const actionsEl = el('div', 'dcs-dialog-actions');
		box.appendChild(titleEl);
		box.appendChild(bodyEl);
		box.appendChild(errorEl);
		box.appendChild(actionsEl);
		root.appendChild(box);
		return {
			root: root,
			box: box,
			titleEl: titleEl,
			bodyEl: bodyEl,
			errorEl: errorEl,
			actionsEl: actionsEl,
			buttonEls: {},
			level: null,
			nested: true,
			titleKey: null,
		};
	}

	/**
	 * Подвал по описанию кнопок. Кнопки переиспользуются по id, чтобы смена подписи не сбивала фокус; узлы
	 * переставляются, только если сменился состав.
	 */
	function renderDialogButtons(shell, buttons) {
		const active = document.activeElement;
		const wanted = buttons.map((button) => {
			let node = shell.buttonEls[button.id];
			if (!node) {
				node = el('button', '');
				node.type = 'button';
				registerDialogButton(shell, button.id, node);
			}
			node.className = button.primary ? 'primary-btn' : 'ghost-btn';
			node.textContent = button.label;
			node.disabled = button.disabled;
			// Недоступная, но фокусируемая кнопка: читалка слышит «недоступно», Tab её не теряет
			if (button.unavailable) {
				node.setAttribute('aria-disabled', 'true');
			} else {
				node.removeAttribute('aria-disabled');
			}
			return node;
		});
		const current = Array.from(shell.actionsEl.children);
		const same = current.length === wanted.length && wanted.every((node, index) => current[index] === node);
		if (same) {
			return;
		}
		shell.actionsEl.textContent = '';
		for (const node of wanted) {
			shell.actionsEl.appendChild(node);
		}
		// Перенос узла снимает с него фокус
		if (active && wanted.indexOf(active) >= 0 && document.activeElement !== active) {
			active.focus();
		}
	}

	function pressDialogButton(shell, id) {
		const level = shell.level;
		// Подвал нижнего окна неактивен: отвечает только верхний уровень
		if (!level || level !== dialogStack.top()) {
			return;
		}
		const button = level.buttons.find((candidate) => candidate.id === id);
		// aria-disabled браузер не соблюдает сам: щелчок и Enter по такой кнопке доходят сюда
		if (!button || button.disabled || button.unavailable) {
			return;
		}
		if (!button.onClick) {
			cancelDialogLevel(level);
			return;
		}
		const result = button.onClick(level);
		// Обработчик мог закрыть окно или открыть другое на том же каркасе
		if (shell.level === level) {
			shell.errorEl.textContent = dialogRules.clickError(result);
		}
	}

	/**
	 * Заголовок уровня: текст, видимый знак «*» изменённого окна и скрытые слова для читалки, потому что aria-hidden
	 * знак в имя окна по aria-labelledby не входит. Перерисовывается только при смене.
	 */
	function paintDialogTitle(shell, parts) {
		const key = parts.text + '\u0000' + parts.mark;
		if (shell.titleKey === key) {
			return;
		}
		shell.titleKey = key;
		shell.titleEl.textContent = parts.text;
		if (!parts.mark) {
			return;
		}
		const mark = el('span', 'dcs-dialog-modified', ' ' + parts.mark);
		mark.setAttribute('aria-hidden', 'true');
		shell.titleEl.appendChild(mark);
		shell.titleEl.appendChild(el('span', 'dcs-dialog-modified-spoken', ' (' + parts.spoken + ')'));
	}

	/**
	 * Открывает уровень поверх открытых. spec: {title, width: normal|wide|full, build(body, level),
	 * buttons: [{id, label, primary?, disabled?, unavailable?, onClick?(level)}], onCancel?(level),
	 * onClose?(level), returnFocus?}. Кнопка без onClick отменяет уровень; строка из onClick показывается
	 * ошибкой; unavailable: недоступна, но фокусируема. onCancel, вернувший false, оставляет окно открытым.
	 * Возвращает уровень {body, setTitle(text, modified?), setError, setButtons, close, isOpen}.
	 */
	function pushDialog(spec) {
		const normalized = dialogRules.normalizeSpec(spec);
		if (!dialogRules.canPush(dialogStack.depth())) {
			throw new Error('Диалог: открыто слишком много окон подряд.');
		}
		const active = document.activeElement;
		const shell = dialogStack.depth() === 0 ? baseShell : createDialogShell();
		const level = {
			shell: shell,
			body: shell.bodyEl,
			buttons: normalized.buttons,
			onCancel: normalized.onCancel,
			onClose: normalized.onClose,
			// Вызвавший элемент: на него вернётся фокус, когда окно закроется
			returnFocus: normalized.returnFocus || (active && active !== document.body ? active : null),
			setTitle: function (text, modified) {
				// Каркас уровня 1 переиспользуется: закрытый уровень не должен переписать заголовок нового окна
				if (shell.level === level) {
					paintDialogTitle(shell, dialogRules.titleParts(text || '', Boolean(modified)));
				}
			},
			setError: function (text) {
				if (shell.level === level) {
					shell.errorEl.textContent = text || '';
				}
			},
			setButtons: function (buttons) {
				level.buttons = dialogRules.normalizeButtons(buttons);
				if (shell.level === level) {
					renderDialogButtons(shell, level.buttons);
				}
			},
			close: function () {
				closeDialogLevels(dialogStack.indexOf(level));
			},
			isOpen: function () {
				return dialogStack.indexOf(level) >= 0;
			},
		};
		dialogStack.push(level);
		shell.level = level;
		// Ключ сбрасывается: заголовок нового окна пишется всегда, даже если совпал с прежним
		shell.titleKey = null;
		paintDialogTitle(shell, dialogRules.titleParts(normalized.title, false));
		shell.bodyEl.textContent = '';
		shell.errorEl.textContent = '';
		shell.box.classList.toggle('dcs-dialog-wide', normalized.width === 'wide');
		shell.box.classList.toggle('dcs-dialog-full', normalized.width === 'full');
		renderDialogButtons(shell, level.buttons);
		if (shell.nested) {
			document.body.appendChild(shell.root);
		} else {
			shell.root.classList.remove('hidden');
		}
		if (normalized.build) {
			try {
				normalized.build(shell.bodyEl, level);
			} catch (error) {
				// Недостроенное окно оставило бы страницу неактивной
				closeDialogLevels(dialogStack.indexOf(level));
				throw error;
			}
		}
		if (!level.isOpen()) {
			return level;
		}
		// Фокус ставится до inert и aria-hidden нижних уровней: на предке элемента с фокусом
		// браузер aria-hidden отклоняет
		if (!shell.box.contains(document.activeElement)) {
			focusDialogDefault(level);
		}
		applyDialogStates();
		return level;
	}

	/** Отмена пользователем (Escape, «Отмена»): onCancel может удержать окно, вернув false. */
	function cancelDialogLevel(level) {
		if (level.onCancel && !dialogRules.cancelAllowed(level.onCancel(level))) {
			return;
		}
		closeDialogLevels(dialogStack.indexOf(level));
	}

	/** Закрывает уровень index и всё над ним, затем возвращает фокус и активность оставшимся. */
	function closeDialogLevels(index) {
		if (index < 0 || index >= dialogStack.depth()) {
			return;
		}
		const active = document.activeElement;
		let focusLeft = !active || active === document.body;
		for (let position = index; position < dialogStack.depth(); position += 1) {
			if (dialogStack.at(position).shell.root.contains(active)) {
				focusLeft = true;
			}
		}
		const closed = dialogStack.truncate(index);
		for (const level of closed) {
			teardownDialogShell(level.shell);
		}
		applyDialogStates();
		restoreDialogFocus(closed, focusLeft);
		// onClose после разборки: обработчик может открыть новое окно
		for (const level of closed) {
			if (level.onClose) {
				level.onClose(level);
			}
		}
	}

	function teardownDialogShell(shell) {
		// blur у удалённого узла браузер не обещает
		closeCompletionWithin(shell.root);
		// Список подсказки нужен и дальше: вернуть его на body до разборки окна
		releaseCompletionHost(shell.box);
		shell.level = null;
		shell.bodyEl.textContent = '';
		shell.errorEl.textContent = '';
		if (shell.nested) {
			shell.root.remove();
			return;
		}
		shell.root.classList.add('hidden');
		shell.box.classList.remove('dcs-dialog-wide', 'dcs-dialog-full');
		setDialogInert(shell.root, false);
	}

	/** Нижние уровни и страница под стеком неактивны и скрыты от читалок. */
	function applyDialogStates() {
		const states = dialogRules.levelStates(dialogStack.depth());
		setDialogInert(pageEl, states.pageInert);
		states.levels.forEach((state, index) => {
			const shell = dialogStack.at(index).shell;
			shell.root.style.zIndex = String(state.zIndex);
			setDialogInert(shell.root, state.inert);
		});
	}

	function setDialogInert(node, inert) {
		node.inert = inert;
		if (inert) {
			node.setAttribute('aria-hidden', 'true');
		} else {
			node.removeAttribute('aria-hidden');
		}
	}

	function restoreDialogFocus(closed, focusLeft) {
		// Вкладку под окном могла перерисовать фоновая запись: вызвавший узел заменён преемником с тем же ключом
		for (const level of closed) {
			level.returnFocus = liveFocusNode(level.returnFocus);
		}
		const top = dialogStack.top();
		const decision = dialogRules.focusAfterClose(
			closed,
			focusLeft,
			(node) => dialogFocusUsable(node, top),
			dialogStack.depth()
		);
		if (decision.kind === 'element') {
			decision.element.focus();
		} else if (decision.kind === 'top') {
			focusDialogDefault(top);
		}
	}

	/** Преемник узла, убранного перерисовкой, по ключу data-dcs-key; иначе сам узел. */
	function liveFocusNode(node) {
		if (!node || node.isConnected || typeof node.getAttribute !== 'function') {
			return node;
		}
		const key = node.getAttribute('data-dcs-key');
		return (key && focusTarget(key)) || node;
	}

	/** Вызвавший элемент жив и лежит в активной части: в верхнем окне или на странице без окон. */
	function dialogFocusUsable(node, top) {
		if (!node || typeof node.focus !== 'function' || node.disabled) {
			return false;
		}
		return (top ? top.shell.box : document.body).contains(node);
	}

	/** Фокус по умолчанию: первое поле формы, иначе само окно. */
	function focusDialogDefault(level) {
		const first = level.shell.bodyEl.querySelector('input, select, textarea');
		(first || level.shell.box).focus();
	}

	function isTabStop(node) {
		if (node.disabled || node.tabIndex < 0) {
			return false;
		}
		// Свёрнутые и скрытые блоки браузер тоже пропускает
		return node.getClientRects().length > 0;
	}

	/** Tab не уходит из верхнего окна: на краях обход заворачивается. */
	function trapDialogTab(event) {
		const box = dialogStack.top().shell.box;
		const stops = Array.from(box.querySelectorAll(FOCUSABLE)).filter(isTabStop);
		const decision = dialogRules.tabTarget(stops.length, stops.indexOf(document.activeElement), event.shiftKey);
		if (!decision.prevent) {
			return;
		}
		event.preventDefault();
		(decision.index >= 0 ? stops[decision.index] : box).focus();
	}

	/** Диалог уровня 1 с подвалом «okLabel / Отмена»; открытие заменяет все окна. */
	function openBaseDialog(width, title, okLabel, build, onSubmit) {
		closeDialogLevels(0);
		return pushDialog({
			title: title,
			width: width,
			build: build,
			buttons: [
				// Пока предыдущая правка сохраняется, нажатие не шлёт вторую и не трогает строку ошибки
				{
					id: 'ok',
					label: okLabel,
					primary: true,
					onClick: (level) => (editBusy() ? level.shell.errorEl.textContent : onSubmit()),
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	function openDialog(title, okLabel, build, onSubmit) {
		return openBaseDialog('normal', title, okLabel, build, onSubmit);
	}

	/** Широкий диалог для форм с таблицами внутри (условное оформление). */
	function openWideDialog(title, okLabel, build, onSubmit) {
		return openBaseDialog('wide', title, okLabel, build, onSubmit);
	}

	/** Закрывает все окна: после сохранения модель перечитана целиком. */
	function closeDialog() {
		closeDialogLevels(0);
	}

	function dialogOpen() {
		return dialogStack.depth() > 0;
	}

	/** Подтверждение удаления: мини-диалог вместо window.confirm (в webview он отключён). */
	function confirmRemove(question, submit) {
		openDialog(
			'Удаление',
			'Удалить',
			(body) => {
				body.appendChild(el('div', 'dcs-confirm-text', question));
			},
			submit
		);
	}

	document.addEventListener('keydown', (event) => {
		// Esc во время переноса отменяет перенос, а не окно: окно закроет следующий Esc
		if (event.key === 'Escape' && dragNow) {
			event.preventDefault();
			finishDrag(false, true);
			return;
		}
		// Набор через IME и клавиши, уже обработанные полем, окна не закрывают
		if (event.defaultPrevented || event.isComposing) {
			return;
		}
		if (event.key === 'Escape') {
			const action = dialogRules.escapeAction(dialogStack.depth(), Boolean(escapePopup && escapePopup.isOpen()));
			if (action === 'popup') {
				event.preventDefault();
				escapePopup.close();
			} else if (action === 'level') {
				event.preventDefault();
				cancelDialogLevel(dialogStack.top());
			}
			return;
		}
		if (event.key === 'Tab' && dialogOpen()) {
			trapDialogTab(event);
		}
	});

	// ---------- элементы форм ----------

	function formRow(host, labelText, control) {
		const row = el('div', 'dcs-form-row');
		const label = el('label', 'dcs-form-label', labelText);
		row.appendChild(label);
		row.appendChild(control);
		host.appendChild(row);
		return control;
	}

	function groupTitle(host, text) {
		host.appendChild(el('div', 'dcs-form-group', text));
	}

	function textInput(value) {
		const input = el('input', 'edit-input');
		input.type = 'text';
		input.value = value || '';
		return input;
	}

	function numberInput(value) {
		const input = el('input', 'edit-input dcs-input-number');
		input.type = 'number';
		input.min = '1';
		input.step = '1';
		input.value = typeof value === 'number' && value > 0 ? String(value) : '';
		return input;
	}

	function selectInput(options, value) {
		const select = el('select', 'edit-input');
		for (const option of options) {
			const node = document.createElement('option');
			node.value = option.value;
			node.textContent = option.label;
			select.appendChild(node);
		}
		select.value = value;
		return select;
	}

	function checkbox(labelText, checked) {
		const wrap = el('label', 'dcs-check');
		const input = el('input', 'edit-check');
		input.type = 'checkbox';
		input.checked = Boolean(checked);
		wrap.appendChild(input);
		wrap.appendChild(el('span', '', labelText));
		return { wrap: wrap, input: input };
	}

	function checkRow(host, boxes) {
		const row = el('div', 'dcs-check-row');
		for (const box of boxes) {
			row.appendChild(box.wrap);
		}
		host.appendChild(row);
	}

	// ---------- перетаскивание: чистые правила ----------

	/**
	 * Тип данных переноса строк редактора. Сброс без него зоны не принимают: оболочка webview отменяет dragover и drop
	 * на всём документе.
	 */
	const DRAG_TYPE = 'application/x-dcs-row';

	/**
	 * Место сброса относительно строки под указателем: offset от её верха, size её высота. mode: 'line' до или после
	 * по половинам; 'into' в строку; 'both' края по четверти до и после, середина в строку; 'zone' в конец списка.
	 */
	function dropPlace(offset, size, mode) {
		if (mode === 'zone') {
			return 'end';
		}
		if (mode === 'into') {
			return 'into';
		}
		const share = size > 0 ? Math.min(Math.max(offset / size, 0), 1) : 0;
		if (mode === 'both') {
			return share < 0.25 ? 'before' : share >= 0.75 ? 'after' : 'into';
		}
		return share < 0.5 ? 'before' : 'after';
	}

	/**
	 * Номер, на котором окажется элемент списка из count элементов. from: номер сейчас или -1 для нового; target: номер
	 * строки сброса или -1 для конца; place: 'before' | 'after'. Номер считается после изъятия элемента.
	 */
	function dropIndex(count, from, target, place) {
		const moving = from >= 0 && from < count;
		let to = target < 0 || target >= count ? count : place === 'after' ? target + 1 : target;
		if (moving && from < to) {
			to -= 1;
		}
		return Math.max(0, Math.min(to, moving ? count - 1 : count));
	}

	/**
	 * Принимает ли зона перенос: у неё есть обработчик для зоны-источника (zone.from[id]), перенос начат в том же окне
	 * (scope) и, если задано, проходит своё правило зоны accept(payload).
	 */
	function dropAccepted(zone, payload) {
		if (!zone || !payload || !zone.from || !Object.prototype.hasOwnProperty.call(zone.from, payload.zone)) {
			return false;
		}
		if (typeof zone.from[payload.zone] !== 'function' || zone.scope !== payload.scope) {
			return false;
		}
		return typeof zone.accept === 'function' ? Boolean(zone.accept(payload)) : true;
	}

	/**
	 * Вид места сброса: zone.place или правило по переносу и ключу строки под указателем (null, если строки нет); по
	 * умолчанию 'line'.
	 */
	function dropMode(zone, payload, key) {
		const mode = typeof zone.place === 'function' ? zone.place(payload, key === undefined ? null : key) : zone.place;
		return mode === 'into' || mode === 'both' || mode === 'zone' ? mode : 'line';
	}

	/** Принимает ли строка под указателем перенос по правилу zone.rowAccept(payload, key); без правила любая. */
	function dropRowAccepted(zone, payload, key) {
		return typeof zone.rowAccept === 'function' ? Boolean(zone.rowAccept(payload, key)) : true;
	}

	/** Курсор сброса: 'copy', если значение остаётся в источнике, иначе 'move'. */
	function dropEffect(zone, payload) {
		const effect = typeof zone.effect === 'function' ? zone.effect(payload) : zone.effect;
		return effect === 'copy' ? 'copy' : 'move';
	}

	/** Есть ли свой тип среди DataTransfer.types (массив или DOMStringList). */
	function hasDragType(types) {
		return Boolean(types) && Array.prototype.indexOf.call(types, DRAG_TYPE) >= 0;
	}

	/*
	 * Правки дерева элементов списка настроек по месту сброса: поля с папками, отбор с группами, сортировка. Чистые, на
	 * копии. Адрес элемента: номера по уровням ([1, 0] первый элемент в папке второй строки).
	 */

	/** Список уровня по адресу владельца ([] для верхнего); у владельца без вложений список создаётся. */
	function itemsLevel(items, parent) {
		let level = items;
		for (const index of parent) {
			const owner = level[index];
			if (!Array.isArray(owner.items)) {
				owner.items = [];
			}
			level = owner.items;
		}
		return level;
	}

	/**
	 * Куда встанет элемент: {parent: адрес владельца, index: номер вставки до изъятия переносимого}. target: адрес
	 * строки сброса или null для конца верхнего уровня; place: 'before' | 'after' | 'into' (последним) | 'end'.
	 */
	function itemsDropSlot(items, target, place) {
		if (!target || target.length === 0 || place === 'end') {
			return { parent: [], index: items.length };
		}
		if (place === 'into') {
			let level = items;
			for (const index of target) {
				const owner = level[index];
				level = owner && Array.isArray(owner.items) ? owner.items : [];
			}
			return { parent: target.slice(), index: level.length };
		}
		const last = target[target.length - 1];
		return { parent: target.slice(0, -1), index: place === 'after' ? last + 1 : last };
	}

	/** Вставляет новый элемент в место slot: {items: копия дерева, pos: его адрес}. */
	function itemsInsert(items, slot, fresh) {
		const next = JSON.parse(JSON.stringify(items));
		const level = itemsLevel(next, slot.parent);
		const index = Math.max(0, Math.min(slot.index, level.length));
		level.splice(index, 0, fresh);
		return { items: next, pos: slot.parent.concat([index]) };
	}

	/**
	 * Перенос элемента с адреса from в место slot: {items: копия дерева, pos: новый адрес}; null, если место то же или
	 * папку бросили в неё саму или во вложенную.
	 */
	function itemsMove(items, from, slot) {
		const depth = from.length - 1;
		if (slot.parent.length >= from.length && from.every((index, at) => slot.parent[at] === index)) {
			return null;
		}
		const next = JSON.parse(JSON.stringify(items));
		const moved = itemsLevel(next, from.slice(0, -1)).splice(from[depth], 1)[0];
		// Адрес места после изъятия: на уровне переносимого строки за ним поднялись на одну
		const parent = slot.parent.slice();
		let index = slot.index;
		if (from.slice(0, -1).every((value, at) => parent[at] === value)) {
			if (parent.length > depth && parent[depth] > from[depth]) {
				parent[depth] -= 1;
			} else if (parent.length === depth && index > from[depth]) {
				index -= 1;
			}
		}
		const level = itemsLevel(next, parent);
		index = Math.max(0, Math.min(index, level.length));
		const pos = parent.concat([index]);
		if (pos.length === from.length && pos.every((value, at) => value === from[at])) {
			return null;
		}
		level.splice(index, 0, moved);
		return { items: next, pos: pos };
	}

	/** Элемент по адресу без правки дерева или null. */
	function itemAtPos(items, pos) {
		let level = items;
		let item = null;
		for (const index of pos) {
			item = Array.isArray(level) ? level[index] || null : null;
			if (!item) {
				return null;
			}
			level = item.items;
		}
		return item;
	}

	/**
	 * Место сброса так, как его показывает линия: папки и группы раскрыты, и линия «после» непустой папки идёт над первой
	 * вложенной строкой, поэтому элемент встаёт в неё первым. container(элемент): папка или группа.
	 */
	function listDropSlot(items, target, place, container) {
		if (place === 'after' && target && target.length > 0 && typeof container === 'function') {
			const owner = itemAtPos(items, target);
			if (owner && container(owner) && Array.isArray(owner.items) && owner.items.length > 0) {
				return { parent: target.slice(), index: 0 };
			}
		}
		return itemsDropSlot(items, target, place);
	}

	/**
	 * «Вынести из папки (группы)»: место сразу за её строкой на уровень выше; null для верхнего уровня. Команды уровня
	 * дают клавиатуре то же, что перенос мышью (WCAG 2.5.7).
	 */
	function itemsOutdentSlot(items, pos) {
		if (!pos || pos.length < 2) {
			return null;
		}
		return { parent: pos.slice(0, -2), index: pos[pos.length - 2] + 1 };
	}

	/**
	 * «В папку (группу) выше»: последним в соседнюю папку прямо над строкой; null, если над строкой не папка или строка
	 * первая.
	 */
	function itemsIndentSlot(items, pos, container) {
		if (!pos || pos.length === 0 || pos[pos.length - 1] === 0) {
			return null;
		}
		const above = pos.slice(0, -1).concat([pos[pos.length - 1] - 1]);
		const owner = itemAtPos(items, above);
		if (!owner || typeof container !== 'function' || !container(owner)) {
			return null;
		}
		return { parent: above, index: Array.isArray(owner.items) ? owner.items.length : 0 };
	}

	// ---------- перетаскивание: обвязка событий ----------

	/*
	 * Перенос мышью дополняет кнопки, двойной щелчок и клавиши (WCAG 2.5.7): сброс зовёт то же действие, что кнопка.
	 * Пока никто не тащит, у строк только атрибут draggable, слушатели висят на документе, а зона: запись WeakMap от
	 * контейнера к описанию. Во время переноса место и подсветка считаются раз в кадр. Ответы расширения ждут конца
	 * переноса (whenIdle): перерисовка не уберёт строку из-под указателя, а сброс сработает по той модели, которую
	 * видел пользователь.
	 */

	/** Контейнер списка → описание зоны (dragZone). */
	const dragZones = new WeakMap();
	/**
	 * Идущий перенос {payload: {zone, scope, key, kind}, source, row, zones, node} или null; у node слушатель конца
	 * переноса до finishDrag.
	 */
	let dragNow = null;
	/** Ответы и перерисовки, ждущие конца переноса, по порядку прихода. */
	let dragHeld = [];
	/** Перерисовки, запрошенные отложенными ответами (rerenderSoon): каждая выполняется один раз. */
	let heldRenders = null;
	/** Последняя точка dragover для подсветки в кадре: {zoneEl, target, x, y} или null. */
	let dragPoint = null;
	let dragFrame = 0;
	/** Подсвеченное сейчас: зона под указателем, строка и её класс места. */
	let dragShown = { zone: null, row: null, mark: '' };
	/** Зона, которой показано место сброса её способом (preview: каретка в тексте выражения), или null. */
	let dragPreview = null;

	/**
	 * Зона переноса: контейнер списка, строки которого его прямые дети. spec: {id, scope?, keyOf(row): ключ | null,
	 * drag?(key, source): вид строки-источника ('' не тащится), from?: {idИсточника: (payload, target) => void | false}
	 * (false: ничего не изменилось), accept?(payload), place?: 'line' | 'into' | 'both' | 'zone' или правило
	 * place(payload, key), effect?: 'move' | 'copy' или правило, target?(event, node): своё место сброса (позиция в
	 * тексте выражения), preview?(x, y): показать место раз в кадр (x = null: перенос кончился), pick?(key): строка
	 * стала текущей, как от щелчка, когда перенос ничего не изменил или скопировал строку, rowOf?(node, контейнер) и
	 * rows?(контейнер): у таблицы, где строки не прямые дети зоны, rowAccept?(payload, key), markRow?(key, place):
	 * строка, у которой рисовать линию, если не у строки сброса}. Зоны регистрируются на каждой отрисовке.
	 */
	function dragZone(node, spec) {
		node.setAttribute('data-dnd-zone', spec.id);
		dragZones.set(node, spec);
		return node;
	}

	/**
	 * Зона у таблицы: host целиком (панель, шапка, строки, место под ними). Строка: tr, ключ по spec.keys. Сброс на шапку
	 * или выше ставит первым; «выше» считается по порядку в документе, потому что у прокрученного списка первая строка
	 * уходит выше панели. spec: {id, scope, head, rows(), keys, drag?, pick?, from?, accept?, place?, effect?}, как у
	 * dragZone.
	 */
	function tableDropZone(host, spec) {
		// Строки собираются один раз за перенос: перерисовки во время переноса отложены, массив не устаревает
		let all = null;
		return dragZone(host, {
			id: spec.id,
			scope: spec.scope,
			keyOf: (row) => (spec.keys && spec.keys.has(row) ? spec.keys.get(row) : null),
			rowOf: (node) => {
				for (let current = node; current && current !== host; current = current.parentElement) {
					if (current.tagName === 'TR') {
						return current;
					}
				}
				return spec.head && nodeAbove(node, spec.head) ? spec.head : null;
			},
			rows: () => all || (all = (spec.head ? [spec.head] : []).concat(spec.rows ? spec.rows() : [])),
			drag: spec.drag,
			pick: spec.pick,
			from: spec.from,
			accept: spec.accept,
			place: spec.place,
			effect: spec.effect,
		});
	}

	/** Лежит ли узел в документе раньше other и не содержит его. */
	function nodeAbove(node, other) {
		if (!node || !other || typeof other.compareDocumentPosition !== 'function') {
			return false;
		}
		// 2: DOCUMENT_POSITION_PRECEDING, 8: DOCUMENT_POSITION_CONTAINS
		const position = other.compareDocumentPosition(node);
		return (position & 2) !== 0 && (position & 8) === 0;
	}

	/** Зона под узлом: ближайший контейнер с data-dnd-zone. */
	function zoneNodeOf(node) {
		const found = node && typeof node.closest === 'function' ? node.closest('[data-dnd-zone]') : null;
		return found && dragZones.has(found) ? found : null;
	}

	/** Строка зоны под узлом: прямой ребёнок контейнера или строка по правилу zone.rowOf у таблицы. */
	function dragRowOf(node, zoneEl, zone) {
		if (zone && typeof zone.rowOf === 'function') {
			return zone.rowOf(node, zoneEl) || null;
		}
		for (let current = node; current && current !== zoneEl; current = current.parentElement) {
			if (current.parentElement === zoneEl) {
				return current;
			}
		}
		return null;
	}

	function dragKeyOf(zone, row) {
		const key = row && typeof zone.keyOf === 'function' ? zone.keyOf(row) : null;
		return key === undefined || key === null ? null : String(key);
	}

	/** Узел на неактивном уровне (inert): переносить можно только внутри верхнего окна. */
	function insideInert(node) {
		for (let current = node; current; current = current.parentElement) {
			if (current.inert) {
				return true;
			}
		}
		return false;
	}

	/** Сделать сейчас или, если идёт перенос, после него: ответы расширения и перерисовки по таймеру. */
	function whenIdle(fn) {
		if (dragNow) {
			dragHeld.push(fn);
			return;
		}
		fn();
	}

	function rethrowLater(error) {
		// Ошибка одного ответа не теряет остальные: она всплывёт отдельной задачей
		setTimeout(() => {
			throw error;
		}, 0);
	}

	/** Перерисовка окна по ответу расширения: сразу, а для ответов, отложенных переносом, одна на всех в конце. */
	function rerenderSoon(fn) {
		if (typeof fn !== 'function') {
			return;
		}
		if (heldRenders) {
			heldRenders.add(fn);
			return;
		}
		fn();
	}

	function releaseHeld() {
		const held = dragHeld;
		dragHeld = [];
		if (held.length === 0) {
			return;
		}
		// Ответы применяются по порядку, а перерисовка окна одна, после всех
		heldRenders = new Set();
		try {
			for (const fn of held) {
				try {
					fn();
				} catch (error) {
					rethrowLater(error);
				}
			}
		} finally {
			const renders = heldRenders;
			heldRenders = null;
			renders.forEach((fn) => {
				try {
					fn();
				} catch (error) {
					rethrowLater(error);
				}
			});
		}
	}

	/** Строки зоны по порядку: прямые дети контейнера или zone.rows у таблицы. */
	function zoneRows(zone, zoneEl) {
		return (typeof zone.rows === 'function' ? zone.rows(zoneEl) : zoneEl.children) || [];
	}

	/** Последняя строка списка с ключом: сброс под строками встаёт за ней, и линия рисуется у неё снизу. */
	function lastDragRow(zone, zoneEl) {
		const children = zoneRows(zone, zoneEl);
		for (let index = children.length - 1; index >= 0; index--) {
			if (dragKeyOf(zone, children[index]) !== null) {
				return children[index];
			}
		}
		return null;
	}

	/** Первая строка с ключом и лежит ли узел row без ключа (шапка) над ней: сброс на шапку встаёт перед первой строкой. */
	function firstDragRow(zone, zoneEl, row) {
		const children = zoneRows(zone, zoneEl);
		let above = false;
		for (let index = 0; index < children.length; index++) {
			if (dragKeyOf(zone, children[index]) !== null) {
				return { row: children[index], above: above };
			}
			if (children[index] === row) {
				above = true;
			}
		}
		return { row: null, above: false };
	}

	/** Место сброса по точке {key, place, row, mark}: строка под указателем и класс подсветки. */
	function dropSpotOf(zone, zoneEl, node, clientY, payload) {
		let mode = dropMode(zone, payload, null);
		if (mode === 'zone') {
			return { key: null, place: 'end', row: null, mark: '' };
		}
		const row = dragRowOf(node, zoneEl, zone);
		const key = dragKeyOf(zone, row);
		// Строка перенос не примет: сброс отменяется
		if (!dropRowAccepted(zone, payload, key)) {
			return { key: key, place: 'none', row: null, mark: '' };
		}
		if (key !== null) {
			mode = dropMode(zone, payload, key);
		}
		if (key === null) {
			if (mode !== 'line') {
				return { key: null, place: 'end', row: null, mark: '' };
			}
			// Шапка и отступ над строками ставят первым: туда целятся, чтобы поставить в начало
			const first = firstDragRow(zone, zoneEl, row);
			if (first.row && first.above) {
				// Линия у нижнего края шапки: закреплённая шапка видна и в прокрученном списке, а первая строка могла уйти
				// за край
				return { key: dragKeyOf(zone, first.row), place: 'before', row: row, mark: 'dcs-dnd-after' };
			}
			if (first.row && clientY < first.row.getBoundingClientRect().top) {
				return { key: dragKeyOf(zone, first.row), place: 'before', row: first.row, mark: 'dcs-dnd-before' };
			}
			const last = lastDragRow(zone, zoneEl);
			return { key: null, place: 'end', row: last, mark: last ? 'dcs-dnd-after' : '' };
		}
		const rect = row.getBoundingClientRect();
		const place = dropPlace(clientY - rect.top, rect.height, mode);
		// Линия там, куда встанет строка, если это не край строки сброса (раскрытый узел дерева)
		const shown = typeof zone.markRow === 'function' ? zone.markRow(key, place) : null;
		return { key: key, place: place, row: shown || row, mark: 'dcs-dnd-' + place };
	}

	/** Подсветка без сдвига раскладки: класс зоны под указателем и класс места у строки, только при смене. */
	function showDrop(zoneEl, row, mark) {
		const shown = dragShown;
		if (shown.zone !== zoneEl) {
			if (shown.zone) {
				shown.zone.classList.remove('dcs-dnd-over');
			}
			if (zoneEl) {
				zoneEl.classList.add('dcs-dnd-over');
			}
		}
		if (shown.row !== row || shown.mark !== mark) {
			if (shown.row && shown.mark) {
				shown.row.classList.remove(shown.mark);
			}
			if (row && mark) {
				row.classList.add(mark);
			}
		}
		dragShown = { zone: zoneEl, row: row, mark: mark };
	}

	/** Место сброса способом зоны (preview); прежняя зона получает preview(null). */
	function showPreview(zone, point) {
		const shown = dragPreview;
		const next = zone && point && typeof zone.preview === 'function' ? zone : null;
		dragPreview = next;
		try {
			if (shown && shown !== next) {
				shown.preview(null, null);
			}
			if (next) {
				next.preview(point.x, point.y);
			}
		} catch (error) {
			rethrowLater(error);
		}
	}

	function paintDrop() {
		dragFrame = 0;
		const drag = dragNow;
		const point = dragPoint;
		if (!drag || !point || !point.zoneEl.isConnected) {
			showDrop(null, null, '');
			showPreview(null, null);
			return;
		}
		const zone = dragZones.get(point.zoneEl);
		if (!zone || typeof zone.target === 'function') {
			// Поле выражения: место показывает сама зона кареткой
			showDrop(point.zoneEl, null, '');
			showPreview(zone, point);
			return;
		}
		showPreview(null, null);
		const spot = dropSpotOf(zone, point.zoneEl, point.target, point.y, drag.payload);
		// Строка перенос не примет: подсветки нет, как вне зон
		showDrop(spot.place === 'none' ? null : point.zoneEl, spot.row, spot.mark);
	}

	/** Подсветка раз в кадр: dragover приходит чаще. */
	function schedulePaint() {
		if (dragFrame) {
			return;
		}
		if (typeof window.requestAnimationFrame === 'function') {
			dragFrame = window.requestAnimationFrame(paintDrop);
		} else {
			paintDrop();
		}
	}

	/**
	 * Строка-источник становится текущей, как от щелчка: фокус она уже получила, а click после переноса браузер не шлёт.
	 * Иначе фокус и выбор разошлись бы по разным строкам.
	 */
	function pickSource(drag) {
		const zone = drag ? drag.source : null;
		if (!zone || typeof zone.pick !== 'function') {
			return;
		}
		try {
			zone.pick(drag.payload.key);
		} catch (error) {
			rethrowLater(error);
		}
	}

	/**
	 * Конец переноса: подсветка и метки снимаются. keepHeld: отложенное отдаст сам сброс после действия; pick: перенос
	 * кончился без сброса, строка-источник становится текущей.
	 */
	function finishDrag(keepHeld, pick) {
		const drag = dragNow;
		dragNow = null;
		dragPoint = null;
		if (dragFrame && typeof window.cancelAnimationFrame === 'function') {
			window.cancelAnimationFrame(dragFrame);
		}
		dragFrame = 0;
		showDrop(null, null, '');
		showPreview(null, null);
		if (drag) {
			if (drag.node) {
				drag.node.removeEventListener('dragend', onDragEnd);
			}
			document.removeEventListener('pointerdown', onDragLost, true);
			document.removeEventListener('mousemove', onDragLost, true);
			if (drag.row) {
				drag.row.classList.remove('dcs-dnd-source');
			}
			for (const node of drag.zones) {
				node.classList.remove('dcs-dnd-can');
			}
		}
		if (!keepHeld) {
			releaseHeld();
			if (pick) {
				pickSource(drag);
			}
		}
	}

	/**
	 * Перенос кончился без dragend (например, исключение в его начале). Во время переноса браузер не шлёт событий мыши,
	 * поэтому нажатие или движение без кнопки значит конец; иначе ответы расширения ждали бы вечно. Строку не выбирают:
	 * пришедший щелчок выберет свою.
	 */
	function onDragLost(event) {
		if (!dragNow || (event.type === 'mousemove' && event.buttons !== 0)) {
			return;
		}
		finishDrag(false, false);
	}

	function onDragStart(event) {
		const source = event.target;
		const zoneEl = zoneNodeOf(source);
		// Чужой перенос (выделенный текст, ссылка) не трогаем
		if (!zoneEl || !source || source.draggable !== true) {
			return;
		}
		const zone = dragZones.get(zoneEl);
		const row = dragRowOf(source, zoneEl, zone);
		const key = dragKeyOf(zone, row);
		// Пока правка сохраняется, перенос не начинается: ответ saved перечитал бы модель под переносом
		const kind = key !== null && typeof zone.drag === 'function' && !editBusy() && !insideInert(zoneEl) ? zone.drag(key, source) : '';
		if (!kind || !event.dataTransfer) {
			event.preventDefault();
			return;
		}
		const payload = { zone: zone.id, scope: zone.scope, key: key, kind: String(kind) };
		dragNow = { payload: payload, source: zone, row: row, zones: [], node: source };
		// dragend доходит до источника, даже если сброс убрал строку из документа. Слушатели ставятся сразу: исключение
		// ниже не должно оставить перенос идущим
		source.addEventListener('dragend', onDragEnd);
		document.addEventListener('pointerdown', onDragLost, true);
		document.addEventListener('mousemove', onDragLost, true);
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setData(DRAG_TYPE, zone.id);
		row.classList.add('dcs-dnd-source');
		// Принимающие зоны верхнего окна сразу получают рамку
		for (const node of Array.from(document.querySelectorAll('[data-dnd-zone]'))) {
			if (dropAccepted(dragZones.get(node), payload) && !insideInert(node)) {
				node.classList.add('dcs-dnd-can');
				dragNow.zones.push(node);
			}
		}
	}

	function onDragOver(event) {
		const drag = dragNow;
		const zoneEl = drag ? zoneNodeOf(event.target) : null;
		const zone = zoneEl ? dragZones.get(zoneEl) : null;
		const accepted = Boolean(zone) && dropAccepted(zone, drag.payload);
		const refused = accepted && typeof zone.rowAccept === 'function' && !dropRowAccepted(zone, drag.payload, dragKeyOf(zone, dragRowOf(event.target, zoneEl, zone)));
		if (!accepted || refused) {
			// Оболочка webview отменила dragover на всём документе: без 'none' курсор обещал бы сброс где угодно
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'none';
			}
			if (drag && (dragShown.zone || dragPreview)) {
				dragPoint = null;
				schedulePaint();
			}
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = dropEffect(zone, drag.payload);
		}
		dragPoint = { zoneEl: zoneEl, target: event.target, x: event.clientX, y: event.clientY };
		schedulePaint();
	}

	function onDragLeave() {
		// Если указатель ушёл за окно, dragover больше не придёт: подсветка снимается в кадре
		if (dragNow) {
			dragPoint = null;
			schedulePaint();
		}
	}

	function onDrop(event) {
		const drag = dragNow;
		if (!drag) {
			// Чужой сброс: действие браузера уже отменила оболочка webview
			return;
		}
		event.preventDefault();
		const zoneEl = zoneNodeOf(event.target);
		const zone = zoneEl ? dragZones.get(zoneEl) : null;
		if (!zone || !hasDragType(event.dataTransfer && event.dataTransfer.types) || insideInert(zoneEl) || !dropAccepted(zone, drag.payload)) {
			finishDrag(false, true);
			return;
		}
		const spot = typeof zone.target === 'function' ? zone.target(event, zoneEl) : dropSpotOf(zone, zoneEl, event.target, event.clientY, drag.payload);
		const payload = drag.payload;
		// Сброс строки на неё саму (дрожь руки при нажатии) считается щелчком
		if ((zone === drag.source && spot.key === payload.key) || spot.place === 'none') {
			finishDrag(false, true);
			return;
		}
		finishDrag(true);
		// Скопированная строка становится текущей до действия: фокус остаётся за действием (поле выражения забирает его
		// вставкой)
		const copied = zone !== drag.source && dropEffect(zone, payload) === 'copy';
		let changed = true;
		try {
			if (copied) {
				pickSource(drag);
			}
			// То же действие, что у кнопки; отложенные ответы отдаются после него
			changed = zone.from[payload.zone](payload, { key: spot.key, place: spot.place, offset: spot.offset }) !== false;
		} finally {
			releaseHeld();
		}
		// Сброс ничего не изменил: строка выбирается, как от щелчка
		if (!changed && !copied) {
			pickSource(drag);
		}
	}

	function onDragEnd() {
		if (dragNow) {
			finishDrag(false, true);
		}
	}

	document.addEventListener('dragstart', onDragStart);
	document.addEventListener('dragover', onDragOver);
	document.addEventListener('dragleave', onDragLeave);
	document.addEventListener('drop', onDrop);
	document.addEventListener('dragend', onDragEnd);

	// ---------- команды-пиктограммы над списками ----------

	const SVG_NS = 'http://www.w3.org/2000/svg';

	/**
	 * Свои пиктограммы 16×16 из линий. Цвет currentColor следует теме, в том числе контрастной. Фигура: [тег,
	 * атрибуты]. Обводка и заливка заданы в стилях (.dcs-icon): атрибут style не пропустил бы CSP окна.
	 */
	const COMMAND_ICONS = Object.freeze({
		add: [['path', { d: 'M8 3v10M3 8h10' }]],
		// Лист за листом и плюс: копия выбранной строки
		'add-copy': [
			['path', { d: 'M5.5 4.5v-2h8v8h-2' }],
			['rect', { x: '2.5', y: '5.5', width: '8', height: '8', rx: '1' }],
			['path', { d: 'M6.5 7.5v4M4.5 9.5h4' }],
		],
		edit: [['path', { d: 'M2.5 13.5l.8-3.2L10.6 3a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2l-7.3 7.3zM9.5 4.1l2.4 2.4' }]],
		delete: [['path', { d: 'M4 4l8 8M12 4l-8 8' }]],
		// Поле с текстом и курсор ввода: правка имени, а не свойств
		rename: [
			['rect', { x: '1.5', y: '4.5', width: '9', height: '7', rx: '1' }],
			['path', { d: 'M4 8h4M13 3v10M11.5 3h3M11.5 13h3' }],
		],
		replace: [['path', { d: 'M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13' }]],
		up: [['path', { d: 'M8 13V3.5M4 7.5l4-4 4 4' }]],
		down: [['path', { d: 'M8 3v9.5M4 8.5l4 4 4-4' }]],
		// Строки с отступом и стрелка: на уровень выше (влево) и в папку над строкой (вправо)
		outdent: [['path', { d: 'M14 3.5H7M14 8H9M14 12.5H7M5.5 5.5L3 8l2.5 2.5M3 8h4' }]],
		indent: [['path', { d: 'M14 3.5H7M14 8H9M14 12.5H7M2 5.5L4.5 8 2 10.5M1.5 8h3' }]],
		// Скобки со строками внутри: запрос в запросе
		'nested-query': [['path', { d: 'M5 2.5c-2.2 2.5-2.2 8.5 0 11M11 2.5c2.2 2.5 2.2 8.5 0 11M6.5 6h3M6.5 8h3M6.5 10h3' }]],
		// Таблица и скобки за ней: Таблица(параметры)
		'table-params': [
			['rect', { x: '1.5', y: '3.5', width: '8', height: '9', rx: '1' }],
			['path', { d: 'M1.5 6.5h8M5.5 6.5v6M12 4.5c-1.2 1.6-1.2 5.4 0 7M13.8 4.5c1.2 1.6 1.2 5.4 0 7' }],
		],
		// Строка и две строки с отступом под ней: новая группировка
		group: [['path', { d: 'M2 3.5h7M4 3.5v8M4 7.5h2.5M4 11.5h2.5M8.5 7.5h5M8.5 11.5h5' }]],
		// Сетка: новая таблица
		table: [
			['rect', { x: '1.5', y: '2.5', width: '13', height: '11', rx: '1' }],
			['path', { d: 'M1.5 6h13M1.5 9.5h13M6 2.5v11' }],
		],
		// Столбики на оси: новая диаграмма
		chart: [['path', { d: 'M2 13.5h12M4.5 12V8M8 12V4M11.5 12V6.5' }]],
		// Палочка и искры: конструктор настроек по шагам
		wizard: [['path', { d: 'M2.5 13.5l7.5-7.5M11.5 1.5v3M10 3h3M13.5 6.5v2M12.5 7.5h2M5.5 2.5v2M4.5 3.5h2' }]],
		// Папка: папка выбранных полей и группа условий отбора
		folder: [['path', { d: 'M1.5 4v8.5h13V6H8L6.5 4z' }]],
		// Угловые скобки вокруг точки, как в записи «<Авто>»
		auto: [
			['path', { d: 'M5 4.5L1.5 8 5 11.5M11 4.5L14.5 8 11 11.5' }],
			['circle', { cx: '8', cy: '8', r: '1.2' }],
		],
	});

	/** Пиктограмма команды: svg 16×16, скрытый от читалки (имя у кнопки). */
	function commandIcon(name) {
		const shapes = COMMAND_ICONS[name];
		if (!shapes) {
			throw new Error('нет пиктограммы «' + name + '»');
		}
		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('class', 'dcs-icon');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		for (const shape of shapes) {
			const node = document.createElementNS(SVG_NS, shape[0]);
			for (const key of Object.keys(shape[1])) {
				node.setAttribute(key, shape[1][key]);
			}
			svg.appendChild(node);
		}
		return svg;
	}

	/**
	 * Кнопка-пиктограмма команды над списком. spec:
	 * - icon: имя из COMMAND_ICONS; name: подсказка и aria-label, потому что видимой подписи нет;
	 * - shortcut: клавиша той же команды в списке; идёт в подсказку, но не в доступное имя: на кнопке она не работает;
	 * - note: пояснение или причина недоступности, вторая строка подсказки и aria-description; spoken: своё, короче;
	 * - unavailable: недоступна, но остаётся в обходе Tab, а щелчок доходит до onClick;
	 * - disabled: выпадает из обхода Tab;
	 * - className: классы кнопки, по умолчанию ghost-btn и dcs-btn-small
	 */
	function iconButton(spec) {
		const node = el('button', (spec.className || 'ghost-btn dcs-btn-small') + ' dcs-icon-btn');
		node.type = 'button';
		node.appendChild(commandIcon(spec.icon));
		node.setAttribute('aria-label', spec.name);
		const head = spec.shortcut ? spec.name + ' (' + spec.shortcut + ')' : spec.name;
		node.title = spec.note ? head + '\n' + spec.note : head;
		const spoken = spec.spoken || spokenReason(spec.note, spec.unavailable) || shortcutSpoken(spec.shortcut);
		if (spoken) {
			node.setAttribute('aria-description', spoken);
		}
		if (spec.disabled) {
			node.disabled = true;
		}
		if (spec.unavailable) {
			node.setAttribute('aria-disabled', 'true');
		}
		node.addEventListener('click', spec.onClick);
		return node;
	}

	/**
	 * Описание для читалки у кнопки с клавишей и без пояснения. Без него описанием стал бы title, и читалка повторила бы
	 * имя кнопки.
	 */
	function shortcutSpoken(shortcut) {
		return shortcut ? 'Клавиша в списке: ' + shortcut : '';
	}

	/** Причина для читалки у недоступной кнопки без начала «Недоступно: …»: aria-disabled читалка называет сама. */
	function spokenReason(note, unavailable) {
		const text = String(note || '');
		if (!unavailable) {
			return text;
		}
		const rest = text.replace(/^Недоступно[:,]?\s*/u, '');
		return rest.charAt(0).toUpperCase() + rest.slice(1);
	}

	/**
	 * Доступность и подсказка кнопки-пиктограммы без перерисовки, по правилам iconButton: выбор строки меняет, можно ли
	 * двигать и удалять.
	 */
	function setIconState(node, name, shortcut, unavailable, note) {
		const head = shortcut ? name + ' (' + shortcut + ')' : name;
		node.title = note ? head + '\n' + note : head;
		const spoken = spokenReason(note, unavailable) || shortcutSpoken(shortcut);
		if (spoken) {
			node.setAttribute('aria-description', spoken);
		} else {
			node.removeAttribute('aria-description');
		}
		if (unavailable) {
			node.setAttribute('aria-disabled', 'true');
		} else {
			node.removeAttribute('aria-disabled');
		}
	}

	/** Панель пиктограмм над списком вкладки схемы. Ключ кнопки сохраняет фокус при перерисовке вкладки. */
	function listToolbar(host, buttons) {
		const bar = el('div', 'dcs-list-toolbar');
		for (const spec of buttons) {
			bar.appendChild(keyed(iconButton(spec), spec.key || focusKey(['tool', activeTabId, spec.name])));
		}
		host.appendChild(bar);
		return bar;
	}

	/** Клавиши, которыми закрытый список листает значения (и тут же шлёт change в Chromium под Windows). */
	const SELECT_BROWSE_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'];

	/**
	 * Список-действие («+ Добавить параметр»): выбор имени сразу добавляет строку или открывает окно. В Chromium под
	 * Windows стрелки и буквы на закрытом списке сразу шлют change, поэтому change от такой клавиши только выбирает имя,
	 * а действует Enter. Выбор мышью и в раскрытом списке срабатывает сразу: раскрытый список ведёт клавиатуру сам, и
	 * keydown до поля не доходит. onPick(value) получает непустое значение.
	 */
	function actionSelect(select, onPick) {
		let fromKey = false;
		const take = () => {
			const value = select.value;
			select.value = '';
			if (value) {
				onPick(value);
			}
		};
		select.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				if (select.value) {
					event.preventDefault();
					take();
				}
				return;
			}
			const printable = typeof event.key === 'string' && event.key.length === 1 && event.key !== ' ';
			if (!event.altKey && (SELECT_BROWSE_KEYS.indexOf(event.key) >= 0 || printable)) {
				// change от этой клавиши придёт до таймера
				fromKey = true;
				setTimeout(() => {
					fromKey = false;
				}, 0);
			}
		});
		select.addEventListener('change', () => {
			if (!fromKey) {
				take();
			}
		});
		// Имя, выбранное стрелками, не мешает выбору мышью (то же имя иначе не дало бы change) и не остаётся после ухода
		select.addEventListener('mousedown', () => {
			select.value = '';
		});
		select.addEventListener('blur', () => {
			select.value = '';
		});
	}

	/**
	 * Список значения, который пишет файл: commit по выбору мышью, Enter или уходу из списка, revert по Esc. Значения с
	 * клавиатуры только листаются, как у actionSelect: иначе первая же стрелка писала бы файл.
	 */
	function browseSelect(select, commit, revert) {
		let fromKey = false;
		let browsed = false;
		const finish = () => {
			if (browsed) {
				browsed = false;
				commit();
			}
		};
		select.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				if (browsed) {
					event.preventDefault();
					finish();
				}
				return;
			}
			if (event.key === 'Escape' && browsed) {
				event.preventDefault();
				browsed = false;
				revert();
				return;
			}
			const printable = typeof event.key === 'string' && event.key.length === 1 && event.key !== ' ';
			if (!event.altKey && (SELECT_BROWSE_KEYS.indexOf(event.key) >= 0 || printable)) {
				// change от этой клавиши придёт до таймера
				fromKey = true;
				setTimeout(() => {
					fromKey = false;
				}, 0);
			}
		});
		select.addEventListener('change', () => {
			if (fromKey) {
				browsed = true;
				return;
			}
			browsed = false;
			commit();
		});
		// Уход из списка заканчивает выбор, если список не убирает перерисовка
		select.addEventListener('blur', () => {
			if (!renderingContent && select.isConnected) {
				finish();
			}
		});
	}

	// ---------- подсветка запроса и выражений ----------

	/** Токенайзер подсветки (dcs-editor-highlight.js). */
	const highlighter = window.DcsHighlight;

	/** Пауза перерисовки после ввода: печать не должна ждать токенайзер на каждом символе. */
	const HIGHLIGHT_DEBOUNCE_MS = 120;

	/** Наполняет зеркало-pre токенами текста; спаны только у распознанных токенов. */
	function renderHighlight(pre, text) {
		pre.textContent = '';
		for (const token of highlighter.tokenize(text)) {
			if (token.type === 'text') {
				pre.appendChild(document.createTextNode(token.value));
			} else {
				const span = document.createElement('span');
				span.className = 'dcs-tok-' + token.type;
				span.textContent = token.value;
				pre.appendChild(span);
			}
		}
		// Хвостовой перевод строки pre схлопывает: добавка выравнивает высоту с textarea
		pre.appendChild(document.createTextNode('\n'));
	}

	/**
	 * Редактор кода с подсветкой: зеркало-pre за прозрачной textarea. Возвращает {box, input, flush}.
	 * На текстах больше лимита подсветка выключается. flush() перерисовывает зеркало без паузы:
	 * подсказка меряет по нему каретку.
	 */
	function codeEditor(value, className) {
		const input = el('textarea', className || 'dcs-expr');
		input.value = value || '';
		input.spellcheck = false;
		const wrap = el('div', 'dcs-hl-wrap');
		const box = el('div', 'dcs-hl-box');
		box.appendChild(wrap);
		const pre = el('pre', 'dcs-hl-pre');
		// Зеркало дублирует текст textarea: читалкам хватает самой textarea
		pre.setAttribute('aria-hidden', 'true');
		wrap.appendChild(pre);
		wrap.appendChild(input);
		const warn = el('div', 'dcs-hl-warn');
		box.appendChild(warn);
		let timer = 0;
		function syncScroll() {
			pre.scrollTop = input.scrollTop;
			pre.scrollLeft = input.scrollLeft;
		}
		function repaint() {
			timer = 0;
			const text = input.value;
			if (text.length > highlighter.HIGHLIGHT_LIMIT) {
				// Большой текст: зеркало дороже пользы, редактор остаётся простым
				wrap.classList.add('dcs-hl-off');
				pre.textContent = '';
				warn.textContent = '';
				return;
			}
			wrap.classList.remove('dcs-hl-off');
			renderHighlight(pre, text);
			warn.textContent = highlighter.delimiterWarning(text);
			syncScroll();
		}
		input.addEventListener('input', () => {
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(repaint, HIGHLIGHT_DEBOUNCE_MS);
		});
		input.addEventListener('scroll', syncScroll);
		// Ctrl+/ только у текста запроса: в однострочном выражении комментарий скорее сломал бы его
		if (input.classList.contains('dcs-query')) {
			input.addEventListener('keydown', (event) => onCommentToggleKey(input, event));
		}
		repaint();
		function flush() {
			if (timer) {
				clearTimeout(timer);
				repaint();
				return;
			}
			// Значение могли записать без события input: зеркало догоняет текст, иначе метка встанет мимо
			if (!wrap.classList.contains('dcs-hl-off') && pre.textContent !== input.value + '\n') {
				repaint();
				return;
			}
			syncScroll();
		}
		codeEditorParts.set(input, { box: box, wrap: wrap, pre: pre, flush: flush });
		return { box: box, input: input, flush: flush };
	}

	/**
	 * Сочетание переключения комментариев: Ctrl+/ (Cmd+/ на mac). Клавиша сверяется и по символу, и по
	 * физической клавише: в русской раскладке на месте «/» стоит «.», а в немецкой «/» набирается с Shift.
	 */
	function isCommentToggleKey(event) {
		if (!(event.ctrlKey || event.metaKey) || event.altKey) {
			return false;
		}
		return event.key === '/' || (event.code === 'Slash' && !event.shiftKey);
	}

	/** Ctrl+/ в тексте запроса: закомментировать или раскомментировать строки выделения. */
	function onCommentToggleKey(input, event) {
		if (event.defaultPrevented || event.isComposing || !isCommentToggleKey(event)) {
			return;
		}
		event.preventDefault();
		// Текст набора внутри объединения только для чтения: правит его конструктор
		if (input.readOnly || input.disabled) {
			return;
		}
		const result = highlighter.toggleLineComments(input.value, input.selectionStart, input.selectionEnd);
		if (result.text === input.value) {
			return;
		}
		// Список подсказки стоял у прежней каретки: после правки строк он врал бы
		closeCompletionWithin(input);
		applyingCompletion = true;
		try {
			writeEditorText(input, result.replaceStart, result.replaceEnd, result.text, result.selStart, result.selEnd);
		} finally {
			applyingCompletion = false;
		}
	}

	/**
	 * Пишет правку отрезка [start, end) так, чтобы поле стало nextText, и ставит выделение.
	 * execCommand оставляет правку в истории поля (Ctrl+Z отменяет только её); без него значение
	 * пишется напрямую с событием input.
	 */
	function writeEditorText(input, start, end, nextText, selStart, selEnd) {
		const tail = input.value.length - end;
		const inserted = nextText.slice(start, nextText.length - tail);
		if (typeof input.setSelectionRange === 'function') {
			input.setSelectionRange(start, end);
		}
		// Пустая правка пустого отрезка: delete по свёрнутой каретке стёр бы символ слева
		let done = start === end && inserted === '' && input.value === nextText;
		if (!done && typeof document.execCommand === 'function') {
			try {
				// insertText с пустой строкой браузеры исполняют по-разному
				done = document.execCommand(inserted === '' ? 'delete' : 'insertText', false, inserted) && input.value === nextText;
			} catch (error) {
				done = false;
			}
		}
		if (!done) {
			input.value = nextText;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}
		if (typeof input.setSelectionRange === 'function') {
			input.setSelectionRange(selStart, selEnd);
		}
	}

	/**
	 * Поле выражения в диалоге: компактный редактор с подсветкой. scopeFn: место ввода для подсказки;
	 * без него подсказки нет.
	 */
	function expressionInput(host, labelText, value, scopeFn) {
		const editor = codeEditor(value, 'dcs-expr');
		formRow(host, labelText, editor.box);
		if (scopeFn) {
			attachCompletion(editor.input, scopeFn);
		}
		return editor.input;
	}

	// ---------- подсказка путей полей, параметров и функций ----------

	/** Чистая часть подсказки (dcs-editor-complete.js). */
	const completer = window.DcsComplete;

	/**
	 * Части редакторов кода по их textarea: подсказке нужны зеркало подсветки и flush, а наружу
	 * expressionInput отдаёт только саму textarea.
	 */
	const codeEditorParts = new WeakMap();

	/** Каталоги мест ввода: строятся при открытии списка и живут, пока не сменились модель или настройки варианта. */
	const completeCatalogs = new Map();

	/**
	 * Открытый список: привязка поля, каталог, контекст каретки, ранжированные строки, активная
	 * строка и начало нарисованного окна; null, если список закрыт.
	 */
	let completeSession = null;

	/** Вставка выбранной строки сама порождает input: его разбор снова открыл бы только что закрытый список. */
	let applyingCompletion = false;

	/** Escape стека диалогов (escapeAction) закрывает сначала список, а не окно с недописанным выражением. */
	const completePopupHook = {
		isOpen: () => completeSession !== null,
		close: () => closeCompletion(),
	};

	/**
	 * Метрики textarea, которые нужны клону для замера каретки без зеркала (подсветка выключена):
	 * шрифт, отступы, рамка и правила переноса определяют, где окажется метка.
	 */
	const CARET_CLONE_STYLES = [
		'boxSizing',
		'width',
		'height',
		'paddingTop',
		'paddingRight',
		'paddingBottom',
		'paddingLeft',
		'borderTopWidth',
		'borderRightWidth',
		'borderBottomWidth',
		'borderLeftWidth',
		'borderStyle',
		'fontFamily',
		'fontSize',
		'fontWeight',
		'fontStyle',
		'lineHeight',
		'letterSpacing',
		'tabSize',
		'whiteSpace',
		'wordWrap',
		'overflowWrap',
		'textIndent',
	];

	/** Клавиши хода по открытому списку (решает nextActive модуля). */
	const COMPLETE_NAV_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];

	/**
	 * Один список на документ: второй читалка приняла бы за другой виджет. Он живёт с position: fixed
	 * на body, а при открытии из окна переезжает в верхний .dcs-dialog: вне aria-modal Chromium под
	 * VoiceOver вырезает его из дерева доступности. Обрезки overflow fixed не боится, пока у предков
	 * окна нет transform, filter и contain.
	 */
	const completeList = createCompleteList();
	/** Скрытая строка для читалки: «Вариантов: N» при открытии и перефильтровке. */
	const completeStatus = createCompleteStatus();

	function createCompleteList() {
		const listEl = el('div', 'dcs-complete hidden');
		listEl.id = 'dcsComplete';
		listEl.setAttribute('role', 'listbox');
		listEl.setAttribute('aria-label', 'Подсказка');
		// Выше любого уровня стека: окна поверх окон не должны закрывать список своего поля
		listEl.style.zIndex = String(dialogRules.POPUP_Z_INDEX);
		// Фокус остаётся в поле: иначе blur закрыл бы список раньше, чем щелчок по строке её вставит
		listEl.addEventListener('mousedown', (event) => {
			event.preventDefault();
		});
		document.body.appendChild(listEl);
		return listEl;
	}

	function createCompleteStatus() {
		const status = el('div', 'dcs-complete-status');
		status.id = 'dcsCompleteStatus';
		status.setAttribute('aria-live', 'polite');
		document.body.appendChild(status);
		return status;
	}

	function announceCompletion(text) {
		completeStatus.textContent = text;
	}

	/**
	 * Список и строка состояния живут в верхнем окне стека, без окон на body: aria-modal прячет от
	 * читалки всё вне окна.
	 */
	function placeCompletionHost() {
		const top = dialogStack.top();
		const host = top ? top.shell.box : document.body;
		if (completeList.parentNode !== host) {
			host.appendChild(completeList);
		}
		if (completeStatus.parentNode !== host) {
			host.appendChild(completeStatus);
		}
	}

	/** Уровень закрывается: список и строка возвращаются на body, а не уходят из документа вместе с окном. */
	function releaseCompletionHost(box) {
		if (box.contains(completeList)) {
			document.body.appendChild(completeList);
		}
		if (box.contains(completeStatus)) {
			document.body.appendChild(completeStatus);
		}
	}

	/** Каталог места ввода; у разделов настроек с пользовательскими полями активного варианта. */
	function completionCatalog(scope) {
		const key = String(scope || '');
		const settingsDto = key.indexOf('settings:') === 0 ? variantCache[activeVariantName()] || null : null;
		const cached = completeCatalogs.get(key);
		// Подписи типов зависят и от словаря имён видов ссылок
		if (cached && cached.model === model && cached.settings === settingsDto && cached.dictionary === typeDictionary) {
			return cached.catalog;
		}
		const catalog = completer.buildCatalog(model, settingsDto, key, completionTypeOptions());
		completeCatalogs.set(key, { model: model, settings: settingsDto, dictionary: typeDictionary, catalog: catalog });
		return catalog;
	}

	/**
	 * Подпись типа в строке подсказки: то же русское представление, что в колонке «Тип», а не XML-имена
	 * (string, CatalogRef.Х).
	 */
	function completionTypeOptions() {
		return { typeText: (valueType) => typeLabelOf(valueType, '') };
	}

	function caretOf(input) {
		return typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
	}

	function caretContext(input) {
		return completer.contextAt(input.value, caretOf(input));
	}

	// ---------- уровень «через точку» по типу ----------

	/** Дети по типу и вывод типов полей наборов-запросов (dcs-editor-field-types.js). */
	const fieldTypes = window.DcsFieldTypes;
	/** Разбор запроса для вывода типов (dcs-editor-query-model.js). */
	const queryModelApi = window.DcsQueryModel;
	/** Операции конструктора запроса над моделью (dcs-editor-query-edit.js). */
	const queryEditApi = window.DcsQueryEdit;

	/**
	 * Привязывает составы определяемых типов и характеристик (typeCompositions ответа) к объектам
	 * типов, один раз при приёме. Зовётся в каждой точке приёма модели cf-dcs-info и описания
	 * cf-md-query-tables; новую точку подключать так же, это сверяет node-тест. Объявлена функцией:
	 * начальная модель разбирается в первой строке скрипта.
	 */
	function withTypeCompositions(answer) {
		return window.DcsFieldTypes.attachTypeCompositions(answer);
	}

	/**
	 * Описания объектов конфигурации (cf-md-query-tables) по ключу на время вкладки: правки схемы
	 * метаданных не меняют, а чтение запускает jar. Состояния: loading, ready, none.
	 */
	const describeCache = new Map();
	/**
	 * Отметка кэша описаний: растёт на каждый ответ с описанием или «нет». По ней таблица констант
	 * конструктора пересобирает типы полей.
	 */
	let describeStamp = 0;
	/** Макет вне выгрузки конфигурации: описывать нечего, запросы описаний не шлются. */
	let describeOutside = false;
	/**
	 * Список, который не открылся только потому, что описаний ещё нет: по ответу он открывается
	 * у того же поля и пути, если фокус и каретка остались там.
	 */
	let describeWaiting = null;
	/** Последний подсчёт детей по типу ждал описаний: так openCompletion отличает «ждём» от «пусто». */
	let describeWaited = false;
	/**
	 * Перерисовка доступных полей открытого конструктора настроек по ответу описания: его поля
	 * раскрываются реквизитами по типу. Ставит и снимает openSettingsWizard.
	 */
	let wizardRerender = null;
	/** Раскрытое поле «Доступных полей» ждёт описания: ответ describeType перерисует вкладку «Настройки». */
	let settingsTypeWaiting = false;
	/** Разборы текстов запросов наборов: текст меняется только правкой, а вывод зовётся на каждое нажатие. */
	const parsedQueries = new Map();
	const PARSED_QUERIES_LIMIT = 200;

	function parseQueryCached(text) {
		let parsed = parsedQueries.get(text);
		if (!parsed) {
			if (parsedQueries.size >= PARSED_QUERIES_LIMIT) {
				parsedQueries.clear();
			}
			parsed = queryModelApi.parse(text);
			parsedQueries.set(text, parsed);
		}
		return parsed;
	}

	/** Описание из кэша: undefined, если ещё не загружено; null, если описания нет. */
	function describeLookup(key) {
		if (describeOutside) {
			return null;
		}
		const entry = describeCache.get(key);
		if (!entry || entry.state === 'loading') {
			return undefined;
		}
		return entry.state === 'ready' ? entry.description : null;
	}

	function requestDescriptions(pending) {
		for (const item of pending) {
			if (describeOutside || describeCache.has(item.key)) {
				continue;
			}
			describeCache.set(item.key, { state: 'loading' });
			post('dcs/describe-type', item.request);
		}
	}

	/**
	 * Окружение extraChildrenFor. Одно на подсказку «через точку» и доступные поля конструктора
	 * настроек: реквизиты по типу у них должны совпадать.
	 */
	function typeChildrenEnv(scope, ownTypes) {
		return {
			// Свой каталог с типами (окно выражения конструктора запроса): тип по полям схемы
			// не выводится, иначе алиас источника совпал бы с тёзкой-полем набора
			model: ownTypes ? {} : model,
			scope: scope,
			lookup: describeLookup,
			queryModel: queryModelApi,
			parse: parseQueryCached,
			typeText: (valueType) => typeLabelOf(valueType, ''),
		};
	}

	/** Дети по типу узла каталога для подсказки; недостающие описания запрашиваются у панели. */
	function typeChildrenProvider(binding) {
		return (owner, parentPath, info) => {
			const result = fieldTypes.extraChildrenFor(info, parentPath, typeChildrenEnv(binding.scopeFn(), binding.ownTypes));
			if (result.pending.length > 0) {
				describeWaited = true;
				requestDescriptions(result.pending);
			}
			return result.children;
		};
	}

	/**
	 * Пришло описание: открытый список пересчитывается на месте, а не открывшийся из-за ожидания
	 * открывается, если каретка всё ещё после той же точки.
	 */
	function onDescribed() {
		// Конструктор настроек раскрывает поля по тем же описаниям: пересчёт до ранних выходов ниже
		rerenderSoon(wizardRerender);
		const session = completeSession;
		if (session) {
			// Верхний уровень детей по типу не берёт: его пересчёт только сбросил бы окно строк
			if (!session.ctx.parentPath) {
				return;
			}
			const active = session.ranked[session.active] ? session.ranked[session.active].item : null;
			openCompletion(session.binding, session.how, caretContext(session.input));
			const next = completeSession;
			if (next && active) {
				const index = next.ranked.findIndex((entry) => entry.item.path === active.path);
				if (index > 0) {
					moveCompletion(index);
				}
			}
			return;
		}
		const waiting = describeWaiting;
		describeWaiting = null;
		if (!waiting || !waiting.binding.input.isConnected || document.activeElement !== waiting.binding.input) {
			return;
		}
		const ctx = caretContext(waiting.binding.input);
		if (ctx.mode === waiting.mode && ctx.parentPath === waiting.parentPath) {
			openCompletion(waiting.binding, waiting.how, ctx);
		}
	}

	/**
	 * Подсказка у поля ввода: textarea редактора кода или однострочное поле пути. scopeFn(): место
	 * ввода каталога (expr-calc, settings:filter, link-source:<набор>…), зовётся при каждом открытии.
	 * options:
	 * - letters:false: список открывают только «&», Ctrl+Пробел и «⋯» (текст запроса);
	 * - extraChildren: свои дети по типу для уровня «через точку»; more:false: без кнопки «⋯»;
	 * - catalog: свой каталог места ввода (функция); ownTypes:true: дети по типу только по своему
	 *   каталогу, без вывода по полям схемы;
	 * - drop {title, label, empty, list, keys}: поле со списком. Кнопка «▾» и Alt+↓ открывают весь
	 *   верхний уровень, выбор заменяет всё значение, Alt+↑ закрывает; Ctrl+Пробел и набор
	 *   подсказывают у каретки. Пустой список показывает строку empty.
	 */
	function attachCompletion(input, scopeFn, options) {
		if (!input || typeof scopeFn !== 'function') {
			return null;
		}
		const opts = options || {};
		const binding = {
			input: input,
			scopeFn: scopeFn,
			catalogFn: typeof opts.catalog === 'function' ? opts.catalog : null,
			ownTypes: opts.ownTypes === true,
			editor: codeEditorParts.get(input) || null,
			letters: opts.letters !== false,
			drop: opts.drop && typeof opts.drop === 'object' ? opts.drop : null,
			extraChildren: null,
			more: null,
		};
		binding.extraChildren = typeof opts.extraChildren === 'function' ? opts.extraChildren : typeChildrenProvider(binding);
		input.setAttribute('aria-autocomplete', 'list');
		input.setAttribute('aria-controls', completeList.id);
		input.setAttribute('aria-expanded', 'false');
		if (input.tagName !== 'TEXTAREA') {
			// У многострочного поля роль combobox отняла бы у читалки ход по строкам
			input.setAttribute('role', 'combobox');
		}
		if (binding.drop) {
			// Роли combobox у редактора кода нет: что Alt+↓ раскрывает список, читалка узнаёт из описания поля
			input.setAttribute('aria-keyshortcuts', 'Alt+ArrowDown');
			if (binding.drop.keys) {
				const own = input.getAttribute('aria-description');
				input.setAttribute('aria-description', own ? own + ' ' + binding.drop.keys : binding.drop.keys);
			}
		}
		input.addEventListener('keydown', (event) => {
			onCompleteKeydown(binding, event);
		});
		input.addEventListener('input', (event) => {
			onCompleteInput(binding, event);
		});
		input.addEventListener('blur', () => {
			if (completeSession && completeSession.binding === binding) {
				closeCompletion();
			}
		});
		// Каретку сдвинули мышью или стрелкой вбок: список следует за словом или закрывается
		input.addEventListener('click', () => {
			syncCompletionCaret(binding);
		});
		input.addEventListener('keyup', (event) => {
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				syncCompletionCaret(binding);
			}
		});
		if (opts.more !== false) {
			binding.more = addCompleteButton(binding);
		}
		return binding;
	}

	/** Кнопка «⋯»: тот же список для мыши и читалки и обход, если Ctrl+Пробел занят раскладкой. */
	function addCompleteButton(binding) {
		const drop = binding.drop;
		const button = el('button', 'struct-btn dcs-complete-more', drop ? '▾' : '⋯');
		button.type = 'button';
		button.title = drop ? drop.title : 'Подсказка (Ctrl+Пробел)';
		button.setAttribute('aria-label', drop ? drop.label : 'Показать подсказку');
		if (drop) {
			// Читалка слышит, открыт ли список
			button.setAttribute('aria-haspopup', 'listbox');
			button.setAttribute('aria-controls', completeList.id);
			button.setAttribute('aria-expanded', 'false');
		}
		// Фокус и каретка остаются в поле: список откроется у того места, где пишут
		button.addEventListener('mousedown', (event) => {
			event.preventDefault();
		});
		button.addEventListener('click', () => {
			if (drop && completeSession && completeSession.binding === binding) {
				// Как у раскрывающегося списка: второе нажатие «▾» закрывает его
				closeCompletion();
				binding.input.focus();
				return;
			}
			binding.input.focus();
			openCompletion(binding, drop ? 'drop' : 'full');
		});
		if (binding.editor) {
			binding.editor.box.classList.add('dcs-complete-host');
			binding.editor.box.appendChild(button);
		} else {
			placeAfterInput(binding.input, button);
		}
		return button;
	}

	/**
	 * Кнопка встаёт сразу за полем: правило стилей скрывает её вместе с полем, а строка формы
	 * получает под неё третью колонку.
	 */
	function placeAfterInput(input, button) {
		const parent = input.parentNode;
		if (!parent) {
			// Поле ещё не вставлено в форму: вызывающий код вставит его тем же тиком
			Promise.resolve().then(() => {
				if (input.parentNode && !button.parentNode) {
					placeAfterInput(input, button);
				}
			});
			return;
		}
		parent.insertBefore(button, input.nextSibling);
		parent.classList.add('dcs-complete-host');
	}

	function onCompleteKeydown(binding, event) {
		if (event.isComposing) {
			return;
		}
		if ((event.key === ' ' || event.code === 'Space') && event.ctrlKey && !event.altKey && !event.metaKey) {
			// Явный вызов: список и при пустом начале слова, а без вариантов сообщение читалке
			event.preventDefault();
			openCompletion(binding, 'explicit');
			return;
		}
		if (binding.drop && event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			// Поле со списком: Alt+↓ раскрывает список значений, Alt+↑ закрывает
			event.preventDefault();
			if (event.key === 'ArrowDown') {
				openCompletion(binding, 'drop');
			} else if (completeSession && completeSession.binding === binding) {
				closeCompletion();
			}
			return;
		}
		const session = completeSession;
		if (!session || session.binding !== binding) {
			return;
		}
		if (event.key === 'Escape') {
			// Закрывается только список: окно с недописанным выражением остаётся (стек видит defaultPrevented)
			event.preventDefault();
			event.stopPropagation();
			closeCompletion();
			return;
		}
		if (event.key === 'Tab' && event.shiftKey) {
			closeCompletion();
			return;
		}
		if ((event.key === 'Enter' || event.key === 'Tab') && !dropAccepts(session, event.key)) {
			// Нечего брать: пустой список, строка не выбрана или список только посмотрели. Enter закрывает список
			// (окно его не видит), Tab уводит фокус дальше
			closeCompletion();
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			acceptCompletion(session.active);
			return;
		}
		if (COMPLETE_NAV_KEYS.indexOf(event.key) >= 0) {
			event.preventDefault();
			session.moved = true;
			moveCompletion(completer.nextActive(session.active, session.ranked.length, event.key));
		}
	}

	/**
	 * Берут ли Enter и Tab строку списка: без активной строки нет. Раскрытый и не перефильтрованный список поля со
	 * списком Tab берёт, только если строку выбрали стрелками.
	 */
	function dropAccepts(session, key) {
		if (!session.ranked[session.active]) {
			return false;
		}
		return !(key === 'Tab' && session.ctx && session.ctx.whole && !session.moved);
	}

	function onCompleteInput(binding, event) {
		if (applyingCompletion || (event && event.isComposing)) {
			return;
		}
		const open = completeSession !== null && completeSession.binding === binding;
		const typed = event && event.inputType === 'insertText' && typeof event.data === 'string' ? event.data : '';
		const ctx = caretContext(binding.input);
		const action = completer.inputAction(open, typed, ctx, { letters: binding.letters });
		if (action === 'open') {
			openCompletion(binding, 'auto', ctx);
		} else if (action === 'refilter') {
			refreshCompletion(ctx);
		} else if (action === 'close') {
			closeCompletion();
		}
	}

	function syncCompletionCaret(binding) {
		if (!completeSession || completeSession.binding !== binding) {
			return;
		}
		const ctx = caretContext(binding.input);
		if (completer.inputAction(true, '', ctx, { letters: binding.letters }) === 'refilter') {
			refreshCompletion(ctx);
		} else {
			closeCompletion();
		}
	}

	function rankCompletion(binding, catalog, ctx, full) {
		return completer.rank(completer.childrenOf(catalog, ctx, binding.extraChildren), full ? '' : ctx.prefix);
	}

	/** Контекст поля со списком: верхний уровень каталога без фильтра, выбор заменяет всё значение поля. */
	function wholeValueContext(input) {
		return { mode: 'path', parentPath: '', prefix: '', replaceStart: 0, replaceEnd: input.value.length, whole: true };
	}

	/**
	 * Строка списка, совпадающая со значением поля (`&Имя` параметра, имя прочих строк); -1, если такой нет: ни одна
	 * строка не выбрана.
	 */
	function dropActive(ranked, value) {
		const want = String(value || '')
			.trim()
			.toUpperCase();
		if (!want) {
			return -1;
		}
		return ranked.findIndex((entry) => {
			const item = entry.item || {};
			return ((item.kind === 'param' && item.bare !== true ? '&' : '') + String(item.name || '')).toUpperCase() === want;
		});
	}

	/**
	 * Открывает список у поля. how: auto по вводу (пустой список не открывается); explicit:
	 * Ctrl+Пробел; full: «⋯», весь уровень без фильтра; drop: «▾» и Alt+↓ поля со списком, весь
	 * верхний уровень, активна строка значения поля. С knownCtx (пересчёт по описаниям) список идёт
	 * от каретки, а не от всего значения.
	 */
	function openCompletion(binding, how, knownCtx) {
		const input = binding.input;
		if (input.readOnly || input.disabled || !input.isConnected) {
			return;
		}
		// До первого сообщения строки состояния: «вариантов нет» должно прозвучать внутри окна
		placeCompletionHost();
		const drop = how === 'drop' && binding.drop !== null && !knownCtx;
		const ctx = drop ? wholeValueContext(input) : knownCtx || caretContext(input);
		if (ctx.mode === 'none') {
			closeCompletion();
			if (how !== 'auto') {
				announceCompletion('Внутри строки и комментария подсказки нет.');
			}
			return;
		}
		const catalog = binding.catalogFn ? binding.catalogFn() : completionCatalog(binding.scopeFn());
		const full = how === 'full' || drop;
		describeWaited = false;
		const ranked = rankCompletion(binding, catalog, ctx, full);
		// Детей по типу ещё нет, но описания уже запрошены: список откроется по ответу (onDescribed)
		describeWaiting = describeWaited && ranked.length === 0 ? { binding: binding, how: how, mode: ctx.mode, parentPath: ctx.parentPath } : null;
		if (ranked.length === 0 && !(drop && binding.drop.empty)) {
			closeCompletion();
			if (how !== 'auto') {
				announceCompletion(describeWaiting ? 'Загрузка реквизитов…' : completer.listSummary(0));
			}
			return;
		}
		if (completeSession && completeSession.binding !== binding) {
			closeCompletion();
		}
		escapePopup = completePopupHook;
		completeSession = {
			binding: binding,
			how: how,
			input: input,
			catalog: catalog,
			ctx: ctx,
			ranked: ranked,
			active: drop ? dropActive(ranked, input.value) : full ? completer.bestIndex(ranked, ctx.prefix) : 0,
			moved: false,
			start: 0,
			rows: [],
			empty: drop ? String(binding.drop.empty || '') : '',
		};
		input.setAttribute('aria-expanded', 'true');
		if (binding.drop && binding.more) {
			binding.more.setAttribute('aria-expanded', 'true');
		}
		renderCompletion();
	}

	/** Перефильтровка по свежему контексту: набор, удаление, сдвиг каретки внутри слова. */
	function refreshCompletion(knownCtx) {
		const session = completeSession;
		if (!session) {
			return;
		}
		if (!session.input.isConnected) {
			closeCompletion();
			return;
		}
		const ctx = knownCtx || caretContext(session.input);
		const ranked = ctx.mode === 'none' ? [] : rankCompletion(session.binding, session.catalog, ctx, false);
		if (ranked.length === 0) {
			closeCompletion();
			return;
		}
		session.ctx = ctx;
		session.ranked = ranked;
		session.active = 0;
		session.start = 0;
		// Перефильтрованный набором список поля становится подсказкой у каретки: пересчёт по описаниям идёт от неё
		if (session.how === 'drop') {
			session.how = 'explicit';
		}
		renderCompletion();
	}

	function closeCompletion() {
		const session = completeSession;
		if (!session) {
			return;
		}
		completeSession = null;
		completeList.classList.add('hidden');
		completeList.textContent = '';
		announceCompletion('');
		session.input.setAttribute('aria-expanded', 'false');
		session.input.removeAttribute('aria-activedescendant');
		if (session.binding.drop && session.binding.more) {
			session.binding.more.setAttribute('aria-expanded', 'false');
		}
	}

	/** Закрывает список, если его поле лежит внутри node (окно закрывается, вкладка перерисовывается). */
	function closeCompletionWithin(node) {
		if (completeSession && node && node.contains(completeSession.input)) {
			closeCompletion();
		}
	}

	/** Рисует окно строк вокруг активной, подпись «строки a–b из N» и ставит список у каретки. */
	function renderCompletion() {
		const session = completeSession;
		const total = session.ranked.length;
		session.start = completer.windowStart(session.active, session.start, total, completer.MAX_ROWS);
		const end = Math.min(total, session.start + completer.MAX_ROWS);
		completeList.textContent = '';
		const drop = session.binding.drop;
		completeList.setAttribute('aria-label', session.ctx.whole && drop && drop.list ? drop.list : 'Подсказка');
		session.rows = [];
		for (let index = session.start; index < end; index += 1) {
			const row = completeRow(session.ranked[index], index);
			session.rows.push(row);
			completeList.appendChild(row);
		}
		const note = total === 0 && session.empty ? session.empty : completer.windowNote(session.start, end, total);
		if (note) {
			// Счёт строк читалке уже сказан строкой состояния
			const noteEl = el('div', 'dcs-complete-note', note);
			noteEl.setAttribute('aria-hidden', 'true');
			completeList.appendChild(noteEl);
		}
		markActiveRow();
		announceCompletion(total === 0 && session.empty ? session.empty : completer.listSummary(total));
		positionCompletion();
	}

	function completeRow(entry, index) {
		const parts = completer.rowParts(entry);
		const row = el('div', 'dcs-complete-row');
		row.id = 'dcsCompleteOption' + index;
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', 'false');
		// Вид словом, а не только буквой и цветом: читалка прочтёт «поле Номенклатура, Товар»
		row.setAttribute('aria-label', completer.itemLabel(entry.item));
		const kind = el('span', 'dcs-complete-kind', parts.letter);
		kind.setAttribute('data-kind', entry.item.kind || 'field');
		kind.setAttribute('aria-hidden', 'true');
		row.appendChild(kind);
		row.appendChild(matchSpan('dcs-complete-name', parts.name));
		const detail = el('span', 'dcs-complete-detail');
		if (parts.title.length > 0) {
			detail.appendChild(matchSpan('dcs-complete-title', parts.title));
		}
		if (parts.typeText) {
			detail.appendChild(el('span', 'dcs-complete-type', parts.typeText));
		}
		row.appendChild(detail);
		// Состав определяемого типа: в подсказке наведения и для читалки
		describeComposition(row, typeCompositionOf(entry.item.valueType));
		row.addEventListener('click', () => {
			acceptCompletion(index);
		});
		return row;
	}

	function matchSpan(className, pieces) {
		const span = el('span', className);
		for (const piece of pieces) {
			if (piece.hit) {
				span.appendChild(el('span', 'dcs-complete-hit', piece.text));
			} else {
				span.appendChild(document.createTextNode(piece.text));
			}
		}
		return span;
	}

	function markActiveRow() {
		const session = completeSession;
		const activeRow = session.rows[session.active - session.start] || null;
		for (const row of session.rows) {
			const active = row === activeRow;
			row.classList.toggle('dcs-complete-active', active);
			row.setAttribute('aria-selected', active ? 'true' : 'false');
		}
		if (!activeRow) {
			session.input.removeAttribute('aria-activedescendant');
			return;
		}
		session.input.setAttribute('aria-activedescendant', activeRow.id);
		if (typeof activeRow.scrollIntoView === 'function') {
			activeRow.scrollIntoView({ block: 'nearest' });
		}
	}

	function moveCompletion(index) {
		const session = completeSession;
		if (!session || index < 0) {
			return;
		}
		session.active = index;
		// За пределами нарисованного окна оно сдвигается и перерисовывается, иначе меняется только отметка
		if (completer.windowStart(index, session.start, session.ranked.length, completer.MAX_ROWS) !== session.start) {
			renderCompletion();
			return;
		}
		markActiveRow();
	}

	/**
	 * Вставляет строку index вместо набранного слова и закрывает список. Раскрытый и не перефильтрованный список поля со
	 * списком заменяет всё значение.
	 */
	function acceptCompletion(index) {
		const session = completeSession;
		if (!session) {
			return;
		}
		const entry = session.ranked[index];
		const input = session.input;
		const ctx = session.ctx && session.ctx.whole ? wholeValueContext(input) : caretContext(input);
		closeCompletion();
		if (!entry || ctx.mode === 'none') {
			return;
		}
		replaceCompletionText(input, ctx, completer.applyItem(input.value, ctx, entry.item));
	}

	/** Пишет вставку в поле через writeEditorText. */
	function replaceCompletionText(input, ctx, result) {
		applyingCompletion = true;
		try {
			writeEditorText(input, ctx.replaceStart, ctx.replaceEnd, result.text, result.caret, result.caret);
		} finally {
			applyingCompletion = false;
		}
	}

	/** Ставит список у якоря: под кареткой, у края окна над ней (placePopup модуля). */
	function positionCompletion() {
		const session = completeSession;
		if (!session) {
			return;
		}
		const anchor = completionAnchor(session.binding);
		const listEl = completeList;
		listEl.style.left = '0px';
		listEl.style.top = '0px';
		listEl.style.maxHeight = '';
		listEl.style.minWidth = anchor.width > 0 ? Math.round(anchor.width) + 'px' : '';
		// Размер списка известен только после раскладки: замер в невидимом состоянии
		listEl.style.visibility = 'hidden';
		listEl.classList.remove('hidden');
		const size = { width: listEl.offsetWidth || 0, height: listEl.offsetHeight || 0 };
		const place = completer.placePopup(anchor, size, { width: window.innerWidth || 0, height: window.innerHeight || 0 });
		listEl.style.left = Math.round(place.left) + 'px';
		listEl.style.top = Math.round(place.top) + 'px';
		listEl.style.maxHeight = place.maxHeight < size.height ? Math.floor(place.maxHeight) + 'px' : '';
		listEl.style.visibility = '';
	}

	/**
	 * Якорь списка. У однострочного поля: его нижний край во всю ширину. У редактора кода:
	 * прямоугольник каретки, прижатый к видимой части поля, чтобы прокрученная каретка не утащила
	 * список за край.
	 */
	function completionAnchor(binding) {
		const box = binding.input.getBoundingClientRect();
		if (!binding.editor) {
			return { left: box.left, top: box.top, bottom: box.bottom, width: box.width };
		}
		const caret = caretRect(binding.editor, binding.input);
		if (!caret) {
			return { left: box.left, top: box.top, bottom: box.bottom, width: 0 };
		}
		const top = Math.min(Math.max(caret.top, box.top), box.bottom);
		const bottom = Math.min(Math.max(caret.bottom, top), box.bottom);
		const left = Math.min(Math.max(caret.left, box.left), box.right);
		return { left: left, top: top, bottom: bottom, width: 0 };
	}

	function caretRect(editor, input) {
		const caret = caretOf(input);
		// Перерисовка может и выключить зеркало, если текст перерос лимит
		editor.flush();
		if (!editor.wrap.classList.contains('dcs-hl-off')) {
			return markerRectInMirror(editor.pre, caret);
		}
		return markerRectInClone(input, caret);
	}

	/**
	 * Каретка по метке в зеркале подсветки: у зеркала те же шрифт, отступы, перенос и прокрутка,
	 * что у textarea. Свёрнутый Range в начале строки даёт пустой прямоугольник, поэтому метка:
	 * временный span с U+2060, который не разрешает перенос внутри слова.
	 */
	function markerRectInMirror(pre, offset) {
		let rest = offset;
		let host = null;
		for (const node of Array.from(pre.childNodes)) {
			const textNode = node.nodeType === 3 ? node : node.firstChild;
			const length = node.textContent.length;
			if (rest <= length && textNode && textNode.nodeType === 3) {
				host = textNode;
				break;
			}
			rest -= length;
		}
		if (!host) {
			return null;
		}
		const marker = el('span', '', '⁠');
		const tail = host.splitText(rest);
		tail.parentNode.insertBefore(marker, tail);
		const rect = marker.getBoundingClientRect();
		const parent = marker.parentNode;
		marker.remove();
		// Разрезанный текстовый узел склеивается: зеркало остаётся тем, что нарисовала подсветка
		parent.normalize();
		return rect;
	}

	/** Та же метка на временном клоне textarea: подсветки нет (текст больше лимита). */
	function markerRectInClone(input, offset) {
		if (typeof window.getComputedStyle !== 'function') {
			return null;
		}
		const style = window.getComputedStyle(input);
		const box = input.getBoundingClientRect();
		const clone = el('div', '');
		for (const name of CARET_CLONE_STYLES) {
			clone.style[name] = style[name];
		}
		clone.style.position = 'fixed';
		clone.style.left = box.left + 'px';
		clone.style.top = box.top + 'px';
		clone.style.overflow = 'hidden';
		clone.style.visibility = 'hidden';
		clone.appendChild(document.createTextNode(input.value.slice(0, offset)));
		const marker = el('span', '', '⁠');
		clone.appendChild(marker);
		clone.appendChild(document.createTextNode(input.value.slice(offset) + '\n'));
		document.body.appendChild(clone);
		clone.scrollTop = input.scrollTop;
		clone.scrollLeft = input.scrollLeft;
		const rect = marker.getBoundingClientRect();
		clone.remove();
		return rect;
	}

	// Прокрутка окна или диалога уводит поле из-под списка: пересчитывать дороже, чем закрыть.
	// Прокрутка самого списка его не закрывает, а прокрутка поля лишь сдвигает его к каретке
	document.addEventListener(
		'scroll',
		(event) => {
			const session = completeSession;
			if (!session) {
				return;
			}
			const target = event.target;
			if (target === completeList || (target && typeof target === 'object' && completeList.contains(target))) {
				return;
			}
			if (target === session.input) {
				positionCompletion();
				return;
			}
			closeCompletion();
		},
		true
	);
	window.addEventListener('resize', () => {
		closeCompletion();
	});
	// Щелчок вне поля и списка закрывает список, даже если фокус остался на месте
	document.addEventListener(
		'mousedown',
		(event) => {
			const session = completeSession;
			if (!session) {
				return;
			}
			const target = event.target;
			if (target === session.input || target === session.binding.more || completeList.contains(target)) {
				return;
			}
			closeCompletion();
		},
		true
	);

	// ---------- строка-подсказка у фокуса с клавиатуры ----------

	/**
	 * Строка-подсказка у фокуса с клавиатуры. Название пиктограммы и полное имя обрезанной вертикальной вкладки есть
	 * только в title, а он виден лишь при наведении мыши. При фокусе с клавиатуры (:focus-visible) первая строка title
	 * видна у нижнего края окна. Читалке строка не нужна: у кнопки есть доступное имя.
	 */
	const focusHint = el('div', 'dcs-focus-hint hidden');
	focusHint.setAttribute('aria-hidden', 'true');
	focusHint.style.zIndex = String(dialogRules.POPUP_Z_INDEX + 1);
	document.body.appendChild(focusHint);

	/** Текст строки-подсказки для пиктограммы или вертикальной вкладки с фокусом с клавиатуры; иначе ''. */
	function focusHintText(target) {
		if (!target || typeof target.getAttribute !== 'function' || !target.title) {
			return '';
		}
		const icon = Boolean(target.classList) && target.classList.contains('dcs-icon-btn');
		const verticalTab = target.getAttribute('role') === 'tab' && typeof target.closest === 'function' && Boolean(target.closest('.dcs-qd-vtabs'));
		if (!icon && !verticalTab) {
			return '';
		}
		// Фокус щелчком мышью строку не показывает: мышь и так видит title
		if (typeof target.matches === 'function') {
			try {
				if (!target.matches(':focus-visible')) {
					return '';
				}
			} catch (error) {
				// Движок без :focus-visible: строка показывается при любом фокусе
			}
		}
		return String(target.title).split('\n')[0];
	}

	function hideFocusHint() {
		focusHint.textContent = '';
		focusHint.classList.add('hidden');
	}

	document.addEventListener('focusin', (event) => {
		const text = focusHintText(event && event.target);
		focusHint.textContent = text;
		focusHint.classList.toggle('hidden', !text);
	});
	document.addEventListener('focusout', hideFocusHint);
	document.addEventListener('pointerdown', hideFocusHint, true);

	// ---------- плашка итогов: автозаполнение и проверка схемы ----------

	function hideNotice() {
		noticeEl.className = 'dcs-notice hidden';
		noticeEl.textContent = '';
	}

	/** Показывает плашку с заголовком и строками; tone: ok, error или info. */
	function showNotice(tone, title, lines) {
		noticeEl.textContent = '';
		noticeEl.className = 'dcs-notice dcs-notice-' + tone;
		const head = el('div', 'dcs-notice-head');
		head.appendChild(el('span', 'dcs-notice-title', title));
		// Имя словами: знак «×» читалка в живой области произносит как «умножить»
		head.appendChild(iconButton({ icon: 'delete', name: 'Закрыть плашку', className: 'struct-btn', onClick: hideNotice }));
		noticeEl.appendChild(head);
		for (const line of lines) {
			noticeEl.appendChild(el('div', line.hint ? 'dcs-notice-line dcs-notice-hint' : 'dcs-notice-line', line.text));
		}
	}

	/** Строки плашки по итогу автозаполнения {added, skipped} из ответа мутации. */
	function autofillNoticeLines(result) {
		const added = Array.isArray(result.added) ? result.added : [];
		const skipped = Array.isArray(result.skipped) ? result.skipped : [];
		const lines = [];
		lines.push({ text: added.length > 0 ? 'Добавлено полей: ' + added.length + ' (' + added.join(', ') + ')' : 'Новых полей нет: все поля выборки уже в наборе.' });
		for (const miss of skipped) {
			lines.push({ text: 'Пропущено: ' + (miss.expression || '') + ' (' + (miss.reason || 'причина не названа') + ')' });
		}
		lines.push({ text: 'Типы полей не выводятся: они задаются в свойствах поля.', hint: true });
		return lines;
	}

	/** Строки плашки по ответу dcs/apply-query: запрос записан, объявленные параметры, итог автозаполнения. */
	function queryAppliedNoticeLines(msg) {
		const lines = [{ text: 'Запрос записан.' }];
		if (msg.addedParameters.length > 0) {
			lines.push({ text: 'Объявлены параметры: ' + msg.addedParameters.join(', ') + '. Тип задаётся на вкладке «Параметры».' });
		}
		if (msg.autofill) {
			return lines.concat(autofillNoticeLines(msg.autofill));
		}
		return lines;
	}

	/**
	 * Строки плашки по вердикту строгой проверки: ошибки с позициями или «ошибок нет», затем предупреждения. Предупреждения
	 * на ok не влияют; вид (kind) нужен для подсказок и чтобы назвать связь номером таблицы.
	 */
	function validationNoticeLines(msg) {
		const errors = msg.errors;
		const warnings = msg.warnings;
		let lines;
		if (msg.ok) {
			lines = [{ text: 'Ошибок нет.' }];
		} else if (errors.length === 0) {
			lines = [{ text: 'Схема не прошла проверку, но ошибки валидатор не назвал.' }];
		} else {
			lines = errors.map((error) => {
				const place = typeof error.line === 'number' ? error.line + (typeof error.column === 'number' ? ':' + error.column : '') + ': ' : '';
				return { text: place + (error.message || 'Ошибка без описания') };
			});
		}
		if (warnings.length === 0) {
			return lines;
		}
		lines.push({ text: 'Предупреждения (' + warnings.length + '):' });
		for (const warning of warnings) {
			if (warning.kind === 'linkListFlagWithoutParameter') {
				// Номер связи как в таблице: с единицы, а не с нуля
				lines.push({ text: linkListFlagWarningLine(warning, list('dataSetLinks')) });
				continue;
			}
			lines.push({ text: typeof warning.message === 'string' && warning.message !== '' ? warning.message : 'Предупреждение без описания' });
		}
		if (warnings.some((warning) => warning.kind === 'valueListPresentationsLost')) {
			lines.push({ text: VALIDATION_LIST_PRESENTATIONS_HINT, hint: true });
		}
		if (warnings.some((warning) => warning.kind === 'linkListFlagWithoutParameter')) {
			lines.push({ text: VALIDATION_LINK_LIST_FLAG_HINT, hint: true });
		}
		return lines;
	}

	/**
	 * Подсказка к предупреждению о флажке «Список параметров» у связи без параметра. «Да» таблица связей помечает сама;
	 * «нет» смысла связи не меняет, и окно связи убирает его вместе с правкой.
	 */
	const VALIDATION_LINK_LIST_FLAG_HINT =
		'Связи с отмеченным флажком «Список параметров» без параметра помечены на вкладке «Связи наборов данных»: откройте связь и снимите флажок или задайте параметр. «Нет» без параметра смысла связи не меняет; окно связи убирает его вместе с любой правкой этой связи.';

	/**
	 * Подсказка к предупреждению о списке старой записи. Окна представления не убирают: значение параметра они не правят,
	 * а снятие флажка «Доступен список значений» убирает пометку, но не представления.
	 */
	const VALIDATION_LIST_PRESENTATIONS_HINT =
		'Такие списки помечены и на вкладке «Параметры». Ни окна правки, ни снятие флажка «Доступен список значений» представления не убирают: убрать их можно только записью списка заново без представлений.';

	/** Тон плашки проверки: ошибка, «ошибок нет» или нейтральный при одних предупреждениях. */
	function validationNoticeTone(msg) {
		if (!msg.ok) {
			return 'error';
		}
		return msg.warnings.length > 0 ? 'info' : 'ok';
	}

	/**
	 * Проверка схемы ждёт правку в полёте: jar читает файл макета, а текст запроса пишется по уходу из поля, то есть уже
	 * на нажатии «Проверить схему».
	 */
	let validateQueued = false;

	validateBtn.addEventListener('click', () => {
		if (validating) {
			return;
		}
		validating = true;
		validateBtn.disabled = true;
		flushQueryEdits('nav');
		if (saving) {
			validateQueued = true;
			return;
		}
		post('dcs/validate');
	});

	/** Отложенная проверка схемы, когда канал правок свободен. */
	function runQueuedValidate() {
		if (validateQueued && !saving) {
			validateQueued = false;
			post('dcs/validate');
		}
	}

	// ---------- конструктор запроса ----------

	/** Последнее дерево объектов вкладки: показывается сразу, пока хост отвечает на сверку. */
	let qcGroups = null;
	let qcGroupsError = '';
	let qcGroupsLoading = false;
	/** Дерева нет в кэше хоста, идёт загрузка с нуля: на большой выгрузке это минуты. */
	let qcGroupsCold = false;
	/** Перерисовка открытого уровня конструктора или null. */
	let qcRerender = null;

	/**
	 * Дерево объектов для открытия конструктора. Запрос уходит и при полученном дереве: сверка с кэшем
	 * хоста дешёвая, а без неё объект, добавленный при открытой вкладке, не появился бы. Пока ответа
	 * нет, показывается последнее дерево.
	 */
	function requestMetadataGroups() {
		if (qcGroupsLoading) {
			return;
		}
		qcGroupsLoading = true;
		qcGroupsCold = false;
		if (!qcGroups) {
			qcGroupsError = '';
		}
		post('dcs/list-metadata');
	}

	/**
	 * Таблицы языка запросов объектов (dcs/query-tables) по ключу «язык|путь» на время вкладки: чтение
	 * запускает jar. Язык в ключе: русский и английский ответы называют таблицы и реквизиты по-разному.
	 * Состояния: loading, ready, error (текст в error).
	 */
	const queryTablesCache = new Map();

	function queryTablesKey(relativePath, lang) {
		return (lang === 'en' ? 'en' : 'ru') + '|' + relativePath;
	}

	/** Описание объекта из кэша; если его нет, запрос панели и состояние loading до ответа. */
	function requestQueryTables(relativePath, lang) {
		const key = queryTablesKey(relativePath, lang);
		let entry = queryTablesCache.get(key);
		if (!entry) {
			entry = { state: 'loading' };
			queryTablesCache.set(key, entry);
			post('dcs/query-tables', { relativePath: relativePath, lang: lang === 'en' ? 'en' : 'ru' });
		}
		return entry;
	}

	// ---------- настройки вариантов: кэш ответов dcs/load-variant ----------

	/** Настройки загруженных вариантов по имени (ленивая загрузка dcs/load-variant). */
	const variantCache = {};
	/** Ошибки загрузки вариантов по имени. */
	const variantErrors = {};
	/** Варианты, дерево которых уже развёрнуто при первом показе. */
	const seededVariants = {};
	/** Вариант, ответ dcs/load-variant по которому ещё не пришёл. */
	let variantLoading = '';

	/** Кэш вариантов, которых больше нет в модели (удалены или переименованы), выбрасывается. */
	function pruneVariantCache() {
		const names = list('settingsVariants').map((item) => item.name || '');
		for (const key of Object.keys(variantCache)) {
			if (names.indexOf(key) < 0) {
				delete variantCache[key];
				delete seededVariants[key];
				delete variantErrors[key];
			}
		}
	}

	// ---------- списки и таблицы ----------

	/** Строка списка в общем виде панелей: имя, пояснение и правое значение. */
	function structItem(row) {
		const item = el('div', 'struct-item');
		const nameEl = el('span', 'struct-item-name', row.name || '');
		if (row.hint) {
			nameEl.title = row.hint;
		}
		item.appendChild(nameEl);
		if (row.value) {
			item.appendChild(el('span', 'struct-item-syn', row.value));
		}
		if (row.right) {
			item.appendChild(el('span', 'struct-item-syn ref-selected-mode', row.right));
		}
		return item;
	}

	function listSection(host, rows) {
		const section = el('div', 'struct-list');
		for (const row of rows) {
			section.appendChild(structItem(row));
		}
		host.appendChild(section);
	}

	function dataTable(host, headers) {
		const wrap = el('div', 'dcs-table-wrap');
		const table = el('table', 'dcs-table');
		const thead = document.createElement('thead');
		const headRow = document.createElement('tr');
		for (const header of headers) {
			headRow.appendChild(el('th', '', header));
		}
		thead.appendChild(headRow);
		table.appendChild(thead);
		const tbody = document.createElement('tbody');
		table.appendChild(tbody);
		wrap.appendChild(table);
		host.appendChild(wrap);
		return tbody;
	}

	function cell(tr, text, className) {
		const td = nameEl('td', className, text);
		tr.appendChild(td);
		return td;
	}

	/**
	 * Кнопки строки таблицы через iconButton. action.svg: имя пиктограммы; title: название и доступное имя; unavailable
	 * и note: недоступна, но в обходе Tab, с причиной.
	 */
	function actionsCell(tr, actions) {
		const td = el('td', 'dcs-cell-actions');
		for (const action of actions) {
			const node = iconButton({
				icon: action.svg,
				name: action.title,
				note: action.note,
				onClick: action.onClick,
				disabled: Boolean(action.disabled),
				unavailable: Boolean(action.unavailable),
				className: action.danger ? 'struct-btn struct-btn-danger' : 'struct-btn',
			});
			// Ключ возвращает фокус после перерисовки вкладки
			if (action.key) {
				keyed(node, action.key);
			}
			td.appendChild(node);
		}
		tr.appendChild(td);
	}

	// ---------- тип значения: словарь и подписи ----------

	/** Чистые функции типа (dcs-editor-types.js). */
	const typeRules = window.DcsTypes;

	/**
	 * Словарь окна типа (cf-dcs-type-dictionary) на время вкладки: правки схемы его не меняют,
	 * а чтение запускает jar по всей выгрузке.
	 */
	let typeDictionary = null;
	let typeDictionaryError = '';
	let typeDictionaryLoading = false;
	/** Перерисовка открытого окна типа по приходу словаря; живёт, пока открыт уровень окна. */
	let typeRerender = null;

	function requestTypeDictionary() {
		if (typeDictionary || typeDictionaryLoading) {
			return;
		}
		typeDictionaryLoading = true;
		typeDictionaryError = '';
		post('dcs/type-dictionary');
	}

	/** Подпись типа по модулю типов; без типа готовая строка модели fallback. */
	function typeLabelOf(valueType, fallback) {
		return valueType ? typeRules.typePresentation(valueType, typeDictionary) : fallback || '';
	}

	/**
	 * Состав определяемых типов и характеристик для подсказки и доступного описания: подпись
	 * остаётся «ОпределяемыйТип.X». Без состава пусто.
	 */
	function typeCompositionOf(valueType) {
		return valueType ? typeRules.compositionTitle(valueType, typeDictionary) : '';
	}

	/**
	 * Состав в title (новой строкой к прежней подсказке) и в aria-description: одного title экранный
	 * диктор не читает.
	 */
	function describeComposition(node, composition) {
		if (!composition) {
			return;
		}
		node.title = node.title ? node.title + '\n' + composition : composition;
		node.setAttribute('aria-description', composition);
	}

	// ---------- подписи значений: параметры схемы и настройки ----------

	/** Нулевая дата платформы: такая граница дополнения периода считается пустой. */
	const DCS_ZERO_DATE = '0001-01-01T00:00:00';

	/** Варианты стандартного периода: полный enum StandardPeriodVariant из data-core XSD. */
	const STANDARD_PERIOD_LABELS = {
		Custom: 'Произвольный',
		Today: 'Сегодня',
		ThisWeek: 'Эта неделя',
		ThisTenDays: 'Эта декада',
		ThisMonth: 'Этот месяц',
		ThisQuarter: 'Этот квартал',
		ThisHalfYear: 'Это полугодие',
		ThisYear: 'Этот год',
		FromBeginningOfThisWeek: 'С начала этой недели',
		FromBeginningOfThisTenDays: 'С начала этой декады',
		FromBeginningOfThisMonth: 'С начала этого месяца',
		FromBeginningOfThisQuarter: 'С начала этого квартала',
		FromBeginningOfThisHalfYear: 'С начала этого полугодия',
		FromBeginningOfThisYear: 'С начала этого года',
		Yesterday: 'Вчера',
		LastWeek: 'Прошлая неделя',
		LastTenDays: 'Прошлая декада',
		LastMonth: 'Прошлый месяц',
		LastQuarter: 'Прошлый квартал',
		LastHalfYear: 'Прошлое полугодие',
		LastYear: 'Прошлый год',
		LastWeekTillSameWeekDay: 'Прошлая неделя до этого же дня',
		LastTenDaysTillSameDayNumber: 'Прошлая декада до этого же числа',
		LastMonthTillSameDate: 'Прошлый месяц до этой же даты',
		LastQuarterTillSameDate: 'Прошлый квартал до этой же даты',
		LastHalfYearTillSameDate: 'Прошлое полугодие до этой же даты',
		LastYearTillSameDate: 'Прошлый год до этой же даты',
		Tomorrow: 'Завтра',
		NextWeek: 'Следующая неделя',
		NextTenDays: 'Следующая декада',
		NextMonth: 'Следующий месяц',
		NextQuarter: 'Следующий квартал',
		NextHalfYear: 'Следующее полугодие',
		NextYear: 'Следующий год',
		NextWeekTillSameWeekDay: 'Следующая неделя до этого же дня',
		NextTenDaysTillSameDayNumber: 'Следующая декада до этого же числа',
		NextMonthTillSameDate: 'Следующий месяц до этой же даты',
		NextQuarterTillSameDate: 'Следующий квартал до этой же даты',
		NextHalfYearTillSameDate: 'Следующее полугодие до этой же даты',
		NextYearTillSameDate: 'Следующий год до этой же даты',
		TillEndOfThisWeek: 'До конца этой недели',
		TillEndOfThisTenDays: 'До конца этой декады',
		TillEndOfThisMonth: 'До конца этого месяца',
		TillEndOfThisQuarter: 'До конца этого квартала',
		TillEndOfThisHalfYear: 'До конца этого полугодия',
		TillEndOfThisYear: 'До конца этого года',
		Last7Days: 'Последние 7 дней',
		Next7Days: 'Следующие 7 дней',
		Month: 'Месяц',
	};

	function periodVariantLabel(value) {
		return STANDARD_PERIOD_LABELS[value] || value || '';
	}

	/** Лексическое значение скаляра: разобранное, иначе текст из файла. */
	function valueRaw(value) {
		return value.decoded !== undefined ? String(value.decoded) : value.text || '';
	}

	/** Сводка шрифта по атрибутам файла: имя, начертания и размер. */
	function fontSummary(attrs) {
		const parts = [];
		if (attrs.faceName || attrs.ref) {
			parts.push(attrs.faceName || attrs.ref);
		}
		if (attrs.bold === 'true') {
			parts.push('жирный');
		}
		if (attrs.italic === 'true') {
			parts.push('курсив');
		}
		if (attrs.underline === 'true') {
			parts.push('подчёркнутый');
		}
		if (attrs.strikeout === 'true') {
			parts.push('зачёркнутый');
		}
		if (attrs.height) {
			parts.push(attrs.height);
		}
		return parts.join(' ') || 'как в макете';
	}

	function shortDate(raw) {
		return raw && raw !== DCS_ZERO_DATE ? raw.replace('T', ' ') : '…';
	}

	/** Сводка одного типизированного значения; незнакомый тип показывается только подписью. */
	function valueSummary(value) {
		if (!value) {
			return '';
		}
		if (value.nil) {
			return 'Неопределено';
		}
		if (value.period) {
			let text = periodVariantLabel(value.period.variant);
			if (value.period.variant === 'Custom') {
				text += ': с ' + shortDate(value.period.startDate) + ' по ' + shortDate(value.period.endDate);
			}
			return text;
		}
		if (value.beginningDate) {
			return 'Дата начала: ' + (value.beginningDate.variant || '') + (value.beginningDate.date ? ' ' + shortDate(value.beginningDate.date) : '');
		}
		if (value.list || value.type === 'v8:ValueListType') {
			const rows = value.list && Array.isArray(value.list.items) ? value.list.items : [];
			return 'Список (' + rows.length + '): ' + rows.map((row) => row.presentation || valueSummary(row.value)).join(', ');
		}
		if (value.attrs) {
			return value.type === 'v8ui:Font' ? fontSummary(value.attrs) : (value.type || 'значение') + ' (в конфигураторе)';
		}
		if (value.opaque) {
			return (value.type || 'значение') + ' (в конфигураторе)';
		}
		if (value.type === 'xs:boolean') {
			return valueRaw(value) === 'true' ? 'Истина' : 'Ложь';
		}
		if (value.type === 'xs:dateTime') {
			const raw = valueRaw(value);
			return raw === DCS_ZERO_DATE ? '' : raw.replace('T', ' ');
		}
		return valueRaw(value);
	}

	// ---------- фокус после перерисовки вкладки схемы ----------

	/**
	 * Вкладка схемы рисуется заново после каждой правки. После перерисовки фокус возвращается на узел с тем же ключом
	 * (data-dcs-key), если отрисовка не поставила его сама. Недописанный текст поля, которое правка не меняла,
	 * переезжает в новое поле вместе с выделением.
	 */
	const focusKeys = new Map();
	/** Значение, с которым поле ввода нарисовано: по нему видно, что пользователь начал его править. */
	const renderedValues = new WeakMap();
	/**
	 * Переименование, ждущее ответа, {scope, from, to}: ключи узлов строки содержат имя, и после ответа узел с прежним
	 * ключом ищется под новым.
	 */
	let pendingRename = null;

	/** Ключ узла из частей; перевод строки в именах 1С не встречается. */
	function focusKey(parts) {
		return parts.map((part) => String(part)).join('\n');
	}

	function keyed(node, key) {
		node.setAttribute('data-dcs-key', key);
		focusKeys.set(key, node);
		if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
			renderedValues.set(node, node.value);
		}
		return node;
	}

	function focusKeyed(key) {
		const node = focusKeys.get(key);
		if (node && node.isConnected) {
			node.focus();
		}
	}

	/** Ключ после переименования: вторая часть scope (набор), третья прежнее имя; иначе null. */
	function renamedFocusKey(key, rename) {
		if (!rename || typeof key !== 'string') {
			return null;
		}
		const parts = key.split('\n');
		if (parts.length < 3 || parts[1] !== rename.scope || parts[2] !== rename.from) {
			return null;
		}
		parts[2] = rename.to;
		return parts.join('\n');
	}

	/** Что запомнить о фокусе до перерисовки: ключ, недописанное значение и выделение поля ввода. */
	function captureFocus(roots) {
		const active = document.activeElement;
		if (!active || active === document.body || typeof active.getAttribute !== 'function') {
			return null;
		}
		if (!roots.some((root) => root.contains(active))) {
			return null;
		}
		const key = active.getAttribute('data-dcs-key');
		if (!key) {
			return null;
		}
		const snap = { key: key };
		if ((active.tagName === 'INPUT' && active.type !== 'checkbox') || active.tagName === 'TEXTAREA') {
			snap.value = active.value;
			snap.rendered = renderedValues.has(active) ? renderedValues.get(active) : active.value;
			snap.start = active.selectionStart;
			snap.end = active.selectionEnd;
			snap.scrollTop = active.scrollTop || 0;
		}
		return snap;
	}

	/** Узел по ключу снимка или, если строку переименовали, по ключу с новым именем. */
	function focusTarget(key) {
		const node = focusKeys.get(key);
		if (node && node.isConnected) {
			return node;
		}
		const renamed = renamedFocusKey(key, pendingRename);
		const moved = renamed ? focusKeys.get(renamed) : null;
		return moved && moved.isConnected ? moved : null;
	}

	function restoreFocus(snap) {
		if (!snap) {
			return;
		}
		const now = document.activeElement;
		// Отрисовка сама поставила фокус (дерево наборов после стрелки)
		if (now && now !== document.body && now.isConnected) {
			return;
		}
		const node = focusTarget(snap.key);
		if (!node || node.disabled) {
			return;
		}
		if (snap.value !== undefined && snap.value !== snap.rendered && renderedValues.get(node) === snap.rendered) {
			// Пользователь правил поле, а перерисовка пришла от другой правки: набранное остаётся
			node.value = snap.value;
		}
		node.focus();
		if (snap.start !== undefined && typeof node.setSelectionRange === 'function' && typeof snap.start === 'number') {
			const length = String(node.value).length;
			node.setSelectionRange(Math.min(snap.start, length), Math.min(snap.end, length));
		}
		if (snap.scrollTop) {
			node.scrollTop = snap.scrollTop;
		}
	}

	// ---------- фокус после ответа правки ----------

	/**
	 * Флажки «вернуть фокус после перерисовки» для клавиатуры: стрелка в таблице вариантов или в дереве перерисовывает
	 * вкладку.
	 */
	let focusVariantRow = false;
	let focusStructureRow = false;
	/** Ключ состояния списка панели (listStateKey), строке которого вернуть фокус в этой отрисовке. */
	let focusListPanel = '';
	/**
	 * Фокус, который вернуть после ответа правки с клавиатуры (Delete в списке, переименование варианта). Ставится при
	 * отправке, переходит в флажки отрисовки только с удачным ответом saved и гаснет после неё; отказ и смена варианта,
	 * узла или вкладки его сбрасывают. Иначе флажок сработал бы на чужой отрисовке.
	 */
	const replyFocus = { variant: false, structure: false, list: '', fallback: '', resources: false };
	/** Вернуть фокус на выбранную строку таблицы ресурсов (или «<») после удаления из неё. */
	let focusResourceRow = false;

	function clearReplyFocus() {
		replyFocus.variant = false;
		replyFocus.structure = false;
		replyFocus.list = '';
		replyFocus.fallback = '';
		replyFocus.resources = false;
	}

	/**
	 * Удаление строки кнопкой в строке, когда ключи кнопок по номеру строки: фокус вернётся на ту же кнопку у преемника.
	 * Без преемника запасной фокус: кнопка предыдущей строки, а без строк команда над списком (emptyKey).
	 */
	function rowRemovalFocus(keyOf, index, emptyKey) {
		replyFocus.fallback = index > 0 ? keyOf(index - 1) : emptyKey;
	}

	// ---------- кнопки переноса между списками ----------

	/**
	 * Столбец кнопок переноса между двумя списками (> >> < <<), общий у конструктора запроса и вкладок схемы. Подпись:
	 * знак, смысл в title и aria-label. items: [{label, title, onClick, unavailable?, note?}], поля как у iconButton.
	 * Возвращает {box, buttons}.
	 */
	function transferButtons(host, items) {
		const box = el('div', 'dcs-qd-moves');
		const buttons = items.map((item) => {
			const node = el('button', 'ghost-btn dcs-qd-move', item.label);
			node.type = 'button';
			setTransferState(node, item.title, Boolean(item.unavailable), item.note || '');
			node.addEventListener('click', item.onClick);
			box.appendChild(node);
			return node;
		});
		host.appendChild(box);
		return { box: box, buttons: buttons };
	}

	/** Доступность и подсказка кнопки переноса: меняются без перерисовки (выбор в дереве). */
	function setTransferState(node, title, unavailable, note) {
		node.title = note ? title + '\n' + note : title;
		node.setAttribute('aria-label', title);
		if (note) {
			node.setAttribute('aria-description', spokenReason(note, unavailable));
		} else {
			node.removeAttribute('aria-description');
		}
		if (unavailable) {
			node.setAttribute('aria-disabled', 'true');
		} else {
			node.removeAttribute('aria-disabled');
		}
	}

	// ---------- дерево «Доступные поля» ----------

	/**
	 * Сколько уровней реквизитов по типу раскрывает дерево доступных полей, как конструктор настроек (WIZARD_TYPE_DEPTH);
	 * глубже путь вводится в окне «Добавить поле…».
	 */
	const FIELD_TREE_TYPE_DEPTH = 3;

	/** Ключ строки дерева доступных полей: путь без учёта регистра, как сверяет пути платформа. */
	function fieldTreeKey(path) {
		return String(path || '').toLowerCase();
	}

	/**
	 * Дерево доступных полей по узлам каталога подсказки ({name, path, kind, title, children}; kind: field, calc, folder,
	 * path). Общий компонент вкладок схемы.
	 * - Одна остановка Tab: выбранная строка. ↑ ↓ Home End выбирают без перерисовки, → раскрывает или идёт к первому
	 *   ребёнку, ← сворачивает или идёт к родителю, Enter и двойной щелчок зовут onActivate (повтор зажатого Enter нет).
	 * - Состояние {selected, expanded: Set} у вызывающего (spec.state), поэтому переживает перерисовку вкладки.
	 * spec: {label, nodes, state, keyPrefix, empty, onActivate(node), onSelect?(node), note?(node): пометка строки,
	 * pickable?(node): выбирается ли узел полем (по умолчанию поле набора и вычисляемое; Enter у невыбираемого узла с
	 * детьми раскрывает его), decorate?(row, node), drag?: {id, scope, from?}: дерево как источник и зона переноса,
	 * typeChildren?(node): реквизиты поля по типу {children, pending} или null, requestTypes?(pending): прочитать
	 * недостающие описания}.
	 * Возвращает {element, selected(), select(path, focus), focus(), nodeOf(ключ строки)}.
	 */
	function fieldTree(host, spec) {
		const tree = el('div', 'dcs-tree dcs-qd-tree dcs-field-tree');
		tree.setAttribute('role', 'tree');
		tree.setAttribute('aria-label', spec.label);
		host.appendChild(tree);
		const state = spec.state;
		let rows = [];
		let items = new Map();
		// Строка → ключ и ключ → строка (при первом обращении): перенос и nodeOf узнают узел без обхода строк
		const rowKeys = new WeakMap();
		let rowByKey = null;
		const rowOfKey = (key) => {
			if (!rowByKey) {
				rowByKey = new Map(rows.map((row) => [row.key, row]));
			}
			return rowByKey.get(key);
		};
		const pickable = (node) => (spec.pickable ? spec.pickable(node) : node.kind === 'field' || node.kind === 'calc');
		if (spec.drag) {
			dragZone(tree, {
				id: spec.drag.id,
				scope: spec.drag.scope,
				keyOf: (row) => (rowKeys.has(row) ? rowKeys.get(row) : null),
				drag: (key) => {
					const row = rowOfKey(key);
					return row && pickable(row.node) ? 'field' : '';
				},
				pick: (key) => select(key, false),
				from: spec.drag.from,
				place: 'zone',
			});
		}

		/**
		 * Строки дерева по раскрытым веткам. typeDepth: уровень реквизитов по типу (у узлов каталога 0). У свёрнутого
		 * реквизита стрелку решает его тип (typeExpandable), без подсчёта детей. Реквизиты без описаний дают под раскрытым
		 * полем строку «Загрузка реквизитов…», которая не выбирается.
		 */
		function visibleRows() {
			const out = [];
			const walk = (nodes, depth, parent, typeDepth) => {
				for (const node of nodes || []) {
					const key = fieldTreeKey(node.path);
					const children = typeDepth === 0 && Array.isArray(node.children) ? node.children : [];
					const wanted = state.expanded.has(key);
					let typed = null;
					let typedExpandable = false;
					if (spec.typeChildren && typeDepth < FIELD_TREE_TYPE_DEPTH) {
						if (typeDepth > 0 && !wanted) {
							typedExpandable = node.typeExpandable === true;
						} else {
							typed = spec.typeChildren(node);
							typedExpandable = Boolean(typed) && (typed.children.length > 0 || typed.pending.length > 0);
						}
					}
					const expandable = children.length > 0 || typedExpandable;
					const open = expandable && wanted;
					out.push({ node: node, key: key, depth: depth, parent: parent, expandable: expandable, open: open });
					if (open) {
						walk(children, depth + 1, key, 0);
						if (typed) {
							walk(typed.children, depth + 1, key, typeDepth + 1);
							if (typed.pending.length > 0) {
								out.push({ loading: true, key: key + '#loading', depth: depth + 1, parent: key, pending: typed.pending });
							}
						}
					}
				}
			};
			walk(spec.nodes, 0, '', 0);
			return out;
		}

		function stopKey() {
			return rows.some((row) => row.key === state.selected) ? state.selected : rows.length > 0 ? rows[0].key : '';
		}

		function paint() {
			tree.textContent = '';
			const drawn = visibleRows();
			rows = drawn.filter((row) => !row.loading);
			items = new Map();
			rowByKey = null;
			if (rows.length === 0) {
				tree.tabIndex = -1;
				tree.appendChild(el('div', 'dcs-qd-empty', spec.empty || ''));
				return;
			}
			tree.removeAttribute('tabindex');
			const stop = stopKey();
			let index = -1;
			for (const row of drawn) {
				if (row.loading) {
					// Описания реквизитов ещё читаются: ответ перерисует дерево (spec.requestTypes)
					const info = el('div', 'dcs-tree-row dcs-wizard-row-info', 'Загрузка реквизитов…');
					info.style.paddingLeft = 4 + row.depth * 14 + 'px';
					info.setAttribute('role', 'treeitem');
					info.setAttribute('aria-level', String(row.depth + 1));
					info.setAttribute('aria-disabled', 'true');
					info.tabIndex = -1;
					tree.appendChild(info);
					if (spec.requestTypes) {
						spec.requestTypes(row.pending);
					}
					continue;
				}
				index += 1;
				paintRow(row, index, stop);
			}
		}

		function paintRow(row, index, stop) {
			const node = row.node;
			const selected = row.key === state.selected;
			const item = el('div', 'dcs-tree-row dcs-qd-row' + (selected ? ' dcs-tree-selected' : ''));
			item.setAttribute('role', 'treeitem');
			item.setAttribute('aria-level', String(row.depth + 1));
			item.setAttribute('aria-selected', String(selected));
			if (row.expandable) {
				item.setAttribute('aria-expanded', String(row.open));
			}
			item.tabIndex = row.key === stop ? 0 : -1;
			item.style.paddingLeft = 4 + row.depth * 14 + 'px';
			const calc = node.kind === 'calc';
			const note = spec.note ? spec.note(node) : '';
			const twist = el('span', 'dcs-tree-twist', row.expandable ? (row.open ? '▾' : '▸') : '');
			twist.setAttribute('aria-hidden', 'true');
			twist.addEventListener('click', (event) => {
				event.stopPropagation();
				if (row.expandable) {
					toggle(row, !row.open);
				}
			});
			item.appendChild(twist);
			const label = item.appendChild(nameEl('span', 'dcs-tree-label', node.name || node.path));
			// Полный путь в подсказке у подписи: title строки читалка добавила бы к её имени
			if (node.path && node.path !== (node.name || node.path)) {
				label.title = node.path;
			}
			if (calc) {
				const badge = el('span', 'dcs-field-badge', 'f(x)');
				badge.setAttribute('aria-hidden', 'true');
				badge.title = 'Вычисляемое поле';
				item.appendChild(badge);
			}
			if (node.title && node.title !== node.name) {
				item.appendChild(nameEl('span', 'dcs-tree-name', node.title));
			}
			if (note) {
				item.appendChild(nameEl('span', 'dcs-tree-name', note));
			}
			// Значок «f(x)» скрыт от читалки, его смысл словами
			const spoken = [node.name || node.path];
			if (node.title && node.title !== node.name) {
				spoken.push(node.title);
			}
			if (calc) {
				spoken.push('вычисляемое поле');
			}
			if (note) {
				spoken.push(note);
			}
			item.setAttribute('aria-label', spoken.join(', '));
			keyed(item, focusKey([spec.keyPrefix, row.key]));
			item.addEventListener('click', () => select(row.key, false));
			// Выбор идёт за фокусом: Tab в дерево выбирает строку-остановку, и «>» сразу знает, что переносить
			item.addEventListener('focus', () => {
				if (state.selected !== row.key) {
					select(row.key, false);
				}
			});
			item.addEventListener('dblclick', () => {
				select(row.key, false);
				activate(row);
			});
			item.addEventListener('keydown', (event) => onKey(event, row, index));
			if (spec.decorate) {
				spec.decorate(item, node);
			}
			if (spec.drag) {
				rowKeys.set(item, row.key);
				if (pickable(node)) {
					item.draggable = true;
				}
			}
			items.set(row.key, item);
			tree.appendChild(item);
		}

		function activate(row) {
			if (row.expandable && !pickable(row.node)) {
				// У папки действия нет: Enter раскрывает и сворачивает её, как в остальных деревьях
				toggle(row, !row.open);
				return;
			}
			spec.onActivate(row.node);
		}

		function toggle(row, open) {
			if (open) {
				state.expanded.add(row.key);
			} else {
				state.expanded.delete(row.key);
			}
			state.selected = row.key;
			paint();
			focusRow(row.key);
			if (spec.onSelect) {
				spec.onSelect(row.node);
			}
		}

		function focusRow(key) {
			const item = items.get(key);
			if (item) {
				item.focus();
			}
		}

		/** Выбор без перерисовки: классы, aria-selected и остановка Tab переезжают на новую строку. */
		function select(key, focus) {
			if (!items.has(key)) {
				return;
			}
			state.selected = key;
			for (const [rowKey, item] of items) {
				const on = rowKey === key;
				item.classList.toggle('dcs-tree-selected', on);
				item.setAttribute('aria-selected', String(on));
				item.tabIndex = on ? 0 : -1;
			}
			if (focus) {
				focusRow(key);
			}
			if (spec.onSelect) {
				const row = rows.find((candidate) => candidate.key === key);
				spec.onSelect(row ? row.node : null);
			}
		}

		function onKey(event, row, index) {
			if (event.defaultPrevented) {
				return;
			}
			let to = -1;
			if (event.key === 'ArrowDown') {
				to = Math.min(rows.length - 1, index + 1);
			} else if (event.key === 'ArrowUp') {
				to = Math.max(0, index - 1);
			} else if (event.key === 'Home') {
				to = 0;
			} else if (event.key === 'End') {
				to = rows.length - 1;
			} else if (event.key === 'ArrowRight') {
				event.preventDefault();
				if (row.expandable && !row.open) {
					toggle(row, true);
				} else if (row.open && rows[index + 1] && rows[index + 1].parent === row.key) {
					// Под раскрытым полем может быть только «Загрузка реквизитов…»: шагать некуда
					select(rows[index + 1].key, true);
				}
				return;
			} else if (event.key === 'ArrowLeft') {
				event.preventDefault();
				if (row.open) {
					toggle(row, false);
				} else if (row.parent) {
					select(row.parent, true);
				}
				return;
			} else if (event.key === 'Enter') {
				event.preventDefault();
				// Повтор зажатой клавиши не активирует строку снова: на «Ресурсах» каждое Enter сразу пишет ресурс в файл
				if (event.repeat) {
					return;
				}
				select(row.key, false);
				activate(row);
				return;
			} else {
				return;
			}
			event.preventDefault();
			select(rows[to].key, true);
		}

		paint();
		return {
			element: tree,
			selected: () => {
				const row = rows.find((candidate) => candidate.key === state.selected);
				return row ? row.node : null;
			},
			select: (path, focus) => select(fieldTreeKey(path), Boolean(focus)),
			focus: () => focusRow(stopKey()),
			nodeOf: (key) => {
				const row = rowOfKey(key);
				return row ? row.node : null;
			},
		};
	}

	// ---------- каркас вкладок ----------

	function visibleTabs() {
		return TABS.filter((tab) => tab.always === true || tab.count() > 0);
	}

	function renderTabs() {
		const tabs = visibleTabs();
		if (!tabs.some((tab) => tab.id === activeTabId)) {
			activeTabId = tabs[0] ? tabs[0].id : '';
		}
		// Ярлык с фокусом рисуется заново (число в скобках меняется): фокус остаётся на нём
		const focus = captureFocus([tabsRoot]);
		tabsRoot.textContent = '';
		for (const tab of tabs) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
			// Какая закладка открыта, читалка слышит (класс active виден только глазу)
			if (tab.id === activeTabId) {
				button.setAttribute('aria-current', 'page');
			}
			const count = tab.count();
			button.textContent = count > 0 ? tab.title + ' (' + count + ')' : tab.title;
			keyed(button, focusKey(['tab', tab.id]));
			button.addEventListener('click', () => {
				// Правленый текст запроса записывается до смены закладки
				flushQueryEdits('nav');
				if (tab.id !== activeTabId) {
					// Ответ правки, отправленной с другой закладки, фокус сюда не переносит
					clearReplyFocus();
				}
				activeTabId = tab.id;
				renderTabs();
				renderContent();
			});
			tabsRoot.appendChild(button);
		}
		restoreFocus(focus);
	}

	function renderContent() {
		const focus = captureFocus([contentRoot]);
		closeCompletionWithin(contentRoot);
		renderingContent = true;
		try {
			contentRoot.textContent = '';
		} finally {
			renderingContent = false;
		}
		queryStatusRefresh = null;
		// Ключи ярлыков закладок живут дольше содержимого: их узлы перерисовывает renderTabs
		for (const key of Array.from(focusKeys.keys())) {
			if (!key.startsWith('tab\n')) {
				focusKeys.delete(key);
			}
		}
		const tab = visibleTabs().find((candidate) => candidate.id === activeTabId);
		if (!tab) {
			emptyNote(contentRoot, 'Схема пуста.');
			return;
		}
		tab.render(contentRoot);
		restoreFocus(focus);
	}

	// Ответы во время переноса мышью ждут его конца (whenIdle)
	window.addEventListener('message', (event) => whenIdle(() => onHostMessage(event)));

	function onHostMessage(event) {
		const msg = event.data;
		if (!msg || typeof msg !== 'object') {
			return;
		}
		if (msg.type === 'validation') {
			// Вердикт строгой проверки схемы
			validating = false;
			validateBtn.disabled = false;
			if (msg.error) {
				showNotice('error', 'Проверка схемы', [{ text: String(msg.error) }]);
				return;
			}
			showNotice(validationNoticeTone(msg), 'Проверка схемы', validationNoticeLines(msg));
			return;
		}
		if (msg.type === 'metadata') {
			// Ответ конструктору запроса: дерево объектов
			if (msg.loading) {
				// Дерева нет и в кэше хоста: загрузка идёт с нуля, готовое дерево придёт следующим ответом
				qcGroupsCold = true;
			} else {
				qcGroupsLoading = false;
				qcGroupsCold = false;
				if (msg.error) {
					qcGroupsError = String(msg.error);
				} else {
					qcGroups = Array.isArray(msg.groups) ? msg.groups : [];
					qcGroupsError = '';
				}
			}
			rerenderSoon(qcRerender);
			// Дерево знает, каких объектов нет в конфигурации: строке проверки имён набора это нужно
			scheduleNameCheck();
			return;
		}
		if (msg.type === 'queryTables') {
			// Таблицы объекта для конструктора; «вне выгрузки» и ошибка дают «описания нет» без
			// повтора до нового открытия вкладки
			if (typeof msg.relativePath === 'string' && msg.relativePath !== '') {
				const ready = !msg.error && !msg.outside && msg.description && typeof msg.description === 'object';
				// Составы привязываются до обоих кэшей: описание в них одно
				const description = ready ? withTypeCompositions(msg.description) : null;
				queryTablesCache.set(
					queryTablesKey(msg.relativePath, msg.lang),
					ready
						? { state: 'ready', description: description }
						: { state: 'error', error: String(msg.error || msg.note || 'Таблицы объекта не прочитаны.') }
				);
				// Тот же ответ нужен подсказке через точку (кэш описаний): второе чтение jar не нужно
				const key = ready ? fieldTypes.answerKeyOf({ queryTable: description.object, lang: msg.lang }) : '';
				const known = key ? describeCache.get(key) : null;
				if (key && (!known || known.state === 'loading')) {
					describeCache.set(key, { state: 'ready', description: description });
					describeStamp++;
				}
			}
			rerenderSoon(qcRerender);
			scheduleNameCheck();
			return;
		}
		if (msg.type === 'typeDictionary') {
			// Ошибка словаря показывается в окне типа, повтор её кнопкой
			typeDictionaryLoading = false;
			if (msg.error) {
				typeDictionaryError = String(msg.error);
			} else if (msg.dictionary && typeof msg.dictionary === 'object') {
				typeDictionary = msg.dictionary;
				typeDictionaryError = '';
			} else {
				typeDictionaryError = 'Ответ словаря типов не разобран.';
			}
			rerenderSoon(typeRerender);
			return;
		}
		if (msg.type === 'describeType') {
			// Описание объекта для подсказки через точку. «Вне выгрузки» гасит дальнейшие запросы,
			// ошибка и ненайденный объект дают «описания нет» без повторов
			if (msg.outside) {
				describeOutside = true;
			}
			const key = fieldTypes.answerKeyOf(msg);
			if (key) {
				const ready = !msg.error && msg.description && typeof msg.description === 'object';
				describeCache.set(key, ready ? { state: 'ready', description: withTypeCompositions(msg.description) } : { state: 'none' });
				describeStamp++;
			}
			onDescribed();
			// Раскрытое поле доступных полей ждало реквизитов: вкладка «Настройки» перерисовывается
			if (settingsTypeWaiting) {
				settingsTypeWaiting = false;
				if (activeTabId === 'variants') {
					rerenderSoon(renderContent);
				}
			}
			// Поля источников конструктора запроса берутся из того же кэша описаний
			rerenderSoon(qcRerender);
			// По тому же кэшу проверяются имена текста набора
			scheduleNameCheck();
			return;
		}
		if (msg.type === 'variant') {
			// Ответ ленивой загрузки настроек варианта
			if (typeof msg.variant !== 'string' || msg.variant === '') {
				return;
			}
			if (variantLoading === msg.variant) {
				variantLoading = '';
			}
			if (msg.error) {
				variantErrors[msg.variant] = String(msg.error);
			} else {
				variantCache[msg.variant] = msg.settings;
				delete variantErrors[msg.variant];
			}
			if (activeTabId === 'variants') {
				renderContent();
			}
			return;
		}
		if (msg.type !== 'saved') {
			return;
		}
		onSaved(msg);
		// Проверка схемы, отложенная до конца правки (validateQueued), уходит, когда канал свободен
		runQueuedValidate();
	}

	/** Ответ правки (saved): фоновой записи текста запроса или правки пользователя. */
	function onSaved(msg) {
		saving = false;
		if (background) {
			// Правки идут по одной, так что в полёте была фоновая запись
			onBackgroundSaved(msg);
			return;
		}
		// Отказ пакета «>>» называет поле, а не номер операции
		const refusal = msg.ok ? '' : resourceRefusalText(resourceReply, msg.error);
		setStatus(msg.ok ? 'Сохранено' : String(refusal || 'Ошибка сохранения'), !msg.ok);
		// Правка со страницы (origin null) окон, открытых после неё, не закрывает
		const origin = editOrigin;
		editOrigin = null;
		const fromDialog = Boolean(origin && origin.isOpen());
		if (msg.ok) {
			// Модель перечитана целиком: формы закрываются, вкладки перерисовываются
			if (fromDialog) {
				closeDialog();
			}
			if (Array.isArray(msg.addedParameters)) {
				// Ответ конструктора запроса: запрос записан, какие параметры объявлены, итог автозаполнения
				showNotice('ok', 'Конструктор запроса', queryAppliedNoticeLines(msg));
			} else if (msg.autofill) {
				// Итог автозаполнения: что добавлено, что пропущено и почему
				showNotice('ok', 'Заполнение из запроса', autofillNoticeLines(msg.autofill));
			}
			if (msg.settings && msg.settings.variant) {
				// Правка настроек: кэш затронутого варианта обновляется, вариант становится активным
				if (msg.settings.variant !== uiState.variant) {
					uiState.variant = msg.settings.variant;
					uiState.nodePath = [];
					uiState.panel = 'selection';
				}
				variantCache[msg.settings.variant] = msg.settings.data || {};
				delete variantErrors[msg.settings.variant];
			} else if (pendingVariant) {
				// Настройки не перечитались вместе с правкой: вариант перезагрузится лениво
				delete variantCache[pendingVariant];
			}
			if (pendingSelect) {
				uiState.nodePath = pendingSelect;
				expandTo(pendingSelect);
			}
			pendingVariant = '';
			pendingSelect = null;
			pendingPathCommit = null;
			// Фокус после правки с клавиатуры действует только в отрисовке этого ответа
			focusVariantRow = replyFocus.variant;
			focusStructureRow = replyFocus.structure;
			focusListPanel = replyFocus.list;
			focusResourceRow = replyFocus.resources;
			const fallbackFocus = replyFocus.fallback;
			clearReplyFocus();
			// Добавленный ресурс: выбрана его строка, итог плашкой после отрисовки
			const resourceDone = resourceReply;
			resourceReply = null;
			if (resourceDone) {
				resourceUi.selected = resourceDone.row;
			}
			if (msg.model) {
				model = withTypeCompositions(msg.model);
				pruneVariantCache();
				// Окно конструктора могло записать текст набора поверх черновика: черновик уступает
				reconcileQueryDrafts();
				// Набранный в ячейке путь поля, которого больше нет (переименовано окном, удалено, набор переименован), забывается
				pruneFieldPathDrafts();
				renderTabs();
				renderContent();
			} else if (activeTabId === 'variants') {
				renderContent();
			}
			// Без вариантов фокус на «Добавить вариант…» ставит renderVariants, ярлык закладки его не забирает
			if (fallbackFocus && (!document.activeElement || document.activeElement === document.body)) {
				// Кнопки удалённой последней строки нет: фокус на запасной цели
				focusKeyed(fallbackFocus);
			}
			// Плашка по модели ответа: описания типов могли прийти за время сохранения
			const resourceNotice = resourceDone ? resourceReplyNotice(resourceDone) : null;
			if (resourceNotice) {
				showNotice(resourceNotice.tone, 'Ресурсы', resourceNotice.lines);
			}
			// Флажки не ждут следующей, чужой отрисовки
			focusVariantRow = false;
			focusStructureRow = false;
			focusListPanel = '';
			focusResourceRow = false;
			pendingRename = null;
			pendingDataSet = '';
			retryQueryDrafts();
			return;
		}
		pendingVariant = '';
		pendingSelect = null;
		pendingDataSet = '';
		pendingRename = null;
		// Ресурс не добавлен: выбор прежний, причину скажет отказ
		resourceReply = null;
		// Фокус после удаления клавишей ждал удачного ответа
		clearReplyFocus();
		// Отказ правки из окна показывается в верхнем окне
		if (fromDialog) {
			dialogStack.top().setError(String(msg.error || 'Ошибка сохранения'));
		}
		const pathCommit = pendingPathCommit;
		pendingPathCommit = null;
		if (pathCommit) {
			// Путь из ячейки не принят: причина под ячейкой, набранное остаётся. Уход из ячейки тот же путь заново не
			// шлёт, Enter шлёт
			const problem = 'Не переименовано: ' + String(msg.error || 'ошибка сохранения');
			fieldPathDrafts.set(pathCommit.draftKey, { text: pathCommit.value, problem: problem, refused: true });
			renderContent();
			// Строка под ячейкой рисуется заново уже с текстом, а такую живая область не объявляет
			announceCompletion(problem);
		} else if (!fromDialog) {
			// Правка со страницы или из закрытого окна: элементы возвращаются к модели, а причину объявляет живая
			// область подсказки, потому что строка состояния ею не является
			renderContent();
			// Отказ «>>» уже начат словами «Ресурсы не добавлены»: «Не сохранено» не нужно
			announceCompletion(refusal !== msg.error ? String(refusal) : 'Не сохранено: ' + String(msg.error || 'ошибка сохранения'));
		}
		retryQueryDrafts();
	}

	// ---------- API для конструктора запроса ----------

	/** Конструктору запроса дерево «База данных» доступно, когда макет внутри выгрузки (признак стартовой модели). */
	const metadataAvailable = Boolean(model && model.queryConstructor);

	/** Язык таблицы по имени её вида: имена ВТ и суффиксы полей сверяются с описанием на том же языке. */
	function tableLangOf(tableName) {
		const head = String(tableName || '').split('.')[0].toUpperCase();
		return fieldTypes.OBJECT_KINDS.some((kind) => kind.en.toUpperCase() === head) ? 'en' : 'ru';
	}

	/**
	 * Тип колонки X общей таблицы констант: тип поля «Значение» таблицы `Константа.X`, если её описание
	 * уже в кэше вкладки. Запроса здесь нет.
	 */
	function constantValueType(tableName, column) {
		const own = fieldTypes.constantColumnTable(tableName, column);
		const target = own ? fieldTypes.tableObjectOf(own.table, own.lang) : null;
		const description = target ? describeLookup(target.key) : null;
		const field = description ? fieldTypes.findField(fieldTypes.findTable(description, target.tail), own.field) : null;
		return field && field.type ? field.type : null;
	}

	/** Последняя собранная таблица констант: дерево, язык и отметка кэша описаний, по которым она собрана. */
	let constantsTableMemo = null;

	/**
	 * Общая таблица констант (`Константы` / `Constants`): своего описания у неё нет, и она собирается из
	 * ветки констант дерева «База данных», по полю на константу. Описания всех констант не запрашиваются:
	 * их тысячи, а описание своей константы просит тот, кому нужен её тип. Пока дерева нет: loading.
	 * Сборка запоминается до смены дерева и кэша описаний: таблицу спрашивают на каждую перерисовку.
	 */
	function constantsQueryTable(tableName) {
		if (!Array.isArray(qcGroups)) {
			if (qcGroupsError) {
				return { state: 'none' };
			}
			requestMetadataGroups();
			return { state: 'loading' };
		}
		const lang = String(tableName || '').trim().toUpperCase() === 'CONSTANTS' ? 'en' : 'ru';
		const memo = constantsTableMemo;
		if (memo && memo.groups === qcGroups && memo.lang === lang && memo.stamp === describeStamp) {
			return memo.answer;
		}
		const group = qcGroups.find((item) => item && item.objectType === 'Constant');
		const name = lang === 'en' ? 'Constants' : 'Константы';
		const fields = (group && Array.isArray(group.items) ? group.items : [])
			.filter((item) => item && typeof item.name === 'string' && item.name !== '')
			.map((item) => ({
				name: item.name,
				nameEn: item.name,
				kind: 'constant',
				type: constantValueType(name, item.name),
				synonym: typeof item.synonym === 'string' && item.synonym !== item.name ? item.synonym : '',
			}));
		const table = { name: name, kind: 'main', synonym: name, params: [], fields: fields };
		const answer = { state: 'ready', table: table, description: { object: name, kind: 'constants', tables: [table] } };
		constantsTableMemo = { groups: qcGroups, lang: lang, stamp: describeStamp, answer: answer };
		return answer;
	}

	/**
	 * Таблица языка запросов из кэша описаний; если её нет, запрос панели и loading, ответ перерисует
	 * открытый конструктор. Общую таблицу констант собирает constantsQueryTable.
	 */
	function describeQueryTable(tableName) {
		if (!metadataAvailable) {
			return { state: 'none' };
		}
		if (fieldTypes.isConstantsTable(tableName)) {
			return constantsQueryTable(tableName);
		}
		const target = fieldTypes.tableObjectOf(tableName, tableLangOf(tableName));
		if (!target) {
			return { state: 'none' };
		}
		const description = describeLookup(target.key);
		if (description === undefined) {
			requestDescriptions([target]);
			return { state: 'loading' };
		}
		const table = description ? fieldTypes.findTable(description, target.tail) : null;
		return table ? { state: 'ready', table: table, description: description } : { state: 'none' };
	}

	/** Дети ссылочного типа (раскрытие поля для разыменования): недостающие описания запрашиваются сразу. */
	function queryTypeChildren(valueType) {
		if (!valueType) {
			return { children: [], loading: false };
		}
		const result = fieldTypes.typeChildren(valueType, describeLookup, { typeText: (type) => typeLabelOf(type, '') });
		if (result.pending.length > 0) {
			requestDescriptions(result.pending);
		}
		return { children: result.children, loading: result.pending.length > 0 };
	}

	/**
	 * Тип колонки запроса пакета (у временной таблицы по запросу, который её создал); недостающие
	 * описания запрашиваются.
	 */
	function queryBatchColumnType(batch, statementIndex, column) {
		if (!metadataAvailable) {
			return { type: null, loading: false };
		}
		const result = fieldTypes.batchColumnType(batch, statementIndex, column, describeLookup, { queryModel: queryModelApi });
		if (result.pending.length > 0) {
			requestDescriptions(result.pending);
		}
		return { type: result.type, loading: result.pending.length > 0 };
	}

	/** Итог вывода типа для конструктора; недостающие описания запрашиваются у панели. */
	function queryTypeAnswer(result) {
		if (result.pending.length > 0) {
			requestDescriptions(result.pending);
		}
		return { type: result.type, loading: result.pending.length > 0 };
	}

	/**
	 * Тип выражения в части запроса (деление «>>» на «Группировке» по типу, сумма нечислового поля).
	 * address: {statement, part}; outerTemp: ВТ внешнего пакета у вложенного конструктора.
	 * metadataAvailable не проверяется: описания читаются и в проекте 1C:EDT, а с проверкой деление «>>»
	 * там писало бы СУММА(Т.Ссылка). Макет вне выгрузки хост узнаёт сам, и тогда типа нет.
	 */
	function queryPartExpressionType(batch, address, expr, outerTemp) {
		const where = address || {};
		const statement = batch && Array.isArray(batch.statements) ? batch.statements[where.statement] : null;
		const part = statement && Array.isArray(statement.parts) ? statement.parts[where.part] : null;
		if (!part) {
			return { type: null, loading: false };
		}
		return queryTypeAnswer(fieldTypes.partExpressionType(batch, where.statement, part, expr, describeLookup, { queryModel: queryModelApi, outerTemp: outerTemp }));
	}

	/** Тип колонки вложенного запроса части: поля подзапроса раскрываются и связываются по типу, как у ВТ. */
	function querySubqueryColumnType(batch, statementIndex, subquery, column, outerTemp) {
		if (!metadataAvailable) {
			return { type: null, loading: false };
		}
		return queryTypeAnswer(fieldTypes.subqueryColumnType(batch, statementIndex, subquery, column, describeLookup, { queryModel: queryModelApi, outerTemp: outerTemp }));
	}

	// ---------- проверка имён запроса по метаданным ----------

	/**
	 * Проверка имён доступна, когда макет внутри выгрузки и выгрузка не расширение: описания заимствованных
	 * объектов несут только заимствованные реквизиты, и проверка давала бы ложные предупреждения.
	 */
	const nameCheckAvailable = metadataAvailable && !(model && model.configurationExtension);

	/**
	 * Общие реквизиты выгрузки (только в стартовой модели): описания перечисляют их не у всех таблиц, поэтому о них
	 * проверка имён молчит.
	 */
	const nameCheckCommonAttributes = model && Array.isArray(model.configurationCommonAttributes) ? model.configurationCommonAttributes.slice() : [];

	/** Имена объектов дерева «База данных» по видам без учёта регистра; собирается заново с новым деревом. */
	let treeObjectIndex = null;

	/**
	 * Есть ли объект в дереве «База данных»; null, если дерева нет, вид неизвестен или ветки вида нет:
	 * утверждать «нет объекта» тогда нельзя.
	 */
	function treeObjectExists(kindRu, name) {
		if (!Array.isArray(qcGroups)) {
			return null;
		}
		if (!treeObjectIndex || treeObjectIndex.groups !== qcGroups) {
			const byType = new Map();
			for (const group of qcGroups) {
				if (group && typeof group.objectType === 'string') {
					const items = Array.isArray(group.items) ? group.items : [];
					byType.set(group.objectType, new Set(items.map((item) => String((item && item.name) || '').toUpperCase())));
				}
			}
			treeObjectIndex = { groups: qcGroups, byType: byType };
		}
		const kind = fieldTypes.OBJECT_KINDS.find((item) => item.ru === kindRu);
		const names = kind ? treeObjectIndex.byType.get(kind.en) : undefined;
		return names ? names.has(String(name || '').toUpperCase()) : null;
	}

	/**
	 * Предупреждения проверки имён модели запроса по кэшу описаний. outerTemp: ВТ внешнего пакета.
	 * options.quiet: строка под текстом набора, ради неё дерево «База данных» не грузится (холодная
	 * загрузка занимает минуты). options.ask: запрашивать ли недостающие описания: true, 'later' (после
	 * отрисовки, только для сохранённого текста) или false. Без проверки пустой список.
	 */
	function queryNameProblems(queryModel, outerTemp, options) {
		if (!nameCheckAvailable || !queryModel) {
			return [];
		}
		const quiet = Boolean(options && options.quiet);
		const env = fieldTypes.nameCheckEnv(describeLookup, {
			queryModel: queryModelApi,
			outerTemp: Array.isArray(outerTemp) ? outerTemp : [],
			objectExists: treeObjectExists,
			commonAttributes: nameCheckCommonAttributes,
			constants: (tableName) => (quiet && !Array.isArray(qcGroups) ? { state: 'none' } : constantsQueryTable(tableName)),
		});
		const problems = queryEditApi.nameProblems(queryModel, env);
		const ask = options && options.ask !== undefined ? options.ask : true;
		if (env.pending.length > 0 && ask === 'later') {
			// Запросы строки набора уходят после отрисовки; уже запрошенное другими повторно не шлётся
			const pending = env.pending.slice();
			setTimeout(() => requestDescriptions(pending), HIGHLIGHT_DEBOUNCE_MS);
		} else if (env.pending.length > 0 && ask) {
			requestDescriptions(env.pending);
		}
		return problems;
	}

	// ---------- закладки ----------

	/**
	 * Объект ядра для фабрик закладок (DcsEditorSchema, DcsEditorSettings, DcsEditorSettingsPanels): других имён этого
	 * скрипта закладки не видят. Изменяемое общее состояние отдаётся аксессорами get/set, чтобы закладки писали в
	 * core.model, а не в копию.
	 */
	const core = Object.freeze({
		actionsCell, actionSelect, announceCompletion, attachCompletion, autofillNoticeLines, browseSelect, BUSY,
		calculatedFieldPaths, cell, checkbox, checkRow, clearReplyFocus, closeDialog, codeEditor, completer,
		completionCatalog, completionTypeOptions, confirmRemove, dataSetFieldPaths, dataSetNames, dataTable, DCS_ZERO_DATE,
		describeComposition, describeLookup, dragZone, dropIndex, editBusy, el, emptyNote, expressionInput, fieldPaths,
		fieldTree, fieldTreeKey, fieldTypes, FOCUSABLE, focusKey, focusKeyed, focusKeys, formRow, groupTitle,
		HIGHLIGHT_DEBOUNCE_MS, iconButton, itemAtPos, itemsDropSlot, itemsIndentSlot, itemsInsert, itemsLevel, itemsMove,
		itemsOutdentSlot, keyed, kindLabel, list, listDropSlot, listSection, listToolbar, nameCheckAvailable, nameEl,
		nameTaken, numberInput, openDialog, openWideDialog, parseQueryCached, post, postEdit, pruneVariantCache, pushDialog,
		queryModelApi, queryNameProblems, renderContent, renderTabs, replyFocus, requestDescriptions, requestTypeDictionary,
		rowRemovalFocus, seededVariants, selectInput, send, setHint, setIconState, setNameText, setStatus, setTransferState,
		showNotice, STANDARD_PERIOD_LABELS, suggestName, tableDropZone, textInput, transferButtons, typeChildrenEnv,
		typeCompositionOf, typeLabelOf, typeRules, valueRaw, valueSummary, variantCache, variantErrors, whenIdle,
		withTypeCompositions,
		get background() {
			return background;
		},
		set background(value) {
			background = value;
		},
		get deferred() {
			return deferred;
		},
		set deferred(value) {
			deferred = value;
		},
		get describeStamp() {
			return describeStamp;
		},
		get editOrigin() {
			return editOrigin;
		},
		set editOrigin(value) {
			editOrigin = value;
		},
		get focusListPanel() {
			return focusListPanel;
		},
		set focusListPanel(value) {
			focusListPanel = value;
		},
		get focusResourceRow() {
			return focusResourceRow;
		},
		set focusResourceRow(value) {
			focusResourceRow = value;
		},
		get focusStructureRow() {
			return focusStructureRow;
		},
		set focusStructureRow(value) {
			focusStructureRow = value;
		},
		get focusVariantRow() {
			return focusVariantRow;
		},
		set focusVariantRow(value) {
			focusVariantRow = value;
		},
		get model() {
			return model;
		},
		set model(value) {
			model = value;
		},
		get pendingDataSet() {
			return pendingDataSet;
		},
		set pendingDataSet(value) {
			pendingDataSet = value;
		},
		get pendingPathCommit() {
			return pendingPathCommit;
		},
		set pendingPathCommit(value) {
			pendingPathCommit = value;
		},
		get pendingRename() {
			return pendingRename;
		},
		set pendingRename(value) {
			pendingRename = value;
		},
		get pendingSelect() {
			return pendingSelect;
		},
		set pendingSelect(value) {
			pendingSelect = value;
		},
		get queryStatusRefresh() {
			return queryStatusRefresh;
		},
		set queryStatusRefresh(value) {
			queryStatusRefresh = value;
		},
		get renderingContent() {
			return renderingContent;
		},
		get resourceReply() {
			return resourceReply;
		},
		set resourceReply(value) {
			resourceReply = value;
		},
		get saving() {
			return saving;
		},
		get settingsTypeWaiting() {
			return settingsTypeWaiting;
		},
		set settingsTypeWaiting(value) {
			settingsTypeWaiting = value;
		},
		get typeDictionary() {
			return typeDictionary;
		},
		get typeDictionaryError() {
			return typeDictionaryError;
		},
		set typeDictionaryError(value) {
			typeDictionaryError = value;
		},
		get typeRerender() {
			return typeRerender;
		},
		set typeRerender(value) {
			typeRerender = value;
		},
		get variantLoading() {
			return variantLoading;
		},
		set variantLoading(value) {
			variantLoading = value;
		},
		get wizardRerender() {
			return wizardRerender;
		},
		set wizardRerender(value) {
			wizardRerender = value;
		},
	});

	// Модули закладок подключены до этого скрипта и только задали фабрики: закладки создаются, когда объявлено всё
	// для объекта ядра
	const schemaTabs = window.DcsEditorSchema(core);
	const settingsTab = window.DcsEditorSettings(core);
	const {
		fieldPathDrafts, flushQueryEdits, linkListFlagWarningLine, onBackgroundSaved, pruneFieldPathDrafts,
		reconcileQueryDrafts, renderCalculated, renderDataSets, renderLinks, renderNested, renderParameters, renderResources,
		resourceRefusalText, resourceReplyNotice, resourceUi, retryQueryDrafts, scheduleNameCheck,
	} = schemaTabs;
	const { activeVariantName, affectedVariant, expandTo, renderVariants, uiState } = settingsTab;

	/** Вкладки в порядке конфигуратора; редактируемые видны всегда, остальные, пока не пусты. */
	const TABS = [
		{ id: 'dataSets', title: 'Наборы данных', count: () => list('dataSets').length, render: renderDataSets, always: true },
		{ id: 'links', title: 'Связи наборов данных', count: () => list('dataSetLinks').length, render: renderLinks, always: true },
		{
			id: 'calculated',
			title: 'Вычисляемые поля',
			count: () => list('calculatedFields').length,
			render: renderCalculated,
			always: true,
		},
		{ id: 'resources', title: 'Ресурсы', count: () => list('totalFields').length, render: renderResources, always: true },
		{ id: 'parameters', title: 'Параметры', count: () => list('parameters').length, render: renderParameters, always: true },
		{ id: 'nested', title: 'Вложенные схемы', count: () => list('nestedSchemas').length, render: renderNested },
		{ id: 'variants', title: 'Настройки', count: () => list('settingsVariants').length, render: renderVariants, always: true },
	];

	/**
	 * API редактора для конструктора запроса (dcs-editor-query-dialog.js): он подключается после этого скрипта и видит
	 * только этот объект.
	 * - формы: el, formRow, textInput, selectInput, checkbox, codeEditor, attachCompletion, iconButton,
	 *   transferButtons; drag.zone (dragZone) и drag.index (dropIndex);
	 * - окна: pushDialog(spec);
	 * - канал: send(type, fields), false, если предыдущая правка ещё сохраняется (текст busyText); isSaving(): новая
	 *   правка получила бы отказ. Ответ saved закрывает все окна или показывает отказ в верхнем;
	 * - данные: model(), typeLabel(valueType); metadata.available() / request() / retry() / state(): дерево «База
	 *   данных»; queryTables(relativePath, lang); describeTable(имяТаблицы): {state: ready|loading|none, table};
	 *   typeChildren(valueType): {children, loading}; expandable(valueType); batchColumnType, partExpressionType и
	 *   subqueryColumnType (queryBatchColumnType и соседние): {type, loading}; nameProblems(модельЗапроса,
	 *   внешниеВТ?): вне выгрузки и в расширении пустой список;
	 * - перерисовка: setRerender(fn) / clearRerender(fn): fn зовётся на каждый ответ дерева, таблиц и описаний, пока
	 *   конструктор открыт.
	 */
	window.DcsEditorApi = Object.freeze({
		el: el,
		formRow: formRow,
		textInput: textInput,
		selectInput: selectInput,
		checkbox: checkbox,
		codeEditor: codeEditor,
		attachCompletion: attachCompletion,
		iconButton: iconButton,
		transferButtons: transferButtons,
		drag: Object.freeze({
			zone: dragZone,
			index: dropIndex,
		}),
		pushDialog: pushDialog,
		send: send,
		busyText: BUSY,
		isSaving: editBusy,
		model: () => model,
		typeLabel: (valueType) => typeLabelOf(valueType, ''),
		metadata: Object.freeze({
			available: () => metadataAvailable,
			request: requestMetadataGroups,
			retry: () => {
				qcGroups = null;
				qcGroupsError = '';
				requestMetadataGroups();
			},
			state: () => ({ groups: qcGroups, error: qcGroupsError, loading: qcGroupsLoading, cold: qcGroupsCold }),
		}),
		queryTables: requestQueryTables,
		describeTable: describeQueryTable,
		typeChildren: queryTypeChildren,
		batchColumnType: queryBatchColumnType,
		partExpressionType: queryPartExpressionType,
		subqueryColumnType: querySubqueryColumnType,
		nameProblems: (queryModel, outerTemp) => queryNameProblems(queryModel, outerTemp),
		expandable: (valueType) => Boolean(valueType && fieldTypes.expandable(valueType)),
		setRerender: (fn) => {
			qcRerender = fn;
		},
		clearRerender: (fn) => {
			if (qcRerender === fn) {
				qcRerender = null;
			}
		},
	});

	renderTabs();
	renderContent();
})();
