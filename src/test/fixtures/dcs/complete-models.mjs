/**
 * Пересобирает complete-models.json: ответы cf-dcs-info (и настройки одного варианта) живого
 * md-sparrow на схемах демо-выгрузки БСП 3.1. Фикстура замораживает форму модели, которую видит
 * webview, поэтому руками её не правят — только этим скриптом из свежей выгрузки и свежего jar.
 *
 * Запуск: node src/test/fixtures/dcs/complete-models.mjs --jar <md-sparrow-*-all.jar>
 *   --cf <клон md-sparrow>/fixtures/ssl31/src/cf [--java <java>] [--work <папка для временных файлов>]
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Схемы подобраны по тому, что проверяет каталог подсказки; объяснение — в README рядом. */
const SCHEMAS = [
	{ name: 'РезультатыПроверкиУчета', template: 'Reports/РезультатыПроверкиУчета/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml' },
	{ name: 'ВыгрузкаЗагрузкаEnterpriseData', template: 'DataProcessors/ВыгрузкаЗагрузкаEnterpriseData/Templates/СхемаКомпоновкиДанных/Ext/Template.xml' },
	{ name: 'ДанныеПечатиОбщиеРеквизиты', template: 'CommonTemplates/ДанныеПечатиОбщиеРеквизиты/Ext/Template.xml' },
	{ name: 'ПользователиПоПодразделениям', template: 'Reports/ПользователиПоПодразделениям/Templates/Макет/Ext/Template.xml', variant: 'Основной' },
];

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
const cf = option('--cf');
const java = option('--java', 'java');
// Кириллица в путях и выводе: без этих флагов JVM на Windows читает и пишет в системной кодировке
const encoding = ['file', 'sun.jnu', 'stdout', 'stderr', 'sun.stdout', 'sun.stderr'].map(
	(key) => `-D${key}.encoding=UTF-8`
);
// jar берёт параметры только файлом: он кладётся во временную папку (--work — своя вместо системной)
const work = fs.mkdtempSync(path.join(option('--work', os.tmpdir()), 'dcs-complete-'));

function readJson(params) {
	const file = path.join(work, 'params.json');
	fs.writeFileSync(file, JSON.stringify(params), 'utf8');
	const result = spawnSync(java, [...encoding, '-jar', jar, 'read-json', '--params', file], {
		encoding: 'buffer',
		maxBuffer: 1 << 28,
	});
	if (result.status !== 0) {
		throw new Error(`${params.op}: ${result.stderr ? result.stderr.toString('utf8') : 'нет вывода'}`);
	}
	return JSON.parse(result.stdout.toString('utf8'));
}

const out = {};
for (const schema of SCHEMAS) {
	const objectXml = path.join(cf, schema.template);
	const entry = { template: schema.template };
	entry.info = readJson({ op: 'cf-dcs-info', objectXml, schemaVersion: 'V2_20' });
	if (schema.variant) {
		const settings = readJson({ op: 'cf-dcs-settings-info', objectXml, schemaVersion: 'V2_20', variant: schema.variant });
		entry.variant = schema.variant;
		entry.settings = settings.variants[0].settings;
	}
	out[schema.name] = entry;
}
fs.writeFileSync(path.join(HERE, 'complete-models.json'), JSON.stringify(out, null, '\t') + '\n', 'utf8');
fs.rmSync(work, { recursive: true, force: true });
console.log(`complete-models.json: ${Object.keys(out).length} схем`);
