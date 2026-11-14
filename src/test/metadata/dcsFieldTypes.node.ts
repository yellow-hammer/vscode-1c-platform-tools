/**
 * Уровень «через точку» подсказки редактора СКД: чистые функции dcs-editor-field-types.js (дети по
 * типу, вывод типов полей наборов-запросов) вместе с каталогом dcs-editor-complete.js и разборщиком
 * dcs-editor-query-model.js, плюс разбор сообщения dcs/describe-type и поиск файла объекта панелью.
 *
 * Файлы webview исполняются в песочнице node:vm, как в dcsComplete.node.ts. Описания объектов —
 * замороженные ответы cf-md-query-tables (src/test/fixtures/dcs/query-tables-ssl31.json), модели
 * схем — complete-models.json, запросы — queries-ssl31.json (см. README фикстур).
 * Запуск: npm run compile && node --test out/test/metadata/dcsFieldTypes.node.js
 * Бюджет времени проверяется только с переменной DCS_PERF_BUDGET=1.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { resolveDcsDescribeTarget } from '../../features/metadata/dcsTargets';
import { readEditorScript } from '../fixtures/helpers/dcsEditorScript';
import {
	DCS_DESCRIBE_TYPE_MESSAGE,
	dcsDescribeRequestOf,
	dcsMutationOf,
	type DcsPanelMessage,
} from '../../features/metadata/dcsPanelMessages';

interface Composition {
	source: string;
	name?: string;
	types: string[];
	typeSets: string[];
}

interface TypeDto {
	types: string[];
	typeSets: string[];
	typeIds?: string[];
	compositions?: Composition[];
}

interface QueryField {
	name: string;
	nameEn?: string;
	kind?: string;
	type: TypeDto | null;
	synonym?: string;
}

interface QueryTable {
	name: string;
	kind: string;
	fields: QueryField[];
}

interface Description {
	object: string;
	kind: string;
	tables: QueryTable[];
	typeCompositions?: Composition[];
}

interface Pending {
	key: string;
	request: { typeName?: string; queryTable?: string; lang?: 'en' };
}

interface ChildRow {
	name: string;
	kind: string;
	title: string;
	typeText: string;
	valueType: TypeDto | null;
	expandable: boolean;
	nameEn?: string;
}

type Lookup = (key: string) => Description | null | undefined;

interface CatalogNode {
	name: string;
	path: string;
	kind: string;
	children: CatalogNode[];
	valueType: TypeDto | null;
	expandable?: boolean;
}

interface Catalog {
	nodes: CatalogNode[];
	params: CatalogNode[];
}

type ExtraChildren = (owner: CatalogNode | null, parentPath: string, info: { mode: string; chain: CatalogNode[] }) => ChildRow[];

interface CompleteApi {
	buildCatalog(model: unknown, settings: unknown, scope: string): Catalog;
	childrenOf(catalog: Catalog, ctx: { mode: string; parentPath: string } | string, extra?: ExtraChildren): CatalogNode[];
	kindLetter(item: Partial<CatalogNode>): string;
}

interface Env {
	model: unknown;
	scope: string;
	lookup: Lookup;
	queryModel: unknown;
	typeText?: (dto: TypeDto) => string;
}

interface FieldTypesApi {
	OBJECT_KINDS: Array<{ ru: string; en: string; ref: string }>;
	MAX_UNION_REFS: number;
	refObjectOf(typeName: string, lang?: 'ru' | 'en'): { object: string; key: string; request: { typeName: string; lang?: 'en' } } | null;
	tableObjectOf(name: string, lang?: 'ru' | 'en'): { object: string; key: string; tail: string[]; request: { queryTable: string; lang?: 'en' } } | null;
	isConstantsTable(name: string): boolean;
	constantColumnTable(name: string, column: string): { table: string; lang: 'ru' | 'en'; field: string } | null;
	answerKeyOf(message: unknown): string;
	findTable(description: Description | null, tail: string[]): QueryTable | null;
	findField(table: QueryTable | null, name: string): QueryField | null;
	mergeTypes(dtos: Array<TypeDto | null>): TypeDto | null;
	attachTypeCompositions<T>(answer: T): T;
	expandedTypes(dto: TypeDto | null): { types: string[]; typeSets: string[]; typeIds: string[] };
	refTypeNames(dto: TypeDto | null): string[];
	expandable(dto: TypeDto | null): boolean;
	typeChildren(dto: TypeDto | null, lookup: Lookup, options?: { typeText?: (dto: TypeDto) => string }): { children: ChildRow[]; pending: Pending[] };
	walkType(dto: TypeDto | null, segments: string[], lookup: Lookup): { type: TypeDto | null; pending: Pending[] };
	classifyExpression(expr: string): { kind: string; path?: string; type?: TypeDto };
	valueShape(expr: string): { kind: string; type?: TypeDto; parts?: string[]; operands?: string[] };
	queryColumnType(text: string, column: string, lookup: Lookup, options: { queryModel: unknown }): { type: TypeDto | null; pending: Pending[] };
	batchColumnType(batch: unknown, statementIndex: number, column: string, lookup: Lookup, options: { queryModel: unknown }): { type: TypeDto | null; pending: Pending[] };
	partExpressionType(
		batch: unknown,
		statementIndex: number,
		part: unknown,
		expr: string,
		lookup: Lookup,
		options: { queryModel: unknown; outerTemp?: unknown[] } | null
	): { type: TypeDto | null; pending: Pending[] };
	subqueryColumnType(
		batch: unknown,
		statementIndex: number,
		subquery: unknown,
		column: string,
		lookup: Lookup,
		options: { queryModel: unknown; outerTemp?: unknown[] } | null
	): { type: TypeDto | null; pending: Pending[] };
	dataSetFieldType(
		model: unknown,
		dataPath: string,
		lookup: Lookup,
		options: { queryModel: unknown; dataSet?: string; fieldIndex?: Map<unknown, unknown> }
	): { type: TypeDto | null; pending: Pending[] };
	resourceFieldType(
		model: unknown,
		path: string,
		kind: string,
		lookup: Lookup,
		options: { queryModel: unknown } | null
	): { state: 'known' | 'waiting' | 'unknown'; type: TypeDto | null; pending: Pending[] };
	numericKind(dto: unknown): 'numeric' | 'other' | 'mixed' | 'unknown';
	scopeDataSets(scope: string): string[] | null;
	extraChildrenFor(info: { mode: string; chain: CatalogNode[] }, parentPath: string, env: Env): { children: ChildRow[]; pending: Pending[] };
}

interface QueryModelApi {
	parse(text: string): { model: { statements: Array<{ type: string; parts?: Array<{ into: unknown }> }> }; diagnostics: unknown[] };
	outputFields(statement: unknown): Array<string | null>;
}

interface SchemaFixture {
	info: {
		dataSets: Array<{ name: string; query?: string; fields?: Array<{ dataPath: string }> }>;
		parameters: Array<{ name: string }>;
	};
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'resources', 'webview');
const FIXTURES = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs');

/**
 * Исполняет файл webview в текущем realm и возвращает его module.exports: объекты из чужого
 * realm не проходят deepStrictEqual (другой Object.prototype).
 */
function loadModule<T>(file: string): T {
	const code = fs.readFileSync(file, 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: file }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	return moduleShim.exports as T;
}

function readJson<T>(name: string): T {
	return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}

const types = loadModule<FieldTypesApi>(path.join(WEBVIEW, 'dcs-editor-field-types.js'));
const complete = loadModule<CompleteApi>(path.join(WEBVIEW, 'dcs-editor-complete.js'));
const queryModel = loadModule<QueryModelApi>(path.join(WEBVIEW, 'dcs-editor-query-model.js'));

const tables = readJson<{ objects: Record<string, { file: string; description: Description }> }>('query-tables-ssl31.json');
const schemas = readJson<Record<string, SchemaFixture>>('complete-models.json');
const corpus = readJson<{ queries: Array<{ file: string; dataSet: string; text: string }> }>('queries-ssl31.json');

const CHECKS = schemas['РезультатыПроверкиУчета'].info;
const UNIONS = schemas['ВыгрузкаЗагрузкаEnterpriseData'].info;
const FOLDER = schemas['ДанныеПечатиОбщиеРеквизиты'].info;
const USERS = schemas['ПользователиПоПодразделениям'].info;

const DESCRIPTIONS = new Map(Object.entries(tables.objects).map(([name, entry]) => [name.toUpperCase(), entry.description]));

/** Кэш webview после ответов на всё, что есть в фикстуре: прочих объектов «нет» (как вне выгрузки). */
const loaded: Lookup = (key) => DESCRIPTIONS.get(key) ?? null;
/** Пустой кэш: ничего ещё не загружено. */
const nothing: Lookup = () => undefined;

function description(name: string): Description {
	const found = DESCRIPTIONS.get(name.toUpperCase());
	assert.ok(found, `в фикстуре нет ${name}`);
	return found;
}

function names(rows: Array<{ name: string }>): string[] {
	return rows.map((row) => row.name);
}

function ref(typeName: string): TypeDto {
	return { types: [typeName], typeSets: [], typeIds: [] };
}

function mainFields(name: string): string[] {
	const table = types.findTable(description(name), []);
	assert.ok(table, `у ${name} нет основной таблицы`);
	return names(table.fields);
}

/** Точка расширения подсказки для места ввода — как её строит обвязка webview. */
function provider(model: unknown, scope: string, lookup: Lookup = loaded): ExtraChildren {
	return (_owner, parentPath, info) => types.extraChildrenFor(info, parentPath, { model, scope, lookup, queryModel }).children;
}

function childPaths(model: unknown, scope: string, parentPath: string, mode: 'path' | 'param' = 'path'): string[] {
	const catalog = complete.buildCatalog(model, null, scope);
	return names(complete.childrenOf(catalog, { mode, parentPath }, provider(model, scope)));
}

function lastSelect(text: string): unknown {
	const parsed = queryModel.parse(text);
	const statements = parsed.model.statements;
	for (let i = statements.length - 1; i >= 0; i -= 1) {
		const statement = statements[i];
		if (statement.type === 'select' && !(statement.parts ?? []).some((part) => part.into)) {
			return statement;
		}
	}
	return null;
}

describe('Через точку: фикстура описаний объектов', () => {
	test('19 объектов тринадцати видов (с критерием отбора и последовательностью), у каждого основная таблица', () => {
		const kinds = new Set(Object.values(tables.objects).map((entry) => entry.description.kind));
		assert.equal(Object.keys(tables.objects).length, 19);
		assert.ok(kinds.size >= 13, `видов ${kinds.size}: ${[...kinds].join(', ')}`);
		assert.ok(kinds.has('filterCriterion') && kinds.has('sequence'), 'критерий отбора и последовательность');
		for (const [name, entry] of Object.entries(tables.objects)) {
			assert.equal(entry.description.object, name);
			assert.ok(types.findTable(entry.description, []), `${name}: нет основной таблицы`);
		}
	});

	test('стандартные реквизиты — русскими именами, английские — в nameEn', () => {
		const users = types.findTable(description('Справочник.Пользователи'), []);
		const reference = types.findField(users, 'Ссылка');
		assert.equal(reference?.nameEn, 'Ref');
		assert.deepEqual(reference?.type?.types, ['cfg:CatalogRef.Пользователи']);
		// Английский запрос пишет стандартные реквизиты по-английски — поле то же
		assert.equal(types.findField(users, 'ref'), reference);
		assert.equal(types.findField(users, 'НетТакого'), null);
	});
});

describe('Через точку: адреса объектов', () => {
	test('ссылочный тип называет объект и запрос describe-type', () => {
		assert.deepEqual(types.refObjectOf('cfg:CatalogRef.Пользователи'), {
			object: 'Справочник.Пользователи',
			key: 'СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ',
			request: { typeName: 'cfg:CatalogRef.Пользователи' },
		});
		assert.equal(types.refObjectOf('cfg:EnumRef.ВажностьПроблемыУчета')?.object, 'Перечисление.ВажностьПроблемыУчета');
		assert.equal(types.refObjectOf('cfg:ChartOfAccountsRef._ДемоОсновной')?.object, 'ПланСчетов._ДемоОсновной');
		assert.equal(types.refObjectOf('cfg:TaskRef.ЗадачаИсполнителя')?.object, 'Задача.ЗадачаИсполнителя');
	});

	test('наборы ссылок, «любая ссылка», характеристики, определяемые типы и журналы объекта не называют', () => {
		for (const typeName of [
			'cfg:CatalogRef',
			'cfg:AnyIBRef',
			'cfg:AnyRef',
			'cfg:Characteristic.ОбъектыАдресацииЗадач',
			'cfg:DefinedType.Организация',
			'cfg:DocumentJournalRef.Взаимодействия',
			'cfg:BusinessProcessRoutePointRef.Задание',
			'xs:string',
			'v8:StandardPeriod',
			'cfg:CatalogRef.А/Б',
			'',
		]) {
			assert.equal(types.refObjectOf(typeName), null, typeName);
		}
	});

	test('таблица запроса: объект, хвост и английский вид к тому же ключу', () => {
		const virtual = types.tableObjectOf('РегистрНакопления._ДемоОстаткиТоваровВМестахХранения.ОстаткиИОбороты');
		assert.deepEqual(virtual, {
			object: 'РегистрНакопления._ДемоОстаткиТоваровВМестахХранения',
			key: 'РЕГИСТРНАКОПЛЕНИЯ._ДЕМООСТАТКИТОВАРОВВМЕСТАХХРАНЕНИЯ',
			tail: ['ОстаткиИОбороты'],
			request: { queryTable: 'РегистрНакопления._ДемоОстаткиТоваровВМестахХранения.ОстаткиИОбороты' },
		});
		assert.equal(types.tableObjectOf('Catalog.Пользователи.КонтактнаяИнформация')?.key, 'СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ');
		assert.equal(types.tableObjectOf('справочник.Пользователи')?.key, 'СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ');
		for (const name of ['ВТ_Товары', 'Справочник', 'Неведомое.Имя', 'Справочник.А Б', '']) {
			assert.equal(types.tableObjectOf(name), null, name);
		}
	});

	test('ключ ответа — по эху запроса, а без эха — по объекту описания', () => {
		assert.equal(types.answerKeyOf({ type: 'describeType', typeName: 'cfg:CatalogRef.Пользователи', outside: true }), 'СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ');
		assert.equal(types.answerKeyOf({ type: 'describeType', queryTable: 'Документ._ДемоСчетНаОплатуПокупателю.Товары', error: 'нет' }), 'ДОКУМЕНТ._ДЕМОСЧЕТНАОПЛАТУПОКУПАТЕЛЮ');
		assert.equal(types.answerKeyOf({ type: 'describeType', description: { object: 'Задача.ЗадачаИсполнителя' } }), 'ЗАДАЧА.ЗАДАЧАИСПОЛНИТЕЛЯ');
		assert.equal(types.answerKeyOf({ type: 'describeType' }), '');
	});

	test('таблицы описания по хвосту: основная, табличная часть, виртуальная', () => {
		const invoice = description('Документ._ДемоСчетНаОплатуПокупателю');
		assert.equal(types.findTable(invoice, [])?.kind, 'main');
		assert.equal(types.findTable(invoice, ['товары'])?.name, 'Документ._ДемоСчетНаОплатуПокупателю.Товары');
		const stock = description('РегистрНакопления._ДемоОстаткиТоваровВМестахХранения');
		assert.equal(types.findTable(stock, ['ОстаткиИОбороты'])?.kind, 'virtual');
		// Английский хвост виртуальной таблицы с русским описанием не сходится — честно «нет»
		assert.equal(types.findTable(stock, ['BalanceAndTurnovers']), null);
		assert.equal(types.findTable(null, []), null);
	});
});

describe('Через точку: дети по типу', () => {
	test('стандартный период и стандартная дата начала — свойства из таблицы', () => {
		assert.deepEqual(names(types.typeChildren(ref('v8:StandardPeriod'), nothing).children), ['ДатаНачала', 'ДатаОкончания', 'Вариант']);
		assert.deepEqual(names(types.typeChildren(ref('v8:StandardBeginningDate'), nothing).children), ['Дата', 'Вариант']);
		const start = types.typeChildren(ref('v8:StandardPeriod'), nothing).children[0];
		assert.deepEqual(start.valueType?.types, ['xs:dateTime']);
		assert.equal(start.expandable, false);
		assert.deepEqual(types.typeChildren(ref('v8:StandardPeriod'), nothing).pending, [], 'таблица свойств не ждёт описаний');
	});

	test('ссылка — поля основной таблицы объекта с подписями и типами', () => {
		const result = types.typeChildren(ref('cfg:CatalogRef.Пользователи'), loaded);
		assert.deepEqual(names(result.children), mainFields('Справочник.Пользователи'));
		assert.deepEqual(result.pending, []);
		const reference = result.children.find((row) => row.name === 'Ссылка');
		assert.equal(reference?.kind, 'field');
		assert.equal(reference?.nameEn, 'Ref');
		assert.equal(reference?.expandable, true, 'ссылка ведёт дальше через точку');
		const comment = result.children.find((row) => row.name === 'Комментарий');
		assert.equal(comment?.expandable, false);
		assert.equal(comment?.typeText, 'string');
		// Определяемый тип состава не раскрывает: детей у такого реквизита нет
		const division = result.children.find((row) => row.name === 'Подразделение');
		assert.deepEqual(division?.valueType?.typeSets, ['cfg:DefinedType.Подразделение']);
		assert.equal(division?.expandable, false);
	});

	test('подпись типа строки — от обвязки', () => {
		const result = types.typeChildren(ref('cfg:EnumRef.ВажностьПроблемыУчета'), loaded, { typeText: (dto) => 'тип:' + dto.types.join('+') });
		assert.deepEqual(names(result.children), mainFields('Перечисление.ВажностьПроблемыУчета'));
		assert.equal(result.children.find((row) => row.name === 'Ссылка')?.typeText, 'тип:cfg:EnumRef.ВажностьПроблемыУчета');
	});

	test('нет описания в кэше — запрос в pending; описания нет вовсе — пусто без запросов', () => {
		const waiting = types.typeChildren(ref('cfg:CatalogRef.Пользователи'), nothing);
		assert.deepEqual(waiting.children, []);
		assert.deepEqual(waiting.pending, [{ key: 'СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ', request: { typeName: 'cfg:CatalogRef.Пользователи' } }]);
		const missing = types.typeChildren(ref('cfg:CatalogRef.ВидыПроверок'), loaded);
		assert.deepEqual(missing, { children: [], pending: [] });
	});

	test('составной тип — объединение детей ссылок, тёзки одной строкой с объединённым типом', () => {
		const dto: TypeDto = { types: ['xs:string', 'cfg:CatalogRef.Пользователи', 'cfg:CatalogRef._ДемоОрганизации'], typeSets: [] };
		const rows = types.typeChildren(dto, loaded).children;
		const expected = new Set([...mainFields('Справочник.Пользователи'), ...mainFields('Справочник._ДемоОрганизации')]);
		assert.deepEqual(new Set(names(rows)), expected);
		assert.equal(rows.length, expected.size, 'тёзки не задвоились');
		const reference = rows.find((row) => row.name === 'Ссылка');
		assert.deepEqual(reference?.valueType?.types, ['cfg:CatalogRef.Пользователи', 'cfg:CatalogRef._ДемоОрганизации']);
		// Порядок — как у первой ссылки, свои реквизиты второй — следом
		assert.deepEqual(names(rows).slice(0, mainFields('Справочник.Пользователи').length), mainFields('Справочник.Пользователи'));
	});

	test('больше MAX_UNION_REFS ссылок, наборы ссылок вида и «любая ссылка» — детей нет', () => {
		const many: TypeDto = {
			types: Array.from({ length: types.MAX_UNION_REFS + 1 }, (_, index) => 'cfg:CatalogRef.Справочник' + index),
			typeSets: [],
		};
		assert.deepEqual(types.typeChildren(many, nothing), { children: [], pending: [] });
		assert.equal(types.expandable(many), false);
		const problem = types.findField(types.findTable(description('РегистрСведений.РезультатыПроверкиУчета'), []), 'ПроблемныйОбъект');
		assert.ok(problem?.type && problem.type.typeSets.length > 1, 'в фикстуре набор ссылок видов');
		assert.deepEqual(types.typeChildren(problem.type, nothing), { children: [], pending: [] });
		assert.deepEqual(types.typeChildren({ types: [], typeSets: ['cfg:AnyIBRef'] }, nothing), { children: [], pending: [] });
	});

	test('путь по типам: Ссылка — тот же объект, чужой сегмент обрывает путь', () => {
		const step = types.walkType(ref('cfg:CatalogRef.Пользователи'), ['Ссылка'], loaded);
		assert.deepEqual(step.type?.types, ['cfg:CatalogRef.Пользователи']);
		const deeper = types.walkType(ref('cfg:TaskRef.ЗадачаИсполнителя'), ['БизнесПроцесс'], loaded);
		assert.equal(deeper.type, null, 'БизнесПроцесс задачи без типа (зависит от других объектов)');
		assert.equal(types.walkType(ref('cfg:CatalogRef.Пользователи'), ['НетТакого', 'Ссылка'], loaded).type, null);
		assert.deepEqual(types.walkType(ref('cfg:CatalogRef.Пользователи'), ['Ссылка'], nothing).pending.map((item) => item.key), ['СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ']);
	});

	test('ссылки на ПВХ, план счетов, бизнес-процесс и задачу раскрываются по своим описаниям', () => {
		for (const [typeName, object] of [
			['cfg:ChartOfCharacteristicTypesRef.ДополнительныеРеквизитыИСведения', 'ПланВидовХарактеристик.ДополнительныеРеквизитыИСведения'],
			['cfg:ChartOfAccountsRef._ДемоОсновной', 'ПланСчетов._ДемоОсновной'],
			['cfg:BusinessProcessRef.Задание', 'БизнесПроцесс.Задание'],
			['cfg:TaskRef.ЗадачаИсполнителя', 'Задача.ЗадачаИсполнителя'],
			['cfg:DocumentRef._ДемоСчетНаОплатуПокупателю', 'Документ._ДемоСчетНаОплатуПокупателю'],
		]) {
			const rows = types.typeChildren(ref(typeName), loaded).children;
			assert.deepEqual(names(rows), mainFields(object), typeName);
			assert.ok(rows.some((row) => row.name === 'Ссылка'), `${typeName}: нет Ссылка`);
		}
	});
});

describe('Через точку: выражения поля выборки', () => {
	test('путь, ЕСТЬNULL/МАКСИМУМ/МИНИМУМ от пути, скобки и комментарии', () => {
		assert.deepEqual(types.classifyExpression('Т.Контрагент'), { kind: 'path', path: 'Т.Контрагент' });
		assert.deepEqual(types.classifyExpression('  (Т.Контрагент.Владелец) '), { kind: 'path', path: 'Т.Контрагент.Владелец' });
		assert.deepEqual(types.classifyExpression('ЕСТЬNULL(Т.Сумма, 0)'), { kind: 'path', path: 'Т.Сумма' });
		assert.deepEqual(types.classifyExpression('isnull(Т.Сумма, 0)'), { kind: 'path', path: 'Т.Сумма' });
		assert.deepEqual(types.classifyExpression('МАКСИМУМ(Т.Дата)'), { kind: 'path', path: 'Т.Дата' });
		assert.deepEqual(types.classifyExpression('Т.Поле // комментарий, с запятой ("и скобкой"\n'), { kind: 'path', path: 'Т.Поле' });
	});

	test('ВЫРАЗИТЬ к ссылке — тип приведения; NULL — пусто, но известно', () => {
		assert.deepEqual(types.classifyExpression('ВЫРАЗИТЬ(Т.Предмет КАК Справочник.Пользователи)'), {
			kind: 'type',
			type: { types: ['cfg:CatalogRef.Пользователи'], typeSets: [], typeIds: [] },
		});
		assert.deepEqual(types.classifyExpression('CAST(T.Subject AS Document.Счет)')?.type?.types, ['cfg:DocumentRef.Счет']);
		assert.deepEqual(types.classifyExpression('NULL'), { kind: 'null' });
	});

	test('выражения, литералы и приведение к примитиву тип не дают', () => {
		for (const expr of [
			'Т.Сумма * 2',
			'ИСТИНА',
			'&Параметр',
			'"строка"',
			'ВЫБОР КОГДА Т.А ТОГДА 1 ИНАЧЕ 2 КОНЕЦ',
			'СУММА(Т.Сумма)',
			'ВЫРАЗИТЬ(Т.Имя КАК СТРОКА(100))',
			'ЕСТЬNULL(Т.А, 0) + 1',
			'(Т.А) + (Т.Б)',
			'ПРЕДСТАВЛЕНИЕ(Т.Контрагент)',
			'',
		]) {
			assert.equal(types.classifyExpression(expr).kind, 'unknown', expr);
		}
	});
});

describe('Через точку: тип колонки запроса', () => {
	const checksQuery = CHECKS.dataSets[0].query ?? '';

	test('колонка `Алиас.Поле` — тип поля таблицы источника; первый проход просит описание', () => {
		const first = types.queryColumnType(checksQuery, 'ПравилоПроверки', nothing, { queryModel });
		assert.equal(first.type, null);
		assert.deepEqual(first.pending, [
			{ key: 'РЕГИСТРСВЕДЕНИЙ.РЕЗУЛЬТАТЫПРОВЕРКИУЧЕТА', request: { queryTable: 'РегистрСведений.РезультатыПроверкиУчета' } },
		]);
		const ready = types.queryColumnType(checksQuery, 'ПравилоПроверки', loaded, { queryModel });
		assert.deepEqual(ready.type?.types, ['cfg:CatalogRef.ПравилаПроверкиУчета']);
		assert.deepEqual(ready.pending, []);
		assert.deepEqual(types.queryColumnType(checksQuery, 'ответственный', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи']);
	});

	test('источник соединения, параметр, путь через ссылку и неизвестная колонка', () => {
		// ИдентификаторПроверки — поле второго источника (ВНУТРЕННЕЕ СОЕДИНЕНИЕ)
		assert.deepEqual(types.queryColumnType(checksQuery, 'ИдентификаторПроверки', loaded, { queryModel }).type?.types, ['xs:string']);
		assert.equal(types.queryColumnType(checksQuery, 'НадписьОшибка', loaded, { queryModel }).type, null, '&-параметр — выражение');
		assert.equal(types.queryColumnType(checksQuery, 'НетТакой', loaded, { queryModel }).type, null);
		// Колонка с точкой (`field` поля набора) — колонка и путь по типам от неё
		assert.deepEqual(types.queryColumnType(checksQuery, 'Ответственный.Ссылка', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи']);
	});

	test('временная таблица пакета, вложенный запрос, объединение и путь без алиаса', () => {
		const text = [
			'ВЫБРАТЬ Т.Ответственный КАК Отв, Т.ПравилоПроверки КАК Правило',
			'ПОМЕСТИТЬ ВТ',
			'ИЗ РегистрСведений.РезультатыПроверкиУчета КАК Т',
			';',
			'ВЫБРАТЬ ВТ.Отв КАК Отв, Вл.Код КАК Правило, Ответственный.Ссылка КАК Сам',
			'ИЗ ВТ КАК ВТ',
			'  ЛЕВОЕ СОЕДИНЕНИЕ (ВЫБРАТЬ П.Ссылка КАК Код ИЗ Справочник.ПравилаПроверкиУчета КАК П) КАК Вл ПО ИСТИНА',
			'  ЛЕВОЕ СОЕДИНЕНИЕ Справочник.Пользователи КАК Ответственный ПО ИСТИНА',
			'ОБЪЕДИНИТЬ ВСЕ',
			'ВЫБРАТЬ ВЫРАЗИТЬ(NULL КАК Справочник._ДемоОрганизации), NULL, Ссылка',
			'ИЗ Справочник.Пользователи КАК Польз',
		].join('\n');
		assert.deepEqual(types.queryColumnType(text, 'Отв', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи', 'cfg:CatalogRef._ДемоОрганизации']);
		assert.deepEqual(types.queryColumnType(text, 'Правило', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.ПравилаПроверкиУчета']);
		// `Ссылка` без алиаса во второй части — у единственного источника
		assert.deepEqual(types.queryColumnType(text, 'Сам', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи']);
	});

	test('колонка запроса пакета по номеру — типы колонок временной таблицы для конструктора', () => {
		const text = [
			'ВЫБРАТЬ Т.Ответственный КАК Отв, Т.ПравилоПроверки КАК Правило, 1 КАК Число',
			'ПОМЕСТИТЬ ВТ',
			'ИЗ РегистрСведений.РезультатыПроверкиУчета КАК Т',
			';',
			'ВЫБРАТЬ ВТ.Отв КАК Отв ИЗ ВТ КАК ВТ',
		].join('\n');
		const batch = queryModel.parse(text).model;
		const first = types.batchColumnType(batch, 0, 'Отв', nothing, { queryModel });
		assert.equal(first.type, null);
		assert.deepEqual(first.pending.map((item) => item.key), ['РЕГИСТРСВЕДЕНИЙ.РЕЗУЛЬТАТЫПРОВЕРКИУЧЕТА']);
		assert.deepEqual(types.batchColumnType(batch, 0, 'отв', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи']);
		assert.deepEqual(types.batchColumnType(batch, 0, 'Правило', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.ПравилаПроверкиУчета']);
		assert.equal(types.batchColumnType(batch, 0, 'Число', loaded, { queryModel }).type, null, 'выражение — без типа');
		assert.deepEqual(types.batchColumnType(batch, 1, 'Отв', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи'], 'через ВТ');
		assert.equal(types.batchColumnType(batch, 5, 'Отв', loaded, { queryModel }).type, null);
		assert.equal(types.batchColumnType(batch, 0, 'Отв.Код', loaded, { queryModel }).type, null, 'колонка — одно имя');
	});

	test('неоднозначный путь без алиаса и часть с выражением тип не дают', () => {
		const ambiguous = 'ВЫБРАТЬ Ссылка КАК С ИЗ Справочник.Пользователи КАК А, Справочник.ПравилаПроверкиУчета КАК Б';
		assert.equal(types.queryColumnType(ambiguous, 'С', loaded, { queryModel }).type, null);
		// Пока описаний нет, неоднозначность не решается: ждём оба
		assert.deepEqual(types.queryColumnType(ambiguous, 'С', nothing, { queryModel }).pending.map((item) => item.key).sort(), [
			'СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ',
			'СПРАВОЧНИК.ПРАВИЛАПРОВЕРКИУЧЕТА',
		]);
		const mixed = 'ВЫБРАТЬ Т.Ссылка КАК С ИЗ Справочник.Пользователи КАК Т ОБЪЕДИНИТЬ ВСЕ ВЫБРАТЬ 1 ИЗ Справочник.Пользователи КАК Т';
		assert.equal(types.queryColumnType(mixed, 'С', loaded, { queryModel }).type, null, 'неполный тип дал бы неполный список');
	});

	test('последний запрос выборки пакета: помещение и уничтожение пропускаются', () => {
		const text = [
			'ВЫБРАТЬ Т.Ссылка КАК Х ИЗ Справочник.Пользователи КАК Т',
			';',
			'ВЫБРАТЬ Т.Ссылка КАК Х ПОМЕСТИТЬ ВТ ИЗ Справочник.ПравилаПроверкиУчета КАК Т',
			';',
			'УНИЧТОЖИТЬ ВТ',
		].join('\n');
		assert.deepEqual(types.queryColumnType(text, 'Х', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи']);
	});

	test('текст с диагностикой разбора, пустой и колонка не-идентификатор — без типа и без запросов', () => {
		for (const [text, column] of [
			['ВЫБРАТЬ Т.Ссылка КАК Х ИЗ Справочник.Пользователи КАК Т ГДЕ (', 'Х'],
			['', 'Х'],
			[checksQuery, 'Ответственный..Ссылка'],
		]) {
			assert.deepEqual(types.queryColumnType(text, column, nothing, { queryModel }), { type: null, pending: [] }, `${column}: ${text.slice(0, 30)}`);
		}
	});

	test('виртуальные таблицы регистров: СрезПоследних, ОстаткиИОбороты с полями периода и счёт бухгалтерии', () => {
		const byFile = (fragment: string) => {
			const found = corpus.queries.find((item) => item.file.includes(fragment));
			assert.ok(found, `в фикстуре запросов нет ${fragment}`);
			return found.text;
		};
		const consents = byFile('СогласияНаОбработкуПерсональныхДанныхДействующие');
		assert.deepEqual(types.queryColumnType(consents, 'ДатаПолучения', loaded, { queryModel }).type?.types, ['xs:dateTime']);
		assert.deepEqual(types.queryColumnType(consents, 'Организация', loaded, { queryModel }).type?.typeSets, ['cfg:DefinedType.Организация']);
		const stock = byFile('_ДемоОстаткиТоваровРасширение');
		assert.deepEqual(types.queryColumnType(stock, 'Номенклатура', loaded, { queryModel }).type?.types, ['cfg:CatalogRef._ДемоНоменклатура']);
		assert.deepEqual(types.queryColumnType(stock, 'ПериодМесяц', loaded, { queryModel }).type?.types, ['xs:dateTime']);
		const turnover = byFile('_ДемоОборотноСальдоваяВедомость');
		assert.deepEqual(types.queryColumnType(turnover, 'Счет', loaded, { queryModel }).type?.types, ['cfg:ChartOfAccountsRef._ДемоОсновной']);
		// Регистратор — тип зависит от документов-регистраторов: md-sparrow его не называет
		assert.equal(types.queryColumnType(turnover, 'ПлатежныйДокумент', loaded, { queryModel }).type, null);
	});

	/** Выводит тип каждой колонки каждого запроса фикстуры; при полном кэше ни одна колонка не ждёт описаний. */
	function inferQueryColumns(): { columns: number; typed: number; references: number } {
		let columns = 0;
		let typed = 0;
		let references = 0;
		for (const item of corpus.queries) {
			const statement = lastSelect(item.text);
			for (const column of queryModel.outputFields(statement).filter((name): name is string => name !== null)) {
				columns += 1;
				const result = types.queryColumnType(item.text, column, loaded, { queryModel });
				assert.deepEqual(result.pending, [], `${item.file}: ${column} ждёт описаний при полном кэше`);
				if (result.type) {
					typed += 1;
					references += result.type.types.some((name) => types.refObjectOf(name) !== null) ? 1 : 0;
				}
			}
		}
		return { columns, typed, references };
	}

	test('запросы фикстуры: все колонки всех запросов — без падений и без лишних запросов', () => {
		const { columns, typed, references } = inferQueryColumns();
		assert.ok(columns > 400, `колонок ${columns}`);
		// Типы выводятся только по объектам фикстуры: описаний остальных объектов выгрузки в ней нет
		assert.ok(typed >= 150, `тип выведен у ${typed} из ${columns}`);
		assert.ok(references >= 60, `ссылочных ${references}`);
	});

	// Порог по времени на общих машинах CI мигает, поэтому замер включается явно и в обычном наборе пропускается
	test(
		'бюджет: вывод типов всех колонок запросов фикстуры меньше 2 с',
		{ skip: process.env.DCS_PERF_BUDGET === '1' ? false : 'замер времени включается переменной DCS_PERF_BUDGET=1' },
		() => {
			const started = process.hrtime.bigint();
			inferQueryColumns();
			const ms = Number(process.hrtime.bigint() - started) / 1e6;
			assert.ok(ms < 2000, `вывод по фикстуре запросов ${Math.round(ms)} мс`);
		}
	);
});

describe('Через точку: поля наборов', () => {
	test('записанный тип главнее вывода; поле набора-запроса — по своей колонке field', () => {
		assert.deepEqual(types.dataSetFieldType(USERS, 'Пользователь', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи']);
		assert.equal(types.dataSetFieldType(USERS, 'ДействительныйУчастник', loaded, { queryModel }).type, null);
		const typed = { dataSets: [{ name: 'Н', type: 'query', query: USERS.dataSets[0].query, fields: [{ dataPath: 'Пользователь', field: 'Пользователь', valueType: ref('xs:string') }] }] };
		assert.deepEqual(types.dataSetFieldType(typed, 'Пользователь', nothing, { queryModel }), { type: { types: ['xs:string'], typeSets: [], typeIds: [] }, pending: [] });
		// Путь данных и колонка различаются: тип — по колонке
		const renamed = { dataSets: [{ name: 'Н', type: 'query', query: USERS.dataSets[0].query, fields: [{ dataPath: 'Кто', field: 'Пользователь' }] }] };
		assert.deepEqual(types.dataSetFieldType(renamed, 'Кто', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи']);
	});

	test('объединение с NULL в запросе — типа нет и запросов нет', () => {
		assert.deepEqual(types.dataSetFieldType(UNIONS, 'ОбъектСсылка', nothing, { queryModel }), { type: null, pending: [] });
	});

	test('тёзки разных наборов складываются; набор места ввода ограничивает вывод', () => {
		const model = {
			dataSets: [
				{ name: 'А', type: 'query', query: 'ВЫБРАТЬ Т.Ссылка КАК Кто ИЗ Справочник.Пользователи КАК Т', fields: [{ dataPath: 'Кто', field: 'Кто' }] },
				{ name: 'Б', type: 'query', query: 'ВЫБРАТЬ Т.Ссылка КАК Кто ИЗ Справочник._ДемоОрганизации КАК Т', fields: [{ dataPath: 'Кто', field: 'Кто' }] },
				{ name: 'В', type: 'object', objectName: 'Таблица', fields: [{ dataPath: 'Кто' }] },
			],
		};
		assert.deepEqual(types.dataSetFieldType(model, 'Кто', loaded, { queryModel }).type?.types, ['cfg:CatalogRef.Пользователи', 'cfg:CatalogRef._ДемоОрганизации']);
		assert.deepEqual(types.dataSetFieldType(model, 'Кто', loaded, { queryModel, dataSet: 'Б' }).type?.types, ['cfg:CatalogRef._ДемоОрганизации']);
		assert.equal(types.dataSetFieldType(model, 'Кто', loaded, { queryModel, dataSet: 'В' }).type, null, 'у набора-объекта тип не выводится');
		assert.deepEqual(types.scopeDataSets('link-source:А'), ['А']);
		assert.deepEqual(types.scopeDataSets('link-both:А|Б'), ['А', 'Б']);
		assert.deepEqual(types.scopeDataSets('field-of-set:Объединение/Дочерний'), ['Объединение/Дочерний']);
		assert.equal(types.scopeDataSets('settings:filter'), null);
	});

	test('раскладка полей по пути (fieldIndex): те же типы, что без неё, первое вхождение главнее, папки не в счёт', () => {
		const model = {
			dataSets: [
				{
					name: 'А',
					type: 'query',
					query: 'ВЫБРАТЬ Т.Ссылка КАК Кто, Т.Наименование КАК Имя ИЗ Справочник.Пользователи КАК Т',
					fields: [
						{ dataPath: 'Кто', kind: 'folder' },
						{ dataPath: 'кто', field: 'Кто' },
						{ dataPath: 'Кто', field: 'Имя' },
						{ dataPath: 'Строка', field: 'Имя', valueType: ref('xs:string') },
					],
				},
				{ name: 'Объединение', type: 'union', items: [{ name: 'Б', type: 'query', query: 'ВЫБРАТЬ Т.Ссылка КАК Кто ИЗ Справочник._ДемоОрганизации КАК Т', fields: [] }], fields: [] },
			],
		};
		const index = new Map();
		for (const dataPath of ['Кто', 'КТО', 'Строка', 'Имя', 'НетТакого']) {
			const plain = types.dataSetFieldType(model, dataPath, loaded, { queryModel });
			assert.deepEqual(types.dataSetFieldType(model, dataPath, loaded, { queryModel, fieldIndex: index }), plain, dataPath);
		}
		// Папка с тем же путём пропущена, из двух тёзок взят первый (колонка Кто, а не Имя); вложенный набор объединения — по колонке
		assert.deepEqual(types.dataSetFieldType(model, 'Кто', loaded, { queryModel, fieldIndex: index }).type?.types, [
			'cfg:CatalogRef.Пользователи',
			'cfg:CatalogRef._ДемоОрганизации',
		]);
		assert.equal(index.size, 3, 'раскладка — одна на каждый просмотренный набор: А, объединение и его вложенный');
		assert.ok(index.has(model.dataSets[0]));
	});
});

describe('Тип поля ресурса: «>>» берёт Сумма(Поле) только по известному числовому типу', () => {
	const STOCK =
		'ВЫБРАТЬ\n\tТ.Номенклатура КАК Номенклатура,\n\tТ.КоличествоОстаток КАК Остаток,\n\tТ.КоличествоОстаток * 2 КАК Двойной,\n\tТ.Организация КАК Организация\n' +
		'ИЗ\n\tРегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Остатки КАК Т';
	const USERS_QUERY = 'ВЫБРАТЬ Т.Ссылка КАК Ссылка ИЗ Справочник.Пользователи КАК Т';
	const stockSet = (fields: unknown[] = []) => ({ name: 'Остатки', type: 'query', query: STOCK, fields });
	const kindOf = (model: unknown, path: string, kind = 'field', lookup: Lookup = loaded): string => {
		const result = types.resourceFieldType(model, path, kind, lookup, { queryModel });
		return result.state === 'known' ? types.numericKind(result.type) : result.state;
	};

	test('набор-запрос: число — по колонке регистра и по форме значения, ссылка — не число, путь через точку — по типам; без описаний — ждём', () => {
		const model = { dataSets: [stockSet()] };
		assert.equal(kindOf(model, 'Остаток'), 'numeric');
		assert.deepEqual(types.resourceFieldType(model, 'Остаток', 'field', loaded, { queryModel }).type?.types, ['xs:decimal']);
		// Произведение — число по форме значения; уровень «через точку» (queryColumnType) знает только колонки
		assert.equal(kindOf(model, 'Двойной'), 'numeric');
		assert.equal(types.queryColumnType(STOCK, 'Двойной', loaded, { queryModel }).type, null);
		assert.equal(kindOf(model, 'Номенклатура'), 'other');
		assert.equal(kindOf(model, 'Организация.Наименование'), 'other', 'реквизит по типу колонки');
		assert.equal(kindOf(model, 'НетТакого'), 'unknown', 'поля нет ни в одном наборе');
		// Описание регистра не прочитано: тип ждёт его, недостающее — в pending; форма значения описаний не ждёт
		const waiting = types.resourceFieldType(model, 'Остаток', 'field', nothing, { queryModel });
		assert.equal(waiting.state, 'waiting');
		assert.ok(waiting.pending.length > 0 && waiting.pending.every((item) => typeof item.key === 'string' && item.key !== ''));
		assert.equal(kindOf(model, 'Двойной', 'field', nothing), 'numeric');
		// Без модуля разбора тип колонки не выводится
		assert.equal(types.resourceFieldType(model, 'Остаток', 'field', loaded, { queryModel: null }).state, 'unknown');
	});

	test('записанный тип главнее вывода; вычисляемое поле — только записанный тип; набор-объект без типа — неизвестен', () => {
		const typed = { dataSets: [stockSet([{ dataPath: 'Номенклатура', field: 'Номенклатура', valueType: ref('xs:decimal') }])] };
		assert.deepEqual(types.resourceFieldType(typed, 'номенклатура', 'field', nothing, { queryModel }), { state: 'known', type: ref('xs:decimal'), pending: [] });
		const calc = {
			dataSets: [],
			calculatedFields: [
				{ name: 'Наценка', value: 'Сумма * 2', valueType: ref('xs:decimal') },
				{ name: 'Метка', value: '"х"' },
				{ name: 'Признак', value: 'Истина', valueType: ref('xs:boolean') },
			],
		};
		assert.equal(kindOf(calc, 'Наценка', 'calc'), 'numeric');
		assert.equal(kindOf(calc, 'Метка', 'calc'), 'unknown', 'выражение вычисляемого поля не разбирается');
		assert.equal(kindOf(calc, 'Признак', 'calc'), 'other');
		const objects = {
			dataSets: [
				{ name: 'Таблица', type: 'object', objectName: 'Таблица', fields: [{ dataPath: 'Сумма' }, { dataPath: 'Имя', valueType: ref('xs:string') }] },
			],
		};
		assert.equal(kindOf(objects, 'Сумма'), 'unknown');
		assert.equal(kindOf(objects, 'Имя'), 'other');
	});

	test('строго по всем наборам: тёзка без типа и вложенный набор без типа делают тип неизвестным, набор без поля не в счёт', () => {
		const objectWith = (fields: unknown[]) => ({ name: 'Таблица', type: 'object', objectName: 'Таблица', fields });
		// Тёзка набора-объекта без типа: dataSetFieldType складывает то, что знает (число), здесь — неизвестно
		const twins = { dataSets: [stockSet(), objectWith([{ dataPath: 'Остаток' }])] };
		assert.deepEqual(types.dataSetFieldType(twins, 'Остаток', loaded, { queryModel }).type?.types, ['xs:decimal']);
		assert.equal(kindOf(twins, 'Остаток'), 'unknown');
		assert.equal(kindOf({ dataSets: [stockSet(), objectWith([{ dataPath: 'Имя' }])] }, 'Остаток'), 'numeric', 'набор без поля не в счёт');
		// Объединение: вложенный запрос без такой колонки не в счёт, вложенный набор с полем без типа — неизвестно
		const union = (second: unknown) => ({ dataSets: [{ name: 'Объединение', type: 'union', fields: [], items: [stockSet(), second] }] });
		assert.equal(kindOf(union({ name: 'Люди', type: 'query', query: USERS_QUERY, fields: [] }), 'Остаток'), 'numeric');
		assert.equal(kindOf(union(objectWith([{ dataPath: 'Остаток' }])), 'Остаток'), 'unknown');
		// Записанный тип у поля самого объединения — главнее вложенных
		const ownTyped = { dataSets: [{ name: 'Объединение', type: 'union', fields: [{ dataPath: 'Остаток', valueType: ref('xs:string') }], items: [stockSet()] }] };
		assert.equal(kindOf(ownTyped, 'Остаток'), 'other');
		// Без автозаполнения не описанное поле в наборе-запросе не ищется по колонкам
		assert.equal(kindOf({ dataSets: [Object.assign(stockSet(), { autoFillFields: false })] }, 'Остаток'), 'unknown');
		// Описанное поле, колонки которого в запросе нет, — тип неизвестен
		assert.equal(kindOf({ dataSets: [stockSet([{ dataPath: 'Итог', field: 'Итог' }])] }, 'Итог'), 'unknown');
		// Одна часть объединения запросов без типа — колонка неизвестна (правило колонки)
		const partly = { dataSets: [{ name: 'Н', type: 'query', query: STOCK + '\nОБЪЕДИНИТЬ ВСЕ\nВЫБРАТЬ NULL, &Остаток, 0, NULL', fields: [] }] };
		assert.equal(kindOf(partly, 'Остаток'), 'unknown', '&-параметр — тип неизвестен');
		assert.equal(kindOf(partly, 'Двойной'), 'numeric', '0 — число');
	});

	test('набор-запрос с автозаполнением, о колонках которого разбор не скажет, делает тип неизвестным; пустой запрос и запрос без колонки — не в счёт', () => {
		const typed = { name: 'Таблица', type: 'object', objectName: 'Таблица', fields: [{ dataPath: 'Сумма', valueType: ref('xs:decimal') }] };
		const querySet = (query: string, extra: Record<string, unknown> = {}) => Object.assign({ name: 'Запрос', type: 'query', autoFillFields: true, query, fields: [] }, extra);
		// Текст с ошибкой: колонка Сумма в нём может быть (здесь — строка), тип по одному набору-объекту — догадка
		const broken = 'ВЫБРАТЬ "текст" КАК Сумма ИЗ Справочник.Пользователи КАК Т ГДЕ (';
		assert.ok(queryModel.parse(broken).diagnostics.length > 0, 'текст разобрался без диагностики');
		assert.equal(kindOf({ dataSets: [typed, querySet(broken)] }, 'Сумма'), 'unknown');
		// Без модуля разбора — то же: колонку не проверить
		assert.equal(types.resourceFieldType({ dataSets: [typed, querySet(USERS_QUERY)] }, 'Сумма', 'field', loaded, { queryModel: null }).state, 'unknown');
		// Разбор сказал, что колонки нет, запрос пуст или автозаполнение снято — набор не в счёт, тип известен
		assert.equal(kindOf({ dataSets: [typed, querySet(USERS_QUERY)] }, 'Сумма'), 'numeric');
		assert.equal(kindOf({ dataSets: [typed, querySet('')] }, 'Сумма'), 'numeric');
		assert.equal(kindOf({ dataSets: [typed, querySet(broken, { autoFillFields: false })] }, 'Сумма'), 'numeric');
	});

	test('числовой вид: только число — numeric, без числа — other, число с другим — mixed, набор без состава — unknown; состав раскрывается', () => {
		assert.equal(types.numericKind(ref('xs:decimal')), 'numeric');
		assert.equal(types.numericKind({ types: ['xs:decimal', 'xs:string'], typeSets: [], typeIds: [] }), 'mixed');
		assert.equal(types.numericKind(ref('cfg:CatalogRef.Валюты')), 'other');
		assert.equal(types.numericKind({ types: [], typeSets: ['cfg:AnyRef'], typeIds: [] }), 'other', '«любая ссылка» — не число');
		const money = { types: [], typeSets: ['cfg:DefinedType.ДенежнаяСумма'], typeIds: [] };
		assert.equal(types.numericKind(money), 'unknown', 'состав определяемого типа не известен');
		assert.equal(types.numericKind({ ...money, compositions: [{ source: 'cfg:DefinedType.ДенежнаяСумма', types: ['xs:decimal'], typeSets: [] }] }), 'numeric');
		assert.equal(types.numericKind({ types: [], typeSets: [], typeIds: ['0000'] }), 'unknown');
		assert.equal(types.numericKind(null), 'unknown');
	});
});

describe('Через точку: точка расширения каталога подсказки', () => {
	test('поле набора-запроса без записанного типа — дети по выведенному типу, глубже — по типам детей', () => {
		assert.deepEqual(childPaths(CHECKS, 'settings:any', 'ПравилоПроверки'), mainFields('Справочник.ПравилаПроверкиУчета'));
		assert.deepEqual(childPaths(CHECKS, 'settings:any', 'Ответственный.Ссылка'), mainFields('Справочник.Пользователи'));
		assert.deepEqual(childPaths(CHECKS, 'expr-calc', 'ВажностьПроблемы'), mainFields('Перечисление.ВажностьПроблемыУчета'));
		// Справочника ВидыПроверок в фикстуре нет: описания нет — детей нет
		assert.deepEqual(childPaths(CHECKS, 'settings:any', 'ВидПроверки'), []);
		assert.deepEqual(childPaths(CHECKS, 'settings:any', 'ПроблемныйОбъект'), [], 'набор ссылок видов');
	});

	test('записанный тип поля набора-объекта и параметры: StandardPeriod и ссылка', () => {
		assert.deepEqual(childPaths(FOLDER, 'settings:any', 'ОбщиеРеквизиты.ОсновнаяОрганизация'), mainFields('Справочник._ДемоОрганизации'));
		// Папка без типа — только свои дети
		assert.deepEqual(
			childPaths(FOLDER, 'settings:any', 'ОбщиеРеквизиты'),
			FOLDER.dataSets[0].fields?.filter((field) => field.dataPath.startsWith('ОбщиеРеквизиты.')).map((field) => field.dataPath.split('.')[1])
		);
		assert.deepEqual(childPaths(CHECKS, 'expr-param', 'Период', 'param'), ['ДатаНачала', 'ДатаОкончания', 'Вариант']);
		assert.deepEqual(childPaths(CHECKS, 'settings:any', 'ПараметрыДанных.Период'), ['ДатаНачала', 'ДатаОкончания', 'Вариант']);
		assert.deepEqual(childPaths(USERS, 'expr-param', 'Пользователь', 'param'), mainFields('Справочник.Пользователи'));
		// Параметр не выводится по запросу: тип у него свой или никакого
		assert.deepEqual(childPaths(USERS, 'expr-param', 'Подразделение', 'param'), []);
	});

	test('подреквизиты отбрасываются по attributeUseRestriction, а пути узлов каталога — свои', () => {
		// Идентификатор набора ВнешняяТаблица запрещает реквизиты во всех разделах
		assert.deepEqual(childPaths(CHECKS, 'settings:selection', 'Идентификатор'), []);
		const catalog = complete.buildCatalog(CHECKS, null, 'settings:any');
		const rows = complete.childrenOf(catalog, 'ПравилоПроверки', provider(CHECKS, 'settings:any'));
		assert.equal(rows[0].path, 'ПравилоПроверки.Ссылка');
		assert.equal(complete.kindLetter(rows[0]), 'П▸', 'у ссылки стрелка: путь продолжается');
		assert.equal(complete.kindLetter(rows.find((row) => row.name === 'Наименование') ?? {}), 'П');
	});

	test('свои дети узла и дети по типу вместе, записанный ребёнок главнее тёзки по типу', () => {
		const model = {
			dataSets: [
				{
					name: 'Н',
					type: 'query',
					query: 'ВЫБРАТЬ Т.Ссылка КАК Пользователь ИЗ Справочник.Пользователи КАК Т',
					fields: [
						{ dataPath: 'Пользователь', kind: 'field', field: 'Пользователь' },
						{ dataPath: 'Пользователь.Наименование', kind: 'field', field: 'Пользователь.Наименование', title: 'Имя' },
						{ dataPath: 'Пользователь.Свой', kind: 'field', field: 'Пользователь.Свой' },
					],
				},
			],
		};
		const catalog = complete.buildCatalog(model, null, 'settings:any');
		const rows = complete.childrenOf(catalog, 'Пользователь', provider(model, 'settings:any'));
		assert.deepEqual(names(rows).slice(0, 2), ['Наименование', 'Свой']);
		assert.equal(names(rows).filter((name) => name === 'Наименование').length, 1);
		assert.deepEqual(new Set(names(rows)), new Set(['Свой', ...mainFields('Справочник.Пользователи')]));
	});

	test('связь видит только свой набор: тёзка из другого набора тип не подмешивает', () => {
		const model = {
			dataSets: [
				{ name: 'А', type: 'query', query: 'ВЫБРАТЬ Т.Ссылка КАК Кто ИЗ Справочник.Пользователи КАК Т', fields: [{ dataPath: 'Кто', field: 'Кто' }] },
				{ name: 'Б', type: 'query', query: 'ВЫБРАТЬ Т.Ссылка КАК Кто ИЗ Справочник._ДемоОрганизации КАК Т', fields: [{ dataPath: 'Кто', field: 'Кто' }] },
			],
		};
		assert.deepEqual(childPaths(model, 'link-source:Б', 'Кто'), mainFields('Справочник._ДемоОрганизации'));
		assert.ok(childPaths(model, 'settings:any', 'Кто').includes('Недействителен'), 'в настройках — оба набора');
	});

	test('ленивость: первый вызов просит описания по очереди вывода, после ответов — дети', () => {
		const cache = new Map<string, Description | null>();
		const lookup: Lookup = (key) => (cache.has(key) ? cache.get(key) : undefined);
		const catalog = complete.buildCatalog(CHECKS, null, 'settings:any');
		const node = catalog.nodes.find((item) => item.name === 'Ответственный');
		assert.ok(node);
		const asked: string[] = [];
		for (let round = 0; round < 5; round += 1) {
			const result = types.extraChildrenFor({ mode: 'path', chain: [node] }, 'Ответственный.Ссылка', { model: CHECKS, scope: 'settings:any', lookup, queryModel });
			if (result.pending.length === 0) {
				assert.deepEqual(names(result.children), mainFields('Справочник.Пользователи'));
				break;
			}
			assert.deepEqual(result.children, []);
			for (const item of result.pending) {
				asked.push(item.key);
				cache.set(item.key, loaded(item.key) ?? null);
			}
		}
		// Сначала источник запроса, затем объект типа колонки — два ответа панели, без повторов
		assert.deepEqual(asked, ['РЕГИСТРСВЕДЕНИЙ.РЕЗУЛЬТАТЫПРОВЕРКИУЧЕТА', 'СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ']);
	});

	test('без цепочки каталога и вне каталога — пусто', () => {
		assert.deepEqual(types.extraChildrenFor({ mode: 'path', chain: [] }, 'Т.Поле', { model: CHECKS, scope: 'settings:any', lookup: loaded, queryModel }), { children: [], pending: [] });
		assert.deepEqual(childPaths(CHECKS, 'settings:any', 'НетТакого'), []);
	});
});

// ---------- составы определяемых типов и характеристик ----------

const PERSON_REF = 'cfg:CatalogRef._ДемоФизическиеЛица';
const DIVISION_REF = 'cfg:CatalogRef._ДемоПодразделения';
/** UUID определяемого типа «Подразделение» — как в модели ПользователиПоПодразделениям (complete-models.json). */
const DIVISION_UUID = '92fb25e9-5b34-4411-b876-cd83fa55a6e0';

function plain(types: string[], typeSets: string[] = [], typeIds: string[] = []): TypeDto {
	return { types, typeSets, typeIds };
}

/**
 * Синтетическое описание справочника: Ссылка, Наименование и свои поля. Тесты правил ниже держат
 * короткие описания нарочно — так видно, откуда каждый ребёнок; те же правила на ответах md-sparrow
 * из фикстуры (физлица, составы на границе предела) проверяет следующий блок.
 */
function catalogDescription(name: string, extra: QueryField[]): Description {
	return {
		object: 'Справочник.' + name,
		kind: 'catalog',
		tables: [
			{
				name: 'Справочник.' + name,
				kind: 'main',
				fields: [
					{ name: 'Ссылка', nameEn: 'Ref', kind: 'standard', type: ref('cfg:CatalogRef.' + name), synonym: 'Ссылка' },
					{ name: 'Наименование', nameEn: 'Description', kind: 'standard', type: plain(['xs:string']), synonym: 'Наименование' },
					...extra,
				],
			},
		],
	};
}

const PERSONS = catalogDescription('_ДемоФизическиеЛица', [
	{ name: 'ДатаРождения', type: plain(['xs:dateTime']), synonym: 'Дата рождения' },
	{ name: 'ИНН', type: plain(['xs:string']), synonym: 'ИНН' },
]);
const DIVISIONS = catalogDescription('_ДемоПодразделения', [{ name: 'Руководитель', type: ref(PERSON_REF), synonym: 'Руководитель' }]);

/** Составы по выгрузке БСП 3.1 (ssl31): физлицо и подразделение — по одной ссылке; характеристика — синтетика (4 ссылки и 4 примитива). */
const PERSON_RECORD: Composition = { source: 'cfg:DefinedType.ФизическоеЛицо', types: [PERSON_REF], typeSets: [] };
const DIVISION_RECORD: Composition = { source: 'cfg:DefinedType.Подразделение', types: [DIVISION_REF], typeSets: [] };
const PROPERTY_RECORD: Composition = {
	source: 'cfg:Characteristic.ДополнительныеРеквизитыИСведения',
	types: ['xs:boolean', 'xs:string', 'xs:decimal', 'xs:dateTime', 'cfg:CatalogRef.ЗначенияСвойствОбъектов', 'cfg:CatalogRef.ЗначенияСвойствОбъектовИерархия', 'cfg:CatalogRef.Пользователи', PERSON_REF],
	typeSets: [],
};
/** «ЗначениеДоступа» — 25 ссылок, больше MAX_UNION_REFS (синтетика по числу из выгрузки БСП 3.1). */
const ACCESS_RECORD: Composition = {
	source: 'cfg:DefinedType.ЗначениеДоступа',
	types: [PERSON_REF, ...Array.from({ length: 24 }, (_, index) => 'cfg:CatalogRef.Доступ' + index)],
	typeSets: [],
};

function copy<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** Ответ cf-md-query-tables для Пользователей: описание фикстуры с составами typeCompositions выше. */
function usersAnswer(): Description {
	const answer = copy(description('Справочник.Пользователи'));
	answer.typeCompositions = copy([DIVISION_RECORD, PERSON_RECORD, PROPERTY_RECORD]);
	return answer;
}

const USERS_ATTACHED = types.attachTypeCompositions(usersAnswer());
/** Кэш после ответов с составами: Пользователи с составами, физлица и подразделения — синтетика, прочее — фикстура. */
const withCompositions: Lookup = (key) => {
	if (key === 'СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ') {
		return USERS_ATTACHED;
	}
	if (key === 'СПРАВОЧНИК._ДЕМОФИЗИЧЕСКИЕЛИЦА') {
		return PERSONS;
	}
	if (key === 'СПРАВОЧНИК._ДЕМОПОДРАЗДЕЛЕНИЯ') {
		return DIVISIONS;
	}
	return loaded(key);
};

function fieldOf(answer: Description, tableTail: string[], name: string): QueryField {
	const field = types.findField(types.findTable(answer, tableTail), name);
	assert.ok(field, `нет поля ${name}`);
	return field;
}

function childPathsWith(model: unknown, scope: string, parentPath: string, mode: 'path' | 'param', lookup: Lookup): string[] {
	const catalog = complete.buildCatalog(model, null, scope);
	return names(complete.childrenOf(catalog, { mode, parentPath }, provider(model, scope, lookup)));
}

describe('Определяемые типы и характеристики: составы typeCompositions', () => {
	test('attachTypeCompositions пришивает записи к объектам типов ответа, списки типов не меняются', () => {
		const answer = usersAnswer();
		const before = copy(answer);
		const result = types.attachTypeCompositions(answer);
		assert.equal(result, answer, 'ответ меняется на месте и возвращается');
		const person = fieldOf(answer, [], 'ФизическоеЛицо');
		assert.deepEqual(person.type?.compositions, [PERSON_RECORD]);
		assert.deepEqual(person.type?.typeSets, ['cfg:DefinedType.ФизическоеЛицо'], 'подпись — «ОпределяемыйТип.X»');
		assert.deepEqual(person.type?.types, []);
		assert.deepEqual(fieldOf(answer, [], 'Подразделение').type?.compositions, [DIVISION_RECORD]);
		assert.deepEqual(fieldOf(answer, ['ДополнительныеРеквизиты'], 'Значение').type?.compositions, [PROPERTY_RECORD], 'характеристика в ТЧ');
		assert.equal(fieldOf(answer, [], 'Наименование').type?.compositions, undefined, 'у поля без наборов составов нет');
		// Записи — общие объекты верхнего ключа, сами записи составов не получают
		assert.equal(person.type?.compositions?.[0], answer.typeCompositions?.[1]);
		for (const record of answer.typeCompositions ?? []) {
			assert.equal((record as TypeDto).compositions, undefined);
		}
		// Без пришитых составов ответ совпадает с исходным байт в байт
		const stripped = JSON.parse(JSON.stringify(answer, (key, value) => (key === 'compositions' ? undefined : value)));
		assert.deepEqual(stripped, before);
		// Повторный вызов ничего не удваивает
		types.attachTypeCompositions(answer);
		assert.deepEqual(person.type?.compositions, [PERSON_RECORD]);
	});

	test('ответ без ключа, с пустым ключом или без совпадений — как есть', () => {
		// Ключа нет, когда в полях нет определяемых типов и характеристик или их описания не найдены
		const withoutKey = copy(description('Справочник.Пользователи'));
		delete withoutKey.typeCompositions;
		const plainAnswer = copy(withoutKey);
		assert.deepEqual(types.attachTypeCompositions(plainAnswer), withoutKey);
		const empty = Object.assign(copy(description('Справочник.Пользователи')), { typeCompositions: [] as Composition[] });
		types.attachTypeCompositions(empty);
		assert.equal(fieldOf(empty, [], 'ФизическоеЛицо').type?.compositions, undefined);
		const garbage = Object.assign(copy(description('Справочник.Пользователи')), {
			typeCompositions: [null, 'cfg:DefinedType.ФизическоеЛицо', { types: [PERSON_REF] }, { source: '', types: [PERSON_REF] }] as unknown as Composition[],
		});
		types.attachTypeCompositions(garbage);
		assert.equal(fieldOf(garbage, [], 'ФизическоеЛицо').type?.compositions, undefined, 'записи без источника отброшены');
		const foreign = Object.assign(copy(description('Справочник.Пользователи')), { typeCompositions: [ACCESS_RECORD] });
		types.attachTypeCompositions(foreign);
		assert.equal(fieldOf(foreign, [], 'ФизическоеЛицо').type?.compositions, undefined, 'чужой источник не пришивается');
		for (const value of [null, undefined, 'строка', 42]) {
			assert.equal(types.attachTypeCompositions(value), value);
		}
	});

	test('модель cf-dcs-info: UUID без учёта регистра — в полях наборов (и вложенных), вычисляемых полях, параметрах; характеристика — по набору', () => {
		const characteristic: Composition = { source: 'cfg:Characteristic.РазделыДатЗапретаИзменения', types: [PERSON_REF, DIVISION_REF], typeSets: [] };
		const model = {
			dataSets: [
				{
					name: 'Объединение',
					type: 'union',
					fields: [{ dataPath: 'Кто', valueType: plain([], [], [DIVISION_UUID.toUpperCase()]) }],
					items: [{ name: 'Вложенный', type: 'query', query: '', fields: [{ dataPath: 'Раздел', valueType: plain([], ['cfg:Characteristic.РазделыДатЗапретаИзменения']) }] }],
				},
			],
			calculatedFields: [{ name: 'Вычисляемое', valueType: plain(['xs:string'], [], [DIVISION_UUID]) }],
			parameters: [{ name: 'Подразделение', valueType: Object.assign(plain([], [], [DIVISION_UUID]), { definedTypes: ['Подразделение'] }) }],
			typeCompositions: [{ source: DIVISION_UUID, name: 'Подразделение', types: [DIVISION_REF], typeSets: [] }, characteristic],
		};
		types.attachTypeCompositions(model);
		const record = model.typeCompositions[0];
		assert.deepEqual((model.dataSets[0].fields[0].valueType as TypeDto).compositions, [record], 'UUID в верхнем регистре');
		assert.deepEqual((model.dataSets[0].items[0].fields[0].valueType as TypeDto).compositions, [characteristic]);
		assert.deepEqual((model.calculatedFields[0].valueType as TypeDto).compositions, [record]);
		assert.deepEqual((model.parameters[0].valueType as TypeDto).compositions, [record]);
		assert.deepEqual(types.expandedTypes(model.calculatedFields[0].valueType), { types: ['xs:string', DIVISION_REF], typeSets: [], typeIds: [] });
	});

	test('expandedTypes и refTypeNames: определяемый тип, характеристика, UUID, наборы вида, «любая ссылка», без составов', () => {
		const withRecords = (dto: TypeDto, records: Composition[]): TypeDto => Object.assign(dto, { compositions: records });
		// Определяемый тип из одной ссылки
		const person = withRecords(plain([], ['cfg:DefinedType.ФизическоеЛицо']), [PERSON_RECORD]);
		assert.deepEqual(types.expandedTypes(person), { types: [PERSON_REF], typeSets: [], typeIds: [] });
		assert.deepEqual(types.refTypeNames(person), [PERSON_REF]);
		// Характеристика: примитивы уходят в types, но ссылками не считаются
		const property = withRecords(plain([], ['cfg:Characteristic.ДополнительныеРеквизитыИСведения']), [PROPERTY_RECORD]);
		assert.deepEqual(types.expandedTypes(property).types, PROPERTY_RECORD.types);
		assert.deepEqual(types.refTypeNames(property), PROPERTY_RECORD.types.filter((name) => name.startsWith('cfg:')));
		// UUID схемы — без учёта регистра, из typeIds уходит
		const uuid = withRecords(plain(['xs:string'], [], [DIVISION_UUID.toUpperCase(), 'ffffffff-0000-0000-0000-000000000000']), [
			{ source: DIVISION_UUID, name: 'Подразделение', types: [DIVISION_REF], typeSets: [] },
		]);
		assert.deepEqual(types.expandedTypes(uuid), { types: ['xs:string', DIVISION_REF], typeSets: [], typeIds: ['ffffffff-0000-0000-0000-000000000000'] });
		// Набор вида и «любая ссылка» остаются наборами — и сами, и внутри состава; повтор не задваивается
		const sets = withRecords(plain([PERSON_REF], ['cfg:CatalogRef', 'cfg:DefinedType.Смешанный', 'cfg:AnyRef']), [
			{ source: 'cfg:definedtype.смешанный', types: [PERSON_REF, 'cfg:DocumentRef.Заказ'], typeSets: ['cfg:AnyIBRef', 'cfg:DefinedType.Цикл'] },
		]);
		assert.deepEqual(types.expandedTypes(sets), {
			types: [PERSON_REF, 'cfg:DocumentRef.Заказ'],
			typeSets: ['cfg:CatalogRef', 'cfg:AnyIBRef', 'cfg:DefinedType.Цикл', 'cfg:AnyRef'],
			typeIds: [],
		});
		assert.deepEqual(types.refTypeNames(sets), [PERSON_REF, 'cfg:DocumentRef.Заказ']);
		// Без составов — те же списки; определяемый тип без записи остаётся набором и ссылок не даёт
		const bare = plain(['xs:string', 'cfg:CatalogRef.Пользователи'], ['cfg:DefinedType.ФизическоеЛицо', 'cfg:CatalogRef'], [DIVISION_UUID]);
		assert.deepEqual(types.expandedTypes(bare), bare);
		assert.deepEqual(types.refTypeNames(bare), ['cfg:CatalogRef.Пользователи']);
		assert.deepEqual(types.refTypeNames(plain([], ['cfg:DefinedType.ФизическоеЛицо'])), []);
		assert.deepEqual(types.expandedTypes(null), { types: [], typeSets: [], typeIds: [] });
		assert.deepEqual(types.expandedTypes(withRecords(plain([], ['cfg:DefinedType.ФизическоеЛицо']), [null, { types: [PERSON_REF] }] as unknown as Composition[])), {
			types: [],
			typeSets: ['cfg:DefinedType.ФизическоеЛицо'],
			typeIds: [],
		});
	});

	test('Пользователи.ФизическоеЛицо раскрывается: дети — поля физлиц, путь ФизическоеЛицо.Наименование', () => {
		const person = fieldOf(USERS_ATTACHED, [], 'ФизическоеЛицо');
		assert.equal(types.expandable(person.type), true);
		const children = types.typeChildren(person.type, withCompositions);
		assert.deepEqual(names(children.children), names(PERSONS.tables[0].fields));
		assert.deepEqual(children.pending, []);
		// Описания ещё нет — запрос по ссылке из состава
		assert.deepEqual(types.typeChildren(person.type, nothing).pending, [{ key: 'СПРАВОЧНИК._ДЕМОФИЗИЧЕСКИЕЛИЦА', request: { typeName: PERSON_REF } }]);
		// Строка дерева справочника несёт стрелку
		const row = types.typeChildren(ref('cfg:CatalogRef.Пользователи'), withCompositions).children.find((item) => item.name === 'ФизическоеЛицо');
		assert.equal(row?.expandable, true);
		assert.equal(row?.typeText, 'DefinedType.ФизическоеЛицо', 'подпись типа не меняется');
		assert.deepEqual(types.walkType(ref('cfg:CatalogRef.Пользователи'), ['ФизическоеЛицо', 'Наименование'], withCompositions).type, plain(['xs:string']));
		// Глубже: Подразделение → Руководитель (физлицо) → ИНН
		assert.deepEqual(types.walkType(ref('cfg:CatalogRef.Пользователи'), ['Подразделение', 'Руководитель', 'ИНН'], withCompositions).type, plain(['xs:string']));
		// Характеристика ТЧ: 4 ссылки — в пределах MAX_UNION_REFS
		assert.equal(types.expandable(fieldOf(USERS_ATTACHED, ['ДополнительныеРеквизиты'], 'Значение').type), true);
	});

	test('ЗначениеДоступа из 25 ссылок остаётся закрытым (MAX_UNION_REFS = 6), а ссылки для связи — все', () => {
		assert.equal(types.MAX_UNION_REFS, 6);
		const access: TypeDto = Object.assign(plain([], ['cfg:DefinedType.ЗначениеДоступа']), { compositions: [ACCESS_RECORD] });
		assert.equal(types.expandable(access), false);
		assert.deepEqual(types.typeChildren(access, nothing), { children: [], pending: [] }, 'описаний не просит');
		assert.equal(types.refTypeNames(access).length, 25);
	});

	test('стандартный период в составе определяемого типа даёт свои свойства', () => {
		const period: TypeDto = Object.assign(plain([], ['cfg:DefinedType.Период']), {
			compositions: [{ source: 'cfg:DefinedType.Период', types: ['v8:StandardPeriod'], typeSets: [] }],
		});
		assert.equal(types.expandable(period), true);
		assert.deepEqual(names(types.typeChildren(period, nothing).children), ['ДатаНачала', 'ДатаОкончания', 'Вариант']);
	});

	test('mergeTypes переносит составы: объединение по источнику, первая запись побеждает; без составов — без ключа compositions', () => {
		const person: TypeDto = Object.assign(plain([], ['cfg:DefinedType.ФизическоеЛицо']), { compositions: [PERSON_RECORD] });
		const users = ref('cfg:CatalogRef.Пользователи');
		const merged = types.mergeTypes([person, users]);
		assert.deepEqual(merged, { types: ['cfg:CatalogRef.Пользователи'], typeSets: ['cfg:DefinedType.ФизическоеЛицо'], typeIds: [], compositions: [PERSON_RECORD] });
		assert.equal(types.expandable(merged), true);
		assert.deepEqual(types.refTypeNames(merged), ['cfg:CatalogRef.Пользователи', PERSON_REF]);
		const other: TypeDto = Object.assign(plain([], ['cfg:DefinedType.ФизическоеЛицо', 'cfg:DefinedType.Подразделение']), {
			compositions: [{ source: 'CFG:DEFINEDTYPE.ФИЗИЧЕСКОЕЛИЦО', types: ['cfg:CatalogRef.Другое'], typeSets: [] }, DIVISION_RECORD],
		});
		assert.deepEqual(types.mergeTypes([person, other])?.compositions, [PERSON_RECORD, DIVISION_RECORD], 'тёзка-источник второго типа не перебивает первый');
		assert.equal(types.mergeTypes([person]), person, 'один тип — как есть');
		assert.deepEqual(types.mergeTypes([users, ref('cfg:CatalogRef._ДемоОрганизации')]), {
			types: ['cfg:CatalogRef.Пользователи', 'cfg:CatalogRef._ДемоОрганизации'],
			typeSets: [],
			typeIds: [],
		});
		// Тёзки детей составного типа сливаются вместе с составами
		const rows = types.typeChildren(plain(['cfg:CatalogRef.Пользователи', 'cfg:CatalogRef._ДемоПодразделения']), withCompositions).children;
		assert.equal(rows.find((row) => row.name === 'ФизическоеЛицо')?.expandable, true);
	});

	test('&Параметр с определяемым типом (UUID в typeIds модели) — дети по составу; 25 ссылок — нет; без ключа — нет', () => {
		const model = copy(USERS) as typeof USERS & { typeCompositions?: Composition[] };
		delete model.typeCompositions;
		types.attachTypeCompositions(model);
		assert.deepEqual(childPathsWith(model, 'expr-param', 'Подразделение', 'param', withCompositions), [], 'модель без typeCompositions: детей нет');
		model.typeCompositions = [{ source: DIVISION_UUID.toUpperCase(), name: 'Подразделение', types: [DIVISION_REF], typeSets: [] }];
		types.attachTypeCompositions(model);
		assert.deepEqual(childPathsWith(model, 'expr-param', 'Подразделение', 'param', withCompositions), names(DIVISIONS.tables[0].fields));
		assert.deepEqual(childPathsWith(model, 'expr-param', 'Подразделение.Руководитель', 'param', withCompositions), names(PERSONS.tables[0].fields));
		const access = {
			parameters: [{ name: 'ЗначениеДоступа', valueType: plain([], [], ['9a33b5dc-a8f1-496e-9961-95890984cd86']) }],
			typeCompositions: [Object.assign({}, ACCESS_RECORD, { source: '9a33b5dc-a8f1-496e-9961-95890984cd86', name: 'ЗначениеДоступа' })],
		};
		types.attachTypeCompositions(access);
		assert.deepEqual(childPathsWith(access, 'expr-param', 'ЗначениеДоступа', 'param', withCompositions), []);
	});

	test('колонка набора-запроса из поля определяемого типа несёт состав и раскрывается', () => {
		const text = 'ВЫБРАТЬ\n\tП.ФизическоеЛицо КАК ФЛ,\n\tП.Подразделение КАК Подразделение\nИЗ\n\tСправочник.Пользователи КАК П';
		const column = types.queryColumnType(text, 'ФЛ', withCompositions, { queryModel });
		assert.deepEqual(column.type?.compositions, [PERSON_RECORD]);
		assert.equal(types.expandable(column.type), true);
		assert.deepEqual(types.queryColumnType(text, 'ФЛ.Наименование', withCompositions, { queryModel }).type, plain(['xs:string']));
		// Поле набора без записанного типа: дети по выведенному типу (модель ПользователиПоПодразделениям, колонка Подразделение)
		assert.deepEqual(childPathsWith(USERS, 'settings:any', 'Подразделение', 'path', withCompositions), names(DIVISIONS.tables[0].fields));
		const model = { dataSets: [{ name: 'Н', type: 'query', query: text, fields: [{ dataPath: 'ФЛ', field: 'ФЛ' }] }] };
		assert.deepEqual(childPathsWith(model, 'expr-calc', 'ФЛ', 'path', withCompositions), names(PERSONS.tables[0].fields));
		// Объединение частей: составы обеих частей сохраняются
		const union = text + '\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tП.Подразделение,\n\tП.Подразделение\nИЗ\n\tСправочник.Пользователи КАК П';
		const merged = types.queryColumnType(union, 'ФЛ', withCompositions, { queryModel }).type;
		assert.deepEqual(merged?.compositions, [PERSON_RECORD, DIVISION_RECORD]);
		assert.deepEqual(types.refTypeNames(merged), [PERSON_REF, DIVISION_REF]);
		// Тот же запрос по описанию без пришитых составов: тип есть, но не раскрывается
		assert.equal(types.expandable(types.queryColumnType(text, 'ФЛ', loaded, { queryModel }).type), false);
	});

	test('без пришитых составов по всем полям фикстуры раскрытие — только по своим types (предел 6)', () => {
		const STATIC = new Set(['v8:StandardPeriod', 'v8:StandardBeginningDate']);
		const ownExpandable = (dto: TypeDto | null): boolean => {
			if (!dto) {
				return false;
			}
			if (dto.types.some((name) => STATIC.has(name))) {
				return true;
			}
			const refs = dto.types.filter((name) => types.refObjectOf(name));
			return refs.length > 0 && refs.length <= types.MAX_UNION_REFS;
		};
		let fields = 0;
		for (const entry of Object.values(tables.objects)) {
			for (const table of entry.description.tables) {
				for (const field of table.fields) {
					fields += 1;
					assert.equal(types.expandable(field.type), ownExpandable(field.type), `${table.name}.${field.name}`);
					if (field.type) {
						assert.deepEqual(types.expandedTypes(field.type), { types: field.type.types, typeSets: field.type.typeSets, typeIds: field.type.typeIds ?? [] });
					}
				}
			}
		}
		// Все поля 19 объектов фикстуры (с ТЧ и виртуальными таблицами): сырые описания пришитых составов не несут
		assert.ok(fields >= 780, `полей ${fields}`);
	});
});

describe('Определяемые типы и характеристики на ответах md-sparrow из фикстуры', () => {
	/** Фикстура так, как её видит webview после ответов: составы пришиты к копиям (сырые описания нужны тестам без составов). */
	const ATTACHED = new Map([...DESCRIPTIONS].map(([key, value]) => [key, types.attachTypeCompositions(copy(value))]));
	const live: Lookup = (key) => ATTACHED.get(key) ?? null;
	const COMPOSED_SET_RE = /^cfg:(?:DefinedType|Characteristic)\./;
	const OBJECT_REF_RE = /^[A-Za-z0-9]+:[A-Za-z]+Ref\.[^.]+$/;
	const STATIC = new Set(['v8:StandardPeriod', 'v8:StandardBeginningDate']);

	/**
	 * Составы ssl31 в фикстуре и число ссылок в каждом — сверка с выгрузкой БСП 3.1 (ФизическоеЛицо — одна
	 * ссылка, КонтактВзаимодействия — 6, ЗначениеДоступа — 25, _ДемоВидыСубконто — 7, деньги — число).
	 * Новый объект фикстуры с новым составом должен попасть сюда осознанно.
	 */
	const EXPECTED_REFS: Record<string, number> = {
		'cfg:DefinedType.КонтекстПроверокВеденияУчета': 0,
		'cfg:DefinedType.УточнениеКонтекстаПроверокВеденияУчета': 0,
		'cfg:DefinedType.ДенежнаяСуммаНеотрицательная': 0,
		'cfg:DefinedType.ДенежнаяСуммаЛюбогоЗнака': 0,
		'cfg:DefinedType.ФизическоеЛицо': 1,
		'cfg:DefinedType.Подразделение': 1,
		'cfg:DefinedType.Организация': 1,
		'cfg:DefinedType.СубъектПерсональныхДанных': 3,
		'cfg:Characteristic.ОбъектыАдресацииЗадач': 3,
		'cfg:Characteristic.ДополнительныеРеквизитыИСведения': 4,
		'cfg:DefinedType.ПредметЗадачи': 5,
		'cfg:DefinedType.КонтактВзаимодействия': 6,
		'cfg:Characteristic._ДемоВидыСубконто': 7,
		'cfg:DefinedType.ЗначениеДоступа': 25,
	};

	interface ComposedField {
		where: string;
		raw: QueryField;
		attached: QueryField;
		records: Composition[];
	}

	/** Поля фикстуры с определяемым типом или характеристикой: сырое поле, оно же с пришитым составом и записи состава ответа. */
	function composedFields(): ComposedField[] {
		const out: ComposedField[] = [];
		for (const [name, entry] of Object.entries(tables.objects)) {
			const attached = ATTACHED.get(name.toUpperCase());
			assert.ok(attached);
			const index = new Map((entry.description.typeCompositions ?? []).map((record) => [record.source.toUpperCase(), record]));
			entry.description.tables.forEach((table, t) => {
				table.fields.forEach((field, f) => {
					const sets = (field.type?.typeSets ?? []).filter((set) => COMPOSED_SET_RE.test(set));
					if (sets.length === 0) {
						return;
					}
					const records = sets.map((set) => index.get(set.toUpperCase()));
					assert.ok(
						records.every(Boolean),
						`${table.name}.${field.name}: нет записи состава для ${sets.join(', ')} — md-sparrow находит описание у всех типов ssl31`
					);
					out.push({ where: `${table.name}.${field.name}`, raw: field, attached: attached.tables[t].fields[f], records: records as Composition[] });
				});
			});
		}
		return out;
	}

	const refsOf = (names: string[]) => [...new Set(names.filter((name) => OBJECT_REF_RE.test(name)))];

	test('составы фикстуры сверены с выгрузкой БСП 3.1: источники, число ссылок, запись одного источника одинакова во всех объектах', () => {
		const seen = new Map<string, string>();
		for (const [name, entry] of Object.entries(tables.objects)) {
			for (const record of entry.description.typeCompositions ?? []) {
				const form = JSON.stringify(record);
				assert.ok(!seen.has(record.source) || seen.get(record.source) === form, `${name}: состав ${record.source} отличается от состава в другом объекте`);
				seen.set(record.source, form);
				assert.deepEqual(Object.keys(record), ['source', 'types', 'typeSets'], `${record.source}: форма записи cf-md-query-tables`);
				assert.deepEqual(record.typeSets, [], `${record.source}: наборов в составах ssl31 нет`);
			}
		}
		const counts = Object.fromEntries([...seen].map(([source, form]) => [source, refsOf((JSON.parse(form) as Composition).types).length]));
		assert.deepEqual(counts, EXPECTED_REFS);
		const record = (source: string) => JSON.parse(seen.get(source) ?? 'null') as Composition;
		assert.deepEqual(record('cfg:DefinedType.ФизическоеЛицо').types, [PERSON_REF]);
		assert.deepEqual(record('cfg:DefinedType.Подразделение').types, [DIVISION_REF]);
		assert.deepEqual(record('cfg:DefinedType.ДенежнаяСуммаНеотрицательная').types, ['xs:decimal']);
		assert.deepEqual(record('cfg:DefinedType.ДенежнаяСуммаЛюбогоЗнака').types, ['xs:decimal']);
		// Характеристика свойств — 4 ссылки и 4 примитива
		assert.equal(record('cfg:Characteristic.ДополнительныеРеквизитыИСведения').types.length, 8);
		// Ключа нет у объектов без определяемых типов и характеристик
		assert.equal(description('Справочник._ДемоФизическиеЛица').typeCompositions, undefined);
		assert.equal(description('КритерийОтбора.СвязанныеДокументы').typeCompositions, undefined);
	});

	test('поля с составом из 1–6 ссылок раскрываются, больше 6 — нет, составы из примитивов — нет; без пришитого состава — ни одно', () => {
		const tally = { open: 0, overLimit: 0, primitive: 0, sixRefs: 0, sevenPlus: 0 };
		const fields = composedFields();
		for (const { where, raw, attached, records } of fields) {
			const own = attached.type?.types ?? [];
			const expanded = [...own, ...records.flatMap((record) => record.types)];
			const refs = refsOf(expanded).filter((name) => types.refObjectOf(name));
			const expected = expanded.some((name) => STATIC.has(name)) || (refs.length > 0 && refs.length <= types.MAX_UNION_REFS);
			assert.equal(types.expandable(attached.type), expected, `${where}: ссылок в составе ${refs.length}`);
			assert.deepEqual(types.refTypeNames(attached.type), refsOf(expanded), `${where}: ссылки для связей — все, без предела`);
			// Подпись — по набору: списки типа не меняются, состав — отдельным ключом
			assert.deepEqual(attached.type?.typeSets, raw.type?.typeSets, where);
			assert.deepEqual(attached.type?.compositions, records, where);
			assert.equal(raw.type?.compositions, undefined, `${where}: сырое описание без пришитого состава`);
			assert.equal(types.expandable(raw.type), refsOf(own).length > 0 && refsOf(own).length <= types.MAX_UNION_REFS, `${where}: без состава — по своим types`);
			if (refs.length === 0) {
				tally.primitive += 1;
			} else if (expected) {
				tally.open += 1;
			} else {
				tally.overLimit += 1;
			}
			tally.sixRefs += refs.length === 6 ? 1 : 0;
			tally.sevenPlus += refs.length > 6 ? 1 : 0;
		}
		// Граница предела есть в фикстуре с обеих сторон: 6 ссылок (КонтактВзаимодействия) и 7 (_ДемоВидыСубконто), 25 (ЗначениеДоступа)
		assert.ok(tally.sixRefs > 0 && tally.sevenPlus > 0, JSON.stringify(tally));
		// Срез фикстуры: 26 полей раскрываются, 31 — за пределом (субконто, ЗначениеДоступа), 61 — деньги и строки
		assert.deepEqual({ open: tally.open, overLimit: tally.overLimit, primitive: tally.primitive }, { open: 26, overLimit: 31, primitive: 61 });
		assert.equal(fields.length, tally.open + tally.overLimit + tally.primitive);
	});

	test('Пользователи.ФизическоеЛицо по живым ответам: дети — реквизиты физлиц фикстуры, путь через точку, колонка «ФЛ.»', () => {
		const users = live('СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ');
		assert.ok(users);
		const person = fieldOf(users, [], 'ФизическоеЛицо');
		assert.equal(types.expandable(person.type), true);
		const children = types.typeChildren(person.type, live);
		assert.deepEqual(names(children.children), mainFields('Справочник._ДемоФизическиеЛица'));
		assert.deepEqual(children.pending, []);
		assert.deepEqual(types.typeChildren(person.type, nothing).pending, [{ key: 'СПРАВОЧНИК._ДЕМОФИЗИЧЕСКИЕЛИЦА', request: { typeName: PERSON_REF } }]);
		const userRef = ref('cfg:CatalogRef.Пользователи');
		const row = types.typeChildren(userRef, live).children.find((item) => item.name === 'ФизическоеЛицо');
		assert.equal(row?.expandable, true);
		assert.equal(row?.typeText, 'DefinedType.ФизическоеЛицо', 'подпись по умолчанию — по набору, состав в неё не входит');
		assert.deepEqual(types.walkType(userRef, ['ФизическоеЛицо', 'Наименование'], live).type?.types, ['xs:string']);
		assert.deepEqual(types.walkType(userRef, ['ФизическоеЛицо', 'Гражданство'], live).type?.types, ['cfg:CatalogRef.СтраныМира']);
		// Подразделение (состав — одна ссылка) раскрывается и без описания цели: ждёт его
		assert.deepEqual(types.typeChildren(fieldOf(users, [], 'Подразделение').type, nothing).pending.map((item) => item.key), ['СПРАВОЧНИК._ДЕМОПОДРАЗДЕЛЕНИЯ']);
		// Колонка набора-запроса из поля определяемого типа — тип с составом, «ФЛ.» — реквизиты физлиц
		const text = 'ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка,\n\tП.ФизическоеЛицо КАК ФЛ\nИЗ\n\tСправочник.Пользователи КАК П';
		const column = types.queryColumnType(text, 'ФЛ', live, { queryModel });
		assert.equal(types.expandable(column.type), true);
		assert.deepEqual(types.queryColumnType(text, 'ФЛ.ИНН', live, { queryModel }).type?.types, ['xs:string']);
		const model = { dataSets: [{ name: 'Н', type: 'query', query: text, fields: [{ dataPath: 'ФЛ', field: 'ФЛ' }] }] };
		assert.deepEqual(childPathsWith(model, 'expr-calc', 'ФЛ', 'path', live), mainFields('Справочник._ДемоФизическиеЛица'));
		// Тот же запрос по сырой фикстуре, без пришитых составов: тип есть, раскрытия нет
		assert.equal(types.expandable(types.queryColumnType(text, 'ФЛ', loaded, { queryModel }).type), false);
	});

	test('границы предела на живых ответах: КонтактВзаимодействия (6) — дети описанных ссылок, ЗначениеДоступа (25) и _ДемоВидыСубконто (7) — без запросов описаний', () => {
		const letter = live('ДОКУМЕНТ.ЭЛЕКТРОННОЕПИСЬМОВХОДЯЩЕЕ');
		assert.ok(letter);
		const contact = fieldOf(letter, [], 'ОтправительКонтакт');
		assert.equal(types.refTypeNames(contact.type).length, 6);
		assert.equal(types.expandable(contact.type), true);
		// Описаний ещё нет — запрос по каждой из 6 ссылок, по одному
		assert.equal(new Set(types.typeChildren(contact.type, nothing).pending.map((item) => item.key)).size, 6);
		// В фикстуре описаны физлица, пользователи и контрагенты: их реквизиты слиты, тёзки — одной строкой
		const children = names(types.typeChildren(contact.type, live).children);
		for (const object of ['Справочник._ДемоФизическиеЛица', 'Справочник.Пользователи', 'Справочник._ДемоКонтрагенты']) {
			for (const name of mainFields(object)) {
				assert.ok(children.includes(name), `${object}.${name} среди детей КонтактВзаимодействия`);
			}
		}
		assert.equal(new Set(children.map((name) => name.toUpperCase())).size, children.length, 'тёзки не задвоены');
		const access = fieldOf(letter, ['НаборыЗначенийДоступа'], 'ЗначениеДоступа');
		assert.equal(types.refTypeNames(access.type).length, 25);
		assert.equal(types.expandable(access.type), false);
		assert.deepEqual(types.typeChildren(access.type, nothing), { children: [], pending: [] }, 'описаний не просит');
		const postings = live('РЕГИСТРБУХГАЛТЕРИИ._ДЕМОЖУРНАЛПРОВОДОКБУХГАЛТЕРСКОГОУЧЕТА');
		assert.ok(postings);
		const subconto = postings.tables.flatMap((table) => table.fields).filter((field) => (field.type?.typeSets ?? []).includes('cfg:Characteristic._ДемоВидыСубконто'));
		assert.ok(subconto.length > 0);
		for (const field of subconto) {
			assert.equal(types.refTypeNames(field.type).length, 7, field.name);
			assert.equal(types.expandable(field.type), false, field.name);
		}
		// Характеристика свойств: 4 ссылки и 4 примитива — в пределах, раскрывается
		assert.equal(types.expandable(fieldOf(letter, ['ДополнительныеРеквизиты'], 'Значение').type), true);
	});

	test('деньги определяемым типом на ответах фикстуры: раскрытый тип числовой в поле части и в колонке подзапроса; без пришитого состава — набор', () => {
		const money = 'cfg:DefinedType.ДенежнаяСуммаНеотрицательная';
		const text = [
			'ВЫБРАТЬ',
			'\tС.СуммаОплаты КАК СуммаОплаты,',
			'\tВл.Сумма КАК Сумма',
			'ИЗ',
			'\tДокумент._ДемоСчетНаОплатуПокупателю КАК С',
			'\t\tЛЕВОЕ СОЕДИНЕНИЕ (ВЫБРАТЬ Т.Ссылка КАК Ссылка, Т.Сумма КАК Сумма ИЗ Документ._ДемоСчетНаОплатуПокупателю.Товары КАК Т) КАК Вл',
			'\t\tПО С.Ссылка = Вл.Ссылка',
		].join('\n');
		const parsed = queryModel.parse(text);
		assert.deepEqual(parsed.diagnostics, []);
		const batch = parsed.model as unknown as { statements: Array<{ parts: Array<{ from: Array<{ joins: Array<{ source: { query: unknown } }> }> }> }> };
		const part = batch.statements[0].parts[0];
		const paid = types.partExpressionType(batch, 0, part, 'С.СуммаОплаты', live, { queryModel }).type;
		assert.deepEqual(paid?.typeSets, [money], 'подпись — «ОпределяемыйТип…»');
		assert.deepEqual(types.expandedTypes(paid), { types: ['xs:decimal'], typeSets: [], typeIds: [] });
		const subquery = part.from[0].joins[0].source.query;
		const sum = types.subqueryColumnType(batch, 0, subquery, 'Сумма', live, { queryModel }).type;
		assert.deepEqual(types.expandedTypes(sum), { types: ['xs:decimal'], typeSets: [], typeIds: [] }, 'колонка подзапроса несёт состав');
		assert.deepEqual(types.expandedTypes(types.partExpressionType(batch, 0, part, 'С.СуммаОплаты', loaded, { queryModel }).type), { types: [], typeSets: [money], typeIds: [] });
	});
});

describe('Конструктор запроса: тип выражения части и колонки вложенного запроса', () => {
	const MONEY = 'cfg:DefinedType.ДенежнаяСуммаНеотрицательная';
	const plainType = (typeNames: string[], typeSets: string[] = []): TypeDto => ({ types: typeNames, typeSets, typeIds: [] });
	const fieldOfType = (name: string, type: TypeDto | null): QueryField => ({ name, nameEn: '', kind: 'attribute', type, synonym: '' });

	/**
	 * Явные описания: справочник валют и документ с деньгами определяемого типа, состав —
	 * typeCompositions ответа в форме md-sparrow. Деньги из фикстуры проверяет блок на ответах md-sparrow.
	 */
	function answers(withComposition: boolean): Description[] {
		const valuta: Description = {
			object: 'Справочник.Валюты',
			kind: 'catalog',
			tables: [
				{
					name: 'Справочник.Валюты',
					kind: 'main',
					fields: [
						fieldOfType('Ссылка', plainType(['cfg:CatalogRef.Валюты'])),
						fieldOfType('Наименование', plainType(['xs:string'])),
						fieldOfType('Курс', plainType(['xs:decimal'])),
						fieldOfType('Владелец', plainType(['cfg:CatalogRef.Пользователи'])),
					],
				},
			],
		};
		const invoice: Description = {
			object: 'Документ.Счет',
			kind: 'document',
			tables: [{ name: 'Документ.Счет', kind: 'main', fields: [fieldOfType('Ссылка', plainType(['cfg:DocumentRef.Счет'])), fieldOfType('СуммаОплаты', plainType([], [MONEY]))] }],
		};
		if (withComposition) {
			invoice.typeCompositions = [{ source: MONEY, types: ['xs:decimal'], typeSets: [] }];
		}
		return [valuta, invoice].map((answer) => types.attachTypeCompositions(answer));
	}
	const KNOWN = answers(true);
	/** Кэш вкладки: свои описания и фикстура (Пользователи — для пути через ссылку), прочего «нет». */
	const lookupOf =
		(list: Description[]): Lookup =>
		(key) =>
			list.find((answer) => answer.object.toUpperCase() === key) ?? loaded(key);
	const known = lookupOf(KNOWN);
	type Batch = { statements: Array<{ type: string; parts: Array<{ from: Array<{ source: { kind: string; query?: unknown } }> }> }> };
	const parse = (text: string): Batch => {
		const result = queryModel.parse(text);
		assert.deepEqual(result.diagnostics, [], text);
		return result.model as unknown as Batch;
	};
	const partAt = (batch: Batch, statement: number, part = 0) => batch.statements[statement].parts[part];

	test('путь, ЕСТЬNULL, ВЫРАЗИТЬ, путь через ссылку и без алиаса; NULL, параметр и выражение — без типа; первый проход просит описание', () => {
		const batch = parse('ВЫБРАТЬ\n\tВал.Ссылка КАК Ссылка,\n\tВал.Курс КАК Курс\nИЗ\n\tСправочник.Валюты КАК Вал');
		const part = partAt(batch, 0);
		const typeOf = (expr: string, lookup: Lookup = known) => types.partExpressionType(batch, 0, part, expr, lookup, { queryModel });
		const first = typeOf('Вал.Ссылка', nothing);
		assert.deepEqual(first, { type: null, pending: [{ key: 'СПРАВОЧНИК.ВАЛЮТЫ', request: { queryTable: 'Справочник.Валюты' } }] });
		assert.deepEqual(typeOf('Вал.Ссылка').type?.types, ['cfg:CatalogRef.Валюты']);
		assert.deepEqual(typeOf('ЕСТЬNULL(Вал.Курс, 0)').type?.types, ['xs:decimal']);
		assert.deepEqual(typeOf('Наименование').type?.types, ['xs:string'], 'путь без алиаса — у единственного источника');
		assert.deepEqual(typeOf('Вал.Владелец.Ссылка').type?.types, ['cfg:CatalogRef.Пользователи'], 'через ссылку — по описанию Пользователей');
		assert.deepEqual(typeOf('ВЫРАЗИТЬ(Вал.Владелец КАК Справочник.Пользователи)').type?.types, ['cfg:CatalogRef.Пользователи']);
		for (const expr of ['NULL', '&Дата', 'Х.Ссылка', 'Вал.Курс > 0', '', '   ']) {
			assert.equal(typeOf(expr).type, null, expr);
		}
		assert.deepEqual(types.partExpressionType(batch, 0, part, 'Вал.Ссылка', known, null), { type: null, pending: [] }, 'без модуля разбора — ничего');
		assert.deepEqual(types.partExpressionType(batch, 0, null, 'Вал.Ссылка', known, { queryModel }), { type: null, pending: [] });
	});

	test('вторая часть объединения и временная таблица пакета; ВТ внешнего пакета у вложенного конструктора (outerTemp)', () => {
		const text = [
			'ВЫБРАТЬ Вал.Ссылка КАК Ссылка ПОМЕСТИТЬ ВТ_Валюты ИЗ Справочник.Валюты КАК Вал',
			';',
			'ВЫБРАТЬ ВТ.Ссылка КАК Ссылка ИЗ ВТ_Валюты КАК ВТ',
			'ОБЪЕДИНИТЬ ВСЕ',
			'ВЫБРАТЬ С.Ссылка ИЗ Документ.Счет КАК С',
		].join('\n');
		const batch = parse(text);
		assert.deepEqual(types.partExpressionType(batch, 1, partAt(batch, 1, 0), 'ВТ.Ссылка', known, { queryModel }).type?.types, ['cfg:CatalogRef.Валюты'], 'ВТ — по запросу-создателю');
		assert.deepEqual(types.partExpressionType(batch, 1, partAt(batch, 1, 1), 'С.Ссылка', known, { queryModel }).type?.types, ['cfg:DocumentRef.Счет']);
		assert.equal(types.partExpressionType(batch, 0, partAt(batch, 1, 0), 'ВТ.Ссылка', known, { queryModel }).type, null, 'ВТ видна только после своего запроса');
		// Вложенный конструктор: своя модель из одного запроса, ВТ — во внешнем пакете
		const nested = parse('ВЫБРАТЬ Вн.Ссылка КАК Ссылка ИЗ ВТ_Валюты КАК Вн');
		const outerTemp = [{ name: 'вт_валюты', statement: 0, batch }];
		assert.equal(types.partExpressionType(nested, 0, partAt(nested, 0), 'Вн.Ссылка', known, { queryModel }).type, null, 'без внешних ВТ — не выводится');
		assert.deepEqual(types.partExpressionType(nested, 0, partAt(nested, 0), 'Вн.Ссылка', known, { queryModel, outerTemp }).type?.types, ['cfg:CatalogRef.Валюты']);
		assert.deepEqual(types.subqueryColumnType(nested, 0, nested.statements[0], 'Ссылка', known, { queryModel, outerTemp }).type?.types, ['cfg:CatalogRef.Валюты']);
	});

	test('колонка вложенного запроса: в ИЗ и в соединении, объединение частей подзапроса, ВТ до номера запроса, неизвестная колонка', () => {
		const text = [
			'ВЫБРАТЬ Вал.Ссылка КАК Ссылка ПОМЕСТИТЬ ВТ_Валюты ИЗ Справочник.Валюты КАК Вал',
			';',
			'ВЫБРАТЬ Вл.Ссылка КАК Ссылка, Вл2.Курс КАК Курс',
			'ИЗ (ВЫБРАТЬ ВТ.Ссылка КАК Ссылка ИЗ ВТ_Валюты КАК ВТ',
			'    ОБЪЕДИНИТЬ ВСЕ',
			'    ВЫБРАТЬ Вал.Владелец ИЗ Справочник.Валюты КАК Вал) КАК Вл',
			'  ЛЕВОЕ СОЕДИНЕНИЕ (ВЫБРАТЬ Вал.Курс КАК Курс, Вал.Ссылка КАК Ссылка ИЗ Справочник.Валюты КАК Вал) КАК Вл2',
			'  ПО Вл.Ссылка = Вл2.Ссылка',
		].join('\n');
		const batch = parse(text);
		const part = partAt(batch, 1) as unknown as { from: Array<{ source: { query: unknown }; joins: Array<{ source: { query: unknown } }> }> };
		const fromQuery = part.from[0].source.query;
		const joinQuery = part.from[0].joins[0].source.query;
		const column = (subquery: unknown, name: string, statementIndex = 1, lookup: Lookup = known) => types.subqueryColumnType(batch, statementIndex, subquery, name, lookup, { queryModel });
		assert.deepEqual(column(fromQuery, 'Ссылка').type?.types, ['cfg:CatalogRef.Валюты', 'cfg:CatalogRef.Пользователи'], 'объединение типов частей подзапроса');
		assert.deepEqual(column(joinQuery, 'курс').type?.types, ['xs:decimal']);
		assert.equal(column(fromQuery, 'Ссылка', 0).type, null, 'ВТ видна только после своего запроса');
		assert.equal(column(joinQuery, 'НетТакой').type, null);
		assert.equal(column(joinQuery, 'Курс.Х').type, null, 'колонка — одно имя');
		assert.deepEqual(
			column(joinQuery, 'Курс', 1, nothing).pending.map((item) => item.key),
			['СПРАВОЧНИК.ВАЛЮТЫ'],
			'описания недостающих таблиц — в pending'
		);
		// Тип выражения части через подзапрос — тот же вывод
		assert.deepEqual(types.partExpressionType(batch, 1, part, 'Вл2.Курс', known, { queryModel }).type?.types, ['xs:decimal']);
		assert.deepEqual(types.subqueryColumnType(batch, 1, null, 'Курс', known, { queryModel }), { type: null, pending: [] });
	});

	test('форма значения: арифметика — число, сложение по слагаемым, литералы, ВЫБОР, функции, ВЫРАЗИТЬ к примитиву', () => {
		const shape = (expr: string) => types.valueShape(expr);
		const typeNames = (expr: string) => shape(expr).type?.types;
		assert.deepEqual(typeNames('Т.Количество * Т.Цена'), ['xs:decimal']);
		assert.deepEqual(typeNames('-Т.Сумма'), ['xs:decimal'], 'унарный минус');
		assert.deepEqual(typeNames('(Т.А - Т.Б) / 2'), ['xs:decimal']);
		assert.deepEqual(typeNames('Т.Сумма * -1 // комментарий'), ['xs:decimal']);
		assert.deepEqual(shape('Т.А + Т.Б'), { kind: 'plus', operands: ['Т.А', 'Т.Б'] }, 'сложение — по слагаемым');
		assert.deepEqual(typeNames('15'), ['xs:decimal']);
		assert.deepEqual(typeNames('"а-б * в"'), ['xs:string'], 'знаки внутри строки — не операторы');
		assert.deepEqual(typeNames('ИСТИНА'), ['xs:boolean']);
		assert.deepEqual(typeNames('ГОД(Т.Дата)'), ['xs:decimal']);
		assert.deepEqual(typeNames('РАЗНОСТЬДАТ(Т.Начало, Т.Конец, ДЕНЬ)'), ['xs:decimal']);
		assert.deepEqual(typeNames('НАЧАЛОПЕРИОДА(Т.Дата, МЕСЯЦ)'), ['xs:dateTime']);
		assert.deepEqual(typeNames('ПРЕДСТАВЛЕНИЕ(Т.Контрагент)'), ['xs:string']);
		assert.deepEqual(typeNames('ПОДСТРОКА(Т.Комментарий, 1, 100)'), ['xs:string']);
		assert.deepEqual(typeNames('ВЫРАЗИТЬ(Т.Имя КАК СТРОКА(100))'), ['xs:string']);
		assert.deepEqual(typeNames('CAST(T.Sum AS NUMBER(15, 2))'), ['xs:decimal']);
		assert.deepEqual(shape('ВЫБОР КОГДА Т.А > 0 ТОГДА Т.А ИНАЧЕ 0 КОНЕЦ'), { kind: 'merge', parts: ['Т.А', '0'] });
		assert.deepEqual(shape('ВЫБОР КОГДА Т.А ТОГДА ВЫБОР КОГДА Т.Б ТОГДА 1 ИНАЧЕ 2 КОНЕЦ ИНАЧЕ 3 КОНЕЦ'), {
			kind: 'merge',
			parts: ['ВЫБОР КОГДА Т.Б ТОГДА 1 ИНАЧЕ 2 КОНЕЦ', '3'],
		});
		assert.deepEqual(shape('ЕСТЬNULL(Т.А * Т.Б, 0)'), { kind: 'merge', parts: ['Т.А * Т.Б', '0'] });
		for (const expr of ['Т.А > 0', 'Т.А И Т.Б', 'НЕ Т.А', 'ВЫБОР КОГДА Т.А ТОГДА 1 КОНЕЦ + 1', 'Т.А *', '* Т.А', '&Параметр', 'Т.Путь', 'НЕИЗВЕСТНАЯ(Т.А)', '(Т.А']) {
			assert.equal(shape(expr).kind, 'unknown', expr);
		}
		// Колонки наборов и «через точку» правилом формы значения не пользуются
		assert.equal(types.classifyExpression('Т.Сумма * 2').kind, 'unknown');
	});

	test('тип выражения части по форме значения: произведение, ВЫБОР, сложение со строкой; ветка без типа и ожидание описаний', () => {
		const batch = parse('ВЫБРАТЬ\n\tВал.Ссылка КАК Ссылка,\n\tВал.Курс КАК Курс,\n\tВал.Курс * 2 КАК Двойной,\n\tВЫБОР КОГДА Вал.Курс > 1 ТОГДА Вал.Курс ИНАЧЕ 0 КОНЕЦ КАК Выбор,\n\tВал.Наименование + "!" КАК Имя\nИЗ\n\tСправочник.Валюты КАК Вал');
		const part = partAt(batch, 0);
		const typeOf = (expr: string, lookup: Lookup = known) => types.partExpressionType(batch, 0, part, expr, lookup, { queryModel });
		assert.deepEqual(typeOf('Вал.Курс * 2').type?.types, ['xs:decimal']);
		assert.deepEqual(typeOf('СУММА(Вал.Курс)').type?.types, ['xs:decimal']);
		assert.deepEqual(typeOf('ВЫБОР КОГДА Вал.Курс > 1 ТОГДА Вал.Курс ИНАЧЕ 0 КОНЕЦ').type?.types, ['xs:decimal'], 'ВЫБОР — объединение веток');
		assert.deepEqual(typeOf('Вал.Наименование + "!"').type?.types, ['xs:string'], 'сложение со строкой — строка');
		assert.deepEqual(typeOf('Вал.Курс + Вал.Курс').type?.types, ['xs:decimal']);
		assert.deepEqual(typeOf('ЕСТЬNULL(Вал.Ссылка, Вал.Владелец)').type?.types, ['cfg:CatalogRef.Валюты'], 'ЕСТЬNULL от пути — по первому аргументу');
		assert.equal(typeOf('ВЫБОР КОГДА Вал.Курс > 1 ТОГДА Х.Поле ИНАЧЕ 0 КОНЕЦ').type, null, 'ветка без типа — без типа');
		const waiting = typeOf('Вал.Курс * 2 + Вал.Курс', nothing);
		assert.deepEqual(waiting.type?.types, ['xs:decimal'], 'число решает сложение и без описаний');
		const pending = typeOf('ВЫБОР КОГДА ИСТИНА ТОГДА Вал.Курс ИНАЧЕ 0 КОНЕЦ', nothing);
		assert.equal(pending.type, null);
		assert.deepEqual(pending.pending.map((item) => item.key), ['СПРАВОЧНИК.ВАЛЮТЫ'], 'описание ветки запрашивается');
	});

	test('деньги определяемым типом: подпись по набору, с пришитым составом раскрытый тип числовой; без состава — набор', () => {
		const batch = parse('ВЫБРАТЬ С.СуммаОплаты КАК СуммаОплаты ИЗ Документ.Счет КАК С');
		const withKey = types.partExpressionType(batch, 0, partAt(batch, 0), 'С.СуммаОплаты', known, { queryModel }).type;
		assert.deepEqual(withKey?.typeSets, [MONEY], 'подпись — «ОпределяемыйТип…»');
		assert.deepEqual(types.expandedTypes(withKey), { types: ['xs:decimal'], typeSets: [], typeIds: [] });
		const withoutKey = types.partExpressionType(batch, 0, partAt(batch, 0), 'С.СуммаОплаты', lookupOf(answers(false)), { queryModel }).type;
		assert.deepEqual(types.expandedTypes(withoutKey), { types: [], typeSets: [MONEY], typeIds: [] });
	});
});

describe('Через точку: сообщение dcs/describe-type панели', () => {
	function request(message: Record<string, unknown>) {
		return dcsDescribeRequestOf({ type: DCS_DESCRIBE_TYPE_MESSAGE, ...message } as DcsPanelMessage);
	}

	test('ссылочный тип и таблица запроса — каталог вида и имя объекта', () => {
		assert.deepEqual(request({ typeName: 'cfg:CatalogRef.Пользователи' }), {
			echo: { typeName: 'cfg:CatalogRef.Пользователи' },
			folder: 'Catalogs',
			name: 'Пользователи',
		});
		assert.deepEqual(request({ queryTable: 'РегистрНакопления.Остатки.ОстаткиИОбороты' }), {
			echo: { queryTable: 'РегистрНакопления.Остатки.ОстаткиИОбороты' },
			folder: 'AccumulationRegisters',
			name: 'Остатки',
		});
		assert.equal((request({ queryTable: 'Document.Счет.Товары' }) as { folder: string }).folder, 'Documents');
	});

	test('виды и ссылки панели совпадают с модулем webview', () => {
		for (const kind of types.OBJECT_KINDS) {
			for (const head of [kind.ru, kind.en]) {
				const parsed = request({ queryTable: `${head}.Объект` });
				assert.ok(!('error' in parsed), `${head}: ${'error' in parsed ? parsed.error : ''}`);
				assert.equal(types.tableObjectOf(`${head}.Объект`)?.key, `${kind.ru}.Объект`.toUpperCase());
			}
			if (kind.ref) {
				const parsed = request({ typeName: `cfg:${kind.ref}.Объект` });
				assert.ok(!('error' in parsed), kind.ref);
				assert.ok(types.refObjectOf(`cfg:${kind.ref}.Объект`), kind.ref);
			}
		}
	});

	test('отказы: ни одного или оба поля, чужой тип, путь вместо имени', () => {
		for (const message of [
			{},
			{ typeName: 'cfg:CatalogRef.А', queryTable: 'Справочник.А' },
			{ typeName: 'cfg:DocumentJournalRef.Взаимодействия' },
			{ typeName: 'cfg:CatalogRef' },
			{ typeName: 'xs:string' },
			{ typeName: 'cfg:CatalogRef.../Configuration' },
			{ queryTable: 'Справочник' },
			{ queryTable: 'Справочник.../../Configuration' },
			{ queryTable: 'ВТ_Товары' },
			{ queryTable: 'Справочник.А\\Б' },
		]) {
			const parsed = request(message);
			assert.ok('error' in parsed, JSON.stringify(message));
		}
	});

	test('чтение, а не правка: маппер мутаций его не разбирает', () => {
		assert.equal(dcsMutationOf({ type: DCS_DESCRIBE_TYPE_MESSAGE, typeName: 'cfg:CatalogRef.А' } as DcsPanelMessage), undefined);
	});

	describe('файл объекта от макета', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-describe-'));
		after(() => fs.rmSync(root, { recursive: true, force: true }));
		const write = (relative: string, content: string) => {
			const file = path.join(root, relative);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, content, 'utf8');
		};
		const metaData = '<?xml version="1.0" encoding="UTF-8"?>\r\n<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.20"><Configuration/></MetaDataObject>';
		write('cf/Configuration.xml', metaData);
		write('cf/Catalogs/Валюты.xml', metaData);
		write('cf/Reports/Отчет/Templates/Схема/Ext/Template.xml', '<DataCompositionSchema/>');
		write('edt/src/Configuration/Configuration.mdo', '<mdclass:Configuration/>');
		write('edt/src/Catalogs/Валюты/Валюты.mdo', '<mdclass:Catalog/>');
		write('edt/src/Reports/Отчет/Templates/Схема/Template.dcs', '<DataCompositionSchema/>');
		write('erf/Отчет/Templates/Схема/Ext/Template.xml', '<DataCompositionSchema/>');

		test('выгрузка конфигуратора: Каталог/Имя.xml, версия из Configuration.xml, cwd — корень', async () => {
			const resolved = await resolveDcsDescribeTarget(path.join(root, 'cf/Reports/Отчет/Templates/Схема/Ext/Template.xml'), 'Catalogs', 'Валюты');
			assert.deepEqual(resolved, {
				target: { objectXml: path.join(root, 'cf', 'Catalogs', 'Валюты.xml'), cwd: path.join(root, 'cf'), schemaVersion: 'V2_20' },
			});
		});

		test('проект EDT: Каталог/Имя/Имя.mdo, версия не передаётся', async () => {
			const resolved = await resolveDcsDescribeTarget(path.join(root, 'edt/src/Reports/Отчет/Templates/Схема/Template.dcs'), 'Catalogs', 'Валюты');
			assert.deepEqual(resolved, {
				target: { objectXml: path.join(root, 'edt', 'src', 'Catalogs', 'Валюты', 'Валюты.mdo'), cwd: path.join(root, 'edt', 'src'), schemaVersion: '' },
			});
		});

		test('объекта нет в выгрузке — missing; макет вне выгрузки — outside', async () => {
			const missing = await resolveDcsDescribeTarget(path.join(root, 'cf/Reports/Отчет/Templates/Схема/Ext/Template.xml'), 'Documents', 'Счет');
			assert.ok('missing' in missing, JSON.stringify(missing));
			const outside = await resolveDcsDescribeTarget(path.join(root, 'erf/Отчет/Templates/Схема/Ext/Template.xml'), 'Catalogs', 'Валюты');
			assert.deepEqual(outside, { outside: true });
		});
	});
});

describe('Английский текст запроса: описание на en', () => {
	/**
	 * Описание регистра в форме cf-md-query-tables с lang en: имена вида, таблиц, стандартных
	 * реквизитов и суффиксов — английские, свои имена объекта — как в метаданных. Синтетика по
	 * контракту ответа (docs/cf-md-object.md md-sparrow), не снимок jar.
	 */
	const EN_KEY = 'EN:РЕГИСТРНАКОПЛЕНИЯ.СКЛАД';
	const EN_REGISTER: Description = {
		object: 'AccumulationRegister.Склад',
		kind: 'accumulationRegister',
		tables: [
			{
				name: 'AccumulationRegister.Склад',
				kind: 'main',
				fields: [
					{ name: 'Period', nameEn: 'Period', kind: 'standard', type: { types: ['xs:dateTime'], typeSets: [] } },
					{ name: 'Ответственный', nameEn: 'Ответственный', kind: 'dimension', type: ref('cfg:CatalogRef.Пользователи') },
				],
			},
			{
				name: 'AccumulationRegister.Склад.Balance',
				kind: 'virtual',
				fields: [
					{ name: 'Ответственный', nameEn: 'Ответственный', kind: 'dimension', type: ref('cfg:CatalogRef.Пользователи') },
					{ name: 'КоличествоBalance', nameEn: 'КоличествоBalance', kind: 'resource', type: { types: ['xs:decimal'], typeSets: [] } },
				],
			},
		],
	};
	/** Русского описания этого регистра нет: английский текст обязан спросить английское. */
	const withEnglish: Lookup = (key) => (key === EN_KEY ? EN_REGISTER : loaded(key));
	const TEXT = 'SELECT\n\tT.Ответственный AS Кто,\n\tT.КоличествоBalance AS Сколько\nFROM\n\tAccumulationRegister.Склад.Balance(&Period, ) AS T';

	test('таблица с английским видом в выводе — ключ и запрос английского описания', () => {
		const pending = types.queryColumnType(TEXT, 'Кто', nothing, { queryModel });
		assert.equal(pending.type, null);
		assert.deepEqual(pending.pending, [
			{ key: EN_KEY, request: { queryTable: 'AccumulationRegister.Склад.Balance', lang: 'en' } },
		]);
	});

	test('хвост Balance сходится с английским описанием, путь дальше — через русское описание ссылки', () => {
		assert.deepEqual(types.queryColumnType(TEXT, 'Кто', withEnglish, { queryModel }).type, ref('cfg:CatalogRef.Пользователи'));
		assert.deepEqual(types.queryColumnType(TEXT, 'Сколько', withEnglish, { queryModel }).type?.types, ['xs:decimal']);
		const name = types.queryColumnType(TEXT, 'Кто.Наименование', withEnglish, { queryModel });
		assert.ok(name.type, 'реквизит ссылки — из русского описания справочника (ключ без языка)');
		assert.deepEqual(name.pending, []);
	});

	test('английское и русское описания — разные ключи: одно другое не подменяет', () => {
		const russianOnly: Lookup = (key) => (key === 'РЕГИСТРНАКОПЛЕНИЯ.СКЛАД' ? EN_REGISTER : null);
		assert.equal(types.queryColumnType(TEXT, 'Кто', russianOnly, { queryModel }).type, null);
		assert.equal(types.tableObjectOf('AccumulationRegister.Склад.Balance', 'en')?.key, EN_KEY);
		assert.equal(types.tableObjectOf('AccumulationRegister.Склад.Balance')?.key, 'РЕГИСТРНАКОПЛЕНИЯ.СКЛАД', 'без языка — ключ без префикса');
		assert.deepEqual(types.refObjectOf('cfg:CatalogRef.Пользователи', 'en')?.request, { typeName: 'cfg:CatalogRef.Пользователи', lang: 'en' });
		assert.equal(types.refObjectOf('cfg:CatalogRef.Пользователи', 'en')?.key, 'EN:СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ');
	});

	test('ключ ответа панели — по эху с языком', () => {
		assert.equal(types.answerKeyOf({ type: 'describeType', queryTable: 'AccumulationRegister.Склад.Balance', lang: 'en', error: 'нет' }), EN_KEY);
		assert.equal(types.answerKeyOf({ type: 'describeType', queryTable: 'AccumulationRegister.Склад.Balance', lang: 'ru' }), 'РЕГИСТРНАКОПЛЕНИЯ.СКЛАД');
		assert.equal(types.answerKeyOf({ type: 'describeType', lang: 'en', description: { object: 'AccumulationRegister.Склад' } }), 'EN:ACCUMULATIONREGISTER.СКЛАД');
	});

	test('русский текст спрашивает русское описание без поля lang', () => {
		const text = 'ВЫБРАТЬ\n\tТ.Номенклатура КАК Н\nИЗ\n\tРегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Остатки КАК Т';
		const pending = types.queryColumnType(text, 'Н', nothing, { queryModel });
		assert.deepEqual(pending.pending, [
			{
				key: 'РЕГИСТРНАКОПЛЕНИЯ._ДЕМООСТАТКИТОВАРОВВМЕСТАХХРАНЕНИЯ',
				request: { queryTable: 'РегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Остатки' },
			},
		]);
	});
});

describe('Через точку: подключение в webview', () => {
	const read = (name: string) => fs.readFileSync(path.join(WEBVIEW, name), 'utf8');
	const panel = fs.readFileSync(path.join(ROOT, 'src', 'features', 'metadata', 'dcsEditorPanel.ts'), 'utf8');

	test('модули разбора и типов подключены до основного скрипта, панель подставляет их адреса', () => {
		const html = read('dcs-editor.html');
		for (const [placeholder, file] of [
			['{{QUERY_MODEL_JS_URI}}', 'dcs-editor-query-model.js'],
			['{{FIELD_TYPES_JS_URI}}', 'dcs-editor-field-types.js'],
		]) {
			const at = html.indexOf(placeholder);
			assert.ok(at >= 0, `в шаблоне нет ${placeholder}`);
			assert.ok(at < html.indexOf('{{JS_URI}}'), `${file} подключён позже скрипта`);
			assert.ok(panel.includes(`'${file}'`), `панель не знает ${file}`);
			assert.ok(panel.includes(`replaceAll('${placeholder}'`), `панель не подставляет ${placeholder}`);
		}
	});

	test('скрипт берёт модули, шлёт dcs/describe-type и принимает describeType', () => {
		const script = readEditorScript();
		assert.ok(script.includes('window.DcsFieldTypes'), 'скрипт не берёт модуль типов');
		assert.ok(script.includes('window.DcsQueryModel'), 'скрипт не берёт разборщик');
		assert.ok(script.includes("post('dcs/describe-type', item.request)"), 'запрос описания');
		assert.ok(script.includes("msg.type === 'describeType'"), 'ответ описания');
		assert.ok(panel.includes("msg.type === 'dcs/describe-type'"), 'панель разбирает запрос');
	});

	test('конструктору запроса доступны типы выражений части и колонок подзапроса: API редактора и окружение источников окна', () => {
		const script = readEditorScript();
		const dialog = read('dcs-editor-query-dialog.js');
		assert.ok(script.includes('partExpressionType: queryPartExpressionType'), 'API: тип выражения части');
		assert.ok(script.includes('subqueryColumnType: querySubqueryColumnType'), 'API: тип колонки подзапроса');
		assert.ok(/subqueryType:\s*\(source, column\)\s*=>/.test(dialog), 'окружение источников передаёт типы колонок подзапроса');
		assert.ok(dialog.includes('QE.groupingCandidates(') && dialog.includes('QE.aggregateTypeWarnings('), '«>>» и плашка «Группировки» — по типу');
		assert.ok(dialog.includes('FT.expandedTypes(result.type)'), 'деление по раскрытому типу');
	});

	test('тип выражения части для «>>» работает и в проекте EDT: обёртка не закрыта флагом дерева «База данных»', () => {
		const script = readEditorScript();
		const start = script.indexOf('function queryPartExpressionType(');
		assert.ok(start >= 0, 'нет обёртки queryPartExpressionType');
		const body = script.slice(start, script.indexOf('\n\t}\n', start));
		// Флаг metadataAvailable ставит только найденный Configuration.xml, а описания EDT (.mdo) читаются и без него
		assert.ok(!body.includes('metadataAvailable'), body);
		assert.ok(body.includes('fieldTypes.partExpressionType('), body);
		// Макет вне выгрузки гасит запросы описаний сам (ответ outside)
		assert.ok(/function describeLookup\(key\) \{\n\t\tif \(describeOutside\) \{/.test(script), 'вне выгрузки описаний нет');
	});

	test('составы пришиваются во всех точках приёма: присваивания model, готовые записи describeCache и queryTablesCache', () => {
		const script = readEditorScript();
		assert.ok(/function withTypeCompositions\(answer\)[\s\S]{0,400}attachTypeCompositions\(answer\)/.test(script), 'помощник зовёт attachTypeCompositions модуля');
		// Каждое присваивание модели (кроме чтения свойств чужих объектов) — через помощник
		// Закладки пишут модель через поле объекта ядра (core.model = …): такие присваивания проверяются так же, а сам
		// аксессор только передаёт значение
		const setter = /set model\(value\) \{\s*model = value;\s*\}/;
		assert.equal((script.match(new RegExp(setter.source, 'g')) || []).length, 1, 'аксессор model у объекта ядра не один');
		const assigns = [...script.replace(setter, '').matchAll(/(?<![.\w$])(?:core\.)?model\s*=(?![=>])\s*([^;\n]*)/g)];
		assert.ok(assigns.length >= 2, `присваиваний model: ${assigns.length}`);
		assert.ok(assigns.some((match) => match[0].startsWith('core.model')), 'присваивание модели закладкой не найдено');
		for (const match of assigns) {
			assert.ok(match[1].startsWith('withTypeCompositions('), `model без составов: ${match[0]}`);
		}
		// Готовые записи кэшей описаний — только из описания, прошедшего помощник
		assert.ok(!/description:\s*msg\.description/.test(script), 'описание сообщения уходит в кэш как есть');
		const readySets = [...script.matchAll(/(describeCache|queryTablesCache)\.set\([^;]*?state:\s*'ready',\s*description:\s*([^}\s]+)\s*}/g)];
		assert.ok(readySets.length >= 3, `готовых записей кэшей: ${readySets.length}`);
		for (const match of readySets) {
			const value = match[2];
			if (value.startsWith('withTypeCompositions(')) {
				continue;
			}
			// Переменная — последнее объявление выше по тексту, и оно из помощника
			const before = script.slice(0, match.index);
			const declared = [...before.matchAll(new RegExp('const\\s+' + value + '\\s*=\\s*([^;\\n]*)', 'g'))].pop();
			assert.ok(declared, `${match[1]}: не найдено объявление ${value}`);
			assert.ok(declared[1].includes('withTypeCompositions(msg.description)'), `${match[1]}: ${value} не прошёл помощник: ${declared[0]}`);
		}
	});
});

describe('Критерии отбора, последовательности и «Константы»', () => {
	const refs = (...names: string[]): TypeDto => ({ types: names, typeSets: [] });
	const field = (name: string, nameEn: string, type: TypeDto | null, kind = 'standard'): QueryField => ({ name, nameEn, kind, type, synonym: '' });
	/**
	 * Ответы cf-md-query-tables, урезанные до проверяемых полей: английской формы последовательности и констант
	 * в фикстуре нет, поэтому описания здесь явные.
	 */
	const CRITERION: Description = {
		object: 'КритерийОтбора.СвязанныеДокументы',
		kind: 'filterCriterion',
		tables: [
			{
				name: 'КритерийОтбора.СвязанныеДокументы',
				kind: 'main',
				fields: [field('Ссылка', 'Ref', refs('cfg:DocumentRef._ДемоЗаказПокупателя', 'cfg:DocumentRef._ДемоРеализацияТоваров'))],
			},
		],
	};
	const sequenceFields = (en: boolean): QueryField[] => [
		field(en ? 'Period' : 'Период', 'Period', refs('xs:dateTime')),
		field(en ? 'Recorder' : 'Регистратор', 'Recorder', refs('cfg:DocumentRef._ДемоРеализацияТоваров', 'cfg:DocumentRef._ДемоПоступлениеТоваров')),
		field(en ? 'PointInTime' : 'МоментВремени', 'PointInTime', null),
		field('Номенклатура', 'Номенклатура', refs('cfg:CatalogRef._ДемоНоменклатура'), 'dimension'),
	];
	const SEQUENCE: Description = {
		object: 'Последовательность._ДемоДвижениеТоваров',
		kind: 'sequence',
		tables: [
			{ name: 'Последовательность._ДемоДвижениеТоваров', kind: 'main', fields: sequenceFields(false) },
			{ name: 'Последовательность._ДемоДвижениеТоваров.Границы', kind: 'virtual', fields: sequenceFields(false) },
		],
	};
	const SEQUENCE_EN: Description = {
		object: 'Sequence._ДемоДвижениеТоваров',
		kind: 'sequence',
		tables: [
			{ name: 'Sequence._ДемоДвижениеТоваров', kind: 'main', fields: sequenceFields(true) },
			{ name: 'Sequence._ДемоДвижениеТоваров.Boundaries', kind: 'virtual', fields: sequenceFields(true) },
		],
	};
	const constant = (name: string, type: TypeDto, en = false): Description => ({
		object: (en ? 'Constant.' : 'Константа.') + name,
		kind: 'constant',
		tables: [{ name: (en ? 'Constant.' : 'Константа.') + name, kind: 'main', fields: [field(en ? 'Value' : 'Значение', 'Value', type)] }],
	});
	const ANSWERS: Record<string, Description> = {
		'КРИТЕРИЙОТБОРА.СВЯЗАННЫЕДОКУМЕНТЫ': CRITERION,
		'ПОСЛЕДОВАТЕЛЬНОСТЬ._ДЕМОДВИЖЕНИЕТОВАРОВ': SEQUENCE,
		'EN:ПОСЛЕДОВАТЕЛЬНОСТЬ._ДЕМОДВИЖЕНИЕТОВАРОВ': SEQUENCE_EN,
		'КОНСТАНТА.ОСНОВНАЯОРГАНИЗАЦИЯ': constant('ОсновнаяОрганизация', refs('cfg:CatalogRef._ДемоОрганизации')),
		'EN:КОНСТАНТА.ОСНОВНАЯОРГАНИЗАЦИЯ': constant('ОсновнаяОрганизация', refs('cfg:CatalogRef._ДемоОрганизации'), true),
		'КОНСТАНТА.ЗАГОЛОВОК': constant('Заголовок', refs('xs:string')),
	};
	const known: Lookup = (key) => ANSWERS[key] ?? loaded(key);

	test('виды: критерий отбора и последовательность в OBJECT_KINDS без ссылочного типа, внешних источников нет', () => {
		const kinds = types.OBJECT_KINDS.map((kind) => kind.en);
		assert.ok(kinds.includes('FilterCriterion') && kinds.includes('Sequence'), kinds.join(', '));
		assert.ok(!kinds.includes('ExternalDataSource'), 'внешних источников данных среди видов нет');
		for (const kind of types.OBJECT_KINDS.filter((item) => item.en === 'FilterCriterion' || item.en === 'Sequence')) {
			assert.equal(kind.ref, '', `${kind.en}: таблицы — только источник`);
		}
	});

	test('tableObjectOf: объект из двух сегментов, хвост Границ, английский вид — к русскому ключу, с lang en — свой ключ', () => {
		assert.deepEqual(types.tableObjectOf('КритерийОтбора.СвязанныеДокументы'), {
			object: 'КритерийОтбора.СвязанныеДокументы',
			key: 'КРИТЕРИЙОТБОРА.СВЯЗАННЫЕДОКУМЕНТЫ',
			tail: [],
			request: { queryTable: 'КритерийОтбора.СвязанныеДокументы' },
		});
		const boundaries = types.tableObjectOf('Последовательность._ДемоДвижениеТоваров.Границы');
		assert.equal(boundaries?.key, 'ПОСЛЕДОВАТЕЛЬНОСТЬ._ДЕМОДВИЖЕНИЕТОВАРОВ');
		assert.deepEqual(boundaries?.tail, ['Границы']);
		assert.equal(types.tableObjectOf('Sequence._ДемоДвижениеТоваров.Boundaries')?.key, 'ПОСЛЕДОВАТЕЛЬНОСТЬ._ДЕМОДВИЖЕНИЕТОВАРОВ');
		assert.deepEqual(types.tableObjectOf('FilterCriterion.СвязанныеДокументы', 'en'), {
			object: 'КритерийОтбора.СвязанныеДокументы',
			key: 'EN:КРИТЕРИЙОТБОРА.СВЯЗАННЫЕДОКУМЕНТЫ',
			tail: [],
			request: { queryTable: 'FilterCriterion.СвязанныеДокументы', lang: 'en' },
		});
		assert.equal(types.findTable(CRITERION, [])?.name, 'КритерийОтбора.СвязанныеДокументы', 'пустой хвост — основная таблица (у критерия она с параметром)');
		assert.equal(types.findTable(SEQUENCE, ['границы'])?.kind, 'virtual');
		for (const name of ['Константы', 'Constants', 'ВнешнийИсточникДанных.И.Таблица.Т']) {
			assert.equal(types.tableObjectOf(name), null, name);
		}
	});

	test('тип колонки: Ссылка критерия, Регистратор и измерение Границ; описание запрашивается по имени таблицы', () => {
		const criterion = 'ВЫБРАТЬ\n\tК.Ссылка КАК Документ\nИЗ\n\tКритерийОтбора.СвязанныеДокументы(&Значение) КАК К';
		const pending = types.queryColumnType(criterion, 'Документ', nothing, { queryModel });
		assert.equal(pending.type, null);
		assert.deepEqual(pending.pending, [{ key: 'КРИТЕРИЙОТБОРА.СВЯЗАННЫЕДОКУМЕНТЫ', request: { queryTable: 'КритерийОтбора.СвязанныеДокументы' } }]);
		assert.deepEqual(
			types.queryColumnType(criterion, 'Документ', known, { queryModel }).type,
			refs('cfg:DocumentRef._ДемоЗаказПокупателя', 'cfg:DocumentRef._ДемоРеализацияТоваров')
		);
		const bounds = 'ВЫБРАТЬ\n\tГ.Регистратор КАК Регистратор,\n\tГ.Номенклатура КАК Номенклатура,\n\tГ.МоментВремени КАК Момент\nИЗ\n\tПоследовательность._ДемоДвижениеТоваров.Границы КАК Г';
		assert.deepEqual(types.queryColumnType(bounds, 'Регистратор', known, { queryModel }).type?.types, [
			'cfg:DocumentRef._ДемоРеализацияТоваров',
			'cfg:DocumentRef._ДемоПоступлениеТоваров',
		]);
		assert.deepEqual(types.queryColumnType(bounds, 'Номенклатура', known, { queryModel }).type?.types, ['cfg:CatalogRef._ДемоНоменклатура']);
		assert.equal(types.queryColumnType(bounds, 'Момент', known, { queryModel }).type, null, 'у МоментВремени тип не задан — не выводится');
		const english = 'SELECT\n\tB.Recorder AS Recorder\nFROM\n\tSequence._ДемоДвижениеТоваров.Boundaries AS B';
		assert.deepEqual(
			types.queryColumnType(english, 'Recorder', nothing, { queryModel }).pending.map((item) => item.request),
			[{ queryTable: 'Sequence._ДемоДвижениеТоваров.Boundaries', lang: 'en' }]
		);
		assert.equal(types.queryColumnType(english, 'Recorder', known, { queryModel }).type?.types.length, 2);
	});

	test('isConstantsTable и колонка общей таблицы констант: таблица константы и поле значения на языке имени', () => {
		for (const name of ['Константы', 'Constants', 'константы', 'CONSTANTS']) {
			assert.equal(types.isConstantsTable(name), true, name);
		}
		for (const name of ['ВТ_Имя', 'Константа', 'Константа.Х', 'КонстантыВТ', '']) {
			assert.equal(types.isConstantsTable(name), false, name);
		}
		assert.deepEqual(types.constantColumnTable('Константы', 'ВалютаУчета'), { table: 'Константа.ВалютаУчета', lang: 'ru', field: 'Значение' });
		assert.deepEqual(types.constantColumnTable('Constants', 'ВалютаУчета'), { table: 'Constant.ВалютаУчета', lang: 'en', field: 'Value' });
		assert.equal(types.constantColumnTable('ВТ_Имя', 'Х'), null);
		assert.equal(types.constantColumnTable('Константы', 'А.Б'), null);
	});

	test('queryColumnType по «Константы»: колонка X — запрос Константа.X и тип «Значение», путь через точку, английский текст', () => {
		const text = 'ВЫБРАТЬ\n\tК.ОсновнаяОрганизация КАК Организация,\n\tК.Заголовок КАК Заголовок\nИЗ\n\tКонстанты КАК К';
		const pending = types.queryColumnType(text, 'Организация', nothing, { queryModel });
		assert.equal(pending.type, null);
		assert.deepEqual(pending.pending, [{ key: 'КОНСТАНТА.ОСНОВНАЯОРГАНИЗАЦИЯ', request: { queryTable: 'Константа.ОсновнаяОрганизация' } }]);
		assert.deepEqual(types.queryColumnType(text, 'Организация', known, { queryModel }).type, refs('cfg:CatalogRef._ДемоОрганизации'));
		assert.deepEqual(types.queryColumnType(text, 'Заголовок', known, { queryModel }).type, refs('xs:string'));
		// Путь через точку от константы — по описанию организации из фикстуры
		const deep = types.queryColumnType(text, 'Организация.Наименование', known, { queryModel });
		assert.deepEqual(deep.type?.types, ['xs:string'], JSON.stringify(deep));
		const english = 'SELECT\n\tC.ОсновнаяОрганизация AS Org\nFROM\n\tConstants AS C';
		assert.deepEqual(types.queryColumnType(english, 'Org', nothing, { queryModel }).pending, [
			{ key: 'EN:КОНСТАНТА.ОСНОВНАЯОРГАНИЗАЦИЯ', request: { queryTable: 'Constant.ОсновнаяОрганизация', lang: 'en' } },
		]);
		assert.deepEqual(types.queryColumnType(english, 'Org', known, { queryModel }).type, refs('cfg:CatalogRef._ДемоОрганизации'));
		// Константы нет в выгрузке (описание null) — тип не выводится, догадок нет
		assert.equal(types.queryColumnType('ВЫБРАТЬ К.Нет КАК Нет ИЗ Константы КАК К', 'Нет', known, { queryModel }).type, null);
	});

	test('«Константы» — таблица констант и при ВТ пакета с тем же именем', () => {
		const text = 'ВЫБРАТЬ\n\t1 КАК ОсновнаяОрганизация\nПОМЕСТИТЬ Константы\n;\n\nВЫБРАТЬ\n\tК.ОсновнаяОрганизация КАК Организация\nИЗ\n\tКонстанты КАК К';
		assert.deepEqual(types.queryColumnType(text, 'Организация', known, { queryModel }).type, refs('cfg:CatalogRef._ДемоОрганизации'));
	});
});
