export const taskNodeSource = `
const args=process.argv.slice(1);
let index=0,mode="file",inputType="commonjs";
while(index<args.length && args[index].startsWith("-")){
 const flag=args[index++];
 if(flag==="-e"||flag==="--eval"){mode="eval";break;}
 if(flag==="-p"||flag==="--print"){mode="print";break;}
 if(flag==="--input-type=module"){inputType="module";continue;}
 if(flag==="--input-type=commonjs")continue;
 if(flag==="--version"||flag==="-v"){console.log(process.version);process.exit(0);}
 throw new Error("Node task option is not supported: "+flag);
}
const entry=args[index++];
if(entry===undefined)throw new Error("A Node task needs a file or eval expression. Use Terminal for an interactive REPL.");
if(mode!=="file"){
 process.argv=["node",...args.slice(index)];
 if(inputType==="module"){
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const result=await new AsyncFunction(mode==="print"?"return ("+entry+")":entry)();
  if(mode==="print")console.log(result);
 }else{
  const result=new Function(mode==="print"?"return ("+entry+")":entry)();
  if(mode==="print")console.log(result);
 }
}else{
 const path=require("node:path").resolve(process.cwd(),entry);
 process.argv=["node",path,...args.slice(index)];
 let esm=path.endsWith(".mjs");
 if(!path.endsWith(".cjs")){
  let directory=require("node:path").dirname(path);
  for(let depth=0;depth<64;depth++){
   const manifest=directory+"/package.json";
   if(globalThis.__fs.exists(manifest)){esm=JSON.parse(globalThis.__fs.readFile(manifest)).type==="module";break;}
   if(directory==="/")break;directory=require("node:path").dirname(directory);
  }
 }
 if(esm)await globalThis.__import__(path);else require(path);
}
`;
