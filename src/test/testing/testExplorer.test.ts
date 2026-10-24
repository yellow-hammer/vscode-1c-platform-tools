import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AdapterRunPlan, FileTreeLocation, TestFrameworkAdapter } from '../../features/testing/frameworkAdapter';
import { registerTestExplorer } from '../../features/testing/registerTestingFeature';
import { testingVRunner } from '../fixtures/helpers/testingVRunner';
import { sameProjectRoot, type ProjectScanRoot } from '../../shared/workspaceProjects';

/** Проект с подпроектом и зависимостями. */
const PROJECT = path.resolve(__dirname, '../../../src/test/fixtures/workspaceScan/проект');
const SUB_PROJECT = path.join(PROJECT, 'подпроект');

class OneScriptFilesAdapter implements TestFrameworkAdapter {
	public readonly id = 'onescript' as const;
	public readonly label = 'OneScript';
	public readonly usesVanessaRunner = false;
	public readonly usesReportDir = false;

	public async isEnabled(): Promise<boolean> {
		return true;
	}

	public getIncludeGlobs(): string[] {
		return ['tests/**/*.os'];
	}

	public parseFile(): undefined {
		return undefined;
	}

	public describeFileLocation(): FileTreeLocation {
		return { segments: [] };
	}

	public async buildRunPlan(): Promise<AdapterRunPlan> {
		throw new Error('процесс в проверке не запускается');
	}
}

interface ControllerInternals {
	controller: vscode.TestController;
}

const scanRootOf = async (root: string): Promise<ProjectScanRoot> => ({
	root,
	excludeDirs: sameProjectRoot(root, PROJECT) ? [SUB_PROJECT] : [],
});

function fileLabels(controller: vscode.TestController): string[] {
	const labels: string[] = [];
	const visit = (item: vscode.TestItem) => {
		if (item.uri && path.extname(item.uri.fsPath) === '.os') {
			labels.push(item.label);
		}
		item.children.forEach(visit);
	};
	controller.items.forEach(visit);
	return labels.sort();
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) {
			return false;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return true;
}

suite('тестирование: панель тестов', () => {
	test('панель выключена у текущего проекта: дерево строится, когда её включают', async function () {
		this.timeout(60_000);
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		await config.update('test.panelEnabled', false, vscode.ConfigurationTarget.Workspace);
		const explorer = registerTestExplorer({
			isProjectRef: { current: true },
			adapters: [new OneScriptFilesAdapter()],
			vrunner: testingVRunner(),
			controllerOptions: { id: '1c-platform-tools-tests-panel-enabled', scanRootOf },
		});
		const tree = (explorer.controller as unknown as ControllerInternals).controller;
		try {
			explorer.controller.setProject(PROJECT);
			await explorer.controller.enqueueRebuild();
			assert.deepStrictEqual(fileLabels(tree), []);

			await config.update('test.panelEnabled', undefined, vscode.ConfigurationTarget.Workspace);
			assert.ok(await waitFor(() => fileLabels(tree).length > 0, 30_000), 'дерево не построено');
			assert.deepStrictEqual(fileLabels(tree), ['Проверка.os']);
		} finally {
			for (const disposable of explorer.disposables) {
				disposable.dispose();
			}
			await config.update('test.panelEnabled', undefined, vscode.ConfigurationTarget.Workspace);
		}
	});
});
