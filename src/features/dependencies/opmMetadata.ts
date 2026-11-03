/**
 * Разбор `opm-metadata.xml` установленного пакета OneScript.
 *
 * Модуль чистый: имя, версия и объявленные зависимости, без vscode.
 * @module opmMetadata
 */

import { XMLParser } from 'fast-xml-parser';

/** Зависимость, объявленная установленным пакетом. */
export interface OpmPackageDependency {
	name: string;
	/** Нижняя граница, если пакет её записал. */
	version?: string;
	/** Зависимость для разработки. */
	dev: boolean;
}

/** Сведения из `opm-metadata.xml`. */
export interface OpmPackageMetadata {
	name?: string;
	version?: string;
	dependencies: OpmPackageDependency[];
}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '',
	parseTagValue: false,
	trimValues: true,
	isArray: (tagName) => tagName === 'depends-on',
});

/**
 * Имя, версия и зависимости из текста `opm-metadata.xml`.
 *
 * @param xml - Содержимое файла
 * @returns undefined, если документ не разобрать или в нём нет корня
 */
export function parseOpmMetadata(xml: string): OpmPackageMetadata | undefined {
	if (xml.trim() === '') {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = parser.parse(xml);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return undefined;
	}
	const root = (parsed as Record<string, unknown>)['opm-metadata'];
	if (typeof root !== 'object' || root === null) {
		return undefined;
	}
	const record = root as Record<string, unknown>;
	return {
		name: textOf(record['name']),
		version: textOf(record['version']),
		dependencies: dependenciesOf(record['depends-on']),
	};
}

function dependenciesOf(value: unknown): OpmPackageDependency[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const dependencies: OpmPackageDependency[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const name = textOf(record['name']);
		if (name === undefined) {
			continue;
		}
		const version = textOf(record['version']);
		dependencies.push({
			name,
			...(version !== undefined ? { version } : {}),
			dev: record['dev'] === true || record['dev'] === 'true',
		});
	}
	return dependencies;
}

function textOf(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed === '' ? undefined : trimmed;
	}
	if (typeof value === 'number') {
		return String(value);
	}
	return undefined;
}
