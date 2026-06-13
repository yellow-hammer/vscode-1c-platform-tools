import * as assert from 'node:assert';
import * as path from 'node:path';
import { epfTestSourceInfo } from '../../features/testing/adapters/xunitAdapter';

suite('xunitAdapter', () => {
	test('epfTestSourceInfo: стандартная структура decompileepf', () => {
		const info = epfTestSourceInfo(
			'C:\\proj\\src\\tests\\Тесты_Сложение\\Тесты_Сложение\\Ext\\ObjectModule.bsl'
		);
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тесты_Сложение');
		assert.strictEqual(
			info.processorDir,
			path.join('C:', 'proj', 'src', 'tests', 'Тесты_Сложение')
		);
	});

	test('epfTestSourceInfo: обработка в подкаталоге-группе', () => {
		const info = epfTestSourceInfo(
			'C:/proj/src/tests/Core/Тест_Плагины/Тест_Плагины/Ext/ObjectModule.bsl'
		);
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тест_Плагины');
		assert.ok(info.processorDir.endsWith(path.join('Core', 'Тест_Плагины')));
	});

	test('epfTestSourceInfo: без дублирующего каталога — берётся внутренний', () => {
		const info = epfTestSourceInfo('C:/proj/src/tests/Тест_Один/Ext/ObjectModule.bsl');
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тест_Один');
		assert.ok(info.processorDir.endsWith('Тест_Один'));
	});

	test('epfTestSourceInfo: не ObjectModule.bsl — undefined', () => {
		assert.strictEqual(epfTestSourceInfo('C:/proj/tests/Тест.os'), undefined);
		assert.strictEqual(
			epfTestSourceInfo('C:/proj/src/tests/Тест/Forms/Форма/Ext/Form/Module.bsl'),
			undefined
		);
		assert.strictEqual(epfTestSourceInfo('C:/proj/ObjectModule.bsl'), undefined);
	});
});
