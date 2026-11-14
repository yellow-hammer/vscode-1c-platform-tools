/**
 * Команда агента dcs.query: разбор аргументов, модель запроса хоста — тот же файл
 * dcs-editor-query-model.js, что исполняет webview, — и действия parse/build/apply.
 *
 * Разбор и сборка проверяются на корпусе запросов БСП 3.1 (queries-ssl31.json), запись — через
 * dcsQueryApply с подделкой ввода-вывода: правила пакета те же, что у ОК конструктора (канал query).
 * Запуск: npm run compile && node --test out/test/metadata/dcsQueryCommand.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	dcsApplyQueryRequestOf,
	dcsBatchProblem,
	dcsDeclaredParameterNames,
	dcsQueryBatchOf,
	dcsQueryDataSetOf,
} from '../../features/metadata/dcsPanelMessages';
import {
	dcsQueryActionOf,
	dcsQueryApply,
	dcsQueryBuild,
	dcsQueryModelFile,
	dcsQueryParse,
	dcsQueryParseDataSet,
	loadDcsQueryModel,
	type DcsQueryAction,
	type DcsQueryIo,
	type DcsQueryRunResult,
} from '../../features/metadata/dcsQueryOps';
import type { MdSparrowParams } from '../../features/metadata/mdSparrowParams';

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const FIXTURES = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs');

const corpus = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'queries-ssl31.json'), 'utf8')) as {
	queries: Array<{ file: string; dataSet: string; text: string }>;
};

/** Модель cf-dcs-info для проверок адресации: набор, объединение с тёзками, объект, параметры. */
const INFO = {
	dataSets: [
		{ name: 'Основной', type: 'query', query: 'ВЫБРАТЬ 1', autoFillFields: false },
		{
			name: 'Регистрация',
			type: 'union',
			items: [
				{ name: 'ОпределениеПолей', type: 'query', query: 'ВЫБРАТЬ 2' },
				{ name: 'Хвост', type: 'union', items: [{ name: 'ОпределениеПолей', type: 'query', query: 'ВЫБРАТЬ 3' }] },
			],
		},
		{ name: 'Объект', type: 'object' },
	],
	parameters: [{ name: 'Период' }, { name: 'Организация' }, { title: 'без имени' }],
};

describe('Команда агента dcs.query: действия и модель запроса хоста', () => {
	const api = loadDcsQueryModel(ROOT);

	test('хост грузит тот же файл модели, что webview, и один раз', () => {
		assert.equal(dcsQueryModelFile(ROOT), path.join(ROOT, 'resources', 'webview', 'dcs-editor-query-model.js'));
		assert.equal(loadDcsQueryModel(ROOT), api, 'повторная загрузка — из памяти');
		for (const name of ['parse', 'buildWithReport', 'selfCheck', 'parametersOf'] as const) {
			assert.equal(typeof api[name], 'function', name);
		}
	});

	test('разбор аргументов: parse по тексту или набору, build по модели, apply — ровно одно из text и model', () => {
		assert.deepEqual(dcsQueryActionOf({ action: 'parse', text: 'ВЫБРАТЬ 1' }), { action: 'parse', text: 'ВЫБРАТЬ 1' });
		assert.deepEqual(dcsQueryActionOf({ action: 'parse', path: 'x', dataSet: 'Регистрация/ОпределениеПолей' }), {
			action: 'parse',
			dataSet: 'Регистрация/ОпределениеПолей',
		});
		assert.deepEqual(dcsQueryActionOf({ action: 'build', model: { statements: [] }, lang: 'en', eol: '\r\n' }), {
			action: 'build',
			model: { statements: [] },
			options: { lang: 'en', eol: '\r\n' },
		});
		const apply = dcsQueryActionOf({ action: 'apply', dataSet: 'Основной', text: 'ВЫБРАТЬ 1', autofill: false });
		assert.deepEqual(apply, { action: 'apply', dataSet: 'Основной', text: 'ВЫБРАТЬ 1', model: undefined, options: {}, autofill: false });
		for (const bad of [
			{},
			{ action: 'run' },
			{ action: 'parse' },
			{ action: 'parse', dataSet: '' },
			{ action: 'build' },
			{ action: 'build', model: [] },
			{ action: 'build', model: {}, lang: 'de' },
			{ action: 'build', model: {}, eol: '\r' },
			{ action: 'apply', text: 'ВЫБРАТЬ 1' },
			{ action: 'apply', dataSet: 'Основной' },
			{ action: 'apply', dataSet: 'Основной', text: 'ВЫБРАТЬ 1', model: {} },
			{ action: 'apply', dataSet: 'Основной', text: 'ВЫБРАТЬ 1', autofill: 'да' },
		]) {
			assert.ok('error' in dcsQueryActionOf(bad), JSON.stringify(bad));
		}
	});

	test('parse → JSON → build: все 47 запросов БСП собираются байт в байт (сплайс по запросам пакета)', () => {
		assert.equal(corpus.queries.length, 47);
		for (const query of corpus.queries) {
			const parsed = dcsQueryParse(api, query.text);
			assert.equal(parsed.selfCheck.ok, true, `${query.file}: самопроверка`);
			assert.deepEqual(parsed.diagnostics, [], query.file);
			// Агент получает модель JSON-ом и возвращает её JSON-ом: круг не должен ничего терять
			const model = JSON.parse(JSON.stringify(parsed.model)) as Record<string, unknown>;
			const built = dcsQueryBuild(api, model, {});
			assert.ok('text' in built, query.file);
			assert.equal(built.text, query.text, `${query.file}: сборка неизменённой модели`);
		}
	});

	test('build по изменённой модели — канон, язык и перевод строки по опциям', () => {
		const parsed = dcsQueryParse(api, 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Т');
		const model = JSON.parse(JSON.stringify(parsed.model)) as { statements: Array<{ parts: Array<{ distinct: boolean }> }> };
		model.statements[0].parts[0].distinct = true;
		const built = dcsQueryBuild(api, model, { eol: '\r\n' });
		assert.ok('text' in built);
		assert.match(built.text, /^ВЫБРАТЬ РАЗЛИЧНЫЕ\r\n\tТ\.Ссылка КАК Ссылка\r\nИЗ\r\n\tСправочник\.Валюты КАК Т$/);
		const english = dcsQueryBuild(api, model, { lang: 'en' });
		assert.ok('text' in english);
		assert.match(english.text, /^SELECT DISTINCT\n/);
	});

	test('сломанная модель от агента — отказ с причиной, а не исключение', () => {
		const built = dcsQueryBuild(api, { statements: 'не список' }, {});
		if ('error' in built) {
			assert.match(built.error, /^Модель запроса не собрана: /);
		} else {
			assert.equal(typeof built.text, 'string', 'сборщик терпим к мусору — отдал строку');
		}
		const nullModel = dcsQueryBuild(api, null, {});
		assert.ok('error' in nullModel || typeof nullModel.text === 'string');
	});

	test('parse: Границы последовательности — виртуальная таблица, критерий отбора — таблица с параметром; JSON-круг байт в байт', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tГ.Регистратор КАК Регистратор,',
			'\tК.Ссылка КАК Ссылка',
			'ИЗ',
			'\tПоследовательность._ДемоДвижениеТоваров.Границы КАК Г',
			'\t\tВНУТРЕННЕЕ СОЕДИНЕНИЕ КритерийОтбора.СвязанныеДокументы(&Значение) КАК К',
			'\t\tПО Г.Регистратор = К.Ссылка',
		].join('\n');
		const parsed = dcsQueryParse(api, text);
		assert.deepEqual(parsed.diagnostics, []);
		assert.equal(parsed.selfCheck.ok, true);
		type Source = { table: string; virtualTable: string | null; params: Array<{ text: string }> | null };
		const model = JSON.parse(JSON.stringify(parsed.model)) as { statements: Array<{ parts: Array<{ from: Array<{ source: Source; joins: Array<{ source: Source }> }> }> }> };
		const entry = model.statements[0].parts[0].from[0];
		assert.deepEqual([entry.source.table, entry.source.virtualTable, entry.source.params], ['Последовательность._ДемоДвижениеТоваров.Границы', 'Границы', null]);
		const criterion = entry.joins[0].source;
		assert.equal(criterion.virtualTable, null, 'у критерия сегмента ВТ нет — признак таблицы с параметром у него params');
		assert.deepEqual(criterion.params?.map((param) => param.text), ['&Значение']);
		const built = dcsQueryBuild(api, model, {});
		assert.ok('text' in built);
		assert.equal(built.text, text);
		const english = dcsQueryParse(api, 'SELECT\n\tB.Period AS Period\nFROM\n\tSequence._ДемоДвижениеТоваров.Boundaries AS B');
		const englishSource = (english.model as unknown as typeof model).statements[0].parts[0].from[0].source;
		assert.equal(englishSource.virtualTable, 'Boundaries');
	});

	test('parse: общая таблица «Константы» — однословный источник без ВТ и параметров, как описано агенту; JSON-круг байт в байт', () => {
		// Агент отличает её от временной таблицы пакета только по имени (описание dcs.query), поэтому модель
		// не должна навешивать на неё ни virtualTable, ни params — иначе агент принял бы её за ВТ
		type Source = { kind: string; table: string; virtualTable: string | null; params: unknown };
		type Model = { statements: Array<{ parts: Array<{ from: Array<{ source: Source }> }> }> };
		for (const text of [
			'ВЫБРАТЬ\n\tК._ДемоОсновнаяОрганизация КАК Организация\nИЗ\n\tКонстанты КАК К',
			'SELECT\n\tC._ДемоОсновнаяОрганизация AS Company\nFROM\n\tConstants AS C',
		]) {
			const parsed = dcsQueryParse(api, text);
			assert.deepEqual(parsed.diagnostics, [], text);
			assert.equal(parsed.selfCheck.ok, true, text);
			const model = JSON.parse(JSON.stringify(parsed.model)) as Model;
			const source = model.statements[0].parts[0].from[0].source;
			assert.deepEqual([source.kind, source.virtualTable, source.params], ['table', null, null], text);
			assert.ok(['Константы', 'Constants'].includes(source.table), text);
			const built = dcsQueryBuild(api, model, {});
			assert.ok('text' in built);
			assert.equal(built.text, text);
		}
	});

	test('недостающие параметры для apply — параметры текста минус объявленные, без учёта регистра', () => {
		const text = 'ВЫБРАТЬ * ИЗ РегистрСведений.Цены.СрезПоследних(&период, {(&Склад)}) ГДЕ Т.Организация = &ОРГАНИЗАЦИЯ И &Склад';
		const batch = dcsQueryBatchOf(
			{ dataSet: 'Основной', text, addParameters: api.parametersOf(text), autofill: true },
			dcsDeclaredParameterNames(INFO)
		);
		assert.deepEqual(batch.addedParameters, ['Склад']);
		assert.equal(dcsBatchProblem('query', batch.mutations), undefined);
	});
});

describe('Команда агента dcs.query: parse набора и apply через канал пакета (ввод-вывод подделкой)', () => {
	const api = loadDcsQueryModel(ROOT);

	/** Схема в памяти: пакет «применяется» к копии модели, как перечитка после записи. */
	function fakeIo(options: { fail?: DcsQueryRunResult } = {}): DcsQueryIo & { batches: MdSparrowParams[]; reads: () => number } {
		let info = JSON.parse(JSON.stringify(INFO)) as typeof INFO;
		let reads = 0;
		const batches: MdSparrowParams[] = [];
		return {
			batches,
			reads: () => reads,
			readInfo: async () => {
				reads += 1;
				return { json: JSON.parse(JSON.stringify(info)) as unknown };
			},
			runBatch: async (params) => {
				batches.push(params);
				if (options.fail) {
					return options.fail;
				}
				const next = JSON.parse(JSON.stringify(info)) as typeof INFO;
				const answers: string[] = [];
				for (const operation of params.operations ?? []) {
					if (operation.op === 'cf-dcs-set-query') {
						const target = dcsQueryDataSetOf(next, operation.tag ?? '');
						if (target) {
							target.query = operation.payloadJson ?? '';
						}
						answers.push('');
					} else if (operation.op === 'cf-dcs-add-parameter') {
						next.parameters.push({ name: (JSON.parse(operation.payloadJson ?? '{}') as { name: string }).name });
						answers.push('');
					} else {
						answers.push(JSON.stringify({ added: ['Поле1'], skipped: [] }));
					}
				}
				info = next;
				return { exitCode: 0, stdout: JSON.stringify(answers), stderr: '' };
			},
			errorText: (result) => `отказ: ${result.stderr}`,
		};
	}

	const ADDRESS = { objectXml: 'C:/x/Template.xml', schemaVersion: 'V2_20' };

	function applyAction(fields: Record<string, unknown>): Extract<DcsQueryAction, { action: 'apply' }> {
		const action = dcsQueryActionOf({ action: 'apply', ...fields });
		assert.ok(!('error' in action) && action.action === 'apply', JSON.stringify(action));
		return action as Extract<DcsQueryAction, { action: 'apply' }>;
	}

	test('parse набора: текст по пути из свежей модели и его разбор; объединение — отказ', async () => {
		const io = fakeIo();
		const parsed = await dcsQueryParseDataSet(api, io, 'Регистрация/Хвост/ОпределениеПолей');
		assert.ok('data' in parsed);
		assert.equal(parsed.data.text, 'ВЫБРАТЬ 3');
		assert.equal(parsed.data.selfCheck.ok, true);
		const union = await dcsQueryParseDataSet(api, io, 'Регистрация');
		assert.ok('error' in union && /объединение/.test(union.error));
	});

	test('apply текстом: недостающие параметры без учёта регистра, автозаполнение — по признаку набора', async () => {
		const io = fakeIo();
		const outcome = await dcsQueryApply(
			api,
			io,
			applyAction({ dataSet: 'Основной', text: 'ВЫБРАТЬ &ПЕРИОД, &Склад, &склад' }),
			ADDRESS
		);
		assert.ok('data' in outcome, JSON.stringify(outcome));
		assert.deepEqual(outcome.data.addedParameters, ['Склад']);
		assert.equal(io.batches.length, 1);
		assert.deepEqual(
			io.batches[0].operations?.map((operation) => operation.op),
			['cf-dcs-set-query', 'cf-dcs-add-parameter'],
			'у набора autoFillFields: false — автозаполнения нет'
		);
		assert.ok(io.batches[0].operations?.every((operation) => operation.objectXml === ADDRESS.objectXml));
		const model = outcome.data.model as typeof INFO;
		assert.deepEqual(model.parameters.map((parameter) => parameter.name), ['Период', 'Организация', undefined, 'Склад']);
	});

	test('apply моделью во вложенный набор: сборка, автозаполнение по умолчанию и его итог', async () => {
		const io = fakeIo();
		const parsed = dcsQueryParse(api, 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Т');
		const model = JSON.parse(JSON.stringify(parsed.model)) as { statements: Array<{ parts: Array<{ where: unknown }> }> };
		model.statements[0].parts[0].where = { conditions: ['Т.Код = &Код'] };
		const outcome = await dcsQueryApply(api, io, applyAction({ dataSet: 'Регистрация/ОпределениеПолей', model }), ADDRESS);
		assert.ok('data' in outcome, JSON.stringify(outcome));
		assert.match(outcome.data.text, /ГДЕ\n\tТ\.Код = &Код$/);
		assert.deepEqual(outcome.data.addedParameters, ['Код']);
		assert.deepEqual(outcome.data.autofill, { added: ['Поле1'], skipped: [] });
		assert.deepEqual(
			io.batches[0].operations?.map((operation) => [operation.op, operation.tag ?? operation.dataSet ?? '']),
			[
				['cf-dcs-set-query', 'Регистрация/ОпределениеПолей'],
				['cf-dcs-add-parameter', ''],
				['cf-dcs-autofill-fields', 'Регистрация/ОпределениеПолей'],
			]
		);
	});

	test('текст не изменился и параметры объявлены — записи нет', async () => {
		const io = fakeIo();
		const outcome = await dcsQueryApply(api, io, applyAction({ dataSet: 'Основной', text: 'ВЫБРАТЬ 1', autofill: true }), ADDRESS);
		assert.ok('data' in outcome);
		assert.equal(outcome.data.unchanged, true);
		assert.equal(io.batches.length, 0);
	});

	test('отказы: объединение и чужой набор — до jar; отказ jar — с кодом, без перечитки', async () => {
		const io = fakeIo();
		const union = await dcsQueryApply(api, io, applyAction({ dataSet: 'Регистрация', text: 'ВЫБРАТЬ 9' }), ADDRESS);
		assert.ok('error' in union && /объединение/.test(union.error));
		const object = await dcsQueryApply(api, io, applyAction({ dataSet: 'Объект', text: 'ВЫБРАТЬ 9' }), ADDRESS);
		assert.ok('error' in object && /не набор-запрос/.test(object.error));
		assert.equal(io.batches.length, 0);
		const refused = fakeIo({ fail: { exitCode: 2, stdout: '', stderr: 'Операция 2 (cf-dcs-add-parameter): параметр уже есть' } });
		const outcome = await dcsQueryApply(api, refused, applyAction({ dataSet: 'Основной', text: 'ВЫБРАТЬ &Новый' }), ADDRESS);
		assert.deepEqual(outcome, { error: 'отказ: Операция 2 (cf-dcs-add-parameter): параметр уже есть', exitCode: 2 });
		assert.equal(refused.reads(), 1, 'после отказа схема не перечитывается');
	});
});

describe('Команда агента dcs.query: комментарии и пустой текст', () => {
	const api = loadDcsQueryModel(ROOT);
	const TEXT = 'ВЫБРАТЬ\n\t// важный комментарий\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Т';

	test('build изменённой модели сообщает, сколько комментариев пропало; неизменённой — ноль без предупреждения', () => {
		const parsed = dcsQueryParse(api, TEXT);
		const same = dcsQueryBuild(api, JSON.parse(JSON.stringify(parsed.model)), {});
		assert.ok('text' in same);
		assert.equal(same.text, TEXT);
		assert.deepEqual(same.comments, { total: 1, dropped: 0 });
		assert.equal(same.warning, undefined);
		const model = JSON.parse(JSON.stringify(parsed.model)) as { statements: Array<{ parts: Array<{ fields: Array<{ alias: string }> }> }> };
		model.statements[0].parts[0].fields[0].alias = 'Ссылка2';
		const changed = dcsQueryBuild(api, model, {});
		assert.ok('text' in changed);
		assert.ok(!changed.text.includes('важный комментарий'));
		assert.deepEqual(changed.comments, { total: 1, dropped: 1 });
		assert.match(changed.warning ?? '', /комментарии \(1\)/);
	});

	test('пустой текст apply — понятный отказ до jar; сообщение dcs/apply-query панели с пустым текстом разбирается', async () => {
		let runs = 0;
		const io: DcsQueryIo = {
			readInfo: async () => ({ json: JSON.parse(JSON.stringify(INFO)) as unknown }),
			runBatch: async () => {
				runs += 1;
				return { exitCode: 0, stdout: '[]', stderr: '' };
			},
			errorText: (result) => result.stderr,
		};
		for (const text of ['', '  \n\t']) {
			const action = dcsQueryActionOf({ action: 'apply', dataSet: 'Основной', text });
			assert.ok(!('error' in action) && action.action === 'apply');
			const outcome = await dcsQueryApply(api, io, action as Extract<DcsQueryAction, { action: 'apply' }>, { objectXml: 'C:/x/Template.xml', schemaVersion: 'V2_20' });
			assert.ok('error' in outcome && /текст запроса пуст/.test(outcome.error), JSON.stringify(outcome));
		}
		assert.equal(runs, 0, 'jar не запускался');
		const panel = dcsApplyQueryRequestOf({ type: 'dcs/apply-query', dataSet: 'Основной', text: '' });
		assert.ok(!('error' in panel), 'сообщение панели с пустым текстом разбирается');
	});

	test('apply моделью с потерей комментариев: запись идёт, в ответе comments и предупреждение', async () => {
		const info = { dataSets: [{ name: 'Основной', type: 'query', query: TEXT, autoFillFields: false }], parameters: [] };
		const io: DcsQueryIo = {
			readInfo: async () => ({ json: JSON.parse(JSON.stringify(info)) as unknown }),
			runBatch: async () => ({ exitCode: 0, stdout: JSON.stringify(['']), stderr: '' }),
			errorText: (result) => result.stderr,
		};
		const model = JSON.parse(JSON.stringify(dcsQueryParse(api, TEXT).model)) as { statements: Array<{ parts: Array<{ distinct: boolean }> }> };
		model.statements[0].parts[0].distinct = true;
		const action = dcsQueryActionOf({ action: 'apply', dataSet: 'Основной', model });
		assert.ok(!('error' in action) && action.action === 'apply');
		const outcome = await dcsQueryApply(api, io, action as Extract<DcsQueryAction, { action: 'apply' }>, { objectXml: 'C:/x/Template.xml', schemaVersion: 'V2_20' });
		assert.ok('data' in outcome);
		assert.deepEqual(outcome.data.comments, { total: 1, dropped: 1 });
		assert.match(outcome.warning ?? '', /без комментариев.*\(1\)/);
	});
});
