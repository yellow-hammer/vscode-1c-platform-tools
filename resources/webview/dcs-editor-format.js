/**
 * Форматная строка редактора СКД («ЧДЦ=2; ЧН=0», «ДЛФ=D», «БЛ=; БИ=Да») — чистые функции без DOM.
 *
 * Как и dcs-editor-types.js, файл живёт двумя жизнями: webview подключает его отдельным <script> и
 * берёт функции из window.DcsFormat, а node-тесты исполняют его в песочнице и читают module.exports.
 *
 * Главное правило модуля — не испортить то, что пользователь не трогал. Форматная строка лежит в
 * значении параметра оформления «Формат» (условное оформление, оформление полей), и окно форматной
 * строки открывается на уже записанном значении. Поэтому разбор хранит точный текст каждого
 * параметра (raw), а сборка:
 * - возвращает исходник байт в байт, если по смыслу ничего не изменилось;
 * - пересобирает только изменённые параметры, сохраняя их имя как записано (в том числе английское
 *   и в чужом регистре), отступ, пробелы у «=» и кавычку исходника;
 * - неизвестные ключи и сегменты без «=» переносит дословно.
 *
 * Синтаксис: параметры через «;», имя и значение через «=»; значение с пробелами, «;», «=» или
 * кавычками заключается в одинарные или двойные кавычки, кавычка внутри удваивается. Пробелы вокруг
 * значения без кавычек незначащие. Имена ключей сравниваются без учёта регистра; при повторе ключа
 * действующим считается последний.
 *
 * Пример в окне (preview) — своё приближение функции Формат, а не повторение платформы: локаль без
 * ключа Л русская, названия месяцев и дней — свои таблицы. Подпись в окне говорит, что пример
 * приблизительный (PREVIEW_NOTE).
 */
(function (root) {
	'use strict';

	/** Неразрывный пробел: им русская локаль разделяет группы разрядов. */
	const NBSP = ' ';

	/**
	 * Известные ключи в порядке, в котором окно дописывает новые. Ключи конструктора форматной строки
	 * платформы (ЧЦ, ЧДЦ, ЧРД, ЧРГ, ЧН, ЧГ, ЧО) идут в его порядке.
	 *
	 * group — вкладка окна (common, number, date, boolean); kind подсказывает обвязке, каким
	 * элементом править значение: integer — целое (у ЧС может быть отрицательным), char — символ,
	 * text — строка, grouping — список размеров групп через запятую, choice — выбор из options,
	 * flag — сам ключ без значения или с любым значением, pattern — шаблон даты, locale — код
	 * языка и страны.
	 */
	const KEYS = Object.freeze([
		Object.freeze({ name: 'Л', en: 'L', group: 'common', kind: 'locale', label: 'Язык и страна' }),
		Object.freeze({ name: 'ЧЦ', en: 'ND', group: 'number', kind: 'integer', label: 'Всего цифр' }),
		Object.freeze({ name: 'ЧДЦ', en: 'NFD', group: 'number', kind: 'integer', label: 'Цифр после запятой' }),
		Object.freeze({ name: 'ЧС', en: 'NS', group: 'number', kind: 'integer', label: 'Сдвиг разрядов' }),
		Object.freeze({ name: 'ЧРД', en: 'NDS', group: 'number', kind: 'char', label: 'Знак дробной части' }),
		Object.freeze({ name: 'ЧРГ', en: 'NGS', group: 'number', kind: 'char', label: 'Знак между группами' }),
		Object.freeze({ name: 'ЧН', en: 'NZ', group: 'number', kind: 'text', label: 'Как выводить ноль' }),
		Object.freeze({ name: 'ЧГ', en: 'NG', group: 'number', kind: 'grouping', label: 'Группы разрядов' }),
		Object.freeze({ name: 'ЧО', en: 'NN', group: 'number', kind: 'choice', label: 'Отрицательные числа' }),
		Object.freeze({ name: 'ЧВН', en: 'NLZ', group: 'number', kind: 'flag', label: 'Дополнять нулями слева' }),
		Object.freeze({ name: 'ЧФ', en: 'NF', group: 'number', kind: 'text', label: 'Шаблон числа' }),
		Object.freeze({ name: 'ДФ', en: 'DF', group: 'date', kind: 'pattern', label: 'Шаблон даты' }),
		Object.freeze({ name: 'ДЛФ', en: 'DLF', group: 'date', kind: 'choice', label: 'Вид даты по локали' }),
		Object.freeze({ name: 'ДП', en: 'DE', group: 'date', kind: 'text', label: 'Как выводить пустую дату' }),
		Object.freeze({ name: 'БЛ', en: 'BF', group: 'boolean', kind: 'text', label: 'Как выводить Ложь' }),
		Object.freeze({ name: 'БИ', en: 'BT', group: 'boolean', kind: 'text', label: 'Как выводить Истина' }),
	]);

	/**
	 * Значения ДЛФ: платформа при русских ключах пишет латинские буквы (`ДЛФ=D`, `ДЛФ=DD`), в
	 * примерах справки — кириллица (`ДЛФ=Д`). Модуль понимает обе формы; value — то, что окно пишет
	 * для нового значения (как платформа).
	 */
	const DLF_OPTIONS = Object.freeze([
		Object.freeze({ value: 'D', ru: 'Д', label: 'Дата' }),
		Object.freeze({ value: 'DD', ru: 'ДД', label: 'Дата прописью' }),
		Object.freeze({ value: 'T', ru: 'В', label: 'Время' }),
		Object.freeze({ value: 'DT', ru: 'ДВ', label: 'Дата и время' }),
		Object.freeze({ value: 'DDT', ru: 'ДДВ', label: 'Дата прописью и время' }),
	]);

	/** Значения ЧО: подпись — как будет выглядеть минус единица с десятыми (своё приближение). */
	const NN_OPTIONS = Object.freeze([
		Object.freeze({ value: '0', label: '(1,1)' }),
		Object.freeze({ value: '1', label: '-1,1' }),
		Object.freeze({ value: '2', label: '- 1,1' }),
		Object.freeze({ value: '3', label: '1,1-' }),
		Object.freeze({ value: '4', label: '1,1 -' }),
	]);

	/** Подпись под примером в окне: пример считает модуль, а не платформа. */
	const PREVIEW_NOTE = 'Пример приблизительный: в платформе вывод может отличаться.';

	const KEY_BY_UPPER = (function () {
		const map = Object.create(null);
		for (const info of KEYS) {
			map[info.name.toUpperCase()] = { info: info, en: false };
			map[info.en.toUpperCase()] = { info: info, en: true };
		}
		return map;
	})();

	/** Известный ключ по имени в любом регистре и на любом языке; неизвестный — null. */
	function keyInfo(name) {
		const found = KEY_BY_UPPER[String(name == null ? '' : name).trim().toUpperCase()];
		return found ? found.info : null;
	}

	function isSpace(ch) {
		return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === NBSP;
	}

	/**
	 * Разбор одного сегмента между «;»: возвращает элемент и индекс конца сегмента в тексте (там
	 * стоит «;» или конец строки). Части сегмента (отступ, имя, «=» с пробелами, значение, хвост)
	 * запоминаются, чтобы изменённый параметр пересобрать, не трогая его оформления.
	 */
	function scanSegment(text, start) {
		let i = start;
		while (i < text.length && isSpace(text[i])) {
			i += 1;
		}
		const lead = text.slice(start, i);
		const keyStart = i;
		while (i < text.length && text[i] !== '=' && text[i] !== ';') {
			i += 1;
		}
		if (i >= text.length || text[i] === ';') {
			// Без «=»: не параметр (пустой сегмент после «;» или мусор) — переносится дословно
			return { end: i, item: { kind: 'other', key: '', name: null, en: false, value: '', quote: '', raw: text.slice(start, i) } };
		}
		const key = text.slice(keyStart, i).trim();
		const keyEnd = keyStart + text.slice(keyStart, i).replace(/\s+$/, '').length;
		i += 1;
		while (i < text.length && isSpace(text[i]) && text[i] !== ';') {
			i += 1;
		}
		const equals = text.slice(keyEnd, i);
		let value = '';
		let quote = '';
		let unterminated = false;
		let tail = '';
		let trail = '';
		if (text[i] === "'" || text[i] === '"') {
			quote = text[i];
			i += 1;
			let closed = false;
			while (i < text.length) {
				if (text[i] === quote) {
					if (text[i + 1] === quote) {
						value += quote;
						i += 2;
						continue;
					}
					i += 1;
					closed = true;
					break;
				}
				value += text[i];
				i += 1;
			}
			unterminated = !closed;
			const after = i;
			while (i < text.length && text[i] !== ';') {
				i += 1;
			}
			const rest = text.slice(after, i);
			trail = rest.slice(rest.replace(/\s+$/, '').length);
			tail = rest.slice(0, rest.length - trail.length);
		} else {
			const from = i;
			while (i < text.length && text[i] !== ';') {
				i += 1;
			}
			const rawValue = text.slice(from, i);
			value = rawValue.replace(/\s+$/, '');
			trail = rawValue.slice(value.length);
		}
		const found = KEY_BY_UPPER[key.toUpperCase()];
		const item = {
			kind: 'param',
			key: key,
			name: found ? found.info.name : null,
			en: found ? found.en : false,
			value: value,
			quote: quote,
			raw: text.slice(start, i),
			lead: lead,
			equals: equals,
			trail: trail,
		};
		if (unterminated) {
			item.unterminated = true;
		}
		if (tail) {
			item.tail = tail;
		}
		return { end: i, item: item };
	}

	/**
	 * Разбор форматной строки.
	 *
	 * items — все сегменты между «;» в исходном порядке: параметры (kind 'param': key как записан,
	 * name — каноническое русское имя известного ключа или null, en — имя английское, value —
	 * значение без кавычек и удвоений, quote — кавычка исходника) и прочее (kind 'other': пустой
	 * сегмент, текст без «=»). Склейка raw через «;» всегда равна исходнику. unterminated — нет
	 * закрывающей кавычки, tail — текст после закрывающей кавычки до «;»: оба переносятся дословно,
	 * пока параметр не изменили (незакрытую кавычку сборка закрывает и тогда, когда после неё
	 * дописали параметр — иначе она проглотила бы его).
	 *
	 * unknown — неизвестные параметры и непустые сегменты без «=». lang — язык имён известных
	 * ключей ('ru', 'en'; поровну — 'ru'; известных нет — null): на нём окно пишет новые ключи. quote
	 * — кавычка для значений, которым она понадобится (первая встреченная, по умолчанию одинарная,
	 * как пишет платформа); gap — отступ после «;» для новых параметров (из исходника, по умолчанию
	 * пробел, как в «ЧДЦ=2; ЧН=0»).
	 */
	function parseFormat(text) {
		const source = text == null ? '' : String(text);
		const items = [];
		if (source.length) {
			let start = 0;
			for (;;) {
				const scanned = scanSegment(source, start);
				items.push(scanned.item);
				if (scanned.end >= source.length) {
					break;
				}
				start = scanned.end + 1;
				if (start === source.length) {
					// «;» в самом конце — пустой хвостовой сегмент, иначе склейка потеряет разделитель
					items.push({ kind: 'other', key: '', name: null, en: false, value: '', quote: '', raw: '' });
					break;
				}
			}
		}
		return finish(source, items);
	}

	/** Сводные поля структуры по её элементам (общие для разбора и правок). */
	function finish(source, items, base) {
		let ru = 0;
		let en = 0;
		let quote = '';
		let gap = null;
		const unknown = [];
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			// Элемент без kind (собран обвязкой руками) — параметр, как и в сборке
			if (item.kind !== 'other') {
				if (item.name) {
					if (item.en) {
						en += 1;
					} else {
						ru += 1;
					}
				} else {
					unknown.push(item);
				}
				if (!quote && item.quote) {
					quote = item.quote;
				}
				if (gap === null && i > 0 && typeof item.raw === 'string') {
					gap = item.lead || '';
				}
			} else if (String(item.raw || '').trim()) {
				unknown.push(item);
			}
		}
		const struct = {
			text: source,
			items: items,
			unknown: unknown,
			lang: ru || en ? (en > ru ? 'en' : 'ru') : null,
			quote: quote || "'",
			gap: gap === null ? ' ' : gap,
		};
		if (base) {
			// Правка не меняет того, как пишутся новые параметры: это свойство исходника
			struct.lang = base.lang || struct.lang;
			struct.quote = base.quote || struct.quote;
			struct.gap = typeof base.gap === 'string' ? base.gap : struct.gap;
		}
		return struct;
	}

	/** Структура из структуры или из текста: обвязке не нужно помнить, разобрана ли строка. */
	function asStruct(struct) {
		if (struct && typeof struct === 'object') {
			return Array.isArray(struct.items) ? struct : parseFormat('');
		}
		return parseFormat(struct);
	}

	function itemsOf(struct) {
		return asStruct(struct).items;
	}

	/** Индекс последнего параметра с этим ключом: при повторе действует последний. */
	function lastIndexOf(items, name) {
		const info = keyInfo(name);
		const upper = String(name == null ? '' : name).trim().toUpperCase();
		for (let i = items.length - 1; i >= 0; i -= 1) {
			const item = items[i];
			if (item.kind === 'other') {
				continue;
			}
			const own = item.name ? item.name : keyInfo(item.key) ? keyInfo(item.key).name : null;
			if (info ? own === info.name : String(item.key || '').trim().toUpperCase() === upper) {
				return i;
			}
		}
		return -1;
	}

	/** Значение ключа (каноническое имя, английское или неизвестное как записано); нет ключа — undefined. */
	function getValue(struct, name) {
		const items = itemsOf(struct);
		const index = lastIndexOf(items, name);
		return index < 0 ? undefined : String(items[index].value == null ? '' : items[index].value);
	}

	function hasKey(struct, name) {
		return lastIndexOf(itemsOf(struct), name) >= 0;
	}

	/**
	 * Новая структура со значением ключа. Имеющийся параметр меняет только значение (имя, кавычка и
	 * отступы остаются для сборки); новый ставится после последнего параметра — перед хвостовыми
	 * пустыми сегментами, а среди других новых — в порядке KEYS — и пишется на языке имён строки
	 * (lang; в строке без известных ключей — по-русски), каким бы именем его ни назвали.
	 * value null/undefined — удалить ключ. Исходная структура не меняется.
	 */
	function setValue(struct, name, value) {
		const target = asStruct(struct);
		if (value === null || value === undefined) {
			return removeKey(target, name);
		}
		const text = String(value);
		const items = target.items.slice();
		const index = lastIndexOf(items, name);
		if (index >= 0) {
			items[index] = Object.assign({}, items[index], { value: text });
			return finish(target.text, items, target);
		}
		const info = keyInfo(name);
		const lang = target.lang;
		const added = {
			kind: 'param',
			key: info ? (lang === 'en' ? info.en : info.name) : String(name).trim(),
			name: info ? info.name : null,
			en: Boolean(info && lang === 'en'),
			value: text,
			quote: '',
		};
		// Без параметров пробельные сегменты не нужны: иначе новый ключ встал бы после «   ;»
		const hasParams = items.some((item) => item.kind !== 'other');
		const kept = hasParams ? items : items.filter((item) => String(item.raw || '').trim());
		let at = 0;
		for (let i = 0; i < kept.length; i += 1) {
			if (kept[i].kind !== 'other' || String(kept[i].raw || '').trim()) {
				at = i + 1;
			}
		}
		// Среди подряд идущих новых (без raw) держим порядок KEYS: так новая строка пишется как у платформы
		const order = (item) => {
			const known = item.name ? KEYS.findIndex((entry) => entry.name === item.name) : -1;
			return known < 0 ? KEYS.length : known;
		};
		while (at > 0 && typeof kept[at - 1].raw !== 'string' && order(kept[at - 1]) > order(added)) {
			at -= 1;
		}
		kept.splice(at, 0, added);
		return finish(target.text, kept, target);
	}

	/** Новая структура без ключа (все повторы). */
	function removeKey(struct, name) {
		const target = asStruct(struct);
		const items = target.items.slice();
		for (let index = lastIndexOf(items, name); index >= 0; index = lastIndexOf(items, name)) {
			items.splice(index, 1);
		}
		return finish(target.text, items, target);
	}

	/** Нужны ли значению кавычки: пробелы, разделители и кавычки без них не переживут разбора. */
	function needsQuote(value) {
		return /[\s;='"]/.test(value);
	}

	function quoted(value, quote) {
		return quote + value.split(quote).join(quote + quote) + quote;
	}

	/**
	 * Текст параметра: изменённый пересобирается из частей исходного (отступ, имя как записано, «=»
	 * с пробелами, кавычка, пробелы после значения), новый — по правилам структуры.
	 */
	function renderParam(item, struct) {
		const value = String(item.value == null ? '' : item.value);
		const info = item.name ? keyInfo(item.name) : keyInfo(item.key);
		const key = item.key ? String(item.key) : info ? (struct.lang === 'en' ? info.en : info.name) : '';
		let quote = item.quote || '';
		if (!quote && needsQuote(value)) {
			quote = struct.quote || "'";
		}
		const body = quote ? quoted(value, quote) : value;
		return (item.lead || '') + key + (typeof item.equals === 'string' ? item.equals : '=') + body + (item.trail || '');
	}

	/** Совпадает ли элемент по смыслу со своим raw (тогда raw и пишется — байт в байт). */
	function untouched(item) {
		if (typeof item.raw !== 'string') {
			return false;
		}
		if (item.kind === 'other') {
			return true;
		}
		const again = scanSegment(item.raw, 0).item;
		return (
			again.kind === 'param' &&
			again.raw === item.raw &&
			again.key === item.key &&
			again.value === String(item.value == null ? '' : item.value) &&
			again.quote === (item.quote || '')
		);
	}

	function sameMeaning(a, b) {
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0; i < a.length; i += 1) {
			const x = a[i];
			const y = b[i];
			if ((x.kind || 'param') !== y.kind || String(x.key || '') !== y.key) {
				return false;
			}
			if (y.kind === 'other' ? x.raw !== y.raw : String(x.value == null ? '' : x.value) !== y.value || (x.quote || '') !== y.quote) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Текст форматной строки по структуре. original — строка, на которой открывали окно (по
	 * умолчанию struct.text): если по смыслу ничего не изменилось, она и возвращается — байт в байт.
	 * Иначе неизменённые параметры пишутся своим raw, изменённые и новые пересобираются; первый
	 * сегмент получает отступ первого сегмента исходника (после удаления первого ключа строка не
	 * начинается с пробела), новые после «;» — отступ gap.
	 */
	function buildFormat(struct, original) {
		const target = asStruct(struct);
		const items = target.items;
		const base = original === undefined || original === null ? String(target.text || '') : String(original);
		const before = parseFormat(base);
		if (sameMeaning(items, before.items)) {
			return base;
		}
		const rules = {
			lang: target.lang || before.lang,
			quote: target.quote || before.quote,
			gap: typeof target.gap === 'string' ? target.gap : before.gap,
		};
		const firstLead = before.items.length && before.items[0].kind === 'param' ? before.items[0].lead || '' : '';
		const parts = [];
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			let text;
			// Незакрытая кавычка не в конце проглотила бы всё, что идёт за ней: такой параметр закрываем
			const swallows = item.unterminated && i < items.length - 1;
			if (untouched(item) && !swallows) {
				text = item.raw;
			} else if (item.kind === 'other') {
				text = String(item.raw || '');
			} else {
				const lead = typeof item.raw === 'string' ? item.lead || '' : i === 0 ? '' : rules.gap;
				text = renderParam(Object.assign({}, item, { lead: lead }), rules);
			}
			if (i === 0 && item.kind !== 'other') {
				text = firstLead + text.replace(/^[\s ]+/, '');
			}
			parts.push(text);
		}
		return parts.join(';');
	}

	// --- Пример (своё приближение функции Формат) ---

	const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
	const MONTHS_RU_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
	const MONTHS_RU_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
	const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const DAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
	const DAYS_RU_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
	const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	/**
	 * Буквы шаблона ДФ: кириллица и латиница. Регистр различает месяц и минуты (М/м, M/m) и 24- и
	 * 12-часовое время (Ч/ч, H/h).
	 */
	const PATTERN_FIELDS = {
		д: 'day', d: 'day',
		М: 'month', M: 'month',
		г: 'year', y: 'year',
		к: 'quarter', q: 'quarter',
		Ч: 'hour24', H: 'hour24',
		ч: 'hour12', h: 'hour12',
		м: 'minute', m: 'minute',
		с: 'second', s: 'second',
		в: 'ampm', t: 'ampm',
	};

	/** Шаблоны ДЛФ по локали (в синтаксисе PATTERN_FIELDS, текст в кавычках выводится как есть). */
	const LOCAL_PATTERNS = {
		ru: { D: 'dd.MM.yyyy', DD: "d MMMM yyyy 'г.'", T: 'H:mm:ss' },
		en: { D: 'M/d/yyyy', DD: 'MMMM d, yyyy', T: 'h:mm:ss tt' },
	};

	/** Локаль примера: по Л (ru_RU, en_US…), без ключа — русская. */
	function localeOf(struct) {
		const code = String(getValue(struct, 'Л') || 'ru').toLowerCase();
		return code.slice(0, 2) === 'en' ? 'en' : 'ru';
	}

	function pad(value, width) {
		let text = String(value);
		while (text.length < width) {
			text = '0' + text;
		}
		return text;
	}

	/** Части даты без часового пояса: Date (по местному времени) или текст xs:dateTime. */
	function dateParts(sample) {
		if (sample instanceof Date && !isNaN(sample.getTime())) {
			return {
				year: sample.getFullYear(),
				month: sample.getMonth() + 1,
				day: sample.getDate(),
				hour: sample.getHours(),
				minute: sample.getMinutes(),
				second: sample.getSeconds(),
			};
		}
		const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(String(sample));
		if (!match) {
			return null;
		}
		return {
			year: Number(match[1]),
			month: Number(match[2]),
			day: Number(match[3]),
			hour: Number(match[4] || 0),
			minute: Number(match[5] || 0),
			second: Number(match[6] || 0),
		};
	}

	function weekday(parts) {
		const date = new Date(0);
		date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
		return date.getUTCDay();
	}

	/**
	 * Шаблон даты: серии одной буквы — поле даты, текст в кавычках (одинарных или двойных) — как
	 * есть, удвоенная кавычка внутри — сама кавычка. Месяц прописью при числе в шаблоне —
	 * в родительном падеже («1 декабря»), без числа — в именительном с заглавной (своё правило).
	 */
	function formatPattern(pattern, parts, locale) {
		const en = locale === 'en';
		const hasDay = /[дd]/.test(pattern.replace(/'[^']*'|"[^"]*"/g, ''));
		let out = '';
		for (let i = 0; i < pattern.length; ) {
			const ch = pattern[i];
			if (ch === "'" || ch === '"') {
				let j = i + 1;
				while (j < pattern.length) {
					if (pattern[j] === ch) {
						if (pattern[j + 1] === ch) {
							out += ch;
							j += 2;
							continue;
						}
						break;
					}
					out += pattern[j];
					j += 1;
				}
				i = j + 1;
				continue;
			}
			const field = PATTERN_FIELDS[ch];
			if (!field) {
				out += ch;
				i += 1;
				continue;
			}
			let count = 1;
			while (pattern[i + count] === ch) {
				count += 1;
			}
			i += count;
			const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
			switch (field) {
				case 'day':
					if (count >= 4) {
						out += en ? DAYS_EN[weekday(parts)] : DAYS_RU[weekday(parts)];
					} else if (count === 3) {
						out += en ? DAYS_EN[weekday(parts)].slice(0, 3) : DAYS_RU_SHORT[weekday(parts)];
					} else {
						out += count === 2 ? pad(parts.day, 2) : String(parts.day);
					}
					break;
				case 'month':
					if (count >= 4) {
						if (en) {
							out += MONTHS_EN[parts.month - 1];
						} else if (hasDay) {
							out += MONTHS_RU_OF[parts.month - 1];
						} else {
							const name = MONTHS_RU[parts.month - 1];
							out += name.charAt(0).toUpperCase() + name.slice(1);
						}
					} else if (count === 3) {
						out += en ? MONTHS_EN[parts.month - 1].slice(0, 3) : MONTHS_RU_SHORT[parts.month - 1];
					} else {
						out += count === 2 ? pad(parts.month, 2) : String(parts.month);
					}
					break;
				case 'year':
					out += count >= 3 ? pad(parts.year, 4) : count === 2 ? pad(parts.year % 100, 2) : String(parts.year % 100);
					break;
				case 'quarter':
					out += String(Math.floor((parts.month - 1) / 3) + 1);
					break;
				case 'hour24':
					out += count >= 2 ? pad(parts.hour, 2) : String(parts.hour);
					break;
				case 'hour12':
					out += count >= 2 ? pad(hour12, 2) : String(hour12);
					break;
				case 'minute':
					out += count >= 2 ? pad(parts.minute, 2) : String(parts.minute);
					break;
				case 'second':
					out += count >= 2 ? pad(parts.second, 2) : String(parts.second);
					break;
				default:
					out += parts.hour < 12 ? 'AM' : 'PM';
			}
		}
		return out;
	}

	/** Вид ДЛФ по значению в любой из двух записей (D/Д, DD/ДД, T/В, DT/ДВ, DDT/ДДВ). */
	function dlfKind(value) {
		const upper = String(value || '').trim().toUpperCase();
		for (const option of DLF_OPTIONS) {
			if (upper === option.value || upper === option.ru) {
				return option.value;
			}
		}
		return '';
	}

	function previewDate(struct, sample) {
		const parts = dateParts(sample);
		if (!parts) {
			return '';
		}
		const locale = localeOf(struct);
		// Пустая дата платформы — 01.01.0001 00:00:00: её выводит только ДП
		if (parts.year === 1 && parts.month === 1 && parts.day === 1 && !parts.hour && !parts.minute && !parts.second) {
			return getValue(struct, 'ДП') || '';
		}
		const df = getValue(struct, 'ДФ');
		if (df) {
			return formatPattern(df, parts, locale);
		}
		const local = LOCAL_PATTERNS[locale];
		const kind = dlfKind(getValue(struct, 'ДЛФ')) || 'DT';
		const date = kind === 'D' || kind === 'DT' ? local.D : kind === 'DD' || kind === 'DDT' ? local.DD : '';
		const time = kind === 'T' || kind === 'DT' || kind === 'DDT' ? local.T : '';
		return [date, time]
			.filter(Boolean)
			.map((pattern) => formatPattern(pattern, parts, locale))
			.join(' ');
	}

	/** Целое из значения ключа; пусто или не число — null. */
	function intOf(value) {
		if (value === undefined || value === null || !/^\s*[-+]?\d+\s*$/.test(String(value))) {
			return null;
		}
		return parseInt(String(value), 10);
	}

	/** Десятичная запись без экспоненты: форматировать дальше удобнее строкой, чем числом. */
	function plain(abs) {
		const text = String(abs);
		if (!/e/i.test(text)) {
			return text;
		}
		return abs.toFixed(20).replace(/\.?0+$/, '');
	}

	/** Округление до digits знаков: половина — от нуля (как Окр по умолчанию). */
	function roundTo(n, digits) {
		const factor = Math.pow(10, digits);
		const scaled = Math.abs(n) * factor;
		// Поправка на двоичное представление: 1.005 * 100 = 100.49999… должно округлиться вверх
		const rounded = Math.round(scaled + Math.max(1, scaled) * Number.EPSILON);
		return (n < 0 ? -rounded : rounded) / factor;
	}

	/**
	 * Группы разрядов ЧГ: размеры через запятую справа налево, последний 0 — повторять предыдущий;
	 * без нуля в конце остаток целой части идёт одним куском («3,0» — тройками, «0» — без групп).
	 */
	function groupDigits(digits, sizesText, separator) {
		const sizes = String(sizesText)
			.split(',')
			.map((part) => parseInt(part.trim(), 10))
			.filter((size) => !isNaN(size) && size >= 0);
		if (!sizes.length || sizes[0] === 0) {
			return digits;
		}
		const groups = [];
		let rest = digits;
		let index = 0;
		let size = sizes[0];
		while (size > 0 && rest.length > size) {
			groups.unshift(rest.slice(rest.length - size));
			rest = rest.slice(0, rest.length - size);
			if (index + 1 < sizes.length) {
				index += 1;
				// 0 — повторять текущий размер, иначе следующий размер из списка
				if (sizes[index] !== 0) {
					size = sizes[index];
				}
			} else if (sizes[index] !== 0) {
				// Список кончился не нулём: остаток — одним куском
				size = 0;
			}
		}
		groups.unshift(rest);
		return groups.join(separator);
	}

	function previewNumber(struct, sample) {
		let n = Number(sample);
		if (!isFinite(n)) {
			return '';
		}
		const locale = localeOf(struct);
		const shift = intOf(getValue(struct, 'ЧС'));
		if (shift) {
			n = shift > 0 ? n / Math.pow(10, shift) : n * Math.pow(10, -shift);
		}
		const length = intOf(getValue(struct, 'ЧЦ'));
		let decimals = intOf(getValue(struct, 'ЧДЦ'));
		if (decimals === null && length !== null) {
			// Длина без точности — целое, как у поля ввода
			decimals = 0;
		}
		if (decimals !== null) {
			decimals = Math.max(0, decimals);
			n = roundTo(n, decimals);
		}
		if (n === 0) {
			// Без ЧН ноль выводится пустой строкой; ЧН= без значения — сам ноль по остальным ключам
			const zero = getValue(struct, 'ЧН');
			if (zero === undefined) {
				return '';
			}
			if (zero !== '') {
				return zero;
			}
		}
		const negative = n < 0;
		const text = decimals !== null ? Math.abs(n).toFixed(decimals) : plain(Math.abs(n));
		const dot = text.indexOf('.');
		let integer = dot < 0 ? text : text.slice(0, dot);
		let fraction = dot < 0 ? '' : text.slice(dot + 1);
		if (length !== null) {
			const room = Math.max(0, length - (decimals || 0));
			if (integer.replace(/^0+/, '').length > room) {
				// Не помещается в длину — максимум из девяток
				integer = room ? '9'.repeat(room) : '0';
				fraction = '9'.repeat(decimals || 0);
			} else if (hasKey(struct, 'ЧВН') && room) {
				integer = pad(integer, room);
			}
		}
		const groupKey = getValue(struct, 'ЧРГ');
		const groupSep = groupKey === undefined ? (locale === 'en' ? ',' : NBSP) : groupKey === '' ? NBSP : groupKey;
		const decimalKey = getValue(struct, 'ЧРД');
		const decimalSep = decimalKey ? decimalKey : locale === 'en' ? '.' : ',';
		const grouping = getValue(struct, 'ЧГ');
		const body = groupDigits(integer, grouping === undefined ? '3,0' : grouping, groupSep) + (fraction ? decimalSep + fraction : '');
		if (!negative) {
			return body;
		}
		switch (String(getValue(struct, 'ЧО') || '1').trim()) {
			case '0':
				return '(' + body + ')';
			case '2':
				return '- ' + body;
			case '3':
				return body + '-';
			case '4':
				return body + ' -';
			default:
				return '-' + body;
		}
	}

	function previewBoolean(struct, sample) {
		const en = localeOf(struct) === 'en';
		const own = getValue(struct, sample ? 'БИ' : 'БЛ');
		if (own !== undefined) {
			return own;
		}
		return sample ? (en ? 'Yes' : 'Да') : en ? 'No' : 'Нет';
	}

	/**
	 * Пример: как форматная строка покажет значение sample — число, Булево, дату (Date или текст
	 * xs:dateTime «2015-12-01T00:00:00»). Своё приближение, не платформа: подпись окна —
	 * PREVIEW_NOTE. ЧФ не учитывается.
	 */
	function preview(struct, sample) {
		const target = asStruct(struct);
		if (typeof sample === 'boolean') {
			return previewBoolean(target, sample);
		}
		if (typeof sample === 'number') {
			return previewNumber(target, sample);
		}
		if (sample instanceof Date || typeof sample === 'string') {
			return previewDate(target, sample);
		}
		return '';
	}

	const api = {
		KEYS: KEYS,
		DLF_OPTIONS: DLF_OPTIONS,
		NN_OPTIONS: NN_OPTIONS,
		PREVIEW_NOTE: PREVIEW_NOTE,
		keyInfo: keyInfo,
		parseFormat: parseFormat,
		buildFormat: buildFormat,
		getValue: getValue,
		hasKey: hasKey,
		setValue: setValue,
		removeKey: removeKey,
		preview: preview,
	};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (root) {
		root.DcsFormat = api;
	}
})(typeof window === 'undefined' ? globalThis : window);
