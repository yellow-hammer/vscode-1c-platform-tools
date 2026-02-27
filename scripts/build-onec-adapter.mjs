#!/usr/bin/env node
/**
 * Получение onec-debug-adapter в bin/onec-debug-adapter/.
 *
 * 1. Пытается скачать готовый релиз с GitHub Releases по версии из package.json
 *    (или ONEC_DEBUG_ADAPTER_VERSION).
 * 2. При неудаче (нет сети / нет релиза) падает обратно на локальную сборку:
 *    clone/pull соседнего репозитория onec-debug-adapter + dotnet publish.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'bin', 'onec-debug-adapter');
// Репозиторий для fallback-сборки
const cloneDir = path.join(root, '..', 'onec-debug-adapter');
const repo = 'https://github.com/yellow-hammer/onec-debug-adapter.git';

// Версию DAP берём из package.json (onecDebugAdapter.version),
// приоритетом поверх неё — переменная окружения ONEC_DEBUG_ADAPTER_VERSION.
function getDapVersion() {
	const pkgPath = path.join(root, 'package.json');
	let pkgVersion;

	try {
		const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
		const pkg = JSON.parse(pkgRaw);
		pkgVersion = pkg.onecDebugAdapter?.version;
	} catch {
		// игнорируем, fallback ниже
	}

	return process.env.ONEC_DEBUG_ADAPTER_VERSION ?? pkgVersion ?? 'v0.1.0';
}

const dapVersion = getDapVersion();
const assetName = `onec-debug-adapter-${dapVersion}.zip`;
const repoOwner = 'yellow-hammer';
const repoName = 'onec-debug-adapter';
const downloadUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/${dapVersion}/${assetName}`;

function run(cmd, args, cwd = root) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { cwd, stdio: 'inherit' });
		p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
	});
}

async function downloadFile(url, destPath) {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Не удалось скачать ${url}: ${res.status} ${res.statusText}`);
	}

	const arrayBuffer = await res.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	fs.writeFileSync(destPath, buffer);
}

async function downloadAndExtract() {
	fs.mkdirSync(path.dirname(outDir), { recursive: true });

	const tmpZip = path.join(root, 'bin', assetName);

	console.log(`Загрузка onec-debug-adapter релиза ${dapVersion}...`);
	await downloadFile(downloadUrl, tmpZip);

	console.log('Очистка каталога вывода...');
	fs.rmSync(outDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });

	console.log('Распаковка onec-debug-adapter...');
	// Архив должен содержать каталог "onec-debug-adapter" в корне.
	// Распаковываем в bin/, чтобы получилось bin/onec-debug-adapter/...
	await run('tar', ['-xf', tmpZip, '-C', path.dirname(outDir)]);

	// В VSIX нужен только распакованный каталог, архив можно удалить
	fs.rmSync(tmpZip, { force: true });
}

async function buildFromSource() {
	console.log('Переход на локальную сборку onec-debug-adapter...');

	if (fs.existsSync(cloneDir)) {
		console.log('Обновление onec-debug-adapter...');
		await run('git', ['pull', '--depth', '1'], cloneDir);
	} else {
		console.log('Клонирование onec-debug-adapter...');
		await run('git', ['clone', '--depth', '1', repo, cloneDir]);
	}

	fs.mkdirSync(path.dirname(outDir), { recursive: true });
	console.log('Сборка onec-debug-adapter...');
	await run('dotnet', ['publish', 'onec-debug-adapter.csproj', '-c', 'Release', '-o', outDir], cloneDir);
}

async function main() {
	try {
		await downloadAndExtract();
		console.log('Готово (релиз GitHub):', outDir);
	} catch (err) {
		console.warn('Не удалось получить релиз onec-debug-adapter, причина:\n', err);
		await buildFromSource();
		console.log('Готово (локальная сборка):', outDir);
	}
}

try {
	await main();
} catch (err) {
	console.error(err);
	process.exit(1);
}
