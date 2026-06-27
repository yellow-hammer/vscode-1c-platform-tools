import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	directoryNodeId,
	directoryNodeFsPath,
	dedupedCaseId,
	directorySortKey,
	fileSortKey,
	caseSortKey
} from '../../features/testing/treeLayout';

suite('treeLayout', () => {
	test('directoryNodeId стабилен и зависит от пути сегментов', () => {
		assert.strictEqual(directoryNodeId('vanessa', ['init']), 'vanessa|dir|init');
		assert.strictEqual(
			directoryNodeId('vanessa', ['Подсистема', 'Объект']),
			'vanessa|dir|Подсистема/Объект'
		);
	});

	test('directoryNodeFsPath: один уровень — каталог файла', () => {
		const file = path.join('C:', 'proj', 'features', 'init', 'Файл.feature');
		// segments=['init'], index 0 (он же последний) → каталог файла
		assert.strictEqual(
			directoryNodeFsPath(file, 1, 0),
			path.join('C:', 'proj', 'features', 'init')
		);
	});

	test('directoryNodeFsPath: два уровня — верхний и нижний каталоги', () => {
		const file = path.join('C:', 'proj', 'features', 'Подсистема', 'Объект', 'Ф.feature');
		// segments=['Подсистема','Объект']
		assert.strictEqual(
			directoryNodeFsPath(file, 2, 0),
			path.join('C:', 'proj', 'features', 'Подсистема'),
			'Верхний сегмент'
		);
		assert.strictEqual(
			directoryNodeFsPath(file, 2, 1),
			path.join('C:', 'proj', 'features', 'Подсистема', 'Объект'),
			'Нижний сегмент = каталог файла'
		);
	});

	test('directoryNodeFsPath: работает с unix-разделителями во входе', () => {
		const file = 'C:/proj/tests/Core/Тест.os';
		assert.ok(directoryNodeFsPath(file, 1, 0).endsWith(path.join('tests', 'Core')));
	});

	test('dedupedCaseId: уникальные имена остаются как есть', () => {
		const seen = new Set<string>();
		assert.strictEqual(dedupedCaseId('vanessa|uri#А', 5, seen), 'vanessa|uri#А');
		assert.strictEqual(dedupedCaseId('vanessa|uri#Б', 8, seen), 'vanessa|uri#Б');
	});

	test('dedupedCaseId: дубль имени разводится номером строки', () => {
		const seen = new Set<string>();
		const first = dedupedCaseId('vanessa|uri#Сценарий', 10, seen);
		const second = dedupedCaseId('vanessa|uri#Сценарий', 20, seen);
		assert.strictEqual(first, 'vanessa|uri#Сценарий');
		assert.strictEqual(second, 'vanessa|uri#Сценарий@20');
		assert.notStrictEqual(first, second);
	});

	test('directorySortKey: каждый сегмент кодируется типом каталога', () => {
		assert.strictEqual(directorySortKey(['fixtures']), '0fixtures');
		assert.strictEqual(directorySortKey(['Подсистема', 'Объект']), '0Подсистема/0Объект');
	});

	test('fileSortKey: предки — каталоги (0), сам файл — файл (1)', () => {
		assert.strictEqual(fileSortKey([], '01_Const.feature'), '101_Const.feature');
		assert.strictEqual(
			fileSortKey(['fixtures'], '01_Const.feature'),
			'0fixtures/101_Const.feature'
		);
	});

	test('caseSortKey: ключ файла как префикс держит кейс под файлом', () => {
		const fileKey = fileSortKey(['fixtures'], '01_Const.feature');
		assert.strictEqual(caseSortKey(fileKey, '000016'), '0fixtures/101_Const.feature/000016');
		// Файл сортируется ровно перед своими кейсами (его ключ — их префикс)
		assert.ok(caseSortKey(fileKey, '000016').startsWith(fileKey));
	});

	test('числовые префиксы файлов сохраняют порядок запуска, а не алфавит', () => {
		const keys = [
			fileSortKey(['fixtures'], '10_Chrt_ВидыСубконто.feature'),
			fileSortKey(['fixtures'], '02_Code_ЗагрузкаВалют.feature'),
			fileSortKey(['fixtures'], '01_Const_Константы.feature')
		].sort();
		assert.deepStrictEqual(keys, [
			'0fixtures/101_Const_Константы.feature',
			'0fixtures/102_Code_ЗагрузкаВалют.feature',
			'0fixtures/110_Chrt_ВидыСубконто.feature'
		]);
	});

	test('плоская сортировка повторяет обход дерева в глубину', () => {
		// Срез раскладки lukoil-erp: каталоги Libraries и fixtures плюс файл в корне.
		// Узлы перемешаны — как их видит плоский «список» Test Explorer.
		const libDir = directorySortKey(['Libraries']);
		const libSubDir = directorySortKey(['Libraries', 'ИнициаторДанных']);
		const fixturesDir = directorySortKey(['fixtures']);
		const fileConst = fileSortKey(['fixtures'], '01_Const_Константы.feature');
		const fileValuta = fileSortKey(['fixtures'], '02_Code_ЗагрузкаВалют.feature');
		const rootFile = fileSortKey([], 'Проверка vanessa-automation.feature');

		const flat = [
			rootFile,
			fileValuta,
			caseSortKey(fileConst, '000016'),
			fixturesDir,
			fileConst,
			caseSortKey(fileConst, '000005'),
			libSubDir,
			libDir
		];

		// Ожидаемый обход в глубину: каталоги перед файлом в корне, поддерево
		// каждого каталога — единым блоком, файл — прямо перед своими кейсами
		assert.deepStrictEqual([...flat].sort(), [
			libDir,
			libSubDir,
			fixturesDir,
			fileConst,
			caseSortKey(fileConst, '000005'),
			caseSortKey(fileConst, '000016'),
			fileValuta,
			rootFile
		]);
	});
});
