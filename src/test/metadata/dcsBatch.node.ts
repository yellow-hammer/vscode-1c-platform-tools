/**
 * Канал пакета `apply-mutation op:"batch"` панели СКД: белые каталоги по каналу,
 * разбор сообщения конструктора настроек dcs/settings-wizard и отказы до запуска jar, параметры
 * пакета и разбор его ответа.
 *
 * Планы мастера берутся тем же модулем, что исполняет webview (dcs-editor-settings-wizard.js, в
 * песочнице node:vm), на замороженных настройках БСП 3.1 (wizard-settings.json): так проверяется,
 * что всё, что пришлёт диалог, канал пропустит, а чужое — отклонит.
 * Запуск: npm run compile && node --test out/test/metadata/dcsBatch.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {
	DCS_ADD_TOTAL_FIELDS_MESSAGE,
	DCS_BATCH_OPS,
	DCS_MESSAGE_SPECS,
	DCS_REMOVE_TOTAL_FIELDS_MESSAGE,
	DCS_SETTINGS_WIZARD_MESSAGE,
	dcsAddTotalFieldsBatchOf,
	dcsAutofillOfResult,
	dcsBatchAnswersOf,
	dcsBatchParamsOf,
	dcsBatchProblem,
	dcsMutationOf,
	dcsRemoveTotalFieldsBatchOf,
	dcsSettingsWizardBatchOf,
	type DcsBatchMutation,
	type DcsPanelMessage,
} from '../../features/metadata/dcsPanelMessages';

interface Operation {
	op: string;
	variant?: string;
	name?: string;
	payload?: Record<string, unknown>;
}

interface WizardApi {
	initialWizardState(settings: unknown): Record<string, unknown>;
	planWizardOperations(settings: unknown, state: unknown, variant: string, options?: unknown): Operation[];
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WIZARD_FILE = path.join(ROOT, 'resources', 'webview', 'dcs-editor-settings-wizard.js');
const FIXTURE = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs', 'wizard-settings.json');

/** Модуль webview в текущем realm: объекты чужого realm не проходят deepStrictEqual. */
function loadWizard(): WizardApi {
	const code = fs.readFileSync(WIZARD_FILE, 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: WIZARD_FILE }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	return moduleShim.exports as WizardApi;
}

const wizard = loadWizard();
const samples = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, { variant: string; settings: unknown }>;

/** Разбор без оглядки на типы: webview может прислать что угодно. */
function parse(fields: Record<string, unknown>): ReturnType<typeof dcsSettingsWizardBatchOf> {
	return dcsSettingsWizardBatchOf({ type: DCS_SETTINGS_WIZARD_MESSAGE, ...fields } as unknown as DcsPanelMessage);
}

function refusal(fields: Record<string, unknown>): string {
	const result = parse(fields);
	assert.ok('error' in result, `пакет не отклонён: ${JSON.stringify(fields)}`);
	return result.error;
}

const S = { list: 'structure', index: 0 };
const remove = (variant = 'Основной'): Operation => ({
	op: 'cf-dcs-remove-structure-item',
	variant,
	payload: { path: [S] },
});
const addGroup = (variant = 'Основной'): Operation => ({
	op: 'cf-dcs-add-structure-item',
	variant,
	payload: { parentPath: [], list: 'structure', kind: 'group' },
});

describe('Канал пакета СКД: белые каталоги', () => {
	test('мастер настроек — мутации внутри варианта и создание варианта', () => {
		const variantOps = Object.values(DCS_MESSAGE_SPECS)
			.filter((spec) => spec.strings?.includes('variant') === true)
			.map((spec) => spec.op as string);
		assert.equal(variantOps.length, 11);
		assert.deepEqual([...DCS_BATCH_OPS.settings].sort(), [...variantOps, 'cf-dcs-add-settings-variant'].sort());
		for (const foreign of ['cf-dcs-remove-settings-variant', 'cf-dcs-set-settings-variant-props', 'cf-dcs-set-query', 'cf-dcs-add-field']) {
			assert.equal(DCS_BATCH_OPS.settings.has(foreign as never), false, foreign);
		}
	});

	test('конструктор запроса — текст набора, недостающие параметры и автозаполнение', () => {
		assert.deepEqual([...DCS_BATCH_OPS.query].sort(), ['cf-dcs-add-parameter', 'cf-dcs-autofill-fields', 'cf-dcs-set-query']);
	});

	test('dcsBatchProblem сверяет каждую операцию с каталогом своего канала', () => {
		const settingsOp: DcsBatchMutation = { op: 'cf-dcs-set-order', variant: 'Основной', payloadJson: '{}' };
		const queryOp: DcsBatchMutation = { op: 'cf-dcs-set-query', tag: 'Набор', payloadJson: 'ВЫБРАТЬ 1' };
		assert.equal(dcsBatchProblem('settings', [settingsOp]), undefined);
		assert.equal(dcsBatchProblem('query', [queryOp, { op: 'cf-dcs-autofill-fields', dataSet: 'Набор' }]), undefined);
		assert.equal(
			dcsBatchProblem('settings', [settingsOp, queryOp]),
			'Операция 2 (cf-dcs-set-query): не входит в каталог правок конструктора настроек.'
		);
		assert.equal(
			dcsBatchProblem('query', [settingsOp]),
			'Операция 1 (cf-dcs-set-order): не входит в каталог правок конструктора запроса.'
		);
		assert.equal(dcsBatchProblem('query', []), 'Пакет конструктора запроса пуст: в нём нет операций.');
	});
});

describe('Канал пакета СКД: сообщение dcs/settings-wizard', () => {
	test('операции разбираются маппером одиночных правок: адрес полем, payload — строкой', () => {
		const result = parse({ variant: 'Основной', operations: [remove(), addGroup()] });
		assert.ok(!('error' in result), JSON.stringify(result));
		assert.equal(result.variant, 'Основной');
		assert.deepEqual(result.mutations, [
			{ op: 'cf-dcs-remove-structure-item', variant: 'Основной', payloadJson: JSON.stringify({ path: [S] }) },
			{
				op: 'cf-dcs-add-structure-item',
				variant: 'Основной',
				payloadJson: JSON.stringify({ parentPath: [], list: 'structure', kind: 'group' }),
			},
		]);
		// Сообщение пакета — не одиночная правка: маппер его не разбирает
		assert.equal(dcsMutationOf({ type: DCS_SETTINGS_WIZARD_MESSAGE, variant: 'Основной' }), undefined);
	});

	test('«В новый вариант…»: первая операция создаёт вариант с именем пакета', () => {
		const result = parse({
			variant: 'Сводка',
			operations: [
				{ op: 'cf-dcs-add-settings-variant', name: 'Сводка', payload: { presentation: 'Сводный' } },
				addGroup('Сводка'),
			],
		});
		assert.ok(!('error' in result), JSON.stringify(result));
		assert.deepEqual(result.mutations[0], {
			op: 'cf-dcs-add-settings-variant',
			name: 'Сводка',
			payloadJson: JSON.stringify({ presentation: 'Сводный' }),
		});
		// Представление необязательно: без него операция несёт одно имя
		const bare = parse({ variant: 'Сводка', operations: [{ op: 'cf-dcs-add-settings-variant', name: 'Сводка' }] });
		assert.ok(!('error' in bare));
		assert.deepEqual(bare.mutations, [{ op: 'cf-dcs-add-settings-variant', name: 'Сводка' }]);
	});

	test('чужая операция — отказ до jar с номером и именем, как у md-sparrow', () => {
		for (const op of ['cf-dcs-remove-data-set', 'cf-dcs-set-query', 'cf-dcs-remove-settings-variant', 'cf-dcs-info', 'batch']) {
			assert.equal(
				refusal({ variant: 'Основной', operations: [remove(), { op, variant: 'Основной', payload: {} }] }),
				`Операция 2 (${op}): не входит в каталог правок конструктора настроек.`
			);
		}
	});

	test('другой вариант у операции — отказ', () => {
		assert.equal(
			refusal({ variant: 'Основной', operations: [remove(), remove('Второй')] }),
			'Операция 2 (cf-dcs-remove-structure-item): вариант «Второй» не совпадает с вариантом пакета «Основной».'
		);
		assert.equal(
			refusal({ variant: 'Основной', operations: [{ op: 'cf-dcs-set-order', payload: { path: [], items: [] } }] }),
			'Операция 1 (cf-dcs-set-order): не назван вариант настроек (variant).'
		);
	});

	test('создание варианта не первой операцией — отказ', () => {
		assert.equal(
			refusal({
				variant: 'Сводка',
				operations: [addGroup('Сводка'), { op: 'cf-dcs-add-settings-variant', name: 'Сводка' }],
			}),
			'Операция 2 (cf-dcs-add-settings-variant): новый вариант создаётся только первой операцией пакета.'
		);
	});

	test('имя нового варианта не равно варианту пакета — отказ', () => {
		assert.equal(
			refusal({ variant: 'Сводка', operations: [{ op: 'cf-dcs-add-settings-variant', name: 'Итоги' }, addGroup('Сводка')] }),
			'Операция 1 (cf-dcs-add-settings-variant): имя нового варианта «Итоги» не совпадает с вариантом пакета «Сводка».'
		);
		assert.equal(
			refusal({ variant: 'Сводка', operations: [{ op: 'cf-dcs-add-settings-variant', variant: 'Сводка', name: 'Сводка' }] }),
			'Операция 1 (cf-dcs-add-settings-variant): поле «variant» в операции пакета не задаётся.'
		);
	});

	test('файл, версию схемы и флаги пакета из webview не принимаем', () => {
		for (const field of ['objectXml', 'schemaVersion', 'dryRun', 'ignoreSupport', 'operations', 'payloadJson', 'type']) {
			assert.equal(
				refusal({ variant: 'Основной', operations: [{ ...remove(), [field]: 'x' }] }),
				`Операция 1 (cf-dcs-remove-structure-item): поле «${field}» в операции пакета не задаётся.`
			);
		}
	});

	test('кривые операции и пакет — отказ, а не исключение', () => {
		assert.equal(
			refusal({ variant: 'Основной', operations: [{ op: 'cf-dcs-set-order', variant: 'Основной', payload: [] }] }),
			'Операция 1 (cf-dcs-set-order): нужен payload (объект полезной нагрузки).'
		);
		assert.equal(
			refusal({ variant: 'Основной', operations: [{ op: 'cf-dcs-set-order', variant: 'Основной' }] }),
			'Операция 1 (cf-dcs-set-order): нужен payload (объект полезной нагрузки).'
		);
		assert.equal(
			refusal({ variant: 'Сводка', operations: [{ op: 'cf-dcs-add-settings-variant', name: 'Сводка', payload: 'x' }] }),
			'Операция 1 (cf-dcs-add-settings-variant): payload, если задан, должен быть объектом.'
		);
		assert.equal(refusal({ variant: 'Основной', operations: [remove(), 'x'] }), 'Операция 2: операция должна быть объектом.');
		assert.equal(refusal({ variant: 'Основной', operations: [{ variant: 'Основной' }] }), 'Операция 1: не задано имя операции (op).');
		assert.equal(
			refusal({ variant: 'Основной', operations: [] }),
			'Пакет конструктора настроек не разобран: в нём нет операций.'
		);
		assert.equal(refusal({ variant: 'Основной' }), 'Пакет конструктора настроек не разобран: в нём нет операций.');
		assert.equal(refusal({ operations: [remove()] }), 'Пакет конструктора настроек не разобран: не назван вариант настроек.');
	});
});

describe('Канал пакета СКД: всё, что строит диалог мастера, канал пропускает', () => {
	const STATES: Array<{ label: string; edit: (state: Record<string, unknown>) => void }> = [
		{ label: 'как открыт диалог', edit: () => undefined },
		{
			label: 'список с иерархией',
			edit: (state) => {
				state.type = 'list';
				state.details = true;
				(state.groupings as Record<string, unknown[]>).levels = [{ field: 'Организация', groupType: 'Hierarchy' }];
			},
		},
		{
			label: 'таблица',
			edit: (state) => {
				state.type = 'table';
				const groupings = state.groupings as Record<string, unknown[]>;
				groupings.rows = [{ field: 'Организация' }, { field: 'Период' }];
				groupings.columns = [{ field: 'Валюта' }];
			},
		},
		{
			label: 'диаграмма',
			edit: (state) => {
				state.type = 'chart';
				state.chartType = 'Pie3D';
				const groupings = state.groupings as Record<string, unknown[]>;
				groupings.tables = [{ field: 'Организация' }];
				groupings.series = [{ field: 'Период' }];
			},
		},
	];

	for (const [key, sample] of Object.entries(samples)) {
		test(`образец «${key}»: замена и «В новый вариант…» — пакет разобран без отказа`, () => {
			for (const entry of STATES) {
				const state = JSON.parse(JSON.stringify(wizard.initialWizardState(sample.settings))) as Record<string, unknown>;
				entry.edit(state);
				for (const [variant, options] of [
					[sample.variant, undefined],
					['МастерКопия', { newVariant: true, presentation: 'Копия' }],
				] as const) {
					const operations = wizard.planWizardOperations(options ? null : sample.settings, state, variant, options);
					if (operations.length === 0) {
						continue;
					}
					const result = parse({ variant, operations: JSON.parse(JSON.stringify(operations)) });
					assert.ok(!('error' in result), `${key} / ${entry.label} / ${variant}: ${'error' in result ? result.error : ''}`);
					assert.equal(result.mutations.length, operations.length);
					assert.equal(dcsBatchProblem('settings', result.mutations), undefined);
				}
			}
		});
	}
});

describe('Канал пакета СКД: параметры и ответ apply-mutation', () => {
	test('файл и версия схемы — в каждой операции, флаги пакета — нет', () => {
		const mutations: DcsBatchMutation[] = [
			{ op: 'cf-dcs-add-settings-variant', name: 'Сводка' },
			{ op: 'cf-dcs-set-order', variant: 'Сводка', payloadJson: '{"path":[],"items":[]}' },
		];
		const params = dcsBatchParamsOf(mutations, 'C:/x/Template.xml', 'V2_20');
		assert.deepEqual(params, {
			op: 'batch',
			operations: [
				{ op: 'cf-dcs-add-settings-variant', name: 'Сводка', objectXml: 'C:/x/Template.xml', schemaVersion: 'V2_20' },
				{
					op: 'cf-dcs-set-order',
					variant: 'Сводка',
					payloadJson: '{"path":[],"items":[]}',
					objectXml: 'C:/x/Template.xml',
					schemaVersion: 'V2_20',
				},
			],
		});
		assert.equal(params.objectXml, undefined, 'у пакета файла нет — он в операциях');
		assert.equal((mutations[0] as Record<string, unknown>).objectXml, undefined, 'разобранные правки не меняются');
	});

	test('ответ пакета — массив строк; автозаполнение — ответ своей операции', () => {
		assert.deepEqual(dcsBatchAnswersOf('["OK","OK"]\n'), ['OK', 'OK']);
		assert.equal(dcsBatchAnswersOf('OK'), undefined);
		assert.equal(dcsBatchAnswersOf('[1]'), undefined);
		const params = dcsBatchParamsOf(
			[
				{ op: 'cf-dcs-set-query', tag: 'Набор', payloadJson: 'ВЫБРАТЬ 1 КАК Поле' },
				{ op: 'cf-dcs-autofill-fields', dataSet: 'Набор' },
			],
			'C:/x/Template.xml',
			'V2_20'
		);
		assert.deepEqual(dcsAutofillOfResult(params, JSON.stringify(['OK', '{"added":["Поле"],"skipped":[]}'])), {
			added: ['Поле'],
			skipped: [],
		});
		assert.equal(dcsAutofillOfResult(dcsBatchParamsOf([{ op: 'cf-dcs-set-order', variant: 'В' }], 'f', 'V2_20'), '["OK"]'), undefined);
		// Одиночное автозаполнение — весь stdout
		assert.deepEqual(dcsAutofillOfResult({ op: 'cf-dcs-autofill-fields' }, '{"added":[],"skipped":[]}'), { added: [], skipped: [] });
		assert.equal(dcsAutofillOfResult({ op: 'cf-dcs-set-order' }, 'OK'), undefined);
	});
});

describe('Канал пакета СКД: ресурсы пачкой («<<» и «>>» закладки «Ресурсы»)', () => {
	test('каталог totals — удаление и добавление ресурса; чужая правка не проходит', () => {
		assert.deepEqual([...DCS_BATCH_OPS.totals], ['cf-dcs-remove-total-field', 'cf-dcs-add-total-field']);
		assert.equal(dcsBatchProblem('totals', [{ op: 'cf-dcs-remove-total-field', index: 0 }]), undefined);
		assert.equal(dcsBatchProblem('totals', [{ op: 'cf-dcs-add-total-field', payloadJson: '{}' }]), undefined);
		assert.match(dcsBatchProblem('totals', [{ op: 'cf-dcs-remove-field', dataSet: 'А', dataPath: 'Б' }]) || '', /^Операция 1 \(cf-dcs-remove-field\): не входит в каталог правок ресурсов\.$/);
		assert.match(dcsBatchProblem('totals', []) || '', /^Пакет ресурсов пуст/);
		assert.equal(DCS_BATCH_OPS.query.has('cf-dcs-remove-total-field' as never), false);
		assert.equal(DCS_BATCH_OPS.settings.has('cf-dcs-remove-total-field' as never), false);
		assert.equal(DCS_BATCH_OPS.query.has('cf-dcs-add-total-field' as never), false);
		assert.equal(DCS_BATCH_OPS.settings.has('cf-dcs-add-total-field' as never), false);
	});

	test('dcs/remove-total-fields: номера от большего к меньшему, отказ у пустого списка, повтора, не целого и отрицательного', () => {
		assert.equal(DCS_REMOVE_TOTAL_FIELDS_MESSAGE, 'dcs/remove-total-fields');
		const batch = dcsRemoveTotalFieldsBatchOf({ type: DCS_REMOVE_TOTAL_FIELDS_MESSAGE, indexes: [0, 2, 1] });
		assert.ok(!('error' in batch), JSON.stringify(batch));
		assert.deepEqual(batch.mutations, [
			{ op: 'cf-dcs-remove-total-field', index: 2 },
			{ op: 'cf-dcs-remove-total-field', index: 1 },
			{ op: 'cf-dcs-remove-total-field', index: 0 },
		]);
		// Параметры пакета — те же, что у остальных каналов: файл и версия схемы в каждой операции
		const params = dcsBatchParamsOf(batch.mutations, 'C:/x/Template.xml', 'V2_20');
		assert.equal(params.op, 'batch');
		assert.deepEqual(params.operations?.map((operation) => [operation.op, operation.index, operation.objectXml]), [
			['cf-dcs-remove-total-field', 2, 'C:/x/Template.xml'],
			['cf-dcs-remove-total-field', 1, 'C:/x/Template.xml'],
			['cf-dcs-remove-total-field', 0, 'C:/x/Template.xml'],
		]);
		for (const [indexes, pattern] of [
			[undefined, /не названы номера ресурсов/],
			[[], /не названы номера ресурсов/],
			['0,1', /не названы номера ресурсов/],
			[[0, 0], /номер 0 назван дважды/],
			[[1.5], /«1\.5» это не номер ресурса/],
			[[-1], /«-1» это не номер ресурса/],
			[['1'], /«1» это не номер ресурса/],
		] as Array<[unknown, RegExp]>) {
			const answer = dcsRemoveTotalFieldsBatchOf({ type: DCS_REMOVE_TOTAL_FIELDS_MESSAGE, indexes } as DcsPanelMessage);
			assert.ok('error' in answer, JSON.stringify(indexes));
			assert.match(answer.error, pattern);
			assert.ok(answer.error.startsWith('Ресурсы не удалены: '), answer.error);
		}
		// Одиночная правка его не разбирает: это пакет, а не мутация маппера
		assert.equal(dcsMutationOf({ type: DCS_REMOVE_TOTAL_FIELDS_MESSAGE, indexes: [0] } as DcsPanelMessage), undefined);
	});

	test('dcs/add-total-fields («>>»): payload каждого ресурса — как у окна «Новый ресурс», порядок сохраняется; отказы до jar', () => {
		assert.equal(DCS_ADD_TOTAL_FIELDS_MESSAGE, 'dcs/add-total-fields');
		const payloads = [
			{ dataPath: 'Сумма', expression: 'Сумма(Сумма)' },
			{ dataPath: 'Контрагент.Долг', expression: 'Сумма(Контрагент.Долг)' },
			{ dataPath: 'Сумма', expression: 'Сумма(Сумма)', groups: ['Склад'] },
		];
		const batch = dcsAddTotalFieldsBatchOf({ type: DCS_ADD_TOTAL_FIELDS_MESSAGE, payloads });
		assert.ok(!('error' in batch), JSON.stringify(batch));
		// Та же операция и та же форма payload, что у одиночного dcs/add-total-field (окно «Новый ресурс» и «>»)
		assert.deepEqual(
			batch.mutations,
			payloads.map((payload) => dcsMutationOf({ type: 'dcs/add-total-field', payload }))
		);
		assert.deepEqual(
			batch.mutations.map((mutation) => JSON.parse(mutation.payloadJson ?? '') as unknown),
			payloads,
			'порядок ресурсов — порядок полей'
		);
		assert.equal(dcsBatchProblem('totals', batch.mutations), undefined);
		const params = dcsBatchParamsOf(batch.mutations, 'C:/x/Template.xml', 'V2_20');
		assert.deepEqual(params.operations?.map((operation) => [operation.op, operation.objectXml, operation.schemaVersion]), [
			['cf-dcs-add-total-field', 'C:/x/Template.xml', 'V2_20'],
			['cf-dcs-add-total-field', 'C:/x/Template.xml', 'V2_20'],
			['cf-dcs-add-total-field', 'C:/x/Template.xml', 'V2_20'],
		]);
		for (const [value, pattern] of [
			[undefined, /не названы новые ресурсы \(payloads\)/],
			[[], /не названы новые ресурсы/],
			[{ dataPath: 'А', expression: 'Сумма(А)' }, /не названы новые ресурсы/],
			[[null], /ресурс 1: не объект\./],
			[[['А']], /ресурс 1: не объект\./],
			[[{ dataPath: 'А', expression: 'Сумма(А)' }, { expression: 'Сумма(Б)' }], /ресурс 2: не задано поле \(dataPath\)\./],
			[[{ dataPath: ' ', expression: 'Сумма(А)' }], /ресурс 1: не задано поле/],
			[[{ dataPath: 'А', expression: '' }], /ресурс 1: не задано выражение \(expression\)\./],
			[[{ dataPath: 'А', expression: 'Сумма(А)', groups: 'Склад' }], /ресурс 1: «Рассчитывать по» \(groups\) задано не списком полей\./],
			[[{ dataPath: 'А', expression: 'Сумма(А)', groups: [''] }], /задано не списком полей/],
			[[{ dataPath: 'А', expression: 'Сумма(А)', objectXml: 'C:/чужой.xml' }], /ресурс 1: поле «objectXml» у ресурса не задаётся\./],
		] as Array<[unknown, RegExp]>) {
			const answer = dcsAddTotalFieldsBatchOf({ type: DCS_ADD_TOTAL_FIELDS_MESSAGE, payloads: value } as DcsPanelMessage);
			assert.ok('error' in answer, JSON.stringify(value));
			assert.match(answer.error, pattern);
			assert.match(answer.error, /^Ресурсы не добавлены(: |, ресурс \d+: )/);
		}
		// Одиночная правка его не разбирает: это пакет, а не мутация маппера
		assert.equal(dcsMutationOf({ type: DCS_ADD_TOTAL_FIELDS_MESSAGE, payloads } as DcsPanelMessage), undefined);
	});
});
