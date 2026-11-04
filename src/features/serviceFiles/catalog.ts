/**
 * Поиск служебных файлов по имени.
 *
 * Каталоги `src`, `oscript_modules`, `build` и `.git` не обходятся: там исходники
 * и зависимости, а не файлы запуска. Новые файлы сборки по умолчанию лежат в
 * `tools/`, профили и `.env` — в корне. Файл из другого каталога тоже попадает
 * в группу, если его имя узнаваемо.
 */

import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { BASE_DOTENV_FILE } from '../../shared/environments';
import {
	baseSettingsFileName,
	parseEnvFileName,
	type SettingsFileFormat,
	type SettingsSchema,
} from '../../shared/envProfiles';

/** Каталоги, которые обход не заходит. */
export const SKIP_DIRS = new Set(['src', 'oscript_modules', 'build', '.git']);

/** Образцы `.env`, которые окружением не являются. */
const DOTENV_TEMPLATES = new Set(['example', 'sample', 'template', 'dist']);

/** Вид служебного файла в дереве панели. */
export type ServiceFileKind =
	| 'profile'
	| 'environment'
	| 'gitignore'
	| 'gitattributes'
	| 'hooks'
	| 'pipelines'
	| 'vrunner'
	| 'vanessa'
	| 'xunit'
	| 'yaxunit'
	| 'syntax';

/** Найденный файл. */
export interface DiscoveredServiceFile {
	kind: ServiceFileKind;
	/** Путь от корня проекта через `/` */
	relPath: string;
}

/** Строка группы: найденный файл или место, куда панель создаёт новый. */
export interface ServiceFileRow {
	kind: ServiceFileKind;
	relPath: string;
	exists: boolean;
}

const VARIANT_STEMS: Partial<Record<ServiceFileKind, string>> = {
	vrunner: 'vrunner',
	vanessa: 'VAParams',
	xunit: 'xUnitParams',
	yaxunit: 'yaxunit',
};

const SINGLE_FILES: { kind: ServiceFileKind; relPath: string }[] = [
	{ kind: 'gitignore', relPath: '.gitignore' },
	{ kind: 'gitattributes', relPath: '.gitattributes' },
	{ kind: 'hooks', relPath: '.1cpt/hooks.json' },
	{ kind: 'pipelines', relPath: '.1cpt/pipelines.json' },
	{ kind: 'syntax', relPath: 'tools/syntax-check-excludes.txt' },
];

/** Группы файлов сборки: у проекта OneScript их нет. */
export const BUILD_KINDS = new Set<ServiceFileKind>(['vrunner', 'vanessa', 'xunit', 'yaxunit', 'syntax']);

/**
 * Узнаёт вид файла по относительному пути.
 *
 * @param relPath - Путь от корня проекта
 * @returns Вид или undefined, если имя панели ни о чём не говорит
 */
export function classifyServiceFile(relPath: string): ServiceFileKind | undefined {
	const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
	const segments = normalized.split('/');
	if (segments.some((segment) => SKIP_DIRS.has(segment))) {
		return undefined;
	}
	const name = segments[segments.length - 1] ?? '';
	const atRoot = segments.length === 1;
	if (atRoot && name === '.gitignore') {
		return 'gitignore';
	}
	if (atRoot && name === '.gitattributes') {
		return 'gitattributes';
	}
	if (normalized === '.1cpt/hooks.json') {
		return 'hooks';
	}
	if (normalized === '.1cpt/pipelines.json') {
		return 'pipelines';
	}
	if (atRoot && isProfileName(name)) {
		return 'profile';
	}
	if (atRoot && isEnvironmentName(name)) {
		return 'environment';
	}
	if (/^vrunner.*\.json$/i.test(name)) {
		return 'vrunner';
	}
	if (/^VAParams.*\.json$/i.test(name) || name === 'vanessaConf.json') {
		return 'vanessa';
	}
	if (/^xUnitParams.*\.json$/i.test(name)) {
		return 'xunit';
	}
	if (/^yaxunit.*\.json$/i.test(name)) {
		return 'yaxunit';
	}
	if (/syntax-check.*\.txt$/i.test(name)) {
		return 'syntax';
	}
	return undefined;
}

/**
 * Оставляет узнаваемые файлы и сортирует их по пути.
 *
 * @param relPaths - Пути от корня проекта
 * @returns Найденные служебные файлы
 */
export function discoverServiceFiles(relPaths: readonly string[]): DiscoveredServiceFile[] {
	const found: DiscoveredServiceFile[] = [];
	for (const relPath of relPaths) {
		const kind = classifyServiceFile(relPath);
		if (kind) {
			found.push({ kind, relPath: relPath.replace(/\\/g, '/') });
		}
	}
	return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Обходит проект и возвращает узнаваемые служебные файлы. */
export async function scanServiceFiles(root: string): Promise<DiscoveredServiceFile[]> {
	const found: string[] = [];
	await walk(root, '', found);
	return discoverServiceFiles(found);
}

async function walk(dir: string, prefix: string, found: string[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry.name)) {
			continue;
		}
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			await walk(path.join(dir, entry.name), rel, found);
		} else if (entry.isFile()) {
			found.push(rel);
		}
	}
}

/** Личный файл окружения: действует всегда и не коммитится. */
export const LOCAL_DOTENV_FILE = '.env.local';

/**
 * Строки группы «Окружение».
 *
 * `.env` есть всегда, даже пока файла нет. `.env.local` показывается, только если уже лежит. Личная половина
 * именованного окружения (`.env.<имя>.local`) в список не входит: она
 * применяется вместе с ним.
 *
 * @param discovered - Найденные файлы проекта
 * @returns Строки группы
 */
export function environmentFileRows(discovered: readonly DiscoveredServiceFile[]): ServiceFileRow[] {
	const rows = rowsOf('environment', discovered).filter((row) => {
		const name = row.relPath.split('/').pop() ?? '';
		return name === LOCAL_DOTENV_FILE || !name.endsWith('.local');
	});
	for (const relPath of [BASE_DOTENV_FILE]) {
		if (!rows.some((row) => row.relPath === relPath)) {
			rows.unshift({ kind: 'environment', relPath, exists: false });
		}
	}
	return rows;
}

/**
 * Строки группы «Профиль запуска»: только файлы схемы установленного vanessa-runner.
 *
 * `env.json` при схеме 3 и `autumn-properties.json` при схеме 2 профилем не являются,
 * как и в списке профиля запуска.
 *
 * @param discovered - Найденные файлы проекта
 * @param schema - Схема настроек установленного vanessa-runner
 * @returns Строки группы, с местом для основного файла, если его ещё нет
 */
export function profileFileRows(discovered: readonly DiscoveredServiceFile[], schema: SettingsSchema): ServiceFileRow[] {
	const rows = rowsOf('profile', discovered).filter((row) => isSchemaProfile(row.relPath, schema));
	const base = baseSettingsFileName(schema);
	if (!rows.some((row) => row.relPath === base)) {
		rows.unshift({ kind: 'profile', relPath: base, exists: false });
	}
	return rows;
}

/**
 * Строки группы Vanessa Runner: уже лежащие файлы только текущей схемы.
 *
 * Файл другой версии профилем не является, поэтому в группу не попадает.
 * Место для нового файла остаётся: его ещё нет, и создаётся он в текущей схеме.
 *
 * @param discovered - Найденные файлы проекта
 * @param schema - Схема настроек установленного vanessa-runner
 * @param formatOf - Формат существующего файла; undefined, если файл не разобрать
 * @returns Строки группы
 */
export function vrunnerFileRows(
	discovered: readonly DiscoveredServiceFile[],
	schema: SettingsSchema,
	formatOf: (relPath: string) => SettingsFileFormat | undefined
): ServiceFileRow[] {
	return rowsOf('vrunner', discovered).filter((row) => !row.exists || formatOf(row.relPath) === schema);
}

/**
 * Строки одной группы: места для новых файлов и всё, что уже нашлось.
 *
 * @param kind - Вид группы
 * @param discovered - Найденные файлы проекта
 * @returns Строки в порядке показа
 */
export function rowsOf(kind: ServiceFileKind, discovered: readonly DiscoveredServiceFile[]): ServiceFileRow[] {
	const existing = discovered.filter((file) => file.kind === kind).map((file) => file.relPath).sort((a, b) => a.localeCompare(b, 'ru'));
	const known = new Set(existing);
	const defaults = defaultPaths(kind).filter((relPath) => !known.has(relPath));
	return [
		...existing.map((relPath) => ({ kind, relPath, exists: true })),
		...defaults.map((relPath) => ({ kind, relPath, exists: false })),
	];
}

/**
 * Путь нового варианта: идентификатор в середине имени, как у профиля запуска.
 *
 * @param kind - Вид файла сборки
 * @param id - Идентификатор
 * @returns Путь `tools/<имя>.<id>.json` или undefined, если у вида нет вариантов
 */
export function variantPath(kind: ServiceFileKind, id: string): string | undefined {
	const stem = VARIANT_STEMS[kind];
	if (!stem || !/^[A-Za-z0-9_.-]+$/.test(id)) {
		return undefined;
	}
	return `tools/${stem}.${id}.json`;
}

/**
 * Путь лежит не там, куда панель кладёт новый файл этого вида.
 *
 * @param kind - Вид файла
 * @param relPath - Путь от корня
 * @returns true, если в подписи нужен сам путь
 */
export function pathIsNotable(kind: ServiceFileKind, relPath: string): boolean {
	if (kind === 'profile' || kind === 'environment' || kind === 'gitignore' || kind === 'gitattributes') {
		return relPath.includes('/');
	}
	if (kind === 'hooks' || kind === 'pipelines') {
		return !relPath.startsWith('.1cpt/');
	}
	return !relPath.startsWith('tools/');
}

function defaultPaths(kind: ServiceFileKind): readonly string[] {
	switch (kind) {
		case 'vrunner':
			return ['tools/vrunner.json', 'tools/vrunner.init.json'];
		case 'vanessa':
			return ['tools/VAParams.json', 'tools/VAParams.init.json'];
		case 'xunit':
			return ['tools/xUnitParams.json'];
		case 'yaxunit':
			return ['tools/yaxunit.json'];
		case 'syntax':
			return ['tools/syntax-check-excludes.txt'];
		case 'gitignore':
		case 'gitattributes':
		case 'hooks':
		case 'pipelines':
			return SINGLE_FILES.filter((file) => file.kind === kind).map((file) => file.relPath);
		case 'profile':
		case 'environment':
			return [];
		default: {
			const neverKind: never = kind;
			return neverKind;
		}
	}
}

/** Постоянные строки. Свой файл идёт после них и место постоянной строки не занимает. */
const FILE_ORDER = [
	'.env',
	'.env.local',
	'env.json',
	'autumn-properties.json',
	'vrunner.json',
	'vrunner.init.json',
	'VAParams.json',
	'VAParams.init.json',
	'xUnitParams.json',
	'yaxunit.json',
	'syntax-check-excludes.txt',
	'syntax-check-exception-file.txt',
	'hooks.json',
	'pipelines.json',
];

/**
 * Строки в постоянном порядке: знакомое имя, затем путь.
 *
 * Наличие файла на место не влияет.
 *
 * @param rows - Строки группы
 * @returns Те же строки в порядке показа
 */
export function sortServiceRows(rows: readonly ServiceFileRow[]): ServiceFileRow[] {
	return [...rows].sort((left, right) => {
		const order = fileOrder(left.relPath) - fileOrder(right.relPath);
		return order !== 0 ? order : left.relPath.localeCompare(right.relPath, 'ru');
	});
}

function fileOrder(relPath: string): number {
	const name = relPath.split('/').pop() ?? relPath;
	const index = FILE_ORDER.indexOf(name);
	return index === -1 ? FILE_ORDER.length : index;
}

function isSchemaProfile(relPath: string, schema: SettingsSchema): boolean {
	const name = relPath.split('/').pop() ?? relPath;
	return parseEnvFileName(name, schema) !== undefined;
}

function isProfileName(name: string): boolean {
	return parseEnvFileName(name, 'v2') !== undefined || parseEnvFileName(name, 'v3') !== undefined;
}

function isEnvironmentName(name: string): boolean {
	if (name === '.env' || name === '.env.local') {
		return true;
	}
	if (!name.startsWith('.env.')) {
		return false;
	}
	const rest = name.slice('.env.'.length);
	const id = rest.endsWith('.local') ? rest.slice(0, -'.local'.length) : rest;
	return id.length > 0 && !DOTENV_TEMPLATES.has(id.toLowerCase()) && /^[A-Za-z0-9_.-]+$/.test(id);
}
