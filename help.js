(function(){
  var form=document.getElementById('helpForm'), input=document.getElementById('helpInput'), box=document.getElementById('helpMessages');
  if(!form||!input||!box)return;
  function add(text){var p=document.createElement('p');p.innerHTML='<strong>Nudge Help Desk:</strong> ';var span=document.createElement('span');span.textContent=text;p.appendChild(span);box.appendChild(p);box.scrollTop=box.scrollHeight;}
  form.addEventListener('submit',async function(e){
    e.preventDefault();var message=input.value.trim();if(!message)return;
    var user=document.createElement('p');user.innerHTML='<strong>You:</strong> ';var span=document.createElement('span');span.textContent=message;user.appendChild(span);box.appendChild(user);
    input.value='';input.disabled=true;
    try{
      var r=await fetch('/api/support/chat',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({message:message})});
      var data=await r.json().catch(function(){return{};});
      if(!r.ok)throw new Error(data.error||'Support is temporarily unavailable.');
      add(data.reply||'Please email nudge.support360@gmail.com for help.');
    }catch(err){add(err.message+' Email nudge.support360@gmail.com if you need human support.');}
    finally{input.disabled=false;input.focus();}
  });
})();