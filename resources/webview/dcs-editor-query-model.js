/**
 * Модель запроса конструктора СКД: структурный разборщик и сборщик текста запроса — чистые функции.
 *
 * Как и dcs-editor-highlight.js, файл живёт двумя жизнями: webview подключает его отдельным
 * <script> и берёт функции из window.DcsQueryModel, а в node его исполняют в песочнице и читают
 * module.exports. Поэтому здесь нет ни DOM, ни require.
 *
 * Разбор структурный: пакет → запросы → части объединения → предложения. Выражения не разбираются,
 * а хранятся срезом исходного текста (с относительными отступами и комментариями внутри), поэтому
 * многострочный ВЫБОР и вложенный запрос в условии выходят из сборки без изменений.
 *
 * Сборка — по канону конструктора (табуляции, КАК у каждого поля и источника, соединения и ПО на
 * две табуляции, разделитель пакета из 80 косых черт), но со сплайсом по запросам пакета: запрос,
 * модель которого не менялась, выводится исходным срезом байт в байт, а разделители между
 * сохранившими соседство запросами — исходные. Неизменённость проверяется повторным разбором среза,
 * а не доверием к флагам: срез уходит в текст, только если он разбирается ровно в текущий узел.
 *
 * Форма модели (format `dcs-query-model/1`):
 * - model: {format, lang, eol, statements[], comments:{total, dropped}, original:{count, tail}};
 * - запрос пакета: {type:'select', parts[], orderBy, autoOrder, totals, indexes[], forUpdate, raw[],
 *   original} или {type:'drop', table, original}; original — {index, before, text}: место в исходном
 *   пакете, текст перед запросом (разделитель) и срез самого запроса;
 * - часть объединения: {unionAll, allowed, distinct, top, fields[{expr, alias}], dcsSelect, into,
 *   from[], where, dcsWhere, groupBy, having, forUpdate, raw[]};
 * - источник ИЗ: {source, joins[]}; соединение {kind, optionalGroup, source, joins[], on:{conditions}};
 *   source — {kind:'table', table, virtualTable, params, alias} | {kind:'subquery', query, alias} |
 *   {kind:'param', name, alias} | {kind:'group', text, alias};
 * - параметр ВТ: {text, dcs?:{text, kind:'whole'|'tail'}} — «целиком в {…}» и «база + блок СКД»;
 * - блоки СКД {ВЫБРАТЬ}/{ГДЕ}: {placement, items[], breaks?}; прочие блоки ({ХАРАКТЕРИСТИКИ} и т. п.)
 *   — raw[{placement, kind, text}] части или запроса.
 */
(function (root) {
	'use strict';

	const FORMAT = 'dcs-query-model/1';

	/** Длина строки-разделителя пакета: так пишет конструктор. */
	const SEPARATOR_WIDTH = 80;

	// ---------------------------------------------------------------------------------------------
	// Лексер
	// ---------------------------------------------------------------------------------------------

	// Липкое выражение: exec со своим lastIndex вместо среза строки на каждую лексему
	const WORD_RE = /[\p{L}_][\p{L}\p{N}_]*/uy;

	function isSpace(code) {
		return (
			code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12 ||
			code === 0xa0 || code === 0xfeff || code === 0x2028 || code === 0x2029 || code === 0x3000 ||
			(code >= 0x2000 && code <= 0x200a)
		);
	}

	function isDigit(code) {
		return code >= 48 && code <= 57;
	}

	/**
	 * Лексемы текста без пропусков: ws, com (комментарий до конца строки), str, num, par (&Имя),
	 * w (слово, u — в верхнем регистре), p (знак, v — сам знак). Позиции — [s, e) в исходном тексте.
	 */
	function lex(text) {
		const tokens = [];
		const n = text.length;
		let i = 0;
		while (i < n) {
			const code = text.charCodeAt(i);
			let j;
			if (isSpace(code)) {
				j = i + 1;
				while (j < n && isSpace(text.charCodeAt(j))) {
					j++;
				}
				tokens.push({ k: 'ws', s: i, e: j });
				i = j;
				continue;
			}
			if (code === 47 && text.charCodeAt(i + 1) === 47) {
				j = i + 2;
				while (j < n) {
					const c = text.charCodeAt(j);
					if (c === 10 || c === 13) {
						break;
					}
					j++;
				}
				tokens.push({ k: 'com', s: i, e: j });
				i = j;
				continue;
			}
			if (code === 34) {
				j = i + 1;
				let closed = false;
				while (j < n) {
					if (text.charCodeAt(j) === 34) {
						if (text.charCodeAt(j + 1) === 34) {
							j += 2;
							continue;
						}
						j++;
						closed = true;
						break;
					}
					j++;
				}
				tokens.push({ k: 'str', s: i, e: j, open: !closed });
				i = j;
				continue;
			}
			if (isDigit(code)) {
				j = i + 1;
				while (j < n && isDigit(text.charCodeAt(j))) {
					j++;
				}
				if (text.charCodeAt(j) === 46 && isDigit(text.charCodeAt(j + 1))) {
					j += 2;
					while (j < n && isDigit(text.charCodeAt(j))) {
						j++;
					}
				}
				tokens.push({ k: 'num', s: i, e: j });
				i = j;
				continue;
			}
			if (code === 38) {
				WORD_RE.lastIndex = i + 1;
				const param = WORD_RE.exec(text);
				if (param) {
					tokens.push({ k: 'par', s: i, e: i + 1 + param[0].length });
					i += 1 + param[0].length;
					continue;
				}
			} else {
				WORD_RE.lastIndex = i;
				const word = WORD_RE.exec(text);
				if (word) {
					tokens.push({ k: 'w', s: i, e: i + word[0].length, u: word[0].toUpperCase() });
					i += word[0].length;
					continue;
				}
			}
			const next = text.charCodeAt(i + 1);
			if ((code === 60 && (next === 61 || next === 62)) || (code === 62 && next === 61)) {
				tokens.push({ k: 'p', s: i, e: i + 2, v: text.slice(i, i + 2) });
				i += 2;
				continue;
			}
			tokens.push({ k: 'p', s: i, e: i + 1, v: text[i] });
			i++;
		}
		return tokens;
	}

	/** Разделитель пакета `////…` конструктор пишет сам: такой комментарий не считается потерей. */
	function isSeparatorComment(value) {
		return /^\/{2,}\s*$/.test(value);
	}

	function countRealComments(text) {
		let count = 0;
		for (const token of lex(text)) {
			if (token.k === 'com' && !isSeparatorComment(text.slice(token.s, token.e))) {
				count++;
			}
		}
		return count;
	}

	// ---------------------------------------------------------------------------------------------
	// Словари
	// ---------------------------------------------------------------------------------------------

	/**
	 * Английские лексемы, которые разборщик понимает как ключевые слова структуры. ДОБАВИТЬ и
	 * УНИКАЛЬНО модуль знает только по-русски: английский текст получает их по-русски, а смешение
	 * языков ключевых слов в одном тексте платформа принимает.
	 */
	const EN_TO_RU = {
		SELECT: 'ВЫБРАТЬ', ALLOWED: 'РАЗРЕШЕННЫЕ', DISTINCT: 'РАЗЛИЧНЫЕ', TOP: 'ПЕРВЫЕ', AS: 'КАК',
		INTO: 'ПОМЕСТИТЬ', FROM: 'ИЗ', WHERE: 'ГДЕ', GROUP: 'СГРУППИРОВАТЬ', BY: 'ПО', ON: 'ПО',
		HAVING: 'ИМЕЮЩИЕ', UNION: 'ОБЪЕДИНИТЬ', ALL: 'ВСЕ', ORDER: 'УПОРЯДОЧИТЬ',
		AUTOORDER: 'АВТОУПОРЯДОЧИВАНИЕ', TOTALS: 'ИТОГИ', OVERALL: 'ОБЩИЕ', ONLY: 'ТОЛЬКО',
		HIERARCHY: 'ИЕРАРХИЯ', PERIODS: 'ПЕРИОДАМИ', INDEX: 'ИНДЕКСИРОВАТЬ', SETS: 'НАБОРАМ',
		GROUPING: 'ГРУППИРУЮЩИМ', FOR: 'ДЛЯ', UPDATE: 'ИЗМЕНЕНИЯ', DROP: 'УНИЧТОЖИТЬ', LEFT: 'ЛЕВОЕ',
		RIGHT: 'ПРАВОЕ', FULL: 'ПОЛНОЕ', INNER: 'ВНУТРЕННЕЕ', OUTER: 'ВНЕШНЕЕ', JOIN: 'СОЕДИНЕНИЕ',
		AND: 'И', OR: 'ИЛИ', BETWEEN: 'МЕЖДУ', CASE: 'ВЫБОР', END: 'КОНЕЦ', ASC: 'ВОЗР', DESC: 'УБЫВ',
		CHARACTERISTICS: 'ХАРАКТЕРИСТИКИ',
	};

	/** Ключевые слова сборки по языку текста; lang — язык конфигурации, как пишет конструктор. */
	const KEYWORDS = {
		ru: {
			select: 'ВЫБРАТЬ', allowed: 'РАЗРЕШЕННЫЕ', distinct: 'РАЗЛИЧНЫЕ', top: 'ПЕРВЫЕ', as: 'КАК',
			into: 'ПОМЕСТИТЬ', add: 'ДОБАВИТЬ', from: 'ИЗ', where: 'ГДЕ', groupBy: 'СГРУППИРОВАТЬ ПО',
			groupingSets: 'ГРУППИРУЮЩИМ НАБОРАМ', having: 'ИМЕЮЩИЕ', union: 'ОБЪЕДИНИТЬ', all: 'ВСЕ',
			orderBy: 'УПОРЯДОЧИТЬ ПО', desc: 'УБЫВ', hierarchy: 'ИЕРАРХИЯ', onlyHierarchy: 'ТОЛЬКО ИЕРАРХИЯ',
			autoOrder: 'АВТОУПОРЯДОЧИВАНИЕ', totals: 'ИТОГИ', by: 'ПО', overall: 'ОБЩИЕ',
			periods: 'ПЕРИОДАМИ', indexBy: 'ИНДЕКСИРОВАТЬ ПО', sets: 'НАБОРАМ', unique: 'УНИКАЛЬНО',
			forUpdate: 'ДЛЯ ИЗМЕНЕНИЯ', drop: 'УНИЧТОЖИТЬ', join: 'СОЕДИНЕНИЕ', inner: 'ВНУТРЕННЕЕ',
			left: 'ЛЕВОЕ', right: 'ПРАВОЕ', full: 'ПОЛНОЕ', on: 'ПО', and: 'И',
		},
		en: {
			select: 'SELECT', allowed: 'ALLOWED', distinct: 'DISTINCT', top: 'TOP', as: 'AS',
			into: 'INTO', add: 'ДОБАВИТЬ', from: 'FROM', where: 'WHERE', groupBy: 'GROUP BY',
			groupingSets: 'GROUPING SETS', having: 'HAVING', union: 'UNION', all: 'ALL',
			orderBy: 'ORDER BY', desc: 'DESC', hierarchy: 'HIERARCHY', onlyHierarchy: 'ONLY HIERARCHY',
			autoOrder: 'AUTOORDER', totals: 'TOTALS', by: 'BY', overall: 'OVERALL',
			periods: 'PERIODS', indexBy: 'INDEX BY', sets: 'SETS', unique: 'УНИКАЛЬНО',
			forUpdate: 'FOR UPDATE', drop: 'DROP', join: 'JOIN', inner: 'INNER',
			left: 'LEFT', right: 'RIGHT', full: 'FULL', on: 'ON', and: 'AND',
		},
	};

	/** Первые слова предложений; составные (СГРУППИРОВАТЬ ПО и т. п.) дочитываются при разметке. */
	const CLAUSE_WORDS = {
		ВЫБРАТЬ: 'select', ПОМЕСТИТЬ: 'into', ДОБАВИТЬ: 'add', ИЗ: 'from', ГДЕ: 'where',
		СГРУППИРОВАТЬ: 'groupBy', ИМЕЮЩИЕ: 'having', ОБЪЕДИНИТЬ: 'union', УПОРЯДОЧИТЬ: 'orderBy',
		АВТОУПОРЯДОЧИВАНИЕ: 'autoOrder', ИТОГИ: 'totals', ИНДЕКСИРОВАТЬ: 'index', ДЛЯ: 'forUpdate',
		УНИЧТОЖИТЬ: 'drop',
	};

	/** Каноническое место предложения в части объединения — для проверки порядка. */
	const PART_STAGE = { select: 0, into: 1, add: 1, from: 2, where: 3, groupBy: 4, having: 5, forUpdate: 6 };
	const STATEMENT_STAGE = { orderBy: 0, autoOrder: 1, totals: 2, index: 3, forUpdate: 4 };

	/** Места блоков СКД в части: блок печатается после своего предложения, как стоял в тексте. */
	const PART_ANCHORS = ['afterFields', 'afterInto', 'afterFrom', 'afterWhere', 'afterGroupBy', 'afterHaving', 'afterForUpdate'];
	const STATEMENT_ANCHORS = ['afterOrderBy', 'afterAutoOrder', 'afterTotals', 'afterIndex', 'afterForUpdate'];
	const PART_PLACEMENT = { select: 'afterFields', into: 'afterInto', add: 'afterInto', from: 'afterFrom', where: 'afterWhere', groupBy: 'afterGroupBy', having: 'afterHaving', forUpdate: 'afterForUpdate' };
	const STATEMENT_PLACEMENT = { orderBy: 'afterOrderBy', autoOrder: 'afterAutoOrder', totals: 'afterTotals', index: 'afterIndex', forUpdate: 'afterForUpdate' };

	/** Слова, которые не могут быть псевдонимом источника без КАК: с них начинается соединение. */
	const JOIN_WORDS = new Set(['ЛЕВОЕ', 'ПРАВОЕ', 'ПОЛНОЕ', 'ВНУТРЕННЕЕ', 'ВНЕШНЕЕ', 'СОЕДИНЕНИЕ', 'ПО']);

	/**
	 * Регистры, бизнес-процессы, задачи и последовательности: только у них третий сегмент пути бывает
	 * виртуальной таблицей (у последовательности — Границы). Критерий отбора сюда не входит: его
	 * параметр пишется у самого объекта (`КритерийОтбора.X(&Значение)`), сегмента с именем ВТ нет,
	 * поэтому признак таблицы с параметрами у него — params, а virtualTable остаётся null. Так
	 * «Заменить таблицу» не сочтёт два разных критерия одной виртуальной таблицей и не перенесёт
	 * значение параметра одного в другой.
	 */
	const VIRTUAL_OWNERS = new Set([
		'РЕГИСТРСВЕДЕНИЙ', 'РЕГИСТРНАКОПЛЕНИЯ', 'РЕГИСТРБУХГАЛТЕРИИ', 'РЕГИСТРРАСЧЕТА', 'БИЗНЕСПРОЦЕСС', 'ЗАДАЧА', 'ПОСЛЕДОВАТЕЛЬНОСТЬ',
		'INFORMATIONREGISTER', 'ACCUMULATIONREGISTER', 'ACCOUNTINGREGISTER', 'CALCULATIONREGISTER', 'BUSINESSPROCESS', 'TASK', 'SEQUENCE',
	]);
	const VIRTUAL_NAMES = new Set([
		'ОСТАТКИ', 'ОБОРОТЫ', 'ОСТАТКИИОБОРОТЫ', 'СРЕЗПОСЛЕДНИХ', 'СРЕЗПЕРВЫХ', 'ОБОРОТЫДТКТ', 'СУБКОНТО',
		'ДВИЖЕНИЯССУБКОНТО', 'ДАННЫЕГРАФИКА', 'ФАКТИЧЕСКИЙПЕРИОДДЕЙСТВИЯ', 'ГРАНИЦЫ', 'ЗАДАЧИПОИСПОЛНИТЕЛЮ',
		'BALANCE', 'TURNOVERS', 'BALANCEANDTURNOVERS', 'SLICELAST', 'SLICEFIRST', 'DRCRTURNOVERS', 'EXTDIMENSIONS',
		'RECORDSWITHEXTDIMENSIONS', 'SCHEDULEDATA', 'ACTUALACTIONPERIOD', 'BOUNDARIES', 'TASKBYPERFORMER',
	]);

	const AGGREGATES = new Set(['СУММА', 'КОЛИЧЕСТВО', 'СРЕДНЕЕ', 'МИНИМУМ', 'МАКСИМУМ', 'SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);

	/** Литералы-слова: по виду это путь из одного сегмента, но имени поля они не дают. */
	const LITERALS = new Set(['ИСТИНА', 'ЛОЖЬ', 'NULL', 'НЕОПРЕДЕЛЕНО', 'TRUE', 'FALSE', 'UNDEFINED']);

	function ruWord(token) {
		return token && token.k === 'w' ? EN_TO_RU[token.u] || token.u : null;
	}

	function isWord(token, word) {
		return !!token && token.k === 'w' && (token.u === word || EN_TO_RU[token.u] === word);
	}

	function isPunct(token, value) {
		return !!token && token.k === 'p' && token.v === value;
	}

	function arr(value) {
		return Array.isArray(value) ? value : [];
	}

	function present(value) {
		return value !== null && value !== undefined && value !== '';
	}

	// ---------------------------------------------------------------------------------------------
	// Позиции и отступы
	// ---------------------------------------------------------------------------------------------

	function position(text, offset) {
		let line = 1;
		let lineStart = 0;
		const end = Math.min(Math.max(offset, 0), text.length);
		for (let i = 0; i < end; i++) {
			if (text.charCodeAt(i) === 10) {
				line++;
				lineStart = i + 1;
			}
		}
		return { offset: end, line: line, column: end - lineStart + 1 };
	}

	/**
	 * Переводы строк вне строковых литералов: внутри литерала перевод строки — часть значения,
	 * отступ к нему ни добавлять, ни снимать нельзя. Удвоенная кавычка переключает флаг дважды,
	 * поэтому экранирование `""` учитывается само.
	 */
	function codeBreaks(value) {
		const breaks = [];
		let inString = false;
		let inComment = false;
		for (let i = 0; i < value.length; i++) {
			const code = value.charCodeAt(i);
			if (code === 10) {
				if (!inString) {
					breaks.push(i);
				}
				inComment = false;
				continue;
			}
			if (inComment) {
				continue;
			}
			if (code === 34) {
				inString = !inString;
			} else if (!inString && code === 47 && value.charCodeAt(i + 1) === 47) {
				inComment = true;
				i++;
			}
		}
		return breaks;
	}

	/** Многострочное значение на строке с отступом prefix: продолжения получают тот же отступ. */
	function emitText(value, prefix, eol) {
		let text = value === null || value === undefined ? '' : String(value);
		// Значения из разбора уже в LF, а текст, введённый в UI, может прийти с CR
		if (text.indexOf('\r') >= 0) {
			text = text.replace(/\r\n?/g, '\n');
		}
		if (text.indexOf('\n') < 0) {
			return text;
		}
		const breaks = codeBreaks(text);
		let out = '';
		let last = 0;
		let b = 0;
		for (let i = 0; i < text.length; i++) {
			if (text.charCodeAt(i) !== 10) {
				continue;
			}
			out += text.slice(last, i) + eol;
			if (b < breaks.length && breaks[b] === i) {
				out += prefix;
				b++;
			}
			last = i + 1;
		}
		return out + text.slice(last);
	}

	// ---------------------------------------------------------------------------------------------
	// Разборщик
	// ---------------------------------------------------------------------------------------------

	/**
	 * Разбор одного текста. clip — начало текущего запроса пакета: отступ строки считается не
	 * дальше него, поэтому срез запроса, разобранный отдельно, даёт ту же модель, что и весь пакет
	 * (на этом держится проверка неизменённости при сплайсе).
	 */
	function createParser(text) {
		const all = lex(text);
		const T = all.filter((token) => token.k !== 'ws' && token.k !== 'com');
		const match = new Int32Array(T.length).fill(-1);
		const diagnostics = [];
		let clip = 0;

		function tt(token) {
			return text.slice(token.s, token.e);
		}

		function diag(token, message) {
			const offset = token ? token.s : text.length;
			diagnostics.push(Object.assign({ message: message }, position(text, offset)));
		}

		function diagAt(index, message) {
			diag(index < T.length ? T[index] : null, message);
		}

		// Пары скобок обоих видов одним стеком: перекрёстная вложенность «( { ) }» — ошибка текста,
		// после неё закрывающая находит свою открывающую глубже, а пропущенные остаются незакрытыми
		(function pairBrackets() {
			const stack = [];
			for (let i = 0; i < T.length; i++) {
				const token = T[i];
				if (token.k === 'str' && token.open) {
					diag(token, 'Не закрыта кавычка');
				}
				if (token.k !== 'p') {
					continue;
				}
				if (token.v === '(' || token.v === '{') {
					stack.push(i);
					continue;
				}
				if (token.v !== ')' && token.v !== '}') {
					continue;
				}
				const want = token.v === ')' ? '(' : '{';
				let depth = stack.length - 1;
				while (depth >= 0 && T[stack[depth]].v !== want) {
					depth--;
				}
				if (depth < 0) {
					diag(token, 'Лишняя закрывающая скобка «' + token.v + '»');
					continue;
				}
				while (stack.length - 1 > depth) {
					const lost = stack.pop();
					diag(T[lost], 'Не закрыта скобка «' + T[lost].v + '»');
				}
				const open = stack.pop();
				match[open] = i;
				match[i] = open;
			}
			for (const open of stack) {
				diag(T[open], 'Не закрыта скобка «' + T[open].v + '»');
			}
		})();

		function isOpen(token) {
			return token.k === 'p' && (token.v === '(' || token.v === '{');
		}

		/** Индекс за группой, которая открывается в i; незакрытая группа тянется до конца диапазона. */
		function skip(i, end) {
			const close = match[i];
			return close >= 0 && close < end ? close + 1 : end;
		}

		function innerEnd(i, end) {
			const close = match[i];
			return close >= 0 && close < end ? close : end;
		}

		function lineIndent(pos) {
			let start = pos;
			while (start > clip) {
				const code = text.charCodeAt(start - 1);
				if (code === 10 || code === 13) {
					break;
				}
				start--;
			}
			let end = start;
			while (end < pos) {
				const code = text.charCodeAt(end);
				if (code !== 32 && code !== 9) {
					break;
				}
				end++;
			}
			return text.slice(start, end);
		}

		/**
		 * Срез лексем [x, y) как значение модели: переводы строк — LF, у строк продолжения снят отступ
		 * строки, где выражение начинается. Так выражение переносится на другой уровень вложенности
		 * без накопления табуляций, а повторная сборка совпадает с первой.
		 */
		function slice(x, y) {
			if (y <= x) {
				return '';
			}
			let raw = text.slice(T[x].s, T[y - 1].e);
			if (raw.indexOf('\r') >= 0) {
				raw = raw.replace(/\r\n?/g, '\n');
			}
			if (raw.indexOf('\n') < 0) {
				return raw;
			}
			const base = lineIndent(T[x].s);
			if (!base) {
				return raw;
			}
			let out = '';
			let last = 0;
			for (const at of codeBreaks(raw)) {
				out += raw.slice(last, at + 1);
				last = at + 1;
				if (raw.startsWith(base, last)) {
					last += base.length;
				}
			}
			return out + raw.slice(last);
		}

		/** Диапазоны элементов списка через запятую верхнего уровня (скобки и блоки — целиком). */
		function splitTop(x, y) {
			const ranges = [];
			if (y <= x) {
				return ranges;
			}
			let start = x;
			for (let i = x; i < y; ) {
				const token = T[i];
				if (isOpen(token)) {
					i = skip(i, y);
					continue;
				}
				if (isPunct(token, ',')) {
					ranges.push([start, i]);
					start = i + 1;
				}
				i++;
			}
			ranges.push([start, y]);
			return ranges;
		}

		/** Путь `А.Б.В` или `А.Б.*` ровно на диапазоне — иначе null. */
		function pathOf(x, y) {
			if (y <= x || T[x].k !== 'w') {
				return null;
			}
			const segments = [tt(T[x])];
			let i = x + 1;
			let star = false;
			while (i < y) {
				if (!isPunct(T[i], '.') || i + 1 >= y) {
					return null;
				}
				const next = T[i + 1];
				if (next.k === 'w') {
					segments.push(tt(next));
					i += 2;
					continue;
				}
				if (isPunct(next, '*') && i + 2 === y) {
					star = true;
					i += 2;
					continue;
				}
				return null;
			}
			return { path: segments.join('.'), star: star };
		}

		/** Хвост `КАК Имя` элемента: возвращает новую правую границу и псевдоним. */
		function aliasTail(x, y) {
			if (y - x >= 3 && isWord(T[y - 2], 'КАК') && T[y - 1].k === 'w') {
				return { end: y - 2, alias: tt(T[y - 1]) };
			}
			return { end: y, alias: null };
		}

		/** Слово как ключевое, а не сегмент пути (`Т.Конец`) и не голова пути (`Конец.Поле`). */
		function keywordAt(i, x, y) {
			const token = T[i];
			if (token.k !== 'w') {
				return null;
			}
			if ((i > x && isPunct(T[i - 1], '.')) || (i + 1 < y && isPunct(T[i + 1], '.'))) {
				return null;
			}
			return EN_TO_RU[token.u] || token.u;
		}

		/**
		 * Условие по И верхнего уровня (закладка «Условия»: одно условие на строку). И внутри
		 * скобок, ВЫБОР…КОНЕЦ и МЕЖДУ…И не делят; при ИЛИ верхнего уровня условие остаётся одним.
		 */
		function splitConditions(x, y) {
			if (y <= x) {
				return [];
			}
			const cuts = [];
			let caseDepth = 0;
			let between = false;
			for (let i = x; i < y; i++) {
				const token = T[i];
				if (isOpen(token)) {
					i = skip(i, y) - 1;
					continue;
				}
				const word = keywordAt(i, x, y);
				if (!word) {
					continue;
				}
				if (word === 'ВЫБОР') {
					caseDepth++;
				} else if (word === 'КОНЕЦ') {
					if (caseDepth > 0) {
						caseDepth--;
					}
				} else if (caseDepth === 0) {
					if (word === 'ИЛИ') {
						return [slice(x, y)];
					}
					if (word === 'МЕЖДУ') {
						between = true;
					} else if (word === 'И') {
						if (between) {
							between = false;
						} else {
							cuts.push(i);
						}
					}
				}
			}
			const out = [];
			let start = x;
			for (const cut of cuts.concat([y])) {
				if (cut <= start) {
					diagAt(start, 'Пустое условие');
				}
				out.push(slice(start, cut));
				start = cut + 1;
			}
			return out;
		}

		/** Разметка предложений верхнего уровня запроса [a, b). */
		function scanClauses(a, b) {
			const clauses = [];
			let current = null;
			for (let i = a; i < b; i++) {
				const token = T[i];
				if (isOpen(token)) {
					i = skip(i, b) - 1;
					continue;
				}
				if (token.k !== 'w') {
					continue;
				}
				const name = CLAUSE_WORDS[EN_TO_RU[token.u] || token.u];
				if (!name) {
					continue;
				}
				const prev = i > a ? T[i - 1] : null;
				const next = i + 1 < b ? T[i + 1] : null;
				if (isPunct(prev, '.') || isPunct(next, '.')) {
					continue;
				}
				// Псевдоним или имя временной таблицы, совпавшее с ключевым словом, предложения не начинает
				if (isWord(prev, 'КАК') || isWord(prev, 'ПОМЕСТИТЬ') || isWord(prev, 'ДОБАВИТЬ') || isWord(prev, 'УНИЧТОЖИТЬ')) {
					continue;
				}
				let length = 1;
				if (name === 'groupBy' || name === 'orderBy' || name === 'index') {
					if (!isWord(next, 'ПО')) {
						continue;
					}
					length = 2;
				} else if (name === 'forUpdate') {
					if (!isWord(next, 'ИЗМЕНЕНИЯ')) {
						continue;
					}
					length = 2;
				} else if (name === 'union') {
					if (isWord(next, 'ВСЕ')) {
						length = 2;
					}
				} else if (name === 'into' || name === 'add') {
					// ДОБАВИТЬ — обычное слово везде, кроме места сразу за списком выборки
					if (!current || current.name !== 'select' || !next || next.k !== 'w') {
						continue;
					}
				}
				if (current) {
					current.end = i;
				}
				current = { name: name, kw: i, start: i + length, end: b };
				clauses.push(current);
				i += length - 1;
			}
			return clauses;
		}

		function blockKind(open, end) {
			const first = open + 1 < end ? T[open + 1] : null;
			const word = ruWord(first);
			if (word === 'ВЫБРАТЬ') {
				return 'select';
			}
			if (word === 'ГДЕ') {
				return 'where';
			}
			if (word === 'ХАРАКТЕРИСТИКИ') {
				return 'characteristics';
			}
			return joinStart(open + 1, innerEnd(open, end)) ? 'join' : 'block';
		}

		/** Длина ключевых слов соединения с позиции k (0 — соединение здесь не начинается). */
		function joinStart(k, end) {
			let j = k;
			const word = j < end ? ruWord(T[j]) : null;
			if (word === 'ЛЕВОЕ' || word === 'ПРАВОЕ' || word === 'ПОЛНОЕ' || word === 'ВНУТРЕННЕЕ') {
				j++;
				if (j < end && isWord(T[j], 'ВНЕШНЕЕ')) {
					j++;
				}
			}
			return j < end && isWord(T[j], 'СОЕДИНЕНИЕ') ? j - k + 1 : 0;
		}

		/**
		 * Блоки {…} в конце тела предложения: [{open, end}] и граница тела без них. Блок посреди тела
		 * остаётся внутри текста выражения — так его лексемы не теряются, а смысл не трогается.
		 */
		function trailingBlocks(x, y, keepJoins) {
			let blocks = [];
			for (let i = x; i < y; ) {
				const token = T[i];
				if (isPunct(token, '{')) {
					const next = skip(i, y);
					blocks.push({ open: i, end: next });
					i = next;
					continue;
				}
				blocks = [];
				i = isOpen(token) ? skip(i, y) : i + 1;
			}
			if (keepJoins) {
				let first = blocks.length;
				while (first > 0 && blockKind(blocks[first - 1].open, y) !== 'join') {
					first--;
				}
				blocks = blocks.slice(first);
			}
			return { end: blocks.length ? blocks[0].open : y, blocks: blocks };
		}

		function dcsSelectItem(x, y) {
			const tail = aliasTail(x, y);
			const path = pathOf(x, tail.end);
			if (path) {
				return { path: path.path, star: path.star, alias: tail.alias };
			}
			return { text: slice(x, tail.end), alias: tail.alias };
		}

		function dcsWhereItem(x, y) {
			const tail = aliasTail(x, y);
			const path = pathOf(x, tail.end);
			if (path) {
				return { kind: path.star ? 'fieldStar' : 'field', path: path.path, alias: tail.alias };
			}
			const end = tail.end;
			if (end > x && isPunct(T[x], '(') && match[x] === end - 1) {
				return { kind: 'condition', text: slice(x + 1, end - 1), parens: true, alias: tail.alias };
			}
			return { kind: 'condition', text: slice(x, end), parens: false, alias: tail.alias };
		}

		function blockItems(block, make) {
			const close = block.end - 1;
			const inner = match[block.open] === close ? close : block.end;
			const items = [];
			for (const range of splitTop(block.open + 2, inner)) {
				if (range[1] <= range[0]) {
					if (inner > block.open + 2) {
						diagAt(range[0], 'Пустой элемент блока');
					}
					continue;
				}
				items.push(make(range[0], range[1]));
			}
			return items;
		}

		/**
		 * Раскладывает хвостовые блоки предложения: {ВЫБРАТЬ} и {ГДЕ} — в структуру части, прочие —
		 * текстом в raw. Порядок печати на одном месте фиксирован (ВЫБРАТЬ, ГДЕ, прочие), поэтому блок,
		 * который в тексте стоит раньше «старшего» соседа, уходит в raw — иначе сборка переставила бы
		 * лексемы. Соседние однородные блоки сливаются с отметкой разрыва (breaks).
		 */
		function attachBlocks(owner, blocks, placement, isPart, end) {
			let rank = -1;
			let lastKey = null;
			for (const block of blocks) {
				const kind = blockKind(block.open, end);
				const key = isPart && kind === 'select' ? 'dcsSelect' : isPart && kind === 'where' ? 'dcsWhere' : null;
				const keyRank = key === 'dcsSelect' ? 0 : key === 'dcsWhere' ? 1 : 2;
				if (key && keyRank >= rank) {
					const items = blockItems(block, key === 'dcsSelect' ? dcsSelectItem : dcsWhereItem);
					const slot = owner[key];
					if (!slot) {
						owner[key] = { placement: placement, items: items };
						rank = keyRank;
						lastKey = key;
						continue;
					}
					if (lastKey === key && slot.placement === placement) {
						slot.breaks = arr(slot.breaks).concat([slot.items.length]);
						slot.items = slot.items.concat(items);
						continue;
					}
				}
				owner.raw.push({
					placement: placement,
					kind: kind === 'characteristics' ? 'characteristics' : 'block',
					text: slice(block.open, block.end),
				});
				rank = 2;
				lastKey = null;
			}
		}

		function newPart(unionAll) {
			return {
				unionAll: unionAll,
				allowed: false,
				distinct: false,
				top: null,
				fields: [],
				dcsSelect: null,
				into: null,
				from: [],
				where: null,
				dcsWhere: null,
				groupBy: null,
				having: null,
				forUpdate: null,
				raw: [],
			};
		}

		function parseSelectBody(part, x, y) {
			let i = x;
			while (i < y) {
				const token = T[i];
				if (isWord(token, 'РАЗРЕШЕННЫЕ')) {
					part.allowed = true;
					i++;
				} else if (isWord(token, 'РАЗЛИЧНЫЕ')) {
					part.distinct = true;
					i++;
				} else if (isWord(token, 'ПЕРВЫЕ') && i + 1 < y && T[i + 1].k === 'num') {
					const value = tt(T[i + 1]);
					part.top = /^[1-9]\d*$/.test(value) ? Number(value) : value;
					i += 2;
				} else {
					break;
				}
			}
			if (i >= y) {
				diagAt(i, 'Нет полей выборки');
				return;
			}
			for (const range of splitTop(i, y)) {
				if (range[1] <= range[0]) {
					diagAt(range[0], 'Пустое поле выборки');
					part.fields.push({ expr: '', alias: null });
					continue;
				}
				const tail = aliasTail(range[0], range[1]);
				part.fields.push({ expr: slice(range[0], tail.end), alias: tail.alias });
			}
		}

		function virtualTableOf(segments, params) {
			if (segments.length !== 3 || !VIRTUAL_OWNERS.has(segments[0].toUpperCase())) {
				return null;
			}
			const last = segments[2];
			return params !== null || VIRTUAL_NAMES.has(last.toUpperCase()) ? last : null;
		}

		/** Параметр ВТ: «целиком в {…}», «база + блок СКД» или текст (частичные скобки и прочее). */
		function virtualParam(x, y) {
			if (y <= x) {
				return { text: '' };
			}
			if (isPunct(T[x], '{') && match[x] === y - 1) {
				return { text: '', dcs: { text: slice(x + 1, y - 1), kind: 'whole' } };
			}
			if (isPunct(T[y - 1], '}')) {
				const open = match[y - 1];
				if (open > x) {
					let plain = true;
					for (let i = x; i < open; ) {
						if (isPunct(T[i], '{')) {
							plain = false;
							break;
						}
						i = isOpen(T[i]) ? skip(i, open) : i + 1;
					}
					if (plain) {
						return { text: slice(x, open), dcs: { text: slice(open + 1, y - 1), kind: 'tail' } };
					}
				}
			}
			return { text: slice(x, y) };
		}

		function parseFrom(part, x, y) {
			let pos = x;
			let groupNo = 0;

			function source(end) {
				const token = pos < end ? T[pos] : null;
				let node;
				if (!token) {
					diagAt(pos, 'Ожидался источник данных');
					return { kind: 'table', table: '', virtualTable: null, params: null, alias: null };
				}
				if (isPunct(token, '(')) {
					const inner = innerEnd(pos, end);
					if (pos + 1 < inner && isWord(T[pos + 1], 'ВЫБРАТЬ')) {
						node = { kind: 'subquery', query: parseStatement(pos + 1, inner), alias: null };
					} else {
						node = { kind: 'group', text: slice(pos + 1, inner), alias: null };
					}
					pos = skip(pos, end);
				} else if (token.k === 'par') {
					node = { kind: 'param', name: text.slice(token.s + 1, token.e), alias: null };
					pos++;
				} else if (token.k === 'w') {
					const segments = [tt(token)];
					pos++;
					while (pos + 1 < end && isPunct(T[pos], '.') && T[pos + 1].k === 'w') {
						segments.push(tt(T[pos + 1]));
						pos += 2;
					}
					let params = null;
					if (pos < end && isPunct(T[pos], '(')) {
						params = [];
						const inner = innerEnd(pos, end);
						if (inner > pos + 1) {
							for (const range of splitTop(pos + 1, inner)) {
								params.push(virtualParam(range[0], range[1]));
							}
						}
						pos = skip(pos, end);
					}
					node = {
						kind: 'table',
						table: segments.join('.'),
						virtualTable: virtualTableOf(segments, params),
						params: params,
						alias: null,
					};
				} else {
					diag(token, 'Ожидался источник данных');
					node = { kind: 'table', table: tt(token), virtualTable: null, params: null, alias: null };
					pos++;
				}
				const next = pos < end ? T[pos] : null;
				if (isWord(next, 'КАК')) {
					if (pos + 1 < end && T[pos + 1].k === 'w') {
						node.alias = tt(T[pos + 1]);
						pos += 2;
					} else {
						diag(next, 'Ожидался псевдоним после КАК');
						pos++;
					}
				} else if (next && next.k === 'w' && !JOIN_WORDS.has(ruWord(next))) {
					node.alias = tt(next);
					pos++;
				}
				return node;
			}

			function chain(end) {
				const joins = [];
				while (pos < end) {
					const token = T[pos];
					if (isPunct(token, '{')) {
						const inner = innerEnd(pos, end);
						if (!joinStart(pos + 1, inner)) {
							break;
						}
						const no = ++groupNo;
						const after = skip(pos, end);
						pos++;
						const group = chain(inner);
						if (pos < inner) {
							diag(T[pos], 'Лишнее в блоке необязательного соединения');
						}
						for (const join of group) {
							if (join.optionalGroup === null) {
								join.optionalGroup = no;
							}
							joins.push(join);
						}
						pos = after;
						continue;
					}
					const length = joinStart(pos, end);
					if (!length) {
						break;
					}
					joins.push(join(length, end));
				}
				return joins;
			}

			function join(length, end) {
				const word = ruWord(T[pos]);
				const kind = word === 'ЛЕВОЕ' ? 'left' : word === 'ПРАВОЕ' ? 'right' : word === 'ПОЛНОЕ' ? 'full' : 'inner';
				pos += length;
				const right = source(end);
				const nested = chain(end);
				let on = null;
				if (pos < end && isWord(T[pos], 'ПО')) {
					pos++;
					const start = pos;
					while (pos < end) {
						const token = T[pos];
						if (isPunct(token, '(')) {
							pos = skip(pos, end);
							continue;
						}
						if (isPunct(token, '{') || isPunct(token, ',') || isWord(token, 'ПО') || joinStart(pos, end)) {
							break;
						}
						pos++;
					}
					if (pos === start) {
						diagAt(pos, 'Нет условия соединения после ПО');
					}
					on = { conditions: splitConditions(start, pos) };
				} else {
					diagAt(pos, 'Нет ПО у соединения');
				}
				return { kind: kind, optionalGroup: null, source: right, joins: nested, on: on };
			}

			while (pos < y) {
				if (isPunct(T[pos], '{')) {
					diag(T[pos], 'Блок {…} на месте источника');
					pos = skip(pos, y);
					continue;
				}
				const entry = { source: source(y), joins: [] };
				entry.joins = chain(y);
				part.from.push(entry);
				if (pos >= y) {
					break;
				}
				if (isPunct(T[pos], ',')) {
					pos++;
					if (pos >= y) {
						diagAt(pos, 'Ожидался источник после запятой');
					}
					continue;
				}
				diag(T[pos], 'Лишнее в ИЗ: «' + tt(T[pos]) + '»');
				while (pos < y && !isPunct(T[pos], ',')) {
					pos = isOpen(T[pos]) ? skip(pos, y) : pos + 1;
				}
				if (pos < y) {
					pos++;
				}
			}
		}

		function parseGroupBy(x, y) {
			if (isWord(T[x], 'ГРУППИРУЮЩИМ') && x + 2 < y && isWord(T[x + 1], 'НАБОРАМ') && isPunct(T[x + 2], '(')) {
				const inner = innerEnd(x + 2, y);
				const sets = splitTop(x + 3, inner).map((range) => {
					const a = range[0];
					const b = range[1];
					if (b > a && isPunct(T[a], '(') && match[a] === b - 1) {
						return splitTop(a + 1, b - 1).map((r) => slice(r[0], r[1]));
					}
					return b > a ? [slice(a, b)] : [];
				});
				const after = skip(x + 2, y);
				if (after < y) {
					diag(T[after], 'Лишнее после ГРУППИРУЮЩИМ НАБОРАМ');
				}
				return { items: [], groupingSets: inner > x + 3 ? sets : [] };
			}
			return { items: splitTop(x, y).map((r) => slice(r[0], r[1])), groupingSets: null };
		}

		function parseOrderBy(x, y) {
			return splitTop(x, y).map((range) => {
				const a = range[0];
				let b = range[1];
				let dir = 'asc';
				let hierarchy = false;
				if (b - a >= 2 && (isWord(T[b - 1], 'УБЫВ') || isWord(T[b - 1], 'ВОЗР'))) {
					dir = isWord(T[b - 1], 'УБЫВ') ? 'desc' : 'asc';
					b--;
				}
				if (b - a >= 2 && isWord(T[b - 1], 'ИЕРАРХИЯ')) {
					hierarchy = true;
					b--;
				}
				return { expr: slice(a, b), dir: dir, hierarchy: hierarchy };
			});
		}

		function parseTotals(x, y) {
			let by = -1;
			for (let i = x; i < y; i++) {
				if (isOpen(T[i])) {
					i = skip(i, y) - 1;
					continue;
				}
				if (keywordAt(i, x, y) === 'ПО') {
					by = i;
					break;
				}
			}
			const aggregates = splitTop(x, by >= 0 ? by : y)
				.filter((range) => range[1] > range[0])
				.map((range) => {
					const tail = aliasTail(range[0], range[1]);
					return { expr: slice(range[0], tail.end), alias: tail.alias };
				});
			let overall = false;
			let items = null;
			if (by >= 0) {
				items = [];
				splitTop(by + 1, y).forEach((range, index) => {
					const a = range[0];
					if (index === 0 && range[1] - a === 1 && isWord(T[a], 'ОБЩИЕ')) {
						overall = true;
						return;
					}
					const tail = aliasTail(a, range[1]);
					let b = tail.end;
					let mode = null;
					let periods = null;
					if (b - a >= 2 && isWord(T[b - 1], 'ИЕРАРХИЯ')) {
						if (b - a >= 3 && isWord(T[b - 2], 'ТОЛЬКО')) {
							mode = 'onlyHierarchy';
							b -= 2;
						} else {
							mode = 'hierarchy';
							b--;
						}
					} else if (b - a >= 3 && isPunct(T[b - 1], ')') && match[b - 1] - 1 > a && isWord(T[match[b - 1] - 1], 'ПЕРИОДАМИ')) {
						const open = match[b - 1];
						mode = 'periods';
						periods = slice(open + 1, b - 1);
						b = open - 1;
					}
					items.push({ expr: slice(a, b), mode: mode, periods: periods, alias: tail.alias });
				});
			}
			return { aggregates: aggregates, overall: overall, by: items };
		}

		function parseIndexes(x, y) {
			if (x + 1 < y && isWord(T[x], 'НАБОРАМ') && isPunct(T[x + 1], '(')) {
				const inner = innerEnd(x + 1, y);
				const sets = splitTop(x + 2, inner).map((range) => {
					const a = range[0];
					let b = range[1];
					let unique = false;
					if (b - a >= 2 && isWord(T[b - 1], 'УНИКАЛЬНО')) {
						unique = true;
						b--;
					}
					if (b > a && isPunct(T[a], '(') && match[a] === b - 1) {
						return { unique: unique, fields: splitTop(a + 1, b - 1).map((r) => slice(r[0], r[1])) };
					}
					return { unique: unique, fields: b > a ? [slice(a, b)] : [] };
				});
				const after = skip(x + 1, y);
				if (after < y) {
					diag(T[after], 'Лишнее после ИНДЕКСИРОВАТЬ ПО НАБОРАМ');
				}
				return inner > x + 2 ? sets : [];
			}
			const ranges = splitTop(x, y);
			if (!ranges.length) {
				diagAt(x, 'Нет полей индекса');
				return [];
			}
			let unique = false;
			const last = ranges[ranges.length - 1];
			if (last[1] - last[0] >= 2 && isWord(T[last[1] - 1], 'УНИКАЛЬНО')) {
				unique = true;
				last[1]--;
			}
			return [{ unique: unique, fields: ranges.map((r) => slice(r[0], r[1])) }];
		}

		function parseList(x, y) {
			return splitTop(x, y).map((r) => slice(r[0], r[1]));
		}

		/** Запрос (или вложенный запрос) на лексемах [a, b). */
		function parseStatement(a, b) {
			const clauses = scanClauses(a, b);
			if (!clauses.length) {
				diagAt(a, 'Ожидалось ВЫБРАТЬ или УНИЧТОЖИТЬ');
				return newStatement();
			}
			if (clauses[0].kw > a) {
				diag(T[a], 'Ожидалось ВЫБРАТЬ или УНИЧТОЖИТЬ');
			}
			if (clauses[0].name === 'drop') {
				const first = clauses[0];
				if (first.end - first.start !== 1 || T[first.start].k !== 'w') {
					diagAt(first.start, 'После УНИЧТОЖИТЬ ожидалось имя временной таблицы');
				}
				for (const extra of clauses.slice(1)) {
					diag(T[extra.kw], 'Лишнее после УНИЧТОЖИТЬ');
				}
				return { type: 'drop', table: slice(first.start, first.end) };
			}
			const statement = newStatement();
			let part = null;
			let partStage = -1;
			let statementStage = -1;
			let pendingUnion = null;
			for (const clause of clauses) {
				const keyword = T[clause.kw];
				const word = text.slice(keyword.s, T[clause.start - 1].e);
				if (clause.name === 'drop') {
					diag(keyword, 'УНИЧТОЖИТЬ внутри запроса выборки');
					continue;
				}
				if (clause.name === 'select') {
					if (statementStage >= 0) {
						diag(keyword, 'ВЫБРАТЬ после предложений всего запроса');
					} else if (part && pendingUnion === null) {
						diag(keyword, 'ВЫБРАТЬ без ОБЪЕДИНИТЬ');
					}
					part = newPart(statement.parts.length ? (pendingUnion === null ? true : pendingUnion) : null);
					pendingUnion = null;
					partStage = 0;
					statement.parts.push(part);
					const tail = trailingBlocks(clause.start, clause.end, false);
					parseSelectBody(part, clause.start, tail.end);
					attachBlocks(part, tail.blocks, 'afterFields', true, clause.end);
					continue;
				}
				if (clause.name === 'union') {
					if (!part || pendingUnion !== null || statementStage >= 0) {
						diag(keyword, 'ОБЪЕДИНИТЬ не на своём месте');
					}
					if (clause.end > clause.start) {
						diag(T[clause.start], 'Лишнее после ОБЪЕДИНИТЬ');
					}
					pendingUnion = clause.start - clause.kw === 2;
					partStage = 99;
					continue;
				}
				const partLevel = PART_STAGE[clause.name] !== undefined && !(clause.name === 'forUpdate' && statementStage >= 0);
				if (partLevel) {
					if (!part || pendingUnion !== null || statementStage >= 0) {
						diag(keyword, word + ' не на своём месте');
						continue;
					}
					const stage = PART_STAGE[clause.name];
					if (stage <= partStage) {
						diag(keyword, 'Нестандартный порядок предложений: ' + word);
					}
					partStage = stage;
					const tail = trailingBlocks(clause.start, clause.end, clause.name === 'from');
					const placement = PART_PLACEMENT[clause.name];
					parsePartClause(part, clause, tail.end, keyword, word);
					attachBlocks(part, tail.blocks, placement, true, clause.end);
					continue;
				}
				if (!part || pendingUnion !== null) {
					diag(keyword, word + ' не на своём месте');
					continue;
				}
				const stage = STATEMENT_STAGE[clause.name];
				if (stage <= statementStage) {
					diag(keyword, 'Нестандартный порядок предложений: ' + word);
				}
				statementStage = stage;
				const tail = trailingBlocks(clause.start, clause.end, false);
				parseStatementClause(statement, clause, tail.end, keyword);
				attachBlocks(statement, tail.blocks, STATEMENT_PLACEMENT[clause.name], false, clause.end);
			}
			if (pendingUnion !== null) {
				diagAt(b, 'После ОБЪЕДИНИТЬ нет запроса');
			}
			return statement;
		}

		function newStatement() {
			return { type: 'select', parts: [], orderBy: null, autoOrder: false, totals: null, indexes: [], forUpdate: null, raw: [] };
		}

		function parsePartClause(part, clause, end, keyword, word) {
			const x = clause.start;
			switch (clause.name) {
				case 'into':
				case 'add':
					if (end - x !== 1 || T[x].k !== 'w') {
						diagAt(x, 'После ' + word + ' ожидалось имя временной таблицы');
					}
					part.into = { table: slice(x, end), mode: clause.name === 'add' ? 'add' : 'create' };
					return;
				case 'from':
					if (end <= x) {
						diag(keyword, 'Пустое предложение ИЗ');
					}
					parseFrom(part, x, end);
					return;
				case 'where':
				case 'having':
					if (end <= x) {
						diag(keyword, 'Пустое условие ' + word);
					}
					part[clause.name] = { conditions: splitConditions(x, end) };
					return;
				case 'groupBy':
					if (end <= x) {
						diag(keyword, 'Пустое ' + word);
					}
					part.groupBy = parseGroupBy(x, end);
					return;
				case 'forUpdate':
					part.forUpdate = parseList(x, end);
					return;
			}
		}

		function parseStatementClause(statement, clause, end, keyword) {
			const x = clause.start;
			switch (clause.name) {
				case 'orderBy':
					if (end <= x) {
						diag(keyword, 'Пустое УПОРЯДОЧИТЬ ПО');
					}
					statement.orderBy = parseOrderBy(x, end);
					return;
				case 'autoOrder':
					if (end > x) {
						diag(T[x], 'Лишнее после АВТОУПОРЯДОЧИВАНИЕ');
					}
					statement.autoOrder = true;
					return;
				case 'totals':
					statement.totals = parseTotals(x, end);
					return;
				case 'index':
					statement.indexes = parseIndexes(x, end);
					return;
				case 'forUpdate':
					statement.forUpdate = parseList(x, end);
					return;
			}
		}

		/** Диапазоны запросов пакета: по «;» верхнего уровня, пустые запросы пропускаются. */
		function statementRanges() {
			const ranges = [];
			let start = 0;
			for (let i = 0; i < T.length; ) {
				const token = T[i];
				if (isOpen(token)) {
					i = skip(i, T.length);
					continue;
				}
				if (isPunct(token, ';')) {
					if (i > start) {
						ranges.push([start, i]);
					}
					start = i + 1;
				}
				i++;
			}
			if (start < T.length) {
				ranges.push([start, T.length]);
			}
			return ranges;
		}

		return {
			all: all,
			tokens: T,
			diagnostics: diagnostics,
			statementRanges: statementRanges,
			parseStatement: function (a, b) {
				clip = a < T.length ? T[a].s : 0;
				return parseStatement(a, b);
			},
		};
	}

	/** Язык ключевых слов текста: по большинству слов-предложений; при равенстве — русский. */
	function detectLang(tokens) {
		let ru = 0;
		let en = 0;
		for (const token of tokens) {
			if (token.k !== 'w') {
				continue;
			}
			if (CLAUSE_WORDS[token.u]) {
				ru++;
			} else if (EN_TO_RU[token.u] && CLAUSE_WORDS[EN_TO_RU[token.u]]) {
				en++;
			}
		}
		return en > ru ? 'en' : 'ru';
	}

	function emptyModel(text) {
		return {
			format: FORMAT,
			lang: 'ru',
			eol: text.indexOf('\r\n') >= 0 ? '\r\n' : '\n',
			statements: [],
			comments: { total: countRealComments(text), dropped: 0 },
			original: { count: 0, tail: text },
		};
	}

	function parseText(text) {
		const parser = createParser(text);
		const ranges = parser.statementRanges();
		const tokens = parser.tokens;
		const statements = [];
		let previousEnd = 0;
		ranges.forEach((range, index) => {
			const start = tokens[range[0]].s;
			const end = tokens[range[1] - 1].e;
			const statement = parser.parseStatement(range[0], range[1]);
			statement.original = { index: index, before: text.slice(previousEnd, start), text: text.slice(start, end) };
			statements.push(statement);
			previousEnd = end;
		});
		const model = {
			format: FORMAT,
			lang: detectLang(tokens),
			eol: text.indexOf('\r\n') >= 0 ? '\r\n' : '\n',
			statements: statements,
			comments: { total: 0, dropped: 0 },
			original: { count: ranges.length, tail: text.slice(previousEnd) },
		};
		let comments = 0;
		for (const token of parser.all) {
			if (token.k === 'com' && !isSeparatorComment(text.slice(token.s, token.e))) {
				comments++;
			}
		}
		model.comments.total = comments;
		const diagnostics = parser.diagnostics.slice().sort((a, b) => a.offset - b.offset);
		return { model: model, diagnostics: diagnostics };
	}

	/**
	 * Разбор текста запроса набора. Не бросает исключений: на любом тексте возвращается модель
	 * (возможно, неполная) и диагностика с позицией первого неразобранного места.
	 */
	function parse(text) {
		const source = typeof text === 'string' ? text : '';
		try {
			return parseText(source);
		} catch (error) {
			const message = error && error.message ? error.message : String(error);
			return {
				model: emptyModel(source),
				diagnostics: [Object.assign({ message: 'Внутренняя ошибка разбора: ' + message, internal: true }, position(source, 0))],
			};
		}
	}

	// Срезы неизменённых запросов разбираются на каждой сборке (живой предпросмотр «Запроса»), а сами
	// тексты между сборками почти не меняются: держим небольшой кэш разборов по тексту среза
	const STATEMENT_CACHE_LIMIT = 128;
	const statementCache = new Map();

	/** Разбор отдельного среза как одного запроса; null — если срез не один запрос. */
	function parseStatementText(text) {
		if (statementCache.has(text)) {
			return statementCache.get(text);
		}
		let statement = null;
		try {
			const parser = createParser(text);
			const ranges = parser.statementRanges();
			if (ranges.length === 1 && ranges[0][0] === 0 && parser.tokens[0].s === 0 && parser.tokens[ranges[0][1] - 1].e === text.length) {
				statement = parser.parseStatement(ranges[0][0], ranges[0][1]);
			}
		} catch (error) {
			statement = null;
		}
		if (statementCache.size >= STATEMENT_CACHE_LIMIT) {
			statementCache.delete(statementCache.keys().next().value);
		}
		statementCache.set(text, statement);
		return statement;
	}

	// ---------------------------------------------------------------------------------------------
	// Сравнение моделей
	// ---------------------------------------------------------------------------------------------

	/** Служебные ключи: место в исходном тексте, счётчики и оформление — не содержание запроса. */
	const IGNORED_KEYS = new Set(['original', 'comments', 'format', 'lang', 'eol']);

	function blank(value) {
		return value === null || value === undefined || value === false;
	}

	function equalNodes(a, b) {
		if (blank(a) || blank(b)) {
			return blank(a) && blank(b);
		}
		if (typeof a !== 'object' || typeof b !== 'object') {
			return a === b;
		}
		if (Array.isArray(a) !== Array.isArray(b)) {
			return false;
		}
		if (Array.isArray(a)) {
			if (a.length !== b.length) {
				return false;
			}
			for (let i = 0; i < a.length; i++) {
				if (!equalNodes(a[i], b[i])) {
					return false;
				}
			}
			return true;
		}
		for (const key of Object.keys(a)) {
			if (!IGNORED_KEYS.has(key) && !equalNodes(a[key], b[key])) {
				return false;
			}
		}
		for (const key of Object.keys(b)) {
			if (!IGNORED_KEYS.has(key) && !(key in a) && !blank(b[key])) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Одинаковы ли модели по содержанию запроса (без места в тексте, счётчиков и языка): «модель не
	 * менялась» — конструктор закрывается без записи. null, undefined и false равнозначны, пустой
	 * массив — нет: `ДЛЯ ИЗМЕНЕНИЯ` без списка и его отсутствие — разные запросы.
	 */
	function sameModel(a, b) {
		const left = a && typeof a === 'object' ? a : {};
		const right = b && typeof b === 'object' ? b : {};
		return equalNodes(arr(left.statements), arr(right.statements));
	}

	// ---------------------------------------------------------------------------------------------
	// Сборщик
	// ---------------------------------------------------------------------------------------------

	function contextOf(model, options) {
		const opts = options || {};
		const lang = opts.lang === 'en' || opts.lang === 'ru' ? opts.lang : model && model.lang === 'en' ? 'en' : 'ru';
		const eol = opts.eol === '\r\n' || opts.eol === '\n' ? opts.eol : model && model.eol === '\r\n' ? '\r\n' : '\n';
		return {
			kw: KEYWORDS[lang],
			eol: eol,
			separator: eol + ';' + eol + eol + '/'.repeat(SEPARATOR_WIDTH) + eol,
		};
	}

	function joinKeyword(kind, kw) {
		return kind === 'left' ? kw.left : kind === 'right' ? kw.right : kind === 'full' ? kw.full : kw.inner;
	}

	function asPart(kw, alias) {
		return present(alias) ? ' ' + kw.as + ' ' + alias : '';
	}

	function partAnchorExists(part, anchor) {
		switch (anchor) {
			case 'afterFields':
				return true;
			case 'afterInto':
				return !!part.into;
			case 'afterFrom':
				return arr(part.from).length > 0;
			case 'afterWhere':
				return !!part.where && arr(part.where.conditions).length > 0;
			case 'afterGroupBy':
				return !!part.groupBy && (Array.isArray(part.groupBy.groupingSets) || arr(part.groupBy.items).length > 0);
			case 'afterHaving':
				return !!part.having && arr(part.having.conditions).length > 0;
			case 'afterForUpdate':
				return Array.isArray(part.forUpdate);
		}
		return false;
	}

	function statementAnchorExists(statement, anchor) {
		switch (anchor) {
			case 'afterOrderBy':
				return arr(statement.orderBy).length > 0;
			case 'afterAutoOrder':
				return !!statement.autoOrder;
			case 'afterTotals':
				return !!statement.totals;
			case 'afterIndex':
				return indexesOf(statement).length > 0;
			case 'afterForUpdate':
				return Array.isArray(statement.forUpdate);
		}
		return false;
	}

	/**
	 * Место блока: записанное, если его предложение осталось; иначе ближайшее предыдущее. Новый блок
	 * без места встаёт по канону: {ВЫБРАТЬ} — после ПОМЕСТИТЬ (или списка выборки), {ГДЕ} — после ГДЕ
	 * (или ИЗ), до СГРУППИРОВАТЬ.
	 */
	function resolvePartAnchor(part, placement, fallback) {
		let k = PART_ANCHORS.indexOf(placement);
		if (k < 0) {
			k = PART_ANCHORS.indexOf(fallback);
		}
		while (k > 0 && !partAnchorExists(part, PART_ANCHORS[k])) {
			k--;
		}
		return PART_ANCHORS[k];
	}

	function resolveStatementAnchor(statement, placement) {
		let k = STATEMENT_ANCHORS.indexOf(placement);
		if (k < 0) {
			k = STATEMENT_ANCHORS.length - 1;
		}
		while (k >= 0 && !statementAnchorExists(statement, STATEMENT_ANCHORS[k])) {
			k--;
		}
		return k >= 0 ? STATEMENT_ANCHORS[k] : 'afterParts';
	}

	function indexesOf(statement) {
		return arr(statement.indexes).filter((index) => index && arr(index.fields).length > 0);
	}

	function buildDcsBlock(block, isSelect, ctx, ind) {
		const kw = ctx.kw;
		const head = '{' + (isSelect ? kw.select : kw.where);
		const items = arr(block.items);
		const breaks = new Set(arr(block.breaks));
		const lines = [head];
		items.forEach((item, k) => {
			if (k > 0 && breaks.has(k)) {
				lines[lines.length - 1] += '}';
				lines.push(head);
			}
			const comma = k < items.length - 1 && !breaks.has(k + 1) ? ',' : '';
			lines.push('\t' + dcsItemText(item, isSelect, ctx, ind + '\t') + comma);
		});
		lines[lines.length - 1] += '}';
		return lines.join(ctx.eol + ind);
	}

	function dcsItemText(item, isSelect, ctx, prefix) {
		const value = item || {};
		let out;
		if (isSelect) {
			out = present(value.path) ? value.path + (value.star ? '.*' : '') : emitText(value.text, prefix, ctx.eol);
		} else if (value.kind === 'field' || value.kind === 'fieldStar' || (present(value.path) && value.kind !== 'condition')) {
			out = value.path + (value.kind === 'fieldStar' || value.star ? '.*' : '');
		} else {
			const body = emitText(value.text, prefix, ctx.eol);
			out = value.parens ? '(' + body + ')' : body;
		}
		return out + asPart(ctx.kw, value.alias);
	}

	function buildParam(param, ctx, prefix) {
		const value = param || {};
		const textValue = emitText(value.text, prefix, ctx.eol);
		if (value.dcs && typeof value.dcs === 'object') {
			const block = '{' + emitText(value.dcs.text, prefix, ctx.eol) + '}';
			const whole = value.dcs.kind === 'whole' || (value.dcs.kind !== 'tail' && !present(value.text));
			return whole ? block : textValue + ' ' + block;
		}
		return textValue;
	}

	function buildSource(source, ctx, prefix) {
		const value = source || {};
		let out;
		if (value.kind === 'subquery') {
			out = '(' + buildStatementText(value.query || {}, ctx, prefix) + ')';
		} else if (value.kind === 'group') {
			out = '(' + emitText(value.text, prefix, ctx.eol) + ')';
		} else if (value.kind === 'param') {
			out = '&' + (value.name || '');
		} else {
			out = (value.table || '') + (Array.isArray(value.params) ? '(' + value.params.map((p) => buildParam(p, ctx, prefix)).join(', ') + ')' : '');
		}
		return out + asPart(ctx.kw, value.alias);
	}

	function buildJoins(joins, ctx, ind, pad, lines) {
		for (let k = 0; k < joins.length; k++) {
			const group = joins[k] ? joins[k].optionalGroup : null;
			const first = lines.length;
			buildJoin(joins[k], ctx, ind, pad, lines);
			if (group === null || group === undefined) {
				continue;
			}
			// Соседние необязательные соединения с одним номером группы — одни скобки
			while (k + 1 < joins.length && joins[k + 1] && joins[k + 1].optionalGroup === group) {
				k++;
				buildJoin(joins[k], ctx, ind, pad, lines);
			}
			lines[first] = pad + '{' + lines[first].slice(pad.length);
			lines[lines.length - 1] += '}';
		}
	}

	function buildJoin(join, ctx, ind, pad, lines) {
		const value = join || {};
		const kw = ctx.kw;
		lines.push(pad + joinKeyword(value.kind, kw) + ' ' + kw.join + ' ' + buildSource(value.source, ctx, ind + pad));
		buildJoins(arr(value.joins), ctx, ind, pad + '\t', lines);
		const conditions = value.on ? arr(value.on.conditions) : [];
		conditions.forEach((condition, k) => {
			if (k === 0) {
				lines.push(pad + kw.on + ' ' + emitText(condition, ind + pad, ctx.eol));
			} else {
				lines.push(pad + '\t' + kw.and + ' ' + emitText(condition, ind + pad + '\t', ctx.eol));
			}
		});
	}

	function listLines(items, ind, lines, render) {
		items.forEach((item, k) => {
			lines.push('\t' + render(item, ind + '\t') + (k < items.length - 1 ? ',' : ''));
		});
	}

	function conditionLines(conditions, ctx, ind, lines) {
		conditions.forEach((condition, k) => {
			lines.push('\t' + (k > 0 ? ctx.kw.and + ' ' : '') + emitText(condition, ind + '\t', ctx.eol));
		});
	}

	function partBlocks(part, ctx, ind) {
		const byAnchor = {};
		const put = (anchor, value) => {
			(byAnchor[anchor] = byAnchor[anchor] || []).push(value);
		};
		if (part.dcsSelect) {
			put(resolvePartAnchor(part, part.dcsSelect.placement, 'afterInto'), buildDcsBlock(part.dcsSelect, true, ctx, ind));
		}
		if (part.dcsWhere) {
			put(resolvePartAnchor(part, part.dcsWhere.placement, 'afterWhere'), buildDcsBlock(part.dcsWhere, false, ctx, ind));
		}
		for (const raw of arr(part.raw)) {
			put(resolvePartAnchor(part, raw && raw.placement, 'afterForUpdate'), emitText(raw && raw.text, ind, ctx.eol));
		}
		return byAnchor;
	}

	function buildPart(part, ctx, ind, lines) {
		const kw = ctx.kw;
		const blocks = partBlocks(part, ctx, ind);
		const flush = (anchor) => {
			for (const block of blocks[anchor] || []) {
				lines.push(block);
			}
		};
		let head = kw.select;
		if (part.allowed) {
			head += ' ' + kw.allowed;
		}
		if (part.distinct) {
			head += ' ' + kw.distinct;
		}
		if (present(part.top)) {
			head += ' ' + kw.top + ' ' + part.top;
		}
		lines.push(head);
		listLines(arr(part.fields), ind, lines, (field, prefix) => emitText(field && field.expr, prefix, ctx.eol) + asPart(kw, field && field.alias));
		flush('afterFields');
		if (part.into) {
			lines.push((part.into.mode === 'add' ? kw.add : kw.into) + ' ' + (part.into.table || ''));
			flush('afterInto');
		}
		const from = arr(part.from);
		if (from.length) {
			lines.push(kw.from);
			from.forEach((entry, k) => {
				const value = entry || {};
				lines.push('\t' + buildSource(value.source, ctx, ind + '\t'));
				buildJoins(arr(value.joins), ctx, ind, '\t\t', lines);
				if (k < from.length - 1) {
					lines[lines.length - 1] += ',';
				}
			});
			flush('afterFrom');
		}
		if (partAnchorExists(part, 'afterWhere')) {
			lines.push(kw.where);
			conditionLines(part.where.conditions, ctx, ind, lines);
			flush('afterWhere');
		}
		if (partAnchorExists(part, 'afterGroupBy')) {
			const sets = part.groupBy.groupingSets;
			if (Array.isArray(sets)) {
				const rendered = sets.map((set) => '(' + arr(set).map((e) => emitText(e, ind + '\t', ctx.eol)).join(', ') + ')');
				lines.push(kw.groupBy + ' ' + kw.groupingSets + ' (' + rendered.join(', ') + ')');
			} else {
				lines.push(kw.groupBy);
				listLines(arr(part.groupBy.items), ind, lines, (item, prefix) => emitText(item, prefix, ctx.eol));
			}
			flush('afterGroupBy');
		}
		if (partAnchorExists(part, 'afterHaving')) {
			lines.push(kw.having);
			conditionLines(part.having.conditions, ctx, ind, lines);
			flush('afterHaving');
		}
		if (Array.isArray(part.forUpdate)) {
			lines.push(kw.forUpdate);
			listLines(part.forUpdate, ind, lines, (item, prefix) => emitText(item, prefix, ctx.eol));
			flush('afterForUpdate');
		}
	}

	function buildStatementText(statement, ctx, ind) {
		const kw = ctx.kw;
		const value = statement || {};
		if (value.type === 'drop') {
			return kw.drop + ' ' + (value.table || '');
		}
		const lines = [];
		arr(value.parts).forEach((part, index) => {
			if (index > 0) {
				lines.push('');
				lines.push(kw.union + (part && part.unionAll === false ? '' : ' ' + kw.all));
				lines.push('');
			}
			buildPart(part || {}, ctx, ind, lines);
		});
		const blocks = {};
		for (const raw of arr(value.raw)) {
			const anchor = resolveStatementAnchor(value, raw && raw.placement);
			(blocks[anchor] = blocks[anchor] || []).push(emitText(raw && raw.text, ind, ctx.eol));
		}
		const flush = (anchor) => {
			for (const block of blocks[anchor] || []) {
				lines.push(block);
			}
		};
		flush('afterParts');
		if (statementAnchorExists(value, 'afterOrderBy')) {
			lines.push(kw.orderBy);
			listLines(value.orderBy, ind, lines, (item, prefix) => {
				const order = item || {};
				return emitText(order.expr, prefix, ctx.eol) + (order.hierarchy ? ' ' + kw.hierarchy : '') + (order.dir === 'desc' ? ' ' + kw.desc : '');
			});
			flush('afterOrderBy');
		}
		if (value.autoOrder) {
			lines.push(kw.autoOrder);
			flush('afterAutoOrder');
		}
		if (value.totals) {
			lines.push(kw.totals);
			listLines(arr(value.totals.aggregates), ind, lines, (item, prefix) => emitText(item && item.expr, prefix, ctx.eol) + asPart(kw, item && item.alias));
			if (Array.isArray(value.totals.by)) {
				lines.push(kw.by);
				const items = (value.totals.overall ? [{ overall: true }] : []).concat(value.totals.by);
				listLines(items, ind, lines, (item, prefix) => {
					const group = item || {};
					if (group.overall) {
						return kw.overall;
					}
					let mode = '';
					if (group.mode === 'hierarchy') {
						mode = ' ' + kw.hierarchy;
					} else if (group.mode === 'onlyHierarchy') {
						mode = ' ' + kw.onlyHierarchy;
					} else if (group.mode === 'periods') {
						mode = ' ' + kw.periods + '(' + emitText(group.periods, prefix, ctx.eol) + ')';
					}
					return emitText(group.expr, prefix, ctx.eol) + mode + asPart(kw, group.alias);
				});
			}
			flush('afterTotals');
		}
		const indexes = indexesOf(value);
		if (indexes.length === 1) {
			lines.push(kw.indexBy);
			listLines(indexes[0].fields, ind, lines, (item, prefix) => emitText(item, prefix, ctx.eol));
			if (indexes[0].unique) {
				lines[lines.length - 1] += ' ' + kw.unique;
			}
			flush('afterIndex');
		} else if (indexes.length > 1) {
			const sets = indexes.map((index) => '(' + index.fields.map((f) => emitText(f, ind + '\t', ctx.eol)).join(', ') + ')' + (index.unique ? ' ' + kw.unique : ''));
			lines.push(kw.indexBy + ' ' + kw.sets + ' (' + sets.join(', ') + ')');
			flush('afterIndex');
		}
		if (Array.isArray(value.forUpdate)) {
			lines.push(kw.forUpdate);
			listLines(value.forUpdate, ind, lines, (item, prefix) => emitText(item, prefix, ctx.eol));
			flush('afterForUpdate');
		}
		return lines.join(ctx.eol + ind);
	}

	function statementUnchanged(statement, original) {
		const reparsed = parseStatementText(original.text);
		return reparsed !== null && equalNodes(reparsed, statement);
	}

	/**
	 * Сборка со сплайсом и отчётом: text, changed[] (какие запросы пакета собраны заново) и
	 * comments {total, dropped}. options.canonical — собрать всё по канону, без исходных срезов
	 * (так работают самопроверка и круговые тесты).
	 */
	function buildWithReport(model, options) {
		const source = model && typeof model === 'object' ? model : {};
		const ctx = contextOf(source, options);
		const canonical = !!(options && options.canonical);
		const statements = arr(source.statements);
		const changed = [];
		let out = '';
		const originalOf = (statement) =>
			!canonical && statement && statement.original && typeof statement.original.text === 'string' ? statement.original : null;
		statements.forEach((statement, k) => {
			const original = originalOf(statement);
			const same = original !== null && statementUnchanged(statement, original);
			changed.push(!same);
			const body = same ? original.text : buildStatementText(statement, ctx, '');
			let before;
			if (k === 0) {
				before = original && original.index === 0 && typeof original.before === 'string' ? original.before : '';
			} else {
				// Разделитель (вместе с комментариями между запросами) сохраняется, пока соседи
				// остаются соседями исходного пакета
				const previous = originalOf(statements[k - 1]);
				const adjacent = original && previous && previous.index + 1 === original.index && typeof original.before === 'string';
				before = adjacent ? original.before : ctx.separator;
			}
			out += before + body;
		});
		const tail = !canonical && source.original && typeof source.original.tail === 'string' ? source.original : null;
		if (tail) {
			const last = statements.length ? originalOf(statements[statements.length - 1]) : null;
			if (statements.length ? last && last.index === tail.count - 1 : tail.count === 0) {
				out += tail.tail;
			}
		}
		const total = source.comments && typeof source.comments.total === 'number' ? source.comments.total : 0;
		const dropped = Math.max(0, total - countRealComments(out));
		return { text: out, changed: changed, comments: { total: total, dropped: dropped } };
	}

	/**
	 * Текст по модели. Неизменённые запросы пакета — исходными срезами, модель без изменений —
	 * исходный текст байт в байт. Счётчик потерянных комментариев последней сборки записывается в
	 * model.comments.dropped: конструктор предупреждает о них перед ОК.
	 */
	function build(model, options) {
		const report = buildWithReport(model, options);
		if (model && typeof model === 'object') {
			model.comments = { total: report.comments.total, dropped: report.comments.dropped };
		}
		return report.text;
	}

	// ---------------------------------------------------------------------------------------------
	// Самопроверка
	// ---------------------------------------------------------------------------------------------

	/**
	 * Слова, которые сборщик вставляет или опускает сам (КАК у каждого псевдонима, ВНУТРЕННЕЕ у
	 * голого СОЕДИНЕНИЕ, ВНЕШНЕЕ, ВОЗР) — в каноне их нет, чтобы такие замены не считались потерей.
	 */
	const CANON_DROP = new Set(['КАК', 'ВНЕШНЕЕ', 'ВНУТРЕННЕЕ', 'ВОЗР']);
	const PREFIX_RANK = { РАЗРЕШЕННЫЕ: 0, РАЗЛИЧНЫЕ: 1, ПЕРВЫЕ: 2 };

	function canonEntries(text) {
		const out = [];
		for (const token of lex(text)) {
			if (token.k === 'ws' || token.k === 'com') {
				continue;
			}
			let value;
			if (token.k === 'w') {
				value = EN_TO_RU[token.u] || token.u;
				if (CANON_DROP.has(value)) {
					continue;
				}
			} else {
				value = text.slice(token.s, token.e);
				if (token.k === 'str' && value.indexOf('\r') >= 0) {
					value = value.replace(/\r\n?/g, '\n');
				}
				// Пустые запросы пакета («;;») сборщик не воспроизводит
				if (token.k === 'p' && value === ';' && (!out.length || out[out.length - 1].v === ';')) {
					continue;
				}
			}
			out.push({ v: value, s: token.s });
		}
		while (out.length && out[out.length - 1].v === ';') {
			out.pop();
		}
		// Порядок РАЗРЕШЕННЫЕ / РАЗЛИЧНЫЕ / ПЕРВЫЕ N после ВЫБРАТЬ на смысл не влияет
		for (let i = 0; i < out.length; i++) {
			if (out[i].v !== 'ВЫБРАТЬ') {
				continue;
			}
			const group = [];
			let j = i + 1;
			while (j < out.length && PREFIX_RANK[out[j].v] !== undefined) {
				const take = out[j].v === 'ПЕРВЫЕ' && j + 1 < out.length ? 2 : 1;
				group.push(out.slice(j, j + take));
				j += take;
			}
			if (group.length > 1) {
				group.sort((a, b) => PREFIX_RANK[a[0].v] - PREFIX_RANK[b[0].v]);
				out.splice(i + 1, j - i - 1, ...[].concat(...group));
			}
		}
		return out;
	}

	/** Канонические значимые лексемы текста — то, что не должно меняться на круге разбор → сборка. */
	function canonTokens(text) {
		return canonEntries(typeof text === 'string' ? text : '').map((entry) => entry.v);
	}

	function firstDifference(a, b) {
		let k = 0;
		while (k < a.length && k < b.length && a[k].v === b[k].v) {
			k++;
		}
		return k < a.length || k < b.length ? k : -1;
	}

	/**
	 * Можно ли открыть текст в конструкторе: разбор без диагностики, круг «разбор → сборка по канону»
	 * не теряет и не переставляет значимых лексем, повторная сборка совпадает с первой. Ловит потерю
	 * текста, а не синтаксические ошибки: «ВЫБРАТЬ ИЗ» проверку пройдёт, если ничего не потеряно.
	 */
	function selfCheck(text) {
		const source = typeof text === 'string' ? text : '';
		const parsed = parse(source);
		if (parsed.diagnostics.length) {
			const first = parsed.diagnostics[0];
			return { ok: false, firstDiff: position(source, first.offset), message: first.message };
		}
		const built = buildWithReport(parsed.model, { canonical: true }).text;
		const before = canonEntries(source);
		const after = canonEntries(built);
		const k = firstDifference(before, after);
		if (k >= 0) {
			const offset = k < before.length ? before[k].s : source.length;
			const lost = k < before.length ? '«' + before[k].v + '»' : 'конец текста';
			return { ok: false, firstDiff: position(source, offset), message: 'Сборка теряет или переставляет текст: ' + lost };
		}
		const again = buildWithReport(parse(built).model, { canonical: true }).text;
		if (again !== built) {
			const m = firstDifference(after, canonEntries(again));
			const offset = m >= 0 && m < before.length ? before[m].s : 0;
			return { ok: false, firstDiff: position(source, offset), message: 'Повторная сборка не совпала с первой' };
		}
		return { ok: true };
	}

	// ---------------------------------------------------------------------------------------------
	// Помощники UI
	// ---------------------------------------------------------------------------------------------

	const PATH_RE = /^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u;

	/**
	 * Имена колонок результата запроса (по первой части объединения): псевдоним, иначе последний
	 * сегмент пути — то же правило, что у автозаполнения полей md-sparrow. Выражение без псевдонима
	 * имени не даёт (null).
	 */
	function outputFields(statement) {
		if (!statement || statement.type === 'drop') {
			return [];
		}
		const first = arr(statement.parts)[0];
		return arr(first && first.fields).map((field) => {
			if (field && present(field.alias)) {
				return field.alias;
			}
			const expr = field && typeof field.expr === 'string' ? field.expr.trim() : '';
			return PATH_RE.test(expr) && !LITERALS.has(expr.toUpperCase()) ? expr.slice(expr.lastIndexOf('.') + 1) : null;
		});
	}

	/** Временные таблицы, созданные запросами пакета до beforeIndex (уничтоженные — исключены). */
	function tempTables(model, beforeIndex) {
		const statements = arr(model && model.statements);
		const limit = typeof beforeIndex === 'number' ? Math.min(beforeIndex, statements.length) : statements.length;
		const tables = new Map();
		for (let i = 0; i < limit; i++) {
			const statement = statements[i];
			if (!statement) {
				continue;
			}
			if (statement.type === 'drop') {
				tables.delete(String(statement.table || '').toUpperCase());
				continue;
			}
			const owner = arr(statement.parts).find((part) => part && part.into);
			if (!owner || !present(owner.into.table)) {
				continue;
			}
			const key = String(owner.into.table).toUpperCase();
			// ДОБАВИТЬ дописывает строки в уже созданную таблицу: состав колонок — от создания
			if (owner.into.mode === 'add' && tables.has(key)) {
				continue;
			}
			tables.set(key, {
				name: owner.into.table,
				fields: outputFields(statement).filter((name) => name !== null),
				statement: i,
			});
		}
		return Array.from(tables.values());
	}

	/** Все `&`-параметры текста (и внутри {…}), без повторов без учёта регистра, в порядке появления. */
	function parametersOf(text) {
		const source = typeof text === 'string' ? text : '';
		const seen = new Set();
		const names = [];
		for (const token of lex(source)) {
			if (token.k !== 'par') {
				continue;
			}
			const name = source.slice(token.s + 1, token.e);
			const key = name.toUpperCase();
			if (!seen.has(key)) {
				seen.add(key);
				names.push(name);
			}
		}
		return names;
	}

	function freeName(base, taken) {
		const used = new Set(arr(taken).map((name) => String(name).toUpperCase()));
		if (!used.has(base.toUpperCase())) {
			return base;
		}
		for (let n = 1; ; n++) {
			if (!used.has((base + n).toUpperCase())) {
				return base + n;
			}
		}
	}

	/**
	 * Псевдоним нового поля по правилу конструктора: сегменты пути после алиаса таблицы
	 * (`Т.Поле` → `Поле`, `Т.Контрагент.ИНН` → `КонтрагентИНН`), у агрегата — по его аргументу;
	 * выражение — `ПолеN`. Занятое имя получает числовой суффикс.
	 */
	function defaultFieldAlias(expr, taken) {
		let value = typeof expr === 'string' ? expr.trim() : '';
		const aggregate = /^([\p{L}_][\p{L}\p{N}_]*)\s*\(\s*(?:(?:РАЗЛИЧНЫЕ|DISTINCT)\s+)?([^()]*?)\s*\)$/iu.exec(value);
		if (aggregate && AGGREGATES.has(aggregate[1].toUpperCase())) {
			value = aggregate[2];
		}
		if (PATH_RE.test(value) && !LITERALS.has(value.toUpperCase())) {
			const segments = value.split('.');
			return freeName(segments.length > 1 ? segments.slice(1).join('') : segments[0], taken);
		}
		const used = new Set(arr(taken).map((name) => String(name).toUpperCase()));
		for (let n = 1; ; n++) {
			if (!used.has(('Поле' + n).toUpperCase())) {
				return 'Поле' + n;
			}
		}
	}

	/**
	 * Алиас новой таблицы: имя объекта, у ТЧ и ВТ регистра — склейка сегментов после вида
	 * (`Документ.Счет.Товары` → `СчетТовары`), у временной таблицы — её имя, у вложенного запроса —
	 * `ВложенныйЗапрос`; повтор — суффикс 1, 2, …
	 */
	function defaultTableAlias(table, taken) {
		let base;
		if (table && typeof table === 'object') {
			if (table.kind === 'subquery') {
				base = 'ВложенныйЗапрос';
			} else if (table.kind === 'param') {
				base = String(table.name || 'Таблица');
			} else {
				return defaultTableAlias(table.table, taken);
			}
		} else {
			const value = typeof table === 'string' ? table.trim() : '';
			if (!value) {
				base = 'ВложенныйЗапрос';
			} else if (value[0] === '&') {
				base = value.slice(1);
			} else {
				const segments = value.split('.');
				base = segments.length > 1 ? segments.slice(1).join('') : segments[0];
			}
		}
		return freeName(base, taken);
	}

	/** Замена алиаса таблицы в тексте выражения: только голова пути `Алиас.`, не строки и не комментарии. */
	function renameAliasInText(value, from, to) {
		if (typeof value !== 'string' || !value || !from) {
			return value;
		}
		const want = String(from).toUpperCase();
		const tokens = lex(value);
		let out = '';
		let last = 0;
		let previous = null;
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token.k === 'ws' || token.k === 'com') {
				continue;
			}
			if (token.k === 'w' && token.u === want && !isPunct(previous, '.')) {
				let j = i + 1;
				while (j < tokens.length && (tokens[j].k === 'ws' || tokens[j].k === 'com')) {
					j++;
				}
				if (isPunct(tokens[j], '.')) {
					out += value.slice(last, token.s) + to;
					last = token.e;
				}
			}
			previous = token;
		}
		return out + value.slice(last);
	}

	function renameInJoins(joins, from, to) {
		return arr(joins).map((join) => {
			const copy = Object.assign({}, join);
			copy.source = renameSource(join && join.source, from, to);
			copy.joins = renameInJoins(join && join.joins, from, to);
			if (join && join.on) {
				copy.on = { conditions: arr(join.on.conditions).map((c) => renameAliasInText(c, from, to)) };
			}
			return copy;
		});
	}

	function renameSource(source, from, to) {
		if (!source || typeof source !== 'object') {
			return source;
		}
		const copy = Object.assign({}, source);
		if (present(copy.alias) && String(copy.alias).toUpperCase() === String(from).toUpperCase()) {
			copy.alias = to;
		}
		return copy;
	}

	/**
	 * Переименование алиаса таблицы части объединения: сам алиас источника и ссылки `Алиас.…` во
	 * всех её предложениях (поля, условия соединений, ГДЕ, {ГДЕ}, группировка, ИМЕЮЩИЕ). Возвращает
	 * новую часть. Вложенные запросы-источники — своя область имён, они не трогаются; {ВЫБРАТЬ}
	 * ссылается на псевдонимы выборки, а не на алиасы, и тоже не меняется.
	 */
	function renameAlias(part, from, to) {
		if (!part || typeof part !== 'object' || !present(from) || !present(to)) {
			return part;
		}
		const text = (value) => renameAliasInText(value, from, to);
		const copy = Object.assign({}, part);
		copy.fields = arr(part.fields).map((field) => Object.assign({}, field, { expr: text(field && field.expr) }));
		copy.from = arr(part.from).map((entry) => ({
			source: renameSource(entry && entry.source, from, to),
			joins: renameInJoins(entry && entry.joins, from, to),
		}));
		if (part.where) {
			copy.where = { conditions: arr(part.where.conditions).map(text) };
		}
		if (part.having) {
			copy.having = { conditions: arr(part.having.conditions).map(text) };
		}
		if (part.groupBy) {
			copy.groupBy = {
				items: arr(part.groupBy.items).map(text),
				groupingSets: Array.isArray(part.groupBy.groupingSets) ? part.groupBy.groupingSets.map((set) => arr(set).map(text)) : null,
			};
		}
		if (part.dcsWhere) {
			copy.dcsWhere = Object.assign({}, part.dcsWhere, {
				items: arr(part.dcsWhere.items).map((item) => {
					const next = Object.assign({}, item);
					// Путь из одного сегмента — имя поля, а не алиас: менять его нельзя
					if (present(next.path) && String(next.path).indexOf('.') > 0) {
						next.path = text(next.path);
					}
					if (typeof next.text === 'string') {
						next.text = text(next.text);
					}
					return next;
				}),
			});
		}
		return copy;
	}

	/**
	 * Переименование алиаса таблицы части вместе с `УПОРЯДОЧИТЬ ПО` запроса: порядок принадлежит
	 * запросу, а не части, поэтому renameAlias до него не дотягивается, и `Алиас.Поле` в порядке
	 * остался бы ссылкой на исчезнувший алиас. Поля источников в порядке бывают только у запроса из
	 * одной части: у объединения порядок — по колонкам результата. Голова пути, совпавшая с колонкой
	 * результата, может означать саму колонку — такой порядок не трогается. Возвращает новый запрос.
	 */
	function renameAliasInStatement(statement, partIndex, from, to) {
		if (!statement || typeof statement !== 'object' || statement.type === 'drop' || !present(from) || !present(to)) {
			return statement;
		}
		const parts = arr(statement.parts);
		if (!parts[partIndex]) {
			return statement;
		}
		const copy = Object.assign({}, statement);
		copy.parts = parts.slice();
		copy.parts[partIndex] = renameAlias(parts[partIndex], from, to);
		const want = String(from).toUpperCase();
		const columns = outputFields(statement)
			.filter((name) => name !== null)
			.map((name) => String(name).toUpperCase());
		if (parts.length === 1 && Array.isArray(statement.orderBy) && columns.indexOf(want) < 0) {
			copy.orderBy = statement.orderBy.map((item) =>
				item && typeof item.expr === 'string' ? Object.assign({}, item, { expr: renameAliasInText(item.expr, from, to) }) : item
			);
		}
		return copy;
	}

	const api = {
		FORMAT: FORMAT,
		PART_PLACEMENTS: Object.freeze(PART_ANCHORS.slice()),
		parse: parse,
		build: build,
		buildWithReport: buildWithReport,
		canonTokens: canonTokens,
		selfCheck: selfCheck,
		sameModel: sameModel,
		outputFields: outputFields,
		tempTables: tempTables,
		parametersOf: parametersOf,
		defaultFieldAlias: defaultFieldAlias,
		defaultTableAlias: defaultTableAlias,
		renameAlias: renameAlias,
		renameAliasInStatement: renameAliasInStatement,
		renameAliasInText: renameAliasInText,
	};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (root) {
		root.DcsQueryModel = api;
	}
})(typeof window === 'undefined' ? globalThis : window);
