import * as assert from 'node:assert';
import { createVRunnerTask, TaskOutputChain } from '../../features/tasks/vrunnerTask';

suite('вывод задач одной команды', () => {
	test('первая задача цепочки очищает терминал, остальные дописывают', () => {
		const chain = new TaskOutputChain();

		assert.strictEqual(chain.append(), false);
		assert.strictEqual(chain.append(), true);
		assert.strictEqual(chain.append(), true);
	});

	test('одиночная задача очищает терминал, задача цепочки сохраняет вывод предыдущей', () => {
		const single = createVRunnerTask({ name: 'Сборка', command: 'vrunner compile', cwd: '.' });
		const chained = createVRunnerTask({ name: 'Сборка', command: 'vrunner compile', cwd: '.', appendOutput: true });

		assert.strictEqual(single.presentationOptions.clear, true);
		assert.strictEqual(chained.presentationOptions.clear, false);
	});
});
