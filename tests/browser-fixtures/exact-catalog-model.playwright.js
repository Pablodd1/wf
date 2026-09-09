async page => {
  // Compiled local UI with explicitly synthetic, image-free API fixtures.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  const common={contract_version:'v2.0',source_hash:'a'.repeat(64),brand:'Rolex',intent:'WTB',listing_type:'WTB',category:'WATCH',
    image_status:'NO_IMAGE',image_key:null,image_url:null,thumbnail_url:null,image_urls:[],images:[],price_usd:null,
    original_price_amount:null,original_price_currency:null,price_research_eligible:false,model:null,
    raw_message_text:'[SYNTHETIC FIXTURE] One Rolex request with a complete reference.',
    raw_message:'[SYNTHETIC FIXTURE] One Rolex request with a complete reference.',raw_message_scope:'original_post',source_created_at:null,
    seller_display_name:null,source_listing_status:'ended',parent_listing_id:null,child_index:null,is_bundle:false};
  const projected={...common,id:'SYNTHETIC-CATALOG-MODEL',listing_id:'SYNTHETIC-CATALOG-MODEL',source_id:'SYNTHETIC-CATALOG-MODEL',reference:'126610LN',
    model:'Submariner',source_model:null,model_source:'CATALOG_EXACT_BRAND_REFERENCE',model_catalog_source_files:['synthetic-source-catalog.csv']};
  const explicit={...common,id:'SYNTHETIC-SOURCE-MODEL',listing_id:'SYNTHETIC-SOURCE-MODEL',source_id:'SYNTHETIC-SOURCE-MODEL',reference:'126610LN',model:'Literal source model'};
  const unresolved={...common,id:'SYNTHETIC-UNKNOWN-MODEL',listing_id:'SYNTHETIC-UNKNOWN-MODEL',source_id:'SYNTHETIC-UNKNOWN-MODEL',reference:'SYNTHETIC-UNKNOWN-123'};
  const rows=[projected,explicit,unresolved],calls=[],screenshots=[];
  await page.route('**/api/**',async route=>{
    const requestUrl=route.request().url();if(!requestUrl.startsWith('http://127.0.0.1:5191/'))throw new Error('Unexpected non-local API request');
    const [pathname,search='']=requestUrl.slice('http://127.0.0.1:5191'.length).split('?');
    const query=Object.fromEntries(search.split('&').filter(Boolean).map(pair=>pair.split('=').map(value=>decodeURIComponent(value.replace(/\+/g,' ')))));
    calls.push({path:pathname,query});let payload={success:true};
    if(pathname==='/api/canary/browse')payload={success:true,snapshot_id:'abcdef12-abcd-4abc-8def-123456abcdef',brands:[{brand:'Rolex',listing_count:3}],
      models:[{model:'Submariner',listing_count:1},{model:'Literal source model',listing_count:1},{model:'Reference-only listings',listing_count:1}],
      references:[],availableCountries:[],availableRegions:[]};
    else if(pathname==='/api/canary/trading-floor'){
      const model=query.model,selected=rows.filter(row=>!model||(row.model||'Reference-only listings')===model);
      payload={status:'ok',success:true,records:selected,total:selected.length,totalCount:selected.length,hasMore:false,nextCursor:null,snapshot_id:'abcdef12-abcd-4abc-8def-123456abcdef'};
    }else if(pathname.includes('price-research'))payload={success:true,count:0,records:[],results:[],stats:null,analytics_ready:false};
    else if(pathname==='/api/catalog-suggestions')payload={success:true,suggestions:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
  });
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const card=id=>page.locator('article[data-listing-id="'+id+'"]');
  const waitIds=async ids=>page.waitForFunction(ids=>JSON.stringify([...document.querySelectorAll('article[data-listing-id]')].map(e=>e.dataset.listingId))===JSON.stringify(ids),ids);
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('about:blank');
    await page.goto('http://127.0.0.1:5191/#/trading?brand=Rolex&model=Submariner');
    await waitIds([projected.id]);check((await card(projected.id).innerText()).includes('Submariner'),'Catalog model displayed on card');
    await card(projected.id).getByRole('button',{name:/126610LN/}).click();
    const detail=page.getByRole('region',{name:'Selected listing'});await detail.waitFor();
    await detail.getByText('Model from catalog · exact manufacturer and reference match',{exact:true}).waitFor();
    await detail.getByText('Original raw message',{exact:true}).click();
    check((await detail.innerText()).includes('[SYNTHETIC FIXTURE]'),'Original source context retained');
    check(await detail.locator('img').count()===0,'No image invented');
    await detail.scrollIntoViewIfNeeded();
    await detail.getByText('Model from catalog · exact manufacturer and reference match',{exact:true}).waitFor({state:'visible'});
    const file='output/playwright/catalog-model-'+viewport.name+'-'+Date.now()+'.png';await page.screenshot({path:file,fullPage:false});screenshots.push(file);
    check(await detail.isVisible(),'Catalog detail remains visibly settled after capture');
    await page.goto('about:blank');
    await page.goto('http://127.0.0.1:5191/#/trading?brand=Rolex&model=Literal%20source%20model');await waitIds([explicit.id]);
    await card(explicit.id).getByRole('button',{name:/126610LN/}).click();await detail.waitFor();
    check(!await detail.getByText('Model from catalog · exact manufacturer and reference match',{exact:true}).count(),'Literal source model never labelled catalog');
    await page.goto('about:blank');
    await page.goto('http://127.0.0.1:5191/#/trading?brand=Rolex&model=Reference-only%20listings');await waitIds([unresolved.id]);
    check(!await page.getByText('Model from catalog · exact manufacturer and reference match',{exact:true}).count(),'Unknown reference has no invented model provenance');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
  }
  check(calls.some(c=>c.path==='/api/canary/trading-floor'&&c.query.model==='Submariner'),'Displayed model filter reaches API');
  return {status:'PASS',synthetic_local_fixture:true,desktop_mobile:true,catalog_model_detail_provenance:true,source_model_preserved:true,reference_only_scope:true,paired_model_filter:true,no_invented_images:true,no_horizontal_overflow:true,screenshots,production_queries:0};
}
