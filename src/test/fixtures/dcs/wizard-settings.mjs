/**
 * Пересобирает wizard-settings.json: настройки вариантов (cf-dcs-settings-info живого md-sparrow) на
 * образцах демо-выгрузки БСП 3.1, по которым проверяется конструктор настроек
 * (dcs-editor-settings-wizard.js). Фикстура замораживает форму DTO варианта, которую видит webview,
 * поэтому руками её не правят — только этим скриптом из свежей выгрузки и свежего jar.
 *
 * Запуск: node src/test/fixtures/dcs/wizard-settings.mjs --jar <md-sparrow-*-all.jar>
 *   --cf <клон md-sparrow>/fixtures/ssl31/src/cf [--java <java>] [--work <папка для временных файлов>]
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Образцы подобраны по формам структуры, которые распознаёт мастер; объяснение — в README рядом. */
const SAMPLES = [
	{ key: 'список-детальные', template: 'DocumentJournals/Взаимодействия/Templates/ИерархияВзаимодействийКонтакт/Ext/Template.xml', variant: 'Основной' },
	{ key: 'список-цепочка', template: 'Reports/_ДемоОтчетПоСчетамНаОплатуГлобальный/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'Основной' },
	{ key: 'список-иерархия', template: 'Reports/_ДемоФайлы/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'Основной' },
	{ key: 'таблица', template: 'Reports/АналитическийОтчетПоАнкетированию/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'ПростыеВопросыКоличествоОтветовСравнениеПоОпросам' },
	{ key: 'таблица-под-группами', template: 'Reports/АналитическийОтчетПоАнкетированию/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'ПросмотрТабличныхВопросовТабличныйВид' },
	{ key: 'диаграмма-тип-в-корне', template: 'Reports/БизнесПроцессы/Templates/Макет/Ext/Template.xml', variant: 'СтатистикаПоВидам' },
	{ key: 'диаграмма-тип-в-узле', template: 'Reports/_ДемоСтатусыЗаказовПокупателей/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'Основной' },
	{ key: 'пустой-вариант', template: 'Reports/_ДемоФайлыВспомогательный/Templates/ПустаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'Основной' },
	// Те же варианты, что в Template-variants.xml: группа с двумя диаграммами и детальные записи
	{ key: 'группа-с-диаграммами', template: 'Reports/_ДемоДинамикаИзмененийФайлов/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'Основной' },
	{ key: 'детальные-с-отбором-корня', template: 'Reports/_ДемоДинамикаИзмененийФайлов/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'Дополнительный1' },
	{ key: 'группа-с-отбором', template: 'Reports/ПользователиПоПодразделениям/Templates/Макет/Ext/Template.xml', variant: 'Основной' },
	// Параметр вывода у вложенной группы строки таблицы (РасположениеОбщихИтогов): граница уровней, где платформа
	// параметры не хранит (dcsPlatformRules.node.ts)
	{ key: 'таблица-итоги-у-группы-строки', template: 'Reports/РезультатыПроверкиУчета/Templates/ОсновнаяСхемаКомпоновкиДанных/Ext/Template.xml', variant: 'Основной' },
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
const work = fs.mkdtempSync(path.join(option('--work', os.tmpdir()), 'dcs-wizard-'));

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
for (const sample of SAMPLES) {
	const objectXml = path.join(cf, sample.template);
	const answer = readJson({ op: 'cf-dcs-settings-info', objectXml, schemaVersion: 'V2_20', variant: sample.variant });
	out[sample.key] = { template: sample.template, variant: sample.variant, settings: answer.variants[0].settings };
}
fs.writeFileSync(path.join(HERE, 'wizard-settings.json'), JSON.stringify(out, null, '\t') + '\n', 'utf8');
fs.rmSync(work, { recursive: true, force: true });
console.log(`wizard-settings.json: ${Object.keys(out).length} вариантов`);
