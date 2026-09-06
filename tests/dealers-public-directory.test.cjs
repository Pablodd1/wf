'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const approved = [
  {id:'synthetic-alpha',display_name:'Synthetic Alpha',rating:4.5,review_count:2},
  {id:'synthetic-beta',display_name:'Synthetic Beta',rating:null,review_count:2},
  {id:'synthetic-gamma',display_name:'Synthetic Gamma',rating:null,review_count:0},
];
const defaultRpc = async (name,args) => {
  if(name==='get_approved_dealer_profile_v2') return {data:null,error:null};
  assert.equal(name,'get_approved_dealer_directory');
  const searched=approved.filter(row=>!args.p_search || row.display_name.toLowerCase().includes(args.p_search.toLowerCase()));
  const rated=searched.filter(row=>row.review_count>0),rows=args.p_rated?rated:searched;
  return {data:{dealers:rows.slice(args.p_offset,args.p_offset+args.p_limit),total:rows.length,all_total:searched.length,rated_total:rated.length},error:null};
};
let rpc=defaultRpc;
const dependency=require.resolve('../api/_lib/supabase');
require.cache[dependency]={id:dependency,filename:dependency,loaded:true,exports:{getClient:()=>({rpc:(...args)=>rpc(...args)})}};
process.env.VITE_USE_CANARY_V2='true';
const { publicDealer } = require('../api/dealers.js');
const {
  mariadbProfilePayload,
  mariadbProfiles,
  parsedSourceDate,
  ratedDealerEvidence,
  ratedProfilePayload,
  ratedProfiles,
  sourcePhone,
  topRatedProfiles,
  sourceProfilePayload,
} = require('../api/_lib/dealer-directory-source.cjs');
const dealersHandler = require('../api/dealers.js');
const dealerProfileHandler = require('../api/dealer-profile.js');

async function invoke(handler, query) {
  let statusCode = 200;
  let payload;
  const res = {
    setHeader() {},
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return value; },
  };
  await handler({ method: 'GET', query }, res);
  return { statusCode, payload };
}

test('public directory keeps Reference Check database-backed and does not require a dealer session', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealers.js'), 'utf8');
  assert.doesNotMatch(source, /authorizeDealer/);
  assert.match(source, /getClient/);
  assert.match(source, /get_approved_dealer_directory/);
});

test('Top Rated preserves source rank and feedback without inventing a numeric rating', () => {
  const profiles = topRatedProfiles();
  assert.equal(profiles.length, 25);
  assert.deepEqual(profiles.map(profile => profile.source_rank), Array.from({ length: 25 }, (_, index) => index + 1));
  assert.ok(profiles.every(profile => profile.rating === null));
  assert.ok(profiles.every(profile => profile.review_count >= 0));
  assert.ok(profiles.every(profile => profile.verified_phone === null));
  assert.ok(profiles.every(profile => profile.source_url?.startsWith('https://watchfacts.com/user/')));
});

test('Rated Dealers preserves feedback counts without inventing a five-point score', () => {
  const profiles = ratedProfiles();
  assert.equal(profiles.length, 53);
  assert.equal(profiles[0].display_name, 'Federico Maman');
  assert.equal(profiles[0].rating, null);
  assert.equal(profiles[0].review_count, 22);
  assert.equal(profiles[0].rating_evidence_status, 'SOURCE_FEEDBACK_COUNT');
  assert.equal(ratedDealerEvidence({ phone: '+1 (305) 988-8263' }).source_profile_id, '916');
  assert.equal(ratedDealerEvidence({ dealerId: '916' }).trust_status, 'Trusted User');
});

test('every rated dealer card resolves to an internal profile payload', () => {
  for (const dealer of ratedProfiles()) {
    const payload = ratedProfilePayload(dealer.id);
    assert.equal(payload?.success, true, dealer.id);
    assert.equal(payload?.dealer?.id, dealer.id);
    assert.equal(payload?.dealer?.rating, null);
    assert.equal(payload?.dealer?.review_count, dealer.review_count);
    assert.equal(payload?.dealer?.verified_phone, null);
    assert.equal(payload?.stats?.verified_contact_info, null);
    assert.equal(payload?.source_links, undefined);
    assert.equal(payload?.dealer?.source_url, undefined);
    assert.equal(payload?.source_provenance?.source_url, undefined);
  }
});

test('source phones remain private reconciliation evidence and are not publicly searchable', async () => {
  assert.equal(sourcePhone({ whatsapp_url: 'https://wa.me/17147340511' }), '+17147340511');
  for (const mode of ['top-rated', 'rated']) {
    const directory = await invoke(dealersHandler, { mode, pageSize: '100', q: '7147340511' });
    assert.equal(directory.statusCode, 200);
    assert.equal(directory.payload.total, 0);
    assert.deepEqual(directory.payload.dealers, []);
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealers.js'), 'utf8');
  assert.doesNotMatch(source, /digits\(profile\.verified_phone\)/);
});

test('directory serves approved database evidence and static source IDs cannot open public profiles', async () => {
  const directory = await invoke(dealersHandler, { mode: 'rated', pageSize: '25' });
  assert.equal(directory.statusCode, 200);
  assert.equal(directory.payload.total, 2);
  assert.equal(directory.payload.source, 'approved-canonical-database');

  const profile = await invoke(dealerProfileHandler, { id: 'watchfacts-source-3435' });
  assert.equal(profile.statusCode, 404);
  assert.equal(profile.payload.dealer, undefined);
});

test('Rated is a source-backed subset of the same approved All population', async () => {
  const all=(await invoke(dealersHandler,{mode:'all',pageSize:'100'})).payload;
  const rated=(await invoke(dealersHandler,{mode:'rated',pageSize:'100'})).payload;
  assert.equal(all.total,3);assert.equal(rated.total,2);
  assert.deepEqual(rated.dealers.map(row=>row.id),all.dealers.filter(row=>row.review_count>0).map(row=>row.id));
  assert.deepEqual(rated.reconciliation,{all_dealers_total:3,rated_dealers_total:2,rated_is_filtered_from_all:true});
  assert.equal(rated.dealers[1].rating,null,'Feedback count must not fabricate a score');
});

test('canonical directory pagination requests only the bounded page and exhausts the approved population', async () => {
  const source = Array.from({ length: 205 }, (_, index) => ({ id: `dealer-${index}` }));
  const offsets = [];
  rpc = async (_name, args) => {
      offsets.push(args.p_offset);
      return {
        data: {
          total: source.length,
          all_total: source.length,
          rated_total: 0,
          dealers: source.slice(args.p_offset, args.p_offset + args.p_limit),
        },
        error: null,
      };
  };
  try {
    const ids=[];
    for(let page=1;page<=3;page++) {
      const result=await invoke(dealersHandler,{page:String(page),pageSize:'100'});
      assert.equal(result.statusCode,200);assert.equal(result.payload.total,205);
      ids.push(...result.payload.dealers.map(row=>row.id));
    }
    assert.deepEqual(ids,source.map(row=>row.id));assert.deepEqual(offsets,[0,100,200]);
  } finally {rpc=defaultRpc;}
});

test('MariaDB dealer candidates publish sanitized business evidence and internal profiles', () => {
  const snapshot = require('../data/dealer-directory/mariadb-public-dealers-2026-08-19.json');
  assert.equal(snapshot.source_candidate_rows, 325);
  assert.equal(snapshot.exact_identity_components, 300);
  assert.equal(snapshot.exact_existing_canonical_matches, 1);
  assert.equal(snapshot.published_source_profiles, 270);
  assert.equal(snapshot.held_profiles, 29);
  assert.equal(snapshot.rated_source_profiles, 3);
  assert.equal(snapshot.held_reason_counts.ALL_SOURCE_ACCOUNTS_DELETED, 28);
  assert.equal(snapshot.held_reason_counts.INTERNAL_OR_TEST_PROFILE, 1);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(serialized, /\b\d{10,15}\b/);
  assert.ok(snapshot.profiles.every(profile => profile.verified_phone == null));
  assert.ok(snapshot.profiles.every(profile => profile.contact_publication_approved === false));
  const payload = mariadbProfilePayload(snapshot.profiles[0].id);
  assert.equal(payload.success, true);
  assert.equal(payload.dealer.id, snapshot.profiles[0].id);
  assert.equal(payload.stats.verified_contact_info, null);
  assert.equal(payload.listing_linkage_status, 'SOURCE_CANDIDATE_UNLINKED');
  assert.deepEqual(payload.listings, []);
});

test('source snapshot accounts for every crawled listing and review once', () => {
  const profiles = topRatedProfiles();
  const payloads = profiles.map(profile => sourceProfilePayload(profile.slug));
  assert.equal(payloads.reduce((sum, payload) => sum + payload.listings.length, 0), 376);
  assert.equal(payloads.reduce((sum, payload) => sum + payload.reviews.length, 0), 268);
});

test('source dates remove repost annotations and remain sortable', () => {
  assert.equal(parsedSourceDate('Aug 7, 2026· Reposted 26x').toISOString(), '2026-08-07T00:00:00.000Z');
  const payload = sourceProfilePayload('watchfacts-source-3435');
  assert.equal(payload.stats.first_post, '2026-08-04T00:00:00.000Z');
  assert.equal(payload.stats.latest_post, '2026-08-09T00:00:00.000Z');
});

test('bulk directory omits contact details even when contact consent is true', () => {
  const base = {
    id: 'dealer-1', display_name: 'Verified Dealer', contact_consent: false,
  };
  const privateResult = publicDealer({...base,verified_phone:'+1 305 555 0101'});
  assert.equal(privateResult.verified_phone, undefined);
  assert.equal('contact_consent' in privateResult, false);

  const publicResult = publicDealer({ ...base, contact_consent: true,verified_phone:'+1 305 555 0101',source_url:'https://watchfacts.com/private' });
  assert.equal(publicResult.verified_phone, undefined);
  assert.equal(publicResult.source_url,undefined);
});

test('source profile workflow is provenance-labeled and remains distinct from verified identity', () => {
  const payload = sourceProfilePayload('watchfacts-source-3435');
  assert.ok(payload);
  assert.equal(payload.dealer.rating, null);
  assert.equal(payload.stats.verified_contact_info, null);
  assert.equal(payload.source_provenance.source_system, 'WATCHFACTS_PUBLIC_TOP_RATED_SNAPSHOT');
  assert.equal(payload.source_links, undefined);
  assert.equal(payload.dealer.source_url, undefined);
  assert.ok(payload.source_provenance.captured_listing_count > 0);

  const directory = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerDirectory.tsx'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerProfile.tsx'), 'utf8');
  assert.doesNotMatch(directory, /public-source leaderboard/);
  assert.match(profile, /Top Rated dealer evidence/);
  assert.match(profile, /Captured facts remain distinct from internally verified seller lineage/);
  assert.match(directory, /Full profile/);
  assert.match(profile, /Verified dealer/);
  assert.doesNotMatch(directory, /Source profile/);
  assert.doesNotMatch(profile, /Open source listing|All source listings|Source WTS|Source WTB|Contact through public source/);
  assert.doesNotMatch(profile, /No source image/);
});

test('public dealer API payloads never expose private provenance URLs', async () => {
  for (const query of [
    { mode: 'top-rated', pageSize: '25' },
    { mode: 'rated', pageSize: '100' },
    { mode: 'all', pageSize: '100' },
  ]) {
    const response = await invoke(dealersHandler, query);
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(JSON.stringify(response.payload), /https:\/\/watchfacts\.com\//i);
    assert.ok(response.payload.dealers.every(dealer => dealer.verified_phone == null));
  }
  for (const id of ['watchfacts-source-3435', 'watchfacts-legacy-9641']) {
    const response = await invoke(dealerProfileHandler, { id });
    assert.equal(response.statusCode, 404);
    assert.doesNotMatch(JSON.stringify(response.payload), /https:\/\/watchfacts\.com\//i);
  }
});

test('Reference Check opens on All Dealers while rated evidence views remain available', () => {
  const directory = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerDirectory.tsx'), 'utf8');
  assert.match(directory, /useState<DirectoryView>\('all'\)/);
  assert.match(directory, /Reference Check/);
  assert.match(directory, /> All Dealers<\/button>/);
  assert.match(directory, /> Rated Dealers</);
  assert.doesNotMatch(directory, /Top Rated Dealers/);
  assert.doesNotMatch(directory, /> Legacy Profiles<\/button>/);
});

test('Workspace removes the redundant public market-access block and preserves the remaining tools', () => {
  const workspace = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerPortal.tsx'), 'utf8');
  assert.doesNotMatch(workspace, /Market access, with the evidence attached/);
  assert.doesNotMatch(workspace, /Public workspace/);
  assert.doesNotMatch(workspace, /title: 'Trading Floor'/);
  assert.doesNotMatch(workspace, /title: 'Price Research'/);
  assert.match(workspace, /title: 'POST IT'/);
  assert.match(workspace, /title: 'Reference Check'/);
  assert.match(workspace, /title: 'Dealer Account'/);
});
