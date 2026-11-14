/**
 * Пересобирает format-strings-ssl31.json: все форматные строки схем компоновки демо-выгрузки БСП 3.1.
 * На этом корпусе проверяется разбор и сборка форматной строки (dcs-editor-format.js): круг
 * parse → build обязан вернуть каждую строку байт в байт, иначе окно форматной строки испортит
 * значение, которое пользователь даже не трогал. Руками файл не правится — только этим скриптом из
 * свежей выгрузки.
 *
 * Что считается форматной строкой:
 * - значение параметра оформления «Формат» и «ФорматРедактирования» (английские имена Format и
 *   EditFormat — на случай английской выгрузки) — где бы он ни стоял: условное оформление
 *   вариантов, оформление полей наборов, вычисляемых полей, ресурсов и макетов. Тип значения
 *   сохраняется в записи (`xs:string` или `v8:LocalStringType`), потому что окно обязано писать в
 *   тип имеющегося значения; у `v8:LocalStringType` каждая языковая строка — отдельная запись;
 * - строковый литерал второго аргумента вызова Формат()/Format() в выражениях схемы (элементы,
 *   имя которых кончается на `xpression`: выражения вычисляемых полей, ресурсов, макетов,
 *   представления и упорядочивания). Тексты запросов не смотрятся: в языке запросов функции Формат
 *   нет. Если второй аргумент не литерал, в списке стоит null — так видно, что вызов найден.
 *
 * Значения записаны так, как их видит XML-парсер (и вслед за ним cf-dcs-info, а значит webview):
 * сущности раскодированы, CRLF файла сведены к LF; у литерала выражения снято удвоение кавычек.
 * Для выражения записан и сам текст: по нему видно, из какого вызова взят литерал.
 *
 * Запуск: node src/test/fixtures/dcs/format-strings-ssl31.mjs --src <клон md-sparrow>/fixtures/ssl31/src
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function option(name) {
	const index = process.argv.indexOf(name);
	if (index >= 0 && process.argv[index + 1]) {
		return process.argv[index + 1];
	}
	throw new Error(`Не задан ${name}`);
}

const src = path.resolve(option('--src'));

/** Параметры оформления, значение которых — форматная строка. */
const FORMAT_PARAMETERS = new Set(['Формат', 'ФорматРедактирования', 'Format', 'EditFormat']);

/** Имя функции форматирования в выражениях схемы (регистр в языке выражений не важен). */
const FORMAT_FUNCTION = /^(?:формат|format)$/i;

/** Обход с сортировкой имён: порядок readdir зависит от ОС, а фикстура должна быть детерминированной. */
function templates(dir, acc = []) {
	const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			templates(full, acc);
		} else if (entry.name === 'Template.xml') {
			acc.push(full);
		}
	}
	return acc;
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Значение текстового узла по правилам XML: CRLF и одиночный CR — в LF, затем сущности. */
function textValue(raw) {
	return raw
		.replace(/\r\n?/g, '\n')
		.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (match, entity) => {
			if (ENTITIES[entity] !== undefined) {
				return ENTITIES[entity];
			}
			return String.fromCodePoint(entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
		});
}

/**
 * Дерево элементов без пространств имён: схеме компоновки хватает локальных имён, а префиксы
 * (`dcscor:`, `dcsset:`, `dcsat:`) у одного и того же элемента в разных местах схемы разные.
 */
function parseXml(xml) {
	const root = { name: '#root', attrs: {}, children: [], text: '' };
	const stack = [root];
	const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
	let last = 0;
	let match;
	while ((match = tag.exec(xml))) {
		const top = stack[stack.length - 1];
		top.text += textValue(xml.slice(last, match.index));
		last = tag.lastIndex;
		if (match[1] !== undefined) {
			top.text += match[1].replace(/\r\n?/g, '\n');
			continue;
		}
		if (!match[3]) {
			continue;
		}
		const [, , closing, qname, attributes, selfClosing] = match;
		if (closing) {
			stack.pop();
			continue;
		}
		const attrs = {};
		for (const attr of attributes.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
			attrs[attr[1]] = textValue(attr[2] ?? attr[3]);
		}
		const element = { name: qname.slice(qname.indexOf(':') + 1), attrs, children: [], text: '', parent: top };
		top.children.push(element);
		if (!selfClosing) {
			stack.push(element);
		}
	}
	return root;
}

const child = (element, name) => element.children.find((item) => item.name === name);

/** Подпись элемента в пути: имя элемента и, если есть, его собственное имя (`name`, `dataPath`, `field`). */
function label(element) {
	const own = child(element, 'name') || child(element, 'dataPath') || child(element, 'field');
	return own && !own.children.length && own.text ? `${element.name}[${own.text}]` : element.name;
}

/** Путь элемента от корня схемы: по нему в фикстуре видно, чьё это оформление или выражение. */
function whereOf(element) {
	const parts = [];
	for (let node = element; node && node.name !== '#root'; node = node.parent) {
		parts.unshift(label(node));
	}
	return parts.join('/');
}

function walk(element, visit) {
	visit(element);
	for (const item of element.children) {
		walk(item, visit);
	}
}

/**
 * Вызовы Формат() в тексте выражения: лексер языка выражений (строки в двойных кавычках с
 * удвоением, комментарии `//`), затем разбор аргументов по скобкам верхнего уровня. Возвращает
 * значения литералов второго аргумента в порядке вызовов; не литерал — null.
 */
function formatCalls(text) {
	const tokens = [];
	const word = /[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*/y;
	for (let i = 0; i < text.length; ) {
		const ch = text[i];
		if (ch === '"') {
			let j = i + 1;
			let value = '';
			for (;;) {
				if (j >= text.length) {
					break;
				}
				if (text[j] === '"') {
					if (text[j + 1] === '"') {
						value += '"';
						j += 2;
						continue;
					}
					j += 1;
					break;
				}
				value += text[j];
				j += 1;
			}
			tokens.push({ kind: 'string', value });
			i = j;
			continue;
		}
		if (ch === '/' && text[i + 1] === '/') {
			const end = text.indexOf('\n', i);
			i = end < 0 ? text.length : end;
			continue;
		}
		if (/\s/.test(ch)) {
			i += 1;
			continue;
		}
		word.lastIndex = i;
		const found = word.exec(text);
		if (found) {
			tokens.push({ kind: 'word', value: found[0] });
			i += found[0].length;
			continue;
		}
		tokens.push({ kind: 'punct', value: ch });
		i += 1;
	}
	const out = [];
	for (let k = 0; k < tokens.length; k += 1) {
		const token = tokens[k];
		const prev = tokens[k - 1];
		if (token.kind !== 'word' || !FORMAT_FUNCTION.test(token.value) || tokens[k + 1]?.value !== '(' || prev?.value === '.') {
			continue;
		}
		// Аргументы вызова: запятые на глубине 1, до закрывающей скобки вызова
		let depth = 0;
		const args = [[]];
		for (let m = k + 1; m < tokens.length; m += 1) {
			const t = tokens[m];
			if (t.kind === 'punct' && t.value === '(') {
				depth += 1;
				if (depth === 1) {
					continue;
				}
			} else if (t.kind === 'punct' && t.value === ')') {
				depth -= 1;
				if (depth === 0) {
					break;
				}
			} else if (t.kind === 'punct' && t.value === ',' && depth === 1) {
				args.push([]);
				continue;
			}
			args[args.length - 1].push(t);
		}
		const second = args[1];
		out.push(second && second.length === 1 && second[0].kind === 'string' ? second[0].value : null);
	}
	return out;
}

const parameters = [];
const calls = [];
const strays = [];
for (const file of templates(src)) {
	const xml = fs.readFileSync(file, 'utf8');
	if (!xml.includes('<DataCompositionSchema')) {
		continue;
	}
	const relative = path.relative(src, file).split(path.sep).join('/');
	walk(parseXml(xml), (element) => {
		if (element.name === 'parameter' && !element.children.length && FORMAT_PARAMETERS.has(element.text)) {
			const siblings = element.parent.children;
			const value = siblings.slice(siblings.indexOf(element) + 1).find((item) => item.name === 'value');
			if (!value) {
				return;
			}
			const type = value.attrs['xsi:type'] ?? null;
			const base = { file: relative, where: whereOf(element.parent), parameter: element.text, type };
			if (type === 'v8:LocalStringType') {
				for (const item of value.children.filter((node) => node.name === 'item')) {
					parameters.push({ ...base, lang: child(item, 'lang')?.text ?? '', text: child(item, 'content')?.text ?? '' });
				}
			} else if (type === 'xs:string') {
				parameters.push({ ...base, text: value.text });
			} else {
				strays.push(`${relative}: ${base.where}: значение «${element.text}» типа ${type}`);
			}
			return;
		}
		if (element.children.length || !/(?:формат|format)\s*\(/i.test(element.text)) {
			return;
		}
		if (/xpression$/.test(element.name)) {
			calls.push({ file: relative, where: whereOf(element), expression: element.text, formats: formatCalls(element.text) });
		} else if (element.name !== 'query') {
			// Не выражение и не запрос (заголовки, тексты): в фикстуру не идёт, но видно в выводе
			strays.push(`${relative}: ${whereOf(element)}: «Формат(» вне выражения`);
		}
	});
}

const all = [...parameters.map((entry) => entry.text), ...calls.flatMap((entry) => entry.formats.filter((text) => text !== null))];

// Коммит выгрузки — чтобы по фикстуре было видно, из какого среза она снята
const head = spawnSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const fixture = {
	source: 'yellow-hammer/ssl_3_1, fixtures/ssl31/src',
	commit: head.status === 0 ? head.stdout.trim() : null,
	eol: 'LF (значение XML: CRLF файла сведены к LF)',
	total: all.length,
	distinct: new Set(all).size,
	parameters,
	calls,
};
fs.writeFileSync(path.join(HERE, 'format-strings-ssl31.json'), JSON.stringify(fixture, null, '\t') + '\n', 'utf8');
console.log(
	`format-strings-ssl31.json: ${parameters.length} значений параметров, ${calls.length} выражений с Формат(), ` +
		`всего строк ${all.length}, различных ${fixture.distinct}`
);
for (const line of strays) {
	console.log(`пропущено: ${line}`);
}
