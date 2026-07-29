import * as assert from 'node:assert';
import * as path from 'node:path';
import { isProjectPathInWorkspace, extractCommandFlags } from '../../shared/ipcRequest';

/** Путь в стиле текущей файловой системы. */
function local(...segments: string[]): string {
	return path.resolve(path.join(...segments));
}

suite('isProjectPathInWorkspace', () => {
	test('без открытых папок проверять нечего', () => {
		assert.strictEqual(isProjectPathInWorkspace(local('work', 'erp'), []), true);
	});

	test('совпадение с папкой рабочей области', () => {
		const root = local('work', 'erp');
		assert.strictEqual(isProjectPathInWorkspace(root, [root]), true);
	});

	test('путь внутри папки рабочей области', () => {
		const root = local('work', 'erp');
		assert.strictEqual(isProjectPathInWorkspace(path.join(root, 'src', 'cf'), [root]), true);
	});

	test('папка рабочей области внутри указанного пути', () => {
		// агент назвал каталог выше открытой папки: команда всё равно про этот проект
		const root = local('work', 'erp');
		assert.strictEqual(isProjectPathInWorkspace(local('work'), [root]), true);
	});

	test('чужой проект отклоняется', () => {
		const root = local('work', 'erp');
		assert.strictEqual(isProjectPathInWorkspace(local('work', 'retail'), [root]), false);
	});

	test('сосед с общим началом имени не считается своим', () => {
		// erp-old начинается так же, как erp: сравнение по границе каталога
		const root = local('work', 'erp');
		assert.strictEqual(isProjectPathInWorkspace(local('work', 'erp-old'), [root]), false);
	});

	test('подходит любая из открытых папок', () => {
		const roots = [local('work', 'erp'), local('work', 'retail')];
		assert.strictEqual(isProjectPathInWorkspace(local('work', 'retail', 'src'), roots), true);
	});

	test('относительный путь считается от первой папки', () => {
		const roots = [local('work', 'erp'), local('work', 'retail')];
		assert.strictEqual(isProjectPathInWorkspace(path.join('src', 'cf'), roots), true);
		assert.strictEqual(isProjectPathInWorkspace(path.join('..', 'retail'), roots), true);
		assert.strictEqual(isProjectPathInWorkspace(path.join('..', 'hrm'), roots), false);
	});

	test('на Windows регистр не мешает', function () {
		if (path.sep !== '\\') {
			this.skip();
			return;
		}
		assert.strictEqual(isProjectPathInWorkspace('C:\\Work\\ERP', ['c:\\work\\erp']), true);
	});

	test('лишние разделители и точки не мешают', () => {
		const root = local('work', 'erp');
		assert.strictEqual(isProjectPathInWorkspace(path.join(root, 'src', '..'), [root]), true);
	});
});

suite('extractCommandFlags', () => {
	test('объект с флагами разбирается', () => {
		const flags = extractCommandFlags([{ wait: true, settingsFile: 'env.dev.json' }]);
		assert.strictEqual(flags.wait, true);
		assert.strictEqual(flags.settingsFile, 'env.dev.json');
	});

	test('вызов без аргументов даёт пустые флаги', () => {
		assert.deepStrictEqual(extractCommandFlags([]), {});
	});

	test('строковый аргумент из UI флагами не считается', () => {
		// команды дерева получают строку или элемент: синхронный режим не включаем
		assert.deepStrictEqual(extractCommandFlags(['dev']), {});
	});

	test('массив первым аргументом флагами не считается', () => {
		assert.deepStrictEqual(extractCommandFlags([['a', 'b']]), {});
	});

	test('null первым аргументом не роняет разбор', () => {
		assert.deepStrictEqual(extractCommandFlags([null]), {});
	});
});
