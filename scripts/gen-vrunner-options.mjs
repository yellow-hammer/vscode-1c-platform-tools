/**
 * Генерирует каталоги опций vanessa-runner для редактора профиля запуска.
 *
 * Источники:
 * - 2.x: официальная vanessa-runner-schema.json (ветка release/2.6) —
 *   типы, русские описания, enum и значения по умолчанию;
 * - 3.x: исходники vanessa-runner 3 — аннотации `&Опция(Имя = ..., Описание = ...)`
 *   в src/cli (пер-командные) и src/cli/НаборыОпций (общие наборы),
 *   ДОПОЛНЕННЫЕ описаниями из таблиц документации (docs/product/команды) и
 *   метаданными одноимённых опций 2.x (enum, значения по умолчанию).
 *
 * Результат кладётся в resources/schemas/vrunner-options.v2.json и
 * vrunner-options.v3.json и коммитится в репозиторий: редактор работает
 * офлайн, а обновление каталога — осознанный запуск этого скрипта
 * (задача VS Code «Обновить каталоги опций vrunner»).
 *
 * Использование:
 *   node scripts/gen-vrunner-options.mjs --v3-ref v3.0.0_rc8   # скачать тег с GitHub
 *   node scripts/gen-vrunner-options.mjs --v3-src <путь>       # локальный клон
 *   (без --v3-ref/--v3-src обновляется только каталог 2.x)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import extract from 'extract-zip';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, 'resources', 'schemas');
const V2_SCHEMA_URL =
	'https://raw.githubusercontent.com/vanessa-opensource/vanessa-runner/refs/heads/release/2.6/vanessa-runner-schema.json';

/** Секции 2.x, не имеющие смысла в env.json (справка и т.п.) */
const V2_SKIP_SECTIONS = new Set(['help', '--help', 'version']);

/** Опция без содержательного описания (для выбора лучшего источника). */
function isEmptyDescription(description) {
	return !description || description.trim().length < 3;
}

async function generateV2() {
	const response = await fetch(V2_SCHEMA_URL);
	if (!response.ok) {
		throw new Error(`Не удалось скачать схему 2.x: HTTP ${response.status}`);
	}
	const schema = await response.json();

	/** Общая таблица опций: key -> описание/тип; секции ссылаются по ключам */
	const options = {};
	const sections = [];
	for (const [sectionId, sectionSchema] of Object.entries(schema.properties ?? {})) {
		if (V2_SKIP_SECTIONS.has(sectionId)) {
			continue;
		}
		const props = sectionSchema?.properties ?? {};
		const keys = [];
		for (const [key, optionSchema] of Object.entries(props)) {
			keys.push(key);
			const known = options[key];
			// одна и та же опция объявлена во многих секциях, часть объявлений
			// пустые — берём первое содержательное
			if (known && !isEmptyDescription(known.description)) {
				continue;
			}
			const entry = {
				type: optionSchema.type ?? known?.type ?? 'string',
				description: isEmptyDescription(optionSchema.description)
					? known?.description ?? ''
					: optionSchema.description,
			};
			const defaultValue = optionSchema.default ?? known?.default;
			if (defaultValue !== undefined) {
				entry.default = defaultValue;
			}
			const enumValues = optionSchema.enum ?? known?.enum;
			if (Array.isArray(enumValues)) {
				entry.enum = enumValues;
			}
			const itemsEnum = optionSchema.items?.enum ?? known?.itemsEnum;
			if (Array.isArray(itemsEnum)) {
				entry.itemsEnum = itemsEnum;
			}
			options[key] = entry;
		}
		sections.push({ id: sectionId, keys });
	}

	const catalog = {
		schema: 'v2',
		source: V2_SCHEMA_URL,
		generatedAt: new Date().toISOString().slice(0, 10),
		options,
		sections,
	};
	fs.writeFileSync(
		path.join(OUT_DIR, 'vrunner-options.v2.json'),
		`${JSON.stringify(catalog, null, '\t')}\n`,
		'utf8'
	);
	console.log(`v2: ${Object.keys(options).length} опций, ${sections.length} секций`);
	return options;
}

/**
 * Находит закрывающую скобку вызова аннотации с учётом строковых литералов
 * (внутри "..." скобки не считаются; "" — экранированная кавычка).
 *
 * @returns Индекс после закрывающей скобки или -1
 */
function scanAnnotationEnd(text, openIndex) {
	let depth = 0;
	let inString = false;
	for (let i = openIndex; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					i++;
				} else {
					inString = false;
				}
			}
			continue;
		}
		if (char === '"') {
			inString = true;
		} else if (char === '(') {
			depth++;
		} else if (char === ')') {
			depth--;
			if (depth === 0) {
				return i + 1;
			}
		}
	}
	return -1;
}

/** Извлекает строковое значение именованного аргумента аннотации. */
function annotationArg(argsText, name) {
	const re = new RegExp(`${name}\\s*=\\s*"((?:[^"]|"")*)"`);
	return argsText.match(re)?.[1]?.replaceAll('""', '"');
}

/** Разбирает аннотации &Опция из текста модуля OneScript. */
function parseOptions(text) {
	const result = [];
	let searchFrom = 0;
	for (;;) {
		const at = text.indexOf('&Опция(', searchFrom);
		if (at === -1) {
			break;
		}
		const end = scanAnnotationEnd(text, at + '&Опция'.length);
		if (end === -1) {
			break;
		}
		searchFrom = end;
		const argsText = text.slice(at + '&Опция('.length, end - 1);
		const name = annotationArg(argsText, 'Имя');
		if (!name) {
			continue;
		}
		// тип задаётся аннотацией между &Опция и объявлением переменной
		const permAt = text.indexOf('Перем ', end);
		const between = permAt === -1 ? '' : text.slice(end, permAt);
		let type = 'boolean';
		if (/&ТМассивСтрок/.test(between)) {
			type = 'array';
		} else if (/&ТЧисло/.test(between)) {
			type = 'number';
		} else if (/&ТСтрока/.test(between)) {
			type = 'string';
		}
		result.push({
			// имя может содержать алиасы через пробел ("recursive R") — берём первое
			key: name.split(/\s+/)[0],
			type,
			description: annotationArg(argsText, 'Описание') ?? '',
		});
	}
	return result;
}

/**
 * Собирает описания опций из таблиц документации 3.x
 * (строки вида `| \`--opt\` | \`VRUNNER_X\` | Описание |`).
 *
 * @returns Map ключ (без --) -> описание
 */
function parseDocsDescriptions(docsDir) {
	const byKey = new Map();
	if (!fs.existsSync(docsDir)) {
		return byKey;
	}
	for (const file of fs.readdirSync(docsDir)) {
		if (!file.endsWith('.md')) {
			continue;
		}
		const text = fs.readFileSync(path.join(docsDir, file), 'utf8');
		for (const line of text.split('\n')) {
			if (!line.startsWith('|')) {
				continue;
			}
			const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
			if (cells.length < 2) {
				continue;
			}
			const keyMatch = cells[0].match(/`--([A-Za-z0-9-]+)`/);
			if (!keyMatch) {
				continue;
			}
			const description = cells[cells.length - 1]
				.replaceAll('`', '')
				.replaceAll('**', '')
				.trim();
			const key = keyMatch[1];
			if (!byKey.has(key) && !isEmptyDescription(description) && !/^Переменная|^Описание$/.test(description)) {
				byKey.set(key, description);
			}
		}
	}
	return byKey;
}

/** Имя команды из имени файла подкоманды: ПодкомандаCfeLoad → cfe.load */
function commandPathFromFileName(fileName) {
	const base = fileName.replace(/^Подкоманда/, '').replace(/\.os$/, '');
	const parts = base.match(/[A-ZА-ЯЁ][a-zа-яё0-9]*/g) ?? [base];
	if (parts.length === 0) {
		return base.toLowerCase();
	}
	const group = parts[0].toLowerCase();
	const sub = parts.slice(1).join('-').toLowerCase();
	return sub ? `${group}.${sub}` : group;
}

function walk(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walk(full));
		} else if (entry.name.endsWith('.os')) {
			out.push(full);
		}
	}
	return out;
}

function generateV3(srcRoot, v2Options) {
	const cliDir = path.join(srcRoot, 'src', 'cli');
	if (!fs.existsSync(cliDir)) {
		throw new Error(`Не найден каталог src/cli в ${srcRoot}`);
	}
	const docsDescriptions = parseDocsDescriptions(path.join(srcRoot, 'docs', 'product', 'команды'));

	/** Дополняет опцию описаниями/метаданными из доков 3.x и схемы 2.x. */
	const enrich = (option) => {
		if (isEmptyDescription(option.description)) {
			option.description = docsDescriptions.get(option.key) ?? '';
		}
		const v2 = v2Options?.[`--${option.key}`];
		if (v2) {
			if (isEmptyDescription(option.description) && !isEmptyDescription(v2.description)) {
				option.description = v2.description;
			}
			if (option.enum === undefined && Array.isArray(v2.enum)) {
				option.enum = v2.enum;
			}
			if (option.default === undefined && v2.default !== undefined) {
				option.default = v2.default;
			}
		}
		return option;
	};

	const sets = {};
	const setsDir = path.join(cliDir, 'НаборыОпций');
	for (const file of fs.readdirSync(setsDir)) {
		if (!file.endsWith('.os')) {
			continue;
		}
		const setName = file.replace(/\.os$/, '');
		sets[setName] = parseOptions(fs.readFileSync(path.join(setsDir, file), 'utf8')).map(enrich);
	}

	const commands = [];
	for (const file of walk(cliDir)) {
		const fileName = path.basename(file);
		if (!fileName.startsWith('Подкоманда')) {
			continue;
		}
		const text = fs.readFileSync(file, 'utf8');
		const usedSets = [...text.matchAll(/&НаборОпций\("([^"]+)"\)/g)].map((m) => m[1]);
		commands.push({
			path: commandPathFromFileName(fileName),
			options: parseOptions(text).map(enrich),
			sets: usedSets,
		});
	}
	commands.sort((a, b) => a.path.localeCompare(b.path));

	const version = readV3Version(srcRoot);
	const catalog = {
		schema: 'v3',
		source: `vanessa-runner ${version} (src/cli + docs/product/команды + схема 2.x)`,
		generatedAt: new Date().toISOString().slice(0, 10),
		sets,
		commands,
	};
	fs.writeFileSync(
		path.join(OUT_DIR, 'vrunner-options.v3.json'),
		`${JSON.stringify(catalog, null, '\t')}\n`,
		'utf8'
	);
	const allOptions = [
		...Object.values(sets).flat(),
		...commands.flatMap((command) => command.options),
	];
	const withoutDescription = allOptions.filter((option) => isEmptyDescription(option.description));
	console.log(`v3: ${allOptions.length} опций, ${Object.keys(sets).length} наборов, ${commands.length} команд (${version})`);
	if (withoutDescription.length > 0) {
		console.log(`v3: без описания ${withoutDescription.length}: ${[...new Set(withoutDescription.map((o) => o.key))].join(', ')}`);
	}
}

function readV3Version(srcRoot) {
	try {
		const packagedef = fs.readFileSync(path.join(srcRoot, 'packagedef'), 'utf8');
		return packagedef.match(/Версия\("([^"]+)"\)/)?.[1] ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

/** Скачивает zipball тега vanessa-runner и возвращает путь к распакованным исходникам. */
async function downloadV3Sources(ref) {
	const url = `https://codeload.github.com/vanessa-opensource/vanessa-runner/zip/refs/tags/${ref}`;
	console.log(`v3: скачиваю ${url}`);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Не удалось скачать исходники ${ref}: HTTP ${response.status}`);
	}
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrunner-src-'));
	const zipPath = path.join(tempDir, 'src.zip');
	fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
	await extract(zipPath, { dir: tempDir });
	const rootEntry = fs
		.readdirSync(tempDir, { withFileTypes: true })
		.find((entry) => entry.isDirectory());
	if (!rootEntry) {
		throw new Error('В архиве исходников не найден корневой каталог');
	}
	return path.join(tempDir, rootEntry.name);
}

function argValue(name) {
	const index = process.argv.indexOf(name);
	return index !== -1 ? process.argv[index + 1] : undefined;
}

const v2Options = await generateV2();
const v3Src = argValue('--v3-src');
const v3Ref = argValue('--v3-ref');
if (v3Src) {
	generateV3(path.resolve(v3Src), v2Options);
} else if (v3Ref) {
	generateV3(await downloadV3Sources(v3Ref), v2Options);
} else {
	console.log('v3: пропущен (укажите --v3-ref <тег> или --v3-src <путь к клону>)');
}
