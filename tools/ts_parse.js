const ts = require('typescript');
const fs = require('fs');
const p = 'src/main/video/index.ts';
const s = fs.readFileSync(p,'utf8');
const sf = ts.createSourceFile(p, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const diag = ts.getPreEmitDiagnostics(sf);
console.log('DIAG LENGTH', diag.length);
for(const d of diag){
  const {line, character} = sf.getLineAndCharacterOfPosition(d.start || 0);
  console.log(`${line+1}:${character+1} - ${d.messageText}`);
}
