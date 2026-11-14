/**
 * Хост конструктора запроса СКД: канал пакета query и запись dcs/apply-query, дерево
 * «База данных» и его кэш по Configuration.xml, таблицы объекта dcs/query-tables (cf и EDT), язык
 * описаний.
 *
 * Кэш и адресация проверяются на временных файлах, а не на выгрузке: так видны отпечаток
 * Configuration.xml и отказы путей без запуска jar.
 * Запуск: npm run compile && node --test out/test/metadata/dcsQueryHost.node.js
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dcsCommonAttributeNames, isConfigurationExtensionXml, resolveDcsDescribeTarget, resolveDcsQueryTablesTarget } from '../../features/metadata/dcsTargets';
import { createDcsMetadataTreeCache } from '../../features/metadata/dcsMetadataTreeCache';
import {
	DCS_APPLY_QUERY_MESSAGE,
	DCS_BATCH_OPS,
	DCS_DESCRIBE_TYPE_MESSAGE,
	DCS_QUERY_TABLES_MESSAGE,
	DCS_QUERY_TREE_KINDS,
	dcsApplyQueryRequestOf,
	dcsBatchParamsOf,
	dcsBatchProblem,
	dcsDeclaredParameterNames,
	dcsDescribeRequestOf,
	dcsMutationOf,
	dcsQueryBatchOf,
	dcsQueryDataSetOf,
	dcsQueryDataSetProblem,
	dcsQueryLangOf,
	dcsQueryMetadataGroupsOf,
	dcsQueryTablesRequestOf,
	type DcsApplyQueryRequest,
	type DcsBatchMutation,
	type DcsPanelMessage,
} from '../../features/metadata/dcsPanelMessages';

const temps: string[] = [];
after(() => {
	for (const dir of temps) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function tempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temps.push(dir);
	return dir;
}

function write(root: string, relative: string, text: string): string {
	const file = path.join(root, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text, 'utf8');
	return file;
}

function configurationXml(version = '2.20'): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\r\n<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="${version}">\r\n\t<Configuration/>\r\n</MetaDataObject>`;
}

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

function request(fields: Partial<DcsApplyQueryRequest> = {}): DcsApplyQueryRequest {
	return { dataSet: 'Основной', text: 'ВЫБРАТЬ &Новый', addParameters: [], autofill: false, ...fields };
}

describe('Канал пакета query: белый каталог и один набор', () => {
	test('каталог канала — текст, параметр и автозаполнение; мастер настроек его операции не принимает', () => {
		assert.deepEqual([...DCS_BATCH_OPS.query].sort(), ['cf-dcs-add-parameter', 'cf-dcs-autofill-fields', 'cf-dcs-set-query']);
		for (const op of DCS_BATCH_OPS.query) {
			assert.ok(!DCS_BATCH_OPS.settings.has(op), op);
		}
	});

	test('пакет записи проходит проверку канала', () => {
		const batch = dcsQueryBatchOf(request({ addParameters: ['Новый'], autofill: true }), []);
		assert.equal(dcsBatchProblem('query', batch.mutations), undefined);
	});

	test('операции настроек и чужие правки схемы — отказ до jar с номером и именем операции', () => {
		const head: DcsBatchMutation = { op: 'cf-dcs-set-query', tag: 'Основной', payloadJson: 'ВЫБРАТЬ 1' };
		const settingsOp = dcsMutationOf({
			type: 'dcs/set-selection',
			variant: 'Основной',
			payload: { path: [], items: [] },
		} as DcsPanelMessage);
		assert.ok(settingsOp);
		assert.equal(
			dcsBatchProblem('query', [head, settingsOp]),
			'Операция 2 (cf-dcs-set-selection): не входит в каталог правок конструктора запроса.'
		);
		for (const op of ['cf-dcs-remove-data-set', 'cf-dcs-set-field', 'cf-dcs-add-settings-variant', 'cf-dcs-set-parameter'] as const) {
			const problem = dcsBatchProblem('query', [head, { op, name: 'Основной' }]);
			assert.match(problem ?? '', /^Операция 2 \(cf-dcs-[\w-]+\): не входит в каталог правок конструктора запроса\.$/, op);
		}
	});

	test('чужой набор посреди пакета — отказ: пакет пишет один запрос', () => {
		const problem = dcsBatchProblem('query', [
			{ op: 'cf-dcs-set-query', tag: 'Регистрация/ОпределениеПолей', payloadJson: 'ВЫБРАТЬ 1' },
			{ op: 'cf-dcs-autofill-fields', dataSet: 'Регистрация/Хвост/ОпределениеПолей' },
		]);
		assert.equal(
			problem,
			'Операция 2 (cf-dcs-autofill-fields): набор «Регистрация/Хвост/ОпределениеПолей» не совпадает с набором пакета «Регистрация/ОпределениеПолей».'
		);
		assert.equal(
			dcsBatchProblem('query', [
				{ op: 'cf-dcs-set-query', tag: 'Основной', payloadJson: 'ВЫБРАТЬ 1' },
				{ op: 'cf-dcs-set-query', tag: 'основной', payloadJson: 'ВЫБРАТЬ 2' },
			]),
			'Операция 2 (cf-dcs-set-query): набор «основной» не совпадает с набором пакета «Основной».'
		);
		assert.equal(
			dcsBatchProblem('query', [{ op: 'cf-dcs-set-query', payloadJson: 'ВЫБРАТЬ 1' }]),
			'Операция 1 (cf-dcs-set-query): не назван набор данных.'
		);
	});

	test('новый параметр — только именем: тип, значение и мусор в payload отклоняются', () => {
		const head: DcsBatchMutation = { op: 'cf-dcs-set-query', tag: 'Основной', payloadJson: 'ВЫБРАТЬ 1' };
		const cases: Array<[string | undefined, RegExp]> = [
			[JSON.stringify({ name: 'Период', valueType: { types: ['xs:dateTime'] } }), /поле «valueType» конструктор запроса не задаёт/],
			[JSON.stringify({ name: 'Период', value: 1 }), /поле «value»/],
			[JSON.stringify({ name: '&Период' }), /«&Период» это не имя параметра/],
			[JSON.stringify(['Период']), /нужен payload/],
			['не json', /нужен payload/],
			[undefined, /нужен payload/],
		];
		for (const [payloadJson, expected] of cases) {
			const problem = dcsBatchProblem('query', [head, { op: 'cf-dcs-add-parameter', payloadJson }]);
			assert.match(problem ?? '', /^Операция 2 \(cf-dcs-add-parameter\): /, String(payloadJson));
			assert.match(problem ?? '', expected, String(payloadJson));
		}
	});

	test('правила канала query не задевают пакет мастера настроек', () => {
		const settingsOp = dcsMutationOf({ type: 'dcs/set-order', variant: 'Основной', payload: { path: [], items: [] } } as DcsPanelMessage);
		assert.ok(settingsOp);
		assert.equal(dcsBatchProblem('settings', [settingsOp, settingsOp]), undefined);
		assert.equal(dcsBatchProblem('query', []), 'Пакет конструктора запроса пуст: в нём нет операций.');
	});
});

describe('Сообщение dcs/apply-query: разбор и пакет записи', () => {
	test('сообщение разбирается в путь набора, текст, имена параметров и признак автозаполнения', () => {
		assert.equal(DCS_APPLY_QUERY_MESSAGE, 'dcs/apply-query');
		const parsed = dcsApplyQueryRequestOf({
			type: DCS_APPLY_QUERY_MESSAGE,
			dataSet: ' Регистрация/ОпределениеПолей ',
			text: 'ВЫБРАТЬ &А, &Б',
			addParameters: ['А', 'Б'],
			autofill: true,
		});
		assert.deepEqual(parsed, { dataSet: 'Регистрация/ОпределениеПолей', text: 'ВЫБРАТЬ &А, &Б', addParameters: ['А', 'Б'], autofill: true });
		assert.deepEqual(dcsApplyQueryRequestOf({ type: DCS_APPLY_QUERY_MESSAGE, dataSet: 'Основной', text: '' }), {
			dataSet: 'Основной',
			text: '',
			addParameters: [],
			autofill: false,
		});
	});

	test('кривые сообщения отклоняются до чтения схемы', () => {
		for (const message of [
			{ text: 'ВЫБРАТЬ 1' },
			{ dataSet: '', text: 'ВЫБРАТЬ 1' },
			{ dataSet: 'Регистрация//Хвост', text: 'ВЫБРАТЬ 1' },
			{ dataSet: 'Основной' },
			{ dataSet: 'Основной', text: 'ВЫБРАТЬ 1', addParameters: 'Период' },
			{ dataSet: 'Основной', text: 'ВЫБРАТЬ 1', addParameters: ['&Период'] },
			{ dataSet: 'Основной', text: 'ВЫБРАТЬ 1', addParameters: ['Период.Начало'] },
			{ dataSet: 'Основной', text: 'ВЫБРАТЬ 1', autofill: 'да' },
		]) {
			const parsed = dcsApplyQueryRequestOf({ type: DCS_APPLY_QUERY_MESSAGE, ...message } as DcsPanelMessage);
			assert.ok('error' in parsed, JSON.stringify(message));
			assert.match(parsed.error, /^Запрос не записан: /);
		}
	});

	test('порядок пакета: текст, параметры, автозаполнение — набор по пути у текста и у автозаполнения', () => {
		const batch = dcsQueryBatchOf(
			request({ dataSet: 'Регистрация/ОпределениеПолей', text: 'ВЫБРАТЬ &А', addParameters: ['А', 'Б'], autofill: true }),
			[]
		);
		assert.deepEqual(batch.mutations, [
			{ op: 'cf-dcs-set-query', tag: 'Регистрация/ОпределениеПолей', payloadJson: 'ВЫБРАТЬ &А' },
			{ op: 'cf-dcs-add-parameter', payloadJson: '{"name":"А"}' },
			{ op: 'cf-dcs-add-parameter', payloadJson: '{"name":"Б"}' },
			{ op: 'cf-dcs-autofill-fields', dataSet: 'Регистрация/ОпределениеПолей' },
		]);
		assert.deepEqual(batch.addedParameters, ['А', 'Б']);
		const params = dcsBatchParamsOf(batch.mutations, 'C:/x/Template.xml', 'V2_20');
		assert.equal(params.op, 'batch');
		assert.ok(params.operations?.every((operation) => operation.objectXml === 'C:/x/Template.xml' && operation.schemaVersion === 'V2_20'));
	});

	test('объявленные параметры и повторы сверяются без учёта регистра: не дублируются', () => {
		const declared = dcsDeclaredParameterNames(INFO);
		assert.deepEqual(declared, ['Период', 'Организация']);
		const batch = dcsQueryBatchOf(
			request({ addParameters: ['период', 'ОРГАНИЗАЦИЯ', 'Склад', 'склад', 'Номенклатура'] }),
			declared
		);
		assert.deepEqual(batch.addedParameters, ['Склад', 'Номенклатура']);
		assert.deepEqual(
			batch.mutations.map((mutation) => mutation.op),
			['cf-dcs-set-query', 'cf-dcs-add-parameter', 'cf-dcs-add-parameter']
		);
	});

	test('без автозаполнения операции автозаполнения нет; без параметров — один текст', () => {
		const batch = dcsQueryBatchOf(request({ autofill: false }), []);
		assert.deepEqual(batch.mutations, [{ op: 'cf-dcs-set-query', tag: 'Основной', payloadJson: 'ВЫБРАТЬ &Новый' }]);
	});

	test('набор по пути, как его ищет cf-dcs-set-query: имя без «/» — только верхний уровень', () => {
		assert.equal(dcsQueryDataSetOf(INFO, 'Основной')?.query, 'ВЫБРАТЬ 1');
		assert.equal(dcsQueryDataSetOf(INFO, 'Регистрация/ОпределениеПолей')?.query, 'ВЫБРАТЬ 2');
		assert.equal(dcsQueryDataSetOf(INFO, 'Регистрация/Хвост/ОпределениеПолей')?.query, 'ВЫБРАТЬ 3');
		assert.equal(dcsQueryDataSetOf(INFO, 'ОпределениеПолей'), undefined, 'вложенный набор без пути не ищется');
		assert.equal(dcsQueryDataSetProblem(INFO, 'Основной'), undefined);
		assert.equal(dcsQueryDataSetProblem(INFO, 'Регистрация/Хвост/ОпределениеПолей'), undefined);
		assert.match(dcsQueryDataSetProblem(INFO, 'ОпределениеПолей') ?? '', /не найден/);
		assert.match(dcsQueryDataSetProblem(INFO, 'Регистрация') ?? '', /объединение: запрос пишется в его дочерний набор/);
		assert.match(dcsQueryDataSetProblem(INFO, 'Регистрация/Хвост') ?? '', /объединение/);
		assert.match(dcsQueryDataSetProblem(INFO, 'Объект') ?? '', /не набор-запрос/);
		assert.match(dcsQueryDataSetProblem(null, 'Основной') ?? '', /не найден/);
	});
});

describe('Дерево «База данных»: виды запроса в порядке конструктора', () => {
	/** Ответ project-metadata-tree в форме md-sparrow: планы обмена в «Общих», последовательности под документами. */
	const TREE = {
		sources: [
			{
				groups: [
					{
						label: 'Общие',
						items: [],
						subgroups: [
							{ label: 'Общие модули', items: [{ objectType: 'CommonModule', name: 'М', relativePath: 'CommonModules/М.xml' }] },
							{ label: 'Планы обмена', items: [{ objectType: 'ExchangePlan', name: 'Обмен', relativePath: 'ExchangePlans/Обмен.xml' }] },
							{ label: 'Критерии отбора', items: [{ objectType: 'FilterCriterion', name: 'К', relativePath: 'FilterCriteria/К.xml' }] },
						],
					},
					{ label: 'Регистры сведений', items: [{ objectType: 'InformationRegister', name: 'Цены', relativePath: 'InformationRegisters/Цены.xml' }] },
					{ label: 'Константы', items: [{ objectType: 'Constant', name: 'Валюта', relativePath: 'Constants/Валюта.xml' }] },
					{
						label: 'Документы',
						items: [{ objectType: 'Document', name: 'Заказ', relativePath: 'Documents/Заказ.xml', synonym: 'Заказ клиента' }],
						subgroups: [{ label: 'Последовательности', items: [{ objectType: 'Sequence', name: 'П', relativePath: 'Sequences/П.xml' }] }],
					},
					{
						label: 'Справочники',
						items: [
							{ objectType: 'Catalog', name: 'Б', relativePath: 'Catalogs/Б.xml' },
							{ objectType: 'Catalog', name: 'А', relativePath: 'Catalogs/А.xml' },
						],
					},
					{ label: 'Отчёты', items: [{ objectType: 'Report', name: 'О', relativePath: 'Reports/О.xml' }] },
				],
			},
		],
	};

	test('только виды с таблицами запроса, ветки — в порядке конструктора, объекты — как в ответе', () => {
		const groups = dcsQueryMetadataGroupsOf(TREE);
		assert.deepEqual(
			groups.map((group) => group.objectType),
			['FilterCriterion', 'ExchangePlan', 'Constant', 'Catalog', 'Document', 'Sequence', 'InformationRegister']
		);
		assert.deepEqual(
			groups.map((group) => group.label),
			['Критерии отбора', 'Планы обмена', 'Константы', 'Справочники', 'Документы', 'Последовательности', 'Регистры сведений']
		);
		assert.deepEqual(
			groups.find((group) => group.objectType === 'Catalog')?.items.map((item) => item.name),
			['Б', 'А']
		);
		assert.equal(groups.find((group) => group.objectType === 'Document')?.items[0].synonym, 'Заказ клиента');
	});

	test('критерий отбора из «Общих» и последовательность из подгруппы документов — своими ветками, с путями ответа', () => {
		const groups = dcsQueryMetadataGroupsOf(TREE);
		const criteria = groups.find((group) => group.objectType === 'FilterCriterion');
		const sequences = groups.find((group) => group.objectType === 'Sequence');
		assert.deepEqual(
			criteria?.items.map((item) => [item.objectType, item.name, item.relativePath]),
			[['FilterCriterion', 'К', 'FilterCriteria/К.xml']]
		);
		assert.deepEqual(
			sequences?.items.map((item) => [item.objectType, item.name, item.relativePath]),
			[['Sequence', 'П', 'Sequences/П.xml']]
		);
		// Документы ветки «Документы» — без последовательностей из своей подгруппы
		assert.deepEqual(
			groups.find((group) => group.objectType === 'Document')?.items.map((item) => item.objectType),
			['Document']
		);
	});

	test('внешние источники данных в дерево не попадают', () => {
		const groups = dcsQueryMetadataGroupsOf({
			sources: [
				{
					groups: [
						{ label: 'Внешние источники данных', items: [{ objectType: 'ExternalDataSource', name: 'ВИ', relativePath: 'ExternalDataSources/ВИ.xml' }] },
						{ label: 'Критерии отбора', items: [{ objectType: 'FilterCriterion', name: 'К', relativePath: 'FilterCriteria/К.xml' }] },
					],
				},
			],
		});
		assert.deepEqual(
			groups.map((group) => group.objectType),
			['FilterCriterion']
		);
		assert.equal(DCS_QUERY_TREE_KINDS.some((kind) => kind.objectType === 'ExternalDataSource'), false);
	});

	test('порядок видов: критерии отбора первыми, последовательности после документов; без внешних источников', () => {
		assert.deepEqual(
			DCS_QUERY_TREE_KINDS.map((kind) => kind.objectType),
			[
				'FilterCriterion',
				'ExchangePlan',
				'Constant',
				'Catalog',
				'Document',
				'Sequence',
				'DocumentJournal',
				'Enum',
				'ChartOfCharacteristicTypes',
				'ChartOfAccounts',
				'ChartOfCalculationTypes',
				'InformationRegister',
				'AccumulationRegister',
				'AccountingRegister',
				'CalculationRegister',
				'BusinessProcess',
				'Task',
			]
		);
	});

	test('каждую ветку дерева описывает describe-type: таблица объекта любого вида дерева адресуется по-английски', () => {
		// Строка объекта дерева называет основную таблицу `<Вид>.<Имя>`, а её поля конструктор просит
		// dcs/describe-type: вид, который хост не адресует, дал бы в дереве объект без полей
		for (const kind of DCS_QUERY_TREE_KINDS) {
			const request = dcsDescribeRequestOf({ type: DCS_DESCRIBE_TYPE_MESSAGE, queryTable: `${kind.objectType}.Имя` });
			assert.ok(!('error' in request), `${kind.objectType}: ${JSON.stringify(request)}`);
		}
	});

	test('кривой ответ — пустое дерево', () => {
		assert.deepEqual(dcsQueryMetadataGroupsOf(null), []);
		assert.deepEqual(dcsQueryMetadataGroupsOf({ sources: 'нет' }), []);
	});
});

describe('Кэш дерева на хосте: по выгрузке и времени изменения Configuration.xml', () => {
	function counter(groups: string[]): { load: () => Promise<{ groups: string[] }>; calls: () => number } {
		let calls = 0;
		return {
			load: async () => {
				calls += 1;
				return { groups };
			},
			calls: () => calls,
		};
	}

	test('первый вызов загружает и говорит о холодной загрузке, повторный — из кэша без загрузки', async () => {
		const root = tempDir('dcs-tree-cache-');
		const configuration = write(root, 'Configuration.xml', configurationXml());
		const cache = createDcsMetadataTreeCache<string[]>();
		const source = counter(['Справочники']);
		let cold = 0;
		const first = await cache.get(configuration, source.load, () => {
			cold += 1;
		});
		assert.deepEqual(first, { groups: ['Справочники'] });
		assert.equal(cold, 1);
		const second = await cache.get(configuration, source.load, () => {
			cold += 1;
		});
		assert.deepEqual(second, { groups: ['Справочники'] });
		assert.equal(source.calls(), 1);
		assert.equal(cold, 1, 'из кэша — без «Загрузка метаданных…»');
		// Тот же файл другим написанием пути — та же выгрузка
		assert.deepEqual(await cache.get(path.join(root, '.', 'Configuration.xml'), source.load), { groups: ['Справочники'] });
		assert.equal(source.calls(), 1);
	});

	test('смена времени изменения Configuration.xml сбрасывает кэш', async () => {
		const root = tempDir('dcs-tree-cache-');
		const configuration = write(root, 'Configuration.xml', configurationXml());
		const cache = createDcsMetadataTreeCache<string[]>();
		const before = counter(['старое']);
		await cache.get(configuration, before.load);
		const stat = fs.statSync(configuration);
		fs.utimesSync(configuration, stat.atime, new Date(stat.mtimeMs + 5000));
		const after = counter(['новое']);
		const answer = await cache.get(configuration, after.load);
		assert.deepEqual(answer, { groups: ['новое'] });
		assert.equal(after.calls(), 1);
		assert.deepEqual(await cache.get(configuration, after.load), { groups: ['новое'] });
		assert.equal(after.calls(), 1);
	});

	test('правка состава той же длины в ту же миллисекунду ловится размером файла', async () => {
		const root = tempDir('dcs-tree-cache-');
		const configuration = write(root, 'Configuration.xml', configurationXml());
		const cache = createDcsMetadataTreeCache<string[]>();
		await cache.get(configuration, counter(['до']).load);
		const stat = fs.statSync(configuration);
		fs.writeFileSync(configuration, configurationXml() + '\r\n<!-- новый объект -->', 'utf8');
		fs.utimesSync(configuration, stat.atime, stat.mtime);
		assert.deepEqual(await cache.get(configuration, counter(['после']).load), { groups: ['после'] });
	});

	test('одновременные вызовы ждут одну загрузку', async () => {
		const root = tempDir('dcs-tree-cache-');
		const configuration = write(root, 'Configuration.xml', configurationXml());
		const cache = createDcsMetadataTreeCache<string[]>();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const load = async (): Promise<{ groups: string[] }> => {
			calls += 1;
			await gate;
			return { groups: ['одно'] };
		};
		const first = cache.get(configuration, load);
		const second = cache.get(configuration, load);
		await new Promise((resolve) => setTimeout(resolve, 20));
		release();
		assert.deepEqual(await first, { groups: ['одно'] });
		assert.deepEqual(await second, { groups: ['одно'] });
		assert.equal(calls, 1);
	});

	test('отказ и исключение загрузки не кэшируются: следующий вызов загружает снова', async () => {
		const root = tempDir('dcs-tree-cache-');
		const configuration = write(root, 'Configuration.xml', configurationXml());
		const cache = createDcsMetadataTreeCache<string[]>();
		assert.deepEqual(await cache.get(configuration, async () => ({ error: 'jar упал' })), { error: 'jar упал' });
		assert.deepEqual(
			await cache.get(configuration, async () => {
				throw new Error('нет java');
			}),
			{ error: 'нет java' }
		);
		const source = counter(['дерево']);
		assert.deepEqual(await cache.get(configuration, source.load), { groups: ['дерево'] });
	});

	test('нет Configuration.xml — отказ без загрузки; старые выгрузки вытесняются', async () => {
		const root = tempDir('dcs-tree-cache-');
		const cache = createDcsMetadataTreeCache<string[]>(1);
		const source = counter(['x']);
		const missing = await cache.get(path.join(root, 'нет', 'Configuration.xml'), source.load);
		assert.ok('error' in missing);
		assert.equal(source.calls(), 0);
		const a = write(root, 'a/Configuration.xml', configurationXml());
		const b = write(root, 'b/Configuration.xml', configurationXml());
		await cache.get(a, source.load);
		await cache.get(b, source.load);
		await cache.get(a, source.load);
		assert.equal(source.calls(), 3, 'предел 1: выгрузка a вытеснена выгрузкой b');
	});
});

describe('dcs/query-tables и язык описаний', () => {
	test('сообщение: путь из дерева и язык ru по умолчанию или en', () => {
		assert.equal(DCS_QUERY_TABLES_MESSAGE, 'dcs/query-tables');
		assert.deepEqual(dcsQueryTablesRequestOf({ type: DCS_QUERY_TABLES_MESSAGE, relativePath: 'Catalogs/Валюты.xml' }), {
			relativePath: 'Catalogs/Валюты.xml',
			lang: 'ru',
		});
		assert.deepEqual(dcsQueryTablesRequestOf({ type: DCS_QUERY_TABLES_MESSAGE, relativePath: 'Catalogs/Валюты.xml', lang: 'en' }), {
			relativePath: 'Catalogs/Валюты.xml',
			lang: 'en',
		});
		assert.ok('error' in dcsQueryTablesRequestOf({ type: DCS_QUERY_TABLES_MESSAGE }));
		assert.ok('error' in dcsQueryTablesRequestOf({ type: DCS_QUERY_TABLES_MESSAGE, relativePath: 'Catalogs/Валюты.xml', lang: 'de' }));
		assert.equal(dcsQueryLangOf({}), 'ru');
		assert.equal(dcsQueryLangOf({ lang: '' }), 'ru');
		assert.equal(dcsQueryLangOf({ lang: 'en' }), 'en');
		assert.equal(dcsQueryLangOf({ lang: 'EN' }), undefined);
	});

	test('выгрузка конфигуратора: путь от корня выгрузки, версия из Configuration.xml', async () => {
		const root = tempDir('dcs-query-tables-');
		const cf = path.join(root, 'cf');
		write(cf, 'Configuration.xml', configurationXml('2.20'));
		const objectXml = write(cf, 'Catalogs/Валюты.xml', '<MetaDataObject/>');
		const template = write(cf, 'Reports/Отчёт/Templates/Схема/Ext/Template.xml', '<DataCompositionSchema/>');
		const resolved = await resolveDcsQueryTablesTarget(template, 'Catalogs/Валюты.xml');
		assert.deepEqual(resolved, { target: { objectXml: path.normalize(objectXml), cwd: cf, schemaVersion: 'V2_20' } });
		const backslash = await resolveDcsQueryTablesTarget(template, 'Catalogs\\Валюты.xml');
		assert.ok('target' in backslash);
		const missing = await resolveDcsQueryTablesTarget(template, 'Catalogs/Нет.xml');
		assert.ok('missing' in missing);
		for (const bad of ['../Configuration.xml', 'Catalogs/../../x.xml', path.join(cf, 'Catalogs', 'Валюты.xml'), 'Catalogs//Валюты.xml', 'Catalogs/Валюты.mdo', './Catalogs/Валюты.xml']) {
			const refused = await resolveDcsQueryTablesTarget(template, bad);
			assert.ok('error' in refused, bad);
		}
	});

	test('проект EDT: путь от корня проекта, файл .mdo, версия — у метамодели (пустой флаг)', async () => {
		const root = tempDir('dcs-query-tables-');
		const src = path.join(root, 'src');
		write(src, 'Configuration/Configuration.mdo', '<mdclass:Configuration/>');
		const objectMdo = write(src, 'Catalogs/Валюты/Валюты.mdo', '<mdclass:Catalog/>');
		const template = write(src, 'Reports/Отчёт/Templates/Схема/Template.dcs', '<DataCompositionSchema/>');
		const resolved = await resolveDcsQueryTablesTarget(template, 'Catalogs/Валюты/Валюты.mdo');
		assert.deepEqual(resolved, { target: { objectXml: path.normalize(objectMdo), cwd: src, schemaVersion: '' } });
		assert.ok('error' in (await resolveDcsQueryTablesTarget(template, 'Catalogs/Валюты.xml')));
	});

	test('вне выгрузки — outside без ошибки', async () => {
		const root = tempDir('dcs-query-tables-');
		const template = write(root, 'ВнешнийОтчёт/Templates/Схема/Ext/Template.xml', '<DataCompositionSchema/>');
		assert.deepEqual(await resolveDcsQueryTablesTarget(template, 'Catalogs/Валюты.xml'), { outside: true });
	});
});

describe('Критерии отбора и последовательности: dcs/describe-type', () => {
	function describeRequest(queryTable: string) {
		return dcsDescribeRequestOf({ type: DCS_DESCRIBE_TYPE_MESSAGE, queryTable } as DcsPanelMessage);
	}

	test('таблица запроса критерия отбора и последовательности — каталог выгрузки и имя объекта; русское и английское имя вида', () => {
		assert.deepEqual(describeRequest('КритерийОтбора.СвязанныеДокументы'), {
			echo: { queryTable: 'КритерийОтбора.СвязанныеДокументы' },
			folder: 'FilterCriteria',
			name: 'СвязанныеДокументы',
		});
		assert.deepEqual(describeRequest('Последовательность._ДемоДвижениеТоваров.Границы'), {
			echo: { queryTable: 'Последовательность._ДемоДвижениеТоваров.Границы' },
			folder: 'Sequences',
			name: '_ДемоДвижениеТоваров',
		});
		assert.equal((describeRequest('FilterCriterion.СвязанныеДокументы') as { folder: string }).folder, 'FilterCriteria');
		assert.deepEqual(describeRequest('Sequence._ДемоДвижениеТоваров.Boundaries'), {
			echo: { queryTable: 'Sequence._ДемоДвижениеТоваров.Boundaries' },
			folder: 'Sequences',
			name: '_ДемоДвижениеТоваров',
		});
		// Внешние источники и общая таблица констант описанием объекта не адресуются
		for (const name of ['ВнешнийИсточникДанных.И.Таблица.Т', 'Константы', 'Constants']) {
			assert.ok('error' in describeRequest(name), name);
		}
	});

	test('файл объекта: FilterCriteria/Имя.xml в выгрузке конфигуратора и Sequences/Имя/Имя.mdo в EDT', async () => {
		const cf = tempDir('dcs-describe-');
		write(cf, 'Configuration.xml', configurationXml());
		const criterion = write(cf, 'FilterCriteria/СвязанныеДокументы.xml', configurationXml());
		const template = write(cf, 'Reports/Отчёт/Templates/Схема/Ext/Template.xml', '<DataCompositionSchema/>');
		assert.deepEqual(await resolveDcsDescribeTarget(template, 'FilterCriteria', 'СвязанныеДокументы'), {
			target: { objectXml: criterion, cwd: cf, schemaVersion: 'V2_20' },
		});
		const edt = path.join(tempDir('dcs-describe-'), 'src');
		write(edt, 'Configuration/Configuration.mdo', '<mdclass:Configuration/>');
		const sequence = write(edt, 'Sequences/_ДемоДвижениеТоваров/_ДемоДвижениеТоваров.mdo', '<mdclass:Sequence/>');
		const edtTemplate = write(edt, 'Reports/Отчёт/Templates/Схема/Template.dcs', '<DataCompositionSchema/>');
		assert.deepEqual(await resolveDcsDescribeTarget(edtTemplate, 'Sequences', '_ДемоДвижениеТоваров'), {
			target: { objectXml: sequence, cwd: edt, schemaVersion: '' },
		});
	});
});

describe('Выгрузка расширения и общие реквизиты: признаки для проверки имён запроса', () => {
	test('Configuration.xml с принадлежностью объекта — расширение; конфигурация, EDT-разметка и нечитаемый файл — нет', async () => {
		const root = tempDir('dcs-extension-');
		const extension = write(
			root,
			'cfe/Расширение/Configuration.xml',
			'<?xml version="1.0" encoding="UTF-8"?>\r\n<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.20">\r\n\t<Configuration>\r\n\t\t<Properties>\r\n\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>\r\n\t\t\t<Name>Расширение</Name>\r\n\t\t\t<ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose>\r\n\t\t</Properties>\r\n\t</Configuration>\r\n</MetaDataObject>'
		);
		assert.equal(await isConfigurationExtensionXml(extension), true);
		assert.equal(await isConfigurationExtensionXml(write(root, 'cf/Configuration.xml', configurationXml())), false);
		assert.equal(await isConfigurationExtensionXml(path.join(root, 'нет/Configuration.xml')), false);
	});

	test('общие реквизиты: CommonAttributes/<Имя>.xml выгрузки и CommonAttributes/<Имя>/ проекта EDT; каталога нет — пусто', async () => {
		const cf = tempDir('dcs-common-');
		write(cf, 'Configuration.xml', configurationXml());
		write(cf, 'CommonAttributes/ОбластьДанныхОсновныеДанные.xml', '<MetaDataObject/>');
		write(cf, 'CommonAttributes/ОбластьДанныхОсновныеДанные/Ext/Пустой.txt', '');
		write(cf, 'CommonAttributes/Заметки.txt', '');
		assert.deepEqual(await dcsCommonAttributeNames(cf), ['ОбластьДанныхОсновныеДанные'], 'файл описания и каталог рядом — одно имя, прочие файлы мимо');
		const edt = path.join(tempDir('dcs-common-'), 'src');
		write(edt, 'CommonAttributes/КомментарийЯзык1/КомментарийЯзык1.mdo', '<mdclass:CommonAttribute/>');
		assert.deepEqual(await dcsCommonAttributeNames(edt), ['КомментарийЯзык1']);
		assert.deepEqual(await dcsCommonAttributeNames(path.join(edt, 'нет')), []);
	});
});
