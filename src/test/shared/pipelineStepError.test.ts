import * as assert from 'node:assert';
import { stepErrorLine } from '../../shared/pipelines/pipelineRunner';

suite('pipelineRunner: строка ошибки шага', () => {
	test('берётся строка с меткой ошибки, а не последняя строка вывода', () => {
		const output = [
			'ИНФОРМАЦИЯ - Выполняю команду в режиме 1С:Предприятие',
			'ОШИБКА - Получен неожиданный результат работы - Не найден файл статуса build/buildstatus.log',
			'Выполнение сценариев закончено. БЫЛИ ОШИБКИ.',
			'Закрытие TestClient <Этот клиент>',
		].join('\n');

		assert.strictEqual(
			stepErrorLine(output),
			'ОШИБКА - Получен неожиданный результат работы - Не найден файл статуса build/buildstatus.log'
		);
	});

	test('критичная ошибка важнее обычной', () => {
		const output = [
			'ОШИБКА - Получен ненулевой код возврата 1',
			'КРИТИЧНАЯОШИБКА - Ошибка XDTO в файле - _ДемоОсновной.xml, при чтении свойства: Synonym',
			'}',
		].join('\r\n');

		assert.strictEqual(
			stepErrorLine(output),
			'КРИТИЧНАЯОШИБКА - Ошибка XDTO в файле - _ДемоОсновной.xml, при чтении свойства: Synonym'
		);
	});

	test('без меток берётся первая содержательная строка', () => {
		assert.strictEqual(stepErrorLine('\n\nне удалось запустить oscript\nподробности ниже'), 'не удалось запустить oscript');
	});

	test('длинная строка обрезается, пустой вывод даёт undefined', () => {
		const long = `ОШИБКА - ${'а'.repeat(400)}`;

		assert.strictEqual(stepErrorLine(long, 50)?.length, 51);
		assert.strictEqual(stepErrorLine('   \n  '), undefined);
	});
});
