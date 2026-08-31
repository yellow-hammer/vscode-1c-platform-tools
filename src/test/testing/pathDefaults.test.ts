import * as assert from 'node:assert';
import * as path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { SETTING_DEFAULTS, TESTS_SUBDIRS, testsSubPath } from '../../shared/pathDefaults';

/**
 * Находит package.json расширения, поднимаясь от каталога теста вверх.
 * Работает и в исходниках, и в скомпилированном коде (тесты бандлятся в out/test/).
 */
function findPackageJson(): string {
	let dir = __dirname;
	while (dir !== path.dirname(dir)) {
		const candidate = path.join(dir, 'package.json');
		if (existsSync(candidate)) {
			const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string };
			if (parsed.name === '1c-platform-tools') {
				return candidate;
			}
		}
		dir = path.dirname(dir);
	}
	throw new Error('package.json расширения не найден');
}

/**
 * Собирает все default-значения настроек из contributes.configuration
 * в плоскую карту «полный ключ → default».
 */
function readConfigDefaults(): Map<string, unknown> {
	const pkg = JSON.parse(readFileSync(findPackageJson(), 'utf8')) as {
		contributes?: { configuration?: Array<{ properties?: Record<string, { default?: unknown }> }> };
	};
	const sections = pkg.contributes?.configuration ?? [];
	const defaults = new Map<string, unknown>();
	for (const section of sections) {
		for (const [key, schema] of Object.entries(section.properties ?? {})) {
			defaults.set(key, schema.default);
		}
	}
	return defaults;
}

/**
 * Защита от дрейфа: дефолты-константы кода обязаны совпадать с default
 * в contributes.configuration (package.json). Иначе при изменении дефолта
 * в одном месте поведение кода и UI настроек разойдётся.
 */
suite('pathDefaults ↔ package.json', () => {
	const defaults = readConfigDefaults();

	for (const { key, value } of SETTING_DEFAULTS) {
		test(`${key} = "${value}"`, () => {
			assert.ok(defaults.has(key), `Настройка ${key} отсутствует в package.json`);
			assert.strictEqual(defaults.get(key), value, `Дефолт ${key} в package.json не совпадает с константой`);
		});
	}
});

suite('каталоги тестов', () => {
	test('подкаталоги считаются от корня тестов', () => {
		assert.strictEqual(testsSubPath('tests', TESTS_SUBDIRS.cfe), 'tests/cfe');
		assert.strictEqual(testsSubPath('tests', TESTS_SUBDIRS.epf), 'tests/epf');
	});

	test('корень нормализуется: слэши, ведущее ./ и хвостовой разделитель', () => {
		assert.strictEqual(testsSubPath('./проверка/тесты/', TESTS_SUBDIRS.cfe), 'проверка/тесты/cfe');
		assert.strictEqual(testsSubPath('проверка\\тесты', TESTS_SUBDIRS.epf), 'проверка/тесты/epf');
	});

	test('пустой корень — подкаталог в корне проекта', () => {
		assert.strictEqual(testsSubPath('', TESTS_SUBDIRS.cfe), 'cfe');
	});

	test('раскладка тестов не настраивается: отдельных настроек путей нет', () => {
		const defaults = readConfigDefaults();
		assert.ok(!defaults.has('1c-platform-tools.path.testsCfe'), 'path.testsCfe вернулась в манифест');
		assert.ok(!defaults.has('1c-platform-tools.path.testsSrc'), 'path.testsSrc вернулась в манифест');
	});
});
