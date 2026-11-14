/**
 * Стек диалогов редактора СКД: чистая часть без DOM.
 *
 * Мастеру настроек и конструктору запроса нужны окна поверх окон (подтверждение, параметры
 * таблицы, окно выражения), а у webview один документ и один набор клавиш. Поэтому решения
 * «какой уровень активен», «что делает Escape и Tab», «куда вернуть фокус» собраны здесь и
 * проверяются node-тестами; dcs-editor.js только исполняет их над DOM.
 *
 * Файл живёт двумя жизнями, как подсветка: webview подключает его отдельным <script> перед
 * dcs-editor.js и берёт window.DcsDialogs, node-тесты исполняют его в песочнице и читают
 * module.exports — поэтому здесь нет ни document, ни acquireVsCodeApi.
 */
(function (root) {
	'use strict';

	/**
	 * Предел глубины. Самый глубокий сценарий — вложенный запрос конструктора с окном
	 * параметров таблицы и окном выражения (4–5 уровней); больше — признак зацикленного открытия.
	 */
	const MAX_DEPTH = 8;

	/** Слой первого уровня — z-index .dcs-dialog-backdrop в стилях. */
	const Z_BASE = 20;
	/** Шаг через единицу: между уровнями остаётся место под их собственные слои. */
	const Z_STEP = 2;
	/** Список подсказки висит на body и должен быть выше любого уровня стека. */
	const POPUP_Z_INDEX = Z_BASE + Z_STEP * (MAX_DEPTH + 1);

	/** normal — обычная форма, wide — форма с таблицами, full — многостраничные конструкторы. */
	const WIDTHS = ['normal', 'wide', 'full'];

	/** Кнопка по умолчанию: уровень без подвала нельзя было бы закрыть мышью. */
	const DEFAULT_BUTTONS = [{ id: 'close', label: 'Закрыть' }];

	/**
	 * Проверяет и нормализует кнопки подвала. Ошибки здесь — ошибки разработчика (опечатка
	 * в описании уровня), поэтому исключение, а не текст для пользователя.
	 */
	function normalizeButtons(buttons) {
		const source = buttons === undefined ? DEFAULT_BUTTONS : buttons;
		if (!Array.isArray(source)) {
			throw new Error('Диалог: кнопки подвала задаются списком.');
		}
		const seen = [];
		let primaries = 0;
		const result = source.map((button, index) => {
			if (!button || typeof button.id !== 'string' || button.id === '') {
				throw new Error('Диалог: у кнопки ' + (index + 1) + ' нет id.');
			}
			if (seen.indexOf(button.id) >= 0) {
				throw new Error('Диалог: id кнопки «' + button.id + '» повторяется.');
			}
			seen.push(button.id);
			if (typeof button.label !== 'string' || button.label === '') {
				throw new Error('Диалог: у кнопки «' + button.id + '» нет подписи.');
			}
			if (button.onClick !== undefined && button.onClick !== null && typeof button.onClick !== 'function') {
				throw new Error('Диалог: onClick кнопки «' + button.id + '» должен быть функцией.');
			}
			if (button.primary) {
				primaries += 1;
			}
			return {
				id: button.id,
				label: button.label,
				primary: Boolean(button.primary),
				disabled: Boolean(button.disabled),
				// Недоступна, но остаётся в обходе Tab (aria-disabled): disabled снял бы с кнопки фокус, когда
				// она гаснет под пальцем, — так у «Далее >» на последней вкладке конструктора запроса
				unavailable: Boolean(button.unavailable),
				// Кнопка без обработчика — «Отмена» своего уровня: так не нужно писать её в каждом окне
				onClick: typeof button.onClick === 'function' ? button.onClick : null,
			};
		});
		if (primaries > 1) {
			throw new Error('Диалог: основная кнопка может быть только одна.');
		}
		return result;
	}

	/** Описание уровня для pushDialog: ширина из трёх, кнопки проверены, обработчики — функции или null. */
	function normalizeSpec(spec) {
		if (!spec || typeof spec !== 'object') {
			throw new Error('Диалог: нет описания уровня.');
		}
		const width = spec.width === undefined || spec.width === null || spec.width === '' ? 'normal' : spec.width;
		if (WIDTHS.indexOf(width) < 0) {
			throw new Error('Диалог: неизвестная ширина «' + width + '», допустимы normal, wide и full.');
		}
		for (const key of ['build', 'onCancel', 'onClose']) {
			if (spec[key] !== undefined && spec[key] !== null && typeof spec[key] !== 'function') {
				throw new Error('Диалог: ' + key + ' должен быть функцией.');
			}
		}
		return {
			title: typeof spec.title === 'string' ? spec.title : '',
			width: width,
			buttons: normalizeButtons(spec.buttons),
			build: typeof spec.build === 'function' ? spec.build : null,
			onCancel: typeof spec.onCancel === 'function' ? spec.onCancel : null,
			onClose: typeof spec.onClose === 'function' ? spec.onClose : null,
			returnFocus: spec.returnFocus || null,
		};
	}

	/** Можно ли открыть ещё один уровень поверх depth открытых. */
	function canPush(depth) {
		return depth < MAX_DEPTH;
	}

	/**
	 * Стек уровней: уровни — непрозрачные объекты DOM-обвязки, стек хранит только порядок.
	 * truncate отдаёт закрытые уровни сверху вниз — в этом порядке их и разбирают.
	 */
	function createStack() {
		const levels = [];
		return {
			depth: function () {
				return levels.length;
			},
			top: function () {
				return levels.length > 0 ? levels[levels.length - 1] : null;
			},
			at: function (index) {
				return index >= 0 && index < levels.length ? levels[index] : null;
			},
			indexOf: function (level) {
				return levels.indexOf(level);
			},
			push: function (level) {
				if (!canPush(levels.length)) {
					throw new Error('Диалог: открыто слишком много окон подряд (больше ' + MAX_DEPTH + ').');
				}
				levels.push(level);
				return levels.length;
			},
			/** Закрывает уровень index и всё, что над ним; список закрытых — сверху вниз. */
			truncate: function (index) {
				if (index < 0 || index >= levels.length) {
					return [];
				}
				return levels.splice(index).reverse();
			},
		};
	}

	/** Слой уровня (1 — нижний): каждый следующий выше предыдущего. */
	function zIndexOf(level) {
		return Z_BASE + Z_STEP * (level - 1);
	}

	/**
	 * Состояние уровней при depth открытых: активен только верхний, нижние затемнены и
	 * неактивны (inert), страница под стеком неактивна, пока открыт хотя бы один уровень.
	 */
	function levelStates(depth) {
		const levels = [];
		for (let index = 0; index < depth; index += 1) {
			const active = index === depth - 1;
			levels.push({ active: active, inert: !active, zIndex: zIndexOf(index + 1) });
		}
		return { pageInert: depth > 0, levels: levels };
	}

	/**
	 * Что закрывает Escape: открытый список подсказки важнее окна — иначе Escape «проваливался»
	 * бы сквозь список и закрывал форму с недописанным выражением.
	 */
	function escapeAction(depth, popupOpen) {
		if (popupOpen) {
			return 'popup';
		}
		return depth > 0 ? 'level' : 'none';
	}

	/**
	 * Куда ведёт Tab в верхнем уровне. count — фокусируемые элементы уровня в порядке обхода,
	 * current — индекс элемента с фокусом (-1 — фокус вне элементов уровня).
	 * prevent:false — внутри уровня браузер обойдёт сам; index:-1 — фокусировать сам уровень.
	 */
	function tabTarget(count, current, backward) {
		if (count <= 0) {
			return { prevent: true, index: -1 };
		}
		if (current < 0 || current >= count) {
			return { prevent: true, index: backward ? count - 1 : 0 };
		}
		if (!backward && current === count - 1) {
			return { prevent: true, index: 0 };
		}
		if (backward && current === 0) {
			return { prevent: true, index: count - 1 };
		}
		return { prevent: false, index: current };
	}

	/**
	 * Куда вернуть фокус после закрытия уровней.
	 * closed — закрытые уровни сверху вниз (у каждого returnFocus — вызвавший элемент или null);
	 * focusLeft — фокус был внутри закрытых уровней или потерян; usable(element) — элемент жив и
	 * доступен в том, что осталось; remainingDepth — сколько уровней осталось открытыми.
	 *
	 * Вызвавший элемент берётся у нижнего закрытого уровня: элементы верхних жили внутри
	 * закрытых же окон. Если обработчик сам перевёл фокус наружу (например, в редактор
	 * запроса), фокус не трогается.
	 */
	function focusAfterClose(closed, focusLeft, usable, remainingDepth) {
		if (!focusLeft || !Array.isArray(closed) || closed.length === 0) {
			return { kind: 'keep' };
		}
		const bottom = closed[closed.length - 1];
		const target = bottom && bottom.returnFocus ? bottom.returnFocus : null;
		if (target && usable(target)) {
			return { kind: 'element', element: target };
		}
		return remainingDepth > 0 ? { kind: 'top' } : { kind: 'keep' };
	}

	/** Отмена уровня (Escape, «Отмена»): onCancel, вернувший false, оставляет окно открытым. */
	function cancelAllowed(result) {
		return result !== false;
	}

	/** Итог нажатия кнопки: строка — текст ошибки под телом, иначе строка ошибки очищается. */
	function clickError(result) {
		return typeof result === 'string' ? result : '';
	}

	/** Знак изменённого окна после заголовка — как у конструктора запроса платформы («Конструктор запроса *»). */
	const MODIFIED_MARK = '*';
	/** То же для читалки: «звёздочка» в имени окна ничего не говорит, слова — говорят (без рода: окна разные). */
	const MODIFIED_SPOKEN = 'есть изменения';

	/**
	 * Части заголовка уровня: text — сам заголовок, mark — знак для глаза (читалке не виден), spoken —
	 * скрытое с экрана слово для читалки. Без правок mark и spoken пустые.
	 */
	function titleParts(title, modified) {
		const text = typeof title === 'string' ? title : '';
		return modified ? { text: text, mark: MODIFIED_MARK, spoken: MODIFIED_SPOKEN } : { text: text, mark: '', spoken: '' };
	}

	const api = {
		MAX_DEPTH: MAX_DEPTH,
		POPUP_Z_INDEX: POPUP_Z_INDEX,
		WIDTHS: WIDTHS.slice(),
		normalizeButtons: normalizeButtons,
		normalizeSpec: normalizeSpec,
		canPush: canPush,
		createStack: createStack,
		zIndexOf: zIndexOf,
		levelStates: levelStates,
		escapeAction: escapeAction,
		tabTarget: tabTarget,
		focusAfterClose: focusAfterClose,
		cancelAllowed: cancelAllowed,
		clickError: clickError,
		titleParts: titleParts,
	};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (root) {
		root.DcsDialogs = api;
	}
})(typeof window === 'undefined' ? globalThis : window);
