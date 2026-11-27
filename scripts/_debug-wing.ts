import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {wingSideAnalysis} from '../src/paper/analysis';
for (const p of Object.values(planes)) {
  const s = replay(papers[0], p.steps.length, p.steps);
  const w = wingSideAnalysis(s);
  console.log(p.id.padEnd(12), 'L', w.leftArea.toFixed(4), 'R', w.rightArea.toFixed(4), 'asym', w.asymmetry.toFixed(3));
}
