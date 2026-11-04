/**
 * Ссылка профиля запуска на один файл vrunner.
 *
 * Ссылка лежит в самом файле профиля и у каждого профиля своя. Уже записанные
 * секции команд функция не трогает: подмена действует при чтении, когда ссылка
 * есть. Ключ `vrunner.settings` занят личным файлом настроек и сюда не пишется.
 */

import type { SettingsSchema } from '../../shared/envProfiles';
import { settingValue } from '../../shared/vrunnerSettings';

/** Ключ ссылки в env.json (2.x). Имя с `$` не является командой vanessa-runner. */
const V2_KEY = '$vrunnerFile';

/** Ключ ссылки в autumn-properties.json (3.x), рядом с секциями `vrunner`. */
const V3_KEY = 'serviceFile';

/** Секции команд env.json, которые при ссылке берутся из файла vrunner. */
const V2_COMMANDS = ['vanessa', 'xunit', 'yaxunit', 'syntax-check', 'run'] as const;

/** Секции команд autumn-properties.json внутри `vrunner`. */
const V3_COMMANDS = ['test', 'validate', 'run'] as const;

/**
 * Это файл настроек vrunner, а не профиль и не личное перекрытие.
 *
 * @param relPath - Путь от корня проекта
 * @returns true для `vrunner.json`, `vrunner.local.json`, `tools/vrunner_ssl.json`
 */
export function isVrunnerFile(relPath: string): boolean {
	const name = relPath.replace(/\\/g, '/').split('/').pop() ?? '';
	return /^vrunner.*\.json$/i.test(name);
}

/**
 * Читает ссылку профиля на файл vrunner.
 *
 * @param doc - Разобранный файл профиля
 * @param schema - Схема настроек
 * @returns Путь от корня или undefined, если ссылки нет
 */
export function readVrunnerLink(doc: unknown, schema: SettingsSchema): string | undefined {
	if (!isRecord(doc)) {
		return undefined;
	}
	const raw = schema === 'v3'
		? (isRecord(doc.vrunner) ? doc.vrunner[V3_KEY] : undefined)
		: doc[V2_KEY];
	if (typeof raw !== 'string' || !isVrunnerFile(raw.trim())) {
		return undefined;
	}
	return raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Записывает ссылку в копию профиля. Другие поля не меняются.
 *
 * @param doc - Разобранный файл профиля
 * @param schema - Схема настроек
 * @param relPath - Путь файла vrunner от корня
 * @returns Новый объект профиля
 */
export function writeVrunnerLink(doc: unknown, schema: SettingsSchema, relPath: string): Record<string, unknown> {
	const record: Record<string, unknown> = isRecord(doc) ? { ...doc } : {};
	const path = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
	if (schema === 'v3') {
		const vrunner = isRecord(record.vrunner) ? { ...record.vrunner } : {};
		vrunner[V3_KEY] = path;
		record.vrunner = vrunner;
		return record;
	}
	record[V2_KEY] = path;
	return record;
}

/**
 * Подставляет секции команд из файла vrunner поверх профиля.
 *
 * Строка базы берётся из файла vrunner, если она там задана. Секции, которых
 * в файле нет, не затираются.
 *
 * @param profile - Настройки профиля, уже сложенные с перекрытиями
 * @param linked - Разобранный файл vrunner
 * @param schema - Схема настроек
 * @returns Настройки, которые видит запуск
 */
export function applyLinkedCommands(
	profile: Record<string, unknown>,
	linked: Record<string, unknown>,
	schema: SettingsSchema
): Record<string, unknown> {
	if (schema === 'v2') {
		const result: Record<string, unknown> = { ...profile };
		const connection = connectionOf(linked);
		if (connection) {
			const profileDefault = isRecord(result.default) ? { ...result.default } : {};
			profileDefault['--ibconnection'] = connection;
			result.default = profileDefault;
		}
		for (const key of V2_COMMANDS) {
			if (isRecord(linked[key])) {
				result[key] = linked[key];
			}
		}
		return result;
	}
	const result: Record<string, unknown> = { ...profile };
	const profileV = isRecord(result.vrunner) ? { ...result.vrunner } : {};
	const linkedV = isRecord(linked.vrunner) ? linked.vrunner : {};
	const connection = connectionOf(linked);
	if (connection) {
		profileV.ibconnection = connection;
	}
	for (const key of V3_COMMANDS) {
		if (isRecord(linkedV[key])) {
			profileV[key] = linkedV[key];
		}
	}
	result.vrunner = profileV;
	return result;
}

function connectionOf(linked: Record<string, unknown>): string | undefined {
	const v3 = isRecord(linked.vrunner) ? linked.vrunner.ibconnection : undefined;
	if (typeof v3 === 'string' && v3.trim().length > 0) {
		return v3;
	}
	const v2 = isRecord(linked.default) ? linked.default['--ibconnection'] : undefined;
	if (typeof v2 === 'string' && v2.trim().length > 0) {
		return v2;
	}
	return undefined;
}

/**
 * Пути файлов Vanessa, xUnit, YAxUnit и синтаксиса, упомянутые в документе.
 *
 * @param doc - Разобранный JSON
 * @returns Пути от корня без `./`
 */
export function referencedBuildFiles(doc: unknown): string[] {
	const found = new Set<string>();
	collectPaths(doc, found);
	return [...found];
}

/**
 * Путь VAParams из секции vanessa.
 *
 * @param settings - Разобранные настройки
 * @param schema - Схема
 * @returns Путь или undefined
 */
export function linkedVanessaSettings(settings: Record<string, unknown>, schema: SettingsSchema): string | undefined {
	const value = settingValue(settings, schema, 'vanessa', 'vanessasettings');
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Путь конфига YAxUnit из команды `RunUnitTests=`.
 *
 * @param settings - Разобранные настройки
 * @param schema - Схема
 * @returns Путь или undefined
 */
export function linkedYaxunitConfig(settings: Record<string, unknown>, schema: SettingsSchema): string | undefined {
	const command = settingValue(settings, schema, 'yaxunit', 'command');
	if (typeof command !== 'string') {
		return undefined;
	}
	const separator = command.indexOf('=');
	if (separator < 0) {
		return undefined;
	}
	const path = command.slice(separator + 1).trim();
	return path.length > 0 ? path : undefined;
}

function collectPaths(value: unknown, found: Set<string>): void {
	if (typeof value === 'string') {
		const trimmed = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
		const file = trimmed.includes('=') ? trimmed.slice(trimmed.indexOf('=') + 1).trim() : trimmed;
		if (/\.(json|txt)$/i.test(file) && /VAParams|xUnitParams|yaxunit|vanessaConf|syntax-check/i.test(file)) {
			found.add(file);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectPaths(item, found);
		}
		return;
	}
	if (isRecord(value)) {
		for (const nested of Object.values(value)) {
			collectPaths(nested, found);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
