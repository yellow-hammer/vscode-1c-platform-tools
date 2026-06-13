import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	directoryNodeId,
	directoryNodeFsPath,
	dedupedCaseId
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
});
