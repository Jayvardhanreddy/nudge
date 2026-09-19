(function(){
  'use strict';

  var money = new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0});
  var KEYS = {
    ideas:'nudge_creator_ideas',
    calendar:'nudge_creator_calendar',
    deals:'nudge_creator_deals',
    affiliates:'nudge_creator_affiliates',
    collabs:'nudge_creator_collabs',
    goals:'nudge_creator_goals',
    rate:'nudge_creator_rate',
    media:'nudge_creator_media'
  };

  function $(id){ return document.getElementById(id); }
  function read(key,fallback){
    try { var v=JSON.parse(localStorage.getItem(key)); return v==null?fallback:v; }
    catch(e){ return fallback; }
  }
  function write(key,value){ localStorage.setItem(key,JSON.stringify(value)); }
  function uid(){ return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())+'-'+Math.random().toString(36).slice(2); }
  function value(id){ return ($(id) && $(id).value || '').trim(); }
  function num(id){ var n=Number($(id) && $(id).value); return Number.isFinite(n)?n:0; }
  function escText(v){ return String(v==null?'':v); }
  function notify(message){
    var box=$('creatorNotice');
    if(!box)return;
    box.textContent=message; box.hidden=false;
    clearTimeout(notify.timer); notify.timer=setTimeout(function(){box.hidden=true;},2600);
  }
  function showError(message){
    var box=$('dashboardError'); if(!box)return;
    box.textContent=message; box.classList.add('show');
  }
  function clearError(){ var box=$('dashboardError'); if(box){box.textContent='';box.classList.remove('show');} }

  function copyText(text,button){
    if(!text)return;
    function done(){
      if(!button)return;
      var old=button.textContent; button.textContent='Copied';
      setTimeout(function(){button.textContent=old;},1200);
    }
    if(navigator.clipboard && window.isSecureContext){
      navigator.clipboard.writeText(text).then(done).catch(function(){fallbackCopy(text,done);});
    } else fallbackCopy(text,done);
  }
  function fallbackCopy(text,done){
    var ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{document.execCommand('copy');done();}catch(e){}
    document.body.removeChild(ta);
  }

  function button(text,cls){
    var b=document.createElement('button'); b.type='button'; b.className=cls||'btn btn-ghost'; b.textContent=text; return b;
  }
  function renderList(containerId,items,renderer){
    var box=$(containerId); if(!box)return;
    box.innerHTML='';
    items.forEach(function(item,index){ box.appendChild(renderer(item,index)); });
  }
  function emptyRow(text){
    var d=document.createElement('div'); d.className='tool-empty'; d.textContent=text; return d;
  }

  // Revenue calculator
  function calcRevenue(){
    var reach=Math.max(0,num('reach')), lead=Math.max(0,Math.min(100,num('leadRate'))), close=Math.max(0,Math.min(100,num('closeRate'))), price=Math.max(0,num('price'));
    var leads=Math.round(reach*lead/100), customers=Math.round(leads*close/100), revenue=customers*price;
    if($('revenueResult'))$('revenueResult').textContent=money.format(revenue);
    if($('revenueMeta'))$('revenueMeta').textContent=leads+' leads · '+customers+' customers';
  }
  ['reach','leadRate','closeRate','price'].forEach(function(id){if($(id))$(id).addEventListener('input',calcRevenue);});

  // UTM builder
  var builtUtm='';
  if($('buildUtm'))$('buildUtm').addEventListener('click',function(){
    clearError();
    try{
      var raw=value('baseUrl'); if(!raw)throw new Error('Enter a destination URL first.');
      var u=new URL(raw); if(!/^https?:$/.test(u.protocol))throw new Error('Use a valid http or https URL.');
      function slug(s,def){return (s||def).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||def;}
      u.searchParams.set('utm_source','instagram'); u.searchParams.set('utm_medium','social');
      u.searchParams.set('utm_campaign',slug(value('campaign'),'nudge-campaign')); u.searchParams.set('utm_content',slug(value('content'),'post'));
      builtUtm=u.toString(); $('utmOutput').textContent=builtUtm; $('copyUtm').disabled=false;
    }catch(e){$('utmOutput').textContent=e.message;$('copyUtm').disabled=true;}
  });
  if($('copyUtm'))$('copyUtm').addEventListener('click',function(){copyText(builtUtm,this);});

  // CTA generators
  function generateCta(offerId,keywordId,outId){
    var offer=value(offerId)||'my offer', keyword=(value(keywordId)||'INFO').toUpperCase().replace(/[^A-Z0-9_-]/g,'');
    if(!keyword)keyword='INFO';
    $(outId).textContent='Comment '+keyword+' and I\'ll send you the details for '+offer+'.';
  }
  if($('generateCta'))$('generateCta').addEventListener('click',function(){generateCta('offer','keyword','ctaOutput');});
  if($('generateCta2'))$('generateCta2').addEventListener('click',function(){generateCta('offer2','keyword2','ctaOutput2');});

  // Ideas
  var ideas=read(KEYS.ideas,[]);
  function renderIdeas(){
    var box=$('ideaList'); if(!box)return; box.innerHTML='';
    if(!ideas.length){box.appendChild(emptyRow('No ideas saved yet.'));return;}
    ideas.slice().reverse().forEach(function(idea,reverseIndex){
      var row=document.createElement('div');row.className='idea-row';
      var text=document.createElement('span');text.textContent=idea.text||idea;
      var del=button('Delete');del.addEventListener('click',function(){
        var real=ideas.length-1-reverseIndex;ideas.splice(real,1);write(KEYS.ideas,ideas);renderIdeas();refreshSummary();
      });
      row.appendChild(text);row.appendChild(del);box.appendChild(row);
    });
  }
  if($('saveIdea'))$('saveIdea').addEventListener('click',function(){
    var v=value('ideaInput');if(!v)return;
    ideas.push({id:uid(),text:v,createdAt:new Date().toISOString()});write(KEYS.ideas,ideas);$('ideaInput').value='';renderIdeas();refreshSummary();notify('Idea saved.');
  });

  // Hook & caption studio
  var contentCopy='';
  if($('generateContent'))$('generateContent').addEventListener('click',function(){
    var topic=value('contentTopic')||'your topic', format=value('contentFormat')||'Reel', tone=value('contentTone')||'Educational';
    contentCopy='HOOK\n'+topic+' — here is what most creators get wrong.\n\n'+
      'STRUCTURE\n1. Open with the problem.\n2. Give 3 specific points.\n3. Show one practical example.\n4. End with one clear takeaway.\n\n'+
      'CAPTION\nIf you are creating '+format.toLowerCase()+' content about '+topic+', save this. Keep the delivery '+tone.toLowerCase()+', specific and easy to act on.\n\n'+
      'CTA\nComment INFO if you want the checklist.';
    $('contentOutput').textContent=contentCopy;
  });
  if($('copyContent'))$('copyContent').addEventListener('click',function(){copyText(contentCopy,this);});

  // Reel script builder
  var scriptCopy='';
  if($('generateScript'))$('generateScript').addEventListener('click',function(){
    var topic=value('scriptTopic')||'your topic', length=value('scriptLength')||'30 seconds', audience=value('scriptAudience')||'your audience';
    scriptCopy='REEL SCRIPT — '+length+'\n\nHOOK\n“Stop scrolling if you are a '+audience+' trying to '+topic+'.”\n\nVALUE 1\nStart with the biggest mistake: explain it in one sentence.\n\nVALUE 2\nShow the simple alternative and one example.\n\nVALUE 3\nGive one action the viewer can take today.\n\nPROOF\nAdd your result, screenshot, demonstration or specific example.\n\nCTA\n“Save this and comment INFO if you want the full checklist.”';
    $('scriptOutput').textContent=scriptCopy;
  });
  if($('copyScript'))$('copyScript').addEventListener('click',function(){copyText(scriptCopy,this);});

  // Repurposer
  var repurposeCopy='';
  if($('repurposeContent'))$('repurposeContent').addEventListener('click',function(){
    var source=value('repurposeInput')||'your original content';
    repurposeCopy='CONTENT REPURPOSE PACK\n\nREEL\nHook: '+source+' — explained in a simple way.\n3 quick value beats → proof/example → CTA.\n\nCAROUSEL\nSlide 1: The big idea\nSlide 2: The problem\nSlide 3: Key point #1\nSlide 4: Key point #2\nSlide 5: Key point #3\nSlide 6: Practical example\nSlide 7: CTA\n\nSTORIES\nStory 1: Ask a question about the problem.\nStory 2: Share the key insight.\nStory 3: Show proof/example.\nStory 4: Add a reply/DM CTA.\n\nCAPTION\n'+source+'\nSave this for later and share it with someone who needs it.';
    $('repurposeOutput').textContent=repurposeCopy;
  });
  if($('copyRepurpose'))$('copyRepurpose').addEventListener('click',function(){copyText(repurposeCopy,this);});

  // Hashtags
  var hashtagCopy='';
  if($('buildHashtags'))$('buildHashtags').addEventListener('click',function(){
    var niche=(value('hashtagNiche')||'creator').toLowerCase().replace(/\s+/g,''), audience=(value('hashtagAudience')||'community').toLowerCase().replace(/\s+/g,'');
    hashtagCopy='#'+niche+' #'+niche+'tips #'+niche+'creator #'+niche+'community #'+audience+' #'+audience+'tips #contentcreator #creatortips #instagramcreator #reelscreator #personalbrand #socialmediatips';
    $('hashtagOutput').textContent=hashtagCopy;
  });
  if($('copyHashtags'))$('copyHashtags').addEventListener('click',function(){copyText(hashtagCopy,this);});

  // Calendar
  var calendar=read(KEYS.calendar,[]);
  function renderCalendar(){
    var sorted=calendar.slice().sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});
    renderList('calendarList',sorted,function(item){
      var row=document.createElement('div');row.className='idea-row';
      var text=document.createElement('span');text.textContent=(item.date||'No date')+' · '+item.format+' · '+item.topic+' · '+item.status;
      var del=button('Delete');del.addEventListener('click',function(){calendar=calendar.filter(function(x){return x.id!==item.id;});write(KEYS.calendar,calendar);renderCalendar();refreshSummary();});
      row.appendChild(text);row.appendChild(del);return row;
    });
    if($('calDate')&&!$('calDate').value){$('calDate').value=new Date().toISOString().slice(0,10);}
  }
  if($('addCalendarItem'))$('addCalendarItem').addEventListener('click',function(){
    var topic=value('calTopic');if(!topic){notify('Add a content topic first.');return;}
    calendar.push({id:uid(),date:value('calDate')||new Date().toISOString().slice(0,10),format:value('calFormat'),topic:topic,status:value('calStatus')});
    write(KEYS.calendar,calendar);$('calTopic').value='';renderCalendar();refreshSummary();notify('Content added to calendar.');
  });

  // Brand deals
  var deals=read(KEYS.deals,[]);
  function renderDeals(){
    renderList('dealList',deals.slice().reverse(),function(item){
      var row=document.createElement('div');row.className='idea-row';
      var text=document.createElement('span');text.textContent=item.brand+' · '+money.format(item.amount||0)+' · '+item.status+(item.deadline?' · due '+item.deadline:'');
      var del=button('Delete');del.addEventListener('click',function(){deals=deals.filter(function(x){return x.id!==item.id;});write(KEYS.deals,deals);renderDeals();refreshSummary();});
      row.appendChild(text);row.appendChild(del);return row;
    });
  }
  if($('addDeal'))$('addDeal').addEventListener('click',function(){
    var brand=value('dealBrand');if(!brand){notify('Add a brand name first.');return;}
    deals.push({id:uid(),brand:brand,amount:Math.max(0,num('dealAmount')),deliverables:value('dealDeliverables')||'Not specified',deadline:value('dealDeadline'),status:value('dealStatus')});
    write(KEYS.deals,deals);['dealBrand','dealAmount','dealDeliverables','dealDeadline'].forEach(function(id){$(id).value='';});renderDeals();refreshSummary();notify('Brand deal added.');
  });

  // Rate card
  function renderRateCard(){
    var r=read(KEYS.rate,{reel:5000,story:2500,carousel:3500,ugc:7500});
    ['Reel','Story','Carousel','Ugc'].forEach(function(label){var id='rate'+label;if($(id))$(id).value=r[label.toLowerCase()];});
    if($('rateCardOutput'))$('rateCardOutput').textContent='Reel '+money.format(r.reel)+' · Story '+money.format(r.story)+' · Carousel '+money.format(r.carousel)+' · UGC '+money.format(r.ugc);
  }
  if($('saveRateCard'))$('saveRateCard').addEventListener('click',function(){
    var r={reel:Math.max(0,num('rateReel')),story:Math.max(0,num('rateStory')),carousel:Math.max(0,num('rateCarousel')),ugc:Math.max(0,num('rateUgc'))};
    write(KEYS.rate,r);renderRateCard();notify('Rate card saved.');
  });

  // Media kit
  var media=read(KEYS.media,{});
  function renderMedia(){
    ['mediaName','mediaHandle','mediaNiche','mediaFollowers','mediaEngagement','mediaAvgViews','mediaBio','mediaContact'].forEach(function(id){
      if($(id)&&media[id]!==undefined)$(id).value=media[id];
    });
    var preview=$('mediaKitPreview');if(!preview)return;
    preview.innerHTML='';
    var title=document.createElement('h3');title.textContent=value('mediaName')||'Your Creator Name';
    var handle=document.createElement('div');handle.className='media-kit-handle';handle.textContent=value('mediaHandle')||'@yourhandle';
    var niche=document.createElement('p');niche.textContent=value('mediaNiche')||'Creator · Your niche';
    var stats=document.createElement('div');stats.className='media-kit-stats';
    [['Followers',num('mediaFollowers').toLocaleString('en-IN')],['Engagement',(num('mediaEngagement')||0)+'%'],['Avg Reel views',num('mediaAvgViews').toLocaleString('en-IN')]].forEach(function(pair){
      var s=document.createElement('div');var strong=document.createElement('strong');strong.textContent=pair[1];var small=document.createElement('small');small.textContent=pair[0];s.appendChild(strong);s.appendChild(small);stats.appendChild(s);
    });
    var bio=document.createElement('p');bio.className='media-kit-bio';bio.textContent=value('mediaBio')||'Tell brands who your audience is and what you create.';
    var contact=document.createElement('p');contact.className='media-kit-contact';contact.textContent=value('mediaContact')||'Business enquiries: your@email.com';
    preview.appendChild(title);preview.appendChild(handle);preview.appendChild(niche);preview.appendChild(stats);preview.appendChild(bio);preview.appendChild(contact);
  }
  ['mediaName','mediaHandle','mediaNiche','mediaFollowers','mediaEngagement','mediaAvgViews','mediaBio','mediaContact'].forEach(function(id){if($(id))$(id).addEventListener('input',function(){
    media[id]=$(id).value;write(KEYS.media,media);renderMedia();
  });});
  if($('printMediaKit'))$('printMediaKit').addEventListener('click',function(){
    renderMedia();document.body.classList.add('printing-media-kit');setTimeout(function(){window.print();document.body.classList.remove('printing-media-kit');},50);
  });

  // Affiliate tracker
  var affiliates=read(KEYS.affiliates,[]);
  function renderAffiliates(){
    renderList('affiliateList',affiliates.slice().reverse(),function(item){
      var row=document.createElement('div');row.className='idea-row';
      var rate=item.clicks?((item.conversions/item.clicks)*100).toFixed(1):'0.0';
      var text=document.createElement('span');text.textContent=item.product+' · '+money.format(item.commission)+' · '+item.clicks+' clicks · '+item.conversions+' conversions · '+rate+'% CVR';
      var del=button('Delete');del.addEventListener('click',function(){affiliates=affiliates.filter(function(x){return x.id!==item.id;});write(KEYS.affiliates,affiliates);renderAffiliates();refreshSummary();});
      row.appendChild(text);row.appendChild(del);return row;
    });
  }
  if($('addAffiliate'))$('addAffiliate').addEventListener('click',function(){
    var product=value('affProduct');if(!product){notify('Add a product or offer first.');return;}
    affiliates.push({id:uid(),product:product,network:value('affNetwork'),clicks:Math.max(0,num('affClicks')),conversions:Math.max(0,num('affConversions')),commission:Math.max(0,num('affCommission'))});
    write(KEYS.affiliates,affiliates);['affProduct','affNetwork','affClicks','affConversions','affCommission'].forEach(function(id){$(id).value='';});renderAffiliates();refreshSummary();notify('Affiliate result added.');
  });

  // Collaborations
  var collabs=read(KEYS.collabs,[]);
  function renderCollabs(){
    renderList('collabList',collabs.slice().reverse(),function(item){
      var row=document.createElement('div');row.className='idea-row';
      var text=document.createElement('span');text.textContent=item.person+' · '+item.project+' · '+item.status+(item.due?' · due '+item.due:'');
      var del=button('Delete');del.addEventListener('click',function(){collabs=collabs.filter(function(x){return x.id!==item.id;});write(KEYS.collabs,collabs);renderCollabs();});
      row.appendChild(text);row.appendChild(del);return row;
    });
  }
  if($('addCollab'))$('addCollab').addEventListener('click',function(){
    var person=value('collabPerson'),project=value('collabProject');if(!person||!project){notify('Add the partner and project.');return;}
    collabs.push({id:uid(),person:person,project:project,due:value('collabDue'),status:value('collabStatus')});
    write(KEYS.collabs,collabs);['collabPerson','collabProject','collabDue'].forEach(function(id){$(id).value='';});renderCollabs();notify('Collaboration added.');
  });

  // Goals
  var goals=read(KEYS.goals,[]);
  function goalPct(g){return Math.max(0,Math.min(100,g.target>0?(g.current/g.target)*100:0));}
  function renderGoals(){
    renderList('goalList',goals.slice().reverse(),function(item){
      var row=document.createElement('div');row.className='goal-row';
      var head=document.createElement('div');head.className='goal-head';
      var name=document.createElement('strong');name.textContent=item.name;
      var pct=document.createElement('span');pct.textContent=Math.round(goalPct(item))+'%';
      head.appendChild(name);head.appendChild(pct);
      var bar=document.createElement('div');bar.className='goal-bar';var fill=document.createElement('span');fill.style.width=goalPct(item)+'%';bar.appendChild(fill);
      var meta=document.createElement('small');meta.textContent=item.current.toLocaleString('en-IN')+' / '+item.target.toLocaleString('en-IN')+' '+item.unit;
      var del=button('Delete');del.addEventListener('click',function(){goals=goals.filter(function(x){return x.id!==item.id;});write(KEYS.goals,goals);renderGoals();refreshSummary();});
      row.appendChild(head);row.appendChild(bar);row.appendChild(meta);row.appendChild(del);return row;
    });
  }
  if($('addGoal'))$('addGoal').addEventListener('click',function(){
    var name=value('goalName'),target=Math.max(1,num('goalTarget')),current=Math.max(0,num('goalCurrent'));if(!name){notify('Add a goal name first.');return;}
    goals.push({id:uid(),name:name,target:target,current:current,unit:value('goalUnit')});
    write(KEYS.goals,goals);$('goalName').value='';renderGoals();refreshSummary();notify('Goal added.');
  });

  // Quote calculator
  function calcQuote(){
    var followers=Math.max(0,num('quoteFollowers')),engagement=Math.max(0,Math.min(100,num('quoteEngagement'))),deliverables=Math.max(1,num('quoteDeliverables')),usage=Math.max(0,Math.min(200,num('quoteUsage')));
    var base=Math.max(500,followers*0.08+followers*engagement/100*20);
    var quote=Math.round(base*deliverables*(1+usage/100)/100)*100;
    if($('quoteResult'))$('quoteResult').textContent=money.format(quote);
  }
  if($('calculateQuote'))$('calculateQuote').addEventListener('click',calcQuote);

  // Summary
  function refreshSummary(){
    var activeDeals=deals.filter(function(d){return d.status!=='Completed'&&d.status!=='Paid';}).length;
    var dealRevenue=deals.filter(function(d){return d.status==='Paid'||d.status==='Completed';}).reduce(function(s,d){return s+(Number(d.amount)||0);},0);
    var affiliateRevenue=affiliates.reduce(function(s,a){return s+(Number(a.commission)||0);},0);
    var avgGoal=goals.length?Math.round(goals.reduce(function(s,g){return s+goalPct(g);},0)/goals.length):0;
    if($('summaryContent'))$('summaryContent').textContent=calendar.length;
    if($('summaryDeals'))$('summaryDeals').textContent=activeDeals;
    if($('summaryRevenue'))$('summaryRevenue').textContent=money.format(dealRevenue+affiliateRevenue);
    if($('summaryGoals'))$('summaryGoals').textContent=avgGoal+'%';
  }

  // Export / clear
  if($('exportCreatorData'))$('exportCreatorData').addEventListener('click',function(){
    var payload={exportedAt:new Date().toISOString(),ideas:ideas,calendar:calendar,deals:deals,affiliates:affiliates,collaborations:collabs,goals:goals,rateCard:read(KEYS.rate,{}),mediaKit:read(KEYS.media,{})};
    var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='nudge-creator-toolkit.json';a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
  });
  if($('clearCreatorData'))$('clearCreatorData').addEventListener('click',function(){
    if(!confirm('Clear all Creator Toolkit data stored in this browser? This cannot be undone.'))return;
    Object.keys(KEYS).forEach(function(k){localStorage.removeItem(KEYS[k]);});
    ideas=[];calendar=[];deals=[];affiliates=[];collabs=[];goals=[];media={};
    renderAll();notify('Creator Toolkit data cleared.');
  });

  function renderAll(){
    calcRevenue();calcQuote();renderIdeas();renderCalendar();renderDeals();renderRateCard();renderMedia();renderAffiliates();renderCollabs();renderGoals();refreshSummary();
  }
  renderAll();
})();