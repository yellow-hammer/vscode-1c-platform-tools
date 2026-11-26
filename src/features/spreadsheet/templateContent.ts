/**
 * Файл содержимого макета на диске.
 *
 * Вид макета решает расширение: у EDT табличный документ — `Template.mxlx`,
 * схема компоновки — `Template.dcs`. У выгрузки конфигуратора содержимое лежит
 * в `Ext/Template.xml`, а вид определяет md-sparrow.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { objectDirectoryOf } from '../../shared/objectPaths';

const CONTENT_EXTENSIONS = ['.mxlx', '.xml', '.dcs', '.txt', '.html', '.htm', '.bin', '.addin'];

/** Каталог макета: у общего макета это каталог самого объекта. */
export function templateFolderOf(objectFile: string, templateName?: string): string {
	const directory = objectDirectoryOf(objectFile);
	return templateName === undefined ? directory : path.join(directory, 'Templates', templateName);
}

/** Файл содержимого: сначала `Ext`, затем каталог макета. */
export async function findTemplateContent(objectFile: string, templateName?: string): Promise<string | undefined> {
	const folder = templateFolderOf(objectFile, templateName);
	return (await pickContent(path.join(folder, 'Ext'))) ?? pickContent(folder);
}

async function pickContent(directory: string): Promise<string | undefined> {
	let names: string[];
	try {
		names = await fs.readdir(directory);
	} catch {
		return undefined;
	}
	const files = names.filter((name) => name.toLowerCase().startsWith('template.'));
	files.sort((left, right) => rank(left) - rank(right));
	const chosen = files[0];
	return chosen === undefined ? undefined : path.join(directory, chosen);
}

function rank(name: string): number {
	const index = CONTENT_EXTENSIONS.indexOf(path.extname(name).toLowerCase());
	return index < 0 ? CONTENT_EXTENSIONS.length : index;
}
