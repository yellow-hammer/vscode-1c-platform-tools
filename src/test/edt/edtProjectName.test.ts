import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { edtProjectName } from '../../features/edt/edtRunner';

/** Каталог проекта с описанием Eclipse. */
function project(name?: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-проект-'));
	if (name !== undefined) {
		fs.writeFileSync(
			path.join(dir, '.project'),
			`<?xml version="1.0" encoding="UTF-8"?>\n<projectDescription>\n\t<name>${name}</name>\n</projectDescription>\n`
		);
	}
	return dir;
}

suite('имя проекта EDT', () => {
	test('берётся из .project, а не из имени каталога', () => {
		const dir = project('УчетАрхитектора-02-04');

		assert.strictEqual(edtProjectName(dir), 'УчетАрхитектора-02-04');
		assert.notStrictEqual(edtProjectName(dir), path.basename(dir));
	});

	test('без .project остаётся имя каталога', () => {
		const dir = project();

		assert.strictEqual(edtProjectName(dir), path.basename(dir));
	});

	test('пустое имя в описании не подменяет каталог', () => {
		const dir = project('   ');

		assert.strictEqual(edtProjectName(dir), path.basename(dir));
	});
});
