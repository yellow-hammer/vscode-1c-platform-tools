import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/** Условие показа: рабочая область является проектом 1С. */
const IS_PROJECT = '1c-platform-tools.is1CProject == true';

/**
 * Представления, которые нужны и вне проекта 1С.
 *
 * Панель проектов - единственное место, откуда проект открывают, а Debug targets живут
 * по состоянию отладки.
 */
const ALWAYS_AVAILABLE = new Map<string, string>([
	['1c-platform-tools-projects-favorites', 'панель проектов работает без открытого проекта'],
	['1c-platform-tools-projects-all', 'панель проектов работает без открытого проекта'],
	['1c-platform-tools-projects-help', 'панель проектов работает без открытого проекта'],
	['debug.debugTargets', 'показывается по состоянию отладки'],
]);

interface ViewContribution {
	id: string;
	when?: string;
}

function readViews(): ViewContribution[] {
	const raw = fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8');
	const manifest = JSON.parse(raw) as { contributes: { views: Record<string, ViewContribution[]> } };
	return Object.values(manifest.contributes.views).flat();
}

suite('видимость представлений', () => {
	test('вне проекта 1С показываются только представления панели проектов', () => {
		const missing = readViews()
			.filter((view) => !ALWAYS_AVAILABLE.has(view.id))
			.filter((view) => !view.when?.includes(IS_PROJECT))
			.map((view) => view.id);

		assert.deepStrictEqual(
			missing,
			[],
			`без условия «${IS_PROJECT}» остались представления: ${missing.join(', ')}. ` +
				'Контейнер прячется только тогда, когда скрыты все его представления.'
		);
	});

	test('список исключений не разъехался с манифестом', () => {
		const ids = new Set(readViews().map((view) => view.id));
		const stale = [...ALWAYS_AVAILABLE.keys()].filter((id) => !ids.has(id));

		assert.deepStrictEqual(stale, [], `в манифесте нет представлений: ${stale.join(', ')}`);
	});
});
