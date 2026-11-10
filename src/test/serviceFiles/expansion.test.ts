import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ServiceFilesTreeProvider } from '../../features/serviceFiles/serviceFilesTree';
import { SERVICE_FILES_EXPANDED_GROUPS_STATE, projectMemento } from '../../shared/projectState';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { runWithProject } from '../../shared/workspaceProjects';

function projectRoot(name: string): string {
	const root = path.join(os.tmpdir(), 'service-files-expansion', name);
	fs.mkdirSync(root, { recursive: true });
	return root;
}

suite('служебные файлы: раскрытие групп service-files-groups', () => {
	test('без сохранённого состояния группы свёрнуты, раскрытие живёт в проекте', async function () {
		this.timeout(60_000);
		const first = projectRoot('первый');
		const second = projectRoot('второй');
		const provider = new ServiceFilesTreeProvider(VRunnerManager.getInstance());
		try {
			const closed = await runWithProject(first, () => provider.getChildren());
			const profile = closed.find((node) => node.group === 'profile' && !node.row);
			assert.ok(profile);
			assert.strictEqual(profile.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

			await runWithProject(first, async () => {
				await provider.rememberExpanded(profile, true);
				provider.refresh();
				const roots = await provider.getChildren();
				const again = roots.find((node) => node.group === 'profile' && !node.row);
				assert.strictEqual(again?.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
			});

			await runWithProject(second, async () => {
				provider.refresh();
				const roots = await provider.getChildren();
				const other = roots.find((node) => node.group === 'profile' && !node.row);
				assert.strictEqual(other?.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
				const vanessa = roots.find((node) => node.group === 'vanessa' && !node.row);
				assert.ok(vanessa);
				await provider.rememberExpanded(vanessa, true);
			});

			assert.deepStrictEqual(projectMemento(first).get(SERVICE_FILES_EXPANDED_GROUPS_STATE), ['profile']);
			assert.deepStrictEqual(projectMemento(second).get(SERVICE_FILES_EXPANDED_GROUPS_STATE), ['vanessa']);
		} finally {
			provider.dispose();
		}
	});
});
