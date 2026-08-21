import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMPONENTS, describeComponentState } from '../../shared/componentsRegistry';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/** Объявленные в package.json настройки расширения. */
function declaredSettings(): Set<string> {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes: { configuration: { properties: Record<string, unknown> } | { properties: Record<string, unknown> }[] };
	};
	const sections = Array.isArray(pkg.contributes.configuration)
		? pkg.contributes.configuration
		: [pkg.contributes.configuration];
	const keys = new Set<string>();
	for (const section of sections) {
		for (const key of Object.keys(section.properties)) {
			keys.add(key.replace(/^1c-platform-tools\./, ''));
		}
	}
	return keys;
}

suite('реестр внешних компонентов', () => {
	test('идентификаторы и названия не повторяются', () => {
		assert.strictEqual(new Set(COMPONENTS.map((c) => c.id)).size, COMPONENTS.length, 'повтор id');
		assert.strictEqual(new Set(COMPONENTS.map((c) => c.title)).size, COMPONENTS.length, 'повтор названия');
	});

	test('название говорит, что это за компонент', () => {
		for (const component of COMPONENTS) {
			assert.ok(component.title.length > 4, `слишком короткое название: ${component.title}`);
			assert.match(component.title, /\(|\s/, `название без пояснения: ${component.title}`);
		}
	});

	test('названные настройки объявлены в package.json', () => {
		const declared = declaredSettings();
		for (const component of COMPONENTS) {
			assert.ok(declared.has(component.pathSetting), `нет настройки ${component.pathSetting} (${component.id})`);
			assert.ok(declared.has(component.autoloadSetting), `нет настройки ${component.autoloadSetting} (${component.id})`);
		}
	});

	test('JRE идёт перед деревом метаданных: дерево запускается ею', () => {
		const ids = COMPONENTS.map((c) => c.id);
		assert.ok(ids.indexOf('jre') < ids.indexOf('metadataTree'), `порядок: ${ids.join(', ')}`);
	});

	test('подпись состояния показывает версию и особые настройки', () => {
		const spec = COMPONENTS[0];
		assert.strictEqual(
			describeComponentState({ spec, version: 'v1.2.3', overridden: false, autoloadOff: false }),
			'v1.2.3'
		);
		assert.strictEqual(
			describeComponentState({ spec, version: undefined, overridden: false, autoloadOff: false }),
			'не загружен'
		);
		assert.strictEqual(
			describeComponentState({ spec, version: 'v1.2.3', overridden: true, autoloadOff: true }),
			`v1.2.3 · свой путь: ${spec.pathSetting} · автозагрузка выключена`
		);
	});
});
