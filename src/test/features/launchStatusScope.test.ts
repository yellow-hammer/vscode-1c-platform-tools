import * as assert from 'node:assert';
import { showsProjectStatus, showsServerStatus } from '../../features/launch/launchStatusScope';

const onec = { kind: 'designer' as const };
const onescript = { kind: 'onescript' as const };

suite('строка состояния: сервер', () => {
	test('виден у проекта 1С, пока открытый файл не лежит вне проектов или в проекте OneScript', () => {
		assert.strictEqual(showsServerStatus(onec, false, 'none'), true);
		assert.strictEqual(showsServerStatus({ kind: 'onec' }, false, 'none'), true);
		assert.strictEqual(showsServerStatus(onec, false, { kind: 'edt' }), true);
		assert.strictEqual(showsServerStatus(onec, false, {}), true);
		assert.strictEqual(showsServerStatus(onec, true, 'outside'), false);
		assert.strictEqual(showsServerStatus(onec, true, onescript), false);
		assert.strictEqual(showsServerStatus(onescript, true, 'none'), false);
		assert.strictEqual(showsServerStatus(undefined, true, 'none'), false);
	});

	test('пока вид проекта не известен, решает файл настроек', () => {
		assert.strictEqual(showsServerStatus({}, true, 'none'), true);
		assert.strictEqual(showsServerStatus({}, false, 'none'), false);
	});
});

suite('строка состояния: профиль и окружение', () => {
	test('видны у проекта любого вида, пока открытый файл лежит в проекте', () => {
		assert.strictEqual(showsProjectStatus(onec, 'none'), true);
		assert.strictEqual(showsProjectStatus(onescript, 'none'), true);
		assert.strictEqual(showsProjectStatus({}, onescript), true);
		assert.strictEqual(showsProjectStatus(onescript, 'outside'), false);
		assert.strictEqual(showsProjectStatus(undefined, 'none'), false);
	});
});
