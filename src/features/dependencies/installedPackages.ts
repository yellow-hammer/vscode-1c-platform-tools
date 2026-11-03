/**
 * Установленные пакеты проекта: каталоги `oscript_modules` с `opm-metadata.xml`.
 * @module installedPackages
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MODULES_DIRECTORY } from '../../shared/oneScriptModules';
import { parseOpmMetadata, type OpmPackageDependency } from './opmMetadata';

/** Пакет, стоящий в `oscript_modules`. */
export interface InstalledPackage {
	name: string;
	version?: string;
	dependencies: OpmPackageDependency[];
}

/**
 * Пакеты из `oscript_modules` корня проекта.
 *
 * Каталог без `opm-metadata.xml` (например `bin`) пропускается.
 *
 * @param root - Корень проекта
 */
export function readInstalledPackages(root: string): InstalledPackage[] {
	const directory = path.join(root, MODULES_DIRECTORY);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}
	const packages: InstalledPackage[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		let xml: string;
		try {
			xml = fs.readFileSync(path.join(directory, entry.name, 'opm-metadata.xml'), 'utf8');
		} catch {
			continue;
		}
		const metadata = parseOpmMetadata(xml);
		if (metadata === undefined) {
			continue;
		}
		const name = metadata.name ?? entry.name;
		packages.push({
			name,
			...(metadata.version !== undefined ? { version: metadata.version } : {}),
			dependencies: metadata.dependencies,
		});
	}
	packages.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
	return packages;
}
