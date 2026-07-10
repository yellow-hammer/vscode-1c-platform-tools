/**
 * Определение имени расширения конфигурации по его исходникам.
 *
 * Имя каталога исходников (src/cfe/<каталог>) и имя расширения в метаданных —
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
	try {
		const xml = await fs.readFile(path.join(extensionSrcDir, 'Configuration.xml'), 'utf8');
		const name = parseExtensionNameFromConfigurationXml(xml);
		if (name) {
			if (name !== fallback) {
				log.debug(`Имя расширения в метаданных: ${name} (каталог ${fallback})`);
			}
			return name;
		}
	} catch {
		// Configuration.xml отсутствует или нечитаем — используем имя каталога
	}
	return fallback;
}
