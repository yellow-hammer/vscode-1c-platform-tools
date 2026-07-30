import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/**
 * Сообщения, которые остаются всплывающим окном осознанно: инструкция к
 * действию, длинное пояснение или подсказка, что делать дальше.
 */
const ALLOWED = [
	'Команды скопированы',
	'Проект 1С создан. Открываю папку',
	'Создан autumn-properties.json. Перенести настройки',
	'Навыки разработки 1С',
	'Установлено навыков расширения',
	'Добавление задачи',
	'Выберите группу метаданных',
	'Нет сохранённых проектов',
];

/** Признак рутинного подтверждения: «сделано и всё». */
const ROUTINE = /обновл|создан|удал|очищ|сохран|выполнен|готов|установлен|добавлен|скопирован|перемещ/i;

/** Файлы исходников расширения без тестов. */
function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (path.relative(EXTENSION_ROOT, full) === path.join('src', 'test')) {
				continue;
			}
			sourceFiles(full, found);
		} else if (entry.name.endsWith('.ts')) {
			found.push(full);
		}
	}
	return found;
}

suite('уведомления: рутина без всплывающих окон', () => {
	test('подтверждение рутинного действия идёт в строку состояния', () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(path.join(EXTENSION_ROOT, 'src'))) {
			const text = fs.readFileSync(file, 'utf8');
			for (const match of text.matchAll(/showInformationMessage\(\s*([`'"])([\s\S]*?)\1([\s\S]{0,20})/g)) {
				const message = match[2];
				const tail = match[3].trimStart();
				const hasButtons = tail.startsWith(',');
				if (!ROUTINE.test(message) || hasButtons) {
					continue;
				}
				if (ALLOWED.some((allowed) => message.includes(allowed))) {
					continue;
				}
				const line = text.slice(0, match.index).split('\n').length;
				offenders.push(`${path.relative(EXTENSION_ROOT, file)}:${line} — ${message.slice(0, 60)}`);
			}
		}
		assert.deepStrictEqual(
			offenders,
			[],
			`используйте notifyQuiet вместо всплывающего окна:\n${offenders.join('\n')}`
		);
	});

	test('строка состояния сообщает и пишет в журнал', () => {
		const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'shared', 'notify.ts'), 'utf8');
		assert.ok(source.includes('setStatusBarMessage'), 'notifyQuiet должен писать в строку состояния');
		assert.ok(source.includes('log.info'), 'notifyQuiet должен оставлять след в журнале');
	});
});
