import * as assert from 'node:assert';
import { parseMdBoilerplateKindFromCommandArgs } from '../../metadataBoilerplateNames';

suite('metadataBoilerplateNames', () => {
	test('читает kind напрямую из аргументов', () => {
		const kind = parseMdBoilerplateKindFromCommandArgs(['DOCUMENT']);
		assert.strictEqual(kind, 'DOCUMENT');
	});

	test('определяет kind по contextValue группы дерева', () => {
		const kind = parseMdBoilerplateKindFromCommandArgs([{ contextValue: 'metadataGroup_reports' }]);
		assert.strictEqual(kind, 'REPORT');
	});

	test('определяет kind CATALOG по contextValue группы справочников', () => {
		const kind = parseMdBoilerplateKindFromCommandArgs([{ contextValue: 'metadataGroup_catalogs' }]);
		assert.strictEqual(kind, 'CATALOG');
	});

	test('определяет kind по contextValue групп внешних артефактов', () => {
		const reportKind = parseMdBoilerplateKindFromCommandArgs([
			{ contextValue: 'metadataGroup_externalReports' }
		]);
		const processorKind = parseMdBoilerplateKindFromCommandArgs([
			{ contextValue: 'metadataGroupExt_externalDataProcessors' }
		]);
		assert.strictEqual(reportKind, 'REPORT');
		assert.strictEqual(processorKind, 'DATA_PROCESSOR');
	});

	test('определяет kind по contextValue подгруппы дерева', () => {
		const kind = parseMdBoilerplateKindFromCommandArgs([
			{ contextValue: 'metadataSubgroup_common_common_subsystem' }
		]);
		assert.strictEqual(kind, 'SUBSYSTEM');
	});
});
