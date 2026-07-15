import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	hasNestedSubsystems,
	nestedSubsystemXmls,
	parentSubsystemXml,
	parseContentRefsToObjectKeys,
	parseContentRefsToObjectNames,
} from '../../features/metadata/metadataSubsystemFilter';

suite('metadataSubsystemFilter: иерархия подсистем по раскладке файлов', () => {
	let root: string;

	setup(() => {
		// src/cf/Subsystems/Продажи.xml + вложенная Продажи/Subsystems/Заказы.xml
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-subsystems-'));
		const subsystems = path.join(root, 'src', 'cf', 'Subsystems');
		fs.mkdirSync(path.join(subsystems, 'Продажи', 'Subsystems'), { recursive: true });
		fs.writeFileSync(path.join(subsystems, 'Продажи.xml'), '<MetaDataObject/>', 'utf-8');
		fs.writeFileSync(path.join(subsystems, 'Продажи', 'Subsystems', 'Заказы.xml'), '<MetaDataObject/>', 'utf-8');
		fs.writeFileSync(path.join(subsystems, 'Закупки.xml'), '<MetaDataObject/>', 'utf-8');
	});

	teardown(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	function xml(...parts: string[]): string {
		return path.join(root, 'src', 'cf', 'Subsystems', ...parts);
	}

	test('у подсистемы верхнего уровня родителя нет', () => {
		assert.strictEqual(parentSubsystemXml(xml('Продажи.xml')), undefined);
	});

	test('у вложенной подсистемы родитель — XML владельца', () => {
		assert.strictEqual(
			parentSubsystemXml(xml('Продажи', 'Subsystems', 'Заказы.xml')),
			xml('Продажи.xml')
		);
	});

	test('подчинённые подсистемы берутся из каталога владельца', () => {
		assert.deepStrictEqual(nestedSubsystemXmls(xml('Продажи.xml'), 'Продажи'), [
			xml('Продажи', 'Subsystems', 'Заказы.xml'),
		]);
		assert.ok(hasNestedSubsystems(xml('Продажи.xml'), 'Продажи'));
		assert.deepStrictEqual(nestedSubsystemXmls(xml('Закупки.xml'), 'Закупки'), []);
		assert.ok(!hasNestedSubsystems(xml('Закупки.xml'), 'Закупки'));
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
