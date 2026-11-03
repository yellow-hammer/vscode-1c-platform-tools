/**
 * Дерево зависимостей OneScript и разбор отчётов depos.
 * Запуск: npm run test:node
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { parseDeposCheck, parseDeposDoctor } from '../../features/dependencies/deposReport';
import {
	buildDependencyForest,
	dependencyReport,
	dependencySummary,
	dependencyVersionLabel,
	flattenDependencyNodes,
} from '../../features/dependencies/dependencyModel';
import { readInstalledPackages } from '../../features/dependencies/installedPackages';
import { parsePackagedef } from '../../shared/packagedef';

function repositoryRoot(): string {
	let dir = __dirname;
	while (!fs.existsSync(path.join(dir, 'package.json'))) {
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error('Не найден корень репозитория');
		}
		dir = parent;
	}
	return dir;
}

const ROOT = path.join(repositoryRoot(), 'src', 'test', 'fixtures', 'depos');
const PROJECT = path.join(ROOT, 'project');

describe('зависимости OneScript', () => {
	test('установленные пакеты читаются из opm-metadata, bin пропускается', () => {
		const packages = readInstalledPackages(PROJECT);
		assert.deepEqual(packages.map((item) => item.name), ['autumn', 'entity', 'logos', 'stray']);
		const autumn = packages.find((item) => item.name === 'autumn');
		assert.equal(autumn?.version, '5.0.0');
		assert.deepEqual(autumn?.dependencies.map((item) => item.name), ['entity', 'logos']);
		assert.equal(autumn?.dependencies.find((item) => item.name === 'logos')?.dev, true);
		const logos = packages.find((item) => item.name === 'logos');
		assert.equal(logos?.dependencies[0]?.name, 'strings');
		assert.equal(logos?.dependencies[0]?.version, '0.4.0');
	});

	test('каталог без opm-metadata в список не попадает', () => {
		assert.deepEqual(readInstalledPackages(path.join(ROOT, 'missing')), []);
	});

	test('check отличает доступное обновление от той же версии', () => {
		const updates = parseDeposCheck(fs.readFileSync(path.join(ROOT, 'check.json'), 'utf8'));
		assert.ok(updates);
		assert.equal(updates.get('autumn')?.targetMin, '5.1.2');
		assert.equal(updates.get('oneunit')?.currentMin, updates.get('oneunit')?.targetMin);
		assert.equal(parseDeposCheck('не json'), undefined);
	});

	test('doctor раскладывает проблемы, цепочку и рекомендацию', () => {
		const problems = parseDeposDoctor(fs.readFileSync(path.join(ROOT, 'doctor.json'), 'utf8'));
		assert.ok(problems);
		assert.equal(problems.get('oneunit')?.problems[0]?.text, 'не установлен');
		assert.equal(problems.get('entity')?.problems[0]?.text, 'конфликт версий');
		assert.match(problems.get('entity')?.problems[0]?.detail ?? '', /autumn → entity/);
		assert.equal(problems.get('strings')?.name, 'strings');
		assert.equal(problems.get('autumn')?.problems[0]?.severity, 'hint');
		assert.equal(parseDeposDoctor('{}'), undefined);
	});

	test('дерево показывает, кто кого затянул, версии и проблемы', () => {
		const declared = parsePackagedef(fs.readFileSync(path.join(PROJECT, 'packagedef'), 'utf8')).dependencies;
		const installed = readInstalledPackages(PROJECT);
		const updates = parseDeposCheck(fs.readFileSync(path.join(ROOT, 'check.json'), 'utf8'));
		const problems = parseDeposDoctor(fs.readFileSync(path.join(ROOT, 'doctor.json'), 'utf8'));
		assert.ok(updates);
		assert.ok(problems);
		const forest = buildDependencyForest(declared, installed, updates, problems);

		assert.deepEqual(forest.packages.map((item) => item.name), ['autumn', 'oneunit']);
		const autumn = forest.packages[0];
		assert.equal(autumn?.outdated, true);
		assert.equal(autumn?.available, '5.1.2');
		assert.equal(dependencyVersionLabel(autumn!), '5.0.0 → 5.1.2');
		assert.deepEqual(autumn?.children.map((item) => item.name), ['entity', 'logos']);
		const entity = autumn?.children.find((item) => item.name === 'entity');
		assert.deepEqual(entity?.via, ['autumn']);
		assert.equal(entity?.problems[0]?.text, 'конфликт версий');
		assert.equal(entity?.direct, false);
		const logos = autumn?.children.find((item) => item.name === 'logos');
		assert.equal(logos?.dev, true);
		assert.deepEqual(logos?.children.map((item) => item.name), []);

		const oneunit = forest.packages[1];
		assert.equal(oneunit?.dev, true);
		assert.equal(oneunit?.installed, undefined);
		assert.equal(oneunit?.problems.filter((item) => item.text === 'не установлен').length, 1);
		assert.match(dependencyVersionLabel(oneunit!), /не установлен/);

		assert.deepEqual(forest.extra.map((item) => item.name), ['stray']);
		assert.deepEqual(forest.notes.map((item) => item.name), ['strings']);

		const summary = dependencySummary(flattenDependencyNodes(forest), { checked: true, diagnosed: true });
		assert.match(summary, /проблем/);
		const report = dependencyReport(forest);
		assert.equal(report.find((item) => item.name === 'entity')?.via[0], 'autumn');
		assert.deepEqual(report.find((item) => item.name === 'autumn')?.hints, ['ограничение версии лишнее']);
	});
});
