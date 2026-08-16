const fs=require('fs');
const path='src/main/ipc.ts';
const s=fs.readFileSync(path,'utf8');
const open='({[';
const close=')}]';
const stack=[];
for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(open.includes(ch)) stack.push({ch, i});
  else if(close.includes(ch)){
    const top = stack.pop();
    if(!top){
      console.log('Unmatched closer', ch, 'at', i);
      console.log(s.slice(Math.max(0,i-80), i+80));
      process.exit(0);
    }
    const match = (open.indexOf(top.ch) === close.indexOf(ch));
    if(!match){
      console.log('Mismatched pair at', i, 'found', ch, 'expected', close[open.indexOf(top.ch)]);
      console.log('Top was', top);
      console.log(s.slice(Math.max(0,i-80), i+80));
      process.exit(0);
    }
  }
}
if(stack.length){
  console.log('Unclosed tokens left:', stack.slice(-10).map(x=>({ch:x.ch,i:x.i,line:s.slice(0,x.i).split('\n').length})).reverse());
  const last = stack[stack.length-1];
  const line = s.slice(0,last.i).split('\n').length;
  console.log('Context around last open (index', last.i, 'line', line, '):');
  console.log(s.split('\n').slice(Math.max(0,line-6), line+8).map((l,ix)=>`${line-5+ix}: ${l}`).join('\n'));
} else {
  console.log('All balanced');
}
