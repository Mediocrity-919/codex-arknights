import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadProxyEnvironment} from '../src/download-network.mjs';

test('downloads follow enabled Windows proxies and always bypass local theme endpoints',()=>{
  const proxy=downloadProxyEnvironment({}, {enabled:true,server:'127.0.0.1:7890',bypass:'<local>;*.example.test'});
  assert.equal(proxy.HTTPS_PROXY,'http://127.0.0.1:7890');assert.equal(proxy.HTTP_PROXY,proxy.HTTPS_PROXY);
  for(const value of ['localhost','127.0.0.1','::1','*.example.test'])assert.ok(proxy.NO_PROXY.split(',').includes(value));
  const split=downloadProxyEnvironment({}, {enabled:true,server:'http=one.example:80;https=two.example:81;socks=ignored.example:82'});
  assert.equal(split.HTTP_PROXY,'http://one.example:80');assert.equal(split.HTTPS_PROXY,'http://two.example:81');
  const disabled=downloadProxyEnvironment({}, {enabled:false,server:'stale.example:80'});assert.equal(disabled.HTTPS_PROXY,'');
  const explicit=downloadProxyEnvironment({HTTPS_PROXY:'http://custom.example:8080',NO_PROXY:'internal.example'}, {enabled:true,server:'system.example:80'});
  assert.equal(explicit.HTTPS_PROXY,'http://custom.example:8080');assert.equal(explicit.HTTP_PROXY,'');assert.ok(explicit.NO_PROXY.includes('internal.example'));
});
