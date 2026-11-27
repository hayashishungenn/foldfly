import {makeInstance, customInstance, checkFoldCompatibility, resolveInstance} from '../src/paper/instance';
import {planes} from '../src/fold/planes';
for (const id of ['a3', 'a4', 'a6'] as const) {
  const inst = makeInstance(id, 'copy', 80);
  const r = resolveInstance(inst);
  console.log(id, 'area', r.areaM2.toFixed(4), 'mass', (r.massKg * 1000).toFixed(2), 'g');
  for (const p of Object.values(planes)) {
    const c = checkFoldCompatibility(inst, p.steps);
    if (!c.ok) console.log('  INCOMPAT', p.id, c.reason);
  }
}
const custom = customInstance(0.2, 0.3, 'news', 70);
console.log('custom ok', resolveInstance(custom).massKg);
