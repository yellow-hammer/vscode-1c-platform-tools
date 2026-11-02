import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { packageFileArgument, packageProjectArgument } from '../../commands/packageCommands';

const PROJECT = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'workspaceScan', 'пакет');
const PACKAGE = path.join(PROJECT, 'пакет-0.1.0.ospx');

suite('аргументы команд пакета OneScript', () => {
	test('пакет берётся из пути, Uri и узла дерева артефактов', () => {
		assert.strictEqual(packageFileArgument(PACKAGE), PACKAGE);
		assert.strictEqual(packageFileArgument(vscode.Uri.file(PACKAGE)), PACKAGE);
		assert.strictEqual(packageFileArgument({ resourceUri: vscode.Uri.file(PACKAGE) }), PACKAGE);
	});

	test('не пакет и опции агента пакетом не считаются', () => {
		assert.strictEqual(packageFileArgument(path.join(PROJECT, 'packagedef')), undefined);
		assert.strictEqual(packageFileArgument({ wait: true, projectPath: PROJECT }), undefined);
		assert.strictEqual(packageFileArgument(undefined), undefined);
	});

	test('раздел «Пакеты» собирает пакет своего проекта, остальное идёт в текущем', () => {
		assert.strictEqual(packageProjectArgument({ projectRoot: PROJECT }), PROJECT);
		assert.strictEqual(packageProjectArgument({ wait: true }), undefined);
		assert.strictEqual(packageProjectArgument(undefined), undefined);
	});
});
