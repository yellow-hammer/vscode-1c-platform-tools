import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { createVRunnerTaskTerminal } from '../../features/tasks/vrunnerTask';
import { buildProcessCommand } from '../../utils/commandUtils';
import {
	finishMessage,
	formatDuration,
	onTaskFinished,
	groupFinishMessage,
	shouldNotify,
	signalTaskFinished,
	soundCommand,
	withGroupedFinishSignals,
	type TaskFinishOutcome,
} from '../../features/tasks/taskFinishSignal';

suite('taskFinishSignal', () => {
	test('режим «только ошибки» молчит на успехе', () => {
		assert.strictEqual(shouldNotify('always', 0), true);
		assert.strictEqual(shouldNotify('always', 1), true);
		assert.strictEqual(shouldNotify('onError', 0), false);
		assert.strictEqual(shouldNotify('onError', 2), true);
		assert.strictEqual(shouldNotify('never', 1), false);
	});

	test('длительность читается словами', () => {
		assert.strictEqual(formatDuration(900), '1 с');
		assert.strictEqual(formatDuration(59_400), '59 с');
		assert.strictEqual(formatDuration(120_000), '2 мин');
		assert.strictEqual(formatDuration(135_000), '2 мин 15 с');
	});

	test('сообщение о команде показывает исход и время', () => {
		assert.strictEqual(
			finishMessage({ name: 'Загрузка конфигурации', exitCode: 0, durationMs: 135_000 }),
			'Загрузка конфигурации: готово за 2 мин 15 с'
		);
		assert.strictEqual(
			finishMessage({ name: 'Синтаксический контроль', exitCode: 1, durationMs: 5_000 }),
			'Синтаксический контроль: ошибка, код 1 (5 с)'
		);
	});

	test('сообщение о цепочке считает шаги и ошибки', () => {
		const ok: TaskFinishOutcome[] = [
			{ name: 'шаг 1', exitCode: 0, durationMs: 1000 },
			{ name: 'шаг 2', exitCode: 0, durationMs: 1000 },
		];

		assert.strictEqual(groupFinishMessage('Пайплайн «Обновление»', ok, 4000), 'Пайплайн «Обновление»: готово за 4 с, шагов 2');
		assert.strictEqual(
			groupFinishMessage('Пайплайн «Обновление»', [...ok, { name: 'шаг 3', exitCode: 1, durationMs: 1000 }], 5000),
			'Пайплайн «Обновление»: ошибок 1 из 3 (5 с)'
		);
	});

	test('внутри автоматизации отдельные команды не сигналят', async () => {
		// сигнал наружу не проверяем: важно, что группа принимает исходы шагов и завершается одна
		let insideCalls = 0;

		const result = await withGroupedFinishSignals('Пайплайн «Тест»', async () => {
			for (let i = 0; i < 5; i += 1) {
				signalTaskFinished({ name: `шаг ${i}`, exitCode: 0, durationMs: 10 });
				insideCalls += 1;
			}
			return 'готово';
		});

		assert.strictEqual(result, 'готово');
		assert.strictEqual(insideCalls, 5);
	});

	test('вложенная группа не заводит вторую', async () => {
		const order: string[] = [];

		await withGroupedFinishSignals('внешняя', async () => {
			order.push('внешняя старт');
			await withGroupedFinishSignals('внутренняя', async () => {
				order.push('внутренняя');
			});
			order.push('внешняя конец');
		});

		assert.deepStrictEqual(order, ['внешняя старт', 'внутренняя', 'внешняя конец']);
	});

	test('после ошибки автоматизации группа закрывается', async () => {
		await assert.rejects(
			withGroupedFinishSignals('падающая', async () => {
				throw new Error('шаг упал');
			})
		);

		// группа снята: следующая команда снова сигналит сама, а не копится в старой группе
		let signalled = false;
		await withGroupedFinishSignals('следующая', async () => {
			signalled = true;
		});
		assert.strictEqual(signalled, true);
	});

	test('звук платформы: у каждой ОС своя команда, у неизвестной звука нет', () => {
		assert.deepStrictEqual(soundCommand('win32', true)?.file, 'powershell');
		// на Windows берём звуковую схему системы, а не системный бип: его не слышно
		assert.ok(soundCommand('win32', true)?.args.join(' ').includes('SystemSounds]::Asterisk'));
		assert.ok(soundCommand('win32', false)?.args.join(' ').includes('SystemSounds]::Hand'));
		assert.strictEqual(soundCommand('darwin', true)?.file, 'afplay');
		assert.strictEqual(soundCommand('linux', false)?.file, 'paplay');
		assert.strictEqual(soundCommand('aix', true), undefined);
	});
});

suite('vrunnerTask: сигнал по завершении задачи', () => {
	test('задача сообщает исход, когда команда закончилась', async () => {
		const outcomes: TaskFinishOutcome[] = [];
		const unsubscribe = onTaskFinished((outcome) => outcomes.push(outcome));

		try {
			const exitCode = await runTaskTerminal('Проверка задачи', process.platform === 'win32' ? 'cmd /c exit 0' : 'exit 0');

			assert.strictEqual(exitCode, 0);
			assert.strictEqual(outcomes.length, 1, 'сигнал не пришёл: обработчик завершения его не вызывает');
			assert.strictEqual(outcomes[0].name, 'Проверка задачи');
			assert.strictEqual(outcomes[0].exitCode, 0);
		} finally {
			unsubscribe();
		}
	});

	test('код возврата команды доходит до сигнала', async () => {
		const outcomes: TaskFinishOutcome[] = [];
		const unsubscribe = onTaskFinished((outcome) => outcomes.push(outcome));

		try {
			await runTaskTerminal('Упавшая задача', process.platform === 'win32' ? 'cmd /c exit 3' : 'exit 3');

			assert.strictEqual(outcomes[0]?.exitCode, 3);
		} finally {
			unsubscribe();
		}
	});
});

suite('vrunnerTask: остановка задачи', () => {
	test('запуск строится на каждое исполнение, остановка вызывает его уборку', async () => {
		const cancelled: number[] = [];
		let runs = 0;
		const params = {
			name: 'Долгая задача',
			cwd: process.cwd(),
			command: () => {
				const run = ++runs;
				return {
					command: buildProcessCommand('node', ['-e', 'setTimeout(() => {}, 60000)']),
					onCancel: () => { cancelled.push(run); },
				};
			},
		};

		const first = createVRunnerTaskTerminal(params);
		createVRunnerTaskTerminal(params);
		assert.strictEqual(runs, 2, 'повтор задачи получил бы запуск прошлого исполнения');

		const exitCode = await new Promise<number>((resolve) => {
			first.onDidClose?.((code: number | void) => resolve(typeof code === 'number' ? code : -1));
			first.open(undefined);
			first.close();
		});

		assert.deepStrictEqual(cancelled, [1]);
		assert.notStrictEqual(exitCode, 0);
	});

	test('программа с аргументами: остановка вызывает обе уборки', async () => {
		const calls: string[] = [];
		const terminal = createVRunnerTaskTerminal({
			name: 'Долгая программа',
			cwd: process.cwd(),
			command: () => ({
				command: { file: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] },
				onCancel: () => { calls.push('cancel'); },
				onCancelled: () => calls.push('cancelled'),
			}),
		});

		const exitCode = await new Promise<number>((resolve) => {
			terminal.onDidClose?.((code: number | void) => resolve(typeof code === 'number' ? code : -1));
			terminal.open(undefined);
			setTimeout(() => terminal.close(), 300);
		});

		assert.deepStrictEqual(calls, ['cancel', 'cancelled']);
		assert.notStrictEqual(exitCode, 0);
	});
});

suite('vrunnerTask: программа с аргументами', () => {
	test('эхо показывает команду, вывод и код возврата доходят до задачи', async () => {
		const outcomes: TaskFinishOutcome[] = [];
		const unsubscribe = onTaskFinished((outcome) => outcomes.push(outcome));
		const written: string[] = [];
		const terminal = createVRunnerTaskTerminal({
			name: 'Программа задачи',
			cwd: process.cwd(),
			command: { file: process.execPath, args: ['-e', 'process.stdout.write("готово"); process.exit(4)'] },
		});

		try {
			const exitCode = await new Promise<number>((resolve) => {
				terminal.onDidWrite((text) => written.push(text));
				terminal.onDidClose?.((code: number | void) => resolve(typeof code === 'number' ? code : -1));
				terminal.open(undefined);
			});

			assert.strictEqual(exitCode, 4);
			assert.strictEqual(outcomes[0]?.exitCode, 4);
			assert.ok(written.join('').includes('process.exit(4)'), `эхо без команды: ${written.join('')}`);
			assert.ok(written.join('').includes('готово'));
		} finally {
			unsubscribe();
		}
	});

	test('переменные запуска ложатся поверх окружения задачи, уборка идёт после выхода', async () => {
		const calls: string[] = [];
		const written: string[] = [];
		const terminal = createVRunnerTaskTerminal({
			name: 'Запуск со своим окружением',
			cwd: process.cwd(),
			env: { TASK_VALUE: 'задача', RUN_VALUE: 'задача' },
			command: () => ({
				command: {
					file: process.execPath,
					args: ['-e', 'process.stdout.write(`${process.env.TASK_VALUE}|${process.env.RUN_VALUE}`)'],
				},
				env: { RUN_VALUE: 'запуск' },
				onExit: () => calls.push('по окончании'),
			}),
		});

		await new Promise<void>((resolve) => {
			terminal.onDidWrite((text) => written.push(text));
			terminal.onDidClose?.(() => resolve());
			terminal.open(undefined);
		});

		assert.ok(written.join('').includes('задача|запуск'), written.join(''));
		assert.deepStrictEqual(calls, ['по окончании']);
	});

	test('отказ запуска программы виден в терминале задачи', async () => {
		const written: string[] = [];
		const terminal = createVRunnerTaskTerminal({
			name: 'Ненайденная программа',
			cwd: process.cwd(),
			command: { file: path.join(os.tmpdir(), 'нет-такой-программы'), args: [] },
		});

		const exitCode = await new Promise<number>((resolve) => {
			terminal.onDidWrite((text) => written.push(text));
			terminal.onDidClose?.((code: number | void) => resolve(typeof code === 'number' ? code : -1));
			terminal.open(undefined);
		});

		assert.strictEqual(exitCode, 1);
		assert.match(written.slice(1).join(''), /ENOENT/);
	});
});

/** Запускает задачу расширения её же псевдотерминалом и ждёт завершения. */
async function runTaskTerminal(name: string, command: string): Promise<number> {
	const terminal = createVRunnerTaskTerminal({ name, command, cwd: process.cwd() });
	return new Promise<number>((resolve) => {
		terminal.onDidClose?.((code: number | void) => resolve(typeof code === 'number' ? code : -1));
		terminal.open(undefined);
	});
}
