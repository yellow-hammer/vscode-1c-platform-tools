import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
	buildPipelineFavoriteItems,
	pipelineRunArguments,
} from '../../features/tools/registerMainTreeCommands';
import type { Pipeline } from '../../shared/pipelines/pipelineTypes';

const PIPELINES = [
	{ id: 'p-build', name: 'Сборка', nodes: [] },
	{ id: 'p-test', name: 'Тесты', nodes: [] },
] as unknown as Pipeline[];

/** Ключ отметки в списке избранного: так же он собирается из сохранённых записей. */
function favoriteKey(command: string, args: unknown[]): string {
	return `${command}|${JSON.stringify(args)}`;
}

suite('избранные пайплайны', () => {
	test('цепочки проекта попадают в список избранного отдельной группой', () => {
		const items = buildPipelineFavoriteItems(PIPELINES, new Set());

		assert.strictEqual(items[0].kind, vscode.QuickPickItemKind.Separator);
		assert.strictEqual(items[0].label, 'Автоматизация');
		assert.deepStrictEqual(
			items.slice(1).map((item) => item.label),
			['▶️ Сборка', '▶️ Тесты']
		);
	});

	test('избранная цепочка отмечена галкой', () => {
		const keys = new Set([favoriteKey('1c-platform-tools.pipelines.run', pipelineRunArguments('p-test'))]);

		const picked = buildPipelineFavoriteItems(PIPELINES, keys)
			.filter((item) => item.picked)
			.map((item) => item.label);

		assert.deepStrictEqual(picked, ['▶️ Тесты']);
	});

	test('запись избранного запускает цепочку по идентификатору', () => {
		const entry = buildPipelineFavoriteItems(PIPELINES, new Set())[1] as vscode.QuickPickItem & {
			command: string;
			title: string;
			sectionType: string;
			arguments: unknown[];
		};

		assert.strictEqual(entry.command, '1c-platform-tools.pipelines.run');
		assert.strictEqual(entry.title, 'Сборка');
		assert.strictEqual(entry.sectionType, 'pipelines');
		assert.deepStrictEqual(entry.arguments, [{ pipeline: 'p-build' }]);
	});

	test('без цепочек группа не появляется', () => {
		assert.deepStrictEqual(buildPipelineFavoriteItems([], new Set()), []);
	});
});
