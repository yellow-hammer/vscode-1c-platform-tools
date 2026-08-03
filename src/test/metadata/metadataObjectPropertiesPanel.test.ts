import * as assert from 'node:assert';
import {
	buildMetadataObjectPropertiesTabsForTest,
	buildStructureListsForTest,
} from '../../features/metadata/metadataObjectPropertiesPanel';

suite('metadataObjectPropertiesPanel tabs', () => {
	test('subsystem content builds grouped summary and full list', () => {
		const props = {
			kind: 'subsystem',
			internalName: 'Продажи',
			synonymRu: 'Продажи',
			comment: '',
			nestedSubsystems: ['ОбменДанными'],
			contentRefs: ['Catalog.Номенклатура', 'Document.Заказ', 'Catalog.Контрагенты'],
		};

		const tabs = buildMetadataObjectPropertiesTabsForTest('Subsystem', props, null);
		const contentTab = tabs.find((tab) => tab.id === 'contentRefs');
		assert.ok(contentTab, 'должна быть вкладка состава');
		assert.strictEqual(contentTab?.render, 'subsystemContent');
		const data = contentTab?.data as { summary: Array<{ type: string; count: number }>; items: string[] };
		assert.strictEqual(data.items.length, 3);
		assert.strictEqual(
			data.summary.reduce((acc, item) => acc + item.count, 0),
			3,
			'сводка должна покрывать весь состав'
		);
		assert.ok(data.summary.length > 0, 'сводка должна содержать хотя бы один тип');
	});

	test('tabular sections are merged with structure attributes', () => {
		const props = {
			kind: 'catalog',
			internalName: 'Номенклатура',
			synonymRu: 'Номенклатура',
			comment: '',
			tabularSections: [{ name: 'Товары', synonymRu: 'Товары', comment: '' }],
		};
		const structure = {
			kind: 'catalog',
			internalName: 'Номенклатура',
			tabularSections: [
				{
					name: 'Товары',
					synonymRu: 'Товары',
					comment: '',
					attributes: [{ name: 'Количество', synonymRu: 'Количество', comment: '' }],
				},
			],
		};

		const tabs = buildMetadataObjectPropertiesTabsForTest('Catalog', props, structure);
		const tab = tabs.find((item) => item.id === 'tabularSections');
		assert.ok(tab, 'вкладка табличных частей должна быть создана');
		const rows = tab?.data as Array<{ name: string; attributes: Array<{ name: string }> }>;
		assert.strictEqual(rows.length, 1);
		assert.strictEqual(rows[0].attributes[0].name, 'Количество');
	});

	test('unknown scalar fields go to fallback tab', () => {
		const props = {
			kind: 'report',
			internalName: 'АнализПродаж',
			synonymRu: 'Анализ продаж',
			comment: '',
			customScalarFlag: 'Use',
		};
		const tabs = buildMetadataObjectPropertiesTabsForTest('Report', props, null);
		const tab = tabs.find((item) => item.id === 'objectProperties');
		assert.ok(tab, 'ожидается вкладка параметров объекта');
		assert.strictEqual(tab?.render, 'kv');
		const kv = tab?.data as Record<string, unknown>;
		assert.ok(Object.keys(kv).length > 0, 'вкладка параметров должна содержать данные');
	});
});

suite('metadataObjectPropertiesPanel: состав объекта', () => {
	test('у отчёта есть вкладка «Данные»: без неё не открыть реквизиты и табличные части', () => {
		const props = { kind: 'report', internalName: 'ДинамикаФайлов', report: { useStandardCommands: false } };

		const tabs = buildMetadataObjectPropertiesTabsForTest('Report', props, {
			kind: 'report',
			forms: [],
			commands: [],
		});

		assert.deepStrictEqual(
			tabs.filter((tab) => tab.render === 'edit').map((tab) => tab.title),
			['Основные', 'Данные', 'Компоновка', 'Формы', 'Команды', 'Макеты']
		);
	});

	test('у общего модуля состава нет, вкладка «Данные» не появляется', () => {
		const props = { kind: 'commonModule', internalName: 'ОбщегоНазначения', commonModule: { server: true } };

		const tabs = buildMetadataObjectPropertiesTabsForTest('CommonModule', props, {
			kind: 'commonModule',
			forms: [],
			commands: [],
		});

		assert.deepStrictEqual(
			tabs.filter((tab) => tab.render === 'edit').map((tab) => tab.title),
			['Основные']
		);
	});

	test('реквизиты адресации показываются в составе, а не отдельной вкладкой', () => {
		const tabs = buildMetadataObjectPropertiesTabsForTest(
			'Task',
			{ kind: 'task', internalName: 'ЗадачаИсполнителя', task: {}, attributes: [] },
			{ kind: 'task', forms: [], commands: [], addressingAttributes: ['Исполнитель'] }
		);

		assert.strictEqual(
			tabs.filter((tab) => tab.title === 'Реквизиты адресации').length,
			0,
			'состав объекта показывается на «Данных»'
		);
	});

	test('у задачи в составе показываются реквизиты адресации', () => {
		const lists = buildStructureListsForTest(
			{ kind: 'task', internalName: 'ЗадачаИсполнителя', attributes: [] },
			{ kind: 'task', addressingAttributes: ['Исполнитель', 'РольИсполнителя'] }
		);

		const addressing = lists.lists[0];
		assert.strictEqual(addressing.title, 'Реквизиты адресации');
		assert.strictEqual(addressing.editable, false);
		assert.deepStrictEqual(
			addressing.rows.map((row) => row.name),
			['Исполнитель', 'РольИсполнителя']
		);
	});
});

suite('metadataObjectPropertiesPanel: макеты', () => {
	test('макеты идут своей вкладкой в общем стиле, сразу за командами', () => {
		const props = { kind: 'exchangePlan', internalName: 'Демо', exchangePlan: {}, attributes: [] };
		const structure = { kind: 'exchangePlan', forms: [], commands: [], templates: ['ПравилаРегистрации'] };

		const tabs = buildMetadataObjectPropertiesTabsForTest('ExchangePlan', props, structure);
		const titles = tabs.filter((tab) => tab.render === 'edit').map((tab) => tab.title);

		assert.ok(titles.includes('Макеты'), 'нет вкладки макетов');
		assert.strictEqual(titles.indexOf('Макеты'), titles.indexOf('Команды') + 1);
		assert.strictEqual(
			tabs.find((tab) => tab.title === 'Макеты')?.render,
			'edit',
			'макеты должны рисоваться как остальные вкладки панели'
		);
	});

	test('вкладка есть и у объекта без макетов: состав можно менять', () => {
		const props = { kind: 'catalog', internalName: 'Номенклатура', catalog: {}, attributes: [] };
		const structure = { kind: 'catalog', forms: [], commands: [] };

		const tabs = buildMetadataObjectPropertiesTabsForTest('Catalog', props, structure);
		const lists = buildStructureListsForTest(props, structure);

		assert.ok(tabs.some((tab) => tab.title === 'Макеты'), 'вкладка макетов нужна и пустой');
		assert.strictEqual(lists.lists.some((list) => list.key === 'templates'), false);
	});
});

suite('metadataObjectPropertiesPanel: команды объекта', () => {
	test('команды правятся на своей вкладке, как в конфигураторе', () => {
		const props = { kind: 'catalog', internalName: 'Номенклатура', catalog: {}, attributes: [] };
		const structure = { kind: 'catalog', forms: [], commands: ['Печать', 'Отправить'] };

		const lists = buildStructureListsForTest(props, structure);
		const commands = lists.lists.find((list) => list.key === 'commands');

		assert.strictEqual(commands?.editable, true, 'команды должны правиться');
		assert.strictEqual(commands?.tab, 'edit_commands', 'команды не на «Данных»');
		assert.deepStrictEqual(commands?.rows.map((row) => row.name), ['Печать', 'Отправить']);
	});

	test('на «Данных» только состав объекта: реквизиты и табличные части', () => {
		const props = { kind: 'report', internalName: 'Отчёт', report: {}, attributes: [] };
		const structure = { kind: 'report', forms: [], commands: ['Печать'] };

		const lists = buildStructureListsForTest(props, structure);
		const dataTitles = lists.lists.filter((list) => list.tab === 'edit_data').map((list) => list.title);

		assert.deepStrictEqual(dataTitles, ['Реквизиты']);
	});
});
