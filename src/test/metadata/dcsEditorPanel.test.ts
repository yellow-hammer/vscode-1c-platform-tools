import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	DCS_MESSAGE_PREFIX,
	dcsAddTotalFieldsBatchOf,
	dcsAffectedSettingsVariant,
	dcsApplyQueryRequestOf,
	dcsBatchProblem,
	dcsMutationOf,
	dcsQueryBatchOf,
	dcsRemoveTotalFieldsBatchOf,
	dcsSettingsWizardBatchOf,
} from '../../features/metadata/dcsPanelMessages';
import type { DcsMutation, DcsPanelMessage } from '../../features/metadata/dcsPanelMessages';
import { DCS_EDITOR_PARTS, readEditorPart, readEditorScript } from '../fixtures/helpers/dcsEditorScript';

/** Разбор сообщения без оглядки на типы: webview может прислать что угодно. */
function parse(message: Record<string, unknown>): DcsMutation | undefined {
	return dcsMutationOf(message as unknown as DcsPanelMessage);
}

/**
 * Образцы правильных сообщений правок схемы: по одному на каждую операцию.
 *
 * В образцах только обязательные поля: проверка «без любого поля сообщение не разбирается»
 * перебирает их все.
 */
const VALID: Record<string, Record<string, unknown>> = {
	'dcs/add-data-set': { name: 'Продажи', dataSetType: 'query', dataSource: 'ИсточникДанных1' },
	'dcs/remove-data-set': { name: 'Продажи' },
	'dcs/rename-data-set': { name: 'Продажи', newName: 'ПродажиПоМесяцам' },
	'dcs/set-data-set-props': { name: 'Продажи', payload: { autoFillFields: false, objectName: 'Продажи' } },
	'dcs/add-field': { dataSet: 'Продажи', payload: { dataPath: 'Номенклатура', field: 'Номенклатура' } },
	'dcs/set-field': {
		dataSet: 'Продажи',
		dataPath: 'Номенклатура',
		payload: { title: 'Товар', useRestriction: { condition: true }, role: { dimension: true } },
	},
	'dcs/remove-field': { dataSet: 'Продажи', dataPath: 'Номенклатура' },
	'dcs/add-link': {
		payload: {
			sourceDataSet: 'Продажи',
			destinationDataSet: 'Цены',
			sourceExpression: 'Номенклатура',
			destinationExpression: 'Номенклатура',
		},
	},
	// required у связи окно шлёт только снятием: true платформа не хранит, и md-sparrow его отклоняет
	'dcs/set-link': { index: 0, payload: { required: false } },
	'dcs/remove-link': { index: 1 },
	'dcs/set-calculated-field': { dataPath: 'Сумма', payload: { expression: 'Цена * Количество' } },
	'dcs/remove-calculated-field': { dataPath: 'Сумма' },
	'dcs/add-total-field': { payload: { dataPath: 'Сумма', expression: 'Сумма(Сумма)', groups: ['Номенклатура'] } },
	'dcs/set-total-field': { index: 0, payload: { expression: 'Среднее(Сумма)' } },
	'dcs/remove-total-field': { index: 2 },
	'dcs/add-parameter': { payload: { name: 'Период', title: 'Период', use: 'Auto' } },
	'dcs/set-parameter': { name: 'Период', payload: { newName: 'ПериодОтчета' } },
	'dcs/remove-parameter': { name: 'Период' },
};

/**
 * Образцы правильных сообщений вариантов настроек: по одному на каждую мутацию.
 *
 * Как и в VALID, только обязательные поля. Нутро payload (пути, номера, элементы)
 * маппер не разбирает — его валидирует md-sparrow.
 */
const VALID_SETTINGS: Record<string, Record<string, unknown>> = {
	'dcs/add-settings-variant': { name: 'Сводный' },
	'dcs/remove-settings-variant': { name: 'Сводный' },
	'dcs/set-settings-variant-props': { name: 'Основной', payload: { newName: 'ОсновнойПоСкладам' } },
	'dcs/add-structure-item': {
		variant: 'Основной',
		payload: { parentPath: [], list: 'structure', kind: 'group', groupFields: [] },
	},
	'dcs/remove-structure-item': { variant: 'Основной', payload: { path: [{ list: 'structure', index: 0 }] } },
	'dcs/move-structure-item': { variant: 'Основной', payload: { path: [{ list: 'structure', index: 1 }], newIndex: 0 } },
	'dcs/set-group-fields': {
		variant: 'Основной',
		payload: {
			path: [{ list: 'structure', index: 0 }],
			items: [{ field: 'Склад', groupType: 'Items', periodAdditionType: 'None' }],
		},
	},
	'dcs/set-selection': { variant: 'Основной', payload: { path: [], items: [{ kind: 'auto' }] } },
	'dcs/set-order': { variant: 'Основной', payload: { path: [], items: [{ kind: 'field', field: 'Период', orderType: 'Desc' }] } },
	'dcs/set-filter': {
		variant: 'Основной',
		payload: {
			path: [],
			items: [{ kind: 'comparison', left: 'Склад', comparisonType: 'Equal', right: [{ type: 'xs:string', decoded: 'Главный' }] }],
		},
	},
	'dcs/set-parameter-value': {
		variant: 'Основной',
		payload: { section: 'data', parameter: 'Период', value: '2026-01-01T00:00:00' },
	},
	'dcs/add-appearance-item': { variant: 'Основной', payload: { path: [], item: { presentation: 'Просрочено' } } },
	'dcs/set-appearance-item': { variant: 'Основной', payload: { path: [], index: 0, item: { use: false } } },
	'dcs/remove-appearance-item': { variant: 'Основной', payload: { path: [], index: 0 } },
};

/**
 * Образец правильного сообщения автозаполнения полей набора.
 *
 * `dcs/validate` сюда не входит: это чтение, панель отвечает на него сообщением
 * `validation`, а не правкой через маппер.
 */
const VALID_AUTOFILL: Record<string, Record<string, unknown>> = {
	'dcs/autofill-fields': { dataSet: 'ОсновнойЗапрос' },
};

/** Читающие dcs/-сообщения панели: мутациями не разбираются. */
const DCS_READ_MESSAGES: ReadonlySet<string> = new Set([
	'dcs/load-variant',
	'dcs/validate',
	// дерево объектов конструктора запроса
	'dcs/list-metadata',
	// словарь окна «Тип значения» — cf-dcs-type-dictionary
	'dcs/type-dictionary',
	// описание объекта для подсказки через точку — cf-md-query-tables
	'dcs/describe-type',
	// таблицы объекта для дерева конструктора запроса — cf-md-query-tables
	'dcs/query-tables',
]);

/**
 * Пакетные dcs/-сообщения: не одна правка маппера, а пакет apply-mutation op:"batch" — разбирает
 * их канал пакета (dcsSettingsWizardBatchOf у мастера настроек, dcsApplyQueryRequestOf и
 * dcsQueryBatchOf у конструктора запроса), образец полей — здесь же.
 */
const DCS_BATCH_MESSAGES: Record<string, Record<string, unknown>> = {
	'dcs/settings-wizard': {
		variant: 'Основной',
		operations: [
			{ op: 'cf-dcs-remove-structure-item', variant: 'Основной', payload: { path: [{ list: 'structure', index: 0 }] } },
			{ op: 'cf-dcs-add-structure-item', variant: 'Основной', payload: { parentPath: [], list: 'structure', kind: 'group' } },
		],
	},
	'dcs/apply-query': {
		dataSet: 'Объединение/ОсновнойЗапрос',
		text: 'ВЫБРАТЬ\n\tТ.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Т\nГДЕ\n\tТ.Код = &Код',
		addParameters: ['Код'],
		autofill: true,
	},
	// «<<» и «>>» закладки «Ресурсы» — ресурсы одним пакетом канала totals
	'dcs/remove-total-fields': { indexes: [0, 1] },
	'dcs/add-total-fields': {
		payloads: [
			{ dataPath: 'Сумма', expression: 'Сумма(Сумма)' },
			{ dataPath: 'Количество', expression: 'Сумма(Количество)' },
		],
	},
};

/** Сообщение операции из образца: тип плюс поля. */
function message(type: string): Record<string, unknown> {
	return { type, ...(VALID[type] ?? VALID_SETTINGS[type] ?? VALID_AUTOFILL[type]) };
}

suite('Правки СКД из сообщений webview', () => {
	test('тип сообщения переходит в операцию по правилу dcs/<операция> → cf-dcs-<операция>', () => {
		for (const type of Object.keys(VALID)) {
			const mutation = parse(message(type));
			assert.ok(mutation, `сообщение ${type} не разобрано`);
			assert.strictEqual(mutation.op, `cf-dcs-${type.slice(DCS_MESSAGE_PREFIX.length)}`, type);
		}
	});

	test('покрыты все операции правок схемы', () => {
		const ops = Object.keys(VALID).map((type) => parse(message(type))?.op);
		assert.deepStrictEqual(
			[...ops].sort(),
			[
				'cf-dcs-add-data-set',
				'cf-dcs-add-field',
				'cf-dcs-add-link',
				'cf-dcs-add-parameter',
				'cf-dcs-add-total-field',
				'cf-dcs-remove-calculated-field',
				'cf-dcs-remove-data-set',
				'cf-dcs-remove-field',
				'cf-dcs-remove-link',
				'cf-dcs-remove-parameter',
				'cf-dcs-remove-total-field',
				'cf-dcs-rename-data-set',
				'cf-dcs-set-calculated-field',
				'cf-dcs-set-data-set-props',
				'cf-dcs-set-field',
				'cf-dcs-set-link',
				'cf-dcs-set-parameter',
				'cf-dcs-set-total-field',
			]
		);
	});

	test('адресация уходит одноимёнными параметрами, payload строкой JSON', () => {
		const mutation = parse(message('dcs/set-field'));
		assert.ok(mutation);
		assert.strictEqual(mutation.dataSet, 'Продажи');
		assert.strictEqual(mutation.dataPath, 'Номенклатура');
		assert.deepStrictEqual(JSON.parse(mutation.payloadJson ?? ''), {
			title: 'Товар',
			useRestriction: { condition: true },
			role: { dimension: true },
		});
	});

	test('правка без полезной нагрузки не несёт лишних параметров', () => {
		assert.deepStrictEqual(parse(message('dcs/rename-data-set')), {
			op: 'cf-dcs-rename-data-set',
			name: 'Продажи',
			newName: 'ПродажиПоМесяцам',
		});
	});

	test('новый набор несёт вид и источник данных', () => {
		assert.deepStrictEqual(parse(message('dcs/add-data-set')), {
			op: 'cf-dcs-add-data-set',
			name: 'Продажи',
			type: 'query',
			dataSource: 'ИсточникДанных1',
		});
	});

	test('связь и ресурс адресуются порядковым номером, ноль тоже номер', () => {
		assert.strictEqual(parse(message('dcs/set-link'))?.index, 0);
		assert.strictEqual(parse(message('dcs/remove-link'))?.index, 1);
		assert.strictEqual(parse(message('dcs/remove-total-field'))?.index, 2);
	});

	test('группировки ресурса доезжают в payload списком', () => {
		const mutation = parse(message('dcs/add-total-field'));
		assert.deepStrictEqual(JSON.parse(mutation?.payloadJson ?? ''), {
			dataPath: 'Сумма',
			expression: 'Сумма(Сумма)',
			groups: ['Номенклатура'],
		});
	});

	test('сообщение без любого обязательного поля не разбирается', () => {
		for (const [type, fields] of Object.entries(VALID)) {
			for (const key of Object.keys(fields)) {
				const broken = message(type);
				delete broken[key];
				assert.strictEqual(parse(broken), undefined, `${type} без ${key}`);
			}
		}
	});

	test('пустая строка в адресации не разбирается', () => {
		for (const [type, fields] of Object.entries(VALID)) {
			for (const [key, value] of Object.entries(fields)) {
				if (typeof value !== 'string') {
					continue;
				}
				assert.strictEqual(parse({ ...message(type), [key]: '' }), undefined, `${type} с пустым ${key}`);
			}
		}
	});

	test('номер не числом, дробью или с минусом не разбирается', () => {
		assert.strictEqual(parse({ ...message('dcs/remove-link'), index: '1' }), undefined);
		assert.strictEqual(parse({ ...message('dcs/remove-link'), index: -1 }), undefined);
		assert.strictEqual(parse({ ...message('dcs/set-total-field'), index: 1.5 }), undefined);
	});

	test('полезная нагрузка не объектом не разбирается', () => {
		for (const payload of [null, [], 'строка', 42]) {
			assert.strictEqual(parse({ ...message('dcs/add-link'), payload }), undefined, String(payload));
		}
	});

	test('неизвестный вид нового набора не разбирается', () => {
		assert.strictEqual(parse({ ...message('dcs/add-data-set'), dataSetType: 'таблица' }), undefined);
	});

	test('чужие и незнакомые типы сообщений мапперу не принадлежат', () => {
		assert.strictEqual(parse({ type: 'setQuery', dataSet: 'Продажи', text: 'ВЫБРАТЬ 1' }), undefined);
		assert.strictEqual(parse({ type: 'addCalculatedField', dataPath: 'Сумма' }), undefined);
		assert.strictEqual(parse({ type: 'dcs/set-query', dataSet: 'Продажи' }), undefined);
		assert.strictEqual(parse({ type: 'dcs/чепуха' }), undefined);
		assert.strictEqual(parse({}), undefined);
	});

	test('лишние поля сообщению не мешают и в параметры не попадают', () => {
		const mutation = parse({ ...message('dcs/remove-parameter'), dataPath: 'Сумма', index: 3 });
		assert.deepStrictEqual(mutation, { op: 'cf-dcs-remove-parameter', name: 'Период' });
	});
});

suite('Правки вариантов настроек из сообщений webview', () => {
	test('тип сообщения переходит в операцию по правилу dcs/<операция> → cf-dcs-<операция>', () => {
		for (const type of Object.keys(VALID_SETTINGS)) {
			const mutation = parse(message(type));
			assert.ok(mutation, `сообщение ${type} не разобрано`);
			assert.strictEqual(mutation.op, `cf-dcs-${type.slice(DCS_MESSAGE_PREFIX.length)}`, type);
		}
	});

	test('покрыты все 14 мутаций вариантов настроек', () => {
		const ops = Object.keys(VALID_SETTINGS).map((type) => parse(message(type))?.op);
		assert.deepStrictEqual(
			[...ops].sort(),
			[
				'cf-dcs-add-appearance-item',
				'cf-dcs-add-settings-variant',
				'cf-dcs-add-structure-item',
				'cf-dcs-move-structure-item',
				'cf-dcs-remove-appearance-item',
				'cf-dcs-remove-settings-variant',
				'cf-dcs-remove-structure-item',
				'cf-dcs-set-appearance-item',
				'cf-dcs-set-filter',
				'cf-dcs-set-group-fields',
				'cf-dcs-set-order',
				'cf-dcs-set-parameter-value',
				'cf-dcs-set-selection',
				'cf-dcs-set-settings-variant-props',
			]
		);
	});

	test('вариантные правки адресуются полем variant, payload уходит строкой JSON', () => {
		for (const [type, fields] of Object.entries(VALID_SETTINGS)) {
			if (typeof fields.variant !== 'string') {
				continue;
			}
			const mutation = parse(message(type));
			assert.ok(mutation, type);
			assert.strictEqual(mutation.variant, fields.variant, type);
			assert.deepStrictEqual(JSON.parse(mutation.payloadJson ?? ''), fields.payload, type);
			assert.deepStrictEqual(Object.keys(mutation).sort(), ['op', 'payloadJson', 'variant'], type);
		}
	});

	test('новый вариант разбирается и без payload, представление доезжает, когда есть', () => {
		assert.deepStrictEqual(parse(message('dcs/add-settings-variant')), {
			op: 'cf-dcs-add-settings-variant',
			name: 'Сводный',
		});
		const withPresentation = parse({ ...message('dcs/add-settings-variant'), payload: { presentation: 'Сводный отчёт' } });
		assert.deepStrictEqual(JSON.parse(withPresentation?.payloadJson ?? ''), { presentation: 'Сводный отчёт' });
	});

	test('переименование варианта едет в payload, адресом остаётся старое имя', () => {
		const mutation = parse(message('dcs/set-settings-variant-props'));
		assert.strictEqual(mutation?.name, 'Основной');
		assert.strictEqual(mutation?.newName, undefined);
		assert.deepStrictEqual(JSON.parse(mutation?.payloadJson ?? ''), { newName: 'ОсновнойПоСкладам' });
	});

	test('сообщение без любого обязательного поля не разбирается', () => {
		for (const [type, fields] of Object.entries(VALID_SETTINGS)) {
			for (const key of Object.keys(fields)) {
				const broken = message(type);
				delete broken[key];
				assert.strictEqual(parse(broken), undefined, `${type} без ${key}`);
			}
		}
	});

	test('пустая строка в имени или варианте не разбирается', () => {
		for (const [type, fields] of Object.entries(VALID_SETTINGS)) {
			for (const [key, value] of Object.entries(fields)) {
				if (typeof value !== 'string') {
					continue;
				}
				assert.strictEqual(parse({ ...message(type), [key]: '' }), undefined, `${type} с пустым ${key}`);
			}
		}
	});

	test('полезная нагрузка не объектом не разбирается и у нового варианта', () => {
		for (const payload of [null, [], 'строка', 42]) {
			assert.strictEqual(parse({ ...message('dcs/add-settings-variant'), payload }), undefined, String(payload));
			assert.strictEqual(parse({ ...message('dcs/set-filter'), payload }), undefined, String(payload));
		}
	});

	test('нутро payload маппер не проверяет: пути и номера — дело md-sparrow', () => {
		const mutation = parse({ ...message('dcs/remove-appearance-item'), payload: { path: 'не массив', index: 'ноль' } });
		assert.ok(mutation, 'сообщение с сомнительным нутром payload должно уйти в md-sparrow');
		assert.deepStrictEqual(JSON.parse(mutation.payloadJson ?? ''), { path: 'не массив', index: 'ноль' });
	});

	test('dcs/load-variant — не мутация и маппером не разбирается', () => {
		assert.strictEqual(parse({ type: 'dcs/load-variant', variant: 'Основной' }), undefined);
	});
});

suite('Автозаполнение, чтения и пакеты из сообщений webview', () => {
	test('автозаполнение разбирается по правилу имён, адрес — имя набора', () => {
		assert.deepStrictEqual(parse(message('dcs/autofill-fields')), {
			op: 'cf-dcs-autofill-fields',
			dataSet: 'ОсновнойЗапрос',
		});
	});

	test('без имени набора или с пустым не разбирается', () => {
		assert.strictEqual(parse({ type: 'dcs/autofill-fields' }), undefined);
		assert.strictEqual(parse({ type: 'dcs/autofill-fields', dataSet: '' }), undefined);
	});

	test('читающие сообщения панели мутациями не разбираются', () => {
		for (const type of DCS_READ_MESSAGES) {
			assert.strictEqual(parse({ type, variant: 'Основной', dataSet: 'Основной' }), undefined, type);
		}
	});

	test('пакет конструктора настроек — не одиночная правка: его разбирает канал пакета', () => {
		const sample = { type: 'dcs/settings-wizard', ...DCS_BATCH_MESSAGES['dcs/settings-wizard'] };
		assert.strictEqual(parse(sample), undefined);
		const batch = dcsSettingsWizardBatchOf(sample as unknown as DcsPanelMessage);
		assert.ok(!('error' in batch), JSON.stringify(batch));
		assert.strictEqual(batch.variant, 'Основной');
		assert.deepStrictEqual(
			batch.mutations.map((mutation) => mutation.op),
			['cf-dcs-remove-structure-item', 'cf-dcs-add-structure-item']
		);
	});

	test('запись конструктора запроса — не одиночная правка: её разбирает канал пакета query', () => {
		const sample = { type: 'dcs/apply-query', ...DCS_BATCH_MESSAGES['dcs/apply-query'] };
		assert.strictEqual(parse(sample), undefined);
		const request = dcsApplyQueryRequestOf(sample as unknown as DcsPanelMessage);
		assert.ok(!('error' in request), JSON.stringify(request));
		const batch = dcsQueryBatchOf(request, ['Период']);
		assert.deepStrictEqual(
			batch.mutations.map((mutation) => mutation.op),
			['cf-dcs-set-query', 'cf-dcs-add-parameter', 'cf-dcs-autofill-fields']
		);
		assert.strictEqual(dcsBatchProblem('query', batch.mutations), undefined);
		assert.deepStrictEqual(dcsQueryBatchOf(request, ['код']).addedParameters, [], 'объявленный параметр без учёта регистра не дублируется');
	});

	test('«<<» закладки «Ресурсы» — не одиночная правка: её разбирает канал пакета totals', () => {
		const sample = { type: 'dcs/remove-total-fields', ...DCS_BATCH_MESSAGES['dcs/remove-total-fields'] };
		assert.strictEqual(parse(sample), undefined);
		const batch = dcsRemoveTotalFieldsBatchOf(sample as unknown as DcsPanelMessage);
		assert.ok(!('error' in batch), JSON.stringify(batch));
		assert.deepStrictEqual(batch.mutations.map((mutation) => mutation.index), [1, 0]);
		assert.strictEqual(dcsBatchProblem('totals', batch.mutations), undefined);
	});

	test('«>>» закладки «Ресурсы» — не одиночная правка: её разбирает канал пакета totals', () => {
		const sample = { type: 'dcs/add-total-fields', ...DCS_BATCH_MESSAGES['dcs/add-total-fields'] };
		assert.strictEqual(parse(sample), undefined);
		const batch = dcsAddTotalFieldsBatchOf(sample as unknown as DcsPanelMessage);
		assert.ok(!('error' in batch), JSON.stringify(batch));
		assert.deepStrictEqual(
			batch.mutations.map((mutation) => mutation.op),
			['cf-dcs-add-total-field', 'cf-dcs-add-total-field']
		);
		assert.strictEqual(dcsBatchProblem('totals', batch.mutations), undefined);
	});

	test('автозаполнение настройки вариантов не трогает', () => {
		const mutation = parse(message('dcs/autofill-fields'));
		assert.ok(mutation);
		assert.strictEqual(dcsAffectedSettingsVariant(mutation), undefined);
	});
});

suite('Вариант для перечитки настроек после правки', () => {
	/** Разобранная правка образца: до перечитки доходят только разобранные сообщения. */
	function mutation(type: string): DcsMutation {
		const parsed = parse(message(type));
		assert.ok(parsed, `сообщение ${type} не разобрано`);
		return parsed;
	}

	test('вариантные правки перечитывают свой вариант', () => {
		for (const [type, fields] of Object.entries(VALID_SETTINGS)) {
			if (typeof fields.variant !== 'string') {
				continue;
			}
			assert.strictEqual(dcsAffectedSettingsVariant(mutation(type)), fields.variant, type);
		}
	});

	test('новый вариант перечитывается по своему имени', () => {
		assert.strictEqual(dcsAffectedSettingsVariant(mutation('dcs/add-settings-variant')), 'Сводный');
	});

	test('после переименования вариант ищется под новым именем', () => {
		assert.strictEqual(dcsAffectedSettingsVariant(mutation('dcs/set-settings-variant-props')), 'ОсновнойПоСкладам');
	});

	test('правка свойств без переименования остаётся на старом имени', () => {
		const parsed = parse({ type: 'dcs/set-settings-variant-props', name: 'Основной', payload: { presentation: 'Основной' } });
		assert.ok(parsed);
		assert.strictEqual(dcsAffectedSettingsVariant(parsed), 'Основной');
	});

	test('после удаления варианта перечитывать нечего', () => {
		assert.strictEqual(dcsAffectedSettingsVariant(mutation('dcs/remove-settings-variant')), undefined);
	});

	test('правки схемы настройки не перечитывают', () => {
		for (const type of Object.keys(VALID)) {
			assert.strictEqual(dcsAffectedSettingsVariant(mutation(type)), undefined, type);
		}
	});
});

suite('Правки СКД на именах реальной схемы', () => {
	// Срез выгрузки БСП 3.1: источник и регенерация — src/test/fixtures/dcs/README.md
	const fixturePath = path.resolve(__dirname, '../../..', 'src', 'test', 'fixtures', 'dcs', 'Template.xml');
	const schema = fs.readFileSync(fixturePath, 'utf8');

	/** Опорные имена фикстуры; первый тест проверяет, что все они в схеме есть. */
	const REAL = {
		querySet: 'ОсновнойЗапрос',
		objectSet: 'ВнешняяТаблица',
		fieldPath: 'Идентификатор',
		calculatedPath: 'ПравилоПроверкиПричиныПроблемы',
		totalPath: 'КоличествоПроблемСОбъектом',
		parameter: 'Контекст',
		dataSource: 'ИсточникДанных1',
	};

	test('опорные имена есть в фикстуре', () => {
		for (const [key, name] of Object.entries(REAL)) {
			assert.ok(
				schema.includes(`<name>${name}</name>`) || schema.includes(`<dataPath>${name}</dataPath>`),
				`${key}: в фикстуре нет ${name}`
			);
		}
	});

	test('кириллические имена уходят в адресацию без искажений', () => {
		assert.deepStrictEqual(
			parse({ type: 'dcs/rename-data-set', name: REAL.objectSet, newName: `${REAL.objectSet}2` }),
			{ op: 'cf-dcs-rename-data-set', name: 'ВнешняяТаблица', newName: 'ВнешняяТаблица2' }
		);
		assert.deepStrictEqual(parse({ type: 'dcs/remove-field', dataSet: REAL.objectSet, dataPath: REAL.fieldPath }), {
			op: 'cf-dcs-remove-field',
			dataSet: 'ВнешняяТаблица',
			dataPath: 'Идентификатор',
		});
		assert.deepStrictEqual(parse({ type: 'dcs/remove-parameter', name: REAL.parameter }), {
			op: 'cf-dcs-remove-parameter',
			name: 'Контекст',
		});
	});

	test('новый набор собирается на источнике данных схемы', () => {
		const mutation = parse({
			type: 'dcs/add-data-set',
			name: 'НоваяТаблица',
			dataSetType: 'object',
			dataSource: REAL.dataSource,
		});
		assert.strictEqual(mutation?.op, 'cf-dcs-add-data-set');
		assert.strictEqual(mutation?.dataSource, 'ИсточникДанных1');
	});

	test('связь из фикстуры доезжает в payload, кириллица в JSON не экранируется', () => {
		const payload = {
			sourceDataSet: REAL.objectSet,
			destinationDataSet: REAL.querySet,
			sourceExpression: 'Идентификатор',
			destinationExpression: 'ИдентификаторПроверки',
		};
		const mutation = parse({ type: 'dcs/add-link', payload });
		assert.ok(mutation?.payloadJson?.includes('"ИдентификаторПроверки"'), mutation?.payloadJson ?? 'payload не собран');
		assert.deepStrictEqual(JSON.parse(mutation?.payloadJson ?? ''), payload);
	});

	test('выражение с кавычками переживает сериализацию', () => {
		const expression = 'ПравилоПроверкиПричиныПроблемы + " *"';
		assert.ok(schema.includes(`<expression>${expression}</expression>`), 'выражения нет в фикстуре');
		const mutation = parse({ type: 'dcs/set-calculated-field', dataPath: REAL.calculatedPath, payload: { expression } });
		assert.strictEqual(JSON.parse(mutation?.payloadJson ?? '').expression, expression);
	});

	test('группировки ресурса из фикстуры доезжают списком', () => {
		const groups = ['ВидПроверки', 'Ответственный', 'ОтветственныйГруппировка', 'ПравилоПроверки', 'ОбщийИтог'];
		for (const group of groups) {
			assert.ok(schema.includes(`<group>${group}</group>`), `группировки ${group} нет в фикстуре`);
		}
		const mutation = parse({
			type: 'dcs/set-total-field',
			index: 0,
			payload: { dataPath: REAL.totalPath, expression: `Количество(${REAL.totalPath})`, groups },
		});
		assert.deepStrictEqual(JSON.parse(mutation?.payloadJson ?? '').groups, groups);
	});
});

suite('Правки вариантов настроек на именах реальной схемы', () => {
	// Срез выгрузки БСП 3.1 с шестью вариантами: источник и регенерация — src/test/fixtures/dcs/README.md
	const fixturePath = path.resolve(__dirname, '../../..', 'src', 'test', 'fixtures', 'dcs', 'Template-variants.xml');
	const schema = fs.readFileSync(fixturePath, 'utf8');

	/** Опорные фрагменты фикстуры; первый тест проверяет, что все они в схеме есть. */
	const ANCHORS = {
		variant: '<dcsset:name>Основной</dcsset:name>',
		renameSource: '<dcsset:name>Дополнительный5</dcsset:name>',
		groupField: '<dcsset:field>Период</dcsset:field>',
		selectionField: '<dcsset:field>Размер</dcsset:field>',
		dataParameter: '<dcscor:parameter>МинимальнаяСкоростьФормирования</dcscor:parameter>',
		chart: 'xsi:type="dcsset:StructureItemChart"',
		nilBoundary: '<dcsset:periodAdditionBegin xsi:nil="true"/>',
	};

	test('опорные фрагменты есть в фикстуре', () => {
		for (const [key, anchor] of Object.entries(ANCHORS)) {
			assert.ok(schema.includes(anchor), `${key}: в фикстуре нет ${anchor}`);
		}
	});

	test('кириллические имена вариантов уходят в адресацию без искажений', () => {
		assert.deepStrictEqual(parse({ type: 'dcs/remove-settings-variant', name: 'Дополнительный5' }), {
			op: 'cf-dcs-remove-settings-variant',
			name: 'Дополнительный5',
		});
		const rename = parse({
			type: 'dcs/set-settings-variant-props',
			name: 'Дополнительный5',
			payload: { newName: 'ДополнительныйПоАвторам', presentation: 'Демо: По авторам' },
		});
		assert.ok(rename);
		assert.strictEqual(rename.name, 'Дополнительный5');
		assert.ok(rename.payloadJson?.includes('"ДополнительныйПоАвторам"'), 'кириллица в JSON не экранируется');
		assert.strictEqual(dcsAffectedSettingsVariant(rename), 'ДополнительныйПоАвторам');
	});

	test('путь из шагов до группы точек второй диаграммы доезжает в payload без потерь', () => {
		// В варианте «Основной» structure = [группировка, диаграмма, диаграмма]; у второй диаграммы
		// дополнение периода Day и nil-граница начала — пятёрка уходит целиком, как пишет платформа
		const path = [
			{ list: 'structure', index: 2 },
			{ list: 'points', index: 0 },
		];
		const items = [
			{
				field: 'Период',
				groupType: 'Items',
				periodAdditionType: 'Day',
				periodAdditionBegin: { nil: true },
				periodAdditionEnd: { type: 'xs:dateTime', decoded: '0001-01-01T00:00:00' },
			},
		];
		const mutation = parse({ type: 'dcs/set-group-fields', variant: 'Основной', payload: { path, items } });
		assert.strictEqual(mutation?.op, 'cf-dcs-set-group-fields');
		assert.strictEqual(mutation?.variant, 'Основной');
		assert.deepStrictEqual(JSON.parse(mutation?.payloadJson ?? ''), { path, items });
	});

	test('выбранные поля варианта собираются на полях фикстуры', () => {
		const items = [
			{ kind: 'field', field: 'Период' },
			{ kind: 'field', field: 'Размер', title: 'Размер, МБ', titleKind: 'lws' },
			{ kind: 'auto' },
		];
		const mutation = parse({ type: 'dcs/set-selection', variant: 'Основной', payload: { path: [], items } });
		assert.ok(mutation?.payloadJson?.includes('"Размер, МБ"'), mutation?.payloadJson ?? 'payload не собран');
		assert.deepStrictEqual(JSON.parse(mutation?.payloadJson ?? ''), { path: [], items });
	});

	test('элемент условного оформления уходит целиком: поля, условие, оформление и области', () => {
		const item = {
			fields: [{ field: 'Размер' }],
			filter: [
				{
					kind: 'comparison',
					left: 'Количество',
					comparisonType: 'Greater',
					right: [{ type: 'xs:decimal', decoded: 100 }],
				},
			],
			appearance: [{ parameter: 'ЦветФона', value: [{ type: 'v8ui:Color', decoded: '#FFE0E0' }] }],
			presentation: 'Крупные файлы',
			useIn: { overall: 'DontUse' },
		};
		const mutation = parse({ type: 'dcs/add-appearance-item', variant: 'Основной', payload: { path: [], item } });
		assert.strictEqual(mutation?.op, 'cf-dcs-add-appearance-item');
		assert.deepStrictEqual(JSON.parse(mutation?.payloadJson ?? ''), { path: [], item });
		assert.strictEqual(dcsAffectedSettingsVariant(mutation), 'Основной');
	});

	test('точечная правка параметра данных адресуется реальным именем', () => {
		const mutation = parse({
			type: 'dcs/set-parameter-value',
			variant: 'Основной',
			payload: { section: 'data', parameter: 'МинимальнаяСкоростьФормирования', value: 5 },
		});
		assert.deepStrictEqual(JSON.parse(mutation?.payloadJson ?? ''), {
			section: 'data',
			parameter: 'МинимальнаяСкоростьФормирования',
			value: 5,
		});
	});
});

suite('Редактор СКД: разметка и скрипт', () => {
	const webviewRoot = path.resolve(__dirname, '../../..', 'resources', 'webview');

	function read(name: string): string {
		return fs.readFileSync(path.join(webviewRoot, name), 'utf8');
	}

	/**
	 * Типы сообщений, которые скрипт шлёт панели: литеральные вызовы send, sendPanelItems, post и postEdit (отправка без
	 * проверки занятости: фоновая запись текста запроса набора).
	 */
	function sentTypes(script: string): string[] {
		return [...script.matchAll(/\b(?:sendPanelItems|send|postEdit|post)\('([^']+)'/g)].map((match) => match[1]);
	}

	test('скрипт обращается только к элементам из разметки или созданным им самим', () => {
		const html = read('dcs-editor.html');
		const script = readEditorScript();
		const declared = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((match) => match[1]));
		// Элементы, которые скрипт создаёт сам (список подсказки, строки состояния), тоже законные адресаты
		for (const match of script.matchAll(/\.id = '([\w-]+)';/g)) {
			declared.add(match[1]);
		}
		const used = [...script.matchAll(/getElementById\('([\w-]+)'\)/g)].map((match) => match[1]);

		const missing = used.filter((id) => !declared.has(id));
		assert.deepStrictEqual(missing, [], `нет в разметке: ${missing.join(', ')}`);
	});

	test('шаблон подставляет данные, стили и скрипты', () => {
		const html = read('dcs-editor.html');
		for (const placeholder of [
			'{{CSP_SOURCE}}',
			'{{NONCE}}',
			'{{BASE_CSS_URI}}',
			'{{CSS_URI}}',
			'{{JS_URI}}',
			'{{HIGHLIGHT_JS_URI}}',
			'{{TITLE}}',
			'{{INITIAL_JSON}}',
		]) {
			assert.ok(html.includes(placeholder), `в шаблоне нет ${placeholder}`);
		}
	});

	test('модуль подсветки подключён до основного скрипта и используется им', () => {
		const html = read('dcs-editor.html');
		// Основной скрипт берёт window.DcsHighlight при старте: порядок подключения обязателен
		assert.ok(html.indexOf('{{HIGHLIGHT_JS_URI}}') < html.indexOf('{{JS_URI}}'), 'подсветка подключена позже скрипта');
		assert.ok(readEditorScript().includes('window.DcsHighlight'), 'скрипт не берёт модуль подсветки');
		const highlight = read('dcs-editor-highlight.js');
		for (const name of ['HIGHLIGHT_LIMIT', 'function tokenize', 'function delimiterWarning', 'module.exports']) {
			assert.ok(highlight.includes(name), `в модуле подсветки нет ${name}`);
		}
	});

	test('конструктор запроса: модули по порядку, классы окна в стилях, отправки окна разбирает панель', () => {
		const html = read('dcs-editor.html');
		// Операции нужны основному скрипту при старте, окно берёт его API — порядок подключения обязателен
		const order = ['{{QUERY_MODEL_JS_URI}}', '{{QUERY_EDIT_JS_URI}}', '{{JS_URI}}', '{{QUERY_DIALOG_JS_URI}}'].map((placeholder) =>
			html.indexOf(placeholder)
		);
		assert.ok(
			order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])),
			`порядок модулей конструктора: ${order.join(', ')}`
		);
		const dialog = read('dcs-editor-query-dialog.js');
		assert.ok(readEditorScript().includes('window.DcsEditorApi = Object.freeze('), 'основной скрипт не отдаёт API окну');
		assert.ok(dialog.includes('window.DcsEditorApi'), 'окно не берёт API редактора');
		const css = read('dcs-editor.css');
		const classes = new Set(
			[...dialog.matchAll(/'([^']*\bdcs-[^']*)'/g)].flatMap((match) => match[1].split(/\s+/)).filter((name) => name.startsWith('dcs-'))
		);
		const unstyled = [...classes].filter((name) => !css.includes(`.${name}`));
		assert.deepStrictEqual(unstyled, [], `нет оформления: ${unstyled.join(', ')}`);
		const sent = sentTypes(dialog);
		assert.ok(sent.includes('dcs/apply-query'), 'ОК конструктора не шлёт dcs/apply-query');
		const known = new Set([...DCS_READ_MESSAGES, ...Object.keys(DCS_BATCH_MESSAGES)]);
		assert.deepStrictEqual(
			sent.filter((type) => !known.has(type)),
			[],
			'окно шлёт сообщение, которого панель не разбирает'
		);
	});

	test('запись текста запроса шлёт автозаполнение, кнопка — проверку схемы', () => {
		const sent = new Set(sentTypes(readEditorScript()));
		// Поля заполняются после записи текста при «Автозаполнении»
		assert.ok(sent.has('setQuery') && sent.has('dcs/autofill-fields'), 'запись текста запроса не шлёт setQuery и автозаполнение');
		assert.ok(sent.has('dcs/validate'), 'кнопка «Проверить схему» не шлёт чтение');
	});

	test('подсказка о типах полей — как в контракте', () => {
		assert.ok(
			readEditorScript().includes('Типы полей не выводятся: они задаются в свойствах поля.'),
			'подсказки про типы полей нет'
		);
	});

	test('правки уходят только сообщениями, которые панель разбирает', () => {
		const sent = sentTypes(readEditorScript());
		assert.ok(sent.length > 0, 'отправки сообщений в скрипте не разобраны');

		// Панель разбирает правки dcs/<операция> маппером, чтения, пакеты и две правки вне правила имён:
		// setQuery и addCalculatedField
		const known = new Set([
			...Object.keys(VALID),
			...Object.keys(VALID_SETTINGS),
			...Object.keys(VALID_AUTOFILL),
			...DCS_READ_MESSAGES,
			...Object.keys(DCS_BATCH_MESSAGES),
			'setQuery',
			'addCalculatedField',
		]);
		const unknown = sent.filter((type) => !known.has(type));
		assert.deepStrictEqual(unknown, [], `панель не разберёт: ${unknown.join(', ')}`);
	});

	test('каждое dcs/-сообщение скрипта разбирается маппером панели', () => {
		// Согласованность webview ↔ панель напрямую через dcsMutationOf: сообщение с полями
		// образца должно разобраться в операцию по правилу имён (чтения — не мутации)
		const sent = sentTypes(readEditorScript()).filter(
			(type) => type.startsWith(DCS_MESSAGE_PREFIX) && !DCS_READ_MESSAGES.has(type) && !(type in DCS_BATCH_MESSAGES)
		);
		assert.ok(sent.length > 0, 'dcs/-сообщения в скрипте не разобраны');
		for (const type of sent) {
			const mutation = parse(message(type));
			assert.ok(mutation, `панель не разберёт ${type}: нет образца полей или спеки сообщения`);
			assert.strictEqual(mutation.op, `cf-dcs-${type.slice(DCS_MESSAGE_PREFIX.length)}`, type);
		}
	});

	test('формы покрывают все операции правок схемы', () => {
		const sent = new Set(sentTypes(readEditorScript()));
		const missing = Object.keys(VALID).filter((type) => !sent.has(type));
		assert.deepStrictEqual(missing, [], `нет формы для: ${missing.join(', ')}`);
	});

	test('вкладка настроек шлёт ленивую загрузку и все 14 мутаций вариантов настроек', () => {
		const sent = new Set(sentTypes(readEditorScript()));
		const expected = ['dcs/load-variant', ...Object.keys(VALID_SETTINGS)];
		const missing = expected.filter((type) => !sent.has(type));
		assert.deepStrictEqual(missing, [], `нет формы для: ${missing.join(', ')}`);
	});

	test('панели узла подписаны и идут, как в конфигураторе', () => {
		const script = readEditorScript();
		const tail = script.slice(script.indexOf('const NODE_PANELS'));
		const titles = [...tail.slice(0, tail.indexOf('];')).matchAll(/title: '([^']+)'/g)].map((match) => match[1]);

		// Порядок вкладок конфигуратора; «Поля группировки» (только у группировки) — первыми
		assert.deepStrictEqual(titles, [
			'Поля группировки',
			'Параметры',
			'Выбранные поля',
			'Отбор',
			'Сортировка',
			'Условное оформление',
			'Пользовательские поля',
			'Другие настройки',
		]);
	});

	test('вкладки подписаны и идут, как в конфигураторе', () => {
		const script = readEditorScript();
		const tail = script.slice(script.indexOf('const TABS'));
		const titles = [...tail.slice(0, tail.indexOf('];')).matchAll(/title: '([^']+)'/g)].map((match) => match[1]);

		assert.deepStrictEqual(titles, [
			'Наборы данных',
			'Связи наборов данных',
			'Вычисляемые поля',
			'Ресурсы',
			'Параметры',
			'Вложенные схемы',
			'Настройки',
		]);
	});

	test('оформление классов редактора лежит в стилях', () => {
		const css = read('dcs-editor.css');
		// Литералы ищутся в каждой части отдельно: на стыке частей кавычки чужого файла дали бы ложный «литерал»
		const classes = new Set(
			DCS_EDITOR_PARTS.map(readEditorPart).flatMap((script) =>
				[...script.matchAll(/'([^']*\bdcs-[^']*)'/g)]
					.flatMap((match) => match[1].split(/\s+/))
					.filter((name) => name.startsWith('dcs-'))
			)
		);
		assert.ok(classes.size > 0, 'классы редактора в скрипте не разобраны');

		const missing = [...classes].filter((name) => !css.includes(`.${name}`));
		assert.deepStrictEqual(missing, [], `нет оформления: ${missing.join(', ')}`);
	});

	/** Литеральный блок скрипта: от объявления до ближайшей закрывающей скобки константы. */
	function scriptBlock(script: string, marker: string, close: string): string {
		const start = script.indexOf(marker);
		assert.ok(start >= 0, `в скрипте нет ${marker}`);
		const tail = script.slice(start);
		const end = tail.indexOf(close);
		assert.ok(end >= 0, `блок ${marker} не закрыт ${JSON.stringify(close)}`);
		return tail.slice(0, end + close.length);
	}

	test('виды сравнения отбора: 20 лексем XSD по порядку, подписи русские', () => {
		const script = readEditorScript();
		const block = scriptBlock(script, 'const COMPARISON_LABELS', '};');
		const keys = [...block.matchAll(/^\t\t(\w+): '[^']+',$/gm)].map((match) => match[1]);
		assert.deepStrictEqual(keys, [
			'Equal',
			'NotEqual',
			'Less',
			'LessOrEqual',
			'Greater',
			'GreaterOrEqual',
			'Contains',
			'InList',
			'InListByHierarchy',
			'InHierarchy',
			'NotContains',
			'NotInList',
			'NotInListByHierarchy',
			'NotInHierarchy',
			'Filled',
			'NotFilled',
			'BeginsWith',
			'NotBeginsWith',
			'Like',
			'NotLike',
		]);
		// Виды без значения и со списком значений — подмножества этих двадцати
		const noValue = scriptBlock(script, 'const NO_VALUE_COMPARISONS', '];');
		for (const lexeme of ['Filled', 'NotFilled']) {
			assert.ok(noValue.includes(`'${lexeme}'`), `без значения: нет ${lexeme}`);
		}
		const listKinds = scriptBlock(script, 'const LIST_COMPARISONS', '];');
		for (const lexeme of ['InList', 'InListByHierarchy', 'NotInList', 'NotInListByHierarchy']) {
			assert.ok(listKinds.includes(`'${lexeme}'`), `со списком: нет ${lexeme}`);
		}
	});

	test('варианты стандартного периода: полный enum data-core XSD с подписями', () => {
		const block = scriptBlock(readEditorScript(), 'const STANDARD_PERIOD_LABELS', '};');
		const entries = [...block.matchAll(/^\t\t(\w+): '([^']*)',$/gm)];
		assert.strictEqual(entries.length, 49, `вариантов периода ${entries.length}, а в XSD 49`);
		const keys = entries.map((match) => match[1]);
		assert.strictEqual(keys[0], 'Custom', 'произвольный период идёт первым');
		for (const lexeme of ['Today', 'FromBeginningOfThisYear', 'LastYearTillSameDate', 'TillEndOfThisYear', 'Last7Days', 'Next7Days', 'Month']) {
			assert.ok(keys.includes(lexeme), `нет варианта ${lexeme}`);
		}
		assert.ok(
			entries.every((match) => match[2].length > 0),
			'у каждого варианта непустая подпись'
		);
	});

	test('белый словарь параметров вывода: имена и типы из белого списка писателя', () => {
		const block = scriptBlock(readEditorScript(), 'const OUTPUT_PARAMS', '\n\t};');
		const names = [...block.matchAll(/^\t\t'([^']+)': \{/gm)].map((match) => match[1]);
		assert.deepStrictEqual(
			[...names].sort((a, b) => a.localeCompare(b, 'ru')),
			[
				'АвтоПозицияРесурсов',
				'ВариантИспользованияГруппировки',
				'ВертикальноеРасположениеОбщихИтогов',
				'ВыводитьЗаголовок',
				'ВыводитьОтбор',
				'ВыводитьПараметрыДанных',
				'ГоризонтальноеРасположениеОбщихИтогов',
				'Заголовок',
				'КоличествоЗаписей',
				'МакетОформления',
				'ПроцентЗаписей',
				'РасположениеГруппировки',
				'РасположениеИтогов',
				'РасположениеОбщихИтогов',
				'РасположениеПолейГруппировки',
				'РасположениеРеквизитов',
				'РасположениеРесурсов',
				// Тип диаграммы правится списком 47 лексем (v8ui:ChartType в белом списке md-sparrow)
				'ТипДиаграммы',
				'ТипЗаголовкаПолей',
				'ТипМакета',
				'ФиксацияСверху',
				'ФиксацияСлева',
			]
		);
		// Каждое значение словаря типизировано префиксом пространства из белого списка писателя
		const types = [...block.matchAll(/type: '([^']+)'/g)].map((match) => match[1]);
		assert.strictEqual(types.length, names.length, 'у каждого имени свой тип');
		assert.ok(
			types.every((type) => /^(dcsset|dcscor|xs|v8|v8ui):/.test(type)),
			`чужой префикс типа: ${types.join(', ')}`
		);
		// Вариант использования группировки — только у группировок
		assert.ok(block.includes("kinds: ['group']"), 'ВариантИспользованияГруппировки не ограничен группировкой');
	});

	test('области условного оформления: десять флагов контракта в порядке XSD', () => {
		const block = scriptBlock(readEditorScript(), 'const CA_USE_IN', '];');
		const keys = [...block.matchAll(/key: '(\w+)'/g)].map((match) => match[1]);
		assert.deepStrictEqual(keys, [
			'group',
			'hierarchicalGroup',
			'overall',
			'fieldsHeader',
			'header',
			'parameters',
			'filter',
			'resourceFieldsHeader',
			'overallHeader',
			'overallResourceFieldsHeader',
		]);
		const options = scriptBlock(readEditorScript(), 'const CA_USE_OPTIONS', '];');
		for (const lexeme of ["value: ''", "value: 'Use'", "value: 'DontUse'"]) {
			assert.ok(options.includes(lexeme), `нет значения флага ${lexeme}`);
		}
	});

	test('словарь параметров оформления — надёжная лексика цветов и строк', () => {
		const block = scriptBlock(readEditorScript(), 'const CA_APPEARANCE_PARAMS', '];');
		const names = [...block.matchAll(/name: '([^']+)'/g)].map((match) => match[1]);
		assert.deepStrictEqual(names, ['ЦветФона', 'ЦветТекста', 'ЦветГраницы', 'Текст', 'Формат']);
		const types = [...block.matchAll(/type: '([^']+)'/g)].map((match) => match[1]);
		assert.ok(
			types.every((type) => type === 'v8ui:Color' || type === 'v8:LocalStringType'),
			`в словаре оформления только цвета и строки: ${types.join(', ')}`
		);
	});

	test('сводки настроек на месте и честно помечают неизвестное', () => {
		const script = readEditorScript();
		for (const fn of [
			'function valueSummary',
			'function valuesSummary',
			'function filterItemSummary',
			'function filterSummary',
			'function appearanceSummary',
			'function useInSummary',
			'function fontSummary',
			'function userSettingBadge',
			'function createValueControl',
			'function valueModeOf',
		]) {
			assert.ok(script.includes(fn), `в скрипте нет ${fn}`);
		}
		// Булево и nil показываются словами, незнакомый тип — честной пометкой без правки
		assert.ok(script.includes("'Неопределено'"), 'nil показывается как «Неопределено»');
		assert.ok(script.includes("'Истина'") && script.includes("'Ложь'"), 'булево показывается словами');
		assert.ok(script.includes('правится в конфигураторе'), 'read-only значения помечаются причиной');
		// Сводка отбора опирается на словарь видов сравнения
		const summaryBlock = scriptBlock(script, 'function filterItemSummary', '\n\t}');
		assert.ok(summaryBlock.includes('comparisonLabel('), 'сводка отбора использует подписи видов сравнения');
		const appearanceBlock = scriptBlock(script, 'function appearanceSummary', '\n\t}');
		assert.ok(appearanceBlock.includes('valuesSummary('), 'сводка оформления использует сводку значений');
	});
});
