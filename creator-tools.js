(function(){
  var money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0});
  function id(x){return document.getElementById(x)}
  function calc(){
    var reach=Number(id('reach').value)||0, lead=Number(id('leadRate').value)||0, close=Number(id('closeRate').value)||0, price=Number(id('price').value)||0;
    var leads=Math.round(reach*lead/100), customers=Math.round(leads*close/100), revenue=customers*price;
    id('revenueResult').textContent=money.format(revenue);
    id('revenueMeta').textContent=leads+' leads · '+customers+' customers';
  }
  ['reach','leadRate','closeRate','price'].forEach(function(k){id(k).addEventListener('input',calc)});
  calc();

  var built='';
  id('buildUtm').addEventListener('click',function(){
    try{
      var raw=id('baseUrl').value.trim();
      if(!raw) throw new Error('Enter a destination URL first.');
      var u=new URL(raw);
      u.searchParams.set('utm_source','instagram');
      u.searchParams.set('utm_medium','social');
      u.searchParams.set('utm_campaign',(id('campaign').value.trim()||'nudge-campaign').toLowerCase().replace(/[^a-z0-9-_]+/g,'-'));
      u.searchParams.set('utm_content',(id('content').value.trim()||'post').toLowerCase().replace(/[^a-z0-9-_]+/g,'-'));
      built=u.toString(); id('utmOutput').textContent=built; id('copyUtm').disabled=false;
    }catch(e){id('utmOutput').textContent=e.message}
  });
  id('copyUtm').addEventListener('click',async function(){
    if(!built)return;
    try{await navigator.clipboard.writeText(built);id('copyUtm').textContent='Copied';setTimeout(function(){id('copyUtm').textContent='Copy link'},1200)}
    catch(e){id('utmOutput').textContent='Copy failed. Select the link and copy it manually.'}
  });

  id('generateCta').addEventListener('click',function(){
    var offer=id('offer').value.trim()||'my offer', keyword=id('keyword').value.trim()||'INFO';
    id('ctaOutput').textContent='Comment '+keyword.toUpperCase()+' and I\'ll send you the details for '+offer+'.';
  });

  var ideas=JSON.parse(localStorage.getItem('nudge_creator_ideas')||'[]');
  function renderIdeas(){
    var list=id('ideaList');list.innerHTML='';
    ideas.slice().reverse().forEach(function(idea,idx){
      var row=document.createElement('div');row.className='idea-row';
      var text=document.createElement('span');text.textContent=idea;
      var b=document.createElement('button');b.className='btn btn-ghost';b.textContent='Delete';b.addEventListener('click',function(){
        var realIndex=ideas.length-1-idx;ideas.splice(realIndex,1);localStorage.setItem('nudge_creator_ideas',JSON.stringify(ideas));renderIdeas();
      });
      row.appendChild(text);row.appendChild(b);list.appendChild(row);
    });
  }
  id('saveIdea').addEventListener('click',function(){
    var value=id('ideaInput').value.trim();if(!value)return;
    ideas.push(value);localStorage.setItem('nudge_creator_ideas',JSON.stringify(ideas));id('ideaInput').value='';renderIdeas();
  });
  renderIdeas();
})();