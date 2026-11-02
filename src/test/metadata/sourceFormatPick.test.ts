import * as assert from 'node:assert';
import { sourceFormatPicks, type SourceFormatSubject } from '../../features/metadata/sourceFormatPick';

const SUBJECTS: readonly SourceFormatSubject[] = ['configuration', 'extension', 'report', 'processor'];

suite('выбор формата исходников', () => {
	test('подписи одни, пояснение называет объект', () => {
		const expected: Record<SourceFormatSubject, [string, string]> = {
			configuration: ['файлы конфигурации', 'проект конфигурации'],
			extension: ['файлы расширения', 'проект расширения'],
			report: ['файл отчёта', 'проект отчёта'],
			processor: ['файл обработки', 'проект обработки'],
		};
		for (const subject of SUBJECTS) {
			const picks = sourceFormatPicks(subject);
			assert.deepStrictEqual(picks.map((pick) => pick.label), [
				'Проект в формате 1С:Конфигуратор',
				'Проект в формате 1С:EDT',
			]);
			assert.deepStrictEqual(picks.map((pick) => pick.format), ['designer', 'edt']);
			assert.deepStrictEqual(picks.map((pick) => pick.description), [...expected[subject]]);
		}
	});
});
