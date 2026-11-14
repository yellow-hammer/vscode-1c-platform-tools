/**
 * Конструктор настроек СКД (мастер «Список / Таблица / Диаграмма»): чистые функции
 * dcs-editor-settings-wizard.js.
 *
 * Модуль исполняется в песочнице node:vm, как подсветка. Настройки вариантов — замороженные ответы
 * cf-dcs-settings-info на образцах БСП 3.1 (wizard-settings.json, см. README фикстур): так
 * распознавание проверяется на формах, которые пишет платформа, а план — на путях, которые
 * md-sparrow разрешит в том же файле. Формы операций сверяются с белым каталогом панели
 * (DCS_MESSAGE_SPECS) — тем же, по которому канал пакета проверит сообщение мастера.
 * Запуск: npm run compile && node --test out/test/metadata/dcsSettingsWizard.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { DCS_MESSAGE_SPECS } from '../../features/metadata/dcsPanelMessages';
import { readEditorScript } from '../fixtures/helpers/dcsEditorScript';

type Settings = Record<string, unknown>;

interface GroupField {
	field: string;
	groupType?: string;
	periodAdditionType?: string;
	periodAdditionBegin?: unknown;
	periodAdditionEnd?: unknown;
}

interface WizardState {
	recognized: boolean;
	reason?: string;
	type: 'list' | 'table' | 'chart';
	selection: unknown[];
	order: unknown[];
	groupings: Record<'levels' | 'tables' | 'rows' | 'columns' | 'points' | 'series', GroupField[]>;
	details: boolean;
	chartType: string | null;
}

interface PathStep {
	list: string;
	index: number;
}

interface Operation {
	op: string;
	variant?: string;
	name?: string;
	payload?: Record<string, unknown>;
}

interface WizardApi {
	REPORT_TYPES: ReadonlyArray<{ value: string; label: string }>;
	TARGETS: Record<string, readonly string[]>;
	TARGET_LABELS: Record<string, string>;
	GROUP_TYPES: ReadonlyArray<{ value: string; label: string }>;
	ORDER_TYPES: ReadonlyArray<{ value: string; label: string }>;
	CHART_TYPE_GROUPS: ReadonlyArray<{ id: string; label: string }>;
	CHART_TYPES: ReadonlyArray<{ value: string; label: string; group: string; since?: string }>;
	DEFAULT_CHART_TYPE: string;
	planWizardOperations(settings: unknown, state: unknown, variant: string, options?: unknown): Operation[];
	replacementSummary(settings: unknown): Record<string, number | boolean>;
	// помощники диалога
	stepsFor(type: string): ReadonlyArray<{ id: string; label: string }>;
	initialWizardState(settings: unknown): WizardState;
	previewLines(state: unknown): Array<{ depth: number; text: string; kind: string }>;
	selectedFieldNames(items: unknown, withDisabled: boolean): string[];
	wizardWarnings(state: unknown, schema: unknown): Array<{ step: string; text: string }>;
	fieldPathProblem(path: unknown): string;
}

interface Sample {
	template: string;
	variant: string;
	settings: Settings;
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const FILE = path.join(ROOT, 'resources', 'webview', 'dcs-editor-settings-wizard.js');
const FIXTURE = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs', 'wizard-settings.json');

/**
 * Исполняет файл webview в текущем realm и возвращает его module.exports.
 *
 * Обёртка-функция вместо нового контекста vm: объекты из чужого realm не проходят
 * deepStrictEqual (другой Object.prototype). Параметр window подменяет глобал webview.
 */
function loadWizard(): WizardApi {
	const code = fs.readFileSync(FILE, 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: FILE }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	return moduleShim.exports as WizardApi;
}

const api = loadWizard();
const samples = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, Sample>;

function sample(key: string): Sample {
	const found = samples[key];
	assert.ok(found, `нет образца ${key} в wizard-settings.json`);
	return found;
}

/** Состояние, как его пришлёт webview: JSON-копия без общих ссылок с прочитанным DTO. */
function stateOf(settings: unknown): WizardState {
	return JSON.parse(JSON.stringify(api.initialWizardState(settings))) as WizardState;
}

function fieldsOf(fields: GroupField[]): string[] {
	return fields.map((field) => `${field.field}:${field.groupType ?? 'Items'}`);
}

const S = (index = 0): PathStep => ({ list: 'structure', index });
const chain = (depth: number): PathStep[] => Array.from({ length: depth }, () => S());

/** Лексемы перечисления ChartType из XSD data-ui (одинаковы в форматах 2.10–2.21), в порядке XSD. */
const XSD_CHART_TYPES = [
	'Line', 'Step', 'StackedLine', 'Area', 'StackedArea', 'NormalizedArea', 'Column', 'StackedColumn',
	'NormalizedColumn', 'Column3D', 'StackedColumn3D', 'NormalizedColumn3D', 'Bar', 'StackedBar', 'NormalizedBar',
	'Bar3D', 'StackedBar3D', 'NormalizedBar3D', 'Pie', 'Pie3D', 'Stock', 'OpenHighLowClose', 'BarGraph', 'CeilGraph',
	'TapeGraph', 'PyramidGraph', 'Waterfall', 'WireframeSurface', 'Honeycomb', 'Surface', 'ConvexSurface',
	'ConcaveSurface', 'ShadedSurface', 'RadarLine', 'RadarArea', 'RadarStackedLine', 'RadarStackedArea',
	'RadarNormalizedArea', 'Gauge', 'Funnel', 'Funnel3D', 'NormalizedFunnel', 'NormalizedFunnel3D', 'Scatter', 'Bubble',
	'Donut', 'Donut3D',
];

/** Операции, которые канал пакета мастера пропускает: мутации внутри варианта и создание варианта. */
const SETTINGS_OPS = new Map(
	Object.values(DCS_MESSAGE_SPECS)
		.filter((spec) => spec.strings?.includes('variant') || spec.op === 'cf-dcs-add-settings-variant')
		.map((spec) => [spec.op as string, spec])
);

/**
 * Пакет проходит правила канала пакета: каждая операция — из белого каталога настроек со своими
 * адресными строками и объектом payload; вариант один, «новый вариант» — только первой операцией
 * с тем же именем.
 */
function assertBatchForm(ops: Operation[], variant: string): void {
	ops.forEach((operation, index) => {
		const spec = SETTINGS_OPS.get(operation.op);
		assert.ok(spec, `операция ${index + 1} (${operation.op}) вне каталога настроек`);
		if (operation.op === 'cf-dcs-add-settings-variant') {
			assert.equal(index, 0, 'новый вариант — только первой операцией');
			assert.equal(operation.name, variant);
			assert.ok(operation.payload === undefined || typeof operation.payload === 'object');
			return;
		}
		assert.equal(operation.variant, variant, `операция ${index + 1}: другой вариант`);
		assert.ok(
			operation.payload !== null && typeof operation.payload === 'object' && !Array.isArray(operation.payload),
			`операция ${index + 1}: payload не объект`
		);
		assert.deepEqual(Object.keys(operation).sort(), ['op', 'payload', 'variant']);
	});
}

function plan(settings: unknown, state: unknown, variant = 'Основной', options?: unknown): Operation[] {
	const ops = api.planWizardOperations(settings, state, variant, options);
	assertBatchForm(ops, variant);
	return ops;
}

const add = (parentPath: PathStep[], list: string, kind?: string, field?: GroupField): Operation => {
	const payload: Record<string, unknown> = { parentPath, list };
	if (kind) {
		payload.kind = kind;
	}
	if (field) {
		payload.groupFields = [field];
	}
	return { op: 'cf-dcs-add-structure-item', variant: 'Основной', payload };
};

const EMPTY = sample('пустой-вариант').settings;

function freshState(type: WizardState['type'], groupings: Partial<WizardState['groupings']>, extra: Partial<WizardState> = {}) {
	return { type, selection: [], order: [], groupings, details: true, chartType: null, ...extra };
}

describe('Мастер настроек СКД: справочники шагов', () => {
	test('47 типов диаграмм — ровно лексемы ChartType из XSD, с русскими подписями по группам', () => {
		const values = api.CHART_TYPES.map((item) => item.value);
		assert.equal(values.length, 47);
		assert.deepEqual([...values].sort(), [...XSD_CHART_TYPES].sort());
		const groups = new Set(api.CHART_TYPE_GROUPS.map((group) => group.id));
		const labels = new Set<string>();
		for (const item of api.CHART_TYPES) {
			assert.ok(groups.has(item.group), `${item.value}: группа ${item.group}`);
			assert.match(item.label, /^[А-ЯЁ][а-яё]/, `${item.value}: подпись по-русски`);
			assert.ok(!labels.has(item.label), `подпись «${item.label}» повторяется`);
			labels.add(item.label);
		}
		assert.ok(values.includes(api.DEFAULT_CHART_TYPE));
		// Кольцевые в модели EDT помечены версией появления
		assert.deepEqual(
			api.CHART_TYPES.filter((item) => item.since).map((item) => item.value),
			['Donut', 'Donut3D']
		);
	});

	test('цели группировок по видам отчёта и подписи типа иерархии', () => {
		assert.deepEqual(api.REPORT_TYPES.map((item) => item.label), ['Список', 'Таблица', 'Диаграмма']);
		assert.deepEqual({ ...api.TARGETS }, { list: ['levels'], table: ['tables', 'rows', 'columns'], chart: ['tables', 'points', 'series'] });
		assert.deepEqual(
			api.GROUP_TYPES.map((item) => [item.value, item.label]),
			[['Items', 'Без иерархии'], ['Hierarchy', 'Иерархия'], ['HierarchyOnly', 'Только иерархия']]
		);
		assert.deepEqual(api.ORDER_TYPES.map((item) => item.value), ['Asc', 'Desc']);
		for (const targets of Object.values(api.TARGETS)) {
			for (const target of targets) {
				assert.ok(api.TARGET_LABELS[target], target);
			}
		}
	});
});

describe('Мастер настроек СКД: распознавание образцов БСП', () => {
	test('детальные записи — список без группировок', () => {
		const state = api.initialWizardState(sample('список-детальные').settings);
		assert.equal(state.recognized, true);
		assert.equal(state.type, 'list');
		assert.deepEqual(state.groupings.levels, []);
		assert.equal(state.details, true);
		assert.equal(state.selection.length, 12);
		assert.equal(state.order.length, 1);
	});

	test('цепочка групп с одним полем — уровни списка по порядку вложенности', () => {
		const state = api.initialWizardState(sample('список-цепочка').settings);
		assert.equal(state.recognized, true);
		assert.equal(state.type, 'list');
		assert.deepEqual(fieldsOf(state.groupings.levels), ['Организация:Items', 'ДатаОплаты:Items']);
		assert.equal(state.details, true);
	});

	test('тип иерархии уровня — из groupType', () => {
		const state = api.initialWizardState(sample('список-иерархия').settings);
		assert.deepEqual(fieldsOf(state.groupings.levels), ['ВладелецФайла:Hierarchy']);
	});

	test('таблица: колонки и цепочка строк из безтиповых вложенных групп', () => {
		const state = api.initialWizardState(sample('таблица').settings);
		assert.equal(state.recognized, true);
		assert.equal(state.type, 'table');
		assert.deepEqual(fieldsOf(state.groupings.columns), ['Опрос.Наименование:Items']);
		assert.deepEqual(fieldsOf(state.groupings.rows), ['ЭлементарныйВопрос:Items', 'Ответ:Items']);
		assert.deepEqual(state.groupings.tables, []);
		assert.equal(state.order.length, 9);
	});

	test('таблица в цепочке групп — группы над ней идут в «Таблицы»', () => {
		const state = api.initialWizardState(sample('таблица-под-группами').settings);
		assert.equal(state.type, 'table');
		assert.deepEqual(fieldsOf(state.groupings.tables), ['Респондент:Items', 'Вопрос:Items']);
		assert.deepEqual(fieldsOf(state.groupings.rows), ['Аналитика1:Items']);
		assert.deepEqual(fieldsOf(state.groupings.columns), ['Аналитика2:Items']);
	});

	test('диаграмма: точки, серии и тип из корневых параметров вывода', () => {
		const state = api.initialWizardState(sample('диаграмма-тип-в-корне').settings);
		assert.equal(state.recognized, true);
		assert.equal(state.type, 'chart');
		assert.deepEqual(fieldsOf(state.groupings.points), ['ВидБизнесПроцесса:Items']);
		assert.deepEqual(fieldsOf(state.groupings.series), ['Завершен:Items']);
		assert.equal(state.chartType, 'Column3D');
	});

	test('диаграмма без точек; тип самой диаграммы перекрывает корневой', () => {
		const state = api.initialWizardState(sample('диаграмма-тип-в-узле').settings);
		assert.equal(state.type, 'chart');
		assert.deepEqual(state.groupings.points, []);
		assert.deepEqual(fieldsOf(state.groupings.series), ['СтатусЗаказа:Items']);
		assert.equal(state.chartType, 'Pie3D');
	});

	test('пустой вариант — список с детальными записями', () => {
		const state = api.initialWizardState(EMPTY);
		assert.equal(state.recognized, true);
		assert.equal(state.type, 'list');
		assert.equal(state.details, true);
		assert.deepEqual(state.selection, []);
		assert.equal(api.initialWizardState(null).recognized, true, 'вариант без настроек');
	});

	test('не мастерская форма — «не распознано» с причиной, поля и порядок корня остаются', () => {
		const several = api.initialWizardState(sample('группа-с-диаграммами').settings);
		assert.equal(several.recognized, false);
		assert.match(several.reason ?? '', /несколько элементов/);
		assert.equal(several.selection.length, 3);
		assert.deepEqual(Object.values(several.groupings).flat(), []);
		const filtered = api.initialWizardState(sample('группа-с-отбором').settings);
		assert.equal(filtered.recognized, false);
		assert.equal(filtered.reason, 'у группировки «Подразделение» есть отбор');
	});

	test('синтетика: несколько полей в группе, соседние строки, вложенный отчёт, своя сортировка', () => {
		const auto = { items: [{ kind: 'auto' }] };
		const group = (field: string, extra: Record<string, unknown> = {}) => ({
			kind: 'group',
			groupFields: [{ field, groupType: 'Items' }],
			order: auto,
			selection: auto,
			...extra,
		});
		const reasons = [
			{ structure: [{ ...group('А'), groupFields: [{ field: 'А' }, { field: 'Б' }] }] },
			{ structure: [{ kind: 'table', rows: [group('А'), group('Б')] }] },
			{ structure: [{ kind: 'nestedObject', objectID: 'x' }] },
			{ structure: [group('А', { order: { items: [{ kind: 'field', field: 'А', orderType: 'Desc' }] } })] },
			{ structure: [{ kind: 'group', order: auto, selection: auto, structure: [group('А')] }] },
			{ structure: [group('А', { use: false })] },
		].map((settings) => api.initialWizardState(settings));
		assert.deepEqual(
			reasons.map((state) => state.recognized),
			[false, false, false, false, false, false]
		);
		assert.deepEqual(
			reasons.map((state) => state.reason),
			[
				'у группировки «А» несколько полей',
				'у таблицы соседние строки',
				'в структуре вложенный отчёт',
				'у группировки «А» своя сортировка',
				'детальные записи стоят не последним уровнем',
				'группировка «А» выключена',
			]
		);
	});

	test('прочитанные DTO отдаются как есть: папки, Auto и выключенные поля — на местах', () => {
		const settings = sample('таблица-под-группами').settings as { selection: { items: unknown[] } };
		const state = api.initialWizardState(settings);
		assert.equal(state.selection[0], settings.selection.items[0], 'та же ссылка на прочитанный элемент');
		assert.deepEqual(state.selection[0], { kind: 'auto', use: false });
		const chainSettings = sample('список-цепочка').settings as { selection: { items: Array<{ use?: boolean }> } };
		const chained = api.initialWizardState(chainSettings);
		assert.equal(
			chained.selection.filter((item) => (item as { use?: boolean }).use === false).length,
			chainSettings.selection.items.filter((item) => item.use === false).length
		);
		assert.ok(chained.groupings.levels[0].periodAdditionType, 'пятёрка поля группировки прочитана целиком');
	});
});

describe('Мастер настроек СКД: план без изменений', () => {
	test('стартовое состояние без правок — пустой пакет у каждого распознанного образца с непустой структурой', () => {
		for (const [key, { settings, variant }] of Object.entries(samples)) {
			const state = api.initialWizardState(settings);
			if (!state.recognized || !Array.isArray(settings.structure) || settings.structure.length === 0) {
				continue;
			}
			assert.deepEqual(plan(settings, state, variant), [], `${key}: прямое состояние`);
			assert.deepEqual(plan(settings, stateOf(settings), variant), [], `${key}: копия состояния через JSON`);
		}
	});

	test('поле группировки без умолчаний пятёрки равно прочитанному — правки нет', () => {
		const settings = sample('список-иерархия').settings;
		const state = stateOf(settings);
		state.groupings.levels = [{ field: 'ВладелецФайла', groupType: 'Hierarchy' }];
		assert.deepEqual(plan(settings, state), []);
	});

	test('план не меняет прочитанные настройки', () => {
		for (const { settings, variant } of Object.values(samples)) {
			const before = JSON.stringify(settings);
			const state = stateOf(settings);
			state.type = 'chart';
			state.groupings.points = [{ field: 'Поле' }];
			api.planWizardOperations(settings, state, variant);
			assert.equal(JSON.stringify(settings), before, variant);
		}
	});
});

describe('Мастер настроек СКД: три вида отчёта на пустом варианте', () => {
	test('список: цепочка уровней с типом иерархии и детальные записи последними', () => {
		const ops = plan(
			EMPTY,
			freshState('list', { levels: [{ field: 'Организация', groupType: 'Hierarchy' }, { field: 'Контрагент' }] }, {
				selection: ['Организация', { kind: 'field', field: 'Сумма' }],
				order: [{ kind: 'field', field: 'Сумма', orderType: 'Desc' }],
			})
		);
		assert.deepEqual(ops, [
			{
				op: 'cf-dcs-set-selection',
				variant: 'Основной',
				payload: { path: [], items: [{ kind: 'field', field: 'Организация' }, { kind: 'field', field: 'Сумма' }] },
			},
			{
				op: 'cf-dcs-set-order',
				variant: 'Основной',
				payload: { path: [], items: [{ kind: 'field', field: 'Сумма', orderType: 'Desc' }] },
			},
			add([], 'structure', 'group', { field: 'Организация', groupType: 'Hierarchy' }),
			add(chain(1), 'structure', 'group', { field: 'Контрагент' }),
			add(chain(2), 'structure', 'group'),
		]);
	});

	test('таблица: «Таблицы» цепочкой в корне, таблица в самой глубокой группе, колонки и строки цепочками', () => {
		const ops = plan(
			EMPTY,
			freshState('table', {
				tables: [{ field: 'Организация' }],
				rows: [{ field: 'Номенклатура', groupType: 'Hierarchy' }, { field: 'Характеристика' }],
				columns: [{ field: 'Склад' }],
			})
		);
		const table = chain(2);
		assert.deepEqual(ops, [
			add([], 'structure', 'group', { field: 'Организация' }),
			add(chain(1), 'structure', 'table'),
			add(table, 'columns', undefined, { field: 'Склад' }),
			add(table, 'rows', undefined, { field: 'Номенклатура', groupType: 'Hierarchy' }),
			add([...table, { list: 'rows', index: 0 }], 'structure', 'group', { field: 'Характеристика' }),
		]);
	});

	test('диаграмма: точки и серии, selection=[Auto] у диаграммы и тип в корневых параметрах вывода', () => {
		const ops = plan(
			EMPTY,
			freshState('chart', { points: [{ field: 'Период' }], series: [{ field: 'Статус' }] }, { chartType: 'Pie' })
		);
		assert.deepEqual(ops, [
			add([], 'structure', 'chart'),
			add(chain(1), 'points', undefined, { field: 'Период' }),
			add(chain(1), 'series', undefined, { field: 'Статус' }),
			{ op: 'cf-dcs-set-selection', variant: 'Основной', payload: { path: chain(1), items: [{ kind: 'auto' }] } },
			{
				op: 'cf-dcs-set-parameter-value',
				variant: 'Основной',
				payload: { section: 'output', path: [], parameter: 'ТипДиаграммы', value: { type: 'v8ui:ChartType', text: 'Pie' } },
			},
		]);
	});

	test('диаграмма без выбранного типа — гистограмма; пустые таблица и диаграмма допустимы', () => {
		const chartOps = plan(EMPTY, freshState('chart', {}));
		assert.deepEqual(chartOps.map((op) => op.op), [
			'cf-dcs-add-structure-item',
			'cf-dcs-set-selection',
			'cf-dcs-set-parameter-value',
		]);
		assert.deepEqual(chartOps[2].payload?.value, { type: 'v8ui:ChartType', text: api.DEFAULT_CHART_TYPE });
		assert.deepEqual(plan(EMPTY, freshState('table', {})), [add([], 'structure', 'table')]);
	});

	test('поля без пути и чужие цели вида отчёта отбрасываются', () => {
		const ops = plan(EMPTY, freshState('list', { levels: [{ field: '' }, { field: 'А' }], rows: [{ field: 'Б' }] }));
		assert.deepEqual(ops, [add([], 'structure', 'group', { field: 'А' }), add(chain(1), 'structure', 'group')]);
	});
});

describe('Мастер настроек СКД: замена непустого варианта', () => {
	test('смена вида отчёта — удаление узлов корня (всегда индекс 0) и сборка заново; поля корня не трогаются', () => {
		const settings = sample('список-цепочка').settings;
		const state = stateOf(settings);
		state.type = 'table';
		state.groupings.rows = [{ field: 'Организация' }];
		const ops = plan(settings, state);
		assert.deepEqual(ops, [
			{ op: 'cf-dcs-remove-structure-item', variant: 'Основной', payload: { path: [S()] } },
			add([], 'structure', 'table'),
			add(chain(1), 'rows', undefined, { field: 'Организация' }),
		]);
	});

	test('не распознанная структура заменяется целиком: каждый узел корня удаляется', () => {
		const settings = sample('группа-с-диаграммами').settings;
		const ops = plan(settings, stateOf(settings));
		assert.deepEqual(ops, [
			{ op: 'cf-dcs-remove-structure-item', variant: 'Основной', payload: { path: [S()] } },
			{ op: 'cf-dcs-remove-structure-item', variant: 'Основной', payload: { path: [S()] } },
			{ op: 'cf-dcs-remove-structure-item', variant: 'Основной', payload: { path: [S()] } },
			add([], 'structure', 'group'),
		]);
	});

	test('изменилось только поле или тип иерархии уровня — set-group-fields на месте, прочее из DTO', () => {
		const settings = sample('список-цепочка').settings;
		const state = stateOf(settings);
		const read = state.groupings.levels[1];
		state.groupings.levels[1] = { ...read, groupType: 'Hierarchy' };
		state.groupings.levels[0] = { field: 'Контрагент' };
		const ops = plan(settings, state);
		assert.deepEqual(ops, [
			{ op: 'cf-dcs-set-group-fields', variant: 'Основной', payload: { path: chain(1), items: [{ field: 'Контрагент' }] } },
			{ op: 'cf-dcs-set-group-fields', variant: 'Основной', payload: { path: chain(2), items: [{ ...read, groupType: 'Hierarchy' }] } },
		]);
		assert.equal((ops[1].payload?.items as GroupField[])[0].periodAdditionType, 'None', 'пятёрка прочитанного поля сохранена');
	});

	test('другое число уровней списка или детальные записи — пересборка цепочки', () => {
		const settings = sample('список-иерархия').settings;
		const state = stateOf(settings);
		state.groupings.levels.push({ field: 'Автор' });
		const ops = plan(settings, state);
		assert.deepEqual(ops.map((op) => op.op), [
			'cf-dcs-remove-structure-item',
			'cf-dcs-add-structure-item',
			'cf-dcs-add-structure-item',
			'cf-dcs-add-structure-item',
		]);
		const noDetails = stateOf(settings);
		noDetails.details = false;
		assert.equal(plan(settings, noDetails)[0].op, 'cf-dcs-remove-structure-item');
	});

	test('у таблицы пересобирается только цель с другим числом полей: таблица и колонки остаются', () => {
		const settings = sample('таблица').settings;
		const state = stateOf(settings);
		state.groupings.rows = [{ field: 'Вопрос' }];
		state.groupings.columns = [{ ...state.groupings.columns[0], groupType: 'Hierarchy' }];
		const ops = plan(settings, state);
		const table = chain(1);
		assert.deepEqual(ops, [
			{ op: 'cf-dcs-remove-structure-item', variant: 'Основной', payload: { path: [...table, { list: 'rows', index: 0 }] } },
			{
				op: 'cf-dcs-set-group-fields',
				variant: 'Основной',
				payload: { path: [...table, { list: 'columns', index: 0 }], items: [state.groupings.columns[0]] },
			},
			add(table, 'rows', undefined, { field: 'Вопрос' }),
		]);
	});

	test('уровень строки во вложенной безтиповой группе адресуется путём через structure', () => {
		const settings = sample('таблица').settings;
		const state = stateOf(settings);
		state.groupings.rows[1] = { field: 'ОткрытыйОтвет' };
		assert.deepEqual(plan(settings, state), [
			{
				op: 'cf-dcs-set-group-fields',
				variant: 'Основной',
				payload: { path: [S(), { list: 'rows', index: 0 }, S()], items: [{ field: 'ОткрытыйОтвет' }] },
			},
		]);
	});

	test('другое число «Таблиц» — таблица переезжает на другую глубину, структура собирается заново', () => {
		const settings = sample('таблица-под-группами').settings;
		const state = stateOf(settings);
		state.groupings.tables.pop();
		const ops = plan(settings, state);
		assert.deepEqual(ops.slice(0, 3), [
			{ op: 'cf-dcs-remove-structure-item', variant: 'Основной', payload: { path: [S()] } },
			add([], 'structure', 'group', state.groupings.tables[0]),
			add(chain(1), 'structure', 'table'),
		]);
	});

	test('выбранные поля и порядок уходят прочитанными DTO, новое — минимальной формой', () => {
		const settings = sample('список-цепочка').settings as { selection: { items: unknown[] } };
		const state = stateOf(settings);
		state.selection.push('Валюта');
		state.order = [{ kind: 'field', field: 'Организация', orderType: 'Asc', pinned: true }];
		const ops = plan(settings, state);
		assert.deepEqual(ops.map((op) => op.op), ['cf-dcs-set-selection', 'cf-dcs-set-order']);
		const items = ops[0].payload?.items as unknown[];
		assert.deepEqual(items.slice(0, -1), settings.selection.items, 'прочитанные элементы, включая выключенные');
		assert.deepEqual(items[items.length - 1], { kind: 'field', field: 'Валюта' });
		assert.deepEqual(ops[1].payload?.items, [{ kind: 'field', field: 'Организация', orderType: 'Asc' }], 'служебные ключи UI не уходят');
	});

	test('пустой порядок снимает прочитанный', () => {
		const settings = sample('список-детальные').settings;
		const state = stateOf(settings);
		state.order = [];
		assert.deepEqual(plan(settings, state), [
			{ op: 'cf-dcs-set-order', variant: 'Основной', payload: { path: [], items: [] } },
		]);
	});
});

describe('Мастер настроек СКД: тип диаграммы', () => {
	test('фикстура: тип диаграммы правится, его под-параметры — только чтение', () => {
		// Мастер пишет ТипДиаграммы, и образцы должны отражать то, что видит webview:
		// значение без opaque, а ТипДиаграммы.* — opaque
		const chartValues: Array<{ parameter: string; opaque: boolean }> = [];
		const visit = (node: unknown): void => {
			if (Array.isArray(node)) {
				node.forEach(visit);
				return;
			}
			if (node === null || typeof node !== 'object') {
				return;
			}
			const item = node as { parameter?: unknown; value?: Array<{ opaque?: boolean }> };
			if (typeof item.parameter === 'string' && item.parameter.startsWith('ТипДиаграммы') && Array.isArray(item.value)) {
				chartValues.push({ parameter: item.parameter, opaque: item.value.some((value) => value.opaque === true) });
			}
			Object.values(node).forEach(visit);
		};
		visit(samples);
		const own = chartValues.filter((entry) => entry.parameter === 'ТипДиаграммы');
		const nested = chartValues.filter((entry) => entry.parameter !== 'ТипДиаграммы');
		assert.ok(own.length >= 4 && nested.length >= 2, JSON.stringify(chartValues));
		assert.deepEqual(own.filter((entry) => entry.opaque), []);
		assert.deepEqual(nested.filter((entry) => !entry.opaque), []);
	});

	test('сохранённая диаграмма со своим типом — правится тип узла, иначе корневой не подействует', () => {
		const settings = sample('диаграмма-тип-в-узле').settings;
		const state = stateOf(settings);
		state.chartType = 'Column';
		assert.deepEqual(plan(settings, state), [
			{
				op: 'cf-dcs-set-parameter-value',
				variant: 'Основной',
				payload: { section: 'output', path: [S()], parameter: 'ТипДиаграммы', value: { type: 'v8ui:ChartType', text: 'Column' } },
			},
		]);
	});

	test('тип в корне — правится корневой', () => {
		const settings = sample('диаграмма-тип-в-корне').settings;
		const state = stateOf(settings);
		state.chartType = 'Line';
		assert.deepEqual(plan(settings, state), [
			{
				op: 'cf-dcs-set-parameter-value',
				variant: 'Основной',
				payload: { section: 'output', path: [], parameter: 'ТипДиаграммы', value: { type: 'v8ui:ChartType', text: 'Line' } },
			},
		]);
	});

	test('пересобранная диаграмма теряет свой тип вместе с узлом — тип уходит в корень', () => {
		const settings = sample('диаграмма-тип-в-узле').settings;
		const state = stateOf(settings);
		state.groupings.tables = [{ field: 'Дата' }];
		const ops = plan(settings, state);
		assert.deepEqual(ops[0], { op: 'cf-dcs-remove-structure-item', variant: 'Основной', payload: { path: [S()] } });
		assert.deepEqual(ops[ops.length - 2].payload, { path: chain(2), items: [{ kind: 'auto' }] });
		assert.deepEqual(ops[ops.length - 1].payload, {
			section: 'output',
			path: [],
			parameter: 'ТипДиаграммы',
			value: { type: 'v8ui:ChartType', text: 'Pie3D' },
		});
	});

	test('новая цель у сохранённой диаграммы дописывается, серия с пользовательской настройкой остаётся', () => {
		const settings = sample('диаграмма-тип-в-узле').settings;
		const state = stateOf(settings);
		state.groupings.points = [{ field: 'Дата' }];
		assert.deepEqual(plan(settings, state), [add(chain(1), 'points', undefined, { field: 'Дата' })]);
		const withUserSetting = sample('диаграмма-тип-в-корне').settings;
		const changed = stateOf(withUserSetting);
		changed.groupings.points = [{ field: 'Дата' }];
		assert.deepEqual(plan(withUserSetting, changed), [
			{
				op: 'cf-dcs-set-group-fields',
				variant: 'Основной',
				payload: { path: [S(), { list: 'points', index: 0 }], items: [{ field: 'Дата' }] },
			},
		]);
	});

	test('с диаграммы на список корневой тип не трогается: параметры мастер не заменяет', () => {
		const settings = sample('диаграмма-тип-в-корне').settings;
		const state = stateOf(settings);
		state.type = 'list';
		const ops = plan(settings, state, 'СтатистикаПоВидам');
		assert.ok(!ops.some((op) => op.op === 'cf-dcs-set-parameter-value'));
		assert.deepEqual(ops.map((op) => op.op), ['cf-dcs-remove-structure-item', 'cf-dcs-add-structure-item']);
	});

	test('неизвестный тип диаграммы, вид отчёта и пустое имя варианта — ошибка программы, не пакет', () => {
		assert.throws(() => api.planWizardOperations(EMPTY, freshState('chart', {}, { chartType: 'Pie4D' }), 'Основной'), /типы? диаграммы/);
		assert.throws(() => api.planWizardOperations(EMPTY, { type: 'toString' }, 'Основной'), /вид отчёта/);
		assert.throws(() => api.planWizardOperations(EMPTY, freshState('list', {}), ''), /имя варианта/);
	});
});

describe('Мастер настроек СКД: «В новый вариант…»', () => {
	test('первая операция создаёт вариант, остальные адресуют его; структура исходного варианта не удаляется', () => {
		const settings = sample('список-цепочка').settings;
		const state = stateOf(settings);
		state.type = 'table';
		state.groupings.rows = [{ field: 'Организация' }];
		const ops = plan(settings, state, 'ПоОрганизациям', { newVariant: true, presentation: 'По организациям' });
		assert.deepEqual(ops[0], { op: 'cf-dcs-add-settings-variant', name: 'ПоОрганизациям', payload: { presentation: 'По организациям' } });
		assert.ok(!ops.some((op) => op.op === 'cf-dcs-remove-structure-item'));
		assert.deepEqual(ops.map((op) => op.op), [
			'cf-dcs-add-settings-variant',
			'cf-dcs-set-selection',
			'cf-dcs-add-structure-item',
			'cf-dcs-add-structure-item',
		]);
		// Выбранные поля переносятся прочитанными DTO — с выключенными и в том же порядке
		assert.deepEqual(ops[1].payload?.items, (settings as { selection: { items: unknown[] } }).selection.items);
	});

	test('без представления — только имя; та же структура в новом варианте собирается заново', () => {
		const settings = sample('диаграмма-тип-в-корне').settings;
		const ops = plan(settings, stateOf(settings), 'Копия', { newVariant: true });
		assert.deepEqual(ops[0], { op: 'cf-dcs-add-settings-variant', name: 'Копия' });
		assert.deepEqual(ops.map((op) => op.op), [
			'cf-dcs-add-settings-variant',
			'cf-dcs-set-selection',
			'cf-dcs-set-order',
			'cf-dcs-add-structure-item',
			'cf-dcs-add-structure-item',
			'cf-dcs-add-structure-item',
			'cf-dcs-set-selection',
			'cf-dcs-set-parameter-value',
		]);
	});
});

describe('Мастер настроек СКД: сводка перед заменой', () => {
	test('узлы по видам, поля, порядок и пользовательские настройки', () => {
		assert.deepEqual(api.replacementSummary(sample('группа-с-диаграммами').settings), {
			nodes: 5,
			groups: 3,
			tables: 0,
			charts: 2,
			nestedObjects: 0,
			userSettings: 3,
			selection: 3,
			order: 0,
			empty: false,
		});
		assert.equal(api.replacementSummary(EMPTY).empty, true, 'пустому варианту подтверждение не нужно');
		assert.equal(api.replacementSummary(sample('таблица').settings).order, 9);
	});
});

describe('Мастер настроек СКД: помощники диалога', () => {
	test('шаги: у диаграммы пятый — «Тип диаграммы», у списка и таблицы мастер кончается на «Порядке»', () => {
		assert.deepEqual(api.stepsFor('list').map((step) => step.label), ['Тип отчёта', 'Поля', 'Группировки', 'Порядок']);
		assert.deepEqual(api.stepsFor('table').map((step) => step.id), ['type', 'fields', 'groups', 'order']);
		assert.deepEqual(api.stepsFor('chart').map((step) => step.id), ['type', 'fields', 'groups', 'order', 'chart']);
	});

	test('старт диалога у пустой структуры: ОК без правок собирает список с детальными записями', () => {
		// Как платформа: новому списку ОК после «Полей» даёт детальные записи
		assert.deepEqual(plan(EMPTY, api.initialWizardState(EMPTY)), [add([], 'structure', 'group')]);
	});

	test('предпросмотр: уровни списка с иерархией и детальные записи', () => {
		const state = freshState('list', { levels: [{ field: 'Склад' }, { field: 'Номенклатура', groupType: 'Hierarchy' }] });
		assert.deepEqual(api.previewLines(state), [
			{ depth: 0, text: 'Отчет', kind: 'root' },
			{ depth: 1, text: 'Склад', kind: 'group' },
			{ depth: 2, text: 'Номенклатура (иерархия)', kind: 'group' },
			{ depth: 3, text: 'Детальные записи', kind: 'details' },
		]);
		assert.deepEqual(api.previewLines(freshState('list', {}, { details: false })).map((line) => line.text), ['Отчет', 'Структура пуста']);
	});

	test('предпросмотр: «Таблицы» над таблицей, колонки раньше строк, цепочки целей', () => {
		const state = freshState('table', {
			tables: [{ field: 'Организация' }],
			rows: [{ field: 'Склад' }, { field: 'Номенклатура', groupType: 'HierarchyOnly' }],
			columns: [{ field: 'Период' }],
		});
		assert.deepEqual(
			api.previewLines(state).map((line) => `${line.depth}:${line.text}`),
			['0:Отчет', '1:Организация', '2:Таблица', '3:Колонки', '4:Период', '3:Строки', '4:Склад', '5:Номенклатура (только иерархия)']
		);
		assert.deepEqual(api.previewLines(freshState('table', {})).map((line) => line.text), ['Отчет', 'Таблица', 'Без строк и колонок']);
	});

	test('предпросмотр диаграммы: тип подписью, без типа — гистограмма', () => {
		const chart = freshState('chart', { series: [{ field: 'Статус' }] }, { chartType: 'Pie3D' });
		assert.deepEqual(api.previewLines(chart).map((line) => line.text), ['Отчет', 'Диаграмма: объёмная круговая', 'Серии', 'Статус']);
		assert.equal(api.previewLines(freshState('chart', {})).map((line) => line.text)[1], 'Диаграмма: гистограмма');
	});

	test('пути выбранных полей: папки раскрываются, выключенные — по запросу, Auto не поле', () => {
		const items = [
			{ kind: 'field', field: 'А' },
			{ kind: 'field', field: 'Б', use: false },
			{ kind: 'auto' },
			{ kind: 'folder', title: 'Папка', items: [{ kind: 'field', field: 'В' }] },
		];
		assert.deepEqual(api.selectedFieldNames(items, false), ['А', 'В']);
		assert.deepEqual(api.selectedFieldNames(items, true), ['А', 'Б', 'В']);
	});

	test('предупреждения: таблица и диаграмма без ресурсов и целей, поле в строках и колонках', () => {
		const schema = { totalFields: [{ name: 'Количество' }, { name: 'Сумма', groups: ['Склад'] }] };
		const table = freshState('table', { rows: [{ field: 'Склад' }], columns: [{ field: 'склад' }] }, {
			selection: [{ kind: 'field', field: 'Номенклатура' }],
		});
		assert.deepEqual(api.wizardWarnings(table, schema), [
			{ step: 'fields', text: 'Не выбран ни один ресурс: в ячейках таблицы выводятся ресурсы схемы.' },
			{
				step: 'fields',
				text: 'Не ресурсы схемы: «Номенклатура». Итогов по группировкам у них не будет. Конструктор ресурсы не создаёт: ресурс добавляется на закладке «Ресурсы».',
			},
			{ step: 'groups', text: 'И в строках, и в колонках: «склад».' },
		]);
		const chart = freshState('chart', {}, { selection: [{ kind: 'field', field: 'количество' }] });
		assert.deepEqual(api.wizardWarnings(chart, schema), [
			{ step: 'groups', text: 'У диаграммы нет ни точек, ни серий: выведется одно значение на ресурс.' },
		]);
		assert.deepEqual(api.wizardWarnings(freshState('table', {}, { selection: [{ kind: 'field', field: 'Сумма' }] }), schema), [
			{ step: 'groups', text: 'У таблицы нет ни строк, ни колонок: выведутся только общие итоги.' },
		]);
		// Список ресурсов не требует, выключенное поле в вывод не идёт
		assert.deepEqual(api.wizardWarnings(freshState('list', {}, { selection: [{ kind: 'field', field: 'Номенклатура', use: false }] }), schema), []);
	});

	test('предупреждение: ресурс считается не по всем выбранным группировкам', () => {
		const schema = { totalFields: [{ name: 'Сумма', groups: ['Склад', 'ОбщийИтог'] }] };
		const state = freshState('list', { levels: [{ field: 'Склад' }, { field: 'Номенклатура' }] }, {
			selection: [{ kind: 'field', field: 'Сумма' }],
		});
		assert.deepEqual(api.wizardWarnings(state, schema), [
			{
				step: 'groups',
				text: 'Ресурс «Сумма» считается только по группировкам «Склад», «ОбщийИтог»: по «Номенклатура» его итога не будет.',
			},
		]);
	});

	test('путь «Другого поля…»: части через точку из букв, цифр и «_»', () => {
		assert.equal(api.fieldPathProblem('Контрагент.ИНН'), '');
		assert.equal(api.fieldPathProblem(' СистемныеПоля.НомерПоПорядку '), '');
		assert.equal(api.fieldPathProblem('_Поле1'), '');
		assert.equal(api.fieldPathProblem(''), 'Укажите путь поля.');
		for (const bad of ['1Поле', 'Поле.', '.Поле', 'Поле..ИНН', 'Поле ИНН', 'Поле-1', '&Параметр']) {
			assert.ok(api.fieldPathProblem(bad).includes('не разобран'), bad);
		}
	});
});

describe('Мастер настроек СКД: реквизиты через точку', () => {
	// Раскрытые по типу поля (Контрагент.ИНН) мастер выбирает теми же путями, что поле каталога: план пишет
	// путь дословно во всех разделах, а повторный запуск узнаёт его и ничего не пересобирает
	const ZERO = { type: 'xs:dateTime', text: '0001-01-01T00:00:00' };
	const groupField = (field: string): GroupField => ({ field, groupType: 'Items', periodAdditionType: 'None', periodAdditionBegin: ZERO, periodAdditionEnd: ZERO });
	const AUTO = { selection: { items: [{ kind: 'auto' }] }, order: { items: [{ kind: 'auto' }] } };

	test('путь через точку пишется дословно в выбранные поля, порядок и группировки трёх видов отчёта', () => {
		const listOps = plan(
			EMPTY,
			freshState('list', { levels: [{ field: 'Контрагент.ИНН' }] }, {
				selection: [{ kind: 'field', field: 'Контрагент.Партнер.Наименование' }, 'Контрагент.ИНН'],
				order: [{ kind: 'field', field: 'Контрагент.ИНН', orderType: 'Desc' }],
			})
		);
		assert.deepEqual(listOps, [
			{
				op: 'cf-dcs-set-selection',
				variant: 'Основной',
				payload: { path: [], items: [{ kind: 'field', field: 'Контрагент.Партнер.Наименование' }, { kind: 'field', field: 'Контрагент.ИНН' }] },
			},
			{ op: 'cf-dcs-set-order', variant: 'Основной', payload: { path: [], items: [{ kind: 'field', field: 'Контрагент.ИНН', orderType: 'Desc' }] } },
			add([], 'structure', 'group', { field: 'Контрагент.ИНН' }),
			add(chain(1), 'structure', 'group'),
		]);
		const tableOps = plan(EMPTY, freshState('table', { rows: [{ field: 'ФизическоеЛицо.ИНН', groupType: 'Hierarchy' }], columns: [{ field: 'Период.ДатаНачала' }] }));
		assert.deepEqual(tableOps, [
			add([], 'structure', 'table'),
			add(chain(1), 'columns', undefined, { field: 'Период.ДатаНачала' }),
			add(chain(1), 'rows', undefined, { field: 'ФизическоеЛицо.ИНН', groupType: 'Hierarchy' }),
		]);
		const chartOps = plan(EMPTY, freshState('chart', { points: [{ field: 'Контрагент.ИНН' }] }, { chartType: 'Pie' }));
		assert.deepEqual(chartOps[1], add(chain(1), 'points', undefined, { field: 'Контрагент.ИНН' }));
	});

	test('повторный запуск узнаёт путь через точку: без правок пусто, смена типа иерархии — set-group-fields на месте', () => {
		const settings = {
			selection: { items: [{ kind: 'field', field: 'Контрагент.ИНН' }] },
			order: { items: [{ kind: 'field', field: 'Контрагент.ИНН', orderType: 'Asc' }] },
			structure: [{ kind: 'group', groupFields: [groupField('Контрагент.ИНН')], ...AUTO, structure: [{ kind: 'group', ...AUTO }] }],
		};
		const state = stateOf(settings);
		assert.equal(state.recognized, true, state.reason ?? '');
		assert.deepEqual(fieldsOf(state.groupings.levels), ['Контрагент.ИНН:Items']);
		assert.deepEqual(api.selectedFieldNames(state.selection, true), ['Контрагент.ИНН']);
		assert.deepEqual(plan(settings, state), [], 'без правок — пакета нет');
		state.groupings.levels[0] = { ...state.groupings.levels[0], groupType: 'Hierarchy' };
		assert.deepEqual(plan(settings, state), [
			{
				op: 'cf-dcs-set-group-fields',
				variant: 'Основной',
				payload: { path: chain(1), items: [{ ...groupField('Контрагент.ИНН'), groupType: 'Hierarchy' }] },
			},
		]);
	});

	test('предупреждения: реквизит в таблице — не ресурс схемы, «в схеме нет» о нём модуль не говорит', () => {
		const schema = { totalFields: [{ name: 'Сумма', value: 'Сумма(Сумма)' }] };
		const texts = api
			.wizardWarnings(freshState('table', { rows: [{ field: 'Контрагент.ИНН' }] }, { selection: ['Сумма', 'Контрагент.ИНН'] }), schema)
			.map((warning) => warning.text);
		assert.ok(texts.some((text) => text.includes('Не ресурсы схемы: «Контрагент.ИНН»')), texts.join(' | '));
		assert.ok(!texts.some((text) => text.includes('нет среди полей')), 'о путях вне каталога судит окно, а не модуль');
	});
});

describe('Мастер настроек СКД: подключение к webview и панели', () => {
	// Концы строк приводятся к \n: рабочая копия на Windows может хранить файлы с \r\n
	const read = (file: string): string => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
	const webview = path.join(ROOT, 'resources', 'webview');

	test('модуль подключён до основного скрипта, панель подставляет его адрес и разбирает пакет', () => {
		const html = read(path.join(webview, 'dcs-editor.html'));
		const at = html.indexOf('{{SETTINGS_WIZARD_JS_URI}}');
		assert.ok(at >= 0, 'в шаблоне нет {{SETTINGS_WIZARD_JS_URI}}');
		assert.ok(at < html.indexOf('{{JS_URI}}'), 'модуль мастера подключён позже скрипта');
		const script = readEditorScript();
		assert.ok(script.includes('window.DcsSettingsWizard'), 'скрипт не берёт модуль мастера');
		const panel = read(path.join(ROOT, 'src', 'features', 'metadata', 'dcsEditorPanel.ts'));
		assert.ok(panel.includes("'dcs-editor-settings-wizard.js'"), 'панель не знает файл модуля');
		assert.ok(panel.includes("replaceAll('{{SETTINGS_WIZARD_JS_URI}}'"), 'панель не подставляет {{SETTINGS_WIZARD_JS_URI}}');
		assert.ok(panel.includes("msg.type === 'dcs/settings-wizard'"), 'панель не разбирает пакет мастера');
	});

	test('мастер пишет только пакетом: одно сообщение dcs/settings-wizard с операциями плана', () => {
		const script = readEditorScript();
		const start = script.indexOf('// ---------- конструктор настроек: мастер «Список / Таблица / Диаграмма» ----------');
		const end = script.indexOf('// ---------- дерево структуры варианта ----------');
		assert.ok(start >= 0 && end > start, 'раздел мастера не найден');
		const sent = [...script.slice(start, end).matchAll(/\b(?:sendPanelItems|send|post)\('([^']+)'/g)].map((match) => match[1]);
		assert.deepEqual(sent, ['dcs/settings-wizard']);
		assert.ok(script.slice(start, end).includes('wizardRules.planWizardOperations('), 'операции строит модуль');
	});

	test('раскрытие по типу: тот же вызов, что у подсказки «через точку», ответ описания перерисовывает мастер', () => {
		const script = readEditorScript();
		const start = script.indexOf('// ---------- конструктор настроек: мастер «Список / Таблица / Диаграмма» ----------');
		const end = script.indexOf('// ---------- дерево структуры варианта ----------');
		const wizard = script.slice(start, end);
		// Окружение одно: разойдись оно — мастер и подсказка показывали бы у поля разные реквизиты
		const level = wizard.slice(wizard.indexOf('function typeLevel('), wizard.indexOf('function typeNodeByPath('));
		// Расчёт уровня — общий с «Доступными полями» «Настроек» (typeAttributeLevel): мастер даёт цепочку,
		// раздел, флажок ограничения раздела и поля наборов по пути
		assert.ok(
			level.includes("typeAttributeLevel(node, node.typeChain || catalogChain(step, node), 'settings:' + WIZARD_SECTIONS[step], WIZARD_RESTRICTION_FLAGS[step], typeFieldIndex)"),
			'мастер берёт общий расчёт реквизитов'
		);
		const shared = script.slice(script.indexOf('function typeAttributeLevel('), script.indexOf('function wizardNodeIndex('));
		assert.ok(shared.includes('const env = typeChildrenEnv(scope, false);'), 'мастер берёт общее окружение');
		assert.ok(shared.includes("fieldTypes.extraChildrenFor({ mode: 'path', chain: chain }, node.path, env)"), 'мастер зовёт extraChildrenFor с цепочкой каталога');
		// Правило childrenOf подсказки: реквизиты поля, запрещённые в разделе, не предлагаются
		assert.ok(shared.includes('item.attributeRestrict && item.attributeRestrict[flag]'), 'запрет реквизитов в разделе соблюдён');
		assert.ok(shared.includes('env.fieldIndex = fieldIndex;'), 'поля наборов разложены по пути: отрисовка тысяч полей не квадратична');
		const provider = script.slice(script.indexOf('function typeChildrenProvider('), script.indexOf('function onDescribed('));
		assert.ok(provider.includes('fieldTypes.extraChildrenFor(info, parentPath, typeChildrenEnv('), 'подсказка зовёт то же окружение');
		const described = script.slice(script.indexOf('function onDescribed('), script.indexOf('function attachCompletion('));
		// rerenderSoon: сразу, а ответы, отложенные переносом мышью, — одной перерисовкой после всех
		assert.ok(/rerenderSoon\(wizardRerender\);/.test(described), 'ответ описания перерисовывает открытый мастер');
		// Перерисовка мастера лежит в поле объекта ядра: ответ описания разбирает ядро
		assert.ok(wizard.includes('core.wizardRerender = onWizardDescribed;'), 'мастер ставит перерисовку');
		assert.ok(/if \(core\.wizardRerender === onWizardDescribed\) \{\s*core\.wizardRerender = null;/.test(wizard), 'и снимает её при закрытии');
		// Описания читает только раскрытие и явно названный путь, а не отрисовка списка
		assert.ok(level.length > 0 && !level.includes('requestDescriptions('), 'подсчёт реквизитов описаний не запрашивает');
	});
});
