// Paste into the browser console (F12) on the vendor's web driver page, BEFORE pressing its Connect button.
// It only records HID traffic in memory. Nothing is sent anywhere. Run ksSave() to download the capture.
// No backticks on purpose: chat apps strip them when the text is copied.
(function(){
  var L=[],t0=performance.now(),P=HIDDevice.prototype;
  function now(){return ((performance.now()-t0)/1000).toFixed(3);}
  function bytes(d){return d instanceof ArrayBuffer?new Uint8Array(d):new Uint8Array(d.buffer,d.byteOffset,d.byteLength);}
  function hex(u){return Array.from(u,function(x){return x.toString(16).padStart(2,'0');}).join(' ');}
  function log(k,id,d){var u=bytes(d);L.push(now()+' '+k+' id='+id+' len='+u.length+' '+hex(u));}
  function wrap(name,kind){var orig=P[name];P[name]=function(id,data){log(kind,id,data);return orig.call(this,id,data);};}
  wrap('sendReport','tx');wrap('sendFeatureReport','tx-feature');
  var rf=P.receiveFeatureReport;
  P.receiveFeatureReport=async function(id){var v=await rf.call(this,id);log('rx-feature',id,v);return v;};
  function listen(d){if(d.__ks)return;d.__ks=1;L.push('# device vid='+d.vendorId.toString(16)+' pid='+d.productId.toString(16)+' '+d.productName);d.addEventListener('inputreport',function(e){log('rx',e.reportId,e.data);});}
  var open=P.open;P.open=async function(){var r=await open.call(this);listen(this);return r;};
  navigator.hid.getDevices().then(function(ds){ds.filter(function(d){return d.opened;}).forEach(listen);});
  window.ksMark=function(text){L.push(now()+' ### '+text);};
  window.ksSave=function(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([L.join('\n')],{type:'text/plain'}));a.download='hid-capture.txt';a.click();return L.length+' lines saved';};
  console.log('HID capture is on. Use ksMark("what I am about to do") before each action, ksSave() at the end.');
})();
