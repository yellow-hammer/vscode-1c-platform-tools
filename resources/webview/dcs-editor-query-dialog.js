/**
 * Многостраничный конструктор запроса редактора СКД — DOM-обвязка над моделью.
 *
 * Подключается отдельным <script> после основного скрипта (dcs-editor.js) и видит редактор только
 * через его явный API window.DcsEditorApi (окна стека, элементы форм, подсказка, канал панели, кэши
 * метаданных — JSDoc там). Модель запроса — window.DcsQueryModel (разбор, сборка со сплайсом, самопроверка), её правки —
 * чистые функции window.DcsQueryEdit: этот файл только рисует вкладки и зовёт их.
 *
 * Окно уровня full стека; справа вертикальные вкладки запросов пакета и частей объединения; подвал
 * «Запрос… / ОК / Отмена». Вкладки — реестр QUERY_TABS в порядке конструктора платформы для режима СКД.
 *
 * Вход: текст набора разбирается и проходит самопроверку; не сошлось — режим «только текст»
 * (плашка со строкой и колонкой, доступно только окно текста). ОК: модель не менялась — окно
 * закрывается без записи; иначе сборка со сплайсом, подтверждение при потере комментариев и
 * dcs/apply-query с недостающими &-параметрами и автозаполнением набора. Отказ панели остаётся в
 * окне (ответ saved обрабатывает основной скрипт). Предупреждения проверки имён по метаданным
 * (api.nameProblems) показывает плашка на «Таблицах и полях» и вопрос «Записать / Отмена» перед ОК;
 * запись они не блокируют.
 */
(function () {
	'use strict';

	const api = window.DcsEditorApi;
	const Q = window.DcsQueryModel;
	const QE = window.DcsQueryEdit;
	const FT = window.DcsFieldTypes;
	const completer = window.DcsComplete;
	if (!api || !Q || !QE) {
		// Без API редактора и модели запроса окну не на чем работать: window.DcsQueryDialog не появляется
		return;
	}
	const el = api.el;

	/** Подписи групп функций окна выражения (как у подсказки): порядок — частые сверху. */
	const FUNCTION_GROUP_ORDER = ['aggregate', 'other', 'date', 'string', 'math'];

	/** Сравнение для поиска без учёта регистра и с ё = е — как в подсказке и мастере настроек. */
	function fold(value) {
		return String(value || '')
			.toLowerCase()
			.replace(/ё/g, 'е');
	}

	function upper(value) {
		return String(value || '').toUpperCase();
	}

	const COLLATOR = new Intl.Collator('ru');

	// ---------------------------------------------------------------------------------------------
	// Реестр вкладок
	// ---------------------------------------------------------------------------------------------

	function isSelect(ctx) {
		return Boolean(ctx.statement());
	}

	function createsTempTable(ctx) {
		const statement = ctx.statement();
		return Boolean(statement && statement.parts.some((part) => part && part.into && part.into.mode !== 'add'));
	}

	function hasCharacteristics(ctx) {
		const statement = ctx.statement();
		if (!statement) {
			return false;
		}
		const blocks = (statement.raw || []).concat(...statement.parts.map((part) => (part && part.raw) || []));
		return blocks.some((block) => /ХАРАКТЕРИСТИКИ|CHARACTERISTICS/i.test(String(block && block.text)));
	}

	/**
	 * Вкладки конструктора для режима СКД в порядке платформы: {id, title, visible(ctx),
	 * render(container, ctx)}. Для запроса «Уничтожение ВТ» видны только «Дополнительно» и «Пакет
	 * запросов»; у вложенного запроса пакета нет.
	 */
	const QUERY_TABS = [
		{ id: 'tables', title: 'Таблицы и поля', visible: isSelect, render: renderTablesTab },
		{ id: 'links', title: 'Связи', visible: (ctx) => isSelect(ctx) && QE.sourcesOf(ctx.part()).length > 1, render: renderLinksTab },
		{ id: 'grouping', title: 'Группировка', visible: isSelect, render: renderGroupingTab },
		{ id: 'conditions', title: 'Условия', visible: isSelect, render: renderConditionsTab },
		{ id: 'advanced', title: 'Дополнительно', visible: () => true, render: renderAdvancedTab },
		{ id: 'index', title: 'Индекс', visible: (ctx) => isSelect(ctx) && createsTempTable(ctx), render: renderIndexTab },
		{ id: 'union', title: 'Объединения/Псевдонимы', visible: isSelect, render: renderUnionTab },
		{ id: 'order', title: 'Порядок', visible: isSelect, render: renderOrderTab },
		{ id: 'batch', title: 'Пакет запросов', visible: (ctx) => !ctx.nested, render: renderBatchTab },
		{ id: 'composition', title: 'Компоновка данных', visible: isSelect, render: renderCompositionTab },
		{ id: 'characteristics', title: 'Характеристики', visible: (ctx) => isSelect(ctx) && hasCharacteristics(ctx), render: renderCharacteristicsTab },
	];

	function visibleTabs(ctx) {
		return QUERY_TABS.filter((tab) => tab.visible(ctx));
	}

	// ---------------------------------------------------------------------------------------------
	// Перерисовка по ответам панели
	// ---------------------------------------------------------------------------------------------

	/** Открытые уровни конструктора (основной, вложенные запросы, окна выражения): ответы перерисовывают все. */
	const renderers = new Set();

	function runRenderers() {
		for (const render of Array.from(renderers)) {
			render();
		}
	}

	function addRenderer(render) {
		renderers.add(render);
		api.setRerender(runRenderers);
	}

	function removeRenderer(render) {
		renderers.delete(render);
		if (renderers.size === 0) {
			api.clearRerender(runRenderers);
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Общие элементы: кнопки, дерево с одной остановкой Tab, фокус по ключу
	// ---------------------------------------------------------------------------------------------

	/**
	 * Кнопка; с keys — с ключом для возврата фокуса: тело окна перерисовывается, а фокус должен остаться на ней.
	 * Доступное имя кнопки со словом в подписи — сама подпись (title остаётся описанием): голосовая
	 * команда по видимому тексту должна находить кнопку (WCAG 2.5.3). Кнопке-знаку (>, <<, ↑, …, А↓Я)
	 * имя даёт title.
	 */
	function button(label, title, onClick, className, keys) {
		const node = el('button', className || 'ghost-btn dcs-btn-small', label);
		node.type = 'button';
		if (title) {
			node.title = title;
			if (!/\p{L}{2}/u.test(String(label))) {
				node.setAttribute('aria-label', title);
			}
		}
		node.addEventListener('click', onClick);
		if (keys) {
			keys.set(node, 'btn:' + (title || label));
		}
		return node;
	}

	/**
	 * Команда панели над списком — пиктограмма с подсказкой, как у конфигуратора. Полное название —
	 * подсказка и доступное имя (api.iconButton: видимой подписи у кнопки нет). Ключ возврата фокуса —
	 * по названию, как у button(): после перерисовки фокус остаётся на той же команде.
	 * options — то, что ещё понимает api.iconButton (unavailable, note, spoken).
	 */
	function iconButton(icon, name, onClick, keys, options) {
		const node = api.iconButton(Object.assign({ icon: icon, name: name, onClick: onClick }, options || {}));
		if (keys) {
			keys.set(node, 'btn:' + name);
		}
		return node;
	}

	/**
	 * Подсказка элемента: текст — во всплывающей подсказке и в aria-description, потому что только title
	 * экранный диктор не читает (то же правило у describeComposition основного скрипта редактора). spoken —
	 * своё, короче, описание для читалки, когда подсказка длинная и элемент повторяется в каждой строке.
	 */
	function hint(node, text, spoken) {
		node.title = text;
		node.setAttribute('aria-description', spoken || text);
		return node;
	}

	/**
	 * Возврат фокуса после окна поверх конструктора: правка из окна перерисовала тело, и вызвавшая
	 * кнопка — уже другой узел; стек вернул бы фокус в никуда, поэтому узел ищется по ключу.
	 */
	function refocusLater(keys) {
		const active = document.activeElement;
		const key = active && typeof active.getAttribute === 'function' ? active.getAttribute('data-qd-key') : null;
		return () => {
			const node = key ? keys.get(key) : null;
			if (node && node.isConnected && document.activeElement !== node) {
				node.focus();
			}
		};
	}

	let keysCount = 0;

	/**
	 * Ключи узлов для возврата фокуса после перерисовки: тело уровня рисуется заново целиком, и без
	 * ключа фокус с выбранной строки ушёл бы в никуда.
	 */
	function createKeys() {
		const map = new Map();
		return {
			/** Окно, которому принадлежат ключи: перенос мышью принимают только списки того же окна. */
			scope: ++keysCount,
			set(node, key) {
				node.setAttribute('data-qd-key', key);
				map.set(key, node);
				return node;
			},
			get(key) {
				return map.get(key) || null;
			},
			/** Ключи с префиксом в порядке отрисовки: так находится соседняя строка удалённой. */
			withPrefix(prefix) {
				return Array.from(map.keys()).filter((key) => key.indexOf(prefix) === 0);
			},
			clear() {
				map.clear();
			},
		};
	}

	/** Строка списка (дерева, списка или сетки): после её удаления фокус переходит к соседней. */
	const ROW_ROLES = new Set(['treeitem', 'option', 'row']);

	function isRowNode(node) {
		return Boolean(node) && typeof node.getAttribute === 'function' && ROW_ROLES.has(node.getAttribute('role'));
	}

	/**
	 * Прокручиваемые списки тела окна (деревья и сетки) по подписи: тело перерисовывается целиком, и
	 * без запоминания каждое действие возвращало бы список наверх — место в длинном списке терялось бы.
	 */
	function scrollPositions(root) {
		const out = new Map();
		const walk = (node) => {
			for (const child of Array.from(node.children || [])) {
				if (child.classList && (child.classList.contains('dcs-qd-tree') || child.classList.contains('dcs-qd-grid'))) {
					const label = child.getAttribute('aria-label');
					if (label && (child.scrollTop || child.scrollLeft)) {
						out.set(label, { top: child.scrollTop || 0, left: child.scrollLeft || 0 });
					}
				}
				walk(child);
			}
		};
		walk(root);
		return out;
	}

	function restoreScroll(root, saved) {
		if (saved.size === 0) {
			return;
		}
		const walk = (node) => {
			for (const child of Array.from(node.children || [])) {
				const label = child.getAttribute ? child.getAttribute('aria-label') : null;
				const position = label ? saved.get(label) : null;
				if (position && child.classList && (child.classList.contains('dcs-qd-tree') || child.classList.contains('dcs-qd-grid'))) {
					child.scrollTop = position.top;
					child.scrollLeft = position.left;
				}
				walk(child);
			}
		};
		walk(root);
	}

	/**
	 * Фокус, потерянный перерисовкой: удалённая строка уступает место соседней (той же позиции, иначе
	 * последней), пустой список держит фокус сам — иначе после Delete фокус ушёл бы на body: стрелки и
	 * Delete не работали бы, а Tab начинал бы с начала окна.
	 */
	function focusNeighbor(keys, lost) {
		if (!lost) {
			return false;
		}
		const rows = keys.withPrefix(lost.prefix).filter((key) => isRowNode(keys.get(key)));
		const node = rows.length > 0 ? keys.get(rows[Math.min(lost.index, rows.length - 1)]) : keys.get(lost.list);
		if (!node) {
			return false;
		}
		if (rows.length > 0) {
			// Одна остановка Tab — на строке с фокусом: как сделала бы стрелка
			for (const key of rows) {
				const row = keys.get(key);
				row.tabIndex = row === node ? 0 : -1;
			}
		}
		node.focus();
		return true;
	}

	/** Где стояла строка с фокусом: префикс ключей списка, номер строки в нём и ключ самого списка. */
	function lostRow(keys, active) {
		const key = isRowNode(active) ? active.getAttribute('data-qd-key') : null;
		const colon = key ? key.indexOf(':') : -1;
		if (colon <= 0) {
			return null;
		}
		const prefix = key.slice(0, colon + 1);
		const rows = keys.withPrefix(prefix).filter((item) => isRowNode(keys.get(item)));
		return { prefix: prefix, list: key.slice(0, colon), index: Math.max(0, rows.indexOf(key)) };
	}

	let tabStripCount = 0;

	/**
	 * Полоса вкладок с панелью: одна остановка Tab, ← → Home End выбирают вкладку, активная вкладка и
	 * панель связаны id (aria-controls / aria-labelledby). id — свои на каждую отрисовку: окна
	 * конструктора бывают вложенными, и одинаковые id связали бы чужие вкладки.
	 * spec: {label, className, panelClass, items: [{id, title, name?}], active, keyPrefix, keys, onPick(id),
	 * orientation?, controls?}. title — текст ярлыка, name — полное название, если ярлык короче: доступное
	 * имя и подсказка (начинается с ярлыка или содержит его). orientation 'vertical' — полоса у края
	 * окна (запросы пакета и части объединения): ↑ ↓ вместо ← →, текст ярлыка повёрнут.
	 * controls — чужая область, которую переключает полоса: своей панели тогда нет, область получает
	 * aria-labelledby от вызвавшего (activeId в ответе).
	 */
	function tabStrip(spec) {
		const uid = 'dcsQdTabs' + ++tabStripCount;
		const vertical = spec.orientation === 'vertical';
		const strip = el('div', spec.className);
		strip.setAttribute('role', 'tablist');
		strip.setAttribute('aria-label', spec.label);
		if (vertical) {
			strip.setAttribute('aria-orientation', 'vertical');
		}
		let panel = null;
		let controlsId = '';
		if (spec.controls) {
			controlsId = spec.controls.id || uid + '-area';
			spec.controls.id = controlsId;
		} else {
			panel = el('div', spec.panelClass);
			panel.setAttribute('role', 'tabpanel');
			panel.id = uid + '-panel';
			controlsId = panel.id;
		}
		const next = vertical ? 'ArrowDown' : 'ArrowRight';
		const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
		let activeId = '';
		const items = spec.items;
		items.forEach((item, index) => {
			const active = item.id === spec.active;
			const tab = el('button', 'tab' + (active ? ' active' : ''), vertical ? undefined : item.title);
			if (vertical) {
				tab.appendChild(el('span', 'dcs-qd-vtab-text', item.title));
			}
			tab.type = 'button';
			tab.id = uid + '-' + index;
			tab.setAttribute('role', 'tab');
			tab.setAttribute('aria-selected', String(active));
			if (item.name && item.name !== item.title) {
				tab.setAttribute('aria-label', item.name);
			}
			if (item.name) {
				tab.title = item.name;
			}
			if (active) {
				activeId = tab.id;
				tab.setAttribute('aria-controls', controlsId);
				if (panel) {
					panel.setAttribute('aria-labelledby', tab.id);
				}
			}
			tab.tabIndex = active ? 0 : -1;
			spec.keys.set(tab, spec.keyPrefix + item.id);
			tab.addEventListener('click', () => spec.onPick(item.id));
			tab.addEventListener('keydown', (event) => {
				const last = items.length - 1;
				let to = -1;
				if (event.key === next) {
					to = index === last ? 0 : index + 1;
				} else if (event.key === previous) {
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
				spec.onPick(items[to].id);
			});
			strip.appendChild(tab);
		});
		return { strip: strip, panel: panel, activeId: activeId };
	}

	// ---------------------------------------------------------------------------------------------
	// Перетаскивание
	// ---------------------------------------------------------------------------------------------

	const DRAG = api.drag;

	/**
	 * Зона переноса у списка treeView / gridView. Ключ строки — из её ключа фокуса (spec.id + ':' + ключ), окно — по
	 * ключам (у каждого окна конструктора свои): списки нижнего окна перенос верхнего не примут. spec.drag(key, source) —
	 * вид строки-источника ('' — строку не тащат); spec.drop — {from: {idСписка: (payload, target) → void | false},
	 * accept?, place?, effect?}: сброс из списка-источника зовёт то же действие, что кнопка переноса (false — ничего не
	 * изменилось). Строка, которую тащили, становится выбранной, как от щелчка (spec.onSelect), когда перенос кончился
	 * без сброса, сброс ничего не изменил или скопировал её в другой список: щелчка после переноса браузер не шлёт.
	 */
	function dragList(node, spec) {
		if (!spec.drag && !spec.drop) {
			return;
		}
		const prefix = spec.id + ':';
		const drop = spec.drop || {};
		DRAG.zone(node, {
			id: spec.id,
			scope: spec.keys.scope,
			keyOf: (row) => {
				const key = typeof row.getAttribute === 'function' ? row.getAttribute('data-qd-key') : null;
				return key && key.indexOf(prefix) === 0 ? key.slice(prefix.length) : null;
			},
			drag: spec.drag,
			pick: spec.drag && spec.onSelect ? (key) => spec.onSelect(key, true) : undefined,
			from: drop.from,
			accept: drop.accept,
			place: drop.place,
			effect: drop.effect,
		});
	}

	/** Номер строки сброса в списке, где ключ строки — её номер; -1 — сброс под строками. */
	function dropRow(target) {
		return target && target.key !== null && target.key !== undefined ? Number(target.key) : -1;
	}

	/** Место нового элемента списка из count (его добавят в конец): номер вставки по точке сброса. */
	function dropAt(count, target) {
		return DRAG.index(count, -1, dropRow(target), target.place);
	}

	/**
	 * Перестановка сбросом: сдвиг для той же правки, что у ↑ ↓ (0 — строка осталась на месте). Фокус переезжает за
	 * строкой: перетаскиваемая строка получила его нажатием кнопки мыши, а её номер после перестановки — у соседней.
	 */
	function dropDelta(ctx, list, count, from, target) {
		const to = DRAG.index(count, from, dropRow(target), target.place);
		if (to !== from) {
			ctx.state.focus = list + ':' + to;
		}
		return to - from;
	}

	/**
	 * Позиция в тексте поля ввода под точкой (x, y): document.caretPositionFromPoint называет у текстового поля его само и
	 * номер символа. Нет такого API или точка мимо текста — null: вставка тогда идёт в позицию каретки.
	 */
	function caretAtPoint(input, x, y) {
		if (typeof document.caretPositionFromPoint !== 'function') {
			return null;
		}
		const position = document.caretPositionFromPoint(x, y);
		if (!position || position.offsetNode !== input || typeof position.offset !== 'number') {
			return null;
		}
		return Math.max(0, Math.min(position.offset, input.value.length));
	}

	/** Значок-ручка «⋮»: строку сетки и поле части тащат за него, если в ячейке только элементы управления. */
	function dragGrip(title) {
		const grip = el('span', 'dcs-dnd-grip', '⋮');
		grip.setAttribute('aria-hidden', 'true');
		grip.title = title;
		grip.draggable = true;
		return grip;
	}

	/**
	 * Ручка строки сетки: первая ячейка без элементов управления, иначе её текст (.dcs-qd-cell-text), иначе значок «⋮»
	 * перед содержимым. Строку целиком не тащат: в ней списки, флажки и поля, а у перетаскиваемого узла браузер не даёт
	 * выделять текст.
	 */
	function dragHandle(cell) {
		if (controlsOf(cell).length === 0) {
			cell.draggable = true;
			return cell;
		}
		let text = null;
		const walk = (node) => {
			for (const child of Array.from(node.children || [])) {
				if (text) {
					return;
				}
				if (child.classList && child.classList.contains('dcs-qd-cell-text')) {
					text = child;
					return;
				}
				walk(child);
			}
		};
		walk(cell);
		if (text) {
			text.draggable = true;
			return text;
		}
		const grip = dragGrip('Перетащите строку');
		cell.insertBefore(grip, cell.firstChild);
		return grip;
	}

	/**
	 * Вид поля для знака строки дерева (treeView, row.mark): только у полей общих реквизитов — разделителя (Разделение
	 * данных — Разделять) и прочего общего реквизита (cf-md-query-tables); у остальных полей знака нет.
	 */
	function fieldMark(kind) {
		return kind === 'separator' || kind === 'commonAttribute' ? kind : '';
	}

	/** Подпись знака вида поля (completer.KIND_LABELS) или null у поля без знака. */
	function markLabel(kind) {
		return kind ? completer.KIND_LABELS[kind] || null : null;
	}

	/**
	 * Знак вида поля в строке дерева — тот же, что у строки подсказки (completer.KIND_LABELS): у разделителя черта, как
	 * значок в дереве полей конфигуратора. В разметке он после имени (подпись строки остаётся вторым элементом), на
	 * экране — перед ним (order в стилях); знак скрыт от читалки, она слышит слово. slot — в дереве есть знаки: строка без
	 * своего знака получает пустое место той же ширины, как у конфигуратора, где значок есть у каждой строки, — иначе имя
	 * строки со знаком стояло бы правее соседей, будто на уровень глубже.
	 */
	function appendMark(item, kind, slot) {
		const label = markLabel(kind);
		if (!label) {
			if (slot) {
				const empty = el('span', 'dcs-qd-mark-slot');
				empty.setAttribute('aria-hidden', 'true');
				item.appendChild(empty);
			}
			return;
		}
		const mark = el('span', 'dcs-qd-mark', label.letter);
		mark.setAttribute('data-kind', kind);
		mark.setAttribute('aria-hidden', 'true');
		mark.title = label.word;
		item.appendChild(mark);
		item.appendChild(el('span', 'dcs-qd-mark-spoken', label.word));
	}

	/**
	 * Дерево с одной остановкой Tab: строки — соседи с aria-level, стрелки ходят по видимым строкам,
	 * вправо и влево раскрывают и сворачивают (или идут к ребёнку и родителю), Enter и двойной
	 * щелчок — действие строки. spec: {id, label, rows: [{key, level, label, note?, badge?,
	 * expandable?, expanded?, title?, inert?, mark?}], selected, onSelect(key), onToggle(key, open),
	 * onActivate(key), onDelete?(key), empty, keys, drag?(key), drop?} — drag и drop: перенос мышью (dragList);
	 * mark — вид поля общего реквизита (fieldMark): знак перед именем и слово для читалки; если знак есть хоть у одной
	 * строки, у остальных на его месте пустое место той же ширины (имена одного уровня стоят ровно).
	 */
	function treeView(host, spec) {
		const tree = el('div', 'dcs-tree dcs-qd-tree');
		tree.setAttribute('role', spec.role === 'listbox' ? 'listbox' : 'tree');
		tree.setAttribute('aria-label', spec.label);
		// Ключ самого списка: пустой список принимает фокус после удаления последней строки
		spec.keys.set(tree, spec.id);
		// Пустой список — тоже зона: в него переносят первую строку
		dragList(tree, spec);
		const rows = spec.rows;
		if (rows.length === 0) {
			tree.tabIndex = -1;
			tree.appendChild(el('div', 'dcs-qd-empty', spec.empty || ''));
			host.appendChild(tree);
			return tree;
		}
		const live = rows.filter((row) => !row.inert);
		const stop = live.some((row) => row.key === spec.selected) ? spec.selected : live.length > 0 ? live[0].key : '';
		const markSlot = rows.some((row) => markLabel(row.mark) !== null);
		const move = (index, step) => {
			for (let k = index + step; k >= 0 && k < rows.length; k += step) {
				if (!rows[k].inert) {
					spec.onSelect(rows[k].key, true);
					return;
				}
			}
		};
		rows.forEach((row, index) => {
			const selected = row.key === spec.selected;
			let className = 'dcs-tree-row dcs-qd-row';
			if (selected) {
				className += ' dcs-tree-selected';
			}
			if (row.inert) {
				className += ' dcs-qd-row-info';
			}
			const item = el('div', className);
			item.setAttribute('role', spec.role === 'listbox' ? 'option' : 'treeitem');
			if (spec.role !== 'listbox') {
				item.setAttribute('aria-level', String(row.level + 1));
			}
			item.setAttribute('aria-selected', String(selected));
			if (row.expandable) {
				item.setAttribute('aria-expanded', String(Boolean(row.expanded)));
			}
			item.tabIndex = row.key === stop ? 0 : -1;
			item.style.paddingLeft = 4 + row.level * 14 + 'px';
			if (row.title) {
				item.title = row.title;
			}
			spec.keys.set(item, spec.id + ':' + row.key);
			const twist = el('span', 'dcs-tree-twist', row.expandable ? (row.expanded ? '▾' : '▸') : '');
			twist.setAttribute('aria-hidden', 'true');
			twist.addEventListener('click', (event) => {
				event.stopPropagation();
				if (row.expandable) {
					spec.onToggle(row.key, !row.expanded);
				}
			});
			item.appendChild(twist);
			item.appendChild(el('span', 'dcs-tree-label', row.label));
			appendMark(item, row.mark, markSlot);
			if (row.note) {
				item.appendChild(el('span', 'dcs-tree-name', row.note));
			}
			if (row.badge) {
				item.appendChild(el('span', 'dcs-tree-badge', row.badge));
			}
			if (!row.inert) {
				item.addEventListener('click', () => spec.onSelect(row.key, false));
				item.addEventListener('dblclick', () => spec.onActivate(row.key));
				// Перенос мышью: строке — только атрибут, слушатели — у документа (api.drag)
				if (spec.drag && spec.drag(row.key)) {
					item.draggable = true;
				}
			}
			item.addEventListener('keydown', (event) => {
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					move(index, event.key === 'ArrowDown' ? 1 : -1);
				} else if (event.key === 'Home' || event.key === 'End') {
					event.preventDefault();
					move(event.key === 'Home' ? -1 : rows.length, event.key === 'Home' ? 1 : -1);
				} else if (event.key === 'ArrowRight' && row.expandable) {
					event.preventDefault();
					if (!row.expanded) {
						spec.onToggle(row.key, true);
					} else {
						move(index, 1);
					}
				} else if (event.key === 'ArrowLeft') {
					event.preventDefault();
					if (row.expandable && row.expanded) {
						spec.onToggle(row.key, false);
						return;
					}
					for (let k = index - 1; k >= 0; k--) {
						if (rows[k].level < row.level) {
							spec.onSelect(rows[k].key, true);
							return;
						}
					}
				} else if (event.key === 'Enter' && !row.inert) {
					event.preventDefault();
					spec.onActivate(row.key);
				} else if (event.key === 'Delete' && spec.onDelete && !row.inert) {
					event.preventDefault();
					spec.onDelete(row.key);
				}
			});
			tree.appendChild(item);
		});
		host.appendChild(tree);
		return tree;
	}

	/** Колонка трёхколоночной раскладки: заголовок, панель кнопок, содержимое. */
	function column(host, title, className) {
		const col = el('div', 'dcs-qd-col' + (className ? ' ' + className : ''));
		col.appendChild(el('div', 'dcs-qd-col-head', title));
		host.appendChild(col);
		return col;
	}

	/**
	 * Столбец кнопок переноса между колонками (> >> < <<): подпись — знак, смысл — в title и aria-label. Кнопки — общие с
	 * вкладками схемы (api.transferButtons, закладка «Ресурсы»): вид и клавиатура одни. Ключ возврата фокуса — как у
	 * button(): после перерисовки фокус остаётся на той же кнопке.
	 */
	function moves(host, items, keys) {
		const made = api.transferButtons(host, items);
		made.buttons.forEach((node, index) => {
			keys.set(node, 'btn:' + (items[index].title || items[index].label));
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Дерево «База данных»
	// ---------------------------------------------------------------------------------------------

	/** Вид объекта дерева в языке запросов (DcsFieldTypes.OBJECT_KINDS) или null — у вида нет таблиц запроса. */
	function objectKindOf(item) {
		return item ? FT.OBJECT_KINDS.find((candidate) => candidate.en === item.objectType) || null : null;
	}

	/** Полное имя объекта дерева в языке запросов (`Справочник.Валюты`, `Catalog.Валюты`). */
	function objectQueryName(kind, item, lang) {
		return (lang === 'en' ? kind.en : kind.ru) + '.' + item.name;
	}

	/**
	 * Имя основной таблицы объекта дерева по его виду: описание объекта для этого не нужно. У вида с
	 * main: false своей таблицы нет (её таблицы — только дочерние) — пусто.
	 */
	function mainTableName(item, lang) {
		const kind = objectKindOf(item);
		return kind && kind.main !== false ? objectQueryName(kind, item, lang) : '';
	}

	/**
	 * Виды, у основной таблицы которых обязательный параметр (критерий отбора: `КритерийОтбора.X(&Значение)`).
	 * Без описания имени параметра не узнать, а таблица без скобок выбрала бы пустоту, поэтому объект
	 * такого вида добавляется только после того, как его описание прочитано.
	 */
	const PARAMETRIZED_MAIN = new Set(['FilterCriterion']);

	/**
	 * Общая таблица констант в ветке «Константы»: «>>» по ней переносит все константы только до этого
	 * числа. Констант бывают тысячи (ERP), и выборка всех полей разом почти всегда ошибка — дальше
	 * переносится одна таблица, а поля выбираются поштучно.
	 */
	const CONSTANTS_ALL_LIMIT = 50;

	/** Имя общей таблицы констант на языке текста (`Константы` / `Constants`). */
	function constantsTableName(lang) {
		return lang === 'en' ? 'Constants' : 'Константы';
	}

	/**
	 * Занятые имена &-параметров: параметры текущего текста модели и параметры, уже объявленные в схеме,
	 * — параметр по умолчанию нового критерия не повторяет ни те, ни другие. ОК объявляет только
	 * необъявленные имена, и без параметров схемы `&Значение` критерия молча привязался бы к чужому
	 * параметру «Значение» с его типом и значением.
	 */
	function takenParameters(ctx) {
		const declared = (api.model().parameters || []).map((param) => param && param.name).filter((name) => typeof name === 'string' && name !== '');
		try {
			return Q.parametersOf(Q.build(ctx.state.model)).concat(declared);
		} catch (error) {
			// Недособранная модель (ОК её не пропустит) — суффикс просто не учтёт её параметры
			return declared;
		}
	}

	/**
	 * Таблица и тексты параметров для источника из строки дерева «База данных». Параметры по умолчанию
	 * (QE.defaultParamTexts) считаются в момент добавления, а не при отрисовке: занятые в тексте имена
	 * меняются с каждой правкой, и второй критерий отбора получает своё `&Значение1`. Описание объекта,
	 * строка которого не раскрывалась, берётся из кэша вкладки (или запрашивается) только у видов с
	 * обязательным параметром основной таблицы.
	 *
	 * @returns {{table: string, params: string[]|null}|{error: string}}
	 */
	function tableSpecOf(ctx, item) {
		let described = item.described || null;
		if (!described && item.relativePath && PARAMETRIZED_MAIN.has(item.objectType)) {
			const entry = api.queryTables(item.relativePath, ctx.lang);
			if (entry.state === 'loading') {
				return { error: 'Описание таблицы «' + item.table + '» загружается: у неё обязательный параметр. Повторите через мгновение.' };
			}
			if (entry.state !== 'ready') {
				// Без описания параметр не назвать, а без него таблица заведомо пуста
				return { error: 'Описание таблицы «' + item.table + '» не прочитано: ' + (entry.error || 'причина неизвестна.') };
			}
			described = (Array.isArray(entry.description.tables) ? entry.description.tables : []).find((table) => table && table.kind === 'main') || null;
		}
		if (described && Array.isArray(described.params) && described.params.length > 0) {
			return { table: described.name || item.table, params: QE.defaultParamTexts(described, takenParameters(ctx)) };
		}
		return { table: item.table, params: item.params };
	}

	function tableTail(name) {
		return String(name || '')
			.split('.')
			.slice(2)
			.join('.');
	}

	const TABLE_BADGES = { tabularSection: 'ТЧ', standardTabularSection: 'ТЧ', virtual: 'ВТ' };

	/**
	 * Объектов вида в дереве «База данных» за раз: каждое действие перерисовывает тело окна целиком, и на
	 * выгрузке с тысячами объектов раскрытый вид или буква поиска строили бы десятки тысяч узлов. Дальше —
	 * строка «Показать ещё» (поиск сужает список).
	 */
	const DB_PAGE = 200;

	/**
	 * Строки дерева «База данных» и что за каждой стоит (info по ключу): виды объектов в порядке веток
	 * конструктора, последней — ветка «Временные таблицы» пакета (до текущего запроса); под объектом —
	 * поля основной таблицы, табличные части и виртуальные таблицы (лениво, dcs/query-tables), под
	 * ссылочным полем — реквизиты для разыменования. Ветку констант открывает общая таблица
	 * «Константы» (по полю на константу); объект вида без своей таблицы (main: false) — строка-объект,
	 * под которой только его таблицы.
	 */
	function databaseRows(ctx) {
		const st = ctx.state.db;
		const rows = [];
		const info = new Map();
		const query = fold(st.search.trim());
		const matches = (name, synonym) => !query || fold(name).indexOf(query) >= 0 || fold(synonym).indexOf(query) >= 0;
		const open = (key) => (query ? !st.collapsed.has(key) : st.expanded.has(key));

		function fieldRows(fields, baseKey, base, level, depth) {
			const owner = info.get(baseKey);
			for (const field of fields) {
				const path = base ? base + '.' + field.name : field.name;
				const key = baseKey + '|' + path;
				const unread = depth === 0 ? unreadConstant(owner.table, field) : null;
				const expandable = depth < 3 && (Boolean(unread) || api.expandable(field.type || field.valueType));
				const expanded = expandable && st.expanded.has(key);
				rows.push({ key: key, level: level, label: field.name, note: field.synonym || field.title || '', expandable: expandable, expanded: expanded, mark: depth === 0 ? fieldMark(field.kind) : '' });
				// Поле тянет за собой таблицу: описание и объект — чтобы её параметры считались, как у самой таблицы
				info.set(key, { kind: 'field', table: owner.table, params: owner.params, described: owner.described, relativePath: owner.relativePath, objectType: owner.objectType, path: path });
				if (expanded && unread) {
					rows.push(unreadConstantRow(key, level + 1, unread));
				} else if (expanded) {
					const children = api.typeChildren(field.type || field.valueType);
					fieldRows(children.children, baseKey, path, level + 1, depth + 1);
					if (children.loading) {
						rows.push({ key: key + '#loading', level: level + 1, label: 'Загрузка реквизитов…', inert: true });
					}
				}
			}
		}

		/**
		 * Строка общей таблицы констант первой в ветке констант: поля — константы ветки, как их
		 * показывает поиск и «Упорядочить», страницами по DB_PAGE; тип поля — из таблицы, которую
		 * обвязка собирает из того же дерева (api.describeTable), — известен, если описание константы уже
		 * читалось, и только такое поле раскрывается.
		 */
		function constantsRows(groupKey, items) {
			const name = constantsTableName(ctx.lang);
			const key = 'c:' + groupKey;
			const expanded = st.expanded.has(key);
			rows.push({
				key: key,
				level: 1,
				label: name,
				badge: 'все',
				expandable: items.length > 0,
				expanded: expanded,
				title: 'Общая таблица констант «' + name + '»: по полю на каждую константу',
			});
			info.set(key, { kind: 'table', table: name, params: null });
			if (!expanded) {
				return;
			}
			const described = api.describeTable(name);
			const types = new Map(
				(described.state === 'ready' && described.table ? described.table.fields || [] : []).map((field) => [upper(field.name), field.type || null])
			);
			const limit = st.limits.get(key) || DB_PAGE;
			fieldRows(
				items.slice(0, limit).map((item) => ({ name: item.name, synonym: item.synonym && item.synonym !== item.name ? item.synonym : '', type: types.get(upper(item.name)) || null })),
				key,
				'',
				2,
				0
			);
			if (items.length > limit) {
				const moreKey = key + '#more';
				const rest = items.length - limit;
				rows.push({
					key: moreKey,
					level: 2,
					label: 'Показать ещё ' + Math.min(DB_PAGE, rest) + ' (осталось ' + rest + ')',
					title: 'Показаны первые ' + limit + ' констант: поиск сужает список',
				});
				info.set(moreKey, { kind: 'more', group: key });
			}
		}

		// Без выгрузки веток видов нет — только «Временные таблицы»
		const md = api.metadata.available() ? api.metadata.state() : null;
		for (const group of md && Array.isArray(md.groups) ? md.groups : []) {
			// Объект — строкой, если его вид известен языку запросов: у вида без своей таблицы (main: false)
			// строка-объект ведёт к его таблицам, а не добавляется сама
			let items = (Array.isArray(group.items) ? group.items : []).filter((item) => objectKindOf(item) && matches(item.name, item.synonym));
			if (items.length === 0) {
				continue;
			}
			if (st.sorted) {
				items = items.slice().sort((a, b) => COLLATOR.compare(String(a.name), String(b.name)));
			}
			const groupKey = 'g:' + (group.objectType || group.label);
			const groupOpen = open(groupKey);
			rows.push({ key: groupKey, level: 0, label: group.label, badge: String(items.length), expandable: true, expanded: groupOpen });
			info.set(groupKey, { kind: 'group' });
			if (!groupOpen) {
				continue;
			}
			if (group.objectType === 'Constant') {
				constantsRows(groupKey, items);
			}
			const limit = st.limits.get(groupKey) || DB_PAGE;
			for (const item of items.slice(0, limit)) {
				const objectKey = 'o:' + item.relativePath;
				const objectOpen = st.expanded.has(objectKey);
				const kind = objectKindOf(item);
				const main = mainTableName(item, ctx.lang);
				rows.push({
					key: objectKey,
					level: 1,
					label: item.name,
					note: item.synonym && item.synonym !== item.name ? item.synonym : '',
					expandable: true,
					expanded: objectOpen,
					title: main || objectQueryName(kind, item, ctx.lang),
				});
				info.set(
					objectKey,
					main
						? { kind: 'table', table: main, params: null, relativePath: item.relativePath, objectType: item.objectType }
						: { kind: 'object', name: objectQueryName(kind, item, ctx.lang) }
				);
				if (!objectOpen) {
					continue;
				}
				const entry = api.queryTables(item.relativePath, ctx.lang);
				if (entry.state === 'loading') {
					rows.push({ key: objectKey + '#loading', level: 2, label: 'Загрузка таблиц объекта…', inert: true });
					continue;
				}
				if (entry.state !== 'ready') {
					rows.push({ key: objectKey + '#error', level: 2, label: entry.error || 'Таблицы объекта не прочитаны.', inert: true });
					continue;
				}
				const tables = Array.isArray(entry.description.tables) ? entry.description.tables : [];
				const mainTable = main ? tables.find((table) => table && table.kind === 'main') : null;
				if (mainTable) {
					// Описание основной таблицы — при строке: по нему «>» даёт критерию его параметр (`(&Значение)`)
					const own = info.get(objectKey);
					own.table = mainTable.name;
					own.described = mainTable;
					fieldRows(mainTable.fields || [], objectKey, '', 2, 0);
				}
				for (const table of tables) {
					if (!table || table === mainTable) {
						continue;
					}
					const tableKey = 't:' + item.relativePath + '|' + table.name;
					const tableOpen = st.expanded.has(tableKey);
					rows.push({
						key: tableKey,
						level: 2,
						label: tableTail(table.name),
						note: table.synonym || '',
						badge: TABLE_BADGES[table.kind] || '',
						expandable: Array.isArray(table.fields) && table.fields.length > 0,
						expanded: tableOpen,
						title: table.name,
					});
					info.set(tableKey, { kind: 'table', table: table.name, params: table.kind === 'virtual' ? QE.defaultParamTexts(table) : null, described: table });
					if (tableOpen) {
						fieldRows(table.fields || [], tableKey, '', 3, 0);
					}
				}
			}
			if (items.length > limit) {
				const moreKey = groupKey + '#more';
				const rest = items.length - limit;
				rows.push({
					key: moreKey,
					level: 1,
					label: 'Показать ещё ' + Math.min(DB_PAGE, rest) + ' (осталось ' + rest + ')',
					title: 'Показаны первые ' + limit + ' объектов вида: поиск сужает список',
				});
				info.set(moreKey, { kind: 'more', group: groupKey });
			}
		}
		// Ветка «Временные таблицы» — последней, после «Задач», как у конструктора конфигуратора: при любом
		// порядке веток видов, с «Упорядочить» и с поиском
		const temps = ctx.tempTables().filter((table) => matches(table.name, ''));
		if (temps.length > 0) {
			const key = 'tmp';
			const expanded = open(key);
			rows.push({ key: key, level: 0, label: 'Временные таблицы', badge: String(temps.length), expandable: true, expanded: expanded });
			info.set(key, { kind: 'group' });
			if (expanded) {
				for (const table of temps) {
					const tableKey = 'tt:' + upper(table.name);
					const tableOpen = table.fields.length > 0 && st.expanded.has(tableKey);
					rows.push({ key: tableKey, level: 1, label: table.name, note: 'запрос пакета ' + (table.statement + 1), expandable: table.fields.length > 0, expanded: tableOpen });
					info.set(tableKey, { kind: 'table', table: table.name, params: null });
					if (tableOpen) {
						// Тип колонки — по запросу, который создал ВТ: ссылочную колонку можно раскрыть, как поле таблицы
						fieldRows(table.fields.map((name) => ({ name: name, synonym: '', type: tempColumnType(table, name) })), tableKey, '', 2, 0);
					}
				}
			}
		}
		return { rows: rows, info: info };
	}

	function renderDatabase(host, ctx) {
		const st = ctx.state.db;
		const toolbar = el('div', 'dcs-qd-toolbar');
		const search = api.textInput(st.search);
		search.className = 'edit-input dcs-qd-search';
		search.placeholder = 'Поиск';
		search.setAttribute('aria-label', 'Поиск в дереве «База данных»');
		ctx.keys.set(search, 'db-search');
		search.addEventListener('input', () => {
			st.search = search.value;
			st.collapsed.clear();
			st.limits.clear();
			ctx.rerender();
		});
		toolbar.appendChild(search);
		const sort = button('А↓Я', 'Упорядочить по имени', () => {
			st.sorted = !st.sorted;
			ctx.rerender();
		});
		sort.setAttribute('aria-pressed', String(st.sorted));
		ctx.keys.set(sort, 'db-sort');
		toolbar.appendChild(sort);
		host.appendChild(toolbar);
		if (!api.metadata.available()) {
			host.appendChild(
				el('div', 'dcs-plate', 'Объекты конфигурации видны, когда макет лежит в выгрузке конфигурации. Здесь только временные таблицы пакета и текст («Запрос…»).')
			);
		} else {
			const md = api.metadata.state();
			if (md.error) {
				const plate = el('div', 'dcs-plate dcs-plate-error', md.error);
				plate.appendChild(button('Повторить', 'Загрузить дерево объектов заново', () => api.metadata.retry(), 'ghost-btn'));
				host.appendChild(plate);
			} else if (!md.groups) {
				host.appendChild(el('div', 'dcs-plate', 'Загрузка метаданных…'));
				if (md.cold) {
					host.appendChild(el('div', 'struct-hint', 'Дерево объектов строится впервые: на большой выгрузке это может занять несколько минут, дальше оно берётся из кэша.'));
				}
			}
		}
		const built = databaseRows(ctx);
		ctx.dbInfo = built.info;
		treeView(host, {
			id: 'db',
			label: 'База данных',
			rows: built.rows,
			selected: st.selected,
			keys: ctx.keys,
			empty: st.search.trim() ? 'Ничего не найдено.' : 'Таблиц нет.',
			onSelect: (key, focus) => ctx.select('db', key, focus),
			onToggle: (key, value) => {
				toggle(st, key, value, Boolean(st.search.trim()) && (key === 'tmp' || key.indexOf('g:') === 0));
				ctx.select('db', key, true);
			},
			onActivate: (key) => {
				const item = built.info.get(key);
				if (item && item.kind === 'group') {
					toggle(st, key, !isOpen(st, key, Boolean(st.search.trim())), Boolean(st.search.trim()));
					ctx.rerender();
					return;
				}
				if (item && item.kind === 'more') {
					st.limits.set(item.group, (st.limits.get(item.group) || DB_PAGE) + DB_PAGE);
					ctx.rerender();
					return;
				}
				addFromDatabase(ctx, key);
			},
			// Перенос мышью: таблицу и поле — в «Таблицы» и «Поля»; таблицу и поле выборки обратно — убрать, как «<»
			drag: (key) => {
				const item = built.info.get(key);
				return item && (item.kind === 'table' || item.kind === 'field') ? item.kind : '';
			},
			drop: {
				from: {
					tables: (payload) => dropRemoveSource(ctx, payload.key),
					fields: (payload) => dropRemoveField(ctx, payload.key),
				},
				accept: (payload) => payload.zone !== 'tables' || payload.kind === 'source',
				place: 'zone',
			},
		});
	}

	/** Таблица, брошенная из «Таблиц» в «Базу данных»: «<» по этой строке — как Delete в списке. */
	function dropRemoveSource(ctx, key) {
		ctx.state.tables.selected = key;
		removeSelectedSource(ctx);
	}

	/** Поле, брошенное из «Полей» в «Таблицы» или «Базу данных»: «<» по этой строке — как Delete в списке. */
	function dropRemoveField(ctx, key) {
		ctx.state.fields.selected = Number(key);
		removeSelectedField(ctx);
	}

	function isOpen(st, key, searching) {
		return searching && (key === 'tmp' || key.indexOf('g:') === 0) ? !st.collapsed.has(key) : st.expanded.has(key);
	}

	/** Раскрытие строки; при поиске ветки видов раскрыты по умолчанию, и свёрнутые помнятся отдельно. */
	function toggle(st, key, value, searchBranch) {
		const set = searchBranch ? st.collapsed : st.expanded;
		const add = searchBranch ? !value : value;
		if (add) {
			set.add(key);
		} else {
			set.delete(key);
		}
	}

	/** Источник с этой таблицей в части (первый по порядку) или новый — так поле из дерева тянет за собой таблицу. */
	function ensureSource(ctx, item) {
		const part = ctx.part();
		const existing = QE.sourcesOf(part).find((entry) => entry.source.kind === 'table' && upper(entry.source.table) === upper(item.table));
		if (existing && existing.alias) {
			return { alias: existing.alias, model: ctx.state.model };
		}
		const spec = tableSpecOf(ctx, item);
		return spec.error ? spec : QE.addSource(ctx.state.model, ctx.address(), spec);
	}

	/** Объект вида без своей таблицы (main: false): «>» и «>>» объясняют, что брать надо его таблицу. */
	function objectNote(item) {
		return 'У объекта «' + item.name + '» нет своей таблицы: раскройте его и выберите таблицу источника.';
	}

	/**
	 * «>>» из дерева: выбранная таблица (уже в части — она же) со всеми полями верхнего уровня. Пока
	 * описание новой таблицы грузится, она добавляется без полей, и повтор «>>» дописывает поля.
	 * Общая таблица констант с числом констант больше CONSTANTS_ALL_LIMIT переносится без полей.
	 */
	function addAllFromDatabase(ctx, key) {
		const item = ctx.dbInfo ? ctx.dbInfo.get(key) : null;
		if (item && item.kind === 'object') {
			ctx.note(objectNote(item));
			return;
		}
		if (!item || item.kind !== 'table') {
			ctx.note('Выберите таблицу в дереве «База данных»: «>>» переносит её со всеми полями.');
			return;
		}
		const source = ensureSource(ctx, item);
		if (source.error) {
			ctx.note(source.error);
			return;
		}
		const fresh = source.model !== ctx.state.model;
		const found = QE.findSource(QE.partAt(source.model, ctx.address()), source.alias);
		const fields = found ? QE.fieldsOfSource(found.source, sourceEnv(ctx.state, ctx.state.statement)) : { state: 'none', fields: [] };
		const tooMany = found && QE.isConstantsTable(found.source) && fields.fields.length > CONSTANTS_ALL_LIMIT;
		if (fields.state !== 'ready' || fields.fields.length === 0 || tooMany) {
			if (fresh) {
				ctx.commit({ model: source.model });
				queueLinkSuggestion(ctx.state, source.alias);
			}
			if (tooMany) {
				ctx.note('Констант ' + fields.fields.length + ', поэтому «>>» переносит таблицу «' + source.alias + '» без полей: выберите нужные константы в дереве.');
				return;
			}
			ctx.note(fields.state === 'loading' ? 'Поля таблицы «' + source.alias + '» загружаются: нажмите «>>» ещё раз.' : 'У таблицы «' + source.alias + '» не известно ни одного поля.');
			return;
		}
		const added = QE.addFields(source.model, ctx.address(), fields.fields.map((field) => source.alias + '.' + field.name));
		if (!ctx.commit(added)) {
			ctx.state.tables.selected = 's:' + upper(source.alias);
			if (fresh) {
				queueLinkSuggestion(ctx.state, source.alias);
			}
			ctx.rerender();
		}
	}

	/**
	 * Поле, добавленное в конец «Полей», — на место сброса: к той же правке QE.addField — QE.moveField, и всё одним
	 * commit, с предупреждениями добавления. base — модель до QE.addField. at не задан или совпал с концом — результат
	 * добавления без сдвига. Поле второй и следующих частей объединения, занявшее пустую (NULL) ячейку своей колонки, новой
	 * колонки не добавило — оно остаётся в ней, как после «>»: сдвиг двигал бы колонку во всех частях.
	 */
	function placeField(ctx, base, added, at) {
		if (!added || added.error || typeof at !== 'number' || at === added.index) {
			return added;
		}
		const before = QE.partAt(base, ctx.address());
		if (!before || added.index !== before.fields.length) {
			return added;
		}
		const moved = QE.moveField(added.model, ctx.address(), added.index, at - added.index);
		return moved.error ? added : Object.assign({}, added, { model: moved.model, index: moved.index });
	}

	/**
	 * «>» из дерева: таблица — источником, поле — в выборку (с таблицей, если её в части ещё нет). at — номер в «Полях»
	 * для поля, брошенного мышью (без него — в конец, как «>»).
	 */
	function addFromDatabase(ctx, key, at) {
		const item = ctx.dbInfo ? ctx.dbInfo.get(key) : null;
		if (!item || item.kind === 'group' || item.kind === 'more') {
			ctx.note('Выберите таблицу или поле в дереве «База данных».');
			return;
		}
		if (item.kind === 'object') {
			ctx.note(objectNote(item));
			return;
		}
		if (item.kind === 'table') {
			const spec = tableSpecOf(ctx, item);
			if (spec.error) {
				ctx.note(spec.error);
				return;
			}
			const added = QE.addSource(ctx.state.model, ctx.address(), spec);
			if (!ctx.commit(added)) {
				ctx.state.tables.selected = 's:' + upper(added.alias);
				// Связь для новой таблицы предлагает перерисовка, когда известны поля (своё правило)
				queueLinkSuggestion(ctx.state, added.alias);
				ctx.rerender();
			}
			return;
		}
		const source = ensureSource(ctx, item);
		if (source.error) {
			ctx.note(source.error);
			return;
		}
		const fresh = source.model !== ctx.state.model;
		const added = placeField(ctx, source.model, QE.addField(source.model, ctx.address(), source.alias + '.' + item.path), at);
		if (!ctx.commit(added)) {
			ctx.state.fields.selected = added.index;
			if (fresh) {
				queueLinkSuggestion(ctx.state, source.alias);
			}
			ctx.rerender();
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Список «Таблицы»
	// ---------------------------------------------------------------------------------------------

	function sourceKey(entry, index) {
		return entry.alias ? 's:' + upper(entry.alias) : 's#' + index;
	}

	function sourceBadge(source) {
		if (source.kind === 'subquery') {
			return 'запрос';
		}
		// Таблица с параметрами — тоже «ВТ»: у критерия отбора параметр стоит у самого объекта
		// (`КритерийОтбора.X(&Значение)`), имени ВТ после объекта нет, а «Параметры…» к нему применимы
		if (source.kind === 'table' && (source.virtualTable || Array.isArray(source.params))) {
			return 'ВТ';
		}
		if (QE.isTempTable(source)) {
			return 'ВТ пакета';
		}
		return '';
	}

	/**
	 * Поле общей таблицы констант, тип которого ещё не известен: таблица собирается из дерева без описаний
	 * констант (их тысячи), поэтому раскрытие такого поля читает описание одной этой константы.
	 * Возвращает имя её таблицы (`Константа.X`) или null.
	 */
	function unreadConstant(tableName, field) {
		if (!field || field.type || field.valueType) {
			return null;
		}
		const own = FT.constantColumnTable(tableName, field.name);
		return own ? own.table : null;
	}

	/** Строка под раскрытой константой без типа: описание запрошено (ответ перерисует окно) или не прочитано. */
	function unreadConstantRow(key, level, constantTable) {
		const described = api.describeTable(constantTable);
		return described.state === 'loading'
			? { key: key + '#loading', level: level, label: 'Загрузка реквизитов…', inert: true }
			: { key: key + '#none', level: level, label: 'Тип константы не прочитан.', inert: true };
	}

	/** Строки «Таблиц»: источники части, под ними их поля, под ссылочными полями — реквизиты. */
	function tablesRows(ctx) {
		const st = ctx.state.tables;
		const rows = [];
		const info = new Map();
		const entries = QE.sourcesOf(ctx.part());
		entries.forEach((entry, index) => {
			const key = sourceKey(entry, index);
			const fields = ctx.fieldsOf(entry.source);
			const expandable = fields.state !== 'none' && Boolean(entry.alias);
			const expanded = expandable && st.expanded.has(key);
			rows.push({
				key: key,
				level: 0,
				label: entry.alias || '(без псевдонима)',
				note: QE.sourceLabel(entry.source),
				badge: sourceBadge(entry.source),
				expandable: expandable,
				expanded: expanded,
				title: QE.sourceLabel(entry.source),
			});
			info.set(key, { kind: 'source', alias: entry.alias, source: entry.source, fields: fields });
			if (!expanded) {
				return;
			}
			if (fields.state === 'loading') {
				rows.push({ key: key + '#loading', level: 1, label: 'Загрузка полей…', inert: true });
				return;
			}
			const walk = (list, base, level, depth) => {
				for (const field of list) {
					const path = base ? base + '.' + field.name : field.name;
					const fieldKey = 'sf:' + upper(entry.alias) + '|' + path;
					const type = field.type || field.valueType;
					const unread = depth === 0 && entry.source && entry.source.kind === 'table' ? unreadConstant(entry.source.table, field) : null;
					const canOpen = depth < 3 && (Boolean(unread) || api.expandable(type));
					const open = canOpen && st.expanded.has(fieldKey);
					rows.push({ key: fieldKey, level: level, label: field.name, note: field.synonym || field.title || '', expandable: canOpen, expanded: open, mark: depth === 0 ? fieldMark(field.kind) : '' });
					info.set(fieldKey, { kind: 'field', alias: entry.alias, path: path });
					if (open && unread) {
						rows.push(unreadConstantRow(fieldKey, level + 1, unread));
					} else if (open) {
						const children = api.typeChildren(type);
						walk(children.children, path, level + 1, depth + 1);
						if (children.loading) {
							rows.push({ key: fieldKey + '#loading', level: level + 1, label: 'Загрузка реквизитов…', inert: true });
						}
					}
				}
			};
			walk(fields.fields, '', 1, 0);
		});
		return { rows: rows, info: info };
	}

	function selectedSource(ctx) {
		const item = ctx.tablesInfo ? ctx.tablesInfo.get(ctx.state.tables.selected) : null;
		if (!item) {
			return null;
		}
		if (item.kind === 'source') {
			return item;
		}
		return ctx.tablesInfo.get('s:' + upper(item.alias)) || null;
	}

	function renderTables(host, ctx) {
		const st = ctx.state.tables;
		// Строки — до панели: доступность «Параметров виртуальной таблицы…» зависит от выбранной таблицы
		const built = tablesRows(ctx);
		ctx.tablesInfo = built.info;
		// Набор и порядок — как у конфигуратора: добавить, вложенный запрос, изменить (у нас — переименовать и
		// заменить), удалить, параметры виртуальной таблицы. Название короткое, подробность — второй строкой подсказки
		const toolbar = el('div', 'dcs-qd-toolbar');
		toolbar.appendChild(iconButton('add', 'Добавить таблицу', () => addTableFromDatabase(ctx), ctx.keys, { note: 'Таблица, выбранная в дереве «База данных»' }));
		toolbar.appendChild(iconButton('nested-query', 'Вложенный запрос…', () => nestedQuery(ctx), ctx.keys, { note: 'Изменить выбранный или создать новый' }));
		toolbar.appendChild(iconButton('rename', 'Переименовать таблицу…', () => renameSelected(ctx), ctx.keys, { note: 'Псевдоним и ссылки на него' }));
		toolbar.appendChild(iconButton('replace', 'Заменить таблицу', () => replaceSelected(ctx), ctx.keys, { note: 'На таблицу, выбранную в дереве «База данных»' }));
		toolbar.appendChild(iconButton('delete', 'Удалить выбранную таблицу', () => removeSelectedSource(ctx), ctx.keys));
		toolbar.appendChild(paramsButton(ctx));
		host.appendChild(toolbar);
		treeView(host, {
			id: 'tables',
			label: 'Таблицы',
			rows: built.rows,
			selected: st.selected,
			keys: ctx.keys,
			empty: 'Таблиц нет: добавьте их из дерева «База данных».',
			onSelect: (key, focus) => ctx.select('tables', key, focus),
			onToggle: (key, value) => {
				toggle(st, key, value, false);
				ctx.select('tables', key, true);
			},
			onActivate: (key) => {
				const item = built.info.get(key);
				if (!item) {
					return;
				}
				if (item.kind === 'source') {
					addAllFields(ctx, item);
				} else {
					addSourceField(ctx, item);
				}
			},
			onDelete: (key) => {
				const item = built.info.get(key);
				if (item && item.kind === 'source') {
					// Delete — по строке с фокусом, как Enter: в дерево входят Tab-ом без выбора
					st.selected = key;
					removeSelectedSource(ctx);
				}
			},
			// Перенос мышью: таблицу и её поля — в «Поля»; сюда — таблицу и поле из «Базы данных» (как «>»), поле
			// выборки из «Полей» — убрать (как «<»). Замены таблицы сбросом на строку нет: см. docs/metadata.md
			drag: (key) => {
				const item = built.info.get(key);
				if (!item) {
					return '';
				}
				return item.kind === 'source' ? (item.alias ? 'source' : '') : item.kind === 'field' ? 'field' : '';
			},
			drop: {
				from: {
					db: (payload) => addFromDatabase(ctx, payload.key),
					fields: (payload) => dropRemoveField(ctx, payload.key),
				},
				place: 'zone',
				effect: (payload) => (payload.zone === 'db' ? 'copy' : 'move'),
			},
		});
	}

	/** «>» по полю таблицы; at — номер в «Полях» для поля, брошенного мышью (без него — в конец). */
	function addSourceField(ctx, item, at) {
		const added = placeField(ctx, ctx.state.model, QE.addField(ctx.state.model, ctx.address(), item.alias + '.' + item.path), at);
		if (!ctx.commit(added)) {
			ctx.state.fields.selected = added.index;
			ctx.rerender();
		}
	}

	/** «>>»: все поля таблицы (верхнего уровня, без разыменования); уже выбранные не повторяются. */
	function addAllFields(ctx, source) {
		if (!source.alias) {
			ctx.note('У таблицы нет псевдонима: поля к ней не привязать.');
			return;
		}
		if (source.fields.state === 'loading') {
			ctx.note('Поля таблицы ещё загружаются.');
			return;
		}
		if (source.fields.fields.length === 0) {
			ctx.note('У таблицы «' + source.alias + '» не известно ни одного поля.');
			return;
		}
		ctx.commit(QE.addFields(ctx.state.model, ctx.address(), source.fields.fields.map((field) => source.alias + '.' + field.name)));
	}

	/**
	 * Пиктограмма «Добавить таблицу» над «Таблицами»: таблица, выбранная в дереве «База данных», — то же, что
	 * «>» для таблицы. Поле дерева она не переносит: это делает «>», а команда над «Таблицами» добавляет таблицы.
	 */
	function addTableFromDatabase(ctx) {
		const item = ctx.dbInfo ? ctx.dbInfo.get(ctx.state.db.selected) : null;
		if (item && item.kind === 'field') {
			ctx.note('Выберите в дереве «База данных» таблицу: поле переносит «>».');
			return;
		}
		addFromDatabase(ctx, ctx.state.db.selected);
	}

	function removeSelectedSource(ctx) {
		const source = selectedSource(ctx);
		if (!source || !source.alias) {
			ctx.note('Выберите таблицу в списке «Таблицы».');
			return;
		}
		ctx.commit(QE.removeSource(ctx.state.model, ctx.address(), source.alias));
	}

	/** Маленькое окно поверх: одно поле ввода, ОК применяет apply(value) → текст ошибки или ничего. */
	function promptWindow(ctx, title, label, value, apply) {
		let input = null;
		api.pushDialog({
			title: title,
			onClose: refocusLater(ctx.keys),
			build: (body) => {
				input = api.formRow(body, label, api.textInput(value));
				// Подпись formRow — соседний элемент без for: имя для читалки ставится явно
				input.setAttribute('aria-label', label);
			},
			buttons: [
				{
					id: 'ok',
					label: 'ОК',
					primary: true,
					onClick: (level) => {
						const error = apply(input.value);
						if (error) {
							return error;
						}
						level.close();
						return undefined;
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	function renameSelected(ctx) {
		const source = selectedSource(ctx);
		if (!source || !source.source.alias) {
			ctx.note('Выберите таблицу с псевдонимом в списке «Таблицы».');
			return;
		}
		promptWindow(ctx, 'Переименование таблицы', 'Псевдоним', source.source.alias, (value) => {
			const result = QE.renameSource(ctx.state.model, ctx.address(), source.alias, value);
			if (result.error) {
				return result.error;
			}
			ctx.state.tables.selected = 's:' + upper(value.trim());
			ctx.commit(result);
			return undefined;
		});
	}

	/** «Заменить таблицу»: выбранный источник получает таблицу, выбранную в дереве. */
	function replaceSelected(ctx) {
		const source = selectedSource(ctx);
		if (!source || source.source.kind !== 'table') {
			ctx.note('Выберите в списке «Таблицы» таблицу, которую заменить.');
			return;
		}
		const item = ctx.dbInfo ? ctx.dbInfo.get(ctx.state.db.selected) : null;
		if (!item || item.kind !== 'table') {
			ctx.note(item && item.kind === 'object' ? objectNote(item) : 'Выберите в дереве «База данных» таблицу, на которую заменить.');
			return;
		}
		const spec = tableSpecOf(ctx, item);
		if (spec.error) {
			ctx.note(spec.error);
			return;
		}
		const target = api.describeTable(item.table);
		const temp = QE.isTempTable({ kind: 'table', table: item.table });
		let fields;
		if (temp) {
			const found = ctx.tempTables().find((table) => upper(table.name) === upper(item.table));
			fields = found ? found.fields : undefined;
		} else if (target.state === 'ready') {
			fields = (target.table.fields || []).map((field) => field.name);
		} else if (target.state === 'loading') {
			ctx.note('Описание новой таблицы загружается: повторите замену через мгновение.');
			return;
		}
		const result = QE.replaceSource(ctx.state.model, ctx.address(), source.alias, { table: spec.table, defaultParams: spec.params }, { fields: fields });
		if (!ctx.commit(result)) {
			ctx.state.tables.selected = 's:' + upper(result.alias);
			ctx.rerender();
		}
	}

	function nestedQuery(ctx) {
		const source = selectedSource(ctx);
		const address = ctx.address();
		const temps = ctx.tempTables();
		// Параметры внешнего пакета — в списке значений параметров ВТ вложенного запроса: они уже есть в запросе
		const outerParams = QE.usedParameters(ctx.state.model, ctx.state.outerParams);
		if (source && source.source.kind === 'subquery' && source.alias) {
			openConstructor({
				nested: true,
				title: 'Вложенный запрос «' + source.alias + '»',
				model: QE.subModel(ctx.state.model, source.source.query),
				outerTemp: temps,
				outerParams: outerParams,
				refocus: refocusLater(ctx.keys),
				onOk: (statement) => ctx.commit(QE.setSubquery(ctx.state.model, address, source.alias, statement)),
			});
			return;
		}
		openConstructor({
			nested: true,
			title: 'Вложенный запрос',
			model: QE.subModel(ctx.state.model),
			outerTemp: temps,
			outerParams: outerParams,
			refocus: refocusLater(ctx.keys),
			onOk: (statement) => {
				const added = QE.addSource(ctx.state.model, address, { subquery: statement });
				const error = ctx.commit(added);
				if (!error) {
					ctx.state.tables.selected = 's:' + upper(added.alias);
					ctx.rerender();
				}
				return error;
			},
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Список «Поля»
	// ---------------------------------------------------------------------------------------------

	function oneLine(value) {
		return String(value || '').replace(/\s+/g, ' ').trim();
	}

	function renderFields(host, ctx) {
		const st = ctx.state.fields;
		const part = ctx.part();
		const toolbar = el('div', 'dcs-qd-toolbar');
		// Как у конфигуратора: добавить (поле-выражение в окне выражения), изменить, удалить; у нас ещё порядок
		toolbar.appendChild(iconButton('add', 'Добавить поле-выражение…', () => expressionForField(ctx, -1), ctx.keys));
		toolbar.appendChild(iconButton('edit', 'Изменить выражение выбранного поля…', () => expressionForField(ctx, st.selected), ctx.keys));
		toolbar.appendChild(iconButton('delete', 'Удалить выбранное поле', () => removeSelectedField(ctx), ctx.keys));
		toolbar.appendChild(iconButton('up', 'Переместить поле выше', () => moveSelectedField(ctx, -1), ctx.keys));
		toolbar.appendChild(iconButton('down', 'Переместить поле ниже', () => moveSelectedField(ctx, 1), ctx.keys));
		host.appendChild(toolbar);
		const names = QE.columnNames(ctx.statement().parts[0]);
		const rows = part.fields.map((field, index) => {
			const column = names[index];
			return {
				key: String(index),
				level: 0,
				label: oneLine(field.expr),
				note: column && upper(column) !== upper(oneLine(field.expr).split('.').pop()) ? 'КАК ' + column : '',
				title: column ? 'Колонка «' + column + '»' : 'Колонка без имени',
			};
		});
		treeView(host, {
			id: 'fields',
			role: 'listbox',
			label: 'Поля',
			rows: rows,
			selected: st.selected >= 0 ? String(st.selected) : '',
			keys: ctx.keys,
			empty: 'Полей нет: перенесите их из таблиц («>») или добавьте выражение.',
			onSelect: (key, focus) => {
				st.selected = Number(key);
				ctx.select('fields', key, focus);
			},
			onToggle: () => undefined,
			onActivate: (key) => expressionForField(ctx, Number(key)),
			onDelete: (key) => {
				st.selected = Number(key);
				removeSelectedField(ctx);
			},
			// Перенос мышью: поле из «Базы данных» и «Таблиц» встаёт в место сброса, таблица — всеми полями в конец
			// (как «>>»); своё поле переставляется (как ↑ ↓) или уходит в «Таблицы» и «Базу данных» (как «<»)
			drag: () => 'field',
			drop: {
				from: {
					db: (payload, target) => {
						if (payload.kind === 'table') {
							addAllFromDatabase(ctx, payload.key);
						} else {
							addFromDatabase(ctx, payload.key, dropAt(part.fields.length, target));
						}
					},
					tables: (payload, target) => {
						const item = ctx.tablesInfo ? ctx.tablesInfo.get(payload.key) : null;
						if (item && item.kind === 'source') {
							addAllFields(ctx, item);
						} else if (item) {
							addSourceField(ctx, item, dropAt(part.fields.length, target));
						}
					},
					fields: (payload, target) => {
						const from = Number(payload.key);
						const delta = dropDelta(ctx, 'fields', part.fields.length, from, target);
						if (delta === 0) {
							return false;
						}
						st.selected = from;
						moveSelectedField(ctx, delta);
					},
				},
				place: (payload) => (payload.kind === 'table' || payload.kind === 'source' ? 'zone' : 'line'),
				effect: (payload) => (payload.zone === 'fields' ? 'move' : 'copy'),
			},
		});
	}

	function moveSelectedField(ctx, delta) {
		const st = ctx.state.fields;
		if (!ctx.part().fields[st.selected]) {
			ctx.note('Выберите поле в списке «Поля».');
			return;
		}
		// Фокус остаётся на кнопке (ключ возвращает его после перерисовки): так сдвигают на несколько позиций подряд
		const result = QE.moveField(ctx.state.model, ctx.address(), st.selected, delta);
		st.selected = result.index;
		ctx.commit(result);
	}

	function removeSelectedField(ctx) {
		const st = ctx.state.fields;
		if (!ctx.part().fields[st.selected]) {
			ctx.note('Выберите поле в списке «Поля».');
			return;
		}
		const result = QE.removeField(ctx.state.model, ctx.address(), st.selected);
		// В объединении значение части становится NULL, а колонка остаётся: выбор считается по новой части
		const next = result.model ? QE.partAt(result.model, ctx.address()) : null;
		st.selected = next ? Math.min(st.selected, next.fields.length - 1) : -1;
		ctx.commit(result);
	}

	/** Окно выражения для поля: index < 0 — новое поле-выражение, иначе правка выражения поля. */
	function expressionForField(ctx, index) {
		const field = index >= 0 ? ctx.part().fields[index] : null;
		if (index >= 0 && !field) {
			ctx.note('Выберите поле в списке «Поля».');
			return;
		}
		const address = ctx.address();
		openExpressionWindow(ctx, {
			title: field ? 'Выражение поля' : 'Новое поле-выражение',
			value: field ? field.expr : '',
			apply: (text) => {
				const result = field ? QE.setFieldExpr(ctx.state.model, address, index, text) : QE.addField(ctx.state.model, address, text);
				const error = ctx.commit(result);
				if (!error && !field) {
					ctx.state.fields.selected = result.index;
					ctx.rerender();
				}
				return error;
			},
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Таблицы и поля»
	// ---------------------------------------------------------------------------------------------

	function renderTablesTab(container, ctx) {
		const layout = el('div', 'dcs-qd-columns');
		const dbCol = column(layout, 'База данных');
		renderDatabase(dbCol, ctx);
		moves(layout, [
			{ label: '>', title: 'Добавить выбранное в дереве: таблицу в «Таблицы», поле в «Поля»', onClick: () => addFromDatabase(ctx, ctx.state.db.selected) },
			{ label: '>>', title: 'Добавить выбранную в дереве таблицу со всеми полями', onClick: () => addAllFromDatabase(ctx, ctx.state.db.selected) },
			{ label: '<', title: 'Удалить выбранную таблицу из запроса', onClick: () => removeSelectedSource(ctx) },
			{ label: '<<', title: 'Удалить все таблицы и поля части запроса', onClick: () => ctx.commit(QE.removeAllSources(ctx.state.model, ctx.address())) },
		], ctx.keys);
		const tablesCol = column(layout, 'Таблицы');
		renderTables(tablesCol, ctx);
		moves(layout, [
			{
				label: '>',
				title: 'Добавить выбранное поле таблицы в «Поля»',
				onClick: () => {
					const item = ctx.tablesInfo.get(ctx.state.tables.selected);
					if (item && item.kind === 'field') {
						addSourceField(ctx, item);
					} else {
						ctx.note('Выберите поле таблицы в списке «Таблицы»: все поля переносит «>>».');
					}
				},
			},
			{
				label: '>>',
				title: 'Добавить все поля выбранной таблицы в «Поля»',
				onClick: () => {
					const source = selectedSource(ctx);
					if (source) {
						addAllFields(ctx, source);
					} else {
						ctx.note('Выберите таблицу в списке «Таблицы».');
					}
				},
			},
			{ label: '<', title: 'Удалить выбранное поле из «Полей»', onClick: () => removeSelectedField(ctx) },
			{ label: '<<', title: 'Удалить все поля части запроса', onClick: () => ctx.commit(QE.removeAllFields(ctx.state.model, ctx.address())) },
		], ctx.keys);
		const fieldsCol = column(layout, 'Поля');
		renderFields(fieldsCol, ctx);
		container.appendChild(layout);
		renderNamePlate(container, ctx);
	}

	// ---------------------------------------------------------------------------------------------
	// Проверка имён по метаданным
	// ---------------------------------------------------------------------------------------------

	/** Сколько предупреждений проверки имён подтверждение перед ОК перечисляет поштучно. */
	const NAMES_IN_CONFIRM = 8;

	/**
	 * Предупреждения проверки имён модели окна — всех запросов пакета и частей (у вложенного запроса —
	 * его самого, ВТ внешнего пакета видны). Описания, которых ещё нет, запрошены: ответ перерисует окно.
	 */
	function nameProblemsOf(state) {
		return state.model ? api.nameProblems(state.model, state.outerTemp) : [];
	}

	/** Место предупреждения: «Запрос пакета 2, часть 1: » — только если запросов или частей больше одного. */
	function nameProblemPlace(model, problem) {
		const statements = model && Array.isArray(model.statements) ? model.statements : [];
		const statement = statements[problem.statement];
		const parts = statement && Array.isArray(statement.parts) ? statement.parts.length : 0;
		const where = [statements.length > 1 ? 'запрос пакета ' + (problem.statement + 1) : '', parts > 1 ? 'часть ' + (problem.part + 1) : '']
			.filter(Boolean)
			.join(', ');
		return where ? where.charAt(0).toUpperCase() + where.slice(1) + ': ' : '';
	}

	function nameProblemList(model, problems, limit) {
		const box = el('ul', 'dcs-qd-names-list');
		for (const problem of problems.slice(0, limit)) {
			box.appendChild(el('li', '', nameProblemPlace(model, problem) + problem.message));
		}
		if (problems.length > limit) {
			box.appendChild(el('li', '', 'и ещё ' + (problems.length - limit) + '.'));
		}
		return box;
	}

	/**
	 * Плашка «Проверка имён: N» под колонками «Таблиц и полей»: имена таблиц и полей, которых нет в
	 * описаниях объектов выгрузки, и неизвестные алиасы. Только предупреждение — ОК не блокируется.
	 */
	function renderNamePlate(container, ctx) {
		const problems = nameProblemsOf(ctx.state);
		if (problems.length === 0) {
			return;
		}
		const plate = el('div', 'dcs-plate dcs-qd-warnings dcs-qd-names');
		plate.appendChild(el('div', 'dcs-qd-names-title', 'Проверка имён: ' + problems.length));
		plate.appendChild(nameProblemList(ctx.state.model, problems, problems.length));
		plate.appendChild(el('div', 'struct-hint', 'Имена сверены с описаниями объектов выгрузки. ОК запишет запрос и так, но платформа может его не принять.'));
		container.appendChild(plate);
	}

	/** Подтверждение перед записью: проверка имён нашла предупреждения. */
	function confirmNames(model, problems, proceed) {
		api.pushDialog({
			title: 'Проверка имён',
			build: (body) => {
				body.appendChild(
					el(
						'div',
						'dcs-confirm-text',
						'Проверка имён по метаданным выгрузки нашла предупреждения (' + problems.length + '). Запрос можно записать и так, но платформа может его не принять.'
					)
				);
				body.appendChild(nameProblemList(model, problems, NAMES_IN_CONFIRM));
			},
			buttons: [
				{
					id: 'write',
					label: 'Записать',
					primary: true,
					onClick: (level) => {
						level.close();
						return proceed();
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Окно выражения
	// ---------------------------------------------------------------------------------------------

	/**
	 * Подпись типа строк окна — то же русское представление, что в колонке «Тип»: узлы
	 * окна несут только valueType, а каталог подпись по типу сам не считает.
	 */
	function withTypeText(nodes) {
		for (const node of nodes) {
			if (node && node.kind !== 'function' && node.valueType && !node.typeText) {
				node.typeText = api.typeLabel(node.valueType) || '';
			}
		}
		return nodes;
	}

	/**
	 * Функции языка запросов для окон конструктора — прописными, как их пишет текст запроса (агрегаты
	 * «Группировки» тоже прописные): выражения хранятся текстом, и смешанный регистр списка (ЕстьNULL)
	 * попадал бы в собранный запрос.
	 */
	function queryFunctionNodes(lang) {
		return completer.functionNodes('query', lang).map((node) => Object.assign({}, node, { path: upper(node.path) }));
	}

	/**
	 * Функции условий виртуальной таблицы (Условие, условия на счёт): без агрегатных — условие ВТ платформа накладывает на
	 * записи регистра до группировки, как ГДЕ, и СУММА или КОЛИЧЕСТВО в нём неуместны.
	 */
	function vtConditionFunctionNodes(lang) {
		return queryFunctionNodes(lang).filter((node) => node.group !== 'aggregate');
	}

	/** Узлы каталога окна выражения: поля источников части, параметры схемы, функции языка запросов (или свои functions). */
	function expressionNodes(ctx, own, functions) {
		const nodes = own ? own.slice() : QE.catalogNodes(ctx.state.model, ctx.address(), Object.assign(sourceEnv(ctx.state, ctx.state.statement), { parameters: api.model().parameters || [] }));
		withTypeText(nodes);
		nodes.push(...(functions || queryFunctionNodes(ctx.lang)));
		return nodes;
	}

	/**
	 * Окно выражения поверх конструктора: слева поля источников текущей части (каталог
	 * catalogFromNodes, ссылочные поля раскрываются через точку), справа функции языка запросов,
	 * снизу текст с подсветкой и подсказкой. Двойной щелчок или Enter вставляет в позицию каретки.
	 * opts: {title, value, apply(text) → ошибка | undefined, nodes?, empty?, check?, hint?, paramsBranch?, functions?,
	 * functionsOpen?} — свои узлы (поля ВТ в условии параметров виртуальной таблицы), текст пустого дерева полей и
	 * check(text) → предупреждение под текстом или пусто (поле, которого в условии этой ВТ быть не может): оно ОК не
	 * блокирует; hint — что правится, когда заголовок общий (в имени поля текста); paramsBranch: false — без ветки
	 * «Параметры» в дереве (параметры остаются в подсказке текста); functions — свои узлы функций вместо всех функций
	 * языка запросов, functionsOpen — раскрытые сначала группы (по умолчанию агрегатные и прочие).
	 */
	function openExpressionWindow(ctx, opts) {
		const state = { fieldsSel: '', funcsSel: '', expanded: new Set(), funcsOpen: new Set(opts.functionsOpen || ['aggregate', 'other']) };
		const keys = createKeys();
		const refocus = refocusLater(ctx.keys);
		let editor = null;
		let panes = null;
		let catalog = null;

		function currentCatalog() {
			catalog = completer.catalogFromNodes(expressionNodes(ctx, opts.nodes, opts.functions), { paramsAtRoot: true });
			return catalog;
		}

		function insert(textValue, caretBack) {
			const input = editor.input;
			const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
			const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
			input.value = input.value.slice(0, start) + textValue + input.value.slice(end);
			const caret = start + textValue.length - (caretBack || 0);
			input.focus();
			input.setSelectionRange(caret, caret);
			// Перерисовка подсветки: зеркало обновляется обработчиком input
			input.dispatchEvent(new Event('input'));
		}

		/** Строки списков, которые можно бросить в текст: путь поля (параметра) и имя функции по ключу строки. */
		let fieldPaths = new Map();
		let functionNames = new Map();

		/**
		 * Поле или функция, брошенные мышью в текст: штатный сброс текста в поле ввода VS Code отменяет,
		 * поэтому вставка своя — та же insert(), что у двойного щелчка, в позицию сброса (offset), а если браузер её не
		 * назвал — в позицию каретки.
		 */
		function insertDropped(payload, target) {
			const value = payload.zone === 'xf' ? fieldPaths.get(payload.key) : functionNames.get(payload.key);
			if (!value) {
				return;
			}
			if (typeof target.offset === 'number') {
				editor.input.setSelectionRange(target.offset, target.offset);
			}
			if (payload.zone === 'xf') {
				insert(value);
			} else {
				insert(value + '()', 1);
			}
		}

		/** Выделение текста до того, как перенос показал в нём место сброса: уйдёт указатель — оно вернётся. */
		let dropSaved = null;

		/**
		 * Место сброса в тексте — кареткой (раз в кадр переноса): без неё вставка «между АААА + и ББББ» шла бы вслепую.
		 * Поле получает фокус без прокрутки, сброс вставит туда же. x = null — указатель ушёл или перенос кончился, или
		 * браузер позицию не назвал: выделение возвращается прежним (сброс ставит свою позицию сам, insertDropped, а без
		 * позиции вставляет в прежнюю каретку).
		 */
		function previewDrop(x, y) {
			const input = editor.input;
			const offset = x === null ? null : caretAtPoint(input, x, y);
			if (offset === null) {
				if (dropSaved) {
					input.setSelectionRange(dropSaved.start, dropSaved.end);
					dropSaved = null;
				}
				return;
			}
			if (!dropSaved) {
				dropSaved = { start: input.selectionStart, end: input.selectionEnd };
			}
			if (document.activeElement !== input) {
				input.focus({ preventScroll: true });
			}
			if (input.selectionStart !== offset || input.selectionEnd !== offset) {
				input.setSelectionRange(offset, offset);
			}
		}

		function fieldRows() {
			const rows = [];
			const info = new Map();
			const walk = (nodes, level) => {
				for (const node of nodes) {
					const key = 'n:' + node.path;
					const children = node.children || [];
					// Раскрываемость — по типу, без чтения: описание объекта запрашивается, только когда строку раскрыли
					// (иначе раскрытие алиаса запрашивало бы описание каждого ссылочного типа его полей)
					const byType = children.length === 0 && api.expandable(node.valueType);
					const expandable = children.length > 0 || byType;
					const open = expandable && state.expanded.has(key);
					const typeKids = open && byType ? api.typeChildren(node.valueType) : null;
					rows.push({ key: key, level: level, label: node.name, note: node.title || '', expandable: expandable, expanded: open, title: node.path, mark: fieldMark(node.kind) });
					info.set(key, node.path);
					if (!open) {
						continue;
					}
					if (children.length > 0) {
						walk(children, level + 1);
					} else {
						walk(
							typeKids.children.map((child) => ({ name: child.name, path: node.path + '.' + child.name, title: child.title, valueType: child.valueType, children: [] })),
							level + 1
						);
						if (typeKids.loading) {
							rows.push({ key: key + '#loading', level: level + 1, label: 'Загрузка реквизитов…', inert: true });
						}
					}
				}
			};
			walk(catalog.nodes || [], 0);
			// Окна условий ВТ — как «Произвольное выражение» конфигуратора: в дереве только поля, параметры — в подсказке текста
			const params = opts.paramsBranch === false ? [] : catalog.params || [];
			if (params.length > 0) {
				rows.push({ key: 'params', level: 0, label: 'Параметры', expandable: true, expanded: state.expanded.has('params') });
				if (state.expanded.has('params')) {
					for (const param of params) {
						const key = 'p:' + param.name;
						rows.push({ key: key, level: 1, label: '&' + param.name, note: param.title || '' });
						info.set(key, '&' + param.name);
					}
				}
			}
			return { rows: rows, info: info };
		}

		function functionRows() {
			const rows = [];
			const info = new Map();
			const groups = completer.FUNCTION_GROUPS;
			const byGroup = new Map();
			for (const fn of catalog.functions || []) {
				const group = fn.group || 'other';
				if (!byGroup.has(group)) {
					byGroup.set(group, []);
				}
				byGroup.get(group).push(fn);
			}
			const order = FUNCTION_GROUP_ORDER.concat(Array.from(byGroup.keys()).filter((group) => FUNCTION_GROUP_ORDER.indexOf(group) < 0));
			for (const group of order) {
				const items = byGroup.get(group);
				if (!items) {
					continue;
				}
				const key = 'g:' + group;
				const open = state.funcsOpen.has(group);
				rows.push({ key: key, level: 0, label: groups[group] || group, badge: String(items.length), expandable: true, expanded: open });
				if (open) {
					for (const fn of items) {
						const fnKey = 'f:' + fn.name;
						rows.push({ key: fnKey, level: 1, label: fn.name });
						info.set(fnKey, fn.name);
					}
				}
			}
			return { rows: rows, info: info };
		}

		function renderPanes() {
			if (!panes || !panes.isConnected) {
				return;
			}
			const active = document.activeElement;
			const activeKey = active && typeof active.getAttribute === 'function' ? active.getAttribute('data-qd-key') : null;
			keys.clear();
			panes.textContent = '';
			currentCatalog();
			const left = column(panes, 'Поля');
			const built = fieldRows();
			fieldPaths = built.info;
			treeView(left, {
				id: 'xf',
				label: 'Поля',
				rows: built.rows,
				selected: state.fieldsSel,
				keys: keys,
				empty: opts.empty || 'Полей нет: в части запроса ещё нет таблиц.',
				onSelect: (key, focus) => {
					state.fieldsSel = key;
					refresh(focus ? 'xf:' + key : '');
				},
				onToggle: (key, value) => {
					if (value) {
						state.expanded.add(key);
					} else {
						state.expanded.delete(key);
					}
					state.fieldsSel = key;
					refresh('xf:' + key);
				},
				onActivate: (key) => {
					const path = built.info.get(key);
					if (path) {
						insert(path);
					}
				},
				// Поле и параметр тащат в текст выражения: вставка — та же, что у двойного щелчка
				drag: (key) => (built.info.has(key) ? 'field' : ''),
			});
			const right = column(panes, 'Функции');
			const fns = functionRows();
			functionNames = fns.info;
			treeView(right, {
				id: 'xn',
				label: 'Функции',
				rows: fns.rows,
				selected: state.funcsSel,
				keys: keys,
				empty: 'Список функций не загрузился.',
				onSelect: (key, focus) => {
					state.funcsSel = key;
					refresh(focus ? 'xn:' + key : '');
				},
				onToggle: (key, value) => {
					const group = key.slice(2);
					if (value) {
						state.funcsOpen.add(group);
					} else {
						state.funcsOpen.delete(group);
					}
					state.funcsSel = key;
					refresh('xn:' + key);
				},
				drag: (key) => (fns.info.has(key) ? 'function' : ''),
				onActivate: (key) => {
					const name = fns.info.get(key);
					if (name) {
						insert(name + '()', 1);
					} else if (key.indexOf('g:') === 0) {
						const group = key.slice(2);
						if (state.funcsOpen.has(group)) {
							state.funcsOpen.delete(group);
						} else {
							state.funcsOpen.add(group);
						}
						refresh('xn:' + key);
					}
				},
			});
			if (activeKey && document.activeElement !== active) {
				const next = keys.get(activeKey);
				if (next) {
					next.focus();
				}
			}
		}

		function refresh(focusKey) {
			renderPanes();
			if (focusKey) {
				const node = keys.get(focusKey);
				if (node) {
					node.focus();
				}
			}
		}

		const level = api.pushDialog({
			title: opts.title,
			width: 'wide',
			build: (body) => {
				const root = el('div', 'dcs-qd-expr');
				panes = el('div', 'dcs-qd-expr-panes');
				root.appendChild(panes);
				root.appendChild(el('div', 'dcs-qd-col-head', 'Выражение'));
				editor = api.codeEditor(opts.value || '', 'dcs-expr dcs-qd-expr-text');
				// Общий заголовок (окна условий ВТ — «Произвольное выражение»): что правится, читалка слышит в имени поля
				// текста
				editor.input.setAttribute('aria-label', opts.hint ? 'Выражение: ' + opts.hint : 'Выражение');
				root.appendChild(editor.box);
				// Текст выражения — зона сброса полей и функций: место — позиция в тексте под указателем. Зона — рамка
				// поля (.dcs-hl-wrap): её фон непрозрачен, и подсветка зоны на внешней обёртке под ним не видна
				DRAG.zone(editor.input.parentElement, {
					id: 'xexpr',
					scope: keys.scope,
					keyOf: () => null,
					from: { xf: insertDropped, xn: insertDropped },
					place: 'zone',
					effect: 'copy',
					target: (event) => ({ key: null, place: 'end', offset: caretAtPoint(editor.input, event.clientX, event.clientY) }),
					preview: previewDrop,
				});
				body.appendChild(root);
				renderPanes();
				api.attachCompletion(editor.input, () => 'query-expression', { catalog: () => catalog || currentCatalog(), ownTypes: true });
				if (typeof opts.check === 'function') {
					attachVtWarning(editor.box, editor.input, () => opts.check(editor.input.value));
				}
				editor.input.focus();
				const end = editor.input.value.length;
				editor.input.setSelectionRange(end, end);
			},
			buttons: [
				{
					id: 'ok',
					label: 'ОК',
					primary: true,
					onClick: (current) => {
						const value = editor.input.value.trim();
						if (!value) {
							return 'Выражение пустое.';
						}
						const error = opts.apply(value);
						if (error) {
							return error;
						}
						current.close();
						return undefined;
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
			onClose: () => {
				removeRenderer(renderPanes);
				refocus();
			},
		});
		addRenderer(renderPanes);
		return level;
	}

	// ---------------------------------------------------------------------------------------------
	// Параметры виртуальной таблицы
	// ---------------------------------------------------------------------------------------------

	/** Название кнопки «Параметры виртуальной таблицы…»: подсказка, доступное имя и ключ возврата фокуса. */
	const PARAMS_TITLE = 'Параметры виртуальной таблицы…';

	/** Описание таблицы источника для окна параметров: у временной таблицы пакета его нет. */
	function describedSource(source) {
		return source && source.kind === 'table' && !QE.isTempTable(source) ? api.describeTable(source.table) : { state: 'none' };
	}

	/**
	 * Решение об окне параметров (QE.virtualParamsState): без выгрузки в дереве «База данных» только
	 * временные таблицы, и сообщение не отсылает к значку «ВТ» в нём.
	 */
	function paramsStateOf(source, alias) {
		return QE.virtualParamsState(source, alias, describedSource(source), { metadata: api.metadata.available() });
	}

	/**
	 * Окно параметров для выбранной таблицы «Таблиц». Описание запрашивается при отрисовке, а его ответ
	 * перерисовывает окно — так кнопка становится доступной, когда оно приходит.
	 */
	function selectedParamsState(ctx) {
		const source = selectedSource(ctx);
		return paramsStateOf(source ? source.source : null, source ? source.alias : '');
	}

	/**
	 * «Параметры виртуальной таблицы…»: у таблицы без параметров (основной, временной, табличной части)
	 * и без выбранной таблицы недоступна, но остаётся в обходе Tab (aria-disabled), а причина — второй
	 * строкой её подсказки, под названием (у пиктограммы видимой подписи нет). Нажатие недоступной кнопки
	 * (Enter, пробел) не молчит: строка заметок говорит, где параметры. Ключ фокуса — по названию: смена
	 * причины не сбивает фокус с кнопки. Читалке — короткая причина в aria-description: полный текст она
	 * услышит один раз, из строки заметок при нажатии, а не дважды (описанием кнопки после перерисовки и
	 * живой областью).
	 */
	function paramsButton(ctx) {
		const info = selectedParamsState(ctx);
		const unavailable = info.available
			? null
			: { unavailable: true, note: info.state === 'loading' ? 'Описание таблицы загружается' : info.note, spoken: info.spoken };
		return iconButton('table-params', PARAMS_TITLE, () => paramsOfSelected(ctx), ctx.keys, unavailable);
	}

	function paramsOfSelected(ctx) {
		const info = selectedParamsState(ctx);
		if (info.state !== 'open') {
			ctx.note(info.note);
			return;
		}
		openParamsWindow(ctx, selectedSource(ctx), info.params, info.current, info.table, info.objectKind);
	}

	/**
	 * Узлы каталога по полям таблицы описания (поля ВТ пишутся без алиаса) и параметрам схемы. Поле общего реквизита — со
	 * своим видом (QE.fieldNodeKind): у разделителя в дереве и подсказке свой знак и слово.
	 */
	function vtFieldNodes(fields) {
		const nodes = [];
		for (const field of fields || []) {
			nodes.push({ path: field.name, kind: QE.fieldNodeKind(field), title: field.synonym || '', valueType: field.type || null });
		}
		for (const param of api.model().parameters || []) {
			if (param && param.name) {
				nodes.push({ path: param.name, kind: 'param', title: param.title || '', valueType: param.valueType || null });
			}
		}
		return nodes;
	}

	/** Кнопка «▾», имя раскрытого списка, описание поля и пустой список поля значения параметра ВТ (attachCompletion, drop). */
	const PARAM_DROP = {
		title: 'Параметры запроса (Alt+↓)',
		label: 'Показать параметры запроса',
		list: 'Параметры запроса',
		keys: 'Alt+↓ раскрывает параметры запроса',
		empty: 'В запросе ещё нет параметров: впишите значение или &Имя.',
	};

	/**
	 * Значение параметра ВТ (НачалоПериода, КонецПериода, Период… — QE.vtParamInput 'value') — поле со списком, как у
	 * конфигуратора: «▾» и Alt+↓ раскрывают `&`-параметры, которые уже есть в запросе (QE.usedParameters:
	 * пакет, внешний пакет вложенного конструктора и ещё не записанные тексты других позиций этого окна —
	 * windowTexts(input) без позиции самого поля), по имени, и выбор ставит &Имя вместо значения; «&» и Ctrl+Пробел
	 * подсказывают те же параметры у каретки, а выражение (ДОБАВИТЬКДАТЕ(&Дата, ДЕНЬ, 1), блок {…}) пишется текстом.
	 * Полей таблицы и функций в списке нет: значение параметра — не выражение над полями таблицы. Заголовок и тип строки
	 * — у параметра схемы с тем же именем. Буква список не открывает: в значении чаще пишут выражение, чем имя параметра.
	 */
	function attachParamDrop(ctx, input, windowTexts) {
		const nodes = () => {
			const declared = new Map();
			for (const param of api.model().parameters || []) {
				if (param && param.name) {
					declared.set(upper(param.name), param);
				}
			}
			// Свой недописанный текст поля (`&Н`) в свой список не идёт: только другие строки окна
			const typed = windowTexts(input);
			return QE.usedParameters(ctx.state.model, ctx.state.outerParams, typed).map((name) => {
				const param = declared.get(upper(name));
				return { path: name, kind: 'param', title: (param && param.title) || '', valueType: (param && param.valueType) || null };
			});
		};
		return api.attachCompletion(input, () => 'virtual-param-value', {
			catalog: () => completer.catalogFromNodes(withTypeText(nodes()), { paramsAtRoot: true }),
			ownTypes: true,
			letters: false,
			drop: PARAM_DROP,
		});
	}

	/**
	 * Значение параметра ВТ — однострочное поле со списком, как у конфигуратора: Enter перевода строки не вставляет. Список
	 * параметров открыт — Enter берёт или закрывает его раньше (обработчик attachCompletion подключён первым). Набор через
	 * IME Enter завершает сам.
	 */
	function singleLine(input) {
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.isComposing) {
				event.preventDefault();
			}
		});
	}

	/** Текст пустого дерева «Поля» окна условия виртуальной таблицы. */
	function vtConditionEmpty(table) {
		return table ? 'У таблицы нет полей, которые можно использовать в условии.' : 'Поля таблицы не известны: описания объекта нет.';
	}

	/**
	 * Заголовок окон выражения условий виртуальной таблицы («Условие» и условия на счёт), как у конфигуратора; какое
	 * условие правится, читалка слышит в имени поля текста (hint окна выражения).
	 */
	const VT_EXPRESSION_TITLE = 'Произвольное выражение';

	/**
	 * Что правит окно выражения условия на счёт (QE.vtParamInput 'account') по виду параметра описания: имя поля текста
	 * окна и подсказка кнопки «…».
	 */
	const ACCOUNT_CONDITION_TITLES = {
		account: 'Условие на счёт',
		corAccount: 'Условие на корреспондирующий счёт',
		accountDr: 'Условие на счёт дебета',
		accountCr: 'Условие на счёт кредита',
	};

	function accountConditionTitle(param) {
		return ACCOUNT_CONDITION_TITLES[param && param.kind] || 'Условие на счёт';
	}

	/**
	 * Поля окна и подсказки позиции по QE.vtExpressionFields и параметры схемы: у условия на счёт — своё поле счёта, у
	 * Порядка и позиции без описания — все поля таблицы.
	 */
	function vtExpressionNodes(param, table) {
		return vtFieldNodes(QE.vtExpressionFields(param, table));
	}

	/**
	 * Окно выражения условия на счёт — «Произвольное выражение», как у конфигуратора: в дереве «Поле» только
	 * своё поле счёта (Счет, КорСчет, СчетДт или СчетКт; раскрывается через точку по типу), без ветки «Параметры»
	 * (параметры — в подсказке текста); функции — без агрегатных, группы свёрнуты. Какое условие правится, читалка слышит
	 * в имени поля текста. Предупреждений нет: на что ставится условие на счёт, правило полей «Условия» не судит.
	 */
	function openAccountWindow(ctx, param, table, value, apply) {
		openExpressionWindow(ctx, {
			title: VT_EXPRESSION_TITLE,
			hint: accountConditionTitle(param),
			value: value,
			nodes: vtExpressionNodes(param, table),
			empty: 'Поля таблицы не известны: описания объекта нет.',
			paramsBranch: false,
			functions: vtConditionFunctionNodes(ctx.lang),
			functionsOpen: [],
			apply: apply,
		});
	}

	let vtWarnCount = 0;

	/**
	 * Строка предупреждения под текстом «Условия» виртуальной таблицы: поля, которых в условии этой
	 * таблицы быть не может (QE.vtConditionWarning). Только предупреждение: ОК не блокируется, текст не правится.
	 * Читалка слышит его описанием поля (aria-describedby), без живой области: пересчёт идёт на каждое нажатие.
	 * message() — текст предупреждения или пусто; возвращает пересчёт.
	 */
	function attachVtWarning(box, input, message) {
		const line = el('div', 'dcs-qd-vt-warn');
		line.id = 'dcsQdVtWarn' + ++vtWarnCount;
		input.setAttribute('aria-describedby', line.id);
		box.appendChild(line);
		const refresh = () => {
			line.textContent = message();
		};
		input.addEventListener('input', refresh);
		refresh();
		return refresh;
	}

	/**
	 * Окно параметров ВТ: строка на позицию (имена — из cf-md-query-tables, без описания — «Параметр N»),
	 * у периодичности и метода дополнения — список значений, у условия — окно выражения над полями
	 * самой таблицы (в условии ВТ поля пишутся без алиаса). Блоки СКД {…} видны и правятся текстом.
	 * Поля условия — только те, что платформа берёт в условие этой таблицы (QE.vtConditionFields: у остатков и
	 * оборотов регистра накопления — измерения и разделители), по имени; поле вне их, уже записанное в условии, остаётся как есть,
	 * а под текстом — предупреждение. У строки условия одна кнопка — «…» окна выражения: подсказка текста условия
	 * открывается набором и Ctrl+Пробел, а вторая кнопка-многоточие рядом путала бы. Условия на счёт (УсловиеСчета,
	 * УсловиеКорСчета, УсловиеСчетаДт, УсловиеСчетаКт) — так же: «…» открывает окно выражения своего поля счёта
	 * (openAccountWindow), подсказка — то же поле, параметры и функции, без «⋯» (как у конфигуратора). Значения
	 * (НачалоПериода, КонецПериода, Период…, виды субконто) — поле со списком параметров запроса (attachParamDrop), в
	 * списке и параметры, только что вписанные в другие строки окна; Периодичность — список значений описания в его
	 * порядке; Порядок — текст с подсказкой всех полей таблицы. Строки видом как у конфигуратора: значение — в одну
	 * строку (Enter перевода строки не вставляет), условия — выше, в три строки; окна их «…» — «Произвольное выражение».
	 */
	function openParamsWindow(ctx, source, params, current, table, objectKind) {
		const count = Math.max(params.length, current.length);
		const controls = [];
		// Поле строки рядом с её чтением (у списка значений — null): список значения берёт тексты других строк окна
		const fields = [];
		const windowTexts = (except) => controls.filter((read, k) => fields[k] !== except).map((read) => read());
		const address = ctx.address();
		const conditionFields = QE.vtConditionFields(objectKind || '', table).allowed;
		const conditionNodes = () => vtFieldNodes(conditionFields);
		const conditionWarning = (value) => QE.vtConditionWarning(objectKind || '', table, value).message;
		api.pushDialog({
			title: 'Параметры виртуальной таблицы «' + source.alias + '»',
			onClose: refocusLater(ctx.keys),
			width: 'wide',
			build: (body) => {
				body.appendChild(el('div', 'struct-hint', QE.sourceLabel(Object.assign({}, source.source, { params: null }))));
				const grid = el('div', 'dcs-qd-params');
				for (let k = 0; k < count; k++) {
					const param = params[k] || { name: 'Параметр ' + (k + 1), kind: '' };
					const value = current[k] || '';
					const input = QE.vtParamInput(param);
					if (input === 'list') {
						const options = [{ value: '', label: '(не задано)' }].concat(param.values.map((item) => ({ value: item, label: item })));
						const known = param.values.find((item) => upper(item) === upper(value.trim()));
						if (value.trim() && !known) {
							options.push({ value: value, label: value + ' (выражение)' });
						}
						const select = api.selectInput(options, known || value);
						select.setAttribute('aria-label', param.name);
						api.formRow(grid, param.name, select);
						const shown = select.value;
						// Список приводит регистр к описанию (АВТО → Авто): невыбранное значение остаётся как записано
						controls.push(() => (select.value === shown ? value : select.value));
						fields.push(null);
						continue;
					}
					const isCondition = input === 'condition';
					const isAccount = input === 'account';
					const shape = input === 'value' ? ' dcs-qd-param-value' : isCondition || isAccount ? ' dcs-qd-param-cond' : '';
					const editor = api.codeEditor(value, 'dcs-expr dcs-qd-param' + shape);
					editor.input.setAttribute('aria-label', param.name);
					const row = el('div', 'dcs-qd-param-row');
					row.appendChild(editor.box);
					const applyText = (text) => {
						editor.input.value = text;
						editor.input.dispatchEvent(new Event('input'));
						return undefined;
					};
					if (isCondition) {
						row.appendChild(
							button('…', 'Условие в окне выражения', () => {
								openExpressionWindow(ctx, {
									title: VT_EXPRESSION_TITLE,
									hint: 'Условие виртуальной таблицы «' + source.alias + '»',
									value: editor.input.value,
									nodes: conditionNodes(),
									empty: vtConditionEmpty(table),
									check: conditionWarning,
									paramsBranch: false,
									functions: vtConditionFunctionNodes(ctx.lang),
									functionsOpen: [],
									apply: applyText,
								});
							})
						);
					} else if (isAccount) {
						row.appendChild(button('…', accountConditionTitle(param) + ' в окне выражения', () => openAccountWindow(ctx, param, table, editor.input.value, applyText)));
					}
					api.formRow(grid, param.name, row);
					if (input === 'value') {
						attachParamDrop(ctx, editor.input, windowTexts);
						singleLine(editor.input);
					} else {
						const nodesOf = isCondition ? conditionNodes : () => vtExpressionNodes(param, table);
						// У условий — функции без агрегатных, как в их окне выражения; у Порядка — все
						const functionsOf = () => (isCondition || isAccount ? vtConditionFunctionNodes(ctx.lang) : queryFunctionNodes(ctx.lang));
						api.attachCompletion(editor.input, () => 'virtual-params', {
							catalog: () => completer.catalogFromNodes(withTypeText(nodesOf()).concat(functionsOf()), { paramsAtRoot: true }),
							ownTypes: true,
							// У условия и условия на счёт своя кнопка «…» окна выражения: вторая кнопка-многоточие путала бы
							more: !(isCondition || isAccount),
						});
					}
					if (isCondition) {
						attachVtWarning(editor.box, editor.input, () => conditionWarning(editor.input.value));
					}
					controls.push(() => editor.input.value);
					fields.push(editor.input);
				}
				body.appendChild(grid);
			},
			buttons: [
				{
					id: 'ok',
					label: 'ОК',
					primary: true,
					onClick: (level) => {
						const texts = controls.map((read) => read());
						const error = ctx.commit(QE.setVirtualParams(ctx.state.model, address, source.alias, texts));
						if (error) {
							return error;
						}
						level.close();
						return undefined;
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Общее вкладок «Связи», «Группировка», «Условия» — сетка, дерево полей, выбор строки
	// ---------------------------------------------------------------------------------------------

	const CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA', 'OPTION', 'LABEL']);

	/** Событие пришло из элемента управления в строке сетки: строку оно не выбирает и стрелками по ней не ходит. */
	function fromControl(event, row) {
		for (let node = event && event.target; node && node !== row; node = node.parentElement) {
			if (CONTROL_TAGS.has(node.tagName)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Сетка с одной остановкой Tab на строках, как у дерева: строка выбирается щелчком и стрелками,
	 * Delete — удаление; элементы управления в ячейках живут сами (их изменения коммитят правку
	 * модели). spec: {id, label, className, columns, rows: [{key, cells: (Node|string)[], title?}],
	 * selected, onSelect(key, focus), onDelete?(key), empty, keys, templateColumns?, drag?(key, source),
	 * drop?} — templateColumns задаёт колонки строкам, когда их число зависит от запроса (части
	 * объединения); drag и drop — перенос мышью (dragList), строку тащат за ручку в первой ячейке (dragHandle).
	 */
	function gridView(host, spec) {
		const grid = el('div', 'dcs-qd-grid' + (spec.className ? ' ' + spec.className : ''));
		grid.setAttribute('role', 'grid');
		grid.setAttribute('aria-label', spec.label);
		const head = el('div', 'dcs-qd-grid-row dcs-qd-grid-head');
		head.setAttribute('role', 'row');
		// Число колонок, известное только при отрисовке (части объединения), — шаблоном строки
		const template = spec.templateColumns || '';
		if (template) {
			head.style.gridTemplateColumns = template;
		}
		for (const title of spec.columns) {
			const cell = el('div', 'dcs-qd-grid-cell', title);
			cell.setAttribute('role', 'columnheader');
			head.appendChild(cell);
		}
		grid.appendChild(head);
		spec.keys.set(grid, spec.id);
		dragList(grid, spec);
		const rows = spec.rows;
		if (rows.length === 0) {
			grid.tabIndex = -1;
			grid.appendChild(el('div', 'dcs-qd-empty', spec.empty || ''));
			host.appendChild(grid);
			return grid;
		}
		const stop = rows.some((row) => row.key === spec.selected) ? spec.selected : rows[0].key;
		const items = [];
		/**
		 * Одна остановка Tab на сетку: строка-остановка и элементы управления в её ячейках, у прочих строк
		 * они только по щелчку и стрелкам — как roving tabindex мастера настроек; иначе Tab проходил бы
		 * по каждому списку каждой строки (1 + 8·N остановок у «Связей»).
		 */
		const setStop = (target) => {
			for (const entry of items) {
				const on = entry === target;
				entry.tabIndex = on ? 0 : -1;
				for (const control of controlsOf(entry)) {
					control.tabIndex = on ? 0 : -1;
				}
			}
		};
		rows.forEach((row, index) => {
			const selected = row.key === spec.selected;
			const item = el('div', 'dcs-qd-grid-row' + (selected ? ' dcs-tree-selected' : ''));
			item.setAttribute('role', 'row');
			item.setAttribute('aria-selected', String(selected));
			if (template) {
				item.style.gridTemplateColumns = template;
			}
			item.tabIndex = row.key === stop ? 0 : -1;
			if (row.title) {
				item.title = row.title;
			}
			spec.keys.set(item, spec.id + ':' + row.key);
			for (const content of row.cells) {
				const cell = el('div', 'dcs-qd-grid-cell');
				cell.setAttribute('role', 'gridcell');
				if (content && typeof content === 'object') {
					cell.appendChild(content);
				} else if (content !== undefined && content !== null && content !== '') {
					cell.textContent = String(content);
				}
				item.appendChild(cell);
			}
			// Перенос мышью — за ручку в первой ячейке: только атрибут, слушатели — у документа (api.drag)
			if (spec.drag && item.children.length > 0 && spec.drag(row.key)) {
				dragHandle(item.children[0]);
			}
			items.push(item);
			// Фокус в ячейку пришёл щелчком: остановка Tab переезжает в эту строку без перерисовки
			item.addEventListener('focusin', () => {
				if (item.tabIndex !== 0) {
					setStop(item);
				}
			});
			item.addEventListener('click', (event) => {
				if (!fromControl(event, item)) {
					spec.onSelect(row.key, false);
				}
			});
			item.addEventListener('keydown', (event) => {
				// Стрелки в списке ячейки — его собственные: строку двигают только клавиши на самой строке
				if (event.target && event.target !== item) {
					return;
				}
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
					if (next) {
						spec.onSelect(next.key, true);
					}
				} else if (event.key === 'Home' || event.key === 'End') {
					event.preventDefault();
					spec.onSelect(rows[event.key === 'Home' ? 0 : rows.length - 1].key, true);
				} else if (event.key === 'Delete' && spec.onDelete) {
					event.preventDefault();
					spec.onDelete(row.key);
				}
			});
			grid.appendChild(item);
		});
		setStop(items[rows.findIndex((row) => row.key === stop)]);
		host.appendChild(grid);
		return grid;
	}

	/** Элементы управления в ячейках строки сетки (флажки, списки, поля, кнопки «…»). */
	function controlsOf(row) {
		const out = [];
		const walk = (node) => {
			for (const child of Array.from(node.children || [])) {
				if (child.tagName === 'INPUT' || child.tagName === 'SELECT' || child.tagName === 'BUTTON' || child.tagName === 'TEXTAREA') {
					out.push(child);
				}
				walk(child);
			}
		};
		walk(row);
		return out;
	}

	/** Выбор строки своих списков вкладки (ctx.select знает только списки «Таблиц и полей»). */
	function choose(ctx, holder, prop, prefix, key, focus) {
		holder[prop] = key;
		ctx.state.focus = focus ? prefix + ':' + key : '';
		ctx.rerender();
	}

	/** Флажок ячейки сетки: подпись — для читалки, на экране её заменяет заголовок колонки. */
	function gridCheck(ctx, checked, label, key, onChange) {
		const input = el('input', 'edit-check');
		input.type = 'checkbox';
		input.checked = Boolean(checked);
		input.setAttribute('aria-label', label);
		ctx.keys.set(input, key);
		input.addEventListener('change', () => onChange(Boolean(input.checked)));
		return input;
	}

	function gridSelect(ctx, options, value, label, key, onChange, narrow) {
		const select = api.selectInput(options, value);
		select.classList.add('dcs-qd-cell-input');
		if (narrow) {
			// Знак сравнения — короткий список: поля вокруг него делят остальную ширину
			select.classList.add('dcs-qd-cell-op');
		}
		select.setAttribute('aria-label', label);
		ctx.keys.set(select, key);
		select.addEventListener('change', () => onChange(select.value));
		return select;
	}

	/** Произвольный текст в ячейке и «…» — окно выражения. */
	function expressionCell(ctx, value, title, key, onEdit) {
		const box = el('div', 'dcs-qd-cell-expr');
		const label = el('span', 'dcs-qd-cell-text', oneLine(value));
		label.title = value;
		box.appendChild(label);
		const edit = button('…', title, onEdit, 'ghost-btn dcs-btn-small');
		ctx.keys.set(edit, key);
		box.appendChild(edit);
		return box;
	}

	/**
	 * Строки дерева полей вкладки: источники части, под ними поля, под ссылочными — реквизиты (как
	 * «Таблицы» вкладки «Таблицы и поля», но только для выбора). prefix отделяет ключи деревьев
	 * разных вкладок; info по ключу — {kind: 'source', alias} | {kind: 'field', alias, path}.
	 */
	function sourceFieldRows(ctx, expanded, prefix, level) {
		const rows = [];
		const info = new Map();
		QE.sourcesOf(ctx.part()).forEach((entry, index) => {
			if (!entry.alias) {
				return;
			}
			const key = prefix + 's:' + upper(entry.alias);
			const fields = ctx.fieldsOf(entry.source);
			const expandable = fields.state !== 'none';
			const open = expandable && expanded.has(key);
			rows.push({ key: key, level: level, label: entry.alias, note: QE.sourceLabel(entry.source), badge: sourceBadge(entry.source), expandable: expandable, expanded: open, title: QE.sourceLabel(entry.source) });
			info.set(key, { kind: 'source', alias: entry.alias, index: index });
			if (!open) {
				return;
			}
			if (fields.state === 'loading') {
				rows.push({ key: key + '#loading', level: level + 1, label: 'Загрузка полей…', inert: true });
				return;
			}
			const walk = (items, base, depth) => {
				for (const field of items) {
					const path = base ? base + '.' + field.name : field.name;
					const fieldKey = prefix + 'f:' + upper(entry.alias) + '|' + path;
					const type = field.type || field.valueType;
					const canOpen = depth < 3 && api.expandable(type);
					const fieldOpen = canOpen && expanded.has(fieldKey);
					rows.push({ key: fieldKey, level: level + 1 + depth, label: field.name, note: field.synonym || field.title || '', expandable: canOpen, expanded: fieldOpen, mark: depth === 0 ? fieldMark(field.kind) : '' });
					info.set(fieldKey, { kind: 'field', alias: entry.alias, path: path });
					if (fieldOpen) {
						const children = api.typeChildren(type);
						walk(children.children, path, depth + 1);
						if (children.loading) {
							rows.push({ key: fieldKey + '#loading', level: level + 2 + depth, label: 'Загрузка реквизитов…', inert: true });
						}
					}
				}
			};
			walk(fields.fields, '', 0);
		});
		return { rows: rows, info: info };
	}

	function flipExpanded(set, key, value) {
		if (value) {
			set.add(key);
		} else {
			set.delete(key);
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Связи»
	// ---------------------------------------------------------------------------------------------

	/** Строка связи после правки, сменившей её место (новая пара): последнее условие соединения по адресу. */
	function lastRowKeyAt(ctx, path) {
		const rows = QE.linkRows(ctx.part()).filter((row) => row.path.join('.') === path.join('.'));
		return rows.length > 0 ? rows[rows.length - 1].key : '';
	}

	function linkEnv(ctx) {
		return sourceEnv(ctx.state, ctx.state.statement);
	}

	/** Поля таблицы связи для списков простого условия; записанное поле, которого нет в описании, остаётся в списке. */
	function linkFieldOptions(ctx, alias, current) {
		const found = QE.findSource(ctx.part(), alias);
		const fields = found ? ctx.fieldsOf(found.source) : { state: 'none', fields: [] };
		const names = fields.fields.map((field) => field.name);
		if (current && !names.some((name) => upper(name) === upper(current))) {
			names.unshift(current);
		}
		return names.map((name) => ({ value: name, label: name }));
	}

	/**
	 * Условие по умолчанию для пары таблиц: предложение по типу ссылки, иначе первое общее имя
	 * поля, иначе первые поля обеих; поля не известны — пусто.
	 */
	function defaultLinkCondition(ctx, left, right, avoid) {
		const part = ctx.part();
		const suggested = QE.suggestCondition(part, left, right, linkEnv(ctx));
		// Ещё одно условие той же пары не повторяет уже записанное: тогда — общее правило ниже
		const taken = (value) => Boolean(avoid) && avoid.some((item) => oneLine(item) === oneLine(value));
		if (suggested.state === 'ready' && !taken(suggested.condition)) {
			return suggested.condition;
		}
		const a = QE.findSource(part, left);
		const b = QE.findSource(part, right);
		const fa = a ? ctx.fieldsOf(a.source) : null;
		const fb = b ? ctx.fieldsOf(b.source) : null;
		if (!fa || !fb || fa.fields.length === 0 || fb.fields.length === 0) {
			return '';
		}
		const common = fa.fields.find((field) => fb.fields.some((other) => upper(other.name) === upper(field.name)));
		const second = common ? fb.fields.find((other) => upper(other.name) === upper(common.name)) : fb.fields[0];
		return QE.linkConditionText(left, (common || fa.fields[0]).name, '=', right, second.name);
	}

	/**
	 * Что значат флажки «Все» — во всплывающей подсказке флажка. Читалке — своё короткое описание у каждого
	 * флажка: имя («Все записи таблицы 1 (…)») она уже прочла, а флажки повторяются в каждой строке.
	 */
	const LINK_ALL_TITLE =
		'Все записи таблицы, даже без пары. Оба флажка дают ПОЛНОЕ соединение, только у первой таблицы ЛЕВОЕ, только у второй ПРАВОЕ, ни одного ВНУТРЕННЕЕ. Флажки общие у всех строк одного соединения.';
	const LINK_ALL_LEFT_SPOKEN = 'с «Все» у таблицы 2 соединение ПОЛНОЕ, без него ЛЕВОЕ; флажок общий для строк соединения';
	const LINK_ALL_RIGHT_SPOKEN = 'с «Все» у таблицы 1 соединение ПОЛНОЕ, без него ПРАВОЕ; флажок общий для строк соединения';

	function linkRowCells(ctx, row, index, aliases) {
		const st = ctx.state.links;
		const address = ctx.address();
		const ref = { path: row.path, condition: row.condition };
		const custom = st.custom.has(row.key) || !row.simple;
		const relink = (pair) => {
			const result = QE.relinkRow(ctx.state.model, address, ref, pair);
			if (!result.error) {
				st.custom.delete(row.key);
			}
			if (!ctx.commit(result)) {
				st.selected = lastRowKeyAt(ctx, result.path);
				ctx.state.focus = 'lk:' + st.selected + (pair.left ? ':left' : ':right');
				ctx.rerender();
			}
		};
		const setKind = (allLeft, allRight) => {
			st.selected = row.key;
			ctx.commit(QE.setLinkKind(ctx.state.model, address, ref, allLeft, allRight));
		};
		const options = aliases.map((alias) => ({ value: alias, label: alias }));
		const number = el('span', '', String(index + 1) + (row.optional ? ' {}' : ''));
		if (row.optional) {
			number.title = 'Необязательное соединение СКД {…}: номер группы задаётся на вкладке «Компоновка данных»';
		}
		const allLeft = gridCheck(ctx, row.allLeft, 'Все записи таблицы 1 (' + row.left + ')', 'lk:' + row.key + ':all1', (value) => setKind(value, row.allRight));
		hint(allLeft, LINK_ALL_TITLE, LINK_ALL_LEFT_SPOKEN);
		const allRight = gridCheck(ctx, row.allRight, 'Все записи таблицы 2 (' + row.right + ')', 'lk:' + row.key + ':all2', (value) => setKind(row.allLeft, value));
		hint(allRight, LINK_ALL_TITLE, LINK_ALL_RIGHT_SPOKEN);
		const cells = [
			number,
			gridSelect(ctx, options, row.left, 'Таблица 1', 'lk:' + row.key + ':left', (value) => relink({ left: value })),
			allLeft,
			gridSelect(ctx, options, row.right, 'Таблица 2', 'lk:' + row.key + ':right', (value) => relink({ right: value })),
			allRight,
			gridCheck(ctx, custom, 'Произвольное условие', 'lk:' + row.key + ':custom', (value) => toggleCustomLink(ctx, row, value)),
		];
		if (custom) {
			cells.push(
				expressionCell(ctx, row.text, 'Изменить условие связи в окне выражения', 'lk:' + row.key + ':expr', () => {
					openExpressionWindow(ctx, {
						title: 'Условие связи ' + row.left + ' и ' + row.right,
						value: row.text,
						apply: (value) => {
							st.selected = row.key;
							return ctx.commit(QE.setLinkCondition(ctx.state.model, address, ref, value));
						},
					});
				})
			);
			return cells;
		}
		const simple = row.simple;
		const write = (leftField, op, rightField) => {
			st.selected = row.key;
			ctx.commit(QE.setLinkCondition(ctx.state.model, address, ref, QE.linkConditionText(row.left, leftField, op, row.right, rightField)));
		};
		const box = el('div', 'dcs-qd-cell-simple');
		box.appendChild(gridSelect(ctx, linkFieldOptions(ctx, row.left, simple.left), simple.left, 'Поле таблицы 1', 'lk:' + row.key + ':f1', (value) => write(value, simple.op, simple.right)));
		box.appendChild(
			gridSelect(ctx, QE.LINK_OPERATORS.map((op) => ({ value: op, label: op })), simple.op, 'Знак сравнения', 'lk:' + row.key + ':op', (value) => write(simple.left, value, simple.right), true)
		);
		box.appendChild(gridSelect(ctx, linkFieldOptions(ctx, row.right, simple.right), simple.right, 'Поле таблицы 2', 'lk:' + row.key + ':f2', (value) => write(simple.left, simple.op, value)));
		cells.push(box);
		return cells;
	}

	/**
	 * «Произвольное»: включено — условие правится текстом (окно выражения), даже если оно простое;
	 * снято — простое «поле · знак · поле». Произвольный текст, который не сводится к простому,
	 * заменяется условием по умолчанию для пары; полей ещё не знаем — остаётся текстом.
	 */
	function toggleCustomLink(ctx, row, value) {
		const st = ctx.state.links;
		st.selected = row.key;
		if (value) {
			st.custom.add(row.key);
			ctx.rerender();
			return;
		}
		st.custom.delete(row.key);
		if (row.simple) {
			ctx.rerender();
			return;
		}
		const condition = defaultLinkCondition(ctx, row.left, row.right);
		if (!condition) {
			st.custom.add(row.key);
			ctx.note('Условие не сводится к виду «поле · знак · поле», а поля таблиц ещё не известны, поэтому оно оставлено произвольным.');
			return;
		}
		ctx.commit(QE.setLinkCondition(ctx.state.model, ctx.address(), { path: row.path, condition: row.condition }, condition));
	}

	/** Отдельные строки ИЗ после первой — таблицы без связи с остальными (каждая строка с каждой). */
	function looseTables(part) {
		return part.from
			.slice(1)
			.map((entry) => QE.aliasOf(entry && entry.source))
			.filter(Boolean);
	}

	/**
	 * «Добавить»: связь первой таблицы с первой не связанной (отдельной строкой ИЗ); условие — по
	 * типу ссылки или по умолчанию для пары. Все таблицы уже связаны — новая строка-условие для пары
	 * «выбранная строка» (иначе первой и второй таблиц) с флажками «Все» её соединения: таблицы 1 и 2
	 * в строке выбираются списками, как у платформы, а не копией чужой строки.
	 */
	function addLinkRow(ctx) {
		const part = ctx.part();
		const aliases = QE.aliasesOf(part);
		const loose = looseTables(part);
		if (aliases.length < 2) {
			ctx.note('Для связи нужны две таблицы: добавьте их на вкладке «Таблицы и поля».');
			return;
		}
		let left = QE.aliasOf(part.from[0].source) || aliases[0];
		let right = loose[0];
		let flags = { allLeft: true, allRight: false };
		let avoid = [];
		if (!right) {
			const rows = QE.linkRows(part);
			const base = selectedLinkRow(ctx, rows) || rows[0] || null;
			if (base) {
				left = base.left;
				right = base.right;
				flags = { allLeft: base.allLeft, allRight: base.allRight };
				avoid = rows.filter((row) => row.path.join('.') === base.path.join('.')).map((row) => row.text);
			} else {
				right = aliases.find((alias) => upper(alias) !== upper(left));
			}
		}
		const condition = defaultLinkCondition(ctx, left, right, avoid) || 'ИСТИНА';
		const result = QE.addLink(ctx.state.model, ctx.address(), { left: left, right: right, allLeft: flags.allLeft, allRight: flags.allRight, condition: condition });
		if (!ctx.commit(result)) {
			ctx.state.links.selected = lastRowKeyAt(ctx, result.path);
			ctx.rerender();
		}
	}

	function selectedLinkRow(ctx, rows) {
		return rows.find((row) => row.key === ctx.state.links.selected) || null;
	}

	function copyLinkRow(ctx, rows) {
		const row = selectedLinkRow(ctx, rows);
		if (!row) {
			ctx.note('Выберите связь в списке.');
			return;
		}
		const result = QE.addLink(ctx.state.model, ctx.address(), { left: row.left, right: row.right, allLeft: row.allLeft, allRight: row.allRight, condition: row.text });
		if (!ctx.commit(result)) {
			ctx.state.links.selected = lastRowKeyAt(ctx, result.path);
			ctx.rerender();
		}
	}

	function removeLinkRow(ctx, rows) {
		const row = selectedLinkRow(ctx, rows);
		if (!row) {
			ctx.note('Выберите связь в списке.');
			return;
		}
		const result = QE.removeLink(ctx.state.model, ctx.address(), { path: row.path, condition: row.condition });
		if (!result.error) {
			// Номера условий соединения сдвинулись: отметки «Произвольное» указывали бы на чужие строки
			ctx.state.links.custom.clear();
			ctx.state.links.selected = '';
		}
		ctx.commit(result);
	}

	function renderLinksTab(container, ctx) {
		const st = ctx.state.links;
		const part = ctx.part();
		const rows = QE.linkRows(part);
		const aliases = QE.aliasesOf(part);
		const toolbar = el('div', 'dcs-qd-toolbar');
		toolbar.appendChild(iconButton('add', 'Добавить связь', () => addLinkRow(ctx), ctx.keys, { note: 'Таблица без связей соединится с первой таблицей' }));
		toolbar.appendChild(iconButton('add-copy', 'Скопировать выбранную связь', () => copyLinkRow(ctx, rows), ctx.keys));
		toolbar.appendChild(iconButton('delete', 'Удалить выбранную связь', () => removeLinkRow(ctx, rows), ctx.keys));
		container.appendChild(toolbar);
		gridView(container, {
			id: 'links',
			label: 'Связи',
			className: 'dcs-qd-grid-links',
			columns: ['№', 'Таблица 1', 'Все', 'Таблица 2', 'Все', 'Произвольное', 'Условие связи'],
			rows: rows.map((row, index) => ({ key: row.key, cells: linkRowCells(ctx, row, index, aliases), title: QE.joinKindOf(row.allLeft, row.allRight) === 'right' ? QE.RIGHT_JOIN_NOTE : '' })),
			selected: st.selected,
			keys: ctx.keys,
			empty: 'Связей нет: таблицы идут через запятую. Кнопка «Добавить связь» над списком свяжет первую таблицу со следующей.',
			onSelect: (key, focus) => choose(ctx, st, 'selected', 'links', key, focus),
			onDelete: (key) => {
				st.selected = key;
				removeLinkRow(ctx, rows);
			},
		});
		// Строка появляется, только когда есть таблицы без связи (каждая строка с каждой)
		const loose = looseTables(part);
		if (loose.length > 0) {
			container.appendChild(el('div', 'struct-hint', 'Без связи с остальными (через запятую, каждая строка с каждой): ' + loose.join(', ') + '.'));
		}
	}

	/** Таблица добавлена в часть: связь для неё предлагается, когда известны поля (описания грузятся лениво). */
	function queueLinkSuggestion(state, alias) {
		state.pendingLinks.push({ statement: state.statement, part: state.part, alias: alias });
	}

	/**
	 * Отложенные предложения связи (своё правило по типу ссылки). Зовётся в начале
	 * каждой перерисовки каркаса — ответы с описаниями приходят перерисовкой; модель меняется без
	 * своей перерисовки, потому что мы уже внутри неё.
	 */
	function processPendingLinks(ctx) {
		const state = ctx.state;
		if (!state.model || state.pendingLinks.length === 0) {
			return;
		}
		const keep = [];
		for (const item of state.pendingLinks) {
			const address = { statement: item.statement, part: item.part };
			const env = sourceEnv(state, item.statement);
			const found = QE.suggestLink(state.model, address, item.alias, env);
			if (found.state === 'loading') {
				keep.push(item);
				continue;
			}
			if (found.state !== 'ready') {
				continue;
			}
			const added = QE.addLink(state.model, address, found);
			if (added.error) {
				continue;
			}
			state.model = added.model;
			state.notes = ['Связь предложена по типу ссылки: ' + found.condition + ' (ЛЕВОЕ). Правится на вкладке «Связи».'];
		}
		state.pendingLinks = keep;
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Группировка»
	// ---------------------------------------------------------------------------------------------

	/** Дерево вкладки: «Поля запроса» (поля выборки без агрегата), затем таблицы части с полями. */
	function groupingTreeRows(ctx, grouping) {
		const st = ctx.state.grouping;
		const part = ctx.part();
		const rows = [];
		const info = new Map();
		const grouped = new Set(grouping.groups.map((item) => Q.canonTokens(item.text).join(' ')));
		const open = !st.collapsed.has('q');
		rows.push({ key: 'q', level: 0, label: 'Поля запроса', badge: String(part.fields.length), expandable: true, expanded: open });
		info.set('q', { kind: 'group' });
		if (open) {
			part.fields.forEach((field, index) => {
				if (QE.hasAggregate(field.expr)) {
					return;
				}
				const key = 'q:' + index;
				const column = QE.columnName(ctx.statement().parts[0].fields[index] || field);
				rows.push({
					key: key,
					level: 1,
					label: oneLine(field.expr),
					note: column && upper(column) !== upper(oneLine(field.expr).split('.').pop()) ? 'КАК ' + column : '',
					badge: grouped.has(Q.canonTokens(field.expr).join(' ')) ? 'групповое' : '',
				});
				info.set(key, { kind: 'select', index: index, expr: field.expr });
			});
		}
		const sources = sourceFieldRows(ctx, st.expanded, 'g', 0);
		rows.push(...sources.rows);
		sources.info.forEach((value, key) => info.set(key, value));
		return { rows: rows, info: info };
	}

	/** Выражение выбранной строки дерева: поле выборки — его выражение, поле таблицы — «Алиас.Путь». */
	function groupingExprOf(item) {
		if (!item) {
			return '';
		}
		if (item.kind === 'select') {
			return item.expr;
		}
		return item.kind === 'field' ? item.alias + '.' + item.path : '';
	}

	function toGroups(ctx, item) {
		const expr = groupingExprOf(item);
		if (!expr) {
			ctx.note('Выберите в дереве поле запроса или поле таблицы.');
			return;
		}
		let result = QE.addGroupField(ctx.state.model, ctx.address(), expr);
		const fresh = result && !result.error ? freshGroupWarnings(ctx, result.model) : [];
		if (fresh.length > 0) {
			result = Object.assign({}, result, { warnings: (Array.isArray(result.warnings) ? result.warnings : []).concat(fresh) });
		}
		if (!ctx.commit(result)) {
			ctx.state.grouping.groupSel = result.index;
			ctx.rerender();
		}
	}

	/**
	 * Типы выражений полей части для «Группировки»: вывод DcsFieldTypes по метаданным через
	 * api.partExpressionType, с раскрытыми составами определяемых типов (FT.expandedTypes) — модуль
	 * правок без зависимостей видит уже раскрытые types, и деньги вида «ДенежнаяСумма…» числовые.
	 * loading — хоть одно нужное описание ещё читается (запрос уже ушёл, ответ перерисует окно).
	 * batch — модель, по которой спрашивать (после правки — новая), по умолчанию текущая.
	 */
	function partTyping(ctx, batch) {
		const typing = { loading: false, typeOf: null };
		const source = batch || ctx.state.model;
		typing.typeOf = (_index, expr) => {
			const result = api.partExpressionType(source, ctx.address(), expr, ctx.state.outerTemp);
			if (result.loading) {
				typing.loading = true;
			}
			if (!result.type) {
				return null;
			}
			const expanded = FT.expandedTypes(result.type);
			// Длина своей строки нужна предупреждению о неограниченной строке в группировке, а раскрытие
			// составов квалификаторов не несёт
			if (result.type.stringQualifiers && Array.isArray(result.type.types) && result.type.types.indexOf('xs:string') >= 0) {
				expanded.stringQualifiers = result.type.stringQualifiers;
			}
			return expanded;
		};
		return typing;
	}

	/**
	 * Правка групповых со строкой заметок: если после неё появилось групповое поле, по которому платформа
	 * не группирует (QE.groupTypeWarnings), читалка объявит это сразу, а не только плашкой.
	 */
	function freshGroupWarnings(ctx, model) {
		const before = new Set(QE.groupTypeWarnings(ctx.part(), partTyping(ctx).typeOf));
		return QE.groupTypeWarnings(QE.partAt(model, ctx.address()), partTyping(ctx, model).typeOf).filter((line) => !before.has(line));
	}

	/** Почему «>>» не взяла поле — по спискам: подпись причины для заметки. */
	const SKIP_REASONS = Object.freeze({
		numeric: 'числовой тип, такие поля суммируют',
		nonNumeric: 'тип не числовой, сумма по нему не считается',
		constant: 'без полей таблиц: константа, параметр или NULL',
	});

	/** Заметка о пропущенных полях списка target, по причинам: «Т.Курс» (числовой тип…); «0» (без полей таблиц…). */
	function skippedNote(part, found, target) {
		const byReason = new Map();
		for (const item of found.skipped) {
			if (item.target !== target || !part.fields[item.index]) {
				continue;
			}
			if (!byReason.has(item.reason)) {
				byReason.set(item.reason, []);
			}
			byReason.get(item.reason).push('«' + oneLine(part.fields[item.index].expr) + '»');
		}
		return [...byReason].map(([reason, names]) => names.join(', ') + ' (' + (SKIP_REASONS[reason] || reason) + ')').join('; ');
	}

	const TYPES_LOADING = 'Типы полей ещё читаются из метаданных. Нажмите «>>» ещё раз через мгновение.';

	/**
	 * «>>» групповых и суммируемых: кандидаты и деление по типу — QE.groupingCandidates, правка —
	 * apply для каждого взятого поля. Пока нужные описания читаются, ничего не меняется: деление по
	 * недочитанному типу отправило бы число в групповые. Пропущенные поля перечисляет заметка.
	 */
	function allByType(ctx, target, apply) {
		const part = ctx.part();
		const typing = partTyping(ctx);
		const found = QE.groupingCandidates(part, typing.typeOf);
		if (typing.loading) {
			ctx.note(TYPES_LOADING);
			return;
		}
		const skipped = skippedNote(part, found, target);
		if (found[target].length === 0) {
			ctx.note(skipped ? 'Полей с подходящим типом нет: ' + skipped + '.' : 'Полей выборки вне групповых и суммируемых нет.');
			return;
		}
		let model = ctx.state.model;
		for (const index of found[target]) {
			const result = apply(model, index, part.fields[index]);
			if (!result.error) {
				model = result.model;
			}
		}
		const lead = target === 'groups' ? 'Не добавлены в групповые: ' : 'Не добавлены в суммируемые: ';
		const warnings = skipped ? [lead + skipped + '.'] : [];
		ctx.commit({ model: model, warnings: target === 'groups' ? warnings.concat(freshGroupWarnings(ctx, model)) : warnings });
	}

	/** «>>» групповых: поля выборки вне списков, кроме известных числовых, констант и параметров. */
	function allToGroups(ctx) {
		allByType(ctx, 'groups', (model, _index, field) => QE.addGroupField(model, ctx.address(), field.expr));
	}

	/** «>>» суммируемых: поля выборки вне списков, кроме известных нечисловых, — с функцией Сумма (её меняют в строке). */
	function allToSums(ctx) {
		allByType(ctx, 'sums', (model, index) => QE.setFieldAggregate(model, ctx.address(), index, 'sum'));
	}

	/**
	 * Правка суммируемых с предупреждением в строке заметок: если после неё появилась сумма или
	 * среднее нечислового поля (QE.aggregateTypeWarnings), читалка объявит это сразу, а не только
	 * плашкой вкладки. Одиночный «>» ставит Сумму, как по умолчанию у платформы; предупреждение ОК не
	 * блокирует.
	 */
	function commitSummed(ctx, result) {
		if (result && !result.error) {
			const before = new Set(QE.aggregateTypeWarnings(ctx.part(), partTyping(ctx).typeOf));
			const after = QE.aggregateTypeWarnings(QE.partAt(result.model, ctx.address()), partTyping(ctx, result.model).typeOf);
			const fresh = after.filter((line) => !before.has(line));
			if (fresh.length > 0) {
				return ctx.commit(Object.assign({}, result, { warnings: (Array.isArray(result.warnings) ? result.warnings : []).concat(fresh) }));
			}
		}
		return ctx.commit(result);
	}

	function toSums(ctx, item) {
		if (item && item.kind === 'select') {
			const result = QE.setFieldAggregate(ctx.state.model, ctx.address(), item.index, 'sum');
			if (!commitSummed(ctx, result)) {
				ctx.state.grouping.sumSel = item.index;
				ctx.rerender();
			}
			return;
		}
		const expr = groupingExprOf(item);
		if (!expr) {
			ctx.note('Выберите в дереве поле запроса или поле таблицы.');
			return;
		}
		const result = QE.addSummedField(ctx.state.model, ctx.address(), expr, 'sum');
		if (!commitSummed(ctx, result)) {
			ctx.state.grouping.sumSel = result.index;
			ctx.rerender();
		}
	}

	function sameExpr(left, right) {
		return Q.canonTokens(left).join(' ') === Q.canonTokens(right).join(' ');
	}

	/**
	 * Групповое поле, брошенное мышью в суммируемые: одной операции нет — цепочка из двух готовых. Сумма
	 * по выражению группы, как «>» суммируемых (QE.addSummedField; поле выборки с тем же выражением получает функцию и
	 * само уходит из групповых), и, если выражение осталось в групповых, — «<» групповых (QE.removeGroupField).
	 */
	function groupToSums(ctx, groupIndex) {
		const item = QE.groupingOf(ctx.part()).groups[groupIndex];
		if (!item) {
			ctx.note('Выберите групповое поле.');
			return;
		}
		let result = QE.addSummedField(ctx.state.model, ctx.address(), item.text, 'sum');
		if (result && !result.error) {
			const left = QE.groupingOf(QE.partAt(result.model, ctx.address())).groups.find((group) => sameExpr(group.text, item.text));
			const removed = left ? QE.removeGroupField(result.model, ctx.address(), left.index) : null;
			if (removed && !removed.error) {
				result = Object.assign({}, result, { model: removed.model });
			}
		}
		if (!commitSummed(ctx, result)) {
			ctx.state.grouping.sumSel = result.index;
			ctx.rerender();
		}
	}

	/**
	 * Суммируемое поле, брошенное мышью в групповые: цепочка из двух готовых операций — снять функцию, как
	 * «<» суммируемых (QE.setFieldAggregate с null), и добавить поле в групповые, как «>» групповых (QE.addGroupField).
	 */
	function sumToGroups(ctx, fieldIndex) {
		const item = QE.groupingOf(ctx.part()).sums.find((sum) => sum.field === fieldIndex);
		if (!item) {
			ctx.note('Выберите суммируемое поле.');
			return;
		}
		const plain = QE.setFieldAggregate(ctx.state.model, ctx.address(), fieldIndex, null);
		if (!plain || plain.error) {
			ctx.commit(plain);
			return;
		}
		let result = QE.addGroupField(plain.model, ctx.address(), item.arg);
		const fresh = result && !result.error ? freshGroupWarnings(ctx, result.model) : [];
		if (fresh.length > 0) {
			result = Object.assign({}, result, { warnings: (Array.isArray(result.warnings) ? result.warnings : []).concat(fresh) });
		}
		if (!ctx.commit(result)) {
			ctx.state.grouping.groupSel = result.index;
			ctx.rerender();
		}
	}

	function renderGroupingTab(container, ctx) {
		const st = ctx.state.grouping;
		const part = ctx.part();
		const grouping = QE.groupingOf(part);
		if (grouping.sets) {
			container.appendChild(el('div', 'dcs-plate', 'Группировка по группирующим наборам правится только текстом (кнопка «Запрос…»).'));
			return;
		}
		const tree = groupingTreeRows(ctx, grouping);
		const layout = el('div', 'dcs-qd-split');
		const left = column(layout, 'Поля');
		treeView(left, {
			id: 'gtree',
			label: 'Поля для группировки',
			rows: tree.rows,
			selected: st.selected,
			keys: ctx.keys,
			empty: 'Полей нет: добавьте таблицы и поля на вкладке «Таблицы и поля».',
			onSelect: (key, focus) => choose(ctx, st, 'selected', 'gtree', key, focus),
			onToggle: (key, value) => {
				if (key === 'q') {
					flipExpanded(st.collapsed, key, !value);
				} else {
					flipExpanded(st.expanded, key, value);
				}
				choose(ctx, st, 'selected', 'gtree', key, true);
			},
			onActivate: (key) => toGroups(ctx, tree.info.get(key)),
			// Перенос мышью: поле — в групповые и суммируемые (как «>»); из списков обратно — убрать (как «<»)
			drag: (key) => {
				const item = tree.info.get(key);
				return item && (item.kind === 'select' || item.kind === 'field') ? item.kind : '';
			},
			drop: {
				from: {
					groups: (payload) => ctx.commit(QE.removeGroupField(ctx.state.model, ctx.address(), Number(payload.key))),
					sums: (payload) => unsum(Number(payload.key)),
				},
				place: 'zone',
			},
		});
		const right = el('div', 'dcs-qd-stack');
		const groupsPair = el('div', 'dcs-qd-pair');
		moves(groupsPair, [
			{ label: '>', title: 'Добавить выбранное поле в групповые', onClick: () => toGroups(ctx, tree.info.get(st.selected)) },
			{ label: '>>', title: 'Добавить в групповые все поля выборки вне списков, кроме числовых', onClick: () => allToGroups(ctx) },
			{
				label: '<',
				title: 'Убрать выбранное групповое поле',
				onClick: () => {
					if (!grouping.groups[st.groupSel]) {
						ctx.note('Выберите групповое поле.');
						return;
					}
					ctx.commit(QE.removeGroupField(ctx.state.model, ctx.address(), st.groupSel));
				},
			},
			{ label: '<<', title: 'Убрать все групповые поля', onClick: () => ctx.commit(QE.removeAllGroupFields(ctx.state.model, ctx.address())) },
		], ctx.keys);
		const groupsCol = column(groupsPair, 'Групповые поля');
		treeView(groupsCol, {
			id: 'groups',
			role: 'listbox',
			label: 'Групповые поля',
			rows: grouping.groups.map((item) => ({ key: String(item.index), level: 0, label: oneLine(item.text) })),
			selected: st.groupSel >= 0 ? String(st.groupSel) : '',
			keys: ctx.keys,
			empty: 'Групповых полей нет.',
			onSelect: (key, focus) => choose(ctx, st, 'groupSel', 'groups', Number(key), focus),
			onToggle: () => undefined,
			onActivate: () => undefined,
			onDelete: (key) => ctx.commit(QE.removeGroupField(ctx.state.model, ctx.address(), Number(key))),
			drag: () => 'group',
			drop: {
				from: {
					gtree: (payload) => toGroups(ctx, tree.info.get(payload.key)),
					sums: (payload) => sumToGroups(ctx, Number(payload.key)),
				},
				place: 'zone',
				effect: (payload) => (payload.zone === 'gtree' ? 'copy' : 'move'),
			},
		});
		right.appendChild(groupsPair);
		const sumsPair = el('div', 'dcs-qd-pair');
		const unsum = (index) => ctx.commit(QE.setFieldAggregate(ctx.state.model, ctx.address(), index, null));
		moves(sumsPair, [
			{ label: '>', title: 'Добавить выбранное поле в суммируемые (функция Сумма)', onClick: () => toSums(ctx, tree.info.get(st.selected)) },
			{ label: '>>', title: 'Добавить в суммируемые все поля выборки вне списков, кроме нечисловых (функция Сумма)', onClick: () => allToSums(ctx) },
			{
				label: '<',
				title: 'Снять агрегатную функцию с выбранного суммируемого поля',
				onClick: () => {
					const item = grouping.sums.find((sum) => sum.field === st.sumSel);
					if (!item) {
						ctx.note('Выберите суммируемое поле.');
						return;
					}
					unsum(item.field);
				},
			},
			{
				label: '<<',
				title: 'Снять агрегатные функции со всех суммируемых полей',
				onClick: () => {
					let model = ctx.state.model;
					for (const item of grouping.sums) {
						const result = item.custom ? { error: 'выражение' } : QE.setFieldAggregate(model, ctx.address(), item.field, null);
						if (!result.error) {
							model = result.model;
						}
					}
					ctx.commit({ model: model });
				},
			},
		], ctx.keys);
		const sumsCol = column(sumsPair, 'Суммируемые поля');
		const functions = QE.AGGREGATE_FUNCTIONS.map((fn) => ({ value: fn.id, label: fn.label }));
		gridView(sumsCol, {
			id: 'sums',
			label: 'Суммируемые поля',
			className: 'dcs-qd-grid-sums',
			columns: ['Суммируемое поле', 'Функция'],
			rows: grouping.sums.map((item) => ({
				key: String(item.field),
				cells: [
					oneLine(item.arg),
					item.custom
						? el('span', 'dcs-qd-cell-text', 'выражение')
						: gridSelect(ctx, functions, item.fn, 'Функция поля ' + oneLine(item.arg), 'sum:' + item.field + ':fn', (value) => {
								st.sumSel = item.field;
								commitSummed(ctx, QE.setFieldAggregate(ctx.state.model, ctx.address(), item.field, value));
						  }),
				],
				title: item.custom ? 'Агрегатная функция внутри выражения: правится выражением поля на вкладке «Таблицы и поля»' : '',
			})),
			selected: st.sumSel >= 0 ? String(st.sumSel) : '',
			keys: ctx.keys,
			empty: 'Суммируемых полей нет.',
			onSelect: (key, focus) => choose(ctx, st, 'sumSel', 'sums', Number(key), focus),
			onDelete: (key) => unsum(Number(key)),
			drag: () => 'sum',
			drop: {
				from: {
					gtree: (payload) => toSums(ctx, tree.info.get(payload.key)),
					groups: (payload) => groupToSums(ctx, Number(payload.key)),
				},
				place: 'zone',
				effect: (payload) => (payload.zone === 'gtree' ? 'copy' : 'move'),
			},
		});
		right.appendChild(sumsPair);
		layout.appendChild(right);
		container.appendChild(layout);
		// Сумма и среднее нечислового поля — рядом с полями вне списков; типы читаются по метаданным,
		// недочитанное придёт ответом и перерисует вкладку
		const typeOf = partTyping(ctx).typeOf;
		const warnings = QE.groupingWarnings(part).concat(QE.groupTypeWarnings(part, typeOf), QE.aggregateTypeWarnings(part, typeOf));
		if (warnings.length > 0) {
			const plate = el('div', 'dcs-plate dcs-qd-warnings');
			for (const line of warnings) {
				plate.appendChild(el('div', '', line));
			}
			container.appendChild(plate);
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Условия»
	// ---------------------------------------------------------------------------------------------

	function conditionsSelectRow(ctx, result) {
		const placed = result && Array.isArray(result.placed) ? result.placed[result.placed.length - 1] : null;
		if (placed) {
			ctx.state.conditions.selected = placed.target + ':' + placed.index;
		}
	}

	/** «>» и двойной щелчок по полю: простое условие «поле = &Поле» (имя параметра — имя поля). */
	function addFieldCondition(ctx, item) {
		if (!item || item.kind !== 'field') {
			ctx.note('Выберите поле таблицы в дереве.');
			return;
		}
		const field = item.alias + '.' + item.path;
		const result = QE.addCondition(ctx.state.model, ctx.address(), { field: field, kind: '=', param: QE.defaultParamName(field) });
		if (!ctx.commit(result)) {
			conditionsSelectRow(ctx, result);
			ctx.rerender();
		}
	}

	function addCustomCondition(ctx) {
		const address = ctx.address();
		openExpressionWindow(ctx, {
			title: 'Новое условие',
			value: '',
			apply: (value) => {
				const result = QE.addCondition(ctx.state.model, address, { text: value });
				const error = ctx.commit(result);
				if (!error) {
					conditionsSelectRow(ctx, result);
					ctx.rerender();
				}
				return error;
			},
		});
	}

	function selectedCondition(ctx, rows) {
		return rows.find((row) => row.key === ctx.state.conditions.selected) || null;
	}

	function copyConditionRow(ctx, rows) {
		const row = selectedCondition(ctx, rows);
		if (!row) {
			ctx.note('Выберите условие в списке.');
			return;
		}
		const result = QE.addCondition(ctx.state.model, ctx.address(), { text: row.text });
		if (!ctx.commit(result)) {
			conditionsSelectRow(ctx, result);
			ctx.rerender();
		}
	}

	function removeConditionRow(ctx, rows) {
		const row = selectedCondition(ctx, rows);
		if (!row) {
			ctx.note('Выберите условие в списке.');
			return;
		}
		const result = QE.removeCondition(ctx.state.model, ctx.address(), { target: row.target, index: row.index });
		if (!result.error) {
			ctx.state.conditions.custom.clear();
			ctx.state.conditions.selected = '';
		}
		ctx.commit(result);
	}

	const LEADING_PATH_RE = /^([\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)+)/u;

	/**
	 * «Произвольное» условия: включено — текстом (окно выражения); снято — простое. Текст, который
	 * не сводится к простому, становится «первое поле текста = &Поле»; поля в начале нет — остаётся текстом.
	 */
	function toggleCustomCondition(ctx, row, value) {
		const st = ctx.state.conditions;
		st.selected = row.key;
		if (value) {
			st.custom.add(row.key);
			ctx.rerender();
			return;
		}
		st.custom.delete(row.key);
		if (row.simple) {
			ctx.rerender();
			return;
		}
		const match = LEADING_PATH_RE.exec(QE.stripParens(row.text));
		if (!match) {
			st.custom.add(row.key);
			ctx.note('Условие не начинается с поля и не сводится к виду «поле · сравнение · параметр», поэтому оно оставлено произвольным.');
			return;
		}
		const result = QE.setCondition(ctx.state.model, ctx.address(), { target: row.target, index: row.index }, { field: match[1], kind: '=', param: QE.defaultParamName(match[1]) });
		if (!ctx.commit(result)) {
			conditionsSelectRow(ctx, result);
			ctx.rerender();
		}
	}

	/** Счётчик id поля простого условия (aria-describedby вида сравнения и параметра). */
	let condFieldCount = 0;

	function conditionRowCells(ctx, row, index) {
		const st = ctx.state.conditions;
		const address = ctx.address();
		const ref = { target: row.target, index: row.index };
		const custom = st.custom.has(row.key) || !row.simple;
		const number = el('span', '', String(index + 1));
		const cells = [number];
		if (row.target === 'having') {
			number.appendChild(el('span', 'dcs-tree-badge', 'ИМЕЮЩИЕ'));
		}
		cells.push(gridCheck(ctx, custom, 'Произвольное условие', 'cd:' + row.key + ':custom', (value) => toggleCustomCondition(ctx, row, value)));
		const write = (spec) => {
			st.selected = row.key;
			const result = QE.setCondition(ctx.state.model, address, ref, spec);
			if (!ctx.commit(result)) {
				conditionsSelectRow(ctx, result);
				ctx.rerender();
			}
		};
		if (custom) {
			cells.push(
				expressionCell(ctx, row.text, 'Изменить условие в окне выражения', 'cd:' + row.key + ':expr', () => {
					openExpressionWindow(ctx, {
						title: 'Условие',
						value: row.text,
						apply: (value) => {
							st.selected = row.key;
							const result = QE.setCondition(ctx.state.model, address, ref, { text: value });
							const error = ctx.commit(result);
							if (!error) {
								conditionsSelectRow(ctx, result);
								ctx.rerender();
							}
							return error;
						},
					});
				})
			);
			return cells;
		}
		const simple = row.simple;
		/*
		 * Простое условие читается, как произвольное: «поле · вид сравнения · &параметр». Поле — по ширине
		 * текста, список вида — по своей ширине, параметр занимает остаток;
		 * если строки мало, параметр переносится вниз, а не уходит за край с горизонтальной прокруткой.
		 */
		const box = el('div', 'dcs-qd-cell-simple dcs-qd-cond-simple');
		const field = el('span', 'dcs-qd-cell-text dcs-qd-cond-field', simple.field);
		field.title = simple.field;
		// Поле — текст без фокуса: читалка слышит его описанием вида сравнения и параметра (подписи не
		// меняются). id свои на каждую отрисовку: окна конструктора бывают вложенными
		field.id = 'dcsQdCondField' + ++condFieldCount;
		box.appendChild(field);
		const kind = gridSelect(ctx, QE.COMPARISONS.map((item) => ({ value: item.id, label: item.label })), simple.kind, 'Вид сравнения', 'cd:' + row.key + ':kind', (value) =>
			write({ field: simple.field, kind: value, param: simple.param }),
			true
		);
		kind.setAttribute('aria-describedby', field.id);
		box.appendChild(kind);
		const valueBox = el('span', 'dcs-qd-cond-value');
		const amp = el('span', 'dcs-qd-cell-amp', '&');
		amp.setAttribute('aria-hidden', 'true');
		valueBox.appendChild(amp);
		const param = api.textInput(simple.param);
		param.classList.add('dcs-qd-cell-input');
		param.setAttribute('aria-label', 'Имя параметра');
		param.setAttribute('aria-describedby', field.id);
		ctx.keys.set(param, 'cd:' + row.key + ':param');
		// Правка имени пишется по change (уход с поля или Enter): перерисовка на каждый символ сбивала бы ввод
		param.addEventListener('change', () => {
			if (param.value.trim() !== simple.param) {
				write({ field: simple.field, kind: simple.kind, param: param.value.trim() });
			}
		});
		valueBox.appendChild(param);
		box.appendChild(valueBox);
		cells.push(box);
		return cells;
	}

	function renderConditionsTab(container, ctx) {
		const st = ctx.state.conditions;
		const rows = QE.conditionRows(ctx.part());
		const layout = el('div', 'dcs-qd-split dcs-qd-split-moves');
		const left = column(layout, 'Поля');
		const tree = sourceFieldRows(ctx, st.expanded, 'c', 0);
		treeView(left, {
			id: 'ctree',
			label: 'Поля для условий',
			rows: tree.rows,
			selected: st.field,
			keys: ctx.keys,
			empty: 'Таблиц нет: добавьте их на вкладке «Таблицы и поля».',
			onSelect: (key, focus) => choose(ctx, st, 'field', 'ctree', key, focus),
			onToggle: (key, value) => {
				flipExpanded(st.expanded, key, value);
				choose(ctx, st, 'field', 'ctree', key, true);
			},
			onActivate: (key) => {
				const item = tree.info.get(key);
				if (item && item.kind === 'source') {
					flipExpanded(st.expanded, key, !st.expanded.has(key));
					ctx.rerender();
					return;
				}
				addFieldCondition(ctx, item);
			},
			// Перенос мышью: поле — в условия (как «>»); условие обратно — удалить (как «Удалить выбранное условие»)
			drag: (key) => {
				const item = tree.info.get(key);
				return item && item.kind === 'field' ? 'field' : '';
			},
			drop: {
				from: {
					conds: (payload) => {
						st.selected = payload.key;
						removeConditionRow(ctx, rows);
					},
				},
				place: 'zone',
			},
		});
		moves(layout, [{ label: '>', title: 'Добавить условие «поле = &параметр» по выбранному полю', onClick: () => addFieldCondition(ctx, tree.info.get(st.field)) }], ctx.keys);
		const right = column(layout, 'Условия');
		const toolbar = el('div', 'dcs-qd-toolbar');
		toolbar.appendChild(iconButton('add', 'Добавить условие…', () => addCustomCondition(ctx), ctx.keys, { note: 'Произвольное условие в окне выражения' }));
		toolbar.appendChild(iconButton('add-copy', 'Скопировать выбранное условие', () => copyConditionRow(ctx, rows), ctx.keys));
		toolbar.appendChild(iconButton('delete', 'Удалить выбранное условие', () => removeConditionRow(ctx, rows), ctx.keys));
		right.appendChild(toolbar);
		gridView(right, {
			id: 'conds',
			label: 'Условия',
			className: 'dcs-qd-grid-conds',
			columns: ['№', 'Произвольное', 'Условие'],
			rows: rows.map((row, index) => ({ key: row.key, cells: conditionRowCells(ctx, row, index), title: row.target === 'having' ? QE.HAVING_NOTE : '' })),
			selected: st.selected,
			keys: ctx.keys,
			empty: 'Условий нет: перенесите поле («>») или добавьте произвольное условие.',
			onSelect: (key, focus) => choose(ctx, st, 'selected', 'conds', key, focus),
			onDelete: (key) => {
				st.selected = key;
				removeConditionRow(ctx, rows);
			},
			drag: () => 'condition',
			drop: {
				from: { ctree: (payload) => addFieldCondition(ctx, tree.info.get(payload.key)) },
				place: 'zone',
				effect: 'copy',
			},
		});
		container.appendChild(layout);
	}

	// ---------------------------------------------------------------------------------------------
	// Общее вкладок «Дополнительно», «Индекс», «Объединения/Псевдонимы», «Порядок», «Пакет
	// запросов», «Компоновка данных»
	// ---------------------------------------------------------------------------------------------

	/** Группа элементов вкладки с заголовком (как группы в окнах редактора). */
	function group(host, title) {
		const box = el('div', 'dcs-qd-group');
		box.setAttribute('role', 'group');
		box.setAttribute('aria-label', title);
		box.appendChild(el('div', 'dcs-form-group', title));
		host.appendChild(box);
		return box;
	}

	/** Флажок с подписью и ключом фокуса: вкладка перерисовывается после каждой правки. */
	function flag(ctx, label, checked, key, onChange) {
		const box = api.checkbox(label, checked);
		ctx.keys.set(box.input, key);
		box.input.addEventListener('change', () => onChange(Boolean(box.input.checked)));
		return box;
	}

	/** Поле ввода в ячейке сетки, правка пишется по change (ввод по символу не перерисовывает окно). */
	function cellInput(ctx, value, label, key, onChange, placeholder) {
		const input = api.textInput(value || '');
		input.classList.add('dcs-qd-cell-input');
		input.setAttribute('aria-label', label);
		if (placeholder) {
			input.placeholder = placeholder;
		}
		ctx.keys.set(input, key);
		input.addEventListener('change', () => onChange(input.value.trim()));
		return input;
	}

	function numberField(value, label) {
		const input = el('input', 'edit-input dcs-input-number dcs-qd-cell-input');
		input.type = 'number';
		input.min = '1';
		input.step = '1';
		input.value = value === null || value === undefined ? '' : String(value);
		input.setAttribute('aria-label', label);
		return input;
	}

	function warningsPlate(host, lines) {
		if (lines.length === 0) {
			return;
		}
		const plate = el('div', 'dcs-plate dcs-qd-warnings');
		for (const line of lines) {
			plate.appendChild(el('div', '', line));
		}
		host.appendChild(plate);
	}

	/** Выбор запроса пакета (список «Пакета запросов» и вертикальные вкладки справа — одно состояние). */
	function selectStatement(ctx, index, focus) {
		const state = ctx.state;
		state.statement = index;
		state.part = 0;
		resetSelection(state);
		state.focus = focus || '';
		ctx.rerender();
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Дополнительно»
	// ---------------------------------------------------------------------------------------------

	/** Число «Первые» при включении флажка без числа. */
	const DEFAULT_TOP = 1;

	function renderAdvancedTab(container, ctx) {
		const state = ctx.state;
		const index = state.statement;
		const current = state.model.statements[index];
		const kind = QE.statementKind(current);
		const root = el('div', 'dcs-qd-advanced');
		if (kind !== 'drop') {
			const part = ctx.part();
			const first = ctx.statement().parts[0];
			const union = ctx.statement().parts.length > 1;
			const records = group(root, union ? 'Выборка записей (часть «Запрос ' + (state.part + 1) + '»)' : 'Выборка записей');
			const hasTop = part.top !== null && part.top !== undefined && part.top !== '';
			const row = el('div', 'dcs-check-row');
			const topNumber = numberField(hasTop ? part.top : '', 'Число первых записей');
			ctx.keys.set(topNumber, 'adv-top-n');
			topNumber.disabled = !hasTop;
			const topFlag = flag(ctx, 'Первые', hasTop, 'adv-top', (value) => {
				ctx.commit(QE.setPartFlags(state.model, ctx.address(), { top: value ? topNumber.value.trim() || DEFAULT_TOP : null }));
			});
			topNumber.addEventListener('change', () => {
				ctx.commit(QE.setPartFlags(state.model, ctx.address(), { top: topNumber.value.trim() || null }));
			});
			const topBox = el('span', 'dcs-qd-inline');
			topBox.appendChild(topFlag.wrap);
			topBox.appendChild(topNumber);
			row.appendChild(topBox);
			row.appendChild(flag(ctx, 'Без повторяющихся', part.distinct, 'adv-distinct', (value) => ctx.commit(QE.setPartFlags(state.model, ctx.address(), { distinct: value }))).wrap);
			const allowed = flag(ctx, 'Разрешенные', first.allowed, 'adv-allowed', (value) => ctx.commit(QE.setPartFlags(state.model, ctx.address(), { allowed: value })));
			if (union) {
				allowed.wrap.title = 'В объединении относится ко всему запросу и пишется у первой части';
			}
			row.appendChild(allowed.wrap);
			records.appendChild(row);
		}
		if (!ctx.nested) {
			const typeGroup = group(root, 'Тип запроса');
			const options = QE.QUERY_KINDS.map((item) => ({ value: item.id, label: item.label }));
			const select = api.selectInput(options, kind);
			select.setAttribute('aria-label', 'Тип запроса');
			if (kind === 'add') {
				// Ограничение версии — в подсказке списка
				hint(select, 'Добавление во временную таблицу (ДОБАВИТЬ) есть с версии 8.3.25, колонки должны совпадать с созданной таблицей');
			}
			ctx.keys.set(select, 'adv-kind');
			select.addEventListener('change', () => {
				const result = QE.setStatementKind(state.model, index, { kind: select.value, restore: state.stash.get(index) });
				if (!result.error) {
					if (result.stash) {
						state.stash.set(index, result.stash);
					} else {
						state.stash.delete(index);
					}
				}
				state.focus = 'adv-kind';
				ctx.commit(result);
			});
			typeGroup.appendChild(select);
			const name = api.textInput(QE.tempTableOf(current));
			name.setAttribute('aria-label', 'Имя временной таблицы');
			name.disabled = kind === 'select';
			if (kind === 'create') {
				hint(name, 'Новое имя переименует таблицу и в следующих запросах пакета, которые к ней обращаются');
			} else if (kind === 'add' || kind === 'drop') {
				// Имя набирается вручную, а вкладки с веткой ВТ у уничтожения нет: какие таблицы есть — в
				// подсказке поля; таблицу, которой до этого запроса нет, называет предупреждение правки
				const known = Q.tempTables(state.model, index).map((table) => table.name);
				hint(name, known.length > 0 ? 'Таблицы пакета до этого запроса: ' + known.join(', ') : 'До этого запроса временных таблиц нет');
			}
			ctx.keys.set(name, 'adv-name');
			name.addEventListener('change', () => {
				const value = name.value.trim();
				if (value !== QE.tempTableOf(current)) {
					ctx.commit(QE.renameTempTable(state.model, index, value));
				}
			});
			api.formRow(typeGroup, 'Имя временной таблицы', name);
		}
		if (kind !== 'drop') {
			const lock = group(root, 'Блокировать получаемые данные для последующего изменения');
			const forUpdate = QE.forUpdateOf(ctx.statement());
			// Флажок недоступен и фокуса не получает: что он только показывает текст — в подписи (видно и без
			// мыши), почему — в подсказке, а не строкой под ним
			const box = api.checkbox('Блокировать (только просмотр)', Boolean(forUpdate));
			box.input.disabled = true;
			box.wrap.title = 'Только просмотр: в схеме компоновки блокировка смысла не имеет, правится текстом («Запрос…»)';
			box.input.setAttribute('aria-description', box.wrap.title);
			lock.appendChild(box.wrap);
			if (forUpdate) {
				lock.appendChild(el('div', 'dcs-qd-cell-text', forUpdate.tables.length > 0 ? 'ДЛЯ ИЗМЕНЕНИЯ: ' + forUpdate.tables.join(', ') : 'ДЛЯ ИЗМЕНЕНИЯ: все таблицы'));
			}
		}
		container.appendChild(root);
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Индекс»
	// ---------------------------------------------------------------------------------------------

	function renderIndexTab(container, ctx) {
		const st = ctx.state.index;
		const index = ctx.state.statement;
		const statement = ctx.statement();
		const indexes = statement.indexes || [];
		st.selected = indexes.length === 0 ? -1 : Math.max(0, Math.min(st.selected, indexes.length - 1));
		const current = st.selected >= 0 ? indexes[st.selected] : null;
		const fields = current ? current.fields || [] : [];
		const layout = el('div', 'dcs-qd-index');
		const listCol = column(layout, 'Индексы');
		const toolbar = el('div', 'dcs-qd-toolbar');
		toolbar.appendChild(
			iconButton('add', 'Добавить индекс', () => {
				const result = QE.addIndex(ctx.state.model, index);
				if (!result.error) {
					st.selected = result.index;
					st.field = -1;
				}
				ctx.commit(result);
			}, ctx.keys)
		);
		const removeIndex = () => {
			if (!current) {
				ctx.note('Выберите индекс.');
				return;
			}
			const result = QE.removeIndex(ctx.state.model, index, st.selected);
			st.field = -1;
			ctx.commit(result);
		};
		// Порядок, как на остальных панелях: добавить, скопировать, удалить, стрелки
		toolbar.appendChild(
			iconButton('add-copy', 'Добавить копию выбранного индекса', () => {
				if (!current) {
					ctx.note('Выберите индекс.');
					return;
				}
				const result = QE.copyIndex(ctx.state.model, index, st.selected);
				if (!result.error) {
					st.selected = result.index;
					st.field = -1;
				}
				ctx.commit(result);
			}, ctx.keys)
		);
		toolbar.appendChild(iconButton('delete', 'Удалить выбранный индекс', removeIndex, ctx.keys));
		const moveIndex = (delta) => {
			if (!current) {
				ctx.note('Выберите индекс.');
				return;
			}
			const result = QE.moveIndex(ctx.state.model, index, st.selected, delta);
			if (!result.error) {
				st.selected = result.index;
			}
			ctx.commit(result);
		};
		toolbar.appendChild(iconButton('up', 'Переместить индекс выше', () => moveIndex(-1), ctx.keys));
		toolbar.appendChild(iconButton('down', 'Переместить индекс ниже', () => moveIndex(1), ctx.keys));
		listCol.appendChild(toolbar);
		const indexGrid = gridView(listCol, {
			id: 'idx',
			label: 'Индексы',
			className: 'dcs-qd-grid-index',
			columns: ['Индекс', 'Уникальность'],
			rows: indexes.map((item, k) => ({
				key: String(k),
				cells: [
					'Индекс ' + (k + 1),
					gridCheck(ctx, item.unique, 'Уникальность индекса ' + (k + 1), 'idx:' + k + ':unique', (value) => {
						st.selected = k;
						ctx.commit(QE.setIndexUnique(ctx.state.model, index, k, value));
					}),
				],
			})),
			selected: String(st.selected),
			keys: ctx.keys,
			empty: 'Индексов нет: кнопка «Добавить индекс» над списком создаст индекс временной таблицы.',
			onSelect: (key, focus) => {
				st.field = -1;
				choose(ctx, st, 'selected', 'idx', Number(key), focus);
			},
			onDelete: (key) => {
				st.selected = Number(key);
				removeIndex();
			},
			// Перенос мышью: перестановка индексов — та же правка, что у ↑ ↓, сразу на нужное место; колонка из «Полей
			// таблицы», брошенная на строку индекса, — в его поля, как щелчок по индексу и «>»
			drag: () => 'index',
			drop: {
				from: {
					idxa: (payload, target) => {
						const k = dropRow(target);
						if (k < 0 || !indexes[k]) {
							return false;
						}
						if (k !== st.selected) {
							st.field = -1;
						}
						st.selected = k;
						addField(payload.key);
					},
					idx: (payload, target) => {
						const from = Number(payload.key);
						const delta = dropDelta(ctx, 'idx', indexes.length, from, target);
						if (delta === 0) {
							return false;
						}
						// Другой индекс — как щелчок по его строке: выбор поля прежнего индекса не переходит к нему
						if (from !== st.selected) {
							st.field = -1;
						}
						st.selected = from;
						moveIndex(delta);
					},
				},
				place: (payload) => (payload.zone === 'idxa' ? 'into' : 'line'),
				effect: (payload) => (payload.zone === 'idxa' ? 'copy' : 'move'),
			},
		});
		// Ограничение версии — один раз у сетки, когда индексов несколько (у строк читалка повторяла бы его
		// на каждой стрелке, а флажок «Уникальность» брал бы себе)
		if (indexes.length > 1) {
			hint(indexGrid, 'Несколько индексов пишутся как ИНДЕКСИРОВАТЬ ПО НАБОРАМ, с версии 8.3.25');
		}
		const taken = new Set(fields.map((field) => upper(String(field).trim())));
		const available = QE.indexColumns(statement).filter((name) => !taken.has(upper(name)));
		const availCol = column(layout, 'Поля таблицы');
		/** «>» по колонке; at — место в полях индекса для колонки, брошенной мышью (QE.moveIndexField следом). */
		const addField = (name, at) => {
			if (!current) {
				ctx.note('Сначала добавьте индекс.');
				return;
			}
			if (!name) {
				ctx.note('Выберите поле таблицы.');
				return;
			}
			let result = QE.addIndexField(ctx.state.model, index, st.selected, name);
			if (!result.error && typeof at === 'number' && at !== result.index) {
				const moved = QE.moveIndexField(result.model, index, st.selected, result.index, at - result.index);
				if (!moved.error) {
					result = Object.assign({}, result, { model: moved.model, index: moved.index });
				}
			}
			if (!result.error) {
				st.field = result.index;
				st.avail = '';
			}
			ctx.commit(result);
		};
		const removeField = () => {
			if (!current || !fields[st.field]) {
				ctx.note('Выберите поле индекса.');
				return;
			}
			const result = QE.removeIndexField(ctx.state.model, index, st.selected, st.field);
			st.field = Math.min(st.field, fields.length - 2);
			ctx.commit(result);
		};
		treeView(availCol, {
			id: 'idxa',
			role: 'listbox',
			label: 'Поля таблицы',
			rows: current ? available.map((name) => ({ key: name, level: 0, label: name })) : [],
			selected: st.avail,
			keys: ctx.keys,
			empty: current ? 'Все колонки уже в индексе.' : 'Добавьте индекс.',
			onSelect: (key, focus) => choose(ctx, st, 'avail', 'idxa', key, focus),
			onToggle: () => undefined,
			onActivate: (key) => addField(key),
			// Перенос мышью: колонка — в поля индекса (как «>»); поле индекса обратно — убрать (как «<»)
			drag: () => 'column',
			drop: {
				from: {
					idxf: (payload) => {
						st.field = Number(payload.key);
						removeField();
					},
				},
				place: 'zone',
			},
		});
		/** Пакетные «>>» и «<<» — цепочка тех же одиночных правок: отказ одной не теряет остальные. */
		const addAll = () => {
			if (!current) {
				ctx.note('Сначала добавьте индекс.');
				return;
			}
			let model = ctx.state.model;
			for (const name of available) {
				const result = QE.addIndexField(model, index, st.selected, name);
				if (!result.error) {
					model = result.model;
				}
			}
			st.avail = '';
			ctx.commit({ model: model });
		};
		const removeAll = () => {
			if (!current || fields.length === 0) {
				ctx.note('В индексе нет полей.');
				return;
			}
			let model = ctx.state.model;
			for (let k = fields.length - 1; k >= 0; k--) {
				const result = QE.removeIndexField(model, index, st.selected, k);
				if (!result.error) {
					model = result.model;
				}
			}
			st.field = -1;
			ctx.commit({ model: model });
		};
		moves(layout, [
			{ label: '>', title: 'Добавить выбранное поле в индекс', onClick: () => addField(st.avail) },
			{ label: '>>', title: 'Добавить в индекс все колонки запроса', onClick: addAll },
			{ label: '<', title: 'Убрать выбранное поле из индекса', onClick: removeField },
			{ label: '<<', title: 'Убрать все поля из индекса', onClick: removeAll },
		], ctx.keys);
		const fieldsCol = column(layout, current ? 'Поля индекса ' + (st.selected + 1) : 'Поля индекса');
		const fieldBar = el('div', 'dcs-qd-toolbar');
		const moveField = (delta) => {
			if (!current || !fields[st.field]) {
				ctx.note('Выберите поле индекса.');
				return;
			}
			const result = QE.moveIndexField(ctx.state.model, index, st.selected, st.field, delta);
			st.field = result.index;
			ctx.commit(result);
		};
		fieldBar.appendChild(iconButton('up', 'Переместить поле индекса выше', () => moveField(-1), ctx.keys));
		fieldBar.appendChild(iconButton('down', 'Переместить поле индекса ниже', () => moveField(1), ctx.keys));
		fieldsCol.appendChild(fieldBar);
		treeView(fieldsCol, {
			id: 'idxf',
			role: 'listbox',
			label: 'Поля индекса',
			rows: fields.map((field, k) => ({ key: String(k), level: 0, label: oneLine(field) })),
			selected: st.field >= 0 ? String(st.field) : '',
			keys: ctx.keys,
			empty: current ? 'Полей нет: перенесите их («>»).' : 'Добавьте индекс.',
			onSelect: (key, focus) => choose(ctx, st, 'field', 'idxf', Number(key), focus),
			onToggle: () => undefined,
			onActivate: () => removeField(),
			onDelete: (key) => {
				st.field = Number(key);
				removeField();
			},
			// Колонка встаёт в место сброса; своё поле переставляется (как ↑ ↓)
			drag: () => 'index-field',
			drop: {
				from: {
					idxa: (payload, target) => addField(payload.key, dropAt(fields.length, target)),
					idxf: (payload, target) => {
						const from = Number(payload.key);
						const delta = dropDelta(ctx, 'idxf', fields.length, from, target);
						if (delta === 0) {
							return false;
						}
						st.field = from;
						moveField(delta);
					},
				},
				effect: (payload) => (payload.zone === 'idxa' ? 'copy' : 'move'),
			},
		});
		container.appendChild(layout);
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Объединения/Псевдонимы»
	// ---------------------------------------------------------------------------------------------

	/** Выбор части: список частей и вертикальные вкладки справа — одно состояние (state.part). */
	function selectPart(ctx, part, focus) {
		ctx.state.part = part;
		resetSelection(ctx.state);
		ctx.state.focus = focus || '';
		ctx.rerender();
	}

	function partOperation(ctx, result) {
		if (!result.error && typeof result.index === 'number') {
			ctx.state.part = result.index;
		}
		ctx.commit(result);
	}

	/**
	 * Ячейка «Имя поля»: явный псевдоним (КАК в первой части) платформа выделяет жирным. Одного шрифта
	 * мало — его не различить при плохом зрении и не услышать, поэтому ещё значок «КАК» (AS у английского
	 * текста) с пояснением и описание поля для читалки. Выведенное из пути имя остаётся без пометки.
	 */
	function aliasCell(ctx, column, input) {
		if (!column.explicit) {
			return input;
		}
		input.classList.add('dcs-qd-alias-explicit');
		input.setAttribute('aria-description', 'псевдоним задан явно');
		const cell = el('span', 'dcs-qd-cell-simple');
		cell.appendChild(input);
		const mark = el('span', 'dcs-qd-alias-mark', ctx.lang === 'en' ? 'AS' : 'КАК');
		mark.title = 'Псевдоним задан явно в тексте запроса';
		// Читалка слышит то же из описания поля: значок ей не нужен второй раз
		mark.setAttribute('aria-hidden', 'true');
		cell.appendChild(mark);
		return cell;
	}

	function renderUnionTab(container, ctx) {
		const st = ctx.state.union;
		const index = ctx.state.statement;
		const statement = ctx.statement();
		const rows = QE.unionRows(statement);
		const layout = el('div', 'dcs-qd-union');
		const left = column(layout, 'Части объединения');
		const toolbar = el('div', 'dcs-qd-toolbar');
		toolbar.appendChild(iconButton('add', 'Добавить часть объединения', () => partOperation(ctx, QE.addPart(ctx.state.model, index)), ctx.keys));
		toolbar.appendChild(iconButton('add-copy', 'Добавить копию выбранной части', () => partOperation(ctx, QE.copyPart(ctx.state.model, index, ctx.state.part)), ctx.keys));
		const removePart = () => partOperation(ctx, QE.removePart(ctx.state.model, index, ctx.state.part));
		toolbar.appendChild(iconButton('delete', 'Удалить выбранную часть объединения', removePart, ctx.keys));
		toolbar.appendChild(iconButton('up', 'Переместить часть выше', () => partOperation(ctx, QE.movePart(ctx.state.model, index, ctx.state.part, -1)), ctx.keys));
		toolbar.appendChild(iconButton('down', 'Переместить часть ниже', () => partOperation(ctx, QE.movePart(ctx.state.model, index, ctx.state.part, 1)), ctx.keys));
		left.appendChild(toolbar);
		gridView(left, {
			id: 'parts',
			label: 'Части объединения',
			className: 'dcs-qd-grid-parts',
			columns: ['Запрос', 'Без дублей'],
			rows: rows.parts.map((part) => ({
				key: String(part.index),
				cells: [
					part.label,
					part.index === 0
						? ''
						: hint(
								gridCheck(ctx, part.noDuplicates, 'Без дублей: ' + part.label, 'part:' + part.index + ':nodup', (value) => {
									ctx.state.part = part.index;
									ctx.commit(QE.setUnionDistinct(ctx.state.model, index, part.index, value));
								}),
								'ОБЪЕДИНИТЬ без ВСЕ перед этой частью: повторяющиеся строки убираются'
						  ),
				],
				title: part.index === 0 ? '' : part.noDuplicates ? 'ОБЪЕДИНИТЬ: без повторяющихся строк' : 'ОБЪЕДИНИТЬ ВСЕ',
			})),
			selected: String(ctx.state.part),
			keys: ctx.keys,
			empty: '',
			onSelect: (key, focus) => selectPart(ctx, Number(key), focus ? 'parts:' + key : ''),
			onDelete: (key) => {
				ctx.state.part = Number(key);
				removePart();
			},
			// Перенос мышью: перестановка частей — та же правка, что у ↑ ↓ (QE.movePart), сразу на нужное место
			drag: () => 'part',
			drop: {
				from: {
					parts: (payload, target) => {
						const from = Number(payload.key);
						const delta = dropDelta(ctx, 'parts', rows.parts.length, from, target);
						if (delta === 0) {
							return false;
						}
						// Не текущая часть: сначала выбор части, как щелчком (selectPart), — выбор в списках прежней
						// части не должен достаться новой текущей
						if (from !== ctx.state.part) {
							resetSelection(ctx.state);
						}
						partOperation(ctx, QE.movePart(ctx.state.model, index, from, delta));
					},
				},
			},
		});
		const right = column(layout, 'Псевдонимы');
		const columnTools = el('div', 'dcs-qd-toolbar');
		const columnOperation = (run) => {
			if (!(st.column >= 0 && st.column < rows.columns.length)) {
				ctx.note('Выберите колонку в таблице «Псевдонимы».');
				return;
			}
			const result = run(st.column);
			if (!result.error && typeof result.index === 'number') {
				st.column = result.index;
			}
			ctx.commit(result);
		};
		const removeColumn = () => columnOperation((k) => QE.removeColumn(ctx.state.model, index, k));
		columnTools.appendChild(iconButton('delete', 'Удалить колонку', removeColumn, ctx.keys, { note: 'Во всех частях объединения' }));
		columnTools.appendChild(iconButton('up', 'Переместить колонку выше', () => columnOperation((k) => QE.moveColumn(ctx.state.model, index, k, -1)), ctx.keys));
		columnTools.appendChild(iconButton('down', 'Переместить колонку ниже', () => columnOperation((k) => QE.moveColumn(ctx.state.model, index, k, 1)), ctx.keys));
		right.appendChild(columnTools);
		if (!rows.aligned) {
			right.appendChild(el('div', 'dcs-plate', 'Число полей у частей объединения разное: соответствие колонок правится текстом («Запрос…»).'));
		}
		const parts = statement.parts;
		const cellOptions = parts.map((part) => {
			const options = [{ value: '', label: '(пусто, NULL)' }];
			(part.fields || []).forEach((field, k) => {
				if (upper(String(field.expr).trim()) !== 'NULL') {
					options.push({ value: String(k), label: oneLine(field.expr) });
				}
			});
			return options;
		});
		gridView(right, {
			id: 'aliases',
			label: 'Псевдонимы и поля частей',
			className: 'dcs-qd-grid-union',
			templateColumns: 'minmax(120px, 1fr) ' + parts.map(() => 'minmax(140px, 1.4fr)').join(' '),
			columns: ['Имя поля'].concat(rows.parts.map((part) => part.label)),
			rows: rows.columns.map((column) => ({
				key: String(column.index),
				cells: [
					aliasCell(
						ctx,
						column,
						cellInput(
							ctx,
							column.name || '',
							'Имя поля ' + (column.index + 1),
							'al:' + column.index + ':name',
							(value) => {
								st.column = column.index;
								ctx.commit(QE.renameColumn(ctx.state.model, index, column.index, value));
							},
							'(без имени)'
						)
					),
				].concat(
					column.cells.map((cell) => {
						if (!rows.aligned || cell.expr === null) {
							return el('span', 'dcs-qd-cell-text', cell.expr === null ? '' : oneLine(cell.expr));
						}
						const select = gridSelect(
							ctx,
							cellOptions[cell.part],
							cell.isNull ? '' : String(column.index),
							'Поле «Запроса ' + (cell.part + 1) + '» для колонки ' + (column.name || column.index + 1),
							'al:' + column.index + ':p' + cell.part,
							(value) => {
								st.column = column.index;
								ctx.commit(QE.setUnionCell(ctx.state.model, index, column.index, cell.part, value === '' ? null : Number(value)));
							}
						);
						// Неочевидное поведение списка — в его подсказке
						hint(select, 'Поле, уже выбранное в другой колонке, поменяется с ним местами');
						if (cell.isNull) {
							return select;
						}
						// Поле части тащат в другую колонку за значок «⋮»: список сам перетаскиваться не может
						const box = el('span', 'dcs-qd-cell-simple');
						const grip = dragGrip('Перетащите поле «Запроса ' + (cell.part + 1) + '» в другую колонку');
						grip.setAttribute('data-dnd-part', String(cell.part));
						box.appendChild(grip);
						box.appendChild(select);
						return box;
					})
				),
			})),
			selected: st.column >= 0 ? String(st.column) : '',
			keys: ctx.keys,
			empty: 'Полей нет: добавьте их на вкладке «Таблицы и поля».',
			onSelect: (key, focus) => choose(ctx, st, 'column', 'aliases', Number(key), focus),
			onDelete: (key) => {
				st.column = Number(key);
				removeColumn();
			},
			/*
			 * Перенос мышью. Строка за «⋮» у имени — колонка целиком: перестановка, как ↑ ↓ (QE.moveColumn). Поле части за
			 * «⋮» у её списка — в строку другой колонки: та же правка, что выбор в списке ячейки (QE.setUnionCell, поля
			 * меняются местами).
			 */
			drag: (key, source) => {
				const part = source && typeof source.getAttribute === 'function' ? source.getAttribute('data-dnd-part') : null;
				return part !== null && part !== undefined ? 'cell:' + part : 'column';
			},
			drop: {
				from: {
					aliases: (payload, target) => {
						const from = Number(payload.key);
						if (payload.kind.indexOf('cell:') === 0) {
							const to = dropRow(target);
							if (to < 0 || to === from) {
								return false;
							}
							// Выбор и фокус — у строки, куда встало поле, как после выбора в её списке
							st.column = to;
							ctx.state.focus = 'aliases:' + to;
							ctx.commit(QE.setUnionCell(ctx.state.model, index, to, Number(payload.kind.slice(5)), from));
							return;
						}
						const delta = dropDelta(ctx, 'aliases', rows.columns.length, from, target);
						if (delta === 0) {
							return false;
						}
						st.column = from;
						columnOperation((k) => QE.moveColumn(ctx.state.model, index, k, delta));
					},
				},
				place: (payload) => (payload.kind.indexOf('cell:') === 0 ? 'into' : 'line'),
			},
		});
		container.appendChild(layout);
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Порядок»
	// ---------------------------------------------------------------------------------------------

	function renderOrderTab(container, ctx) {
		const st = ctx.state.order;
		const index = ctx.state.statement;
		const statement = ctx.statement();
		const union = statement.parts.length > 1;
		const rows = QE.orderRows(statement);
		const layout = el('div', 'dcs-qd-split dcs-qd-split-moves');
		const left = column(layout, 'Поля');
		const treeRows = [];
		const info = new Map();
		const columns = QE.indexColumns(statement);
		treeRows.push({ key: 'q', level: 0, label: 'Поля запроса', badge: String(columns.length), expandable: true, expanded: !st.expanded.has('q-closed') });
		info.set('q', { kind: 'group' });
		if (!st.expanded.has('q-closed')) {
			for (const name of columns) {
				treeRows.push({ key: 'oq:' + upper(name), level: 1, label: name });
				info.set('oq:' + upper(name), { kind: 'column', expr: name });
			}
		}
		if (!union) {
			// В объединении порядок — только по колонкам результата: поля таблиц частей не показываются
			const sources = sourceFieldRows(ctx, st.expanded, 'o', 0);
			treeRows.push(...sources.rows);
			sources.info.forEach((value, key) => info.set(key, value));
		}
		const exprOf = (item) => (!item ? '' : item.kind === 'column' ? item.expr : item.kind === 'field' ? item.alias + '.' + item.path : '');
		/** «>» по полю дерева; at — место в порядке для поля, брошенного мышью (QE.moveOrder следом). */
		const add = (item, at) => {
			const expr = exprOf(item);
			if (!expr) {
				ctx.note('Выберите в дереве поле запроса или поле таблицы.');
				return;
			}
			let result = QE.addOrder(ctx.state.model, index, expr, 'asc');
			if (!result.error && typeof at === 'number' && at !== result.index) {
				const moved = QE.moveOrder(result.model, index, result.index, at - result.index);
				if (!moved.error) {
					result = Object.assign({}, result, { model: moved.model, index: moved.index });
				}
			}
			if (!result.error) {
				st.row = result.index;
			}
			ctx.commit(result);
		};
		const remove = () => {
			if (!rows[st.row]) {
				ctx.note('Выберите поле в списке «Порядок».');
				return;
			}
			const result = QE.removeOrder(ctx.state.model, index, st.row);
			st.row = Math.min(st.row, rows.length - 2);
			ctx.commit(result);
		};
		treeView(left, {
			id: 'otree',
			label: 'Поля для порядка',
			rows: treeRows,
			selected: st.selected,
			keys: ctx.keys,
			empty: '',
			onSelect: (key, focus) => choose(ctx, st, 'selected', 'otree', key, focus),
			onToggle: (key, value) => {
				if (key === 'q') {
					flipExpanded(st.expanded, 'q-closed', !value);
				} else {
					flipExpanded(st.expanded, key, value);
				}
				choose(ctx, st, 'selected', 'otree', key, true);
			},
			onActivate: (key) => {
				const item = info.get(key);
				if (item && (item.kind === 'group' || item.kind === 'source')) {
					if (key === 'q') {
						flipExpanded(st.expanded, 'q-closed', !st.expanded.has('q-closed'));
					} else {
						flipExpanded(st.expanded, key, !st.expanded.has(key));
					}
					ctx.rerender();
					return;
				}
				add(item);
			},
			// Перенос мышью: поле — в порядок (как «>»), узел «Поля запроса» — все колонки (как «>>»); поле порядка
			// обратно — убрать (как «<»)
			drag: (key) => {
				const item = info.get(key);
				if (key === 'q') {
					return 'columns';
				}
				return item && (item.kind === 'column' || item.kind === 'field') ? item.kind : '';
			},
			drop: {
				from: {
					order: (payload) => {
						st.row = Number(payload.key);
						remove();
					},
				},
				place: 'zone',
			},
		});
		/** «>>» — все колонки запроса, которых в порядке ещё нет; «<<» — порядок целиком (как у платформы). */
		const addAll = () => {
			let model = ctx.state.model;
			for (const name of columns) {
				const result = QE.addOrder(model, index, name, 'asc');
				if (!result.error) {
					model = result.model;
				}
			}
			ctx.commit({ model: model });
		};
		const removeAll = () => {
			if (rows.length === 0) {
				ctx.note('Порядка нет.');
				return;
			}
			let model = ctx.state.model;
			for (let k = rows.length - 1; k >= 0; k--) {
				const result = QE.removeOrder(model, index, k);
				if (!result.error) {
					model = result.model;
				}
			}
			st.row = -1;
			ctx.commit({ model: model });
		};
		moves(layout, [
			{ label: '>', title: 'Добавить выбранное поле в порядок', onClick: () => add(info.get(st.selected)) },
			{ label: '>>', title: 'Добавить в порядок все колонки запроса', onClick: addAll },
			{ label: '<', title: 'Убрать выбранное поле из порядка', onClick: remove },
			{ label: '<<', title: 'Убрать все поля из порядка', onClick: removeAll },
		], ctx.keys);
		const right = column(layout, 'Порядок');
		const toolbar = el('div', 'dcs-qd-toolbar');
		const move = (delta) => {
			if (!rows[st.row]) {
				ctx.note('Выберите поле в списке «Порядок».');
				return;
			}
			const result = QE.moveOrder(ctx.state.model, index, st.row, delta);
			st.row = result.index;
			ctx.commit(result);
		};
		toolbar.appendChild(iconButton('up', 'Переместить поле порядка выше', () => move(-1), ctx.keys));
		toolbar.appendChild(iconButton('down', 'Переместить поле порядка ниже', () => move(1), ctx.keys));
		right.appendChild(toolbar);
		const directions = QE.ORDER_DIRECTIONS.map((item) => ({ value: item.id, label: item.label }));
		gridView(right, {
			id: 'order',
			label: 'Порядок',
			className: 'dcs-qd-grid-order',
			columns: ['Поле', 'Сортировка'],
			rows: rows.map((row) => ({
				key: String(row.index),
				cells: [
					oneLine(row.expr),
					gridSelect(ctx, directions, row.direction, 'Сортировка поля ' + oneLine(row.expr), 'ord:' + row.index + ':dir', (value) => {
						st.row = row.index;
						ctx.commit(QE.setOrderDirection(ctx.state.model, index, row.index, value));
					}),
				],
			})),
			selected: st.row >= 0 ? String(st.row) : '',
			keys: ctx.keys,
			empty: 'Порядка нет: перенесите поле («>»).',
			onSelect: (key, focus) => choose(ctx, st, 'row', 'order', Number(key), focus),
			onDelete: (key) => {
				st.row = Number(key);
				remove();
			},
			// Поле дерева встаёт в место сброса, «Поля запроса» — все колонки в конец (как «>>»); своё переставляется (как ↑ ↓)
			drag: () => 'order',
			drop: {
				from: {
					otree: (payload, target) => {
						if (payload.kind === 'columns') {
							addAll();
						} else {
							add(info.get(payload.key), dropAt(rows.length, target));
						}
					},
					order: (payload, target) => {
						const from = Number(payload.key);
						const delta = dropDelta(ctx, 'order', rows.length, from, target);
						if (delta === 0) {
							return false;
						}
						st.row = from;
						move(delta);
					},
				},
				place: (payload) => (payload.kind === 'columns' ? 'zone' : 'line'),
				effect: (payload) => (payload.zone === 'otree' ? 'copy' : 'move'),
			},
		});
		right.appendChild(flag(ctx, 'Автоупорядочивание', statement.autoOrder, 'ord-auto', (value) => ctx.commit(QE.setAutoOrder(ctx.state.model, index, value))).wrap);
		container.appendChild(layout);
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Пакет запросов»
	// ---------------------------------------------------------------------------------------------

	/** Правка состава пакета: места запросов сдвинулись, и отложенное по местам запросов сбрасывается. */
	function batchOperation(ctx, result) {
		const state = ctx.state;
		if (!result.error && result.model !== state.model) {
			state.stash.clear();
			state.pendingLinks = [];
			state.statement = typeof result.index === 'number' ? result.index : state.statement;
			state.part = 0;
			resetSelection(state);
		}
		ctx.commit(result);
	}

	function renderBatchTab(container, ctx) {
		const state = ctx.state;
		const rows = QE.batchRows(state.model);
		const toolbar = el('div', 'dcs-qd-toolbar');
		toolbar.appendChild(iconButton('add', 'Добавить запрос пакета после выбранного', () => batchOperation(ctx, QE.addStatement(state.model, state.statement)), ctx.keys));
		toolbar.appendChild(iconButton('add-copy', 'Добавить копию выбранного запроса пакета', () => batchOperation(ctx, QE.copyStatement(state.model, state.statement)), ctx.keys));
		const remove = () => batchOperation(ctx, QE.removeStatement(state.model, state.statement));
		toolbar.appendChild(iconButton('delete', 'Удалить выбранный запрос пакета', remove, ctx.keys));
		toolbar.appendChild(iconButton('up', 'Переместить запрос пакета выше', () => batchOperation(ctx, QE.moveStatement(state.model, state.statement, -1)), ctx.keys));
		toolbar.appendChild(iconButton('down', 'Переместить запрос пакета ниже', () => batchOperation(ctx, QE.moveStatement(state.model, state.statement, 1)), ctx.keys));
		container.appendChild(toolbar);
		gridView(container, {
			id: 'batch',
			label: 'Запросы пакета',
			className: 'dcs-qd-grid-batch',
			columns: ['№', 'Запрос', 'Вид'],
			rows: rows.map((row) => {
				const note = el('span', '', row.note);
				if (row.dataSet) {
					note.appendChild(el('span', 'dcs-tree-badge', 'поля набора'));
				}
				return { key: String(row.index), cells: [String(row.index + 1), row.label, note], title: row.dataSet ? 'Колонки этого запроса становятся полями набора данных' : '' };
			}),
			selected: String(state.statement),
			keys: ctx.keys,
			empty: '',
			onSelect: (key, focus) => selectStatement(ctx, Number(key), focus ? 'batch:' + key : ''),
			onDelete: (key) => {
				state.statement = Number(key);
				remove();
			},
			// Перенос мышью: перестановка запросов пакета — та же правка, что у ↑ ↓ (QE.moveStatement), сразу на место
			drag: () => 'statement',
			drop: {
				from: {
					batch: (payload, target) => {
						const from = Number(payload.key);
						const delta = dropDelta(ctx, 'batch', rows.length, from, target);
						if (delta === 0) {
							return false;
						}
						batchOperation(ctx, QE.moveStatement(state.model, from, delta));
					},
				},
			},
		});
		warningsPlate(container, QE.batchWarnings(state.model));
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Компоновка данных»: Таблицы, Поля, Условия
	// ---------------------------------------------------------------------------------------------

	const COMPOSITION_SUBTABS = [
		{ id: 'tables', title: 'Таблицы', render: renderCompositionTables },
		{ id: 'fields', title: 'Поля', render: renderCompositionFields },
		{ id: 'conditions', title: 'Условия', render: renderCompositionConditions },
	];

	function renderCompositionTab(container, ctx) {
		const st = ctx.state.composition;
		const subs = COMPOSITION_SUBTABS;
		const current = subs.find((sub) => sub.id === st.sub) || subs[0];
		const built = tabStrip({
			label: 'Подвкладки «Компоновки данных»',
			className: 'tabs dcs-subtabs dcs-qd-subtabs',
			panelClass: 'dcs-qd-subpanel',
			items: subs,
			active: current.id,
			keyPrefix: 'csub:',
			keys: ctx.keys,
			onPick: (id) => {
				st.sub = id;
				ctx.state.focus = 'csub:' + id;
				ctx.rerender();
			},
		});
		container.appendChild(built.strip);
		current.render(built.panel, ctx);
		container.appendChild(built.panel);
	}

	/**
	 * Есть ли у источника параметры для окна «Параметры…» «Компоновки данных»: в тексте или в описании
	 * таблицы. Пока описание читается — считаем, что есть (кнопка не пропадает на время чтения). У
	 * Границ последовательности параметров нет ни там, ни там: окно открылось бы пустым.
	 */
	function hasTableParams(found) {
		const source = found && found.source;
		if (!source || source.kind !== 'table') {
			return false;
		}
		if (Array.isArray(source.params) && source.params.length > 0) {
			return true;
		}
		const described = QE.isTempTable(source) ? { state: 'none' } : api.describeTable(source.table);
		if (described.state === 'loading') {
			return true;
		}
		return described.state === 'ready' && Boolean(described.table) && Array.isArray(described.table.params) && described.table.params.length > 0;
	}

	function renderCompositionTables(host, ctx) {
		const st = ctx.state.composition;
		const address = ctx.address();
		const rows = QE.compositionTables(ctx.part());
		gridView(host, {
			id: 'ctables',
			label: 'Таблицы компоновки',
			className: 'dcs-qd-grid-ctables',
			columns: ['Таблица', 'Обязательная', 'Номер группы', 'Параметры'],
			rows: rows.map((row) => {
				const name = el('span', 'dcs-qd-cell-text', row.alias || '(без псевдонима)');
				name.style.paddingLeft = row.depth * 14 + 'px';
				name.title = row.label;
				const required = gridCheck(ctx, !row.optional, 'Обязательная: ' + (row.alias || row.label), 'ct:' + row.key + ':req', (value) => {
					st.table = row.key;
					ctx.commit(QE.setJoinRequired(ctx.state.model, address, row.path, value));
				});
				if (!row.join) {
					required.disabled = true;
					hint(required, 'Таблица ИЗ обязательна всегда: необязательным бывает только соединение');
				} else {
					// Смысл флажка и номера группы — в их подсказках
					hint(required, 'Снятый флажок берёт соединение в {…}: схема уберёт его из запроса, когда поля таблицы отчёту не нужны');
				}
				const number = numberField(row.group, 'Номер группы: ' + (row.alias || row.label));
				number.disabled = !row.optional;
				hint(number, 'Соседние необязательные соединения одного уровня с одним номером идут в одних скобках и выпадают вместе');
				ctx.keys.set(number, 'ct:' + row.key + ':group');
				number.addEventListener('change', () => {
					st.table = row.key;
					ctx.commit(QE.setJoinGroup(ctx.state.model, address, row.path, number.value));
				});
				const params =
					row.virtual && hasTableParams(row.alias ? QE.findSource(ctx.part(), row.alias) : null)
						? button('Параметры…', 'Параметры виртуальной таблицы «' + row.alias + '» для СКД', () => openDcsParamsWindow(ctx, row), 'ghost-btn dcs-btn-small', ctx.keys)
						: '';
				return { key: row.key, cells: [name, required, number, params], title: row.label };
			}),
			selected: st.table,
			keys: ctx.keys,
			empty: 'Таблиц нет: добавьте их на вкладке «Таблицы и поля».',
			onSelect: (key, focus) => choose(ctx, st, 'table', 'ctables', key, focus),
		});
	}

	/**
	 * Параметры виртуальной таблицы для СКД: по позиции — значение и блок {…}; флажок
	 * «Необязательный параметр» (`&П` ↔ `{(&П)}`) и имя параметра, когда позиция — один параметр; у
	 * условия — поля-отборы `(Поле).* КАК Х` по полям самой таблицы, прочее в блоке — текстом. ОК
	 * собирает тексты позиций и правит их той же операцией, что окно параметров «Таблиц и полей».
	 */
	function openDcsParamsWindow(ctx, row) {
		const found = QE.findSource(ctx.part(), row.alias);
		if (!found || found.source.kind !== 'table') {
			ctx.note('Выберите виртуальную таблицу.');
			return;
		}
		const source = found.source;
		// То же решение и те же сообщения, что у окна «Таблиц и полей»: у основной таблицы регистра —
		// где его параметры, у Границ последовательности — «нет параметров»
		const state = paramsStateOf(source, row.alias);
		if (state.state !== 'open') {
			ctx.note(state.note);
			return;
		}
		const table = state.table;
		const params = state.params;
		const current = Array.isArray(source.params) ? source.params : [];
		const count = Math.max(params.length, current.length);
		const address = ctx.address();
		const readers = [];
		// Ещё не записанные тексты других позиций (чтение знает поле значения своей позиции): параметр, вписанный в одну
		// позицию, уже есть в списке значения другой
		const windowTexts = (except) => readers.filter((read) => read.field !== except).map((read) => read());
		api.pushDialog({
			title: 'Параметры виртуальной таблицы «' + row.alias + '» для СКД',
			width: 'wide',
			onClose: refocusLater(ctx.keys),
			build: (body) => {
				for (let k = 0; k < count; k++) {
					readers.push(buildDcsParamPosition(ctx, body, params[k] || { name: 'Параметр ' + (k + 1), kind: '' }, current[k] || { text: '' }, table, state.objectKind, windowTexts));
				}
			},
			buttons: [
				{
					id: 'ok',
					label: 'ОК',
					primary: true,
					onClick: (level) => {
						const texts = readers.map((read) => read());
						const error = ctx.commit(QE.setVirtualParams(ctx.state.model, address, row.alias, texts));
						if (error) {
							return error;
						}
						level.close();
						return undefined;
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	/**
	 * Позиция окна параметров для СКД; возвращает чтение итогового текста позиции. У условия «Поля-отборы» и подсказка
	 * значения — только поля, которые платформа берёт в условие этой таблицы (QE.vtConditionFields), по имени; отбор по
	 * другому полю, уже записанный в блоке, остаётся отмеченным, а под значением — предупреждение о нём. Значение
	 * НачалоПериода, КонецПериода, Период…, виды субконто — поле со списком параметров запроса (attachParamDrop), в нём
	 * и параметры ещё не записанных текстов других позиций окна (windowTexts) и блока своей позиции. Значение условия
	 * на счёт — как в окне «Таблиц и полей»: «…» окна выражения своего поля счёта и подсказка того же поля без «⋯».
	 */
	function buildDcsParamPosition(ctx, host, param, value, table, objectKind, windowTexts) {
		const lang = ctx.lang;
		const box = el('div', 'dcs-qd-vt');
		box.setAttribute('role', 'group');
		box.setAttribute('aria-label', param.name);
		box.appendChild(el('div', 'dcs-form-group', param.name));
		const parts = QE.vtParamParts(value);
		const isCondition = param.kind === 'condition';
		const items = parts.block === null ? [] : QE.vtBlockItems(parts.block);
		const filters = new Map();
		const order = [];
		const remember = (field, state) => {
			if (!filters.has(upper(field))) {
				order.push(upper(field));
			}
			filters.set(upper(field), state);
		};
		let blockText = parts.block === null ? '' : parts.block;
		if (isCondition) {
			for (const item of items.filter((entry) => entry.kind === 'filter')) {
				remember(item.field, { field: item.field, on: true, star: item.star, alias: item.alias || '' });
			}
			blockText = QE.vtBlockText(
				items.filter((entry) => entry.kind !== 'filter'),
				lang
			);
		}
		const base = api.codeEditor(parts.base, 'dcs-expr dcs-qd-param');
		base.input.setAttribute('aria-label', 'Значение: ' + param.name);
		const isAccount = QE.vtParamInput(param) === 'account';
		if (isAccount) {
			const row = el('div', 'dcs-qd-param-row');
			row.appendChild(base.box);
			row.appendChild(
				button('…', accountConditionTitle(param) + ' в окне выражения', () =>
					openAccountWindow(ctx, param, table, base.input.value, (text) => {
						setValue(base, text);
						return undefined;
					})
				)
			);
			api.formRow(box, 'Значение', row);
		} else {
			api.formRow(box, 'Значение', base.box);
		}
		const block = api.codeEditor(blockText, 'dcs-expr dcs-qd-param');
		block.input.setAttribute('aria-label', (isCondition ? 'Прочее в блоке СКД: ' : 'Блок СКД: ') + param.name);
		// Когда схема применяет блок — в подсказке поля
		hint(block.input, 'Блок {…} схема применяет, только когда в отчёте задано значение параметра или отбор');
		api.formRow(box, isCondition ? 'Прочее в блоке {…}' : 'Для СКД {…}', block.box);
		const setValue = (editor, text) => {
			editor.input.value = text;
			editor.input.dispatchEvent(new Event('input'));
		};
		if (!isCondition) {
			if (QE.vtParamInput(param) === 'value') {
				// Значение — тем же полем со списком параметров запроса, что в окне «Таблиц и полей»; блок своей позиции —
				// другое поле, его параметры тоже в списке
				attachParamDrop(ctx, base.input, (except) => windowTexts(except).concat([block.input.value]));
			} else if (isAccount) {
				api.attachCompletion(base.input, () => 'virtual-params', {
					catalog: () => completer.catalogFromNodes(withTypeText(vtExpressionNodes(param, table)).concat(vtConditionFunctionNodes(lang)), { paramsAtRoot: true }),
					ownTypes: true,
					more: false,
				});
			}
			const line = el('div', 'dcs-check-row');
			const optional = api.checkbox('Необязательный параметр', false);
			const name = api.textInput('');
			name.classList.add('dcs-qd-vt-name');
			name.setAttribute('aria-label', 'Имя параметра: ' + param.name);
			const sync = () => {
				const state = QE.vtOptionalState(base.input.value, block.input.value);
				optional.input.checked = state.optional;
				optional.input.disabled = !state.available;
				name.value = state.name;
				name.disabled = !state.available;
				name.setAttribute('data-name', state.name);
			};
			optional.input.addEventListener('change', () => {
				const next = QE.vtSetOptional(base.input.value, block.input.value, optional.input.checked);
				setValue(base, next.base);
				setValue(block, next.block === null ? '' : next.block);
				sync();
			});
			name.addEventListener('change', () => {
				const from = name.getAttribute('data-name');
				const to = name.value.trim();
				if (from && QE.IDENT_RE.test(to) && to !== from) {
					setValue(base, QE.renameParamText(base.input.value, from, to));
					setValue(block, QE.renameParamText(block.input.value, from, to));
				}
				sync();
			});
			base.input.addEventListener('input', sync);
			block.input.addEventListener('input', sync);
			line.appendChild(optional.wrap);
			const label = el('label', 'dcs-qd-inline');
			label.appendChild(el('span', 'dcs-prop-label', 'Имя параметра'));
			label.appendChild(name);
			line.appendChild(label);
			box.appendChild(line);
			sync();
		} else {
			const allowed = QE.vtConditionFields(objectKind || '', table).allowed;
			for (const field of allowed) {
				if (!filters.has(upper(field.name))) {
					remember(field.name, { field: field.name, on: false, star: false, alias: '' });
				}
			}
			api.attachCompletion(base.input, () => 'virtual-params', { catalog: () => completer.catalogFromNodes(withTypeText(vtFieldNodes(allowed)).concat(vtConditionFunctionNodes(lang)), { paramsAtRoot: true }), ownTypes: true });
			// Отмеченный отбор уходит в условие таблицы так же, как значение и прочее в блоке
			const warningTexts = () => [base.input.value, block.input.value].concat(order.map((keyName) => filters.get(keyName)).filter((state) => state.on).map((state) => state.field));
			const refreshWarning = attachVtWarning(base.box, base.input, () => QE.vtConditionWarning(objectKind || '', table, warningTexts()).message);
			block.input.addEventListener('input', refreshWarning);
			box.appendChild(el('div', 'dcs-form-label', 'Поля-отборы'));
			const list = el('div', 'dcs-check-list dcs-qd-vt-filters');
			list.setAttribute('role', 'group');
			list.setAttribute('aria-label', 'Поля-отборы: ' + param.name);
			list.title = 'Отбор отчёта по отмеченному полю уйдёт в условие таблицы';
			list.setAttribute('aria-description', list.title);
			for (const keyName of order) {
				const state = filters.get(keyName);
				const line = el('div', 'dcs-qd-vt-filter');
				const on = api.checkbox(state.field, state.on);
				const star = api.checkbox('дочерние (.*)', state.star);
				star.input.setAttribute('aria-label', 'Использовать дочерние: ' + state.field);
				const alias = api.textInput(state.alias);
				alias.classList.add('dcs-qd-cell-input');
				alias.placeholder = 'псевдоним';
				alias.setAttribute('aria-label', 'Псевдоним отбора: ' + state.field);
				on.input.addEventListener('change', () => {
					state.on = Boolean(on.input.checked);
					refreshWarning();
				});
				star.input.addEventListener('change', () => {
					state.star = Boolean(star.input.checked);
				});
				alias.addEventListener('input', () => {
					state.alias = alias.value.trim();
				});
				line.appendChild(on.wrap);
				line.appendChild(star.wrap);
				line.appendChild(alias);
				list.appendChild(line);
			}
			if (order.length === 0) {
				list.appendChild(el('div', 'dcs-qd-empty', table ? vtConditionEmpty(table) : 'Поля таблицы не известны: поля-отборы впишите в блок текстом.'));
			}
			box.appendChild(list);
		}
		host.appendChild(box);
		const read = () => {
			let inner = block.input.value.trim();
			if (isCondition) {
				const chosen = order
					.map((keyName) => filters.get(keyName))
					.filter((state) => state.on)
					.map((state) => ({ kind: 'filter', field: state.field, star: state.star, alias: QE.IDENT_RE.test(state.alias) ? state.alias : null }));
				inner = [inner, QE.vtBlockText(chosen, lang)].filter(Boolean).join(', ');
			}
			return QE.vtParamText(base.input.value, inner);
		};
		// Позиция без правок отдаёт записанный текст: пересборка блока (порядок отборов, пробелы) — не правка
		const pristine = read();
		const reader = () => {
			const now = read();
			return now === pristine ? QE.paramText(value) : now;
		};
		// Поле значения позиции: его список (windowTexts окна) берёт тексты других позиций
		reader.field = base.input;
		return reader;
	}

	/** Предупреждение у полей компоновки набора с автозаполнением: по описаниям платформы блок тогда не применяется. */
	const AUTOFILL_SELECT_WARNING = 'У набора включено автозаполнение: по описаниям платформы блок {ВЫБРАТЬ} тогда не применяется.';

	/** Поля {ВЫБРАТЬ}: колонки запроса → поля компоновки; блок есть только у первой части. */
	function renderCompositionFields(host, ctx) {
		const st = ctx.state.composition;
		const index = ctx.state.statement;
		const statement = ctx.statement();
		if (ctx.state.part > 0) {
			host.appendChild(el('div', 'struct-hint', 'Блок {ВЫБРАТЬ} бывает только у первой части объединения, список ниже относится к ней.'));
		}
		const rows = QE.dcsSelectRows(statement);
		const available = QE.dcsSelectAvailable(statement);
		const layout = el('div', 'dcs-qd-split dcs-qd-split-moves');
		const left = column(layout, 'Поля запроса');
		/** «>» по полю запроса; at — место в полях компоновки для поля, брошенного мышью (QE.moveDcsSelect следом). */
		const add = (name, at) => {
			if (!name) {
				ctx.note('Выберите поле запроса.');
				return;
			}
			let result = QE.addDcsSelect(ctx.state.model, index, name);
			if (!result.error && typeof at === 'number' && at !== result.index) {
				const moved = QE.moveDcsSelect(result.model, index, result.index, at - result.index);
				if (!moved.error) {
					result = Object.assign({}, result, { model: moved.model, index: moved.index });
				}
			}
			if (!result.error) {
				st.field = result.index;
				st.avail = '';
			}
			ctx.commit(result);
		};
		const remove = () => {
			if (!rows[st.field]) {
				ctx.note('Выберите поле в списке «Поля компоновки».');
				return;
			}
			const result = QE.removeDcsSelect(ctx.state.model, index, st.field);
			st.field = Math.min(st.field, rows.length - 2);
			ctx.commit(result);
		};
		treeView(left, {
			id: 'dsa',
			role: 'listbox',
			label: 'Поля запроса',
			rows: available.map((name) => ({ key: name, level: 0, label: name })),
			selected: st.avail,
			keys: ctx.keys,
			empty: rows.length > 0 ? 'Все поля запроса уже в списке.' : 'Полей нет: добавьте их на вкладке «Таблицы и поля».',
			onSelect: (key, focus) => choose(ctx, st, 'avail', 'dsa', key, focus),
			onToggle: () => undefined,
			onActivate: (key) => add(key),
			// Перенос мышью: поле — в поля компоновки (как «>»); поле компоновки обратно — убрать (как «<»)
			drag: () => 'field',
			drop: {
				from: {
					dsel: (payload) => {
						st.field = Number(payload.key);
						remove();
					},
				},
				place: 'zone',
			},
		});
		moves(layout, [
			{ label: '>', title: 'Добавить выбранное поле в поля компоновки', onClick: () => add(st.avail) },
			{ label: '>>', title: 'Добавить в поля компоновки все поля запроса', onClick: () => ctx.commit(QE.addAllDcsSelect(ctx.state.model, index)) },
			{ label: '<', title: 'Убрать выбранное поле из полей компоновки', onClick: remove },
			{ label: '<<', title: 'Убрать все поля компоновки', onClick: () => ctx.commit(QE.removeAllDcsSelect(ctx.state.model, index)) },
		], ctx.keys);
		const right = column(layout, 'Поля компоновки');
		const toolbar = el('div', 'dcs-qd-toolbar');
		const move = (delta) => {
			if (!rows[st.field]) {
				ctx.note('Выберите поле в списке «Поля компоновки».');
				return;
			}
			const result = QE.moveDcsSelect(ctx.state.model, index, st.field, delta);
			st.field = result.index;
			ctx.commit(result);
		};
		toolbar.appendChild(iconButton('up', 'Переместить поле компоновки выше', () => move(-1), ctx.keys));
		toolbar.appendChild(iconButton('down', 'Переместить поле компоновки ниже', () => move(1), ctx.keys));
		right.appendChild(toolbar);
		gridView(right, {
			id: 'dsel',
			label: 'Поля компоновки',
			className: 'dcs-qd-grid-dsel',
			columns: ['Поле', 'Использовать дочерние', 'Псевдоним'],
			rows: rows.map((row) => {
				if (!row.path) {
					return { key: String(row.index), cells: [el('span', 'dcs-qd-cell-text', oneLine(row.text)), '', ''], title: 'Не путь: правится текстом («Запрос…»)' };
				}
				const write = (spec) => {
					st.field = row.index;
					ctx.commit(QE.setDcsSelect(ctx.state.model, index, row.index, spec));
				};
				return {
					key: String(row.index),
					cells: [
						row.path,
						gridCheck(ctx, row.star, 'Использовать дочерние: ' + row.path, 'ds:' + row.index + ':star', (value) => write({ star: value })),
						cellInput(ctx, row.alias || '', 'Псевдоним: ' + row.path, 'ds:' + row.index + ':alias', (value) => write({ alias: value })),
					],
				};
			}),
			selected: st.field >= 0 ? String(st.field) : '',
			keys: ctx.keys,
			empty: 'Полей компоновки нет: в отчёте доступны все поля набора.',
			onSelect: (key, focus) => choose(ctx, st, 'field', 'dsel', Number(key), focus),
			onDelete: (key) => {
				st.field = Number(key);
				remove();
			},
			// Поле запроса встаёт в место сброса; своё переставляется (как ↑ ↓)
			drag: () => 'composition-field',
			drop: {
				from: {
					dsa: (payload, target) => add(payload.key, dropAt(rows.length, target)),
					dsel: (payload, target) => {
						const from = Number(payload.key);
						const delta = dropDelta(ctx, 'dsel', rows.length, from, target);
						if (delta === 0) {
							return false;
						}
						st.field = from;
						move(delta);
					},
				},
				effect: (payload) => (payload.zone === 'dsa' ? 'copy' : 'move'),
			},
		});
		host.appendChild(layout);
		// Предупреждение — только когда блок {ВЫБРАТЬ} есть, а автозаполнение делает его бесполезным. Без полей
		// компоновки предупреждать не о чем: у наборов БСП автозаполнение включено почти всегда
		if (rows.length > 0 && ctx.state.dataSet && ctx.state.dataSet.autoFill) {
			host.appendChild(el('div', 'struct-hint', AUTOFILL_SELECT_WARNING));
		}
	}

	/** Условия {ГДЕ}: поля таблиц части и условия с параметром; у каждой части свой блок. */
	function renderCompositionConditions(host, ctx) {
		const st = ctx.state.composition;
		const address = ctx.address();
		const rows = QE.dcsWhereRows(ctx.part());
		const layout = el('div', 'dcs-qd-split dcs-qd-split-moves');
		const left = column(layout, 'Поля таблиц');
		const tree = sourceFieldRows(ctx, st.whereExpanded, 'w', 0);
		/** «>» по полю таблицы; at — место в условиях компоновки для поля, брошенного мышью (QE.moveDcsWhere следом). */
		const add = (item, at) => {
			if (!item || item.kind !== 'field') {
				ctx.note('Выберите поле таблицы в дереве.');
				return;
			}
			let result = QE.addDcsWhereField(ctx.state.model, address, item.alias + '.' + item.path);
			if (!result.error && typeof at === 'number' && at !== result.index) {
				const moved = QE.moveDcsWhere(result.model, address, result.index, at - result.index);
				if (!moved.error) {
					result = Object.assign({}, result, { model: moved.model, index: moved.index });
				}
			}
			if (!result.error) {
				st.where = result.index;
			}
			ctx.commit(result);
		};
		const remove = () => {
			if (!rows[st.where]) {
				ctx.note('Выберите строку в списке «Условия компоновки».');
				return;
			}
			const result = QE.removeDcsWhere(ctx.state.model, address, st.where);
			st.where = Math.min(st.where, rows.length - 2);
			ctx.commit(result);
		};
		treeView(left, {
			id: 'wtree',
			label: 'Поля таблиц для условий компоновки',
			rows: tree.rows,
			selected: st.whereField,
			keys: ctx.keys,
			empty: 'Таблиц нет: добавьте их на вкладке «Таблицы и поля».',
			onSelect: (key, focus) => choose(ctx, st, 'whereField', 'wtree', key, focus),
			onToggle: (key, value) => {
				flipExpanded(st.whereExpanded, key, value);
				choose(ctx, st, 'whereField', 'wtree', key, true);
			},
			onActivate: (key) => {
				const item = tree.info.get(key);
				if (item && item.kind === 'source') {
					flipExpanded(st.whereExpanded, key, !st.whereExpanded.has(key));
					ctx.rerender();
					return;
				}
				add(item);
			},
			// Перенос мышью: поле — в условия компоновки (как «>»); строку условий обратно — убрать (как «<»)
			drag: (key) => {
				const item = tree.info.get(key);
				return item && item.kind === 'field' ? 'field' : '';
			},
			drop: {
				from: {
					dwhere: (payload) => {
						st.where = Number(payload.key);
						remove();
					},
				},
				place: 'zone',
			},
		});
		moves(layout, [
			{ label: '>', title: 'Добавить выбранное поле в условия компоновки', onClick: () => add(tree.info.get(st.whereField)) },
			{ label: '<', title: 'Убрать выбранную строку из условий компоновки', onClick: remove },
			{ label: '<<', title: 'Убрать все условия компоновки части', onClick: () => ctx.commit(QE.removeAllDcsWhere(ctx.state.model, address)) },
		], ctx.keys);
		const right = column(layout, 'Условия компоновки');
		const toolbar = el('div', 'dcs-qd-toolbar');
		toolbar.appendChild(
			iconButton('add', 'Добавить условие…', () => {
				const item = tree.info.get(st.whereField);
				const field = item && item.kind === 'field' ? item.alias + '.' + item.path : '';
				openExpressionWindow(ctx, {
					title: 'Условие компоновки',
					value: field ? field + ' = &' + QE.defaultParamName(field) : '',
					apply: (value) => {
						const result = QE.addDcsWhereCondition(ctx.state.model, address, value);
						if (!result.error) {
							st.where = result.index;
						}
						return ctx.commit(result);
					},
				});
			}, ctx.keys, { note: 'Условие с параметром в окне выражения' })
		);
		const move = (delta) => {
			if (!rows[st.where]) {
				ctx.note('Выберите строку в списке «Условия компоновки».');
				return;
			}
			const result = QE.moveDcsWhere(ctx.state.model, address, st.where, delta);
			st.where = result.index;
			ctx.commit(result);
		};
		toolbar.appendChild(iconButton('up', 'Переместить строку условий компоновки выше', () => move(-1), ctx.keys));
		toolbar.appendChild(iconButton('down', 'Переместить строку условий компоновки ниже', () => move(1), ctx.keys));
		right.appendChild(toolbar);
		gridView(right, {
			id: 'dwhere',
			label: 'Условия компоновки',
			className: 'dcs-qd-grid-dwhere',
			columns: ['Поле или условие', 'Использовать дочерние', 'Псевдоним'],
			rows: rows.map((row) => {
				const editText = (title, value) =>
					openExpressionWindow(ctx, {
						title: title,
						value: value,
						apply: (next) => {
							st.where = row.index;
							return ctx.commit(QE.setDcsWhereItem(ctx.state.model, address, row.index, { text: next }));
						},
					});
				if (row.kind === 'condition') {
					return {
						key: String(row.index),
						cells: [expressionCell(ctx, row.text, 'Изменить условие компоновки в окне выражения', 'dw:' + row.index + ':expr', () => editText('Условие компоновки', row.text)), '', ''],
					};
				}
				const write = (spec) => {
					st.where = row.index;
					ctx.commit(QE.setDcsWhereItem(ctx.state.model, address, row.index, spec));
				};
				const field = expressionCell(ctx, row.path, 'Условие с параметром по полю ' + row.path, 'dw:' + row.index + ':expr', () =>
					editText('Условие компоновки по полю ' + row.path, row.path + ' = &' + QE.defaultParamName(row.path))
				);
				return {
					key: String(row.index),
					cells: [
						field,
						gridCheck(ctx, row.star, 'Использовать дочерние: ' + row.path, 'dw:' + row.index + ':star', (value) => write({ star: value })),
						cellInput(ctx, row.alias || '', 'Псевдоним: ' + row.path, 'dw:' + row.index + ':alias', (value) => write({ alias: value })),
					],
				};
			}),
			selected: st.where >= 0 ? String(st.where) : '',
			keys: ctx.keys,
			empty: 'Условий компоновки нет: перенесите поле («>») или добавьте условие.',
			onSelect: (key, focus) => choose(ctx, st, 'where', 'dwhere', Number(key), focus),
			onDelete: (key) => {
				st.where = Number(key);
				remove();
			},
			// Поле встаёт в место сброса; своя строка переставляется (как ↑ ↓)
			drag: () => 'composition-where',
			drop: {
				from: {
					wtree: (payload, target) => add(tree.info.get(payload.key), dropAt(rows.length, target)),
					dwhere: (payload, target) => {
						const from = Number(payload.key);
						const delta = dropDelta(ctx, 'dwhere', rows.length, from, target);
						if (delta === 0) {
							return false;
						}
						st.where = from;
						move(delta);
					},
				},
				effect: (payload) => (payload.zone === 'wtree' ? 'copy' : 'move'),
			},
		});
		host.appendChild(layout);
	}

	// ---------------------------------------------------------------------------------------------
	// Вкладка «Характеристики»: только просмотр
	// ---------------------------------------------------------------------------------------------

	function renderCharacteristicsTab(container, ctx) {
		const texts = QE.characteristicsTexts(ctx.statement());
		texts.forEach((value, k) => {
			const view = el('pre', 'dcs-qd-chars', value);
			view.tabIndex = 0;
			view.setAttribute('role', 'region');
			view.setAttribute('aria-label', 'Блок ХАРАКТЕРИСТИКИ' + (texts.length > 1 ? ' ' + (k + 1) : ''));
			// Что блок только показывается — в подсказке и описании для читалки, а не строкой над ним
			view.title = 'Только просмотр: блок {ХАРАКТЕРИСТИКИ} правится текстом (кнопка «Запрос…»)';
			view.setAttribute('aria-description', view.title);
			container.appendChild(view);
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Окно «Запрос…»: текст запроса
	// ---------------------------------------------------------------------------------------------

	function positionText(check) {
		const at = check.firstDiff;
		return at ? 'строка ' + at.line + ', колонка ' + at.column : 'позиция не определена';
	}

	/**
	 * Режим «только текст» по самопроверке: сообщение, строка и колонка для плашки и смещение первого
	 * расхождения — на него окно «Запрос…» ставит каретку (-1 — места нет).
	 */
	function textOnlyOf(check) {
		const at = check.firstDiff;
		return {
			message: check.message || 'Текст не разобран',
			line: at ? at.line : 0,
			column: at ? at.column : 0,
			offset: at && typeof at.offset === 'number' ? at.offset : -1,
		};
	}

	/**
	 * Каретка на месте ошибки, как у отказа ОК окна текста. Сначала выделение, потом фокус: само
	 * выделение поле к каретке не прокручивает, а фокус поля с готовым выделением прокручивает.
	 */
	function caretAt(input, offset) {
		const at = Math.min(Math.max(offset, 0), input.value.length);
		input.setSelectionRange(at, at);
		input.focus();
	}

	/** Текст, который запишет ОК: сборка со сплайсом и явными КАК изменённых частей (как при записи). */
	function currentText(state) {
		if (state.textOnly) {
			return state.text;
		}
		return Q.build(QE.finalize(state.model, state.baseline));
	}

	/**
	 * Просмотр и правка текста. После правки текст заново раскладывается по вкладкам: разбор и
	 * самопроверка не сошлись — ошибка со строкой и колонкой, текст не принимается (в режиме «только
	 * текст» принимается любой: другого способа править у окна нет).
	 */
	function openTextWindow(state, rerender) {
		const before = currentText(state);
		let editor = null;
		api.pushDialog({
			title: state.nested ? 'Текст вложенного запроса' : 'Текст запроса',
			width: 'full',
			build: (body) => {
				if (state.textOnly) {
					body.appendChild(el('div', 'struct-hint', 'Текст не раскладывается по вкладкам: правьте его здесь. Когда он разберётся без ошибок, вкладки вернутся.'));
				}
				editor = api.codeEditor(before, 'dcs-query dcs-qd-text');
				editor.input.setAttribute('aria-label', 'Текст запроса');
				body.appendChild(editor.box);
				api.attachCompletion(editor.input, () => 'query', { letters: false });
				// Текст, который не разложился по вкладкам, открывается на месте расхождения: его и правят.
				// Фокус, поставленный здесь, стек не перебивает (поле уже в окне)
				if (state.textOnly && !state.nested && state.textOnly.offset >= 0) {
					caretAt(editor.input, state.textOnly.offset);
				}
			},
			buttons: [
				{
					id: 'ok',
					label: 'ОК',
					primary: true,
					onClick: (level) => {
						const value = editor.input.value;
						if (value === before) {
							level.close();
							return undefined;
						}
						const check = Q.selfCheck(value);
						if (state.textOnly && !state.nested) {
							state.text = value;
							state.textEdited = true;
							if (check.ok) {
								acceptText(state, value);
							} else {
								state.textOnly = textOnlyOf(check);
							}
							level.close();
							rerender();
							return undefined;
						}
						if (!check.ok) {
							if (check.firstDiff && typeof check.firstDiff.offset === 'number') {
								caretAt(editor.input, check.firstDiff.offset);
							}
							return 'Текст не принят (' + positionText(check) + '): ' + (check.message || 'ошибка разбора') + '.';
						}
						if (state.nested) {
							const parsed = Q.parse(value).model;
							if (parsed.statements.length !== 1 || parsed.statements[0].type !== 'select') {
								return 'Вложенный запрос должен быть одним запросом выборки без «;».';
							}
						}
						acceptText(state, value);
						state.textEdited = true;
						level.close();
						rerender();
						return undefined;
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	/** Принятый текст становится моделью окна; он же — исходник сплайса для «изменённых частей». */
	function acceptText(state, value) {
		const model = value.trim() === '' ? QE.newModel(value, state.model ? state.model.lang : 'ru') : Q.parse(value).model;
		if (state.nested) {
			model.original = { count: 0, tail: '' };
			for (const statement of model.statements) {
				delete statement.original;
			}
		}
		state.model = model;
		state.baseline = QE.clone(model);
		state.textOnly = null;
		// Отложенные запросы «Уничтожения ВТ» привязаны к местам прежней модели
		state.stash.clear();
		state.statement = Math.min(state.statement, Math.max(0, model.statements.length - 1));
		state.part = 0;
	}

	// ---------------------------------------------------------------------------------------------
	// Каркас окна конструктора
	// ---------------------------------------------------------------------------------------------

	function newState(options) {
		return {
			nested: Boolean(options.nested),
			title: options.title || 'Конструктор запроса',
			model: null,
			initial: null,
			baseline: null,
			originalText: '',
			text: '',
			textOnly: null,
			textEdited: false,
			dataSet: options.dataSet || null,
			outerTemp: options.outerTemp || [],
			// Параметры внешнего пакета (у вложенного запроса): список значений параметров ВТ (QE.usedParameters)
			outerParams: options.outerParams || [],
			onOk: options.onOk || null,
			statement: 0,
			part: 0,
			tab: 'tables',
			notes: [],
			focus: '',
			db: { expanded: new Set(), collapsed: new Set(), selected: '', search: '', sorted: false, limits: new Map() },
			tables: { expanded: new Set(), selected: '' },
			fields: { selected: -1 },
			// «Связи» (custom — строки, которые показываются текстом, хоть и простые), «Группировка», «Условия»
			links: { selected: '', custom: new Set() },
			grouping: { selected: '', expanded: new Set(), collapsed: new Set(), groupSel: -1, sumSel: -1 },
			conditions: { selected: '', field: '', expanded: new Set(), custom: new Set() },
			pendingLinks: [],
			// Выбор в списках вкладок; stash — прежний запрос пакета, заменённый уничтожением ВТ (по индексу)
			index: { selected: 0, avail: '', field: -1 },
			union: { column: -1 },
			order: { selected: '', expanded: new Set(), row: -1 },
			composition: { sub: 'tables', table: '', avail: '', field: -1, where: -1, whereField: '', whereExpanded: new Set() },
			stash: new Map(),
		};
	}

	/** Вход по тексту набора: разбор и самопроверка; пустой текст — новый запрос. */
	function enterText(state, sourceText) {
		state.originalText = sourceText;
		state.text = sourceText;
		if (sourceText.trim() === '') {
			state.model = QE.newModel(sourceText);
			state.initial = QE.clone(state.model);
			state.baseline = QE.clone(state.model);
			return;
		}
		const check = Q.selfCheck(sourceText);
		if (!check.ok) {
			state.textOnly = textOnlyOf(check);
			return;
		}
		state.model = Q.parse(sourceText).model;
		state.initial = QE.clone(state.model);
		state.baseline = QE.clone(state.model);
		// Последний запрос пакета — тот, чьи поля станут полями набора: с него и начинаем
		state.statement = Math.max(0, state.model.statements.length - 1);
	}

	/**
	 * Временные таблицы пакета до запроса statementIndex (и внешнего пакета у вложенного запроса): каждая
	 * помнит свой пакет, чтобы тип колонки выводился по запросу, который её создал.
	 */
	function tempTablesOf(state, statementIndex) {
		return state.outerTemp.concat(Q.tempTables(state.model, statementIndex).map((table) => Object.assign({ batch: state.model }, table)));
	}

	/** Тип колонки временной таблицы (вывод по запросу-создателю); описаний нет — null, ответ перерисует окно. */
	function tempColumnType(table, column) {
		if (!table || !table.batch) {
			return null;
		}
		return api.batchColumnType(table.batch, table.statement, column).type || null;
	}

	/**
	 * Тип колонки вложенного запроса части (вывод по его источникам; ВТ — пакета до запроса и внешние
	 * у вложенного конструктора); описаний нет — null, ответ перерисует окно.
	 */
	function subqueryColumnTypeOf(state, statementIndex, source, column) {
		if (!source || !source.query) {
			return null;
		}
		return api.subqueryColumnType(state.model, statementIndex, source.query, column, state.outerTemp).type || null;
	}

	/**
	 * Окружение полей источников (QE.fieldsOfSource и всё, что на нём): описания таблиц, ВТ пакета и
	 * типы их колонок, типы колонок вложенных запросов.
	 */
	function sourceEnv(state, statementIndex) {
		return {
			describe: api.describeTable,
			tempTables: tempTablesOf(state, statementIndex),
			tempType: tempColumnType,
			subqueryType: (source, column) => subqueryColumnTypeOf(state, statementIndex, source, column),
		};
	}

	function makeContext(state, keys, rerender) {
		const ctx = {
			state: state,
			keys: keys,
			nested: state.nested,
			lang: state.model && state.model.lang === 'en' ? 'en' : 'ru',
			dbInfo: null,
			tablesInfo: null,
			address: () => ({ statement: state.statement, part: state.part }),
			statement: () => QE.statementAt(state.model, { statement: state.statement, part: state.part }),
			part: () => QE.partAt(state.model, { statement: state.statement, part: state.part }),
			rerender: rerender,
			tempTables: () => tempTablesOf(state, state.statement),
			fieldsOf: (source) => QE.fieldsOfSource(source, sourceEnv(state, state.statement)),
			/** Результат операции: новая модель и предупреждения или отказ; возвращает текст отказа. */
			commit: (result) => {
				if (!result || result.error) {
					const error = result ? result.error : 'Правка не выполнена.';
					state.notes = [error];
					rerender();
					return error;
				}
				state.model = result.model;
				state.notes = Array.isArray(result.warnings) ? result.warnings.slice() : [];
				rerender();
				return '';
			},
			note: (text) => {
				state.notes = [text];
				rerender();
			},
			select: (list, key, focus) => {
				state[list === 'db' ? 'db' : list === 'tables' ? 'tables' : 'fields'].selected = list === 'fields' ? Number(key) : key;
				state.focus = focus ? list + ':' + key : '';
				rerender();
			},
		};
		return ctx;
	}

	/**
	 * Запросы пакета и части объединения — вертикальные вкладки у правого края окна, как у конструктора
	 * конфигуратора. Ближе к содержимому — части текущего запроса, у самого края —
	 * запросы пакета; полоса видна, когда выбирать есть из чего (запросов или частей больше одного).
	 * Каждая полоса — одна остановка Tab, ↑ ↓ Home End выбирают вкладку. Вкладки переключают всё
	 * содержимое слева (main): оно — панель, названная активными вкладками обеих полос.
	 */
	function renderSideTabs(root, main, ctx) {
		const state = ctx.state;
		const statements = state.model.statements;
		const statement = ctx.statement();
		const labelledBy = [];
		const side = [];
		if (statement && statement.parts.length > 1) {
			const built = tabStrip({
				label: 'Часть объединения',
				className: 'dcs-qd-vtabs',
				orientation: 'vertical',
				controls: main,
				// Имя начинается с ярлыка (голосовая команда по видимому тексту) и говорит, что это часть: область
				// слева названа обеими вкладками, и «Запрос пакета 2 … Запрос 1» без пояснения читалось бы неоднозначно
				items: statement.parts.map((_part, index) => ({ id: String(index), title: 'Запрос ' + (index + 1), name: 'Запрос ' + (index + 1) + ', часть объединения' })),
				active: String(state.part),
				keyPrefix: 'qpart:',
				keys: ctx.keys,
				onPick: (id) => selectPart(ctx, Number(id), 'qpart:' + id),
			});
			side.push(built.strip);
			labelledBy.push(built.activeId);
		}
		if (statements.length > 1) {
			const built = tabStrip({
				label: 'Запрос пакета',
				className: 'dcs-qd-vtabs dcs-qd-vtabs-batch',
				orientation: 'vertical',
				controls: main,
				items: statements.map((item, index) => ({ id: String(index), title: QE.statementTabLabel(item, index), name: QE.statementLabel(item, index) })),
				active: String(state.statement),
				keyPrefix: 'qstmt:',
				keys: ctx.keys,
				onPick: (id) => selectStatement(ctx, Number(id), 'qstmt:' + id),
			});
			side.push(built.strip);
			// Запрос пакета называет область первым: часть объединения — внутри него
			labelledBy.unshift(built.activeId);
		}
		if (side.length === 0) {
			return;
		}
		main.setAttribute('role', 'tabpanel');
		main.setAttribute('aria-labelledby', labelledBy.filter(Boolean).join(' '));
		for (const strip of side) {
			root.appendChild(strip);
		}
	}

	function resetSelection(state) {
		state.tables.selected = '';
		state.tables.expanded.clear();
		state.fields.selected = -1;
		state.links.selected = '';
		state.links.custom.clear();
		state.grouping.selected = '';
		state.grouping.groupSel = -1;
		state.grouping.sumSel = -1;
		state.conditions.selected = '';
		state.conditions.field = '';
		state.conditions.custom.clear();
		state.index.selected = 0;
		state.index.avail = '';
		state.index.field = -1;
		state.union.column = -1;
		state.order.selected = '';
		state.order.row = -1;
		state.composition.table = '';
		state.composition.avail = '';
		state.composition.field = -1;
		state.composition.where = -1;
		state.composition.whereField = '';
		state.notes = [];
	}

	function renderBody(body, ctx) {
		const state = ctx.state;
		const root = el('div', 'dcs-qd');
		if (state.textOnly) {
			const where = state.textOnly.line ? 'строка ' + state.textOnly.line + ', колонка ' + state.textOnly.column : 'позиция не определена';
			root.appendChild(
				el(
					'div',
					'dcs-plate dcs-plate-error dcs-qd-textonly',
					'Текст не раскладывается по вкладкам (' + where + ': ' + state.textOnly.message + '). Доступен только текст (кнопка «Запрос…»).' +
						(state.textEdited ? ' ОК запишет исправленный текст как есть.' : '')
				)
			);
			body.appendChild(root);
			return;
		}
		// Описания таблиц приходят перерисовкой: тогда и предлагается связь для добавленной таблицы
		processPendingLinks(ctx);
		// Слева — вкладки конструктора с содержимым, справа — вертикальные вкладки запросов пакета и частей
		const main = el('div', 'dcs-qd-main');
		root.appendChild(main);
		renderSideTabs(root, main, ctx);
		const tabs = visibleTabs(ctx);
		if (!tabs.some((tab) => tab.id === state.tab)) {
			state.tab = tabs[0].id;
		}
		const built = tabStrip({
			label: 'Вкладки конструктора',
			className: 'tabs dcs-subtabs dcs-qd-tabs',
			panelClass: 'dcs-qd-panel',
			items: tabs,
			active: state.tab,
			keyPrefix: 'tab:',
			keys: ctx.keys,
			onPick: (id) => {
				state.tab = id;
				state.focus = 'tab:' + id;
				ctx.rerender();
			},
		});
		main.appendChild(built.strip);
		tabs.find((tab) => tab.id === state.tab).render(built.panel, ctx);
		main.appendChild(built.panel);
		body.appendChild(root);
	}

	/**
	 * Видимые вкладки и номер текущей среди них — для «< Назад / Далее >». В режиме «только текст»
	 * вкладок нет (index -1): обе кнопки недоступны. Звать после renderBody: он поправляет state.tab,
	 * если прежняя вкладка у этого запроса не видна.
	 */
	function tabPlace(ctx) {
		const tabs = ctx.state.textOnly ? [] : visibleTabs(ctx);
		return { tabs: tabs, index: tabs.findIndex((tab) => tab.id === ctx.state.tab) };
	}

	/**
	 * Есть ли в окне правки — знак «*» в заголовке, как у конструктора платформы. Модель сравнивается с
	 * исходной; правленный текст окна «Запрос…» — тоже правка, даже если модель вышла той же (ОК тогда
	 * всё равно сверит собранный текст с исходным и лишнего не запишет). В режиме «только текст» —
	 * текст, отличный от исходного.
	 */
	function isModified(state) {
		if (state.textOnly) {
			return state.textEdited && state.text !== state.originalText;
		}
		return (!state.nested && state.textEdited) || !Q.sameModel(state.model, state.initial);
	}

	/**
	 * Строка заметок окна (отказы действий и предупреждения правок) — живой регион, который переживает
	 * перерисовку: читалки объявляют изменение текста существующего региона, а только что вставленный
	 * регион с готовым текстом обычно молчат. Поэтому он стоит рядом с перерисовываемым телом, а не в нём.
	 */
	function notesRegion(body) {
		const notes = el('div', 'dcs-qd-notes');
		notes.setAttribute('role', 'status');
		notes.setAttribute('aria-live', 'polite');
		body.appendChild(notes);
		return notes;
	}

	/** Подтверждение перед записью: в изменённых запросах пакета пропадут комментарии. */
	function confirmComments(count, proceed) {
		api.pushDialog({
			title: 'Комментарии в запросе',
			build: (body) => {
				body.appendChild(
					el(
						'div',
						'dcs-confirm-text',
						'В изменённых запросах пакета есть комментарии (' + count + '): конструктор собирает такие запросы заново, и комментарии пропадут. Неизменённые запросы пакета запишутся как были.'
					)
				);
			},
			buttons: [
				{
					id: 'continue',
					label: 'Продолжить',
					primary: true,
					onClick: (level) => {
						level.close();
						return proceed();
					},
				},
				{ id: 'cancel', label: 'Отмена' },
			],
		});
	}

	/** Запись текста набора: недостающие &-параметры (без учёта регистра) и автозаполнение — пакетом панели. */
	function applyText(state, text) {
		const declared = (api.model().parameters || []).map((param) => upper(param && param.name));
		const missing = Q.parametersOf(text).filter((name) => declared.indexOf(upper(name)) < 0);
		const sent = api.send('dcs/apply-query', {
			dataSet: state.dataSet.path,
			text: text,
			addParameters: missing,
			autofill: Boolean(state.dataSet.autoFill),
		});
		return sent ? undefined : api.busyText;
	}

	function submitTop(state, level) {
		if (api.isSaving()) {
			return api.busyText;
		}
		if (state.textOnly) {
			if (!state.textEdited || state.text === state.originalText) {
				level.close();
				return undefined;
			}
			return applyText(state, state.text);
		}
		if (!state.textEdited && Q.sameModel(state.model, state.initial)) {
			level.close();
			return undefined;
		}
		const issues = QE.problems(state.model, { autofill: Boolean(state.dataSet && state.dataSet.autoFill) });
		if (issues.length > 0) {
			return issues[0];
		}
		const report = Q.buildWithReport(QE.finalize(state.model, state.baseline));
		if (report.text === state.originalText) {
			level.close();
			return undefined;
		}
		const check = Q.selfCheck(report.text);
		if (!check.ok) {
			return 'Собранный текст не прошёл самопроверку (' + positionText(check) + ': ' + check.message + '), запрос не записан.';
		}
		const write = () => {
			if (report.comments.dropped > 0) {
				confirmComments(report.comments.dropped, () => {
					const error = applyText(state, report.text);
					if (error) {
						level.setError(error);
					}
					return undefined;
				});
				return undefined;
			}
			return applyText(state, report.text);
		};
		// Предупреждения проверки имён ОК не блокируют: вывод по метаданным может не знать всего, а
		// окончательно текст проверяет платформа — поэтому только вопрос перед записью
		const names = nameProblemsOf(state);
		if (names.length > 0) {
			confirmNames(state.model, names, () => {
				const error = write();
				if (error) {
					level.setError(error);
				}
				return undefined;
			});
			return undefined;
		}
		return write();
	}

	function submitNested(state, level) {
		if (!Q.sameModel(state.model, state.initial)) {
			const issues = QE.problems(state.model);
			if (issues.length > 0) {
				return issues[0];
			}
			const final = QE.finalize(state.model, state.baseline);
			const error = state.onOk(final.statements[0]);
			if (error) {
				return error;
			}
		}
		level.close();
		return undefined;
	}

	/**
	 * Открывает конструктор. options: {dataSet: путь набора, text, autoFill} — основной уровень над
	 * текстом набора; {nested: true, title, model, outerTemp, outerParams, onOk(statement) → ошибка} — второй
	 * уровень над вложенным запросом (модель из одного запроса, ВТ внешнего пакета видны в дереве);
	 * refocus — возврат фокуса на вызвавшую кнопку внешнего уровня после закрытия.
	 */
	function openConstructor(options) {
		const opts = options || {};
		const state = newState(opts);
		if (state.nested) {
			state.model = opts.model;
			state.initial = QE.clone(opts.model);
			state.baseline = QE.clone(opts.model);
		} else {
			state.dataSet = { path: String(opts.dataSet || ''), autoFill: opts.autoFill === true };
			enterText(state, typeof opts.text === 'string' ? opts.text : '');
		}
		const keys = createKeys();
		let level = null;
		// Тело окна: перерисовываемая часть и постоянная строка заметок (живой регион) за ней
		let host = null;
		let notes = null;

		function paint(body, owner) {
			if (!host || host.parentElement !== body) {
				body.textContent = '';
				host = el('div');
				body.appendChild(host);
				notes = notesRegion(body);
			}
			host.textContent = '';
			const ctx = makeContext(state, keys, render);
			renderBody(host, ctx);
			const text = state.textOnly ? '' : state.notes.join(' ');
			if (notes.textContent !== text) {
				notes.textContent = text;
			}
			// Подвал и заголовок зависят от вкладки и правок: обновляются той же перерисовкой (уровня ещё нет
			// только при первой сборке тела — тогда их ставит render сразу после открытия)
			if (owner) {
				owner.setButtons(footer(tabPlace(ctx)));
				owner.setTitle(state.title, isModified(state));
			}
		}

		/**
		 * Подвал как у конструктора платформы: «Запрос…», «< Назад», «Далее >», ОК, Отмена. На краях
		 * «Назад»/«Далее» недоступны, но остаются в обходе Tab (unavailable — aria-disabled).
		 */
		function footer(place) {
			return [
				{ id: 'query', label: 'Запрос…', onClick: () => openTextWindow(state, render) },
				{ id: 'back', label: '< Назад', unavailable: place.index <= 0, onClick: () => stepTab(-1) },
				{ id: 'next', label: 'Далее >', unavailable: place.index < 0 || place.index >= place.tabs.length - 1, onClick: () => stepTab(1) },
				{ id: 'ok', label: 'ОК', primary: true, onClick: (current) => (state.nested ? submitNested(state, current) : submitTop(state, current)) },
				{ id: 'cancel', label: 'Отмена' },
			];
		}

		/**
		 * Соседняя видимая вкладка. Фокус — на её ярлык: читалка называет вкладку, а стрелки дальше
		 * листают полосу; кнопка же на последней вкладке гаснет, и фокус на ней ничего бы не дал.
		 */
		function stepTab(delta) {
			const place = tabPlace(makeContext(state, keys, render));
			const to = place.index >= 0 ? place.tabs[place.index + delta] : null;
			if (to) {
				state.tab = to.id;
				state.focus = 'tab:' + to.id;
				render();
			}
			return undefined;
		}

		function render() {
			if (!level || !level.isOpen()) {
				return;
			}
			const active = document.activeElement;
			const activeKey = active && typeof active.getAttribute === 'function' ? active.getAttribute('data-qd-key') : null;
			const caret = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
			const lost = lostRow(keys, active);
			const scrolled = scrollPositions(level.body);
			const bodyScroll = level.body.scrollTop || 0;
			keys.clear();
			paint(level.body, level);
			restoreScroll(level.body, scrolled);
			if (bodyScroll) {
				level.body.scrollTop = bodyScroll;
			}
			const want = state.focus || activeKey;
			state.focus = '';
			const target = want ? keys.get(want) : null;
			if (target && document.activeElement !== target) {
				target.focus();
				if (caret !== null && want === activeKey && typeof target.setSelectionRange === 'function') {
					target.setSelectionRange(caret, caret);
				}
			} else if (!target && want === activeKey) {
				focusNeighbor(keys, lost);
			}
		}

		level = api.pushDialog({
			title: state.title,
			width: 'full',
			build: (body) => {
				paint(body, null);
			},
			// Место вкладки до первой перерисовки неизвестно: края уточнит render сразу после открытия
			buttons: footer({ tabs: [], index: -1 }),
			onClose: () => {
				removeRenderer(render);
				if (opts.refocus) {
					opts.refocus();
				}
			},
		});
		addRenderer(render);
		if (api.metadata.available()) {
			api.metadata.request();
		}
		// Тело собрано до появления уровня: подвал и заголовок по вкладке и правкам ставит эта перерисовка
		render();
		return level;
	}

	window.DcsQueryDialog = Object.freeze({ open: openConstructor });
})();
