/**
 * Запись файлов сборки, которые создаёт панель.
 *
 * Существующий файл не перезаписывается.
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { vrunnerVariantDocument } from './envDefaults';
import { readTemplate } from './templates';
import type { SettingsSchema } from '../../shared/envProfiles';

const VA_TEMPLATE = 'tools/VAParams.json.template';
const XUNIT_TEMPLATE = 'tools/xUnitParams.json.template';
const YAXUNIT_TEMPLATE = 'tools/yaxunit.json.template';
const SYNTAX_TEMPLATE = 'tools/syntax-check-excludes.txt.template';

/**
 * Создаёт файл сборки и файл Vanessa, на который он ссылается, если их ещё нет.
 *
 * @param root - Корень проекта
 * @param relPath - Путь от корня
 * @param schema - Схема настроек
 * @param extensionPath - Каталог расширения, откуда читаются шаблоны
 */
export async function writeBuildFile(
	root: string,
	relPath: string,
	schema: SettingsSchema,
	extensionPath: string | undefined
): Promise<void> {
	const normalized = relPath.replace(/\\/g, '/');
	const name = path.posix.basename(normalized);
	const vrunnerId = /^vrunner\.([A-Za-z0-9_.-]+)\.json$/i.exec(name)?.[1];
	if (vrunnerId) {
		await writeIfMissing(root, `tools/VAParams.${vrunnerId}.json`, await templateOrEmpty(extensionPath, VA_TEMPLATE));
		await writeIfMissing(root, normalized, `${JSON.stringify(vrunnerVariantDocument(schema, vrunnerId), null, 4)}\n`);
		return;
	}
	const template = buildFileTemplate(name);
	if (template) {
		await writeIfMissing(root, normalized, await templateOrEmpty(extensionPath, template));
	}
}

/**
 * Шаблон файла сборки по имени файла.
 *
 * @param name - Имя файла без каталога
 * @returns Имя шаблона в resources/templates или undefined, если шаблона нет
 */
export function buildFileTemplate(name: string): string | undefined {
	if (/^VAParams\.init\.json$/i.test(name)) {
		return 'tools/VAParams.init.json.template';
	}
	if (/^VAParams(?:\.[A-Za-z0-9_.-]+)?\.json$/i.test(name)) {
		return VA_TEMPLATE;
	}
	if (/^xUnitParams(?:\.[A-Za-z0-9_.-]+)?\.json$/i.test(name)) {
		return XUNIT_TEMPLATE;
	}
	if (/^yaxunit(?:\.[A-Za-z0-9_.-]+)?\.json$/i.test(name)) {
		return YAXUNIT_TEMPLATE;
	}
	if (name === 'syntax-check-excludes.txt') {
		return SYNTAX_TEMPLATE;
	}
	return undefined;
}

async function templateOrEmpty(extensionPath: string | undefined, templateName: string): Promise<string> {
	if (!extensionPath) {
		return '';
	}
	return readTemplate(extensionPath, templateName);
}

async function writeIfMissing(root: string, relPath: string, content: string): Promise<void> {
	const fullPath = path.join(root, relPath);
	if (fsSync.existsSync(fullPath)) {
		return;
	}
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, content, 'utf8');
}
