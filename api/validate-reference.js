/**
 * Reference Validator API
 * Checks if a watch reference exists in known catalogs
 */

const KNOWN_REFS = new Set([
    '5711/1A','5711/1R','5711/1300A','5712/1A','5712/1R','5712/1G','5712GR-001',
    '5726/1A','5990/1A','5990/1R','5980/1A','5980/1R','5980/1400G',
    '7118/1A','7118/1R','7118/1200A','7118/1200R','7118/1450G','7118/1451G',
    '7300/1200A','7300/1200R','4910/1200A','4910/1201R','5267/200A',
    '5268/200R','5268/461G','4962/200R','4997/200R','4997/200G',
    '5167A','5167R','5168G','5164A','5164R','5067A','5062/450R',
    '5205R','5227G','5231G','5236P','5270P','5270R','5271/',
    '5370P','5374G','5320G','5326G','5327R','5396R','5524G','5524R',
    '6104G','6102R','5146G','5146R','5147G','5196G','5226G',
    '126334','126334G','126333','126331','126300','126303',
    '126234','126231','126233','126200','126201',
    '126503','126508','126518','126519','126500','126505',
    '126600','126603','126621','126622','126655','126711',
    '126715','126719','126720','228238','228235','228239',
    '228206','228396','116500','116503','116508','116518',
    '116519','116506','116505','126529','126622',
    '124300','126000','124273','126200','278273','278288',
    '278240','278341','279135','279136','279138','279160',
    '279171','279173','279174','279175',
    '15510ST','15510OR','15510BC','15551ST','15551OR','15551BC',
    '15720ST','15720OR','15720BC','26240ST','26240OR','26240BC',
    '26231ST','26231OR','26420SO','26420RO','26420IO','26420CE',
    '26574ST','26574OR','26574PT','26579CB','26579CE','26586IP',
    '15400ST','15400OR','15400BC','15202ST','15202OR','15202BC',
    '16202ST','16202OR','16202BC','16202XT','26331ST','26331OR',
    '26331BC','26315OR','77351OR','77351ST','77350CE','77451OR',
    '77451ST','67651OR','67651ST','67650SR',
    'RM07-01','RM07-02','RM037','RM67-02','RM11-03','RM11-04',
    'RM35-03','RM65-01','RM72-01','RM88','RM47','RM50-03',
    'RM52-05','RM56-02','RM27-04',
]);

function normalizeRef(ref) {
    if (!ref) return null;
    ref = ref.toUpperCase().trim().replace(/[\/\-]$/, '');
    return ref;
}

module.exports = function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let references = [];
    if (req.method === 'POST') {
        const body = req.body;
        references = Array.isArray(body) ? body : body ? [body.reference || body.ref] : [];
    } else {
        references = [req.query.ref || req.query.reference];
    }
    references = references.filter(Boolean);

    if (references.length === 0) {
        return res.status(400).json({ error: 'No references provided. Use ?ref=5712/1A' });
    }

    const results = references.map(ref => {
        const normalized = normalizeRef(ref);
        const isKnown = normalized ? KNOWN_REFS.has(normalized) : false;
        
        const partialMatch = !isKnown && normalized ? Array.from(KNOWN_REFS).some(known => 
            normalized.startsWith(known) || known.startsWith(normalized)
        ) : false;

        return {
            reference: ref,
            normalized,
            valid: isKnown || partialMatch,
            confidence: isKnown ? 100 : partialMatch ? 75 : 0,
            note: isKnown ? 'Verified in catalog' : partialMatch ? 'Partial match - verify suffix' : 'Unknown reference - verify against brand website',
        };
    });

    return res.status(200).json({
        checked: results.length,
        valid: results.filter(r => r.valid).length,
        invalid: results.filter(r => !r.valid).length,
        results
    });
};
