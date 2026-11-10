import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ServiceFilesTreeProvider } from '../../features/serviceFiles/serviceFilesTree';
import { projectStructureDirectories } from '../../shared/projectStructure';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { runWithProject } from '../../shared/workspaceProjects';

function emptyRoot(name: string): string {
	const root = path.join(os.tmpdir(), 'service-files-repo', name);
	fs.rmSync(root, { recursive: true, force: true });
	fs.mkdirSync(root, { recursive: true });
	return root;
}

async function repoRows(provider: ServiceFilesTreeProvider): Promise<vscode.TreeItem[]> {
	provider.refresh();
	const repo = (await provider.getChildren()).find((node) => node.group === 'repo' && !node.row);
	assert.ok(repo);
	return provider.getChildren(repo);
}

function iconOf(item: vscode.TreeItem): string | undefined {
	return item.iconPath instanceof vscode.ThemeIcon ? item.iconPath.id : undefined;
}

suite('служебные файлы: группа «Репозиторий»', () => {
	test('packagedef и структура проекта идут после файлов Git', async function () {
		this.timeout(60_000);
		const root = emptyRoot('порядок');
		const provider = new ServiceFilesTreeProvider(VRunnerManager.getInstance());
		try {
			const rows = await runWithProject(root, () => repoRows(provider));
			assert.deepStrictEqual(rows.map((row) => String(row.label)), ['.gitignore', '.gitattributes', 'packagedef', 'Структура проекта']);
			const structure = rows[3];
			assert.strictEqual(structure.command?.command, '1c-platform-tools.dependencies.initializeProjectStructure');
		} finally {
			provider.dispose();
		}
	});

	test('лежащий packagedef отмечен и открывается, а не создаётся заново', async function () {
		this.timeout(60_000);
		const root = emptyRoot('packagedef');
		fs.writeFileSync(path.join(root, 'packagedef'), '');
		const provider = new ServiceFilesTreeProvider(VRunnerManager.getInstance());
		try {
			const rows = await runWithProject(root, () => repoRows(provider));
			const packagedef = rows.find((row) => row.label === 'packagedef');
			assert.ok(packagedef);
			assert.strictEqual(iconOf(packagedef), 'check');
			assert.strictEqual(packagedef.command?.title, 'Открыть');
		} finally {
			provider.dispose();
		}
	});

	test('структура отмечена, когда на месте все каталоги шаблона', async function () {
		this.timeout(60_000);
		const root = emptyRoot('структура');
		const provider = new ServiceFilesTreeProvider(VRunnerManager.getInstance());
		try {
			const before = (await runWithProject(root, () => repoRows(provider))).find((row) => row.label === 'Структура проекта');
			assert.ok(before);
			assert.strictEqual(iconOf(before), 'add');

			for (const dir of projectStructureDirectories(undefined)) {
				fs.mkdirSync(path.join(root, dir), { recursive: true });
			}
			const after = (await runWithProject(root, () => repoRows(provider))).find((row) => row.label === 'Структура проекта');
			assert.ok(after);
			assert.strictEqual(iconOf(after), 'check');
			assert.strictEqual(after.command?.command, '1c-platform-tools.dependencies.initializeProjectStructure');
		} finally {
			provider.dispose();
		}
	});
});
