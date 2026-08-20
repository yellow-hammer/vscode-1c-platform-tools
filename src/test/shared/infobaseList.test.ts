import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	commonListPaths,
	infobaseConnectionString,
	parseInfobaseList,
	readInfobases,
	readPlatformText,
	startupDirectory,
} from '../../shared/infobaseList';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'infobases');

suite('Список информационных баз', () => {
	test('секция без Connect - это папка списка, а не база', () => {
		const entries = parseInfobaseList(readPlatformText(path.join(FIXTURES, 'ibases.v8i')) ?? '');

		assert.deepStrictEqual(
			entries.map((e) => e.name),
			['Демонстрационная', 'Рабочая', 'Песочница'],
			'«Демо» - папка, у неё нет строки подключения'
		);
	});

	test('порядок дерева читается из записи, без поля — ноль', () => {
		const entries = parseInfobaseList(readPlatformText(path.join(FIXTURES, 'ibases.v8i')) ?? '');
		const byName = new Map(entries.map((e) => [e.name, e]));

		assert.strictEqual(byName.get('Демонстрационная')?.orderInTree, 1792);
		assert.strictEqual(byName.get('Рабочая')?.orderInTree, 2048);
		assert.strictEqual(byName.get('Песочница')?.orderInTree, 0);
		assert.strictEqual(byName.get('Рабочая')?.orderInList, -1);
	});

	test('папка берётся из поля базы, а не из вложенности секций', () => {
		const entries = parseInfobaseList(readPlatformText(path.join(FIXTURES, 'ibases.v8i')) ?? '');
		const byName = new Map(entries.map((e) => [e.name, e]));

		assert.strictEqual(byName.get('Демонстрационная')?.folder, '/Демо');
		assert.strictEqual(byName.get('Рабочая')?.folder, '/');
	});

	test('папка без ведущего слэша приводится к виду платформы', () => {
		const [entry] = parseInfobaseList('[База]\nConnect=File="C:\\\\ib";\nFolder=Демо\n');

		assert.strictEqual(entry?.folder, '/Демо');
	});

	test('строка подключения собирается для файловой и серверной базы', () => {
		assert.strictEqual(infobaseConnectionString('File="C:\\bases\\demo";'), '/FC:\\bases\\demo');
		assert.strictEqual(infobaseConnectionString('Srvr="srv-1c:1541";Ref="erp";'), '/Ssrv-1c:1541\\erp');
	});

	test('неразобранная строка подключения не подставляется сырой', () => {
		assert.strictEqual(infobaseConnectionString('Srvr="srv";'), undefined, 'нет имени базы');
		assert.strictEqual(infobaseConnectionString('File="";'), undefined);
		assert.strictEqual(infobaseConnectionString('что-то своё'), undefined);
	});

	test('список читается в UTF-8 с BOM, настройки запуска рядом - в UTF-16', () => {
		assert.ok(readPlatformText(path.join(FIXTURES, 'ibases.v8i'))?.startsWith('[Демо]'), 'BOM снят');
		assert.ok(readPlatformText(path.join(FIXTURES, '1cestart.cfg'))?.includes('CommonInfoBases='));
	});

	test('общие списки берутся из настроек запуска', () => {
		const cfg = readPlatformText(path.join(FIXTURES, '1cestart.cfg')) ?? '';

		assert.deepStrictEqual(commonListPaths(cfg), ['common.v8i']);
	});

	test('база из общего списка добавляется, повтор отбрасывается', () => {
		const names = readInfobases(FIXTURES).map((e) => e.name);

		assert.deepStrictEqual(names, ['Демонстрационная', 'Рабочая', 'Песочница', 'Общая']);
	});

	test('нет файла - нет и баз, без исключения', () => {
		assert.deepStrictEqual(readInfobases(path.join(FIXTURES, 'нет-такого')), []);
	});

	test('каталог платформы зависит от системы', () => {
		assert.strictEqual(
			startupDirectory('linux', '/home/user'),
			path.join('/home/user', '.1C', '1cestart')
		);
		assert.strictEqual(
			startupDirectory('darwin', '/Users/user'),
			path.join('/Users/user', '.1C', '1cestart')
		);
		assert.ok(startupDirectory('win32', 'C:\\Users\\user').endsWith(path.join('1C', '1CEStart')));
	});
});
