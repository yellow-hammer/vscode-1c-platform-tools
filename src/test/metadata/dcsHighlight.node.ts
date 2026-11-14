/**
 * Токенайзер подсветки запросов и выражений СКД: чистые функции dcs-editor-highlight.js.
 *
 * Файл webview исполняется в песочнице node:vm — ему не нужны ни DOM, ни acquireVsCodeApi,
 * поэтому тесты гоняют ровно тот код, который работает в редакторе.
 * Запуск: npm run compile && node --test out/test/metadata/dcsHighlight.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { readEditorScript } from '../fixtures/helpers/dcsEditorScript';

interface HighlightToken {
	type: string;
	value: string;
}

interface ToggleResult {
	text: string;
	selStart: number;
	selEnd: number;
	replaceStart: number;
	replaceEnd: number;
}

interface HighlightApi {
	HIGHLIGHT_LIMIT: number;
	FUNCTION_NAMES: readonly string[];
	tokenize(text: string): HighlightToken[];
	delimiterWarning(text: string): string;
	toggleLineComments(text: string, selStart: number, selEnd: number): ToggleResult;
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const FILE = path.resolve(__dirname, '../../../resources/webview/dcs-editor-highlight.js');

/**
 * Исполняет файл webview в текущем realm и возвращает его module.exports.
 *
 * Обёртка-функция вместо нового контекста vm: объекты из чужого realm не проходят
 * deepStrictEqual (другой Object.prototype). Параметр window подменяет глобал webview,
 * чтобы модуль не записывал DcsHighlight в глобалы теста.
 */
function loadHighlight(): HighlightApi {
	const code = fs.readFileSync(FILE, 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: FILE }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	return moduleShim.exports as HighlightApi;
}

const api = loadHighlight();

function values(tokens: HighlightToken[], type: string): string[] {
	return tokens.filter((token) => token.type === type).map((token) => token.value);
}

describe('Токенайзер СКД: разбор текста', () => {
	test('токены покрывают текст целиком: конкатенация равна входу', () => {
		const query =
			'ВЫБРАТЬ\t// выборка\n\tТаблица.Поле КАК Поле, &Параметр, "строка ""внутри""", 42.5\n' +
			'ИЗ\n\tСправочник.Номенклатура КАК Таблица\nГДЕ\n\tСУММА(Таблица.Сумма) > 0';
		assert.equal(
			api
				.tokenize(query)
				.map((token) => token.value)
				.join(''),
			query
		);
	});

	test('ключевые слова обеих раскладок без учёта регистра', () => {
		for (const word of ['ВЫБРАТЬ', 'выбрать', 'Select', 'ИЗ', 'from', 'ГДЕ', 'where', 'Объединить', 'UNION']) {
			assert.deepEqual(api.tokenize(word), [{ type: 'keyword', value: word }], word);
		}
	});

	test('функция подсвечивается только со скобкой вызова', () => {
		assert.deepEqual(api.tokenize('СУММА(Поле)')[0], { type: 'func', value: 'СУММА' });
		// «Количество» без скобки — обычное имя поля, а не функция
		assert.deepEqual(api.tokenize('Количество'), [{ type: 'text', value: 'Количество' }]);
	});

	test('LEFT перед JOIN — ключевое слово, LEFT со скобкой — функция', () => {
		assert.equal(api.tokenize('LEFT JOIN')[0].type, 'keyword');
		assert.equal(api.tokenize('LEFT("а", 1)')[0].type, 'func');
	});

	test('компонента пути после точки не подсвечивается', () => {
		// «Продажи.Количество» — путь к данным: ни ключевых слов, ни функций
		assert.deepEqual(api.tokenize('Продажи.Количество'), [{ type: 'text', value: 'Продажи.Количество' }]);
		const sly = api.tokenize('Т.ГОД(1)');
		assert.ok(
			sly.every((token) => token.type !== 'func' && token.type !== 'keyword'),
			JSON.stringify(sly)
		);
	});

	test('строка с удвоенной кавычкой — один токен, ключевые слова внутри не подсвечиваются', () => {
		const text = '"ВЫБРАТЬ ""вложено"" ИЗ"';
		assert.deepEqual(api.tokenize(text), [{ type: 'string', value: text }]);
	});

	test('незакрытая строка заканчивается на границе строки текста', () => {
		const tokens = api.tokenize('"обрыв\nВЫБРАТЬ');
		assert.deepEqual(tokens[0], { type: 'string', value: '"обрыв' });
		assert.deepEqual(tokens[2], { type: 'keyword', value: 'ВЫБРАТЬ' });
	});

	test('комментарий идёт до конца строки, дальше разбор продолжается', () => {
		const tokens = api.tokenize('// ВЫБРАТЬ не ключевое\nВЫБРАТЬ');
		assert.deepEqual(tokens[0], { type: 'comment', value: '// ВЫБРАТЬ не ключевое' });
		assert.deepEqual(tokens[2], { type: 'keyword', value: 'ВЫБРАТЬ' });
	});

	test('числа, параметры и операторы различаются', () => {
		const tokens = api.tokenize('&Период1 + 42.5 * (2)');
		assert.deepEqual(values(tokens, 'param'), ['&Период1']);
		assert.deepEqual(values(tokens, 'number'), ['42.5', '2']);
		assert.deepEqual(values(tokens, 'operator'), ['+', '*', '(', ')']);
	});

	test('цифры в имени поля числом не считаются, одиночный амперсанд — оператор', () => {
		assert.deepEqual(api.tokenize('Поле1'), [{ type: 'text', value: 'Поле1' }]);
		assert.deepEqual(api.tokenize('&')[0], { type: 'operator', value: '&' });
	});

	test('функции встроенного языка из выражений СКД подсвечиваются со скобкой', () => {
		for (const name of [
			'Формат', 'ЗначениеЗаполнено', 'НСтр', 'СоединитьСтроки', 'Строка', 'ТекущаяДатаСеанса', 'ТекущаяДата',
			'Массив', 'Уровень', 'ПредставлениеПериода', 'СтрШаблон', 'УниверсальноеВремя', 'Дата',
		]) {
			assert.deepEqual(api.tokenize(name + '(Поле)')[0], { type: 'func', value: name }, name);
		}
		// Без скобки это имена полей: «Уровень» и «Массив» бывают реквизитами
		assert.deepEqual(api.tokenize('Уровень'), [{ type: 'text', value: 'Уровень' }]);
	});

	test('СТРОКА и ДАТА после КАК — тип приведения, ВЫРАЗИТЬ остаётся ключевым словом', () => {
		const cast = api.tokenize('ВЫРАЗИТЬ(Т.Поле КАК СТРОКА(100))');
		assert.deepEqual(cast[0], { type: 'keyword', value: 'ВЫРАЗИТЬ' });
		assert.deepEqual(values(cast, 'keyword'), ['ВЫРАЗИТЬ', 'КАК', 'СТРОКА']);
		assert.deepEqual(values(cast, 'func'), []);
		assert.deepEqual(values(api.tokenize('CAST(F AS STRING(10))'), 'keyword'), ['CAST', 'AS', 'STRING']);
		// Вне приведения та же лексема со скобкой — вызов функции
		assert.deepEqual(values(api.tokenize('Строка(Поле) + Дата(2020, 1, 1)'), 'func'), ['Строка', 'Дата']);
		// Слово после КАК без скобки — ключевое слово или имя
		assert.deepEqual(values(api.tokenize('Т.Поле КАК Дата'), 'keyword'), ['КАК', 'Дата']);
	});

	test('ключевые слова временных таблиц и характеристик', () => {
		for (const word of ['ДОБАВИТЬ', 'УНИКАЛЬНО', 'ХАРАКТЕРИСТИКИ', 'Характеристики', 'CHARACTERISTICS']) {
			assert.deepEqual(api.tokenize(word), [{ type: 'keyword', value: word }], word);
		}
		// Функция с тем же началом не путается с ключевым словом
		assert.deepEqual(api.tokenize('ДобавитьКДате(')[0], { type: 'func', value: 'ДобавитьКДате' });
		const index = api.tokenize('ИНДЕКСИРОВАТЬ ПО Поле УНИКАЛЬНО');
		assert.deepEqual(values(index, 'keyword'), ['ИНДЕКСИРОВАТЬ', 'ПО', 'УНИКАЛЬНО']);
	});

	test('словарь функций отдаётся наружу копией в верхнем регистре', () => {
		assert.ok(Array.isArray(api.FUNCTION_NAMES));
		assert.ok(api.FUNCTION_NAMES.includes('СУММА') && api.FUNCTION_NAMES.includes('ФОРМАТ'));
		assert.ok(api.FUNCTION_NAMES.every((name) => name === name.toUpperCase()));
		assert.ok(Object.isFrozen(api.FUNCTION_NAMES));
	});

	test('пустой и нестроковый вход дают пустой список', () => {
		assert.deepEqual(api.tokenize(''), []);
		assert.deepEqual(api.tokenize(undefined as unknown as string), []);
	});
});

describe('Токенайзер СКД: парность скобок и кавычек', () => {
	test('парный текст предупреждения не даёт', () => {
		assert.equal(api.delimiterWarning('ВЫБРАТЬ СУММА(Т.Сумма) ИЗ Т ГДЕ Поле = "скобки ()( в строке"'), '');
	});

	test('нехватка закрывающих скобок называется числом', () => {
		assert.match(api.delimiterWarning('СУММА((Поле)'), /не хватает закрывающих скобок: 1/);
	});

	test('лишняя закрывающая скобка тоже называется', () => {
		assert.match(api.delimiterWarning('(Поле))'), /лишних закрывающих скобок: 1/);
	});

	test('незакрытая кавычка', () => {
		assert.match(api.delimiterWarning('ГДЕ Поле = "строка'), /не закрыта кавычка/);
	});

	test('скобки в строках и комментариях не считаются', () => {
		assert.equal(api.delimiterWarning('Поле = "(" // )'), '');
	});
});

/**
 * Выделение размечено прямо в тексте: «[…]» — непустое выделение, «|» — свёрнутая каретка.
 * Так ожидание читается глазами, а не сверяется по числам смещений.
 */
function parseMarked(marked: string): { text: string; start: number; end: number } {
	const caret = marked.indexOf('|');
	if (caret >= 0) {
		return { text: marked.slice(0, caret) + marked.slice(caret + 1), start: caret, end: caret };
	}
	const open = marked.indexOf('[');
	const close = marked.indexOf(']');
	assert.ok(open >= 0 && close > open, 'в разметке нет выделения: ' + JSON.stringify(marked));
	return {
		text: marked.slice(0, open) + marked.slice(open + 1, close) + marked.slice(close + 1),
		start: open,
		end: close - 1,
	};
}

function markSelection(text: string, start: number, end: number): string {
	if (start === end) {
		return text.slice(0, start) + '|' + text.slice(start);
	}
	return text.slice(0, start) + '[' + text.slice(start, end) + ']' + text.slice(end);
}

/**
 * Вызов с проверкой контракта отрезка замены: поле вставляет правку через execCommand по
 * replaceStart/replaceEnd, и вставка обязана дать ровно новый текст.
 */
function toggle(text: string, start: number, end: number): ToggleResult {
	const result = api.toggleLineComments(text, start, end);
	const tail = text.length - result.replaceEnd;
	assert.ok(result.replaceStart <= result.replaceEnd, JSON.stringify(result));
	assert.equal(result.text.slice(0, result.replaceStart), text.slice(0, result.replaceStart));
	assert.equal(result.text.slice(result.text.length - tail), text.slice(result.replaceEnd));
	assert.ok(result.selStart <= result.selEnd && result.selEnd <= result.text.length, JSON.stringify(result));
	return result;
}

function toggleMarked(marked: string): string {
	const { text, start, end } = parseMarked(marked);
	const result = toggle(text, start, end);
	return markSelection(result.text, result.selStart, result.selEnd);
}

describe('Комментарии строк (Ctrl+/): toggleLineComments', () => {
	test('одна строка: // встаёт перед первым непробельным символом, второе нажатие его снимает', () => {
		assert.equal(toggleMarked('\tВЫБ|РАТЬ'), '\t//ВЫБ|РАТЬ');
		assert.equal(toggleMarked('\t//ВЫБ|РАТЬ'), '\tВЫБ|РАТЬ');
		// Каретка в начале строки без отступа остаётся перед тем же символом — за префиксом
		assert.equal(toggleMarked('|ВЫБРАТЬ'), '//|ВЫБРАТЬ');
		assert.equal(toggleMarked('//|ВЫБРАТЬ'), '|ВЫБРАТЬ');
		// Каретка внутри отступа левее вставки и не сдвигается
		assert.equal(toggleMarked('\t|\tПоле'), '\t|\t//Поле');
	});

	test('несколько строк: у каждой свой отступ, двойное переключение возвращает текст и выделение', () => {
		const marked = '[ВЫБРАТЬ\n\tТ.Поле КАК Поле,\n    Т.Сумма\nИЗ Т]';
		const commented = '[//ВЫБРАТЬ\n\t//Т.Поле КАК Поле,\n    //Т.Сумма\n//ИЗ Т]';
		assert.equal(toggleMarked(marked), commented);
		assert.equal(toggleMarked(commented), marked);
	});

	test('частично закомментированный блок получает второй слой, целиком закомментированный раскомментируется', () => {
		assert.equal(toggleMarked('[//ВЫБРАТЬ\n\tТ.Поле]'), '[////ВЫБРАТЬ\n\t//Т.Поле]');
		assert.equal(toggleMarked('[////ВЫБРАТЬ\n\t//Т.Поле]'), '[//ВЫБРАТЬ\n\tТ.Поле]');
		assert.equal(toggleMarked('[//ВЫБРАТЬ\n\t//Т.Поле]'), '[ВЫБРАТЬ\n\tТ.Поле]');
	});

	test('пустые и пробельные строки не трогаются и не мешают снятию', () => {
		assert.equal(toggleMarked('[А\n\n  \nБ]'), '[//А\n\n  \n//Б]');
		assert.equal(toggleMarked('[//А\n\n   \n\t//Б]'), '[А\n\n   \n\tБ]');
	});

	test('каретка на пустой строке: префикс встаёт после отступа, чтобы сразу набирать комментарий', () => {
		assert.equal(toggleMarked('А\n|\nБ'), 'А\n//|\nБ');
		assert.equal(toggleMarked('А\n//|\nБ'), 'А\n|\nБ');
		assert.equal(toggleMarked('\t|'), '\t//|');
		assert.equal(toggleMarked('|'), '//|');
		// Ведущий перевод строки: строка каретки в позиции 0 — пустая первая, не вторая
		assert.equal(toggleMarked('|\nА'), '//|\nА');
	});

	test('CRLF: конец строки сохраняется, \\r не считается содержимым строки', () => {
		const marked = '[ВЫБРАТЬ\r\n\tПоле\r\n\r\nИЗ Т\r\n]';
		const commented = '[//ВЫБРАТЬ\r\n\t//Поле\r\n\r\n//ИЗ Т\r\n]';
		assert.equal(toggleMarked(marked), commented);
		assert.equal(toggleMarked(commented), marked);
		// Пустая строка CRLF — пустая: в решении «снять или поставить» не участвует
		assert.equal(toggleMarked('[//А\r\n\r\n//Б]'), '[А\r\n\r\nБ]');
		assert.equal(toggleMarked('\t//|\r\nБ'), '\t|\r\nБ');
	});

	test('выделение не целыми строками: берутся строки от начала до конца выделения', () => {
		assert.equal(toggleMarked('ВЫ[БРАТЬ\n\tТ.По]ле\nИЗ Т'), '//ВЫ[БРАТЬ\n\t//Т.По]ле\nИЗ Т');
		// Конец выделения в начале строки (выделение целых строк) эту строку не захватывает
		assert.equal(toggleMarked('[ВЫБРАТЬ\n\tПоле\n]ИЗ Т'), '[//ВЫБРАТЬ\n\t//Поле\n]ИЗ Т');
		assert.equal(toggleMarked('А[\n]Б'), '//А[\n]Б');
		// Начало выделения в точке вставки остаётся левее префикса, конец — правее
		assert.equal(toggleMarked('[ВЫБРАТЬ]'), '[//ВЫБРАТЬ]');
		assert.equal(toggleMarked('А[\n\t]Б'), '//А[\n\t//]Б');
	});

	test('смещение внутри снимаемого // прижимается к его началу', () => {
		assert.equal(toggleMarked('/|/А'), '|А');
		assert.equal(toggleMarked('/[/А\n/]/Б'), '[А\n]Б');
	});

	test('снимается ровно //: пробел ручного комментария остаётся, префикс в начале строки снимается байт в байт', () => {
		assert.equal(toggleMarked('[// Комментарий]'), '[ Комментарий]');
		// Префикс в начале строки и отступ кода за ним: снятие возвращает исходный отступ
		assert.equal(toggleMarked('[//ВЫБРАТЬ\n//\tТ.Поле]'), '[ВЫБРАТЬ\n\tТ.Поле]');
	});

	test('после переключения токенайзер видит в каждой непустой строке комментарий', () => {
		const query = 'ВЫБРАТЬ\r\n\tСУММА(Т.Сумма) КАК Сумма, // итог\r\n\r\n\t"строка // не комментарий"\r\nИЗ Т';
		const result = toggle(query, 0, query.length);
		for (const line of result.text.split(/\r?\n/)) {
			if (line.trim() === '') {
				continue;
			}
			const meaningful = api.tokenize(line).filter((token) => token.type !== 'text');
			assert.equal(meaningful.length, 1, line);
			assert.equal(meaningful[0].type, 'comment', line);
		}
	});

	test('двойное переключение возвращает текст и выделение при любом выделении', () => {
		const text = 'ВЫБРАТЬ\r\n\tТ.Поле,\n\n  Т.Сумма\nИЗ Т КАК Т';
		for (let start = 0; start <= text.length; start += 1) {
			for (let end = start; end <= text.length; end += 1) {
				const once = toggle(text, start, end);
				assert.notEqual(once.text, text, `${start}..${end}`);
				const twice = toggle(once.text, once.selStart, once.selEnd);
				assert.deepEqual(
					[twice.text, twice.selStart, twice.selEnd],
					[text, start, end],
					`${start}..${end}`
				);
			}
		}
	});

	test('отрезок замены охватывает только правки', () => {
		const text = 'А\n\tБ\nВ';
		const result = toggle(text, 0, text.length);
		assert.equal(result.text, '//А\n\t//Б\n//В');
		assert.deepEqual([result.replaceStart, result.replaceEnd], [0, 5]);
		const back = toggle(result.text, result.selStart, result.selEnd);
		// Снятие: отрезок кончается за последним снятым префиксом
		assert.deepEqual([back.replaceStart, back.replaceEnd], [0, 11]);
		// Правка в середине текста не задевает строк вокруг
		const middle = toggle(text, 3, 3);
		assert.deepEqual([middle.text, middle.replaceStart, middle.replaceEnd], ['А\n\t//Б\nВ', 3, 3]);
	});

	test('нечисловое, перевёрнутое и выходящее за текст выделение приводится к тексту', () => {
		assert.deepEqual(toggle('А\nБ', 3, 0), toggle('А\nБ', 0, 3));
		const wide = toggle('А', -5, 99);
		assert.deepEqual([wide.text, wide.selStart, wide.selEnd], ['//А', 0, 3]);
		const nan = toggle('А\nБ', Number.NaN, Number.NaN);
		assert.deepEqual([nan.text, nan.selStart, nan.selEnd], ['//А\nБ', 2, 2]);
		// Нестроковый текст — пустой: помощник toggle сверяет отрезок по длине строки, поэтому вызов прямой
		const empty = api.toggleLineComments(undefined as unknown as string, 0, 0);
		assert.deepEqual([empty.text, empty.selStart, empty.selEnd], ['//', 2, 2]);
	});

	test('текст у лимита подсветки переключается целиком и обратно без потерь', () => {
		const big = '\tВЫБРАТЬ Поле ИЗ Таблица\r\n\r\n'.repeat(3500);
		assert.ok(big.length > 90 * 1024, String(big.length));
		const once = toggle(big, 0, big.length);
		// Пустые строки между запросами не трогаются: префикс получает только каждая вторая строка
		assert.equal(once.text.length, big.length + 2 * 3500);
		const twice = toggle(once.text, once.selStart, once.selEnd);
		assert.equal(twice.text, big);
		assert.deepEqual([twice.selStart, twice.selEnd], [0, big.length]);
	});
});

describe('Токенайзер СКД: граница размера', () => {
	test('лимит подсветки — ~100 КБ: выше редактор остаётся простой textarea', () => {
		assert.equal(api.HIGHLIGHT_LIMIT, 100 * 1024);
	});

	test('текст на лимите переваривается без потерь', () => {
		const big = 'ВЫБРАТЬ Поле ИЗ Таблица // строка\n'.repeat(3000);
		assert.ok(big.length > 90 * 1024, String(big.length));
		assert.equal(
			api
				.tokenize(big)
				.map((token) => token.value)
				.join(''),
			big
		);
	});
});

describe('Комментарии строк (Ctrl+/): подключение к редактору запроса', () => {
	const script = readEditorScript();

	/** Тело функции dcs-editor.js по сигнатуре: до закрывающей скобки на уровне функций скрипта. */
	function functionSource(signature: string): string {
		const at = script.indexOf(signature);
		assert.ok(at >= 0, `в скрипте нет ${signature}`);
		const rest = script.slice(at);
		return rest.slice(0, rest.indexOf('\n\t}\n') + 3);
	}

	// Сочетание проверяется исполнением самой функции скрипта: она без внешних ссылок
	const isToggleKey = new Function(`${functionSource('function isCommentToggleKey(event)')}\nreturn isCommentToggleKey;`)() as (
		event: Record<string, unknown>
	) => boolean;

	test('сочетание: Ctrl+/ и Cmd+/, по символу и по физической клавише; Alt и Shift+клавиша «/» US — нет', () => {
		const cases: Array<[string, Record<string, unknown>, boolean]> = [
			['Ctrl+/', { key: '/', code: 'Slash', ctrlKey: true }, true],
			['Cmd+/ на mac', { key: '/', code: 'Slash', metaKey: true }, true],
			['русская раскладка: на клавише «/» — точка', { key: '.', code: 'Slash', ctrlKey: true }, true],
			['немецкая раскладка: «/» — Shift+7', { key: '/', code: 'Digit7', ctrlKey: true, shiftKey: true }, true],
			['Ctrl+Shift+/ в US — это «?»', { key: '?', code: 'Slash', ctrlKey: true, shiftKey: true }, false],
			['Ctrl+Alt+/', { key: '/', code: 'Slash', ctrlKey: true, altKey: true }, false],
			['просто /', { key: '/', code: 'Slash' }, false],
			['Ctrl+Пробел', { key: ' ', code: 'Space', ctrlKey: true }, false],
		];
		for (const [label, event, expected] of cases) {
			assert.equal(isToggleKey(event), expected, label);
		}
	});

	test('обработчик стоит только у текста запроса (класс dcs-query), не у выражений; правка — через историю поля', () => {
		const editor = functionSource('function codeEditor(value, className)');
		assert.ok(
			/if \(input\.classList\.contains\('dcs-query'\)\) \{\s*input\.addEventListener\('keydown'/.test(editor),
			'codeEditor не вешает Ctrl+/ на текст запроса'
		);
		const handler = functionSource('function onCommentToggleKey(input, event)');
		assert.ok(handler.includes('highlighter.toggleLineComments(input.value, input.selectionStart, input.selectionEnd)'), 'переключение не по выделению поля');
		assert.ok(handler.includes('input.readOnly'), 'текст набора внутри объединения (только чтение) правится');
		assert.ok(handler.includes('writeEditorText(input, result.replaceStart, result.replaceEnd, result.text, result.selStart, result.selEnd)'), 'правка не отрезком замены');
		const write = functionSource('function writeEditorText(input, start, end, nextText, selStart, selEnd)');
		assert.ok(write.includes("document.execCommand(inserted === '' ? 'delete' : 'insertText', false, inserted)"), 'правка мимо истории поля (Ctrl+Z)');
		assert.ok(write.includes("input.dispatchEvent(new Event('input', { bubbles: true }))"), 'без execCommand подсветка не узнает о правке');
		// Окно «Запрос…» конструктора — тот же редактор с классом dcs-query
		const dialog = fs.readFileSync(path.resolve(__dirname, '../../../resources/webview/dcs-editor-query-dialog.js'), 'utf8');
		assert.ok(dialog.includes("api.codeEditor(before, 'dcs-query dcs-qd-text')"), 'окно «Запрос…» без класса dcs-query');
	});
});
