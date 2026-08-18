/**
 * Определение имени расширения конфигурации по его исходникам.
 *
 * Имя каталога исходников (src/cfe/<каталог>, tests/cfe/<каталог>) и имя расширения в метаданных —
 * разные вещи: каталог может называться `yaxunit-test`, а расширение внутри —
 * «Тесты». Для команд vrunner нужно имя из метаданных: под ним расширение
 * регистрируется в информационной базе, а vanessa-runner 3 ещё и валидирует
 * его (буквы/цифры/подчёркивание — дефис недопустим).
 *
 * Источник имени — корневой `Configuration.xml` XML-дампа
 * (MetaDataObject → Configuration → Properties → Name); при его отсутствии
 * или ошибке разбора используется имя каталога.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { logger } from '../../shared/logger';

const log = logger.scope('extensions');

/**
 * Извлекает имя расширения из содержимого Configuration.xml.
 *
 * @param xml - Содержимое корневого Configuration.xml исходников расширения
 * @returns Имя расширения или undefined, если разобрать не удалось
 */
export function parseExtensionNameFromConfigurationXml(xml: string): string | undefined {
	if (!xml) {
		return undefined;
	}
	let parsed: Record<string, unknown>;
	try {
		const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
		parsed = parser.parse(xml) as Record<string, unknown>;
	} catch {
		return undefined;
	}
	const metaDataObject = parsed['MetaDataObject'] as Record<string, unknown> | undefined;
	const configuration = metaDataObject?.['Configuration'] as Record<string, unknown> | undefined;
	const properties = configuration?.['Properties'] as Record<string, unknown> | undefined;
	const name = properties?.['Name'];
	if (typeof name !== 'string' && typeof name !== 'number') {
		return undefined;
	}
	const trimmed = String(name).trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Извлекает имя расширения из содержимого Configuration.mdo проекта EDT.
 *
 * @param mdo - Содержимое src/Configuration/Configuration.mdo
 * @returns Имя расширения или undefined, если разобрать не удалось
 */
export function parseExtensionNameFromConfigurationMdo(mdo: string): string | undefined {
	if (!mdo) {
		return undefined;
	}
	const name = mdo.match(/<name>([^<]+)<\/name>/)?.[1]?.trim();
	return name !== undefined && name.length > 0 ? name : undefined;
}

/**
 * Возвращает имя расширения для каталога исходников.
 *
 * Читает `<каталог исходников>/Configuration.xml`; если файла нет или имя
 * не извлекается — возвращает имя каталога (прежнее поведение).
 *
 * @param extensionSrcDir - Абсолютный путь к каталогу исходников расширения
 * @returns Имя расширения из метаданных или имя каталога
 */
export async function resolveExtensionNameFromSrc(extensionSrcDir: string): Promise<string> {
	const fallback = path.basename(extensionSrcDir);
	// Выгрузка конфигуратора и проект EDT держат описание в разных файлах.
	const markers: Array<[string, (content: string) => string | undefined]> = [
		['Configuration.xml', parseExtensionNameFromConfigurationXml],
		[path.join('src', 'Configuration', 'Configuration.mdo'), parseExtensionNameFromConfigurationMdo],
	];

	for (const [relative, parse] of markers) {
		try {
			const content = await fs.readFile(path.join(extensionSrcDir, relative), 'utf8');
			const name = parse(content);
			if (name) {
				if (name !== fallback) {
					log.debug(`Имя расширения в метаданных: ${name} (каталог ${fallback})`);
				}
				return name;
			}
		} catch {
			// Файла нет или он нечитаем — пробуем следующую раскладку
		}
	}

	return fallback;
}
