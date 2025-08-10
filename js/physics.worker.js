// physics.worker.js
// (Optional) Reserved for future off-thread physics. Not used in 2D fallback version.
// Included to satisfy advanced architecture and future-proofing.
self.onmessage = (e)=>{
  const { cmd } = e.data;
  if(cmd==='ping') postMessage({pong:true});
};