/**
 * Конвертация файла настроек vanessa-runner из формата 2.x (env.json) в формат
 * 3.0 (autumn-properties): нужна, потому что vrunner 3 читает `--settings` иначе
 * (issue #118).
 *
 * Логика повторяет официальный скрипт `tools/migrate26to30.os` из vanessa-runner:
 *   - секции 2.x раскладываются по иерархии `vrunner.<команда>...`;
 *   - префикс `--` у ключей убирается;
 *   - часть ключей переименовывается (inputPath→src, outputPath→out,
 *     extensionName→extension-name);
 *   - значения `mode` теряют ведущий `-`;
 *   - флаги updatedb `--v1`/`--v2` → `infobase.update.rtype`;
 *   - `testsPath` не переносится (путь к тестам — позиционный аргумент CLI).
 */

/** Маппинг секций 2.x → путь в иерархии настроек 3.0. */
const SECTION_MAP: Readonly<Record<string, string>> = {
	default: 'vrunner',
	xunit: 'vrunner.test.xunit',
	vanessa: 'vrunner.test.vanessa',
	'syntax-check': 'vrunner.validate.syntax-check',
	compile: 'vrunner.cf.compile',
	compileconf: 'vrunner.cf.compile',
	decompile: 'vrunner.cf.decompile',
	decompileconf: 'vrunner.cf.decompile',
	compileepf: 'vrunner.epf.compile',
	decompileepf: 'vrunner.epf.decompile',
	compileext: 'vrunner.cfe.compile',
	decompileext: 'vrunner.cfe.decompile',
	updatedb: 'vrunner.infobase.update',
	run: 'vrunner.run.enterprise',
	loadrepo: 'vrunner.repo.load',
	designer: 'vrunner.run.designer',
};

/** Секции 2.x без автоконвертации (требуют ручной правки). */
const MANUAL_SECTIONS: ReadonlySet<string> = new Set(['init-dev', 'update-dev', 'init-project']);

/** Глобальные переименования ключей (после снятия `--`). */
const KEY_RENAMES: Readonly<Record<string, string>> = {
	inputPath: 'src',
	outputPath: 'out',
	extensionName: 'extension-name',
};

/** Результат конвертации. */
export interface SettingsConversionResult {
	/** Объект в формате autumn-properties 3.0. */
	result: Record<string, unknown>;
	/** Предупреждения о секциях/ключах, требующих ручной проверки. */
	warnings: string[];
}

/**
 * Убирает префикс `--` у ключа.
 */
function stripPrefix(key: string): string {
	return key.startsWith('--') ? key.slice(2) : key;
}

/**
 * Устанавливает значение по вложенному пути ключей, создавая объекты.
 */
function setNested(root: Record<string, unknown>, keys: string[], value: unknown): void {
	let current = root;
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i];
		if (typeof current[k] !== 'object' || current[k] === null) {
			current[k] = {};
		}
		current = current[k] as Record<string, unknown>;
	}
	current[keys[keys.length - 1]] = value;
}

/**
 * Преобразует значение опции `mode`: убирает ведущий `-` у каждого режима.
 */
function convertModeValue(value: unknown): unknown {
	const strip = (v: unknown): unknown =>
		typeof v === 'string' && v.startsWith('-') ? v.slice(1) : v;
	return Array.isArray(value) ? value.map(strip) : strip(value);
}

/**
 * Конвертирует объект настроек 2.x (env.json) в формат 3.0 (autumn-properties).
 *
 * @param env - Разобранный объект env.json (секции верхнего уровня)
 * @returns Объект autumn-properties и список предупреждений
 */
export function convertEnvToAutumnProperties(env: Record<string, unknown>): SettingsConversionResult {
	const result: Record<string, unknown> = {};
	const warnings: string[] = [];

	for (const [section, data] of Object.entries(env)) {
		if (section === '$schema') {
			continue;
		}
		if (MANUAL_SECTIONS.has(section)) {
			warnings.push(`Секция «${section}» не мигрирует автоматически (см. docs/product/миграция/${section}.md).`);
			continue;
		}
		const targetPath = SECTION_MAP[section];
		if (!targetPath) {
			warnings.push(`Неизвестная секция «${section}» пропущена — перенесите вручную.`);
			continue;
		}
		if (typeof data !== 'object' || data === null || Array.isArray(data)) {
			warnings.push(`Секция «${section}»: ожидался объект — пропущена.`);
			continue;
		}

		const basePath = targetPath.split('.');
		const sectionObj = data as Record<string, unknown>;

		// updatedb: флаги --v1/--v2 → rtype
		if (section === 'updatedb') {
			const hasV2 = sectionObj['--v2'] === true || sectionObj['v2'] === true;
			const hasV1 = sectionObj['--v1'] === true || sectionObj['v1'] === true;
			if (hasV2) {
				setNested(result, [...basePath, 'rtype'], 'v2');
			} else if (hasV1) {
				setNested(result, [...basePath, 'rtype'], 'v1');
			}
		}

		if (sectionObj['testsPath'] !== undefined) {
			warnings.push(`[${section}] testsPath не переносится — путь к тестам передаётся позиционным аргументом.`);
		}

		for (const [rawKey, rawValue] of Object.entries(sectionObj)) {
			const cleanKey = stripPrefix(rawKey);
			if ((cleanKey === 'v1' || cleanKey === 'v2') && section === 'updatedb') {
				continue;
			}
			if (cleanKey === 'testsPath') {
				continue;
			}
			const newKey = KEY_RENAMES[cleanKey] ?? cleanKey;
			const newValue = newKey === 'mode' ? convertModeValue(rawValue) : rawValue;
			setNested(result, [...basePath, newKey], newValue);
		}
	}

	return { result, warnings };
}
