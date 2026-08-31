import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');
const SUPPORT_KEY = '1c-platform-tools.metadata.supportEnabled';

interface ConfigurationSection {
	title?: string;
	properties?: Record<string, { type?: string; default?: unknown; description?: string }>;
}

function configurationSections(): ConfigurationSection[] {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes?: { configuration?: ConfigurationSection | ConfigurationSection[] };
	};
	const configuration = pkg.contributes?.configuration;
	if (!configuration) {
		return [];
	}
	return Array.isArray(configuration) ? configuration : [configuration];
}

suite('Настройка работы с поддержкой', () => {
	test('лежит в разделе метаданных и по умолчанию выключена', () => {
		// Выключенная настройка означает: выгрузка правится так, будто поставки нет
		const section = configurationSections().find((item) => item.properties?.[SUPPORT_KEY]);
		assert.ok(section, `настройки ${SUPPORT_KEY} нет в package.json`);
		assert.strictEqual(section.title, 'Метаданные');
		const setting = section.properties?.[SUPPORT_KEY];
		assert.strictEqual(setting?.type, 'boolean');
		assert.strictEqual(setting?.default, false);
		assert.ok((setting?.description ?? '').length > 0, 'у настройки нет описания');
	});
});
