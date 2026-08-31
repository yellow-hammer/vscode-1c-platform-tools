import * as assert from 'node:assert';
import {
	isUsableExtensionFolderName,
	resolveDumpTargets
} from '../../features/extensions/extensionDumpTargets';

suite('extensionDumpTargets', () => {
	test('нет каталога — папка и имя как в базе', () => {
		assert.deepStrictEqual(resolveDumpTargets([], ['Зарплата', 'Бюджет']), [
			{ folder: 'Зарплата', extensionName: 'Зарплата' },
			{ folder: 'Бюджет', extensionName: 'Бюджет' }
		]);
	});

	test('каталог с другим именем находится по Configuration.xml', () => {
		const disk = [{ folder: 'yaxunit-test', extensionName: 'Тесты' }];
		assert.deepStrictEqual(resolveDumpTargets(disk, ['Тесты']), [
			{ folder: 'yaxunit-test', extensionName: 'Тесты' }
		]);
	});

	test('выбор по имени каталога сохраняет имя из метаданных', () => {
		const disk = [{ folder: 'yaxunit-test', extensionName: 'Тесты' }];
		assert.deepStrictEqual(resolveDumpTargets(disk, ['yaxunit-test']), [
			{ folder: 'yaxunit-test', extensionName: 'Тесты' }
		]);
	});

	test('сопоставление без учёта регистра, существующие каталоги не переименовываются', () => {
		const disk = [{ folder: 'Salary', extensionName: 'Зарплата' }];
		assert.deepStrictEqual(resolveDumpTargets(disk, ['зарплата', 'Новое']), [
			{ folder: 'Salary', extensionName: 'Зарплата' },
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
