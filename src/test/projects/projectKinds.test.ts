import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { ProjectKinds } from '../../features/projects/projectKinds';
import { projectListItems } from '../../features/projects/projectsPicker';
import { autodetectDetail } from '../../features/projects/autodetectProvider';
import type { ProjectKind } from '../../shared/projectKind';
import { normalizeProjectRoot } from '../../shared/workspaceProjects';

function memoryMemento(initial: Record<string, unknown> = {}): vscode.Memento {
	const values = new Map<string, unknown>(Object.entries(initial));
	return {
		get: <T>(key: string, fallback?: T) => (values.has(key) ? (values.get(key) as T) : fallback),
		update: async (key: string, value: unknown) => {
			values.set(key, value);
		},
		keys: () => [...values.keys()],
	} as vscode.Memento;
}

const LIBRARY = normalizeProjectRoot('/w/библиотека');
const RETAIL = normalizeProjectRoot('/w/розница');

suite('проекты: вид в списках', () => {
	test('вид каталога проверяется в фоне один раз и запоминается между сессиями', async () => {
		const memento = memoryMemento();
		const checked: string[] = [];
		const detect = async (root: string): Promise<ProjectKind | undefined> => {
			checked.push(root);
			return root === LIBRARY ? 'onescript' : 'designer';
		};
		const kinds = new ProjectKinds(memento, detect, () => undefined);
		let changes = 0;
		kinds.onDidChange(() => {
			changes += 1;
		});

		assert.strictEqual(kinds.kindOf(LIBRARY), undefined);
		assert.strictEqual(kinds.kindOf(RETAIL), undefined);
		await kinds.settled();

		assert.strictEqual(kinds.kindOf(LIBRARY), 'onescript');
		assert.strictEqual(kinds.kindOf(RETAIL), 'designer');
		await kinds.settled();
		assert.deepStrictEqual(checked, [LIBRARY, RETAIL]);
		assert.strictEqual(changes, 1);
		kinds.dispose();

		const next = new ProjectKinds(memento, async () => 'onescript', () => undefined);
		assert.strictEqual(next.kindOf(RETAIL), 'designer');
		await next.settled();
		assert.strictEqual(next.kindOf(RETAIL), 'onescript');
		next.dispose();
	});

	test('у проекта окна вид из обнаружения, без проверки каталога', async () => {
		const checked: string[] = [];
		const kinds = new ProjectKinds(
			undefined,
			async (root) => {
				checked.push(root);
				return 'designer';
			},
			(root) => (root === LIBRARY ? 'onescript' : undefined)
		);

		assert.strictEqual(kinds.kindOf(LIBRARY), 'onescript');
		await kinds.settled();
		assert.deepStrictEqual(checked, []);
		kinds.dispose();
	});

	test('окно выбора и «Все проекты»: вид перед каталогом и после отметки окна', () => {
		const kindOf = (root: string): ProjectKind | undefined => (root === LIBRARY ? 'onescript' : undefined);
		const items = projectListItems([], [{ label: 'библиотека', description: LIBRARY }], [{ label: 'розница', description: RETAIL }], kindOf);

		assert.deepStrictEqual(
			items.map((item) => [item.label, item.description, item.path]),
			[
				['Избранное', undefined, ''],
				['библиотека', `OneScript · ${LIBRARY}`, LIBRARY],
				['Все проекты', undefined, ''],
				['розница', RETAIL, RETAIL],
			]
		);
		assert.strictEqual(autodetectDetail(LIBRARY, undefined, 'w', 'onescript'), 'OneScript · w');
		assert.strictEqual(autodetectDetail(RETAIL, undefined, undefined, 'edt'), '1C:EDT');
	});
});

