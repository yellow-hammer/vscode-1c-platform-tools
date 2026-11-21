/**
 * Стек диалогов редактора СКД: чистая часть без DOM.
 *
 * Решения «какой уровень активен», «что делает Escape и Tab», «куда вернуть фокус» собраны
 * здесь и проверяются node-тестами; dcs-editor.js исполняет их над DOM. Webview берёт
 * window.DcsDialogs, node-тесты читают module.exports, поэтому здесь нет ни document,
 * ни acquireVsCodeApi.
 */
(function (root) {
	'use strict';

	/** Предел глубины: реальным сценариям хватает 4–5 уровней, больше значит зацикленное открытие. */
	const MAX_DEPTH = 8;

	/** Слой первого уровня: z-index .dcs-dialog-backdrop в стилях. */
	const Z_BASE = 20;
	/** Шаг через единицу: между уровнями остаётся место под их собственные слои. */
	const Z_STEP = 2;
	/** Список подсказки висит на body и должен быть выше любого уровня стека. */
	const POPUP_Z_INDEX = Z_BASE + Z_STEP * (MAX_DEPTH + 1);

	/** normal: обычная форма, wide: форма с таблицами, full: многостраничные конструкторы. */
	const WIDTHS = ['normal', 'wide', 'full'];

	/** Кнопка по умолчанию: уровень без подвала нельзя было бы закрыть мышью. */
	const DEFAULT_BUTTONS = [{ id: 'close', label: 'Закрыть' }];

	/** Проверяет и нормализует кнопки подвала. Ошибка здесь в описании уровня, поэтому исключение. */
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
				// Недоступна, но остаётся в обходе Tab (aria-disabled): disabled снял бы фокус с погасшей кнопки
				unavailable: Boolean(button.unavailable),
				// Кнопка без обработчика отменяет свой уровень
				onClick: typeof button.onClick === 'function' ? button.onClick : null,
			};
		});
		if (primaries > 1) {
			throw new Error('Диалог: основная кнопка может быть только одна.');
		}
		return result;
	}

	/** Проверяет и нормализует описание уровня для pushDialog. */
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

	/** Стек уровней: хранит только порядок непрозрачных объектов DOM-обвязки. */
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
			/** Закрывает уровень index и всё, что над ним; возвращает закрытые сверху вниз. */
			truncate: function (index) {
				if (index < 0 || index >= levels.length) {
					return [];
				}
				return levels.splice(index).reverse();
			},
		};
	}

	/** Слой уровня; нижний уровень 1. */
	function zIndexOf(level) {
		return Z_BASE + Z_STEP * (level - 1);
	}

	/** Состояние уровней при depth открытых: активен только верхний, нижние и страница под стеком inert. */
	function levelStates(depth) {
		const levels = [];
		for (let index = 0; index < depth; index += 1) {
			const active = index === depth - 1;
			levels.push({ active: active, inert: !active, zIndex: zIndexOf(index + 1) });
		}
		return { pageInert: depth > 0, levels: levels };
	}

	/** Что закрывает Escape: сначала список подсказки, иначе закрылась бы форма с недописанным выражением. */
	function escapeAction(depth, popupOpen) {
		if (popupOpen) {
			return 'popup';
		}
		return depth > 0 ? 'level' : 'none';
	}

	/**
	 * Куда ведёт Tab в верхнем уровне. count: число фокусируемых элементов уровня, current: индекс
	 * элемента с фокусом (-1, если фокус вне уровня). prevent:false оставляет обход браузеру,
	 * index:-1 фокусирует сам уровень.
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
	 * Куда вернуть фокус после закрытия уровней. closed: закрытые уровни сверху вниз; focusLeft: фокус
	 * был внутри закрытых уровней или потерян; usable(element): элемент жив и доступен;
	 * remainingDepth: сколько уровней осталось.
	 *
	 * Вызвавший элемент берётся у нижнего закрытого уровня: элементы верхних закрыты вместе с ними.
	 * Фокус, который обработчик сам перевёл наружу, не трогается.
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

	/** Итог нажатия кнопки: строка становится текстом ошибки под телом, иначе ошибка очищается. */
	function clickError(result) {
		return typeof result === 'string' ? result : '';
	}

	/** Знак изменённого окна после заголовка, как у конструктора запроса платформы. */
	const MODIFIED_MARK = '*';
	/** То же для читалки; без рода, окна разные. */
	const MODIFIED_SPOKEN = 'есть изменения';

	/**
	 * Части заголовка уровня: text, mark (виден, скрыт от читалки) и spoken (скрыт с экрана, для
	 * читалки). Без правок mark и spoken пустые.
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
