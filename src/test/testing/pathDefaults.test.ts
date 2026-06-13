import * as assert from 'node:assert';
import * as path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_PATHS, DEFAULT_TESTING, DEFAULT_VRUNNER } from '../../shared/pathDefaults';

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

	const check = (group: string, constants: Record<string, string>) => {
		for (const [key, value] of Object.entries(constants)) {
			const settingKey = `1c-platform-tools.${group}.${key}`;
			test(`${settingKey} = "${value}"`, () => {
				assert.ok(defaults.has(settingKey), `Настройка ${settingKey} отсутствует в package.json`);
				assert.strictEqual(
					defaults.get(settingKey),
					value,
					`Дефолт ${settingKey} в package.json не совпадает с константой`
				);
			});
		}
	};

	check('paths', DEFAULT_PATHS);
	check('testing', DEFAULT_TESTING);
	check('vrunner', DEFAULT_VRUNNER);
});
