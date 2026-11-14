/**
 * Пересобирает или сверяет legacy-value-lists.json: ответы живого md-sparrow на Template-legacy-lists.xml —
 * варианты списка значений параметра схемы старой записи (один элемент v8:ValueListType с представлениями),
 * формы платформы и соседних случаев. Снимок держит то, что нужно сверке правила редактора с предупреждением
 * valueListPresentationsLost строгой проверки: у каждого параметра — name, valueListAllowed и valueTyped из
 * cf-dcs-info, и вердикт cf-dcs-validate (strict) целиком. Руками снимок не правят — только этим скриптом.
 *
 * Запуск: node src/test/fixtures/dcs/legacy-value-lists.mjs --jar <md-sparrow-*-all.jar>
 *   [--java <java>] [--work <папка для временных файлов>] [--check]
 * С --check снимок не пишется, а сверяется с ответом jar: код 1 и расхождение в выводе, если они разные
 * (так его запускает dcsPlatformRules.node.ts при заданном MD_SPARROW_JAR). Хеш jar в снимке справочный:
 * другая сборка с тем же поведением сверку проходит.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = 'Template-legacy-lists.xml';
const SNAPSHOT = path.join(HERE, 'legacy-value-lists.json');

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	if (index >= 0 && process.argv[index + 1]) {
		return process.argv[index + 1];
	}
	if (fallback !== undefined) {
		return fallback;
	}
	throw new Error(`Не задан ${name}`);
}

const jar = option('--jar');
const java = option('--java', 'java');
const check = process.argv.includes('--check');
// Кириллица в путях и выводе: без этих флагов JVM на Windows читает и пишет в системной кодировке
const encoding = ['file', 'sun.jnu', 'stdout', 'stderr', 'sun.stdout', 'sun.stderr'].map(
	(key) => `-D${key}.encoding=UTF-8`
);
// jar берёт параметры только файлом; схема тоже копируется туда: фикстура остаётся нетронутой
const work = fs.mkdtempSync(path.join(option('--work', os.tmpdir()), 'dcs-legacy-lists-'));

function readJson(params) {
	const file = path.join(work, 'params.json');
	fs.writeFileSync(file, JSON.stringify(params), 'utf8');
	const result = spawnSync(java, [...encoding, '-jar', jar, 'read-json', '--params', file], {
		encoding: 'buffer',
		maxBuffer: 1 << 26,
	});
	if (result.status !== 0) {
		throw new Error(`${params.op}: ${result.stderr ? result.stderr.toString('utf8') : 'нет вывода'}`);
	}
	return JSON.parse(result.stdout.toString('utf8'));
}

/** Хеш текста фикстуры с переводами строк, сведёнными к LF: так же его считает тест, на любой рабочей копии. */
function templateSha256(text) {
	return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

let out;
try {
	const source = path.join(HERE, TEMPLATE);
	const objectXml = path.join(work, 'Template.xml');
	fs.copyFileSync(source, objectXml);
	const info = readJson({ op: 'cf-dcs-info', objectXml, schemaVersion: 'V2_20' });
	const validate = readJson({ op: 'cf-dcs-validate', objectXml, strict: true });
	const parameters = info.parameters.map((parameter) => {
		const row = { name: parameter.name };
		if (parameter.valueListAllowed !== undefined) {
			row.valueListAllowed = parameter.valueListAllowed;
		}
		if (parameter.valueTyped !== undefined) {
			row.valueTyped = parameter.valueTyped;
		}
		return row;
	});
	out = {
		about:
			'Ответы md-sparrow на Template-legacy-lists.xml: cf-dcs-info (name, valueListAllowed, valueTyped параметров) и cf-dcs-validate strict. Правило редактора (schemaListPresentedItems) обязано помечать ровно параметры предупреждений valueListPresentationsLost: тест dcsPlatformRules.node.ts сверяет это всегда, а с MD_SPARROW_JAR сверяет с живым jar и сам снимок. Пересобирается скриптом legacy-value-lists.mjs.',
		template: TEMPLATE,
		templateSha256: templateSha256(fs.readFileSync(source, 'utf8')),
		// Справочно: все сборки md-sparrow одной версии носят одно имя, и по имени не понять, каким jar снят снимок
		jarSha256: createHash('sha256').update(fs.readFileSync(jar)).digest('hex'),
		info: { parameters },
		validate,
	};
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}

if (!check) {
	fs.writeFileSync(SNAPSHOT, JSON.stringify(out, null, '\t') + '\n', 'utf8');
	console.log(`legacy-value-lists.json: параметров ${out.info.parameters.length}, предупреждений ${out.validate.warnings.length}, jar sha256 ${out.jarSha256}`);
} else {
	const saved = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
	const problems = [];
	for (const key of ['template', 'templateSha256', 'info', 'validate']) {
		if (!isDeepStrictEqual(saved[key], out[key])) {
			problems.push(`${key}:\n  снимок: ${JSON.stringify(saved[key])}\n  jar:    ${JSON.stringify(out[key])}`);
		}
	}
	if (problems.length > 0) {
		console.log(`legacy-value-lists.json расходится с jar ${out.jarSha256}:\n${problems.join('\n')}`);
		process.exit(1);
	}
	console.log(`legacy-value-lists.json совпадает с jar ${out.jarSha256}${saved.jarSha256 === out.jarSha256 ? '' : ` (снимок снят jar ${saved.jarSha256})`}`);
}
