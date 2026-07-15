import * as assert from 'node:assert';
import {
	computeSubsystemFilter,
	findSubsystemByName,
	parseContentRefsToObjectKeys,
	parseContentRefsToObjectNames,
	type SubsystemNode,
} from '../../features/metadata/metadataSubsystemFilter';

/** Дерево как его отдаёт md-sparrow: Продажи → Заказы, плюс отдельные Закупки. */
function roots(): SubsystemNode[] {
	return [
		{
			name: 'Продажи',
			xmlPath: 'C:/ws/src/cf/Subsystems/Продажи.xml',
			contentRefs: ['Catalog.Партнеры'],
			children: [
				{
					name: 'Заказы',
					xmlPath: 'C:/ws/src/cf/Subsystems/Продажи/Subsystems/Заказы.xml',
					contentRefs: ['Document.ЗаказПокупателя'],
					children: [
						{
							name: 'Согласование',
							xmlPath: 'C:/ws/src/cf/Subsystems/Продажи/Subsystems/Заказы/Subsystems/Согласование.xml',
							contentRefs: ['Catalog.Согласования'],
							children: [],
						},
					],
				},
			],
		},
		{
			name: 'Закупки',
			xmlPath: 'C:/ws/src/cf/Subsystems/Закупки.xml',
			contentRefs: ['Document.ЗаказПоставщику'],
			children: [],
		},
	];
}

const ORDERS = 'C:/ws/src/cf/Subsystems/Продажи/Subsystems/Заказы.xml';

suite('metadataSubsystemFilter: состав отбора', () => {
	test('пустой набор ничего не разрешает', () => {
		const result = computeSubsystemFilter(roots(), new Set(), { includeNested: true, includeParents: false });
		assert.strictEqual(result.names.size, 0);
		assert.strictEqual(result.keys.size, 0);
	});

	test('подчинённые включаются по переключателю', () => {
		const withNested = computeSubsystemFilter(roots(), new Set([ORDERS]), {
			includeNested: true,
			includeParents: false,
		});
		assert.deepStrictEqual(
			[...withNested.keys].sort(),
			['Catalog.Согласования', 'Document.ЗаказПокупателя', 'Subsystem.Заказы', 'Subsystem.Согласование'],
			'объекты вложенной подсистемы попадают в отбор'
		);

		const withoutNested = computeSubsystemFilter(roots(), new Set([ORDERS]), {
			includeNested: false,
			includeParents: false,
		});
		assert.deepStrictEqual(
			[...withoutNested.keys].sort(),
			['Document.ЗаказПокупателя', 'Subsystem.Заказы'],
			'без переключателя берём только саму подсистему'
		);
	});

	test('родительские включаются по переключателю', () => {
		const withParents = computeSubsystemFilter(roots(), new Set([ORDERS]), {
			includeNested: false,
			includeParents: true,
		});
		assert.ok(withParents.keys.has('Catalog.Партнеры'), 'объекты родителя попадают в отбор');
		assert.ok(withParents.subsystemNames.has('Продажи'));
		assert.ok(!withParents.keys.has('Document.ЗаказПоставщику'), 'соседняя ветка не попадает');
	});

	test('несколько отмеченных подсистем объединяются', () => {
		const result = computeSubsystemFilter(roots(), new Set([ORDERS, 'C:/ws/src/cf/Subsystems/Закупки.xml']), {
			includeNested: false,
			includeParents: false,
		});
		assert.ok(result.keys.has('Document.ЗаказПокупателя'));
		assert.ok(result.keys.has('Document.ЗаказПоставщику'));
	});

	test('подсистема ищется по имени на любом уровне', () => {
		assert.strictEqual(findSubsystemByName(roots(), 'Согласование')?.name, 'Согласование');
		assert.strictEqual(findSubsystemByName(roots(), 'Нет'), undefined);
	});
});

suite('metadataSubsystemFilter: разбор состава подсистемы', () => {
	test('имена объектов вытаскиваются из ссылок и из путей', () => {
		const names = parseContentRefsToObjectNames([
			'Catalog.Номенклатура',
			'Document.ЗаказПокупателя',
			'Catalogs/Партнеры.xml',
			'  ',
		]);
		assert.deepStrictEqual([...names].sort(), ['ЗаказПокупателя', 'Номенклатура', 'Партнеры']);
	});

	test('ключи объектов собираются из вида и имени', () => {
		const keys = parseContentRefsToObjectKeys([
			'Catalog.Номенклатура',
			'AccumulationRegister.Остатки',
			'НеИзвестныйВид.Объект',
			'БезТочки',
		]);
		assert.deepStrictEqual(
			[...keys].sort(),
			['AccumulationRegister.Остатки', 'Catalog.Номенклатура'],
			'неизвестные виды и ссылки без вида отбрасываются'
		);
	});
});
