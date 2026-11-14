/**
 * Автодополнение редактора СКД: чистые функции dcs-editor-complete.js и их сверка с подсветкой.
 *
 * Файлы webview исполняются в песочнице node:vm, как в dcsHighlight.node.ts: тесты гоняют ровно
 * тот код, который работает в редакторе. Модели схем — замороженные ответы cf-dcs-info из
 * src/test/fixtures/dcs/complete-models.json (см. README фикстур).
 * Запуск: npm run compile && node --test out/test/metadata/dcsComplete.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { readEditorScript } from '../fixtures/helpers/dcsEditorScript';

interface Restriction {
	field: boolean;
	condition: boolean;
	group: boolean;
	order: boolean;
}

interface CatalogNode {
	name: string;
	path: string;
	kind: string;
	title: string;
	typeText: string;
	children: CatalogNode[];
	restrict: Restriction | null;
	attributeRestrict: Restriction | null;
	priority: number;
	bare?: boolean;
	group?: string;
	valueType?: unknown;
}

interface Catalog {
	nodes: CatalogNode[];
	params: CatalogNode[];
	functions: CatalogNode[];
	section: string;
	paramsAtRoot: boolean;
}

interface CompletionContext {
	mode: 'path' | 'param' | 'none';
	parentPath: string;
	prefix: string;
	replaceStart: number;
	replaceEnd: number;
}

interface Ranked {
	item: CatalogNode;
	group: number;
	match: { on: 'name' | 'title'; start: number; end: number } | null;
}

interface FunctionEntry {
	name: string;
	nameEn: string;
	group: string;
}

type NodeSpec = Partial<CatalogNode> & { path: string };
type ExtraChildren = (owner: CatalogNode | null, parentPath: string) => Array<Partial<CatalogNode>>;

interface CompleteApi {
	FUNCTION_GROUPS: Record<string, string>;
	QUERY_FUNCTIONS: FunctionEntry[];
	DCS_FUNCTIONS: FunctionEntry[];
	KIND_LABELS: Record<string, { letter: string; word: string }>;
	POPUP_MARGIN: number;
	compactType(valueType: unknown): string;
	functionNodes(which: 'dcs' | 'query', lang?: 'ru' | 'en'): NodeSpec[];
	catalogFromNodes(nodes: NodeSpec[], options?: { section?: string; paramsAtRoot?: boolean }): Catalog;
	buildCatalog(model: unknown, settings: unknown, scope: string, options?: { typeText?: (valueType: unknown) => string }): Catalog;
	childrenOf(catalog: Catalog, ctx: Partial<CompletionContext> | string, extraChildren?: ExtraChildren): CatalogNode[];
	contextAt(text: string, caret: number): CompletionContext;
	rank(items: Array<Partial<CatalogNode>>, prefix: string): Ranked[];
	applyItem(text: string, ctx: CompletionContext, item: Partial<CatalogNode>): { text: string; caret: number };
	itemLabel(item: Partial<CatalogNode>): string;
	placePopup(
		anchor: { left: number; top: number; bottom: number },
		size: { width: number; height: number },
		viewport: { width: number; height: number }
	): { left: number; top: number; above: boolean; maxHeight: number };
	PAGE_STEP: number;
	MAX_ROWS: number;
	inputAction(open: boolean, typed: string, ctx: Partial<CompletionContext> | null, options?: { letters?: boolean }): string;
	nextActive(index: number, count: number, key: string): number;
	windowStart(active: number, start: number, count: number, size?: number): number;
	bestIndex(ranked: Ranked[], prefix: string): number;
	splitMatch(text: string, start: number, end: number): Array<{ text: string; hit: boolean }>;
	kindLetter(item: Partial<CatalogNode>): string;
	rowParts(entry: { item: Partial<CatalogNode>; group?: number; match?: Ranked['match'] }): {
		letter: string;
		name: Array<{ text: string; hit: boolean }>;
		title: Array<{ text: string; hit: boolean }>;
		typeText: string;
	};
	listSummary(count: number): string;
	windowNote(start: number, end: number, count: number): string;
}

interface HighlightApi {
	FUNCTION_NAMES: string[];
	tokenize(text: string): Array<{ type: string; value: string }>;
}

interface SchemaFixture {
	template: string;
	info: {
		dataSets: unknown[];
		calculatedFields: Array<{ name: string }>;
		parameters: Array<{ name: string; availableAsField?: boolean }>;
	};
	variant?: string;
	settings?: { userFields?: Array<{ dataPath: string; title?: string }> };
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'resources', 'webview');
const FIXTURE = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs', 'complete-models.json');

/**
 * Исполняет файл webview в текущем realm и возвращает его module.exports.
 *
 * Обёртка-функция вместо нового контекста vm: объекты из чужого realm не проходят
 * deepStrictEqual (другой Object.prototype). Параметр window подменяет глобал webview.
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

const api = loadModule<CompleteApi>(path.join(WEBVIEW, 'dcs-editor-complete.js'));
const highlight = loadModule<HighlightApi>(path.join(WEBVIEW, 'dcs-editor-highlight.js'));
const schemas = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, SchemaFixture>;

const CHECKS = schemas['РезультатыПроверкиУчета'];
const UNIONS = schemas['ВыгрузкаЗагрузкаEnterpriseData'];
const FOLDER = schemas['ДанныеПечатиОбщиеРеквизиты'];
const USERS = schemas['ПользователиПоПодразделениям'];

function names(nodes: Array<{ name: string }>): string[] {
	return nodes.map((node) => node.name);
}

function rootNode(catalog: Catalog, name: string): CatalogNode | undefined {
	return catalog.nodes.find((node) => node.name === name);
}

/** Контекст в конце текста или на месте маркера «|» (маркер из текста убирается). */
function at(textWithCaret: string): { text: string; ctx: CompletionContext } {
	const caret = textWithCaret.indexOf('|');
	const text = caret < 0 ? textWithCaret : textWithCaret.slice(0, caret) + textWithCaret.slice(caret + 1);
	return { text, ctx: api.contextAt(text, caret < 0 ? text.length : caret) };
}

describe('Каталог подсказки: фикстура моделей', () => {
	test('в фикстуре четыре схемы с тем, что проверяет каталог', () => {
		assert.deepEqual(Object.keys(schemas).sort(), [
			'ВыгрузкаЗагрузкаEnterpriseData',
			'ДанныеПечатиОбщиеРеквизиты',
			'ПользователиПоПодразделениям',
			'РезультатыПроверкиУчета',
		]);
		assert.ok(USERS.settings && Array.isArray(USERS.settings.userFields), 'нет пользовательских полей варианта');
		// Параметры без ключа availableAsField: md-sparrow не пишет умолчание true
		assert.ok(USERS.info.parameters.every((param) => !('availableAsField' in param)), 'у параметров появился ключ');
		assert.ok(CHECKS.info.parameters.some((param) => param.availableAsField === false), 'нет параметров с false');
	});
});

describe('Каталог подсказки: поля наборов', () => {
	test('папка — узел с заголовком, пути через точку — её дети', () => {
		// В группировках системных полей нет: на верхнем уровне только поля набора
		const catalog = api.buildCatalog(FOLDER.info, null, 'settings:group');
		assert.deepEqual(names(catalog.nodes), ['ОбщиеРеквизиты', 'Ссылка']);
		const folder = rootNode(catalog, 'ОбщиеРеквизиты');
		assert.equal(folder?.kind, 'folder');
		assert.equal(folder?.title, 'Общие реквизиты');
		const children = api.childrenOf(catalog, 'ОбщиеРеквизиты');
		assert.equal(children.length, 8);
		assert.ok(children.every((node) => node.kind === 'field' && node.path === 'ОбщиеРеквизиты.' + node.name));
		const date = children.find((node) => node.name === 'ТекущаяДата');
		assert.equal(date?.typeText, 'dateTime');
		assert.equal(date?.title, 'Текущая дата');
	});

	test('дети ищутся без учёта регистра', () => {
		const catalog = api.buildCatalog(FOLDER.info, null, 'settings:any');
		assert.equal(api.childrenOf(catalog, 'общиереквизиты').length, 8);
		assert.equal(api.childrenOf(catalog, { mode: 'path', parentPath: 'ОБЩИЕРЕКВИЗИТЫ' }).length, 8);
	});

	test('промежуточный узел пути без своего поля — вид path', () => {
		const catalog = api.catalogFromNodes([{ path: 'Контрагент.ИНН', kind: 'field' }]);
		assert.equal(catalog.nodes[0].kind, 'path');
		assert.equal(catalog.nodes[0].path, 'Контрагент');
		assert.deepEqual(names(api.childrenOf(catalog, 'Контрагент')), ['ИНН']);
	});

	test('объединения обходятся: поля объединения и вложенных наборов один раз', () => {
		const catalog = api.buildCatalog(UNIONS.info, null, 'expr-calc');
		const fields = catalog.nodes.map((node) => node.name);
		assert.deepEqual(fields, ['ОбъектТип', 'ОбъектСсылка', 'ОбщееКоличество', 'Тип']);
	});

	test('набор по пути «Объединение/Дочерний», голое имя — первый найденный', () => {
		// Имя ОпределениеПолей стоит в обоих объединениях схемы: точный адрес — только путь
		const byPath = api.buildCatalog(UNIONS.info, null, 'field-of-set:ОбщееКоличествоЭлементов/ОпределениеПолей');
		assert.deepEqual(names(byPath.nodes), ['ОбщееКоличество', 'Тип']);
		const byName = api.buildCatalog(UNIONS.info, null, 'field-of-set:ОпределениеПолей');
		assert.deepEqual(names(byName.nodes), ['ОбъектТип', 'ОбъектСсылка']);
		assert.deepEqual(api.buildCatalog(UNIONS.info, null, 'field-of-set:Нет/ОпределениеПолей').nodes, []);
	});

	test('вычисляемое поле — тёзка поля набора: одна строка с видом «вычисляемое»', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'settings:any');
		const twins = catalog.nodes.filter((node) => node.name === 'ПравилоПроверкиПричиныПроблемы');
		assert.equal(twins.length, 1);
		assert.equal(twins[0].kind, 'calc');
		assert.equal(twins[0].title, 'Причины проблемы');
		assert.equal(twins[0].typeText, 'string');
	});

	test('тип у тёзки без своего типа берётся у поля набора', () => {
		const catalog = api.catalogFromNodes([
			{ path: 'Сумма', kind: 'field', typeText: 'decimal', title: 'Сумма набора' },
			{ path: 'сумма', kind: 'calc', title: '' },
		]);
		assert.equal(catalog.nodes.length, 1);
		assert.equal(catalog.nodes[0].kind, 'calc');
		assert.equal(catalog.nodes[0].typeText, 'decimal');
		assert.equal(catalog.nodes[0].title, 'Сумма набора');
		assert.equal(catalog.nodes[0].path, 'Сумма', 'путь — в написании первого вхождения');
	});

	test('ресурс-тёзка вычисляемого поля в настройках — ресурс', () => {
		const catalog = api.buildCatalog(USERS.info, USERS.settings, 'settings:any');
		const quantity = catalog.nodes.filter((node) => node.name === 'Количество');
		assert.equal(quantity.length, 1);
		assert.equal(quantity[0].kind, 'total');
		assert.equal(quantity[0].title, 'Количество');
	});
});

describe('Каталог подсказки: параметры и прочие источники', () => {
	test('ПараметрыДанных — при отсутствии availableAsField', () => {
		const catalog = api.buildCatalog(USERS.info, USERS.settings, 'settings:filter');
		const container = rootNode(catalog, 'ПараметрыДанных');
		assert.equal(container?.kind, 'container');
		assert.deepEqual(
			names(api.childrenOf(catalog, 'ПараметрыДанных')),
			USERS.info.parameters.map((param) => param.name)
		);
		assert.ok(api.childrenOf(catalog, 'ПараметрыДанных').every((node) => node.kind === 'dataParam'));
	});

	test('availableAsField=false параметр данных не даёт', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'settings:any');
		const expected = CHECKS.info.parameters.filter((param) => param.availableAsField !== false).map((param) => param.name);
		const container = rootNode(catalog, 'ПараметрыДанных');
		assert.deepEqual(container ? names(container.children) : [], expected);
		assert.ok(!expected.includes('Контекст'));
		// Все параметры схемы выгрузки недоступны как поля — узла нет вовсе
		assert.equal(rootNode(api.buildCatalog(UNIONS.info, null, 'settings:any'), 'ПараметрыДанных'), undefined);
	});

	test('пользовательские поля варианта — только при настройках', () => {
		const withSettings = api.buildCatalog(USERS.info, USERS.settings, 'settings:selection');
		const fields = api.childrenOf(withSettings, 'ПользовательскиеПоля');
		assert.deepEqual(names(fields), ['Поле1', 'Поле2', 'Поле3']);
		assert.equal(fields[0].kind, 'userField');
		assert.equal(fields[0].title, 'Вышестоящее подразделение');
		assert.equal(rootNode(api.buildCatalog(USERS.info, null, 'settings:selection'), 'ПользовательскиеПоля'), undefined);
	});

	test('системные поля — в выбранных полях и отборе, не в группировках и сортировке', () => {
		for (const section of ['selection', 'filter', 'any']) {
			const catalog = api.buildCatalog(CHECKS.info, null, 'settings:' + section);
			assert.deepEqual(
				names(api.childrenOf(catalog, 'СистемныеПоля')),
				['НомерПоПорядку', 'НомерПоПорядкуВГруппировке', 'Уровень'],
				section
			);
			assert.ok(api.childrenOf(catalog, 'СистемныеПоля').every((node) => node.kind === 'system'));
		}
		for (const section of ['group', 'order']) {
			assert.equal(rootNode(api.buildCatalog(CHECKS.info, null, 'settings:' + section), 'СистемныеПоля'), undefined, section);
		}
	});

	test('настройки: ресурсы и вычисляемые поля есть, функций и &-параметров нет', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'settings:selection');
		assert.equal(rootNode(catalog, 'КоличествоПроблемСОбъектом')?.kind, 'total');
		assert.equal(rootNode(catalog, 'РасшифровкаПоля')?.kind, 'calc');
		assert.deepEqual(catalog.functions, []);
		assert.equal(catalog.paramsAtRoot, false);
		assert.ok(api.childrenOf(catalog, '').every((node) => node.kind !== 'function' && node.kind !== 'param'));
	});

	test('ограничения использования фильтруют по разделу', () => {
		// В объединении ОбщееКоличество и Тип запрещены в условии, группировке и сортировке
		const filter = api.buildCatalog(UNIONS.info, null, 'settings:filter');
		assert.deepEqual(names(filter.nodes).filter((name) => name !== 'СистемныеПоля'), ['ОбъектТип', 'ОбъектСсылка']);
		const selection = api.buildCatalog(UNIONS.info, null, 'settings:selection');
		assert.ok(rootNode(selection, 'ОбщееКоличество'), 'в выбранных полях ограничения нет');
		assert.equal(rootNode(selection, 'ОбщееКоличество')?.kind, 'total', 'ресурс не снимает запрет поля, но и не теряется');
		const group = api.buildCatalog(UNIONS.info, null, 'settings:group');
		assert.equal(rootNode(group, 'Тип'), undefined);
		// Вне настроек ограничения не действуют
		assert.ok(rootNode(api.buildCatalog(UNIONS.info, null, 'expr-calc'), 'Тип'));
	});

	test('запрещённое поле с детьми остаётся промежуточным узлом', () => {
		const restricted = { field: false, condition: true, group: false, order: false };
		const catalog = api.catalogFromNodes(
			[
				{ path: 'Контрагент', kind: 'field', restrict: restricted },
				{ path: 'Контрагент.ИНН', kind: 'field' },
				{ path: 'Сумма', kind: 'field', restrict: restricted },
			],
			{ section: 'filter' }
		);
		assert.deepEqual(names(catalog.nodes), ['Контрагент']);
		assert.equal(catalog.nodes[0].kind, 'path');
		assert.deepEqual(names(api.childrenOf(catalog, 'Контрагент')), ['ИНН']);
	});

	test('реквизиты через точку отбрасываются по attributeUseRestriction раздела', () => {
		const extra: ExtraChildren = () => [{ name: 'Код', kind: 'field' }];
		// Идентификатор набора ВнешняяТаблица запрещает реквизиты во всех разделах
		const selection = api.buildCatalog(CHECKS.info, null, 'settings:selection');
		assert.deepEqual(api.childrenOf(selection, 'Идентификатор', extra), []);
		const kinds = api.childrenOf(selection, 'ВидПроверки', extra);
		assert.deepEqual(names(kinds), ['Код']);
		assert.equal(kinds[0].path, 'ВидПроверки.Код');
		const any = api.buildCatalog(CHECKS.info, null, 'settings:any');
		assert.deepEqual(names(api.childrenOf(any, 'Идентификатор', extra)), ['Код']);
	});

	test('точка расширения получает узел и путь, неизвестный путь — null', () => {
		const calls: Array<[string | null, string]> = [];
		const extra: ExtraChildren = (owner, parentPath) => {
			calls.push([owner ? owner.path : null, parentPath]);
			return [];
		};
		const catalog = api.buildCatalog(CHECKS.info, null, 'expr-param');
		api.childrenOf(catalog, { mode: 'param', parentPath: 'Контекст' }, extra);
		api.childrenOf(catalog, { mode: 'path', parentPath: 'Т.Поле' }, extra);
		assert.deepEqual(calls, [
			['Контекст', 'Контекст'],
			[null, 'Т.Поле'],
		]);
	});
});

describe('Каталог подсказки: места ввода (scope)', () => {
	test('выражение вычисляемого поля: поля наборов, &-параметры, функции, без вычисляемых', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'expr-calc');
		assert.equal(rootNode(catalog, 'РасшифровкаПоля'), undefined, 'вычисляемое поле в выражении вычисляемого');
		// Тёзка поля набора остаётся полем набора: выражение вычисляемого ссылается именно на него
		assert.equal(rootNode(catalog, 'ПравилоПроверкиПричиныПроблемы')?.kind, 'field');
		assert.equal(catalog.paramsAtRoot, true);
		assert.deepEqual(names(catalog.params), CHECKS.info.parameters.map((param) => param.name));
		assert.ok(catalog.functions.some((node) => node.name === 'ВычислитьВыражение'));
		assert.equal(rootNode(catalog, 'ПараметрыДанных'), undefined);
	});

	test('выражение ресурса: вычисляемые поля и агрегатные функции первыми', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'expr-total');
		assert.equal(rootNode(catalog, 'РасшифровкаПоля')?.kind, 'calc');
		const ranked = api.rank(api.childrenOf(catalog, ''), '');
		assert.deepEqual(
			ranked.slice(0, 5).map((row) => row.item.name),
			['Количество', 'Максимум', 'Минимум', 'Среднее', 'Сумма']
		);
		const sum = api.rank(api.childrenOf(catalog, ''), 'С');
		assert.equal(sum[0].item.name, 'Среднее', 'агрегат с совпадением по началу выше прочих');
	});

	test('выражение параметра: параметры без самого себя, полей нет', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'expr-param:Контекст');
		assert.deepEqual(catalog.nodes, []);
		assert.ok(!names(catalog.params).includes('Контекст'));
		assert.equal(catalog.params.length, CHECKS.info.parameters.length - 1);
		assert.ok(catalog.functions.length > 0);
	});

	test('связи: источник, приёмник и оба набора', () => {
		const source = api.buildCatalog(CHECKS.info, null, 'link-source:ВнешняяТаблица');
		assert.deepEqual(names(source.nodes), ['ОбработчикПереходаКИсправлению', 'Идентификатор']);
		assert.deepEqual(source.params, []);
		const dest = api.buildCatalog(CHECKS.info, null, 'link-dest:ОсновнойЗапрос');
		assert.equal(dest.nodes.length, 21);
		assert.equal(rootNode(dest, 'Идентификатор'), undefined);
		const both = api.buildCatalog(CHECKS.info, null, 'link-both:ОсновнойЗапрос|ВнешняяТаблица');
		assert.equal(both.nodes.length, 23);
		assert.ok(both.functions.length > 0);
	});

	test('текст запроса: только &-параметры схемы', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'query');
		assert.deepEqual(catalog.nodes, []);
		assert.deepEqual(catalog.functions, []);
		const params = api.childrenOf(catalog, { mode: 'param', parentPath: '' });
		assert.equal(params.length, CHECKS.info.parameters.length);
		assert.ok(api.childrenOf(catalog, '').every((node) => node.kind === 'param'));
	});

	test('имя параметра связи — голые имена', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'param-name');
		assert.deepEqual(catalog.params, []);
		assert.equal(catalog.nodes.length, CHECKS.info.parameters.length);
		assert.ok(catalog.nodes.every((node) => node.kind === 'param' && node.bare === true));
	});

	test('неизвестный scope и пустая модель — пустой каталог без падений', () => {
		for (const [model, scope] of [
			[CHECKS.info, 'нечто'],
			[null, 'settings:any'],
			[undefined, 'expr-calc'],
			[{}, 'link-both:А|Б'],
		] as Array<[unknown, string]>) {
			const catalog = api.buildCatalog(model, null, scope);
			assert.deepEqual(
				api.childrenOf(catalog, '').filter((node) => node.kind !== 'function' && node.kind !== 'container' && node.kind !== 'system'),
				[],
				scope
			);
		}
	});

	test('конструктор запроса подаёт свои узлы: алиасы и поля источников', () => {
		const catalog = api.catalogFromNodes([
			{ path: 'Товары.Номенклатура', kind: 'field', typeText: 'CatalogRef.Номенклатура' },
			{ path: 'Товары', kind: 'table', title: 'РегистрНакопления.Товары' },
			{ path: 'товары.Количество', kind: 'field' },
			...api.functionNodes('query'),
		]);
		const table = rootNode(catalog, 'Товары');
		assert.equal(table?.kind, 'table', 'узел пути стал алиасом, когда пришёл его собственный узел');
		assert.equal(table?.title, 'РегистрНакопления.Товары');
		const children = api.childrenOf(catalog, 'Товары');
		assert.deepEqual(names(children), ['Номенклатура', 'Количество']);
		assert.equal(children[1].path, 'Товары.Количество', 'путь ребёнка — от написания узла');
		assert.equal(catalog.functions.length, api.QUERY_FUNCTIONS.length);
		assert.ok(!catalog.functions.some((node) => node.name === 'ВычислитьВыражение'));
	});

	test('поле ресурса: поля наборов и вычисляемые, без параметров, функций и ограничений', () => {
		const catalog = api.buildCatalog(CHECKS.info, null, 'total-field');
		assert.equal(rootNode(catalog, 'РасшифровкаПоля')?.kind, 'calc');
		assert.equal(rootNode(catalog, 'ПравилоПроверкиПричиныПроблемы')?.kind, 'calc', 'тёзка — вычисляемое');
		assert.deepEqual(catalog.params, []);
		assert.deepEqual(catalog.functions, []);
		assert.equal(catalog.paramsAtRoot, false);
		assert.equal(rootNode(catalog, 'ПараметрыДанных'), undefined);
		assert.equal(rootNode(catalog, 'КоличествоПроблемСОбъектом')?.kind, 'field', 'ресурс виден своим полем набора, не ресурсом');
		// Запрет в объединении действует только в разделах настроек
		assert.ok(rootNode(api.buildCatalog(UNIONS.info, null, 'total-field'), 'Тип'));
	});

	test('подпись типа — по структурному valueType', () => {
		assert.equal(api.compactType({ types: ['xs:string', 'cfg:CatalogRef.Пользователи'], typeSets: ['cfg:AnyIBRef'] }), 'string, CatalogRef.Пользователи, AnyIBRef');
		assert.equal(api.compactType({ types: [], typeSets: [], typeIds: ['x'], definedTypes: ['Подразделение'] }), 'Подразделение');
		assert.equal(api.compactType(null), '');
		const catalog = api.buildCatalog(USERS.info, null, 'expr-param');
		assert.equal(catalog.params.find((node) => node.name === 'Подразделение')?.typeText, 'Подразделение');
	});

	test('с typeText подпись строки — русское представление модуля типов, XML-имён нет', () => {
		const types = loadModule<{ typePresentation(dto: unknown, dictionary: unknown): string }>(path.join(WEBVIEW, 'dcs-editor-types.js'));
		const options = { typeText: (valueType: unknown) => types.typePresentation(valueType, null) };
		const XML_NAME = /\b(?:string|boolean|dateTime|decimal|CatalogRef|DocumentRef|AnyIBRef)\b|xs:|cfg:/;
		for (const [scope, model] of [
			['expr-calc', CHECKS.info],
			['expr-param', USERS.info],
			['settings:selection', USERS.info],
			['link-both:Основной|Основной', CHECKS.info],
			['param-name', CHECKS.info],
		] as const) {
			const catalog = api.buildCatalog(model, null, scope, options);
			const all: CatalogNode[] = [];
			const walk = (nodes: CatalogNode[]): void => {
				for (const node of nodes) {
					all.push(node);
					walk(node.children);
				}
			};
			walk(catalog.nodes);
			all.push(...catalog.params);
			assert.ok(all.length > 0, scope);
			for (const node of all) {
				assert.doesNotMatch(node.typeText, XML_NAME, `${scope}: ${node.name} — «${node.typeText}»`);
				if (!node.valueType) {
					assert.equal(node.typeText, '', `${scope}: ${node.name} без структурного типа — пустая подпись`);
				}
			}
			// У функций в колонке — группа функций, а не тип
			for (const fn of catalog.functions) {
				assert.equal(fn.typeText, api.FUNCTION_GROUPS[fn.group ?? ''] || '');
			}
		}
		const users = api.buildCatalog(USERS.info, null, 'expr-param', options);
		assert.equal(users.params.find((node) => node.name === 'Пользователь')?.typeText, 'СправочникСсылка.Пользователи');
		const checks = api.buildCatalog(CHECKS.info, null, 'expr-calc', options);
		assert.equal(checks.params.find((node) => node.name === 'ВыводитьОтветственного')?.typeText, 'Булево');
	});
});

describe('Подсказка: контекст каретки', () => {
	test('после точки — дети узла пути', () => {
		const { ctx } = at('Т.Номенклатура.');
		assert.deepEqual(ctx, { mode: 'path', parentPath: 'Т.Номенклатура', prefix: '', replaceStart: 15, replaceEnd: 15 });
	});

	test('посреди слова замена доходит до конца идентификатора', () => {
		const { ctx } = at('Сумма(Номен|клатура) + 1');
		assert.equal(ctx.mode, 'path');
		assert.equal(ctx.prefix, 'Номен');
		assert.equal(ctx.replaceStart, 6);
		assert.equal(ctx.replaceEnd, 18);
		// Хвост после точки не захватывается: заменяется только текущий сегмент
		assert.equal(at('Орг|анизация.Наименование').ctx.replaceEnd, 'Организация'.length);
	});

	test('после & — режим параметра, после «&Имя.» — его свойства', () => {
		assert.deepEqual(at('&').ctx, { mode: 'param', parentPath: '', prefix: '', replaceStart: 1, replaceEnd: 1 });
		assert.deepEqual(at('Поле < &Пер').ctx, { mode: 'param', parentPath: '', prefix: 'Пер', replaceStart: 8, replaceEnd: 11 });
		const props = at('&Период.Дата').ctx;
		assert.equal(props.mode, 'param');
		assert.equal(props.parentPath, 'Период');
		assert.equal(props.prefix, 'Дата');
	});

	test('внутри строки и комментария подсказки нет', () => {
		assert.equal(at('Поле = "текст По').ctx.mode, 'none');
		assert.equal(at('Поле = "а ""Пол|е"" б"').ctx.mode, 'none');
		assert.equal(at('Поле // комментарий По').ctx.mode, 'none');
		assert.equal(at('ВычислитьВыражение("Сумма(Ко|)")').ctx.mode, 'none');
	});

	test('после закрытой строки и на следующей строке за комментарием — снова путь', () => {
		assert.deepEqual(at('"закрыта" + По').ctx.mode, 'path');
		assert.equal(at('"а ""б""" + По').ctx.prefix, 'По');
		const next = at('Поле // комментарий\nСум');
		assert.equal(next.ctx.mode, 'path');
		assert.equal(next.ctx.prefix, 'Сум');
		// Незакрытая кавычка кончается на границе строки, как в подсветке
		assert.equal(at('"обрыв\nПо').ctx.mode, 'path');
	});

	test('после пробела и знака операции — верхний уровень с пустым префиксом', () => {
		for (const text of ['Поле + ', 'Сумма(', 'ВЫБРАТЬ ', '']) {
			const { ctx } = at(text);
			assert.equal(ctx.mode, 'path', JSON.stringify(text));
			assert.equal(ctx.parentPath, '');
			assert.equal(ctx.prefix, '');
		}
	});

	test('число с точкой — не путь, цифры в имени — путь', () => {
		assert.equal(at('1.').ctx.mode, 'none');
		assert.equal(at('Цена * 1.5').ctx.mode, 'none');
		assert.equal(at('Цена * 2').ctx.mode, 'none');
		assert.deepEqual(at('Поле1.').ctx.parentPath, 'Поле1');
	});

	test('обрывки пути без имени к каталогу не привязываются', () => {
		assert.equal(at('Функция().По').ctx.mode, 'none');
		assert.equal(at('А..Б').ctx.mode, 'none');
	});

	test('кириллица с ё и каретка в начале текста', () => {
		const yo = at('Счёт.Да').ctx;
		assert.equal(yo.parentPath, 'Счёт');
		assert.equal(yo.prefix, 'Да');
		assert.deepEqual(api.contextAt('Поле', 0), { mode: 'path', parentPath: '', prefix: '', replaceStart: 0, replaceEnd: 4 });
	});

	test('каретка за пределами текста прижимается к краю', () => {
		assert.equal(api.contextAt('Поле', 99).prefix, 'Поле');
		assert.equal(api.contextAt('Поле', -5).replaceStart, 0);
	});
});

describe('Подсказка: ранжирование', () => {
	const items: Array<Partial<CatalogNode>> = [
		{ name: 'КодНоменклатуры', kind: 'field', title: '' },
		{ name: 'Номенклатура', kind: 'field', title: 'Товар' },
		{ name: 'Количество', kind: 'field', title: 'Количество номеров' },
		{ name: 'Склад', kind: 'field', title: 'Место хранения' },
	];

	test('начало имени → вхождение → заголовок, с границами совпадения', () => {
		const ranked = api.rank(items, 'ном');
		assert.deepEqual(
			ranked.map((row) => [row.item.name, row.group, row.match]),
			[
				['Номенклатура', 0, { on: 'name', start: 0, end: 3 }],
				['КодНоменклатуры', 1, { on: 'name', start: 3, end: 6 }],
				['Количество', 2, { on: 'title', start: 11, end: 14 }],
			]
		);
	});

	test('регистр не важен, несовпавшие строки отброшены', () => {
		assert.deepEqual(
			api.rank(items, 'НОМ').map((row) => row.item.name),
			['Номенклатура', 'КодНоменклатуры', 'Количество']
		);
		assert.deepEqual(api.rank(items, 'xyz'), []);
	});

	test('ё и е совпадают в обе стороны', () => {
		const words: Array<Partial<CatalogNode>> = [
			{ name: 'Счёт', kind: 'field' },
			{ name: 'СчетФактура', kind: 'field' },
		];
		assert.deepEqual(api.rank(words, 'сче').map((row) => row.item.name), ['Счёт', 'СчетФактура']);
		assert.deepEqual(api.rank(words, 'счё').map((row) => row.item.name), ['Счёт', 'СчетФактура']);
	});

	test('пустой префикс — все строки по алфавиту без подсветки', () => {
		const ranked = api.rank(items, '');
		assert.deepEqual(
			ranked.map((row) => row.item.name),
			['КодНоменклатуры', 'Количество', 'Номенклатура', 'Склад']
		);
		assert.ok(ranked.every((row) => row.match === null && row.group === 0));
	});

	test('внутри группы приоритет выше алфавита, тёзки разных видов — поле раньше функции', () => {
		const ranked = api.rank(
			[
				{ name: 'Сумма', kind: 'function', priority: 0 },
				{ name: 'Сумма', kind: 'field' },
				{ name: 'СуммаВсего', kind: 'field' },
				{ name: 'СумПрописью', kind: 'function', priority: 1 },
			],
			'сум'
		);
		assert.deepEqual(
			ranked.map((row) => row.item.name + ':' + row.item.kind),
			['СумПрописью:function', 'Сумма:field', 'Сумма:function', 'СуммаВсего:field']
		);
	});
});

describe('Подсказка: вставка', () => {
	test('выбор заменяет текущее слово целиком, каретка — после имени', () => {
		const { text, ctx } = at('Сумма(Номен|клатура) + 1');
		assert.deepEqual(api.applyItem(text, ctx, { name: 'Номенклатура', kind: 'field' }), {
			text: 'Сумма(Номенклатура) + 1',
			caret: 18,
		});
	});

	test('после точки вставляется сегмент, путь до точки не трогается', () => {
		const { text, ctx } = at('Т.Номенклатура.К');
		assert.deepEqual(api.applyItem(text, ctx, { name: 'Код', kind: 'field' }), { text: 'Т.Номенклатура.Код', caret: 18 });
	});

	test('имена вставляются как есть, без квадратных скобок', () => {
		const { text, ctx } = at('ПараметрыДанных.');
		const result = api.applyItem(text, ctx, { name: 'НачалоПериода', kind: 'dataParam' });
		assert.equal(result.text, 'ПараметрыДанных.НачалоПериода');
		assert.ok(!result.text.includes('['));
	});

	test('функция получает открывающую скобку, вторую не дублирует', () => {
		const typed = at('Сум');
		assert.deepEqual(api.applyItem(typed.text, typed.ctx, { name: 'Сумма', kind: 'function' }), { text: 'Сумма(', caret: 6 });
		const paren = at('Сум|(Поле)');
		assert.deepEqual(api.applyItem(paren.text, paren.ctx, { name: 'Сумма', kind: 'function' }), {
			text: 'Сумма(Поле)',
			caret: 6,
		});
	});

	test('параметр в выражении — «&Имя», после & — только имя, голое имя связи — без &', () => {
		const expr = at('Поле + Пер');
		assert.deepEqual(api.applyItem(expr.text, expr.ctx, { name: 'Период', kind: 'param' }), { text: 'Поле + &Период', caret: 14 });
		const amp = at('Поле + &Пер|');
		assert.deepEqual(api.applyItem(amp.text, amp.ctx, { name: 'Период', kind: 'param' }), { text: 'Поле + &Период', caret: 14 });
		const bare = at('Пер');
		assert.deepEqual(api.applyItem(bare.text, bare.ctx, { name: 'Период', kind: 'param', bare: true }), { text: 'Период', caret: 6 });
	});

	test('свойство параметра после «&Имя.» — имя без &', () => {
		const { text, ctx } = at('&Период.Дата');
		assert.deepEqual(api.applyItem(text, ctx, { name: 'ДатаНачала', kind: 'field' }), { text: '&Период.ДатаНачала', caret: 18 });
	});

	test('вне контекста текст не меняется', () => {
		const { text, ctx } = at('"строка По');
		assert.deepEqual(api.applyItem(text, ctx, { name: 'Поле', kind: 'field' }), { text, caret: text.length });
	});

	test('подпись для скринридера: вид словом, имя, заголовок и тип', () => {
		assert.equal(
			api.itemLabel({ name: 'Номенклатура', kind: 'field', title: 'Товар', typeText: 'CatalogRef.Номенклатура' }),
			'поле Номенклатура, Товар, CatalogRef.Номенклатура'
		);
		assert.equal(api.itemLabel({ name: 'Период', kind: 'param', title: 'Период' }), 'параметр &Период');
		assert.equal(api.itemLabel({ name: 'Сумма', kind: 'function', typeText: 'Агрегатные' }), 'функция Сумма, Агрегатные');
		// Поля общих реквизитов: разделитель и прочий общий реквизит — своим словом
		assert.equal(api.itemLabel({ name: 'ОбластьДанныхОсновныеДанные', kind: 'separator', title: 'Область данных основные данные' }), 'разделитель ОбластьДанныхОсновныеДанные, Область данных основные данные');
		assert.equal(api.itemLabel({ name: 'КомментарийЯзык1', kind: 'commonAttribute' }), 'общий реквизит КомментарийЯзык1');
		for (const kind of Object.keys(api.KIND_LABELS)) {
			assert.ok(api.KIND_LABELS[kind].letter && api.KIND_LABELS[kind].word, kind);
		}
	});
});

describe('Подсказка: положение списка', () => {
	const viewport = { width: 1000, height: 800 };
	const size = { width: 300, height: 200 };

	test('по умолчанию — под якорем, у левого края якоря', () => {
		assert.deepEqual(api.placePopup({ left: 100, top: 200, bottom: 220 }, size, viewport), {
			left: 100,
			top: 220,
			above: false,
			maxHeight: 200,
		});
	});

	test('у нижнего края — над якорем', () => {
		assert.deepEqual(api.placePopup({ left: 100, top: 680, bottom: 700 }, size, viewport), {
			left: 100,
			top: 480,
			above: true,
			maxHeight: 200,
		});
	});

	test('у правого и левого края — прижатие к окну с отступом', () => {
		const right = api.placePopup({ left: 900, top: 100, bottom: 120 }, size, viewport);
		assert.equal(right.left, 1000 - api.POPUP_MARGIN - 300);
		assert.equal(api.placePopup({ left: -20, top: 100, bottom: 120 }, size, viewport).left, api.POPUP_MARGIN);
		// Список шире окна прижимается к левому краю
		assert.equal(api.placePopup({ left: 50, top: 100, bottom: 120 }, { width: 1200, height: 100 }, viewport).left, api.POPUP_MARGIN);
	});

	test('не влезает ни снизу, ни сверху — туда, где места больше, с ужатой высотой', () => {
		const small = { width: 1000, height: 300 };
		assert.deepEqual(api.placePopup({ left: 0, top: 100, bottom: 120 }, { width: 300, height: 250 }, small), {
			left: 4,
			top: 120,
			above: false,
			maxHeight: 176,
		});
		assert.deepEqual(api.placePopup({ left: 0, top: 200, bottom: 220 }, { width: 300, height: 250 }, small), {
			left: 4,
			top: 4,
			above: true,
			maxHeight: 196,
		});
	});
});

describe('Списки функций и сверка с подсветкой', () => {
	const upper = (entries: FunctionEntry[]): Set<string> =>
		new Set(entries.flatMap((entry) => [entry.name.toUpperCase(), entry.nameEn.toUpperCase()]));

	test('выражения СКД = язык запросов + функции компоновки и встроенного языка', () => {
		const query = new Set(api.QUERY_FUNCTIONS.map((entry) => entry.name));
		const dcs = new Set(api.DCS_FUNCTIONS.map((entry) => entry.name));
		assert.ok([...query].every((name) => dcs.has(name)), 'язык запросов не вошёл в выражения СКД');
		for (const name of [
			'Формат', 'ЗначениеЗаполнено', 'НСтр', 'СоединитьСтроки', 'Строка', 'ТекущаяДатаСеанса', 'ТекущаяДата',
			'Массив', 'Уровень', 'ПредставлениеПериода', 'СтрШаблон', 'УниверсальноеВремя', 'Дата', 'Выразить',
			'ВычислитьВыражение',
		]) {
			assert.ok(dcs.has(name), `нет в выражениях СКД: ${name}`);
		}
		// Функций компоновки в окне выражения запроса нет
		for (const name of ['ВычислитьВыражение', 'Уровень', 'Формат', 'Строка']) {
			assert.ok(!query.has(name), `лишнее в языке запросов: ${name}`);
		}
	});

	test('имена в списках уникальны, у каждой функции известная группа и английское имя', () => {
		for (const entries of [api.QUERY_FUNCTIONS, api.DCS_FUNCTIONS]) {
			const seen = entries.map((entry) => entry.name.toUpperCase());
			assert.equal(new Set(seen).size, seen.length);
			for (const entry of entries) {
				assert.ok(api.FUNCTION_GROUPS[entry.group], `${entry.name}: группа ${entry.group}`);
				assert.match(entry.nameEn, /^[A-Za-z0-9]+$/, entry.name);
			}
		}
		const nodes = api.functionNodes('dcs');
		assert.equal(nodes.length, api.DCS_FUNCTIONS.length);
		assert.equal(nodes.find((node) => node.path === 'Сумма')?.typeText, 'Агрегатные');
		assert.ok(api.functionNodes('query', 'en').some((node) => node.path === 'BeginOfPeriod'));
	});

	test('словарь функций подсветки ⊆ объединение двух списков подсказки', () => {
		// НеделяГода подсвечивается, но в подсказку не входит: в языке запросов её нет, в списке функций
		// выражений СКД — тоже
		const exceptions = new Set(['НЕДЕЛЯГОДА', 'WEEKOFYEAR']);
		const known = new Set([...upper(api.QUERY_FUNCTIONS), ...upper(api.DCS_FUNCTIONS)]);
		const extra = highlight.FUNCTION_NAMES.filter((name) => !known.has(name) && !exceptions.has(name));
		assert.deepEqual(extra, []);
	});

	test('каждая функция подсказки со скобкой подсвечивается функцией', () => {
		// Выразить — конструкция приведения типа: подсветка оставляет её ключевым словом
		const keywords = new Set(['ВЫРАЗИТЬ', 'CAST']);
		for (const name of upper(api.DCS_FUNCTIONS)) {
			const token = highlight.tokenize(name + '(')[0];
			assert.equal(token.type, keywords.has(name) ? 'keyword' : 'func', name);
		}
		for (const entry of api.DCS_FUNCTIONS) {
			assert.equal(highlight.tokenize(entry.name + '(1)')[0].type, keywords.has(entry.name.toUpperCase()) ? 'keyword' : 'func', entry.name);
		}
	});
});

describe('Подсказка: решения DOM-обвязки по вводу', () => {
	const ctxOf = (textWithCaret: string): CompletionContext => at(textWithCaret).ctx;

	test('буква открывает, при открытом — перефильтровывает; цифра закрытый не открывает', () => {
		assert.equal(api.inputAction(false, 'С', ctxOf('С')), 'open');
		assert.equal(api.inputAction(true, 'у', ctxOf('Су')), 'refilter');
		assert.equal(api.inputAction(false, '_', ctxOf('_')), 'open');
		assert.equal(api.inputAction(false, '1', ctxOf('Поле1')), 'keep');
		assert.equal(api.inputAction(true, '1', ctxOf('Поле1')), 'refilter');
	});

	test('точка открывает уровень пути, «&» — параметры', () => {
		assert.equal(api.inputAction(false, '.', ctxOf('Контрагент.')), 'open');
		assert.equal(api.inputAction(true, '.', ctxOf('Контрагент.')), 'open', 'открытый список встаёт на новый уровень');
		assert.equal(api.inputAction(false, '&', ctxOf('Поле < &')), 'open');
		assert.equal(api.inputAction(false, '.', ctxOf('&Период.')), 'open');
	});

	test('число, строка и комментарий: список не открывается, открытый закрывается', () => {
		assert.equal(api.inputAction(false, '.', ctxOf('1.')), 'keep');
		assert.equal(api.inputAction(true, '.', ctxOf('Цена * 1.')), 'close');
		assert.equal(api.inputAction(false, 'П', ctxOf('"текст П')), 'keep');
		assert.equal(api.inputAction(true, 'П', ctxOf('// П')), 'close');
		assert.equal(api.inputAction(true, '"', ctxOf('Ск"')), 'close');
	});

	test('пробел и знак операции закрывают, закрытый не трогают', () => {
		for (const ch of [' ', '+', '(', ')', ',', '=']) {
			assert.equal(api.inputAction(true, ch, ctxOf('Поле' + ch)), 'close', JSON.stringify(ch));
			assert.equal(api.inputAction(false, ch, ctxOf('Поле' + ch)), 'keep', JSON.stringify(ch));
		}
		assert.equal(api.inputAction(true, 'ab', ctxOf('Поле ab')), 'close', 'вставка нескольких символов');
	});

	test('удаление и сдвиг каретки: в слове — перефильтр, вне слова — закрыть', () => {
		assert.equal(api.inputAction(true, '', ctxOf('Ск')), 'refilter');
		assert.equal(api.inputAction(true, '', ctxOf('Контрагент.')), 'refilter', 'сразу за точкой — уровень пути');
		assert.equal(api.inputAction(true, '', ctxOf('Поле < &')), 'refilter', 'сразу за & — параметры');
		assert.equal(api.inputAction(true, '', ctxOf('Поле + ')), 'close');
		assert.equal(api.inputAction(true, '', ctxOf('')), 'close');
		assert.equal(api.inputAction(false, '', ctxOf('Ск')), 'keep', 'удаление закрытый список не открывает');
	});

	test('letters:false (текст запроса): буквы — только после &', () => {
		const query = { letters: false };
		assert.equal(api.inputAction(false, 'В', ctxOf('В'), query), 'keep');
		assert.equal(api.inputAction(false, 'П', ctxOf('ГДЕ Поле = &П'), query), 'open');
		assert.equal(api.inputAction(false, '&', ctxOf('= &'), query), 'open');
		// Открытый явным вызовом список буквы фильтруют
		assert.equal(api.inputAction(true, 'е', ctxOf('Пе'), query), 'refilter');
	});

	test('неполный контекст не роняет решение', () => {
		assert.equal(api.inputAction(false, 'А', null), 'keep');
		assert.equal(api.inputAction(true, 'А', { mode: 'none' }), 'close');
	});
});

describe('Подсказка: клавиши и окно строк', () => {
	test('стрелки по кругу, PageUp/PageDown с упором, Home/End', () => {
		const count = 20;
		const cases: Array<[number, string, number]> = [
			[0, 'ArrowDown', 1],
			[19, 'ArrowDown', 0],
			[0, 'ArrowUp', 19],
			[5, 'ArrowUp', 4],
			[0, 'PageDown', api.PAGE_STEP],
			[15, 'PageDown', 19],
			[10, 'PageUp', 10 - api.PAGE_STEP],
			[3, 'PageUp', 0],
			[7, 'Home', 0],
			[7, 'End', 19],
			[7, 'x', 7],
			[-1, 'ArrowDown', 0],
			[-1, 'ArrowUp', 19],
			[99, 'ArrowUp', 18],
		];
		for (const [index, keyName, expected] of cases) {
			assert.equal(api.nextActive(index, count, keyName), expected, `${index} ${keyName}`);
		}
		assert.equal(api.nextActive(0, 0, 'ArrowDown'), -1, 'строк нет');
		assert.equal(api.nextActive(0, 1, 'ArrowDown'), 0);
	});

	test('окно строк сдвигается, только когда активная вышла за край', () => {
		const size = api.MAX_ROWS;
		assert.equal(api.windowStart(0, 0, 50, size), 0, 'всё помещается');
		assert.equal(api.windowStart(99, 0, 5000, size), 0);
		assert.equal(api.windowStart(100, 0, 5000, size), 1, 'на шаг за край — сдвиг на шаг');
		assert.equal(api.windowStart(4999, 0, 5000, size), 4900, 'End — последние строки');
		assert.equal(api.windowStart(4950, 4900, 5000, size), 4900, 'внутри окна не прыгает');
		assert.equal(api.windowStart(10, 4900, 5000, size), 10, 'вверх за край — окно с активной строки');
		assert.equal(api.windowStart(0, 4990, 5000, size), 0);
		assert.equal(api.windowStart(5, 9000, 120, size), 5, 'старое начало за концом прижимается');
	});

	test('полный список встаёт на лучшую строку: начало, вхождение, иначе первая', () => {
		const ranked = api.rank(
			[
				{ name: 'Количество', kind: 'field' },
				{ name: 'КодНоменклатуры', kind: 'field' },
				{ name: 'Номенклатура', kind: 'field' },
				{ name: 'Склад', kind: 'field' },
			],
			''
		);
		assert.equal(ranked[api.bestIndex(ranked, 'ном')].item.name, 'Номенклатура');
		assert.equal(ranked[api.bestIndex(ranked, 'склад')].item.name, 'Склад');
		assert.equal(ranked[api.bestIndex(ranked, 'енкл')].item.name, 'КодНоменклатуры', 'вхождение — первое по порядку');
		assert.equal(api.bestIndex(ranked, 'xyz'), 0);
		assert.equal(api.bestIndex(ranked, ''), 0);
		assert.equal(api.bestIndex([], 'а'), 0);
	});
});

describe('Подсказка: строка списка', () => {
	test('куски совпадения без пустых и с упором в края', () => {
		assert.deepEqual(api.splitMatch('Номенклатура', 0, 3), [
			{ text: 'Ном', hit: true },
			{ text: 'енклатура', hit: false },
		]);
		assert.deepEqual(api.splitMatch('КодНоменклатуры', 3, 6), [
			{ text: 'Код', hit: false },
			{ text: 'Ном', hit: true },
			{ text: 'енклатуры', hit: false },
		]);
		assert.deepEqual(api.splitMatch('Поле', 0, 0), [{ text: 'Поле', hit: false }]);
		assert.deepEqual(api.splitMatch('Поле', 2, 99), [
			{ text: 'По', hit: false },
			{ text: 'ле', hit: true },
		]);
		assert.deepEqual(api.splitMatch('', 0, 0), []);
	});

	test('метка вида: буква и стрелка у узла с детьми', () => {
		assert.equal(api.kindLetter({ kind: 'field', children: [] }), 'П');
		const catalog = api.catalogFromNodes([{ path: 'Контрагент.ИНН', kind: 'field' }, { path: 'Сумма', kind: 'calc' }]);
		assert.equal(api.kindLetter(catalog.nodes[0]), 'П▸');
		assert.equal(api.kindLetter(catalog.nodes[1]), 'В');
		assert.equal(api.kindLetter({ kind: 'function' }), 'ƒ');
		assert.equal(api.kindLetter({ kind: 'неизвестно' }), 'П');
		// Разделитель «Р», общий реквизит «О», как буквы других видов
		assert.equal(api.kindLetter({ kind: 'separator' }), 'Р');
		assert.equal(api.kindLetter({ kind: 'commonAttribute' }), 'О');
		const merged = api.catalogFromNodes([{ path: 'Область', kind: 'separator', title: 'Область данных' }, { path: 'Область', kind: 'path' }]);
		assert.equal(merged.nodes[0].kind, 'separator', 'вид разделителя не уступает промежуточному узлу пути');
	});

	test('части строки: «&» у параметра сдвигает совпадение, заголовок — своим совпадением', () => {
		const [param] = api.rank([{ name: 'Период', kind: 'param', title: 'Период отчёта' }], 'пер');
		const parts = api.rowParts(param);
		assert.equal(parts.letter, '&');
		assert.deepEqual(parts.name, [
			{ text: '&', hit: false },
			{ text: 'Пер', hit: true },
			{ text: 'иод', hit: false },
		]);
		assert.deepEqual(parts.title, [{ text: 'Период отчёта', hit: false }]);
		const [bare] = api.rank([{ name: 'Период', kind: 'param', bare: true }], 'пер');
		assert.equal(api.rowParts(bare).name[0].text, 'Пер', 'голое имя связи — без &');
		const [byTitle] = api.rank([{ name: 'Склад', kind: 'field', title: 'Место хранения', typeText: 'CatalogRef.Склады' }], 'хран');
		const titled = api.rowParts(byTitle);
		assert.deepEqual(titled.name, [{ text: 'Склад', hit: false }]);
		assert.deepEqual(titled.title, [
			{ text: 'Место ', hit: false },
			{ text: 'хран', hit: true },
			{ text: 'ения', hit: false },
		]);
		assert.equal(titled.typeText, 'CatalogRef.Склады');
		const same = api.rowParts({ item: { name: 'Склад', kind: 'field', title: 'Склад' }, match: null });
		assert.deepEqual(same.title, [], 'заголовок, равный имени, не повторяется');
	});

	test('сообщение читалке и подпись окна', () => {
		assert.equal(api.listSummary(0), 'Вариантов нет.');
		assert.equal(api.listSummary(12), 'Вариантов: 12.');
		assert.equal(api.windowNote(0, 40, 40), '');
		assert.equal(api.windowNote(0, 100, 5000), 'Строки 1–100 из 5000: уточните ввод или листайте клавишами.');
		assert.equal(api.windowNote(4900, 5000, 5000), 'Строки 4901–5000 из 5000: уточните ввод или листайте клавишами.');
	});
});

describe('Подсказка: подключение к webview', () => {
	const read = (name: string): string => fs.readFileSync(path.join(WEBVIEW, name), 'utf8');
	const script = readEditorScript();

	/** Аргументы вызова верхнего уровня: от «(» после имени до парной «)», запятые вне скобок и строк. */
	function callArgs(source: string, start: number): string[] {
		const open = source.indexOf('(', start);
		const args: string[] = [];
		let depth = 0;
		let quote = '';
		let current = '';
		for (let i = open + 1; i < source.length; i += 1) {
			const ch = source[i];
			if (quote) {
				current += ch;
				if (ch === quote && source[i - 1] !== '\\') {
					quote = '';
				}
				continue;
			}
			if (ch === "'" || ch === '"' || ch === '`') {
				quote = ch;
				current += ch;
				continue;
			}
			if (ch === '(' || ch === '{' || ch === '[') {
				depth += 1;
			} else if (ch === ')' || ch === '}' || ch === ']') {
				if (depth === 0) {
					args.push(current.trim());
					return args.filter(Boolean);
				}
				depth -= 1;
			} else if (ch === ',' && depth === 0) {
				args.push(current.trim());
				current = '';
				continue;
			}
			current += ch;
		}
		throw new Error('вызов не закрыт');
	}

	test('модуль подключён до основного скрипта, панель подставляет его адрес', () => {
		const html = read('dcs-editor.html');
		const at = html.indexOf('{{COMPLETE_JS_URI}}');
		assert.ok(at >= 0, 'в шаблоне нет {{COMPLETE_JS_URI}}');
		assert.ok(at < html.indexOf('{{JS_URI}}'), 'модуль подсказки подключён позже скрипта');
		assert.ok(script.includes('window.DcsComplete'), 'скрипт не берёт модуль подсказки');
		const panel = fs.readFileSync(path.join(ROOT, 'src', 'features', 'metadata', 'dcsEditorPanel.ts'), 'utf8');
		assert.ok(panel.includes("'dcs-editor-complete.js'"), 'панель не знает файл модуля');
		assert.ok(panel.includes("replaceAll('{{COMPLETE_JS_URI}}'"), 'панель не подставляет {{COMPLETE_JS_URI}}');
	});

	test('поле пути «Настроек» подсказывает через attachCompletion', () => {
		assert.ok(script.includes('function attachFieldList(input, section)'), 'сигнатура attachFieldList');
		const body = script.slice(script.indexOf('function attachFieldList('));
		const end = body.indexOf('\n\t}\n');
		assert.ok(end > 0, 'тело attachFieldList не найдено');
		assert.ok(body.slice(0, end).includes('attachCompletion(input'), 'attachFieldList идёт через attachCompletion');
	});

	test('каждое поле выражения получает место ввода, текст запроса — только параметры', () => {
		const definition = script.indexOf('function expressionInput(');
		let calls = 0;
		for (let at = script.indexOf('expressionInput(', 0); at >= 0; at = script.indexOf('expressionInput(', at + 1)) {
			if (at === definition + 'function '.length) {
				continue;
			}
			calls += 1;
			const args = callArgs(script, at);
			assert.equal(args.length, 4, `вызов expressionInput без scope: ${args.join(', ')}`);
			assert.match(args[3], /=>|bothSets/, 'четвёртый аргумент — функция места ввода');
		}
		assert.equal(calls, 7, 'семь полей выражений');
		assert.ok(script.includes("attachCompletion(editor.input, () => 'query', { letters: false })"), 'текст запроса');
	});

	test('места ввода в скрипте известны модулю', () => {
		const module = read('dcs-editor-complete.js');
		const known = new Set([...module.matchAll(/case '([a-z-]+)':/g)].map((match) => match[1]));
		// Функции мест ввода — аргументы attachCompletion и expressionInput (и общая bothSets связи)
		const used = new Set(
			[...script.matchAll(/\(\) => '([a-z-]+)/g)]
				.filter((match) => /attachCompletion\(|expressionInput\(|bothSets = /.test(script.slice(Math.max(0, (match.index ?? 0) - 200), match.index)))
				.map((match) => match[1])
		);
		assert.ok(used.size >= 10, `мест ввода мало: ${[...used].join(', ')}`);
		const unknown = [...used].filter((scope) => !known.has(scope));
		assert.deepEqual(unknown, [], 'scope, которого модуль не знает');
	});

	test('список выше стека диалогов, ARIA поля — как у combo', () => {
		assert.ok(script.includes('String(dialogRules.POPUP_Z_INDEX)'), 'z-index списка из правил стека');
		for (const part of ["'aria-autocomplete', 'list'", "'aria-controls'", "'aria-expanded'", "'aria-activedescendant'", "'role', 'combobox'", "'role', 'listbox'", "'role', 'option'", "'aria-live', 'polite'"]) {
			assert.ok(script.includes(part), `нет ${part}`);
		}
		const css = read('dcs-editor.css');
		assert.ok(css.includes('.hidden + .dcs-complete-more'), 'кнопка «⋯» скрывается вместе с полем');
		assert.ok(/\.dcs-complete \{[^}]*position: fixed/.test(css), 'список fixed');
	});
});

describe('Параметры данных в подсказках настроек', () => {
	test('settingsFieldPaths берёт параметры при availableAsField !== false', () => {
		const script = readEditorScript();
		const start = script.indexOf('function settingsFieldPaths()');
		assert.ok(start >= 0, 'нет settingsFieldPaths');
		const body = script.slice(start, script.indexOf('\n\t}\n', start));
		assert.ok(body.includes('param.availableAsField !== false'), 'условие доступности параметра как поля');
		assert.ok(body.includes("'ПараметрыДанных.'"), 'путь параметра данных');
	});
});
