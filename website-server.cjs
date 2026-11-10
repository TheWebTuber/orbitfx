// Local-only static server for the website + embedded editor. No external packages.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname, port=Number(process.env.PORT||8790);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.cjs':'text/plain; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.zip':'application/zip','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const relative=pathname==='/'?'/index.html':pathname;
  const target=path.resolve(root,'.'+relative);
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.stat(target,(err,stat)=>{
   if(err||!stat.isFile()){res.writeHead(404).end('Not found');return;}
   res.writeHead(200,{'Content-Type':mime[path.extname(target).toLowerCase()]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
   if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);
  });
 }catch{res.writeHead(400).end('Bad request');}
}).listen(port,'127.0.0.1',()=>console.log('OrbitFX website: http://127.0.0.1:'+port+'/'));
