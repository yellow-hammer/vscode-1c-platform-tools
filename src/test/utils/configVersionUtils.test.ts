import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readConfigurationDeliveryProperties, readConfigurationVersion } from '../../utils/configVersionUtils';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');

suite('версия и свойства поставки из описания конфигурации', () => {
	test('проект EDT: версия, имя и поставщик из Configuration.mdo', async () => {
		const mdo = path.join(FIXTURES, 'edt-workspace', 'ssl31', 'src', 'Configuration', 'Configuration.mdo');
		assert.strictEqual(await readConfigurationVersion(mdo), '3.1.11.392');
		const props = await readConfigurationDeliveryProperties(mdo);
		assert.ok(props);
		assert.strictEqual(props.version, '3.1.11.392');
		assert.strictEqual(props.name, 'БиблиотекаСтандартныхПодсистемДемо');
		// Кавычки в файле записаны сущностями, а в поставке нужен сам текст
		assert.strictEqual(props.vendor, 'Фирма "1С"');
	});

	test('выгрузка конфигуратора: те же свойства из Configuration.xml', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-version-'));
		const xml = path.join(dir, 'Configuration.xml');
		fs.writeFileSync(
			xml,
			[
				'<MetaDataObject version="2.21"><Configuration><Properties>',
				'<Name>Демо</Name>',
				'<Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Демо конфигурация</v8:content></v8:item></Synonym>',
				'<Vendor>Фирма &quot;1С&quot;</Vendor>',
				'<Version>1.2.3.4</Version>',
				'<CompatibilityMode>Version8_3_24</CompatibilityMode>',
				'</Properties></Configuration></MetaDataObject>',
			].join('\n'),
			'utf8'
		);
		try {
			assert.strictEqual(await readConfigurationVersion(xml), '1.2.3.4');
			const props = await readConfigurationDeliveryProperties(xml);
			assert.ok(props);
			assert.strictEqual(props.name, 'Демо');
			assert.strictEqual(props.synonymRu, 'Демо конфигурация');
			assert.strictEqual(props.vendor, 'Фирма "1С"');
			assert.strictEqual(props.appVersion, '8.3');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('без файла версия не определена', async () => {
		assert.strictEqual(await readConfigurationVersion(path.join(FIXTURES, 'нет', 'Configuration.xml')), undefined);
	});
});
