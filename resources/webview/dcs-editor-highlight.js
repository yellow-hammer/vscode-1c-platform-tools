/**
 * Подсветка языка запросов и выражений СКД и переключение строчных комментариев (Ctrl+/):
 * чистые функции без DOM.
 *
 * Webview подключает файл перед dcs-editor.js и берёт функции из window.DcsHighlight,
 * node-тесты исполняют его в песочнице и читают module.exports. Поэтому здесь нет
 * document и acquireVsCodeApi.
 */
(function (root) {
	'use strict';

	/** Выше этого размера подсветка отключается: разбор на каждую правку дороже пользы. */
	const HIGHLIGHT_LIMIT = 100 * 1024;

	/** Ключевые слова, русские и английские, в верхнем регистре: сравнение без учёта регистра. */
	const KEYWORDS = new Set([
		'ВЫБРАТЬ', 'SELECT', 'РАЗРЕШЕННЫЕ', 'ALLOWED', 'РАЗЛИЧНЫЕ', 'DISTINCT', 'ПЕРВЫЕ', 'TOP',
		'КАК', 'AS', 'ИЗ', 'FROM', 'ГДЕ', 'WHERE', 'СГРУППИРОВАТЬ', 'GROUP', 'ПО', 'BY', 'ON',
		'ИМЕЮЩИЕ', 'HAVING', 'УПОРЯДОЧИТЬ', 'ORDER', 'ИТОГИ', 'TOTALS', 'ОБЩИЕ', 'OVERALL',
		'ОБЪЕДИНИТЬ', 'UNION', 'ВСЕ', 'ALL', 'СОЕДИНЕНИЕ', 'JOIN', 'ЛЕВОЕ', 'LEFT', 'ПРАВОЕ', 'RIGHT',
		'ПОЛНОЕ', 'FULL', 'ВНУТРЕННЕЕ', 'INNER', 'ВНЕШНЕЕ', 'OUTER', 'И', 'AND', 'ИЛИ', 'OR',
		'НЕ', 'NOT', 'В', 'IN', 'ИЕРАРХИИ', 'HIERARCHY', 'ИЕРАРХИЯ', 'ТОЛЬКО', 'ONLY',
		'МЕЖДУ', 'BETWEEN', 'ЕСТЬ', 'IS', 'NULL', 'ПОДОБНО', 'LIKE', 'СПЕЦСИМВОЛ', 'ESCAPE',
		'ВЫБОР', 'CASE', 'КОГДА', 'WHEN', 'ТОГДА', 'THEN', 'ИНАЧЕ', 'ELSE', 'КОНЕЦ', 'END',
		'ВЫРАЗИТЬ', 'CAST', 'ПОМЕСТИТЬ', 'INTO', 'УНИЧТОЖИТЬ', 'DROP', 'ИНДЕКСИРОВАТЬ', 'INDEX',
		'ВОЗР', 'ASC', 'УБЫВ', 'DESC', 'АВТОУПОРЯДОЧИВАНИЕ', 'AUTOORDER', 'ДЛЯ', 'FOR',
		'ИЗМЕНЕНИЯ', 'UPDATE', 'ПУСТАЯТАБЛИЦА', 'EMPTYTABLE', 'ССЫЛКА', 'REFS',
		'ИСТИНА', 'TRUE', 'ЛОЖЬ', 'FALSE', 'НЕОПРЕДЕЛЕНО', 'UNDEFINED', 'ПЕРИОДАМИ', 'PERIODS',
		'ЧИСЛО', 'NUMBER', 'СТРОКА', 'STRING', 'ДАТА', 'DATE', 'БУЛЕВО', 'BOOLEAN',
		'ГРУППИРУЮЩИМ', 'GROUPING', 'НАБОРАМ', 'SETS',
		// Временные таблицы 8.3.25 и блок характеристик; ДОБАВИТЬ и УНИКАЛЬНО без английской пары:
		// модель запроса знает их только по-русски
		'ДОБАВИТЬ', 'УНИКАЛЬНО', 'ХАРАКТЕРИСТИКИ', 'CHARACTERISTICS',
	]);

	/**
	 * Функции языка запросов и выражений СКД в обеих раскладках. Подсвечиваются только со
	 * скобкой вызова: без неё «День» или «Количество» это имена полей.
	 */
	const FUNCTIONS = new Set([
		'СУММА', 'SUM', 'КОЛИЧЕСТВО', 'COUNT', 'СРЕДНЕЕ', 'AVG', 'МИНИМУМ', 'MIN', 'МАКСИМУМ', 'MAX',
		'ПОДСТРОКА', 'SUBSTRING', 'ГОД', 'YEAR', 'КВАРТАЛ', 'QUARTER', 'МЕСЯЦ', 'MONTH',
		'ДЕНЬГОДА', 'DAYOFYEAR', 'ДЕНЬ', 'DAY', 'НЕДЕЛЯ', 'WEEK', 'НЕДЕЛЯГОДА', 'WEEKOFYEAR',
		'ДЕНЬНЕДЕЛИ', 'WEEKDAY', 'ЧАС', 'HOUR', 'МИНУТА', 'MINUTE', 'СЕКУНДА', 'SECOND',
		'НАЧАЛОПЕРИОДА', 'BEGINOFPERIOD', 'КОНЕЦПЕРИОДА', 'ENDOFPERIOD',
		'ДОБАВИТЬКДАТЕ', 'DATEADD', 'РАЗНОСТЬДАТ', 'DATEDIFF', 'ДАТАВРЕМЯ', 'DATETIME',
		'ЗНАЧЕНИЕ', 'VALUE', 'ТИП', 'TYPE', 'ТИПЗНАЧЕНИЯ', 'VALUETYPE', 'ЕСТЬNULL', 'ISNULL',
		'ПРЕДСТАВЛЕНИЕ', 'PRESENTATION', 'ПРЕДСТАВЛЕНИЕССЫЛКИ', 'REFPRESENTATION',
		'АВТОНОМЕРЗАПИСИ', 'RECORDAUTONUMBER', 'РАЗМЕРХРАНИМЫХДАННЫХ', 'STOREDDATASIZE',
		'ВЫЧИСЛИТЬ', 'EVAL', 'ВЫЧИСЛИТЬВЫРАЖЕНИЕ', 'EVALEXPRESSION',
		'ВЫЧИСЛИТЬВЫРАЖЕНИЕСГРУППИРОВКОЙМАССИВ', 'EVALEXPRESSIONWITHGROUPARRAY',
		'ВЫЧИСЛИТЬВЫРАЖЕНИЕСГРУППИРОВКОЙТАБЛИЦАЗНАЧЕНИЙ', 'EVALEXPRESSIONWITHGROUPVALUETABLE',
		'ВРЕГ', 'UPPER', 'НРЕГ', 'LOWER', 'СОКРЛ', 'TRIML', 'СОКРП', 'TRIMR', 'СОКРЛП', 'TRIMALL',
		'ДЛИНАСТРОКИ', 'STRINGLENGTH', 'СТРНАЙТИ', 'STRFIND', 'СТРЗАМЕНИТЬ', 'STRREPLACE',
		// LEFT и RIGHT есть и в ключевых словах: со скобкой это функции
		'ЛЕВ', 'LEFT', 'ПРАВ', 'RIGHT', 'ОКР', 'ROUND', 'ЦЕЛ', 'INT',
		'ACOS', 'ASIN', 'ATAN', 'COS', 'SIN', 'TAN', 'EXP', 'LOG', 'LOG10', 'POW', 'SQRT',
		// Функции встроенного языка в выражениях СКД
		'ФОРМАТ', 'FORMAT', 'ЗНАЧЕНИЕЗАПОЛНЕНО', 'VALUEISFILLED', 'НСТР', 'NSTR',
		'СОЕДИНИТЬСТРОКИ', 'JOINSTRINGS', 'СТРШАБЛОН', 'STRTEMPLATE', 'ТЕКУЩАЯДАТА', 'CURRENTDATE',
		'ТЕКУЩАЯДАТАСЕАНСА', 'CURRENTSESSIONDATE', 'УНИВЕРСАЛЬНОЕВРЕМЯ', 'TOUNIVERSALTIME',
		'ПРЕДСТАВЛЕНИЕПЕРИОДА', 'PERIODPRESENTATION', 'МАССИВ', 'ARRAY', 'УРОВЕНЬ', 'LEVEL',
		// СТРОКА и ДАТА есть и в ключевых словах: после КАК это тип приведения
		'СТРОКА', 'STRING', 'ДАТА', 'DATE',
	]);

	/** Точки здесь нет: это разделитель пути, а не оператор. */
	const OPERATORS = new Set(['(', ')', '+', '-', '*', '/', '%', '<', '>', '=', ',', ';']);

	// Флаг y: exec с позиции lastIndex без среза строки на каждую лексему
	const WORD_RE = /[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*/y;
	const NUMBER_RE = /\d+(?:\.\d+)?/y;

	function matchAt(re, text, index) {
		re.lastIndex = index;
		const found = re.exec(text);
		return found ? found[0] : '';
	}

	/**
	 * Конец строкового литерала, `""` внутри экранирует кавычку. Незакрытая строка кончается
	 * на конце строки текста, чтобы подсветка не захватила весь хвост запроса.
	 */
	function stringEnd(text, start) {
		let i = start + 1;
		while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
			if (text[i] === '"') {
				if (text[i + 1] === '"') {
					i += 2;
					continue;
				}
				return { end: i + 1, closed: true };
			}
			i += 1;
		}
		return { end: i, closed: false };
	}

	function nextMeaningfulChar(text, index) {
		let i = index;
		while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
			i += 1;
		}
		return text[i] || '';
	}

	/**
	 * Разбирает текст запроса или выражения СКД на токены подсветки.
	 *
	 * Токены покрывают текст без пропусков, чтобы зеркало-pre повторяло textarea символ в символ.
	 * Типы: keyword, func, string, number, param, comment, operator и text.
	 *
	 * @param {string} text Текст запроса или выражения.
	 * @returns {{type: string, value: string}[]} Токены в порядке следования.
	 */
	function tokenize(text) {
		const source = typeof text === 'string' ? text : '';
		const tokens = [];
		let plainStart = 0;
		let i = 0;
		// В «КАК СТРОКА(10)» СТРОКА ключевое слово, а не вызов функции
		let lastWord = '';

		function push(type, end) {
			if (i > plainStart) {
				tokens.push({ type: 'text', value: source.slice(plainStart, i) });
			}
			tokens.push({ type: type, value: source.slice(i, end) });
			i = end;
			plainStart = end;
		}

		while (i < source.length) {
			const ch = source[i];
			if (ch === '/' && source[i + 1] === '/') {
				let end = source.indexOf('\n', i);
				if (end < 0) {
					end = source.length;
				}
				push('comment', end);
				continue;
			}
			if (ch === '"') {
				lastWord = '';
				push('string', stringEnd(source, i).end);
				continue;
			}
			if (ch === '&') {
				lastWord = '';
				const word = matchAt(WORD_RE, source, i + 1);
				if (word !== '') {
					push('param', i + 1 + word.length);
				} else {
					push('operator', i + 1);
				}
				continue;
			}
			const word = matchAt(WORD_RE, source, i);
			if (word !== '') {
				const upper = word.toUpperCase();
				// После точки идёт часть пути данных: в «Таблица.День» День это поле
				const afterDot = i > 0 && source[i - 1] === '.';
				const castType = (lastWord === 'КАК' || lastWord === 'AS') && KEYWORDS.has(upper);
				lastWord = afterDot ? '' : upper;
				if (!afterDot && !castType && FUNCTIONS.has(upper) && nextMeaningfulChar(source, i + word.length) === '(') {
					push('func', i + word.length);
				} else if (!afterDot && KEYWORDS.has(upper)) {
					push('keyword', i + word.length);
				} else {
					i += word.length;
				}
				continue;
			}
			const number = matchAt(NUMBER_RE, source, i);
			if (number !== '') {
				lastWord = '';
				push('number', i + number.length);
				continue;
			}
			if (OPERATORS.has(ch)) {
				lastWord = '';
				push('operator', i + 1);
				continue;
			}
			if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') {
				lastWord = '';
			}
			i += 1;
		}
		if (source.length > plainStart) {
			tokens.push({ type: 'text', value: source.slice(plainStart) });
		}
		return tokens;
	}

	/**
	 * Проверка парности скобок и кавычек для подсказки под редактором.
	 *
	 * Скобки в строках и комментариях не считаются, как у токенайзера.
	 *
	 * @param {string} text Текст запроса или выражения.
	 * @returns {string} Текст предупреждения либо пустая строка.
	 */
	function delimiterWarning(text) {
		const source = typeof text === 'string' ? text : '';
		let depth = 0;
		let extraClose = 0;
		let openQuote = false;
		let i = 0;
		while (i < source.length) {
			const ch = source[i];
			if (ch === '/' && source[i + 1] === '/') {
				let end = source.indexOf('\n', i);
				if (end < 0) {
					end = source.length;
				}
				i = end;
				continue;
			}
			if (ch === '"') {
				const str = stringEnd(source, i);
				if (!str.closed) {
					openQuote = true;
				}
				i = str.end;
				continue;
			}
			if (ch === '(') {
				depth += 1;
			} else if (ch === ')') {
				if (depth === 0) {
					extraClose += 1;
				} else {
					depth -= 1;
				}
			}
			i += 1;
		}
		const parts = [];
		if (openQuote) {
			parts.push('не закрыта кавычка');
		}
		if (depth > 0) {
			parts.push('не хватает закрывающих скобок: ' + depth);
		}
		if (extraClose > 0) {
			parts.push('лишних закрывающих скобок: ' + extraClose);
		}
		if (parts.length === 0) {
			return '';
		}
		return 'Проверьте парность: ' + parts.join(', ') + '.';
	}

	const LINE_COMMENT = '//';

	function clampOffset(value, length, fallback) {
		const number = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
		return Math.min(Math.max(number, 0), length);
	}

	/**
	 * Закомментирует или раскомментирует строки выделения (Ctrl+/).
	 *
	 * Если каждая непустая строка после отступа начинается с `//`, префикс снимается, иначе
	 * `//` ставится каждой непустой строке перед первым непробельным символом, уже
	 * закомментированные получают второй слой. Пустые строки в решении не участвуют, чтобы
	 * пустая строка между закомментированными не меняла «снять» на «поставить». Если пустые
	 * все строки, префикс ставится им, чтобы сразу набирать комментарий.
	 *
	 * Префикс ровно `//` без пробела: снятие возвращает байт в байт строки, закомментированные
	 * этой командой, а пробел после `//`, набранный вручную, остаётся. Конец строки
	 * (LF или CRLF) не меняется. Выделение, которое кончается в начале строки (выделение
	 * целых строк), эту строку не захватывает.
	 *
	 * Каретка остаётся перед тем же символом. Начало непустого выделения в точке вставки
	 * остаётся левее `//`, конец правее; смещение внутри снятого `//` прижимается к его началу.
	 * Двойное переключение незакомментированных строк возвращает и текст, и выделение.
	 *
	 * @param {string} text Текст поля.
	 * @param {number} selStart Начало выделения.
	 * @param {number} selEnd Конец выделения; если меньше начала, концы меняются местами.
	 * @returns {{text: string, selStart: number, selEnd: number, replaceStart: number, replaceEnd: number}}
	 *   Новый текст и выделение в нём. replaceStart и replaceEnd: изменённый отрезок исходного
	 *   текста, до и после него текст не меняется. По нему поле вставляет правку через
	 *   execCommand('insertText') и сохраняет её в истории отмены.
	 */
	function toggleLineComments(text, selStart, selEnd) {
		const source = typeof text === 'string' ? text : '';
		let start = clampOffset(selStart, source.length, 0);
		let end = clampOffset(selEnd, source.length, start);
		if (start > end) {
			const swap = start;
			start = end;
			end = swap;
		}
		const collapsed = start === end;
		const lastAnchor = !collapsed && source[end - 1] === '\n' ? end - 1 : end;

		const lines = [];
		// При start = 0 lastIndexOf с позиции -1 смотрит на символ 0 и при ведущем \n промахивается
		let lineStart = start > 0 ? source.lastIndexOf('\n', start - 1) + 1 : 0;
		for (;;) {
			const newline = source.indexOf('\n', lineStart);
			let contentEnd = newline < 0 ? source.length : newline;
			// \r перед \n относится к концу строки CRLF
			if (contentEnd > lineStart && source[contentEnd - 1] === '\r') {
				contentEnd -= 1;
			}
			let indentEnd = lineStart;
			while (indentEnd < contentEnd && (source[indentEnd] === ' ' || source[indentEnd] === '\t')) {
				indentEnd += 1;
			}
			lines.push({
				at: indentEnd,
				blank: indentEnd === contentEnd,
				commented: source.startsWith(LINE_COMMENT, indentEnd),
			});
			if (newline < 0 || newline >= lastAnchor) {
				break;
			}
			lineStart = newline + 1;
		}

		const filled = lines.filter((line) => !line.blank);
		const uncomment = filled.length > 0 && filled.every((line) => line.commented);
		const targets = filled.length > 0 ? filled : lines;
		const width = LINE_COMMENT.length;

		const pieces = [];
		let copied = 0;
		for (const line of targets) {
			pieces.push(source.slice(copied, line.at));
			if (uncomment) {
				copied = line.at + width;
			} else {
				pieces.push(LINE_COMMENT);
				copied = line.at;
			}
		}
		pieces.push(source.slice(copied));

		// Позиции правок возрастают: проход останавливается на первой правке правее смещения
		function mapOffset(offset, stickRight) {
			let delta = 0;
			for (const line of targets) {
				if (uncomment) {
					if (line.at + width <= offset) {
						delta -= width;
					} else {
						if (line.at < offset) {
							delta -= offset - line.at;
						}
						break;
					}
				} else if (line.at < offset || (line.at === offset && stickRight)) {
					delta += width;
				} else {
					break;
				}
			}
			return offset + delta;
		}

		const last = targets[targets.length - 1];
		return {
			text: pieces.join(''),
			selStart: mapOffset(start, collapsed),
			selEnd: mapOffset(end, true),
			replaceStart: targets[0].at,
			replaceEnd: uncomment ? last.at + width : last.at,
		};
	}

	const api = {
		HIGHLIGHT_LIMIT: HIGHLIGHT_LIMIT,
		// Тест сверяет этот список с подсказкой dcs-editor-complete.js
		FUNCTION_NAMES: Object.freeze(Array.from(FUNCTIONS)),
		tokenize: tokenize,
		delimiterWarning: delimiterWarning,
		toggleLineComments: toggleLineComments,
	};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (root) {
		root.DcsHighlight = api;
	}
})(typeof window === 'undefined' ? globalThis : window);
