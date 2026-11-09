import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SettingsSchema } from '../../shared/envProfiles';
import {
	extractJUnitPathFromReportsXunit,
	reportsXunitFromEnv,
	resolveConfigPath,
	syntaxCheckExceptionFileFromEnv,
	syntaxCheckJUnitPathFromEnv,
	vanessaReportSpec,
	vanessaSettingsPathFromEnv,
	xunitSettingsPathFromEnv,
	yaxunitSectionFromEnv,
} from './projectTestConfig';

/** Незаданная настройка: в каком файле и какая. */
export interface SettingGap {
	/** Файл, где нет настройки. Пусто: файл профиля. */
	where?: string;
	/** Какой настройки нет. */
	text: string;
}

/** Связь профиля: откуда прогон узнает, куда писать отчёт. */
export interface ProfileLink {
	/** Короткое имя фреймворка. */
	short: string;
	/** Заголовок в отчёте проверки. */
	title: string;
	/** Связь задана. */
	ok: boolean;
	/** Строки отчёта проверки. */
	lines: string[];
	/** Служебный файл из профиля, если ключ задан. */
	file?: string;
	/** Незаданная настройка. Есть, когда связи нет. */
	gap?: SettingGap;
}

const ORDER = ['vanessa', 'xunit', 'yaxunit', 'syntax-check'] as const;

/**
 * Связи активного профиля: файл настроек и каталог отчёта.
 *
 * @param root - Корень проекта
 * @param settings - Разобранный профиль
 * @param schema - Схема профиля
 */
export async function profileLinks(
	root: string,
	settings: Record<string, unknown>,
	schema: SettingsSchema,
): Promise<ProfileLink[]> {
	return [
		await vanessaLink(root, settings, schema),
		xunitLink(settings, schema),
		await yaxunitLink(root, settings, schema),
		syntaxLink(settings, schema),
	];
}

/**
 * Текст проверки для терминала задачи: файл профиля и ветки под ним.
 *
 * @param file - Файл профиля
 * @param links - Связи профиля
 */
export function formatProfileLinks(file: string, links: readonly ProfileLink[]): string {
	const lines = [shownProfilePath(file)];
	for (let index = 0; index < links.length; index++) {
		lines.push(...linkBranch(links[index], index === links.length - 1));
	}
	return lines.join('\n');
}

/**
 * Красная строка: файла профиля нет.
 *
 * @param file - Файл профиля
 */
export function formatMissingProfileFile(file: string): string {
	return red(`${shownProfilePath(file)}  файл не найден`);
}

/**
 * Есть ли файл профиля на диске.
 *
 * @param root - Корень проекта
 * @param file - Файл профиля, абсолютный или от корня
 * @returns true, если файла нет
 */
export async function profileFileMissing(root: string, file: string): Promise<boolean> {
	try {
		await fs.access(path.resolve(root, file));
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return true;
		}
		throw error;
	}
}

/**
 * Служебные файлы фреймворков прогона для заголовка.
 *
 * @param links - Связи профиля
 * @param ids - Фреймворки прогона
 */
export function serviceFileClauses(links: readonly ProfileLink[], ids: readonly string[]): string[] {
	const wanted = new Set(ids);
	return ORDER
		.filter((id) => wanted.has(id))
		.map((id) => links.find((link) => link.short === shortOf(id)))
		.filter((link): link is ProfileLink => link !== undefined)
		.map(frameworkClause)
		.filter((clause) => clause !== '');
}

/** Фраза заголовка: служебный файл и, если настройки не хватает, жёлтый текст проблемы. */
function frameworkClause(link: ProfileLink): string {
	const problem = link.gap?.text;
	if (link.file && problem) {
		return `${link.title}: ${link.file}, ${yellow(problem)}`;
	}
	if (link.file) {
		return `${link.title}: ${link.file}`;
	}
	if (problem) {
		return `${link.title}: ${yellow(problem)}`;
	}
	return '';
}

/** Имя опции так, как она записана в файле профиля. */
function optionKey(schema: SettingsSchema, option: string): string {
	return schema === 'v3' ? option : `--${option}`;
}

/** Имя файла профиля как путь от корня проекта: по нему терминал открывает файл. */
function shownProfilePath(file: string): string {
	if (path.isAbsolute(file) || file.startsWith('.') || file.includes('/') || file.includes('\\')) {
		return file;
	}
	return `./${file}`;
}

function shortOf(id: (typeof ORDER)[number]): string {
	switch (id) {
		case 'vanessa':
			return 'VA';
		case 'xunit':
			return 'xUnit';
		case 'yaxunit':
			return 'YAxUnit';
		case 'syntax-check':
			return 'синтаксис';
		default: {
			const unknown: never = id;
			return unknown;
		}
	}
}

function linkBranch(link: ProfileLink, last: boolean): string[] {
	const branch = last ? '  └─ ' : '  ├─ ';
	const pad = last ? '     ' : '  │  ';
	const head = `${tone(`${branch}${link.title}`, link.ok)}  ${paint(link.ok)}`;
	return [
		head,
		...link.lines.map((line, index) => {
			const mark = index === link.lines.length - 1 ? '└─ ' : '├─ ';
			return tone(`${pad}${mark}${line}`, link.ok);
		}),
	];
}

function paint(ok: boolean): string {
	return ok ? '\u001b[32mесть\u001b[0m' : yellow('нет');
}

function tone(text: string, ok: boolean): string {
	return ok ? text : yellow(text);
}

function yellow(text: string): string {
	return `\u001b[33m${text}\u001b[0m`;
}

function red(text: string): string {
	return `\u001b[31m${text}\u001b[0m`;
}

async function vanessaLink(
	root: string,
	settings: Record<string, unknown>,
	schema: SettingsSchema,
): Promise<ProfileLink> {
	const title = 'Vanessa';
	const file = vanessaSettingsPathFromEnv(settings, schema);
	if (!file) {
		return { short: 'VA', title, ok: false, lines: ['файл настроек не задан'], gap: { text: `${optionKey(schema, 'vanessasettings')} не задан` } };
	}
	const parsed = await readJsonFile(resolveConfigPath(file, root));
	if (parsed === 'missing') {
		return { short: 'VA', title, ok: false, file, lines: [`файл  ${file}`, 'файл не найден'], gap: { where: file, text: 'файл не найден' } };
	}
	if (parsed === 'bad') {
		return { short: 'VA', title, ok: false, file, lines: [`файл  ${file}`, 'файл не разобран'], gap: { where: file, text: 'файл не разобран' } };
	}
	const target = vanessaReportSpec(parsed);
	if (!target) {
		return { short: 'VA', title, ok: false, file, lines: [`файл  ${file}`, 'каталог отчёта не задан'], gap: { where: file, text: 'каталог отчёта не задан' } };
	}
	return { short: 'VA', title, ok: true, file, lines: [`файл  ${file}`, `отчёт  ${target.path}`] };
}

function xunitLink(settings: Record<string, unknown>, schema: SettingsSchema): ProfileLink {
	const title = 'xUnit';
	const file = xunitSettingsPathFromEnv(settings, schema);
	const reports = reportsXunitFromEnv(settings, schema);
	const junit = reports ? extractJUnitPathFromReportsXunit(reports) : undefined;
	const lines = file ? [`файл  ${file}`] : [];
	const named = file ? { file } : {};
	if (!junit) {
		return {
			short: 'xUnit',
			title,
			ok: false,
			...named,
			lines: [...lines, 'генератор jUnit не задан'],
			gap: { text: reports ? 'генератор jUnit не задан' : `${optionKey(schema, 'reportsxunit')} не задан` },
		};
	}
	return { short: 'xUnit', title, ok: true, ...named, lines: [...lines, `отчёт  ${junit}`] };
}

async function yaxunitLink(
	root: string,
	settings: Record<string, unknown>,
	schema: SettingsSchema,
): Promise<ProfileLink> {
	const title = 'YAxUnit';
	const section = yaxunitSectionFromEnv(settings, schema);
	if (!section.configPath) {
		return section.report
			? { short: 'YAxUnit', title, ok: true, lines: [`отчёт  ${section.report}`] }
			: {
				short: 'YAxUnit',
				title,
				ok: false,
				lines: ['конфиг и отчёт не заданы'],
				gap: { text: schema === 'v3' ? 'yaxunit-config не задан' : 'RunUnitTests не задан' },
			};
	}
	const parsed = await readJsonFile(resolveConfigPath(section.configPath, root));
	if (parsed === 'missing') {
		return { short: 'YAxUnit', title, ok: false, file: section.configPath, lines: [`файл  ${section.configPath}`, 'файл не найден'], gap: { where: section.configPath, text: 'файл не найден' } };
	}
	if (parsed === 'bad') {
		return { short: 'YAxUnit', title, ok: false, file: section.configPath, lines: [`файл  ${section.configPath}`, 'файл не разобран'], gap: { where: section.configPath, text: 'файл не разобран' } };
	}
	const report = typeof parsed['reportPath'] === 'string' && parsed['reportPath'].length > 0 ? parsed['reportPath'] : undefined;
	if (!report) {
		return { short: 'YAxUnit', title, ok: false, file: section.configPath, lines: [`файл  ${section.configPath}`, 'отчёт не задан'], gap: { where: section.configPath, text: 'reportPath не задан' } };
	}
	return { short: 'YAxUnit', title, ok: true, file: section.configPath, lines: [`файл  ${section.configPath}`, `отчёт  ${report}`] };
}

function syntaxLink(settings: Record<string, unknown>, schema: SettingsSchema): ProfileLink {
	const title = 'Синтаксический контроль';
	const file = syntaxCheckExceptionFileFromEnv(settings, schema);
	const report = syntaxCheckJUnitPathFromEnv(settings, schema);
	const lines = file ? [`файл  ${file}`] : [];
	const named = file ? { file } : {};
	return report
		? { short: 'синтаксис', title, ok: true, ...named, lines: [...lines, `отчёт  ${report}`] }
		: {
			short: 'синтаксис',
			title,
			ok: false,
			...named,
			lines: [...lines, 'отчёт не задан'],
			gap: { text: `${optionKey(schema, schema === 'v3' ? 'report-path' : 'junitpath')} не задан` },
		};
}

/** Убирает BOM в начале JSON-файла. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** JSON-объект файла. `missing`, если файла нет; `bad`, если он не разбирается. */
async function readJsonFile(filePath: string): Promise<Record<string, unknown> | 'missing' | 'bad'> {
	try {
		return JSON.parse(stripBom(await fs.readFile(filePath, 'utf8'))) as Record<string, unknown>;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'bad';
	}
}
