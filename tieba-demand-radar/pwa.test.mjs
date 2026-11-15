import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname);
test('PWA install assets are present and linked',async()=>{
 const [html,manifest,sw,icon,server]=await Promise.all(['index.html','manifest.webmanifest','sw.js','icon.svg','server.mjs'].map(x=>readFile(path.join(root,x),'utf8')));
 assert.match(html,/<link rel="manifest" href="\/manifest\.webmanifest">/);
 assert.match(html,/apple-mobile-web-app-capable/);
 assert.match(html,/navigator\.serviceWorker\.register\('\/sw\.js'\)/);
 assert.match(manifest,/"display": "standalone"/);
 assert.match(manifest,/"start_url": "\/"/);
 assert.match(sw,/skipWaiting/);
 assert.match(sw,/caches\.match\('\/index\.html'\)/);
 assert.match(icon,/<svg/);
 assert.match(server,/manifest\.webmanifest/);
 assert.match(server,/sw\.js/);
});
