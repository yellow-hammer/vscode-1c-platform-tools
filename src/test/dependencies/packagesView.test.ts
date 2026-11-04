import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DependencyTreeRow } from '../../features/dependencies/dependencyTree';
import { PackagesViewProvider, type PackagesTreeSource } from '../../features/dependencies/packagesView';

const LEFT = path.join(os.tmpdir(), 'pkg-left');
const RIGHT = path.join(os.tmpdir(), 'pkg-right');

function row(): DependencyTreeRow {
	return {
		label: 'add',
		packageName: 'add',
		icon: 'package',
		children: [{ label: 'logos', icon: 'package', children: [] }],
	};
}

function source(roots: readonly string[], selected?: string): PackagesTreeSource {
	return {
		roots: () => roots,
		rows: () => [row()],
		message: (root) => (root === RIGHT ? '2 пакета' : '1 пакет'),
		selected: () => selected,
	};
}

function projectRootOf(item: vscode.TreeItem): string | undefined {
	const root = (item as { projectRoot?: unknown }).projectRoot;
	return typeof root === 'string' ? root : undefined;
}

suite('пакеты: панель', () => {
	test('один проект показывается без группы', () => {
		const provider = new PackagesViewProvider(source([LEFT], LEFT));
		const view = { message: '' };
		provider.bind(view);
		try {
			const items = provider.getChildren();
			assert.strictEqual(items.length, 1);
			assert.strictEqual(items[0].contextValue, 'oscriptPackage');
			assert.strictEqual(projectRootOf(items[0]), LEFT);
			const nested = provider.getChildren(items[0]);
			assert.strictEqual(nested.length, 1);
			assert.strictEqual(projectRootOf(nested[0]), LEFT);
			assert.strictEqual(view.message, '1 пакет');
		} finally {
			provider.dispose();
		}
	});

	test('несколько проектов: текущий первый и раскрыт, команда идёт в его корень', () => {
		const provider = new PackagesViewProvider(source([LEFT, RIGHT], RIGHT));
		const view = { message: '' };
		provider.bind(view);
		try {
			const groups = provider.getChildren();
			assert.deepStrictEqual(groups.map((item) => item.label), ['pkg-right', 'pkg-left']);
			assert.strictEqual(groups[0].description, 'текущий');
			assert.strictEqual(groups[0].collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
			assert.strictEqual(groups[1].description, undefined);
			assert.strictEqual(groups[1].collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
			assert.strictEqual(groups[0].contextValue, 'oscriptPackagesProject');
			assert.strictEqual(projectRootOf(groups[0]), RIGHT);
			const packages = provider.getChildren(groups[1]);
			assert.strictEqual(projectRootOf(packages[0]), LEFT);
			assert.strictEqual(view.message, 'pkg-right: 2 пакета');
		} finally {
			provider.dispose();
		}
	});

	test('без выбранного проекта сводка над несколькими группами пустая', () => {
		const provider = new PackagesViewProvider(source([LEFT, RIGHT]));
		const view = { message: 'было' };
		provider.bind(view);
		try {
			assert.strictEqual(provider.getChildren().length, 2);
			assert.strictEqual(view.message, '');
		} finally {
			provider.dispose();
		}
	});
});
