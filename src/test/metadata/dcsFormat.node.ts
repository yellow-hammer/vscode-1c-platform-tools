/**
 * Форматная строка редактора СКД: чистые функции dcs-editor-format.js.
 *
 * Модуль исполняется в песочнице node:vm, как подсветка и типы: DOM ему не нужен, поэтому тесты
 * гоняют ровно тот код, которым окно форматной строки разбирает и пишет значение «Формат». Главная
 * проверка — корпус ssl31 (format-strings-ssl31.json, все форматные строки схем БСП 3.1): круг
 * parse → build на каждой строке байт в байт и правки, которые не задевают соседние параметры.
 * Запуск: npm run compile && node --test out/test/metadata/dcsFormat.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { readEditorScript } from '../fixtures/helpers/dcsEditorScript';

interface FormatItem {
	kind?: 'param' | 'other';
	key: string;
	name?: string | null;
	en?: boolean;
	value: string;
	quote?: string;
	raw?: string;
	lead?: string;
	unterminated?: boolean;
	tail?: string;
}

interface FormatStruct {
	text: string;
	items: FormatItem[];
	unknown: FormatItem[];
	lang: 'ru' | 'en' | null;
	quote: string;
	gap: string;
}

interface KeyInfo {
	name: string;
	en: string;
	group: string;
	kind: string;
	label: string;
}

type Struct = FormatStruct | string;

interface FormatApi {
	KEYS: readonly KeyInfo[];
	DLF_OPTIONS: ReadonlyArray<{ value: string; ru: string; label: string }>;
	NN_OPTIONS: ReadonlyArray<{ value: string; label: string }>;
	PREVIEW_NOTE: string;
	keyInfo(name: string): KeyInfo | null;
	parseFormat(text: string): FormatStruct;
	buildFormat(struct: Struct, original?: string): string;
	getValue(struct: Struct, name: string): string | undefined;
	hasKey(struct: Struct, name: string): boolean;
	setValue(struct: Struct, name: string, value: string | null): FormatStruct;
	removeKey(struct: Struct, name: string): FormatStruct;
	preview(struct: Struct, sample: unknown): string;
}

interface FormatFixture {
	commit: string | null;
	total: number;
	distinct: number;
	parameters: Array<{ file: string; where: string; parameter: string; type: string; lang?: string; text: string }>;
	calls: Array<{ file: string; where: string; expression: string; formats: Array<string | null> }>;
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const FILE = path.join(ROOT, 'resources', 'webview', 'dcs-editor-format.js');
const FIXTURE = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs', 'format-strings-ssl31.json');

/**
 * Исполняет файл webview в текущем realm и возвращает module.exports и подменённый window.
 *
 * Обёртка-функция вместо нового контекста vm: объекты из чужого realm не проходят
 * deepStrictEqual (другой Object.prototype).
 */
function load(): { api: FormatApi; window: Record<string, unknown> } {
	const code = fs.readFileSync(FILE, 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: FILE }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	const windowShim: Record<string, unknown> = {};
	factory(moduleShim, windowShim);
	return { api: moduleShim.exports as FormatApi, window: windowShim };
}

const { api, window: webview } = load();
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as FormatFixture;
const NBSP = ' ';

/** Все форматные строки корпуса: значения параметров и литералы вызовов Формат(). */
const corpus: string[] = [
	...fixture.parameters.map((entry) => entry.text),
	...fixture.calls.flatMap((entry) => entry.formats.filter((text): text is string => text !== null)),
];
const distinct = [...new Set(corpus)];

/** Параметры структуры парами [имя как записано, значение], прочие сегменты — их текстом. */
function meaning(struct: FormatStruct): Array<[string, string]> {
	return struct.items.map((item) => (item.kind === 'other' ? ['#other', item.raw ?? ''] : [item.key, item.value]));
}

describe('dcs-editor-format: корпус ssl31', () => {
	test('модуль доступен и webview (window.DcsFormat), и node (module.exports)', () => {
		assert.equal(webview.DcsFormat, api);
		assert.equal(typeof api.parseFormat, 'function');
	});

	test('фикстура собрана скриптом и согласована сама с собой', () => {
		assert.equal(fixture.total, corpus.length);
		assert.equal(fixture.distinct, distinct.length);
		assert.ok(corpus.length >= 100, `строк в корпусе ${corpus.length}`);
		assert.ok(fixture.calls.length > 0, 'вызовы Формат() в выражениях найдены');
		// Окно пишет в тип имеющегося значения: в УО ssl31 встречаются оба типа
		const conditional = fixture.parameters.filter((entry) => entry.where.includes('/conditionalAppearance/'));
		const types = new Set(conditional.map((entry) => entry.type));
		assert.deepEqual([...types].sort(), ['v8:LocalStringType', 'xs:string']);
	});

	test('круг parse → build байт в байт на каждой строке, склейка raw равна исходнику', () => {
		for (const text of corpus) {
			const struct = api.parseFormat(text);
			assert.equal(api.buildFormat(struct, text), text, text);
			assert.equal(api.buildFormat(struct), text, text);
			assert.equal(api.buildFormat(text), text, text);
			assert.equal(struct.items.map((item) => item.raw).join(';'), text, text);
		}
	});

	test('все ключи корпуса известны и записаны по-русски', () => {
		for (const text of distinct) {
			const struct = api.parseFormat(text);
			assert.deepEqual(struct.unknown, [], text);
			assert.equal(struct.lang, 'ru', text);
			for (const item of struct.items) {
				assert.equal(item.kind, 'param', text);
				assert.ok(item.name, `${text}: ${item.key}`);
			}
		}
	});

	test('сборка с нуля (без raw) пишет так же, как записано в корпусе', () => {
		for (const text of distinct) {
			const struct = api.parseFormat(text);
			const fresh: FormatStruct = {
				...struct,
				items: struct.items.map((item) => ({ kind: item.kind, key: item.key, name: item.name, value: item.value, quote: item.quote })),
			};
			assert.equal(api.buildFormat(fresh, ''), text, text);
		}
	});

	test('правка любого ключа на любой строке не задевает соседей и читается обратно', () => {
		const values = ['', '0', '3,0', 'a b', "x'y", 'p"q', 'a;b', 'k=v', ' lead', 'trail '];
		for (const text of distinct) {
			const original = api.parseFormat(text);
			for (const info of api.KEYS) {
				for (const value of values) {
					const edited = api.setValue(original, info.name, value);
					const out = api.buildFormat(edited, text);
					assert.deepEqual(meaning(api.parseFormat(out)), meaning(edited), `${text} | ${info.name}=${JSON.stringify(value)} → ${out}`);
					assert.equal(api.getValue(out, info.name), value, `${text} | ${info.name}`);
					// Нетронутые параметры остаются своим текстом
					for (const item of original.items) {
						if (item.name !== info.name) {
							assert.ok(out.includes((item.raw ?? '').trim()), `${text} | ${info.name}: потерян «${item.raw}»`);
						}
					}
				}
				const removed = api.buildFormat(api.removeKey(original, info.name), text);
				assert.equal(api.hasKey(removed, info.name), false, `${text} − ${info.name} → ${removed}`);
				assert.equal(removed.startsWith(' '), false, `${text} − ${info.name} → «${removed}»`);
				assert.deepEqual(
					meaning(api.parseFormat(removed)).map(([key]) => key),
					meaning(original)
						.map(([key]) => key)
						.filter((key) => api.keyInfo(key)?.name !== info.name),
					`${text} − ${info.name}`
				);
			}
		}
	});
});

describe('dcs-editor-format: разбор и сборка', () => {
	test('правка одного ключа меняет только его значение', () => {
		const struct = api.parseFormat('ЧДЦ=2; ЧН=0');
		assert.equal(api.buildFormat(api.setValue(struct, 'ЧДЦ', '3')), 'ЧДЦ=3; ЧН=0');
		// Исходная структура не мутируется: её сборка — исходник
		assert.equal(api.buildFormat(struct), 'ЧДЦ=2; ЧН=0');
		// То же значение — исходник байт в байт, даже если строку разбирали заново
		assert.equal(api.buildFormat(api.setValue(struct, 'ЧДЦ', '2')), 'ЧДЦ=2; ЧН=0');
	});

	test('кавычки и удвоение: значение без удвоений, запись — кавычкой исходника', () => {
		const text = "ДФ='дд.ММ.гггг''г.'''";
		const struct = api.parseFormat(text);
		assert.equal(api.getValue(struct, 'ДФ'), "дд.ММ.гггг'г.'");
		assert.equal(struct.items[0].quote, "'");
		assert.equal(api.buildFormat(api.setValue(struct, 'ДФ', "дд.ММ.гг'г.'")), "ДФ='дд.ММ.гг''г.'''");
		// Двойная кавычка исходника сохраняется, удваивается тоже она
		assert.equal(api.buildFormat(api.setValue('ЧН="—"', 'ЧН', 'a"b')), 'ЧН="a""b"');
		// Без кавычки в исходнике — кавычка появляется, только когда значение без неё не разобрать
		assert.equal(api.buildFormat(api.setValue('ЧН=0', 'ЧН', 'Не задано')), "ЧН='Не задано'");
		assert.equal(api.buildFormat(api.setValue('ЧН=0', 'ЧН', '—')), 'ЧН=—');
		// Лишние кавычки исходника не снимаются
		assert.equal(api.buildFormat(api.setValue("ЧЦ='15'; ЧДЦ='2'", 'ЧДЦ', '3')), "ЧЦ='15'; ЧДЦ='3'");
		// «;» внутри кавычек — не разделитель
		assert.equal(api.getValue("ДФ='dd;MM'; ЧН=0", 'ДФ'), 'dd;MM');
		assert.equal(api.getValue("ДФ='dd;MM'; ЧН=0", 'ЧН'), '0');
	});

	test('пустое значение: БЛ= читается пустой строкой и так же пишется', () => {
		const struct = api.parseFormat('БЛ=; БИ=Да');
		assert.equal(api.getValue(struct, 'БЛ'), '');
		assert.equal(api.hasKey(struct, 'БЛ'), true);
		assert.equal(api.buildFormat(api.setValue(struct, 'БИ', '✔')), 'БЛ=; БИ=✔');
		assert.equal(api.buildFormat(api.setValue(struct, 'БЛ', 'Нет')), 'БЛ=Нет; БИ=Да');
		assert.equal(api.buildFormat(api.setValue('БИ=Да', 'БЛ', '')), 'БИ=Да; БЛ=');
		// Пустое в кавычках остаётся в кавычках
		assert.equal(api.buildFormat(api.setValue("ЧГ=''; ЧН=0", 'ЧН', '-')), "ЧГ=''; ЧН=-");
	});

	test('неизвестный ключ и сегмент без «=» переносятся дословно', () => {
		const text = 'ЧДЦ=2; Х=1 ;мусор; ЧН=0';
		const struct = api.parseFormat(text);
		assert.deepEqual(
			struct.unknown.map((item) => item.raw),
			[' Х=1 ', 'мусор']
		);
		assert.equal(api.getValue(struct, 'Х'), '1');
		assert.equal(api.buildFormat(api.setValue(struct, 'ЧН', '-')), 'ЧДЦ=2; Х=1 ;мусор; ЧН=-');
		assert.equal(api.buildFormat(api.setValue(struct, 'Х', '2')), 'ЧДЦ=2; Х=2 ;мусор; ЧН=0');
	});

	test('английские имена: дословно, новые ключи — тоже по-английски', () => {
		const struct = api.parseFormat('ND=10;NFD=2');
		assert.equal(struct.lang, 'en');
		assert.equal(api.getValue(struct, 'ЧДЦ'), '2');
		assert.equal(api.getValue(struct, 'NFD'), '2');
		assert.equal(api.buildFormat(api.setValue(struct, 'ЧДЦ', '3')), 'ND=10;NFD=3');
		assert.equal(api.buildFormat(api.setValue(struct, 'ЧН', '0')), 'ND=10;NFD=2;NZ=0');
		assert.equal(api.keyInfo('dlf')?.name, 'ДЛФ');
		// Смешанная строка: язык новых ключей — по большинству
		assert.equal(api.parseFormat('ЧДЦ=2; ЧН=0; DF=dd').lang, 'ru');
	});

	test('имя ключа в чужом регистре узнаётся и пишется как было', () => {
		const struct = api.parseFormat('чдц=2');
		assert.equal(struct.items[0].name, 'ЧДЦ');
		assert.equal(api.buildFormat(api.setValue(struct, 'ЧДЦ', '1')), 'чдц=1');
	});

	test('удаление первого, среднего и последнего ключа', () => {
		const text = 'ЧЦ=10; ЧДЦ=2; ЧН=0';
		assert.equal(api.buildFormat(api.removeKey(text, 'ЧЦ')), 'ЧДЦ=2; ЧН=0');
		assert.equal(api.buildFormat(api.removeKey(text, 'ЧДЦ')), 'ЧЦ=10; ЧН=0');
		assert.equal(api.buildFormat(api.removeKey(text, 'ЧН')), 'ЧЦ=10; ЧДЦ=2');
		assert.equal(api.buildFormat(api.removeKey('ЧН=0', 'ЧН'), 'ЧН=0'), '');
		// Нет ключа — нечего удалять, исходник цел
		assert.equal(api.buildFormat(api.removeKey(text, 'ДФ')), text);
		// null в setValue — то же удаление
		assert.equal(api.buildFormat(api.setValue(text, 'ЧЦ', null)), 'ЧДЦ=2; ЧН=0');
	});

	test('новая строка: ключи в порядке KEYS через «; », как пишет платформа', () => {
		let struct = api.parseFormat('');
		assert.deepEqual(struct.items, []);
		struct = api.setValue(struct, 'БИ', 'Да');
		struct = api.setValue(struct, 'ЧН', 'Ноль');
		struct = api.setValue(struct, 'БЛ', '');
		struct = api.setValue(struct, 'ЧЦ', '15');
		struct = api.setValue(struct, 'ЧРГ', ' ');
		assert.equal(api.buildFormat(struct), "ЧЦ=15; ЧРГ=' '; ЧН=Ноль; БЛ=; БИ=Да");
		// Новые после имеющихся: исходный порядок не переставляется
		assert.equal(api.buildFormat(api.setValue('ЧН=0', 'ЧДЦ', '2')), 'ЧН=0; ЧДЦ=2');
		// Структура, собранная обвязкой руками (только key и value), пишется по тем же правилам
		const manual = { items: [{ key: 'ЧДЦ', value: '2' }, { key: 'ЧН', value: 'Не задано' }] } as unknown as FormatStruct;
		assert.equal(api.buildFormat(manual), "ЧДЦ=2; ЧН='Не задано'");
		assert.equal(api.getValue(manual, 'ЧН'), 'Не задано');
	});

	test('разделители и отступы исходника сохраняются', () => {
		assert.equal(api.buildFormat(api.setValue('ЧДЦ=2;ЧН=0', 'ЧДЦ', '3')), 'ЧДЦ=3;ЧН=0');
		assert.equal(api.buildFormat(api.setValue('ЧДЦ=2;ЧН=0', 'ЧГ', '0')), 'ЧДЦ=2;ЧН=0;ЧГ=0');
		assert.equal(api.buildFormat(api.setValue(' ЧДЦ = 2 ;  ЧН=0', 'ЧДЦ', '3')), ' ЧДЦ = 3 ;  ЧН=0');
		assert.equal(api.buildFormat(api.removeKey(' ЧДЦ = 2 ;  ЧН=0', 'ЧДЦ')), ' ЧН=0');
		// Хвостовая «;» остаётся в конце, новый ключ встаёт перед ней
		assert.equal(api.buildFormat(api.setValue('ЧДЦ=2;', 'ЧН', '0')), 'ЧДЦ=2; ЧН=0;');
		// Строка из пробелов: новому ключу пробелы не нужны
		assert.equal(api.buildFormat(api.setValue('  ', 'ЧН', '0')), 'ЧН=0');
	});

	test('повтор ключа: действует последний, правится последний, удаляются все', () => {
		const text = 'ЧДЦ=1; ЧН=0; ЧДЦ=2';
		assert.equal(api.getValue(text, 'ЧДЦ'), '2');
		assert.equal(api.buildFormat(api.setValue(text, 'ЧДЦ', '3')), 'ЧДЦ=1; ЧН=0; ЧДЦ=3');
		assert.equal(api.buildFormat(api.removeKey(text, 'ЧДЦ')), 'ЧН=0');
	});

	test('незакрытая кавычка и текст после кавычки: дословно, пока параметр не трогали', () => {
		const open = "ЧН=0; ДФ='дд.ММ";
		const struct = api.parseFormat(open);
		assert.equal(struct.items[1].unterminated, true);
		assert.equal(api.getValue(struct, 'ДФ'), 'дд.ММ');
		assert.equal(api.buildFormat(struct), open);
		assert.equal(api.buildFormat(api.setValue(struct, 'ЧН', '-')), "ЧН=-; ДФ='дд.ММ");
		// Дописанный после незакрытой кавычки ключ не проглатывается: кавычка закрывается
		const appended = api.buildFormat(api.setValue(struct, 'ДП', 'нет'));
		assert.equal(appended, "ЧН=0; ДФ='дд.ММ'; ДП=нет");
		assert.equal(api.getValue(appended, 'ДП'), 'нет');

		const tail = "ДФ='дд'ММ; ЧН=0";
		const withTail = api.parseFormat(tail);
		assert.equal(withTail.items[0].tail, 'ММ');
		assert.equal(api.buildFormat(api.setValue(withTail, 'ЧН', '-')), "ДФ='дд'ММ; ЧН=-");
	});

	test('описание ключей: у каждого русское и английское имя, вкладка и вид значения', () => {
		const names = new Set<string>();
		for (const info of api.KEYS) {
			assert.ok(info.name && info.en && info.label, JSON.stringify(info));
			assert.ok(['common', 'number', 'date', 'boolean'].includes(info.group), info.name);
			assert.equal(names.has(info.name.toUpperCase()) || names.has(info.en.toUpperCase()), false, info.name);
			names.add(info.name.toUpperCase());
			names.add(info.en.toUpperCase());
		}
		for (const key of ['Л', 'ЧЦ', 'ЧДЦ', 'ЧС', 'ЧРД', 'ЧРГ', 'ЧН', 'ЧГ', 'ЧО', 'ЧВН', 'ЧФ', 'ДФ', 'ДЛФ', 'ДП', 'БЛ', 'БИ']) {
			assert.equal(api.keyInfo(key)?.name, key);
		}
		assert.equal(api.keyInfo('Х'), null);
	});
});

describe('dcs-editor-format: пример (своё приближение)', () => {
	test('подпись примера предупреждает, что он не от платформы', () => {
		assert.equal(api.PREVIEW_NOTE, 'Пример приблизительный: в платформе вывод может отличаться.');
	});

	test('число: группы, дробная часть, разделители, сдвиг, длина', () => {
		assert.equal(api.preview('ЧДЦ=2', 1234567.891), `1${NBSP}234${NBSP}567,89`);
		assert.equal(api.preview('', 1234.5), `1${NBSP}234,5`);
		assert.equal(api.preview('ЧДЦ=2', 1.005), '1,01');
		assert.equal(api.preview("ЧЦ=15; ЧДЦ=2; ЧРД=,; ЧРГ=' '; ЧН=Ноль; ЧГ=3,0; ЧО=1", -547836), '-547 836,00');
		assert.equal(api.preview('ЧРГ=; ЧДЦ=0', 1234), `1${NBSP}234`);
		assert.equal(api.preview('ЧРД=.; ЧРГ=,', 1234.5), '1,234.5');
		assert.equal(api.preview('ЧГ=0', 1234567), '1234567');
		assert.equal(api.preview('ЧГ=3', 1234567890), `1234567${NBSP}890`);
		assert.equal(api.preview('ЧГ=3,2', 1234567890), `12345${NBSP}67${NBSP}890`);
		assert.equal(api.preview('ЧГ=3,2,0', 1234567890), `1${NBSP}23${NBSP}45${NBSP}67${NBSP}890`);
		assert.equal(api.preview('ЧЦ=3', 12345), '999');
		assert.equal(api.preview('ЧЦ=5', 1.6), '2');
		assert.equal(api.preview('ЧЦ=5; ЧГ=0; ЧВН=', 42), '00042');
		assert.equal(api.preview('ЧС=3', 12345), '12,345');
		assert.equal(api.preview('ЧС=-2', 5), '500');
	});

	test('ноль: без ЧН — пустая строка, ЧН= — сам ноль, иначе текст ЧН', () => {
		assert.equal(api.preview('ЧДЦ=2', 0), '');
		assert.equal(api.preview('ЧДЦ=2', 0.001), '');
		assert.equal(api.preview('ЧДЦ=2; ЧН=', 0), '0,00');
		assert.equal(api.preview('ЧДЦ=3; ЧН=0,000', 0), '0,000');
		assert.equal(api.preview("ЧН='Не используется'", 0), 'Не используется');
	});

	test('отрицательные числа по ЧО', () => {
		const shown = api.NN_OPTIONS.map((option) => api.preview(`ЧДЦ=1; ЧО=${option.value}`, -1.1));
		assert.deepEqual(shown, ['(1,1)', '-1,1', '- 1,1', '1,1-', '1,1 -']);
		assert.deepEqual(
			api.NN_OPTIONS.map((option) => option.label),
			shown
		);
	});

	test('английская локаль — по ключу Л, без него — русская', () => {
		assert.equal(api.preview('Л=en_US; ЧДЦ=2', 1234.5), '1,234.50');
		assert.equal(api.preview('Л=en', true), 'Yes');
		assert.equal(api.preview('', false), 'Нет');
	});

	test('дата: ДЛФ в обеих записях, шаблон ДФ с текстом в кавычках, пустая дата', () => {
		const day = '2015-12-01T00:00:00';
		assert.equal(api.preview('ДЛФ=D', day), '01.12.2015');
		assert.equal(api.preview('ДЛФ=Д', day), '01.12.2015');
		assert.equal(api.preview('ДЛФ=DD', day), '1 декабря 2015 г.');
		assert.equal(api.preview('ДЛФ=T', '2015-12-01T14:05:09'), '14:05:09');
		assert.equal(api.preview('ДЛФ=ДДВ', day), '1 декабря 2015 г. 0:00:00');
		assert.equal(api.preview('', day), '01.12.2015 0:00:00');
		// Локаль en_US: месяц перед днём, 12-часовое время
		assert.equal(api.preview('Л=en_US;ДЛФ=Д', day), '12/1/2015');
		assert.equal(api.preview('Л=en_US;ДЛФ=ДВ', day), '12/1/2015 12:00:00 AM');
		assert.equal(api.preview("ДФ='дд.ММ.гггг''г. '' ЧЧ:мм'", '2015-12-01T14:05:00'), '01.12.2015г.  14:05');
		assert.equal(api.preview('ДФ=dd.MM.yy', day), '01.12.15');
		assert.equal(api.preview("ДФ='dd.MM.yyyy hh:mm:ss'", '2015-12-01T14:05:09'), '01.12.2015 02:05:09');
		assert.equal(api.preview("ДФ='MMMM yy'", day), 'Декабрь 15');
		assert.equal(api.preview("ДФ='dddd, ddd, к'", day), 'вторник, Вт, 4');
		assert.equal(api.preview("ДЛФ=D; ДП='Без запрета'", '0001-01-01T00:00:00'), 'Без запрета');
		assert.equal(api.preview('ДЛФ=D', '0001-01-01T00:00:00'), '');
		assert.equal(api.preview('ДЛФ=D', new Date(2015, 11, 1, 10, 0, 0)), '01.12.2015');
	});

	test('булево: БИ и БЛ, пустое значение — пустая строка', () => {
		assert.equal(api.preview('БЛ=; БИ=Да', true), 'Да');
		assert.equal(api.preview('БЛ=; БИ=Да', false), '');
		assert.equal(api.preview('', true), 'Да');
		assert.equal(api.preview('БЛ=Разрешенные; БИ=Запрещенные', false), 'Разрешенные');
	});

	test('неподдержанный пример — пустая строка, а не исключение', () => {
		assert.equal(api.preview('ЧДЦ=2', null), '');
		assert.equal(api.preview('ЧДЦ=2', Number.NaN), '');
		assert.equal(api.preview('ДЛФ=D', 'не дата'), '');
	});
});

describe('dcs-editor-format: подключение в webview', () => {
	const read = (name: string) => fs.readFileSync(path.join(ROOT, 'resources', 'webview', name), 'utf8');
	const panel = fs.readFileSync(path.join(ROOT, 'src', 'features', 'metadata', 'dcsEditorPanel.ts'), 'utf8');

	test('модуль подключён до основного скрипта, панель подставляет его адрес', () => {
		const html = read('dcs-editor.html');
		const at = html.indexOf('{{FORMAT_JS_URI}}');
		assert.ok(at >= 0, 'в шаблоне нет {{FORMAT_JS_URI}}');
		// Основной скрипт берёт window.DcsFormat при старте: модуль обязан встать раньше
		assert.ok(at < html.indexOf('{{JS_URI}}'), 'модуль форматной строки подключён позже скрипта');
		assert.ok(panel.includes("'dcs-editor-format.js'"), 'панель не знает файл модуля');
		assert.ok(panel.includes("replaceAll('{{FORMAT_JS_URI}}'"), 'панель не подставляет {{FORMAT_JS_URI}}');
	});

	test('«…» у «Формат» условного оформления открывает окно, тип значения держит контрол', () => {
		const script = readEditorScript();
		assert.ok(script.includes('window.DcsFormat'), 'скрипт не берёт модуль');
		// Кнопка — только у параметра «Формат»
		assert.ok(
			/textButton: isFormatParameter\(row\.item\.parameter\) \? formatStringButton : undefined/.test(script),
			'редактор оформления не подключает кнопку окна'
		);
		// Тип имеющегося значения не переключается: окно правит только текст поля контрола
		assert.ok(/fixedMode: Boolean\(values\[0\]\) && !values\[0\]\.nil/.test(script), 'тип значения оформления не фиксирован');
		const dialog = script.slice(script.indexOf('function openFormatDialog(spec)'), script.indexOf('function formatStringButton(input)'));
		assert.ok(dialog.length > 0 && dialog.includes("width: 'wide'"), 'окно форматной строки — не широкий уровень стека');
		// Неизменённая строка не пишется: onDone зовётся только при отличии от исходной
		assert.ok(/if \(text !== initialText\) \{\s*spec\.onDone\(text\);/.test(script), 'ОК без правок меняет поле');
	});
});
