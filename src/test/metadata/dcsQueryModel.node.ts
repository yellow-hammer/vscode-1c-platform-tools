/**
 * Модель запроса конструктора СКД: чистые функции dcs-editor-query-model.js.
 *
 * Модуль исполняется в песочнице node:vm, как подсветка: тесты гоняют ровно тот код, который
 * работает в webview. Корпус — все 47 текстов запросов
 * схем компоновки БСП 3.1 (queries-ssl31.json, см. README фикстур); синтетика написана здесь и
 * покрывает то, чего в корпусе нет (ДОБАВИТЬ, ИТОГИ, ПО НАБОРАМ, английские ключевые слова и т. п.).
 * Запуск: npm run compile && node --test out/test/metadata/dcsQueryModel.node.js
 * Бюджет времени проверяется только с переменной DCS_PERF_BUDGET=1.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { performance } from 'node:perf_hooks';

interface Diagnostic {
	message: string;
	offset: number;
	line: number;
	column: number;
	internal?: boolean;
}

interface Field {
	expr: string;
	alias: string | null;
}

interface VirtualParam {
	text: string;
	dcs?: { text: string; kind: 'whole' | 'tail' };
}

interface Source {
	kind: 'table' | 'subquery' | 'param' | 'group';
	table?: string;
	virtualTable?: string | null;
	params?: VirtualParam[] | null;
	query?: Statement;
	name?: string;
	text?: string;
	alias: string | null;
}

interface Join {
	kind: 'inner' | 'left' | 'right' | 'full';
	optionalGroup: number | null;
	source: Source;
	joins: Join[];
	on: { conditions: string[] } | null;
}

interface FromEntry {
	source: Source;
	joins: Join[];
}

interface SelectItem {
	path?: string;
	star?: boolean;
	text?: string;
	alias: string | null;
}

interface WhereItem {
	kind: 'field' | 'fieldStar' | 'condition';
	path?: string;
	text?: string;
	parens?: boolean;
	alias: string | null;
}

interface DcsBlock<T> {
	placement: string | null;
	items: T[];
	breaks?: number[];
}

interface RawBlock {
	placement: string;
	kind: 'characteristics' | 'block';
	text: string;
}

interface Part {
	unionAll: boolean | null;
	allowed: boolean;
	distinct: boolean;
	top: number | string | null;
	fields: Field[];
	dcsSelect: DcsBlock<SelectItem> | null;
	into: { table: string; mode: 'create' | 'add' } | null;
	from: FromEntry[];
	where: { conditions: string[] } | null;
	dcsWhere: DcsBlock<WhereItem> | null;
	groupBy: { items: string[]; groupingSets: string[][] | null } | null;
	having: { conditions: string[] } | null;
	forUpdate: string[] | null;
	raw: RawBlock[];
}

interface Totals {
	aggregates: Field[];
	overall: boolean;
	by: Array<{ expr: string; mode: string | null; periods: string | null; alias: string | null }> | null;
}

interface Statement {
	type: 'select' | 'drop';
	table?: string;
	parts: Part[];
	orderBy: Array<{ expr: string; dir: 'asc' | 'desc'; hierarchy: boolean }> | null;
	autoOrder: boolean;
	totals: Totals | null;
	indexes: Array<{ unique: boolean; fields: string[] }>;
	forUpdate: string[] | null;
	raw: RawBlock[];
	original?: { index: number; before: string; text: string };
}

interface Model {
	format: string;
	lang: 'ru' | 'en';
	eol: string;
	statements: Statement[];
	comments: { total: number; dropped: number };
	original: { count: number; tail: string };
}

interface BuildOptions {
	lang?: 'ru' | 'en';
	eol?: '\r\n' | '\n';
	canonical?: boolean;
}

interface Position {
	offset: number;
	line: number;
	column: number;
}

interface QueryModelApi {
	FORMAT: string;
	parse(text: string): { model: Model; diagnostics: Diagnostic[] };
	build(model: Model, options?: BuildOptions): string;
	buildWithReport(model: Model, options?: BuildOptions): { text: string; changed: boolean[]; comments: { total: number; dropped: number } };
	canonTokens(text: string): string[];
	selfCheck(text: string): { ok: boolean; firstDiff?: Position; message?: string };
	sameModel(a: Model, b: Model): boolean;
	outputFields(statement: Statement): Array<string | null>;
	tempTables(model: Model, beforeIndex: number): Array<{ name: string; fields: string[]; statement: number }>;
	parametersOf(text: string): string[];
	defaultFieldAlias(expr: string, taken?: string[]): string;
	defaultTableAlias(table: string | Partial<Source>, taken?: string[]): string;
	renameAlias(part: Part, from: string, to: string): Part;
	renameAliasInStatement(statement: Statement, partIndex: number, from: string, to: string): Statement;
	renameAliasInText(text: string, from: string, to: string): string;
}

interface CorpusQuery {
	file: string;
	dataSet: string;
	nestedSchema?: string;
	text: string;
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const FILE = path.join(ROOT, 'resources', 'webview', 'dcs-editor-query-model.js');
const FIXTURE = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs', 'queries-ssl31.json');

type Factory = (moduleShim: { exports: unknown } | undefined, windowShim: Record<string, unknown>) => void;

/**
 * Исполняет файл webview в текущем realm. Обёртка-функция вместо нового контекста vm: объекты из
 * чужого realm не проходят deepStrictEqual (другой Object.prototype). Параметр window подменяет
 * глобал webview, чтобы модуль не записывал DcsQueryModel в глобалы теста.
 */
function loadFactory(): Factory {
	const code = fs.readFileSync(FILE, 'utf8');
	return vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: FILE }) as Factory;
}

const factory = loadFactory();
const api = (() => {
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	return moduleShim.exports as QueryModelApi;
})();

const corpus = (JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { queries: CorpusQuery[] }).queries;

/** Оба вида текста: как его отдаёт cf-dcs-info (LF) и как он лежит в файле выгрузки (CRLF). */
const variants: Array<{ name: string; text: (query: CorpusQuery) => string }> = [
	{ name: 'LF', text: (query) => query.text },
	{ name: 'CRLF', text: (query) => query.text.replace(/\n/g, '\r\n') },
];

function label(query: CorpusQuery): string {
	return `${query.file} / ${query.nestedSchema ? query.nestedSchema + ' / ' : ''}${query.dataSet}`;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function canonical(model: Model, options: BuildOptions = {}): string {
	return api.buildWithReport(model, Object.assign({}, options, { canonical: true })).text;
}

function parsed(text: string): Model {
	const result = api.parse(text);
	assert.deepEqual(result.diagnostics, [], 'диагностика разбора');
	return result.model;
}

function selects(model: Model): Statement[] {
	return model.statements.filter((statement) => statement.type === 'select');
}

function allParts(model: Model): Part[] {
	return selects(model).flatMap((statement) => statement.parts);
}

function joinsOf(joins: Join[]): Join[] {
	return joins.flatMap((join) => [join, ...joinsOf(join.joins)]);
}

function partJoins(part: Part): Join[] {
	return part.from.flatMap((entry) => joinsOf(entry.joins));
}

function table(name: string, alias: string): Source {
	return { kind: 'table', table: name, virtualTable: null, params: null, alias: alias };
}

function newPart(fields: Field[]): Part {
	return {
		unionAll: null, allowed: false, distinct: false, top: null, fields: fields, dcsSelect: null, into: null, from: [],
		where: null, dcsWhere: null, groupBy: null, having: null, forUpdate: null, raw: [],
	};
}

/** Правка модели, сборка и повторный разбор: собранный текст разбирается без диагностики и сам проходит самопроверку. */
function rebuild(text: string, mutate: (model: Model) => void): { before: Model; after: Model; out: string; model: Model } {
	const before = parsed(text);
	const model = clone(before);
	mutate(model);
	const out = api.build(model);
	const result = api.parse(out);
	assert.deepEqual(result.diagnostics, [], 'диагностика собранного текста');
	const check = api.selfCheck(out);
	assert.ok(check.ok, `самопроверка собранного текста: ${check.message ?? ''}`);
	return { before: before, after: result.model, out: out, model: model };
}

/** Детерминированный генератор для обрезки: тест повторяем от запуска к запуску. */
function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
}

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

describe('Модель запроса СКД: модуль и корпус', () => {
	test('webview получает модуль через window.DcsQueryModel без module', () => {
		const windowShim: Record<string, unknown> = {};
		factory(undefined, windowShim);
		const exported = windowShim.DcsQueryModel as QueryModelApi;
		assert.equal(typeof exported.parse, 'function');
		assert.equal(exported.FORMAT, 'dcs-query-model/1');
	});

	test('фикстура: 47 текстов ssl31, 4 из них внутри объединений, все непустые и с LF', () => {
		assert.equal(corpus.length, 47);
		assert.equal(corpus.filter((query) => query.dataSet.includes('/')).length, 4);
		assert.equal(corpus.filter((query) => query.nestedSchema).length, 4);
		for (const query of corpus) {
			assert.ok(query.text.trim().length > 0, label(query));
			assert.ok(!query.text.includes('\r'), label(query));
			assert.match(query.file, /\/Templates\/[^/]+\/Ext\/Template\.xml$/);
		}
	});
});

describe('Модель запроса СКД: круг на корпусе ssl31', () => {
	for (const variant of variants) {
		test(`${variant.name}: разбор без диагностики, канон на круге и самопроверка — 47 из 47`, () => {
			for (const query of corpus) {
				const text = variant.text(query);
				const model = parsed(text);
				assert.equal(model.format, api.FORMAT);
				// Конец строки берётся из текста; у однострочного запроса его нет — по умолчанию LF
				assert.equal(model.eol, variant.name === 'CRLF' && query.text.includes('\n') ? '\r\n' : '\n');
				assert.deepEqual(api.canonTokens(canonical(model)), api.canonTokens(text), label(query));
				const check = api.selfCheck(text);
				assert.ok(check.ok, `${label(query)}: ${check.message ?? ''}`);
			}
		});

		test(`${variant.name}: повторная сборка совпадает с первой символ в символ`, () => {
			for (const query of corpus) {
				const first = canonical(parsed(variant.text(query)));
				assert.equal(canonical(parsed(first)), first, label(query));
			}
		});

		test(`${variant.name}: модель без изменений собирается в исходный текст байт в байт`, () => {
			for (const query of corpus) {
				const text = variant.text(query);
				const model = parsed(text);
				const report = api.buildWithReport(model);
				assert.equal(report.text, text, label(query));
				assert.ok(report.changed.every((changed) => !changed), label(query));
				assert.equal(report.comments.dropped, 0);
				// Модель переживает JSON-круг без потерь: клон собирается в тот же текст
				assert.equal(api.build(clone(model)), text, label(query));
			}
		});
	}

	test('модель на круге: текст канона разбирается в ту же модель (и после сборки на английском)', () => {
		for (const query of corpus) {
			const model = parsed(query.text);
			assert.ok(api.sameModel(parsed(canonical(model)), model), label(query));
			assert.ok(api.sameModel(parsed(canonical(model, { lang: 'en' })), model), label(query));
		}
	});

	test('метрика: канон без сплайса совпадает с исходником байт в байт не реже 29 из 47', () => {
		// Нижняя граница, чтобы подгонка сборщика не откатывалась; без учёта пробелов — 43 из 47
		const exact = corpus.filter((query) => canonical(parsed(query.text)) === query.text).length;
		const spaces = corpus.filter((query) => canonical(parsed(query.text)).replace(/\s+/g, ' ').trim() === query.text.replace(/\s+/g, ' ').trim()).length;
		assert.ok(exact >= 29, `до байта ${exact}`);
		assert.ok(spaces >= 43, `без пробелов ${spaces}`);
	});

	test('сборка канона в CRLF не оставляет голых LF, в LF — CR', () => {
		for (const query of corpus) {
			const model = parsed(query.text);
			const crlf = canonical(model, { eol: '\r\n' });
			assert.ok(!/[^\r]\n/.test(crlf), label(query));
			assert.ok(!canonical(model, { eol: '\n' }).includes('\r'), label(query));
			assert.deepEqual(api.canonTokens(crlf), api.canonTokens(query.text), label(query));
		}
	});

	test('сборка в английских ключевых словах сохраняет канон', () => {
		for (const query of corpus) {
			const english = canonical(parsed(query.text), { lang: 'en' });
			assert.deepEqual(api.canonTokens(english), api.canonTokens(query.text), label(query));
			assert.equal(parsed(english).lang, 'en', label(query));
		}
	});

	test('структура корпуса: пакеты, объединения, необязательные соединения, блоки СКД и ВТ разобраны', () => {
		const models = corpus.map((query) => parsed(query.text));
		const parts = models.flatMap(allParts);
		assert.equal(models.filter((model) => model.statements.length > 1).length, 5);
		assert.ok(models.some((model) => selects(model).some((statement) => statement.parts.length > 1)));
		assert.ok(parts.some((part) => partJoins(part).some((join) => join.optionalGroup !== null)));
		assert.ok(parts.some((part) => part.dcsSelect && part.dcsSelect.items.some((item) => item.star)));
		assert.ok(parts.some((part) => part.dcsWhere && part.dcsWhere.items.some((item) => item.kind === 'condition' && item.parens)));
		// Два соседних {ГДЕ} одной части сливаются в один список с отметкой разрыва
		assert.ok(parts.some((part) => part.dcsWhere && (part.dcsWhere.breaks ?? []).length > 0));
		const sources = parts.flatMap((part) => part.from.flatMap((entry) => [entry.source, ...joinsOf(entry.joins).map((join) => join.source)]));
		assert.ok(sources.some((source) => source.kind === 'subquery'));
		const virtual = sources.filter((source) => source.virtualTable);
		assert.deepEqual(new Set(virtual.map((source) => source.virtualTable)), new Set(['ОстаткиИОбороты', 'СрезПоследних']));
		assert.ok(virtual.some((source) => (source.params ?? []).some((param) => param.dcs && param.dcs.kind === 'whole')));
		// Неразобранного не осталось: ни групп соединений текстом, ни прочих блоков
		assert.ok(!sources.some((source) => source.kind === 'group'));
		assert.ok(!parts.some((part) => part.raw.length > 0));
	});
});

describe('Модель запроса СКД: сплайс по запросам пакета', () => {
	const packages = corpus.filter((query) => parsed(query.text).statements.length > 1);

	test('правка одного запроса пакета не трогает байты остальных', () => {
		assert.equal(packages.length, 5);
		let edits = 0;
		for (const query of packages) {
			for (const variant of variants) {
				const text = variant.text(query);
				const model = parsed(text);
				model.statements.forEach((statement, k) => {
					if (statement.type !== 'select') {
						return;
					}
					const copy = clone(model);
					for (const part of copy.statements[k].parts) {
						part.fields.push({ expr: 'ИСТИНА', alias: 'ДобавленноеПоле' });
					}
					const report = api.buildWithReport(copy);
					assert.deepEqual(report.changed, copy.statements.map((_, i) => i === k), label(query));
					const prefix = model.statements.slice(0, k).map((s) => s.original!.before + s.original!.text).join('') + statement.original!.before;
					const suffix = model.statements.slice(k + 1).map((s) => s.original!.before + s.original!.text).join('') + model.original.tail;
					assert.ok(report.text.startsWith(prefix), `${label(query)}: начало до запроса ${k + 1}`);
					assert.ok(report.text.endsWith(suffix), `${label(query)}: конец после запроса ${k + 1}`);
					const back = parsed(report.text);
					assert.ok(api.sameModel(back, copy), label(query));
					edits++;
				});
			}
		}
		assert.ok(edits >= 2 * 20);
	});

	test('удаление и вставка запроса пакета сохраняют срезы остальных', () => {
		for (const query of packages) {
			const text = query.text;
			const model = parsed(text);
			// Удаление первого: остальные — исходными срезами со своими разделителями
			const removed = clone(model);
			removed.statements.shift();
			const out = api.build(removed);
			assert.ok(out.startsWith(model.statements[1].original!.text), label(query));
			assert.ok(text.endsWith(out), label(query));
			assert.equal(parsed(out).statements.length, model.statements.length - 1);
			// Вставка в конец: исходный текст до хвоста не тронут, новый запрос — после разделителя
			const added = rebuild(text, (copy) => {
				copy.statements.push({
					type: 'select',
					parts: [newPart([{ expr: '1', alias: 'Единица' }])],
					orderBy: null, autoOrder: false, totals: null, indexes: [], forUpdate: null, raw: [],
				});
			});
			assert.ok(added.out.startsWith(text.slice(0, text.length - model.original.tail.length)), label(query));
			assert.ok(added.out.endsWith(';\n\n' + '/'.repeat(80) + '\nВЫБРАТЬ\n\t1 КАК Единица'), label(query));
			assert.equal(added.after.statements.length, model.statements.length + 1);
		}
	});

	test('срез не доверяется флагам: изменённый узел со старым срезом собирается заново', () => {
		const query = packages[0];
		const model = parsed(query.text);
		const copy = clone(model);
		copy.statements[0].parts[0].fields[0].alias = 'ИзменённыйПсевдоним';
		// original.text не изменён — сборка обязана его не использовать
		const out = api.build(copy);
		assert.notEqual(out, query.text);
		assert.equal(parsed(out).statements[0].parts[0].fields[0].alias, 'ИзменённыйПсевдоним');
		assert.ok(out.endsWith(model.statements.slice(1).map((s) => s.original!.before + s.original!.text).join('') + model.original.tail));
	});
});

describe('Модель запроса СКД: мутации', () => {
	test('поле: добавление во все части последнего запроса — 47 из 47', () => {
		for (const query of corpus) {
			const result = rebuild(query.text, (model) => {
				const last = selects(model).pop()!;
				for (const part of last.parts) {
					part.fields.push({ expr: 'ИСТИНА', alias: 'ДобавленноеПоле' });
				}
			});
			assert.ok(api.sameModel(result.after, result.model), label(query));
			const last = selects(result.after).pop()!;
			assert.equal(api.outputFields(last).pop(), 'ДобавленноеПоле');
		}
	});

	test('псевдоним поля и условие ГДЕ — 47 из 47', () => {
		for (const query of corpus) {
			const aliased = rebuild(query.text, (model) => {
				selects(model)[0].parts[0].fields[0].alias = 'НовыйПсевдоним';
			});
			assert.ok(api.sameModel(aliased.after, aliased.model), label(query));
			const conditioned = rebuild(query.text, (model) => {
				const part = selects(model)[0].parts[0];
				part.where = { conditions: (part.where ? part.where.conditions : []).concat(['ИСТИНА']) };
			});
			assert.ok(api.sameModel(conditioned.after, conditioned.model), label(query));
			assert.equal(selects(conditioned.after)[0].parts[0].where!.conditions.slice(-1)[0], 'ИСТИНА');
		}
	});

	test('источник и соединение добавляются в ИЗ', () => {
		let tried = 0;
		for (const query of corpus) {
			const model = parsed(query.text);
			const statementIndex = model.statements.findIndex((s) => s.type === 'select' && s.parts[0].from.length > 0);
			if (statementIndex < 0) {
				continue;
			}
			tried++;
			const alias = model.statements[statementIndex].parts[0].from[0].source.alias ?? 'Т';
			const added = rebuild(query.text, (copy) => {
				copy.statements[statementIndex].parts[0].from.push({ source: table('Справочник.ДобавленныйСправочник', 'ДобавленныйСправочник'), joins: [] });
			});
			assert.ok(api.sameModel(added.after, added.model), label(query));
			const joined = rebuild(query.text, (copy) => {
				copy.statements[statementIndex].parts[0].from[0].joins.push({
					kind: 'left',
					optionalGroup: null,
					source: table('Справочник.Связанный', 'Связанный'),
					joins: [],
					on: { conditions: [`Связанный.Ссылка = ${alias}.Ссылка`, 'Связанный.Активен'] },
				});
			});
			assert.ok(api.sameModel(joined.after, joined.model), label(query));
			assert.ok(joined.out.includes(`\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Связанный КАК Связанный\n\t\tПО Связанный.Ссылка = ${alias}.Ссылка\n\t\t\tИ Связанный.Активен`), label(query));
		}
		assert.ok(tried >= 40);
	});

	test('часть объединения: добавление копии и удаление', () => {
		let unions = 0;
		for (const query of corpus) {
			const added = rebuild(query.text, (model) => {
				const statement = selects(model).pop()!;
				const copy = Object.assign(clone(statement.parts[0]), { unionAll: false, dcsSelect: null, into: null });
				statement.parts.push(copy);
			});
			assert.ok(api.sameModel(added.after, added.model), label(query));
			const model = parsed(query.text);
			const index = model.statements.findIndex((s) => s.type === 'select' && s.parts.length > 1);
			if (index < 0) {
				continue;
			}
			unions++;
			const removed = rebuild(query.text, (copy) => {
				copy.statements[index].parts.pop();
			});
			assert.ok(api.sameModel(removed.after, removed.model), label(query));
			assert.equal(removed.after.statements[index].parts.length, model.statements[index].parts.length - 1);
		}
		assert.ok(unions >= 3);
	});

	test('{ГДЕ} и {ВЫБРАТЬ}: элемент добавляется в блок или блок создаётся на каноническом месте', () => {
		for (const query of corpus) {
			const model = parsed(query.text);
			const statementIndex = model.statements.length - 1;
			const part = model.statements[statementIndex].parts[0];
			const alias = part.from.length ? part.from[0].source.alias : null;
			const result = rebuild(query.text, (copy) => {
				const target = copy.statements[statementIndex].parts[0];
				const whereItem: WhereItem = alias
					? { kind: 'fieldStar', path: `${alias}.Ссылка`, alias: 'ОтборПоСсылке' }
					: { kind: 'condition', text: 'ИСТИНА', parens: true, alias: null };
				if (target.dcsWhere) {
					target.dcsWhere.items.push(whereItem);
				} else {
					target.dcsWhere = { placement: null, items: [whereItem] };
				}
				const selectItem: SelectItem = { path: 'ДобавленныйПсевдоним', star: true, alias: null };
				if (target.dcsSelect) {
					target.dcsSelect.items.push(selectItem);
				} else {
					target.dcsSelect = { placement: null, items: [selectItem] };
				}
			});
			const back = result.after.statements[statementIndex].parts[0];
			assert.deepEqual(back.dcsWhere!.items, result.model.statements[statementIndex].parts[0].dcsWhere!.items, label(query));
			assert.deepEqual(back.dcsSelect!.items, result.model.statements[statementIndex].parts[0].dcsSelect!.items, label(query));
			// Новый блок без места встаёт по канону: {ВЫБРАТЬ} — после ПОМЕСТИТЬ или списка, {ГДЕ} — после ГДЕ или ИЗ
			if (!part.dcsSelect) {
				assert.equal(back.dcsSelect!.placement, back.into ? 'afterInto' : 'afterFields', label(query));
			}
			if (!part.dcsWhere) {
				const expected = back.where ? 'afterWhere' : back.from.length ? 'afterFrom' : back.into ? 'afterInto' : 'afterFields';
				assert.equal(back.dcsWhere!.placement, expected, label(query));
			}
		}
	});

	test('необязательное соединение: снятие и установка фигурных скобок', () => {
		let set = 0;
		let cleared = 0;
		for (const query of corpus) {
			const model = parsed(query.text);
			model.statements.forEach((statement, s) => {
				if (statement.type !== 'select') {
					return;
				}
				statement.parts.forEach((part, p) => {
					part.from.forEach((entry, e) => {
						entry.joins.forEach((join, j) => {
							const result = rebuild(query.text, (copy) => {
								copy.statements[s].parts[p].from[e].joins[j].optionalGroup = join.optionalGroup === null ? 100 : null;
							});
							const back = result.after.statements[s].parts[p].from[e].joins[j];
							if (join.optionalGroup === null) {
								assert.notEqual(back.optionalGroup, null, label(query));
								set++;
							} else {
								assert.equal(back.optionalGroup, null, label(query));
								cleared++;
							}
						});
					});
				});
			});
		}
		assert.ok(set >= 20 && cleared >= 3, `${set} / ${cleared}`);
	});

	test('параметр ВТ: «база + блок СКД» и «целиком в {…}» на виртуальных таблицах корпуса', () => {
		let tried = 0;
		for (const query of corpus) {
			const model = parsed(query.text);
			model.statements.forEach((statement, s) => {
				statement.parts?.forEach((part, p) => {
					part.from.forEach((entry, e) => {
						if (!entry.source.params || !entry.source.params.length) {
							return;
						}
						tried++;
						const result = rebuild(query.text, (copy) => {
							const params = copy.statements[s].parts[p].from[e].source.params!;
							params[0] = { text: '&НовыйПериод', dcs: { text: '(&НовыйПериод)', kind: 'tail' } };
							params[params.length - 1] = { text: '', dcs: { text: 'Поле.* КАК Отбор', kind: 'whole' } };
						});
						assert.ok(api.sameModel(result.after, result.model), label(query));
						assert.match(result.out, /\(&НовыйПериод \{\(&НовыйПериод\)\}, /);
					});
				});
			});
		}
		assert.equal(tried, 4);
	});

	test('переименование алиаса источника заменяет ссылки во всех предложениях части', () => {
		let renamed = 0;
		for (const query of corpus) {
			const model = parsed(query.text);
			model.statements.forEach((statement, s) => {
				statement.parts?.forEach((part, p) => {
					const alias = part.from.length ? part.from[0].source.alias : null;
					if (!alias) {
						return;
					}
					const result = rebuild(query.text, (copy) => {
						copy.statements[s].parts[p] = api.renameAlias(copy.statements[s].parts[p], alias, 'ПереименованныйАлиас');
					});
					const back = result.after.statements[s].parts[p];
					assert.equal(back.from[0].source.alias, 'ПереименованныйАлиас', label(query));
					const texts = [
						...back.fields.map((field) => field.expr),
						...(back.where ? back.where.conditions : []),
						...partJoins(back).flatMap((join) => (join.on ? join.on.conditions : [])),
						...(back.groupBy ? back.groupBy.items : []),
						...(back.dcsWhere ? back.dcsWhere.items.map((item) => item.path ?? item.text ?? '') : []),
					];
					for (const value of texts) {
						assert.equal(api.renameAliasInText(value, alias, 'Х'), value, `${label(query)}: «${value}»`);
					}
					renamed++;
				});
			});
		}
		assert.ok(renamed >= 50);
	});

	test('переименование алиаса в запросе доходит до УПОРЯДОЧИТЬ ПО', () => {
		// Порядок по полям источников — обычная форма запросов, а живёт он у запроса, не у части:
		// без этого `Т.Код` в порядке ссылался бы на старый алиас
		const text = 'ВЫБРАТЬ\n\tТ.Наименование КАК Наименование\nИЗ\n\tСправочник.Валюты КАК Т\nУПОРЯДОЧИТЬ ПО\n\tТ.Код УБЫВ,\n\tНаименование';
		const result = rebuild(text, (model) => {
			model.statements[0] = api.renameAliasInStatement(model.statements[0], 0, 'Т', 'Валюты');
		});
		assert.equal(
			result.out,
			'ВЫБРАТЬ\n\tВалюты.Наименование КАК Наименование\nИЗ\n\tСправочник.Валюты КАК Валюты\nУПОРЯДОЧИТЬ ПО\n\tВалюты.Код УБЫВ,\n\tНаименование'
		);
		// Исходный запрос не изменён: функция возвращает новый
		const before = parsed(text).statements[0];
		api.renameAliasInStatement(before, 0, 'Т', 'Валюты');
		assert.equal(before.orderBy![0].expr, 'Т.Код');
		assert.equal(before.parts[0].from[0].source.alias, 'Т');

		// У объединения порядок — по колонкам результата, алиас второй части — своя область имён
		const union =
			'ВЫБРАТЬ\n\tТ.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Т\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tТ.Код\nИЗ\n\tСправочник.Банки КАК Т\nУПОРЯДОЧИТЬ ПО\n\tКод';
		const unionResult = rebuild(union, (model) => {
			model.statements[0] = api.renameAliasInStatement(model.statements[0], 0, 'Т', 'Валюты');
		});
		const back = unionResult.after.statements[0];
		assert.equal(back.parts[0].from[0].source.alias, 'Валюты');
		assert.equal(back.parts[1].from[0].source.alias, 'Т');
		assert.equal(back.parts[1].fields[0].expr, 'Т.Код');
		assert.deepEqual(back.orderBy, [{ expr: 'Код', dir: 'asc', hierarchy: false }]);

		// Голова пути — колонка результата: порядок мог иметь в виду её, поэтому не трогается
		const column = 'ВЫБРАТЬ\n\tТ.Ссылка КАК Т\nИЗ\n\tСправочник.Валюты КАК Т\nУПОРЯДОЧИТЬ ПО\n\tТ.Наименование';
		const kept = rebuild(column, (model) => {
			model.statements[0] = api.renameAliasInStatement(model.statements[0], 0, 'Т', 'Валюты');
		});
		assert.equal(kept.after.statements[0].orderBy![0].expr, 'Т.Наименование');
		assert.equal(kept.after.statements[0].parts[0].fields[0].expr, 'Валюты.Ссылка');

		// Уничтожение ВТ и неверный индекс части — без изменений
		const drop = parsed('УНИЧТОЖИТЬ ВТ').statements[0];
		assert.equal(api.renameAliasInStatement(drop, 0, 'Т', 'Х'), drop);
		const single = parsed(text).statements[0];
		assert.equal(api.renameAliasInStatement(single, 5, 'Т', 'Х'), single);
	});
});

describe('Модель запроса СКД: отрицательный контроль и сравнение моделей', () => {
	test('удалённое поле меняет канон — потеря видна', () => {
		let tried = 0;
		for (const query of corpus) {
			const model = parsed(query.text);
			const part = allParts(model).find((candidate) => candidate.fields.length > 1);
			if (!part) {
				continue;
			}
			tried++;
			part.fields.shift();
			assert.notDeepEqual(api.canonTokens(api.build(model)), api.canonTokens(query.text), label(query));
		}
		assert.ok(tried >= 45);
	});

	test('sameModel: два разбора равны, правка различима, откат правки снова равен', () => {
		for (const query of corpus) {
			const a = parsed(query.text);
			const b = parsed(query.text.replace(/\n/g, '\r\n'));
			assert.ok(api.sameModel(a, b), label(query));
			const changed = clone(a);
			const field = changed.statements.find((s) => s.type === 'select')!.parts[0].fields[0];
			const before = field.expr;
			field.expr = before + ' + 1';
			assert.ok(!api.sameModel(a, changed), label(query));
			field.expr = before;
			assert.ok(api.sameModel(a, changed), label(query));
		}
	});
});

describe('Модель запроса СКД: обрезанный текст и бюджет', () => {
	test('обрезка в 10 местах каждого текста: без падений, no-op байт в байт, самопроверка честна', () => {
		const next = random(42);
		let cases = 0;
		let accepted = 0;
		for (const query of corpus) {
			for (let k = 0; k < 10; k++) {
				const cut = query.text.slice(0, Math.floor(next() * query.text.length));
				cases++;
				const result = api.parse(cut);
				assert.ok(!result.diagnostics.some((d) => d.internal), `${label(query)}: внутренняя ошибка на срезе ${cut.length}`);
				assert.equal(api.build(result.model), cut);
				const check = api.selfCheck(cut);
				if (check.ok) {
					accepted++;
					assert.deepEqual(api.canonTokens(canonical(result.model)), api.canonTokens(cut));
				} else {
					assert.ok(check.firstDiff && check.firstDiff.offset <= cut.length && check.message);
				}
			}
		}
		assert.equal(cases, 470);
		assert.ok(accepted > 0 && accepted < cases);
	});

	// Порог по времени на общих машинах CI мигает, поэтому замер включается явно и в обычном наборе пропускается
	const perfBudget = process.env.DCS_PERF_BUDGET === '1';
	test(
		'бюджет: разбор и сборка текста ssl31, медиана меньше 5 мс',
		{ skip: perfBudget ? false : 'замер времени включается переменной DCS_PERF_BUDGET=1' },
		(t) => {
			for (const query of corpus) {
				api.buildWithReport(api.parse(query.text).model, { canonical: true });
			}
			const medians = corpus.map((query) => {
				const runs: number[] = [];
				for (let k = 0; k < 7; k++) {
					const start = performance.now();
					const model = api.parse(query.text).model;
					api.buildWithReport(model, { canonical: true });
					api.build(model);
					runs.push(performance.now() - start);
				}
				return { query, ms: median(runs) };
			});
			const slowest = medians.reduce((a, b) => (b.ms > a.ms ? b : a));
			t.diagnostic(
				`наибольшая медиана ${slowest.ms.toFixed(2)} мс: ${label(slowest.query)}, ${slowest.query.text.length} символов`
			);
			const over = medians
				.filter((entry) => entry.ms >= 5)
				.map((entry) => `${label(entry.query)}: ${entry.ms.toFixed(2)} мс на ${entry.query.text.length} символов`);
			assert.deepEqual(over, [], over.join('; '));
		}
	);
});

describe('Модель запроса СКД: диагностика', () => {
	const cases: Array<{ name: string; text: string; line: number; column: number; message: RegExp }> = [
		{
			name: 'незакрытая скобка',
			text: 'ВЫБРАТЬ\n\tТ.А КАК А\nИЗ\n\tСправочник.Т КАК Т\nГДЕ\n\t(Т.А = 1',
			line: 6,
			column: 2,
			message: /Не закрыта скобка/,
		},
		{
			name: 'второе ИЗ после ГДЕ',
			text: 'ВЫБРАТЬ\n\tТ.А\nИЗ\n\tСправочник.Т КАК Т\nГДЕ\n\tТ.А = 1\nИЗ\n\tСправочник.Т2 КАК Т2',
			line: 7,
			column: 1,
			message: /Нестандартный порядок предложений: ИЗ/,
		},
		{
			name: 'незакрытая кавычка',
			text: 'ВЫБРАТЬ\n\t"абв КАК А',
			line: 2,
			column: 2,
			message: /Не закрыта кавычка/,
		},
		{
			name: 'соединение без ПО',
			text: 'ВЫБРАТЬ\n\tТ.А\nИЗ\n\tСправочник.Т КАК Т\n\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Т2 КАК Т2\nГДЕ\n\tИСТИНА',
			line: 6,
			column: 1,
			message: /Нет ПО у соединения/,
		},
		{
			name: 'лишняя закрывающая скобка',
			text: 'ВЫБРАТЬ\n\tТ.А)\nИЗ\n\tСправочник.Т КАК Т',
			line: 2,
			column: 5,
			message: /Лишняя закрывающая скобка/,
		},
		{
			name: 'текст до ВЫБРАТЬ',
			text: 'Т.А\nВЫБРАТЬ\n\tТ.А\nИЗ\n\tСправочник.Т КАК Т',
			line: 1,
			column: 1,
			message: /Ожидалось ВЫБРАТЬ/,
		},
	];
	for (const item of cases) {
		test(`${item.name}: строка ${item.line}, колонка ${item.column}`, () => {
			const result = api.parse(item.text);
			assert.ok(result.diagnostics.length > 0);
			const first = result.diagnostics[0];
			assert.match(first.message, item.message);
			assert.deepEqual([first.line, first.column], [item.line, item.column]);
			const check = api.selfCheck(item.text);
			assert.equal(check.ok, false);
			assert.deepEqual([check.firstDiff!.line, check.firstDiff!.column], [item.line, item.column]);
			// Текст с ошибкой не теряется: модель без правок собирается в него же
			assert.equal(api.build(result.model), item.text);
		});
	}

	test('самопроверка показывает место, где сборка изменила бы текст', () => {
		// Один набор в ПО НАБОРАМ сборщик пишет простым ИНДЕКСИРОВАТЬ ПО: лексемы расходятся на НАБОРАМ
		const text = 'ВЫБРАТЬ\n\tТ.А КАК А\nПОМЕСТИТЬ ВТ\nИЗ\n\tСправочник.Т КАК Т\nИНДЕКСИРОВАТЬ ПО НАБОРАМ ((А))';
		assert.deepEqual(api.parse(text).diagnostics, []);
		const check = api.selfCheck(text);
		assert.equal(check.ok, false);
		assert.deepEqual([check.firstDiff!.line, check.firstDiff!.column], [6, 18]);
		assert.match(check.message!, /НАБОРАМ/);
	});

	test('самопроверка ловит потерю текста, а не синтаксис; пустой текст — новый запрос', () => {
		// Недописанное выражение лексем не теряет: проверку проходит, хотя платформа такой текст отвергнет
		assert.equal(api.selfCheck('ВЫБРАТЬ\n\tТ.А +\nИЗ\n\tСправочник.Т КАК Т').ok, true);
		// Пустые списки разборщик отмечает сам
		assert.match(api.parse('ВЫБРАТЬ ИЗ Справочник.Т КАК Т').diagnostics[0].message, /Нет полей выборки/);
		assert.equal(api.selfCheck('').ok, true);
		assert.deepEqual(api.parse('').model.statements, []);
		assert.equal(api.build(api.parse('  // только комментарий\n').model), '  // только комментарий\n');
	});
});

/** Канон сборки на синтетическом тексте: разбор и сборка возвращают его символ в символ. */
const CANON = [
	'ВЫБРАТЬ РАЗРЕШЕННЫЕ РАЗЛИЧНЫЕ ПЕРВЫЕ 10',
	'\tОстатки.Склад КАК Склад,',
	'\tСУММА(Остатки.КоличествоОстаток) КАК Количество',
	'ПОМЕСТИТЬ ВТ_Остатки',
	'{ВЫБРАТЬ',
	'\tСклад.*,',
	'\tКоличество}',
	'ИЗ',
	'\tРегистрНакопления.ТестовыйРегистр.Остатки({(&Период)}, Склад = &Склад) КАК Остатки',
	'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Склады КАК Склады',
	'\t\tПО Остатки.Склад = Склады.Ссылка',
	'\t\t\tИ Склады.ЭтоГруппа = ЛОЖЬ',
	'\t\t{ЛЕВОЕ СОЕДИНЕНИЕ Справочник.Организации КАК Организации',
	'\t\tПО Склады.Организация = Организации.Ссылка}',
	'ГДЕ',
	'\tОстатки.КоличествоОстаток > 0',
	'\tИ Склады.ПометкаУдаления = ЛОЖЬ',
	'{ГДЕ',
	'\tСклады.Организация.* КАК Организация,',
	'\t(Склады.Родитель В ИЕРАРХИИ (&Группа))}',
	'СГРУППИРОВАТЬ ПО',
	'\tОстатки.Склад',
	'ИМЕЮЩИЕ',
	'\tСУММА(Остатки.КоличествоОстаток) > 1',
	'ИНДЕКСИРОВАТЬ ПО',
	'\tСклад',
	';',
	'',
	'/'.repeat(80),
	'ВЫБРАТЬ',
	'\tВТ_Остатки.Склад КАК Склад',
	'ИЗ',
	'\tВТ_Остатки КАК ВТ_Остатки',
	'',
	'ОБЪЕДИНИТЬ',
	'',
	'ВЫБРАТЬ',
	'\tВТ_Остатки.Склад',
	'ИЗ',
	'\tВТ_Остатки КАК ВТ_Остатки',
	'',
	'ОБЪЕДИНИТЬ ВСЕ',
	'',
	'ВЫБРАТЬ',
	'\tNULL',
	'УПОРЯДОЧИТЬ ПО',
	'\tСклад УБЫВ',
	';',
	'',
	'/'.repeat(80),
	'УНИЧТОЖИТЬ ВТ_Остатки',
].join('\n');

function fixedPoint(text: string): Model {
	const model = parsed(text);
	assert.equal(canonical(model), text);
	assert.ok(api.selfCheck(text).ok);
	assert.equal(api.build(model), text);
	return model;
}

describe('Модель запроса СКД: канон сборки и синтетика', () => {
	test('канон: табуляции, КАК, соединения на две табуляции, И на три, разделитель пакета, ОБЪЕДИНИТЬ между пустыми строками', () => {
		const model = fixedPoint(CANON);
		const [first, second, third] = model.statements;
		assert.deepEqual([first.parts[0].allowed, first.parts[0].distinct, first.parts[0].top], [true, true, 10]);
		assert.deepEqual(first.parts[0].into, { table: 'ВТ_Остатки', mode: 'create' });
		assert.equal(first.parts[0].dcsSelect!.placement, 'afterInto');
		assert.deepEqual(first.parts[0].dcsSelect!.items, [
			{ path: 'Склад', star: true, alias: null },
			{ path: 'Количество', star: false, alias: null },
		]);
		const source = first.parts[0].from[0].source;
		assert.equal(source.virtualTable, 'Остатки');
		assert.deepEqual(source.params, [{ text: '', dcs: { text: '(&Период)', kind: 'whole' } }, { text: 'Склад = &Склад' }]);
		assert.deepEqual(first.parts[0].from[0].joins.map((join) => [join.kind, join.optionalGroup, join.on!.conditions.length]), [
			['left', null, 2],
			['left', 1, 1],
		]);
		assert.deepEqual(first.parts[0].where!.conditions, ['Остатки.КоличествоОстаток > 0', 'Склады.ПометкаУдаления = ЛОЖЬ']);
		assert.deepEqual(first.parts[0].dcsWhere, {
			placement: 'afterWhere',
			items: [
				{ kind: 'fieldStar', path: 'Склады.Организация', alias: 'Организация' },
				{ kind: 'condition', text: 'Склады.Родитель В ИЕРАРХИИ (&Группа)', parens: true, alias: null },
			],
		});
		assert.deepEqual(first.parts[0].having, { conditions: ['СУММА(Остатки.КоличествоОстаток) > 1'] });
		assert.deepEqual(first.indexes, [{ unique: false, fields: ['Склад'] }]);
		assert.deepEqual(second.parts.map((part) => part.unionAll), [null, false, true]);
		assert.deepEqual(second.orderBy, [{ expr: 'Склад', dir: 'desc', hierarchy: false }]);
		assert.deepEqual(third, { type: 'drop', table: 'ВТ_Остатки', original: third.original });
		assert.deepEqual(api.outputFields(second), ['Склад']);
		assert.deepEqual(api.tempTables(model, 0), []);
		assert.deepEqual(api.tempTables(model, 1), [{ name: 'ВТ_Остатки', fields: ['Склад', 'Количество'], statement: 0 }]);
		assert.deepEqual(api.tempTables(model, 2), api.tempTables(model, 1));
		assert.deepEqual(api.tempTables(model, 3), []);
	});

	test('новая модель без исходного текста собирается каноном', () => {
		const model = parsed(CANON);
		for (const statement of model.statements) {
			delete statement.original;
		}
		assert.equal(api.build(model), CANON);
		assert.equal(api.build(model, { eol: '\r\n' }), CANON.replace(/\n/g, '\r\n'));
	});

	test('английские ключевые слова: разбор, сборка на языке текста и перевод', () => {
		const english = canonical(parsed(CANON), { lang: 'en' });
		for (const word of ['SELECT ALLOWED DISTINCT TOP 10', 'INTO ВТ_Остатки', '{SELECT', 'FROM', 'LEFT JOIN', '\t\tON ', '\t\t\tAND ', 'WHERE', '{WHERE', 'GROUP BY', 'HAVING', 'INDEX BY', 'UNION ALL', 'ORDER BY', 'DESC', 'DROP ВТ_Остатки', ' AS ']) {
			assert.ok(english.includes(word), word);
		}
		const model = fixedPoint(english);
		assert.equal(model.lang, 'en');
		assert.equal(canonical(model, { lang: 'ru' }), CANON);
		const handWritten = 'SELECT ALLOWED\n\tT.Ref AS Ref,\n\tU.Code\nFROM\n\tCatalog.Items AS T\n\t\tLEFT OUTER JOIN Catalog.Units AS U\n\t\tON T.Unit = U.Ref\nWHERE\n\tT.DeletionMark = FALSE\n\tAND T.Code <> ""\nORDER BY\n\tRef DESC';
		const parsedEnglish = parsed(handWritten);
		assert.equal(parsedEnglish.lang, 'en');
		assert.equal(parsedEnglish.statements[0].parts[0].from[0].joins[0].kind, 'left');
		assert.deepEqual(parsedEnglish.statements[0].parts[0].where!.conditions, ['T.DeletionMark = FALSE', 'T.Code <> ""']);
		assert.ok(api.selfCheck(handWritten).ok);
		assert.equal(api.build(parsedEnglish), handWritten);
	});

	test('ДОБАВИТЬ во временную таблицу', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tТ.Ссылка КАК Ссылка',
			'ПОМЕСТИТЬ ВТ',
			'ИЗ',
			'\tСправочник.Т КАК Т',
			';',
			'',
			'/'.repeat(80),
			'ВЫБРАТЬ',
			'\tТ2.Ссылка КАК Ссылка',
			'ДОБАВИТЬ ВТ',
			'ИЗ',
			'\tСправочник.Т2 КАК Т2',
		].join('\n');
		const model = fixedPoint(text);
		assert.deepEqual(model.statements[1].parts[0].into, { table: 'ВТ', mode: 'add' });
		assert.deepEqual(api.tempTables(model, 2), [{ name: 'ВТ', fields: ['Ссылка'], statement: 0 }]);
		// ДОБАВИТЬ вне места после списка выборки — обычное слово, а не предложение
		const word = parsed('ВЫБРАТЬ\n\tТ.Добавить КАК Добавить\nИЗ\n\tСправочник.Т КАК Т');
		assert.equal(word.statements[0].parts[0].into, null);
	});

	test('ИНДЕКСИРОВАТЬ ПО НАБОРАМ и УНИКАЛЬНО', () => {
		const head = 'ВЫБРАТЬ\n\tТ.А КАК А,\n\tТ.Б КАК Б,\n\tТ.В КАК В\nПОМЕСТИТЬ ВТ\nИЗ\n\tСправочник.Т КАК Т\n';
		const sets = fixedPoint(head + 'ИНДЕКСИРОВАТЬ ПО НАБОРАМ ((А, Б) УНИКАЛЬНО, (В))');
		assert.deepEqual(sets.statements[0].indexes, [
			{ unique: true, fields: ['А', 'Б'] },
			{ unique: false, fields: ['В'] },
		]);
		const unique = fixedPoint(head + 'ИНДЕКСИРОВАТЬ ПО\n\tА,\n\tБ УНИКАЛЬНО');
		assert.deepEqual(unique.statements[0].indexes, [{ unique: true, fields: ['А', 'Б'] }]);
		// Второй индекс превращает простой список в ПО НАБОРАМ
		const copy = clone(unique);
		copy.statements[0].indexes.push({ unique: false, fields: ['В'] });
		assert.ok(api.build(copy).endsWith('ИНДЕКСИРОВАТЬ ПО НАБОРАМ ((А, Б) УНИКАЛЬНО, (В))'));
	});

	test('СГРУППИРОВАТЬ ПО ГРУППИРУЮЩИМ НАБОРАМ', () => {
		const model = fixedPoint('ВЫБРАТЬ\n\tТ.А КАК А,\n\tТ.Б КАК Б,\n\tСУММА(Т.С) КАК С\nИЗ\n\tСправочник.Т КАК Т\nСГРУППИРОВАТЬ ПО ГРУППИРУЮЩИМ НАБОРАМ ((Т.А, Т.Б), (Т.А), ())');
		assert.deepEqual(model.statements[0].parts[0].groupBy, { items: [], groupingSets: [['Т.А', 'Т.Б'], ['Т.А'], []] });
	});

	test('ИТОГИ: агрегаты, ОБЩИЕ, ИЕРАРХИЯ, ТОЛЬКО ИЕРАРХИЯ, ПЕРИОДАМИ; УПОРЯДОЧИТЬ ПО … ИЕРАРХИЯ', () => {
		const model = fixedPoint([
			'ВЫБРАТЬ',
			'\tТ.Номенклатура КАК Номенклатура,',
			'\tТ.Период КАК Период,',
			'\tТ.СуммаОборот КАК Сумма',
			'ИЗ',
			'\tРегистрНакопления.Т.Обороты(&Начало, &Конец, Месяц, ) КАК Т',
			'УПОРЯДОЧИТЬ ПО',
			'\tНоменклатура ИЕРАРХИЯ,',
			'\tПериод УБЫВ',
			'ИТОГИ',
			'\tСУММА(Сумма) КАК Сумма',
			'ПО',
			'\tОБЩИЕ,',
			'\tНоменклатура ИЕРАРХИЯ,',
			'\tПериод ПЕРИОДАМИ(МЕСЯЦ, &Начало, &Конец),',
			'\tСклад ТОЛЬКО ИЕРАРХИЯ КАК СкладИтог',
		].join('\n'));
		const statement = model.statements[0];
		assert.deepEqual(statement.orderBy, [
			{ expr: 'Номенклатура', dir: 'asc', hierarchy: true },
			{ expr: 'Период', dir: 'desc', hierarchy: false },
		]);
		assert.deepEqual(statement.totals, {
			aggregates: [{ expr: 'СУММА(Сумма)', alias: 'Сумма' }],
			overall: true,
			by: [
				{ expr: 'Номенклатура', mode: 'hierarchy', periods: null, alias: null },
				{ expr: 'Период', mode: 'periods', periods: 'МЕСЯЦ, &Начало, &Конец', alias: null },
				{ expr: 'Склад', mode: 'onlyHierarchy', periods: null, alias: 'СкладИтог' },
			],
		});
		assert.deepEqual(statement.parts[0].from[0].source.params, [{ text: '&Начало' }, { text: '&Конец' }, { text: 'Месяц' }, { text: '' }]);
	});

	test('ДЛЯ ИЗМЕНЕНИЯ: в части (со списком и без) и после УПОРЯДОЧИТЬ', () => {
		const head = 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Т КАК Т\nГДЕ\n\tТ.Ссылка = &Ссылка\n';
		const list = fixedPoint(head + 'ДЛЯ ИЗМЕНЕНИЯ\n\tСправочник.Т');
		assert.deepEqual(list.statements[0].parts[0].forUpdate, ['Справочник.Т']);
		const all = fixedPoint(head + 'ДЛЯ ИЗМЕНЕНИЯ');
		assert.deepEqual(all.statements[0].parts[0].forUpdate, []);
		const late = fixedPoint(head + 'УПОРЯДОЧИТЬ ПО\n\tСсылка\nДЛЯ ИЗМЕНЕНИЯ');
		assert.equal(late.statements[0].parts[0].forUpdate, null);
		assert.deepEqual(late.statements[0].forUpdate, []);
		assert.ok(!api.sameModel(all, parsed(head.trimEnd())));
	});

	test('вложенные скобки {…{…}…} и «база + блок СКД» в параметрах ВТ', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tТ.Ссылка КАК Ссылка,',
			'\tОстатки.КоличествоОстаток КАК Остаток',
			'ИЗ',
			'\tСправочник.Т КАК Т',
			'\t\t{ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.Р.Остатки({(&Период)}, Склад = &Склад {(Склад).* КАК Склад}) КАК Остатки',
			'\t\tПО Т.Ссылка = Остатки.Номенклатура}',
			'{ГДЕ',
			'\tТ.Ссылка.* КАК Номенклатура}',
		].join('\n');
		const model = fixedPoint(text);
		const join = model.statements[0].parts[0].from[0].joins[0];
		assert.equal(join.optionalGroup, 1);
		assert.deepEqual(join.source.params, [
			{ text: '', dcs: { text: '(&Период)', kind: 'whole' } },
			{ text: 'Склад = &Склад', dcs: { text: '(Склад).* КАК Склад', kind: 'tail' } },
		]);
		assert.deepEqual(api.parametersOf(text), ['Период', 'Склад']);
		const tail = fixedPoint('ВЫБРАТЬ\n\tС.Значение КАК Значение\nИЗ\n\tРегистрСведений.С.СрезПоследних(&Дата {(&Дата)}, ) КАК С');
		assert.deepEqual(tail.statements[0].parts[0].from[0].source.params, [{ text: '&Дата', dcs: { text: '(&Дата)', kind: 'tail' } }, { text: '' }]);
		// Частичные скобки, которые не «база + блок», остаются текстом параметра
		const partial = fixedPoint('ВЫБРАТЬ\n\tС.Значение КАК Значение\nИЗ\n\tРегистрСведений.С.СрезПоследних(, {А = &А} {Б = &Б}) КАК С');
		assert.deepEqual(partial.statements[0].parts[0].from[0].source.params, [{ text: '' }, { text: '{А = &А} {Б = &Б}' }]);
	});

	test('{ХАРАКТЕРИСТИКИ} и прочие блоки хранятся текстом на своём месте', () => {
		const block = '{ХАРАКТЕРИСТИКИ\n\tТИП(Справочник.Т)\n\tВИДЫХАРАКТЕРИСТИК ПланВидовХарактеристик.Свойства\n\tПОЛЕКЛЮЧА Ссылка\n\tПОЛЕИМЕНИ Наименование}';
		const model = fixedPoint('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Т КАК Т\n' + block);
		assert.deepEqual(model.statements[0].parts[0].raw, [{ placement: 'afterFrom', kind: 'characteristics', text: block }]);
		// Добавленное ГДЕ не сдвигает блок: он остаётся после ИЗ
		const copy = clone(model);
		copy.statements[0].parts[0].where = { conditions: ['ИСТИНА'] };
		assert.ok(api.build(copy).endsWith(block + '\nГДЕ\n\tИСТИНА'));
	});

	test('выражения хранятся срезом: многострочный ВЫБОР и строковый литерал с переводом строки не меняются', () => {
		const text = [
			'ВЫБРАТЬ',
			'\t\tВЫБОР',
			'\t\t\tКОГДА Т.А = 1',
			'\t\t\t\tТОГДА "строка',
			'\t\tс переводом"',
			'\t\t\tИНАЧЕ 0',
			'\t\tКОНЕЦ КАК Поле',
			'ИЗ',
			'\tСправочник.Т КАК Т',
		].join('\n');
		const model = parsed(text);
		assert.equal(model.statements[0].parts[0].fields[0].expr, 'ВЫБОР\n\tКОГДА Т.А = 1\n\t\tТОГДА "строка\n\t\tс переводом"\n\tИНАЧЕ 0\nКОНЕЦ');
		const built = canonical(model);
		assert.ok(built.includes('\tВЫБОР\n\t\tКОГДА Т.А = 1\n\t\t\tТОГДА "строка\n\t\tс переводом"\n\t\tИНАЧЕ 0\n\tКОНЕЦ КАК Поле'));
		assert.equal(canonical(parsed(built)), built);
	});
});

describe('Модель запроса СКД: комментарии', () => {
	const text = [
		'// ведущий комментарий пакета',
		'ВЫБРАТЬ',
		'\tТ.А КАК А, // хвост поля',
		'\tТ.Б КАК Б',
		'ПОМЕСТИТЬ ВТ',
		'ИЗ',
		'\tСправочник.Т КАК Т',
		';',
		'',
		'/'.repeat(80),
		'// пояснение ко второму запросу',
		'ВЫБРАТЬ',
		'\tВТ.А КАК А,',
		'\t// поле Б',
		'\tВТ.Б КАК Б,',
		'\tВЫБОР // внутри выражения',
		'\t\tКОГДА ВТ.А = 1 ТОГДА 1',
		'\t\tИНАЧЕ 0',
		'\tКОНЕЦ КАК В',
		'ИЗ',
		'\tВТ КАК ВТ',
	].join('\n');

	test('разделители пакета не считаются, настоящие — считаются', () => {
		const model = parsed(text);
		assert.equal(model.comments.total, 5);
		assert.equal(api.build(model), text);
		assert.equal(model.comments.dropped, 0);
	});

	test('теряются только комментарии между элементами изменённого запроса', () => {
		const second = rebuild(text, (model) => {
			model.statements[1].parts[0].fields.push({ expr: 'ИСТИНА', alias: 'Г' });
		});
		// Комментарий внутри выражения живёт в его срезе, пояснение — в разделителе перед запросом
		assert.equal(api.buildWithReport(second.model).comments.dropped, 1);
		assert.ok(second.out.includes('// внутри выражения') && second.out.includes('// пояснение ко второму запросу'));
		assert.ok(!second.out.includes('// поле Б'));
		const first = clone(parsed(text));
		first.statements[0].parts[0].fields[0].alias = 'А1';
		api.build(first);
		assert.equal(first.comments.dropped, 1);
		const removed = clone(parsed(text));
		removed.statements.shift();
		assert.equal(api.buildWithReport(removed).comments.dropped, 3);
	});
});

describe('Модель запроса СКД: помощники UI', () => {
	test('outputFields: псевдоним, последний сегмент пути, null у выражения без псевдонима', () => {
		const model = parsed('ВЫБРАТЬ\n\tТ.А,\n\tТ.Б.В,\n\tТ.Г КАК Д,\n\t1,\n\tТ.*\nИЗ\n\tСправочник.Т КАК Т');
		assert.deepEqual(api.outputFields(model.statements[0]), ['А', 'В', 'Д', null, null]);
	});

	test('tempTables: созданные раньше и не уничтоженные, поля — по первой части', () => {
		const text = [
			'ВЫБРАТЬ 1 КАК А ПОМЕСТИТЬ ВТ1',
			';',
			'ВЫБРАТЬ 2 КАК Б, 3 КАК В ПОМЕСТИТЬ ВТ2',
			';',
			'УНИЧТОЖИТЬ ВТ1',
			';',
			'ВЫБРАТЬ ВТ2.Б ИЗ ВТ2 КАК ВТ2',
		].join('\n');
		const model = parsed(text);
		assert.deepEqual(api.tempTables(model, 0), []);
		assert.deepEqual(api.tempTables(model, 2).map((t) => [t.name, t.fields]), [['ВТ1', ['А']], ['ВТ2', ['Б', 'В']]]);
		assert.deepEqual(api.tempTables(model, 3).map((t) => t.name), ['ВТ2']);
		const big = corpus.map((query) => parsed(query.text)).find((m) => m.statements.length > 10)!;
		const created = big.statements.filter((s) => s.type === 'select' && s.parts[0].into).map((s) => s.parts[0].into!.table);
		assert.deepEqual(api.tempTables(big, big.statements.length).map((t) => t.name), created);
	});

	test('parametersOf: все &-имена, включая {…}, без строк, комментариев и повторов', () => {
		const text = 'ВЫБРАТЬ &А, "&Б" КАК Б ИЗ Справочник.Т КАК Т {ГДЕ (Т.Х = &В)} // &Г\nГДЕ Т.Y = &а И Т.Z В ИЕРАРХИИ(&Д)';
		assert.deepEqual(api.parametersOf(text), ['А', 'В', 'Д']);
		const osv = corpus.find((query) => query.text.includes('ОстаткиИОбороты('))!;
		assert.deepEqual(api.parametersOf(osv.text), ['НачалоПериода', 'КонецПериода', 'Счет', 'Организация', 'Валюта']);
	});

	test('defaultFieldAlias: сегменты после алиаса, агрегат, выражение, суффикс повтора', () => {
		assert.equal(api.defaultFieldAlias('Т.Поле'), 'Поле');
		assert.equal(api.defaultFieldAlias('Т.Контрагент.ИНН'), 'КонтрагентИНН');
		assert.equal(api.defaultFieldAlias('СУММА(Т.Количество)'), 'Количество');
		assert.equal(api.defaultFieldAlias('КОЛИЧЕСТВО(РАЗЛИЧНЫЕ Т.Ссылка)'), 'Ссылка');
		assert.equal(api.defaultFieldAlias('Т.Поле', ['Поле']), 'Поле1');
		assert.equal(api.defaultFieldAlias('Т.Поле', ['поле', 'Поле1']), 'Поле2');
		assert.equal(api.defaultFieldAlias('Т.А + Т.Б'), 'Поле1');
		assert.equal(api.defaultFieldAlias('ИСТИНА', ['Поле1']), 'Поле2');
	});

	test('defaultTableAlias: объект, ТЧ, ВТ регистра, временная таблица, вложенный запрос, повтор', () => {
		assert.equal(api.defaultTableAlias('Справочник.Номенклатура'), 'Номенклатура');
		assert.equal(api.defaultTableAlias('Документ.Счет.Товары'), 'СчетТовары');
		assert.equal(api.defaultTableAlias('РегистрНакопления.ТоварыНаСкладах.Остатки'), 'ТоварыНаСкладахОстатки');
		assert.equal(api.defaultTableAlias('ВТ_Товары'), 'ВТ_Товары');
		assert.equal(api.defaultTableAlias({ kind: 'subquery' }), 'ВложенныйЗапрос');
		assert.equal(api.defaultTableAlias('Справочник.Номенклатура', ['Номенклатура']), 'Номенклатура1');
		// Заведомо сгенерированный конструктором текст корпуса: алиас ВТ по правилу
		const generated = parsed(corpus.find((query) => query.file.startsWith('cfe/'))!.text);
		const source = generated.statements[0].parts[0].from[0].source;
		assert.equal(api.defaultTableAlias(source.table!), source.alias);
	});

	test('renameAliasInText: только голова пути, строки и комментарии не трогаются', () => {
		assert.equal(api.renameAliasInText('Т.А + "Т.Б" + ТТ.В + Т . Г + Т.Т.Т // Т.Д', 'т', 'Х'), 'Х.А + "Т.Б" + ТТ.В + Х . Г + Х.Т.Т // Т.Д');
	});
});

describe('Модель запроса СКД: критерии отбора, последовательности и «Константы»', () => {
	/**
	 * Формы имён таблиц: ожидаемые таблица, виртуальная таблица и тексты параметров источника.
	 * Тексты синтетические, имена объектов — из демо-конфигурации БСП; параметры Границ в корпусе
	 * не встречаются и разбираются так же, как у ВТ регистров.
	 */
	const FORMS: Array<{ text: string; table: string; virtualTable: string | null; params: string[] | null }> = [
		{ text: 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tКритерийОтбора.СвязанныеДокументы(&Значение) КАК Т', table: 'КритерийОтбора.СвязанныеДокументы', virtualTable: null, params: ['&Значение'] },
		{ text: 'SELECT\n\tT.Ref AS Ref\nFROM\n\tFilterCriterion.СвязанныеДокументы(&Value) AS T', table: 'FilterCriterion.СвязанныеДокументы', virtualTable: null, params: ['&Value'] },
		{ text: 'ВЫБРАТЬ\n\tТ.Регистратор КАК Регистратор\nИЗ\n\tПоследовательность._ДемоДвижениеТоваров КАК Т', table: 'Последовательность._ДемоДвижениеТоваров', virtualTable: null, params: null },
		{ text: 'ВЫБРАТЬ\n\tТ.Период КАК Период,\n\tТ.Номенклатура КАК Номенклатура\nИЗ\n\tПоследовательность._ДемоДвижениеТоваров.Границы КАК Т', table: 'Последовательность._ДемоДвижениеТоваров.Границы', virtualTable: 'Границы', params: null },
		{ text: 'ВЫБРАТЬ\n\tТ.Период КАК Период\nИЗ\n\tПоследовательность._ДемоДвижениеТоваров.Границы(&Период) КАК Т', table: 'Последовательность._ДемоДвижениеТоваров.Границы', virtualTable: 'Границы', params: ['&Период'] },
		{ text: 'SELECT\n\tT.Period AS Period\nFROM\n\tSequence._ДемоДвижениеТоваров.Boundaries AS T', table: 'Sequence._ДемоДвижениеТоваров.Boundaries', virtualTable: 'Boundaries', params: null },
		{ text: 'ВЫБРАТЬ\n\tЗначенияКонстант.ВерсияДатЗапретаИзменения КАК Версия\nИЗ\n\tКонстанты КАК ЗначенияКонстант', table: 'Константы', virtualTable: null, params: null },
		{ text: 'SELECT\n\tC.X AS X\nFROM\n\tConstants AS C', table: 'Constants', virtualTable: null, params: null },
	];

	for (const form of FORMS) {
		test(`${form.table}${form.params ? '(…)' : ''}: разбор без диагностики, источник, сборка байт в байт и круг канона`, () => {
			const model = parsed(form.text);
			const source = model.statements[0].parts[0].from[0].source;
			assert.equal(source.table, form.table);
			assert.equal(source.virtualTable, form.virtualTable, 'признак виртуальной таблицы');
			assert.deepEqual(source.params === null || source.params === undefined ? null : source.params.map((param) => param.text), form.params);
			assert.equal(api.build(model), form.text, 'неизменённая модель — исходный текст');
			// Тексты написаны каноном: сборка без сплайса даёт тот же текст, а её разбор — ту же модель
			const lang = /^SELECT/.test(form.text) ? 'en' : 'ru';
			const canon = canonical(model, { lang });
			assert.equal(canon, form.text, 'канон');
			assert.ok(api.sameModel(api.parse(canon).model, model), 'разбор канона — та же модель');
			assert.ok(api.selfCheck(form.text).ok);
		});
	}

	test('критерий отбора без параметров и последовательность без Границ — не виртуальные таблицы', () => {
		const bare = parsed('ВЫБРАТЬ Т.Ссылка ИЗ КритерийОтбора.СвязанныеДокументы КАК Т').statements[0].parts[0].from[0].source;
		assert.equal(bare.virtualTable, null);
		assert.equal(bare.params, null, 'без скобок параметров нет');
		const other = parsed('ВЫБРАТЬ Т.Ссылка ИЗ Последовательность.Х.НеГраницы КАК Т').statements[0].parts[0].from[0].source;
		assert.equal(other.virtualTable, null, 'третий сегмент не из имён ВТ и без параметров — не ВТ');
	});

	test('правка поля в запросе с критерием и Границами: параметры источников переживают пересборку каноном', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tК.Ссылка КАК Ссылка',
			'ИЗ',
			'\tКритерийОтбора.СвязанныеДокументы(&Значение) КАК К',
			'\t\tЛЕВОЕ СОЕДИНЕНИЕ Последовательность._ДемоДвижениеТоваров.Границы КАК Г',
			'\t\tПО К.Ссылка = Г.Регистратор',
		].join('\n');
		const result = rebuild(text, (model) => {
			model.statements[0].parts[0].fields.push({ expr: 'Г.Период', alias: 'Период' });
		});
		assert.ok(result.out.includes('КритерийОтбора.СвязанныеДокументы(&Значение) КАК К'), result.out);
		assert.ok(result.out.includes('Последовательность._ДемоДвижениеТоваров.Границы КАК Г'), result.out);
		const join = result.after.statements[0].parts[0].from[0].joins[0];
		assert.equal(join.source.virtualTable, 'Границы');
		assert.deepEqual(api.parametersOf(result.out), ['Значение']);
	});

	test('defaultTableAlias критерия отбора, Границ и «Константы»: имя объекта, у Границ — склейка, у «Константы» — само имя', () => {
		assert.equal(api.defaultTableAlias('КритерийОтбора.СвязанныеДокументы'), 'СвязанныеДокументы');
		assert.equal(api.defaultTableAlias('Последовательность._ДемоДвижениеТоваров.Границы'), '_ДемоДвижениеТоваровГраницы');
		assert.equal(api.defaultTableAlias('Константы'), 'Константы');
	});

	test('tempTables не принимает чтение «Константы» за созданную временную таблицу', () => {
		const model = parsed('ВЫБРАТЬ К.Х КАК Х ПОМЕСТИТЬ ВТ ИЗ Константы КАК К\n;\nВЫБРАТЬ ВТ.Х ИЗ ВТ КАК ВТ');
		assert.deepEqual(api.tempTables(model, 2).map((table) => table.name), ['ВТ']);
	});
});
