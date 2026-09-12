import * as assert from 'node:assert';
import {
	isUsableExtensionFolderName,
	resolveDumpTargets
} from '../../features/extensions/extensionDumpTargets';
import { selectionKey } from '../../features/extensions/extensionSelection';

suite('extensionDumpTargets', () => {
	test('нет каталога — папка и имя как в базе', () => {
		assert.deepStrictEqual(resolveDumpTargets([], ['Зарплата', 'Бюджет']), [
			{ folder: 'Зарплата', extensionName: 'Зарплата' },
			{ folder: 'Бюджет', extensionName: 'Бюджет' }
		]);
	});

	test('каталог с другим именем находится по имени из метаданных', () => {
		const disk = [{ folder: 'yaxunit-test', name: 'Тесты', dir: 'tests/cfe/yaxunit-test' }];
		assert.deepStrictEqual(resolveDumpTargets(disk, ['Тесты']), [
			{ dir: 'tests/cfe/yaxunit-test', folder: 'yaxunit-test', extensionName: 'Тесты' }
		]);
	});

	test('выбор по имени каталога или пути сохраняет имя из метаданных', () => {
		const disk = [{ folder: 'yaxunit-test', name: 'Тесты', dir: 'tests/cfe/yaxunit-test' }];
		const expected = [{ dir: 'tests/cfe/yaxunit-test', folder: 'yaxunit-test', extensionName: 'Тесты' }];
		assert.deepStrictEqual(resolveDumpTargets(disk, ['yaxunit-test']), expected);
		assert.deepStrictEqual(resolveDumpTargets(disk, ['tests/cfe/yaxunit-test']), expected);
	});

	test('проект EDT: имя из базы ведёт в каталог проекта', () => {
		const disk = [{ folder: 'ssl31._ДемоРасширение', name: '_ДемоРасширение', dir: 'ssl31._ДемоРасширение' }];
		assert.deepStrictEqual(resolveDumpTargets(disk, ['_ДемоРасширение', 'Новое']), [
			{ dir: 'ssl31._ДемоРасширение', folder: 'ssl31._ДемоРасширение', extensionName: '_ДемоРасширение' },
			{ folder: 'Новое', extensionName: 'Новое' }
		]);
	});

	test('одноимённые каталоги: ключ выбора ведёт к своему', () => {
		const disk = [
			{ folder: 'Общее', name: 'Общее', dir: 'src/cfe/Общее' },
			{ folder: 'Общее', name: 'ОбщееПодмодуля', dir: 'src/cfe/подмодуль/src/cfe/Общее' },
		];
		assert.deepStrictEqual(resolveDumpTargets(disk, [selectionKey(disk[1], disk)]), [
			{ dir: 'src/cfe/подмодуль/src/cfe/Общее', folder: 'Общее', extensionName: 'ОбщееПодмодуля' }
		]);
	});

	test('сопоставление без учёта регистра, существующие каталоги не переименовываются', () => {
		const disk = [{ folder: 'Salary', name: 'Зарплата', dir: 'src/cfe/Salary' }];
		assert.deepStrictEqual(resolveDumpTargets(disk, ['зарплата', 'Новое']), [
			{ dir: 'src/cfe/Salary', folder: 'Salary', extensionName: 'Зарплата' },
			{ folder: 'Новое', extensionName: 'Новое' }
		]);
	});

	test('isUsableExtensionFolderName отсекает запрещённые в пути знаки', () => {
		assert.strictEqual(isUsableExtensionFolderName('Зарплата'), true);
		assert.strictEqual(isUsableExtensionFolderName('ext_1'), true);
		assert.strictEqual(isUsableExtensionFolderName(''), false);
		assert.strictEqual(isUsableExtensionFolderName('..'), false);
		assert.strictEqual(isUsableExtensionFolderName('a/b'), false);
		assert.strictEqual(isUsableExtensionFolderName('a:b'), false);
	});
});
