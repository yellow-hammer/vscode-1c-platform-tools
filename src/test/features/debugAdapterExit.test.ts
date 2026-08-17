import * as assert from 'node:assert';
import { adapterExitMessage } from '../../features/debug/registerDebugFeature';

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
