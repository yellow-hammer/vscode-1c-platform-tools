import * as assert from 'node:assert';
import { RunQueue } from '../../features/testing/runQueue';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('runQueue', () => {
	test('выполняет задачи строго последовательно', async () => {
		const queue = new RunQueue();
		const order: string[] = [];

		const first = queue.enqueue(async () => {
			await tick(20);
			order.push('first');
		});
		const second = queue.enqueue(async () => {
			order.push('second');
		});

		await Promise.all([first, second]);
		// second не должна стартовать раньше завершения first
		assert.deepStrictEqual(order, ['first', 'second']);
	});

	test('ошибка задачи не ломает очередь — следующая выполняется', async () => {
		const queue = new RunQueue();
		const order: string[] = [];

		const failing = queue.enqueue(async () => {
			throw new Error('бум');
		});
		const next = queue.enqueue(async () => {
			order.push('next');
		});

		await assert.rejects(failing, /бум/);
		await next;
		assert.deepStrictEqual(order, ['next']);
	});

	test('enqueue возвращает промис именно своей задачи', async () => {
		const queue = new RunQueue();
		const result = queue.enqueue(async () => {
			await tick(5);
		});
		assert.ok(result instanceof Promise);
		await result;
	});
});
