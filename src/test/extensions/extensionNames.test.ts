import * as assert from 'node:assert';
import { parseExtensionNameFromConfigurationXml } from '../../features/extensions/extensionNames';

const CONFIGURATION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.20">
	<Configuration uuid="4fa8f83e-d765-4fc8-979f-9e5de91b28b0">
		<InternalInfo>
			<xr:ContainedObject xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">
				<xr:ClassId>9cd510cd-abfc-11d4-9434-004095e12fc7</xr:ClassId>
			</xr:ContainedObject>
		</InternalInfo>
		<Properties>
			<Name>Тесты</Name>
			<Synonym/>
		</Properties>
	</Configuration>
</MetaDataObject>`;

suite('extensionNames', () => {
	test('извлекает имя расширения из Configuration.xml', () => {
		assert.strictEqual(parseExtensionNameFromConfigurationXml(CONFIGURATION_XML), 'Тесты');
	});

	test('битый или чужой XML → undefined', () => {
		assert.strictEqual(parseExtensionNameFromConfigurationXml(''), undefined);
		assert.strictEqual(parseExtensionNameFromConfigurationXml('<не xml'), undefined);
		assert.strictEqual(parseExtensionNameFromConfigurationXml('<Other><Name>X</Name></Other>'), undefined);
	});
});
