/**
 * Тип значения редактора СКД: чистые функции dcs-editor-types.js.
 *
 * Модуль исполняется в песочнице node:vm, как подсветка: DOM ему не нужен, поэтому тесты гоняют
 * ровно тот код, который рисует колонку «Тип» и решает в диалоге, слать ли мутацию. Реальные
 * DTO `valueType` берутся из замороженных ответов cf-dcs-info (complete-models.json, БСП 3.1).
 * Запуск: npm run compile && node --test out/test/metadata/dcsTypes.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { readEditorScript } from '../fixtures/helpers/dcsEditorScript';

interface ValueTypeDto {
	types?: string[];
	typeSets?: string[];
	typeIds?: string[];
	definedTypes?: string[];
	stringQualifiers?: Record<string, unknown>;
	numberQualifiers?: Record<string, unknown>;
	dateQualifiers?: Record<string, unknown>;
	binaryDataQualifiers?: Record<string, unknown>;
	editable?: boolean;
	readOnlyReason?: string;
}

interface TypeItem {
	list: 'types' | 'typeSets' | 'typeIds';
	value: string;
	label: string;
}

interface TypesApi {
	PRIMITIVES: ReadonlyArray<{ type: string; label: string; qualifiers?: string }>;
	MAX_DIGITS: number;
	isEmptyType(dto: unknown): boolean;
	typeListOf(type: unknown): string;
	typeItems(dto: unknown, dictionary?: unknown): TypeItem[];
	typePresentation(dto: unknown, dictionary?: unknown): string;
	compositionTitle(dto: unknown, dictionary?: unknown): string;
	toggleType(dto: unknown, type: unknown, composite: boolean): ValueTypeDto;
	defaultQualifiers(type: string): ValueTypeDto;
	validateQualifiers(dto: unknown): Array<{ field: string; message: string }>;
	compatibleValue(dto: unknown, value: unknown, dictionary?: unknown): boolean;
	emptyValueFor(dto: unknown, dictionary?: unknown): Record<string, unknown> | null;
	sameType(a: unknown, b: unknown): boolean;
	PARAMETER_FLAG_DEFAULTS: Record<string, boolean>;
	hasType(dto: unknown, type: unknown): boolean;
	typeTree(dictionary: unknown, query?: string): TreeNode[];
	payloadType(dto: unknown): ValueTypeDto | null;
	valueClearing(
		dto: unknown,
		value: unknown,
		dictionary?: unknown
	): { value?: Record<string, unknown> | null; blocked?: boolean } | null;
	typeEditPayload(
		original: unknown,
		edited: unknown,
		dictionary?: unknown
	): {
		payload: Record<string, unknown>;
		valueChange: { value?: Record<string, unknown> | null; blocked?: boolean } | null;
		error?: string;
		errors?: Array<{ field: string; message: string }>;
	};
}

interface TreeNode {
	key: string;
	label: string;
	kind: 'group' | 'kind' | 'row';
	rows: Array<{ value: unknown; label: string }>;
	typeSet?: string;
	platformName?: string;
	value?: unknown;
	total: number;
	open?: boolean;
}

interface SchemaFixture {
	info: {
		dataSets: Array<{ fields?: Array<{ dataPath?: string; valueType?: ValueTypeDto; items?: unknown }>; items?: unknown[] }>;
		calculatedFields?: Array<{ name: string; valueType?: ValueTypeDto }>;
		parameters?: Array<{ name: string; valueType?: ValueTypeDto }>;
	};
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const FILE = path.join(ROOT, 'resources', 'webview', 'dcs-editor-types.js');
const FIXTURE = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs', 'complete-models.json');

/**
 * Исполняет файл webview в текущем realm и возвращает его module.exports.
 *
 * Обёртка-функция вместо нового контекста vm: объекты из чужого realm не проходят
 * deepStrictEqual (другой Object.prototype). Параметр window подменяет глобал webview.
 */
function loadTypes(): TypesApi {
	const code = fs.readFileSync(FILE, 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: FILE }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	return moduleShim.exports as TypesApi;
}

const api = loadTypes();
const schemas = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, SchemaFixture>;

/** Все записанные типы фикстуры: поля наборов (с вложенными наборами объединений), вычисляемые, параметры. */
function corpusTypes(): Array<{ where: string; valueType: ValueTypeDto }> {
	const out: Array<{ where: string; valueType: ValueTypeDto }> = [];
	const visitSets = (schema: string, sets: unknown[] | undefined) => {
		for (const set of sets ?? []) {
			const node = set as { fields?: Array<{ dataPath?: string; valueType?: ValueTypeDto }>; items?: unknown[] };
			for (const field of node.fields ?? []) {
				if (field.valueType) {
					out.push({ where: `${schema}: поле ${field.dataPath}`, valueType: field.valueType });
				}
			}
			visitSets(schema, node.items);
		}
	};
	for (const [schema, fixture] of Object.entries(schemas)) {
		visitSets(schema, fixture.info.dataSets);
		for (const calc of fixture.info.calculatedFields ?? []) {
			if (calc.valueType) {
				out.push({ where: `${schema}: вычисляемое ${calc.name}`, valueType: calc.valueType });
			}
		}
		for (const parameter of fixture.info.parameters ?? []) {
			if (parameter.valueType) {
				out.push({ where: `${schema}: параметр ${parameter.name}`, valueType: parameter.valueType });
			}
		}
	}
	return out;
}

/** Ответ cf-dcs-type-dictionary в форме docs/cf-dcs.md (сокращён до нужного тестам). */
const DICTIONARY = {
	configurationFound: true,
	anyRef: 'cfg:AnyIBRef',
	primitives: [
		{ type: 'xs:string', label: 'Строка', qualifiers: 'string' },
		{ type: 'xs:decimal', label: 'Число', qualifiers: 'number' },
		{ type: 'xs:dateTime', label: 'Дата', qualifiers: 'date' },
		{ type: 'xs:boolean', label: 'Булево' },
		{ type: 'v8:StandardPeriod', label: 'Стандартный период' },
		{ type: 'v8:UUID', label: 'Уникальный идентификатор' },
	],
	refKinds: [
		{
			kind: 'Catalog',
			label: 'Справочник',
			platformName: 'СправочникСсылка',
			typeSet: 'cfg:CatalogRef',
			types: ['cfg:CatalogRef.Валюты'],
		},
	],
	characteristics: ['cfg:Characteristic.ВидыСубконто'],
	definedTypes: [{ name: 'Организация', typeId: '33C3E710-0000-4000-8000-000000000001' }],
};

const STRING_0 = { types: ['xs:string'], typeSets: [], typeIds: [], stringQualifiers: { length: '0', allowedLength: 'VARIABLE' } };

describe('Тип значения СКД: подпись', () => {
	test('примитивы с квалификаторами — по образцу «Строка(100)», умолчания опущены', () => {
		const cases: Array<[ValueTypeDto, string]> = [
			[STRING_0, 'Строка'],
			[{ types: ['xs:string'], stringQualifiers: { length: '100', allowedLength: 'VARIABLE' } }, 'Строка(100)'],
			[{ types: ['xs:string'], stringQualifiers: { length: '5', allowedLength: 'FIXED' } }, 'Строка(5, фиксированная)'],
			[{ types: ['xs:decimal'], numberQualifiers: { digits: '0', fractionDigits: '0', allowedSign: 'ANY' } }, 'Число'],
			[{ types: ['xs:decimal'], numberQualifiers: { digits: '15', fractionDigits: '2', allowedSign: 'ANY' } }, 'Число(15, 2)'],
			[
				{ types: ['xs:decimal'], numberQualifiers: { digits: '10', fractionDigits: '0', allowedSign: 'NONNEGATIVE' } },
				'Число(10, 0, неотрицательное)',
			],
			[{ types: ['xs:dateTime'], dateQualifiers: { dateFractions: 'DATE_TIME' } }, 'Дата(дата и время)'],
			[{ types: ['xs:dateTime'], dateQualifiers: { dateFractions: 'DATE' } }, 'Дата(дата)'],
			[{ types: ['xs:dateTime'], dateQualifiers: { dateFractions: 'TIME' } }, 'Дата(время)'],
			[{ types: ['xs:boolean'] }, 'Булево'],
			[{ types: ['v8:StandardPeriod'] }, 'Стандартный период'],
			[{ types: ['v8:UUID'] }, 'Уникальный идентификатор'],
		];
		for (const [dto, expected] of cases) {
			assert.equal(api.typePresentation(dto), expected, JSON.stringify(dto));
		}
	});

	test('ссылки, наборы, характеристики и определяемые типы — именами платформы', () => {
		assert.equal(api.typePresentation({ types: ['cfg:CatalogRef.Валюты'] }), 'СправочникСсылка.Валюты');
		assert.equal(api.typePresentation({ types: ['cfg:ChartOfCharacteristicTypesRef.ВидыСубконто'] }), 'ПланВидовХарактеристикСсылка.ВидыСубконто');
		assert.equal(api.typePresentation({ typeSets: ['cfg:DocumentRef'] }), 'ДокументСсылка');
		assert.equal(api.typePresentation({ typeSets: ['cfg:AnyIBRef'] }), 'Любая ссылка');
		assert.equal(api.typePresentation({ typeSets: ['cfg:AnyRef'] }), 'Любая ссылка', 'EDT пишет «любую ссылку» другим именем');
		assert.equal(api.typePresentation({ typeSets: ['cfg:Characteristic.ВидыСубконто'] }), 'Характеристика.ВидыСубконто');
		assert.equal(
			api.typePresentation({ typeIds: ['92fb25e9-5b34-4411-b876-cd83fa55a6e0'], definedTypes: ['Подразделение'] }),
			'ОпределяемыйТип.Подразделение'
		);
		// Точка маршрута в словарь новых типов не входит, но записанная читается своим именем
		assert.equal(
			api.typePresentation({ types: ['cfg:BusinessProcessRoutePointRef.Задание'] }),
			'ТочкаМаршрутаБизнесПроцессаСсылка.Задание'
		);
	});

	test('составной тип — элементы через запятую в порядке файла: Type → TypeSet → TypeId', () => {
		const dto = {
			types: ['cfg:CatalogRef.Пользователи', 'xs:string'],
			typeSets: ['cfg:CatalogRef'],
			typeIds: [],
			stringQualifiers: { length: '150', allowedLength: 'VARIABLE' },
		};
		assert.equal(api.typePresentation(dto), 'СправочникСсылка.Пользователи, Строка(150), СправочникСсылка');
		assert.deepEqual(
			api.typeItems(dto).map((item) => item.list),
			['types', 'types', 'typeSets']
		);
	});

	test('словарь главнее запасной таблицы; имя определяемого типа ищется по UUID без учёта регистра', () => {
		const dictionary = {
			...DICTIONARY,
			primitives: [{ type: 'xs:boolean', label: 'Флаг' }],
			refKinds: [{ kind: 'Catalog', label: 'Справочник', platformName: 'КаталогСсылка', typeSet: 'cfg:CatalogRef', types: [] }],
		};
		assert.equal(api.typePresentation({ types: ['xs:boolean'] }, dictionary), 'Флаг');
		assert.equal(api.typePresentation({ types: ['cfg:CatalogRef.Валюты'] }, dictionary), 'КаталогСсылка.Валюты');
		assert.equal(api.typePresentation({ typeSets: ['cfg:CatalogRef'] }, dictionary), 'КаталогСсылка');
		assert.equal(
			api.typePresentation({ typeIds: ['33c3e710-0000-4000-8000-000000000001'] }, DICTIONARY),
			'ОпределяемыйТип.Организация'
		);
		assert.equal(
			api.typePresentation({ typeIds: ['00000000-1111-2222-3333-444444444444'] }, DICTIONARY),
			'Определяемый тип 00000000-1111-2222-3333-444444444444',
			'неизвестный UUID показывается как есть, без выдуманного имени'
		);
	});

	test('типы вне словаря — своей подписью или как есть; пустой тип — пустая подпись', () => {
		assert.equal(api.typePresentation({ types: ['v8:ValueTable'], editable: false }), 'Таблица значений');
		assert.equal(api.typePresentation({ types: ['v8:Null'] }), 'Null');
		assert.equal(api.typePresentation({ types: ['d5p1:SomeEnterpriseType'] }), 'd5p1:SomeEnterpriseType');
		// Тексты типов приходят из файла: имена свойств Object.prototype — просто непонятные типы
		assert.equal(api.typePresentation({ types: ['constructor', '__proto__'] }), 'constructor, __proto__');
		assert.equal(api.compatibleValue({ types: ['xs:string'] }, { type: 'constructor' }), false);
		assert.equal(api.typePresentation({ types: [], typeSets: [], typeIds: [] }), '');
		assert.equal(api.typePresentation(null), '');
		assert.equal(api.typePresentation(undefined), '');
	});

	test('каждый тип реальных схем БСП подписан без служебного префикса cfg:', () => {
		const types = corpusTypes();
		// Четыре схемы фикстуры дают 30 записанных типов: примитивы, ссылки, любая ссылка, определяемый тип
		assert.ok(types.length >= 30, `типов в фикстуре: ${types.length}`);
		for (const { where, valueType } of types) {
			const text = api.typePresentation(valueType);
			assert.notEqual(text, '', where);
			assert.ok(!text.includes('cfg:'), `${where}: ${text}`);
		}
	});
});

describe('Тип значения СКД: флажок в дереве типов', () => {
	test('без составного типа поставленный элемент остаётся единственным', () => {
		const next = api.toggleType({ ...STRING_0, editable: true }, 'cfg:CatalogRef.Валюты', false);
		assert.deepEqual(next, { types: ['cfg:CatalogRef.Валюты'], typeSets: [], typeIds: [] });
		// Признаки только-чтения считает md-sparrow: в новом типе их нет
		assert.equal('editable' in next, false);
	});

	test('в составном новый элемент дописывается в конец, прочитанный порядок сохраняется', () => {
		const read = { types: ['cfg:CatalogRef.Б', 'cfg:CatalogRef.А'], typeSets: [], typeIds: [] };
		const next = api.toggleType(read, 'xs:string', true);
		assert.deepEqual(next.types, ['cfg:CatalogRef.Б', 'cfg:CatalogRef.А', 'xs:string']);
		assert.deepEqual(next.stringQualifiers, { length: '0', allowedLength: 'VARIABLE' }, 'новый примитив — с умолчаниями');
		assert.deepEqual(read.types, ['cfg:CatalogRef.Б', 'cfg:CatalogRef.А'], 'входной DTO не меняется');
	});

	test('отмеченный элемент снимается вместе со своими квалификаторами; последний — пустой тип', () => {
		const composite = {
			types: ['xs:string', 'xs:decimal'],
			typeSets: [],
			typeIds: [],
			stringQualifiers: { length: '50', allowedLength: 'VARIABLE' },
			numberQualifiers: { digits: '15', fractionDigits: '2', allowedSign: 'ANY' },
		};
		const withoutString = api.toggleType(composite, 'xs:string', true);
		assert.deepEqual(withoutString, {
			types: ['xs:decimal'],
			typeSets: [],
			typeIds: [],
			numberQualifiers: { digits: '15', fractionDigits: '2', allowedSign: 'ANY' },
		});
		const empty = api.toggleType(withoutString, 'xs:decimal', false);
		assert.equal(api.isEmptyType(empty), true);
		assert.equal('numberQualifiers' in empty, false);
	});

	test('квалификаторы оставшихся примитивов не сбрасываются на умолчания', () => {
		const read = { types: ['xs:string'], typeSets: [], typeIds: [], stringQualifiers: { length: '64', allowedLength: 'VARIABLE' } };
		const next = api.toggleType(read, 'cfg:CatalogRef.Валюты', true);
		assert.deepEqual(next.stringQualifiers, { length: '64', allowedLength: 'VARIABLE' });
	});

	test('наборы ссылок и характеристики идут в typeSets, UUID — в typeIds', () => {
		assert.equal(api.typeListOf('cfg:CatalogRef'), 'typeSets');
		assert.equal(api.typeListOf('cfg:AnyIBRef'), 'typeSets');
		assert.equal(api.typeListOf('cfg:AnyRef'), 'typeSets');
		assert.equal(api.typeListOf('cfg:Characteristic.ВидыСубконто'), 'typeSets');
		assert.equal(api.typeListOf('cfg:CatalogRef.Валюты'), 'types');
		assert.equal(api.typeListOf('xs:string'), 'types');
		assert.equal(api.typeListOf('92fb25e9-5b34-4411-b876-cd83fa55a6e0'), 'typeIds');
		assert.equal(api.typeListOf({ typeId: '92fb25e9-5b34-4411-b876-cd83fa55a6e0', name: 'Подразделение' }), 'typeIds');
		const next = api.toggleType({ types: ['xs:boolean'] }, 'cfg:AnyIBRef', true);
		assert.deepEqual(next, { types: ['xs:boolean'], typeSets: ['cfg:AnyIBRef'], typeIds: [] });
	});

	test('определяемый тип вытесняет остальные и вытесняется ими даже в составном', () => {
		const defined = { typeId: '92fb25e9-5b34-4411-b876-cd83fa55a6e0', name: 'Подразделение' };
		const chosen = api.toggleType(STRING_0, defined, true);
		assert.deepEqual(chosen, {
			types: [],
			typeSets: [],
			typeIds: ['92fb25e9-5b34-4411-b876-cd83fa55a6e0'],
			definedTypes: ['Подразделение'],
		});
		const replaced = api.toggleType(chosen, 'xs:boolean', true);
		assert.deepEqual(replaced, { types: ['xs:boolean'], typeSets: [], typeIds: [] });
		const cleared = api.toggleType(chosen, '92FB25E9-5B34-4411-B876-CD83FA55A6E0', true);
		assert.equal(api.isEmptyType(cleared), true, 'UUID сравнивается без учёта регистра');
	});

	test('тип вне белого словаря не правится: DTO возвращается как был', () => {
		const readOnly = { types: ['v8:ValueTable'], typeSets: [], typeIds: [], editable: false, readOnlyReason: 'тип «v8:ValueTable» правится в конфигураторе' };
		assert.deepEqual(api.toggleType(readOnly, 'xs:string', false), readOnly);
	});
});

describe('Тип значения СКД: квалификаторы', () => {
	test('умолчания — самые частые в схемах БСП: строка 0 «переменная», число 0,0, дата и время', () => {
		assert.deepEqual(api.defaultQualifiers('xs:string'), { stringQualifiers: { length: '0', allowedLength: 'VARIABLE' } });
		assert.deepEqual(api.defaultQualifiers('xs:decimal'), {
			numberQualifiers: { digits: '0', fractionDigits: '0', allowedSign: 'ANY' },
		});
		assert.deepEqual(api.defaultQualifiers('xs:dateTime'), { dateQualifiers: { dateFractions: 'DATE_TIME' } });
		assert.deepEqual(api.defaultQualifiers('xs:boolean'), {});
		assert.deepEqual(api.defaultQualifiers('cfg:CatalogRef.Валюты'), {});
		const first = api.defaultQualifiers('xs:string');
		(first.stringQualifiers as Record<string, unknown>).length = '999';
		assert.equal((api.defaultQualifiers('xs:string').stringQualifiers as Record<string, unknown>).length, '0', 'каждый раз новый объект');
	});

	test('умолчания проходят собственную проверку', () => {
		for (const primitive of api.PRIMITIVES) {
			const dto = { types: [primitive.type], ...api.defaultQualifiers(primitive.type) };
			assert.deepEqual(api.validateQualifiers(dto), [], primitive.type);
		}
	});

	test('проверка повторяет отказы писателя md-sparrow', () => {
		const fields = (dto: ValueTypeDto) => api.validateQualifiers(dto).map((error) => error.field);
		assert.deepEqual(fields({ types: ['xs:string'] }), ['stringQualifiers'], 'примитив без квалификаторов');
		assert.deepEqual(fields({ types: ['xs:boolean'], dateQualifiers: { dateFractions: 'DATE' } }), ['dateQualifiers'], 'квалификатор без типа');
		assert.deepEqual(fields({ types: ['xs:string'], stringQualifiers: { length: '-1', allowedLength: 'VARIABLE' } }), [
			'stringQualifiers.length',
		]);
		assert.deepEqual(fields({ types: ['xs:string'], stringQualifiers: { length: 2.5, allowedLength: 'VARIABLE' } }), [
			'stringQualifiers.length',
		]);
		assert.deepEqual(fields({ types: ['xs:string'], stringQualifiers: { length: '10', allowedLength: 'ПЕРЕМЕННАЯ' } }), [
			'stringQualifiers.allowedLength',
		]);
		const fraction = api.validateQualifiers({
			types: ['xs:decimal'],
			numberQualifiers: { digits: '5', fractionDigits: '6', allowedSign: 'ANY' },
		});
		assert.deepEqual(fraction.map((error) => error.field), ['numberQualifiers.fractionDigits']);
		assert.match(fraction[0].message, /больше разрядности/);
		assert.deepEqual(fields({ types: ['xs:decimal'], numberQualifiers: { digits: '5', allowedSign: 'ANY' } }), [
			'numberQualifiers.fractionDigits',
		]);
		assert.deepEqual(fields({ types: ['xs:dateTime'], dateQualifiers: {} }), ['dateQualifiers.dateFractions']);
		// Разрядность — не больше 64, как у отказа писателя: загрузка 8.3.27 хранит 64, а 65 обрезает до 64
		assert.equal(api.MAX_DIGITS, 64);
		const number = (digits: string, fractionDigits = '0') => ({ types: ['xs:decimal'], numberQualifiers: { digits, fractionDigits, allowedSign: 'ANY' } });
		assert.deepEqual(api.validateQualifiers(number('64')), [], 'разрядность 64 допустима');
		assert.deepEqual(api.validateQualifiers(number('64', '64')), [], 'дробная часть может равняться разрядности');
		const over = api.validateQualifiers(number('65'));
		assert.deepEqual(over.map((error) => error.field), ['numberQualifiers.digits']);
		assert.equal(over[0].message, 'Разрядность числа (65) больше 64: платформа сохранит только 64 разряда.', 'текст отказа md-sparrow');
		assert.deepEqual(fields(number('100', '70')), ['numberQualifiers.digits'], 'дробная часть сверяется с разрядностью, а не с пределом');
		// Длину строки сверху не ограничивают ни окно, ни писатель: загрузка хранит 100000 переменной длины и 1025
		// фиксированной
		assert.deepEqual(fields({ types: ['xs:string'], stringQualifiers: { length: '100000', allowedLength: 'VARIABLE' } }), []);
		assert.deepEqual(fields({ types: ['xs:string'], stringQualifiers: { length: '1025', allowedLength: 'FIXED' } }), []);
		assert.deepEqual(fields({ types: [], binaryDataQualifiers: { length: '0', allowedLength: 'VARIABLE' } }), ['binaryDataQualifiers']);
	});

	test('числа из поля ввода и тексты файла равноправны с формой cf-dcs-info', () => {
		assert.deepEqual(
			api.validateQualifiers({
				types: ['xs:string', 'xs:decimal', 'xs:dateTime'],
				stringQualifiers: { length: 100, allowedLength: 'Fixed' },
				numberQualifiers: { digits: 15, fractionDigits: 2, allowedSign: 'Nonnegative' },
				dateQualifiers: { dateFractions: 'DateTime' },
			}),
			[]
		);
	});

	test('сообщения — по-русски, у каждой ошибки есть поле для подсветки', () => {
		const errors = api.validateQualifiers({ types: ['xs:decimal'], numberQualifiers: { digits: 'x', fractionDigits: '0', allowedSign: 'ANY' } });
		assert.equal(errors.length, 1);
		assert.equal(errors[0].field, 'numberQualifiers.digits');
		assert.match(errors[0].message, /[А-Яа-яЁё]/);
	});
});

describe('Тип значения СКД: значение параметра', () => {
	const catalog = { types: ['cfg:CatalogRef.Валюты'], typeSets: [], typeIds: [] };

	test('без типа, без значения и nil — подходит всегда', () => {
		assert.equal(api.compatibleValue(null, { type: 'xs:string', text: 'x' }), true);
		assert.equal(api.compatibleValue(catalog, null), true);
		assert.equal(api.compatibleValue(catalog, undefined), true);
		assert.equal(api.compatibleValue(catalog, { nil: true }), true);
		assert.equal(api.compatibleValue(catalog, [{ nil: true }]), true);
	});

	test('значения xs:* и стандартный период — только при том же типе', () => {
		const date = { types: ['xs:dateTime'], dateQualifiers: { dateFractions: 'DATE' } };
		assert.equal(api.compatibleValue(date, { type: 'xs:dateTime', text: '0001-01-01T00:00:00' }), true);
		assert.equal(api.compatibleValue(date, { type: 'xs:string', text: 'x' }), false);
		assert.equal(api.compatibleValue({ types: ['v8:StandardPeriod'] }, { type: 'v8:StandardPeriod', period: { variant: 'Custom' } }), true);
		assert.equal(api.compatibleValue({ types: ['xs:boolean'] }, true), true, 'скаляр поля ввода');
		assert.equal(api.compatibleValue({ types: ['xs:boolean'] }, 'true'), false);
	});

	test('пустая строка — «значение не задано» платформы: подходит к любому типу, но не в списке', () => {
		// Так же у md-sparrow: в БСП пустой строкой хранится значение параметра типа UUID
		const uuid = { types: ['v8:UUID'], typeSets: [], typeIds: [] };
		assert.equal(api.compatibleValue(uuid, { type: 'xs:string' }), true, 'valueTyped без text');
		assert.equal(api.compatibleValue(uuid, { type: 'xs:string', text: '' }), true);
		assert.equal(api.compatibleValue(catalog, { type: 'xs:string', decoded: '' }), true);
		assert.equal(api.compatibleValue(uuid, { type: 'xs:string', text: ' ' }), false, 'пробел — уже значение');
		const list = { type: 'v8:ValueListType', list: { items: [{ value: { type: 'xs:string' } }] } };
		assert.equal(api.compatibleValue(uuid, list), false, 'в списке пустая строка — обычный элемент');
	});

	test('значение конфигуратора — при ссылке того же объекта, наборе вида или любой ссылке', () => {
		const value = { type: 'dcscor:DesignTimeValue', text: 'Справочник.Валюты.ПустаяСсылка' };
		assert.equal(api.compatibleValue(catalog, value), true);
		assert.equal(api.compatibleValue({ typeSets: ['cfg:CatalogRef'] }, value), true);
		assert.equal(api.compatibleValue({ typeSets: ['cfg:AnyIBRef'] }, value), true);
		assert.equal(api.compatibleValue({ typeSets: ['cfg:AnyRef'] }, value), true);
		assert.equal(api.compatibleValue({ types: ['cfg:CatalogRef.Организации'] }, value), false);
		assert.equal(api.compatibleValue({ typeSets: ['cfg:DocumentRef'] }, value), false);
		assert.equal(
			api.compatibleValue({ types: ['cfg:EnumRef.СтатусыЗаказов'] }, { type: 'dcscor:DesignTimeValue', text: 'Enum.СтатусыЗаказов.Новый' }),
			true,
			'английское имя вида'
		);
	});

	test('список значений — каждым элементом; поле компоновки и значение вне словаря не подходят', () => {
		// nil в списке платформа хранит только единственным элементом (загрузка 8.3.27): образец без него
		const list = {
			type: 'v8:ValueListType',
			list: { items: [{ value: { type: 'xs:decimal', text: '1' } }, { value: { type: 'xs:decimal', text: '2' } }] },
		};
		assert.equal(api.compatibleValue({ types: ['xs:decimal'] }, list), true);
		assert.equal(api.compatibleValue({ types: ['xs:string'] }, list), false);
		const nilOnly = { type: 'v8:ValueListType', list: { items: [{ value: { nil: true } }] } };
		assert.equal(api.compatibleValue({ types: ['xs:string'] }, nilOnly), true, 'список из одного nil подходит к любому типу');
		assert.equal(api.compatibleValue({ types: ['xs:string'] }, { type: 'dcscor:Field', text: 'Поле' }), false);
		assert.equal(api.compatibleValue({ types: ['xs:string'] }, { type: 'v8ui:Color', text: 'auto' }), false);
	});

	test('пустое значение типа — формы параметров схем БСП', () => {
		assert.deepEqual(api.emptyValueFor(STRING_0), { type: 'xs:string', text: '' });
		assert.deepEqual(api.emptyValueFor({ types: ['xs:boolean'] }), { type: 'xs:boolean', text: 'false' });
		assert.deepEqual(api.emptyValueFor({ types: ['xs:decimal'] }), { type: 'xs:decimal', text: '0' });
		assert.deepEqual(api.emptyValueFor({ types: ['xs:dateTime'] }), { type: 'xs:dateTime', text: '0001-01-01T00:00:00' });
		assert.deepEqual(api.emptyValueFor({ types: ['v8:StandardPeriod'] }), {
			type: 'v8:StandardPeriod',
			period: { variant: 'Custom', startDate: '0001-01-01T00:00:00', endDate: '0001-01-01T00:00:00' },
		});
		assert.deepEqual(api.emptyValueFor(catalog), { type: 'dcscor:DesignTimeValue', text: 'Справочник.Валюты.ПустаяСсылка' });
		assert.deepEqual(api.emptyValueFor({ types: ['cfg:DocumentRef.Анкета'] }), {
			type: 'dcscor:DesignTimeValue',
			text: 'Документ.Анкета.ПустаяСсылка',
		});
	});

	test('у составного типа, наборов и определяемого типа пустого значения нет — «без значения»', () => {
		assert.equal(api.emptyValueFor({ types: ['xs:string', 'xs:decimal'] }), null);
		assert.equal(api.emptyValueFor({ typeSets: ['cfg:AnyIBRef'] }), null);
		assert.equal(api.emptyValueFor({ typeIds: ['92fb25e9-5b34-4411-b876-cd83fa55a6e0'] }), null);
		assert.equal(api.emptyValueFor(null), null);
	});

	test('пустое значение подходит к своему типу у каждого параметра фикстуры', () => {
		for (const { where, valueType } of corpusTypes()) {
			const value = api.emptyValueFor(valueType);
			assert.equal(api.compatibleValue(valueType, value), true, where);
		}
	});
});

/**
 * Словарь отдаёт состав определяемого типа (`definedTypes[].composition`, форма valueType), и значение
 * параметра определяемого типа сверяется с ним так же, как в md-sparrow: к своим types/typeSets
 * дописываются types/typeSets состава. Составы — как в БСП 3.1 (ДенежнаяСуммаЛюбогоЗнака — число,
 * Подразделение — одна ссылка, БезопасныйРежим — два типа); набор ссылок вида в составе — синтетика.
 */
describe('Тип значения СКД: состав определяемого типа', () => {
	const MONEY = 'A1B2C3D4-0000-4000-8000-000000000001';
	const DEPARTMENT = 'a1b2c3d4-0000-4000-8000-000000000002';
	const SAFE_MODE = 'a1b2c3d4-0000-4000-8000-000000000003';
	const ANY_CATALOG = 'a1b2c3d4-0000-4000-8000-000000000004';
	const NO_DESCRIPTION = 'a1b2c3d4-0000-4000-8000-000000000005';
	const WITH_COMPOSITION = {
		...DICTIONARY,
		definedTypes: [
			{
				name: 'ДенежнаяСуммаЛюбогоЗнака',
				typeId: MONEY,
				composition: { types: ['xs:decimal'], typeSets: [], typeIds: [], numberQualifiers: { digits: '15', fractionDigits: '2', allowedSign: 'ANY' } },
			},
			{ name: 'Подразделение', typeId: DEPARTMENT, composition: { types: ['cfg:CatalogRef.Подразделения'], typeSets: [], typeIds: [] } },
			{
				name: 'БезопасныйРежим',
				typeId: SAFE_MODE,
				composition: { types: ['xs:boolean', 'xs:string'], typeSets: [], typeIds: [], stringQualifiers: { length: '120', allowedLength: 'VARIABLE' } },
			},
			{ name: 'ЛюбойСправочник', typeId: ANY_CATALOG, composition: { types: [], typeSets: ['cfg:CatalogRef'], typeIds: [] } },
			// Описание не найдено в выгрузке: ключа composition нет
			{ name: 'БезОписания', typeId: NO_DESCRIPTION },
		],
	};
	const defined = (typeId: string) => ({ types: [], typeSets: [], typeIds: [typeId] });
	const zero = { type: 'xs:decimal', text: '0' };
	const department = { type: 'dcscor:DesignTimeValue', text: 'Справочник.Подразделения.ПустаяСсылка' };

	test('без словаря и без состава подходят только «не задано», nil и пустая строка', () => {
		for (const dictionary of [undefined, null, DICTIONARY, WITH_COMPOSITION]) {
			const typeId = dictionary === WITH_COMPOSITION ? NO_DESCRIPTION : MONEY;
			assert.equal(api.compatibleValue(defined(typeId), zero, dictionary), false, JSON.stringify(dictionary && Object.keys(dictionary)));
			assert.equal(api.compatibleValue(defined(typeId), { nil: true }, dictionary), true);
			assert.equal(api.compatibleValue(defined(typeId), { type: 'xs:string' }, dictionary), true);
			assert.equal(api.compatibleValue(defined(typeId), undefined, dictionary), true);
		}
	});

	test('значение из состава подходит, вне состава — нет; UUID ищется без учёта регистра', () => {
		assert.equal(api.compatibleValue(defined(MONEY), zero, WITH_COMPOSITION), true);
		assert.equal(api.compatibleValue(defined(MONEY.toLowerCase()), zero, WITH_COMPOSITION), true);
		assert.equal(api.compatibleValue(defined(MONEY), { type: 'xs:boolean', text: 'true' }, WITH_COMPOSITION), false);
		assert.equal(api.compatibleValue(defined(DEPARTMENT.toUpperCase()), department, WITH_COMPOSITION), true);
		assert.equal(
			api.compatibleValue(defined(DEPARTMENT), { type: 'dcscor:DesignTimeValue', text: 'Справочник.Валюты.ПустаяСсылка' }, WITH_COMPOSITION),
			false,
			'ссылка другого объекта'
		);
		assert.equal(api.compatibleValue(defined(SAFE_MODE), { type: 'xs:boolean', text: 'false' }, WITH_COMPOSITION), true);
		assert.equal(api.compatibleValue(defined(SAFE_MODE), { type: 'xs:string', text: 'x' }, WITH_COMPOSITION), true);
		assert.equal(api.compatibleValue(defined(SAFE_MODE), zero, WITH_COMPOSITION), false);
	});

	test('набор ссылок вида в составе и список значений сверяются как у обычного типа', () => {
		assert.equal(api.compatibleValue(defined(ANY_CATALOG), department, WITH_COMPOSITION), true);
		assert.equal(
			api.compatibleValue(defined(ANY_CATALOG), { type: 'dcscor:DesignTimeValue', text: 'Документ.Заказ.ПустаяСсылка' }, WITH_COMPOSITION),
			false
		);
		const list = (values: unknown[]) => ({ type: 'v8:ValueListType', list: { items: values.map((value) => ({ value })) } });
		assert.equal(api.compatibleValue(defined(MONEY), list([zero, { type: 'xs:decimal', text: '5' }]), WITH_COMPOSITION), true);
		assert.equal(api.compatibleValue(defined(MONEY), list([zero, { type: 'xs:string', text: '5' }]), WITH_COMPOSITION), false);
		assert.equal(api.compatibleValue(defined(MONEY), [zero], WITH_COMPOSITION), true, 'массив значений варианта');
	});

	test('пустое значение: состав из одного типа — пустое значение этого типа, иначе «без значения»', () => {
		assert.deepEqual(api.emptyValueFor(defined(MONEY), WITH_COMPOSITION), zero);
		assert.deepEqual(api.emptyValueFor(defined(DEPARTMENT), WITH_COMPOSITION), department);
		assert.equal(api.emptyValueFor(defined(SAFE_MODE), WITH_COMPOSITION), null, 'два типа');
		assert.equal(api.emptyValueFor(defined(ANY_CATALOG), WITH_COMPOSITION), null, 'набор ссылок');
		assert.equal(api.emptyValueFor(defined(NO_DESCRIPTION), WITH_COMPOSITION), null, 'без состава');
		assert.equal(api.emptyValueFor(defined(MONEY)), null, 'без словаря');
		for (const typeId of [MONEY, DEPARTMENT]) {
			assert.equal(api.compatibleValue(defined(typeId), api.emptyValueFor(defined(typeId), WITH_COMPOSITION), WITH_COMPOSITION), true);
		}
	});

	test('очистка значения в окне типа: подходящее к составу остаётся, неподходящее — к пустому значению состава', () => {
		const fromNumber = { valueType: { types: ['xs:decimal'], typeSets: [], typeIds: [] }, value: { type: 'xs:decimal', text: '5' } };
		const toMoney = { valueType: { types: [], typeSets: [], typeIds: [MONEY], definedTypes: ['ДенежнаяСуммаЛюбогоЗнака'] } };
		const kept = api.typeEditPayload(fromNumber, toMoney, WITH_COMPOSITION);
		assert.deepEqual(kept.payload, { valueType: { types: [], typeSets: [], typeIds: [MONEY] } }, 'число подходит к составу — значение не трогается');
		assert.equal(kept.valueChange, null);
		const conservative = api.typeEditPayload(fromNumber, toMoney);
		assert.equal(conservative.payload.value, null, 'без словаря значение снимается');

		const fromBoolean = { valueType: { types: ['xs:boolean'], typeSets: [], typeIds: [] }, value: { type: 'xs:boolean', text: 'true' } };
		const cleared = api.typeEditPayload(fromBoolean, toMoney, WITH_COMPOSITION);
		assert.deepEqual(cleared.payload.value, zero, 'булево не подходит — пустое значение состава');
		assert.deepEqual(cleared.valueChange, { value: zero });
		const toSafeMode = api.typeEditPayload(fromBoolean, { valueType: defined(SAFE_MODE) }, WITH_COMPOSITION);
		assert.equal('value' in toSafeMode.payload, false, 'булево есть в составе');
		const toDepartment = api.typeEditPayload(fromBoolean, { valueType: defined(DEPARTMENT) }, WITH_COMPOSITION);
		assert.deepEqual(toDepartment.payload.value, department);
		assert.deepEqual(api.valueClearing(defined(SAFE_MODE), zero, WITH_COMPOSITION), { value: null }, 'состав из двух типов — значение снимается');
	});

	test('состав в словаре не меняет подпись и дерево: определяемый тип — одной строкой с именем', () => {
		assert.equal(api.typePresentation(defined(MONEY), WITH_COMPOSITION), 'ОпределяемыйТип.ДенежнаяСуммаЛюбогоЗнака');
		const node = api.typeTree(WITH_COMPOSITION, '').find((item) => item.key === 'defined');
		assert.ok(node);
		assert.deepEqual(
			node.rows.map((row) => row.label),
			['ДенежнаяСуммаЛюбогоЗнака', 'Подразделение', 'БезопасныйРежим', 'ЛюбойСправочник', 'БезОписания']
		);
	});
});

/**
 * Состав определяемого типа и характеристики — в title и aria-description, подпись «ОпределяемыйТип.X»
 * не меняется. Записи составов — в форме typeCompositions md-sparrow, пришитые к типу (`compositions`,
 * DcsFieldTypes.attachTypeCompositions); составы — как в query-tables-ssl31.json.
 */
describe('Тип значения СКД: состав во всплывающей подсказке (compositionTitle)', () => {
	const PERSON_RECORD = { source: 'cfg:DefinedType.ФизическоеЛицо', types: ['cfg:CatalogRef._ДемоФизическиеЛица'], typeSets: [] as string[] };
	const PROPERTY_RECORD = {
		source: 'cfg:Characteristic.ДополнительныеРеквизитыИСведения',
		types: ['cfg:CatalogRef.ЗначенияСвойствОбъектовИерархия', 'xs:boolean', 'cfg:CatalogRef.ЗначенияСвойствОбъектов', 'xs:string', 'xs:dateTime', 'xs:decimal', 'cfg:CatalogRef._ДемоПартнеры', 'cfg:CatalogRef.Пользователи'],
		typeSets: [] as string[],
	};
	const ACCESS_UUID = '9a33b5dc-a8f1-496e-9961-95890984cd86';
	const ACCESS_RECORD = {
		source: ACCESS_UUID,
		name: 'ЗначениеДоступа',
		types: Array.from({ length: 25 }, (_, index) => 'cfg:CatalogRef.Доступ' + (index + 1)),
		typeSets: [] as string[],
	};
	const person = { types: [] as string[], typeSets: ['cfg:DefinedType.ФизическоеЛицо'], typeIds: [] as string[], compositions: [PERSON_RECORD] };

	test('одна ссылка — «Состав: СправочникСсылка.X»; подпись типа не меняется', () => {
		assert.equal(api.compositionTitle(person), 'Состав: СправочникСсылка._ДемоФизическиеЛица');
		assert.equal(api.typePresentation(person), 'ОпределяемыйТип.ФизическоеЛицо', 'подпись не удлиняется');
		assert.equal(api.compositionTitle(person, DICTIONARY), 'Состав: СправочникСсылка._ДемоФизическиеЛица', 'имя вида — из словаря, если он есть');
	});

	test('25 ссылок по UUID схемы — первые пять и «и ещё 20»; характеристика — ссылки и примитивы подписями типа', () => {
		const access = { types: [], typeSets: [], typeIds: [ACCESS_UUID.toUpperCase()], compositions: [ACCESS_RECORD] };
		assert.equal(
			api.compositionTitle(access),
			'Состав: СправочникСсылка.Доступ1, СправочникСсылка.Доступ2, СправочникСсылка.Доступ3, СправочникСсылка.Доступ4, СправочникСсылка.Доступ5 и ещё 20'
		);
		assert.equal(api.typePresentation(access), 'Определяемый тип ' + ACCESS_UUID.toUpperCase(), 'без имени в типе и словаре подпись — по UUID');
		const property = { types: [], typeSets: [PROPERTY_RECORD.source], typeIds: [], compositions: [PROPERTY_RECORD] };
		assert.equal(
			api.compositionTitle(property),
			'Состав: СправочникСсылка.ЗначенияСвойствОбъектовИерархия, Булево, СправочникСсылка.ЗначенияСвойствОбъектов, Строка, Дата и ещё 3'
		);
		// Ровно пять — без «и ещё»
		const five = { ...access, compositions: [{ ...ACCESS_RECORD, types: ACCESS_RECORD.types.slice(0, 5) }] };
		assert.ok(!api.compositionTitle(five).includes('и ещё'));
	});

	test('несколько составов (тёзки слиты в один тип) — строка на каждый с именем типа; тот же источник дважды — одна строка', () => {
		const division = { source: 'cfg:DefinedType.Подразделение', types: ['cfg:CatalogRef._ДемоПодразделения'], typeSets: [] };
		const merged = {
			types: ['cfg:CatalogRef.Пользователи'],
			typeSets: ['cfg:DefinedType.ФизическоеЛицо', 'cfg:DefinedType.Подразделение', 'cfg:CatalogRef'],
			typeIds: [ACCESS_UUID],
			definedTypes: ['ЗначениеДоступа'],
			compositions: [PERSON_RECORD, division, { ...division, source: 'CFG:DEFINEDTYPE.ПОДРАЗДЕЛЕНИЕ', types: ['cfg:CatalogRef.Другое'] }, ACCESS_RECORD],
		};
		assert.deepEqual(api.compositionTitle(merged).split('\n'), [
			'Состав ОпределяемыйТип.ФизическоеЛицо: СправочникСсылка._ДемоФизическиеЛица',
			'Состав ОпределяемыйТип.Подразделение: СправочникСсылка._ДемоПодразделения',
			'Состав ОпределяемыйТип.ЗначениеДоступа: СправочникСсылка.Доступ1, СправочникСсылка.Доступ2, СправочникСсылка.Доступ3, СправочникСсылка.Доступ4, СправочникСсылка.Доступ5 и ещё 20',
		]);
		// Имя определяемого типа — из записи cf-dcs-info, когда его нет ни в типе, ни в словаре
		const unnamed = { types: [], typeSets: [], typeIds: [ACCESS_UUID, 'ffffffff-0000-4000-8000-000000000000'], compositions: [ACCESS_RECORD, PERSON_RECORD] };
		assert.ok(api.compositionTitle(unnamed).startsWith('Состав: СправочникСсылка.Доступ1'), 'UUID без записи состава не даёт строки');
		const twoIds = { ...unnamed, compositions: [ACCESS_RECORD, { ...PERSON_RECORD, source: 'ffffffff-0000-4000-8000-000000000000', name: 'ФизическоеЛицо' }] };
		assert.ok(api.compositionTitle(twoIds).split('\n')[1].startsWith('Состав ОпределяемыйТип.ФизическоеЛицо: '));
	});

	test('без пришитых составов — из словаря окна типа (UUID и имя), с квалификаторами; нет состава нигде — пустая строка', () => {
		const MONEY = 'A1B2C3D4-0000-4000-8000-000000000001';
		const dictionary = {
			...DICTIONARY,
			definedTypes: [
				{
					name: 'ДенежнаяСуммаЛюбогоЗнака',
					typeId: MONEY,
					composition: { types: ['xs:decimal'], typeSets: [], typeIds: [], numberQualifiers: { digits: '15', fractionDigits: '2', allowedSign: 'ANY' } },
				},
				{ name: 'БезОписания', typeId: 'a1b2c3d4-0000-4000-8000-000000000005' },
			],
		};
		assert.equal(api.compositionTitle({ types: [], typeSets: [], typeIds: [MONEY.toLowerCase()] }, dictionary), 'Состав: Число(15, 2)');
		assert.equal(api.compositionTitle({ types: [], typeSets: ['cfg:DefinedType.ДенежнаяСуммаЛюбогоЗнака'], typeIds: [] }, dictionary), 'Состав: Число(15, 2)', 'набор — по имени');
		assert.equal(api.compositionTitle({ types: [], typeSets: [], typeIds: ['a1b2c3d4-0000-4000-8000-000000000005'] }, dictionary), '', 'описание не найдено');
		// Пришитая запись главнее словаря
		const attached = { types: [], typeSets: [], typeIds: [MONEY], compositions: [{ source: MONEY, types: ['xs:string'], typeSets: [] }] };
		assert.equal(api.compositionTitle(attached, dictionary), 'Состав: Строка');
		for (const dto of [null, undefined, STRING_0, { types: ['cfg:CatalogRef.Валюты'], typeSets: ['cfg:CatalogRef', 'cfg:AnyIBRef'] }, { typeSets: ['cfg:DefinedType.ФизическоеЛицо'] }]) {
			assert.equal(api.compositionTitle(dto, DICTIONARY), '', JSON.stringify(dto));
		}
		// Мусор в записях не роняет и строк не даёт
		assert.equal(api.compositionTitle({ typeSets: ['cfg:DefinedType.ФизическоеЛицо'], compositions: [null, 'x', { source: '' }, { source: 'cfg:DefinedType.ФизическоеЛицо' }] }), '');
	});

	test('пришитые составы не видны payload и сравнению: тип с compositions — тот же тип, в jar уходят только известные ключи', () => {
		const bare = { types: [], typeSets: ['cfg:DefinedType.ФизическоеЛицо'], typeIds: [] };
		assert.equal(api.sameType(person, bare), true);
		assert.deepEqual(api.payloadType(person), bare);
		assert.equal('compositions' in (api.payloadType(person) ?? {}), false);
		const edited = api.typeEditPayload({ valueType: person }, { valueType: JSON.parse(JSON.stringify(person)) });
		assert.deepEqual(edited.payload, {}, 'тот же тип с составом — правки нет');
	});
});

describe('Тип значения СКД: сравнение «слать ли payload»', () => {
	test('эхо прочитанного DTO — тот же тип у каждого типа фикстуры', () => {
		for (const { where, valueType } of corpusTypes()) {
			assert.equal(api.sameType(valueType, JSON.parse(JSON.stringify(valueType))), true, where);
		}
	});

	test('числа сравниваются числами, константы — без разницы между текстом файла и именем', () => {
		assert.equal(api.sameType(STRING_0, { types: ['xs:string'], stringQualifiers: { length: 0, allowedLength: 'Variable' } }), true);
		assert.equal(
			api.sameType(
				{ types: ['xs:dateTime'], dateQualifiers: { dateFractions: 'DATE_TIME' } },
				{ types: ['xs:dateTime'], dateQualifiers: { dateFractions: 'DateTime' } }
			),
			true
		);
		assert.equal(api.sameType(STRING_0, { ...STRING_0, stringQualifiers: { length: '10', allowedLength: 'VARIABLE' } }), false);
	});

	test('перестановка элементов — другой тип: порядок в файле тоже правка', () => {
		const a = { types: ['xs:string', 'xs:boolean'], stringQualifiers: { length: '0', allowedLength: 'VARIABLE' } };
		const b = { types: ['xs:boolean', 'xs:string'], stringQualifiers: { length: '0', allowedLength: 'VARIABLE' } };
		assert.equal(api.sameType(a, b), false);
	});

	test('подписи, признаки только-чтения и регистр UUID не различают типы', () => {
		const read = {
			types: [],
			typeSets: [],
			typeIds: ['92fb25e9-5b34-4411-b876-cd83fa55a6e0'],
			definedTypes: ['Подразделение'],
			editable: true,
		};
		assert.equal(api.sameType(read, { typeIds: ['92FB25E9-5B34-4411-B876-CD83FA55A6E0'] }), true);
		assert.equal(api.sameType(null, { types: [], typeSets: [], typeIds: [] }), true, 'нет типа и пустой тип — одно');
		assert.equal(api.sameType(null, STRING_0), false);
	});

	test('поставить и снять тот же флажок — тип прежний, мутация не уходит', () => {
		const read = { types: ['cfg:CatalogRef.Пользователи'], typeSets: [], typeIds: [], editable: true };
		const roundTrip = api.toggleType(api.toggleType(read, 'xs:string', true), 'xs:string', true);
		assert.equal(api.sameType(read, roundTrip), true);
	});
});

describe('Тип значения СКД: дерево окна типа', () => {
	const BIG = {
		...DICTIONARY,
		refKinds: [
			...DICTIONARY.refKinds,
			{
				kind: 'Document',
				label: 'Документ',
				platformName: 'ДокументСсылка',
				typeSet: 'cfg:DocumentRef',
				types: ['cfg:DocumentRef.Анкета', 'cfg:DocumentRef.ЗаказПокупателя'],
			},
		],
	};

	test('узлы в порядке окна: примитивы, любая ссылка, виды, характеристики, определяемые', () => {
		const tree = api.typeTree(BIG, '');
		assert.deepEqual(
			tree.map((node) => node.key),
			['primitives', 'anyRef', 'kind:Catalog', 'kind:Document', 'characteristics', 'defined']
		);
		const kind = tree.find((node) => node.key === 'kind:Document');
		assert.equal(kind?.typeSet, 'cfg:DocumentRef', 'флажок вида — «любая ссылка вида»');
		assert.equal(kind?.platformName, 'ДокументСсылка');
		assert.deepEqual(
			kind?.rows.map((row) => row.label),
			['Анкета', 'ЗаказПокупателя'],
			'объекты — по имени'
		);
		assert.equal(tree.find((node) => node.key === 'anyRef')?.value, 'cfg:AnyIBRef');
		assert.deepEqual(tree.find((node) => node.key === 'defined')?.rows[0].value, {
			typeId: '33C3E710-0000-4000-8000-000000000001',
			name: 'Организация',
		});
		assert.ok(
			tree.every((node) => !node.open),
			'без поиска узлы не раскрываются сами'
		);
	});

	test('без словаря — только примитивы: их писатель примет всегда', () => {
		for (const dictionary of [null, undefined, {}]) {
			const tree = api.typeTree(dictionary, '');
			assert.deepEqual(
				tree.map((node) => node.key),
				['primitives']
			);
			assert.deepEqual(
				tree[0].rows.map((row) => row.value),
				api.PRIMITIVES.map((primitive) => primitive.type)
			);
		}
	});

	test('вне выгрузки — примитивы и «любая ссылка» формата файла', () => {
		const outside = {
			configurationFound: false,
			anyRef: 'cfg:AnyRef',
			primitives: DICTIONARY.primitives,
			refKinds: [],
			characteristics: [],
			definedTypes: [],
		};
		const tree = api.typeTree(outside, '');
		assert.deepEqual(
			tree.map((node) => node.key),
			['primitives', 'anyRef']
		);
		assert.equal(tree[1].value, 'cfg:AnyRef');
	});

	test('поиск: подстрока без регистра по подписи и полному имени, узел с находками раскрыт', () => {
		const byName = api.typeTree(BIG, 'заказ');
		assert.deepEqual(
			byName.map((node) => node.key),
			['kind:Document']
		);
		assert.deepEqual(
			byName[0].rows.map((row) => row.label),
			['ЗаказПокупателя']
		);
		assert.equal(byName[0].open, true);
		assert.equal(byName[0].total, 2, 'всего объектов вида — для бейджа');
		const byPlatform = api.typeTree(BIG, 'справочникссылка.вал');
		assert.deepEqual(
			byPlatform.map((node) => node.key),
			['kind:Catalog']
		);
		const byKind = api.typeTree(BIG, 'документ');
		assert.equal(byKind[0].rows.length, 2, 'совпало имя вида — все его объекты');
		assert.ok(!byKind[0].open, 'совпало имя вида — раскрывает пользователь');
		assert.deepEqual(
			api.typeTree(BIG, 'строк').map((node) => node.key),
			['primitives']
		);
		assert.deepEqual(
			api.typeTree(BIG, 'любая').map((node) => node.key),
			['anyRef']
		);
		assert.deepEqual(
			api.typeTree(BIG, 'определяемый').map((node) => node.key),
			['defined']
		);
		assert.deepEqual(api.typeTree(BIG, 'нет такого типа'), []);
	});

	test('отмеченность строки: UUID без регистра, набор вида и характеристика — в typeSets', () => {
		const dto = {
			types: ['xs:string'],
			typeSets: ['cfg:DocumentRef', 'cfg:Characteristic.ВидыСубконто'],
			typeIds: [],
			stringQualifiers: { length: '0', allowedLength: 'VARIABLE' },
		};
		assert.equal(api.hasType(dto, 'xs:string'), true);
		assert.equal(api.hasType(dto, 'cfg:DocumentRef'), true);
		assert.equal(api.hasType(dto, 'cfg:DocumentRef.Анкета'), false, 'набор вида не отмечает объекты');
		assert.equal(api.hasType(dto, 'cfg:Characteristic.ВидыСубконто'), true);
		const defined = { types: [], typeSets: [], typeIds: ['33c3e710-0000-4000-8000-000000000001'] };
		assert.equal(
			api.hasType(defined, { typeId: '33C3E710-0000-4000-8000-000000000001', name: 'Организация' }),
			true
		);
		assert.equal(api.hasType(null, 'xs:string'), false);
		assert.equal(api.hasType(dto, ''), false);
	});
});

describe('Тип значения СКД: payload правки из итога диалога', () => {
	const catalog = { types: ['cfg:CatalogRef.Валюты'], typeSets: [], typeIds: [], editable: true };

	test('без изменений — пустой payload: окно закрывается без записи', () => {
		for (const { where, valueType } of corpusTypes()) {
			const result = api.typeEditPayload({ valueType }, { valueType: JSON.parse(JSON.stringify(valueType)) });
			assert.deepEqual(result.payload, {}, where);
		}
		assert.deepEqual(
			api.typeEditPayload({}, { valueType: { types: [], typeSets: [], typeIds: [] } }).payload,
			{},
			'без типа и пустой тип'
		);
		assert.deepEqual(
			api.typeEditPayload(
				{ valueListAllowed: true, availableAsField: false },
				{ valueListAllowed: true, availableAsField: false }
			).payload,
			{}
		);
	});

	test('новый тип уходит формой cf-dcs-info без подписей и признаков только-чтения', () => {
		let edited = api.toggleType(STRING_0, 'cfg:CatalogRef.Валюты', true);
		edited = api.toggleType(edited, 'xs:decimal', true);
		const result = api.typeEditPayload({ valueType: STRING_0 }, { valueType: edited });
		assert.deepEqual(result.payload, {
			valueType: {
				types: ['xs:string', 'cfg:CatalogRef.Валюты', 'xs:decimal'],
				typeSets: [],
				typeIds: [],
				stringQualifiers: { length: '0', allowedLength: 'VARIABLE' },
				numberQualifiers: { digits: '0', fractionDigits: '0', allowedSign: 'ANY' },
			},
		});
		const defined = api.toggleType(
			null,
			{ typeId: '33C3E710-0000-4000-8000-000000000001', name: 'Организация' },
			false
		);
		const definedPayload = api.typeEditPayload({}, { valueType: defined }).payload;
		assert.deepEqual(
			definedPayload.valueType,
			{ types: [], typeSets: [], typeIds: ['33C3E710-0000-4000-8000-000000000001'] },
			'имя определяемого типа не уходит: адрес — UUID'
		);
	});

	test('снятый тип — valueType: null (пустого элемента платформа не пишет)', () => {
		const cleared = api.toggleType(catalog, 'cfg:CatalogRef.Валюты', false);
		assert.deepEqual(api.typeEditPayload({ valueType: catalog }, { valueType: cleared }).payload, { valueType: null });
	});

	test('ошибка квалификатора — отказ с полем, payload не собирается', () => {
		const broken = { ...STRING_0, stringQualifiers: { length: '-1', allowedLength: 'VARIABLE' } };
		const result = api.typeEditPayload({ valueType: STRING_0 }, { valueType: broken });
		assert.deepEqual(result.payload, {});
		assert.match(result.error ?? '', /длина строки/i);
		assert.equal(result.errors?.[0].field, 'stringQualifiers.length');
	});

	test('тип вне словаря не правится: отказ, а не запись', () => {
		const opaque = {
			types: ['v8:ValueTable'],
			typeSets: [],
			typeIds: [],
			editable: false,
			readOnlyReason: 'тип «v8:ValueTable» правится в конфигураторе',
		};
		const result = api.typeEditPayload({ valueType: opaque }, { valueType: STRING_0 });
		assert.deepEqual(result.payload, {});
		assert.match(result.error ?? '', /правится в конфигураторе/);
		assert.deepEqual(
			api.typeEditPayload({ valueType: opaque }, { valueType: opaque, valueListAllowed: true }).payload,
			{ valueListAllowed: true },
			'признаки параметра при таком типе правятся'
		);
	});

	test('несовместимое значение при смене типа очищается до пустого значения нового типа', () => {
		const original = {
			valueType: { types: ['xs:boolean'], typeSets: [], typeIds: [] },
			value: { type: 'xs:boolean', text: 'true', decoded: true },
		};
		const toDate = api.typeEditPayload(original, {
			valueType: api.toggleType(original.valueType, 'xs:dateTime', false),
		});
		assert.deepEqual(toDate.payload.value, { type: 'xs:dateTime', text: '0001-01-01T00:00:00' });
		assert.deepEqual(toDate.valueChange, { value: { type: 'xs:dateTime', text: '0001-01-01T00:00:00' } });
		const toRef = api.typeEditPayload(original, {
			valueType: api.toggleType(original.valueType, 'cfg:CatalogRef.Валюты', false),
		});
		assert.deepEqual(toRef.payload.value, { type: 'dcscor:DesignTimeValue', text: 'Справочник.Валюты.ПустаяСсылка' });
		const toComposite = api.typeEditPayload(original, {
			valueType: api.toggleType(original.valueType, 'xs:string', true),
		});
		assert.equal('value' in toComposite.payload, false, 'булево осталось в составе — значение подходит');
		const toSet = api.typeEditPayload(original, {
			valueType: api.toggleType(original.valueType, 'cfg:AnyIBRef', false),
		});
		assert.equal(toSet.payload.value, null, 'у набора пустого значения нет — значение снимается');
	});

	test('список значений параметра схемы окно не пишет: подходящий остаётся, неподходящий заменяется не списком', () => {
		// Платформа хранит список параметра схемы повторяющимися значениями без представлений, а nil — только
		// единственным элементом (загрузка 8.3.27); md-sparrow отказывает в представлении и в nil среди других.
		// Окно типа список не собирает: в payload уходит лишь пустое значение нового типа или снятие.
		const string = { types: ['xs:string'], typeSets: [], typeIds: [], stringQualifiers: { length: '0', allowedLength: 'VARIABLE' } };
		const list = (...items: Array<Record<string, unknown>>) => ({ type: 'v8:ValueListType', list: { items } });
		const letter = (text: string) => ({ value: { type: 'xs:string', text } });
		const lists = [
			list({ value: { nil: true } }),
			list(letter('A'), letter('B')),
			// Формы старой или ручной записи: md-sparrow их читает, но новую такую запись отклонит
			list({ value: { nil: true } }, letter('A')),
			list({ ...letter('A'), presentation: 'Буква А' }),
		];
		const targets = [
			api.toggleType(string, 'xs:decimal', false),
			api.toggleType(string, 'cfg:CatalogRef.Валюты', false),
			api.toggleType(string, 'xs:decimal', true),
			api.toggleType(string, 'cfg:AnyIBRef', false),
		];
		for (const value of lists) {
			for (const target of targets) {
				const result = api.typeEditPayload({ valueType: string, value, valueListAllowed: true }, { valueType: target });
				const sent = result.payload.value as Record<string, unknown> | null | undefined;
				assert.ok(!(sent && (sent.list || sent.type === 'v8:ValueListType')), `список в payload: ${JSON.stringify(value)}`);
			}
		}
		const single = api.typeEditPayload({ valueType: string, value: lists[0], valueListAllowed: true }, { valueType: targets[1] });
		assert.equal('value' in single.payload, false, 'список из одного nil подходит к любому типу и не трогается');
	});

	test('подходящее значение, nil, пустая строка и отсутствие значения не трогаются', () => {
		const date = { types: ['xs:dateTime'], typeSets: [], typeIds: [], dateQualifiers: { dateFractions: 'DATE' } };
		const dateTime = { ...date, dateQualifiers: { dateFractions: 'DATE_TIME' } };
		const values = [undefined, { nil: true }, { type: 'xs:string' }, { type: 'xs:dateTime', text: '2026-01-01T00:00:00' }];
		for (const value of values) {
			const result = api.typeEditPayload({ valueType: date, value }, { valueType: dateTime });
			assert.deepEqual(result.payload, { valueType: api.payloadType(dateTime) }, JSON.stringify(value));
			assert.equal(result.valueChange, null);
		}
	});

	test('значение вне белого списка не заменить — отказ', () => {
		const original = { valueType: STRING_0, value: { type: 'v8ui:Color', text: 'auto', opaque: true } };
		const result = api.typeEditPayload(original, { valueType: { types: ['xs:boolean'], typeSets: [], typeIds: [] } });
		assert.deepEqual(result.payload, {});
		assert.deepEqual(result.valueChange, { blocked: true });
		assert.ok(result.error);
	});

	test('признаки параметра — только отличия от прочитанного с учётом умолчаний', () => {
		assert.deepEqual(api.PARAMETER_FLAG_DEFAULTS, {
			valueListAllowed: false,
			availableAsField: true,
			denyIncompleteValues: false,
		});
		assert.deepEqual(
			api.typeEditPayload({}, { valueListAllowed: false, availableAsField: true, denyIncompleteValues: false }).payload,
			{},
			'умолчания при отсутствии в файле — не правка'
		);
		assert.deepEqual(
			api.typeEditPayload({}, { valueListAllowed: true, availableAsField: false, denyIncompleteValues: true }).payload,
			{ valueListAllowed: true, availableAsField: false, denyIncompleteValues: true }
		);
		assert.deepEqual(api.typeEditPayload({ valueListAllowed: true }, { valueListAllowed: false }).payload, {
			valueListAllowed: false,
		});
		assert.deepEqual(api.typeEditPayload({ valueListAllowed: true }, {}).payload, {}, 'не переданный признак не трогается');
	});

	test('у поля и вычисляемого поля в payload только тип', () => {
		const result = api.typeEditPayload(
			{ valueType: STRING_0 },
			{ valueType: { types: ['xs:boolean'], typeSets: [], typeIds: [] } }
		);
		assert.deepEqual(Object.keys(result.payload), ['valueType']);
	});
});

describe('Тип значения СКД: подключение к webview', () => {
	// Концы строк приводятся к \n: рабочая копия на Windows хранит файлы с \r\n (autocrlf)
	const read = (file: string): string => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
	const webview = path.join(ROOT, 'resources', 'webview');

	test('модуль подключён до основного скрипта, панель подставляет его адрес', () => {
		const html = read(path.join(webview, 'dcs-editor.html'));
		const at = html.indexOf('{{TYPES_JS_URI}}');
		assert.ok(at >= 0, 'в шаблоне нет {{TYPES_JS_URI}}');
		assert.ok(at < html.indexOf('{{JS_URI}}'), 'модуль типа подключён позже скрипта');
		assert.ok(readEditorScript().includes('window.DcsTypes'), 'скрипт не берёт модуль типа');
		const panel = read(path.join(ROOT, 'src', 'features', 'metadata', 'dcsEditorPanel.ts'));
		assert.ok(panel.includes("'dcs-editor-types.js'"), 'панель не знает файл модуля');
		assert.ok(panel.includes("replaceAll('{{TYPES_JS_URI}}'"), 'панель не подставляет {{TYPES_JS_URI}}');
		assert.ok(panel.includes("msg.type === 'dcs/type-dictionary'"), 'панель не отвечает на чтение словаря');
		assert.ok(panel.includes("op: 'cf-dcs-type-dictionary'"), 'панель не зовёт cf-dcs-type-dictionary');
	});

	test('состав — в title и aria-description ячейки «Тип» и строки подсказки, подпись ячейки не меняется', () => {
		const script = readEditorScript();
		assert.ok(/function typeCompositionOf\(valueType\)[\s\S]{0,300}typeRules\.compositionTitle\(valueType, typeDictionary\)/.test(script), 'состав считает модуль типов со словарём');
		assert.ok(/function describeComposition\(node, composition\)[\s\S]{0,400}setAttribute\('aria-description', composition\)/.test(script), 'состав уходит и читалке');
		const cell = script.slice(script.indexOf('function typeCell('), script.indexOf('function clearingText('));
		assert.ok(cell.includes('const composition = typeCompositionOf(valueType);'), 'ячейка «Тип» считает состав');
		assert.equal((cell.match(/describeComposition\((?:td|button), composition\)/g) ?? []).length, 2, 'и у подписи текстом, и у кнопки');
		const row = script.slice(script.indexOf('function completeRow('), script.indexOf('function matchSpan('));
		assert.ok(row.includes('describeComposition(row, typeCompositionOf(entry.item.valueType))'), 'строка подсказки несёт состав своего типа');
	});

	test('поле «Разрядность» подсказывает спиннеру тот же предел, что проверка', () => {
		const script = readEditorScript();
		assert.ok(/function qualifierInput\([^)]*, max\)[\s\S]{0,400}input\.max = String\(max\);/.test(script), 'поле квалификатора не знает max');
		assert.ok(
			/'Разрядность',\s*q\.digits,\s*'numberQualifiers\.digits',[\s\S]{0,200}typeRules\.MAX_DIGITS\s*\)/.test(script),
			'«Разрядность» без предела модуля типов'
		);
	});

	test('окно типа шлёт правки только сообщениями set-field, set-calculated-field, set-parameter', () => {
		const script = readEditorScript();
		// Колонка «Тип» и окно лежат в модуле закладок схемы, словарь типов и его запрос остались в ядре
		const sections = [
			['// ---------- тип значения: словарь и подписи ----------', '// ---------- подписи значений: параметры схемы и настройки ----------'],
			['// ---------- тип значения: колонка «Тип» и окно «Тип значения» ----------', '// ---------- вкладка «Наборы данных» ----------'],
		];
		const sent = sections.flatMap(([from, to]) => {
			const start = script.indexOf(from);
			const end = script.indexOf(to, start);
			assert.ok(start >= 0 && end > start, `раздел ${from} не найден`);
			return [...script.slice(start, end).matchAll(/\b(?:send|post)\('([^']+)'/g)].map((match) => match[1]);
		});
		assert.deepEqual(
			[...new Set(sent)].sort(),
			['dcs/set-calculated-field', 'dcs/set-field', 'dcs/set-parameter', 'dcs/type-dictionary']
		);
	});
});
