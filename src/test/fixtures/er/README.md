# ER-фикстуры

Реальные подграфы метаданных, выгруженные через `md-sparrow cf-md-graph` из типовых
конфигураций. Используются в `src/test/metadata/er.test.ts` для тестов фильтров и
экспортёров без синтетических литералов в коде тестов.

## ssl31-anketirovanie.json

Подграф вокруг подсистемы `_ДемоАнкетирование` из SSL3.1 (1-hop соседей):
24 узла, 48 рёбер, ~26 KB. Покрывает виды связей `subsystemMembership`,
`subsystemNesting`, `catalogOwners`, `typeComposite`, `valueType`,
`roleObjectRights`, `functionalOptionLocation`, `functionalOptionAffected`.

`projectRoot` намеренно заменён на `fixture://ssl_3_1`, чтобы фикстура была
переносимой между машинами.

### Регенерация

Требуется собранный `md-sparrow` JAR и склонированный соседний репозиторий
`ssl_3_1` (см. `../ssl_3_1`).

```powershell
$jar  = "../../../../../md-sparrow/build/libs/md-sparrow-0.1.0-all.jar"
$ssl  = "../../../../../../ssl_3_1"
$out  = "src/test/fixtures/er/ssl31-anketirovanie.json"

java -jar $jar cf-md-graph $ssl > full.json
node -e "
const g = require('./full.json');
const seed = 'Subsystem._ДемоАнкетирование';
const keep = new Set([seed]);
const adj = new Map();
for (const e of g.edges) {
  if (!adj.has(e.sourceKey)) adj.set(e.sourceKey, []);
  if (!adj.has(e.targetKey)) adj.set(e.targetKey, []);
  adj.get(e.sourceKey).push(e.targetKey);
  adj.get(e.targetKey).push(e.sourceKey);
}
for (const k of [seed]) for (const n of (adj.get(k) || [])) keep.add(n);
const nodes = g.nodes.filter(n => keep.has(n.key));
const edges = g.edges.filter(e => keep.has(e.sourceKey) && keep.has(e.targetKey));
require('fs').writeFileSync('$out', JSON.stringify({
  projectRoot: 'fixture://ssl_3_1',
  mainSchemaVersion: g.mainSchemaVersion,
  mainSchemaVersionFlag: g.mainSchemaVersionFlag,
  nodeCount: nodes.length,
  edgeCount: edges.length,
  nodes, edges,
}, null, 2));
"
Remove-Item full.json
```

При обновлении контракта `cf-md-graph` или существенных изменений SSL3.1 —
регенерируй фикстуру и проверь, что тесты проходят.
