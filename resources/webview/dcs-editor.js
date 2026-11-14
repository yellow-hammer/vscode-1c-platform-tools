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
	 * Фоновая запись текста запроса набора по концу правки: {key, text, autofill, stage: 'text' | 'fill'}; null — не
	 * идёт. Её ответ не закрывает окна и не пишет отказ в окно: запись была не их.
	 */
	let background = null;
	/** Правка пользователя, пришедшая во время фоновой записи: уходит следом за ней, а не получает «ещё сохраняется». */
	let deferred = null;
	/**
	 * Окно, из которого ушла правка в полёте (null — со страницы): удачный ответ закрывает окна, только если оно ещё
	 * открыто, а отказ пишется в окно, только если правка ушла из него. Правка со страницы, ждавшая фоновой записи
	 * текста запроса, не закрывает окно, открытое уже после неё (конструктор запроса, окно строки).
	 */
	let editOrigin = null;
	/** Проверка схемы в полёте: повторный запрос не шлётся, пока не пришёл ответ validation. */
	let validating = false;
	/** Набор, который выбрать после ответа правки: новый или переименованный. */
	let pendingDataSet = '';
	/** Путь из ячейки, ответ на который ещё не пришёл: {draftKey, value} — отказ md-sparrow покажется под ячейкой. */
	let pendingPathCommit = null;

	/**
	 * Итог правки «Ресурсов», который применить после ответа saved: row — строка таблицы, которую выбрать (новый ресурс
	 * встаёт в конец); add {path, kind, expression} — ресурс «>» (плашку соберёт resourceReplyNotice по модели ответа);
	 * batch {add, unknown, unsafe} — план «>>» (плашка и имя поля в отказе); без них — окно «Новый ресурс», плашки нет.
	 * Отказ итог сбрасывает: выбор остаётся прежним, причину объявляет общий ответ отказа.
	 */
	let resourceReply = null;
	/** Вариант правки в полёте: если ответ saved не принёс его настройки, кэш сбрасывается. */
	let pendingVariant = '';
	/** Путь узла, который выделить после удачной правки структуры. */
	let pendingSelect = null;

	const BUSY = 'Предыдущая правка ещё сохраняется.';

	/** Открытая закладка: id из реестра TABS (он в конце скрипта, рядом с созданием закладок). */
	let activeTabId = 'dataSets';
	/** Строка под полем открытого набора: {key, repaint, rebase(text) — записанный текст для проверки имён}. */
	let queryStatusRefresh = null;
	/** Идёт перерисовка содержимого вкладки: blur убираемого поля — не конец правки. */
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
	 * Имя с местами переноса на границах слов: перед заглавной буквой после строчной или цифры
	 * (АнализАктивности|Пользователей) и после точки, запятой, точки с запятой, открывающей скобки и подчёркивания
	 * (СправочникСсылка.|Пользователи). Места переноса — элементы wbr: знаков они не добавляют, и текст узла,
	 * доступное имя и копирование дают имя целиком.
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

	/** Как el, но текст — имя с местами переноса на границах слов (setNameText). */
	function nameEl(tag, className, text) {
		const node = el(tag, className);
		if (text !== undefined && text !== null && text !== '') {
			setNameText(node, text);
		}
		return node;
	}

	/**
	 * Пояснение к неочевидному элементу — всплывающей подсказкой и описанием для читалки, а не постоянным абзацем под
	 * ним. Одного title экранный диктор не читает, поэтому ещё aria-description.
	 */
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
	 * Шлёт правку панели; false — предыдущая правка ещё не ответила. Во время фоновой записи текста запроса одна
	 * правка встаёт в очередь за ней: действие сразу после ухода из поля запроса (щелчок по флажку, ОК окна) не
	 * должно спотыкаться о запись, которую пользователь не просил явно.
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

	/** Отправка правки без проверки занятости: send, очередь за фоновой записью и сама фоновая запись. */
	function postEdit(type, fields) {
		saving = true;
		editOrigin = null;
		pendingVariant = affectedVariant(type, fields || {});
		setStatus('Сохраняем…', false);
		vscode.postMessage(Object.assign({ type: type }, fields || {}));
	}

	/** Новая правка сейчас получила бы отказ «ещё сохраняется» (за фоновой записью место в очереди есть). */
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
	 * Имя занято без учёта регистра — так их сверяет md-sparrow. own — прежнее имя переименовываемого:
	 * смена регистра своего же имени чужое не занимает.
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

	/** Пути вычисляемых полей схемы: путь нового или переименованного поля уникален среди них. */
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

	/**
	 * Точка расширения для списка подсказки: пока список открыт, Escape закрывает только
	 * его, а не окно с недописанным выражением. Подсказка кладёт сюда {isOpen(), close()}.
	 */
	let escapePopup = null;

	/** Кандидаты в остановки Tab; скрытые и отключённые отсеивает isTabStop. */
	const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

	/** Каркас уровня 1 — разметка шаблона (dcs-editor.html); вложенные уровни собирает скрипт. */
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
		// Нарисованный заголовок (paintDialogTitle): перерисовка тела не трогает его без смены
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
	 * Подвал по описанию кнопок. Кнопки переиспользуются по id: смена подписи («Далее >» → «ОК»)
	 * не пересоздаёт кнопку и не сбивает фокус; переставляются узлы, только если сменился состав.
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
		// Перенос узла снимает с него фокус: возвращаем, если кнопка осталась в подвале
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
		// Обработчик мог закрыть окно или открыть другое на том же каркасе: ошибка — только живому уровню
		if (shell.level === level) {
			shell.errorEl.textContent = dialogRules.clickError(result);
		}
	}

	/**
	 * Заголовок уровня: текст, знак «*» изменённого окна (только для глаза) и скрытые с экрана слова
	 * для читалки — имя окна по aria-labelledby собирается из заголовка, и aria-hidden знак в него не
	 * входит. Перерисовывается только при смене: setTitle зовут на каждой перерисовке тела.
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
	 * onClose?(level), returnFocus?}. Кнопка без onClick — «Отмена» уровня; onClick, вернувший строку,
	 * показывает её ошибкой; unavailable — недоступна, но фокусируема (aria-disabled). onCancel,
	 * вернувший false, оставляет окно открытым. Возвращает уровень: {body, setTitle(text, modified?),
	 * setError, setButtons, close, isOpen}; modified ставит после заголовка «*».
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
				// Недостроенное окно не оставляем: иначе страница так и останется неактивной
				closeDialogLevels(dialogStack.indexOf(level));
				throw error;
			}
		}
		if (!level.isOpen()) {
			return level;
		}
		// Фокус — в новое окно до inert и aria-hidden нижних уровней: на предке элемента с фокусом
		// браузер aria-hidden отклоняет. build мог сам поставить фокус в своё окно — тогда не трогаем
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
		// onClose — после разборки: стек уже согласован, обработчик может открыть новое окно
		for (const level of closed) {
			if (level.onClose) {
				level.onClose(level);
			}
		}
	}

	function teardownDialogShell(shell) {
		// Поле уходит вместе с окном, а blur у удалённого узла браузер не обещает: список закрываем сами
		closeCompletionWithin(shell.root);
		// Сам список жил в этом окне — он нужен и дальше, поэтому возвращается на body до разборки окна
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

	/** Нижние уровни и страница под стеком неактивны и скрыты от читалок; верхний — активен. */
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
		// Вкладку под окном могла перерисовать фоновая запись текста запроса (или правка, вставшая за ней в очередь):
		// вызвавший узел заменён новым с тем же ключом — фокус вернётся на него
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

	/** Узел, убранный перерисовкой вкладки, — его преемник с тем же ключом (data-dcs-key); иначе сам узел. */
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
		// Свёрнутые и скрытые блоки фокус не получают — браузер их тоже пропускает
		return node.getClientRects().length > 0;
	}

	/** Tab не уходит из верхнего окна: на краях обход заворачивается, внутри — браузерный. */
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
				// Пока предыдущая правка сохраняется, повторное нажатие не шлёт вторую и не трогает строку ошибки; за
				// фоновой записью текста запроса правка окна встаёт в очередь (editBusy)
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

	/** Закрывает все окна: уровень 1 и всё над ним (после сохранения модель перечитана целиком). */
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
	 * Свой тип данных переноса строк редактора. Сброс без него (файл, текст из другого окна) зоны не принимают: оболочка
	 * webview VS Code отменяет dragover и drop на всём документе, и без этой проверки в зону «падало» бы что угодно.
	 */
	const DRAG_TYPE = 'application/x-dcs-row';

	/**
	 * Место сброса относительно строки под указателем: offset — от её верха, size — её высота. mode: 'line' — до или
	 * после (по половинам строки), 'into' — в саму строку, 'both' — края (по четверти) до и после, середина — в строку,
	 * 'zone' — строка не важна, перенос в список целиком (тогда 'end').
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
	 * Номер, на котором окажется элемент списка из count элементов: from — его номер сейчас (-1 — новый: его добавят в
	 * конец и сдвинут на место), target — номер строки сброса (-1 — под строками, в конец), place — 'before' | 'after'.
	 * Перестановка считает номер после изъятия элемента; итог всегда в границах списка.
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
	 * Вид места сброса в зоне для этого переноса: zone.place — строка или правило по переносу и ключу строки под
	 * указателем (key: null — строки нет или она ещё не найдена; так папка принимает «в строку», а поле — только до и
	 * после); по умолчанию 'line'.
	 */
	function dropMode(zone, payload, key) {
		const mode = typeof zone.place === 'function' ? zone.place(payload, key === undefined ? null : key) : zone.place;
		return mode === 'into' || mode === 'both' || mode === 'zone' ? mode : 'line';
	}

	/**
	 * Принимает ли строка зоны под указателем этот перенос: zone.rowAccept(payload, key) — правило по строке (узел
	 * структуры переставляется только среди соседей); без правила — любая строка.
	 */
	function dropRowAccepted(zone, payload, key) {
		return typeof zone.rowAccept === 'function' ? Boolean(zone.rowAccept(payload, key)) : true;
	}

	/** Курсор сброса: 'copy' — значение остаётся в источнике (добавить), иначе 'move' (убрать, переставить). */
	function dropEffect(zone, payload) {
		const effect = typeof zone.effect === 'function' ? zone.effect(payload) : zone.effect;
		return effect === 'copy' ? 'copy' : 'move';
	}

	/** Есть ли среди типов переноса (DataTransfer.types — массив или DOMStringList) свой тип. */
	function hasDragType(types) {
		return Boolean(types) && Array.prototype.indexOf.call(types, DRAG_TYPE) >= 0;
	}

	/*
	 * Правки дерева элементов списка «Настроек» по месту сброса: выбранные поля с папками, отбор с группами (И, ИЛИ, НЕ),
	 * сортировка. Чистые, на копии; адрес элемента — номера по уровням ([1, 0] — первый элемент в папке второй строки).
	 * Результат уходит той же правкой списка целиком (dcs/set-selection, set-filter, set-order), что у кнопок.
	 */

	/** Список уровня по адресу владельца ([] — верхний) в копии дерева; у владельца без вложений список создаётся. */
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
	 * Куда встанет элемент по месту сброса: {parent — адрес владельца, index — номер вставки в его список до изъятия
	 * переносимого}. target — адрес строки сброса или null (под строками, пустой список: в конец верхнего уровня);
	 * place — 'before' | 'after' | 'into' (в папку или группу — последним) | 'end'.
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

	/** Новый элемент в место slot: {items — копия дерева с ним, pos — его адрес}. */
	function itemsInsert(items, slot, fresh) {
		const next = JSON.parse(JSON.stringify(items));
		const level = itemsLevel(next, slot.parent);
		const index = Math.max(0, Math.min(slot.index, level.length));
		level.splice(index, 0, fresh);
		return { items: next, pos: slot.parent.concat([index]) };
	}

	/**
	 * Перенос элемента с адреса from в место slot (itemsDropSlot): {items — копия дерева, pos — новый адрес}; null — место
	 * то же, или папку (группу) бросили в неё саму или во вложенную.
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

	/** Элемент по адресу без правки дерева; адреса нет — null. */
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
	 * Место сброса так, как его показывает линия (itemsDropSlot с поправкой): папки и группы раскрыты всегда, и линия
	 * «после» папки (группы) с вложенными идёт под её строкой — над первой вложенной. Элемент встаёт первым в неё, как при
	 * сбросе «до» её первой строки, а не за всем её содержимым, за много строк от линии. container(элемент) — папка или
	 * группа.
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
	 * Команды уровня — путь клавиатурой и одним щелчком к тому, что перенос мышью делает с папками и группами (WCAG 2.5.7):
	 * «Вынести из папки (группы)» — сразу за её строкой на уровень выше; null — строка на верхнем уровне.
	 */
	function itemsOutdentSlot(items, pos) {
		if (!pos || pos.length < 2) {
			return null;
		}
		return { parent: pos.slice(0, -2), index: pos[pos.length - 2] + 1 };
	}

	/**
	 * «В папку (группу) выше» — последним в соседнюю папку (группу) прямо над строкой, на её уровне; null — над строкой
	 * на этом уровне не папка (не группа) или строка первая.
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
	 * Перенос мышью — дополнение к кнопкам > >> < << ↑ ↓, двойному щелчку и клавишам (WCAG 2.5.7): сброс зовёт то же
	 * действие, что кнопка, поэтому проверки, заметки и возврат фокуса у них общие.
	 * Пока никто не тащит, перенос ничего не стоит: у строки только атрибут draggable (у самой строки или у её ручки) и,
	 * у списков без своего ключа в разметке, запись WeakMap от строки к ключу; слушателей у строк и списков нет — пять на
	 * документе (слушатель конца переноса у источника — только на время переноса), а зона — запись WeakMap от контейнера
	 * списка к описанию. Сводки строк по ключу (дерево структуры, «Доступные поля») собираются при первом обращении за
	 * перенос, не на каждой отрисовке.
	 * Во время переноса dragover делает closest() и сравнение зоны; место вставки и подсветка считаются раз в кадр
	 * (requestAnimationFrame) и меняют только классы. Нагрузка — данные (зона, окно, ключ строки, вид), не узлы DOM.
	 * Ответы расширения, пришедшие во время переноса, ждут его конца (whenIdle): перерисовка не уберёт строку из-под
	 * указателя, а сброс сработает по той модели, которую пользователь видел.
	 */

	/** Контейнер списка → описание зоны (dragZone). */
	const dragZones = new WeakMap();
	/**
	 * Идущий перенос: {payload: {zone, scope, key, kind}, source — описание зоны-источника, row, zones, node — узел, за
	 * который тащат (у него слушатель конца переноса — до finishDrag)} или null.
	 */
	let dragNow = null;
	/** То, что ждёт конца переноса: ответы расширения и отложенные перерисовки — по порядку прихода. */
	let dragHeld = [];
	/** Перерисовки окон, которые просили отложенные ответы, пока они отдаются (rerenderSoon): каждая — один раз. */
	let heldRenders = null;
	/** Последняя точка dragover для подсветки в кадре: {zoneEl, target, x, y} или null. */
	let dragPoint = null;
	let dragFrame = 0;
	/** Подсвеченное сейчас: зона под указателем, строка и её класс места. */
	let dragShown = { zone: null, row: null, mark: '' };
	/** Зона, которой показано место сброса её способом (preview: каретка в тексте выражения), или null. */
	let dragPreview = null;

	/**
	 * Зона переноса — контейнер списка (дерево, сетка, поле выражения), его строки — прямые дети. spec: {id, scope?,
	 * keyOf(row) → ключ строки | null, drag?(key, source) → вид строки-источника ('' — не тащится; source — узел, за
	 * который тащат), from?: {idЗоныИсточника: (payload, target) → void | false} — сброс (false — ничего не
	 * изменилось), accept?(payload), place? — 'line' | 'into' | 'both' | 'zone' или правило по переносу, effect? —
	 * 'move' | 'copy' или правило, target?(event, node) — своё место сброса (поле выражения: позиция в тексте),
	 * preview?(x, y) — показать это место раз в кадр (x = null — указатель ушёл, перенос кончился), pick?(key) — строка
	 * этой зоны стала текущей, как от щелчка: перенос кончился без сброса, сброс ничего не изменил или скопировал
	 * строку в другой список, rowOf?(node, контейнер) → строка под узлом и rows?(контейнер) → строки по порядку — у
	 * таблицы, где строки не прямые дети зоны (зона — колонка с панелью и таблицей, строки — tr в tbody, шапка — tr в
	 * thead), rowAccept?(payload, key) — примет ли строка под указателем (иначе — курсор «нельзя», без линии),
	 * markRow?(key, place) — строка, у которой рисовать линию места, если не у строки сброса (дерево структуры: «после»
	 * раскрытого узла — под его последним видимым потомком, там, куда узел и встанет), или null}.
	 * place может зависеть от ключа строки: place(payload, key). Зоны регистрируются на каждой отрисовке: новый
	 * контейнер — новая запись, прежний уходит из документа вместе со своей.
	 */
	function dragZone(node, spec) {
		node.setAttribute('data-dnd-zone', spec.id);
		dragZones.set(node, spec);
		return node;
	}

	/**
	 * Зона у таблицы (вкладки схемы и «Настройки»): контейнер host целиком — панель пиктограмм, шапка, строки и место под
	 * ними, у пустого списка — его плашка. Строка — tr, ключ — по spec.keys (WeakMap tr → ключ); у шапки ключа нет, и
	 * сброс на неё или выше, на панель (она — вне прокрутки списка), ставит первым: узел над таблицей считается шапкой,
	 * по порядку в документе, а не по высоте — у прокрученного списка первая строка уходит выше панели. spec: {id, scope,
	 * head — tr шапки или null, rows() — tr строк по порядку, keys, drag?, pick?, from?, accept?, place?, effect?} (смысл
	 * — у dragZone).
	 */
	function tableDropZone(host, spec) {
		// Шапка и строки — один массив на зону, собранный при первом обращении (в переносе): кадр подсветки его не копирует.
		// Зона живёт одну отрисовку, а перерисовки во время переноса отложены — массив не устаревает
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

	/**
	 * Лежит ли узел в документе раньше other и не содержит его (панель пиктограмм над таблицей — да, обёртка таблицы с
	 * местом под строками — нет): одно сравнение позиций, без обхода строк.
	 */
	function nodeAbove(node, other) {
		if (!node || !other || typeof other.compareDocumentPosition !== 'function') {
			return false;
		}
		// 2 — DOCUMENT_POSITION_PRECEDING (узел раньше), 8 — DOCUMENT_POSITION_CONTAINS (узел — предок)
		const position = other.compareDocumentPosition(node);
		return (position & 2) !== 0 && (position & 8) === 0;
	}

	/** Зона под узлом: ближайший контейнер с data-dnd-zone (closest — без обхода строк). */
	function zoneNodeOf(node) {
		const found = node && typeof node.closest === 'function' ? node.closest('[data-dnd-zone]') : null;
		return found && dragZones.has(found) ? found : null;
	}

	/**
	 * Строка зоны под узлом — прямой ребёнок контейнера (в строке бывают ячейки, списки и флажки), у таблицы — по её
	 * правилу zone.rowOf (подъём от узла до tr: обход предков, не строк).
	 */
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

	/**
	 * Перерисовка окна по ответу расширения: сразу, а пока отдаются ответы, отложенные переносом, — одна на всех в
	 * конце (ответы метаданных, таблиц и описаний, пришедшие за время переноса, иначе перерисовали бы окно каждый).
	 */
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
		// Ответы применяются по порядку, а перерисовка окна, которую они просят, — одна, после всех
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

	/** Строки зоны по порядку: прямые дети контейнера, у таблицы — zone.rows (шапка и строки tbody). */
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

	/**
	 * Первая строка списка с ключом и лежит ли узел без ключа (row — шапка сетки) над ней: сброс на шапку встаёт перед
	 * первой строкой, а не в конец. Обход — до первой строки с ключом, то есть шапка и пустая строка, не весь список.
	 */
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

	/**
	 * Место сброса по точке: {key, place, row, mark} — строка под указателем (над первой строкой — она, под строками —
	 * последняя) и класс подсветки. Чтение раскладки (getBoundingClientRect строки) — в кадре подсветки и в самом сбросе.
	 */
	function dropSpotOf(zone, zoneEl, node, clientY, payload) {
		let mode = dropMode(zone, payload, null);
		if (mode === 'zone') {
			return { key: null, place: 'end', row: null, mark: '' };
		}
		const row = dragRowOf(node, zoneEl, zone);
		const key = dragKeyOf(zone, row);
		// Строка, которая этот перенос не примет (узел структуры у другого родителя): места нет, сброс — отмена
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
			// Шапка сетки и отступ над строками — «первым», а не «в конец»: туда целятся, когда хотят поставить в начало
			const first = firstDragRow(zone, zoneEl, row);
			if (first.row && first.above) {
				// Шапка (и панель над таблицей): линия — у её нижнего края. Закреплённая шапка видна и в прокрученном списке,
				// а первая строка тогда ушла вверх, за край, и место сброса не было бы видно
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
		// Линия — там, куда встанет строка, если это не край строки сброса (раскрытый узел дерева структуры)
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

	/** Место сброса своим способом (preview) — у зоны под указателем; ушёл указатель — прежней зоне preview(null). */
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
			// Поле выражения: место — позиция в тексте, его показывает сама зона (каретка), строк у неё нет
			showDrop(point.zoneEl, null, '');
			showPreview(zone, point);
			return;
		}
		showPreview(null, null);
		const spot = dropSpotOf(zone, point.zoneEl, point.target, point.y, drag.payload);
		// Строка перенос не примет: ни рамки «под указателем», ни линии — как вне зон
		showDrop(spot.place === 'none' ? null : point.zoneEl, spot.row, spot.mark);
	}

	/** Подсветка — раз в кадр: dragover приходит чаще, чем экран успевает её показать. */
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
	 * Строка-источник становится текущей, как от щелчка: нажатие кнопки мыши уже дало ей фокус, а click после переноса
	 * браузер не шлёт. Без этого фокус стоял бы на одной строке, а выбор — на другой: клавиши (Delete, Enter) работали
	 * бы с первой, кнопки (<, ↑ ↓) — со второй.
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
	 * Конец переноса: подсветка и метки снимаются; keepHeld — отложенное отдаст сам сброс, после своего действия; pick —
	 * перенос кончился без сброса (отмена, Esc, сброс мимо зон), и строка-источник становится текущей (pickSource).
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
			// Слушатель конца у источника — только на время переноса: после finishDrag dragend делать нечего
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
	 * Перенос кончился, а dragend не пришёл (например, исключение посреди начала переноса): во время переноса браузер
	 * не шлёт событий мыши, поэтому нажатие кнопки или движение без нажатой кнопки значит, что он кончился. Без этого
	 * ответы расширения ждали бы вечно, а правка висела бы на «Сохраняем…». Слушатели — только на время переноса
	 * (снимает finishDrag); строку не выбирают: щелчок, который пришёл, выбирает свою.
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
		// Чужой перенос (выделенный текст поля ввода, ссылка) — не наш: его не трогаем
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
		// Конец переноса доходит до источника, даже если сброс перерисовал список и строка ушла из документа. Слушатели
		// конца — сразу: исключение ниже не должно оставить перенос «идущим»
		source.addEventListener('dragend', onDragEnd);
		document.addEventListener('pointerdown', onDragLost, true);
		document.addEventListener('mousemove', onDragLost, true);
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setData(DRAG_TYPE, zone.id);
		row.classList.add('dcs-dnd-source');
		// Куда можно бросить — видно сразу: принимающие зоны верхнего окна получают тонкую рамку (один обход за перенос)
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
		// Правило по строке есть только у зон, которым оно нужно: подъём до строки — обход предков, не строк
		const accepted = Boolean(zone) && dropAccepted(zone, drag.payload);
		const refused = accepted && typeof zone.rowAccept === 'function' && !dropRowAccepted(zone, drag.payload, dragKeyOf(zone, dragRowOf(event.target, zoneEl, zone)));
		if (!accepted || refused) {
			// Вне своих зон сброса нет: оболочка VS Code отменила dragover на всём документе, и без 'none' курсор обещал
			// бы сброс где угодно. Чужой перенос (файл, текст) — тоже 'none'
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
		// Указатель ушёл с узла: если он ушёл совсем (за окно), следующего dragover не будет — подсветка снимается в кадре
		if (dragNow) {
			dragPoint = null;
			schedulePaint();
		}
	}

	function onDrop(event) {
		const drag = dragNow;
		if (!drag) {
			// Чужой сброс (файл, текст): оболочка VS Code уже отменила действие браузера, редактору он не нужен
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
		// Строку бросили на неё саму (нажатие с дрожью руки сдвинуло мышь за порог переноса): это щелчок, а не правка.
		// Строка, которая перенос не примет, — как сброс мимо зон
		if ((zone === drag.source && spot.key === payload.key) || spot.place === 'none') {
			finishDrag(false, true);
			return;
		}
		finishDrag(true);
		// Скопированная в другой список строка становится текущей до действия, как от двойного щелчка: фокус после
		// действия остаётся его (поле выражения забирает фокус вставкой)
		const copied = zone !== drag.source && dropEffect(zone, payload) === 'copy';
		let changed = true;
		try {
			if (copied) {
				pickSource(drag);
			}
			// То же действие, что у кнопки: перерисовка сразу, отложенные ответы — после него, по новой модели
			changed = zone.from[payload.zone](payload, { key: spot.key, place: spot.place, offset: spot.offset }) !== false;
		} finally {
			releaseHeld();
		}
		// Сброс ничего не изменил (строка встала на своё же место): выбор — за строкой, как от щелчка
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
	 * Свои простые пиктограммы 16×16 из линий, не рисунки 1С и не codicons. Цвет — currentColor, поэтому
	 * пиктограмма следует теме, в том числе контрастной. Фигура — [тег, атрибуты]. Обводка и заливка заданы в
	 * стилях (.dcs-icon): атрибута style в разметке нет, CSP окна его не пропустил бы.
	 */
	const COMMAND_ICONS = Object.freeze({
		add: [['path', { d: 'M8 3v10M3 8h10' }]],
		// Лист за листом и плюс: новая строка — копия выбранной
		'add-copy': [
			['path', { d: 'M5.5 4.5v-2h8v8h-2' }],
			['rect', { x: '2.5', y: '5.5', width: '8', height: '8', rx: '1' }],
			['path', { d: 'M6.5 7.5v4M4.5 9.5h4' }],
		],
		edit: [['path', { d: 'M2.5 13.5l.8-3.2L10.6 3a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2l-7.3 7.3zM9.5 4.1l2.4 2.4' }]],
		delete: [['path', { d: 'M4 4l8 8M12 4l-8 8' }]],
		// Поле с текстом и курсор ввода: правка имени, а не свойств (у «Изменить» — карандаш)
		rename: [
			['rect', { x: '1.5', y: '4.5', width: '9', height: '7', rx: '1' }],
			['path', { d: 'M4 8h4M13 3v10M11.5 3h3M11.5 13h3' }],
		],
		replace: [['path', { d: 'M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13' }]],
		up: [['path', { d: 'M8 13V3.5M4 7.5l4-4 4 4' }]],
		down: [['path', { d: 'M8 3v9.5M4 8.5l4 4 4-4' }]],
		// Строки с отступом и стрелка: строка — на уровень выше (влево) и в папку или группу над ней (вправо)
		outdent: [['path', { d: 'M14 3.5H7M14 8H9M14 12.5H7M5.5 5.5L3 8l2.5 2.5M3 8h4' }]],
		indent: [['path', { d: 'M14 3.5H7M14 8H9M14 12.5H7M2 5.5L4.5 8 2 10.5M1.5 8h3' }]],
		// Скобки со строками внутри: запрос в запросе
		'nested-query': [['path', { d: 'M5 2.5c-2.2 2.5-2.2 8.5 0 11M11 2.5c2.2 2.5 2.2 8.5 0 11M6.5 6h3M6.5 8h3M6.5 10h3' }]],
		// Таблица и скобки за ней: Таблица(параметры)
		'table-params': [
			['rect', { x: '1.5', y: '3.5', width: '8', height: '9', rx: '1' }],
			['path', { d: 'M1.5 6.5h8M5.5 6.5v6M12 4.5c-1.2 1.6-1.2 5.4 0 7M13.8 4.5c1.2 1.6 1.2 5.4 0 7' }],
		],
		// Строка и под ней две строки с отступом: новая группировка — уровень структуры «Настроек»
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
		// Угловые скобки вокруг точки — как запись «<Авто>»
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
	 * Кнопка-пиктограмма команды над списком, как у конфигуратора. spec:
	 * - icon — имя из COMMAND_ICONS; name — короткое название команды: оно и подсказка (title), и доступное
	 *   имя (aria-label), потому что видимой подписи у кнопки нет;
	 * - shortcut — клавиша, которой та же команда вызывается из списка (F2, Delete): в подсказке — после
	 *   названия в скобках. В доступное имя и aria-keyshortcuts она не идёт: клавиша работает в списке, а не
	 *   на самой кнопке. Без note описание для читалки — короткое «В списке — клавиша Delete» (shortcutSpoken):
	 *   иначе описанием стала бы подсказка целиком, и читалка повторила бы имя кнопки вместе с клавишей;
	 * - note — пояснение или причина недоступности: вторая строка подсказки и описание для читалки
	 *   (aria-description); spoken — своё, короче, описание для читалки вместо note;
	 * - unavailable — недоступна, но остаётся в обходе Tab (aria-disabled); щелчок и Enter доходят до onClick,
	 *   и тот решает сам — например, говорит, почему недоступна;
	 * - disabled — настоящий disabled: кнопка выпадает из обхода Tab;
	 * - className — классы кнопки; по умолчанию — классы кнопки панели ghost-btn и dcs-btn-small
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
	 * Описание для читалки у кнопки с клавишей списка и без пояснения: короткое, без имени кнопки. Без него описанием
	 * стал бы title («Удалить (Delete)»), и читалка сказала бы «Удалить, кнопка, Удалить (Delete)».
	 */
	function shortcutSpoken(shortcut) {
		return shortcut ? 'Клавиша в списке: ' + shortcut : '';
	}

	/**
	 * Причина для читалки у недоступной кнопки: aria-disabled читалка сама называет «недоступно», поэтому начало причины
	 * «Недоступно: …» в описании не повторяется («…, кнопка, недоступно, строка уже первая»). Подсказка (title) для глаза —
	 * полная. У доступной кнопки пояснение — как есть.
	 */
	function spokenReason(note, unavailable) {
		const text = String(note || '');
		if (!unavailable) {
			return text;
		}
		const rest = text.replace(/^Недоступно[:,]?\s*/u, '');
		return rest.charAt(0).toUpperCase() + rest.slice(1);
	}

	/**
	 * Доступность и подсказка кнопки-пиктограммы без перерисовки — выбор строки списка «Настроек» меняет, можно ли
	 * двигать и удалять. Правила те же, что у iconButton: название и клавиша — в подсказке, причина — второй строкой
	 * и описанием для читалки, недоступная остаётся в обходе Tab (aria-disabled).
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

	/**
	 * Панель пиктограмм над списком вкладки схемы: кнопки — описания для iconButton. У каждой ключ (закладка и название
	 * или spec.key): фокус на ней переживает перерисовку вкладки по ответу правки.
	 */
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
	 * Windows стрелки и буквы на закрытом списке меняют значение и сразу шлют change: листая имена с клавиатуры,
	 * пользователь получил бы действие для первого же. Поэтому change, пришедший от такой клавиши (в той же задаче, что и
	 * keydown), только выбирает имя, а действует Enter. Выбор мышью и в раскрытом списке (Alt+↓, F4, пробел) — сразу:
	 * раскрытый список ведёт клавиатуру сам, keydown до списка не доходит. onPick(value) получает непустое значение,
	 * список возвращается к первой строке-подсказке.
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
				// change от этой клавиши придёт в этой же задаче — до таймера
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
	 * Список значения, который пишет файл (значение параметра вывода в «Других настройках»): commit — по выбору мышью, Enter
	 * или уходу из списка, revert — по Esc. Стрелки, Home, End и буквы на закрытом списке в Chromium на Windows сразу дают
	 * change: так значения только листаются, как у actionSelect, — иначе первая же стрелка писала бы файл, а ответ
	 * перерисовывал панель под пользователем.
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
				// change от этой клавиши придёт в этой же задаче — до таймера
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
		// Уход из списка заканчивает выбор; список, который убирает перерисовка, — нет
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
		// Хвостовой перевод строки pre схлопывает — добавка выравнивает высоту с textarea
		pre.appendChild(document.createTextNode('\n'));
	}

	/**
	 * Редактор кода с подсветкой: зеркало-pre за прозрачной textarea, скролл синхронный.
	 * Возвращает {box, input, flush}; на текстах больше лимита textarea остаётся обычной —
	 * редактирование важнее подсветки. flush() перерисовывает зеркало сразу, без паузы:
	 * подсказка меряет по нему каретку, а отстающее на 120 мс зеркало соврало бы.
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
		// Ctrl+/ — только у текста запроса (набор и окно «Запрос…»): у выражений СКД своё поле, и
		// строчный комментарий в одной строке выражения скорее сломал бы его, чем помог
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

	/** Ctrl+/ в тексте запроса: строки выделения закомментировать или раскомментировать (DcsHighlight.toggleLineComments). */
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
	 * Пишет правку отрезка [start, end) поля так, чтобы поле стало nextText, и ставит выделение.
	 * execCommand оставляет правку в истории поля (Ctrl+Z отменяет именно её, а не весь набранный
	 * текст) и сам шлёт input; там, где его нет или он не сработал, — прямая запись значения и input,
	 * чтобы подсветка и обработчики формы узнали о новом тексте так же, как о наборе.
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
				// Пустая вставка — удаление выделения: insertText с пустой строкой браузеры исполняют по-разному
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
	 * Поле выражения в диалоге: компактный редактор с подсветкой вместо однострочного input.
	 * scopeFn — место ввода для подсказки (attachCompletion); без него поле без подсказки.
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
	 * строка (индекс по всему списку) и начало нарисованного окна. null — список закрыт.
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

	/** Клавиши, которыми ходят по открытому списку (решение — nextActive модуля). */
	const COMPLETE_NAV_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];

	/**
	 * Один список на документ: второй список рядом с первым читалка приняла бы за другой виджет.
	 * Живёт он с position: fixed — без окна на body, а при открытии из окна стека переезжает в верхний
	 * .dcs-dialog (placeCompletionHost): за пределами aria-modal Chromium под VoiceOver вырезает его из
	 * дерева доступности. Обрезки overflow окна fixed не боится, пока у предков окна нет transform,
	 * filter и contain — они сделали бы предка точкой отсчёта fixed (у .dcs-dialog-backdrop и
	 * .dcs-dialog их нет).
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
	 * Список и строка состояния — внутри верхнего окна стека, без окон — на body:
	 * aria-modal прячет от читалки всё вне окна, а список с полем должны читаться вместе. z-index
	 * списка (POPUP_Z_INDEX) и position: fixed при переезде не меняются.
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

	/** Уровень закрывается: список и строка уходят из его окна назад на body, а не вместе с окном из документа. */
	function releaseCompletionHost(box) {
		if (box.contains(completeList)) {
			document.body.appendChild(completeList);
		}
		if (box.contains(completeStatus)) {
			document.body.appendChild(completeStatus);
		}
	}

	/** Каталог места ввода; у разделов настроек — с пользовательскими полями активного варианта. */
	function completionCatalog(scope) {
		const key = String(scope || '');
		const settingsDto = key.indexOf('settings:') === 0 ? variantCache[activeVariantName()] || null : null;
		const cached = completeCatalogs.get(key);
		// Подписи типов зависят и от словаря (имена видов ссылок): пришёл словарь — каталог пересобирается
		if (cached && cached.model === model && cached.settings === settingsDto && cached.dictionary === typeDictionary) {
			return cached.catalog;
		}
		const catalog = completer.buildCatalog(model, settingsDto, key, completionTypeOptions());
		completeCatalogs.set(key, { model: model, settings: settingsDto, dictionary: typeDictionary, catalog: catalog });
		return catalog;
	}

	/**
	 * Подпись типа в строке подсказки — то же русское представление, что в колонке «Тип»: XML-имена
	 * md-sparrow (string, CatalogRef.Х) в UI не показываются.
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
	 * Составы определяемых типов и характеристик (typeCompositions ответа md-sparrow) — к объектам
	 * типов ответа, один раз при приёме: дальше чистые функции читают type.compositions и раскрывают
	 * такие поля через точку и в связях. Зовётся в каждой точке, где приходит модель cf-dcs-info или
	 * описание cf-md-query-tables (начальная модель, ответ saved, queryTables, describeType); новую
	 * точку приёма надо подключить так же — это сверяет node-тест по тексту скрипта. Объявление
	 * функцией, а не через fieldTypes: начальная модель разбирается в первой строке скрипта.
	 */
	function withTypeCompositions(answer) {
		return window.DcsFieldTypes.attachTypeCompositions(answer);
	}

	/**
	 * Описания объектов конфигурации (cf-md-query-tables) по ключу объекта на время вкладки:
	 * правки схемы метаданные конфигурации не меняют, а каждое чтение — запуск jar. Состояния:
	 * loading — запрос ушёл, ready — описание есть, none — описания нет (не найден, ошибка).
	 */
	const describeCache = new Map();
	/**
	 * Отметка кэша описаний: растёт на каждый ответ, который кладёт в него готовое описание или «нет».
	 * По ней таблица констант конструктора (constantsQueryTable) знает, что типы её полей пора собрать заново.
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

	/** Описание из кэша для модуля: undefined — ещё не загружено, null — описания нет. */
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
	 * Окружение extraChildrenFor: модель схемы, место ввода, кэш описаний и подпись типа. Одно на
	 * подсказку «через точку» и доступные поля конструктора настроек: реквизиты по типу у них
	 * должны совпадать строка в строку.
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

	/**
	 * Точка расширения подсказки для поля ввода: дети по типу узла каталога (записанному или
	 * выведенному по запросу набора), недостающие описания — запросом панели.
	 */
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
	 * Пришло описание: открытый список пересчитывается на месте (активная строка остаётся, если
	 * она есть и после пересчёта), а не открывшийся из-за ожидания — открывается, если пользователь
	 * всё ещё стоит после той же точки.
	 */
	function onDescribed() {
		// Открытый конструктор настроек раскрывает поля по тем же описаниям: его реквизиты и
		// «Загрузка реквизитов…» пересчитываются до подсказки, у которой ниже ранние выходы
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
	 * Подсказка у поля ввода: textarea редактора кода (codeEditor) или однострочное поле пути.
	 *
	 * scopeFn() → место ввода каталога (expr-calc, settings:filter, link-source:<набор>… — см.
	 * buildCatalog модуля); зовётся при каждом открытии, поэтому подсказка связи следует за
	 * набором, выбранным в форме. options: letters:false — буква не открывает список, только «&»,
	 * Ctrl+Пробел и «⋯» (текст запроса); extraChildren — свои дети по типу для уровня «через
	 * точку» (по умолчанию — по типу узла и описаниям объектов, typeChildrenProvider); more:false —
	 * без кнопки «⋯»; catalog — свой каталог места ввода (функция) вместо каталога по scope:
	 * конструктор настроек подаёт каталог своего шага, у нового варианта — без пользовательских
	 * полей текущего; ownTypes:true — дети по типу только по типам узлов своего каталога, без
	 * вывода по полям схемы (окно выражения конструктора запроса). drop: {title, label, empty, list,
	 * keys} — поле со списком (значения параметров виртуальной таблицы): вместо «⋯»
	 * кнопка «▾» (подсказка title, имя label, aria-expanded; повторное нажатие закрывает список), она
	 * и Alt+↓ открывают весь верхний уровень каталога (имя списка — list), а выбор заменяет всё
	 * значение поля, как выбор в списке поля конфигуратора; Alt+↑ закрывает список. Поле получает
	 * aria-keyshortcuts и описание keys для читалки. Ctrl+Пробел и набор при этом подсказывают у
	 * каретки — так в выражение вставляется параметр. Пустой список открывается со строкой empty, а
	 * не молчит.
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
			// Многострочному полю роль combobox не ставим: читалка потеряла бы у него ход по строкам
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

	/**
	 * Кнопка «⋯» — тот же список для мыши и читалки, заодно обход Ctrl+Пробел, если сочетание занято
	 * раскладкой. У редактора кода она справа от поля, у однострочного — следующей за ним.
	 */
	function addCompleteButton(binding) {
		const drop = binding.drop;
		const button = el('button', 'struct-btn dcs-complete-more', drop ? '▾' : '⋯');
		button.type = 'button';
		button.title = drop ? drop.title : 'Подсказка (Ctrl+Пробел)';
		button.setAttribute('aria-label', drop ? drop.label : 'Показать подсказку');
		if (drop) {
			// Кнопка раскрывающегося списка: читалка слышит, открыт ли он (openCompletion/closeCompletion)
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
	 * Кнопка встаёт сразу за полем: соседство держит её скрытой вместе с полем (правило стилей
	 * для скрытого поля), а строка формы получает под неё третью колонку.
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
			// Явный вызов: список и при пустом начале слова, а если вариантов нет — сообщение читалке
			event.preventDefault();
			openCompletion(binding, 'explicit');
			return;
		}
		if (binding.drop && event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			// Поле со списком: Alt+↓ раскрывает список значений, Alt+↑ его закрывает — как у раскрывающегося списка
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
			// Нечего брать: пустой список, строка не выбрана или Tab по списку, который только посмотрели. Значение
			// не меняется; Enter закрывает список (окно его не видит), Tab уводит фокус дальше
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
	 * Берут ли Enter и Tab строку списка. Без активной строки (пустой список, у поля со списком — значение не совпало ни
	 * с одной строкой) — нет. Список поля со списком, раскрытый «▾» или Alt+↓ и не перефильтрованный набором, Tab берёт,
	 * только если строку выбрали стрелками: раскрыли посмотреть и ушли Tab — значение остаётся как было.
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

	/**
	 * Контекст списка поля со списком (attachCompletion, drop): верхний уровень каталога без фильтра, а выбор заменяет
	 * всё значение поля — где бы ни стояла каретка, хоть внутри строки.
	 */
	function wholeValueContext(input) {
		return { mode: 'path', parentPath: '', prefix: '', replaceStart: 0, replaceEnd: input.value.length, whole: true };
	}

	/**
	 * Строка списка поля со списком, совпадающая со значением поля (`&Имя` параметра, имя прочих строк). Нет такой (пусто,
	 * выражение, блок `{(&Имя)}`) — -1: ни одна строка не выбрана, как у поля со списком, чьё значение не из списка; ↓
	 * встаёт на первую.
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
	 * Открывает список у поля. how: auto — по вводу (пустой список молча не открывается), explicit —
	 * Ctrl+Пробел, full — «⋯»: весь уровень без фильтра, активна строка лучшего совпадения; drop —
	 * «▾» и Alt+↓ поля со списком: весь верхний уровень, активна строка значения поля (нет её — ни
	 * одна), выбор заменяет всё значение, пустой список показывается строкой binding.drop.empty.
	 * Переоткрытие со своим контекстом (knownCtx: пересчёт по описаниям) идёт от каретки, а не от
	 * всего значения.
	 */
	function openCompletion(binding, how, knownCtx) {
		const input = binding.input;
		if (input.readOnly || input.disabled || !input.isConnected) {
			return;
		}
		// До первого сообщения строки состояния: и «вариантов нет» должно прозвучать внутри окна
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
		// Список поля со списком, перефильтрованный набором, — уже подсказка у каретки: и пересчёт по описаниям
		// (onDescribed) должен идти от каретки, а не раскрывать снова весь список значений
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
		// Раскрытый список поля со списком читалка называет его словами («Параметры запроса»), прочие — «Подсказка»
		const drop = session.binding.drop;
		completeList.setAttribute('aria-label', session.ctx.whole && drop && drop.list ? drop.list : 'Подсказка');
		session.rows = [];
		for (let index = session.start; index < end; index += 1) {
			const row = completeRow(session.ranked[index], index);
			session.rows.push(row);
			completeList.appendChild(row);
		}
		// Пустой список поля со списком — своей строкой («В запросе ещё нет параметров…»), а не молчанием
		const note = total === 0 && session.empty ? session.empty : completer.windowNote(session.start, end, total);
		if (note) {
			// Счёт строк читалке уже сказан строкой состояния: подпись — для глаза
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
		// Состав определяемого типа строки: подпись в колонке типа короткая, состав — наведением и читалке
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
		// Вышли за нарисованное окно — окно сдвигается и перерисовывается, иначе меняется только отметка
		if (completer.windowStart(index, session.start, session.ranked.length, completer.MAX_ROWS) !== session.start) {
			renderCompletion();
			return;
		}
		markActiveRow();
	}

	/**
	 * Вставка строки index вместо набранного слова (applyItem модуля) и закрытие списка. Список поля со списком,
	 * открытый «▾» или Alt+↓ и не перефильтрованный набором, заменяет всё значение поля.
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

	/** Пишет вставку в поле (writeEditorText: правка остаётся в истории поля, Ctrl+Z отменяет только её). */
	function replaceCompletionText(input, ctx, result) {
		applyingCompletion = true;
		try {
			writeEditorText(input, ctx.replaceStart, ctx.replaceEnd, result.text, result.caret, result.caret);
		} finally {
			applyingCompletion = false;
		}
	}

	/** Ставит список у якоря: снизу от каретки, у края окна — сверху и с прижатием (placePopup модуля). */
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
		// Размер списка известен только после раскладки: меряем невидимым, затем ставим на место
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
	 * Якорь списка. Однострочное поле — его нижний край во всю ширину (точное x каретки там не
	 * нужно). Редактор кода — прямоугольник каретки, прижатый к видимой части поля: каретка,
	 * ушедшая прокруткой за край textarea, не утащит список на другой конец окна.
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
		// Сначала догоняем зеркало: перерисовка может и выключить его, если текст перерос лимит
		editor.flush();
		if (!editor.wrap.classList.contains('dcs-hl-off')) {
			return markerRectInMirror(editor.pre, caret);
		}
		return markerRectInClone(input, caret);
	}

	/**
	 * Каретка по метке в зеркале подсветки: у зеркала те же шрифт, отступы, перенос и прокрутка,
	 * что у textarea. Свёрнутый Range в начале строки даёт пустой прямоугольник, поэтому метка —
	 * временный span с невидимым символом; U+2060 (а не U+200B) не разрешает перенос внутри слова.
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
	 * Строка-подсказка у фокуса с клавиатуры. Название пиктограммы и полное имя обрезанной вертикальной
	 * вкладки конструктора запроса есть только в title, а его VS Code показывает при наведении мыши. Когда такая кнопка
	 * получает фокус с клавиатуры (:focus-visible), первая строка её title видна в строке у нижнего края окна:
	 * position: fixed — область прокрутки и края полосы вкладок её не обрезают, слой — над окнами и списком подсказки.
	 * Читалке строка не нужна (aria-hidden): у кнопки есть доступное имя. Уход фокуса и нажатие мыши её прячут.
	 */
	const focusHint = el('div', 'dcs-focus-hint hidden');
	focusHint.setAttribute('aria-hidden', 'true');
	focusHint.style.zIndex = String(dialogRules.POPUP_Z_INDEX + 1);
	document.body.appendChild(focusHint);

	/** Текст строки-подсказки для узла с фокусом: пиктограмма или вертикальная вкладка с фокусом с клавиатуры; иначе ''. */
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

	/** Показывает плашку с заголовком и строками; tone — ok, error или info. */
	function showNotice(tone, title, lines) {
		noticeEl.textContent = '';
		noticeEl.className = 'dcs-notice dcs-notice-' + tone;
		const head = el('div', 'dcs-notice-head');
		head.appendChild(el('span', 'dcs-notice-title', title));
		// Пиктограмма с именем словами: знак «×» читалка в живой области плашки произносила как «умножить»
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
	 * Строки плашки по вердикту строгой проверки: ошибки с позициями или «ошибок нет», затем предупреждения.
	 * Предупреждения на ok не влияют (схема читается и загружается): необъявленный &-параметр запроса, список значений
	 * старой записи, чьи представления потеряет загрузка, и флажок «Список параметров» у связи без параметра. Текст
	 * md-sparrow полный; вид (kind) нужен для подсказок, где такие места помечены, а у флажка без параметра — ещё и
	 * чтобы назвать связь номером таблицы (linkListFlagWarningLine).
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
				// Номер связи — как в таблице связей (с единицы), а не номер md-sparrow (с нуля)
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
	 * Подсказка к предупреждению о флажке «Список параметров» у связи без параметра (ключ link — номер связи с нуля).
	 * «Да» без параметра таблица связей помечает сама, по прочитанной модели; «нет» без параметра смысла связи не меняет
	 * (снятый флажок — то же, что «не задано»), и окно связи убирает его вместе с правкой.
	 */
	const VALIDATION_LINK_LIST_FLAG_HINT =
		'Связи с отмеченным флажком «Список параметров» без параметра помечены на вкладке «Связи наборов данных»: откройте связь и снимите флажок или задайте параметр. «Нет» без параметра смысла связи не меняет; окно связи убирает его вместе с любой правкой этой связи.';

	/**
	 * Подсказка к предупреждению о списке старой записи. Совет md-sparrow «уберите представления» окнами не выполнить:
	 * значение параметра схемы они не правят (смена типа лишь очищает неподходящее), а снятие флажка «Доступен список
	 * значений» уводит пометку, но не представления. Поэтому подсказка говорит, чем их всё же убрать: записью списка
	 * заново.
	 */
	const VALIDATION_LIST_PRESENTATIONS_HINT =
		'Такие списки помечены и на вкладке «Параметры». Ни окна правки, ни снятие флажка «Доступен список значений» представления не убирают: убрать их можно только записью списка заново без представлений.';

	/** Тон плашки проверки: ошибка, «ошибок нет» или — при предупреждениях без ошибок — нейтральный. */
	function validationNoticeTone(msg) {
		if (!msg.ok) {
			return 'error';
		}
		return msg.warnings.length > 0 ? 'info' : 'ok';
	}

	/**
	 * Проверка схемы ждёт правку в полёте: jar читает файл макета, и вердикт должен говорить о том, что пользователь
	 * видит. Текст запроса пишется по уходу из поля — то есть уже на нажатии «Проверить схему», и проверка, ушедшая
	 * сразу, читала бы макет, который в это время пишет cf-dcs-set-query (а за ним — заполнение полей).
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

	/** Отложенная проверка схемы — когда канал правок свободен: ответ пришёл и следом ничего не ушло. */
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
	/** Хост сказал, что дерева в его кэше нет и идёт загрузка с нуля: на большой выгрузке — минуты. */
	let qcGroupsCold = false;
	/** Перерисовка открытого уровня конструктора; null — уровень закрыт. */
	let qcRerender = null;

	/**
	 * Дерево объектов для открытия конструктора. Запрос уходит и при уже полученном дереве: кэш держит
	 * хост (по отпечатку Configuration.xml), и сверка с ним дешёвая, а без неё объект, добавленный при
	 * открытой вкладке, появился бы только после её переоткрытия. Пока ответа нет, показывается
	 * последнее полученное дерево.
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
	 * Таблицы языка запросов объектов (cf-md-query-tables, сообщение dcs/query-tables) по ключу
	 * «язык|путь»: правки схемы метаданные конфигурации не меняют, а каждое чтение — запуск jar.
	 * Язык — в ключе: русский и английский ответы называют таблицы и стандартные реквизиты по-разному.
	 * Состояния: loading — запрос ушёл, ready — описание есть, error — описания нет (текст в error).
	 */
	const queryTablesCache = new Map();

	function queryTablesKey(relativePath, lang) {
		return (lang === 'en' ? 'en' : 'ru') + '|' + relativePath;
	}

	/** Описание объекта из кэша; нет в кэше — запрос панели, пока ответ не пришёл — состояние loading. */
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
	 * Кнопки строки таблицы. action.svg — имя пиктограммы команды: кнопка рисуется iconButton, title — её полное
	 * название и доступное имя. action.unavailable и action.note — недоступна, но в обходе Tab (aria-disabled) с
	 * причиной; onClick тогда сам называет причину.
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
			// Ключ — для возврата фокуса после перерисовки вкладки (captureFocus)
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
	 * Словарь окна типа (cf-dcs-type-dictionary) на время вкладки: правки схемы состав
	 * конфигурации не меняют, а чтение словаря — запуск jar по всей выгрузке.
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

	/** Подпись типа по модулю типов; без типа — строка md-sparrow (valueTypePresentation, type). */
	function typeLabelOf(valueType, fallback) {
		return valueType ? typeRules.typePresentation(valueType, typeDictionary) : fallback || '';
	}

	/**
	 * Состав определяемых типов и характеристик для всплывающей подсказки и доступного описания:
	 * подпись остаётся «ОпределяемыйТип.X», а что за ним стоит, видно наведением и слышно читалке.
	 * Без типа или без состава — пусто.
	 */
	function typeCompositionOf(valueType) {
		return valueType ? typeRules.compositionTitle(valueType, typeDictionary) : '';
	}

	/**
	 * Состав — в title (к уже заданной подсказке узла — новой строкой) и в aria-description:
	 * только title экранный диктор не читает, а aria-description дополняет имя (aria-label), не заменяя его.
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
	 * Вкладка схемы рисуется заново целиком после каждой правки: ответ saved несёт новую модель. Узлы с ключом
	 * (data-dcs-key) — поля и флажки ячеек, кнопки, строки списков, текст запроса. После перерисовки фокус
	 * возвращается на узел с тем же ключом, если сама отрисовка его никуда не поставила (дерево наборов ставит
	 * фокус само). Недописанный текст поля, значение которого правка не меняла, переезжает в новое поле вместе с
	 * выделением: правка соседней строки не стирает набранное.
	 */
	const focusKeys = new Map();
	/** Значение, с которым поле ввода нарисовано: по нему видно, что пользователь начал его править. */
	const renderedValues = new WeakMap();
	/**
	 * Переименование, ответ на которое ещё не пришёл: ключи узлов строки содержат имя (путь поля), и после
	 * ответа узел с прежним ключом ищется под новым. {scope, from, to} — ключ вида «вид\nscope\nfrom\n…».
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

	/** Ключ после переименования: вторая часть — scope (набор), третья — прежнее имя; иначе null. */
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

	/** Узел по ключу снимка: прежний ключ, а если строку переименовали — ключ под новым именем. */
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
		// Отрисовка сама поставила фокус (дерево наборов после стрелки): не спорим с ней
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
	 * Флажки «вернуть фокус после перерисовки» — для навигации с клавиатуры: стрелка в таблице вариантов или в дереве
	 * перерисовывает вкладку, и фокус должен встать на новую строку.
	 */
	let focusVariantRow = false;
	let focusStructureRow = false;
	/** Ключ состояния списка панели (listStateKey), строке которого вернуть фокус в этой отрисовке. */
	let focusListPanel = '';
	/**
	 * Фокус, который вернуть после ответа правки, отправленной с клавиатуры: удаление варианта, узла или строки списка
	 * клавишей Delete, переименование варианта из таблицы. Ставится при отправке, в флажки отрисовки переходит только
	 * удачным ответом saved и после его отрисовки гаснет; отказ, смена варианта, узла и вкладки узла его сбрасывают.
	 * Иначе флажок сработал бы на первой же чужой отрисовке (щелчок по другому узлу до ответа) или пережил бы ответ.
	 */
	const replyFocus = { variant: false, structure: false, list: '', fallback: '', resources: false };
	/** Вернуть фокус на выбранную строку таблицы «Ресурсов» (или «<») в этой отрисовке: удаление из таблицы. */
	let focusResourceRow = false;

	function clearReplyFocus() {
		replyFocus.variant = false;
		replyFocus.structure = false;
		replyFocus.list = '';
		replyFocus.fallback = '';
		replyFocus.resources = false;
	}

	/**
	 * Удаление строки кнопкой в строке, когда ключи кнопок — по номеру строки: после ответа фокус вернётся на ту же
	 * кнопку, теперь у строки-преемника. Удалена последняя строка — преемника нет: запасной фокус — та же кнопка у
	 * предыдущей строки, а без строк — команда над списком (emptyKey).
	 */
	function rowRemovalFocus(keyOf, index, emptyKey) {
		replyFocus.fallback = index > 0 ? keyOf(index - 1) : emptyKey;
	}

	// ---------- кнопки переноса между списками ----------

	/**
	 * Столбец кнопок переноса между двумя списками (> >> < <<) — общий у конструктора запроса и вкладок схемы, чтобы
	 * вид и клавиатура были одни. Подпись — знак, смысл — в title и aria-label: у знака нет слова, которое читалка
	 * назвала бы. items: [{label, title, onClick, unavailable?, note?}]: unavailable — недоступна, но остаётся в обходе
	 * Tab (aria-disabled), щелчок доходит до onClick, и тот говорит, почему; note — вторая строка подсказки и описание
	 * для читалки (причина недоступности). Возвращает {box, buttons}.
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
	 * Сколько уровней реквизитов по типу раскрывает дерево доступных полей под полем — как конструктор настроек
	 * (WIZARD_TYPE_DEPTH) и деревья полей конструктора запроса: глубже путь вводится в окне «Добавить поле…».
	 */
	const FIELD_TREE_TYPE_DEPTH = 3;

	/** Ключ строки дерева доступных полей: путь без учёта регистра — так сверяет пути платформа. */
	function fieldTreeKey(path) {
		return String(path || '').toLowerCase();
	}

	/**
	 * Дерево доступных полей по узлам каталога подсказки (DcsComplete.buildCatalog: {name, path, kind, title, children};
	 * kind field — поле набора, calc — вычисляемое, folder и path — папка и промежуточный узел пути). Общий компонент
	 * вкладок схемы: «Ресурсы», «Настройки», источник перетаскивания.
	 * - Одна остановка Tab — выбранная строка (без выбора — первая). ↑ ↓ Home End выбирают соседнюю строку без
	 *   перерисовки, → раскрывает (у раскрытой — к первому ребёнку), ← сворачивает (иначе — к родителю), Enter и двойной
	 *   щелчок — onActivate выбранной строки (повтор зажатого Enter — нет). Набора букв для поиска нет: у остальных деревьев редактора его тоже нет.
	 * - Состояние {selected, expanded: Set} — у вызывающего (spec.state): выбор и раскрытые ветки переживают перерисовку
	 *   вкладки. Строки с ключом (keyed) — фокус после перерисовки возвращается на ту же строку.
	 * - У вычисляемого поля — значок «f(x)» (свой текст, не рисунок 1С), в доступном имени — «вычисляемое поле».
	 * spec: {label, nodes, state, keyPrefix, empty, onActivate(node), onSelect?(node), note?(node) — пометка строки,
	 * pickable?(node) — выбирается ли узел полем (по умолчанию — поле набора и вычисляемое: у «Настроек» ещё ресурсы,
	 * параметры данных, системные и пользовательские поля); Enter у невыбираемого узла с детьми раскрывает его,
	 * decorate?(row, node) — крючок источника (атрибуты и обработчики строки), drag?: {id, scope, from?} — дерево как
	 * источник и зона переноса мышью: строка выбираемого узла получает атрибут draggable (вид переноса 'field'),
	 * from — сброс строк других списков на дерево (убрать, как «<»); строка, которую тащили, выбирается, как щелчком},
	 * typeChildren?(node) — реквизиты поля по типу {children, pending} или null (у «Настроек»: Контрагент → Контрагент.ИНН,
	 * не глубже FIELD_TREE_TYPE_DEPTH уровней), requestTypes?(pending) — прочитать недостающие описания (ответ перерисует
	 * дерево; до него под полем — «Загрузка реквизитов…»).
	 * Возвращает {element, selected() — узел или null, select(path, focus), focus(), nodeOf(ключ строки) — узел или null}.
	 */
	function fieldTree(host, spec) {
		const tree = el('div', 'dcs-tree dcs-qd-tree dcs-field-tree');
		tree.setAttribute('role', 'tree');
		tree.setAttribute('aria-label', spec.label);
		host.appendChild(tree);
		const state = spec.state;
		let rows = [];
		let items = new Map();
		// Строка дерева → её ключ (только у источника переноса) и ключ → строка (при первом обращении после отрисовки):
		// перенос и nodeOf узнают узел без обхода строк, а отрисовка их не строит
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
			// Слушателей у дерева и строк нет: зона — запись у обвязки документа, строке — только атрибут
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
		 * Строки дерева по раскрытым веткам. typeDepth — уровень реквизитов по типу (у узлов каталога 0): у поля каталога
		 * реквизиты считаются сразу (spec.typeChildren кэширует), у свёрнутого реквизита стрелку решает его тип
		 * (typeExpandable) — без подсчёта детей на каждую строку. Реквизиты, чьих описаний ещё нет (pending), дают под
		 * раскрытым полем строку «Загрузка реквизитов…» (loading): она не остановка и не выбирается.
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
			// Полный путь — подсказкой у подписи, а не у строки: title строки читалка добавила бы к её имени описанием
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
			// Имя для читалки: значок «f(x)» скрыт, его смысл — словами
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
					// Под раскрытым полем может быть только «Загрузка реквизитов…» — тогда шагать некуда
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

	// Ответ, пришедший во время переноса мышью, ждёт его конца: перерисовка убрала бы строку из-под указателя
	window.addEventListener('message', (event) => whenIdle(() => onHostMessage(event)));

	function onHostMessage(event) {
		const msg = event.data;
		if (!msg || typeof msg !== 'object') {
			return;
		}
		if (msg.type === 'validation') {
			// Вердикт строгой проверки схемы: плашка с ошибками или «ошибок нет» и предупреждениями
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
			// Таблицы объекта для конструктора: в кэш вкладки по пути и языку; «вне выгрузки» и
			// ошибка — описания нет, повтора нет (повтор — новым открытием вкладки)
			if (typeof msg.relativePath === 'string' && msg.relativePath !== '') {
				const ready = !msg.error && !msg.outside && msg.description && typeof msg.description === 'object';
				// Составы — до обоих кэшей: описание в них одно и то же
				const description = ready ? withTypeCompositions(msg.description) : null;
				queryTablesCache.set(
					queryTablesKey(msg.relativePath, msg.lang),
					ready
						? { state: 'ready', description: description }
						: { state: 'error', error: String(msg.error || msg.note || 'Таблицы объекта не прочитаны.') }
				);
				// Тот же ответ cf-md-query-tables нужен и полям источников конструктора, и подсказке через
				// точку (кэш описаний по имени объекта): второе чтение jar того же объекта не нужно
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
			// Словарь окна типа — в кэш вкладки; ошибка — плашкой в окне, повтор — её кнопкой
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
			// Описание объекта для подсказки через точку: в кэш вкладки; «вне выгрузки» гасит
			// дальнейшие запросы, ошибка и ненайденный объект — «описания нет» без повторов
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
			// Раскрытое поле «Доступных полей» «Настроек» ждало реквизитов: вкладка перерисовывается, фокус — по ключу строки
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
			// Ответ ленивой загрузки настроек варианта: данные в кэш, ошибка — в плашку
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
			// Ответ фоновой записи текста запроса: правки по одной, так что в полёте была она
			onBackgroundSaved(msg);
			return;
		}
		// Отказ пакета «>>» называет поле, а не номер операции (resourceRefusalText); прочие отказы — как есть
		const refusal = msg.ok ? '' : resourceRefusalText(resourceReply, msg.error);
		setStatus(msg.ok ? 'Сохранено' : String(refusal || 'Ошибка сохранения'), !msg.ok);
		// Окно, из которого ушла правка; правка со страницы (null) окон, открытых после неё, не закрывает
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
			// Фокус после правки с клавиатуры (Delete, переименование из таблицы) — только в отрисовке этого ответа
			focusVariantRow = replyFocus.variant;
			focusStructureRow = replyFocus.structure;
			focusListPanel = replyFocus.list;
			focusResourceRow = replyFocus.resources;
			const fallbackFocus = replyFocus.fallback;
			clearReplyFocus();
			// Добавленный ресурс («>», «>>», окно): выбрана его строка, итог — плашкой после отрисовки
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
			// Удалён последний вариант: закладка «Настройки» остаётся, фокус её отрисовка ставит на «Добавить
			// вариант…» (renderVariants) — ярлык закладки его не забирает
			if (fallbackFocus && (!document.activeElement || document.activeElement === document.body)) {
				// Кнопки удалённой последней строки больше нет: фокус — на запасной цели, а не в никуда
				focusKeyed(fallbackFocus);
			}
			// Плашка — по модели ответа: у «>» вид типа поля считается заново, описания могли прийти за время сохранения
			const resourceNotice = resourceDone ? resourceReplyNotice(resourceDone) : null;
			if (resourceNotice) {
				showNotice(resourceNotice.tone, 'Ресурсы', resourceNotice.lines);
			}
			// Ответ отрисован (или вкладка «Настройки» не на экране): флажки не ждут следующей, чужой отрисовки
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
		// Ресурс не добавлен: выбор в таблице прежний, итога нет — причину скажет отказ
		resourceReply = null;
		// Фокус после удаления клавишей ждал удачного ответа: на отказ его не переносить и при следующей перерисовке
		clearReplyFocus();
		// Отказ правки из окна показывается в верхнем окне: правку отправила кнопка этого стека
		if (fromDialog) {
			dialogStack.top().setError(String(msg.error || 'Ошибка сохранения'));
		}
		const pathCommit = pendingPathCommit;
		pendingPathCommit = null;
		if (pathCommit) {
			// md-sparrow не принял путь из ячейки: причина — под ячейкой, как у отказа проверки, набранное остаётся, а
			// уход из ячейки тот же путь заново не шлёт (Enter — шлёт)
			const problem = 'Не переименовано: ' + String(msg.error || 'ошибка сохранения');
			fieldPathDrafts.set(pathCommit.draftKey, { text: pathCommit.value, problem: problem, refused: true });
			renderContent();
			// Строка под ячейкой рисуется заново уже с текстом — такую живая область не объявляет
			announceCompletion(problem);
		} else if (!fromDialog) {
			// Правка со страницы (флажок, ячейка, действие списка) или из окна, которое уже закрыто: элементы возвращаются к
			// модели, причину слышит читалка — строка состояния не живая область. Фокус перерисовка возвращает по ключу
			renderContent();
			// Отказ «>>» с полем вместо номера операции уже начат словами «Ресурсы не добавлены»: «Не сохранено» ему лишнее
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
	 * Тип колонки X общей таблицы констант — тип поля «Значение» таблицы `Константа.X`, только если её
	 * описание уже в кэше вкладки (константа раскрывалась в дереве, её тип выводился): запроса здесь нет.
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
	 * Общая таблица констант (`Константы` / `Constants`): своего описания в md-sparrow у неё нет, и
	 * таблица собирается из ветки констант дерева «База данных» — по полю на константу (имя и синоним).
	 * Описания всех констант не запрашиваются: их сотни (в ERP — тысячи), а тип поля нужен только
	 * раскрытию и выводу типов, и тот, кому он нужен, просит описание своей константы сам
	 * (DcsFieldTypes.constantColumnTable). Пока дерево не пришло — loading: ответ дерева перерисует окно.
	 * Сборка запоминается, пока не сменились дерево и кэш описаний: таблицу спрашивают на каждую
	 * перерисовку по каждому источнику, а констант тысячи.
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
	 * Таблица языка запросов из кэша описаний (cf-md-query-tables через dcs/describe-type): нет в
	 * кэше — запрос панели и состояние loading, ответ перерисует открытый конструктор (qcRerender).
	 * Общую таблицу констант собирает constantsQueryTable из дерева.
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
	 * Тип колонки запроса пакета модели конструктора (колонка временной таблицы — по запросу, который её
	 * создал): недостающие описания запрашиваются, ответ перерисует открытый конструктор.
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

	/** Итог вывода типа для конструктора: недостающие описания — запросом панели, ответ перерисует окно. */
	function queryTypeAnswer(result) {
		if (result.pending.length > 0) {
			requestDescriptions(result.pending);
		}
		return { type: result.type, loading: result.pending.length > 0 };
	}

	/**
	 * Тип выражения в части запроса модели конструктора (деление «>>» на «Группировке» по типу и
	 * сумма нечислового поля). address — {statement, part} части в batch; outerTemp — временные
	 * таблицы внешнего пакета у вложенного конструктора. Флаг дерева «База данных» (metadataAvailable)
	 * здесь не нужен: описания объектов читаются и в проекте EDT (.mdo), как у подсказки «через точку»,
	 * а без этого деление «>>» в EDT писало бы СУММА(Т.Ссылка). Макет вне выгрузки хост узнаёт
	 * сам (describeOutside) — тогда типа нет.
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
	 * Проверка имён доступна, когда макет внутри выгрузки конфигурации и выгрузка — не расширение (признак
	 * стартовой модели, как queryConstructor). В выгрузке расширения нет объектов основной конфигурации, а
	 * описания заимствованных объектов несут только заимствованные реквизиты и части: проверка по ним давала
	 * бы ложные предупреждения на рабочих запросах.
	 */
	const nameCheckAvailable = metadataAvailable && !(model && model.configurationExtension);

	/**
	 * Общие реквизиты выгрузки (признак стартовой модели, перечитанные модели его не несут): поля таблиц, которых
	 * описания md-sparrow перечисляют не у всех таблиц (табличные части, константы), — о них проверка имён молчит.
	 */
	const nameCheckCommonAttributes = model && Array.isArray(model.configurationCommonAttributes) ? model.configurationCommonAttributes.slice() : [];

	/** Имена объектов дерева «База данных» по видам (без учёта регистра): собирается заново, когда приходит новое дерево. */
	let treeObjectIndex = null;

	/**
	 * Есть ли объект в дереве «База данных»: true / false; null — дерева ещё нет, вид неизвестен или ветки
	 * вида в дереве нет вовсе: утверждать «нет объекта» тогда нельзя.
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
	 * Предупреждения проверки имён модели запроса (DcsQueryEdit.nameProblems) по кэшу описаний; их ответы
	 * перерисуют конструктор и строку под текстом набора. outerTemp — ВТ внешнего пакета у вложенного
	 * конструктора. options.quiet — строка под текстом набора: ради неё дерево «База данных» не грузится
	 * (на большой выгрузке холодная загрузка — минуты), и таблица «Константы» без дерева не проверяется;
	 * options.ask — запрашивать ли недостающие описания: у конструктора — сразу, у строки набора — 'later'
	 * (после отрисовки вкладки, и только для сохранённого текста: черновик при наборе дал бы запросы по
	 * недописанным именам) или false. Недоступна проверка — пустой список.
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
			// Строке набора описания не к спеху: запросы уходят после отрисовки, а то, что к этому времени уже
			// запросил кто-то другой (конструктор, подсказка), повторно не шлётся
			const pending = env.pending.slice();
			setTimeout(() => requestDescriptions(pending), HIGHLIGHT_DEBOUNCE_MS);
		} else if (env.pending.length > 0 && ask) {
			requestDescriptions(env.pending);
		}
		return problems;
	}

	// ---------- закладки ----------

	/**
	 * Объект ядра для фабрик закладок (window.DcsEditorSchema, window.DcsEditorSettings и через неё
	 * window.DcsEditorSettingsPanels): других имён этого скрипта закладки не видят. В нём:
	 * - элементы форм, таблиц и списков, пиктограммы, перенос мышью, подсказка ввода и редактор кода;
	 * - окна стека диалогов, плашка и строка состояния, ключи фокуса и фокус после ответа правки;
	 * - канал панели (send, post, postEdit), перерисовка (renderTabs, renderContent), кэши описаний, подписи типов
	 *   и значений, кэш настроек вариантов;
	 * - изменяемое общее состояние полями-аксессорами (get/set): модель, правка в полёте и её очередь, ожидания ответа,
	 *   флажки фокуса, словарь типов. Закладки читают и пишут его как core.model, а не копией значения.
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

	// Модули закладок подключены до этого скрипта и только задали фабрики. Закладки создаются здесь, когда всё, что
	// отдаёт объект ядра, уже объявлено; ядру от них нужны отрисовка и обработчики ответов панели
	const schemaTabs = window.DcsEditorSchema(core);
	const settingsTab = window.DcsEditorSettings(core);
	const {
		fieldPathDrafts, flushQueryEdits, linkListFlagWarningLine, onBackgroundSaved, pruneFieldPathDrafts,
		reconcileQueryDrafts, renderCalculated, renderDataSets, renderLinks, renderNested, renderParameters, renderResources,
		resourceRefusalText, resourceReplyNotice, resourceUi, retryQueryDrafts, scheduleNameCheck,
	} = schemaTabs;
	const { activeVariantName, affectedVariant, expandTo, renderVariants, uiState } = settingsTab;

	/**
	 * Вкладки в порядке конфигуратора; редактируемые видны всегда, остальные — пока не пусты. «Настройки» видны и без
	 * вариантов: первый вариант добавляется из пустой таблицы вариантов.
	 */
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
	 * Явный API редактора для многостраничного конструктора запроса (dcs-editor-query-dialog.js):
	 * он подключается после этого скрипта и ничего, кроме этого объекта, внутри не видит.
	 * - элементы форм: el, formRow, textInput, selectInput, checkbox, codeEditor (редактор
	 *   с подсветкой {box, input, flush}), attachCompletion(input, scopeFn, options) — подсказка;
	 *   iconButton(spec) — кнопка-пиктограмма команды над списком (spec — у iconButton);
	 *   transferButtons(host, items) — столбец кнопок переноса > >> < << (общий с вкладкой «Ресурсы»);
	 *   drag — перенос мышью: zone(контейнер, spec) — зона списка (spec — у dragZone), index — номер вставки
	 *   по месту сброса у строки (dropIndex);
	 * - окна: pushDialog(spec) — уровень стека диалогов;
	 * - канал: send(type, fields) — правка (false — предыдущая ещё сохраняется, текст busyText; за фоновой записью
	 *   текста запроса набора правка встаёт в очередь); isSaving() — новая правка получила бы отказ; ответ saved
	 *   закрывает все окна или показывает отказ в верхнем (ответ фоновой записи окна не трогает);
	 * - данные: model() — текущая модель cf-dcs-info; typeLabel(valueType) — подпись типа;
	 *   metadata.available() / request() / retry() / state() — дерево «База данных» (dcs/list-metadata);
	 *   queryTables(relativePath, lang) — таблицы объекта дерева (dcs/query-tables, кэш вкладки);
	 *   describeTable(имяТаблицы) — {state: ready|loading|none, table} по кэшу описаний (общую таблицу
	 *   констант `Константы` / `Constants` — из ветки констант дерева, constantsQueryTable);
	 *   typeChildren(valueType) — {children, loading}; expandable(valueType) — есть ли дети по типу;
	 *   batchColumnType(модельЗапроса, номерЗапроса, колонка) — {type, loading}: тип колонки запроса
	 *   пакета (колонки временных таблиц);
	 *   partExpressionType(модельЗапроса, {statement, part}, выражение, внешниеВТ?) — {type, loading}:
	 *   тип выражения в части (деление «>>» на «Группировке», сумма нечислового);
	 *   subqueryColumnType(модельЗапроса, номерЗапроса, запросИсточника, колонка, внешниеВТ?) —
	 *   {type, loading}: тип колонки вложенного запроса;
	 *   nameProblems(модельЗапроса, внешниеВТ?) — предупреждения проверки имён по метаданным
	 *   (DcsQueryEdit.nameProblems); вне выгрузки и в выгрузке расширения — пустой список;
	 * - перерисовка: setRerender(fn) / clearRerender(fn) — fn зовётся на каждый ответ дерева,
	 *   таблиц объекта и описаний, пока конструктор открыт.
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
