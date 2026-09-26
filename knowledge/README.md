# District knowledge

Real planning documents for each district, used to find **region-specific
livelihood opportunities**. Every opportunity the assistant mentions is quoted
from one of these files, with the page it came from.

```
knowledge/<state>/<district-id>/<type>_<anything>.pdf|.md|.txt
```

`<district-id>` must match an `id` in `data/districts.json` (e.g. `jhansi`,
`gaya`, `nashik`). The file-name prefix sets the source type:

| Prefix | Document | Where to get it |
|---|---|---|
| `dips_` | District Industrial Potential Survey | MSME-DFO (MSME Development & Facilitation Office) for the state |
| `odop_` | One District One Product entry | ODOP portal (Invest India / DPIIT) and the state ODOP site |
| `plp_` | NABARD Potential Linked Credit Plan | NABARD regional office / nabard.org publications |
| `dsdp_` | District Skill Development Plan | State Skill Development Mission / SANKALP |
| `ncs_` | Job openings export | National Career Service portal (ncs.gov.in) |

Example: `knowledge/uttar-pradesh/jhansi/dips_jhansi.pdf`

Then:

```bash
npm run ingest:regions          # chunk (and embed, if GOOGLE_API_KEY is set)
npm run extract:opportunities   # cards, each quoting its source; needs GROQ_API_KEY
```

Do not put made-up or summarised text here. The whole point is that what the
assistant says can be traced to an official document and page.
