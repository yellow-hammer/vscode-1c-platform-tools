/**
 * Чтение шаблонов служебных файлов из ресурсов расширения.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * Читает шаблон из каталога ресурсов расширения
 *
 * @param extensionPath - Путь к каталогу расширения
 * @param templateName - Имя файла шаблона (например 'gitignore.template' или 'tools/x.json.template')
 * @returns Содержимое шаблона
 */
export async function readTemplate(extensionPath: string, templateName: string): Promise<string> {
	return fs.readFile(path.join(extensionPath, 'resources', 'templates', templateName), 'utf8');
}
