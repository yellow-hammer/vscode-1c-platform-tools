import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isPipelineTemplatesNode, ServiceFilesTreeProvider } from '../../features/serviceFiles/serviceFilesTree';
import { writePipelines } from '../../shared/pipelines/pipelineFile';
import { PIPELINE_TEMPLATE_ID_PREFIX } from '../../shared/pipelines/pipelineTemplates';
import { projectStructureDirectories } from '../../shared/projectStructure';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { runWithProject } from '../../shared/workspaceProjects';

function emptyRoot(name: string): string {
	const root = path.join(os.tmpdir(), 'service-files-repo', name);
	fs.rmSync(root, { recursive: true, force: true });
	fs.mkdirSync(root, { recursive: true });
	return root;
}

async function groupRows(provider: ServiceFilesTreeProvider, group: 'repo' | 'automation'): Promise<vscode.TreeItem[]> {
	provider.refresh();
	const node = (await provider.getChildren()).find((item) => item.group === group && !item.row);
	assert.ok(node);
	return provider.getChildren(node);
}

function repoRows(provider: ServiceFilesTreeProvider): Promise<vscode.TreeItem[]> {
	return groupRows(provider, 'repo');
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

	test('меню есть у лежащего файла: открыть и пересоздать', async function () {
		this.timeout(60_000);
		const root = emptyRoot('меню');
		fs.writeFileSync(path.join(root, '.gitignore'), '');
		fs.writeFileSync(path.join(root, 'packagedef'), '');
		const provider = new ServiceFilesTreeProvider(VRunnerManager.getInstance());
		try {
			const rows = await runWithProject(root, () => repoRows(provider));
			const contextOf = (label: string): string | undefined => rows.find((row) => row.label === label)?.contextValue;
			assert.strictEqual(contextOf('.gitignore'), 'serviceFile serviceFileRecreatable');
			assert.strictEqual(contextOf('packagedef'), 'serviceFile serviceFileRecreatable');
			assert.strictEqual(contextOf('.gitattributes'), undefined);
			assert.strictEqual(contextOf('Структура проекта'), undefined);
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

suite('служебные файлы: группа «Автоматизация»', () => {
	test('хуки и пайплайны пересоздаются, типовые пайплайны только когда уже стоят', async function () {
		this.timeout(60_000);
		const root = emptyRoot('типовые');
		const provider = new ServiceFilesTreeProvider(VRunnerManager.getInstance());
		const templatesRow = async (): Promise<vscode.TreeItem | undefined> =>
			(await runWithProject(root, () => groupRows(provider, 'automation'))).find(isPipelineTemplatesNode);
		try {
			const before = await templatesRow();
			assert.ok(before);
			assert.strictEqual(before.contextValue, undefined);
			assert.strictEqual(before.command?.command, '1c-platform-tools.pipelines.addTemplates');

			await writePipelines(root, [{ id: `${PIPELINE_TEMPLATE_ID_PREFIX}test-run`, name: 'Прогон тестов', nodes: [], edges: [] }]);
			fs.writeFileSync(path.join(root, '.1cpt', 'hooks.json'), '{}');
			const after = await templatesRow();
			assert.ok(after);
			assert.strictEqual(after.contextValue, 'serviceFileRecreatable');
			assert.strictEqual(after.command?.command, '1c-platform-tools.pipelines.openEditor');
			const rows = await runWithProject(root, () => groupRows(provider, 'automation'));
			assert.deepStrictEqual(
				rows.map((item) => [String(item.label), item.contextValue]),
				[
					['1cpt: hooks', 'serviceFile serviceFileRecreatable'],
					['1cpt: пайплайны', 'serviceFile serviceFileRecreatable'],
					['1cpt: типовые пайплайны', 'serviceFileRecreatable'],
				]
			);
		} finally {
			provider.dispose();
		}
	});
});
