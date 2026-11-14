/**
 * Пересобирает queries-ssl31.json: все тексты запросов наборов данных (<query>) из схем компоновки
 * демо-выгрузки БСП 3.1, включая запросы внутри объединений. На этом корпусе проверяется модель
 * запроса конструктора (dcs-editor-query-model.js): круг канона, сплайс и мутации. Руками файл не
 * правится — только этим скриптом из свежей выгрузки.
 *
 * Текст берётся так, как его видит XML-парсер (и вслед за ним cf-dcs-info, а значит webview):
 * сущности раскодированы, переводы строк CRLF файла сведены к LF. Отсюда скрипту не нужен jar —
 * XML читается напрямую, а нормализация повторяет правило спецификации XML.
 *
 * Запуск: node src/test/fixtures/dcs/queries-ssl31.mjs --src <клон md-sparrow>/fixtures/ssl31/src
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
 * Запросы схемы с путями наборов. Набор — элемент `dataSet` или `item` с типом `DataSet…` внутри
 * набора (дочерние наборы объединения); путь `Объединение/Дочерний` — та же адресация, что у
 * cf-dcs-set-query. Наборы вложенных схем (`nestedSchema`) операция не адресует,
 * поэтому имя вложенной схемы идёт отдельным ключом. Имя и запрос берутся только у прямых потомков
 * набора: у полей и параметров есть свои `<name>`.
 */
function queriesOf(xml) {
	const out = [];
	const stack = [];
	const frames = [];
	const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g;
	const pathOf = (kind) =>
		frames
			.filter((frame) => frame.kind === kind)
			.map((frame) => frame.name)
			.join('/');
	let match;
	while ((match = tag.exec(xml))) {
		if (!match[2]) {
			continue;
		}
		const [, closing, name, attributes, selfClosing] = match;
		if (closing) {
			stack.pop();
			if (frames.length && frames[frames.length - 1].depth === stack.length) {
				frames.pop();
			}
			continue;
		}
		const parent = frames.length ? frames[frames.length - 1] : null;
		const direct = parent && parent.depth === stack.length - 1;
		if (direct && (name === 'name' || name === 'query') && !selfClosing) {
			const end = xml.indexOf(`</${name}>`, tag.lastIndex);
			const value = textValue(xml.slice(tag.lastIndex, end));
			if (name === 'name' && parent.name === null) {
				parent.name = value;
			} else if (name === 'query' && parent.kind === 'dataSet') {
				out.push({ nestedSchema: pathOf('nestedSchema'), dataSet: pathOf('dataSet'), text: value });
			}
			tag.lastIndex = end + name.length + 3;
			continue;
		}
		if (direct && name === 'query' && selfClosing && parent.kind === 'dataSet') {
			out.push({ nestedSchema: pathOf('nestedSchema'), dataSet: pathOf('dataSet'), text: '' });
			continue;
		}
		if (selfClosing) {
			continue;
		}
		stack.push(name);
		const unionChild = name === 'item' && parent && parent.kind === 'dataSet' && /xsi:type="DataSet\w*"/.test(attributes);
		if (name === 'dataSet' || unionChild) {
			frames.push({ kind: 'dataSet', depth: stack.length - 1, name: null });
		} else if (name === 'nestedSchema') {
			frames.push({ kind: 'nestedSchema', depth: stack.length - 1, name: null });
		}
	}
	return out;
}

const queries = [];
for (const file of templates(src)) {
	const xml = fs.readFileSync(file, 'utf8');
	if (!xml.includes('<DataCompositionSchema')) {
		continue;
	}
	const relative = path.relative(src, file).split(path.sep).join('/');
	for (const query of queriesOf(xml)) {
		const entry = { file: relative, dataSet: query.dataSet };
		if (query.nestedSchema) {
			entry.nestedSchema = query.nestedSchema;
		}
		entry.text = query.text;
		queries.push(entry);
	}
}

// Коммит выгрузки — чтобы по фикстуре было видно, из какого среза она снята
const head = spawnSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const fixture = {
	source: 'yellow-hammer/ssl_3_1, fixtures/ssl31/src',
	commit: head.status === 0 ? head.stdout.trim() : null,
	eol: 'LF (значение XML: CRLF файла сведены к LF)',
	queries,
};
fs.writeFileSync(path.join(HERE, 'queries-ssl31.json'), JSON.stringify(fixture, null, '\t') + '\n', 'utf8');
console.log(`queries-ssl31.json: ${queries.length} запросов`);
