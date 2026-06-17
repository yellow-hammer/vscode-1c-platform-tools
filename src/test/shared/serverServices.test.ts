import * as assert from 'node:assert';
import { extractPublishableServices } from '../../features/launch/serverServices';
import type { ProjectMetadataTreeDto } from '../../features/metadata/metadataTreeService';

function tree(partial: Partial<ProjectMetadataTreeDto>): ProjectMetadataTreeDto {
	return {
		projectRoot: '/p',
		mainSchemaVersion: '',
		mainSchemaVersionFlag: '',
		sources: [],
		...partial,
	} as ProjectMetadataTreeDto;
}

suite('serverServices', () => {
	test('extractPublishableServices: собирает HTTP и Web из групп и подгрупп', () => {
		const dto = tree({
			sources: [
				{
					kind: 'cf',
					id: 'main',
					label: 'Конфигурация',
					configurationXmlRelativePath: '',
					metadataRootRelativePath: '',
					groups: [
						{
							id: 'httpServices',
							label: 'HTTP-сервисы',
							iconHint: '',
							items: [
								{ objectType: 'HTTPService', name: 'Платежи', relativePath: 'a' },
								{ objectType: 'HTTPService', name: 'ОбменДанными', relativePath: 'b' },
							],
						},
						{
							id: 'webServices',
							label: 'Web-сервисы',
							iconHint: '',
							items: [],
							subgroups: [
								{
									id: 'sub',
									label: 'Подгруппа',
									iconHint: '',
									items: [{ objectType: 'WebService', name: 'ОбменWS', relativePath: 'c' }],
								},
							],
						},
						{
							id: 'catalogs',
							label: 'Справочники',
							iconHint: '',
							items: [{ objectType: 'Catalog', name: 'Номенклатура', relativePath: 'd' }],
						},
					],
				},
			],
		});

		const result = extractPublishableServices(dto);
		assert.deepStrictEqual(result.http, ['ОбменДанными', 'Платежи']); // отсортировано
		assert.deepStrictEqual(result.web, ['ОбменWS']);
	});

	test('extractPublishableServices: пустое дерево → пустые списки', () => {
		const result = extractPublishableServices(tree({ sources: [] }));
		assert.deepStrictEqual(result, { web: [], http: [] });
	});

	test('extractPublishableServices: дедупликация между источниками', () => {
		const mkSource = (id: string) => ({
			kind: 'cf',
			id,
			label: id,
			configurationXmlRelativePath: '',
			metadataRootRelativePath: '',
			groups: [
				{
					id: 'httpServices',
					label: 'HTTP',
					iconHint: '',
					items: [{ objectType: 'HTTPService', name: 'Общий', relativePath: 'x' }],
				},
			],
		});
		const dto = tree({ sources: [mkSource('main'), mkSource('ext')] });
		assert.deepStrictEqual(extractPublishableServices(dto).http, ['Общий']);
	});
});
