import * as assert from 'node:assert';
import { showsLaunchStatus, showsProfileStatus } from '../../features/launch/launchStatusScope';

const onec = { kind: 'designer' as const };
const onescript = { kind: 'onescript' as const };

suite('строка состояния: сервер', () => {
	test('виден у проекта 1С, пока открытый файл не лежит вне проектов или в проекте OneScript', () => {
		assert.strictEqual(showsLaunchStatus(onec, false, 'none'), true);
		assert.strictEqual(showsLaunchStatus({ kind: 'onec' }, false, 'none'), true);
		assert.strictEqual(showsLaunchStatus(onec, false, { kind: 'edt' }), true);
		assert.strictEqual(showsLaunchStatus(onec, false, {}), true);
		assert.strictEqual(showsLaunchStatus(onec, true, 'outside'), false);
		assert.strictEqual(showsLaunchStatus(onec, true, onescript), false);
		assert.strictEqual(showsLaunchStatus(onescript, true, 'none'), false);
		assert.strictEqual(showsLaunchStatus(undefined, true, 'none'), false);
	});

	test('пока вид проекта не известен, решает файл настроек', () => {
		assert.strictEqual(showsLaunchStatus({}, true, 'none'), true);
		assert.strictEqual(showsLaunchStatus({}, false, 'none'), false);
	});
});

suite('строка состояния: профиль запуска', () => {
	test('виден у проекта любого вида, пока открытый файл лежит в проекте', () => {
		assert.strictEqual(showsProfileStatus(onec, false, 'none'), true);
		assert.strictEqual(showsProfileStatus(onescript, false, 'none'), true);
		assert.strictEqual(showsProfileStatus(onec, false, onescript), true);
		assert.strictEqual(showsProfileStatus(onescript, false, { kind: 'edt' }), true);
		assert.strictEqual(showsProfileStatus(onescript, false, 'outside'), false);
		assert.strictEqual(showsProfileStatus(undefined, true, 'none'), false);
	});

	test('пока вид проекта не известен, решает файл настроек', () => {
		assert.strictEqual(showsProfileStatus({}, true, 'none'), true);
		assert.strictEqual(showsProfileStatus({}, false, 'none'), false);
	});
});
