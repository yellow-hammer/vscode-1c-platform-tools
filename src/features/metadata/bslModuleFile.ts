/**
 * Файл модуля `.bsl` рядом с объектом метаданных.
 *
 * @module bslModuleFile
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** UTF-8 BOM: конфигуратор пишет модули с ним. */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Что стало с файлом модуля. */
export type ModuleFileState =
	/** Файл был на месте. */
	| 'exists'
	/** Файла не было, создан пустой. */
	| 'created'
	/** Текстового модуля не бывает: рядом лежит двоичный. */
	| 'binary';

/**
 * Гарантирует существование файла модуля: если файла нет, создаёт пустой вместе с каталогом.
 *
 * Пустой модуль поверх двоичного не создаётся: у защищённого паролем модуля
 * исходный код лежит в `.bin`, и текстовый файл рядом сделал бы обратную
 * загрузку неоднозначной.
 *
 * @param modulePath Полный путь к `.bsl`.
 */
export async function ensureBslModuleFile(modulePath: string): Promise<ModuleFileState> {
	try {
		await fs.access(modulePath);
		return 'exists';
	} catch {
		/* файла нет — решаем ниже */
	}
	const binary = path.join(path.dirname(modulePath), `${path.basename(modulePath, '.bsl')}.bin`);
	try {
		await fs.access(binary);
		return 'binary';
	} catch {
		/* двоичного нет — создаём текстовый */
	}
	await fs.mkdir(path.dirname(modulePath), { recursive: true });
	await fs.writeFile(modulePath, UTF8_BOM);
	return 'created';
}
