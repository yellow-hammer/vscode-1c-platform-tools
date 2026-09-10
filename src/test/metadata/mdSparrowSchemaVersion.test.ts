import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	EDT_SCHEMA_FLAG,
	designerXmlVersionToMdSparrowFlag,
	mdSparrowSchemaFlagFromConfigurationXml,
} from '../../features/metadata/mdSparrowSchemaVersion';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');

suite('флаг схемы для md-sparrow', () => {
	test('выгрузка конфигуратора: версия формата из Configuration.xml', async () => {
		const flag = await mdSparrowSchemaFlagFromConfigurationXml(
			path.join(FIXTURES, 'designer', 'src', 'cf', 'Configuration.xml')
		);
		assert.strictEqual(flag, 'V2_4');
	});

	test('проект EDT: версии выгрузки нет, флаг пустой и файл не читается', async () => {
		const flag = await mdSparrowSchemaFlagFromConfigurationXml(
			path.join(FIXTURES, 'edt-workspace', 'ssl31', 'src', 'Configuration', 'Configuration.mdo')
		);
		assert.strictEqual(flag, EDT_SCHEMA_FLAG);
		// Файла может и не быть: формат виден по расширению
		assert.strictEqual(
			await mdSparrowSchemaFlagFromConfigurationXml(path.join('C:', 'нет', 'Configuration.mdo')),
			EDT_SCHEMA_FLAG
		);
	});

	test('атрибут version переводится во флаг схемы', () => {
		assert.strictEqual(designerXmlVersionToMdSparrowFlag('2.21'), 'V2_21');
		assert.throws(() => designerXmlVersionToMdSparrowFlag('abc'));
	});
});
