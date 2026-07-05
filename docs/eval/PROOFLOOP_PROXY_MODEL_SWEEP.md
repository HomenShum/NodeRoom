# ProofLoop Proxy Model Sweep

Generated: 2026-07-04T22:44:07.928Z
Base URL: https://noderoom.live
Real user mode: true
Runtime profile: standard
Scope: proxy_adapter_smoke
Full official task coverage claim: false
Included local proxy tasks: 3
Cheapest fully passing model: poolside/laguna-xs-2.1

## Scope

Passes are local live-browser proxy tasks per adapter, not full official benchmark tasks.

| Adapter | Local proxy task count | Local proxy task IDs |
| --- | ---: | --- |
| finch | 1 | finch-local-financial-evidence-qa |
| finauditing | 1 | finauditing-local-risk-and-misstatement-review |
| workstreambench | 1 | workstreambench-local-spreadsheet-workstream |

Not included in this run:

- SpreadsheetBench V1 full 912-task model-run scorer matrix
- SpreadsheetBench V2 full 321-task bundle/run/scorer/chart matrix
- BankerToolBench full 100-task official/live-UI matrix
- Proximitty underwriting proof-loop suite
- Accounting proof-loop suite
- Notion SDR/BDR proof-loop suite
- NodeRoom internal model-route/professional workflow evals
- Official Finch/FinAuditing/WorkstreamBench upstream scorers or judge credentials

## Cost Chart

| Model | Proxy task passes | Est. OpenRouter list cost | UI measured cost | Avg duration | Input $/M | Output $/M |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| z-ai/glm-5.2 | 3/3 | $0.2454 | $0.2450 | 129s | 0.77 | 2.42 |
| deepseek/deepseek-v4-flash | 1/3 | $0.0683 | $0.0690 | 476s | 0.09 | 0.18 |
| poolside/laguna-xs-2.1 | 3/3 | $0.0326 | $0.0330 | 107s | 0.06 | 0.12 |
| qwen/qwen3.7-plus | 3/3 | $0.1994 | $0.1990 | 191s | 0.32 | 1.28 |

## Runs

| Model | Adapter | Status | Room | Est. cost | Tokens in/out | Failed gates |
| --- | --- | --- | --- | ---: | ---: | --- |
| z-ai/glm-5.2 | finch | passed | [NR1RHOT8YL9](https://noderoom.live/?room=NR1RHOT8YL9&name=Proof+Loop) | $0.0213 | 27092/175 |  |
| z-ai/glm-5.2 | finauditing | passed | [NRLVLO8AUAH](https://noderoom.live/?room=NRLVLO8AUAH&name=Proof+Loop) | $0.0710 | 74593/5611 |  |
| z-ai/glm-5.2 | workstreambench | passed | [NRZ0HG6EWN2](https://noderoom.live/?room=NRZ0HG6EWN2&name=Proof+Loop) | $0.1531 | 173527/8059 |  |
| deepseek/deepseek-v4-flash | finch | failed | [NRVOIY1HS9X](https://noderoom.live/?room=NRVOIY1HS9X&name=Proof+Loop) | $0.0236 | 260890/447 | finch: live-room browser scenario failed |
| deepseek/deepseek-v4-flash | finauditing | passed | [NR114IGV15E](https://noderoom.live/?room=NR114IGV15E&name=Proof+Loop) | $0.0252 | 269583/5063 |  |
| deepseek/deepseek-v4-flash | workstreambench | failed | [NRHLPZ9ZOP0](https://noderoom.live/?room=NRHLPZ9ZOP0&name=Proof+Loop) | $0.0195 | 209738/3563 | workstreambench: live-room browser scenario failed |
| poolside/laguna-xs-2.1 | finch | passed | [NRTSTABCXSW](https://noderoom.live/?room=NRTSTABCXSW&name=Proof+Loop) | $0.0122 | 194651/4022 |  |
| poolside/laguna-xs-2.1 | finauditing | passed | [NR7WGCGIHRK](https://noderoom.live/?room=NR7WGCGIHRK&name=Proof+Loop) | $0.008741 | 139411/3135 |  |
| poolside/laguna-xs-2.1 | workstreambench | passed | [NRNTVRWKBCZ](https://noderoom.live/?room=NRNTVRWKBCZ&name=Proof+Loop) | $0.0117 | 191044/2189 |  |
| qwen/qwen3.7-plus | finch | passed | [NR55Z4WL4JC](https://noderoom.live/?room=NR55Z4WL4JC&name=Proof+Loop) | $0.0759 | 214926/5548 |  |
| qwen/qwen3.7-plus | finauditing | passed | [NR8PPHSO44V](https://noderoom.live/?room=NR8PPHSO44V&name=Proof+Loop) | $0.0182 | 44653/3031 |  |
| qwen/qwen3.7-plus | workstreambench | passed | [NRBKA2NPOM2](https://noderoom.live/?room=NRBKA2NPOM2&name=Proof+Loop) | $0.1054 | 256758/18143 |  |
