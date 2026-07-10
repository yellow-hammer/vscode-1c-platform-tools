/**
 * Каталог опций vanessa-runner для редактора профиля запуска.
 *
 * Данные собираются из трёх слоёв:
 * 1. Сгенерированные каталоги (scripts/gen-vrunner-options.mjs):
 *    vrunner-options.v2.json — из официальной vanessa-runner-schema.json;
 *    vrunner-options.v3.json — из аннотаций `&Опция` исходников 3.x,
 *    дополненных документацией и метаданными одноимённых опций 2.x.
 * 2. Кураторский слой vrunner-options.overrides.json: смысловые группы формы,
 *    порядок важности, уточнения типов и человеческие подписи значений.
 *
 * Результат — секции формы: где опция живёт в JSON и как её показать.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { SettingsSchema } from '../../shared/envProfiles';

/** Опция каталога (метаданные для контрола формы). */
export interface CatalogOption {
	/** Ключ в файле настроек (в 2.x — с префиксом `--`, в 3.x — без) */
	key: string;
	/** Тип значения: boolean | string | number | array | integer */
	type: string;
	/** Описание для пользователя (из схемы/исходников/документации vanessa-runner) */
	description: string;
	/** Значение по умолчанию (если задано схемой) */
	default?: unknown;
	/** Допустимые значения */
	enum?: unknown[];
	/** Подписи допустимых значений (значение -> подпись) */
	enumLabels?: Record<string, string>;
	/** Допустимые значения элементов массива */
	itemsEnum?: unknown[];
	/** Смысловая группа формы (id из overrides; 'other' — вне групп) */
	group: string;
	/** Порядок важности (меньше — выше в списке) */
	order: number;
}

/** Смысловая группа формы. */
export interface OptionGroup {
	id: string;
	label: string;
}

/** Секция формы редактора. */
export interface EditorSection {
	/** Идентификатор секции (имя секции 2.x или путь команды 3.x) */
	id: string;
	/** Подпись секции */
	label: string;
	/** Путь секции в JSON-документе (например ['vrunner','test','xunit']) */
	jsonPath: string[];
	/** Это главная секция файла (default / vrunner) */
	isMain: boolean;
	/** Секцию стоит предлагать к добавлению (не экзотика) */
	advertised: boolean;
	/** Опции, применимые в секции */
	options: CatalogOption[];
}

interface V2Catalog {
	options: Record<string, Partial<CatalogOption>>;
	sections: { id: string; keys: string[] }[];
}

interface V3Catalog {
	sets: Record<string, Partial<CatalogOption>[]>;
	commands: { path: string; options: Partial<CatalogOption>[]; sets: string[] }[];
}

interface Overrides {
	groups: { id: string; label: string; keys: string[] }[];
	priority: string[];
	options: Record<string, Partial<CatalogOption>>;
	/** Секции 2.x, предлагаемые к добавлению в редакторе */
	v2Sections?: string[];
}

/** Группа «всё остальное» (сворачивается в форме). */
export const OTHER_GROUP: OptionGroup = { id: 'other', label: 'Прочее' };

/** Приоритетные секции 2.x (показываются первыми, в этом порядке). */
const V2_SECTION_ORDER = ['default', 'vanessa', 'xunit', 'syntax-check', 'run', 'designer', 'updatedb', 'init-dev', 'update-dev'];

function readJson<T>(extensionPath: string, fileName: string): T {
	const fullPath = path.join(extensionPath, 'resources', 'schemas', fileName);
	return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as T;
}

/** Ключ без CLI-префикса: под ним опция описана в overrides. */
function bareKey(key: string): string {
	return key.startsWith('--') ? key.slice(2) : key;
}

class CatalogContext {
	private readonly groupByKey = new Map<string, string>();
	private readonly orderByKey = new Map<string, number>();
	readonly groups: OptionGroup[];

	constructor(private readonly overrides: Overrides) {
		this.groups = overrides.groups.map(({ id, label }) => ({ id, label }));
		for (const group of overrides.groups) {
			for (const key of group.keys) {
				this.groupByKey.set(key, group.id);
			}
		}
		overrides.priority.forEach((key, index) => this.orderByKey.set(key, index));
	}

	/** Собирает опцию: данные каталога + кураторские уточнения + группа/порядок. */
	finalize(key: string, raw: Partial<CatalogOption>): CatalogOption {
		const clean = bareKey(key);
		const patch = this.overrides.options[clean] ?? {};
		return {
			key,
			type: patch.type ?? raw.type ?? 'string',
			description: raw.description ?? '',
			default: patch.default ?? raw.default,
			enum: patch.enum ?? raw.enum,
			enumLabels: patch.enumLabels,
			itemsEnum: patch.itemsEnum ?? raw.itemsEnum,
			group: this.groupByKey.get(clean) ?? OTHER_GROUP.id,
			order: this.orderByKey.get(clean) ?? Number.MAX_SAFE_INTEGER,
		};
	}
}

/** Сортировка опций: приоритетные выше, дальше по алфавиту. */
function byImportance(a: CatalogOption, b: CatalogOption): number {
	return a.order - b.order || a.key.localeCompare(b.key);
}

function buildV2Sections(catalog: V2Catalog, ctx: CatalogContext, advertisedSections: Set<string>): EditorSection[] {
	const ordered = [...catalog.sections].sort((a, b) => {
		const ai = V2_SECTION_ORDER.indexOf(a.id);
		const bi = V2_SECTION_ORDER.indexOf(b.id);
		if (ai !== -1 || bi !== -1) {
			return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
		}
		return a.id.localeCompare(b.id);
	});
	return ordered.map((section) => ({
		id: section.id,
		label: section.id === 'default' ? 'Общие параметры' : `Команда: ${section.id}`,
		jsonPath: [section.id],
		isMain: section.id === 'default',
		advertised: advertisedSections.has(section.id),
		options: section.keys
			.map((key) => ctx.finalize(key, catalog.options[key] ?? {}))
			.sort(byImportance),
	}));
}

function buildV3Sections(catalog: V3Catalog, ctx: CatalogContext): EditorSection[] {
	const commonByKey = new Map<string, CatalogOption>();
	for (const options of Object.values(catalog.sets)) {
		for (const option of options) {
			if (option.key && !commonByKey.has(option.key)) {
				commonByKey.set(option.key, ctx.finalize(option.key, option));
			}
		}
	}

	const sections: EditorSection[] = [
		{
			id: 'vrunner',
			label: 'Общие параметры',
			jsonPath: ['vrunner'],
			isMain: true,
			advertised: true,
			options: [...commonByKey.values()].sort(byImportance),
		},
	];

	for (const command of catalog.commands) {
		const byKey = new Map<string, CatalogOption>();
		for (const option of command.options) {
			if (option.key) {
				byKey.set(option.key, ctx.finalize(option.key, option));
			}
		}
		// опции наборов можно переопределять на уровне команды (каскад 3.x)
		for (const setName of command.sets) {
			for (const option of catalog.sets[setName] ?? []) {
				if (option.key && !byKey.has(option.key)) {
					byKey.set(option.key, ctx.finalize(option.key, option));
				}
			}
		}
		if (byKey.size === 0) {
			continue;
		}
		sections.push({
			id: `vrunner.${command.path}`,
			label: `Команда: ${command.path.replaceAll('.', ' ')}`,
			jsonPath: ['vrunner', ...command.path.split('.')],
			isMain: false,
			advertised: true,
			options: [...byKey.values()].sort(byImportance),
		});
	}
	return sections;
}

/**
 * Загружает секции формы редактора для схемы настроек.
 *
 * @param extensionPath - Корень установленного расширения (ресурсы)
 * @param schema - Схема файла настроек
 * @returns Секции формы и смысловые группы главной секции
 */
export function loadEditorSections(
	extensionPath: string,
	schema: SettingsSchema
): { sections: EditorSection[]; groups: OptionGroup[] } {
	const overrides = readJson<Overrides>(extensionPath, 'vrunner-options.overrides.json');
	const ctx = new CatalogContext(overrides);
	const sections =
		schema === 'v3'
			? buildV3Sections(readJson<V3Catalog>(extensionPath, 'vrunner-options.v3.json'), ctx)
			: buildV2Sections(
				readJson<V2Catalog>(extensionPath, 'vrunner-options.v2.json'),
				ctx,
				new Set(overrides.v2Sections ?? [])
			);
	return { sections, groups: [...ctx.groups, OTHER_GROUP] };
}
