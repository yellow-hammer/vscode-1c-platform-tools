/**
 * Пересобирает query-tables-ssl31.json: ответы cf-md-query-tables живого md-sparrow (lang ru) на
 * объектах демо-выгрузки БСП 3.1 разных видов. На них проверяется уровень «через точку» подсказки
 * (dcs-editor-field-types.js): дети по типу, вывод типов полей наборов-запросов и раскрытие полей
 * определяемого типа по составам ответа (typeCompositions). Фикстура
 * замораживает форму описания, которое webview получает сообщением describeType, поэтому руками
 * её не правят — только этим скриптом из свежей выгрузки и свежего jar.
 *
 * Запуск: node src/test/fixtures/dcs/query-tables-ssl31.mjs --jar <md-sparrow-*-all.jar>
 *   --cf <клон md-sparrow>/fixtures/ssl31/src/cf [--java <java>] [--work <папка для временных файлов>]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Объекты подобраны под тесты: источники запросов схем complete-models.json, типы их полей и
 * параметров, плюс по объекту на каждый вид таблиц (объяснение — в README рядом).
 */
const OBJECTS = [
	{ name: 'РегистрСведений.РезультатыПроверкиУчета', file: 'InformationRegisters/РезультатыПроверкиУчета.xml' },
	{ name: 'Справочник.ПравилаПроверкиУчета', file: 'Catalogs/ПравилаПроверкиУчета.xml' },
	{ name: 'Справочник.Пользователи', file: 'Catalogs/Пользователи.xml' },
	{ name: 'Справочник._ДемоОрганизации', file: 'Catalogs/_ДемоОрганизации.xml' },
	{ name: 'Перечисление.ВажностьПроблемыУчета', file: 'Enums/ВажностьПроблемыУчета.xml' },
	{ name: 'Документ._ДемоСчетНаОплатуПокупателю', file: 'Documents/_ДемоСчетНаОплатуПокупателю.xml' },
	{ name: 'ЖурналДокументов.Взаимодействия', file: 'DocumentJournals/Взаимодействия.xml' },
	{ name: 'РегистрСведений.СогласияНаОбработкуПерсональныхДанных', file: 'InformationRegisters/СогласияНаОбработкуПерсональныхДанных.xml' },
	{ name: 'РегистрНакопления._ДемоОстаткиТоваровВМестахХранения', file: 'AccumulationRegisters/_ДемоОстаткиТоваровВМестахХранения.xml' },
	{ name: 'РегистрБухгалтерии._ДемоЖурналПроводокБухгалтерскогоУчета', file: 'AccountingRegisters/_ДемоЖурналПроводокБухгалтерскогоУчета.xml' },
	{ name: 'ПланСчетов._ДемоОсновной', file: 'ChartsOfAccounts/_ДемоОсновной.xml' },
	{ name: 'ПланВидовХарактеристик.ДополнительныеРеквизитыИСведения', file: 'ChartsOfCharacteristicTypes/ДополнительныеРеквизитыИСведения.xml' },
	{ name: 'БизнесПроцесс.Задание', file: 'BusinessProcesses/Задание.xml' },
	{ name: 'Задача.ЗадачаИсполнителя', file: 'Tasks/ЗадачаИсполнителя.xml' },
	// Цель состава определяемого типа ФизическоеЛицо у Пользователей — раскрытие и связь по составу
	{ name: 'Справочник._ДемоФизическиеЛица', file: 'Catalogs/_ДемоФизическиеЛица.xml' },
	// Составы на границе предела раскрытия: КонтактВзаимодействия (6 ссылок) и ЗначениеДоступа (25)
	{ name: 'Документ.ЭлектронноеПисьмоВходящее', file: 'Documents/ЭлектронноеПисьмоВходящее.xml' },
	// Характеристика в табличной части справочника
	{ name: 'Справочник._ДемоКонтрагенты', file: 'Catalogs/_ДемоКонтрагенты.xml' },
	// Критерий отбора с параметром и последовательность с Границами
	{ name: 'КритерийОтбора.СвязанныеДокументы', file: 'FilterCriteria/СвязанныеДокументы.xml' },
	{ name: 'Последовательность._ДемоДвижениеТоваров', file: 'Sequences/_ДемоДвижениеТоваров.xml' },
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
const cf = path.resolve(option('--cf'));
const java = option('--java', 'java');
// Кириллица в путях и выводе: без этих флагов JVM на Windows читает и пишет в системной кодировке
const encoding = ['file', 'sun.jnu', 'stdout', 'stderr', 'sun.stdout', 'sun.stderr'].map(
	(key) => `-D${key}.encoding=UTF-8`
);
// jar берёт параметры только файлом: он кладётся во временную папку (--work — своя вместо системной)
const work = fs.mkdtempSync(path.join(option('--work', os.tmpdir()), 'dcs-query-tables-'));

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

const objects = {};
for (const object of OBJECTS) {
	const description = readJson({ op: 'cf-md-query-tables', objectXml: path.join(cf, object.file), schemaVersion: 'V2_20', lang: 'ru' });
	if (description.object !== object.name) {
		throw new Error(`${object.file}: ответ описывает ${description.object}, а не ${object.name}`);
	}
	objects[object.name] = { file: object.file, description };
}
// Коммит выгрузки — чтобы было видно, с какого её состояния снят срез
const head = spawnSync('git', ['-C', cf, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
// Хеш jar: все сборки md-sparrow одной версии носят одно имя, и по имени не понять, каким jar снят срез
const jarSha256 = createHash('sha256').update(fs.readFileSync(jar)).digest('hex');
const out = {
	source: 'yellow-hammer/ssl_3_1, fixtures/ssl31/src/cf',
	commit: head.status === 0 ? head.stdout.trim() : null,
	operation: 'cf-md-query-tables (lang ru)',
	jarSha256,
	objects,
};
fs.writeFileSync(path.join(HERE, 'query-tables-ssl31.json'), JSON.stringify(out, null, '\t') + '\n', 'utf8');
fs.rmSync(work, { recursive: true, force: true });
console.log(`query-tables-ssl31.json: ${Object.keys(objects).length} объектов, jar sha256 ${jarSha256}`);
