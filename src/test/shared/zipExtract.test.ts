import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ZipFile } from 'yazl';
import { extractZip, safeEntryPath } from '../../shared/zipExtract';

interface ArchiveEntry {
	name: string;
	content?: string;
	/** Режим записи для внешних атрибутов: права и тип (ссылка). */
	mode?: number;
}

function tempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Собирает архив с произвольными записями, включая такие, каких обычный упаковщик не делает. */
async function writeArchive(file: string, entries: ArchiveEntry[]): Promise<void> {
	const zip = new ZipFile();
	for (const entry of entries) {
		zip.addBuffer(Buffer.from(entry.content ?? ''), entry.name, { mode: entry.mode });
	}
	zip.end();
	await new Promise<void>((resolve, reject) => {
		const out = fs.createWriteStream(file);
		zip.outputStream.pipe(out).on('close', resolve).on('error', reject);
	});
}

suite('распаковка zip', () => {
	test('путь наружу каталога не проходит проверку', () => {
		const root = path.join(os.tmpdir(), '1cpt-zip-root');
		assert.strictEqual(safeEntryPath(root, '../evil.txt'), undefined);
		assert.strictEqual(safeEntryPath(root, 'a/../../evil.txt'), undefined);
		assert.strictEqual(safeEntryPath(root, '/etc/passwd'), undefined);
		assert.strictEqual(safeEntryPath(root, 'a/../b.txt'), path.join(root, 'b.txt'));
		assert.strictEqual(safeEntryPath(root, 'sub/file.txt'), path.join(root, 'sub', 'file.txt'));
	});

	test('обычный архив распаковывается', async () => {
		const work = tempDir('1cpt-zip-ok-');
		const archive = path.join(work, 'component.zip');
		await writeArchive(archive, [
			{ name: 'component/readme.txt', content: 'привет' },
			{ name: 'component/bin/tool', content: '#!/bin/sh', mode: 0o100755 },
		]);

		const out = path.join(work, 'out');
		await extractZip(archive, out);

		assert.strictEqual(fs.readFileSync(path.join(out, 'component/readme.txt'), 'utf8'), 'привет');
		const tool = path.join(out, 'component/bin/tool');
		assert.ok(fs.existsSync(tool));
		if (process.platform !== 'win32') {
			assert.ok((fs.statSync(tool).mode & 0o111) !== 0, 'право на выполнение должно сохраниться');
		}
	});

	test('запись за пределы каталога прерывает распаковку', async () => {
		const work = tempDir('1cpt-zip-traversal-');
		const archive = path.join(work, 'evil.zip');
		// Упаковщик не даёт записать путь с «..», поэтому имя подменяется в готовом архиве:
		// длина совпадает, поэтому смещения записей остаются верными.
		const placeholder = 'zz/zz/evil.txt';
		const traversal = '../../evil.txt';
		await writeArchive(archive, [
			{ name: 'component/readme.txt', content: 'ок' },
			{ name: placeholder, content: 'чужой файл' },
		]);
		const patched = fs.readFileSync(archive).toString('binary').split(placeholder).join(traversal);
		fs.writeFileSync(archive, Buffer.from(patched, 'binary'));

		const out = path.join(work, 'out');
		// Такое имя отсекает уже разбор архива, до нашей проверки пути.
		await assert.rejects(() => extractZip(archive, out), /ведёт за пределы каталога|invalid relative path/);
		assert.ok(!fs.existsSync(path.join(work, 'evil.txt')), 'файл не должен появиться рядом с каталогом');
	});

	test('символьные ссылки пропускаются', async () => {
		const work = tempDir('1cpt-zip-symlink-');
		const archive = path.join(work, 'link.zip');
		await writeArchive(archive, [
			{ name: 'component/readme.txt', content: 'ок' },
			// Ссылка наружу: содержимое записи - путь, куда она указывает.
			{ name: 'component/passwd', content: '../../../../etc/passwd', mode: 0o120777 },
		]);

		const out = path.join(work, 'out');
		await extractZip(archive, out);

		assert.ok(fs.existsSync(path.join(out, 'component/readme.txt')));
		assert.ok(!fs.existsSync(path.join(out, 'component/passwd')), 'ссылка не должна создаваться');
	});
});
