import * as assert from 'node:assert';
import { buildMetadataObjectPropertiesTabsForTest } from '../../features/metadata/metadataObjectPropertiesPanel';

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
