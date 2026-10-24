/**
 * Окружения запуска по файлам `.env` корня проекта.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildEnvironments,
	environmentFiles,
	environmentLabel,
	isEnvironmentId,
	newEnvironmentText,
	parseEnvironmentFileName,
} from '../../shared/environments';

describe('environments', () => {
	test('.env.<id> и .env.<id>.local — окружение <id>; общие файлы и образцы — нет', () => {
		assert.equal(parseEnvironmentFileName('.env.dev'), 'dev');
		assert.equal(parseEnvironmentFileName('.env.dev.local'), 'dev');
		assert.equal(parseEnvironmentFileName('.env.ci.linux'), 'ci.linux');
		for (const name of ['.env', '.env.local', '.env.example', '.env.sample.local', '.env.', 'env.ci', '.envrc']) {
			assert.equal(parseEnvironmentFileName(name), undefined, name);
		}
		assert.equal(isEnvironmentId('stage'), true);
		assert.equal(isEnvironmentId('local'), false);
		assert.equal(isEnvironmentId('example'), false);
	});

	test('общие файлы действуют в каждом окружении, личный поверх общего', () => {
		assert.deepEqual(environmentFiles(), ['.env', '.env.local']);
		assert.deepEqual(environmentFiles('ci'), ['.env', '.env.local', '.env.ci', '.env.ci.local']);
	});

	test('окружения проекта по файлам корня, по алфавиту, с найденными файлами', () => {
		assert.deepEqual(
			buildEnvironments(['.env', '.env.test.local', '.env.ci', 'env.json', '.env.example', '.env.test']),
			[
				{ id: 'ci', files: ['.env.ci'] },
				{ id: 'test', files: ['.env.test', '.env.test.local'] },
			]
		);
	});

	test('подпись как у профиля: имя выбранного, без выбранного — «По умолчанию» или «Нет файла окружения»', () => {
		assert.equal(environmentLabel('ci', ['.env.ci']), 'ci');
		assert.equal(environmentLabel(undefined, ['.env']), 'По умолчанию');
		assert.equal(environmentLabel(undefined, ['.env.local']), 'По умолчанию');
		assert.equal(environmentLabel(undefined, []), 'Нет файла окружения');
	});

	test('новый файл перечисляет переменные из кода закомментированными', () => {
		assert.equal(newEnvironmentText([]), '# ИМЯ=значение\n');
		assert.equal(
			newEnvironmentText(['DB_HOST', 'RUN_INTEGRATION']),
			'# Переменные, которые читает код проекта\n# DB_HOST=\n# RUN_INTEGRATION=\n'
		);
	});
});
