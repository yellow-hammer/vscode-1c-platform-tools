import * as assert from 'node:assert';
import * as path from 'node:path';
import { hasConfigurationSources } from '../../features/testing/adapters/xunitAdapter';
import { invalidateProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';
import type { VRunnerManager } from '../../shared/vrunnerManager';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures');

/** Раннер, знающий только корень рабочей области. */
function vrunnerAt(workspaceRoot: string): VRunnerManager {
	return { getWorkspaceRoot: () => workspaceRoot } as unknown as VRunnerManager;
}

suite('конфигурация в рабочей области', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	test('есть у выгрузки конфигуратора и у проекта EDT, нет там, где исходного кода нет', async () => {
		assert.strictEqual(await hasConfigurationSources(vrunnerAt(path.join(FIXTURES, 'projectLayout', 'designer'))), true);
		assert.strictEqual(await hasConfigurationSources(vrunnerAt(path.join(FIXTURES, 'projectLayout', 'edt-workspace'))), true);
		assert.strictEqual(await hasConfigurationSources(vrunnerAt(path.join(FIXTURES, 'projectLayout', 'edt-workspace', 'ssl31'))), true);
		assert.strictEqual(await hasConfigurationSources(vrunnerAt(path.join(FIXTURES, 'infobases'))), false);
	});
});
