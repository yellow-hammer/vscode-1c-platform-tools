import * as assert from 'node:assert';
import { adapterExitMessage, isAdapterShutdownNoise } from '../../features/debug/registerDebugFeature';

suite('debugAdapterExit', () => {
	test('штатное завершение адаптера не сообщается', () => {
		assert.strictEqual(adapterExitMessage(0, undefined), undefined);
	});

	test('ненулевой код возврата попадает в сообщение', () => {
		assert.strictEqual(
			adapterExitMessage(134, undefined),
			'процесс адаптера отладки завершился аварийно: код возврата 134'
		);
	});

	test('остановка сессии не показывает код 1; обрыв канала — штатный шум', () => {
		assert.strictEqual(adapterExitMessage(1, undefined, true), undefined);
		assert.strictEqual(adapterExitMessage(undefined, undefined, true), undefined);
		assert.strictEqual(
			adapterExitMessage(134, undefined, true),
			'процесс адаптера отладки завершился аварийно: код возврата 134'
		);
		assert.ok(isAdapterShutdownNoise(new Error('read error')));
		assert.ok(isAdapterShutdownNoise(new Error('write EPIPE')));
		assert.ok(!isAdapterShutdownNoise(new Error('hostpolicy.dll not found')));
	});

	test('завершение по сигналу описывается сигналом', () => {
		assert.strictEqual(
			adapterExitMessage(undefined, 'SIGTERM'),
			'процесс адаптера отладки завершился аварийно: сигнал SIGTERM'
		);
		assert.strictEqual(
			adapterExitMessage(undefined, undefined),
			'процесс адаптера отладки завершился аварийно: сигнал неизвестен'
		);
	});
});
