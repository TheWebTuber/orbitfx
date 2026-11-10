// Local-only static server. No uploads, telemetry, or external dependencies.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const port = Number(process.env.STUDIO_PORT || 8787);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.txt':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
  try {
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/content.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.stat(file,(err,stat)=>{
      if(err||!stat.isFile()){res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found. Keep scene-output.html beside content.html.');return;}
      res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache'});
      if(req.method==='HEAD')res.end();else {const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);}
    });
  } catch {res.writeHead(400).end('Invalid request');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Close the other studio server or set STUDIO_PORT.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`OrbitFX Studio beta v3\nEditor: http://127.0.0.1:${port}/content.html\nClean view: http://127.0.0.1:${port}/content.html?clean=1\nKeep this window open. Press Ctrl+C to stop.`));
