/**
 * Операции конструктора запроса СКД над моделью: чистые функции dcs-editor-query-edit.js.
 *
 * Модуль исполняется в песочнице node:vm вместе с моделью запроса (dcs-editor-query-model.js) —
 * тот же код, что работает в webview. Каждая операция проверяется кругом «операция → сборка → разбор»:
 * собранный текст проходит самопроверку, разбирается в ту же модель, а неизменённые запросы пакета
 * выходят исходными срезами байт в байт. Корпус — 47 текстов ssl31 (queries-ssl31.json), описания
 * таблиц — ответы cf-md-query-tables (query-tables-ssl31.json). Кроме источников и полей проверяются
 * вкладки «Связи» (вид соединения, сохранение дерева, автопредложение), «Группировка», «Условия» (ИМЕЮЩИЕ),
 * «Дополнительно» (флаги, тип запроса, ДОБАВИТЬ, имя ВТ), «Индекс» (ПО НАБОРАМ, УНИКАЛЬНО),
 * «Объединения/Псевдонимы», «Порядок», «Пакет запросов» (сплайс по пакету) и «Компоновка данных»
 * (необязательные соединения с номером группы, параметры ВТ «целиком» и «база + блок», {ВЫБРАТЬ}, {ГДЕ}).
 * Запуск: npm run compile && node --test out/test/metadata/dcsQueryEdit.node.js
 * Бюджет времени проверяется только с переменной DCS_PERF_BUDGET=1.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

interface VirtualParam {
	text: string;
	dcs?: { text: string; kind: string };
}

interface Source {
	kind: string;
	table?: string;
	virtualTable?: string | null;
	params?: VirtualParam[] | null;
	query?: Statement;
	name?: string;
	alias: string | null;
}

interface Join {
	kind: string;
	optionalGroup: number | null;
	source: Source;
	joins: Join[];
	on: { conditions: string[] } | null;
}

interface Field {
	expr: string;
	alias: string | null;
}

interface Part {
	fields: Field[];
	from: Array<{ source: Source; joins: Join[] }>;
	where: { conditions: string[] } | null;
	dcsWhere: { placement?: string; items: Array<{ path?: string; text?: string; alias?: string | null }> } | null;
	groupBy: { items: string[]; groupingSets?: unknown } | null;
	having: { conditions: string[] } | null;
	into: { table: string; mode?: string } | null;
	unionAll?: boolean | null;
	allowed?: boolean;
	distinct?: boolean;
	top?: number | string | null;
	dcsSelect?: { placement?: string; items: Array<{ path?: string; star?: boolean; alias?: string | null; text?: string }>; breaks?: number[] } | null;
	forUpdate?: string[] | null;
}

interface Statement {
	type: string;
	parts: Part[];
	orderBy: Array<{ expr: string; dir?: string; hierarchy?: boolean }> | null;
	table?: string;
	original?: { index: number; text: string; before: string };
	indexes?: Array<{ unique: boolean; fields: string[] }>;
	autoOrder?: boolean;
}

interface Model {
	statements: Statement[];
	lang: string;
	eol: string;
	comments: { total: number; dropped: number };
	original: { count: number; tail: string };
}

interface QueryModelApi {
	parse(text: string): { model: Model; diagnostics: Array<{ message: string; line: number; column: number }> };
	build(model: Model, options?: { lang?: string; eol?: string }): string;
	buildWithReport(model: Model): { text: string; changed: boolean[]; comments: { total: number; dropped: number } };
	selfCheck(text: string): { ok: boolean; message?: string };
	sameModel(a: unknown, b: unknown): boolean;
	tempTables(model: Model, beforeIndex: number): Array<{ name: string; fields: string[]; statement: number }>;
	parametersOf(text: string): string[];
}

interface Address {
	statement: number;
	part: number;
}

interface EditResult {
	model: Model;
	alias?: string;
	index?: number;
	added?: string[];
	warnings?: string[];
	error?: string;
	path?: number[];
	placed?: Array<{ target: string; index: number }>;
	stash?: Statement;
}

interface DescribedTable {
	name: string;
	kind: string;
	params: Array<{ name: string; kind: string; values?: string[]; required?: boolean; type?: unknown }>;
	fields: DescribedField[];
}

interface DescribedField {
	name: string;
	nameEn: string;
	synonym: string;
	type: unknown;
	kind?: string;
}

interface CatalogNode {
	path: string;
	kind: string;
	title?: string;
	valueType?: unknown;
}

interface EditApi {
	newModel(text: string, lang?: string): Model;
	subModel(outer: Model, statement?: Statement): Model;
	emptyStatement(): Statement;
	partAt(model: Model, address: Address): Part;
	sourcesOf(part: Part): Array<{ source: Source; alias: string; depth: number; path: number[] }>;
	aliasesOf(part: Part): string[];
	columnNames(part: Part): Array<string | null>;
	paramTexts(source: Source): string[];
	defaultParamTexts(table: DescribedTable, taken?: string[]): string[] | null;
	virtualParamsState(
		source: Source | null,
		alias: string,
		described: { state: string; table?: DescribedTable; description?: { tables: DescribedTable[] } },
		options?: { metadata?: boolean }
	): { state: string; available: boolean; params: DescribedTable['params']; current: string[]; table: DescribedTable | null; objectKind: string; note: string; spoken: string };
	vtConditionAccess(objectKind: string, tableName: string, field: { name: string; nameEn?: string; kind?: string }): string;
	vtConditionFields(objectKind: string, table: DescribedTable | null): { rule: string; allowed: DescribedField[]; denied: DescribedField[] };
	vtConditionWarning(objectKind: string, table: DescribedTable | null, texts: string | string[]): { names: string[]; message: string };
	vtParamInput(param: { name?: string; kind?: string; values?: string[] } | null): string;
	usedParameters(model: Model, outer?: string[], typed?: string[]): string[];
	vtExpressionFields(param: { name?: string; kind?: string } | null, table: DescribedTable | null): DescribedField[];
	fieldNodeKind(field: { kind?: string } | null): string;
	isTempTable(source: Source): boolean;
	isConstantsTable(source: Source | string): boolean;
	checkAlias(alias: string, taken: string[], own: string): string;
	addSource(model: Model, address: Address, spec: { table?: string; params?: string[] | null; alias?: string; subquery?: Statement }): EditResult;
	removeSource(model: Model, address: Address, alias: string): EditResult;
	removeAllSources(model: Model, address: Address): EditResult;
	renameSource(model: Model, address: Address, from: string, to: string): EditResult;
	replaceSource(
		model: Model,
		address: Address,
		alias: string,
		spec: { table: string; params?: string[] | null; defaultParams?: string[] | null },
		options?: { fields?: string[] }
	): EditResult;
	setVirtualParams(model: Model, address: Address, alias: string, texts: string[]): EditResult;
	setSubquery(model: Model, address: Address, alias: string, statement: Statement): EditResult;
	addField(model: Model, address: Address, expr: string, options?: { alias?: string }): EditResult;
	addFields(model: Model, address: Address, exprs: string[]): EditResult;
	removeField(model: Model, address: Address, index: number): EditResult;
	removeAllFields(model: Model, address: Address): EditResult;
	moveField(model: Model, address: Address, index: number, delta: number): EditResult;
	setFieldExpr(model: Model, address: Address, index: number, expr: string): EditResult;
	refersTo(text: string, alias: string): boolean;
	finalize(model: Model, initial: Model | null): Model;
	problems(model: Model, options?: { autofill?: boolean }): string[];
	fieldsOfSource(source: Source, env: SourceEnv): { state: string; fields: Array<{ name: string; synonym: string; type: unknown; kind?: string }> };
	catalogNodes(
		model: Model,
		address: Address,
		env: {
			describe?: (table: string) => { state: string; table?: DescribedTable } | null;
			tempTables?: Array<{ name: string; fields: string[] }>;
			parameters?: Array<{ name: string; title?: string }>;
		}
	): CatalogNode[];
	statementLabel(statement: Statement, index: number): string;
	statementTabLabel(statement: Statement, index: number): string;
	// «Связи», «Группировка», «Условия»
	hasAggregate(text: string): boolean;
	RIGHT_JOIN_NOTE: string;
	joinKindOf(allLeft: boolean, allRight: boolean): string;
	linkRows(part: Part): LinkRow[];
	setLinkKind(model: Model, address: Address, ref: LinkRef, allLeft: boolean, allRight: boolean): EditResult;
	setLinkCondition(model: Model, address: Address, ref: LinkRef, text: string): EditResult;
	removeLink(model: Model, address: Address, ref: LinkRef): EditResult;
	addLink(model: Model, address: Address, spec: { left: string; right: string; allLeft: boolean; allRight: boolean; condition: string }): EditResult & { path?: number[] };
	relinkRow(model: Model, address: Address, ref: LinkRef, pair: { left?: string; right?: string }): EditResult & { path?: number[] };
	linkConditionText(left: string, leftField: string, op: string, right: string, rightField: string): string;
	suggestCondition(part: Part, left: string, right: string, env: SourceEnv): { state: string; condition: string };
	suggestLink(model: Model, address: Address, alias: string, env: SourceEnv): { state: string; left?: string; right?: string; condition?: string; allLeft?: boolean; allRight?: boolean };
	expandedTypes(dto: unknown): { types: string[]; typeSets: string[]; typeIds: string[] };
	refTypeNames(dto: unknown): string[];
	numericKind(dto: unknown): string;
	AGGREGATE_FUNCTIONS: Array<{ id: string; label: string }>;
	aggregateOf(expr: string): { fn: string; arg: string } | null;
	groupingOf(part: Part): { active: boolean; sets: boolean; groups: Array<{ index: number; text: string }>; sums: Array<{ field: number; fn: string; arg: string; custom: boolean }>; loose: number[] };
	groupingWarnings(part: Part): string[];
	groupingCandidates(
		part: Part,
		typeOf: ((index: number, expr: string) => unknown) | null
	): { groups: number[]; sums: number[]; skipped: Array<{ index: number; target: string; reason: string }> };
	aggregateTypeWarnings(part: Part, typeOf: ((index: number, expr: string) => unknown) | null): string[];
	groupTypeWarnings(part: Part, typeOf: ((index: number, expr: string) => unknown) | null): string[];
	ungroupableKind(dto: unknown): string;
	addGroupField(model: Model, address: Address, expr: string): EditResult;
	removeGroupField(model: Model, address: Address, index: number): EditResult;
	removeAllGroupFields(model: Model, address: Address): EditResult;
	setFieldAggregate(model: Model, address: Address, index: number, fn: string | null): EditResult;
	addSummedField(model: Model, address: Address, expr: string, fn: string): EditResult;
	COMPARISONS: Array<{ id: string; label: string }>;
	HAVING_NOTE: string;
	conditionRows(part: Part): Array<{ key: string; target: string; index: number; text: string; simple: { field: string; kind: string; param: string } | null }>;
	conditionText(field: string, kind: string, param: string, lang?: string): string;
	defaultParamName(field: string): string;
	addCondition(model: Model, address: Address, spec: { text?: string; field?: string; kind?: string; param?: string }): EditResult & { placed?: Array<{ target: string; index: number }> };
	setCondition(
		model: Model,
		address: Address,
		ref: { target: string; index: number },
		spec: { text?: string; field?: string; kind?: string; param?: string }
	): EditResult & { placed?: Array<{ target: string; index: number }> };
	removeCondition(model: Model, address: Address, ref: { target: string; index: number }): EditResult;
	// «Дополнительно», «Индекс», «Объединения/Псевдонимы», «Порядок», «Пакет запросов», «Компоновка данных»
	statementKind(statement: Statement): string;
	tempTableOf(statement: Statement): string;
	setPartFlags(model: Model, address: Address, flags: { top?: number | string | null; distinct?: boolean; allowed?: boolean }): EditResult;
	setStatementKind(model: Model, index: number, spec: { kind: string; table?: string; restore?: Statement }): EditResult & { stash?: Statement };
	renameTempTable(model: Model, index: number, name: string): EditResult;
	forUpdateOf(statement: Statement): { tables: string[] } | null;
	indexColumns(statement: Statement): string[];
	addIndex(model: Model, index: number): EditResult;
	removeIndex(model: Model, index: number, k: number): EditResult;
	copyIndex(model: Model, index: number, k: number): EditResult;
	moveIndex(model: Model, index: number, k: number, delta: number): EditResult;
	setIndexUnique(model: Model, index: number, k: number, unique: boolean): EditResult;
	addIndexField(model: Model, index: number, k: number, name: string): EditResult;
	removeIndexField(model: Model, index: number, k: number, f: number): EditResult;
	moveIndexField(model: Model, index: number, k: number, f: number, delta: number): EditResult;
	unionRows(statement: Statement): {
		parts: Array<{ index: number; label: string; noDuplicates: boolean }>;
		columns: Array<{ index: number; name: string | null; explicit: boolean; cells: Array<{ part: number; expr: string | null; isNull: boolean }> }>;
		aligned: boolean;
	};
	addPart(model: Model, index: number): EditResult;
	copyPart(model: Model, index: number, p: number): EditResult;
	removePart(model: Model, index: number, p: number): EditResult;
	movePart(model: Model, index: number, p: number, delta: number): EditResult;
	setUnionDistinct(model: Model, index: number, p: number, noDuplicates: boolean): EditResult;
	setUnionCell(model: Model, index: number, column: number, p: number, sourceColumn: number | null): EditResult;
	renameColumn(model: Model, index: number, column: number, name: string): EditResult;
	removeColumn(model: Model, index: number, column: number): EditResult;
	moveColumn(model: Model, index: number, column: number, delta: number): EditResult;
	orderRows(statement: Statement): Array<{ index: number; expr: string; direction: string }>;
	addOrder(model: Model, index: number, expr: string, direction?: string): EditResult;
	removeOrder(model: Model, index: number, k: number): EditResult;
	moveOrder(model: Model, index: number, k: number, delta: number): EditResult;
	setOrderDirection(model: Model, index: number, k: number, direction: string): EditResult;
	setAutoOrder(model: Model, index: number, on: boolean): EditResult;
	dataSetStatementIndex(model: Model): number;
	batchRows(model: Model): Array<{ index: number; label: string; kind: string; table: string; note: string; dataSet: boolean }>;
	batchWarnings(model: Model): string[];
	addStatement(model: Model, after?: number): EditResult;
	copyStatement(model: Model, index: number): EditResult;
	removeStatement(model: Model, index: number): EditResult;
	moveStatement(model: Model, index: number, delta: number): EditResult;
	compositionTables(part: Part): Array<{ key: string; alias: string; path: number[]; join: boolean; optional: boolean; group: number | null; virtual: boolean }>;
	setJoinRequired(model: Model, address: Address, path: number[], required: boolean): EditResult;
	setJoinGroup(model: Model, address: Address, path: number[], group: number | string): EditResult;
	vtParamParts(param: VirtualParam): { base: string; block: string | null };
	vtBlockItems(block: string): Array<{ kind: string; field?: string; star?: boolean; alias?: string | null; name?: string; parens?: boolean; text?: string }>;
	vtBlockText(items: unknown[], lang?: string): string;
	vtParamText(base: string, block: string | null): string;
	vtOptionalState(base: string, block: string | null): { available: boolean; optional: boolean; name: string };
	vtSetOptional(base: string, block: string | null, on: boolean): { base: string; block: string | null };
	renameParamText(text: string, from: string, to: string): string;
	dcsSelectRows(statement: Statement): Array<{ index: number; path: string | null; star: boolean; alias: string | null; text: string | null }>;
	dcsSelectAvailable(statement: Statement): string[];
	addDcsSelect(model: Model, index: number, path: string): EditResult;
	addAllDcsSelect(model: Model, index: number): EditResult;
	removeDcsSelect(model: Model, index: number, k: number): EditResult;
	removeAllDcsSelect(model: Model, index: number): EditResult;
	setDcsSelect(model: Model, index: number, k: number, spec: { star?: boolean; alias?: string }): EditResult;
	moveDcsSelect(model: Model, index: number, k: number, delta: number): EditResult;
	dcsWhereRows(part: Part): Array<{ index: number; kind: string; path: string | null; star: boolean; alias: string | null; text: string | null }>;
	addDcsWhereField(model: Model, address: Address, path: string): EditResult;
	addDcsWhereCondition(model: Model, address: Address, text: string): EditResult;
	setDcsWhereItem(model: Model, address: Address, k: number, spec: { star?: boolean; alias?: string; text?: string }): EditResult;
	removeDcsWhere(model: Model, address: Address, k: number): EditResult;
	removeAllDcsWhere(model: Model, address: Address): EditResult;
	moveDcsWhere(model: Model, address: Address, k: number, delta: number): EditResult;
	characteristicsTexts(statement: Statement): string[];
	// Проверка имён по метаданным
	nameProblems(model: Model, env: unknown): NameProblem[];
}

interface NameProblem {
	statement: number;
	part: number;
	text: string;
	message: string;
	offset?: number;
}

interface LinkRef {
	path: number[];
	condition: number;
}

interface LinkRow extends LinkRef {
	key: string;
	left: string;
	right: string;
	allLeft: boolean;
	allRight: boolean;
	kind: string;
	text: string;
	simple: { left: string; op: string; right: string } | null;
	optional: boolean;
	count: number;
}

interface SourceEnv {
	describe?: (table: string) => { state: string; table?: DescribedTable } | null;
	tempTables?: Array<{ name: string; fields: string[] }>;
	tempType?: (table: { name: string; fields: string[] } | undefined, column: string) => unknown;
	subqueryType?: (source: Source, column: string) => unknown;
}

interface CorpusQuery {
	file: string;
	dataSet: string;
	text: string;
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'resources', 'webview');
const FIXTURES = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs');

/**
 * Файл webview в текущем realm (обёртка-функция, а не новый контекст vm: объекты чужого realm не
 * проходят deepStrictEqual). Параметр window подменяет глобал webview.
 */
function loadModule<T>(file: string): T {
	const code = fs.readFileSync(path.join(WEBVIEW, file), 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: file }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	return moduleShim.exports as T;
}

const Q = loadModule<QueryModelApi>('dcs-editor-query-model.js');
const E = loadModule<{ create(api: QueryModelApi): EditApi }>('dcs-editor-query-edit.js').create(Q);

const corpus = (JSON.parse(fs.readFileSync(path.join(FIXTURES, 'queries-ssl31.json'), 'utf8')) as { queries: CorpusQuery[] }).queries;
const tables = (
	JSON.parse(fs.readFileSync(path.join(FIXTURES, 'query-tables-ssl31.json'), 'utf8')) as {
		objects: Record<string, { description: { object: string; kind?: string; tables: DescribedTable[] } }>;
	}
).objects;

const A: Address = { statement: 0, part: 0 };

/** Описание таблицы из фикстуры по имени таблицы языка запросов: так его отдаёт кэш webview. */
function describeTable(name: string): { state: string; table?: DescribedTable } | null {
	const segments = name.split('.');
	const entry = tables[segments.slice(0, 2).join('.')];
	if (!entry) {
		return { state: 'none' };
	}
	const table = entry.description.tables.find((item) => item.name.toUpperCase() === name.toUpperCase());
	return table ? { state: 'ready', table } : { state: 'none' };
}

function ok(result: EditResult): EditResult {
	assert.equal(result.error, undefined, `операция отказала: ${result.error}`);
	return result;
}

/** Круг: сборка самопроверяется, разбирается без диагностики и в ту же модель. */
function roundTrip(model: Model, label = ''): string {
	const text = Q.build(model);
	const check = Q.selfCheck(text);
	assert.ok(check.ok, `${label}: самопроверка: ${check.message}\n${text}`);
	const parsed = Q.parse(text);
	assert.deepEqual(parsed.diagnostics, [], `${label}: диагностика разбора\n${text}`);
	assert.ok(Q.sameModel(parsed.model, model), `${label}: разбор собранного текста — другая модель\n${text}`);
	return text;
}

/** Операция не трогает исходную модель: окно держит её для «модель не менялась». */
function frozen<T>(model: Model, run: () => T): T {
	const before = JSON.stringify(model);
	const result = run();
	assert.equal(JSON.stringify(model), before, 'исходная модель изменилась');
	return result;
}

function parsed(text: string): Model {
	const result = Q.parse(text);
	assert.deepEqual(result.diagnostics, []);
	return result.model;
}

const BATCH = [
	'ВЫБРАТЬ',
	'\tТ.Ссылка КАК Ссылка',
	'ПОМЕСТИТЬ ВТ_Валюты',
	'ИЗ',
	'\tСправочник.Валюты КАК Т',
	';',
	'',
	'////////////////////////////////////////////////////////////////////////////////',
	'ВЫБРАТЬ // свой комментарий',
	'\tВТ_Валюты.Ссылка',
	'ИЗ',
	'\tВТ_Валюты КАК ВТ_Валюты',
].join('\n');

describe('Конструктор запроса: источники', () => {
	test('новый запрос: таблица, виртуальная таблица с умолчаниями, ТЧ, временная таблица; алиасы по имени таблицы и уникальны', () => {
		let model = E.newModel('');
		assert.equal(model.statements.length, 1);
		assert.deepEqual(E.problems(model), ['Запрос: нет полей выборки, добавьте их на вкладке «Таблицы и поля».']);
		const valuta = frozen(model, () => ok(E.addSource(model, A, { table: 'Справочник.Валюты' })));
		assert.equal(valuta.alias, 'Валюты');
		model = valuta.model;
		assert.equal(ok(E.addSource(model, A, { table: 'Справочник.Валюты' })).alias, 'Валюты1', 'повтор таблицы — суффикс 1');
		const register = tables['РегистрНакопления._ДемоОстаткиТоваровВМестахХранения'].description;
		const turnovers = register.tables.find((table) => table.kind === 'virtual' && table.name.endsWith('.Обороты'));
		assert.ok(turnovers);
		const defaults = E.defaultParamTexts(turnovers);
		assert.deepEqual(defaults, ['', '', 'Авто', ''], 'у периодичности — Авто, остальное пусто');
		const balance = register.tables.find((table) => table.name.endsWith('.Остатки'));
		assert.ok(balance);
		assert.equal(E.defaultParamTexts(balance), null, 'все пусты — таблица без скобок');
		const english = { ...turnovers, params: turnovers.params.map((param) => (param.values ? { ...param, values: ['Auto', 'Record', 'Month'] } : param)) };
		assert.deepEqual(E.defaultParamTexts(english), ['', '', 'Auto', ''], 'описание на en — Auto');
		const vt = ok(E.addSource(model, A, { table: turnovers.name, params: defaults }));
		assert.equal(vt.alias, '_ДемоОстаткиТоваровВМестахХраненияОбороты');
		model = vt.model;
		model = ok(E.addSource(model, A, { table: 'Документ._ДемоСчетНаОплатуПокупателю.Товары' })).model;
		model = ok(E.addField(model, A, 'Валюты.Код')).model;
		model = ok(E.addField(model, A, '_ДемоОстаткиТоваровВМестахХраненияОбороты.КоличествоОборот')).model;
		model = ok(E.addField(model, A, '_ДемоСчетНаОплатуПокупателюТовары.Номенклатура')).model;
		assert.deepEqual(E.problems(model), []);
		const text = roundTrip(model, 'новый запрос');
		assert.equal(
			text,
			[
				'ВЫБРАТЬ',
				'\tВалюты.Код КАК Код,',
				'\t_ДемоОстаткиТоваровВМестахХраненияОбороты.КоличествоОборот КАК КоличествоОборот,',
				'\t_ДемоСчетНаОплатуПокупателюТовары.Номенклатура КАК Номенклатура',
				'ИЗ',
				'\tСправочник.Валюты КАК Валюты,',
				'\tРегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Обороты(, , Авто, ) КАК _ДемоОстаткиТоваровВМестахХраненияОбороты,',
				'\tДокумент._ДемоСчетНаОплатуПокупателю.Товары КАК _ДемоСчетНаОплатуПокупателюТовары',
			].join('\n')
		);
		const source = E.sourcesOf(model.statements[0].parts[0])[1].source;
		assert.equal(source.virtualTable, 'Обороты', 'признак ВТ — как у разбора');
	});

	test('временная таблица пакета и вложенный запрос: алиас — имя ВТ и ВложенныйЗапрос', () => {
		const model = parsed(BATCH);
		const second = { statement: 1, part: 0 };
		const temp = Q.tempTables(model, 1);
		assert.deepEqual(temp.map((item) => item.name), ['ВТ_Валюты']);
		const added = ok(E.addSource(model, second, { table: 'ВТ_Валюты' }));
		assert.equal(added.alias, 'ВТ_Валюты1');
		const inner = ok(E.addSource(E.subModel(model), A, { table: 'Справочник.Пользователи' }));
		const innerModel = ok(E.addField(inner.model, A, 'Пользователи.Ссылка')).model;
		const sub = ok(E.addSource(added.model, second, { subquery: innerModel.statements[0] }));
		assert.equal(sub.alias, 'ВложенныйЗапрос');
		const withField = ok(E.addField(sub.model, second, 'ВложенныйЗапрос.Ссылка')).model;
		const text = roundTrip(withField, 'ВТ и вложенный запрос');
		assert.ok(text.startsWith(model.statements[0].original?.text ?? '-'), 'первый запрос пакета — исходный срез');
		assert.ok(text.includes('\t(ВЫБРАТЬ\n\t\tПользователи.Ссылка КАК Ссылка\n\tИЗ\n\t\tСправочник.Пользователи КАК Пользователи) КАК ВложенныйЗапрос'), text);
		assert.ok(text.includes(model.statements[1].original?.before ?? '-'), 'разделитель пакета сохранён');
		const fields = E.fieldsOfSource(E.sourcesOf(withField.statements[1].parts[0])[2].source, {});
		assert.deepEqual(fields, { state: 'ready', fields: [{ name: 'Ссылка', synonym: '', type: null }] });
		const changedSub = ok(
			E.setSubquery(withField, second, 'ВложенныйЗапрос', ok(E.addField(innerModel, A, 'Пользователи.Наименование')).model.statements[0])
		).model;
		assert.ok(roundTrip(changedSub, 'вложенный запрос второго уровня').includes('Пользователи.Наименование КАК Наименование'));
	});

	test('переименование алиаса: ссылки в полях, соединениях, условиях, {ГДЕ}, группировке и порядке; отказы', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tТ.Ссылка КАК Ссылка,',
			'\tСУММА(Т.Сумма) КАК Сумма',
			'ИЗ',
			'\tСправочник.Валюты КАК Т',
			'\t\tЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.КурсыВалют КАК К',
			'\t\tПО Т.Ссылка = К.Валюта',
			'ГДЕ',
			'\tТ.ПометкаУдаления = ЛОЖЬ',
			'{ГДЕ',
			'\tТ.Код.* КАК Код}',
			'СГРУППИРОВАТЬ ПО',
			'\tТ.Ссылка',
			'УПОРЯДОЧИТЬ ПО',
			'\tТ.Код',
		].join('\n');
		const model = parsed(text);
		const renamed = frozen(model, () => ok(E.renameSource(model, A, 'т', 'Валюты')));
		const out = roundTrip(renamed.model, 'переименование');
		assert.ok(!E.refersTo(out, 'Т'), out);
		assert.equal((out.match(/Валюты\./g) || []).length, 7, out);
		assert.equal(E.renameSource(model, A, 'Т', 'К').error, 'Псевдоним «К» уже есть в этой части запроса.');
		assert.equal(E.renameSource(model, A, 'Т', 'к').error, 'Псевдоним «к» уже есть в этой части запроса.', 'без учёта регистра');
		assert.match(E.renameSource(model, A, 'Т', 'ИЗ').error ?? '', /ключевое слово/);
		assert.match(E.renameSource(model, A, 'Т', 'Два слова').error ?? '', /одно слово/);
		assert.equal(E.renameSource(model, A, 'Т', 'Т').model, model, 'то же имя — та же модель');
		assert.ok(ok(E.renameSource(model, A, 'Т', 'т')).model !== model, 'смена регистра — правка');
	});

	test('удаление таблицы: поднятые соединения, снятые ссылки с предупреждением; удаление всех', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tА.Ссылка КАК Ссылка,',
			'\tБ.Код КАК Код,',
			'\tВ.Имя КАК Имя',
			'ИЗ',
			'\tСправочник.А КАК А',
			'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Б КАК Б',
			'\t\tПО А.Ссылка = Б.Владелец',
			'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.В КАК В',
			'\t\tПО Б.Ссылка = В.Владелец',
			'\t\t\tИ А.Ссылка = В.Родитель',
			'ГДЕ',
			'\tА.ПометкаУдаления = ЛОЖЬ',
			'\tИ Б.Код <> ""',
		].join('\n');
		const model = parsed(text);
		const result = frozen(model, () => ok(E.removeSource(model, A, 'А')));
		const out = roundTrip(result.model, 'удаление');
		assert.equal(
			out,
			[
				'ВЫБРАТЬ',
				'\tБ.Код КАК Код,',
				'\tВ.Имя КАК Имя',
				'ИЗ',
				'\tСправочник.Б КАК Б,',
				'\tСправочник.В КАК В',
				'ГДЕ',
				'\tБ.Код <> ""',
			].join('\n')
		);
		assert.deepEqual(result.warnings, ['Вместе с таблицей «А» удалено (поле: А.Ссылка; условие: А.ПометкаУдаления = ЛОЖЬ).']);
		const middle = ok(E.removeSource(model, A, 'Б'));
		const mid = roundTrip(middle.model, 'удаление соединения');
		assert.ok(mid.includes('ЛЕВОЕ СОЕДИНЕНИЕ Справочник.В КАК В\n\t\tПО А.Ссылка = В.Родитель'), mid);
		const all = ok(E.removeAllSources(model, A));
		assert.deepEqual(all.model.statements[0].parts[0].from, []);
		assert.deepEqual(all.model.statements[0].parts[0].fields, []);
		assert.equal(all.model.statements[0].parts[0].where, null);
	});

	test('заменить таблицу: автоматический алиас меняется со ссылками, свой остаётся; нет поля — удалено с предупреждением', () => {
		const model = parsed('ВЫБРАТЬ\n\tВалюты.Ссылка КАК Ссылка,\n\tВалюты.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Валюты\nГДЕ\n\tВалюты.Код <> ""');
		const fields = tables['Справочник.Пользователи'].description.tables[0].fields.map((field) => field.name);
		const replaced = frozen(model, () => ok(E.replaceSource(model, A, 'Валюты', { table: 'Справочник.Пользователи' }, { fields })));
		assert.equal(replaced.alias, 'Пользователи');
		assert.deepEqual(replaced.warnings, ['В новой таблице нет полей, удалены из выборки: Пользователи.Код.']);
		assert.equal(
			roundTrip(replaced.model, 'замена'),
			'ВЫБРАТЬ\n\tПользователи.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Пользователи КАК Пользователи\nГДЕ\n\tПользователи.Код <> ""'
		);
		const own = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Т');
		const kept = ok(E.replaceSource(own, A, 'Т', { table: 'Справочник.Пользователи' }));
		assert.equal(kept.alias, 'Т', 'свой псевдоним не трогается');
		assert.ok(roundTrip(kept.model).includes('Справочник.Пользователи КАК Т'));
		const vt = parsed('ВЫБРАТЬ\n\tО.КоличествоОборот КАК К\nИЗ\n\tРегистрНакопления.А.Обороты(&Н, &К, Месяц, ) КАК О');
		const sameVt = ok(E.replaceSource(vt, A, 'О', { table: 'РегистрНакопления.Б.Обороты', defaultParams: ['', '', 'Авто', ''] }));
		assert.ok(roundTrip(sameVt.model).includes('РегистрНакопления.Б.Обороты(&Н, &К, Месяц, ) КАК О'), 'та же ВТ — параметры сохранены');
		const otherVt = ok(E.replaceSource(vt, A, 'О', { table: 'РегистрНакопления.Б.Остатки' }));
		assert.ok(roundTrip(otherVt.model).includes('РегистрНакопления.Б.Остатки КАК О'), 'другая ВТ без умолчаний — без скобок');
	});
});

describe('Конструктор запроса: параметры виртуальной таблицы', () => {
	const text = 'ВЫБРАТЬ\n\tС.Субъект КАК Субъект\nИЗ\n\tРегистрСведений.Согласия.СрезПоследних({(&ДатаДействия)}, ) КАК С';

	test('позиции текстом: блок СКД {…} сохраняется, правка позиции, все пусты — без скобок', () => {
		const model = parsed(text);
		const source = model.statements[0].parts[0].from[0].source;
		assert.deepEqual(E.paramTexts(source), ['{(&ДатаДействия)}', '']);
		assert.equal(ok(E.setVirtualParams(model, A, 'С', ['{(&ДатаДействия)}', ''])).model, model, 'без изменений — та же модель');
		const changed = frozen(model, () => ok(E.setVirtualParams(model, A, 'с', ['{(&ДатаДействия)}', 'Действует = ИСТИНА'])));
		const out = roundTrip(changed.model, 'параметры ВТ');
		assert.ok(out.includes('СрезПоследних({(&ДатаДействия)}, Действует = ИСТИНА) КАК С'), out);
		const tail = ok(E.setVirtualParams(model, A, 'С', ['&Дата {(&ДатаДействия)}', '']));
		assert.deepEqual(tail.model.statements[0].parts[0].from[0].source.params?.[0], { text: '&Дата', dcs: { text: '(&ДатаДействия)', kind: 'tail' } });
		roundTrip(tail.model, 'база + блок');
		const cleared = ok(E.setVirtualParams(model, A, 'С', ['', '']));
		assert.equal(cleared.model.statements[0].parts[0].from[0].source.params, null);
		assert.ok(roundTrip(cleared.model).includes('СрезПоследних КАК С'));
	});

	test('ошибка в тексте параметра — отказ без правки', () => {
		const model = parsed(text);
		assert.match(E.setVirtualParams(model, A, 'С', ['(&Дата', '']).error ?? '', /^Параметры таблицы не разобраны: /);
		assert.match(E.setVirtualParams(model, A, 'С', ['&А, &Б', '']).error ?? '', /запятая/);
		assert.match(E.setVirtualParams(model, A, 'Нет', ['', '']).error ?? '', /нет/);
	});
});

describe('Конструктор запроса: поля', () => {
	test('добавить, ↑↓, изменить выражение, удалить; псевдонимы по пути поля', () => {
		let model = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Т');
		const added = frozen(model, () => ok(E.addField(model, A, 'Т.Ссылка')));
		assert.equal(added.alias, 'Ссылка1', 'повтор имени — суффикс');
		model = added.model;
		model = ok(E.addField(model, A, 'Т.Владелец.Код')).model;
		assert.equal(model.statements[0].parts[0].fields[2].alias, 'ВладелецКод', 'разыменование — склейка сегментов');
		const batch = ok(E.addFields(model, A, ['Т.Код', 'Т.Ссылка', 'Т.Наименование']));
		assert.deepEqual(batch.added, ['Код', 'Наименование'], '>> не повторяет уже выбранное');
		model = batch.model;
		const moved = ok(E.moveField(model, A, 4, -4));
		assert.equal(moved.index, 0);
		assert.equal(moved.model.statements[0].parts[0].fields[0].expr, 'Т.Наименование');
		assert.equal(ok(E.moveField(model, A, 0, -1)).model, model, 'за край — без правки');
		const expr = ok(E.setFieldExpr(moved.model, A, 0, 'ПРЕДСТАВЛЕНИЕ(Т.Ссылка)'));
		assert.equal(expr.model.statements[0].parts[0].fields[0].alias, 'Наименование', 'имя колонки сохранено');
		const removed = ok(E.removeField(expr.model, A, 1));
		roundTrip(removed.model, 'поля');
		assert.deepEqual(
			removed.model.statements[0].parts[0].fields.map((field) => field.alias),
			['Наименование', 'Ссылка1', 'ВладелецКод', 'Код']
		);
		assert.deepEqual(ok(E.removeAllFields(model, A)).model.statements[0].parts[0].fields, []);
		assert.match(E.addField(model, A, '  ').error ?? '', /Пустое/);
	});

	test('объединение: новое поле — колонка с NULL в других частях, удаление — NULL части, пустая колонка уходит, сдвиг — во всех частях', () => {
		const text = 'ВЫБРАТЬ\n\tА.Х КАК Х\nИЗ\n\tСправочник.А КАК А\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tБ.Х\nИЗ\n\tСправочник.Б КАК Б';
		const model = parsed(text);
		const second = { statement: 0, part: 1 };
		const added = ok(E.addField(model, second, 'Б.Код'));
		assert.equal(added.alias, 'Код');
		const parts = added.model.statements[0].parts;
		assert.deepEqual(parts.map((part) => part.fields.map((field) => [field.expr, field.alias])), [
			[
				['А.Х', 'Х'],
				['NULL', 'Код'],
			],
			[
				['Б.Х', null],
				['Б.Код', null],
			],
		]);
		roundTrip(added.model, 'объединение');
		const moved = ok(E.moveField(added.model, second, 1, -1));
		assert.deepEqual(moved.model.statements[0].parts.map((part) => part.fields.map((field) => field.expr)), [
			['NULL', 'А.Х'],
			['Б.Код', 'Б.Х'],
		]);
		const nulled = ok(E.removeField(added.model, A, 0));
		assert.deepEqual(nulled.model.statements[0].parts.map((part) => part.fields.map((field) => [field.expr, field.alias])), [
			[
				['NULL', 'Х'],
				['NULL', 'Код'],
			],
			[
				['Б.Х', null],
				['Б.Код', null],
			],
		]);
		const gone = ok(E.removeField(nulled.model, second, 1));
		assert.deepEqual(gone.model.statements[0].parts.map((part) => part.fields.length), [1, 1], 'NULL во всех частях — колонки нет');
		roundTrip(gone.model, 'объединение после удаления');
	});

	test('явный КАК у простых полей в изменённых частях, тёзки и многосегментные пути — как есть', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tТ.Ссылка,',
			'\tТ.Код,',
			'\tК.Код,',
			'\tТ.Владелец.Наименование,',
			'\tТ.Наименование КАК Имя',
			'ИЗ',
			'\tСправочник.Валюты КАК Т',
			'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.К КАК К',
			'\t\tПО Т.Ссылка = К.Валюта',
			';',
			'',
			'////////////////////////////////////////////////////////////////////////////////',
			'ВЫБРАТЬ',
			'\tТ.Ссылка',
			'ИЗ',
			'\tСправочник.Валюты КАК Т',
		].join('\n');
		const model = parsed(text);
		assert.equal(Q.build(E.finalize(model, model)), text, 'модель не менялась — текст байт в байт, без КАК');
		const edited = ok(E.addField(model, A, '&Флаг')).model;
		const final = E.finalize(edited, model);
		assert.deepEqual(final.statements[0].parts[0].fields.map((field) => field.alias), ['Ссылка', null, null, null, 'Имя', 'Поле1'], 'выражение — ПолеN');
		assert.deepEqual(final.statements[1].parts[0].fields.map((field) => field.alias), [null], 'неизменённый запрос пакета не тронут');
		const report = Q.buildWithReport(final);
		assert.deepEqual(report.changed, [true, false]);
		assert.ok(report.text.endsWith(model.statements[1].original?.before + (model.statements[1].original?.text ?? '')), 'сплайс второго запроса');
		roundTrip(final, 'явный КАК');
		const fresh = E.newModel('');
		const created = ok(E.addSource(fresh, A, { table: 'Справочник.Валюты' })).model;
		const plain = created.statements[0].parts[0];
		plain.fields.push({ expr: 'Валюты.Ссылка', alias: null });
		assert.equal(E.finalize(created, fresh).statements[0].parts[0].fields[0].alias, 'Ссылка', 'новый запрос — изменён целиком');
	});
});

describe('Конструктор запроса: корпус ssl31', () => {
	test('каждый из 47 текстов: поле в последний запрос выборки → сборка проходит самопроверку, прочие запросы пакета — исходные срезы', () => {
		let edited = 0;
		for (const query of corpus) {
			const label = `${query.file} ${query.dataSet}`;
			const parse = Q.parse(query.text);
			assert.deepEqual(parse.diagnostics, [], label);
			const model = parse.model;
			assert.equal(Q.build(E.finalize(model, model)), query.text, `${label}: без правок — исходный текст`);
			let last = -1;
			model.statements.forEach((statement, index) => {
				if (statement.type === 'select' && !statement.parts.some((part) => part.into)) {
					last = index;
				}
			});
			assert.ok(last >= 0, label);
			const address = { statement: last, part: 0 };
			const result = frozen(model, () => ok(E.addField(model, address, '&ПроверкаКонструктора')));
			const final = E.finalize(result.model, model);
			const report = Q.buildWithReport(final);
			assert.deepEqual(
				report.changed,
				model.statements.map((_statement, index) => index === last),
				`${label}: пересобран только изменённый запрос`
			);
			model.statements.forEach((statement, index) => {
				if (index !== last) {
					assert.ok(report.text.includes(statement.original?.text ?? '-'), `${label}: запрос ${index + 1} — исходный срез`);
				}
			});
			const check = Q.selfCheck(report.text);
			assert.ok(check.ok, `${label}: ${check.message}\n${report.text}`);
			assert.ok(Q.parametersOf(report.text).includes('ПроверкаКонструктора'), label);
			const again = Q.parse(report.text);
			assert.deepEqual(again.diagnostics, [], label);
			assert.ok(Q.sameModel(again.model, final), `${label}: круг модели`);
			// В изменённой части простое поле без псевдонима с уникальным именем колонки — с явным КАК,
			// поле со своим псевдонимом, тёзки и прочие выражения — как было
			const before = model.statements[last].parts[0];
			const after = again.model.statements[last].parts[0];
			const aliases = new Set(E.aliasesOf(before).map((name) => name.toUpperCase()));
			const columns = E.columnNames(before).map((name) => (name ?? '').toUpperCase());
			before.fields.forEach((field, k) => {
				const match = /^([\p{L}_][\p{L}\p{N}_]*)\.([\p{L}_][\p{L}\p{N}_]*)$/u.exec(field.expr.trim());
				const unique = match ? columns.filter((name) => name === match[2].toUpperCase()).length === 1 : false;
				const expected = field.alias === null && match && aliases.has(match[1].toUpperCase()) && unique ? match[2] : field.alias;
				assert.equal(after.fields[k].alias, expected, `${label}: ${field.expr}`);
			});
			edited += 1;
		}
		assert.equal(edited, 47);
	});

	test('переименование первого алиаса части каждого текста: ссылок на старое имя не остаётся, самопроверка проходит', () => {
		let renamed = 0;
		for (const query of corpus) {
			const model = Q.parse(query.text).model;
			for (let index = 0; index < model.statements.length; index++) {
				const statement = model.statements[index];
				if (statement.type !== 'select') {
					continue;
				}
				const source = E.sourcesOf(statement.parts[0]).find((entry) => entry.source.alias);
				if (!source) {
					continue;
				}
				const address = { statement: index, part: 0 };
				const next = source.alias + 'Конструктор';
				const result = ok(E.renameSource(model, address, source.alias, next));
				const text = Q.build(E.finalize(result.model, model));
				const check = Q.selfCheck(text);
				assert.ok(check.ok, `${query.file}: ${check.message}`);
				const part = Q.parse(text).model.statements[index].parts[0];
				for (const field of part.fields) {
					assert.ok(!E.refersTo(field.expr, source.alias), `${query.file}: ${field.expr}`);
				}
				renamed += 1;
				break;
			}
		}
		assert.ok(renamed >= 40, `переименований ${renamed}`);
	});
});

describe('Конструктор запроса: поля источников и окно выражения', () => {
	test('поля таблицы — из описания, ВТ пакета — из пакета, вложенный запрос — колонки, параметр — нет', () => {
		const model = parsed(
			'ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Пользователи КАК П,\n\tВТ_Т КАК ВТ_Т,\n\t(ВЫБРАТЬ 1 КАК Один) КАК ВЗ,\n\t&Внешняя КАК Вн'
		);
		const sources = E.sourcesOf(model.statements[0].parts[0]);
		const env = { describe: describeTable, tempTables: [{ name: 'вт_т', fields: ['Номенклатура', 'Количество'] }] };
		const users = E.fieldsOfSource(sources[0].source, env);
		assert.equal(users.state, 'ready');
		assert.ok(users.fields.some((field) => field.name === 'ПометкаУдаления' && field.synonym === 'Пометка удаления'), 'синоним из описания');
		// Вид поля — только у общих реквизитов (знак в деревьях полей)
		assert.equal(users.fields.find((field) => field.name === 'ОбластьДанныхОсновныеДанные')?.kind, 'separator');
		assert.equal('kind' in (users.fields.find((field) => field.name === 'ПометкаУдаления') || {}), false);
		assert.deepEqual(E.fieldsOfSource(sources[1].source, env).fields.map((field) => field.name), ['Номенклатура', 'Количество']);
		assert.deepEqual(E.fieldsOfSource(sources[2].source, env).fields.map((field) => field.name), ['Один']);
		assert.deepEqual(E.fieldsOfSource(sources[3].source, env), { state: 'none', fields: [] });
		assert.equal(E.fieldsOfSource(sources[0].source, { describe: () => ({ state: 'loading' }) }).state, 'loading');
		const nodes = E.catalogNodes(model, A, { ...env, parameters: [{ name: 'Период', title: 'Период' }] });
		assert.deepEqual(
			nodes.filter((node) => node.kind === 'table').map((node) => [node.path, node.title]),
			[
				['П', 'Справочник.Пользователи'],
				['ВТ_Т', 'ВТ_Т'],
				['ВЗ', 'Вложенный запрос'],
				['Вн', '&Внешняя'],
			]
		);
		const link = nodes.find((node) => node.path === 'П.Ссылка');
		assert.deepEqual((link?.valueType as { types: string[] }).types, ['cfg:CatalogRef.Пользователи'], 'тип поля — для раскрытия через точку');
		assert.deepEqual(nodes.filter((node) => node.kind === 'param').map((node) => node.path), ['Период']);
		// Поле общего реквизита — своим видом (знак и слово в подсказке и деревьях), прочие поля — 'field'
		assert.equal(nodes.find((node) => node.path === 'П.ОбластьДанныхОсновныеДанные')?.kind, 'separator', 'разделитель Пользователей');
		assert.equal(nodes.find((node) => node.path === 'П.Наименование')?.kind, 'field');
		assert.deepEqual(['separator', 'commonAttribute', 'dimension', 'standard', '', 'toString'].map((kind) => E.fieldNodeKind({ kind })), ['separator', 'commonAttribute', 'field', 'field', 'field', 'field']);
		assert.equal(E.fieldNodeKind(null), 'field');
	});

	test('подписи запросов пакета и второй уровень над вложенным запросом', () => {
		const model = parsed(BATCH + '\n;\n\n////////////////////////////////////////////////////////////////////////////////\nУНИЧТОЖИТЬ ВТ_Валюты');
		assert.deepEqual(
			model.statements.map((statement, index) => E.statementLabel(statement, index)),
			['Запрос пакета 1: временная таблица ВТ_Валюты', 'Запрос пакета 2', 'Запрос пакета 3: уничтожение ВТ_Валюты']
		);
		// Ярлык вертикальной вкладки короче, но остаётся частью полного названия — доступного имени вкладки
		const tabs = model.statements.map((statement, index) => E.statementTabLabel(statement, index));
		assert.deepEqual(tabs, ['ВТ_Валюты', 'Запрос пакета 2', 'Уничтожение ВТ_Валюты']);
		model.statements.forEach((statement, index) => {
			assert.ok(E.statementLabel(statement, index).toLowerCase().includes(tabs[index].toLowerCase()), tabs[index]);
		});
		const add = parsed('ВЫБРАТЬ\n\t1 КАК А\nПОМЕСТИТЬ ВТ\n;\nВЫБРАТЬ\n\t2 КАК А\nДОБАВИТЬ ВТ');
		assert.equal(E.statementLabel(add.statements[1], 1), 'Запрос пакета 2: добавление в ВТ');
		assert.equal(E.statementTabLabel(add.statements[1], 1), 'Добавление в ВТ');
		assert.equal(E.statementTabLabel(E.emptyStatement(), 4), 'Запрос пакета 5');
		const sub = E.subModel(model);
		assert.equal(sub.statements.length, 1);
		assert.deepEqual(sub.statements[0], E.emptyStatement());
		const edited = ok(E.addField(ok(E.addSource(sub, A, { table: 'Справочник.Валюты' })).model, A, 'Валюты.Ссылка')).model;
		assert.equal(Q.build(edited), 'ВЫБРАТЬ\n\tВалюты.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Валюты');
		assert.equal(E.checkAlias('ВложенныйЗапрос', ['вложенныйзапрос'], ''), 'Псевдоним «ВложенныйЗапрос» уже есть в этой части запроса.');
	});
});

// ---------------------------------------------------------------------------------------------
// Вкладки «Связи», «Группировка», «Условия»
// ---------------------------------------------------------------------------------------------

const TREE = [
	'ВЫБРАТЬ',
	'\tА.Ссылка КАК Ссылка',
	'ИЗ',
	'\tСправочник.А КАК А',
	'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Б КАК Б',
	'\t\t\tВНУТРЕННЕЕ СОЕДИНЕНИЕ Справочник.В КАК В',
	'\t\t\tПО Б.Ссылка = В.Владелец',
	'\t\tПО А.Ссылка = Б.Владелец',
	'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Г КАК Г',
	'\t\tПО Г.Владелец = Б.Ссылка',
	'\t\t\tИ А.Ссылка = Г.Родитель',
].join('\n');

const rowsOf = (model: Model, address: Address = A): LinkRow[] => E.linkRows(model.statements[address.statement].parts[address.part]);

describe('Конструктор запроса: связи', () => {
	test('строки: по строке на условие соединения, таблица 1 — левая сторона по ссылке условия, вложенное — с родителем, записанное наоборот — простое', () => {
		const model = parsed(TREE);
		const rows = rowsOf(model);
		assert.deepEqual(
			rows.map((row) => [row.key, row.left, row.right, row.kind, row.allLeft, row.allRight, row.simple]),
			[
				['l:0.0#0', 'А', 'Б', 'left', true, false, { left: 'Ссылка', op: '=', right: 'Владелец' }],
				['l:0.0.0#0', 'Б', 'В', 'inner', false, false, { left: 'Ссылка', op: '=', right: 'Владелец' }],
				['l:0.1#0', 'Б', 'Г', 'left', true, false, { left: 'Ссылка', op: '=', right: 'Владелец' }],
				['l:0.1#1', 'А', 'Г', 'left', true, false, { left: 'Ссылка', op: '=', right: 'Родитель' }],
			]
		);
		const mirrored = parsed('ВЫБРАТЬ\n\tА.Ссылка КАК Ссылка\nИЗ\n\tСправочник.А КАК А\n\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Б КАК Б\n\t\tПО Б.Дата < А.Дата');
		assert.deepEqual(rowsOf(mirrored)[0].simple, { left: 'Дата', op: '>', right: 'Дата' }, 'знак отражён');
		const custom = parsed('ВЫБРАТЬ\n\tА.Ссылка КАК Ссылка\nИЗ\n\tСправочник.А КАК А\n\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Б КАК Б\n\t\tПО (Б.Владелец = А.Ссылка)\n\t\t\tИ Б.Код = &Код');
		assert.deepEqual(
			rowsOf(custom).map((row) => [row.left, row.right, row.simple === null]),
			[
				['А', 'Б', false],
				['А', 'Б', true],
			],
			'скобки вокруг простого не мешают; условие только по таблице 2 — таблица 1 родитель, произвольное'
		);
	});

	test('вид соединения по флажкам «Все»: все четыре и смена — меняется только затронутое соединение, дерево сохраняется', () => {
		const model = parsed(TREE);
		const nested = rowsOf(model)[1];
		const words: Record<string, string> = { full: 'ПОЛНОЕ', left: 'ЛЕВОЕ', right: 'ПРАВОЕ', inner: 'ВНУТРЕННЕЕ' };
		for (const [allLeft, allRight, kind] of [
			[true, true, 'full'],
			[true, false, 'left'],
			[false, true, 'right'],
			[false, false, 'inner'],
		] as Array<[boolean, boolean, string]>) {
			assert.equal(E.joinKindOf(allLeft, allRight), kind);
			const result = frozen(model, () => ok(E.setLinkKind(model, A, nested, allLeft, allRight)));
			assert.deepEqual(result.warnings, kind === 'right' ? [E.RIGHT_JOIN_NOTE] : [], 'ПРАВОЕ — с пометкой');
			if (kind === 'inner') {
				assert.equal(result.model, model, 'тот же вид — та же модель');
				continue;
			}
			const text = roundTrip(result.model, kind);
			assert.equal(text, TREE.replace('\t\t\tВНУТРЕННЕЕ СОЕДИНЕНИЕ', '\t\t\t' + words[kind] + ' СОЕДИНЕНИЕ'), kind + ': только вложенное соединение');
		}
		const second = rowsOf(model)[3];
		const full = ok(E.setLinkKind(model, A, second, true, true)).model;
		assert.deepEqual(
			rowsOf(full).map((row) => row.kind),
			['left', 'inner', 'full', 'full'],
			'флажки общие у строк одного соединения'
		);
		assert.match(E.setLinkKind(model, A, { path: [0, 5], condition: 0 }, true, true).error ?? '', /не найдена/);
	});

	test('условие строки: простое и произвольное, несколько через И — строки того же соединения, ИЛИ рядом с другими — в скобках', () => {
		const model = parsed(TREE);
		const row = rowsOf(model)[0];
		const changed = frozen(model, () => ok(E.setLinkCondition(model, A, row, E.linkConditionText('А', 'Ссылка', '<>', 'Б', 'Родитель'))));
		assert.ok(roundTrip(changed.model).includes('\t\tПО А.Ссылка <> Б.Родитель\n'), 'простое');
		const split = ok(E.setLinkCondition(model, A, row, 'А.Ссылка = Б.Владелец И Б.Код = &Код'));
		assert.deepEqual(
			rowsOf(split.model)
				.filter((item) => item.path.join('.') === '0.0')
				.map((item) => item.text),
			['А.Ссылка = Б.Владелец', 'Б.Код = &Код']
		);
		roundTrip(split.model, 'И — две строки');
		const second = rowsOf(split.model).find((item) => item.text === 'Б.Код = &Код');
		assert.ok(second);
		const or = ok(E.setLinkCondition(split.model, A, second, 'Б.Код = &Код ИЛИ Б.Код = ""'));
		const text = roundTrip(or.model, 'ИЛИ');
		assert.ok(text.includes('\t\tПО А.Ссылка = Б.Владелец\n\t\t\tИ (Б.Код = &Код ИЛИ Б.Код = "")\n'), text);
		assert.equal(ok(E.setLinkCondition(model, A, row, '  А.Ссылка = Б.Владелец ')).model, model, 'тот же текст — та же модель');
		assert.match(E.setLinkCondition(model, A, row, '').error ?? '', /пустое/);
		assert.match(E.setLinkCondition(model, A, row, 'А.Х = 1 СГРУППИРОВАТЬ ПО А.Х').error ?? '', /не разобрано/);
	});

	test('новая связь: отдельная строка ИЗ — соединением в цепочку первой таблицы; таблица 1 справа — флажки отражены; уже связанные — И в разделяющее соединение', () => {
		const loose = parsed('ВЫБРАТЬ\n\tА.Ссылка КАК Ссылка\nИЗ\n\tСправочник.А КАК А,\n\tСправочник.Б КАК Б,\n\tСправочник.В КАК В');
		const first = frozen(loose, () => ok(E.addLink(loose, A, { left: 'А', right: 'Б', allLeft: true, allRight: false, condition: 'А.Ссылка = Б.Владелец' })));
		assert.deepEqual(first.path, [0, 0]);
		assert.deepEqual(first.warnings, []);
		const second = ok(E.addLink(first.model, A, { left: 'Б', right: 'В', allLeft: false, allRight: false, condition: 'Б.Ссылка = В.Владелец' }));
		assert.equal(
			roundTrip(second.model, 'цепочка'),
			[
				'ВЫБРАТЬ',
				'\tА.Ссылка КАК Ссылка',
				'ИЗ',
				'\tСправочник.А КАК А',
				'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Б КАК Б',
				'\t\tПО А.Ссылка = Б.Владелец',
				'\t\tВНУТРЕННЕЕ СОЕДИНЕНИЕ Справочник.В КАК В',
				'\t\tПО Б.Ссылка = В.Владелец',
			].join('\n'),
			'плоская цепочка от первой таблицы'
		);
		assert.deepEqual(
			rowsOf(second.model).map((row) => [row.left, row.right]),
			[
				['А', 'Б'],
				['Б', 'В'],
			]
		);
		// Таблица 1 — дальняя строка ИЗ: она уходит в цепочку первой, «Все» отражаются (смысл тот же)
		const swapped = ok(E.addLink(loose, A, { left: 'В', right: 'А', allLeft: true, allRight: false, condition: 'В.Владелец = А.Ссылка' }));
		assert.deepEqual(swapped.warnings, [E.RIGHT_JOIN_NOTE]);
		assert.ok(roundTrip(swapped.model).includes('\tСправочник.А КАК А\n\t\tПРАВОЕ СОЕДИНЕНИЕ Справочник.В КАК В\n\t\tПО В.Владелец = А.Ссылка,\n\tСправочник.Б КАК Б'));
		// Уже в одной цепочке: условие — в соединение, которое их разделяет, вид — по флажкам строки
		const tree = parsed(TREE);
		const extra = ok(E.addLink(tree, A, { left: 'В', right: 'Г', allLeft: true, allRight: true, condition: 'В.Ссылка = Г.Ссылка' }));
		assert.deepEqual(extra.path, [0, 1]);
		const rows = rowsOf(extra.model).filter((row) => row.path.join('.') === '0.1');
		assert.deepEqual(
			rows.map((row) => [row.left, row.kind]),
			[
				['Б', 'full'],
				['А', 'full'],
				['В', 'full'],
			]
		);
		roundTrip(extra.model, 'И в разделяющее');
		const reverse = ok(E.addLink(tree, A, { left: 'Г', right: 'А', allLeft: false, allRight: true, condition: 'Г.Код = А.Код' }));
		assert.equal(rowsOf(reverse.model)[4].kind, 'left', 'таблица 1 справа: «Все» у второй строки — ЛЕВОЕ соединения');
		const nested = ok(E.addLink(tree, A, { left: 'А', right: 'В', allLeft: true, allRight: false, condition: 'А.Ссылка = В.Ссылка' }));
		assert.deepEqual(nested.path, [0, 0], 'таблица внутри вложенного соединения — условие у внешнего соединения');
		roundTrip(nested.model, 'условие у внешнего');
		assert.match(E.addLink(tree, A, { left: 'А', right: 'а', allLeft: true, allRight: false, condition: 'ИСТИНА' }).error ?? '', /совпадают/);
		assert.match(E.addLink(tree, A, { left: 'А', right: 'Нет', allLeft: true, allRight: false, condition: 'ИСТИНА' }).error ?? '', /нет в части/);
	});

	test('удаление: условие из нескольких — строка; последнее — таблица через запятую с вложенными соединениями; на неё ссылается другая связь — отказ', () => {
		const model = parsed(TREE);
		const rows = rowsOf(model);
		const one = frozen(model, () => ok(E.removeLink(model, A, rows[3])));
		assert.deepEqual(
			rowsOf(one.model).map((row) => row.key),
			['l:0.0#0', 'l:0.0.0#0', 'l:0.1#0']
		);
		roundTrip(one.model, 'строка из двух');
		assert.match(E.removeLink(model, A, rows[0]).error ?? '', /^Связь не удалить: на таблицу «Б» ссылается связь таблицы «Г»/);
		const last = ok(E.removeLink(one.model, A, rowsOf(one.model)[2]));
		assert.deepEqual(last.warnings, ['Таблица «Г» больше ни с чем не связана: в ИЗ она идёт через запятую, и каждая её строка соединится с каждой.']);
		const detached = ok(E.removeLink(last.model, A, rowsOf(last.model)[0]));
		assert.equal(
			roundTrip(detached.model, 'с вложенным'),
			[
				'ВЫБРАТЬ',
				'\tА.Ссылка КАК Ссылка',
				'ИЗ',
				'\tСправочник.А КАК А,',
				'\tСправочник.Б КАК Б',
				'\t\tВНУТРЕННЕЕ СОЕДИНЕНИЕ Справочник.В КАК В',
				'\t\tПО Б.Ссылка = В.Владелец,',
				'\tСправочник.Г КАК Г',
			].join('\n'),
			'отделённая таблица уносит своё вложенное соединение'
		);
	});

	test('смена таблицы строки: ссылки условия переходят, строка встаёт к новой паре с прежними флажками; обмен местами', () => {
		const model = parsed(TREE);
		const rows = rowsOf(model);
		const moved = frozen(model, () => ok(E.relinkRow(model, A, rows[3], { left: 'В' })));
		const after = rowsOf(moved.model).find((row) => row.text === 'В.Ссылка = Г.Родитель');
		assert.ok(after, JSON.stringify(rowsOf(moved.model).map((row) => row.text)));
		assert.deepEqual([after.left, after.right, after.allLeft], ['В', 'Г', true]);
		roundTrip(moved.model, 'смена таблицы 1');
		const swap = ok(E.relinkRow(model, A, rows[2], { left: 'Г', right: 'Б' }));
		assert.ok(
			rowsOf(swap.model).some((row) => row.text === 'Б.Владелец = Г.Ссылка'),
			'обмен алиасов не склеил их: ' + JSON.stringify(rowsOf(swap.model).map((row) => row.text))
		);
		assert.equal(ok(E.relinkRow(model, A, rows[0], { left: 'А' })).model, model, 'та же пара — та же модель');
		assert.match(E.relinkRow(model, A, rows[0], { right: 'А' }).error ?? '', /совпадают/);
	});

	test('автопредложение по типу ссылки (своё правило): поле → Ссылка, Ссылка → поле, ТЧ к документу, тёзки; сама с собой и без типов — нет; грузится — loading', () => {
		const env = { describe: describeTable };
		let model = E.newModel('');
		model = ok(E.addSource(model, A, { table: 'Документ._ДемоСчетНаОплатуПокупателю' })).model;
		const users = ok(E.addSource(model, A, { table: 'Справочник.Пользователи' }));
		assert.deepEqual(E.suggestLink(users.model, A, 'Пользователи', env), {
			state: 'ready',
			left: '_ДемоСчетНаОплатуПокупателю',
			right: 'Пользователи',
			condition: '_ДемоСчетНаОплатуПокупателю.Ответственный = Пользователи.Ссылка',
			allLeft: true,
			allRight: false,
		});
		const goods = ok(E.addSource(model, A, { table: 'Документ._ДемоСчетНаОплатуПокупателю.Товары' }));
		assert.equal(
			E.suggestLink(goods.model, A, goods.alias ?? '', env).condition,
			'_ДемоСчетНаОплатуПокупателю.Ссылка = _ДемоСчетНаОплатуПокупателюТовары.Ссылка',
			'ТЧ — по Ссылке'
		);
		const fromUsers = ok(E.addSource(ok(E.addSource(E.newModel(''), A, { table: 'Справочник.Пользователи' })).model, A, { table: 'Документ._ДемоСчетНаОплатуПокупателю' }));
		assert.equal(
			E.suggestLink(fromUsers.model, A, '_ДемоСчетНаОплатуПокупателю', env).condition,
			'Пользователи.Ссылка = _ДемоСчетНаОплатуПокупателю.Ответственный',
			'Ссылка таблицы 1 ← поле таблицы 2'
		);
		const twins = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tДокумент._ДемоСчетНаОплатуПокупателю.Товары КАК Т,\n\tРегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Остатки КАК О');
		assert.equal(E.suggestLink(twins, A, 'О', env).condition, 'Т.Номенклатура = О.Номенклатура', 'тёзки с одним ссылочным типом');
		const self = ok(E.addSource(users.model, A, { table: 'Справочник.Пользователи' }));
		assert.equal(E.suggestCondition(self.model.statements[0].parts[0], 'Пользователи', 'Пользователи1', env).state, 'none', 'сама с собой — нет');
		assert.equal(E.suggestLink(users.model, A, 'Пользователи', { describe: () => ({ state: 'loading' }) }).state, 'loading');
		const linked = ok(E.addLink(users.model, A, { left: '_ДемоСчетНаОплатуПокупателю', right: 'Пользователи', allLeft: true, allRight: false, condition: 'ИСТИНА' }));
		assert.equal(E.suggestLink(linked.model, A, 'Пользователи', env).state, 'none', 'уже связана — не предлагается');
		const temp = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tВТ_А КАК Т,\n\tВТ_Б КАК Б');
		const temps = [
			{ name: 'ВТ_А', fields: ['Ссылка'] },
			{ name: 'ВТ_Б', fields: ['Ссылка'] },
		];
		assert.equal(E.suggestLink(temp, A, 'Б', { tempTables: temps }).state, 'none', 'без типов — не угадываем');
		const suggestion = E.suggestLink(users.model, A, 'Пользователи', env) as { left: string; right: string; allLeft: boolean; allRight: boolean; condition: string };
		const applied = ok(E.addLink(ok(E.addField(users.model, A, 'Пользователи.Наименование')).model, A, suggestion));
		assert.ok(
			roundTrip(applied.model).includes('\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Пользователи КАК Пользователи\n\t\tПО _ДемоСчетНаОплатуПокупателю.Ответственный = Пользователи.Ссылка')
		);
	});

	test('корпус ssl31: у каждого из 47 соединений все четыре вида проходят круг, возврат вида — исходный текст байт в байт, прочие запросы пакета — срезы', () => {
		let joins = 0;
		for (const query of corpus) {
			const model = Q.parse(query.text).model;
			model.statements.forEach((statement, si) => {
				if (statement.type !== 'select') {
					return;
				}
				statement.parts.forEach((part, pi) => {
					const address = { statement: si, part: pi };
					const seen = new Set<string>();
					for (const row of E.linkRows(part)) {
						if (seen.has(row.path.join('.'))) {
							continue;
						}
						seen.add(row.path.join('.'));
						joins += 1;
						const label = `${query.file} ${si}/${pi} ${row.key}`;
						for (const [allLeft, allRight] of [
							[true, true],
							[false, false],
							[true, false],
							[false, true],
						]) {
							const final = E.finalize(ok(E.setLinkKind(model, address, row, allLeft, allRight)).model, model);
							const report = Q.buildWithReport(final);
							assert.ok(Q.selfCheck(report.text).ok, label);
							assert.ok(Q.sameModel(Q.parse(report.text).model, final), `${label}: круг модели`);
							assert.deepEqual(
								report.changed,
								model.statements.map((_item, index) => index === si && E.joinKindOf(allLeft, allRight) !== row.kind),
								`${label}: пересобран только изменённый запрос`
							);
						}
						const away = ok(E.setLinkKind(model, address, row, !row.allLeft, !row.allRight)).model;
						const back = ok(E.setLinkKind(away, address, row, row.allLeft, row.allRight)).model;
						assert.equal(Q.build(E.finalize(back, model)), query.text, `${label}: вид вернули — текст исходный`);
					}
				});
			});
		}
		assert.equal(joins, 47);
	});
});

describe('Конструктор запроса: группировка', () => {
	const goods = 'ВЫБРАТЬ\n\tТ.Номенклатура,\n\tТ.Количество КАК Количество,\n\tТ.Сумма\nИЗ\n\tДокумент.Р.Товары КАК Т';
	const partOf = (value: Model): Part => value.statements[0].parts[0];

	test('групповые и суммируемые: все шесть функций, Количество различных — РАЗЛИЧНЫЕ, имя колонки — явным КАК, снятие, поле вне списков — предупреждение', () => {
		const model = parsed(goods);
		assert.deepEqual(E.groupingWarnings(partOf(model)), [], 'без группировки — без предупреждений');
		assert.deepEqual(
			E.AGGREGATE_FUNCTIONS.map((fn) => fn.label),
			['Сумма', 'Количество', 'Количество различных', 'Максимум', 'Минимум', 'Среднее']
		);
		const grouped = frozen(model, () => ok(E.addGroupField(model, A, 'Т.Номенклатура')));
		assert.deepEqual(E.groupingWarnings(partOf(grouped.model)), [
			'Поле «Т.Количество» не входит ни в групповые, ни в суммируемые поля. Добавьте его в один из списков.',
			'Поле «Т.Сумма» не входит ни в групповые, ни в суммируемые поля. Добавьте его в один из списков.',
		]);
		const expected: Record<string, string> = {
			sum: 'СУММА(Т.Сумма)',
			count: 'КОЛИЧЕСТВО(Т.Сумма)',
			countDistinct: 'КОЛИЧЕСТВО(РАЗЛИЧНЫЕ Т.Сумма)',
			max: 'МАКСИМУМ(Т.Сумма)',
			min: 'МИНИМУМ(Т.Сумма)',
			avg: 'СРЕДНЕЕ(Т.Сумма)',
		};
		for (const fn of E.AGGREGATE_FUNCTIONS) {
			const summed = ok(E.setFieldAggregate(grouped.model, A, 2, fn.id));
			const field = partOf(summed.model).fields[2];
			assert.deepEqual([field.expr, field.alias], [expected[fn.id], 'Сумма'], fn.id);
			assert.deepEqual(E.aggregateOf(field.expr), { fn: fn.id, arg: 'Т.Сумма' });
			roundTrip(summed.model, fn.id);
		}
		let current = ok(E.setFieldAggregate(grouped.model, A, 2, 'sum')).model;
		current = ok(E.addSummedField(current, A, 'Т.Количество', 'max')).model;
		assert.deepEqual(E.groupingWarnings(partOf(current)), []);
		assert.deepEqual(
			E.groupingOf(partOf(current)).sums.map((sum) => [sum.field, sum.fn]),
			[
				[1, 'max'],
				[2, 'sum'],
			]
		);
		assert.equal(
			roundTrip(current, 'группировка'),
			[
				'ВЫБРАТЬ',
				'\tТ.Номенклатура,',
				'\tМАКСИМУМ(Т.Количество) КАК Количество,',
				'\tСУММА(Т.Сумма) КАК Сумма',
				'ИЗ',
				'\tДокумент.Р.Товары КАК Т',
				'СГРУППИРОВАТЬ ПО',
				'\tТ.Номенклатура',
			].join('\n')
		);
		const fresh = ok(E.addSummedField(current, A, 'Т.Цена', 'avg'));
		assert.deepEqual(partOf(fresh.model).fields[3], { expr: 'СРЕДНЕЕ(Т.Цена)', alias: 'Цена' }, 'поля нет в выборке — добавлено с псевдонимом по имени поля');
		const unsummed = ok(E.setFieldAggregate(current, A, 1, null));
		assert.deepEqual(partOf(unsummed.model).fields[1], { expr: 'Т.Количество', alias: 'Количество' });
		assert.equal(E.groupingWarnings(partOf(unsummed.model)).length, 1);
		// Суммируемое поле уходит из групповых; повтор группового — без правки; последнее снятое — без СГРУППИРОВАТЬ ПО
		const both = ok(E.addGroupField(unsummed.model, A, 'т.количество'));
		assert.deepEqual(partOf(both.model).groupBy?.items, ['Т.Номенклатура', 'т.количество']);
		const resummed = ok(E.setFieldAggregate(both.model, A, 1, 'sum'));
		assert.deepEqual(partOf(resummed.model).groupBy?.items, ['Т.Номенклатура'], 'поле стало суммируемым — ушло из групповых');
		assert.equal(ok(E.addGroupField(current, A, ' Т.Номенклатура ')).model, current, 'повтор — та же модель');
		const none = ok(E.removeGroupField(current, A, 0));
		assert.equal(partOf(none.model).groupBy, null);
		roundTrip(none.model, 'без группировки');
		assert.equal(partOf(ok(E.removeAllGroupFields(current, A)).model).groupBy, null);
		assert.match(E.removeGroupField(current, A, 5).error ?? '', /нет/);
	});

	test('в СГРУППИРОВАТЬ ПО — выражения; путь от группового и константы покрыты; отказы: агрегат в групповых, агрегат внутри выражения, группирующие наборы', () => {
		const model = parsed(
			'ВЫБРАТЬ\n\tНАЧАЛОПЕРИОДА(Т.Дата, ДЕНЬ) КАК День,\n\tТ.Склад.Владелец КАК Владелец,\n\t"Итого" КАК Подпись,\n\t&Флаг КАК Флаг,\n\tЕСТЬNULL(СУММА(Т.Сумма), 0) КАК Сумма\nИЗ\n\tДокумент.Р.Товары КАК Т'
		);
		let current = ok(E.addGroupField(model, A, 'НАЧАЛОПЕРИОДА(Т.Дата, ДЕНЬ)')).model;
		current = ok(E.addGroupField(current, A, 'Т.Склад')).model;
		const state = E.groupingOf(partOf(current));
		assert.deepEqual(state.loose, [], 'выражение совпало с групповым, путь продолжает групповой, литерал и параметр — константы');
		assert.deepEqual(state.sums, [{ field: 4, fn: '', arg: 'ЕСТЬNULL(СУММА(Т.Сумма), 0)', custom: true }], 'агрегат внутри выражения — «выражение»');
		assert.ok(roundTrip(current).includes('СГРУППИРОВАТЬ ПО\n\tНАЧАЛОПЕРИОДА(Т.Дата, ДЕНЬ),\n\tТ.Склад'));
		assert.match(E.addGroupField(model, A, 'СУММА(Т.Сумма)').error ?? '', /суммируемое/);
		assert.match(E.setFieldAggregate(model, A, 4, 'sum').error ?? '', /внутри выражения/);
		assert.equal(E.hasAggregate('Т.Х В (ВЫБРАТЬ СУММА(В.Х) ИЗ В КАК В)'), false, 'агрегат вложенного запроса — не наш');
		assert.equal(E.hasAggregate('ЕСТЬNULL(СУММА(Т.Х), 0) > 0'), true);
		const sets = parsed('ВЫБРАТЬ\n\tТ.А КАК А,\n\tСУММА(Т.Б) КАК Б\nИЗ\n\tТ КАК Т\nСГРУППИРОВАТЬ ПО ГРУППИРУЮЩИМ НАБОРАМ ((Т.А), ())');
		assert.equal(E.groupingOf(partOf(sets)).sets, true);
		assert.match(E.addGroupField(sets, A, 'Т.В').error ?? '', /группирующим наборам/);
		const english = parsed('SELECT\n\tT.Amount AS Amount\nFROM\n\tDocument.R.Goods AS T');
		const sum = ok(E.setFieldAggregate(english, A, 0, 'countDistinct'));
		assert.equal(partOf(sum.model).fields[0].expr, 'COUNT(DISTINCT T.Amount)', 'английский запрос — английские имена функций');
		assert.equal(E.aggregateOf('СУММА(РАЗЛИЧНЫЕ Т.Х)'), null, 'РАЗЛИЧНЫЕ — только у количества');
		assert.equal(E.aggregateOf('СУММА(Т.А) + СУММА(Т.Б)'), null, 'агрегат не всё выражение');
	});

	test('корпус ssl31: группировки без ложных предупреждений, суммируемые узнаются', () => {
		let grouped = 0;
		let sums = 0;
		for (const query of corpus) {
			for (const statement of Q.parse(query.text).model.statements) {
				for (const part of statement.type === 'select' ? statement.parts : []) {
					assert.deepEqual(E.groupingWarnings(part), [], query.file);
					if (part.groupBy) {
						grouped += 1;
						sums += E.groupingOf(part).sums.length;
					}
				}
			}
		}
		assert.ok(grouped >= 6, `группировок ${grouped}`);
		assert.ok(sums >= 10, `суммируемых ${sums}`);
	});
});

describe('Конструктор запроса: условия', () => {
	const base = 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tДокумент.Р КАК Т\n{ГДЕ\n\tТ.Склад.*}';
	const partOf = (value: Model): Part => value.statements[0].parts[0];

	test('простые всех девяти видов сравнения: текст, разбор обратно в простое, имя параметра по умолчанию уникально без учёта регистра', () => {
		const model = parsed(base);
		const texts: Record<string, string> = {
			'=': 'Т.Склад = &Склад',
			'<>': 'Т.Склад <> &Склад',
			'<': 'Т.Склад < &Склад',
			'<=': 'Т.Склад <= &Склад',
			'>': 'Т.Склад > &Склад',
			'>=': 'Т.Склад >= &Склад',
			in: 'Т.Склад В (&Склад)',
			inHierarchy: 'Т.Склад В ИЕРАРХИИ (&Склад)',
			like: 'Т.Склад ПОДОБНО &Склад',
		};
		assert.deepEqual(
			E.COMPARISONS.map((item) => item.label),
			['=', '<>', '<', '<=', '>', '>=', 'В', 'В иерархии', 'Подобно']
		);
		for (const kind of E.COMPARISONS.map((item) => item.id)) {
			const result = frozen(model, () => ok(E.addCondition(model, A, { field: 'Т.Склад', kind, param: 'Склад' })));
			const rows = E.conditionRows(partOf(result.model));
			assert.deepEqual(
				rows.map((row) => [row.target, row.text, row.simple]),
				[['where', texts[kind], { field: 'Т.Склад', kind, param: 'Склад' }]],
				kind
			);
			const text = roundTrip(result.model, kind);
			assert.ok(text.includes('ГДЕ\n\t' + texts[kind] + '\n{ГДЕ'), `${kind}: {ГДЕ} после ГДЕ\n${text}`);
			assert.ok(Q.parametersOf(text).includes('Склад'));
		}
		assert.equal(E.conditionText('T.Store', 'inHierarchy', 'Store', 'en'), 'T.Store IN HIERARCHY (&Store)');
		assert.equal(E.conditionText('T.Store', 'like', 'Store', 'en'), 'T.Store LIKE &Store');
		assert.equal(E.defaultParamName('Т.Склад'), 'Склад', 'занятое имя (параметр схемы, другая часть) — тот же параметр, без суффикса');
		assert.equal(E.defaultParamName('Т.Склад.Владелец'), 'СкладВладелец', 'путь — склейка сегментов после алиаса');
		assert.equal(E.defaultParamName('Склад'), 'Склад');
		const first = ok(E.addCondition(model, A, { field: 'Т.Склад', kind: '=', param: 'Склад' })).model;
		const kindChanged = ok(E.setCondition(first, A, { target: 'where', index: 0 }, { field: 'Т.Склад', kind: 'in', param: 'Склады' }));
		assert.deepEqual(E.conditionRows(partOf(kindChanged.model))[0].simple, { field: 'Т.Склад', kind: 'in', param: 'Склады' });
		assert.match(E.addCondition(model, A, { field: 'Т.Склад', kind: '=', param: 'два слова' }).error ?? '', /одно слово/);
		assert.match(E.addCondition(model, A, { field: 'Т.Склад', kind: 'между', param: 'П' }).error ?? '', /вид сравнения/);
	});

	test('произвольные: И верхнего уровня — строки, ИЛИ рядом с другими — в скобках, агрегат — в ИМЕЮЩИЕ с пометкой и обратно', () => {
		const model = parsed(base);
		const split = ok(E.addCondition(model, A, { text: 'Т.Проведен И Т.Дата МЕЖДУ &Начало И &Конец' }));
		assert.deepEqual(
			E.conditionRows(partOf(split.model)).map((row) => row.text),
			['Т.Проведен', 'Т.Дата МЕЖДУ &Начало И &Конец']
		);
		assert.deepEqual(split.placed, [
			{ target: 'where', index: 0 },
			{ target: 'where', index: 1 },
		]);
		const or = ok(E.addCondition(split.model, A, { text: 'Т.Склад = &Склад ИЛИ &ВсеСклады' }));
		assert.equal(E.conditionRows(partOf(or.model))[2].text, '(Т.Склад = &Склад ИЛИ &ВсеСклады)');
		roundTrip(or.model, 'ИЛИ');
		const lone = ok(E.addCondition(model, A, { text: 'Т.Склад = &Склад ИЛИ &ВсеСклады' }));
		assert.equal(E.conditionRows(partOf(lone.model))[0].text, 'Т.Склад = &Склад ИЛИ &ВсеСклады', 'одно условие — без лишних скобок');
		const withOld = ok(E.addCondition(lone.model, A, { text: 'Т.Проведен' }));
		assert.deepEqual(
			E.conditionRows(partOf(withOld.model)).map((row) => row.text),
			['(Т.Склад = &Склад ИЛИ &ВсеСклады)', 'Т.Проведен'],
			'прежнее ИЛИ взято в скобки'
		);
		const having = ok(E.addCondition(split.model, A, { text: 'СУММА(Т.Сумма) > &Порог' }));
		assert.deepEqual(having.warnings, [E.HAVING_NOTE]);
		assert.deepEqual(having.placed, [{ target: 'having', index: 0 }]);
		const havingText = roundTrip(having.model, 'ИМЕЮЩИЕ');
		assert.ok(havingText.endsWith('{ГДЕ\n\tТ.Склад.*}\nИМЕЮЩИЕ\n\tСУММА(Т.Сумма) > &Порог'), havingText);
		const back = ok(E.setCondition(having.model, A, { target: 'having', index: 0 }, { text: 'Т.Сумма > &Порог' }));
		assert.equal(partOf(back.model).having, null, 'агрегат пропал — строка ушла из ИМЕЮЩИЕ');
		assert.deepEqual(back.placed, [{ target: 'where', index: 2 }]);
		const there = ok(E.setCondition(split.model, A, { target: 'where', index: 0 }, { text: 'КОЛИЧЕСТВО(Т.Ссылка) > 1' }));
		assert.deepEqual(there.warnings, [E.HAVING_NOTE]);
		assert.deepEqual(
			E.conditionRows(partOf(there.model)).map((row) => [row.target, row.index]),
			[
				['where', 0],
				['having', 0],
			]
		);
		const inPlace = ok(E.setCondition(split.model, A, { target: 'where', index: 0 }, { text: 'Т.Проведен И НЕ Т.ПометкаУдаления' }));
		assert.deepEqual(
			E.conditionRows(partOf(inPlace.model)).map((row) => row.text),
			['Т.Проведен', 'НЕ Т.ПометкаУдаления', 'Т.Дата МЕЖДУ &Начало И &Конец'],
			'на своём месте'
		);
		assert.equal(ok(E.setCondition(split.model, A, { target: 'where', index: 0 }, { text: ' Т.Проведен ' })).model, split.model, 'тот же текст — та же модель');
		assert.match(E.addCondition(model, A, { text: '' }).error ?? '', /пустое/);
		assert.match(E.addCondition(model, A, { text: 'Т.А = 1 {ГДЕ Т.Б}' }).error ?? '', /не разобрано/);
		assert.match(E.setCondition(model, A, { target: 'where', index: 3 }, { text: 'ИСТИНА' }).error ?? '', /нет/);
	});

	test('удаление: последнее условие снимает ГДЕ, {ГДЕ} возвращается за ИЗ; корпус: условие в каждый запрос — круг, прочие запросы пакета — срезы', () => {
		const model = parsed(base);
		const added = ok(E.addCondition(model, A, { field: 'Т.Склад', kind: '=', param: 'Склад' }));
		assert.equal((partOf(added.model).dcsWhere as { placement?: string } | null)?.placement, 'afterWhere', 'первый ГДЕ забрал {ГДЕ} за собой');
		const removed = frozen(added.model, () => ok(E.removeCondition(added.model, A, { target: 'where', index: 0 })));
		assert.equal(partOf(removed.model).where, null);
		assert.equal(roundTrip(removed.model, 'удаление'), base);
		assert.match(E.removeCondition(model, A, { target: 'having', index: 0 }).error ?? '', /нет/);
		let touched = 0;
		for (const query of corpus) {
			const corpusModel = Q.parse(query.text).model;
			corpusModel.statements.forEach((statement, si) => {
				if (statement.type !== 'select') {
					return;
				}
				const address = { statement: si, part: 0 };
				for (const row of E.conditionRows(statement.parts[0])) {
					assert.equal(ok(E.setCondition(corpusModel, address, row, { text: row.text })).model, corpusModel, `${query.file}: тот же текст`);
				}
				const result = ok(E.addCondition(corpusModel, address, { field: 'Т.ПолеПроверки', kind: 'inHierarchy', param: 'ПроверкаУсловия' }));
				const final = E.finalize(result.model, corpusModel);
				const report = Q.buildWithReport(final);
				assert.ok(Q.selfCheck(report.text).ok, query.file);
				assert.ok(Q.sameModel(Q.parse(report.text).model, final), `${query.file}: круг модели`);
				assert.deepEqual(
					report.changed,
					corpusModel.statements.map((_item, index) => index === si),
					`${query.file}: пересобран только изменённый запрос`
				);
				touched += 1;
			});
		}
		assert.ok(touched >= 50, `запросов ${touched}`);
	});

	test('сплайс по пакету: условие и группировка второго запроса — первый запрос исходным срезом', () => {
		const model = parsed(BATCH);
		const second = { statement: 1, part: 0 };
		let current = ok(E.addCondition(model, second, { field: 'ВТ_Валюты.Ссылка', kind: 'in', param: 'Валюты' })).model;
		current = ok(E.addGroupField(current, second, 'ВТ_Валюты.Ссылка')).model;
		const report = Q.buildWithReport(E.finalize(current, model));
		assert.deepEqual(report.changed, [false, true]);
		assert.ok(report.text.startsWith(model.statements[0].original?.text ?? '-'), 'первый запрос — исходный срез');
		assert.ok(report.text.includes(model.statements[1].original?.before ?? '-'), 'разделитель пакета сохранён');
		assert.ok(report.text.endsWith('ГДЕ\n\tВТ_Валюты.Ссылка В (&Валюты)\nСГРУППИРОВАТЬ ПО\n\tВТ_Валюты.Ссылка'), report.text);
		assert.ok(Q.selfCheck(report.text).ok);
		assert.ok(Q.parametersOf(report.text).includes('Валюты'));
	});
});

// =====================================================================================================
// Вкладки «Дополнительно», «Индекс», «Объединения/Псевдонимы», «Порядок», «Пакет запросов», «Компоновка данных»
// =====================================================================================================

const firstPart = (value: Model, index = 0): Part => value.statements[index].parts[0];

/** Пакет из трёх запросов: ВТ, чтение её без алиаса и с алиасом, уничтожение — для типа запроса и имени ВТ. */
const TEMP_BATCH = [
	'ВЫБРАТЬ',
	'\tТ.Ссылка КАК Ссылка,',
	'\tТ.Код КАК Код',
	'ПОМЕСТИТЬ ВТ_Валюты',
	'ИЗ',
	'\tСправочник.Валюты КАК Т',
	';',
	'',
	'////////////////////////////////////////////////////////////////////////////////',
	'ВЫБРАТЬ',
	'\tВТ_Валюты.Ссылка КАК Ссылка,',
	'\tВ.Код КАК Код',
	'ИЗ',
	'\tВТ_Валюты',
	'\t\tЛЕВОЕ СОЕДИНЕНИЕ ВТ_Валюты КАК В',
	'\t\tПО ВТ_Валюты.Ссылка = В.Ссылка',
	';',
	'',
	'////////////////////////////////////////////////////////////////////////////////',
	'УНИЧТОЖИТЬ ВТ_Валюты',
].join('\n');

/** Сборка финальной модели со сплайсом: самопроверка, круг модели, какие запросы пакета собраны заново. */
function spliced(model: Model, initial: Model, label: string): { text: string; changed: boolean[] } {
	const final = E.finalize(model, initial);
	const report = Q.buildWithReport(final);
	const check = Q.selfCheck(report.text);
	assert.ok(check.ok, `${label}: самопроверка: ${check.message}\n${report.text}`);
	assert.ok(Q.sameModel(Q.parse(report.text).model, final), `${label}: круг модели\n${report.text}`);
	return { text: report.text, changed: report.changed };
}

describe('Конструктор запроса: «Дополнительно»', () => {
	const base = 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Т';

	test('Первые N, Без повторяющихся, Разрешенные: порядок РАЗРЕШЕННЫЕ РАЗЛИЧНЫЕ ПЕРВЫЕ, отказ на не число, тот же флаг — та же модель', () => {
		const model = parsed(base);
		const flagged = frozen(model, () => ok(E.setPartFlags(model, A, { top: '10', distinct: true, allowed: true })));
		assert.ok(roundTrip(flagged.model, 'флаги').startsWith('ВЫБРАТЬ РАЗРЕШЕННЫЕ РАЗЛИЧНЫЕ ПЕРВЫЕ 10\n'));
		assert.equal(firstPart(flagged.model).top, 10);
		assert.equal(ok(E.setPartFlags(flagged.model, A, { top: 10, distinct: true })).model, flagged.model, 'без изменений — та же модель');
		const cleared = ok(E.setPartFlags(flagged.model, A, { top: '', distinct: false, allowed: false }));
		assert.equal(roundTrip(cleared.model, 'снятые флаги'), base);
		assert.match(E.setPartFlags(model, A, { top: '0' }).error ?? '', /больше нуля/);
		assert.match(E.setPartFlags(model, A, { top: 'десять' }).error ?? '', /больше нуля/);
	});

	test('«Разрешенные» в объединении — у первой части, «Без повторяющихся» и «Первые» — у своей', () => {
		const union = parsed(base + '\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tТ.Ссылка,\n\tТ.Код\nИЗ\n\tСправочник.Валюты КАК Т');
		const second = { statement: 0, part: 1 };
		const result = ok(E.setPartFlags(union, second, { allowed: true, distinct: true, top: 5 }));
		const parts = result.model.statements[0].parts;
		assert.equal(parts[0].allowed, true, 'РАЗРЕШЕННЫЕ — у первой части');
		assert.equal(parts[1].allowed, false);
		assert.equal(parts[1].distinct, true);
		assert.equal(parts[1].top, 5);
		assert.equal(parts[0].distinct, false);
		roundTrip(result.model, 'флаги объединения');
	});

	test('тип запроса: выборка → создание ВТ ({ВЫБРАТЬ} за ПОМЕСТИТЬ) → ДОБАВИТЬ (индексы сняты) → УНИЧТОЖИТЬ → выборка (вернулся прежний запрос)', () => {
		const withBlock = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\n{ВЫБРАТЬ\n\tСсылка.*}\nИЗ\n\tСправочник.Валюты КАК Т');
		assert.equal(E.statementKind(withBlock.statements[0]), 'select');
		const created = frozen(withBlock, () => ok(E.setStatementKind(withBlock, 0, { kind: 'create' })));
		assert.equal(E.statementKind(created.model.statements[0]), 'create');
		assert.equal(E.tempTableOf(created.model.statements[0]), 'ВременнаяТаблица', 'имя по умолчанию');
		assert.equal(
			roundTrip(created.model, 'создание ВТ'),
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nПОМЕСТИТЬ ВременнаяТаблица\n{ВЫБРАТЬ\n\tСсылка.*}\nИЗ\n\tСправочник.Валюты КАК Т'
		);
		const indexed = ok(E.addIndexField(ok(E.addIndex(created.model, 0)).model, 0, 0, 'Код')).model;
		const added = ok(E.setStatementKind(indexed, 0, { kind: 'add', table: 'ВТ_Курсы' }));
		assert.ok(added.warnings?.some((line) => line.startsWith('Индексы временной таблицы сняты')));
		assert.ok(added.warnings?.some((line) => line.includes('раньше в пакете не создаётся')));
		assert.deepEqual(added.model.statements[0].indexes, []);
		assert.ok(roundTrip(added.model, 'ДОБАВИТЬ').includes('\nДОБАВИТЬ ВТ_Курсы\n'));
		const dropped = ok(E.setStatementKind(added.model, 0, { kind: 'drop' }));
		assert.equal(roundTrip(dropped.model, 'УНИЧТОЖИТЬ'), 'УНИЧТОЖИТЬ ВТ_Курсы', 'имя — прежнее');
		assert.ok(dropped.stash, 'прежний запрос отдан окну');
		const restored = ok(E.setStatementKind(dropped.model, 0, { kind: 'select', restore: dropped.stash }));
		assert.ok(Q.sameModel(restored.model, ok(E.setStatementKind(added.model, 0, { kind: 'select' })).model), 'выборка из прежнего запроса');
		const fresh = ok(E.setStatementKind(dropped.model, 0, { kind: 'select' }));
		assert.deepEqual(E.problems(fresh.model), ['Запрос: нет полей выборки, добавьте их на вкладке «Таблицы и поля».'], 'без stash — пустой запрос');
		const back = ok(E.setStatementKind(created.model, 0, { kind: 'select' }));
		assert.ok(Q.sameModel(back.model, withBlock), 'снятое ПОМЕСТИТЬ — {ВЫБРАТЬ} снова за списком выборки');
		assert.equal(ok(E.setStatementKind(withBlock, 0, { kind: 'select' })).model, withBlock, 'тот же тип — та же модель');
		assert.match(E.setStatementKind(withBlock, 0, { kind: 'create', table: 'ИЗ' }).error ?? '', /ключевое слово/);
		assert.match(E.setStatementKind(withBlock, 0, { kind: 'create', table: 'Два слова' }).error ?? '', /одно слово/);
		assert.match(E.setStatementKind(withBlock, 0, { kind: 'тип' }).error ?? '', /Неизвестный/);
		const plainDrop = ok(E.setStatementKind(withBlock, 0, { kind: 'drop' }));
		assert.equal(Q.build(plainDrop.model), 'УНИЧТОЖИТЬ ВременнаяТаблица', 'без ВТ в пакете — имя по умолчанию, его правят полем имени');
		assert.ok(plainDrop.warnings?.some((line) => line.includes('раньше в пакете не создаётся')));
	});

	test('имя ВТ: создание переименовывает чтения, ДОБАВИТЬ и УНИЧТОЖИТЬ дальше по пакету (источник без алиаса получает прежнее имя алиасом); занятое имя — отказ', () => {
		const model = parsed(TEMP_BATCH);
		const renamed = frozen(model, () => ok(E.renameTempTable(model, 0, 'ВТ_Курсы')));
		assert.deepEqual(renamed.warnings, ['ВТ «ВТ_Валюты» переименована и в запросах пакета 2, 3.']);
		const out = spliced(renamed.model, model, 'имя ВТ');
		assert.deepEqual(out.changed, [true, true, true]);
		assert.ok(out.text.includes('ПОМЕСТИТЬ ВТ_Курсы'), out.text);
		assert.ok(out.text.includes('\tВТ_Курсы КАК ВТ_Валюты\n\t\tЛЕВОЕ СОЕДИНЕНИЕ ВТ_Курсы КАК В'), 'ссылки ВТ_Валюты.Ссылка остались верными');
		assert.ok(out.text.endsWith('УНИЧТОЖИТЬ ВТ_Курсы'));
		// Повторное создание той же ВТ останавливает переименование: дальше — уже другая таблица
		const recreated = parsed(TEMP_BATCH.replace('УНИЧТОЖИТЬ ВТ_Валюты', 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nПОМЕСТИТЬ ВТ_Валюты\nИЗ\n\tСправочник.Валюты КАК Т'));
		const stopped = ok(E.renameTempTable(recreated, 0, 'ВТ_Курсы'));
		assert.deepEqual(stopped.warnings, ['ВТ «ВТ_Валюты» переименована и в запросах пакета 2.']);
		assert.equal(E.tempTableOf(stopped.model.statements[2]), 'ВТ_Валюты');
		assert.equal(ok(E.renameTempTable(model, 0, 'ВТ_Валюты')).model, model, 'то же имя — та же модель');
		const later = parsed(TEMP_BATCH.replace('УНИЧТОЖИТЬ ВТ_Валюты', 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nПОМЕСТИТЬ ВТ_Курсы\nИЗ\n\tСправочник.Валюты КАК Т'));
		assert.match(E.renameTempTable(later, 2, 'ВТ_Валюты').error ?? '', /уже создана запросом пакета 1/);
		assert.match(E.setStatementKind(later, 1, { kind: 'create', table: 'ВТ_Валюты' }).error ?? '', /уже создана запросом пакета 1/);
		const drop = ok(E.renameTempTable(model, 2, 'ВТ_Другая'));
		assert.ok(spliced(drop.model, model, 'имя УНИЧТОЖИТЬ').text.endsWith('УНИЧТОЖИТЬ ВТ_Другая'), 'у уничтожения — только своё имя');
		assert.match(E.renameTempTable(model, 1, 'ВТ_Х').error ?? '', /не работает с временной таблицей/);
	});

	test('имя ВТ у ДОБАВИТЬ и УНИЧТОЖИТЬ: таблица, которой до запроса в пакете нет, — предупреждение (плашка пакета её не заметит)', () => {
		const model = parsed(TEMP_BATCH);
		const drop = ok(E.renameTempTable(model, 2, 'ВТ_Опечатка'));
		assert.deepEqual(drop.warnings, ['ВТ «ВТ_Опечатка» раньше в пакете не создаётся: уничтожить можно только созданную таблицу (или внешнюю).']);
		// Плашка «Пакета запросов» считает несозданную таблицу внешней и молчит: без предупреждения правки опечатка прошла бы тихо
		assert.ok(!E.batchWarnings(drop.model).some((line) => line.includes('ВТ_Опечатка')), 'плашка пакета называет несозданную таблицу');
		assert.deepEqual(ok(E.renameTempTable(drop.model, 2, 'вт_валюты')).warnings, [], 'созданная таблица (регистр не важен) — без предупреждения');
		const added = ok(E.setStatementKind(model, 1, { kind: 'add', table: 'ВТ_Валюты' }));
		assert.ok(!added.warnings?.some((line) => line.includes('раньше в пакете не создаётся')), 'ДОБАВИТЬ в созданную таблицу');
		const typo = ok(E.renameTempTable(added.model, 1, 'ВТ_Опечатка'));
		assert.deepEqual(typo.warnings, [
			'ВТ «ВТ_Опечатка» раньше в пакете не создаётся: добавлять можно только в созданную таблицу (или внешнюю) с тем же составом колонок.',
		]);
		assert.ok(!E.batchWarnings(typo.model).some((line) => line.includes('ВТ_Опечатка')), 'плашка пакета называет несозданную таблицу');
		assert.deepEqual(ok(E.renameTempTable(typo.model, 1, 'ВТ_Валюты')).warnings, []);
		// Тот же тип с новым именем идёт через переименование — и предупреждение то же
		assert.deepEqual(ok(E.setStatementKind(model, 2, { kind: 'drop', table: 'ВТ_Опечатка' })).warnings, drop.warnings);
	});

	test('выборка вместо создания ВТ, которую читают дальше, — с предупреждением; ДЛЯ ИЗМЕНЕНИЯ — только просмотр', () => {
		const model = parsed(TEMP_BATCH);
		const select = ok(E.setStatementKind(model, 0, { kind: 'select' }));
		assert.deepEqual(select.warnings, ['ВТ «ВТ_Валюты» больше не создаётся, а её читают запросы пакета 2.']);
		assert.deepEqual(E.batchWarnings(select.model), [], 'несозданная в пакете ВТ может быть внешней');
		const forUpdate = parsed(base + '\nДЛЯ ИЗМЕНЕНИЯ\n\tСправочник.Валюты');
		assert.deepEqual(E.forUpdateOf(forUpdate.statements[0]), { tables: ['Справочник.Валюты'] });
		assert.deepEqual(E.forUpdateOf(parsed(base + '\nДЛЯ ИЗМЕНЕНИЯ').statements[0]), { tables: [] }, 'без списка — все таблицы');
		assert.equal(E.forUpdateOf(model.statements[0]), null);
	});
});

describe('Конструктор запроса: «Индекс»', () => {
	const text = 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код,\n\tТ.Наименование\nПОМЕСТИТЬ ВТ_Валюты\nИЗ\n\tСправочник.Валюты КАК Т';

	test('один индекс — ИНДЕКСИРОВАТЬ ПО, уникальность, порядок полей; несколько — ПО НАБОРАМ; индекс без полей держит ОК', () => {
		const model = parsed(text);
		assert.deepEqual(E.indexColumns(model.statements[0]), ['Ссылка', 'Код', 'Наименование'], 'колонки — по именам выборки');
		let current = frozen(model, () => ok(E.addIndex(model, 0))).model;
		assert.deepEqual(E.problems(current), ['Запрос: у индекса 1 нет полей, добавьте их на вкладке «Индекс» или удалите индекс.']);
		current = ok(E.addIndexField(current, 0, 0, 'код')).model;
		assert.deepEqual(current.statements[0].indexes, [{ unique: false, fields: ['Код'] }], 'имя — как у колонки');
		current = ok(E.addIndexField(current, 0, 0, 'Ссылка')).model;
		const moved = ok(E.moveIndexField(current, 0, 0, 1, -1));
		assert.equal(moved.index, 0);
		current = ok(E.setIndexUnique(moved.model, 0, 0, true)).model;
		assert.ok(roundTrip(current, 'один индекс').endsWith('ИНДЕКСИРОВАТЬ ПО\n\tСсылка,\n\tКод УНИКАЛЬНО'));
		current = ok(E.addIndex(current, 0)).model;
		current = ok(E.addIndexField(current, 0, 1, 'Наименование')).model;
		assert.ok(roundTrip(current, 'ПО НАБОРАМ').endsWith('ИНДЕКСИРОВАТЬ ПО НАБОРАМ ((Ссылка, Код) УНИКАЛЬНО, (Наименование))'));
		assert.deepEqual(E.problems(current), []);
		assert.match(E.addIndexField(current, 0, 1, 'Наименование').error ?? '', /уже в индексе/);
		assert.match(E.addIndexField(current, 0, 1, 'Нет').error ?? '', /нет/);
		current = ok(E.removeIndexField(current, 0, 0, 1)).model;
		current = ok(E.removeIndex(current, 0, 1)).model;
		assert.ok(roundTrip(current, 'снятые').endsWith('ИНДЕКСИРОВАТЬ ПО\n\tСсылка УНИКАЛЬНО'));
		assert.equal(ok(E.setIndexUnique(current, 0, 0, true)).model, current, 'тот же флаг — та же модель');
		assert.equal(ok(E.moveIndexField(current, 0, 0, 0, -1)).model, current, 'за край — без правки');
		assert.match(E.addIndex(parsed('ВЫБРАТЬ\n\tТ.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Т'), 0).error ?? '', /создаёт временную таблицу/);
	});

	test('корпус: индекс запроса ssl31 читается, правка уникальности — только свой запрос пакета', () => {
		const query = corpus.find((item) => Q.parse(item.text).model.statements.some((statement) => (statement.indexes ?? []).length > 0));
		assert.ok(query, 'в корпусе есть ИНДЕКСИРОВАТЬ ПО');
		const model = parsed(query.text);
		const index = model.statements.findIndex((statement) => (statement.indexes ?? []).length > 0);
		const result = ok(E.setIndexUnique(model, index, 0, true));
		const out = spliced(result.model, model, 'уникальность в корпусе');
		assert.deepEqual(out.changed, model.statements.map((_item, k) => k === index));
	});
});

describe('Конструктор запроса: «Объединения/Псевдонимы»', () => {
	const two = [
		'ВЫБРАТЬ',
		'\tТ.Ссылка КАК Ссылка,',
		'\tТ.Код',
		'ИЗ',
		'\tСправочник.Валюты КАК Т',
		'',
		'ОБЪЕДИНИТЬ ВСЕ',
		'',
		'ВЫБРАТЬ',
		'\tП.Ссылка,',
		'\tП.Код',
		'ИЗ',
		'\tСправочник.Пользователи КАК П',
		'УПОРЯДОЧИТЬ ПО',
		'\tКод',
	].join('\n');

	test('таблица соответствия: части с «Без дублей», колонки по первой части; корпус ssl31 — ОБЪЕДИНИТЬ без ВСЕ', () => {
		const rows = E.unionRows(parsed(two).statements[0]);
		assert.deepEqual(rows.parts, [
			{ index: 0, label: 'Запрос 1', noDuplicates: false },
			{ index: 1, label: 'Запрос 2', noDuplicates: false },
		]);
		assert.deepEqual(
			rows.columns.map((column) => [column.name, column.cells.map((cell) => cell.expr)]),
			[
				['Ссылка', ['Т.Ссылка', 'П.Ссылка']],
				['Код', ['Т.Код', 'П.Код']],
			]
		);
		const union = corpus.map((item) => parsed(item.text)).find((model) => model.statements[0].parts.length === 3);
		assert.ok(union);
		assert.deepEqual(
			E.unionRows(union.statements[0]).parts.map((part) => part.noDuplicates),
			[false, true, true]
		);
	});

	test('явный псевдоним: КАК в первой части — explicit, имя из пути — нет; переименование колонки делает его явным', () => {
		const model = parsed(two);
		assert.deepEqual(
			E.unionRows(model.statements[0]).columns.map((column) => [column.name, column.explicit]),
			[
				['Ссылка', true],
				['Код', false],
			],
			'псевдоним второй части колонку не называет'
		);
		const renamed = ok(E.renameColumn(model, 0, 1, 'КодВалюты'));
		assert.deepEqual(
			E.unionRows(renamed.model.statements[0]).columns.map((column) => [column.name, column.explicit]),
			[
				['Ссылка', true],
				['КодВалюты', true],
			]
		);
		const bare = parsed('ВЫБРАТЬ\n\t1,\n\tТ.Ссылка\nИЗ\n\tСправочник.Валюты КАК Т');
		assert.deepEqual(
			E.unionRows(bare.statements[0]).columns.map((column) => [column.name, column.explicit]),
			[
				[null, false],
				['Ссылка', false],
			],
			'выражение без псевдонима — без имени и без пометки'
		);
	});

	test('части: добавить (NULL во всех колонках), копия, «Без дублей», перестановка с первой (имена колонок за позициями), удаление первой', () => {
		const model = parsed(two);
		const added = frozen(model, () => ok(E.addPart(model, 0)));
		assert.equal(added.index, 2);
		assert.ok(roundTrip(added.model, 'новая часть').endsWith('ОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tNULL,\n\tNULL\nУПОРЯДОЧИТЬ ПО\n\tКод'));
		const copied = ok(E.copyPart(model, 0, 0));
		assert.equal(copied.index, 1);
		assert.deepEqual(
			copied.model.statements[0].parts[1].fields,
			[
				{ expr: 'Т.Ссылка', alias: null },
				{ expr: 'Т.Код', alias: null },
			],
			'у копии нет псевдонимов'
		);
		roundTrip(copied.model, 'копия части');
		const distinct = ok(E.setUnionDistinct(model, 0, 1, true));
		assert.ok(roundTrip(distinct.model, 'без дублей').includes('\n\nОБЪЕДИНИТЬ\n\nВЫБРАТЬ'));
		assert.equal(ok(E.setUnionDistinct(distinct.model, 0, 1, true)).model, distinct.model);
		assert.match(E.setUnionDistinct(model, 0, 0, true).error ?? '', /второй и следующих/);
		const moved = ok(E.movePart(distinct.model, 0, 1, -1));
		assert.equal(moved.index, 0);
		const movedText = roundTrip(moved.model, 'перестановка');
		assert.ok(
			movedText.startsWith('ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка,\n\tП.Код КАК Код\nИЗ\n\tСправочник.Пользователи КАК П\n\nОБЪЕДИНИТЬ\n\nВЫБРАТЬ\n\tТ.Ссылка,\n\tТ.Код\n'),
			movedText
		);
		const removed = ok(E.removePart(model, 0, 0));
		assert.equal(
			roundTrip(removed.model, 'удаление первой'),
			'ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка,\n\tП.Код КАК Код\nИЗ\n\tСправочник.Пользователи КАК П\nУПОРЯДОЧИТЬ ПО\n\tКод'
		);
		assert.match(E.removePart(removed.model, 0, 0).error ?? '', /одна/);
	});

	test('перестановка части больше чем на одну позицию (перенос мышью): первой становится та, что встала на место 0, — как цепочка сдвигов на одну', () => {
		const three = parsed(
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nПОМЕСТИТЬ ВТ\nИЗ\n\tСправочник.Валюты КАК Т\n\nОБЪЕДИНИТЬ\n\nВЫБРАТЬ\n\tП.Ссылка\nИЗ\n\tСправочник.Пользователи КАК П\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tО.Ссылка\nИЗ\n\tСправочник.Организации КАК О'
		);
		// Первая часть — сразу на третье место: первой становится следующая за ней («П»), а не та, на чьё место она ушла
		const down = frozen(three, () => ok(E.movePart(three, 0, 0, 2)));
		assert.equal(down.index, 2);
		const parts = down.model.statements[0].parts;
		assert.deepEqual(
			parts.map((part) => part.from[0].source.alias),
			['П', 'О', 'Т']
		);
		assert.deepEqual(parts[0].into, { table: 'ВТ', mode: 'create' }, 'ПОМЕСТИТЬ — у новой первой части');
		assert.equal(parts[2].into, null);
		assert.deepEqual(
			parts.map((part) => part.unionAll ?? null),
			[null, true, false],
			'оператор пары с первой частью («ОБЪЕДИНИТЬ») уехал с прежней первой, у остальных — свой'
		);
		assert.deepEqual(
			parts.map((part) => part.fields[0].alias),
			['Ссылка', null, null],
			'имя колонки — у первой позиции'
		);
		const downText = roundTrip(down.model, 'первая часть на третье место');
		assert.ok(downText.startsWith('ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка\nПОМЕСТИТЬ ВТ\nИЗ\n\tСправочник.Пользователи КАК П\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tО.Ссылка'), downText);
		const stepwise = ok(E.movePart(ok(E.movePart(three, 0, 0, 1)).model, 0, 1, 1));
		assert.equal(Q.build(down.model), Q.build(stepwise.model), 'сдвиг на две — то же, что два сдвига на одну');
		// Третья часть — сразу на первое место
		const up = ok(E.movePart(three, 0, 2, -2));
		assert.equal(up.index, 0);
		assert.deepEqual(
			up.model.statements[0].parts.map((part) => part.from[0].source.alias),
			['О', 'Т', 'П']
		);
		assert.deepEqual(up.model.statements[0].parts[0].into, { table: 'ВТ', mode: 'create' });
		roundTrip(up.model, 'третья часть на первое место');
		const upStepwise = ok(E.movePart(ok(E.movePart(three, 0, 2, -1)).model, 0, 1, -1));
		assert.equal(Q.build(up.model), Q.build(upStepwise.model), 'сдвиг на две вверх — то же, что два сдвига на одну');
	});

	test('ПОМЕСТИТЬ и {ВЫБРАТЬ} уходят к новой первой части; новая часть у запроса с порядком по таблице — предупреждение', () => {
		const model = parsed(
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nПОМЕСТИТЬ ВТ\n{ВЫБРАТЬ\n\tСсылка.*}\nИЗ\n\tСправочник.Валюты КАК Т\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tП.Ссылка\nИЗ\n\tСправочник.Пользователи КАК П'
		);
		const moved = ok(E.movePart(model, 0, 0, 1));
		const parts = moved.model.statements[0].parts;
		assert.deepEqual(parts[0].into, { table: 'ВТ', mode: 'create' });
		assert.equal(parts[1].into, null);
		assert.ok(parts[0].dcsSelect && !parts[1].dcsSelect);
		assert.ok(
			roundTrip(moved.model, 'ПОМЕСТИТЬ у первой').startsWith('ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка\nПОМЕСТИТЬ ВТ\n{ВЫБРАТЬ\n\tСсылка.*}\nИЗ\n\tСправочник.Пользователи КАК П')
		);
		const ordered = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Т\nУПОРЯДОЧИТЬ ПО\n\tТ.Код');
		assert.deepEqual(ok(E.addPart(ordered, 0)).warnings, ['В объединении порядок задаётся по колонкам результата: поправьте «Т.Код» на вкладке «Порядок».']);
	});

	test('ячейка: выражение другой колонки части меняется местами, «пусто» — NULL; в первой части имя колонки закрепляется явным КАК', () => {
		const model = parsed(two);
		const swapped = frozen(model, () => ok(E.setUnionCell(model, 0, 0, 1, 1)));
		assert.deepEqual(
			swapped.model.statements[0].parts[1].fields.map((field) => field.expr),
			['П.Код', 'П.Ссылка']
		);
		roundTrip(swapped.model, 'перестановка в части 2');
		const firstSwap = ok(E.setUnionCell(model, 0, 0, 0, 1));
		assert.deepEqual(
			firstSwap.model.statements[0].parts[0].fields,
			[
				{ expr: 'Т.Код', alias: 'Ссылка' },
				{ expr: 'Т.Ссылка', alias: 'Код' },
			],
			'имена колонок остались за позициями'
		);
		roundTrip(firstSwap.model, 'перестановка в части 1');
		const cleared = ok(E.setUnionCell(model, 0, 1, 0, null));
		assert.deepEqual(cleared.model.statements[0].parts[0].fields[1], { expr: 'NULL', alias: 'Код' });
		assert.ok(roundTrip(cleared.model, 'NULL').includes('\tNULL КАК Код\n'));
		assert.equal(ok(E.setUnionCell(cleared.model, 0, 1, 0, null)).model, cleared.model);
		assert.equal(ok(E.setUnionCell(model, 0, 1, 1, 1)).model, model, 'то же выражение — та же модель');
		const ragged = parsed('ВЫБРАТЬ\n\t1 КАК А,\n\t2 КАК Б\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\t3');
		assert.match(E.setUnionCell(ragged, 0, 0, 1, null).error ?? '', /разное/);
		assert.equal(E.unionRows(ragged.statements[0]).aligned, false);
	});

	test('псевдоним колонки: явный КАК, ссылки в УПОРЯДОЧИТЬ ПО, {ВЫБРАТЬ} и индексе; повтор — отказ; ВТ, которую читают дальше, — предупреждение', () => {
		const model = parsed(two);
		const renamed = frozen(model, () => ok(E.renameColumn(model, 0, 1, 'КодВалюты')));
		const renamedText = roundTrip(renamed.model, 'псевдоним');
		assert.ok(renamedText.includes('\tТ.Код КАК КодВалюты\n'), renamedText);
		assert.ok(renamedText.endsWith('УПОРЯДОЧИТЬ ПО\n\tКодВалюты'), renamedText);
		assert.match(E.renameColumn(model, 0, 0, 'код').error ?? '', /уже есть/);
		assert.match(E.renameColumn(model, 0, 1, 'ИЗ').error ?? '', /ключевое слово/);
		assert.equal(ok(E.renameColumn(model, 0, 1, 'Код')).model, model, 'то же имя (неявное) — та же модель');
		const temp = parsed(
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nПОМЕСТИТЬ ВТ\n{ВЫБРАТЬ\n\tКод.*}\nИЗ\n\tСправочник.Валюты КАК Т\nИНДЕКСИРОВАТЬ ПО\n\tКод\n;\nВЫБРАТЬ\n\tВТ.Код КАК Код\nИЗ\n\tВТ КАК ВТ'
		);
		const tempRenamed = ok(E.renameColumn(temp, 0, 1, 'КодВалюты'));
		assert.deepEqual(tempRenamed.model.statements[0].indexes, [{ unique: false, fields: ['КодВалюты'] }]);
		assert.equal(firstPart(tempRenamed.model).dcsSelect?.items[0].path, 'КодВалюты');
		assert.deepEqual(tempRenamed.warnings, ['Колонка ВТ «ВТ» переименована: запросы пакета 2 обращаются к ней по прежнему имени «Код». Поправьте их.']);
		assert.deepEqual(spliced(tempRenamed.model, temp, 'колонка ВТ').changed, [true, false]);
		const single = parsed('ВЫБРАТЬ\n\tКод.Ссылка КАК Код\nИЗ\n\tСправочник.Валюты КАК Код\nУПОРЯДОЧИТЬ ПО\n\tКод.Наименование,\n\tКод');
		const singleRenamed = ok(E.renameColumn(single, 0, 0, 'Валюта'));
		assert.deepEqual(
			singleRenamed.model.statements[0].orderBy?.map((item) => item.expr),
			['Код.Наименование', 'Валюта'],
			'голова-алиас таблицы не тронута'
		);
	});
});

describe('Конструктор запроса: «Порядок»', () => {
	const base = 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Т';

	test('поле и направление, ↑↓, удаление последнего снимает предложение, автоупорядочивание; повтор — отказ', () => {
		const model = parsed(base);
		let current = frozen(model, () => ok(E.addOrder(model, 0, 'Код', 'desc'))).model;
		current = ok(E.addOrder(current, 0, 'Т.Наименование')).model;
		current = ok(E.addOrder(current, 0, 'Т.Родитель', 'hierarchyDesc')).model;
		assert.deepEqual(
			E.orderRows(current.statements[0]).map((row) => [row.expr, row.direction]),
			[
				['Код', 'desc'],
				['Т.Наименование', 'asc'],
				['Т.Родитель', 'hierarchyDesc'],
			]
		);
		assert.ok(roundTrip(current, 'порядок').endsWith('УПОРЯДОЧИТЬ ПО\n\tКод УБЫВ,\n\tТ.Наименование,\n\tТ.Родитель ИЕРАРХИЯ УБЫВ'));
		assert.match(E.addOrder(current, 0, 'код').error ?? '', /уже в порядке/);
		const moved = ok(E.moveOrder(current, 0, 2, -2));
		assert.equal(moved.index, 0);
		assert.equal(moved.model.statements[0].orderBy?.[0].expr, 'Т.Родитель');
		const direction = ok(E.setOrderDirection(current, 0, 1, 'desc'));
		assert.ok(roundTrip(direction.model, 'направление').includes('\tТ.Наименование УБЫВ,'));
		assert.equal(ok(E.setOrderDirection(current, 0, 0, 'desc')).model, current);
		assert.match(E.setOrderDirection(current, 0, 0, 'вбок').error ?? '', /направление/);
		let removed = current;
		for (let k = 0; k < 3; k++) {
			removed = ok(E.removeOrder(removed, 0, 0)).model;
		}
		assert.equal(removed.statements[0].orderBy, null);
		assert.equal(roundTrip(removed, 'без порядка'), base);
		const auto = ok(E.setAutoOrder(model, 0, true));
		assert.ok(roundTrip(auto.model, 'автоупорядочивание').endsWith('\nАВТОУПОРЯДОЧИВАНИЕ'));
		assert.equal(ok(E.setAutoOrder(auto.model, 0, true)).model, auto.model);
		assert.match(E.addOrder(model, 0, '   ').error ?? '', /Пустое/);
	});
});

describe('Конструктор запроса: «Пакет запросов»', () => {
	test('строки пакета: имя ВТ или «Запрос пакета N», вид, запрос с полями набора (последняя выборка)', () => {
		const model = parsed(TEMP_BATCH);
		assert.deepEqual(
			E.batchRows(model).map((row) => [row.label, row.note, row.dataSet]),
			[
				['ВТ_Валюты', 'создание ВТ', false],
				['Запрос пакета 2', 'выборка', true],
				['Уничтожение ВТ_Валюты', 'уничтожение ВТ', false],
			]
		);
		assert.equal(E.dataSetStatementIndex(model), 1);
		assert.deepEqual(E.batchWarnings(model), []);
	});

	test('подпись строки списка — та же, что у вертикальной вкладки запроса (создание, добавление, уничтожение, выборка)', () => {
		const model = parsed('ВЫБРАТЬ\n\t1 КАК А\nПОМЕСТИТЬ ВТ\n;\nВЫБРАТЬ\n\t2 КАК А\nДОБАВИТЬ ВТ\n;\nВЫБРАТЬ\n\tВТ.А КАК А\nИЗ\n\tВТ КАК ВТ\n;\nУНИЧТОЖИТЬ ВТ');
		const labels = E.batchRows(model).map((row) => row.label);
		assert.deepEqual(labels, ['ВТ', 'Добавление в ВТ', 'Запрос пакета 3', 'Уничтожение ВТ']);
		assert.deepEqual(
			labels,
			model.statements.map((statement, index) => E.statementTabLabel(statement, index)),
			'один запрос на одном экране называется одинаково'
		);
		assert.deepEqual(
			E.batchRows(model).map((row) => row.kind),
			['create', 'add', 'select', 'drop']
		);
	});

	test('добавить, копировать (копия создания ВТ — свободное имя), удалить, ↑↓: неизменённые запросы — исходными срезами', () => {
		const model = parsed(TEMP_BATCH);
		const added = frozen(model, () => ok(E.addStatement(model, 1)));
		assert.equal(added.index, 2);
		assert.deepEqual(E.problems(added.model), ['Запрос пакета 3: нет полей выборки, добавьте их на вкладке «Таблицы и поля».']);
		const third = { statement: 2, part: 0 };
		const filled = ok(E.addField(ok(E.addSource(added.model, third, { table: 'ВТ_Валюты' })).model, third, 'ВТ_Валюты1.Код')).model;
		const addedOut = spliced(filled, model, 'новый запрос');
		assert.deepEqual(addedOut.changed, [false, false, true, false]);
		const head = (model.statements[0].original?.text ?? '-') + (model.statements[1].original?.before ?? '-') + (model.statements[1].original?.text ?? '-');
		assert.ok(addedOut.text.startsWith(head), 'первые два запроса и разделитель — исходные');
		const copied = ok(E.copyStatement(model, 0));
		assert.deepEqual(copied.warnings, ['Копия создаёт ВТ «ВТ_Валюты1»: одну таблицу дважды в пакете не создают.']);
		assert.deepEqual(spliced(copied.model, model, 'копия').changed, [false, true, false, false]);
		const removed = ok(E.removeStatement(model, 2));
		const removedOut = spliced(removed.model, model, 'удаление последнего');
		assert.deepEqual(removedOut.changed, [false, false]);
		assert.equal(removedOut.text, TEMP_BATCH.slice(0, TEMP_BATCH.indexOf('\n;\n\n' + '/'.repeat(80) + '\nУНИЧТОЖИТЬ')));
		const middle = ok(E.removeStatement(model, 1));
		assert.deepEqual(middle.warnings, []);
		const middleOut = spliced(middle.model, model, 'удаление среднего');
		assert.deepEqual(middleOut.changed, [false, false]);
		assert.ok(middleOut.text.endsWith('\n;\n\n' + '/'.repeat(80) + '\nУНИЧТОЖИТЬ ВТ_Валюты'), 'разрыв соседства — канонический разделитель');
		const firstRemoved = ok(E.removeStatement(model, 0));
		assert.deepEqual(firstRemoved.warnings, ['Удалён запрос, создававший ВТ «ВТ_Валюты», а её читают запросы пакета 1 (номера после удаления).']);
		const moved = ok(E.moveStatement(model, 0, 1));
		assert.equal(moved.index, 1);
		assert.deepEqual(moved.warnings, ['Запрос пакета 1 читает ВТ «ВТ_Валюты», которая создаётся позже (запрос пакета 2).']);
		assert.deepEqual(spliced(moved.model, model, 'перестановка').changed, [false, false, false], 'тексты запросов — исходные, меняются разделители');
		assert.equal(ok(E.moveStatement(model, 0, -1)).model, model, 'за край — без правки');
		assert.match(E.removeStatement(parsed('ВЫБРАТЬ 1 КАК А'), 0).error ?? '', /один запрос/);
	});

	test('зависимости ВТ: повторное создание, уничтожение и ДОБАВИТЬ раньше создания, пакет без выборки; внешняя ВТ — без предупреждения', () => {
		const twice = parsed('ВЫБРАТЬ\n\t1 КАК А\nПОМЕСТИТЬ ВТ\n;\nВЫБРАТЬ\n\t2 КАК А\nПОМЕСТИТЬ ВТ');
		assert.deepEqual(E.batchWarnings(twice), [
			'Запрос пакета 2 создаёт ВТ «ВТ» повторно: до этого её не уничтожили.',
			'В пакете нет запроса выборки без ПОМЕСТИТЬ: у набора данных не будет полей.',
		]);
		const add = parsed('ВЫБРАТЬ\n\t1 КАК А\nДОБАВИТЬ ВТ\n;\nВЫБРАТЬ\n\t2 КАК А\nПОМЕСТИТЬ ВТ\n;\nВЫБРАТЬ\n\tВТ.А КАК А\nИЗ\n\tВТ КАК ВТ');
		assert.deepEqual(E.batchWarnings(add), ['Запрос пакета 1 дополняет ВТ «ВТ» раньше, чем она создаётся.']);
		const drop = parsed('УНИЧТОЖИТЬ ВТ\n;\nВЫБРАТЬ\n\t2 КАК А\nПОМЕСТИТЬ ВТ\n;\nВЫБРАТЬ\n\tВТ.А КАК А\nИЗ\n\tВТ КАК ВТ');
		assert.deepEqual(E.batchWarnings(drop), ['Запрос пакета 1 уничтожает ВТ «ВТ» раньше, чем она создаётся.']);
		assert.deepEqual(E.batchWarnings(parsed('ВЫБРАТЬ\n\tВнешняя.А КАК А\nИЗ\n\tВнешняя КАК Внешняя')), []);
	});

	/** Пакет «ПОМЕСТИТЬ ВТ → ДОБАВИТЬ ВТ → чтение ВТ»: поля создания и добавления — строками выборки. */
	function addBatch(created: string[], added: string[]): string {
		const separator = '\n;\n\n' + '/'.repeat(80) + '\n';
		return [
			'ВЫБРАТЬ\n' + created.map((line) => '\t' + line).join(',\n') + '\nПОМЕСТИТЬ ВТ\nИЗ\n\tСправочник.Валюты КАК Т',
			'ВЫБРАТЬ\n' + added.map((line) => '\t' + line).join(',\n') + '\nДОБАВИТЬ ВТ\nИЗ\n\tСправочник.Валюты КАК Т',
			'ВЫБРАТЬ\n\tВТ.Ссылка КАК Ссылка\nИЗ\n\tВТ КАК ВТ',
		].join(separator);
	}

	test('ДОБАВИТЬ с другим составом колонок, чем у создания ВТ: нет и лишние по именам, без учёта регистра и порядка', () => {
		// Создание с Ссылка и Код, добавление только со Ссылкой
		const short = parsed(addBatch(['Т.Ссылка КАК Ссылка', 'Т.Код КАК Код'], ['Т.Ссылка КАК Ссылка']));
		assert.ok(Q.selfCheck(addBatch(['Т.Ссылка КАК Ссылка', 'Т.Код КАК Код'], ['Т.Ссылка КАК Ссылка'])).ok, 'текст разбирается');
		assert.deepEqual(E.batchWarnings(short), ['Запрос пакета 2 добавляет в ВТ «ВТ» другой состав колонок, чем у её создания (запрос пакета 1): нет «Код».']);
		const other = parsed(addBatch(['Т.Ссылка КАК Ссылка', 'Т.Код КАК Код'], ['Т.Ссылка КАК Ссылка', 'Т.Наименование КАК Имя']));
		assert.deepEqual(E.batchWarnings(other), [
			'Запрос пакета 2 добавляет в ВТ «ВТ» другой состав колонок, чем у её создания (запрос пакета 1): нет «Код»; лишние «Имя».',
		]);
		// Тот же состав в другом порядке и регистре, имя из пути без КАК — предупреждения нет
		const same = parsed(addBatch(['Т.Ссылка КАК Ссылка', 'Т.Код КАК Код'], ['Т.Код КАК код', 'Т.Ссылка']));
		assert.deepEqual(E.batchWarnings(same), []);
		// Колонка без имени (выражение без КАК): по именам судить нельзя, сверяется число колонок
		assert.deepEqual(E.batchWarnings(parsed(addBatch(['Т.Ссылка КАК Ссылка', 'Т.Код КАК Код'], ['Т.Ссылка КАК Ссылка', '1']))), []);
		assert.deepEqual(E.batchWarnings(parsed(addBatch(['Т.Ссылка КАК Ссылка', '1'], ['Т.Ссылка КАК Ссылка']))), [
			'Запрос пакета 2 добавляет в ВТ «ВТ» другой состав колонок, чем у её создания (запрос пакета 1): колонок 1, а при создании 2.',
		]);
	});

	test('ДОБАВИТЬ сверяется с последним созданием ВТ: после УНИЧТОЖИТЬ и нового ПОМЕСТИТЬ — с ним; ранний ДОБАВИТЬ — предупреждение о порядке', () => {
		const separator = '\n;\n\n' + '/'.repeat(80) + '\n';
		const recreated = [
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nПОМЕСТИТЬ ВТ\nИЗ\n\tСправочник.Валюты КАК Т',
			'УНИЧТОЖИТЬ ВТ',
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nПОМЕСТИТЬ ВТ\nИЗ\n\tСправочник.Валюты КАК Т',
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nДОБАВИТЬ ВТ\nИЗ\n\tСправочник.Валюты КАК Т',
			'ВЫБРАТЬ\n\tВТ.Ссылка КАК Ссылка\nИЗ\n\tВТ КАК ВТ',
		].join(separator);
		assert.deepEqual(E.batchWarnings(parsed(recreated)), [], 'добавление совпадает со вторым созданием');
		const early = parsed('ВЫБРАТЬ\n\t1 КАК А\nДОБАВИТЬ ВТ\n;\nВЫБРАТЬ\n\t2 КАК Б\nПОМЕСТИТЬ ВТ\n;\nВЫБРАТЬ\n\tВТ.Б КАК Б\nИЗ\n\tВТ КАК ВТ');
		assert.deepEqual(E.batchWarnings(early), ['Запрос пакета 1 дополняет ВТ «ВТ» раньше, чем она создаётся.'], 'состав раннего добавления не сверяется');
	});

	test('корпус: «Без повторяющихся» и порядок в каждый запрос выборки — пересобран только он, круг модели', () => {
		let touched = 0;
		for (const query of corpus) {
			const model = Q.parse(query.text).model;
			model.statements.forEach((statement, si) => {
				if (statement.type !== 'select') {
					return;
				}
				const flagged = ok(E.setPartFlags(model, { statement: si, part: 0 }, { distinct: !statement.parts[0].distinct }));
				const columns = E.indexColumns(statement);
				const ordered = columns.length > 0 ? ok(E.addOrder(flagged.model, si, columns[0] + 'Проверка', 'desc')).model : flagged.model;
				const out = spliced(ordered, model, query.file);
				assert.deepEqual(
					out.changed,
					model.statements.map((_item, k) => k === si),
					`${query.file}: пересобран только изменённый запрос`
				);
				touched += 1;
			});
		}
		assert.ok(touched >= 50, `запросов ${touched}`);
	});
});

describe('Конструктор запроса: «Компоновка данных»', () => {
	const joins = [
		'ВЫБРАТЬ',
		'\tА.Ссылка КАК Ссылка',
		'ИЗ',
		'\tСправочник.А КАК А',
		'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Б КАК Б',
		'\t\tПО А.Ссылка = Б.Владелец',
		'\t\tВНУТРЕННЕЕ СОЕДИНЕНИЕ Справочник.В КАК В',
		'\t\tПО А.Ссылка = В.Владелец',
		'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Г КАК Г',
		'\t\tПО А.Ссылка = Г.Владелец',
	].join('\n');

	test('«Обязательная» и «Номер группы»: свои скобки, общая группа соседних — одни скобки, номера подряд как у разбора; строка ИЗ — отказ', () => {
		const model = parsed(joins);
		assert.deepEqual(
			E.compositionTables(firstPart(model)).map((row) => [row.alias, row.join, row.optional, row.group]),
			[
				['А', false, false, null],
				['Б', true, false, null],
				['В', true, false, null],
				['Г', true, false, null],
			]
		);
		let current = frozen(model, () => ok(E.setJoinRequired(model, A, [0, 2], false))).model;
		current = ok(E.setJoinRequired(current, A, [0, 0], false)).model;
		assert.deepEqual(
			E.compositionTables(firstPart(current)).map((row) => row.group),
			[null, 1, null, 2],
			'номера — по месту скобки'
		);
		let text = roundTrip(current, 'необязательные');
		assert.ok(text.includes('\t\t{ЛЕВОЕ СОЕДИНЕНИЕ Справочник.Б КАК Б\n\t\tПО А.Ссылка = Б.Владелец}\n\t\tВНУТРЕННЕЕ'), text);
		current = ok(E.setJoinRequired(current, A, [0, 1], false)).model;
		assert.deepEqual(
			E.compositionTables(firstPart(current)).map((row) => row.group),
			[null, 1, 2, 3]
		);
		const grouped = ok(E.setJoinGroup(current, A, [0, 2], 2));
		assert.deepEqual(grouped.warnings, []);
		assert.deepEqual(
			E.compositionTables(firstPart(grouped.model)).map((row) => row.group),
			[null, 1, 2, 2]
		);
		text = roundTrip(grouped.model, 'группа');
		assert.ok(
			text.endsWith('\t\t{ВНУТРЕННЕЕ СОЕДИНЕНИЕ Справочник.В КАК В\n\t\tПО А.Ссылка = В.Владелец\n\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Г КАК Г\n\t\tПО А.Ссылка = Г.Владелец}'),
			text
		);
		assert.deepEqual(ok(E.setJoinGroup(grouped.model, A, [0, 0], 2)).warnings, [], 'соседние Б и В — одни скобки');
		const separate = ok(E.setJoinRequired(current, A, [0, 1], true));
		const far = ok(E.setJoinGroup(separate.model, A, [0, 2], 1));
		assert.deepEqual(far.warnings, ['Общие скобки бывают только у соседних необязательных соединений одного уровня: у этого соединения своя группа.']);
		roundTrip(far.model, 'несоседние');
		const back = ok(E.setJoinRequired(ok(E.setJoinRequired(ok(E.setJoinRequired(current, A, [0, 0], true)).model, A, [0, 1], true)).model, A, [0, 2], true));
		assert.ok(Q.sameModel(back.model, model), 'все снова обязательные');
		assert.match(E.setJoinRequired(model, A, [0], false).error ?? '', /строка ИЗ/);
		assert.match(E.setJoinGroup(model, A, [0, 0], 1).error ?? '', /необязательного/);
		assert.match(E.setJoinGroup(current, A, [0, 0], 'два').error ?? '', /больше нуля/);
		assert.equal(ok(E.setJoinRequired(model, A, [0, 0], true)).model, model);
	});

	test('корпус: необязательное соединение ssl31 — сделать обязательным и вернуть: круг до исходного текста', () => {
		const query = corpus.find((item) => {
			const value = Q.parse(item.text).model;
			return value.statements.length === 1 && E.compositionTables(firstPart(value)).some((row) => row.optional);
		});
		assert.ok(query, 'в корпусе есть необязательное соединение');
		const model = parsed(query.text);
		const row = E.compositionTables(firstPart(model)).find((item) => item.optional);
		assert.ok(row);
		const required = ok(E.setJoinRequired(model, A, row.path, true));
		assert.ok(!/\{(ЛЕВОЕ|ВНУТРЕННЕЕ) СОЕДИНЕНИЕ/.test(spliced(required.model, model, 'обязательное').text), 'скобок нет');
		const restored = ok(E.setJoinRequired(required.model, A, row.path, false));
		assert.ok(Q.sameModel(restored.model, model));
		assert.equal(Q.build(E.finalize(restored.model, model)), query.text, 'модель та же — исходный текст');
	});

	test('параметры ВТ для СКД: «целиком» и «база + блок», необязательный параметр, переименование, поля-отборы — через параметры позиций', () => {
		const text = 'ВЫБРАТЬ\n\tО.КоличествоОстаток КАК Остаток\nИЗ\n\tРегистрНакопления.Р.Остатки(&Период, Склад = &Склад) КАК О';
		const model = parsed(text);
		const params = model.statements[0].parts[0].from[0].source.params ?? [];
		assert.deepEqual(
			params.map((param) => E.vtParamParts(param)),
			[
				{ base: '&Период', block: null },
				{ base: 'Склад = &Склад', block: null },
			]
		);
		assert.deepEqual(E.vtOptionalState('&Период', null), { available: true, optional: false, name: 'Период' });
		const optional = E.vtSetOptional('&Период', null, true);
		assert.deepEqual(optional, { base: '', block: '(&Период)' });
		assert.deepEqual(E.vtSetOptional(optional.base, optional.block, false), { base: '&Период', block: null });
		assert.equal(E.vtOptionalState('Склад = &Склад', null).available, false);
		const renamed = E.renameParamText(optional.block ?? '', 'период', 'НачалоГода');
		assert.equal(renamed, '(&НачалоГода)');
		assert.equal(E.renameParamText('"&Период" // &Период\n&Период', 'Период', 'П'), '"&Период" // &Период\n&П', 'строки и комментарии не трогаются');
		const filters = E.vtBlockText(
			[
				{ kind: 'filter', field: 'Номенклатура', star: true, alias: 'Товар' },
				{ kind: 'filter', field: 'Склад', star: true, alias: null },
			],
			'ru'
		);
		assert.equal(filters, '(Номенклатура).* КАК Товар, (Склад).*');
		const texts = [E.vtParamText(optional.base, renamed), E.vtParamText('Склад = &Склад', filters)];
		assert.deepEqual(texts, ['{(&НачалоГода)}', 'Склад = &Склад {(Номенклатура).* КАК Товар, (Склад).*}']);
		const result = ok(E.setVirtualParams(model, A, 'О', texts));
		assert.deepEqual(result.model.statements[0].parts[0].from[0].source.params, [
			{ text: '', dcs: { text: '(&НачалоГода)', kind: 'whole' } },
			{ text: 'Склад = &Склад', dcs: { text: '(Номенклатура).* КАК Товар, (Склад).*', kind: 'tail' } },
		]);
		const out = roundTrip(result.model, 'параметры для СКД');
		assert.ok(out.includes('.Остатки({(&НачалоГода)}, Склад = &Склад {(Номенклатура).* КАК Товар, (Склад).*}) КАК О'), out);
		assert.deepEqual(Q.parametersOf(out), ['НачалоГода', 'Склад']);
		assert.deepEqual(E.vtBlockItems('(Номенклатура).* КАК Товар, (Склад).*, (&П), Поле = &Х, (Б) AS Б'), [
			{ kind: 'filter', field: 'Номенклатура', star: true, alias: 'Товар' },
			{ kind: 'filter', field: 'Склад', star: true, alias: null },
			{ kind: 'param', name: 'П', parens: true },
			{ kind: 'other', text: 'Поле = &Х' },
			{ kind: 'filter', field: 'Б', star: false, alias: 'Б' },
		]);
		const corpusVt = corpus
			.map((item) => parsed(item.text))
			.find((value) => (value.statements[0].parts[0].from[0]?.source.params ?? []).some((param) => param.dcs?.kind === 'whole'));
		assert.ok(corpusVt, 'в корпусе есть параметр ВТ целиком в {…}');
		const whole = (corpusVt.statements[0].parts[0].from[0].source.params ?? []).map((param) => E.vtParamParts(param)).find((part) => part.block !== null);
		assert.ok(whole && whole.base === '' && E.vtOptionalState(whole.base, whole.block).optional, JSON.stringify(whole));
	});

	test('{ВЫБРАТЬ}: колонки, «Использовать дочерние», псевдоним, ↑↓, все и ни одного; новый блок — за ПОМЕСТИТЬ; слитые блоки — одним', () => {
		const model = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код,\n\tТ.Наименование\nПОМЕСТИТЬ ВТ\nИЗ\n\tСправочник.Валюты КАК Т');
		assert.deepEqual(E.dcsSelectAvailable(model.statements[0]), ['Ссылка', 'Код', 'Наименование']);
		let current = frozen(model, () => ok(E.addDcsSelect(model, 0, 'Ссылка'))).model;
		current = ok(E.setDcsSelect(current, 0, 0, { star: true, alias: 'Валюта' })).model;
		current = ok(E.addAllDcsSelect(current, 0)).model;
		assert.deepEqual(E.dcsSelectAvailable(current.statements[0]), []);
		assert.ok(roundTrip(current, '{ВЫБРАТЬ}').includes('ПОМЕСТИТЬ ВТ\n{ВЫБРАТЬ\n\tСсылка.* КАК Валюта,\n\tКод,\n\tНаименование}\nИЗ'));
		assert.match(E.addDcsSelect(current, 0, 'код').error ?? '', /уже/);
		const moved = ok(E.moveDcsSelect(current, 0, 2, -2));
		assert.deepEqual(
			E.dcsSelectRows(moved.model.statements[0]).map((row) => row.path),
			['Наименование', 'Ссылка', 'Код']
		);
		const plain = ok(E.setDcsSelect(current, 0, 0, { star: false, alias: '' }));
		assert.ok(roundTrip(plain.model, 'без дочерних').includes('{ВЫБРАТЬ\n\tСсылка,'));
		assert.equal(ok(E.setDcsSelect(current, 0, 0, { star: true })).model, current);
		assert.match(E.setDcsSelect(current, 0, 0, { alias: 'Два слова' }).error ?? '', /одно слово/);
		let emptied = current;
		for (let k = 0; k < 3; k++) {
			emptied = ok(E.removeDcsSelect(emptied, 0, 0)).model;
		}
		assert.equal(firstPart(emptied).dcsSelect, null);
		assert.equal(roundTrip(emptied, 'без блока'), Q.build(model));
		assert.equal(firstPart(ok(E.removeAllDcsSelect(current, 0)).model).dcsSelect, null);
		const broken = parsed('ВЫБРАТЬ\n\tТ.А КАК А,\n\tТ.Б КАК Б\n{ВЫБРАТЬ\n\tА}\n{ВЫБРАТЬ\n\tБ}\nИЗ\n\tТ КАК Т');
		assert.deepEqual(firstPart(broken).dcsSelect?.breaks, [1]);
		const merged = ok(E.removeDcsSelect(broken, 0, 0));
		assert.equal(firstPart(merged.model).dcsSelect?.breaks, undefined, 'правленый блок — один');
		roundTrip(merged.model, 'слитый блок');
	});

	test('{ГДЕ}: поле таблицы, «Использовать дочерние», псевдоним, условие с параметром (правка поля карандашом); своя часть объединения; после ГДЕ или ИЗ', () => {
		const model = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tДокумент.Счет КАК Т\nГДЕ\n\tТ.Проведен\nСГРУППИРОВАТЬ ПО\n\tТ.Ссылка');
		let current = frozen(model, () => ok(E.addDcsWhereField(model, A, 'Т.Организация'))).model;
		current = ok(E.setDcsWhereItem(current, A, 0, { star: true, alias: 'Организация' })).model;
		current = ok(E.addDcsWhereCondition(current, A, 'Т.Дата МЕЖДУ &НачалоПериода И &КонецПериода')).model;
		current = ok(E.addDcsWhereField(current, A, 'Т.Контрагент')).model;
		current = ok(E.setDcsWhereItem(current, A, 2, { text: 'Т.Контрагент В (&Контрагенты)' })).model;
		assert.deepEqual(
			E.dcsWhereRows(firstPart(current)).map((row) => [row.kind, row.path ?? row.text, row.star, row.alias]),
			[
				['field', 'Т.Организация', true, 'Организация'],
				['condition', 'Т.Дата МЕЖДУ &НачалоПериода И &КонецПериода', false, null],
				['condition', 'Т.Контрагент В (&Контрагенты)', false, null],
			]
		);
		const out = roundTrip(current, '{ГДЕ}');
		assert.ok(
			out.includes(
				'ГДЕ\n\tТ.Проведен\n{ГДЕ\n\tТ.Организация.* КАК Организация,\n\t(Т.Дата МЕЖДУ &НачалоПериода И &КонецПериода),\n\t(Т.Контрагент В (&Контрагенты))}\nСГРУППИРОВАТЬ ПО'
			),
			out
		);
		assert.deepEqual(Q.parametersOf(out), ['НачалоПериода', 'КонецПериода', 'Контрагенты']);
		assert.match(E.addDcsWhereField(current, A, 'т.организация').error ?? '', /уже/);
		assert.match(E.addDcsWhereCondition(current, A, 'Т.А = 1 {ГДЕ Т.Б}').error ?? '', /фигурных/);
		assert.match(E.addDcsWhereCondition(current, A, '(Т.А = 1').error ?? '', /не разобрано/);
		assert.match(E.setDcsWhereItem(current, A, 1, { star: true }).error ?? '', /окне выражения/);
		assert.equal(ok(E.setDcsWhereItem(current, A, 1, { text: 'Т.Дата МЕЖДУ &НачалоПериода И &КонецПериода' })).model, current);
		const moved = ok(E.moveDcsWhere(current, A, 0, 2));
		assert.equal(E.dcsWhereRows(firstPart(moved.model))[2].path, 'Т.Организация');
		let emptied = current;
		for (let k = 0; k < 3; k++) {
			emptied = ok(E.removeDcsWhere(emptied, A, 0)).model;
		}
		assert.equal(roundTrip(emptied, 'без {ГДЕ}'), Q.build(model));
		const noWhere = ok(E.addDcsWhereField(parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tДокумент.Счет КАК Т'), A, 'Т.Дата'));
		assert.ok(roundTrip(noWhere.model, '{ГДЕ} за ИЗ').endsWith('ИЗ\n\tДокумент.Счет КАК Т\n{ГДЕ\n\tТ.Дата}'));
		const union = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tДокумент.Счет КАК Т\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tП.Ссылка\nИЗ\n\tДокумент.Заказ КАК П');
		const second = ok(E.addDcsWhereField(union, { statement: 0, part: 1 }, 'П.Дата'));
		assert.equal(second.model.statements[0].parts[0].dcsWhere, null, 'у первой части своего {ГДЕ} нет');
		assert.ok(roundTrip(second.model, '{ГДЕ} второй части').endsWith('ИЗ\n\tДокумент.Заказ КАК П\n{ГДЕ\n\tП.Дата}'));
		assert.equal(firstPart(ok(E.removeAllDcsWhere(current, A)).model).dcsWhere, null);
	});

	test('корпус: поле в {ГДЕ} и {ВЫБРАТЬ} каждого запроса выборки — пересобран только он; {ХАРАКТЕРИСТИКИ} — текстом', () => {
		let touched = 0;
		for (const query of corpus) {
			const model = Q.parse(query.text).model;
			model.statements.forEach((statement, si) => {
				if (statement.type !== 'select') {
					return;
				}
				let current = ok(E.addDcsWhereField(model, { statement: si, part: 0 }, 'Т.ПолеПроверкиКомпоновки')).model;
				const free = E.dcsSelectAvailable(statement);
				if (free.length > 0) {
					current = ok(E.addDcsSelect(current, si, free[0])).model;
				}
				const out = spliced(current, model, query.file);
				assert.deepEqual(
					out.changed,
					model.statements.map((_item, k) => k === si),
					query.file
				);
				touched += 1;
			});
		}
		assert.ok(touched >= 50, `запросов ${touched}`);
		const block = '{ХАРАКТЕРИСТИКИ\n\tТИП(Справочник.Т)\n\tВИДЫХАРАКТЕРИСТИК ПланВидовХарактеристик.Свойства\n\tПОЛЕКЛЮЧА Ссылка\n\tПОЛЕИМЕНИ Наименование}';
		const chars = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Т КАК Т\n' + block);
		assert.deepEqual(E.characteristicsTexts(chars.statements[0]), [block]);
		assert.deepEqual(E.characteristicsTexts(parsed(TEMP_BATCH).statements[0]), []);
	});
});

/**
 * Ссылки по имени на колонку, которой в запросе нет: УПОРЯДОЧИТЬ ПО (имя колонки или путь от неё, кроме
 * пути от алиаса таблицы в запросе из одной части), {ВЫБРАТЬ} и ИНДЕКСИРОВАТЬ ПО.
 */
function danglingRefs(statement: Statement): string[] {
	if (!statement || statement.type !== 'select') {
		return [];
	}
	const first = statement.parts[0];
	const columns = new Set(
		E.columnNames(first)
			.filter((name): name is string => Boolean(name))
			.map((name) => name.toUpperCase())
	);
	const aliases = new Set(E.aliasesOf(first).map((name) => name.toUpperCase()));
	const single = statement.parts.length === 1;
	const out: string[] = [];
	const head = (value: string): { head: string; dotted: boolean } | null => {
		const trimmed = value.trim();
		if (!/^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u.test(trimmed)) {
			return null;
		}
		const dot = trimmed.indexOf('.');
		return { head: (dot < 0 ? trimmed : trimmed.slice(0, dot)).toUpperCase(), dotted: dot >= 0 };
	};
	for (const item of statement.orderBy ?? []) {
		const h = head(item.expr);
		if (h && !columns.has(h.head) && !(single && h.dotted && aliases.has(h.head))) {
			out.push('порядок ' + item.expr);
		}
	}
	for (const item of first.dcsSelect?.items ?? []) {
		const h = typeof item.path === 'string' ? head(item.path) : null;
		if (h && !columns.has(h.head)) {
			out.push('{ВЫБРАТЬ} ' + item.path);
		}
	}
	for (const index of statement.indexes ?? []) {
		for (const field of index.fields) {
			const h = head(field);
			if (h && !columns.has(h.head)) {
				out.push('индекс ' + field);
			}
		}
	}
	return out;
}

describe('Конструктор запроса: ссылки на колонки при удалении полей и таблиц', () => {
	test('удаление поля снимает ссылки на его колонку в {ВЫБРАТЬ}, УПОРЯДОЧИТЬ ПО и ИНДЕКСИРОВАТЬ ПО — с предупреждением', () => {
		const model = parsed(
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Наименование КАК Имя\n{ВЫБРАТЬ\n\tСсылка.*,\n\tИмя}\nИЗ\n\tСправочник.Валюты КАК Т\nУПОРЯДОЧИТЬ ПО\n\tИмя УБЫВ,\n\tТ.Код'
		);
		const removed = frozen(model, () => ok(E.removeField(model, A, 1)));
		const text = roundTrip(removed.model, 'без колонки Имя');
		assert.equal(text, 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\n{ВЫБРАТЬ\n\tСсылка.*}\nИЗ\n\tСправочник.Валюты КАК Т\nУПОРЯДОЧИТЬ ПО\n\tТ.Код');
		assert.equal(removed.warnings?.length, 1);
		assert.match(removed.warnings?.[0] ?? '', /«Имя».*порядок: Имя.*\{ВЫБРАТЬ\}: Имя/);
		assert.deepEqual(ok(E.removeField(removed.model, A, 0)).warnings, ['Вместе с колонкой «Ссылка» удалены ссылки на неё ({ВЫБРАТЬ}: Ссылка.*).']);
		// Без ссылок — без предупреждений
		assert.deepEqual(ok(E.removeField(parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Т'), A, 1)).warnings, []);
		// «<<» — все поля разом; порядок по полю таблицы остаётся
		const all = ok(E.removeAllFields(model, A));
		assert.equal(all.model.statements[0].orderBy?.map((item) => item.expr).join(), 'Т.Код');
		assert.equal(all.model.statements[0].parts[0].dcsSelect, null);
	});

	test('индекс временной таблицы: поле удалённой колонки уходит, пустой индекс — целиком; читателям ВТ — предупреждение', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tТ.Код КАК КодВалюты,',
			'\tТ.Ссылка КАК Ссылка',
			'ПОМЕСТИТЬ ВТ_Валюты',
			'ИЗ',
			'\tСправочник.Валюты КАК Т',
			'ИНДЕКСИРОВАТЬ ПО',
			'\tКодВалюты',
			';',
			'',
			'////////////////////////////////////////////////////////////////////////////////',
			'ВЫБРАТЬ',
			'\tВТ.КодВалюты КАК КодВалюты',
			'ИЗ',
			'\tВТ_Валюты КАК ВТ',
		].join('\n');
		const model = parsed(text);
		const removed = ok(E.removeField(model, A, 0));
		assert.deepEqual(removed.model.statements[0].indexes, []);
		const out = roundTrip(removed.model, 'без индекса');
		assert.ok(!out.includes('ИНДЕКСИРОВАТЬ'), out);
		assert.ok(out.endsWith(model.statements[1].original?.text ?? '-'), 'второй запрос пакета — исходным срезом');
		assert.equal(removed.warnings?.length, 2);
		assert.match(removed.warnings?.[1] ?? '', /ВТ «ВТ_Валюты».*«КодВалюты».*запросы пакета 2/);
	});

	test('удаление таблицы и замена таблицы снимают ссылки на колонки, что ушли вместе с полями', () => {
		const model = parsed(
			[
				'ВЫБРАТЬ',
				'\tТ.Ссылка КАК Ссылка,',
				'\tК.Курс КАК Курс',
				'{ВЫБРАТЬ',
				'\tСсылка,',
				'\tКурс}',
				'ИЗ',
				'\tСправочник.Валюты КАК Т',
				'\t\tЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.КурсыВалют КАК К',
				'\t\tПО К.Валюта = Т.Ссылка',
				'УПОРЯДОЧИТЬ ПО',
				'\tКурс',
			].join('\n')
		);
		const removed = ok(E.removeSource(model, A, 'К'));
		assert.deepEqual(danglingRefs(removed.model.statements[0]), []);
		assert.equal(roundTrip(removed.model, 'без К'), 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\n{ВЫБРАТЬ\n\tСсылка}\nИЗ\n\tСправочник.Валюты КАК Т');
		assert.equal(removed.warnings?.length, 2, (removed.warnings ?? []).join(' | '));
		assert.match(removed.warnings?.[1] ?? '', /«Курс».*порядок: Курс.*\{ВЫБРАТЬ\}: Курс/);
		const replaced = ok(E.replaceSource(model, A, 'К', { table: 'Справочник.Пользователи' }, { fields: ['Ссылка', 'Наименование'] }));
		assert.deepEqual(danglingRefs(replaced.model.statements[0]), []);
		roundTrip(replaced.model, 'замена К');
	});

	test('колонка, убранная во всех частях объединения, уходит и из порядка; смена выражения поля ведёт ссылки за новым именем', () => {
		const union = parsed(
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Т\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tП.Ссылка,\n\tП.Код\nИЗ\n\tСправочник.Пользователи КАК П\nУПОРЯДОЧИТЬ ПО\n\tКод'
		);
		const halfway = ok(E.removeField(union, A, 1));
		assert.equal(halfway.model.statements[0].orderBy?.length, 1, 'значение одной части — колонка жива');
		assert.deepEqual(halfway.warnings, []);
		const gone = ok(E.removeField(halfway.model, { statement: 0, part: 1 }, 1));
		assert.equal(gone.model.statements[0].orderBy, null);
		assert.deepEqual(danglingRefs(gone.model.statements[0]), []);
		roundTrip(gone.model, 'объединение без Код');
		const source = parsed('ВЫБРАТЬ\n\tТ.Ссылка\n{ВЫБРАТЬ\n\tСсылка.*}\nИЗ\n\tСправочник.Валюты КАК Т\nУПОРЯДОЧИТЬ ПО\n\tСсылка');
		const renamed = ok(E.setFieldExpr(source, A, 0, 'Т.Наименование'));
		assert.equal(
			roundTrip(renamed.model, 'новое выражение'),
			'ВЫБРАТЬ\n\tТ.Наименование\n{ВЫБРАТЬ\n\tНаименование.*}\nИЗ\n\tСправочник.Валюты КАК Т\nУПОРЯДОЧИТЬ ПО\n\tНаименование'
		);
	});

	test('корпус: удаление каждого поля не оставляет висячих ссылок по имени колонки', () => {
		let checked = 0;
		for (const query of corpus) {
			const model = Q.parse(query.text).model;
			model.statements.forEach((statement, si) => {
				if (statement.type !== 'select' || danglingRefs(statement).length > 0) {
					return;
				}
				statement.parts.forEach((part, pi) => {
					part.fields.forEach((_field, fi) => {
						const result = ok(E.removeField(model, { statement: si, part: pi }, fi));
						assert.deepEqual(danglingRefs(result.model.statements[si]), [], `${query.file} #${si}.${pi}.${fi}`);
						checked += 1;
					});
				});
			});
		}
		assert.ok(checked > 300, `полей ${checked}`);
	});
});

describe('Конструктор запроса: круг модели после удаления таблицы и связи', () => {
	test('удаление таблицы, снявшее ГДЕ: {ГДЕ} встаёт за ИЗ, отметки разрыва {ГДЕ} сбрасываются — модель та же, что после разбора', () => {
		const grouped = parsed(
			'ВЫБРАТЬ\n\tТ.А КАК А,\n\tСУММА(Т.Б) КАК Б\nИЗ\n\tСправочник.Х КАК Т\n\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.У КАК У\n\t\tПО Т.А = У.А\nГДЕ\n\tУ.В = 1\n{ГДЕ\n\tТ.А.*}\nСГРУППИРОВАТЬ ПО\n\tТ.А'
		);
		const first = ok(E.removeSource(grouped, A, 'У'));
		assert.equal(first.model.statements[0].parts[0].where, null);
		assert.equal(first.model.statements[0].parts[0].dcsWhere?.placement, 'afterFrom', 'как после removeCondition');
		roundTrip(first.model, 'без У и ГДЕ');
		const split = parsed(
			'ВЫБРАТЬ\n\tТ.А КАК А\nИЗ\n\tСправочник.Х КАК Т\n\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.У КАК У\n\t\tПО Т.А = У.А\nГДЕ\n\tУ.В = 1\n{ГДЕ\n\tТ.А.*,\n\tУ.В.*}\n{ГДЕ\n\tТ.Б.*}'
		);
		const second = ok(E.removeSource(split, A, 'У'));
		assert.deepEqual(
			second.model.statements[0].parts[0].dcsWhere?.items.map((item) => item.path),
			['Т.А', 'Т.Б']
		);
		roundTrip(second.model, 'два блока {ГДЕ} без элемента У');
	});

	test('удаление связи и таблицы: номера групп необязательных соединений идут подряд, как у разбора', () => {
		const text =
			'ВЫБРАТЬ\n\tА.Ссылка КАК Ссылка\nИЗ\n\tСправочник.А КАК А\n\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.Б КАК Б\n\t\tПО А.Ссылка = Б.Ссылка\n\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник.В КАК В\n\t\tПО А.Ссылка = В.Ссылка';
		let model = parsed(text);
		const joins = E.compositionTables(model.statements[0].parts[0]).filter((row) => row.join);
		model = ok(E.setJoinRequired(model, A, joins[0].path, false)).model;
		model = ok(E.setJoinRequired(model, A, joins[1].path, false)).model;
		assert.deepEqual(
			model.statements[0].parts[0].from[0].joins.map((join) => join.optionalGroup),
			[1, 2]
		);
		const links = E.linkRows(model.statements[0].parts[0]);
		const unlinked = ok(E.removeLink(model, A, links[0]));
		assert.deepEqual(
			unlinked.model.statements[0].parts[0].from[0].joins.map((join) => join.optionalGroup),
			[1]
		);
		roundTrip(unlinked.model, 'без связи Б');
		const dropped = ok(E.removeSource(model, A, 'Б'));
		assert.deepEqual(
			dropped.model.statements[0].parts[0].from[0].joins.map((join) => join.optionalGroup),
			[1]
		);
		roundTrip(dropped.model, 'без таблицы Б');
	});

	test('корпус: удаление каждой таблицы и каждой связи сходится по кругу', () => {
		let checked = 0;
		for (const query of corpus) {
			const model = Q.parse(query.text).model;
			model.statements.forEach((statement, si) => {
				if (statement.type !== 'select') {
					return;
				}
				statement.parts.forEach((part, pi) => {
					const address = { statement: si, part: pi };
					for (const entry of E.sourcesOf(part)) {
						if (!entry.alias) {
							continue;
						}
						const result = E.removeSource(model, address, entry.alias);
						if (result.error || E.problems(result.model).length > 0) {
							continue;
						}
						roundTrip(E.finalize(result.model, model), `${query.file} #${si}.${pi} без ${entry.alias}`);
						checked += 1;
					}
					for (const row of E.linkRows(part)) {
						const result = E.removeLink(model, address, row);
						if (result.error) {
							continue;
						}
						roundTrip(E.finalize(result.model, model), `${query.file} #${si}.${pi} без связи ${row.key}`);
						checked += 1;
					}
				});
			});
		}
		assert.ok(checked > 100, `правок ${checked}`);
	});
});

describe('Конструктор запроса: объединение с нуля и колонки объединения', () => {
	test('поле второй части встаёт в пустую ячейку колонки со своим именем, остальные — новыми колонками', () => {
		const model = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Наименование КАК Имя\nИЗ\n\tСправочник.Валюты КАК Т');
		let current = ok(E.addPart(model, 0)).model;
		const second = { statement: 0, part: 1 };
		current = ok(E.addSource(current, second, { table: 'Справочник._ДемоОрганизации' })).model;
		const ref = frozen(current, () => ok(E.addField(current, second, '_ДемоОрганизации.Ссылка')));
		assert.equal(ref.index, 0, 'Ссылка — в колонку «Ссылка»');
		assert.equal(ref.alias, 'Ссылка');
		const all = ok(E.addFields(ref.model, second, ['_ДемоОрганизации.Ссылка', '_ДемоОрганизации.Наименование']));
		const rows = E.unionRows(all.model.statements[0]);
		assert.deepEqual(
			rows.columns.map((column) => [column.name, column.cells.map((cell) => cell.expr)]),
			[
				['Ссылка', ['Т.Ссылка', '_ДемоОрганизации.Ссылка']],
				['Имя', ['Т.Наименование', 'NULL']],
				['Наименование', ['NULL', '_ДемоОрганизации.Наименование']],
			]
		);
		const text = roundTrip(E.finalize(all.model, model), 'объединение с нуля');
		assert.ok(text.includes('ВЫБРАТЬ\n\t_ДемоОрганизации.Ссылка,\n\tNULL,\n\t_ДемоОрганизации.Наименование\nИЗ'), text);
		// Явный псевдоним — всегда новая колонка; занятая ячейка — тоже
		assert.equal(ok(E.addField(ref.model, second, '_ДемоОрганизации.Ссылка', { alias: 'Организация' })).index, 2);
		assert.equal(ok(E.addField(ref.model, second, '_ДемоОрганизации.Ссылка')).index, 2, 'ячейка «Ссылка» уже занята');
		// Первая часть — новая колонка с суффиксом
		assert.equal(ok(E.addField(model, A, 'Т.Ссылка')).alias, 'Ссылка1');
	});

	test('колонка объединения: удаление во всех частях со снятием ссылок и сдвиг во всех частях', () => {
		const union = parsed(
			'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Т\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tП.Ссылка,\n\tП.Код\nИЗ\n\tСправочник.Пользователи КАК П\nУПОРЯДОЧИТЬ ПО\n\tКод'
		);
		const removed = frozen(union, () => ok(E.removeColumn(union, 0, 1)));
		assert.deepEqual(
			removed.model.statements[0].parts.map((part) => part.fields.map((field) => field.expr)),
			[['Т.Ссылка'], ['П.Ссылка']]
		);
		assert.equal(removed.model.statements[0].orderBy, null);
		assert.match(removed.warnings?.[0] ?? '', /«Код».*порядок: Код/);
		roundTrip(removed.model, 'без колонки Код');
		const moved = ok(E.moveColumn(union, 0, 1, -1));
		assert.equal(moved.index, 0);
		assert.deepEqual(
			moved.model.statements[0].parts.map((part) => part.fields.map((field) => field.expr)),
			[
				['Т.Код', 'Т.Ссылка'],
				['П.Код', 'П.Ссылка'],
			]
		);
		assert.deepEqual(E.columnNames(moved.model.statements[0].parts[0]), ['Код', 'Ссылка']);
		roundTrip(moved.model, 'Код первой');
		assert.ok(E.removeColumn(union, 0, 5).error);
	});
});

describe('Конструктор запроса: пакет без запроса выборки при автозаполнении', () => {
	test('problems с autofill отказывает пакету без выборки; без автозаполнения такой пакет записывается', () => {
		const model = parsed(BATCH);
		const removed = ok(E.removeStatement(model, 1));
		assert.deepEqual(E.problems(removed.model), [], 'без автозаполнения — можно');
		const issues = E.problems(removed.model, { autofill: true });
		assert.equal(issues.length, 1);
		assert.match(issues[0], /нет запроса выборки.*автозаполнение/);
		assert.deepEqual(E.problems(model, { autofill: true }), [], 'с выборкой — можно');
		const kind = ok(E.setStatementKind(model, 1, { kind: 'create', table: 'ВТ_Итог' }));
		assert.equal(E.problems(kind.model, { autofill: true }).length, 1, 'последний запрос стал созданием ВТ');
	});
});

describe('Конструктор запроса: типы колонок временных таблиц пакета', () => {
	test('поля ВТ получают тип от env.tempType: связь со справочником предлагается, каталог окна выражения несёт тип', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tОстатки.Организация КАК Организация,',
			'\tОстатки.КоличествоОстаток КАК КоличествоОстаток',
			'ПОМЕСТИТЬ ВТ_Остатки',
			'ИЗ',
			'\tРегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Остатки КАК Остатки',
			';',
			'',
			'////////////////////////////////////////////////////////////////////////////////',
			'ВЫБРАТЬ',
			'\tВТ_Остатки.КоличествоОстаток КАК КоличествоОстаток',
			'ИЗ',
			'\tВТ_Остатки КАК ВТ_Остатки',
		].join('\n');
		const model = parsed(text);
		const second = { statement: 1, part: 0 };
		const orgType = { types: ['cfg:CatalogRef._ДемоОрганизации'], typeSets: [], typeIds: [] };
		const temps = Q.tempTables(model, 1);
		const typed: SourceEnv = {
			describe: describeTable,
			tempTables: temps,
			tempType: (table, column) => (table?.name === 'ВТ_Остатки' && column === 'Организация' ? orgType : null),
		};
		const source = E.sourcesOf(model.statements[1].parts[0])[0].source;
		assert.deepEqual(E.fieldsOfSource(source, typed).fields, [
			{ name: 'Организация', synonym: '', type: orgType },
			{ name: 'КоличествоОстаток', synonym: '', type: null },
		]);
		assert.deepEqual(
			E.fieldsOfSource(source, { tempTables: temps }).fields.map((field) => field.type),
			[null, null],
			'без tempType — тип неизвестен'
		);
		const withOrg = ok(E.addSource(model, second, { table: 'Справочник._ДемоОрганизации' }));
		const suggested = E.suggestLink(withOrg.model, second, withOrg.alias ?? '', typed);
		assert.equal(suggested.state, 'ready');
		assert.equal(suggested.condition, 'ВТ_Остатки.Организация = _ДемоОрганизации.Ссылка');
		assert.equal(E.suggestLink(withOrg.model, second, withOrg.alias ?? '', { describe: describeTable, tempTables: temps }).state, 'none');
		const nodes = E.catalogNodes(model, second, typed);
		assert.deepEqual(nodes.find((node) => node.path === 'ВТ_Остатки.Организация')?.valueType, orgType);
	});
});

describe('Конструктор запроса: ОК окна параметров ВТ без правок', () => {
	test('пустые хвостовые позиции сверх записанных — не правка; настоящая правка хвоста — правка', () => {
		const model = parsed('ВЫБРАТЬ\n\tОстатки.МестоХранения КАК МестоХранения\nИЗ\n\tРегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Остатки(&Период) КАК Остатки');
		const same = E.setVirtualParams(model, A, 'Остатки', ['&Период', '']);
		assert.equal(same.model, model, 'модель та же — запрос не пересобирается');
		const bare = parsed('ВЫБРАТЬ\n\tОстатки.МестоХранения КАК МестоХранения\nИЗ\n\tРегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Остатки КАК Остатки');
		assert.equal(E.setVirtualParams(bare, A, 'Остатки', ['', '']).model, bare);
		const filled = ok(E.setVirtualParams(model, A, 'Остатки', ['&Период', 'Склад = &Склад']));
		assert.notEqual(filled.model, model);
		assert.ok(roundTrip(filled.model, 'хвост заполнен').includes('Остатки(&Период, Склад = &Склад) КАК Остатки'));
		const auto = parsed(corpus[14].text);
		const autoSource = E.sourcesOf(auto.statements[0].parts[0]).find((entry) => entry.source.kind === 'table' && Array.isArray(entry.source.params));
		assert.ok(autoSource);
		assert.equal(E.setVirtualParams(auto, A, autoSource.alias, E.paramTexts(autoSource.source)).model, auto, 'записанные тексты как есть — та же модель');
	});
});

describe('Конструктор запроса: копия и сдвиг индекса', () => {
	test('копия встаёт за индексом, сдвиг меняет порядок наборов ПО НАБОРАМ', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tТ.Код КАК Код,',
			'\tТ.Ссылка КАК Ссылка',
			'ПОМЕСТИТЬ ВТ_Валюты',
			'ИЗ',
			'\tСправочник.Валюты КАК Т',
			'ИНДЕКСИРОВАТЬ ПО',
			'\tКод',
		].join('\n');
		const model = parsed(text);
		const copied = frozen(model, () => ok(E.copyIndex(model, 0, 0)));
		assert.equal(copied.index, 1);
		const second = ok(E.addIndexField(copied.model, 0, 1, 'Ссылка'));
		assert.deepEqual(
			second.model.statements[0].indexes?.map((item) => item.fields),
			[['Код'], ['Код', 'Ссылка']]
		);
		const moved = ok(E.moveIndex(second.model, 0, 1, -1));
		assert.equal(moved.index, 0);
		assert.deepEqual(
			moved.model.statements[0].indexes?.map((item) => item.fields),
			[['Код', 'Ссылка'], ['Код']]
		);
		assert.ok(roundTrip(moved.model, 'ПО НАБОРАМ').includes('ИНДЕКСИРОВАТЬ ПО НАБОРАМ'));
		assert.equal(E.moveIndex(moved.model, 0, 0, -1).model, moved.model, 'край — без правки');
		assert.ok(E.copyIndex(model, 0, 3).error);
		assert.ok(E.copyIndex(parsed('ВЫБРАТЬ\n\tТ.Код КАК Код\nИЗ\n\tСправочник.Валюты КАК Т'), 0, 0).error, 'индекс — только у создания ВТ');
	});
});

describe('Конструктор запроса: связи по составу определяемого типа', () => {
	interface Composition {
		source: string;
		name?: string;
		types: string[];
		typeSets: string[];
	}
	interface FieldTypesApi {
		attachTypeCompositions<T>(answer: T): T;
		expandedTypes(dto: unknown): { types: string[]; typeSets: string[]; typeIds: string[] };
		refTypeNames(dto: unknown): string[];
		numericKind(dto: unknown): string;
	}
	interface Answer {
		object: string;
		tables: DescribedTable[];
		typeCompositions?: Composition[];
	}
	const FT = loadModule<FieldTypesApi>('dcs-editor-field-types.js');
	const PERSON_REF = 'cfg:CatalogRef._ДемоФизическиеЛица';
	const PERSON_RECORD: Composition = { source: 'cfg:DefinedType.ФизическоеЛицо', types: [PERSON_REF], typeSets: [] };
	const typeOf = (types: string[], typeSets: string[] = []) => ({ types, typeSets, typeIds: [] as string[] });

	/** Синтетический справочник (короткий нарочно; физлиц фикстуры проверяет корпусный тест): Ссылка, Наименование и свои поля. */
	function catalog(name: string, extra: DescribedTable['fields'], typeCompositions?: Composition[]): Answer {
		const answer: Answer = {
			object: 'Справочник.' + name,
			tables: [
				{
					name: 'Справочник.' + name,
					kind: 'main',
					params: [],
					fields: [
						{ name: 'Ссылка', nameEn: 'Ref', synonym: 'Ссылка', type: typeOf(['cfg:CatalogRef.' + name]) },
						{ name: 'Наименование', nameEn: 'Description', synonym: 'Наименование', type: typeOf(['xs:string']) },
						...extra,
					],
				},
			],
		};
		if (typeCompositions) {
			answer.typeCompositions = typeCompositions;
		}
		return FT.attachTypeCompositions(answer);
	}

	/** Ответ cf-md-query-tables Пользователей с составами: фикстура + typeCompositions. */
	function usersAnswer(records: Composition[]): Answer {
		const answer = JSON.parse(JSON.stringify(tables['Справочник.Пользователи'].description)) as Answer;
		answer.typeCompositions = records;
		return FT.attachTypeCompositions(answer);
	}

	const field = (name: string, typeSets: string[]) => ({ name, nameEn: '', synonym: '', type: typeOf([], typeSets) });
	const persons = catalog('_ДемоФизическиеЛица', [{ name: 'ИНН', nameEn: '', synonym: 'ИНН', type: typeOf(['xs:string']) }]);

	/** Кэш вкладки поверх фикстуры: свои ответы главнее. */
	function describeWith(answers: Answer[]): SourceEnv['describe'] {
		return (name) => {
			const want = name.toUpperCase();
			for (const answer of answers) {
				const table = answer.tables.find((item) => item.name.toUpperCase() === want);
				if (table) {
					return { state: 'ready', table };
				}
			}
			return describeTable(name);
		};
	}

	const withCompositions: SourceEnv = { describe: describeWith([usersAnswer([PERSON_RECORD]), persons]) };
	const uncomposed: SourceEnv = { describe: describeWith([persons]) };

	test('Пользователи + _ДемоФизическиеЛица: «ФизическоеЛицо = Ссылка» в обоих порядках и при добавлении таблицы; без состава — нет', () => {
		const usersFirst = ok(E.addSource(ok(E.addSource(E.newModel(''), A, { table: 'Справочник.Пользователи' })).model, A, { table: 'Справочник._ДемоФизическиеЛица' }));
		assert.deepEqual(E.suggestLink(usersFirst.model, A, '_ДемоФизическиеЛица', withCompositions), {
			state: 'ready',
			left: 'Пользователи',
			right: '_ДемоФизическиеЛица',
			condition: 'Пользователи.ФизическоеЛицо = _ДемоФизическиеЛица.Ссылка',
			allLeft: true,
			allRight: false,
		});
		const part = usersFirst.model.statements[0].parts[0];
		assert.equal(E.suggestCondition(part, 'Пользователи', '_ДемоФизическиеЛица', withCompositions).condition, 'Пользователи.ФизическоеЛицо = _ДемоФизическиеЛица.Ссылка');
		assert.equal(E.suggestCondition(part, '_ДемоФизическиеЛица', 'Пользователи', withCompositions).condition, '_ДемоФизическиеЛица.Ссылка = Пользователи.ФизическоеЛицо');
		const personsFirst = ok(E.addSource(ok(E.addSource(E.newModel(''), A, { table: 'Справочник._ДемоФизическиеЛица' })).model, A, { table: 'Справочник.Пользователи' }));
		assert.equal(E.suggestLink(personsFirst.model, A, 'Пользователи', withCompositions).condition, '_ДемоФизическиеЛица.Ссылка = Пользователи.ФизическоеЛицо');
		// Ответ без typeCompositions: правило не угадывает связь по имени поля
		assert.equal(E.suggestCondition(part, 'Пользователи', '_ДемоФизическиеЛица', uncomposed).state, 'none');
		assert.equal(E.suggestLink(usersFirst.model, A, '_ДемоФизическиеЛица', uncomposed).state, 'none');
		// Предложение проходит круг сборки
		const suggestion = E.suggestLink(usersFirst.model, A, '_ДемоФизическиеЛица', withCompositions) as { left: string; right: string; allLeft: boolean; allRight: boolean; condition: string };
		const applied = ok(E.addLink(ok(E.addField(usersFirst.model, A, '_ДемоФизическиеЛица.ИНН')).model, A, suggestion));
		assert.ok(roundTrip(applied.model, 'связь по составу').includes('ПО Пользователи.ФизическоеЛицо = _ДемоФизическиеЛица.Ссылка'));
	});

	test('тёзки одного определяемого типа; поле из одной ссылки раньше составного; предела числа ссылок для связи нет', () => {
		const org: Composition = { source: 'cfg:DefinedType.Организация', types: ['cfg:CatalogRef._ДемоОрганизации'], typeSets: [] };
		const left = catalog('Левый', [field('Организация', ['cfg:DefinedType.Организация'])], [org]);
		const right = catalog('Правый', [field('Организация', ['cfg:DefinedType.Организация'])], [org]);
		const twins = parsed('ВЫБРАТЬ\n\tЛ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Левый КАК Л,\n\tСправочник.Правый КАК П');
		assert.equal(E.suggestLink(twins, A, 'П', { describe: describeWith([left, right]) }).condition, 'Л.Организация = П.Организация');
		// Участник (две ссылки) стоит раньше Физлица (одна), но поле с одной ссылкой главнее
		const member: Composition = { source: 'cfg:DefinedType.Участник', types: [PERSON_REF, 'cfg:CatalogRef.Пользователи'], typeSets: [] };
		const mixed = catalog('Смешанный', [field('Участник', ['cfg:DefinedType.Участник']), field('Физлицо', ['cfg:DefinedType.ФизическоеЛицо'])], [member, PERSON_RECORD]);
		const pair = parsed('ВЫБРАТЬ\n\tС.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Смешанный КАК С,\n\tСправочник._ДемоФизическиеЛица КАК Ф');
		assert.equal(E.suggestLink(pair, A, 'Ф', { describe: describeWith([mixed, persons]) }).condition, 'С.Физлицо = Ф.Ссылка');
		// 25 ссылок «ЗначениеДоступа»: через точку поле закрыто, а связь по имени типа предлагается
		const access: Composition = {
			source: 'cfg:DefinedType.ЗначениеДоступа',
			types: [...Array.from({ length: 24 }, (_, index) => 'cfg:CatalogRef.Доступ' + index), PERSON_REF],
			typeSets: [],
		};
		const keys = catalog('Ключи', [field('Значение', ['cfg:DefinedType.ЗначениеДоступа'])], [access]);
		const wide = parsed('ВЫБРАТЬ\n\tК.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Ключи КАК К,\n\tСправочник._ДемоФизическиеЛица КАК Ф');
		assert.equal(E.suggestLink(wide, A, 'Ф', { describe: describeWith([keys, persons]) }).condition, 'К.Значение = Ф.Ссылка');
	});

	test('сверка копий правила: expandedTypes и refTypeNames конструктора совпадают с DcsFieldTypes на всех полях фикстуры и составах', () => {
		const dtos: unknown[] = [];
		for (const entry of Object.values(tables)) {
			for (const table of entry.description.tables) {
				for (const item of table.fields) {
					dtos.push(item.type);
				}
			}
		}
		const fixtureCount = dtos.length;
		const users = usersAnswer([PERSON_RECORD, { source: 'cfg:DefinedType.Подразделение', types: ['cfg:CatalogRef._ДемоПодразделения'], typeSets: ['cfg:AnyIBRef'] }]);
		for (const table of users.tables) {
			for (const item of table.fields) {
				dtos.push(item.type);
			}
		}
		dtos.push(
			null,
			undefined,
			'строка',
			{
				types: ['xs:string', PERSON_REF, PERSON_REF],
				typeSets: ['cfg:CatalogRef'],
				typeIds: ['AAAA'],
				compositions: [{ source: 'aaaa', types: [PERSON_REF, 'cfg:DocumentRef.Заказ'], typeSets: ['cfg:DefinedType.Цикл'] }],
			},
			{ types: [], typeSets: ['cfg:Characteristic.Х'], compositions: [null, { source: '' }, { source: 'CFG:CHARACTERISTIC.Х', types: ['xs:decimal', 'cfg:EnumRef.Пол'] }] }
		);
		let withRefs = 0;
		const kinds = new Map<string, number>();
		for (const dto of dtos) {
			assert.deepEqual(E.expandedTypes(dto), FT.expandedTypes(dto), JSON.stringify(dto));
			assert.deepEqual(E.refTypeNames(dto), FT.refTypeNames(dto), JSON.stringify(dto));
			// Числовой ли тип: «>>» на «Группировке» и тип поля ресурса делят поля одним правилом
			assert.equal(E.numericKind(dto), FT.numericKind(dto), JSON.stringify(dto));
			kinds.set(FT.numericKind(dto), (kinds.get(FT.numericKind(dto)) ?? 0) + 1);
			if (FT.refTypeNames(dto).length > 0) {
				withRefs += 1;
			}
		}
		assert.ok(fixtureCount >= 600 && withRefs > 100, `полей ${fixtureCount}, со ссылками ${withRefs}`);
		// Сверка прошла по всем четырём видам, а не только по ссылкам
		for (const kind of ['numeric', 'other', 'mixed', 'unknown']) {
			assert.ok((kinds.get(kind) ?? 0) > 0, `нет типов вида ${kind}: ${JSON.stringify([...kinds])}`);
		}
	});
});

describe('Конструктор запроса: «>>» на «Группировке» по типу, сумма нечислового, типы колонок подзапроса', () => {
	interface TypeDto {
		types: string[];
		typeSets: string[];
		typeIds?: string[];
		compositions?: Array<{ source: string; types: string[]; typeSets: string[] }>;
	}
	interface Described {
		object: string;
		kind: string;
		tables: DescribedTable[];
		typeCompositions?: Array<{ source: string; types: string[]; typeSets: string[] }>;
	}
	interface FieldTypesApi {
		attachTypeCompositions<T>(answer: T): T;
		expandedTypes(dto: unknown): { types: string[]; typeSets: string[]; typeIds: string[] };
		tableObjectOf(name: string): { key: string; tail: string[] } | null;
		findTable(description: Described | null, tail: string[]): DescribedTable | null;
		partExpressionType(
			batch: Model,
			statementIndex: number,
			part: Part,
			expr: string,
			lookup: (key: string) => Described | null | undefined,
			options: { queryModel: QueryModelApi }
		): { type: TypeDto | null; pending: unknown[] };
		subqueryColumnType(
			batch: Model,
			statementIndex: number,
			subquery: Statement,
			column: string,
			lookup: (key: string) => Described | null | undefined,
			options: { queryModel: QueryModelApi }
		): { type: TypeDto | null; pending: unknown[] };
	}
	const FT = loadModule<FieldTypesApi>('dcs-editor-field-types.js');
	const T = (types: string[], typeSets: string[] = []): TypeDto => ({ types, typeSets, typeIds: [] });
	const MONEY = 'cfg:DefinedType.ДенежнаяСуммаНеотрицательная';
	const field = (name: string, type: TypeDto | null) => ({ name, nameEn: '', synonym: '', type });

	/**
	 * Явные описания: справочник валют — ссылка, строки и число (у справочника валют фикстуры нет всех
	 * видов типов разом); документ с ТЧ — деньги определяемым типом с составом xs:decimal, как в ssl31.
	 * Деньги фикстуры проверяет корпусный тест ниже.
	 */
	function described(withComposition: boolean): Described[] {
		const valuta: Described = {
			object: 'Справочник.Валюты',
			kind: 'catalog',
			tables: [
				{
					name: 'Справочник.Валюты',
					kind: 'main',
					params: [],
					fields: [
						field('Ссылка', T(['cfg:CatalogRef.Валюты'])),
						field('Наименование', T(['xs:string'])),
						field('Код', T(['xs:string'])),
						field('Курс', T(['xs:decimal'])),
						field('Дата', T(['xs:dateTime'])),
						field('Флаг', T(['xs:boolean'])),
						field('Период', T(['v8:StandardPeriod'])),
						field('Ид', T(['v8:UUID'])),
						field('Любая', T([], ['cfg:AnyRef'])),
						field('Составное', T(['xs:decimal', 'xs:string'])),
						field('Неведомое', null),
						field('Деньги', T([], [MONEY])),
					],
				},
			],
		};
		const invoice: Described = {
			object: 'Документ.Счет',
			kind: 'document',
			tables: [
				{ name: 'Документ.Счет', kind: 'main', params: [], fields: [field('Ссылка', T(['cfg:DocumentRef.Счет'])), field('СуммаОплаты', T([], [MONEY]))] },
				{
					name: 'Документ.Счет.Товары',
					kind: 'tabular',
					params: [],
					fields: [
						field('Ссылка', T(['cfg:DocumentRef.Счет'])),
						field('Номенклатура', T(['cfg:CatalogRef.Номенклатура'])),
						field('Склад', T(['cfg:CatalogRef.Склады'])),
						field('Количество', T(['xs:decimal'])),
						field('Сумма', T([], [MONEY])),
					],
				},
			],
		};
		if (withComposition) {
			for (const answer of [valuta, invoice]) {
				answer.typeCompositions = [{ source: MONEY, types: ['xs:decimal'], typeSets: [] }];
			}
		}
		return [valuta, invoice].map((answer) => FT.attachTypeCompositions(answer));
	}

	function lookupOf(answers: Described[]): (key: string) => Described | null {
		return (key) => answers.find((answer) => answer.object.toUpperCase() === key) ?? null;
	}

	/** Кэш вкладки для QE.fieldsOfSource по тем же описаниям. */
	function describeOf(answers: Described[]): SourceEnv['describe'] {
		const lookup = lookupOf(answers);
		return (name) => {
			const target = FT.tableObjectOf(name);
			const table = target ? FT.findTable(lookup(target.key), target.tail) : null;
			return table ? { state: 'ready', table } : { state: 'none' };
		};
	}

	/** typeOf, как его строит обвязка конструктора: вывод по метаданным и раскрытые составы (FT.expandedTypes). */
	function typing(model: Model, address: Address, answers: Described[]): (index: number, expr: string) => unknown {
		const part = E.partAt(model, address);
		return (_index, expr) => {
			const result = FT.partExpressionType(model, address.statement, part, expr, lookupOf(answers), { queryModel: Q });
			return result.type ? FT.expandedTypes(result.type) : null;
		};
	}

	const KNOWN = described(true);
	const UNCOMPOSED = described(false);
	const partOf = (value: Model, index = 0): Part => value.statements[0].parts[index];

	test('без группировки: групповые — всё, кроме известных числовых; суммируемые — всё, кроме известных нечисловых; константы, параметры и NULL — никуда; составной и неизвестный тип — в оба', () => {
		const exprs = [
			'Т.Ссылка',
			'Т.Наименование',
			'Т.Дата',
			'Т.Флаг',
			'Т.Период',
			'Т.Ид',
			'Т.Любая',
			'Т.Курс',
			'Т.Деньги',
			'Т.Составное',
			'Т.Неведомое',
			'&Дата',
			'0',
			'"x"',
			'NULL',
			'ЗНАЧЕНИЕ(Перечисление.Пол.Мужской)',
		];
		const model = parsed('ВЫБРАТЬ\n\t' + exprs.map((expr, k) => expr + ' КАК Поле' + k).join(',\n\t') + '\nИЗ\n\tСправочник.Валюты КАК Т');
		const found = E.groupingCandidates(partOf(model), typing(model, A, KNOWN));
		const at = (expr: string) => exprs.indexOf(expr);
		assert.deepEqual(found.groups, ['Т.Ссылка', 'Т.Наименование', 'Т.Дата', 'Т.Флаг', 'Т.Период', 'Т.Ид', 'Т.Любая', 'Т.Составное', 'Т.Неведомое'].map(at));
		assert.deepEqual(found.sums, ['Т.Курс', 'Т.Деньги', 'Т.Составное', 'Т.Неведомое'].map(at), 'деньги определяемым типом с составом — числовые');
		const reasons = (target: string) => found.skipped.filter((item) => item.target === target).map((item) => [exprs[item.index], item.reason]);
		const constants = ['&Дата', '0', '"x"', 'NULL', 'ЗНАЧЕНИЕ(Перечисление.Пол.Мужской)'].map((expr) => [expr, 'constant']);
		assert.deepEqual(reasons('groups'), [...constants, ['Т.Курс', 'numeric'], ['Т.Деньги', 'numeric']]);
		assert.deepEqual(reasons('sums'), [...constants, ...['Т.Ссылка', 'Т.Наименование', 'Т.Дата', 'Т.Флаг', 'Т.Период', 'Т.Ид', 'Т.Любая'].map((expr) => [expr, 'nonNumeric'])]);
		// Без вывода типов (макет вне выгрузки, обвязки нет) — все поля с путями в оба списка
		const blind = E.groupingCandidates(partOf(model), null);
		assert.deepEqual(blind.groups, blind.sums);
		assert.equal(blind.groups.length, 11);
		// Состав определяемого типа неизвестен: деньги — неизвестный тип, в оба
		const old = E.groupingCandidates(partOf(model), typing(model, A, UNCOMPOSED));
		assert.ok(old.groups.includes(at('Т.Деньги')) && old.sums.includes(at('Т.Деньги')), 'определяемый тип без состава — решает пользователь');
	});

	test('группировка активна: кандидаты — поля вне списков (путь от группового и константы покрыты), ЕСТЬNULL(Т.Сумма, 0) — числовое; вторая часть объединения — по своим источникам', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tТ.Склад КАК Склад,',
			'\tТ.Склад.Владелец КАК Владелец,',
			'\tТ.Номенклатура КАК Номенклатура,',
			'\tЕСТЬNULL(Т.Сумма, 0) КАК Сумма,',
			'\tСУММА(Т.Количество) КАК Количество,',
			'\t&П КАК П',
			'ИЗ',
			'\tДокумент.Счет.Товары КАК Т',
			'СГРУППИРОВАТЬ ПО',
			'\tТ.Склад',
			'',
			'ОБЪЕДИНИТЬ ВСЕ',
			'',
			'ВЫБРАТЬ',
			'\tВал.Ссылка,',
			'\tВал.Ссылка,',
			'\tВал.Наименование,',
			'\tВал.Курс,',
			'\t0,',
			'\tNULL',
			'ИЗ',
			'\tСправочник.Валюты КАК Вал',
		].join('\n');
		const model = parsed(text);
		const first = E.groupingCandidates(partOf(model), typing(model, A, KNOWN));
		assert.deepEqual(first, { groups: [2], sums: [3], skipped: [{ index: 2, target: 'sums', reason: 'nonNumeric' }, { index: 3, target: 'groups', reason: 'numeric' }] });
		const second = { statement: 0, part: 1 };
		const other = E.groupingCandidates(partOf(model, 1), typing(model, second, KNOWN));
		assert.deepEqual([other.groups, other.sums], [[0, 1, 2], [3]], 'вторая часть: свои алиасы и типы, константы и NULL — никуда');
		// Группирующие наборы правятся текстом — кандидатов нет
		const sets = parsed('ВЫБРАТЬ\n\tТ.Склад КАК Склад,\n\tСУММА(Т.Количество) КАК К\nИЗ\n\tДокумент.Счет.Товары КАК Т\nСГРУППИРОВАТЬ ПО ГРУППИРУЮЩИМ НАБОРАМ ((Т.Склад), ())');
		assert.deepEqual(E.groupingCandidates(partOf(sets), typing(sets, A, KNOWN)), { groups: [], sums: [], skipped: [] });
	});

	test('отрицательный контроль: «>>» суммируемых на справочнике Валюты не пишет СУММА(Т.Ссылка), «>>» групповых — констант в СГРУППИРОВАТЬ ПО', () => {
		const model = parsed('ВЫБРАТЬ\n\tТ.Ссылка,\n\tТ.Наименование,\n\tТ.Код\nИЗ\n\tСправочник.Валюты КАК Т');
		assert.deepEqual(E.groupingCandidates(partOf(model), typing(model, A, KNOWN)).sums, [], 'ссылка и строки не суммируются');
		const loose = parsed('ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка,\n\tТ.Наименование КАК Наименование,\n\t&Дата КАК Дата,\n\t0 КАК Ноль,\n\t"x" КАК Икс,\n\tNULL КАК Пусто,\n\tТ.Курс КАК Курс\nИЗ\n\tСправочник.Валюты КАК Т');
		const typeOf = typing(loose, A, KNOWN);
		const found = E.groupingCandidates(partOf(loose), typeOf);
		// Как «>>» групповых обвязки: addGroupField по каждому кандидату
		let current = loose;
		for (const index of found.groups) {
			current = ok(E.addGroupField(current, A, partOf(loose).fields[index].expr)).model;
		}
		assert.deepEqual(partOf(current).groupBy?.items, ['Т.Ссылка', 'Т.Наименование']);
		// После группировки вне списков только курс — «>>» суммируемых берёт его одного
		const after = E.groupingCandidates(partOf(current), typing(current, A, KNOWN));
		assert.deepEqual(after.sums, [6]);
		current = ok(E.setFieldAggregate(current, A, 6, 'sum')).model;
		const built = roundTrip(current, 'отрицательный контроль');
		assert.ok(built.includes('СУММА(Т.Курс) КАК Курс') && !built.includes('СУММА(Т.Ссылка)'), built);
		assert.ok(built.endsWith('СГРУППИРОВАТЬ ПО\n\tТ.Ссылка,\n\tТ.Наименование'), built);
		assert.deepEqual(E.groupingWarnings(partOf(current)), [], 'константы покрыты, полей вне списков нет');
		assert.deepEqual(E.aggregateTypeWarnings(partOf(current), typing(current, A, KNOWN)), []);
	});

	test('произведение и ВЫБОР по числам — числовые, «>>» суммируемых берёт и множители, и произведение; запрос без полей вне списков', () => {
		const model = parsed(
			[
				'ВЫБРАТЬ',
				'\tТ.Номенклатура КАК Номенклатура,',
				'\tТ.Количество КАК Количество,',
				'\tТ.Сумма КАК Сумма,',
				'\tТ.Количество * Т.Сумма КАК Произведение,',
				'\tВЫБОР КОГДА Т.Количество > 0 ТОГДА Т.Количество ИНАЧЕ 0 КОНЕЦ КАК Выбор',
				'ИЗ',
				'\tДокумент.Счет.Товары КАК Т',
			].join('\n')
		);
		const first = E.groupingCandidates(partOf(model), typing(model, A, KNOWN));
		assert.deepEqual([first.groups, first.sums], [[0], [1, 2, 3, 4]], 'произведение и ВЫБОР по числам — не в групповые');
		let current = ok(E.addGroupField(model, A, partOf(model).fields[0].expr)).model;
		// Произведение числовое и в групповые не идёт, поэтому множители не покрыты: «>>» суммируемых берёт и их, и произведение
		const second = E.groupingCandidates(partOf(current), typing(current, A, KNOWN));
		assert.deepEqual([second.groups, second.sums], [[], [1, 2, 3, 4]]);
		for (const index of second.sums) {
			current = ok(E.setFieldAggregate(current, A, index, 'sum')).model;
		}
		assert.deepEqual(E.groupingWarnings(partOf(current)), []);
		assert.deepEqual(E.aggregateTypeWarnings(partOf(current), typing(current, A, KNOWN)), []);
		const built = roundTrip(current, 'произведение');
		assert.ok(built.includes('СУММА(Т.Количество * Т.Сумма) КАК Произведение'), built);
		assert.ok(built.endsWith('СГРУППИРОВАТЬ ПО\n\tТ.Номенклатура'), built);
	});

	test('групповая неограниченная строка и хранилище значения — предупреждение, ПОДСТРОКА и строка с длиной — нет; у суммы такой строки — только Количество', () => {
		const model = parsed(
			[
				'ВЫБРАТЬ',
				'\tТ.Комментарий КАК Комментарий,',
				'\tТ.Данные КАК Данные,',
				'\tТ.Код КАК Код,',
				'\tПОДСТРОКА(Т.Комментарий, 1, 100) КАК Начало,',
				'\tСУММА(Т.Комментарий) КАК Сумма',
				'ИЗ',
				'\tСправочник.Валюты КАК Т',
				'СГРУППИРОВАТЬ ПО',
				'\tТ.Комментарий,',
				'\tТ.Данные,',
				'\tТ.Код,',
				'\tПОДСТРОКА(Т.Комментарий, 1, 100)',
			].join('\n')
		);
		const unlimited = { types: ['xs:string'], typeSets: [], typeIds: [], stringQualifiers: { length: '0', allowedLength: 'VARIABLE' } };
		const typeOf = (_index: number, expr: string): unknown => {
			if (expr === 'Т.Комментарий') {
				return unlimited;
			}
			if (expr === 'Т.Данные') {
				return T(['v8:ValueStorage']);
			}
			if (expr === 'Т.Код') {
				return { ...T(['xs:string']), stringQualifiers: { length: '10', allowedLength: 'VARIABLE' } };
			}
			return T(['xs:string']);
		};
		assert.deepEqual(E.groupTypeWarnings(partOf(model), typeOf), [
			'Групповое поле «Т.Комментарий» это строка неограниченной длины: по такой строке платформа не группирует. Сократите её: ПОДСТРОКА(…, 1, N) или ВЫРАЗИТЬ(… КАК СТРОКА(N)).',
			'Групповое поле «Т.Данные» это хранилище значения: по такому полю платформа не группирует.',
		]);
		assert.deepEqual(E.groupTypeWarnings(partOf(model), null), [], 'без типов — молчит');
		assert.equal(E.ungroupableKind({ types: ['xs:string'], stringQualifiers: { length: 0 } }), 'unlimitedString');
		assert.equal(E.ungroupableKind(T(['xs:string'])), '', 'длина неизвестна (выражение, определяемый тип) — молчим');
		assert.deepEqual(E.aggregateTypeWarnings(partOf(model), typeOf), [
			'Суммируемое поле «Т.Комментарий» не числовое, а функция «Сумма» считается только по числам. Выберите другую функцию (Количество).',
		]);
		// «>>» групповых такие поля берёт: деление — только по числу
		const plain = parsed('ВЫБРАТЬ\n\tТ.Комментарий КАК Комментарий,\n\tТ.Курс КАК Курс\nИЗ\n\tСправочник.Валюты КАК Т');
		const found = E.groupingCandidates(partOf(plain), (_index, expr) => (expr === 'Т.Комментарий' ? unlimited : T(['xs:decimal'])));
		assert.deepEqual([found.groups, found.sums], [[0], [1]]);
	});

	test('определяемый тип: состав пришит к типу (compositions) — QE раскрывает сам; уже раскрытый тип обвязки — так же; составной состав — в оба', () => {
		const model = parsed('ВЫБРАТЬ\n\tС.СуммаОплаты КАК СуммаОплаты,\n\tС.Ссылка КАК Ссылка\nИЗ\n\tДокумент.Счет КАК С');
		const raw = (_index: number, expr: string) => FT.partExpressionType(model, 0, partOf(model), expr, lookupOf(KNOWN), { queryModel: Q }).type;
		const rawType = raw(0, 'С.СуммаОплаты');
		assert.deepEqual(rawType?.typeSets, [MONEY], 'тип поля не меняется — подпись «ОпределяемыйТип…»');
		assert.ok(rawType?.compositions, 'состав пришит');
		for (const typeOf of [raw, typing(model, A, KNOWN)]) {
			const found = E.groupingCandidates(partOf(model), typeOf);
			assert.deepEqual([found.groups, found.sums], [[1], [0]], 'СуммаОплаты (ДенежнаяСуммаНеотрицательная → xs:decimal) — только в суммируемые');
		}
		const mixed = (_index: number, expr: string) =>
			expr === 'С.СуммаОплаты' ? { types: [], typeSets: [MONEY], typeIds: [], compositions: [{ source: MONEY, types: ['xs:decimal', 'cfg:CatalogRef.Валюты'], typeSets: [] }] } : null;
		const both = E.groupingCandidates(partOf(model), mixed);
		assert.ok(both.groups.includes(0) && both.sums.includes(0), 'число и ссылка в составе — в оба');
		const uuid = (_index: number, expr: string) => (expr === 'С.СуммаОплаты' ? { types: [], typeSets: [], typeIds: ['0A1B'] } : null);
		const unknown = E.groupingCandidates(partOf(model), uuid);
		assert.ok(unknown.groups.includes(0) && unknown.sums.includes(0), 'UUID определяемого типа без состава — в оба');
	});

	test('aggregateTypeWarnings: Сумма ссылки и Среднее строки — предупреждение; число, деньги с составом, максимум, количество, неизвестный тип, агрегат внутри выражения — нет; английский SUM', () => {
		const model = parsed(
			[
				'ВЫБРАТЬ',
				'\tСУММА(Т.Ссылка) КАК А,',
				'\tСРЕДНЕЕ(Т.Наименование) КАК Б,',
				'\tСУММА(Т.Курс) КАК В,',
				'\tСУММА(Т.Деньги) КАК Г,',
				'\tМАКСИМУМ(Т.Ссылка) КАК Д,',
				'\tКОЛИЧЕСТВО(РАЗЛИЧНЫЕ Т.Ссылка) КАК Е,',
				'\tСУММА(Т.Неведомое) КАК Ж,',
				'\tЕСТЬNULL(СУММА(Т.Код), 0) КАК З',
				'ИЗ',
				'\tСправочник.Валюты КАК Т',
			].join('\n')
		);
		assert.deepEqual(E.aggregateTypeWarnings(partOf(model), typing(model, A, KNOWN)), [
			'Суммируемое поле «Т.Ссылка» не числовое, а функция «Сумма» считается только по числам. Выберите другую функцию (Количество, Максимум, Минимум).',
			'Суммируемое поле «Т.Наименование» не числовое, а функция «Среднее» считается только по числам. Выберите другую функцию (Количество, Максимум, Минимум).',
		]);
		assert.deepEqual(E.aggregateTypeWarnings(partOf(model), null), [], 'без типов — молчит');
		const english = parsed('SELECT\n\tSUM(T.Ссылка) AS A,\n\tAVG(T.Курс) AS B\nFROM\n\tCatalog.Валюты AS T');
		const warnings = E.aggregateTypeWarnings(partOf(english), (_index, expr) => (expr === 'T.Ссылка' ? T(['cfg:CatalogRef.Валюты']) : T(['xs:decimal'])));
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /«T\.Ссылка» не числовое, а функция «Сумма»/);
	});

	test('fieldsOfSource вложенного запроса: env.subqueryType даёт типы колонок (без него — null), связь по ссылочной колонке подзапроса предлагается', () => {
		const model = parsed(
			'ВЫБРАТЬ\n\tВл.Ссылка КАК Ссылка\nИЗ\n\t(ВЫБРАТЬ\n\t\tТ.Ссылка КАК Ссылка,\n\t\tТ.Курс КАК Курс,\n\t\t1 КАК Один\n\tИЗ\n\t\tСправочник.Валюты КАК Т) КАК Вл'
		);
		const source = E.sourcesOf(partOf(model))[0].source;
		assert.equal(source.kind, 'subquery');
		const subqueryType = (value: Source, column: string) => FT.subqueryColumnType(model, 0, value.query as Statement, column, lookupOf(KNOWN), { queryModel: Q }).type;
		assert.deepEqual(
			E.fieldsOfSource(source, { subqueryType }).fields.map((item) => [item.name, (item.type as TypeDto | null)?.types ?? null]),
			[
				['Ссылка', ['cfg:CatalogRef.Валюты']],
				['Курс', ['xs:decimal']],
				['Один', null],
			]
		);
		assert.deepEqual(
			E.fieldsOfSource(source, {}).fields.map((item) => item.type),
			[null, null, null],
			'без subqueryType — тип неизвестен'
		);
		const env: SourceEnv = { describe: describeOf(KNOWN), subqueryType };
		const linked = ok(E.addSource(model, A, { table: 'Справочник.Валюты' }));
		const suggestion = E.suggestLink(linked.model, A, linked.alias ?? '', env);
		assert.equal(suggestion.state, 'ready');
		assert.equal(suggestion.condition, 'Вл.Ссылка = Валюты.Ссылка');
		assert.equal(E.suggestLink(linked.model, A, linked.alias ?? '', { describe: describeOf(KNOWN) }).state, 'none', 'без типов подзапроса связи нет');
	});
});

describe('Конструктор запроса на фикстуре cf-md-query-tables: связи по составу и «>>» по типу', () => {
	interface Composition {
		source: string;
		types: string[];
		typeSets: string[];
	}
	interface Answer {
		object: string;
		tables: DescribedTable[];
		typeCompositions?: Composition[];
	}
	interface FieldTypesApi {
		attachTypeCompositions<T>(answer: T): T;
		expandedTypes(dto: unknown): { types: string[]; typeSets: string[]; typeIds: string[] };
		refTypeNames(dto: unknown): string[];
		tableObjectOf(name: string): { key: string; tail: string[] } | null;
		findTable(description: Answer | null, tail: string[]): DescribedTable | null;
		partExpressionType(
			batch: Model,
			statementIndex: number,
			part: Part,
			expr: string,
			lookup: (key: string) => Answer | null | undefined,
			options: { queryModel: QueryModelApi }
		): { type: unknown; pending: unknown[] };
	}
	type Lookup = (key: string) => Answer | null;
	const FT = loadModule<FieldTypesApi>('dcs-editor-field-types.js');
	const copyOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
	const RAW = Object.values(tables).map((entry) => entry.description as Answer);
	/** Ответы, как их держит кэш webview: составы пришиты (обвязка зовёт attachTypeCompositions при приёме). */
	const ATTACHED = RAW.map((answer) => FT.attachTypeCompositions(copyOf(answer)));
	/** Те же ответы без ключа typeCompositions: так md-sparrow отвечает, когда составы не найдены в выгрузке. */
	const UNCOMPOSED_ANSWERS = RAW.map((answer) => {
		const copy = copyOf(answer);
		delete copy.typeCompositions;
		return copy;
	});
	const lookupOf =
		(answers: Answer[]): Lookup =>
		(key) =>
			answers.find((answer) => answer.object.toUpperCase() === key) ?? null;
	const describeOf =
		(lookup: Lookup): SourceEnv['describe'] =>
		(name) => {
			const target = FT.tableObjectOf(name);
			const table = target ? FT.findTable(lookup(target.key), target.tail) : null;
			return table ? { state: 'ready', table } : { state: 'none' };
		};
	const live = lookupOf(ATTACHED);
	const uncomposed = lookupOf(UNCOMPOSED_ANSWERS);
	const COMPOSED_SET_RE = /^cfg:(?:DefinedType|Characteristic)\./;
	const OBJECT_REF_RE = /^[A-Za-z0-9]+:[A-Za-z]+Ref\.[^.]+$/;
	const IDENT_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

	test('связь Пользователи + _ДемоФизическиеЛица по составу ФизическоеЛицо: оба порядка и «Добавить» — «ФизическоеЛицо = Ссылка»; без состава — не угадывает', () => {
		const env: SourceEnv = { describe: describeOf(live) };
		const usersFirst = ok(E.addSource(ok(E.addSource(E.newModel(''), A, { table: 'Справочник.Пользователи' })).model, A, { table: 'Справочник._ДемоФизическиеЛица' }));
		assert.equal(E.suggestLink(usersFirst.model, A, '_ДемоФизическиеЛица', env).condition, 'Пользователи.ФизическоеЛицо = _ДемоФизическиеЛица.Ссылка');
		const personsFirst = ok(E.addSource(ok(E.addSource(E.newModel(''), A, { table: 'Справочник._ДемоФизическиеЛица' })).model, A, { table: 'Справочник.Пользователи' }));
		assert.equal(E.suggestLink(personsFirst.model, A, 'Пользователи', env).condition, '_ДемоФизическиеЛица.Ссылка = Пользователи.ФизическоеЛицо');
		// «Добавить» на «Связях» у текста с двумя таблицами без связи — то же правило по алиасам текста
		const pair = parsed('ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Пользователи КАК П,\n\tСправочник._ДемоФизическиеЛица КАК Ф');
		const suggestion = E.suggestLink(pair, A, 'Ф', env) as { state: string; left: string; right: string; allLeft: boolean; allRight: boolean; condition: string };
		assert.equal(suggestion.condition, 'П.ФизическоеЛицо = Ф.Ссылка');
		const applied = ok(E.addLink(pair, A, suggestion));
		assert.ok(roundTrip(applied.model, 'связь по составу фикстуры').includes('ПО П.ФизическоеЛицо = Ф.Ссылка'));
		// Без typeCompositions поле определяемого типа у Пользователей без состава — правило связи его не видит
		assert.equal(E.suggestLink(pair, A, 'Ф', { describe: describeOf(uncomposed) }).state, 'none');
	});

	test('сверка копий правила: expandedTypes и refTypeNames конструктора совпадают с DcsFieldTypes на каждом поле фикстуры с пришитыми составами', () => {
		let composed = 0;
		for (const answer of ATTACHED) {
			for (const table of answer.tables) {
				for (const item of [...table.fields, ...(table.params ?? []).map((param) => ({ name: param.name, type: param.type }))]) {
					assert.deepEqual(E.expandedTypes(item.type), FT.expandedTypes(item.type), `${table.name}.${item.name}`);
					assert.deepEqual(E.refTypeNames(item.type), FT.refTypeNames(item.type), `${table.name}.${item.name}`);
					composed += (item.type as { compositions?: unknown } | null)?.compositions ? 1 : 0;
				}
			}
		}
		// 118 полей с определяемым типом или характеристикой (корпусный тест DcsFieldTypes разбирает их по пределу)
		assert.equal(composed, 118);
	});

	test('«>>» на «Группировке» по каждой таблице фикстуры: деньги определяемым типом (СуммаОплаты и т. п.) — только в суммируемых, составы из одних ссылок — только в групповых; без состава — в оба', () => {
		const tally = { tables: 0, money: 0, refsOnly: 0, mixed: 0 };
		const skippedTables: string[] = [];
		for (const answer of ATTACHED) {
			for (const table of answer.tables) {
				const fields = table.fields.filter((item) => IDENT_RE.test(item.name));
				if (fields.length === 0) {
					continue;
				}
				const text = 'ВЫБРАТЬ\n\t' + fields.map((item, k) => 'Т.' + item.name + ' КАК Поле' + k).join(',\n\t') + '\nИЗ\n\t' + table.name + ' КАК Т';
				const result = Q.parse(text);
				if (result.diagnostics.length > 0) {
					skippedTables.push(table.name);
					continue;
				}
				const model = result.model;
				const part = E.partAt(model, A);
				const typing = (lookup: Lookup) => (_index: number, expr: string) => {
					const typed = FT.partExpressionType(model, 0, part, expr, lookup, { queryModel: Q });
					return typed.type ? FT.expandedTypes(typed.type) : null;
				};
				const found = E.groupingCandidates(part, typing(live));
				const old = E.groupingCandidates(part, typing(uncomposed));
				tally.tables += 1;
				const index = new Map((answer.typeCompositions ?? []).map((record) => [record.source, record]));
				fields.forEach((item, k) => {
					const where = `${table.name}.${item.name}`;
					assert.ok(found.groups.includes(k) || found.sums.includes(k), `${where}: поле с путём попадает хотя бы в один список`);
					const sets = ((item.type as { typeSets?: string[] } | null)?.typeSets ?? []).filter((set) => COMPOSED_SET_RE.test(set));
					if (sets.length !== 1 || ((item.type as { types?: string[] }).types ?? []).length > 0) {
						return;
					}
					const record = index.get(sets[0]);
					assert.ok(record, `${where}: нет состава ${sets[0]}`);
					const inBoth = old.groups.includes(k) && old.sums.includes(k);
					if (record.types.length > 0 && record.types.every((name) => name === 'xs:decimal')) {
						tally.money += 1;
						assert.ok(found.sums.includes(k) && !found.groups.includes(k), `${where}: деньги определяемым типом — только в суммируемых`);
						assert.ok(inBoth, `${where}: без состава — тип неизвестен, в оба`);
					} else if (record.types.length > 0 && record.types.every((name) => OBJECT_REF_RE.test(name))) {
						tally.refsOnly += 1;
						assert.ok(found.groups.includes(k) && !found.sums.includes(k), `${where}: состав из ссылок — только в групповых`);
						assert.ok(inBoth, `${where}: без состава — в оба`);
					} else if (record.types.includes('xs:decimal')) {
						tally.mixed += 1;
						assert.ok(found.groups.includes(k) && found.sums.includes(k), `${where}: число вместе с другими типами — решает пользователь`);
					}
				});
			}
		}
		assert.deepEqual(skippedTables, [], 'каждая таблица фикстуры разбирается');
		// СуммаОплаты и суммы ТЧ счёта (5) и суммы журнала проводок (54) — деньги; субконто, контакты, доступ и др. — ссылки
		assert.equal(tally.money, 59, JSON.stringify(tally));
		assert.ok(tally.refsOnly > 30 && tally.mixed > 0 && tally.tables > 30, JSON.stringify(tally));
	});
});

describe('Конструктор запроса: критерии отбора, последовательности и «Константы»', () => {
	const FT = loadModule<{ isConstantsTable(name: string): boolean }>('dcs-editor-field-types.js');
	const T = (...types: string[]) => ({ types, typeSets: [] as string[] });
	/** Основная таблица критерия в форме ответа cf-md-query-tables (синтетика по ответу md-sparrow на ssl31). */
	const CRITERION: DescribedTable = {
		name: 'КритерийОтбора.СвязанныеДокументы',
		kind: 'main',
		params: [{ name: 'Значение', kind: 'value', required: true, type: T('cfg:DocumentRef._ДемоСчетНаОплатуПокупателю') }],
		fields: [{ name: 'Ссылка', nameEn: 'Ref', synonym: '', type: T('cfg:DocumentRef._ДемоЗаказПокупателя') }],
	};
	/** Границы последовательности: виртуальная таблица без параметров (в корпусе и в ответе jar). */
	const BOUNDARIES: DescribedTable = {
		name: 'Последовательность._ДемоДвижениеТоваров.Границы',
		kind: 'virtual',
		params: [],
		fields: [
			{ name: 'Период', nameEn: 'Period', synonym: '', type: T('xs:dateTime') },
			{ name: 'Регистратор', nameEn: 'Recorder', synonym: '', type: T('cfg:DocumentRef._ДемоРеализацияТоваров') },
		],
	};
	const table = (name: string): Source => ({ kind: 'table', table: name, virtualTable: null, params: null, alias: null });

	test('isConstantsTable и isTempTable: «Константы» и «Constants» без учёта регистра — таблица констант, а не ВТ пакета; правило совпадает с DcsFieldTypes', () => {
		for (const name of ['Константы', 'Constants', 'константы', 'CONSTANTS']) {
			assert.equal(E.isConstantsTable(table(name)), true, name);
			assert.equal(E.isConstantsTable(name), true, `${name} строкой`);
			assert.equal(E.isTempTable(table(name)), false, `${name}: не ВТ пакета`);
		}
		for (const name of ['ВТ_Имя', 'КонстантыВТ', 'Константа', 'Константа.ВалютаУчета', 'Справочник.Валюты', '']) {
			assert.equal(E.isConstantsTable(table(name)), false, name);
		}
		assert.equal(E.isTempTable(table('ВТ_Имя')), true);
		assert.equal(E.isTempTable(table('Справочник.Валюты')), false);
		assert.equal(E.isConstantsTable({ kind: 'subquery', alias: 'Константы' }), false, 'вложенный запрос с таким алиасом — не таблица');
		for (const name of ['Константы', 'constants', 'ВТ_Имя', 'Константа', 'Константа.Х', '']) {
			assert.equal(E.isConstantsTable(name), FT.isConstantsTable(name), `копии правила расходятся на «${name}»`);
		}
	});

	test('defaultParamTexts: у критерия — &Значение, занятое имя — с суффиксом; английское описание — &Value; необязательный параметр и Границы — без скобок', () => {
		assert.deepEqual(E.defaultParamTexts(CRITERION), ['&Значение']);
		assert.deepEqual(E.defaultParamTexts(CRITERION, ['значение']), ['&Значение1'], 'имена параметров — без учёта регистра');
		assert.deepEqual(E.defaultParamTexts(CRITERION, ['Значение', 'Значение1', 'Период']), ['&Значение2']);
		assert.deepEqual(E.defaultParamTexts({ ...CRITERION, params: [{ ...CRITERION.params[0], name: 'Value' }] }), ['&Value']);
		assert.deepEqual(E.defaultParamTexts({ ...CRITERION, params: [{ ...CRITERION.params[0], name: 'не имя' }] }), ['&Значение'], 'не идентификатор — имя по умолчанию');
		assert.equal(E.defaultParamTexts({ ...CRITERION, params: [{ name: 'Значение', kind: 'value' }] }), null, 'без required — пусто, таблица без скобок');
		assert.equal(E.defaultParamTexts(BOUNDARIES), null, 'у Границ параметров нет');
		const turnovers = tables['РегистрНакопления._ДемоОстаткиТоваровВМестахХранения'].description.tables.find((item) => item.name.endsWith('.Обороты'));
		assert.ok(turnovers);
		assert.deepEqual(E.defaultParamTexts(turnovers, ['Значение']), ['', '', 'Авто', ''], 'у ВТ регистра занятые имена ни на что не влияют');
	});

	test('addSource критерия с умолчаниями: «(&Значение)», второй критерий — «(&Значение1)»; признак — params, а не virtualTable', () => {
		let model = E.newModel('');
		const first = ok(E.addSource(model, A, { table: CRITERION.name, params: E.defaultParamTexts(CRITERION, Q.parametersOf(Q.build(model))) }));
		assert.equal(first.alias, 'СвязанныеДокументы');
		model = ok(E.addField(first.model, A, 'СвязанныеДокументы.Ссылка')).model;
		const second = ok(E.addSource(model, A, { table: CRITERION.name, params: E.defaultParamTexts(CRITERION, Q.parametersOf(Q.build(model))) }));
		assert.equal(second.alias, 'СвязанныеДокументы1');
		model = second.model;
		const text = roundTrip(model, 'два критерия');
		assert.ok(text.includes('КритерийОтбора.СвязанныеДокументы(&Значение) КАК СвязанныеДокументы'), text);
		assert.ok(text.includes('КритерийОтбора.СвязанныеДокументы(&Значение1) КАК СвязанныеДокументы1'), text);
		assert.deepEqual(Q.parametersOf(text), ['Значение', 'Значение1']);
		const source = E.sourcesOf(model.statements[0].parts[0])[0].source;
		assert.equal(source.virtualTable, null);
		assert.deepEqual(E.paramTexts(source), ['&Значение']);
		assert.deepEqual(E.compositionTables(model.statements[0].parts[0]).map((row) => row.virtual), [true, true], '«Параметры…» «Компоновки данных» доступны по params');
	});

	test('Границы последовательности: virtualTable «Границы», без параметров — источник без скобок; пустые параметры ничего не меняют', () => {
		const added = ok(E.addSource(E.newModel(''), A, { table: BOUNDARIES.name, params: E.defaultParamTexts(BOUNDARIES) }));
		assert.equal(added.alias, '_ДемоДвижениеТоваровГраницы');
		const model = ok(E.addField(added.model, A, '_ДемоДвижениеТоваровГраницы.Период')).model;
		const text = roundTrip(model, 'Границы');
		assert.ok(text.includes('\tПоследовательность._ДемоДвижениеТоваров.Границы КАК _ДемоДвижениеТоваровГраницы'), text);
		const source = E.sourcesOf(model.statements[0].parts[0])[0].source;
		assert.equal(source.virtualTable, 'Границы');
		assert.equal(source.params, null);
		assert.equal(E.setVirtualParams(model, A, '_ДемоДвижениеТоваровГраницы', ['']).model, model, 'пустая позиция у таблицы без скобок — не правка');
	});

	test('«Заменить таблицу»: другой критерий берёт умолчания новой таблицы, а не значение прежнего; те же Границы — параметры сохраняются', () => {
		const model = parsed('ВЫБРАТЬ\n\tК.Ссылка КАК Ссылка\nИЗ\n\tКритерийОтбора.СвязанныеДокументы(&Мой) КАК К');
		const replaced = ok(E.replaceSource(model, A, 'К', { table: 'КритерийОтбора.Другой', defaultParams: ['&Значение'] }));
		assert.ok(roundTrip(replaced.model, 'замена критерия').includes('КритерийОтбора.Другой(&Значение) КАК К'));
		const bounds = parsed('ВЫБРАТЬ\n\tГ.Период КАК Период\nИЗ\n\tПоследовательность.А.Границы(&П) КАК Г');
		const kept = ok(E.replaceSource(bounds, A, 'Г', { table: 'Последовательность.Б.Границы' }));
		assert.ok(roundTrip(kept.model, 'замена Границ').includes('Последовательность.Б.Границы(&П) КАК Г'), 'та же ВТ — параметры остаются');
	});

	test('fieldsOfSource «Константы»: поля — по env.describe, а не колонки ВТ пакета с тем же именем', () => {
		const model = parsed('ВЫБРАТЬ\n\tК.ВалютаУчета КАК ВалютаУчета\nИЗ\n\tКонстанты КАК К');
		const source = E.sourcesOf(model.statements[0].parts[0])[0].source;
		const temps = [{ name: 'Константы', fields: ['Чужое'] }];
		const asked: string[] = [];
		const env: SourceEnv = {
			tempTables: temps,
			describe: (name) => {
				asked.push(name);
				return { state: 'ready', table: { name: 'Константы', kind: 'main', params: [], fields: [{ name: 'ВалютаУчета', nameEn: 'ВалютаУчета', synonym: 'Валюта учета', type: null }] } };
			},
		};
		assert.deepEqual(
			E.fieldsOfSource(source, env).fields.map((item) => [item.name, item.synonym]),
			[['ВалютаУчета', 'Валюта учета']]
		);
		assert.deepEqual(asked, ['Константы']);
		assert.deepEqual(E.fieldsOfSource(source, { tempTables: temps }), { state: 'none', fields: [] }, 'без описания полей нет — колонки ВТ не подставляются');
		assert.equal(E.fieldsOfSource(source, { describe: () => ({ state: 'loading' }) }).state, 'loading');
	});

	test('пакет: чтение «Константы» — не чтение ВТ; переименование ВТ его не трогает; имя «Константы» для новой ВТ — отказ', () => {
		const separator = '\n;\n\n' + '/'.repeat(80) + '\n';
		const batch = parsed('ВЫБРАТЬ\n\tК.Х КАК Х\nПОМЕСТИТЬ ВТ\nИЗ\n\tКонстанты КАК К' + separator + 'ВЫБРАТЬ\n\tВТ.Х КАК Х,\n\tК.У КАК У\nИЗ\n\tВТ КАК ВТ,\n\tКонстанты КАК К');
		assert.deepEqual(E.batchWarnings(batch), []);
		const renamed = ok(E.renameTempTable(batch, 0, 'ВТ_Новая'));
		const out = Q.build(renamed.model);
		assert.ok(out.includes('ВТ_Новая КАК ВТ'), out);
		assert.equal(out.split('Константы КАК К').length - 1, 2, 'обе таблицы констант на месте');
		// ВТ с именем «Константы» из текста: её чтение — таблица констант
		const named = parsed('ВЫБРАТЬ\n\t1 КАК А\nПОМЕСТИТЬ Константы' + separator + 'ВЫБРАТЬ\n\tК.А КАК А\nИЗ\n\tКонстанты КАК К');
		assert.ok(Q.build(ok(E.renameTempTable(named, 0, 'ВТ_Своя')).model).endsWith('ИЗ\n\tКонстанты КАК К'), 'чтение не переименовано');
		assert.match(E.renameTempTable(batch, 0, 'константы').error ?? '', /общей таблицы констант/);
		assert.match(E.setStatementKind(parsed('ВЫБРАТЬ\n\t1 КАК А'), 0, { kind: 'create', table: 'Constants' }).error ?? '', /общей таблицы констант/);
	});
});

describe('Конструктор запроса: проверка имён по метаданным', () => {
	interface Answer {
		object: string;
		kind?: string;
		tables: DescribedTable[];
		typeCompositions?: Array<{ source: string; types: string[]; typeSets: string[] }>;
	}
	interface NameEnv {
		pending: Array<{ key: string }>;
		describe(table: string): { state: string; table?: DescribedTable; description?: Answer };
		members(type: unknown): { known: boolean; names?: string[]; loading?: boolean };
	}
	interface EnvOptions {
		queryModel: QueryModelApi;
		outerTemp?: unknown[];
		objectExists?: (kind: string, name: string) => boolean | null;
		constants?: (table: string) => { state: string; table?: DescribedTable };
		commonAttributes?: string[];
	}
	interface FieldTypesApi {
		attachTypeCompositions<T>(answer: T): T;
		isConstantsTable(name: string): boolean;
		nameCheckEnv(lookup: (key: string) => Answer | null | undefined, options: EnvOptions): NameEnv;
	}
	type Lookup = (key: string) => Answer | null | undefined;
	const FT = loadModule<FieldTypesApi>('dcs-editor-field-types.js');
	const copyOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
	/** Ответы кэша webview: составы пришиты, как при приёме describeType. */
	const ATTACHED = Object.values(tables).map((entry) => FT.attachTypeCompositions(copyOf(entry.description as Answer)));
	const UNCOMPOSED = Object.values(tables).map((entry) => {
		const copy = copyOf(entry.description as Answer);
		delete copy.typeCompositions;
		return copy;
	});
	const lookupOf =
		(answers: Answer[]): Lookup =>
		(key) =>
			answers.find((answer) => answer.object.toUpperCase() === key) ?? null;
	const live = lookupOf(ATTACHED);
	/** Дерево «База данных»: объекты фикстуры есть, «НетТакого…» — нет, о прочих сведений нет (null). */
	const FIXTURE_OBJECTS = new Set(Object.keys(tables).map((name) => name.toUpperCase()));
	const tree = (kind: string, name: string): boolean | null =>
		FIXTURE_OBJECTS.has((kind + '.' + name).toUpperCase()) ? true : name.startsWith('НетТакого') ? false : null;
	const envOf = (lookup: Lookup = live, extra: Partial<EnvOptions> = {}): NameEnv => FT.nameCheckEnv(lookup, { queryModel: Q, objectExists: tree, ...extra });
	const problemsOf = (text: string, lookup: Lookup = live, extra: Partial<EnvOptions> = {}): NameProblem[] => E.nameProblems(parsed(text), envOf(lookup, extra));
	const messages = (items: NameProblem[]): string[] => items.map((item) => item.message);
	const USERS = 'Справочник.Пользователи';
	const STOCK = 'РегистрНакопления._ДемоОстаткиТоваровВМестахХранения';

	test('отрицательный контроль: 47 запросов ssl31 с описаниями фикстуры — 0 предупреждений; объекты без описания молчат', () => {
		let described = 0;
		let silent = 0;
		const env = envOf();
		for (const entry of corpus) {
			const model = Q.parse(entry.text).model;
			assert.deepEqual(E.nameProblems(model, envOf()), [], `${entry.file} ${entry.dataSet}`);
			// И без составов, и без дерева — тоже молча
			assert.deepEqual(E.nameProblems(model, envOf(lookupOf(UNCOMPOSED), { objectExists: undefined })), [], `${entry.file}: без составов`);
			for (const statement of model.statements) {
				for (const part of statement.parts ?? []) {
					for (const item of E.sourcesOf(part)) {
						const name = item.source.kind === 'table' ? item.source.table ?? '' : '';
						if (name.includes('.')) {
							if (env.describe(name).state === 'ready') {
								described++;
							} else {
								silent++;
							}
						}
					}
				}
			}
		}
		// Фикстура покрывает часть источников: остальные — «описания нет», и о них проверка молчит
		assert.ok(described >= 15 && silent > 0, `описано ${described}, без описания ${silent}`);
		assert.deepEqual(env.pending, [], 'фикстура отвечает сразу: ожидания нет');
	});

	// Порог по времени на общих машинах CI мигает, поэтому замер включается явно и в обычном наборе пропускается
	test(
		'бюджет: проверка имён 47 запросов ssl31, медиана меньше 5 мс на текст',
		{ skip: process.env.DCS_PERF_BUDGET === '1' ? false : 'замер времени включается переменной DCS_PERF_BUDGET=1' },
		() => {
			const models = corpus.map((entry) => ({ entry, model: Q.parse(entry.text).model }));
			// Первый проход прогревает JIT
			for (const { model } of models) {
				E.nameProblems(model, envOf());
			}
			const over: string[] = [];
			for (const { entry, model } of models) {
				const runs: number[] = [];
				for (let k = 0; k < 7; k++) {
					const started = process.hrtime.bigint();
					E.nameProblems(model, envOf());
					runs.push(Number(process.hrtime.bigint() - started) / 1e6);
				}
				const ms = runs.sort((a, b) => a - b)[3];
				if (ms >= 5) {
					over.push(`${entry.file} ${entry.dataSet}: ${ms.toFixed(2)} мс`);
				}
			}
			assert.deepEqual(over, [], over.join('; '));
		}
	);

	test('опечатки: поле, реквизит через точку (состав определяемого типа), хвост ВТ, неизвестный объект; место — позиция в тексте', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tП.Наименованиее КАК Н,',
			'\tП.ФизическоеЛицо.ИНННН КАК И,',
			'\tП.ФизическоеЛицо.ИНН КАК ИНН,',
			'\tП.Ref КАК Ссылка,',
			'\tО.КоличествоОстаток КАК Количество',
			'ИЗ',
			`\t${USERS} КАК П,`,
			`\t${STOCK}.Остаткии КАК О,`,
			'\tСправочник.НетТакого КАК Н2',
		].join('\n');
		const found = problemsOf(text);
		assert.deepEqual(messages(found), [
			`У объекта «${STOCK}» нет таблицы «Остаткии» (табличной части или виртуальной таблицы).`,
			'Объекта «Справочник.НетТакого» нет в конфигурации (таблица «Справочник.НетТакого»).',
			`«П.Наименованиее»: у «П» (${USERS}) нет поля «Наименованиее».`,
			'«П.ФизическоеЛицо.ИНННН»: у «П.ФизическоеЛицо» нет реквизита «ИНННН».',
		]);
		assert.deepEqual(
			found.map((item) => [item.statement, item.part, item.text]),
			[
				[0, 0, `${STOCK}.Остаткии`],
				[0, 0, 'Справочник.НетТакого'],
				[0, 0, 'П.Наименованиее'],
				[0, 0, 'П.ФизическоеЛицо.ИНННН'],
			]
		);
		for (const item of found) {
			assert.ok(typeof item.offset === 'number' && text.slice(item.offset).startsWith(item.text), `место ${item.text}: ${item.offset}`);
		}
		// Без typeCompositions состав ФизическоеЛицо неизвестен — реквизит через точку не проверяется, поле — да
		const old = messages(problemsOf(text, lookupOf(UNCOMPOSED)));
		assert.equal(old.some((item) => item.includes('ФизическоеЛицо')), false);
		assert.equal(old.some((item) => item.includes('Наименованиее')), true);
		// Без дерева «нет в конфигурации» не утверждается: описания нет — молчим
		assert.equal(messages(problemsOf(text, live, { objectExists: undefined })).some((item) => item.includes('НетТакого')), false);
		// Модель после правки (без мест в тексте) — без offset
		const edited = ok(E.addField(parsed(text), A, 'П.Ссылка')).model;
		delete edited.statements[0].original;
		assert.equal(E.nameProblems(edited, envOf())[0].offset, undefined);
	});

	test('неизвестный алиас — только когда поля всех источников известны; ЗНАЧЕНИЕ, ССЫЛКА, ВЫРАЗИТЬ, ТИП и путь без алиаса молчат', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tП.Ссылка КАК Ссылка,',
			'\tПп.Наименование КАК Имя,',
			'\tФизическоеЛицо.ИНН КАК ИНН,',
			'\tВЫРАЗИТЬ(П.Подразделение КАК Справочник._ДемоПодразделения) КАК Подразделение',
			'ИЗ',
			`\t${USERS} КАК П`,
			'ГДЕ',
			'\tП.Ссылка <> ЗНАЧЕНИЕ(Справочник.Пользователи.ПустаяСсылка)',
			'\tИ П.Ссылка ССЫЛКА Справочник.Пользователи',
			'\tИ ТИПЗНАЧЕНИЯ(П.Ссылка) = ТИП(Справочник.Пользователи)',
			'\tИ &Период.ДатаНачала <> ДАТАВРЕМЯ(1, 1, 1)',
		].join('\n');
		assert.deepEqual(messages(problemsOf(text)), ['«Пп.Наименование»: в части запроса нет таблицы с псевдонимом «Пп».']);
		// Источник без описания: его полей не знаем — путь «Пп.…» мог быть его полем, молчим
		const unknown = text.replace(`${USERS} КАК П\n`, `${USERS} КАК П,\n\tСправочник.НеОписан КАК Х\n`);
		assert.deepEqual(problemsOf(unknown), []);
	});

	test('псевдоним с именем вида («КАК Справочник») — имя типа в ВЫРАЗИТЬ и ССЫЛКА не считается его путём, опечатка в поле видна', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tСправочник.Ссылка КАК Ссылка,',
			'\tВЫРАЗИТЬ(Справочник.Ссылка КАК Справочник.Пользователи).Наименование КАК Имя,',
			'\tСправочник.Наименованиее КАК Опечатка',
			'ИЗ',
			`\t${USERS} КАК Справочник`,
			'ГДЕ',
			'\tСправочник.Ссылка ССЫЛКА Справочник.Пользователи',
		].join('\n');
		const found = messages(problemsOf(text));
		assert.equal(found.length, 1, JSON.stringify(found));
		assert.match(found[0], /Наименованиее/);
		const english = 'SELECT\n\tCatalog.Ref AS Ref\nFROM\n\tCatalog.Пользователи AS Catalog\nWHERE\n\tCatalog.Ref REFS Catalog.Пользователи\n\tAND CAST(Catalog.Ref AS Catalog.Пользователи) <> UNDEFINED';
		assert.deepEqual(messages(problemsOf(english)), []);
	});

	test('временные таблицы и вложенные запросы: колонки известны — опечатка видна; выражение без псевдонима, внешние данные и ВТ внешнего пакета', () => {
		const separator = '\n;\n\n' + '/'.repeat(80) + '\n';
		const batch = [
			`ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка,\n\tП.Наименование КАК Имя\nПОМЕСТИТЬ ВТ_Пользователи\nИЗ\n\t${USERS} КАК П`,
			'ВЫБРАТЬ\n\tВТ.Ссылка КАК Ссылка,\n\tВТ.Имяя КАК Имя,\n\tВн.Колонка КАК Колонка,\n\tВл.Код КАК Код,\n\tВл.Ссылкаа КАК Лишнее\nИЗ\n\tВТ_Пользователи КАК ВТ,\n\tВнешниеДанные КАК Вн,\n\t(ВЫБРАТЬ\n\t\tП.Ссылка КАК Ссылка,\n\t\tП.Наименование КАК Код\n\tИЗ\n\t\t' +
				USERS +
				' КАК П) КАК Вл',
		].join(separator);
		const found = problemsOf(batch);
		assert.deepEqual(messages(found), [
			'«ВТ.Имяя»: у «ВТ» (временная таблица ВТ_Пользователи) нет поля «Имяя».',
			'«Вл.Ссылкаа»: у «Вл» (вложенный запрос) нет поля «Ссылкаа».',
		]);
		assert.deepEqual(
			found.map((item) => [item.statement, item.part]),
			[
				[1, 0],
				[1, 0],
			]
		);
		// Колонка ВТ без псевдонима (выражение) — состав неполон, поля ВТ не проверяются
		const loose = batch.replace('П.Наименование КАК Имя', 'П.Наименование + ""');
		assert.equal(messages(problemsOf(loose)).some((item) => item.includes('«ВТ.')), false);
		// Опечатка внутри вложенного запроса — его же правилами, с подписью
		const inner = problemsOf(batch.replace('\t\tП.Наименование КАК Код', '\t\tП.Наименованиее КАК Код'));
		assert.ok(messages(inner).includes(`Вложенный запрос «Вл»: «П.Наименованиее»: у «П» (${USERS}) нет поля «Наименованиее».`), JSON.stringify(inner));
		// У справочника пользователей в БСП нет кода: «П.Код» — настоящая ошибка, а не шум
		assert.ok(messages(problemsOf(batch.replace('П.Наименование КАК Код', 'П.Код КАК Код'))).includes(`Вложенный запрос «Вл»: «П.Код»: у «П» (${USERS}) нет поля «Код».`));
		// Вложенный конструктор: ВТ внешнего пакета видны через outerTemp
		const outer = parsed(batch);
		const sub = E.subModel(outer, parsed('ВЫБРАТЬ\n\tВТ.Имяя КАК Имя\nИЗ\n\tВТ_Пользователи КАК ВТ').statements[0]);
		const temps = Q.tempTables(outer, 1).map((table) => ({ ...table, batch: outer }));
		assert.deepEqual(messages(E.nameProblems(sub, envOf(live, { outerTemp: temps }))), ['«ВТ.Имяя»: у «ВТ» (временная таблица ВТ_Пользователи) нет поля «Имяя».']);
		assert.deepEqual(E.nameProblems(sub, envOf()), [], 'без outerTemp ВТ — внешние данные, молчим');
	});

	test('таблицы вне описания, ТЧ через точку, Константы, ХАРАКТЕРИСТИКИ, вложенный ВЫБРАТЬ в условии и параметры ВТ', () => {
		// Таблица изменений и подчинённые таблицы регистра расчёта описание не перечисляет — не опечатка
		assert.deepEqual(problemsOf(`ВЫБРАТЬ\n\tИ.Ссылка КАК Ссылка\nИЗ\n\t${USERS}.Изменения КАК И`), []);
		// Табличная часть через точку от основной таблицы (`Д.Товары.Номенклатура`)
		assert.deepEqual(problemsOf('ВЫБРАТЬ\n\tД.Товары.Номенклатура КАК Н\nИЗ\n\tДокумент._ДемоСчетНаОплатуПокупателю КАК Д'), []);
		// Общая таблица констант: поля — по описанию обвязки (из дерева), без него — молча
		const constants = (): { state: string; table: DescribedTable } => ({
			state: 'ready',
			table: { name: 'Константы', kind: 'main', params: [], fields: [{ name: 'ВалютаУчета', nameEn: 'ВалютаУчета', synonym: '', type: null }] },
		});
		const constantsText = 'ВЫБРАТЬ\n\tК.ВалютаУчета КАК В,\n\tК.ВалютаУчетаа КАК Х\nИЗ\n\tКонстанты КАК К';
		assert.deepEqual(messages(problemsOf(constantsText, live, { constants })), ['«К.ВалютаУчетаа»: у «К» (Константы) нет поля «ВалютаУчетаа».']);
		assert.deepEqual(problemsOf(constantsText), []);
		// {ХАРАКТЕРИСТИКИ}: поля характеристик динамические — запрос не проверяется
		const characteristics = Q.parse(
			`ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка,\n\tП.НетТакогоПоля КАК Х\nИЗ\n\t${USERS} КАК П\n{ХАРАКТЕРИСТИКИ\n\tТИП(Справочник.Пользователи)\n\tВИДЫХАРАКТЕРИСТИК ПланВидовХарактеристик.ДополнительныеРеквизитыИСведения\n\tПОЛЕКЛЮЧА Ссылка\n\tПОЛЕИМЕНИ Наименование\n\tПОЛЕТИПАЗНАЧЕНИЯ ТипЗначения}`
		);
		assert.deepEqual(characteristics.diagnostics, []);
		assert.equal(E.characteristicsTexts(characteristics.model.statements[0]).length, 1);
		assert.deepEqual(E.nameProblems(characteristics.model, envOf()), []);
		// Вложенный ВЫБРАТЬ в условии: у подзапроса свои алиасы — выражение целиком мимо
		assert.deepEqual(problemsOf(`ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка\nИЗ\n\t${USERS} КАК П\nГДЕ\n\tП.Ссылка В\n\t\t(ВЫБРАТЬ\n\t\t\tХ.Опечаткаа\n\t\tИЗ\n\t\t\tСправочник.Чужой КАК Х)`), []);
		// Параметры ВТ: свои поля без алиаса (Номенклатура.Родитель) молчат, путь от алиаса другой таблицы — проверяется
		const vt = `ВЫБРАТЬ\n\tО.КоличествоОстаток КАК К\nИЗ\n\t${STOCK}.Остатки(, Номенклатура.Родитель = &Р И П.Наименованиее = &Имя) КАК О,\n\t${USERS} КАК П`;
		assert.deepEqual(messages(problemsOf(vt)), [`«П.Наименованиее»: у «П» (${USERS}) нет поля «Наименованиее».`]);
	});

	test('группировка, порядок, условия соединения и {ГДЕ}; одна опечатка в нескольких местах — одно предупреждение; части объединения — свои', () => {
		const text = [
			'ВЫБРАТЬ',
			'\tП.Наименованиее КАК Имя,',
			'\tКОЛИЧЕСТВО(Ф.Ссылка) КАК Число',
			'ИЗ',
			`\t${USERS} КАК П`,
			'\t\tЛЕВОЕ СОЕДИНЕНИЕ Справочник._ДемоФизическиеЛица КАК Ф',
			'\t\tПО П.ФизическоеЛицо = Ф.Ссылкаа',
			'{ГДЕ',
			'\tФ.Иннн.*}',
			'СГРУППИРОВАТЬ ПО',
			'\tП.Наименованиее',
			'УПОРЯДОЧИТЬ ПО',
			'\tП.Наименованиее,',
			'\tИмя',
		].join('\n');
		assert.deepEqual(messages(problemsOf(text)), [
			`«П.Наименованиее»: у «П» (${USERS}) нет поля «Наименованиее».`,
			'«Ф.Иннн»: у «Ф» (Справочник._ДемоФизическиеЛица) нет поля «Иннн».',
			'«Ф.Ссылкаа»: у «Ф» (Справочник._ДемоФизическиеЛица) нет поля «Ссылкаа».',
		]);
		const union = `ВЫБРАТЬ\n\tП.Ссылка КАК Ссылка\nИЗ\n\t${USERS} КАК П\n\nОБЪЕДИНИТЬ ВСЕ\n\nВЫБРАТЬ\n\tФ.Ссылкаа\nИЗ\n\tСправочник._ДемоФизическиеЛица КАК Ф`;
		assert.deepEqual(
			problemsOf(union).map((item) => [item.statement, item.part, item.text]),
			[[0, 1, 'Ф.Ссылкаа']]
		);
	});

	test('английский текст: английские имена стандартных реквизитов и поле «Order» не путаются с ключевыми словами; русское имя у английского описания и чужой язык хвоста — молча', () => {
		const english: Answer = {
			object: 'Catalog.Валюты',
			tables: [
				{
					name: 'Catalog.Валюты',
					kind: 'main',
					params: [],
					fields: [
						{ name: 'Ref', nameEn: 'Ref', synonym: '', type: null },
						{ name: 'Description', nameEn: 'Description', synonym: '', type: null },
						{ name: 'Order', nameEn: 'Order', synonym: '', type: null },
						{ name: 'Курс', nameEn: 'Курс', synonym: '', type: null },
					],
				},
			],
		};
		const lookup: Lookup = (key) => (key === 'EN:СПРАВОЧНИК.ВАЛЮТЫ' ? english : live(key));
		const text = 'SELECT\n\tT.Ref AS Ref,\n\tT.Order AS O,\n\tT.Descriptionn AS D,\n\tT.Наименование AS N,\n\tT.Курс AS K\nFROM\n\tCatalog.Валюты AS T\nWHERE\n\tT.Ref = VALUE(Catalog.Валюты.EmptyRef)';
		assert.deepEqual(messages(problemsOf(text, lookup)), ['«T.Descriptionn»: у «T» (Catalog.Валюты) нет поля «Descriptionn».']);
		// Русский вид таблицы с английскими именами стандартных реквизитов: у русского описания они есть (nameEn)
		assert.deepEqual(problemsOf(`SELECT\n\tU.Ref AS Ref,\n\tU.Description AS D\nFROM\n\t${USERS} AS U`), []);
		// Хвост на другом языке, чем описание (`РегистрНакопления.X.Balance`), — не утверждаем
		assert.deepEqual(problemsOf(`ВЫБРАТЬ\n\tО.Номенклатура КАК Н\nИЗ\n\t${STOCK}.Balance КАК О`), []);
	});

	test('общие реквизиты выгрузки: поле таблицы конфигурации и реквизит ссылки с таким именем — молча; у ВТ пакета и вложенного запроса — как обычное поле', () => {
		const common = ['ОбластьДанныхВспомогательныеДанные', 'ОбластьДанныхОсновныеДанные'];
		const text = [
			'ВЫБРАТЬ',
			'\tП.ОбластьДанныхВспомогательныеДанные КАК Область,',
			'\tП.ФизическоеЛицо.ОбластьДанныхОсновныеДанные КАК ОбластьФЛ,',
			'\tВл.ОбластьДанныхОсновныеДанные КАК Чужое',
			'ИЗ',
			`\t${USERS} КАК П,`,
			`\t(ВЫБРАТЬ\n\t\tП2.Ссылка КАК Ссылка\n\tИЗ\n\t\t${USERS} КАК П2) КАК Вл`,
		].join('\n');
		// Описания md-sparrow перечисляют общие реквизиты основных таблиц по составу: разделитель
		// ОбластьДанныхОсновныеДанные у физического лица известен и без имён; ОбластьДанныхВспомогательныеДанные в состав
		// Пользователей не входит. Для таблиц, у которых описание общие реквизиты не перечисляет, есть список имён commonAttributes
		assert.deepEqual(
			problemsOf(text).map((problem) => problem.text),
			['П.ОбластьДанныхВспомогательныеДанные', 'Вл.ОбластьДанныхОсновныеДанные']
		);
		assert.deepEqual(messages(problemsOf(text, live, { commonAttributes: common })), ['«Вл.ОбластьДанныхОсновныеДанные»: у «Вл» (вложенный запрос) нет поля «ОбластьДанныхОсновныеДанные».']);
	});

	test('nameCheckEnv: описание ещё читается — ожидание в pending и молчание; набор, «любая ссылка» и примитив — реквизиты неизвестны; объект без таблицы — none с описанием', () => {
		const pendingEnv = FT.nameCheckEnv(() => undefined, { queryModel: Q });
		assert.deepEqual(E.nameProblems(parsed(`ВЫБРАТЬ\n\tП.Наименованиее КАК Н\nИЗ\n\t${USERS} КАК П`), pendingEnv), []);
		assert.deepEqual(
			pendingEnv.pending.map((item) => item.key),
			['СПРАВОЧНИК.ПОЛЬЗОВАТЕЛИ']
		);
		const env = envOf();
		const missing = env.describe(`${STOCK}.Остаткии`);
		assert.equal(missing.state, 'none');
		assert.equal(missing.description?.object, STOCK);
		assert.equal(env.describe(`${STOCK}.Остатки`).state, 'ready');
		assert.equal(env.describe('Справочник.НеОписан').description, undefined);
		assert.deepEqual(env.members({ types: [], typeSets: ['cfg:CatalogRef'], typeIds: [] }), { known: false });
		assert.deepEqual(env.members({ types: [], typeSets: ['cfg:AnyRef'], typeIds: [] }), { known: false });
		assert.deepEqual(env.members({ types: ['xs:string'], typeSets: [], typeIds: [] }), { known: false });
		const person = env.members({ types: ['cfg:CatalogRef._ДемоФизическиеЛица'], typeSets: [], typeIds: [] });
		assert.equal(person.known, true);
		assert.ok(person.names?.includes('ИНН') && person.names.includes('Ref') && person.names.includes('КонтактнаяИнформация'), 'поля, английские имена и ТЧ');
		assert.equal(FT.isConstantsTable('Константы'), true);
	});
});

describe('Конструктор запроса: «Параметры виртуальной таблицы…» у основной и виртуальной таблиц', () => {
	/** Ответ cf-md-query-tables из фикстуры: таблица и всё описание объекта, как у api.describeTable. */
	function described(name: string): { state: string; table?: DescribedTable; description?: { tables: DescribedTable[] } } {
		const entry = tables[name.split('.').slice(0, 2).join('.')];
		const table = entry ? entry.description.tables.find((item) => item.name.toUpperCase() === name.toUpperCase()) : undefined;
		return entry && table ? { state: 'ready', table, description: entry.description } : { state: 'none' };
	}
	/** Источник первой таблицы текста — с признаком virtualTable и параметрами, как их разбирает модель. */
	function sourceOf(from: string): { source: Source; alias: string } {
		const model = Q.parse('ВЫБРАТЬ 1 ИЗ ' + from).model;
		const entry = E.sourcesOf(E.partAt(model, A))[0];
		return { source: entry.source, alias: entry.alias };
	}

	test('основная таблица регистра: кнопка недоступна, сообщение называет виртуальные таблицы объекта и его ветку дерева', () => {
		const name = 'РегистрСведений.СогласияНаОбработкуПерсональныхДанных';
		const { source, alias } = sourceOf(name + ' КАК Согласия');
		assert.equal(source.virtualTable, null, 'основная таблица — не виртуальная');
		const info = E.virtualParamsState(source, alias, described(name));
		assert.equal(info.state, 'none');
		assert.equal(info.available, false);
		assert.equal(
			info.note,
			'У основной таблицы «Согласия» параметров нет: они есть у виртуальных таблиц СрезПоследних, СрезПервых. Добавьте нужную из ветки «СогласияНаОбработкуПерсональныхДанных» дерева «База данных» или замените таблицу.'
		);
		// Одна виртуальная таблица — в единственном числе
		const task = E.virtualParamsState(sourceOf('Задача.ЗадачаИсполнителя').source, 'ЗадачаИсполнителя', described('Задача.ЗадачаИсполнителя'));
		assert.equal(
			task.note,
			'У основной таблицы «ЗадачаИсполнителя» параметров нет: они есть у виртуальной таблицы ЗадачиПоИсполнителю. Добавьте её из ветки «ЗадачаИсполнителя» дерева «База данных» или замените таблицу.'
		);
		assert.equal(task.available, false);
		assert.equal(task.spoken, 'у таблицы нет параметров: нажмите, чтобы узнать, где они', 'читалке — короткая причина');
	});

	test('основная таблица последовательности: у Границ параметров нет — совета их добавить нет', () => {
		const name = 'Последовательность._ДемоДвижениеТоваров';
		assert.deepEqual(described(name + '.Границы').table?.params, [], 'у Границ параметров нет (ответ jar)');
		const { source, alias } = sourceOf(name + ' КАК П');
		const info = E.virtualParamsState(source, alias, described(name));
		assert.equal(info.state, 'none');
		assert.equal(info.available, false);
		assert.equal(info.note, 'У таблицы «П» нет параметров.');
		assert.ok(!info.note.includes('Границы') && !info.note.includes('дерева'), info.note);
		assert.equal(info.spoken, 'у таблицы нет параметров', 'нажатие больше ничего не скажет, и читалка не зовёт нажать');
	});

	test('без описания и без выгрузки: у виртуальной таблицы параметры «не известны», общее сообщение не отсылает к дереву', () => {
		const slice = sourceOf('РегистрСведений.СогласияНаОбработкуПерсональныхДанных.СрезПоследних КАК Срез');
		const unknown = E.virtualParamsState(slice.source, slice.alias, { state: 'none' }, { metadata: false });
		assert.equal(unknown.state, 'virtual');
		assert.equal(unknown.available, true);
		assert.equal(unknown.note, 'Параметры таблицы «Срез» не известны: описания объекта нет, впишите их в текст («Запрос…»).');
		// На выгрузке без описания — так же: «нет параметров» было бы неправдой
		assert.equal(E.virtualParamsState(slice.source, slice.alias, { state: 'none' }).note, unknown.note);
		const catalog = sourceOf('Справочник.Пользователи КАК П');
		const plain = E.virtualParamsState(catalog.source, catalog.alias, { state: 'none' }, { metadata: false });
		assert.equal(plain.state, 'none');
		assert.equal(plain.available, false);
		assert.equal(
			plain.note,
			'У таблицы «П» нет параметров: они бывают у виртуальных таблиц регистров (СрезПоследних, Остатки…). Укажите такую таблицу в тексте («Запрос…»).'
		);
		const temp = sourceOf('ВТ_Товары КАК Т');
		assert.ok(!E.virtualParamsState(temp.source, temp.alias, { state: 'none' }, { metadata: false }).note.includes('«База данных»'), 'вне выгрузки в дереве только временные таблицы');
		// С выгрузкой (и без options) — отсылка к значку «ВТ»
		assert.match(E.virtualParamsState(catalog.source, catalog.alias, { state: 'none' }, { metadata: true }).note, /значок «ВТ» в дереве «База данных»/);
	});

	test('виртуальная таблица: окно открывается по описанию и по параметрам текста; Границы последовательности — доступны, «нет параметров»', () => {
		const slice = 'РегистрСведений.СогласияНаОбработкуПерсональныхДанных.СрезПоследних';
		const bare = sourceOf(slice + ' КАК Срез');
		assert.equal(bare.source.virtualTable, 'СрезПоследних');
		const open = E.virtualParamsState(bare.source, bare.alias, described(slice));
		assert.equal(open.state, 'open');
		assert.equal(open.available, true);
		assert.deepEqual(
			open.params.map((param) => param.name),
			['Период', 'Условие']
		);
		assert.equal(open.note, '');
		const withText = sourceOf(slice + '(&Дата, ) КАК Срез');
		assert.deepEqual(E.virtualParamsState(withText.source, withText.alias, described(slice)).current, ['&Дата', '']);
		// Без описания позиции текста всё равно открывают окно («Параметр N»)
		const old = E.virtualParamsState(withText.source, withText.alias, { state: 'none' });
		assert.equal(old.state, 'open');
		assert.deepEqual(old.params, []);
		const bounds = 'Последовательность._ДемоДвижениеТоваров.Границы';
		const boundary = sourceOf(bounds + ' КАК Г');
		const info = E.virtualParamsState(boundary.source, boundary.alias, described(bounds));
		assert.equal(info.state, 'virtual');
		assert.equal(info.available, true, 'у виртуальной таблицы кнопка доступна, даже без параметров');
		assert.equal(info.note, 'У таблицы «Г» нет параметров.');
		// Критерий отбора: параметр у основной таблицы
		const criterion = sourceOf('КритерийОтбора.СвязанныеДокументы(&Значение) КАК К');
		assert.equal(E.virtualParamsState(criterion.source, criterion.alias, described('КритерийОтбора.СвязанныеДокументы')).state, 'open');
	});

	test('таблица без виртуальных соседей, временная таблица, выбор не таблицы и описание в пути', () => {
		const catalog = sourceOf('Справочник.Пользователи КАК П');
		const plain = E.virtualParamsState(catalog.source, catalog.alias, described('Справочник.Пользователи'));
		assert.equal(plain.state, 'none');
		assert.equal(plain.available, false);
		assert.equal(plain.note, 'У таблицы «П» нет параметров: они бывают у виртуальных таблиц (значок «ВТ» в дереве «База данных»).');
		const temp = sourceOf('ВТ_Товары КАК Т');
		assert.equal(E.virtualParamsState(temp.source, temp.alias, { state: 'none' }).state, 'none', 'временная таблица пакета');
		const pick = E.virtualParamsState(null, '', { state: 'none' });
		assert.equal(pick.state, 'pick');
		assert.equal(pick.available, false);
		assert.equal(pick.note, 'Выберите виртуальную таблицу в списке «Таблицы».');
		assert.equal(pick.spoken, 'таблица не выбрана');
		const nested = sourceOf('(ВЫБРАТЬ 1 КАК Х) КАК Вложенный');
		assert.equal(E.virtualParamsState(nested.source, nested.alias, { state: 'none' }).state, 'pick', 'вложенный запрос');
		// Описание читается: основная таблица по имени — недоступна до ответа, виртуальная и таблица с параметрами текста — доступны
		const loading = { state: 'loading' };
		const main = E.virtualParamsState(sourceOf('РегистрНакопления._ДемоОстаткиТоваровВМестахХранения КАК Р').source, 'Р', loading);
		// Недоступной кнопке «через мгновение» не обещаем: основная таблица и с описанием останется без параметров
		assert.deepEqual([main.state, main.available, main.note, main.spoken], ['loading', false, 'Описание таблицы загружается.', 'описание таблицы загружается']);
		const rests = E.virtualParamsState(sourceOf('РегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Остатки КАК Р').source, 'Р', loading);
		assert.deepEqual([rests.available, rests.note, rests.spoken], [true, 'Описание таблицы загружается: откройте параметры через мгновение.', '']);
		assert.equal(E.virtualParamsState(sourceOf('КритерийОтбора.СвязанныеДокументы(&Значение) КАК К').source, 'К', loading).available, true);
	});
});

describe('Конструктор запроса: поля «Условия» виртуальной таблицы по виду таблицы', () => {
	/** Вид объекта и виртуальная таблица из ответа md-sparrow (фикстура), как их видит окно параметров. */
	function vt(name: string): { kind: string; table: DescribedTable } {
		const entry = tables[name.split('.').slice(0, 2).join('.')];
		assert.ok(entry, 'нет объекта ' + name);
		const table = entry.description.tables.find((item) => item.name === name);
		assert.ok(table, 'нет таблицы ' + name);
		return { kind: entry.description.kind || '', table };
	}
	const names = (fields: DescribedField[]): string[] => fields.map((field) => field.name);
	/** Поля, о которых правило не знает ничего: ни в дереве, ни в предупреждении. */
	const unsure = (kind: string, table: DescribedTable): string[] => table.fields.filter((field) => E.vtConditionAccess(kind, table.name, field) === 'unsure').map((field) => field.name);
	const ACCUMULATION = 'РегистрНакопления._ДемоОстаткиТоваровВМестахХранения';
	const ACCOUNTING = 'РегистрБухгалтерии._ДемоЖурналПроводокБухгалтерскогоУчета';

	test('регистр накопления: в Остатках, Оборотах и ОстаткахИОборотах — измерения и разделители, по имени; ресурсы, периоды, регистратор — нельзя', () => {
		for (const tail of ['Остатки', 'Обороты', 'ОстаткиИОбороты']) {
			const { kind, table } = vt(ACCUMULATION + '.' + tail);
			assert.equal(kind, 'accumulationRegister');
			const rule = E.vtConditionFields(kind, table);
			assert.equal(rule.rule, 'dimensions', tail);
			// В описании порядок другой (Номенклатура, МестоХранения, Организация, разделитель): конфигуратор упорядочивает по имени
			assert.deepEqual(names(rule.allowed), ['МестоХранения', 'Номенклатура', 'ОбластьДанныхОсновныеДанные', 'Организация'], tail);
			assert.equal(rule.allowed.find((field) => field.name === 'ОбластьДанныхОсновныеДанные')?.kind, 'separator', tail);
			assert.deepEqual(unsure(kind, table), [], tail + ': у регистра накопления сомнительных полей нет');
			assert.equal(rule.allowed.length + rule.denied.length, table.fields.length, tail);
		}
		const turnovers = vt(ACCUMULATION + '.Обороты');
		const denied = names(E.vtConditionFields(turnovers.kind, turnovers.table).denied);
		for (const name of ['КоличествоОборот', 'КоличествоПриход', 'КоличествоРасход', 'НомерСтроки', 'Регистратор', 'Период', 'ПериодМесяц', 'ПериодГод']) {
			assert.ok(denied.includes(name), name + ' в условии Оборотов допустим');
		}
		// Правило — по виду поля, а не по имени: любое измерение и разделитель — можно; ресурс, стандартное поле, период,
		// реквизит и общий реквизит не разделитель — нельзя
		const field = (kind: string) => ({ name: 'Х', nameEn: 'X', kind });
		assert.deepEqual(
			['dimension', 'separator', 'resource', 'standard', 'period', 'attribute', 'commonAttribute', 'новыйВид'].map((kind) => E.vtConditionAccess('accumulationRegister', 'Обороты', field(kind))),
			['allowed', 'allowed', 'denied', 'denied', 'denied', 'denied', 'denied', 'unsure']
		);
		// Английский текст: таблица `AccumulationRegister.X.Turnovers` (описание на en)
		const english = Object.assign({}, turnovers.table, { name: 'AccumulationRegister._ДемоОстаткиТоваровВМестахХранения.Turnovers' });
		assert.deepEqual(names(E.vtConditionFields('accumulationRegister', english).allowed), ['МестоХранения', 'Номенклатура', 'ОбластьДанныхОсновныеДанные', 'Организация']);
		assert.equal(E.vtConditionFields('accumulationRegister', Object.assign({}, english, { name: 'AccumulationRegister.X.BalanceAndTurnovers' })).rule, 'dimensions');
	});

	test('регистр бухгалтерии: в остатках и оборотах — измерения (и Кор, Дт, Кт), субконто, корреспондирующие субконто и разделители, как у конфигуратора; счета — не судятся; ДвиженияССубконто — любые поля', () => {
		const balance = vt(ACCOUNTING + '.Остатки');
		assert.equal(balance.kind, 'accountingRegister');
		const rests = E.vtConditionFields(balance.kind, balance.table);
		assert.equal(rests.rule, 'dimensionsSubconto');
		assert.deepEqual(names(rests.allowed), ['Валюта', 'ОбластьДанныхОсновныеДанные', 'Организация', 'Субконто1', 'Субконто2', 'Субконто3']);
		assert.deepEqual(unsure(balance.kind, balance.table), ['Счет'], 'у счёта свои параметры УсловиеСчета: в дереве и в предупреждении его нет');
		assert.ok(names(rests.denied).includes('СуммаОстаток') && names(rests.denied).includes('КоличествоРазвернутыйОстатокДт'), 'ресурсы — нельзя');
		// Хозрасчетный.Обороты у конфигуратора: все измерения, XКор небалансовых, Субконто1..N, КорСубконто1..N,
		// разделитель — по имени; счетов, ресурсов, периода и регистратора нет
		const turnovers = vt(ACCOUNTING + '.Обороты');
		const turns = E.vtConditionFields(turnovers.kind, turnovers.table);
		assert.deepEqual(names(turns.allowed), [
			'Валюта',
			'ВалютаКор',
			'КорСубконто1',
			'КорСубконто2',
			'КорСубконто3',
			'ОбластьДанныхОсновныеДанные',
			'Организация',
			'Субконто1',
			'Субконто2',
			'Субконто3',
		]);
		assert.deepEqual(unsure(turnovers.kind, turnovers.table), ['Счет', 'КорСчет']);
		for (const name of ['НомерСтроки', 'Регистратор', 'Период', 'ПериодДень', 'СуммаОборот', 'ВалютнаяСуммаКорОборот']) {
			assert.ok(names(turns.denied).includes(name), name);
		}
		const drcr = vt(ACCOUNTING + '.ОборотыДтКт');
		const sides = E.vtConditionFields(drcr.kind, drcr.table);
		assert.equal(sides.rule, 'dimensionsSubconto');
		assert.deepEqual(names(sides.allowed), ['ВалютаДт', 'ВалютаКт', 'ОбластьДанныхОсновныеДанные', 'Организация', 'СубконтоДт1', 'СубконтоДт2', 'СубконтоДт3', 'СубконтоКт1', 'СубконтоКт2', 'СубконтоКт3']);
		assert.deepEqual(unsure(drcr.kind, drcr.table), ['СчетДт', 'СчетКт']);
		assert.equal(E.vtConditionFields(drcr.kind, drcr.table).denied.every((field) => !/^Субконто/.test(field.name)), true);
		const both = vt(ACCOUNTING + '.ОстаткиИОбороты');
		assert.deepEqual(names(E.vtConditionFields(both.kind, both.table).allowed), ['Валюта', 'ОбластьДанныхОсновныеДанные', 'Организация', 'Субконто1', 'Субконто2', 'Субконто3']);
		assert.equal(E.vtConditionAccess('accountingRegister', 'Turnovers', { name: 'X', nameEn: 'BalancedExtDimension1', kind: 'standard' }), 'allowed');
		assert.equal(E.vtConditionAccess('accountingRegister', 'Turnovers', { name: 'X', nameEn: 'BalancedAccount', kind: 'standard' }), 'unsure');
		assert.equal(E.vtConditionAccess('accountingRegister', 'DrCrTurnovers', { name: 'X', nameEn: 'ExtDimensionCr1', kind: 'standard' }), 'allowed');
		// Уточнение периода (у регистра с длиной уточнения больше 0): в оборотах — поле периода, нельзя
		assert.equal(E.vtConditionAccess('accountingRegister', 'Обороты', { name: 'УточнениеПериода', nameEn: 'PeriodAdjustment', kind: 'period' }), 'denied');
		// ДвиженияССубконто: любое поле таблицы, без отказов
		const records = vt(ACCOUNTING + '.ДвиженияССубконто');
		const all = E.vtConditionFields(records.kind, records.table);
		assert.equal(all.rule, 'all');
		assert.equal(all.allowed.length, records.table.fields.length);
		assert.deepEqual(all.denied, []);
	});

	test('срезы регистра сведений, задача, регистр расчёта и неизвестные таблицы — любые поля, по имени', () => {
		const slice = vt('РегистрСведений.СогласияНаОбработкуПерсональныхДанных.СрезПоследних');
		const rule = E.vtConditionFields(slice.kind, slice.table);
		assert.equal(rule.rule, 'all');
		assert.deepEqual(names(rule.allowed), ['Активность', 'Действует', 'НомерСтроки', 'ОбластьДанныхОсновныеДанные', 'Организация', 'Период', 'Регистратор', 'СрокДействия', 'Субъект'], 'ресурсы, стандартные поля и разделитель среза — можно');
		assert.deepEqual(rule.denied, []);
		const task = vt('Задача.ЗадачаИсполнителя.ЗадачиПоИсполнителю');
		assert.equal(E.vtConditionFields(task.kind, task.table).allowed.length, task.table.fields.length, 'задача: поля задачи');
		const actual = { name: 'РегистрРасчета.Начисления.ФактическийПериодДействия', kind: 'virtual', params: [], fields: [{ name: 'Регистратор', nameEn: 'Recorder', synonym: '', type: null, kind: 'standard' }, { name: 'Результат', nameEn: 'Результат', synonym: '', type: null, kind: 'resource' }] };
		assert.deepEqual(names(E.vtConditionFields('calculationRegister', actual).allowed), ['Регистратор', 'Результат']);
		assert.deepEqual(names(E.vtConditionFields('', actual).allowed), ['Регистратор', 'Результат'], 'без описания вида — все поля');
		assert.deepEqual(E.vtConditionFields('accumulationRegister', null), { rule: 'all', allowed: [], denied: [] });
	});

	test('предупреждение: поле вне допустимых, которое условие уже пишет, — по имени описания, без повторов; параметры, строки и чужие имена — мимо', () => {
		const { kind, table } = vt(ACCUMULATION + '.Обороты');
		const warn = (texts: string | string[]) => E.vtConditionWarning(kind, table, texts);
		assert.deepEqual(warn('Номенклатура = &Номенклатура И МестоХранения В (&Склады)'), { names: [], message: '' });
		assert.deepEqual(warn('КоличествоОборот > 0 И Номенклатура = &Н И Регистратор ССЫЛКА Документ._ДемоПоступление И КоличествоОборот < 10'), {
			names: ['КоличествоОборот', 'Регистратор'],
			message: 'В условии этой таблицы можно использовать только измерения и разделители: «КоличествоОборот», «Регистратор» не подойдут.',
		});
		assert.equal(warn('Период >= &Начало').message, 'В условии этой таблицы можно использовать только измерения и разделители: «Период» не подойдёт.');
		// Разделители в тексте — только если они у таблицы есть (конфигурация без разделения данных)
		const bare = Object.assign({}, table, { fields: table.fields.filter((item) => item.kind !== 'separator') });
		assert.equal(E.vtConditionWarning(kind, bare, 'Период >= &Начало').message, 'В условии этой таблицы можно использовать только измерения: «Период» не подойдёт.');
		// Английское имя поля — тем же полем, в написании описания
		assert.deepEqual(warn('КоличествоTurnover > 0').names, ['КоличествоОборот']);
		assert.deepEqual(warn('Номенклатура.Родитель = &Группа И Номенклатура.Наименование ПОДОБНО "КоличествоОборот%"').names, [], 'путь от измерения и строка');
		assert.deepEqual(warn('&КоличествоОборот = 1 И Номенклатура В ИЕРАРХИИ (&Регистратор)').names, [], '&-параметры');
		assert.deepEqual(warn('ОбластьДанныхОсновныеДанные = 0 И Неизвестное = 1').names, [], 'разделитель — можно, неизвестное имя — не дело этого правила');
		assert.deepEqual(warn('Номенклатура В (ВЫБРАТЬ Т.Ссылка ИЗ Справочник.Х КАК Т ГДЕ Т.КоличествоОборот > 0)').names, [], 'вложенный запрос не судится');
		// Окно для СКД: значение, блок и поля-отборы — отдельными текстами, повторы — одним
		assert.deepEqual(warn(['Регистратор = &Р', '(КоличествоОборот).*', 'Регистратор']).names, ['Регистратор', 'КоличествоОборот']);
		// Регистр бухгалтерии: счёт не судится (не известно), ресурс — с другим перечнем
		const balance = vt(ACCOUNTING + '.Остатки');
		assert.equal(E.vtConditionWarning(balance.kind, balance.table, 'Счет В ИЕРАРХИИ (&Счет) И Субконто1 = &С').message, '');
		const turnovers = vt(ACCOUNTING + '.Обороты');
		assert.equal(E.vtConditionWarning(turnovers.kind, turnovers.table, 'КорСубконто1 = &К И ВалютаКор = &В И КорСчет = &С И ОбластьДанныхОсновныеДанные = 0').message, '', 'корреспонденция и разделитель');
		assert.equal(
			E.vtConditionWarning(turnovers.kind, turnovers.table, 'СуммаКорОборот > 0 И Регистратор = &Р').message,
			'В условии этой таблицы можно использовать только измерения, субконто и разделители: «Регистратор» не подойдёт.',
			'«СуммаКорОборот» у таблицы нет (Сумма — балансовый ресурс): имя — не дело правила'
		);
		assert.equal(
			E.vtConditionWarning(balance.kind, balance.table, 'СуммаОстаток > 0').message,
			'В условии этой таблицы можно использовать только измерения, субконто и разделители: «СуммаОстаток» не подойдёт.'
		);
		const slice = vt('РегистрСведений.СогласияНаОбработкуПерсональныхДанных.СрезПоследних');
		assert.equal(E.vtConditionWarning(slice.kind, slice.table, 'Действует = ИСТИНА И Регистратор = &Р').message, '', 'у среза — любые поля');
	});

	test('решение окна параметров несёт вид объекта описания: по нему окно выбирает поля условия', () => {
		const name = ACCUMULATION + '.Обороты';
		const source = E.sourcesOf(E.partAt(Q.parse('ВЫБРАТЬ 1 ИЗ ' + name + '(, , , ) КАК Р').model, A))[0].source;
		const entry = tables[ACCUMULATION];
		const table = entry.description.tables.find((item) => item.name === name);
		assert.equal(E.virtualParamsState(source, 'Р', { state: 'ready', table, description: entry.description }).objectKind, 'accumulationRegister');
		assert.equal(E.virtualParamsState(source, 'Р', { state: 'loading' }).objectKind, '');
		assert.equal(E.virtualParamsState(source, 'Р', { state: 'none' }).objectKind, '');
	});
});

describe('Конструктор запроса: значения параметров виртуальной таблицы — поле со списком параметров запроса', () => {
	/** Все параметры виртуальных таблиц фикстуры: имя таблицы → [имя:вид → чем правится]. */
	function inputs(): Map<string, string> {
		const out = new Map<string, string>();
		for (const entry of Object.values(tables)) {
			for (const table of entry.description.tables) {
				for (const param of table.params || []) {
					out.set(param.name + ':' + param.kind, E.vtParamInput(param));
				}
			}
		}
		return out;
	}

	test('чем правится позиция: значения периода, критерия, исполнителя, «Первые» и виды субконто — поле со списком; списки — список, условие — окно условия; условие на счёт — своё окно; порядок — текст', () => {
		const seen = inputs();
		const expect: Record<string, string> = {
			'Период:period': 'value',
			'НачалоПериода:periodStart': 'value',
			'КонецПериода:periodEnd': 'value',
			'Значение:value': 'value',
			'Исполнитель:performer': 'value',
			'Первые:top': 'value',
			'Периодичность:periodicity': 'list',
			'МетодДополнения:method': 'list',
			'Условие:condition': 'condition',
			// Условие на счёт — окно выражения своего поля счёта, как у конфигуратора
			'УсловиеСчета:account': 'account',
			'УсловиеКорСчета:corAccount': 'account',
			'УсловиеСчетаДт:accountDr': 'account',
			'УсловиеСчетаКт:accountCr': 'account',
			// Вид субконто или их список — значение, а не выражение над полями таблицы
			'Субконто:extDimensions': 'value',
			'КорСубконто:corExtDimensions': 'value',
			'СубконтоДт:extDimensionsDr': 'value',
			'СубконтоКт:extDimensionsCr': 'value',
			'Порядок:order': 'expression',
		};
		for (const [key, want] of Object.entries(expect)) {
			assert.equal(seen.get(key), want, key);
		}
		assert.deepEqual([...seen.keys()].filter((key) => !(key in expect)), [], 'в фикстуре появился параметр, о котором тест не знает');
		// Позиция без описания («Параметр N») и пустой список значений — текст
		assert.equal(E.vtParamInput({ name: 'Параметр 1', kind: '' }), 'expression');
		assert.equal(E.vtParamInput(null), 'expression');
		assert.equal(E.vtParamInput({ name: 'Периодичность', kind: 'periodicity', values: [] }), 'expression');
		assert.equal(E.vtParamInput({ name: 'Х', kind: 'period', values: ['А'] }), 'list', 'список описания главнее вида');
		assert.equal(E.vtParamInput({ name: 'Х', kind: 'toString' }), 'expression', 'вид — не ключ прототипа объекта');
	});

	test('периодичность — список значений описания в его порядке (как у конфигуратора: Период первым, Авто последним); УточнениеПериода — там, где его отдаёт md-sparrow', () => {
		const ACCOUNTING = 'РегистрБухгалтерии._ДемоЖурналПроводокБухгалтерскогоУчета';
		const ORDER = ['Период', 'Запись', 'Регистратор', 'Секунда', 'Минута', 'Час', 'День', 'Неделя', 'Декада', 'Месяц', 'Квартал', 'Полугодие', 'Год', 'Авто'];
		let seen = 0;
		for (const entry of Object.values(tables)) {
			for (const table of entry.description.tables) {
				for (const param of (table.params || []).filter((item) => item.kind === 'periodicity')) {
					seen++;
					// У выгрузки ssl31 длина уточнения периода — 0: УточнениеПериода md-sparrow не отдаёт
					assert.deepEqual(param.values, ORDER, table.name);
					assert.equal(E.vtParamInput(param), 'list', table.name);
				}
			}
		}
		assert.equal(seen, 5, 'периодичность — у трёх таблиц регистра бухгалтерии и двух регистра накопления');
		const turnovers = tables[ACCOUNTING].description.tables.find((item) => item.name === ACCOUNTING + '.Обороты');
		assert.ok(turnovers);
		// Регистр с длиной уточнения больше 0: значение после Регистратор (так отдаёт md-sparrow); новая таблица — Авто
		const refined = turnovers.params.map((param) => (param.kind === 'periodicity' ? { ...param, values: ORDER.slice(0, 3).concat(['УточнениеПериода'], ORDER.slice(3)) } : param));
		assert.equal(E.vtParamInput(refined[2]), 'list');
		assert.deepEqual(E.defaultParamTexts({ ...turnovers, params: refined }), ['', '', 'Авто', '', '', '', '', '']);
	});

	test('параметры, которые уже есть в запросе: весь пакет и блоки {…}, без повторов без учёта регистра, по имени; внешний пакет вложенного запроса', () => {
		const model = Q.parse(
			[
				'ВЫБРАТЬ Т.Ссылка КАК Ссылка ПОМЕСТИТЬ ВТ ИЗ Справочник.Пользователи КАК Т ГДЕ Т.Наименование = &Имя И Т.Ссылка В (&Список)',
				';',
				'ВЫБРАТЬ О.Номенклатура КАК Номенклатура ИЗ РегистрНакопления._ДемоОстаткиТоваровВМестахХранения.Обороты({(&ДатаНачала)}, , , ) КАК О',
				'ГДЕ О.Организация = &организация И О.Номенклатура <> &Организация',
				'{ГДЕ О.МестоХранения = &Склад}',
			].join('\n')
		).model;
		assert.deepEqual(E.usedParameters(model), ['ДатаНачала', 'Имя', 'организация', 'Склад', 'Список'], 'первое написание, по имени');
		assert.deepEqual(E.usedParameters(model, ['Склад', 'Внешний', 'ИМЯ']), ['Внешний', 'ДатаНачала', 'Имя', 'организация', 'Склад', 'Список'], 'внешний пакет — без повторов');
		assert.deepEqual(E.usedParameters(Q.parse('ВЫБРАТЬ 1 КАК Х').model), []);
		// Модель, которая не собирается: только внешний пакет
		assert.deepEqual(E.usedParameters({ statements: [{ type: 'сломан' }] } as unknown as Model, ['Б', 'А']), ['А', 'Б']);
		// Ещё не записанные тексты позиций окна: выражение, блок {…}; без повторов с пакетом, строки и комментарии — мимо
		assert.deepEqual(
			E.usedParameters(model, ['Внешний'], ['ДОБАВИТЬКДАТЕ(&Дата1, ДЕНЬ, 1)', '{(&КонецПериода)}', '&ИМЯ', '"&ВСтроке" // &ВКомментарии', '']),
			['Внешний', 'Дата1', 'ДатаНачала', 'Имя', 'КонецПериода', 'организация', 'Склад', 'Список']
		);
		assert.deepEqual(E.usedParameters({ statements: [{ type: 'сломан' }] } as unknown as Model, [], ['&Б И &А']), ['А', 'Б'], 'модель не собирается — тексты окна остаются');
	});

	test('подсказка условия на счёт — только своё поле счёта; Порядок и позиция без описания — все поля таблицы', () => {
		const ACCOUNTING = 'РегистрБухгалтерии._ДемоЖурналПроводокБухгалтерскогоУчета';
		const tableOf = (tail: string): DescribedTable => {
			const table = tables[ACCOUNTING].description.tables.find((item) => item.name === ACCOUNTING + '.' + tail);
			assert.ok(table, 'нет таблицы ' + tail);
			return table;
		};
		const fieldsFor = (tail: string, kind: string): string[] => E.vtExpressionFields({ name: kind, kind }, tableOf(tail)).map((field) => field.name);
		assert.deepEqual(fieldsFor('Остатки', 'account'), ['Счет']);
		assert.deepEqual(fieldsFor('Обороты', 'account'), ['Счет']);
		assert.deepEqual(fieldsFor('Обороты', 'corAccount'), ['КорСчет']);
		assert.deepEqual(fieldsFor('ОборотыДтКт', 'accountDr'), ['СчетДт']);
		assert.deepEqual(fieldsFor('ОборотыДтКт', 'accountCr'), ['СчетКт']);
		// Порядок ДвиженияССубконто и позиция без описания — все поля таблицы
		const records = tableOf('ДвиженияССубконто');
		assert.equal(E.vtExpressionFields({ name: 'Порядок', kind: 'order' }, records).length, records.fields.length);
		assert.equal(E.vtExpressionFields(null, records).length, records.fields.length);
		// Поля счёта у таблицы нет — все поля, а не пустая подсказка
		const bare: DescribedTable = { name: 'Т', kind: 'virtual', params: [], fields: [{ name: 'Счет', nameEn: '', synonym: '', type: null }, { name: 'Сумма', nameEn: '', synonym: '', type: null }] };
		assert.deepEqual(E.vtExpressionFields({ kind: 'accountDr' }, bare).map((field) => field.name), ['Счет', 'Сумма']);
		assert.deepEqual(E.vtExpressionFields({ kind: 'account' }, null), []);
	});
});
