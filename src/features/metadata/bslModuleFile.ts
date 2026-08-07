/**
 * Файл модуля `.bsl` рядом с объектом метаданных.
 *
 * @module bslModuleFile
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** UTF-8 BOM: конфигуратор пишет модули с ним. */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Гарантирует существование файла модуля: если файла нет, создаёт пустой вместе с каталогом.
 *
 * @param modulePath Полный путь к `.bsl`.
 * @returns `true`, если файл был создан.
 */
export async function ensureBslModuleFile(modulePath: string): Promise<boolean> {
	try {
		await fs.access(modulePath);
		return false;
	} catch {
		/* файла нет — создаём ниже */
	}
	await fs.mkdir(path.dirname(modulePath), { recursive: true });
	await fs.writeFile(modulePath, UTF8_BOM);
	return true;
}
